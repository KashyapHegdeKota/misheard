"use client";

import { werColor } from "@/lib/color";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Filters } from "@/lib/mapStore";
import type { ModelMeta } from "@/lib/types";
import { tagValueLabel, type FilterGroupKey } from "@/lib/wording";
import { ResetIcon } from "./icons";
import styles from "./MapFilters.module.css";

export interface FilterOptions {
  key: FilterGroupKey;
  label: string;
  values: { value: string; count: number }[];
}

interface Props {
  options: FilterOptions[];
  filters: Filters;
  onToggle: (group: FilterGroupKey, value: string) => void;
  onReset: () => void;
  models: ModelMeta[];
  modelId: string;
  onModel: (id: string) => void;
  matching: number;
  total: number;
  wer: number | null;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  activeCount: number;
}

/** Filters for the map: noise, overlap, accent, speed, and which model colors the dots. */
export function MapFilters({ options, filters, onToggle, onReset, models, modelId, onModel, matching, total, wer, expanded, onExpandedChange, activeCount }: Props) {
  return (
    <div className={styles.bar}>
      <div className={styles.top}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls="map-filter-groups"
          onClick={() => onExpandedChange(!expanded)}
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          <span aria-hidden="true">{expanded ? "–" : "+"}</span>
        </button>
        <p className={styles.count} aria-live="polite" data-testid="map-count">
          <span className="num">
            {fmtInt(matching)} of {fmtInt(total)}
          </span>{" "}
          clips
          {matching > 0 && (
            <>
              {" · "}
              <span title="Pooled over the matching clips: total errors divided by total reference words">WER </span>
              <b className="num" style={{ color: werColor(wer) }}>
                {fmtPct(wer)}
              </b>
            </>
          )}
        </p>
      </div>

      <div id="map-filter-groups" className={styles.groups} hidden={!expanded} role="group" aria-label="Map filters">
        {models.length > 1 && (
          <fieldset className={styles.group}>
            <legend>Color by model</legend>
            {models.length <= 4 ? (
              <div className={styles.chips} role="radiogroup" aria-label="Model whose error rate colors the dots">
                {models.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === modelId} className={styles.chip} onClick={() => onModel(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            ) : (
              <select className={styles.select} value={modelId} onChange={(e) => onModel(e.target.value)} aria-label="Model whose error rate colors the dots">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </fieldset>
        )}

        {options.map((g) =>
          g.values.length < 2 ? null : (
            <fieldset key={g.key} className={styles.group}>
              <legend>{g.label}</legend>
              <div className={styles.chips}>
                {g.values.map((v) => {
                  const on = filters[g.key].includes(v.value);
                  return (
                    <button key={v.value} type="button" aria-pressed={on} className={styles.chip} onClick={() => onToggle(g.key, v.value)}>
                      {tagValueLabel(g.key, v.value)}
                      <span className={`${styles.n} num`}>{fmtInt(v.count)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ),
        )}

        <button type="button" className={styles.reset} onClick={onReset} disabled={activeCount === 0}>
          <ResetIcon size={14} />
          Clear filters
        </button>
      </div>
    </div>
  );
}

