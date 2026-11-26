"use client";

import { useMemo } from "react";
import { useClip } from "@/lib/data";
import { buildTokens } from "@/lib/diff";
import { fmtPct, fmtSeconds } from "@/lib/format";
import { publicUrl } from "@/lib/url";
import { werColor } from "@/lib/color";
import { conditionLabel } from "@/lib/wording";
import type { Clip, ModelMeta } from "@/lib/types";
import { DiffKey, OpSummary, SideBySide } from "./Transcript";
import { Waveform } from "./Waveform";
import styles from "./ClipDetail.module.css";

interface Props {
  clipId: string;
  models: ModelMeta[];
  modelId: string;
  onModelChange: (id: string) => void;
  autoPlay?: boolean;
  onEnded?: () => void;
  /** rendered at the end of the header row (the panel puts its close button here) */
  trailing?: React.ReactNode;
}

/** Everything about one clip: waveform and playback, tags, and the reference
 *  next to the model's transcript with the differences marked. Used by the map's
 *  panel and by the worst-10 player. */
export function ClipDetail({ clipId, models, modelId, onModelChange, autoPlay, onEnded, trailing }: Props) {
  const loaded = useClip(clipId);

  if (!loaded || loaded.status === "loading") {
    return (
      <div className={styles.skeleton} aria-busy="true" aria-label="Loading clip">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (loaded.status === "error") {
    return (
      <p className={styles.error} role="alert">
        Could not load clip {clipId}.
      </p>
    );
  }
  return (
    <Loaded clip={loaded.data} models={models} modelId={modelId} onModelChange={onModelChange} autoPlay={autoPlay} onEnded={onEnded} trailing={trailing} />
  );
}

function Loaded({ clip, models, modelId, onModelChange, autoPlay, onEnded, trailing }: Omit<Props, "clipId"> & { clip: Clip }) {
  const result = clip.results[modelId];
  const model = models.find((m) => m.id === modelId);
  const tokens = useMemo(() => (result ? buildTokens(result.ops, clip.words, clip.duration) : []), [result, clip.words, clip.duration]);
  const marks = useMemo(
    () => tokens.filter((t) => (t.op === "sub" || t.op === "del") && t.timed).map((t) => ({ start: t.start, end: t.end })),
    [tokens],
  );
  const tags = describeTags(clip);

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div>
          <h3 className={`${styles.id} mono`} tabIndex={-1} data-clip-heading>
            {clip.id}
          </h3>
          <p className={styles.meta}>
            {fmtSeconds(clip.duration)}
            {clip.meeting ? ` · meeting ${clip.meeting}` : ""}
            {clip.mic ? ` · ${clip.mic}` : ""}
          </p>
        </div>
        <div className={styles.headEnd}>
          <div className={styles.score}>
            <span className={`${styles.pct} num`} style={{ color: werColor(result?.wer) }}>
              {result ? fmtPct(result.wer) : "–"}
            </span>
            <span className={styles.pctLabel}>WER</span>
          </div>
          {trailing}
        </div>
      </div>

      {models.length > 1 && (
        <div className={styles.models} role="radiogroup" aria-label="Model whose transcript is shown">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === modelId}
              className={styles.model}
              onClick={() => onModelChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <Waveform
        key={clip.audio}
        src={publicUrl(clip.audio)}
        duration={clip.duration}
        label={`clip ${clip.id}`}
        marks={marks}
        autoPlay={autoPlay}
        onEnded={onEnded}
      />

      {clip.conditions.length > 0 && (
        <ul className={styles.chips} aria-label="Conditions">
          {clip.conditions.map((c) => (
            <li key={c}>{conditionLabel(c)}</li>
          ))}
        </ul>
      )}

      {result ? (
        <>
          <SideBySide tokens={tokens} modelLabel={model?.label ?? modelId} />
          <OpSummary ops={result.ops} />
          <DiffKey />
        </>
      ) : (
        <p className={styles.error}>{model?.label ?? modelId} has no transcript for this clip.</p>
      )}

      {tags.length > 0 && (
        <dl className={styles.tags}>
          {tags.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Label/value pairs for whichever tags the clip carries. */
function describeTags(clip: Clip): [string, string][] {
  const t = clip.tags;
  const out: [string, string][] = [];
  if (t.noise !== undefined || t.snr_db !== undefined)
    out.push(["Noise", [t.noise, t.snr_db !== undefined ? `${t.snr_db.toFixed(1)} dB SNR` : undefined].filter(Boolean).join(" · ")]);
  if (t.overlap !== undefined || t.overlap_ratio !== undefined)
    out.push([
      "Overlap",
      t.overlap === false ? "none" : t.overlap_ratio !== undefined ? `${Math.round(t.overlap_ratio * 100)}% of the clip` : "yes",
    ]);
  if (t.speed !== undefined || t.wpm !== undefined)
    out.push(["Speed", [t.speed, t.wpm !== undefined ? `${Math.round(t.wpm)} wpm` : undefined].filter(Boolean).join(" · ")]);
  if (t.accent !== undefined)
    out.push(["Accent", [t.accent, t.native_languages?.length ? t.native_languages.join(", ") : undefined].filter(Boolean).join(" · ")]);
  if (t.n_speakers !== undefined) out.push(["Speakers", String(t.n_speakers)]);
  return out;
}

