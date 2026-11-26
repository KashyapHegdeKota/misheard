// The build-time site data (generated/site.json, written by scripts/prepare-data.mjs
// from public/data/clips.json, or from the sample fixture when that file is absent).
import raw from "@/generated/site.json";
import type { ClipBrief, ModelMeta, SiteData } from "./types";

export const site = raw as unknown as SiteData;

export const models: ModelMeta[] = site.meta.models;

export function modelLabel(id: string): string {
  return models.find((m) => m.id === id)?.label ?? id;
}

/** The model the headline, hero and karaoke use: meta.primary_model. */
export const primaryModel = site.meta.primary_model;

export function brief(id: string): ClipBrief | undefined {
  return site.briefs[id];
}
