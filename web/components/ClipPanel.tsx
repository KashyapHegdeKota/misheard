"use client";

import { m } from "framer-motion";
import { forwardRef, useEffect } from "react";
import type { ModelMeta } from "@/lib/types";
import { ClipDetail } from "./ClipDetail";
import { CloseIcon } from "./icons";
import styles from "./ClipPanel.module.css";

interface Props {
  clipId: string;
  models: ModelMeta[];
  modelId: string;
  onModelChange: (id: string) => void;
  onClose: () => void;
  /** "overlay" floats over the right of the map; "inline" sits below it on narrow screens */
  layout: "overlay" | "inline";
}

/** The panel that opens when a dot is clicked: waveform, playback, transcripts. */
export const ClipPanel = forwardRef<HTMLDivElement, Props>(function ClipPanel({ clipId, models, modelId, onModelChange, onClose, layout }, ref) {
  useEffect(() => {
    // keyboard users land in the panel; it is a plain container, so no ring shows for mouse clicks
    if (ref && "current" in ref) ref.current?.focus({ preventScroll: true });
  }, [clipId, ref]);

  return (
    <m.div
      ref={ref}
      className={`${styles.panel} ${layout === "overlay" ? styles.overlay : styles.inline}`}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={`Clip ${clipId}`}
      initial={{ opacity: 0, x: layout === "overlay" ? 28 : 0, y: layout === "overlay" ? 0 : 16 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: layout === "overlay" ? 28 : 0, y: layout === "overlay" ? 0 : 16 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      data-testid="clip-panel"
    >
      <ClipDetail
        clipId={clipId}
        models={models}
        modelId={modelId}
        onModelChange={onModelChange}
        trailing={
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the clip panel">
            <CloseIcon size={16} />
          </button>
        }
      />
    </m.div>
  );
});
