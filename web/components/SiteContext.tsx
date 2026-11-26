"use client";

import { createContext, useContext, useMemo } from "react";
import type { ModelMeta } from "@/lib/types";

// The few facts every client component needs. The server page passes them in so
// that client bundles never import the generated data file itself.

export interface SiteContextValue {
  models: ModelMeta[];
  primaryModel: string;
  nClips: number;
  isSample: boolean;
}

const Ctx = createContext<SiteContextValue | null>(null);

export function SiteProvider({ value, children }: { value: SiteContextValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSite(): SiteContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSite must be used inside <SiteProvider>");
  return v;
}

export function useModelLabel(): (id: string) => string {
  const { models } = useSite();
  return useMemo(() => {
    const m = new Map(models.map((x) => [x.id, x.label]));
    return (id: string) => m.get(id) ?? id;
  }, [models]);
}
