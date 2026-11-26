import styles from "./SampleBanner.module.css";

/** Shown only when the site is built from the placeholder fixture (no clips.json). */
export function SampleBanner() {
  return (
    <div className={styles.banner} role="status">
      <span className={styles.tag}>Sample data</span>
      <span className={styles.text}>
        Placeholder clips, made-up words and fake models. None of these numbers are real results.
      </span>
    </div>
  );
}
