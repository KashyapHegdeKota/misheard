"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";

// Audio is fetched on demand: nothing here touches the network until the first
// play() (or seek()), and only one clip plays at a time across the whole page.

export type AudioStatus = "idle" | "loading" | "ready" | "error";

export interface PlayerSnapshot {
  playing: boolean;
  status: AudioStatus;
  /** media duration once known, else the duration the caller supplied */
  duration: number;
}

let current: { id: string; pause: () => void } | null = null;

/** Pause whatever else is playing, and register this player as the one that is. */
export function claimPlayback(id: string, pause: () => void) {
  if (current && current.id !== id) current.pause();
  current = { id, pause };
}
export function releasePlayback(id: string) {
  if (current?.id === id) current = null;
}

/** Stop any clip that is playing anywhere on the page (used when a dialog closes). */
export function pauseAllAudio() {
  current?.pause();
  current = null;
}

export class ClipPlayer {
  readonly id: string;
  private el: HTMLAudioElement | null = null;
  private src: string | null = null;
  private subs = new Set<() => void>();
  private snap: PlayerSnapshot = { playing: false, status: "idle", duration: 0 };
  private fallbackDuration = 0;
  private wantPlay = false;
  private onEnded?: () => void;
  private timeSubs = new Set<() => void>();
  private timeSnap = 0;
  private raf = 0;
  private lastTick = 0;

  constructor(id: string) {
    this.id = id;
  }

  subscribe = (cb: () => void) => {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  };

  getSnapshot = () => this.snap;

  setOnEnded(fn: (() => void) | undefined) {
    this.onEnded = fn;
  }

  /** Subscribe to the position of the playhead (see getTimeSnapshot). */
  subscribeTime = (cb: () => void) => {
    this.timeSubs.add(cb);
    return () => {
      this.timeSubs.delete(cb);
    };
  };

  /** The playhead in seconds, refreshed about 24 times a second while playing and
   *  immediately on seek, pause and end. For progress bars and clocks. */
  getTimeSnapshot = () => this.timeSnap;

  private publishTime() {
    const t = this.el?.currentTime ?? 0;
    if (t === this.timeSnap) return;
    this.timeSnap = t;
    this.timeSubs.forEach((cb) => cb());
  }

  private startTicking() {
    if (this.raf || typeof requestAnimationFrame === "undefined") return;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (now - this.lastTick < 1000 / 24) return;
      this.lastTick = now;
      this.publishTime();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopTicking() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private set(patch: Partial<PlayerSnapshot>) {
    const next = { ...this.snap, ...patch };
    if (next.playing === this.snap.playing && next.status === this.snap.status && next.duration === this.snap.duration) return;
    this.snap = next;
    this.subs.forEach((cb) => cb());
  }

  /** Point at a new file. Nothing is downloaded until play() or seek(). */
  setSource(src: string | null, duration = 0) {
    if (src === this.src && this.el) {
      this.fallbackDuration = duration;
      return;
    }
    this.teardown();
    this.src = src;
    this.fallbackDuration = duration;
    this.snap = { playing: false, status: "idle", duration };
    this.subs.forEach((cb) => cb());
  }

  private ensure(): HTMLAudioElement | null {
    if (this.el) return this.el;
    if (!this.src || typeof Audio === "undefined") return null;
    const a = new Audio();
    a.preload = "auto";
    a.src = this.src;
    a.addEventListener("loadstart", () => this.set({ status: "loading" }));
    a.addEventListener("loadedmetadata", () => {
      this.set({ duration: Number.isFinite(a.duration) && a.duration > 0 ? a.duration : this.fallbackDuration });
    });
    a.addEventListener("canplay", () => this.set({ status: "ready" }));
    a.addEventListener("waiting", () => this.set({ status: "loading" }));
    a.addEventListener("playing", () => this.set({ status: "ready" }));
    a.addEventListener("play", () => {
      claimPlayback(this.id, () => this.pause());
      this.set({ playing: true });
      this.startTicking();
    });
    a.addEventListener("pause", () => {
      this.set({ playing: false });
      this.stopTicking();
      this.publishTime();
    });
    a.addEventListener("seeked", () => this.publishTime());
    a.addEventListener("ended", () => {
      this.set({ playing: false });
      this.stopTicking();
      this.publishTime();
      releasePlayback(this.id);
      this.onEnded?.();
    });
    a.addEventListener("error", () => {
      this.wantPlay = false;
      this.set({ status: "error", playing: false });
    });
    this.el = a;
    return a;
  }

  async play() {
    const a = this.ensure();
    if (!a) return;
    this.wantPlay = true;
    if (a.ended) a.currentTime = 0;
    claimPlayback(this.id, () => this.pause());
    try {
      await a.play();
    } catch (e) {
      // AbortError: paused before it could start. NotAllowedError: no user gesture.
      if ((e as DOMException)?.name === "NotAllowedError") this.set({ playing: false });
    }
  }

  pause() {
    this.wantPlay = false;
    this.el?.pause();
  }

  toggle() {
    if (this.snap.playing) this.pause();
    else void this.play();
  }

  /** Current position in seconds; cheap enough to call every animation frame. */
  getTime() {
    return this.el?.currentTime ?? 0;
  }

  seek(t: number) {
    const a = this.ensure();
    if (!a) return;
    const max = this.snap.duration || this.fallbackDuration || Infinity;
    a.currentTime = Math.max(0, Math.min(t, max));
    this.publishTime();
  }

  /** Back to the start, paused. */
  rewind() {
    this.pause();
    if (this.el) this.el.currentTime = 0;
    this.publishTime();
  }

  private teardown() {
    this.wantPlay = false;
    this.stopTicking();
    this.timeSnap = 0;
    this.timeSubs.forEach((cb) => cb());
    if (this.el) {
      const a = this.el;
      a.pause();
      a.removeAttribute("src");
      a.load();
      this.el = null;
    }
    releasePlayback(this.id);
  }

  dispose() {
    this.teardown();
    this.src = null;
  }
}

export interface UseClipPlayer {
  player: ClipPlayer;
  state: PlayerSnapshot;
}

/** A lazily-loading player for one clip. Pass src = null for "nothing yet". */
export function useClipPlayer(src: string | null, duration = 0, onEnded?: () => void): UseClipPlayer {
  const uid = useId();
  const [player] = useState(() => new ClipPlayer(uid));
  useEffect(() => {
    player.setOnEnded(onEnded);
  }, [player, onEnded]);
  useEffect(() => {
    player.setSource(src, duration);
  }, [player, src, duration]);
  useEffect(() => () => player.dispose(), [player]);
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  return { player, state };
}

/** The player's position in seconds, as React state. For progress bars and clocks;
 *  the karaoke view reads player.getTime() directly on animation frames instead. */
export function usePlayerTime(player: ClipPlayer): number {
  return useSyncExternalStore(player.subscribeTime, player.getTimeSnapshot, () => 0);
}
