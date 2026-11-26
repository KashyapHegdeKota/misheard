// Generates a clearly fake fixture in the same shape as the real data contract,
// so the site can be developed before the pipeline's clips.json exists.
//
//   public/data/clips.sample.json   1,000 fake clips + summary
//   public/audio-sample/*.wav       a few short synthetic tone "speech" files
//                                   (shared between clips; one file per timing template)
//
// Everything here is placeholder: made-up words, made-up models, made-up numbers.
// The site only uses this fixture when public/data/clips.json is absent, and then
// shows a "sample data" banner. Nothing here touches public/audio/ or clips.json.
//
// Usage: node scripts/make-sample-data.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const AUDIO_DIR = path.join(ROOT, "public", "audio-sample");

const N_CLIPS = 1000;
const SAMPLE_RATE = 8000;

// ---------- small utilities -------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260101);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (a, b) => a + rng() * (b - a);
const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const VOCAB = [
  "sample", "placeholder", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
  "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar",
  "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
  "xray", "yankee", "zulu", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "fake", "demo", "test", "data", "word",
];
const LANGS = ["Dutch", "German", "Hindi", "Mandarin", "Spanish", "Portuguese"];

// ---------- audio pool ------------------------------------------------------
// Each pool entry is one timing template: a list of word windows and a WAV file
// whose tone bursts fall exactly inside those windows. Clips reuse the template
// with their own placeholder words, so karaoke timing can be checked by ear.

// Mix of short and long clips so transcript layouts get exercised.
const POOL_SPECS = [
  { wpm: 105, dur: 5.0, overlap: false },
  { wpm: 128, dur: 5.5, overlap: false },
  { wpm: 150, dur: 5.0, overlap: false },
  { wpm: 168, dur: 8.5, overlap: false },
  { wpm: 182, dur: 9.0, overlap: false },
  { wpm: 205, dur: 3.6, overlap: false },
  { wpm: 238, dur: 3.2, overlap: false },
  { wpm: 130, dur: 5.6, overlap: true },
  { wpm: 150, dur: 6.4, overlap: true },
  { wpm: 180, dur: 5.2, overlap: true },
];

function buildTemplate(spec) {
  const period = 60 / spec.wpm;
  const nWords = Math.max(6, Math.round((spec.dur * spec.wpm) / 60));
  const words = [];
  let t = 0.28;
  let speaker = "A";
  let turnLeft = 0;
  for (let i = 0; i < nWords; i++) {
    const len = clamp(period * between(0.5, 0.78), 0.16, 0.55);
    let start = t;
    if (spec.overlap) {
      if (turnLeft <= 0) {
        speaker = speaker === "A" ? "B" : "A";
        turnLeft = 2 + Math.floor(rng() * 3);
        // a new turn starts before the previous word has finished: real overlap
        if (i > 0) start = Math.max(0.05, words[i - 1].end - between(0.1, 0.22));
      }
      turnLeft--;
    }
    start = Math.max(start, words.length ? words[words.length - 1].start : 0);
    const end = start + len;
    words.push({ start: round(start, 3), end: round(end, 3), speaker, pitch: rng() });
    t = Math.max(t, end) + period * between(0.18, 0.4);
  }
  const duration = round(words[words.length - 1].end + 0.35, 2);
  return { words, duration };
}

function synthesize(template) {
  const n = Math.ceil(template.duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (const w of template.words) {
    const f0 = w.speaker === "A" ? 135 + w.pitch * 55 : 205 + w.pitch * 65;
    const i0 = Math.floor(w.start * SAMPLE_RATE);
    const i1 = Math.min(n, Math.floor(w.end * SAMPLE_RATE));
    const len = w.end - w.start;
    let phase = 0;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SAMPLE_RATE;
      const env =
        Math.min(1, t / 0.03) * Math.min(1, (len - t) / 0.05) * (0.72 + 0.28 * Math.sin((Math.PI * t) / len));
      const f = f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 4.5 * t) + 0.12 * (t / len - 0.5));
      phase += (2 * Math.PI * f) / SAMPLE_RATE;
      let s = 0;
      for (let h = 1; h <= 5; h++) s += Math.sin(h * phase) / h;
      out[i] += env * (0.17 * s + 0.05 * (rng() * 2 - 1));
    }
  }
  return out;
}

function wavBuffer(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = clamp(Math.tanh(samples[i] * 1.4), -1, 1);
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  return buf;
}

