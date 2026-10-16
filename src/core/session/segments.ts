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

  reasoning(chunk: string): void {
    if (!chunk) return;
    const s = this.last();
    const target = !s || s.text || s.steps?.length || this.acting ? this.open() : s;
    target.reasoning = (target.reasoning ?? "") + chunk;
  }

  text(chunk: string): void {
    if (!chunk) return;
    const s = this.last();
    const target = !s || s.steps?.length || this.acting ? this.open() : s;
    target.text = (target.text ?? "") + chunk;
  }

  /** An action is starting: it belongs to the current segment. */
  acted(): void {
    if (!this.last()) this.open();
    this.acting = true;
  }

  step(step: SegmentStep): void {
    const s = this.last() ?? this.open();
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
