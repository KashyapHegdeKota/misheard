"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildTokens, describeToken, type Token } from "@/lib/diff";
import { usePlayerTime, useClipPlayer } from "@/lib/audio";
import { fmtClock } from "@/lib/format";
import { publicUrl } from "@/lib/url";
import type { Clip } from "@/lib/types";
import { PauseIcon, PlayIcon } from "./icons";
import styles from "./Karaoke.module.css";

// The transcript of one clip, laid out as the model's output with corrections:
//   substitution  the model's word, red and crossed out, with the right word in green above
//   deletion      a dashed red gap, with the missed word in green above
//   insertion     the extra word, red and crossed out, tagged "extra" above
// Words light up in time with the audio, timed from words[]. Words not yet
// spoken are shown dimmed (so the problem is visible before anyone presses play).

type TokState = "ghost" | "active" | "done";

export function Karaoke({ clip, modelId, modelLabel }: { clip: Clip; modelId: string; modelLabel: string }) {
  const result = clip.results[modelId];
  const tokens = useMemo<Token[]>(() => {
    if (result) return buildTokens(result.ops, clip.words, clip.duration);
    // no result for this model: show the reference words unmarked
    return buildTokens(
      clip.words.map((w) => ({ op: "equal" as const, ref: w.w, hyp: w.w })),
      clip.words,
      clip.duration,
    );
  }, [result, clip.words, clip.duration]);

  const showSpeakers = useMemo(() => new Set(tokens.map((t) => t.speaker).filter(Boolean)).size > 1, [tokens]);

  const { player, state } = useClipPlayer(publicUrl(clip.audio), clip.duration);
  const t = usePlayerTime(player);
  const duration = state.duration || clip.duration;

  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const started = useRef(false);

  const sync = useCallback(() => {
    const now = player.getTime();
    const over = now >= duration - 0.03;
    for (let k = 0; k < tokens.length; k++) {
      const el = els.current[k];
      if (!el) continue;
      const tk = tokens[k];
      let next: TokState = "ghost";
      if (started.current) next = over || now >= tk.end ? "done" : now >= tk.start ? "active" : "ghost";
      if (el.dataset.state !== next) el.dataset.state = next;
    }
  }, [player, tokens, duration]);

  useEffect(() => {
    if (!state.playing) {
      sync();
      return;
    }
    started.current = true;
    let raf = 0;
    const loop = () => {
      sync();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state.playing, sync]);

  const onScrub = (value: number) => {
    started.current = true;
    player.seek(value);
    sync();
  };

  const examples = useMemo(
    () => ({
      sub: tokens.find((x) => x.op === "sub"),
      del: tokens.find((x) => x.op === "del"),
      ins: tokens.find((x) => x.op === "ins"),
    }),
    [tokens],
  );

  const errorTicks = useMemo(
    () => tokens.filter((x) => (x.op === "sub" || x.op === "del") && x.timed).map((x) => ({ i: x.i, at: x.start / duration })),
    [tokens, duration],
  );
  const progress = duration > 0 ? Math.min(1, t / duration) : 0;
  const unavailable = state.status === "error";

  return (
    <div className={styles.root}>
      <div className={styles.stage} role="group" aria-label={`Transcript of the clip as ${modelLabel} heard it, with errors marked`}>
        <div className={styles.words}>
          {tokens.map((tk, k) => {
            const word = (
              <span
                key={tk.i}
                ref={(el) => {
                  els.current[tk.i] = el;
                }}
                className={`${styles.tok} ${styles[tk.op]}`}
                data-state="ghost"
                data-op={tk.op}
                data-start={tk.start.toFixed(3)}
                data-end={tk.end.toFixed(3)}
              >
                <Cell tk={tk} />
              </span>
            );
            // a speaker's chip travels with their first word so it can never wrap alone
            const turnStart = showSpeakers && (k === 0 || tokens[k - 1].speaker !== tk.speaker);
            return turnStart ? (
              <span className={styles.lead} key={tk.i}>
                <span className={styles.speaker} role="img" aria-label={`Speaker ${tk.speaker ?? "?"}`}>
                  {tk.speaker ?? "?"}
                </span>
                {word}
              </span>
            ) : (
              word
            );
          })}
        </div>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.play}
          data-fresh={!state.playing && t === 0}
          onClick={() => player.toggle()}
          aria-label={state.playing ? "Pause the clip" : "Play the clip"}
          disabled={unavailable}
        >
          {state.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <div className={styles.scrub}>
          <div className={styles.track}>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.01}
              value={Math.min(t, duration)}
              onChange={(e) => onScrub(Number(e.target.value))}
              aria-label="Position in the clip"
              aria-valuetext={`${fmtClock(t)} of ${fmtClock(duration)}`}
              style={{ ["--p" as string]: `${progress * 100}%` }}
            />
            <span className={styles.ticks} aria-hidden="true">
              {errorTicks.map((k) => (
                <i key={k.i} style={{ left: `${Math.min(100, k.at * 100)}%` }} />
              ))}
            </span>
          </div>
          <span className={`${styles.clock} num`} aria-hidden="true">
            {fmtClock(t)} / {fmtClock(duration)}
          </span>
        </div>
        <p className={styles.hint}>
          {unavailable ? "Audio for this clip is not available." : state.playing ? "Playing" : "Press play to hear it"}
        </p>
      </div>

      <ul className={styles.key} aria-label="Key to the marks">
        {examples.sub && (
          <li>
            <span className={`${styles.tok} ${styles.sub} ${styles.mini}`} data-state="done">
              <Cell tk={examples.sub} />
            </span>
            <span>Misheard: the model wrote the red word, the speaker said the green one</span>
          </li>
        )}
        {examples.del && (
          <li>
            <span className={`${styles.tok} ${styles.del} ${styles.mini}`} data-state="done">
              <Cell tk={examples.del} />
            </span>
            <span>Missed: the model left the word out</span>
          </li>
        )}
        {examples.ins && (
          <li>
            <span className={`${styles.tok} ${styles.ins} ${styles.mini}`} data-state="done">
              <Cell tk={examples.ins} />
            </span>
            <span>Added: the model wrote a word nobody said</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function Cell({ tk }: { tk: Token }) {
  if (tk.op === "equal") return <span className={styles.word}>{tk.ref}</span>;
  const gapWidth = `${Math.min(7, Math.max(1.8, (tk.ref ?? "").length * 0.52))}em`;
  return (
    <>
      <span className={styles.fix} aria-hidden="true">
        {tk.op === "ins" ? "extra" : tk.ref}
      </span>
      <span className={styles.word} aria-hidden="true">
        {tk.op === "del" ? <span className={styles.gap} style={{ width: gapWidth }} /> : tk.hyp}
      </span>
      <span className="sr-only">{describeToken(tk)}</span>
    </>
  );
}
