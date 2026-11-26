import type { AlignOp, Op, RefWord } from "./types";

/** One cell of the aligned transcript: what was said, what the model wrote, and when. */
export interface Token {
  /** stable key: position in the alignment */
  i: number;
  op: Op;
  /** the reference word (what was said); null for insertions */
  ref: string | null;
  /** the model's word; null for deletions */
  hyp: string | null;
  /** seconds from clip start when the word begins (insertions borrow the previous word's end) */
  start: number;
  end: number;
  speaker?: string;
  /** true when start/end come from words[]; false for the evenly spaced fallback */
  timed: boolean;
}

export interface OpCounts {
  sub: number;
  del: number;
  ins: number;
  equal: number;
  /** reference words: the WER denominator */
  ref: number;
}

export function countOps(ops: AlignOp[]): OpCounts {
  const c: OpCounts = { sub: 0, del: 0, ins: 0, equal: 0, ref: 0 };
  for (const o of ops) {
    c[o.op]++;
    if (o.op !== "ins") c.ref++;
  }
  return c;
}

/**
 * Join the alignment to the word timings. The i-th ref-bearing op (equal, sub or
 * del) is the i-th entry of words[]; insertions have no reference word and so no
 * timing of their own, so they appear when the previous reference word ends.
 *
 * If words[] is missing or the wrong length the tokens are spaced evenly over the
 * clip so the view still works; those tokens are marked `timed: false`.
 */
export function buildTokens(ops: AlignOp[], words: RefWord[] | undefined, duration: number): Token[] {
  const nRef = ops.reduce((n, o) => n + (o.op === "ins" ? 0 : 1), 0);
  const usable = Array.isArray(words) && words.length === nRef && nRef > 0;
  const slot = nRef > 0 ? duration / nRef : 0;

  const tokens: Token[] = [];
  let r = 0;
  let prevEnd = 0;
  let prevSpeaker: string | undefined;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === "ins") {
      const nextStart = nextRefStart(ops, i, words, usable, slot, duration, r);
      const start = Math.min(prevEnd, nextStart);
      tokens.push({
        i,
        op: "ins",
        ref: null,
        hyp: o.hyp,
        start,
        end: Math.max(start, Math.min(nextStart, start + 0.25)),
        speaker: prevSpeaker,
        timed: usable,
      });
      continue;
    }
    const w = usable ? words![r] : undefined;
    const start = w ? w.start : r * slot;
    const end = w ? w.end : r * slot + slot * 0.85;
    tokens.push({ i, op: o.op, ref: o.ref, hyp: o.hyp, start, end, speaker: w?.speaker, timed: usable });
    prevEnd = Math.max(prevEnd, end);
    prevSpeaker = w?.speaker ?? prevSpeaker;
    r++;
  }
  return tokens;
}

function nextRefStart(
  ops: AlignOp[],
  from: number,
  words: RefWord[] | undefined,
  usable: boolean,
  slot: number,
  duration: number,
  nextRefIndex: number,
): number {
  for (let j = from + 1; j < ops.length; j++) {
    if (ops[j].op !== "ins") return usable ? words![nextRefIndex].start : nextRefIndex * slot;
  }
  return duration;
}

/** True when the token is an error of any kind. */
export const isError = (t: Pick<Token, "op">) => t.op !== "equal";

/** A short phrase for screen readers and tooltips. */
export function describeToken(t: Token): string {
  switch (t.op) {
    case "equal":
      return t.ref ?? "";
    case "sub":
      return `model wrote “${t.hyp}” where the speaker said “${t.ref}”`;
    case "del":
      return `model missed “${t.ref}”`;
    case "ins":
      return `model added “${t.hyp}”, which nobody said`;
  }
}
