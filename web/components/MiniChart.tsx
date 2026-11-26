import { werColor } from "@/lib/color";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Finding } from "@/lib/types";
import { InView } from "./InView";
import styles from "./MiniChart.module.css";

// One small bar chart per finding, rendered as static SVG at build time from the
// finding's own chart data. Bars are the primary model's WER, colored on the shared
// WER scale; every other model in the data is a short white tick on the same category.

const W = 340;
const H = 176;
const PAD = { l: 34, r: 6, t: 28, b: 40 };

/** Round the top of the y axis up to a tidy value. */
function niceMax(v: number): number {
  const steps = [0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10];
  return steps.find((s) => s >= v) ?? Math.ceil(v);
}

export function MiniChart({
  chart,
  primary,
  labelOf,
  title,
}: {
  chart: Finding["chart"];
  primary: string;
  labelOf: (id: string) => string;
  title: string;
}) {
  const valid = (chart.series ?? []).map((s) => ({
    ...s,
    points: (s.points ?? []).filter((p) => typeof p.label === "string" && Number.isFinite(p.wer)),
  }));
  const main = valid.find((s) => s.model === primary) ?? valid[0];
  if (!main || main.points.length === 0) return null;
  const others = valid.filter((s) => s !== main && s.points.length > 0);

  const max = niceMax(Math.max(...valid.flatMap((s) => s.points.map((p) => p.wer)), 0.05));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const band = plotW / main.points.length;
  const barW = Math.min(46, band * 0.54);
  const y = (v: number) => PAD.t + plotH * (1 - Math.min(v, max) / max);
  const ticks = [0, max / 2, max];

  const description = `${chart.y_label ?? "WER"} by ${chart.x_label ?? "category"} for ${labelOf(main.model)}: ${main.points
    .map((p) => `${p.label} ${fmtPct(p.wer)}${p.n !== undefined ? ` (n=${fmtInt(p.n)})` : ""}`)
    .join("; ")}.`;

  return (
    <figure className={styles.figure}>
      <InView className={styles.chart}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${description}`} className={styles.svg}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? styles.axis : styles.grid} />
              <text x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end" className={styles.tick}>
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {main.points.map((p, i) => {
            const cx = PAD.l + band * (i + 0.5);
            const top = y(p.wer);
            // keep the value label clear of the other models' ticks
            const highest = Math.min(top, ...others.map((s) => y(s.points.find((x) => x.label === p.label)?.wer ?? 0)));
            return (
              <g key={`${p.label}-${i}`}>
                <rect
                  x={cx - barW / 2}
                  y={top}
                  width={barW}
                  height={Math.max(1, PAD.t + plotH - top)}
                  rx={3}
                  fill={werColor(p.wer)}
                  className={styles.bar}
                  style={{ transitionDelay: `${i * 90}ms` }}
                />
                <text x={cx} y={highest - 8} textAnchor="middle" className={styles.value}>
                  {fmtPct(p.wer)}
                </text>
                <text x={cx} y={H - 22} textAnchor="middle" className={styles.cat}>
                  {p.label}
                </text>
                {p.n !== undefined && (
                  <text x={cx} y={H - 8} textAnchor="middle" className={styles.n}>
                    n={fmtInt(p.n)}
                  </text>
                )}
                {others.map((s) => {
                  const q = s.points.find((x) => x.label === p.label);
                  if (!q) return null;
                  return (
                    <line key={s.model} x1={cx - barW / 2 - 5} x2={cx + barW / 2 + 5} y1={y(q.wer)} y2={y(q.wer)} className={styles.other}>
                      <title>{`${labelOf(s.model)}: ${fmtPct(q.wer)}`}</title>
                    </line>
                  );
                })}
              </g>
            );
          })}
          <text x={PAD.l - 8} y={10} textAnchor="end" className={styles.axisLabel}>
            {chart.y_label ?? "WER"}
          </text>
        </svg>
      </InView>
      <figcaption className={styles.caption}>
        {chart.x_label && <span>{chart.x_label}</span>}
        <span className={styles.key}>
          <i className={styles.swatch} aria-hidden="true" />
          {labelOf(main.model)}
          {others.length > 0 && (
            <>
              <i className={styles.tickSwatch} aria-hidden="true" />
              {others.length === 1 ? labelOf(others[0].model) : "other models"}
            </>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
