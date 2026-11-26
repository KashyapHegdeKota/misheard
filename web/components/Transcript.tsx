import { countOps, type Token } from "@/lib/diff";
import { plural } from "@/lib/format";
import type { AlignOp } from "@/lib/types";
import styles from "./Transcript.module.css";

/**
 * Reference and model transcript side by side, differences marked.
 * Marks (same everywhere on the page): what was actually said is green, what the
 * model got wrong is red and crossed out, a missed word is a dashed gap, and a word
 * the model added is crossed out with a +.
 */
export function SideBySide({
  tokens,
  modelLabel,
  compact = false,
}: {
  tokens: Token[];
  modelLabel: string;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      <div className={styles.cols}>
        <div className={styles.col} role="group" aria-label="Reference transcript">
          <h4 className={styles.title}>What was said</h4>
          <p className={styles.text}>
            {tokens.map((t) =>
              t.op === "ins" ? null : (
                <span key={t.i}>
                  {t.op === "equal" ? t.ref : <mark className={styles.said}>{t.ref}</mark>}{" "}
                </span>
              ),
            )}
          </p>
        </div>
        <div className={styles.col} role="group" aria-label={`${modelLabel} transcript`}>
          <h4 className={styles.title}>{modelLabel}</h4>
          <p className={styles.text}>
            {tokens.map((t) => {
              if (t.op === "equal") return <span key={t.i}>{t.hyp} </span>;
              if (t.op === "sub")
                return (
                  <span key={t.i}>
                    <del className={styles.wrong}>{t.hyp}</del>{" "}
                  </span>
                );
              if (t.op === "ins")
                return (
                  <span key={t.i}>
                    <del className={`${styles.wrong} ${styles.added}`}>{t.hyp}</del>
                    <span className="sr-only"> (added by the model)</span>{" "}
                  </span>
                );
              return (
                <span key={t.i}>
                  <span className={styles.gap} role="img" aria-label={`missed “${t.ref}”`} />{" "}
                </span>
              );
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "2 substitutions · 1 deletion · 0 insertions", counted from the alignment. */
export function OpSummary({ ops }: { ops: AlignOp[] }) {
  const c = countOps(ops);
  return (
    <p className={`${styles.summary} num`}>
      <span>{plural(c.sub, "substitution")}</span>
      <span>{plural(c.del, "deletion")}</span>
      <span>{plural(c.ins, "insertion")}</span>
      <span>{plural(c.ref, "reference word")}</span>
    </p>
  );
}

/** The key to the marks, for panels that show a diff. */
export function DiffKey() {
  return (
    <ul className={styles.key} aria-label="Key to the marks">
      <li>
        <mark className={styles.said}>said</mark>
        <span>word the model got wrong or missed</span>
      </li>
      <li>
        <del className={styles.wrong}>heard</del>
        <span>wrong word</span>
      </li>
      <li>
        <span className={styles.gap} aria-hidden="true" />
        <span>missed</span>
      </li>
      <li>
        <del className={`${styles.wrong} ${styles.added}`}>extra</del>
        <span>added</span>
      </li>
    </ul>
  );
}
