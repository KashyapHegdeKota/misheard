"use client";

import { useEffect, useRef } from "react";
import { usePoints } from "@/lib/data";
import { NO_RESULT_RGB, WER_SCALE_MAX, werRGB } from "@/lib/color";
import styles from "./HeroField.module.css";

// The hero background: every clip as a softly glowing dot at its real map
// position, colored by the primary model's WER, drifting very slowly.
// It is a plain 2D canvas on purpose: no heavy chunk has to load before it can
// paint, and the headline above it is server-rendered and never waits for it.

const BUCKETS = 32;
const FPS = 18; // the drift is a few pixels per second; more frames add nothing but battery drain

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSprite(rgb: readonly [number, number, number], size = 96): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const col = `${rgb[0]},${rgb[1]},${rgb[2]}`;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${col},1)`);
  grad.addColorStop(0.09, `rgba(${col},0.92)`);
  grad.addColorStop(0.26, `rgba(${col},0.34)`);
  grad.addColorStop(0.58, `rgba(${col},0.08)`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function HeroField({ model }: { model: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = usePoints();

  useEffect(() => {
    if (points.status !== "ready") return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const pts = points.data.points;
    const n = pts.length;
    if (n === 0) return;

    // positions normalised to 0..1 over the data's own bounding box
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const rand = mulberry32(20260101);
    const U = new Float32Array(n);
    const V = new Float32Array(n);
    const bucket = new Uint8Array(n);
    const ampX = new Float32Array(n);
    const ampY = new Float32Array(n);
    const wX = new Float32Array(n); // angular speeds (rad/s): periods of 45-120 s
    const wY = new Float32Array(n);
    const phX = new Float32Array(n);
    const phY = new Float32Array(n);
    const phA = new Float32Array(n);
    const alpha = new Float32Array(n);
    const grow = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      U[i] = (p.x - minX) / spanX;
      V[i] = 1 - (p.y - minY) / spanY;
      const w = p.wer[model];
      bucket[i] = w == null ? BUCKETS : Math.round(Math.min(1, Math.max(0, w / WER_SCALE_MAX)) * (BUCKETS - 1));
      ampX[i] = 0.6 + rand() * 1.0;
      ampY[i] = 0.6 + rand() * 1.0;
      wX[i] = (2 * Math.PI) / (45 + rand() * 75);
      wY[i] = (2 * Math.PI) / (45 + rand() * 75);
      phX[i] = rand() * 6.283;
      phY[i] = rand() * 6.283;
      phA[i] = rand() * 6.283;
      alpha[i] = 0.5 + rand() * 0.4;
      grow[i] = 0.75 + rand() * 0.55;
    }

    const sprites: HTMLCanvasElement[] = [];
    for (let k = 0; k < BUCKETS; k++) sprites.push(makeSprite(werRGB((k / (BUCKETS - 1)) * WER_SCALE_MAX)));
    sprites.push(makeSprite(NO_RESULT_RGB));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let W = 0;
    let H = 0;
    let baseR = 12;
    let raf = 0;
    let last = 0;
    let visible = true;
    let running = false;
    const t0 = performance.now();

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseR = Math.max(7, Math.min(17, Math.sqrt((W * H) / n) * 0.46));
      draw(reduced.matches ? 0 : (performance.now() - t0) / 1000);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const mx = W * 0.03;
      const my = H * 0.05;
      const iw = W - mx * 2;
      const ih = H - my * 2;
      const drift = baseR * 1.1;
      for (let i = 0; i < n; i++) {
        const x = mx + U[i] * iw + Math.sin(t * wX[i] + phX[i]) * ampX[i] * drift;
        const y = my + V[i] * ih + Math.cos(t * wY[i] + phY[i]) * ampY[i] * drift;
        const r = baseR * grow[i];
        ctx.globalAlpha = alpha[i] * (0.88 + 0.12 * Math.sin(t * 0.35 + phA[i]));
        ctx.drawImage(sprites[bucket[i]], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw((now - t0) / 1000);
    };
    const start = () => {
      if (running || reduced.matches || !visible || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    wrap.dataset.ready = "true";
    start();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(wrap);
    const onVis = () => (document.hidden ? stop() : start());
    const onMotion = () => {
      if (reduced.matches) {
        stop();
        draw(0);
      } else start();
    };
    document.addEventListener("visibilitychange", onVis);
    reduced.addEventListener("change", onMotion);
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", onMotion);
    };
  }, [points, model]);

  return (
    <div ref={wrapRef} className={styles.wrap} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