// ---------- alignment ops ---------------------------------------------------

function pickDifferent(word) {
  let h = pick(VOCAB);
  while (h === word) h = pick(VOCAB);
  return h;
}

/** Randomly corrupt a reference into a hypothesis, returning a full alignment. */
function makeResult(refWords, p, delShare, extraInsertions = 0) {
  const ops = [];
  const hyp = [];
  let errors = 0;
  const maybeInsert = (prob) => {
    if (rng() < prob) {
      const h = pick(VOCAB);
      ops.push({ op: "ins", ref: null, hyp: h });
      hyp.push(h);
      errors++;
    }
  };
  maybeInsert(p * 0.1);
  for (const w of refWords) {
    if (rng() < p) {
      if (rng() < delShare) {
        ops.push({ op: "del", ref: w, hyp: null });
      } else {
        const h = pickDifferent(w);
        ops.push({ op: "sub", ref: w, hyp: h });
        hyp.push(h);
      }
      errors++;
    } else {
      ops.push({ op: "equal", ref: w, hyp: w });
      hyp.push(w);
    }
    maybeInsert(p * 0.3);
  }
  // a hallucination loop: lots of extra words appended at the end
  for (let i = 0; i < extraInsertions; i++) {
    const h = VOCAB[(i * 7) % VOCAB.length];
    ops.push({ op: "ins", ref: null, hyp: h });
    hyp.push(h);
    errors++;
  }
  return { hyp: hyp.join(" "), wer: round(errors / refWords.length, 4), ops, errors };
}

// ---------- generation ------------------------------------------------------

const MODELS = [
  { id: "sample-large", label: "Sample large (fake)", detail: "Placeholder model: synthetic errors, nothing was transcribed.", base: 0.055 },
  { id: "sample-small", label: "Sample small (fake)", detail: "Placeholder model: synthetic errors, nothing was transcribed.", base: 0.09 },
  { id: "sample-alt", label: "Sample alt (fake)", detail: "Placeholder model: synthetic errors, nothing was transcribed.", base: 0.07 },
];

function difficulty(tags, mic) {
  let f = 1;
  f += 11 * tags.overlap_ratio;
  f += tags.noise === "mid" ? 0.7 : tags.noise === "high" ? 1.9 : 0;
  f += tags.accent === "non-native" ? 0.7 : 0;
  f += tags.speed === "fast" ? 0.6 : tags.speed === "slow" ? -0.1 : 0;
  f += mic === "far-field" ? 0.5 : 0;
  return f;
}

const NOISE_OFFSET = { low: [0, 0], mid: [0.17, -0.28], high: [0.34, -0.56] };

