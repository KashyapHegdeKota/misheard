// Build-time data step (runs before `next dev` and `next build`).
//
// Reads the pipeline's public/data/clips.json (or, only when that file is absent,
// the generated fixture public/data/clips.sample.json), checks it against the data
// contract, and derives what the site needs:
//
//   generated/site.json           meta + summary + the few clips the page renders
//                                 server-side (karaoke clip, finding example clips)
//   public/data/points.json       light file: position, tags and per-model WER of every
//                                 clip. Fetched by the hero and the map after first paint.
//   public/data/clip/<id>.json    one full clip each (words, alignments), fetched on demand
//                                 when a dot is clicked or the worst-10 player steps.
//
// It runs from clips.json alone, on every `npm run dev` and `npm run build`, so dropping
// the pipeline's real files in and rebuilding is all it takes. Whichever source it uses,
// it wipes the previous derived output first, so nothing from the fixture can survive
// into a build made from real data.
//
// Never writes to clips.json or public/audio/. When real data is present it removes the
// fixture (public/data/clips.sample.json, public/audio-sample/) so the deployed site
// cannot carry placeholder files.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSample } from "./make-sample-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const REAL = path.join(PUBLIC, "data", "clips.json");
const SAMPLE = path.join(PUBLIC, "data", "clips.sample.json");
const OUT_SITE = path.join(ROOT, "generated", "site.json");
const OUT_POINTS = path.join(PUBLIC, "data", "points.json");
const OUT_CLIPS = path.join(PUBLIC, "data", "clip");
const SAMPLE_AUDIO = path.join(PUBLIC, "audio-sample");

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

// ---------- choose source ---------------------------------------------------

let isSample = false;
let sourcePath = REAL;
if (existsSync(REAL)) {
  // real data wins outright: no trace of the fixture may ship with it
  rmSync(SAMPLE, { force: true });
  rmSync(SAMPLE_AUDIO, { recursive: true, force: true });
} else {
  isSample = true;
  sourcePath = SAMPLE;
  if (!existsSync(SAMPLE)) {
    console.log("[data] no clips.json and no sample fixture: generating the sample fixture");
    generateSample();
  }
}

let data;
try {
  data = JSON.parse(readFileSync(sourcePath, "utf8"));
} catch (e) {
  console.error(`[data] cannot read ${path.relative(ROOT, sourcePath)}: ${e.message}`);
  process.exit(1);
}

// ---------- validate against the contract -----------------------------------

const { meta, clips, summary } = data ?? {};
if (!isObj(meta)) fail("meta is missing");
if (!Array.isArray(clips) || clips.length === 0) fail("clips must be a non-empty array");
if (!isObj(summary)) fail("summary is missing");

const modelIds = [];
if (isObj(meta)) {
  if (!Array.isArray(meta.models) || meta.models.length === 0) fail("meta.models must be a non-empty array");
  else
    for (const m of meta.models) {
      if (!isObj(m) || !isStr(m.id) || !isStr(m.label)) fail(`meta.models entry needs id and label: ${JSON.stringify(m)}`);
      else modelIds.push(m.id);
    }
  if (!modelIds.includes(meta.primary_model)) fail(`meta.primary_model "${meta.primary_model}" is not in meta.models`);
  for (const k of ["dataset", "metric"]) if (!isStr(meta[k])) fail(`meta.${k} must be a non-empty string`);
}

const ids = new Set();
const byId = new Map();
const badOps = [];
const badWer = [];
let missingResults = 0;
let missingAudio = 0;
let withoutWords = 0;
const wordMismatch = [];

