// The spending guard. Two limits, because they catch different accidents:
//
//   • per request — one runaway prompt (a pasted 200 k-token log, an agent loop that re-reads a
//     build directory) cannot cost more than a coffee. Checked BEFORE the call, on an estimate.
//   • per day — the sum of many reasonable calls. Checked before the call, on facts recorded
//     after previous ones.
//
// The ledger is injected rather than owned, so the core stays free of any VS Code or filesystem
// API and the tests can run a whole day of spending in a millisecond.

export interface Spend {
  day: string; // YYYY-MM-DD, local time: a developer's day, not UTC's
  usd: number;
  calls: number;
}

export interface SpendStore {
  read(): Spend | undefined;
  write(s: Spend): void;
}

export class MemorySpendStore implements SpendStore {
  private value: Spend | undefined;
  read(): Spend | undefined {
    return this.value;
  }
  write(s: Spend): void {
    this.value = s;
  }
}

/**
 * The limits the product ships with, in ONE place.
 *
 * ⚠️ They were in two, with different numbers, and the consequence was the exact defect this
 * project had already fixed once. `CHANGELOG` records it for the panel: a $2 daily cap refused the
 * eighth question of the day, silently, "so what the user saw was an extension that had stopped
 * working for no reason". The panel was raised to $20. **The terminal client kept `0.25` and `2`
 * hard-coded in its own config defaults** — so the same product refused in the terminal what it
 * allowed in the panel, by a factor of ten, and nobody noticed because nobody runs both halves on
 * the same day.
 *
 * It was found by the evaluation harness, which drives the terminal: after eleven tasks the daily
 * cap was reached and the next forty-two were refused before they started. In the results they were
 * indistinguishable from forty-two model failures — which is how a measurement comes to say
 * something that is not true.
 *
 * `package.json` declares the same numbers to the editor, and a test asserts the two agree.
 */
export const SHIPPED_LIMITS = { perRequestUsd: 2, dailyUsd: 20, perRequestTokens: 200_000 } as const;

export interface BudgetLimits {
  perRequestUsd: number;
  dailyUsd: number; // 0 = no limit
  /**
   * Prompt tokens past which one request is questioned whatever it costs. `0` = no limit.
   *
   * ⚠️ The dollar caps alone could not hold this line, and the reason is structural rather than a
   * mistake: they LOOSEN every time models get cheaper. The guard was calibrated when the middle
   * preset routed to a $120/M flagship, where a pasted build log of 400 000 tokens blew straight
   * through a $2 cap. The presets were then moved onto current models at $10/M — a tenfold
   * improvement, and the same runaway prompt now costs 80 cents and passes unquestioned. A test
   * caught it; nobody would have.
   *
   * For a tool whose argument is that your code does not leave, that is the wrong direction to
   * drift. 400 000 tokens of your repository going to a provider is worth a question at any price,
   * so the size is asked about on its own terms.
   */
  perRequestTokens?: number;
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: "per-request" | "per-request-size" | "daily"; message: string };

export class Budget {
  constructor(
    private readonly store: SpendStore,
    private limits: BudgetLimits,
    private readonly today: () => string = defaultToday,
  ) {}

  setLimits(limits: BudgetLimits): void {
    this.limits = limits;
  }

  spentToday(): number {
    const s = this.store.read();
    return s && s.day === this.today() ? s.usd : 0;
  }

  callsToday(): number {
    const s = this.store.read();
    return s && s.day === this.today() ? s.calls : 0;
  }

  /** Called before a remote request, with the estimated cost. Local calls never come here. */
  check(estimatedUsd: number, promptTokens?: number): BudgetVerdict {
    // Size first, because it is the question that does not get cheaper. A request this large is
    // almost always an accident — a pasted build log, a tool that read a minified bundle — and the
    // person wants to be asked even when the bill is small.
    const tokenCap = this.limits.perRequestTokens ?? 0;
    if (tokenCap > 0 && promptTokens !== undefined && promptTokens > tokenCap) {
      return {
        ok: false,
        reason: "per-request-size",
        message: `${promptTokens.toLocaleString("en-US")} prompt tokens exceeds the per-request ceiling of ${tokenCap.toLocaleString("en-US")}`,
      };
    }
    if (this.limits.perRequestUsd > 0 && estimatedUsd > this.limits.perRequestUsd) {
      return {
        ok: false,
        reason: "per-request",
        message: `estimated $${estimatedUsd.toFixed(3)} exceeds the per-request cap of $${this.limits.perRequestUsd.toFixed(2)}`,
      };
    }
    if (this.limits.dailyUsd > 0 && this.spentToday() + estimatedUsd > this.limits.dailyUsd) {
      return {
        ok: false,
        reason: "daily",
        message: `today's spend $${this.spentToday().toFixed(3)} + $${estimatedUsd.toFixed(3)} exceeds the daily cap of $${this.limits.dailyUsd.toFixed(2)}`,
      };
    }
    return { ok: true };
  }

  /** Called after a remote request, with what it really cost. */
  record(usd: number): void {
    const day = this.today();
    const cur = this.store.read();
    const base = cur && cur.day === day ? cur : { day, usd: 0, calls: 0 };
    this.store.write({ day, usd: base.usd + usd, calls: base.calls + 1 });
  }
}

function defaultToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
