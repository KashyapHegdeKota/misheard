import { site } from "@/lib/site";
import { fmtDate, fmtInt } from "@/lib/format";
import { GithubIcon } from "./icons";
import styles from "./Footer.module.css";

export const REPO_URL = "https://github.com/KashyapHegdeKota/misheard";

/** Section 7: the method in three lines, from meta, plus the repo and the author. */
export function Footer() {
  const { meta } = site;
  return (
    <footer className={styles.footer} id="method">
      <div className="container">
        <p className="eyebrow">Method</p>
        <dl className={styles.method}>
          <div>
            <dt>Dataset</dt>
            <dd>{meta.dataset}</dd>
          </div>
          <div>
            <dt>Models</dt>
            <dd>
              {meta.models.map((m) => (
                <span key={m.id} className={styles.model}>
                  <b>{m.label}</b>
                  {m.detail && <span>: {m.detail}</span>}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>Metric</dt>
            <dd>{meta.metric}</dd>
          </div>
        </dl>
        <p className={`${styles.gen} num`}>
          {fmtInt(site.nClips)} clips · generated {fmtDate(meta.generated_at)}
        </p>

        <div className={styles.bottom}>
          <p className={styles.author}>Built by Kashyap Hegde Kota, CVPR 2026 co-author who built offline speech tagging at ~120 ms.</p>
          <a className={`btn ${styles.repo}`} href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label={`Source code on GitHub: ${REPO_URL}`}>
            <GithubIcon size={16} />
            github.com/KashyapHegdeKota/misheard
          </a>
        </div>
      </div>
    </footer>
  );
}
