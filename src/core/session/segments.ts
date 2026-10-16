// An answer as it happened: thinking and actions, then the words written at that point — step by step.
//
// ⚠️ « on a du mal à comprendre quelle réponse va avec quelle action et quel raisonnement sur les
// longues tâches ». An agent turn was stored as three heaps — all the thinking, all the steps, all
// the text — and drawn heap by heap, so on a twenty-step task nothing said which sentence followed
// which action. A segment is one stretch of the turn: what the model thought, the actions it took,
// and the text it wrote there. Drawn in order, the turn reads the way it was lived.
//
// A new segment starts when the model thinks again after it has written or acted, or writes again
// after it has acted. Text written before the actions of the same step stays with them: the panel
// shows the block (thinking and actions) first, then the words.

export interface SegmentStep {
  tool: string;
  summary: string;
  ok: boolean;
  call?: string;
}

export interface Segment {
  reasoning?: string;
  steps?: SegmentStep[];
  text?: string;
  /**
   * What the person typed while the turn ran, at the step the model read it. A segment of its own:
   * what follows is the model's work after the correction, and reads as such.
   */
  user?: string;
}

export class SegmentBuilder {
  readonly segments: Segment[] = [];
  /** An action has started in the current segment and its result has not come back yet. */
  private acting = false;

  private last(): Segment | undefined {
    return this.segments[this.segments.length - 1];
  }

  private open(): Segment {
    const s: Segment = {};
    this.segments.push(s);
    this.acting = false;
    return s;
  }

  /** The person's correction, read by the model now: everything after it starts afresh. */
  user(text: string): void {
    if (!text.trim()) return;
    this.segments.push({ user: text });
    this.acting = false;
  }

  reasoning(chunk: string): void {
    if (!chunk) return;
    const s = this.last();
    const target = !s || s.user !== undefined || s.text || s.steps?.length || this.acting ? this.open() : s;
    target.reasoning = (target.reasoning ?? "") + chunk;
  }

  text(chunk: string): void {
    if (!chunk) return;
    const s = this.last();
    const target = !s || s.user !== undefined || s.steps?.length || this.acting ? this.open() : s;
    target.text = (target.text ?? "") + chunk;
  }

  /** An action is starting: it belongs to the current segment. */
  acted(): void {
    const s = this.last();
    if (!s || s.user !== undefined) this.open();
    this.acting = true;
  }

  step(step: SegmentStep): void {
    const last = this.last();
    const s = last && last.user === undefined ? last : this.open();
    (s.steps ??= []).push(step);
  }

  /** A note was rewritten after it streamed (put back in the user's language): the record follows. */
  replace(from: string, to: string): void {
    if (!from || from === to) return;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i]!;
      if (s.text?.includes(from)) {
        s.text = s.text.replace(from, to);
        return;
      }
    }
  }
}

/**
 * An answer as the model re-reads it in later turns, with the person's corrections where they came.
 *
 * The saved answer is the model's words only; without this, a later turn would read work that
 * changed direction half-way for no visible reason — and could take the first direction up again.
 * Unchanged for an answer nobody interrupted.
 */
export function answerWithInterjections(text: string, segments?: Segment[]): string {
  if (!segments?.some((s) => s.user !== undefined)) return text;
  const parts: string[] = [];
  for (const s of segments) {
    if (s.user !== undefined) parts.push(`[The user, while you were working: ${s.user}]`);
    else if (s.text?.trim()) parts.push(s.text.trim());
  }
  return parts.join("\n\n");
}
