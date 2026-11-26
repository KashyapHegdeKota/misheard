import { site } from "@/lib/site";
import { modelLabel } from "@/lib/site";
import { werColor } from "@/lib/color";
import { fmtInt, fmtPct } from "@/lib/format";
import { conditionLabel, conditionPhrase, modelFamily } from "@/lib/wording";
import { HeroField } from "./HeroField";
import { HeroActions } from "./HeroActions";
import { WerLegend } from "./WerLegend";
import styles from "./Hero.module.css";

export function Hero() {
  const h = site.summary.headline;
  const family = modelFamily(modelLabel(h.model));
  const verb = h.to_wer >= h.from_wer ? "jumps" : "falls";
  const fromNote = h.from_condition === "clean" ? "" : ` (${conditionLabel(h.from_condition).toLowerCase()})`;

  return (
    <header className={styles.hero} id="top">
      <HeroField model={site.meta.primary_model} />
      <div className={styles.shade} aria-hidden="true" />
      <div className={`container ${styles.inner}`}>
        <p className={`eyebrow ${styles.rise}`} style={{ animationDelay: "0s" }}>
          Misheard
        </p>
        <h1 className={styles.title}>Speech models mishear real conversations.</h1>
        <p className={styles.sub}>
          {family}&apos;s error rate {verb} from{" "}
          <strong className="num" style={{ color: werColor(h.from_wer) }}>
            {fmtPct(h.from_wer)}
          </strong>
          {fromNote} to{" "}
          <strong className="num" style={{ color: werColor(h.to_wer) }}>
            {fmtPct(h.to_wer)}
          </strong>{" "}
          {conditionPhrase(h.to_condition)}.
        </p>
        <HeroActions
          worst10={site.summary.worst10.map((id) => site.briefs[id]).filter(Boolean)}
          models={site.meta.models}
          primaryModel={site.meta.primary_model}
          className={styles.actions}
        />
        <div className={styles.foot}>
          <WerLegend />
          <p className={styles.count}>
            Each dot is one clip.{" "}
            <span className="num">
              {fmtInt(site.nClips)} clips · {site.meta.models.length} {site.meta.models.length === 1 ? "model" : "models"}
            </span>
          </p>
        </div>
      </div>
    </header>
  );
}
