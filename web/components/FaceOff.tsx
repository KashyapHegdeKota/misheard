import { site } from "@/lib/site";
import { werColor } from "@/lib/color";
import { fmtInt, fmtPct1 } from "@/lib/format";
import { CONDITION_ORDER, conditionLabel } from "@/lib/wording";
import { Reveal } from "./Motion";
import { WerLegend } from "./WerLegend";
import styles from "./FaceOff.module.css";

/** Section 5: models down the side, conditions across the top, cells shaded by
 *  error rate (the same scale as the map), n per cell in small type. */
export function FaceOff() {
  const bc = site.summary.by_condition;
  const models = site.meta.models;
  const present = new Set<string>();
  for (const m of models) for (const k of Object.keys(bc[m.id] ?? {})) if (bc[m.id]?.[k]?.wer !== undefined) present.add(k);
  const conditions = [
    ...CONDITION_ORDER.filter((k) => present.has(k)),
    ...[...present].filter((k) => k !== "all" && !CONDITION_ORDER.includes(k)),
  ];
  const cols = present.has("all") ? [...conditions, "all"] : conditions;

  // the lowest error in each column gets an outline
  const best = new Map<string, number>();
  for (const k of cols) {
    const vals = models.map((m) => bc[m.id]?.[k]?.wer).filter((v): v is number => typeof v === "number");
    if (vals.length > 1) best.set(k, Math.min(...vals));
  }

  return (
    <section id="faceoff" className="section" aria-labelledby="faceoff-title">
      <div className="container">
        <Reveal>
          <p className="eyebrow">04 — Model face-off</p>
          <h2 id="faceoff-title" className="h2">
            Every model, every condition
          </h2>
          <p className="lead">Word error rate for each model under each condition, shaded on the same scale as the map.</p>
        </Reveal>
        <Reveal delay={0.1} className={styles.wrap}>
          <div className={styles.scroll} role="region" aria-label="Model face-off table, scrolls sideways on small screens" tabIndex={0}>
            <table className={styles.table}>
              <caption className="sr-only">Word error rate by model and condition. Each cell also shows n, the sample size behind it.</caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.corner}>
                    Model
                  </th>
                  {cols.map((k) => (
                    <th key={k} scope="col" className={k === "all" ? styles.all : undefined}>
                      {k === "all" ? "All clips" : conditionLabel(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <th scope="row" className={styles.model}>
                      {m.label}
                    </th>
                    {cols.map((k) => {
                      const cell = bc[m.id]?.[k];
                      const wer = cell?.wer;
                      const isBest = typeof wer === "number" && best.get(k) === wer;
                      return typeof wer === "number" ? (
                        <td
                          key={k}
                          className={`${styles.cell} ${isBest ? styles.best : ""} ${k === "all" ? styles.all : ""}`}
                          style={{ background: werColor(wer, 0.36) }}
                          data-wer={wer}
                        >
                          <span className={`${styles.wer} num`}>{fmtPct1(wer)}</span>
                          {cell?.n !== undefined && <span className={`${styles.n} num`}>n={fmtInt(cell.n)}</span>}
                          {isBest && <span className="sr-only"> (lowest in this column)</span>}
                        </td>
                      ) : (
                        <td key={k} className={`${styles.cell} ${styles.none}`}>
                          –
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.foot}>
            <WerLegend />
            <p className={styles.note}>
              n is the sample size behind each cell. A clip can belong to more than one condition.
              {best.size > 0 && " The outlined cell is the lowest error in its column."}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