if (Array.isArray(clips)) {
  for (const c of clips) {
    if (!isObj(c) || !isStr(c.id)) {
      fail(`clip without id: ${JSON.stringify(c)?.slice(0, 80)}`);
      continue;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(c.id)) fail(`clip id "${c.id}" has characters that are unsafe in a file name`);
    if (ids.has(c.id)) fail(`duplicate clip id ${c.id}`);
    ids.add(c.id);
    byId.set(c.id, c);
    if (!isNum(c.x) || !isNum(c.y)) fail(`clip ${c.id}: x and y must be numbers`);
    if (!isStr(c.audio)) fail(`clip ${c.id}: audio must be a path`);
    else if (!existsSync(path.join(PUBLIC, c.audio))) missingAudio++;
    if (!isNum(c.duration)) fail(`clip ${c.id}: duration must be a number`);
    if (!isObj(c.tags)) fail(`clip ${c.id}: tags missing`);
    if (!Array.isArray(c.conditions)) fail(`clip ${c.id}: conditions must be an array`);
    if (!Array.isArray(c.words) || c.words.length === 0) withoutWords++;
    if (!isObj(c.results)) {
      fail(`clip ${c.id}: results missing`);
      continue;
    }
    for (const m of modelIds) {
      const r = c.results[m];
      if (!r) {
        missingResults++;
        continue;
      }
      if (!Array.isArray(r.ops) || !isNum(r.wer)) {
        fail(`clip ${c.id}: results.${m} needs wer and ops`);
        continue;
      }
      const refOps = r.ops.filter((o) => o.op !== "ins").length;
      if (Array.isArray(c.words) && c.words.length > 0 && refOps !== c.words.length) badOps.push(c.id);
      else if (Array.isArray(c.words) && c.words.length > 0) {
        const refSide = r.ops.filter((o) => o.op !== "ins");
        if (refSide.some((o, i) => o.ref !== c.words[i].w)) wordMismatch.push(`${c.id}/${m}`);
      }
      const errs = r.ops.filter((o) => o.op !== "equal").length;
      if (refOps > 0 && Math.abs(errs / refOps - r.wer) > 0.002) badWer.push(`${c.id}/${m}`);
    }
  }
  if (isObj(meta) && isNum(meta.n_clips) && meta.n_clips !== clips.length)
    warn(`meta.n_clips is ${meta.n_clips} but clips has ${clips.length} entries (the site shows ${clips.length})`);
}

const uniq = (arr) => [...new Set(arr)];
const sample = (arr) => `${uniq(arr).slice(0, 5).join(", ")}${uniq(arr).length > 5 ? ", ..." : ""}`;
if (missingResults) warn(`${missingResults} clip/model pairs have no result (their dots render grey)`);
if (missingAudio) warn(`${missingAudio} of ${clips?.length} clips point at an audio file that is not in public/ yet`);
if (withoutWords) warn(`${withoutWords} clips have no words[] (karaoke timing and word-level views need it)`);
if (badOps.length) warn(`${uniq(badOps).length} clips where the number of ref-bearing ops differs from words.length (word timing will misalign): ${sample(badOps)}`);
if (wordMismatch.length) warn(`${wordMismatch.length} clip results (${uniq(wordMismatch.map((x) => x.split("/")[0])).length} clips) where ops[].ref does not match words[].w in order (karaoke would show the wrong word at the wrong time): ${sample(wordMismatch)}`);
if (badWer.length) warn(`${badWer.length} clip results whose wer differs from (S+D+I)/N of their ops: ${sample(badWer)}`);

if (isObj(summary)) {
  const bc = summary.by_condition;
  if (!isObj(bc)) fail("summary.by_condition is missing");
  else for (const m of modelIds) if (!isObj(bc[m])) warn(`summary.by_condition has no row for model ${m}`);
  const h = summary.headline;
  if (!isObj(h) || !modelIds.includes(h.model) || !isStr(h.to_condition) || !isStr(h.from_condition) || !isNum(h.from_wer) || !isNum(h.to_wer))
    fail("summary.headline needs model, from_condition, to_condition, from_wer, to_wer");
  if (!Array.isArray(summary.findings) || summary.findings.length === 0) fail("summary.findings must be a non-empty array");
  else {
    if (summary.findings.length !== 3) warn(`summary.findings has ${summary.findings.length} entries (the layout expects exactly 3)`);
    for (const f of summary.findings) {
      if (!isObj(f) || !isStr(f.key) || !isStr(f.title) || !isStr(f.stat) || !isObj(f.chart) || !Array.isArray(f.chart.series))
        fail(`finding needs key, title, stat, chart.series: ${JSON.stringify(f)?.slice(0, 80)}`);
      else if (!byId.has(f.example_clip)) fail(`finding ${f.key}: example_clip "${f.example_clip}" is not a clip id`);
      else {
        for (const s of f.chart.series) {
          if (!modelIds.includes(s.model)) warn(`finding ${f.key}: chart series for unknown model "${s.model}"`);
          if (!Array.isArray(s.points) || s.points.some((p) => !isStr(p.label) || !isNum(p.wer)))
            warn(`finding ${f.key}: chart series "${s.model}" has points without a label and a numeric wer (they are skipped)`);
        }
      }
    }
  }
  if (!Array.isArray(summary.worst10) || summary.worst10.length === 0) fail("summary.worst10 must be a non-empty array of clip ids");
  else for (const id of summary.worst10) if (!byId.has(id)) fail(`summary.worst10 contains unknown clip id ${id}`);
  if (!byId.has(summary.karaoke_clip)) fail(`summary.karaoke_clip "${summary.karaoke_clip}" is not a clip id`);
  else if (!byId.get(summary.karaoke_clip).results?.[meta?.primary_model])
    warn(`the karaoke clip has no result for the primary model ${meta?.primary_model}; the page will use another model`);

  // The hero sentence and the face-off table must agree: both are shown on the same page.
  if (isObj(h) && isObj(bc)) {
    for (const [which, cond, wer] of [["from", h.from_condition, h.from_wer], ["to", h.to_condition, h.to_wer]]) {
      const cell = bc[h.model]?.[cond]?.wer;
      if (isNum(cell) && Math.abs(cell - wer) > 0.0005)
        warn(`summary.headline.${which}_wer (${wer}) differs from summary.by_condition.${h.model}.${cond}.wer (${cell}): the hero and the table would show different numbers`);
    }
  }
}

