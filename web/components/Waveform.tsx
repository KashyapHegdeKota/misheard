"use client";

import { useEffect, useId, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { claimPlayback, releasePlayback } from "@/lib/audio";
import { fmtClock } from "@/lib/format";
import { PauseIcon, PlayIcon } from "./icons";
import styles from "./Waveform.module.css";

// wavesurfer.js decodes the clip to draw its waveform, so the library and the
// audio are only fetched when a clip is actually opened (never up front).

export interface WaveMark {
  start: number;
  end: number;
}

interface Props {
  src: string;
  duration: number;
  /** what this audio is, for the accessible names of the controls */
  label: string;
  /** spans where the model went wrong, drawn on the waveform */
  marks?: WaveMark[];
  autoPlay?: boolean;
  onEnded?: () => void;
}

type Status = "loading" | "ready" | "error";

export function Waveform({ src, duration, label, marks, autoPlay = false, onEnded }: Props) {
  const uid = useId();
  const box = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(duration);
  const onEndedRef = useRef(onEnded);
  const autoPlayRef = useRef(autoPlay);
  const marksRef = useRef(marks);
  useEffect(() => {
    onEndedRef.current = onEnded;
    autoPlayRef.current = autoPlay;
    marksRef.current = marks;
  });

  useEffect(() => {
    let cancelled = false;
    let instance: WaveSurfer | null = null;

    (async () => {
      try {
        const [{ default: WaveSurferCtor }, { default: RegionsPlugin }] = await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/plugins/regions"),
        ]);
        if (cancelled || !box.current) return;
        const regions = RegionsPlugin.create();
        instance = WaveSurferCtor.create({
          container: box.current,
          url: src,
          height: 56,
          waveColor: "rgba(255,255,255,0.30)",
          progressColor: "#f4f4f5",
          cursorColor: "#ffffff",
          cursorWidth: 2,
          barWidth: 2,
          barGap: 2,
          barRadius: 2,
          normalize: true,
          dragToSeek: true,
          plugins: [regions],
        });
        ws.current = instance;
        instance.on("ready", (d) => {
          if (cancelled) return;
          setDur(d);
          setStatus("ready");
          for (const m of marksRef.current ?? []) {
            regions.addRegion({
              start: m.start,
              end: Math.max(m.end, m.start + 0.04),
              color: "rgba(247, 56, 66, 0.30)",
              drag: false,
              resize: false,
            });
          }
          if (autoPlayRef.current) void instance?.play().catch(() => {});
        });
        instance.on("error", () => !cancelled && setStatus("error"));
        instance.on("play", () => {
          claimPlayback(uid, () => instance?.pause());
          setPlaying(true);
        });
        instance.on("pause", () => setPlaying(false));
        instance.on("finish", () => {
          setPlaying(false);
          releasePlayback(uid);
          onEndedRef.current?.();
        });
        instance.on("timeupdate", (t) => setTime(t));
        instance.on("interaction", (t) => setTime(t));
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      releasePlayback(uid);
      ws.current = null;
      try {
        instance?.destroy();
      } catch {
        /* already torn down */
      }
    };
  }, [src, uid]);

  const seekBy = (delta: number) => {
    const w = ws.current;
    if (!w) return;
    w.setTime(Math.max(0, Math.min(dur, w.getCurrentTime() + delta)));
    setTime(w.getCurrentTime());
  };

  const onKey = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowRight") seekBy(big);
    else if (e.key === "ArrowLeft") seekBy(-big);
    else if (e.key === "Home") seekBy(-Infinity);
    else if (e.key === "End") seekBy(Infinity);
    else return;
    e.preventDefault();
  };

  return (
    <div className={styles.root} data-status={status}>
      <button
        type="button"
        className={styles.play}
        onClick={() => ws.current?.playPause()}
        disabled={status !== "ready"}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      >
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <div
        className={styles.wave}
        role="slider"
        tabIndex={status === "ready" ? 0 : -1}
        aria-label={`Position in ${label}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(dur * 10) / 10}
        aria-valuenow={Math.round(time * 10) / 10}
        aria-valuetext={`${fmtClock(time)} of ${fmtClock(dur)}`}
        onKeyDown={onKey}
      >
        <div ref={box} className={styles.canvas} />
        {status === "loading" && <span className={styles.msg}>Loading audio…</span>}
        {status === "error" && <span className={styles.msg}>Audio is not available for this clip.</span>}
      </div>
      <span className={`${styles.clock} num`} aria-hidden="true">
        {fmtClock(time)} / {fmtClock(dur)}
      </span>
    </div>
  );
}
