"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prefetchClip } from "@/lib/data";
import { pauseAllAudio } from "@/lib/audio";
import { werColor } from "@/lib/color";
import { fmtPct } from "@/lib/format";
import type { ClipBrief, ModelMeta } from "@/lib/types";
import { ClipDetail } from "./ClipDetail";
import { ChevronIcon, CloseIcon } from "./icons";
import styles from "./WorstPlayer.module.css";

interface Props {
  clips: ClipBrief[];
  models: ModelMeta[];
  primaryModel: string;
  onClose: () => void;
}

/** A modal that steps through summary.worst10: the clips the primary model got
 *  most wrong. Opens playing; keeps going to the next clip when one ends. */
export function WorstPlayer({ clips, models, primaryModel, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [modelId, setModelId] = useState(primaryModel);
  const [auto, setAuto] = useState(true);
  const count = clips.length;
  const clip = clips[index];
  const primaryLabel = models.find((m) => m.id === primaryModel)?.label ?? primaryModel;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      pauseAllAudio();
      if (d.open) d.close();
    };
  }, []);

  // fetch the next clip's transcript ahead of time so stepping feels instant
  useEffect(() => {
    const next = clips[index + 1];
    if (next) prefetchClip(next.id);
  }, [clips, index]);

  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(count - 1, to))), [count]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else return;
    e.preventDefault();
  };

  if (!clip) return null;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="worst-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      onKeyDown={onKeyDown}
    >
      <div className={styles.frame}>
        <div className={styles.header}>
          <div>
            <p className="eyebrow">
              Clip <span className="num">{index + 1}</span> of <span className="num">{count}</span>
            </p>
            <h2 id="worst-title" className={styles.title}>
              The worst {count}
            </h2>
            <p className={styles.sub}>The clips {primaryLabel} got most wrong, worst first.</p>
          </div>
          <button type="button" className={styles.close} onClick={() => ref.current?.close()} aria-label="Close the worst-10 player">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <ol className={styles.list} aria-label="The clips, worst first">
            {clips.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={styles.item}
                  aria-current={i === index ? "true" : undefined}
                  onClick={() => go(i)}
                >
                  <span className={`${styles.rank} num`}>{i + 1}</span>
                  <span className={styles.itemId}>{c.id}</span>
                  <span className={`${styles.itemWer} num`} style={{ color: werColor(c.wer[primaryModel]) }}>
                    <span className="sr-only">WER </span>
                    {fmtPct(c.wer[primaryModel])}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className={styles.detail}>
            <ClipDetail key={clip.id} clipId={clip.id} models={models} modelId={modelId} onModelChange={setModelId} autoPlay onEnded={() => auto && index < count - 1 && go(index + 1)} />
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.step}>
            <button type="button" className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronIcon dir="left" size={16} />
              Previous
            </button>
            <button type="button" className="btn btn-primary" onClick={() => go(index + 1)} disabled={index === count - 1}>
              Next
              <ChevronIcon dir="right" size={16} />
            </button>
          </div>
          <label className={styles.auto}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Play on when a clip ends</span>
          </label>
        </div>
      </div>
    </dialog>
  );
}
