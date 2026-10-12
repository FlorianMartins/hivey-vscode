// What a request is waiting for, said while it waits.
//
// ⚠️ "when two work at the same time … avoid the feeling of waiting with nothing happening". A
// self-hosted server with one slot serves requests in turn: while the other person's request
// finishes, this one sits in the queue, and the panel said "thinking…" over a model that had not
// started. llama.cpp says when it starts — with `return_progress` its first chunk is the progress of
// reading the prompt, and nothing at all arrives while the request is queued. So silence after a
// request on such a server IS the queue, and the progress that follows is the reading of the
// conversation, which on a long one is the other part of the wait.
//
// A server that has never sent progress cannot tell a queue from a slow prompt, so it gets the
// neutral "waiting for the server".

import type { ChatDelta } from "../providers/types.js";

export type Progress = NonNullable<ChatDelta["progress"]>;

/** Nothing is said for a wait this short: a label that flickers on every step is noise. */
export const QUIET_MS = 1500;
/** A prompt with fewer tokens than this left to read is read too fast to be worth a percentage. */
export const QUIET_TOKENS = 1500;

export interface WaitState {
  /** Milliseconds since the request left. */
  elapsedMs: number;
  /** The last reading progress the server reported for this request. */
  progress?: Progress;
  /** Has this server ever reported progress? Then its silence is a queue. */
  serverReportsProgress: boolean;
  /** The model has started answering — thinking or text. */
  started: boolean;
}

export type WaitLabel =
  | { kind: "none" }
  | { kind: "queued"; seconds: number }
  | { kind: "waiting"; seconds: number }
  | { kind: "reading"; percent: number };

export function waitLabel(s: WaitState): WaitLabel {
  if (s.started) return { kind: "none" };
  if (s.progress) {
    const left = s.progress.total - s.progress.cache;
    if (left < QUIET_TOKENS || s.progress.total <= 0) return { kind: "none" };
    return { kind: "reading", percent: Math.min(100, Math.max(0, Math.round((s.progress.processed / s.progress.total) * 100))) };
  }
  if (s.elapsedMs < QUIET_MS) return { kind: "none" };
  const seconds = Math.floor(s.elapsedMs / 1000);
  return s.serverReportsProgress ? { kind: "queued", seconds } : { kind: "waiting", seconds };
}

/**
 * The watch itself: told when a request leaves and what arrives, it ticks once a second and calls
 * `show` only when the label changes.
 */
export class WaitWatch {
  private sentAt = 0;
  private progress?: Progress;
  private started = true;
  private timer?: ReturnType<typeof setInterval>;
  private shown = "";

  constructor(
    private readonly show: (label: WaitLabel) => void,
    private readonly reportsProgress: () => boolean,
    private readonly onProgress: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** A request is leaving. */
  request(): void {
    this.sentAt = this.now();
    this.progress = undefined;
    this.started = false;
    this.timer ??= setInterval(() => this.render(), 1000);
    this.render();
  }

  /** Something arrived. */
  delta(d: ChatDelta): void {
    if (d.progress) {
      this.onProgress();
      this.progress = d.progress;
    }
    if (d.text || d.reasoning) this.started = true;
    this.render();
  }

  /** The turn is over. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.started = true;
    this.render();
  }

  private render(): void {
    const label = waitLabel({
      elapsedMs: this.now() - this.sentAt,
      ...(this.progress ? { progress: this.progress } : {}),
      serverReportsProgress: this.reportsProgress(),
      started: this.started,
    });
    const key = JSON.stringify(label);
    if (key === this.shown) return;
    this.shown = key;
    this.show(label);
  }
}
