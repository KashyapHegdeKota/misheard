"use client";

import DeckGL from "@deck.gl/react";
import { LinearInterpolator, OrthographicView, type OrthographicViewState } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { werColor, werRGB } from "@/lib/color";
import { fmtPct } from "@/lib/format";
import { useReducedMotion } from "@/lib/useMedia";
import { conditionLabel } from "@/lib/wording";
import type { Point } from "@/lib/types";
import { MinusIcon, PlusIcon, ResetIcon } from "./icons";
import styles from "./MapCanvas.module.css";

// The map: every clip as a dot at its UMAP position, colored by the chosen
// model's WER, drawn with deck.gl (WebGL). Filters dim the dots that don't match.
// Drag to pan, Ctrl/Cmd + scroll or pinch to zoom, click a dot to open it, and
// the arrow keys move between dots for people who aren't using a pointer.

const VIEW = new OrthographicView({ id: "map", flipY: false });

/** A scatterplot layer whose circles fade smoothly to nothing at the edge: the dots' glow. */
class GlowLayer extends ScatterplotLayer<Point> {
  static layerName = "GlowLayer";
  getShaders() {
    const shaders = super.getShaders();
    shaders.inject = {
      ...shaders.inject,
      "fs:#main-end": "fragColor.a *= pow(1.0 - clamp(length(unitPosition), 0.0, 1.0), 1.7);",
    };
    return shaders;
  }
}
const PAD = 36;
const DIM: [number, number, number, number] = [150, 150, 160, 30];

interface Props {
  points: Point[];
  modelId: string;
  modelLabel: string;
  mask: Uint8Array;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** pixels at the right edge currently covered by the clip panel */
  insetRight: number;
  /** pixels the panel covers whenever it is open (0 when it opens below the map) */
  panelInset: number;
}

type ViewState = OrthographicViewState & { transitionDuration?: number; transitionInterpolator?: LinearInterpolator };

let webglCache: boolean | undefined;
/** Creating a context is the only way to learn whether WebGL2 is available; do it once. */
function getWebgl(): boolean {
  if (webglCache === undefined) {
    try {
      webglCache = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webglCache = false;
    }
  }
  return webglCache;
}
const noSubscription = () => () => {};
const INTERP = new LinearInterpolator(["target", "zoom"]);

