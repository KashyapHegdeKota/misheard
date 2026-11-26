import { site } from "@/lib/site";
import { COPY_STATUS, recommendations, sectionCopy } from "@/content/recommendations";
import { MapLink } from "./MapLink";
import { Reveal } from "./Motion";
import styles from "./Recommendations.module.css";

/** Section 6: the three kinds of audio to collect next. One item per finding in the
 *  data; the copy comes from content/recommendations.ts, the evidence from the data. */
export function Recommendations() {
  const findings = site.summary.findings;
  for (const f of findings) {
    if (!recommendations[f.key]) console.warn(`[content] no recommendation copy for finding key "${f.key}" in content/recommendations.ts`);
  }

  return (
    <section id="data" className="section" aria-labelledby="data-title">
      <div className="container">
        <Reveal>
          <p className="eyebrow">
            {sectionCopy.eyebrow}
            {COPY_STATUS === "draft" && <span className={styles.draft}>Draft copy</span>}
          </p>
          <h2 id="data-title" className="h2">
            {sectionCopy.title}
          </h2>
          <p className="lead">{sectionCopy.lead}</p>
        </Reveal>
        <ol className={styles.list}>
          {findings.map((f, i) => {
            const r = recommendations[f.key];
            return (
              <li key={f.key}>
                <Reveal className={styles.item}>
                  <span className={`${styles.index} num`} aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className={styles.main}>
                    <h3 className={styles.kind}>{r?.kind ?? f.title}</h3>
                    {r && <p className={styles.why}>{r.why}</p>}
                    {r && (
                      <ul className={styles.collect} aria-label="What to collect">
                        {r.collect.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className={styles.evidence} role="group" aria-label="Evidence from the results">
                    <p className="eyebrow">Evidence</p>
                    <p className={styles.stat}>{f.stat}</p>
                    {r?.mapFilters && <MapLink filters={r.mapFilters}>See these clips on the map</MapLink>}
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
