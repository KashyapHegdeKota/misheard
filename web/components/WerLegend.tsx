import { WER_SCALE_MAX, WER_SCALE_MID, werGradient } from "@/lib/color";
import styles from "./WerLegend.module.css";

/** The key to the one color scale. Used under the hero and on the map. */
export function WerLegend({ className = "" }: { className?: string }) {
  const pct = (w: number) => `${Math.round(w * 100)}%`;
  return (
    <div className={`${styles.legend} ${className}`} role="img" aria-label={`Color scale: word error rate from 0% in green, through ${pct(WER_SCALE_MID)} in amber, to ${pct(WER_SCALE_MAX)} or more in red.`}>
      <span className={styles.title}>Word error rate</span>
      <span className={styles.bar} style={{ background: werGradient() }} aria-hidden />
      <span className={styles.ticks} aria-hidden>
        <span>0%</span>
        <span>{pct(WER_SCALE_MID)}</span>
        <span>{pct(WER_SCALE_MAX)}+</span>
      </span>
    </div>
  );
}
