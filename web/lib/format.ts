// Number and text formatting shared by the server-rendered page and the client
// components. Everything is locale-pinned so the HTML the build writes and the
// HTML React hydrates are identical.

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** WER as a percentage: one decimal below 10%, whole numbers above ("8.3%", "38%"). */
export function fmtPct(wer: number | null | undefined): string {
  if (wer == null || !Number.isFinite(wer)) return "–";
  const p = wer * 100;
  return Math.abs(p) < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** WER as a percentage with exactly one decimal ("11.2%"), for tables. */
export function fmtPct1(wer: number | null | undefined): string {
  if (wer == null || !Number.isFinite(wer)) return "–";
  return `${(wer * 100).toFixed(1)}%`;
}

/** Seconds as m:ss. */
export function fmtClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds with one decimal ("8.4 s"). */
export const fmtSeconds = (t: number) => `${t.toFixed(1)} s`;

/** ISO timestamp -> "2026-11-25" (UTC). */
export const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso);

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;
