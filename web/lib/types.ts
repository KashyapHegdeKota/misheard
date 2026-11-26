// Types for the data contract (public/data/clips.json) and for the files the build
// step derives from it. Nothing in here is a value: every number, label and
// transcript shown on the page is read from the data at build or run time.

export type ConditionKey = "clean" | "noisy" | "overlapping" | "accented";

export type Op = "equal" | "sub" | "del" | "ins";

export interface AlignOp {
  op: Op;
  ref: string | null;
  hyp: string | null;
}

export interface RefWord {
  w: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface ClipTags {
  snr_db?: number;
  noise?: string; // low | mid | high
  overlap_ratio?: number;
  overlap?: boolean;
  wpm?: number;
  speed?: string; // slow | normal | fast
  n_speakers?: number;
  accent?: string; // native | non-native
  native_languages?: string[];
}

export interface ModelResult {
  hyp: string;
  wer: number;
  ops: AlignOp[];
}

export interface Clip {
  id: string;
  x: number;
  y: number;
  audio: string;
  duration: number;
  meeting?: string;
  mic?: string;
  tags: ClipTags;
  conditions: string[];
  ref: string;
  words: RefWord[];
  results: Record<string, ModelResult | undefined>;
}

export interface ModelMeta {
  id: string;
  label: string;
  detail?: string;
}

export interface Meta {
  dataset: string;
  models: ModelMeta[];
  primary_model: string;
  metric: string;
  n_clips: number;
  generated_at: string;
}

export interface Cell {
  wer?: number;
  n?: number;
}

export type ByCondition = Record<string, Record<string, Cell | undefined>>;

export interface Headline {
  model: string;
  from_condition: string;
  to_condition: string;
  from_wer: number;
  to_wer: number;
}

export interface ChartPoint {
  label: string;
  wer: number;
  n?: number;
}

export interface ChartSeries {
  model: string;
  points: ChartPoint[];
}

export interface Finding {
  key: string;
  title: string;
  stat: string;
  chart: { x_label?: string; y_label?: string; series: ChartSeries[] };
  example_clip: string;
}

export interface Summary {
  by_condition: ByCondition;
  headline: Headline;
  findings: Finding[];
  worst10: string[];
  karaoke_clip: string;
}

/** Light per-clip record the build step writes for clips that the page needs
 *  before the user has clicked anything (hero, findings, worst-10 list). */
export interface ClipBrief {
  id: string;
  audio: string;
  duration: number;
  conditions: string[];
  wer: Record<string, number | null>;
}

/** generated/site.json: everything the statically rendered page needs. */
export interface SiteData {
  isSample: boolean;
  nClips: number;
  meta: Meta;
  summary: Summary;
  briefs: Record<string, ClipBrief>;
  karaoke: Clip;
  /** full records of the clips the findings play, by clip id */
  examples: Record<string, Clip>;
}

/** One row of public/data/points.json: the light record behind every dot. */
export interface Point {
  id: string;
  x: number;
  y: number;
  /** number of reference words (the WER denominator) */
  nw: number;
  /** WER per model id (null when the model has no result for this clip) */
  wer: Record<string, number | null>;
  /** error count (S + D + I) per model id, for pooling WER over a filtered selection */
  err: Record<string, number | null>;
  noise: string | null;
  overlap: boolean | null;
  accent: string | null;
  speed: string | null;
  conditions: string[];
}

export interface PointsFile {
  models: string[];
  points: Point[];
}
