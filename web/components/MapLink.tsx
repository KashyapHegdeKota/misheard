"use client";

import { mapStore, type Filters } from "@/lib/mapStore";
import { ChevronIcon } from "./icons";

/** Sets the map's filters and scrolls to it, so a recommendation can show its clips. */
export function MapLink({ filters, children }: { filters: Partial<Filters>; children: React.ReactNode }) {
  return (
    <a
      href="#map"
      className="btn"
      onClick={() => {
        mapStore.setFilters(filters);
        mapStore.set({ selectedId: null });
      }}
    >
      {children}
      <ChevronIcon size={14} dir="right" />
    </a>
  );
}
