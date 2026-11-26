import { brief, models, modelLabel, primaryModel, site } from "@/lib/site";
import { buildTokens } from "@/lib/diff";
import { publicUrl } from "@/lib/url";
import { Reveal } from "./Motion";
import { MiniChart } from "./MiniChart";
import { PlayExample } from "./PlayExample";
import { SideBySide } from "./Transcript";
import styles from "./Findings.module.css";

/** Section 3: one card per entry of summary.findings, straight from the data. */
export function Findings() {
  const findings = site.summary.findings;
  return (
    <section id="findings" className="section" aria-labelledby="findings-title">
      <div className="container">
        <Reveal>
          <p className="eyebrow">02 — Three findings</p>
          <h2 id="findings-title" className="h2">
            Where the errors come from
          </h2>
          <p className="lead">
            Each card compares word error rate across the clips, and lets you hear one example from the data.
          </p>
        </Reveal>
        <div className={styles.grid}>
          {findings.map((f, i) => {
            const clip = site.examples[f.example_clip];
            const b = brief(f.example_clip);
            const result = clip?.results[primaryModel];
            return (
              <Reveal key={f.key} delay={i * 0.12} className={styles.cell}>
                <article className={styles.card} data-finding={f.key}>
                  <p className="eyebrow">Finding {String(i + 1).padStart(2, "0")}</p>
                  <h3 className={styles.title}>{f.title}</h3>
                  <p className={styles.stat}>{f.stat}</p>
                  <MiniChart chart={f.chart} primary={primaryModel} labelOf={modelLabel} title={f.title} />
                  {b && (
                    <div className={styles.example}>
                      <PlayExample src={publicUrl(b.audio)} duration={b.duration} wer={b.wer[primaryModel] ?? null} label={f.title} />
                      {clip && result && (
                        <SideBySide tokens={buildTokens(result.ops, clip.words, clip.duration)} modelLabel={models.find((m) => m.id === primaryModel)?.label ?? primaryModel} compact />
                      )}
                    </div>
                  )}
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
