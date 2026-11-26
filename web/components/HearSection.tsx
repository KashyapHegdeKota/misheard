import { modelLabel, primaryModel, site } from "@/lib/site";
import { werColor } from "@/lib/color";
import { fmtPct, fmtSeconds } from "@/lib/format";
import { conditionLabel } from "@/lib/wording";
import { Karaoke } from "./Karaoke";
import { Reveal } from "./Motion";
import styles from "./HearSection.module.css";

/** Section 2: the karaoke clip. Hear it, and read it, word by word. */
export function HearSection() {
  const clip = site.karaoke;
  // the headline model if it has a result for this clip, else the first model that does
  const modelId = clip.results[primaryModel] ? primaryModel : (site.meta.models.find((m) => clip.results[m.id])?.id ?? primaryModel);
  const wer = clip.results[modelId]?.wer;

  return (
    <section id="hear" className="section" aria-labelledby="hear-title">
      <div className="container">
        <Reveal>
          <p className="eyebrow">01 — Hear it vs. read it</p>
          <h2 id="hear-title" className="h2">
            Hear it. Then read what the model heard.
          </h2>
          <p className="lead">
            Press play. The transcript fills in as each word is spoken: what {modelLabel(modelId)} wrote, with what was actually said above it.
          </p>
        </Reveal>
        <Reveal delay={0.1} className={styles.panel}>
          <div className={styles.bar}>
            <p className={`${styles.clip} mono`}>
              Clip {clip.id} · <span className="num">{fmtSeconds(clip.duration)}</span>
            </p>
            {clip.conditions.length > 0 && (
              <ul className={styles.chips} aria-label="Conditions">
                {clip.conditions.map((c) => (
                  <li key={c}>{conditionLabel(c)}</li>
                ))}
              </ul>
            )}
            <p className={styles.wer}>
              <span className={`${styles.werValue} num`} style={{ color: werColor(wer) }}>
                {fmtPct(wer)}
              </span>
              <span className={styles.werLabel}>WER</span>
            </p>
          </div>
          <Karaoke clip={clip} modelId={modelId} modelLabel={modelLabel(modelId)} />
        </Reveal>
      </div>
    </section>
  );
}
