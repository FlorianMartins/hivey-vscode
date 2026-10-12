// A queue that survives the editor being closed.
//
// The point of shipping the ledger is that somebody is watching. A shipper that drops rows when the
// collector is down, or when the window closes mid-flush, is worse than no shipper: the SIEM shows a
// quiet afternoon and nobody knows whether it was quiet or whether the pipe was broken.
//
// So the queue is on disk, and the two operations are separate: a row is REMOVED only once the
// collector has taken it. A crash between sending and acknowledging re-sends the row — duplicates
// in a SIEM are a nuisance, a gap is a hole in an audit — and every row carries its `seq` and its
// `hash` from the chain, so a duplicate is recognisable and a gap is not guessable.
//
// ⚠️ AND AN UNSENT ROW STAYS VISIBLE. `pending()` is what the sovereignty report and the panel read:
// "the last 12 rows have not reached the collector since Tuesday" is the sentence this whole module
// exists to make possible. A queue that silently grew would be the same failure as dropping.

export interface QueueStore {
  read(): string | undefined;
  write(text: string): void;
}

export interface Queued {
  /** The row, already reduced to what may leave. */
  row: Record<string, unknown>;
  /** When it was queued, for "how long has this been stuck". */
  queuedAt: number;
  /** How many times sending it has failed. */
  attempts: number;
  /** The last reason it failed, for the panel and the report. */
  lastError?: string;
}

/**
 * How many rows are kept before the oldest are dropped.
 *
 * A bound is necessary — an editor left open for a month against a dead collector must not fill the
 * disk — and dropping has to be LOUD rather than silent, which is what `dropped` counts. The number
 * is high enough that an ordinary outage never reaches it: at one remote request a minute, this is
 * about three days.
 */
export const QUEUE_MAX = 5000;

export interface QueueState {
  rows: Queued[];
  /** Rows lost to the bound. Never reset by sending; only an operator acknowledging it clears it. */
  dropped: number;
  /** When the last successful send happened, so "nothing has reached the collector since" is sayable. */
  lastSentAt?: number;
}

const EMPTY: QueueState = { rows: [], dropped: 0 };

export class SiemQueue {
  private state: QueueState;

  constructor(private readonly store: QueueStore) {
    this.state = read(store);
  }

  /** Add a row. Returns false when the bound dropped something, so the caller can say so. */
  enqueue(row: Record<string, unknown>, now = Date.now()): boolean {
    this.state.rows.push({ row, queuedAt: now, attempts: 0 });
    let lost = false;
    while (this.state.rows.length > QUEUE_MAX) {
      this.state.rows.shift();
      this.state.dropped += 1;
      lost = true;
    }
    this.flush();
    return !lost;
  }

  /** The rows waiting, oldest first. Never more than `limit`, so one batch cannot be unbounded. */
  pending(limit = 200): Queued[] {
    return this.state.rows.slice(0, limit);
  }

  /** How many are waiting, for the panel. */
  depth(): number {
    return this.state.rows.length;
  }

  dropped(): number {
    return this.state.dropped;
  }

  lastSentAt(): number | undefined {
    return this.state.lastSentAt;
  }

  /**
   * The collector took these. Removed from the front, by identity rather than by count.
   *
   * By identity because a row may have been enqueued while the batch was in flight: removing "the
   * first n" would then drop a row that was never sent.
   */
  acknowledge(sent: Queued[], now = Date.now()): void {
    if (!sent.length) return;
    const gone = new Set(sent.map(identify));
    this.state.rows = this.state.rows.filter((q) => !gone.has(identify(q)));
    this.state.lastSentAt = now;
    this.flush();
  }

  /** Sending failed. The rows stay, and they remember why — which is what `pending` reports. */
  failed(rows: Queued[], why: string): void {
    const marked = new Set(rows.map(identify));
    for (const q of this.state.rows) {
      if (!marked.has(identify(q))) continue;
      q.attempts += 1;
      q.lastError = why.slice(0, 200);
    }
    this.flush();
  }

  /** An operator has seen the dropped count. Only this clears it. */
  acknowledgeDropped(): void {
    this.state.dropped = 0;
    this.flush();
  }

  private flush(): void {
    this.store.write(JSON.stringify(this.state));
  }
}

/** `seq` and `hash` together: the chain already guarantees they identify a row. */
function identify(q: Queued): string {
  return `${String(q.row["seq"])}:${String(q.row["hash"])}`;
}

function read(store: QueueStore): QueueState {
  const text = store.read();
  if (!text) return { ...EMPTY, rows: [] };
  try {
    const parsed = JSON.parse(text) as QueueState;
    if (!Array.isArray(parsed?.rows)) return { ...EMPTY, rows: [] };
    return {
      rows: parsed.rows.filter((q) => q && typeof q === "object" && q.row && typeof q.row === "object"),
      dropped: Number.isFinite(parsed.dropped) ? parsed.dropped : 0,
      ...(Number.isFinite(parsed.lastSentAt as number) ? { lastSentAt: parsed.lastSentAt } : {}),
    };
  } catch {
    // A corrupt queue file is not a reason to lose the ability to queue. It IS a reason to say so,
    // which the caller does by noticing the depth went to zero — and the alternative, throwing on
    // startup, would stop the extension because a log shipper could not read its spool.
    return { ...EMPTY, rows: [] };
  }
}

/**
 * How long the oldest unsent row has been waiting, in milliseconds.
 *
 * The number the panel turns into a sentence. `undefined` when nothing is waiting, which is not the
 * same as zero.
 */
export function stuckFor(queue: SiemQueue, now = Date.now()): number | undefined {
  const oldest = queue.pending(1)[0];
  return oldest ? now - oldest.queuedAt : undefined;
}
