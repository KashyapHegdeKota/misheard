// The one color scale on the page: green -> amber -> red for word error rate.
// It colors dots, table cells, chart bars and transcript marks, and nothing else
// on the page is allowed to carry a hue.
//
// The scale is defined in OKLCH (so the amber in the middle stays a clean amber
// rather than a muddy olive) and evaluated through a 256-entry lookup table.
// It is a pure function with no data in it: a clip's color depends only on its WER.

export type RGB = readonly [number, number, number];

/** Words are "fully red" at this error rate and beyond (WER can exceed 1). */
export const WER_SCALE_MAX = 0.5;
/** The amber midpoint of the scale. */
export const WER_SCALE_MID = WER_SCALE_MAX / 2;

/** Neutral grey for "no result". Deliberately not on the scale. */
export const NO_RESULT_RGB: RGB = [112, 112, 122];

const STOPS: { at: number; l: number; c: number; h: number }[] = [
  { at: 0, l: 0.8, c: 0.19, h: 150 }, // green
  { at: WER_SCALE_MID, l: 0.83, c: 0.165, h: 80 }, // amber
  { at: WER_SCALE_MAX, l: 0.64, c: 0.225, h: 24 }, // red
];

// ---- OKLCH -> sRGB ------------------------------------------------------------

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function encode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

function oklchToRgb(l: number, c: number, h: number): RGB {
  const hr = (h * Math.PI) / 180;
  // Reduce chroma until the color fits in sRGB, keeping lightness and hue.
  let lo = 0;
  let hi = c;
  let best = c;
  if (inGamut(oklabToLinear(l, c * Math.cos(hr), c * Math.sin(hr)))) lo = hi;
  else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(l, mid * Math.cos(hr), mid * Math.sin(hr)))) lo = mid;
      else hi = mid;
    }
    best = lo;
  }
  const lin = oklabToLinear(l, best * Math.cos(hr), best * Math.sin(hr));
  return [Math.round(encode(lin[0]) * 255), Math.round(encode(lin[1]) * 255), Math.round(encode(lin[2]) * 255)];
}

// ---- the scale ---------------------------------------------------------------

const LUT_SIZE = 256;
let lut: RGB[] | null = null;

function buildLut(): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * WER_SCALE_MAX;
    let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1].at) k++;
    const a = STOPS[k];
    const b = STOPS[k + 1];
    const u = Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)));
    // interpolate in OKLab (Cartesian) so hue transitions stay clean
    const ar = (a.h * Math.PI) / 180;
    const br = (b.h * Math.PI) / 180;
    const L = a.l + (b.l - a.l) * u;
    const A = a.c * Math.cos(ar) + (b.c * Math.cos(br) - a.c * Math.cos(ar)) * u;
    const B = a.c * Math.sin(ar) + (b.c * Math.sin(br) - a.c * Math.sin(ar)) * u;
    const C = Math.hypot(A, B);
    const H = (Math.atan2(B, A) * 180) / Math.PI;
    out.push(oklchToRgb(L, C, H));
  }
  return out;
}

/** RGB for a WER. Values at or beyond WER_SCALE_MAX saturate at red. */
export function werRGB(wer: number | null | undefined): RGB {
  if (wer == null || !Number.isFinite(wer)) return NO_RESULT_RGB;
  lut ??= buildLut();
  const t = Math.min(1, Math.max(0, wer / WER_SCALE_MAX));
  return lut[Math.round(t * (LUT_SIZE - 1))];
}

export const rgbCss = (rgb: RGB, alpha?: number) =>
  alpha === undefined ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`;

/** CSS color for a WER. */
export const werColor = (wer: number | null | undefined, alpha?: number) => rgbCss(werRGB(wer), alpha);

/** A CSS linear-gradient over the whole scale (0 .. WER_SCALE_MAX), for legends. */
export function werGradient(direction = "to right"): string {
  const n = 9;
  const stops = Array.from({ length: n }, (_, i) => {
    const w = (i / (n - 1)) * WER_SCALE_MAX;
    return `${werColor(w)} ${Math.round((i / (n - 1)) * 100)}%`;
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}