function generateClips(templates) {
  const meetings = Array.from({ length: 14 }, (_, i) => ({
    id: `SAMPLE-M${String(i + 1).padStart(2, "0")}`,
    dx: gauss() * 0.1,
    dy: gauss() * 0.1,
  }));
  const normalPools = templates.map((t, i) => i).filter((i) => !POOL_SPECS[i].overlap);
  const overlapPools = templates.map((t, i) => i).filter((i) => POOL_SPECS[i].overlap);
  const clips = [];
  const internal = []; // per-clip error counts for aggregation

  for (let i = 0; i < N_CLIPS; i++) {
    const overlap = rng() < 0.27;
    const poolIdx = overlap ? pick(overlapPools) : pick(normalPools);
    const template = templates[poolIdx];
    const meeting = meetings[i % meetings.length];
    const noiseRoll = rng();
    const noise = noiseRoll < 0.55 ? "low" : noiseRoll < 0.85 ? "mid" : "high";
    const snr = noise === "low" ? between(18, 32) : noise === "mid" ? between(8, 18) : between(0, 8);
    const nonNative = rng() < 0.3;
    const mic = rng() < 0.3 ? "far-field" : "headset-mix";
    const wpm = Math.round((template.words.length / template.duration) * 60);
    const speed = wpm < 130 ? "slow" : wpm < 190 ? "normal" : "fast";
    const overlapRatio = overlap ? round(between(0.08, 0.62), 2) : 0;
    const tags = {
      snr_db: round(snr, 1),
      noise,
      overlap_ratio: overlapRatio,
      overlap,
      wpm,
      speed,
      n_speakers: overlap ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2),
      accent: nonNative ? "non-native" : "native",
      native_languages: nonNative ? [pick(LANGS)] : ["English"],
    };
    const conditions = [];
    if (noise !== "low") conditions.push("noisy");
    if (overlap) conditions.push("overlapping");
    if (nonNative) conditions.push("accented");
    if (conditions.length === 0) conditions.push("clean");

    // 2D position: clusters by overlap / noise / accent, so errors form regions
    const [nx, ny] = NOISE_OFFSET[noise];
    const x = (overlap ? 0.6 : -0.45) + nx + (nonNative ? -0.18 : 0.1) + meeting.dx + gauss() * 0.15;
    const y = (overlap ? 0.35 : -0.05) + ny + (nonNative ? 0.32 : -0.08) + meeting.dy + gauss() * 0.15;

    const refWords = Array.from({ length: template.words.length }, () => pick(VOCAB));
    const f = difficulty(tags, mic) * Math.exp(gauss() * 0.4);
    const results = {};
    const errorCounts = {};
    MODELS.forEach((m, mi) => {
      const p = clamp(m.base * f * Math.exp(gauss() * 0.15), 0, 0.92);
      const forceHallucination = (i === 17 || i === 211 || i === 733) && mi === 0;
      const forceEmpty = i === 5 && mi === 1;
      let r;
      if (forceEmpty) {
        r = makeResult(refWords, 1, 1);
      } else {
        r = makeResult(refWords, p, overlap ? 0.52 : 0.34, forceHallucination ? refWords.length + 3 : 0);
      }
      results[m.id] = { hyp: r.hyp, wer: r.wer, ops: r.ops };
      errorCounts[m.id] = r.errors;
    });

    const id = `sample_${String(i).padStart(4, "0")}`;
    clips.push({
      id,
      x: round(x, 4),
      y: round(y, 4),
      audio: `audio-sample/s${poolIdx}.wav`,
      duration: template.duration,
      meeting: meeting.id,
      mic,
      tags,
      conditions,
      ref: refWords.join(" "),
      words: template.words.map((w, wi) => ({
        w: refWords[wi],
        start: w.start,
        end: w.end,
        speaker: w.speaker,
      })),
      results,
    });
    internal.push({ n: refWords.length, errors: errorCounts });
  }

  // normalize positions to [-1, 1] keeping aspect ratio
  const maxAbs = Math.max(...clips.flatMap((c) => [Math.abs(c.x), Math.abs(c.y)]));
  for (const c of clips) {
    c.x = round(c.x / maxAbs, 4);
    c.y = round(c.y / maxAbs, 4);
  }
  return { clips, internal };
}

function pooled(clips, internal, modelId, predicate) {
  let errors = 0;
  let words = 0;
  let n = 0;
  clips.forEach((c, i) => {
    if (!predicate(c)) return;
    errors += internal[i].errors[modelId];
    words += internal[i].n;
    n++;
  });
  return n === 0 ? {} : { wer: round(errors / words, 4), n };
}

const pct = (x) => `${Math.round(x * 100)}%`;