for (const w of warnings) console.warn(`[data] warning: ${w}`);
if (errors.length) {
  console.error(`[data] ${path.relative(ROOT, sourcePath)} does not match the data contract:`);
  for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
  if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more`);
  process.exit(1);
}

// ---------- derive ----------------------------------------------------------

const round4 = (x) => (isNum(x) ? Math.round(x * 10000) / 10000 : null);
const refWordCount = (c) => {
  const n = String(c.ref ?? "").trim().split(/\s+/).filter(Boolean).length;
  return n || (Array.isArray(c.words) ? c.words.length : 0);
};

const points = clips.map((c) => ({
  id: c.id,
  x: c.x,
  y: c.y,
  nw: refWordCount(c),
  wer: Object.fromEntries(modelIds.map((m) => [m, round4(c.results[m]?.wer)])),
  err: Object.fromEntries(modelIds.map((m) => [m, c.results[m] ? c.results[m].ops.filter((o) => o.op !== "equal").length : null])),
  noise: c.tags.noise ?? null,
  overlap: typeof c.tags.overlap === "boolean" ? c.tags.overlap : null,
  accent: c.tags.accent ?? null,
  speed: c.tags.speed ?? null,
  conditions: c.conditions,
}));

const brief = (c) => ({
  id: c.id,
  audio: c.audio,
  duration: c.duration,
  conditions: c.conditions,
  wer: Object.fromEntries(modelIds.map((m) => [m, round4(c.results[m]?.wer)])),
});

// clips the statically rendered page needs: the karaoke clip and each finding's example
// get their full record (transcripts are rendered into the HTML); the worst 10 only need
// a brief for the list, their transcripts load when the player steps to them.
const exampleIds = [...new Set(summary.findings.map((f) => f.example_clip))];
const briefIds = new Set([summary.karaoke_clip, ...exampleIds, ...summary.worst10]);
const site = {
  isSample,
  nClips: clips.length,
  meta,
  summary,
  briefs: Object.fromEntries([...briefIds].map((id) => [id, brief(byId.get(id))])),
  karaoke: byId.get(summary.karaoke_clip),
  examples: Object.fromEntries(exampleIds.map((id) => [id, byId.get(id)])),
};

mkdirSync(path.dirname(OUT_SITE), { recursive: true });
writeFileSync(OUT_SITE, JSON.stringify(site));
writeFileSync(OUT_POINTS, JSON.stringify({ models: modelIds, points }));
rmSync(OUT_CLIPS, { recursive: true, force: true });
mkdirSync(OUT_CLIPS, { recursive: true });
for (const c of clips) writeFileSync(path.join(OUT_CLIPS, `${c.id}.json`), JSON.stringify(c));

console.log(
  `[data] ${isSample ? "SAMPLE fixture" : "clips.json"}: ${clips.length} clips, ${modelIds.length} models` +
    ` -> generated/site.json, public/data/points.json, ${clips.length} files in public/data/clip/` +
    `${warnings.length ? ` (${warnings.length} warnings)` : ""}`,
);
