"use client";

import { useClipPlayer, usePlayerTime } from "@/lib/audio";
import { werColor } from "@/lib/color";
import { fmtClock, fmtPct } from "@/lib/format";
import { PauseIcon, PlayIcon } from "./icons";
import styles from "./PlayExample.module.css";

/** A play button for one example clip. The audio is fetched on the first press. */
export function PlayExample({
  src,
  duration,
  wer,
  label,
}: {
  src: string;
  duration: number;
  wer: number | null;
  label: string;
}) {
  const { player, state } = useClipPlayer(src, duration);
  const t = usePlayerTime(player);
  const dur = state.duration || duration;
  const unavailable = state.status === "error";

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.btn}
        onClick={() => player.toggle()}
        disabled={unavailable}
        aria-label={state.playing ? `Pause the example clip: ${label}` : `Play an example clip: ${label}`}
      >
        {state.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <div className={styles.text}>
        <span className={styles.title}>{unavailable ? "Audio not available" : "Hear an example"}</span>
        <span className={`${styles.meta} num`}>
          WER <b style={{ color: werColor(wer) }}>{fmtPct(wer)}</b> · {fmtClock(state.playing || t > 0 ? t : 0)} / {fmtClock(dur)}
        </span>
      </div>
      <span className={styles.bar} aria-hidden="true">
        <i style={{ transform: `scaleX(${dur > 0 ? Math.min(1, t / dur) : 0})` }} />
      </span>
    </div>
  );
}
