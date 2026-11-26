"use client";

import { useSyncExternalStore } from "react";
import type { FilterGroupKey } from "./wording";

// Shared state for the map, kept outside React so that other sections (the
// recommendations) can set filters on the map and scroll to it.

export type Filters = Record<FilterGroupKey, string[]>;

export interface MapState {
  filters: Filters;
  /** model whose WER colors the dots; null until the map has the model list */
  model: string | null;
  selectedId: string | null;
}

export const EMPTY_FILTERS: Filters = { noise: [], overlap: [], accent: [], speed: [] };

let state: MapState = { filters: EMPTY_FILTERS, model: null, selectedId: null };
const subs = new Set<() => void>();

const emit = () => subs.forEach((cb) => cb());

export const mapStore = {
  get: () => state,
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
  set(patch: Partial<MapState>) {
    state = { ...state, ...patch };
    emit();
  },
  toggleFilter(group: FilterGroupKey, value: string) {
    const cur = state.filters[group];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    state = { ...state, filters: { ...state.filters, [group]: next } };
    emit();
  },
  setFilters(filters: Partial<Filters>) {
    state = { ...state, filters: { ...EMPTY_FILTERS, ...filters } };
    emit();
  },
  reset() {
    state = { ...state, filters: EMPTY_FILTERS };
    emit();
  },
};

export function useMapState(): MapState {
  return useSyncExternalStore(mapStore.subscribe, mapStore.get, mapStore.get);
}