function buildSummary(clips, internal) {
  const byCondition = {};
  for (const m of MODELS) {
    const row = {};
    for (const cond of ["clean", "noisy", "overlapping", "accented"]) {
      row[cond] = pooled(clips, internal, m.id, (c) => c.conditions.includes(cond));
    }
    row.all = pooled(clips, internal, m.id, () => true);
    byCondition[m.id] = row;
  }
  const primary = MODELS[0].id;
  const headline = {
    model: primary,
    from_condition: "clean",
    to_condition: "overlapping",
    from_wer: byCondition[primary].clean.wer,
    to_wer: byCondition[primary].overlapping.wer,
  };

  const series = (bins) =>
    MODELS.map((m) => ({
      model: m.id,
      points: bins.map((b) => ({ label: b.label, ...pooled(clips, internal, m.id, b.test) })),
    }));

  const overlapBins = [
    { label: "0%", test: (c) => c.tags.overlap_ratio === 0 },
    { label: "1–25%", test: (c) => c.tags.overlap_ratio > 0 && c.tags.overlap_ratio <= 0.25 },
    { label: "26–50%", test: (c) => c.tags.overlap_ratio > 0.25 && c.tags.overlap_ratio <= 0.5 },
    { label: ">50%", test: (c) => c.tags.overlap_ratio > 0.5 },
  ];
  const noiseBins = ["low", "mid", "high"].map((k) => ({ label: k, test: (c) => c.tags.noise === k }));
  const accentBins = ["native", "non-native"].map((k) => ({ label: k, test: (c) => c.tags.accent === k }));

  const meanFirstLast = (s) => [s.points[0].wer, s.points[s.points.length - 1].wer];
  const overlapSeries = series(overlapBins);
  const noiseSeries = series(noiseBins);
  const accentSeries = series(accentBins);
  const [o0, o1] = meanFirstLast(overlapSeries[0]);
  const [n0, n1] = meanFirstLast(noiseSeries[0]);
  const [a0, a1] = meanFirstLast(accentSeries[0]);

  const refLen = (c) => c.words.length;
  const worstIn = (pred) =>
    clips
      .filter((c) => pred(c) && refLen(c) >= 6 && refLen(c) <= 14)
      .sort((a, b) => b.results[primary].wer - a.results[primary].wer)[0];

  const findings = [
    {
      key: "overlap",
      title: "[sample] Overlapping speech",
      stat: `[sample data] ${MODELS[0].label} goes from ${pct(o0)} with no overlap to ${pct(o1)} when more than half the clip overlaps.`,
      chart: { x_label: "Share of clip with overlapping speech", y_label: "WER", series: overlapSeries },
      example_clip: worstIn((c) => c.tags.overlap_ratio > 0.4).id,
    },
    {
      key: "noise",
      title: "[sample] Background noise",
      stat: `[sample data] Error rate rises from ${pct(n0)} on low-noise clips to ${pct(n1)} on high-noise clips.`,
      chart: { x_label: "Noise level", y_label: "WER", series: noiseSeries },
      example_clip: worstIn((c) => c.tags.noise === "high" && !c.tags.overlap).id,
    },
    {
      key: "accent",
      title: "[sample] Non-native accents",
      stat: `[sample data] Non-native speakers see ${pct(a1)} error against ${pct(a0)} for native speakers.`,
      chart: { x_label: "Speaker accent", y_label: "WER", series: accentSeries },
      example_clip: worstIn((c) => c.tags.accent === "non-native" && !c.tags.overlap && c.tags.noise === "low").id,
    },
  ];

  const worst10 = clips
    .filter((c) => refLen(c) >= 6)
    .sort((a, b) => b.results[primary].wer - a.results[primary].wer)
    .slice(0, 10)
    .map((c) => c.id);

  // karaoke clip: a long-ish overlapping clip with all three error kinds
  const hasAll = (c) => {
    const kinds = new Set(c.results[primary].ops.map((o) => o.op));
    return kinds.has("sub") && kinds.has("del") && kinds.has("ins");
  };
  const karaoke =
    clips
      .filter((c) => c.tags.overlap && refLen(c) >= 11 && refLen(c) <= 16 && hasAll(c))
      .filter((c) => c.results[primary].wer >= 0.3 && c.results[primary].wer <= 0.6)[0] ??
    clips.filter((c) => refLen(c) >= 8 && hasAll(c))[0];

  return {
    by_condition: byCondition,
    headline,
    findings,
    worst10,
    karaoke_clip: karaoke.id,
  };
}

export function generateSample() {
  const templates = POOL_SPECS.map(buildTemplate);
  const { clips, internal } = generateClips(templates);
  const summary = buildSummary(clips, internal);
  const data = {
    meta: {
      dataset:
        "SAMPLE DATA: synthetic placeholder clips made by scripts/make-sample-data.mjs. Not a real dataset; no license applies.",
      models: MODELS.map(({ id, label, detail }) => ({ id, label, detail })),
      primary_model: MODELS[0].id,
      metric:
        "SAMPLE: WER = (substitutions + deletions + insertions) / reference words, per clip; condition cells pool errors over all reference words in that condition. Numbers are synthetic.",
      n_clips: clips.length,
      generated_at: new Date().toISOString(),
    },
    clips,
    summary,
  };

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AUDIO_DIR, { recursive: true });
  templates.forEach((t, i) => writeFileSync(path.join(AUDIO_DIR, `s${i}.wav`), wavBuffer(synthesize(t))));
  writeFileSync(path.join(DATA_DIR, "clips.sample.json"), JSON.stringify(data));
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = generateSample();
  console.log(
    `sample data: ${data.clips.length} clips, ${data.meta.models.length} models -> public/data/clips.sample.json, ${POOL_SPECS.length} wav files -> public/audio-sample/`,
  );
}
