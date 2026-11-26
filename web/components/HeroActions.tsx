"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ClipBrief, ModelMeta } from "@/lib/types";
import { PlayIcon } from "./icons";

// The player is a separate chunk (it pulls in the waveform library): it is only
// fetched when the button is first pressed.
const WorstPlayer = dynamic(() => import("./WorstPlayer").then((m) => m.WorstPlayer), { ssr: false });

interface Props {
  worst10: ClipBrief[];
  models: ModelMeta[];
  primaryModel: string;
  className?: string;
}

export function HeroActions({ worst10, models, primaryModel, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={className} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <a className="btn btn-primary" href="#map">
          Explore the map
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10m0 0 4-4m-4 4L4 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <button type="button" className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <PlayIcon size={14} />
          Hear the worst 10
        </button>
      </div>
      {open && <WorstPlayer clips={worst10} models={models} primaryModel={primaryModel} onClose={() => setOpen(false)} />}
    </>
  );
}