function neighbor(points: Point[], mask: Uint8Array, from: number, dir: [number, number]): number {
  const p = points[from];
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (i === from || !mask[i]) continue;
    const dx = points[i].x - p.x;
    const dy = points[i].y - p.y;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1e-9) continue;
    const perp = Math.abs(dx * dir[1] - dy * dir[0]);
    const score = Math.hypot(dx, dy) + perp * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export default function MapCanvas({ points, modelId, modelLabel, mask, selectedId, onSelect, insetRight, panelInset }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [viewState, setViewState] = useState<ViewState | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [moved, setMoved] = useState(false);
  const [fitKey, setFitKey] = useState<string | null>(null);
  const webgl = useSyncExternalStore(noSubscription, getWebgl, () => null);

  const bounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY, spanX: maxX - minX || 1, spanY: maxY - minY || 1 };
  }, [points]);

  // fit the whole cloud into the area that is not covered by the panel
  const fit = useCallback(
    (w: number, h: number, inset: number): ViewState => {
      const availW = Math.max(120, w - inset - PAD * 2);
      const availH = Math.max(120, h - PAD * 2);
      const scale = Math.min(availW / bounds.spanX, availH / bounds.spanY);
      const zoom = Math.log2(scale);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      return { target: [cx + inset / 2 / scale, cy, 0], zoom, minZoom: zoom - 1, maxZoom: zoom + 6 };
    },
    [bounds],
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the cloud into the free area on first layout and whenever the size or the covered
  // area changes, until the user has moved the map themselves. (Derived while rendering:
  // React re-renders at once with the new view, no effect needed.)
  const wantKey = size.w > 0 && size.h > 0 ? `${size.w}x${size.h}:${insetRight}` : null;
  if (wantKey && wantKey !== fitKey && !(moved && viewState)) {
    setFitKey(wantKey);
    const next = fit(size.w, size.h, insetRight);
    setViewState(viewState && !reduced ? { ...next, transitionDuration: 700, transitionInterpolator: INTERP } : next);
  }

  const scaleNow = viewState ? 2 ** (viewState.zoom as number) : 1;
  const toScreen = useCallback(
    (p: Point) => {
      if (!viewState) return { x: 0, y: 0 };
      const t = viewState.target as number[];
      return { x: size.w / 2 + (p.x - t[0]) * scaleNow, y: size.h / 2 - (p.y - t[1]) * scaleNow };
    },
    [viewState, size, scaleNow],
  );

  // bring a point into the free area if it is off-screen or under the panel
  const reveal = useCallback(
    (p: Point, inset = insetRight) => {
      if (!viewState || !size.w) return;
      const s = toScreen(p);
      const margin = 48;
      const inside = s.x > margin && s.x < size.w - inset - margin && s.y > margin && s.y < size.h - margin;
      if (inside) return;
      const freeCx = (size.w - inset) / 2;
      setViewState({
        target: [p.x - (freeCx - size.w / 2) / scaleNow, p.y, 0],
        zoom: viewState.zoom,
        minZoom: viewState.minZoom,
        maxZoom: viewState.maxZoom,
        transitionDuration: reduced ? 0 : 600,
        transitionInterpolator: INTERP,
      });
    },
    [viewState, size, insetRight, scaleNow, toScreen, reduced],
  );

  const selectedIdx = useMemo(() => (selectedId ? points.findIndex((p) => p.id === selectedId) : -1), [points, selectedId]);

  // opening a clip: if the user has panned or zoomed, make sure the dot is not under the panel
  const open = (index: number) => {
    setFocusIdx(index);
    if (moved) reveal(points[index], panelInset);
    onSelect(points[index].id);
  };

  const zoomTo = useCallback(
    (nextZoom: number, anchor?: { x: number; y: number }) => {
      if (!viewState) return;
      const z0 = viewState.zoom as number;
      const z = Math.min(viewState.maxZoom ?? 20, Math.max(viewState.minZoom ?? -20, nextZoom));
      const t = viewState.target as number[];
      const a = anchor ?? { x: size.w / 2, y: size.h / 2 };
      const s0 = 2 ** z0;
      const s1 = 2 ** z;
      const wx = t[0] + (a.x - size.w / 2) / s0;
      const wy = t[1] - (a.y - size.h / 2) / s0;
      setMoved(true);
      // Built from scratch, not spread from the current state: deck.gl's own copy of the view
      // state also carries zoomX/zoomY, which override `zoom`, so spreading it would ignore this zoom.
      setViewState({
        target: [wx - (a.x - size.w / 2) / s1, wy + (a.y - size.h / 2) / s1, 0],
        zoom: z,
        minZoom: viewState.minZoom,
        maxZoom: viewState.maxZoom,
        transitionDuration: 0,
      });
    },
    [viewState, size],
  );

  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms the map.
  // A plain wheel is left alone so the page keeps scrolling past it.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !viewState) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo((viewState.zoom as number) - e.deltaY * 0.01, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewState, zoomTo]);

  const resetView = () => {
    setMoved(false);
    if (size.w) setViewState({ ...fit(size.w, size.h, insetRight), transitionDuration: reduced ? 0 : 600, transitionInterpolator: INTERP });
  };

  // ---- layers ---------------------------------------------------------------

  // a stable object: deck.gl restarts an interaction if the controller options change mid-drag
  const controller = useMemo(
    () => ({ scrollZoom: false, doubleClickZoom: true, touchZoom: true, touchRotate: false, dragPan: true, dragRotate: false, keyboard: false, inertia: reduced ? 0 : 250 }),
    [reduced],
  );

  const narrow = size.w > 0 && size.w < 640;
  const dotR = narrow ? 3.1 : 4.2;
  const glowR = narrow ? 12 : 19;

  const layers = useMemo(() => {
    const color = (d: Point, index: number, alphaOn: number, alphaOff: number): [number, number, number, number] => {
      if (!mask[index]) return [DIM[0], DIM[1], DIM[2], alphaOff];
      const c = werRGB(d.wer[modelId]);
      return [c[0], c[1], c[2], alphaOn];
    };
    const pos = (d: Point): [number, number] => [d.x, d.y];
    const glowBlend = {
      blend: true,
      blendColorSrcFactor: "src-alpha",
      blendColorDstFactor: "one",
      blendAlphaSrcFactor: "one",
      blendAlphaDstFactor: "one",
    } as const;
    const tr = reduced ? undefined : { getFillColor: 500 };
    return [
      new GlowLayer({
        id: "glow",
        data: points,
        getPosition: pos,
        getRadius: glowR,
        radiusUnits: "pixels",
        getFillColor: (d, { index }) => color(d, index, 120, 0),
        transitions: tr,
        updateTriggers: { getFillColor: [modelId, mask] },
        pickable: false,
        parameters: glowBlend,
      }),
      new ScatterplotLayer<Point>({
        id: "dots",
        data: points,
        getPosition: pos,
        getRadius: dotR,
        radiusUnits: "pixels",
        getFillColor: (d, { index }) => color(d, index, 238, 30),
        transitions: tr,
        updateTriggers: { getFillColor: [modelId, mask] },
        pickable: true,
      }),
      new ScatterplotLayer<Point>({
        id: "ring-hover",
        data: hover && mask[hover.index] ? [points[hover.index]] : [],
        getPosition: pos,
        getRadius: dotR + 4.5,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [255, 255, 255, 150],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        pickable: false,
      }),
      new ScatterplotLayer<Point>({
        id: "ring-focus",
        data: focusIdx !== null && mask[focusIdx] ? [points[focusIdx]] : [],
        getPosition: pos,
        getRadius: dotR + 7,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [255, 255, 255, 230],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        pickable: false,
      }),
      new ScatterplotLayer<Point>({
        id: "ring-selected",
        data: selectedIdx >= 0 ? [points[selectedIdx]] : [],
        getPosition: pos,
        getRadius: dotR + 5,
        radiusUnits: "pixels",
        stroked: true,
        filled: false,
        getLineColor: [255, 255, 255, 255],
        getLineWidth: 2.5,
        lineWidthUnits: "pixels",
        pickable: false,
      }),
    ];
  }, [points, modelId, mask, hover, focusIdx, selectedIdx, reduced, dotR, glowR]);

  // ---- keyboard -------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (dirs[e.key]) {
      e.preventDefault();
      const from = focusIdx;
      if (from === null || !mask[from]) {
        // start from the visible dot nearest the middle of the view
        const t = (viewState?.target as number[] | undefined) ?? [0, 0];
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < points.length; i++) {
          if (!mask[i]) continue;
          const d = Math.hypot(points[i].x - t[0], points[i].y - t[1]);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best >= 0) {
          setFocusIdx(best);
          reveal(points[best]);
        }
        return;
      }
      const next = neighbor(points, mask, from, dirs[e.key]);
      if (next >= 0) {
        setFocusIdx(next);
        reveal(points[next]);
      }
    } else if ((e.key === "Enter" || e.key === " ") && focusIdx !== null && mask[focusIdx]) {
      e.preventDefault();
      open(focusIdx);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      if (viewState) zoomTo((viewState.zoom as number) + 0.5);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      if (viewState) zoomTo((viewState.zoom as number) - 0.5);
    } else if (e.key === "0") {
      e.preventDefault();
      resetView();
    }
  };

  const describe = (i: number) => {
    const p = points[i];
    const conds = p.conditions.map(conditionLabel).join(", ");
    return `${p.id}. ${modelLabel} word error rate ${fmtPct(p.wer[modelId])}${conds ? `. ${conds}` : ""}. Press Enter to open.`;
  };

  const tipIdx = hover && mask[hover.index] ? hover.index : null;
  const tip = tipIdx !== null ? points[tipIdx] : null;
  const tipPos = tip && hover ? { x: Math.min(hover.x + 16, Math.max(0, size.w - 230)), y: Math.max(8, hover.y - 8) } : null;
  const focusTip = focusIdx !== null && mask[focusIdx] && !tip ? points[focusIdx] : null;
  const focusPos = focusTip ? toScreen(focusTip) : null;

  if (webgl === false || failed) {
    return (
      <div className={styles.fallback} role="note">
        <p>
          The interactive map needs WebGL, which this browser has turned off or does not support. The rest of the page still works: the
          worst-10 player at the top plays the clips the model got most wrong.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={wrap}
      className={styles.wrap}
      tabIndex={0}
      role="application"
      aria-roledescription="map"
      aria-label={`Map of ${points.length} clips colored by ${modelLabel} word error rate. Arrow keys move between clips, Enter opens one, plus and minus zoom.`}
      onKeyDown={onKeyDown}
      data-testid="map-stage"
      data-zoom={viewState ? (viewState.zoom as number).toFixed(4) : undefined}
      data-target={viewState ? (viewState.target as number[]).slice(0, 2).map((v) => v.toFixed(5)).join(",") : undefined}
    >
      {viewState && webgl && (
        <DeckGL
          views={VIEW}
          viewState={viewState}
          controller={controller}
          touchAction="pan-y"
          onViewStateChange={({ viewState: vs, interactionState }) => {
            const user = !!(interactionState?.isDragging || interactionState?.isPanning || interactionState?.isZooming);
            if (user) setMoved(true);
            setViewState(vs as ViewState);
          }}
          layers={layers}
          onClick={(info) => {
            if (info.index >= 0 && mask[info.index]) open(info.index);
          }}
          onHover={(info) => setHover(info.index >= 0 && mask[info.index] ? { index: info.index, x: info.x, y: info.y } : null)}
          getCursor={({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
          pickingRadius={9}
          onError={() => setFailed(true)}
          style={{ position: "absolute", inset: "0", background: "transparent" }}
        />
      )}

      {tip && tipPos && (
        <div className={styles.tip} style={{ transform: `translate(${tipPos.x}px, ${tipPos.y}px)` }} aria-hidden="true">
          <span className="mono">{tip.id}</span>
          <b className="num" style={{ color: werColor(tip.wer[modelId]) }}>
            {fmtPct(tip.wer[modelId])}
          </b>
          {tip.conditions.length > 0 && <small>{tip.conditions.map(conditionLabel).join(" · ")}</small>}
        </div>
      )}
      {focusTip && focusPos && (
        <div className={styles.tip} style={{ transform: `translate(${Math.min(focusPos.x + 16, size.w - 230)}px, ${Math.max(8, focusPos.y - 8)}px)` }} aria-hidden="true">
          <span className="mono">{focusTip.id}</span>
          <b className="num" style={{ color: werColor(focusTip.wer[modelId]) }}>
            {fmtPct(focusTip.wer[modelId])}
          </b>
        </div>
      )}

      <div className={styles.controls} role="group" aria-label="Map view">
        <button type="button" onClick={() => viewState && zoomTo((viewState.zoom as number) + 0.6)} aria-label="Zoom in">
          <PlusIcon />
        </button>
        <button type="button" onClick={() => viewState && zoomTo((viewState.zoom as number) - 0.6)} aria-label="Zoom out">
          <MinusIcon />
        </button>
        <button type="button" onClick={resetView} aria-label="Reset the view">
          <ResetIcon />
        </button>
      </div>

      <p className={styles.hint} aria-hidden="true">
        Drag to pan · Ctrl or ⌘ + scroll to zoom · arrow keys to move between dots
      </p>
      <p className="sr-only" aria-live="polite">
        {focusIdx !== null && mask[focusIdx] ? describe(focusIdx) : ""}
      </p>
    </div>
  );
}
