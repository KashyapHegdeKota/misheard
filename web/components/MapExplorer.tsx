"use client";

import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePoints } from "@/lib/data";
import { mapStore, useMapState } from "@/lib/mapStore";
import { useMediaQuery } from "@/lib/useMedia";
import { FILTER_GROUPS, sortTagValues, type FilterGroupKey } from "@/lib/wording";
import type { Point } from "@/lib/types";
import { ClipPanel } from "./ClipPanel";
import { MapFilters, type FilterOptions } from "./MapFilters";
import { useModelLabel, useSite } from "./SiteContext";
import { WerLegend } from "./WerLegend";
import styles from "./MapExplorer.module.css";

// deck.gl is a large chunk: it is only fetched once the map is about to scroll into view.
const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false });

const PANEL_INSET = 456; // panel width + gutters, when it floats over the map

function tagValue(p: Point, group: FilterGroupKey): string | null {
  if (group === "overlap") return p.overlap === null ? null : p.overlap ? "yes" : "no";
  return p[group];
}

export function MapExplorer() {
  const { models, primaryModel } = useSite();
  const labelOf = useModelLabel();
  const state = useMapState();
  const loaded = usePoints();
  const desktop = useMediaQuery("(min-width: 900px)");
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const modelId = state.model && models.some((m) => m.id === state.model) ? state.model : primaryModel;
  const points = loaded.status === "ready" ? loaded.data.points : null;

  // start fetching the map code shortly before it scrolls into view
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setNear(true));
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "1400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // filters start collapsed on narrow screens, until the person opens or closes them
  const isNarrow = useMediaQuery("(max-width: 899px)");
  const expanded = userExpanded ?? !isNarrow;

  const options = useMemo<FilterOptions[]>(() => {
    if (!points) return [];
    return FILTER_GROUPS.map((g) => {
      const counts = new Map<string, number>();
      for (const p of points) {
        const v = tagValue(p, g.key);
        if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return { key: g.key, label: g.label, values: sortTagValues(g.key, [...counts.keys()]).map((value) => ({ value, count: counts.get(value) ?? 0 })) };
    });
  }, [points]);

  const mask = useMemo(() => {
    const m = new Uint8Array(points?.length ?? 0);
    if (!points) return m;
    for (let i = 0; i < points.length; i++) {
      let ok = true;
      for (const g of FILTER_GROUPS) {
        const want = state.filters[g.key];
        if (want.length === 0) continue;
        const v = tagValue(points[i], g.key);
        if (v === null || !want.includes(v)) {
          ok = false;
          break;
        }
      }
      m[i] = ok ? 1 : 0;
    }
    return m;
  }, [points, state.filters]);

  const summary = useMemo(() => {
    let n = 0;
    let words = 0;
    let errs = 0;
    if (points)
      for (let i = 0; i < points.length; i++) {
        if (!mask[i]) continue;
        n++;
        const e = points[i].err[modelId];
        if (e != null) {
          errs += e;
          words += points[i].nw;
        }
      }
    return { n, wer: words > 0 ? errs / words : null };
  }, [points, mask, modelId]);

  const activeCount = FILTER_GROUPS.reduce((n, g) => n + state.filters[g.key].length, 0);
  const selectedId = state.selectedId;
  const showOverlay = desktop && !!selectedId;

  // on narrow screens the panel opens below the map: bring it into view
  useEffect(() => {
    if (!selectedId || desktop) return;
    const t = window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [selectedId, desktop]);

  const close = () => {
    mapStore.set({ selectedId: null });
    stageRef.current?.querySelector<HTMLElement>("[data-testid=map-stage]")?.focus({ preventScroll: true });
  };

  const panel = selectedId ? (
    <ClipPanel
      key="panel"
      ref={panelRef}
      clipId={selectedId}
      models={models}
      modelId={modelId}
      onModelChange={(id) => mapStore.set({ model: id })}
      onClose={close}
      layout={desktop ? "overlay" : "inline"}
    />
  ) : null;

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="container">
        {points && (
          <MapFilters
            options={options}
            filters={state.filters}
            onToggle={(g, v) => mapStore.toggleFilter(g, v)}
            onReset={() => mapStore.reset()}
            models={models}
            modelId={modelId}
            onModel={(id) => mapStore.set({ model: id })}
            matching={summary.n}
            total={points.length}
            wer={summary.wer}
            expanded={expanded}
            onExpandedChange={setUserExpanded}
            activeCount={activeCount}
          />
        )}
      </div>

      <div ref={stageRef} className={styles.stage} data-state={loaded.status}>
        {points && near && mask.length === points.length && (
          <MapCanvas
            points={points}
            modelId={modelId}
            modelLabel={labelOf(modelId)}
            mask={mask}
            selectedId={selectedId}
            onSelect={(id) => mapStore.set({ selectedId: id })}
            insetRight={showOverlay ? PANEL_INSET : 0}
            panelInset={desktop ? PANEL_INSET : 0}
          />
        )}
        {loaded.status === "loading" && <p className={styles.status}>Loading the map…</p>}
        {loaded.status === "error" && <p className={styles.status}>Could not load the map data.</p>}
        {points && summary.n === 0 && (
          <div className={styles.empty}>
            <p>No clips match these filters.</p>
            <button type="button" className="btn" onClick={() => mapStore.reset()}>
              Clear filters
            </button>
          </div>
        )}
        <WerLegend className={styles.legend} />
        <AnimatePresence>{showOverlay && panel}</AnimatePresence>
      </div>

      {!desktop && (
        <div className="container">
          <AnimatePresence>{selectedId && panel}</AnimatePresence>
        </div>
      )}
    </div>
  );
}
