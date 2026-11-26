"use client";

import { useEffect, useState } from "react";
import type { Clip, PointsFile } from "./types";

// Heavy data is fetched after first paint, on the client, and cached for the
// session: the light points file once, and one small JSON per clip on demand.
// All of these files are derived from public/data/clips.json by the build step.

const cache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    // a failed request must not be cached, or "retry" could never succeed
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export const loadPoints = () => getJson<PointsFile>("/data/points.json");
export const loadClip = (id: string) => getJson<Clip>(`/data/clip/${encodeURIComponent(id)}.json`);

/** Warm the cache for a clip without caring about the result. */
export const prefetchClip = (id: string) => {
  loadClip(id).catch(() => {});
};

export type Loaded<T> = { status: "loading" } | { status: "error"; error: Error } | { status: "ready"; data: T };

export function usePoints(): Loaded<PointsFile> {
  const [state, setState] = useState<Loaded<PointsFile>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadPoints()
      .then((data) => live && setState({ status: "ready", data }))
      .catch((error: Error) => live && setState({ status: "error", error }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function useClip(id: string | null): Loaded<Clip> | null {
  const [state, setState] = useState<{ id: string | null; value: Loaded<Clip> }>({ id: null, value: { status: "loading" } });
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadClip(id)
      .then((data) => live && setState({ id, value: { status: "ready", data } }))
      .catch((error: Error) => live && setState({ id, value: { status: "error", error } }));
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return null;
  // while a new clip loads, report loading rather than the previous clip
  return state.id === id ? state.value : { status: "loading" };
}
