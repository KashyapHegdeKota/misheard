// ============================================================================
//  Copy for "What data would fix this", written against the pipeline run of
//  2026-11-25 (1,000 AMI clips, 5 models).
//
//  It contains no numbers: the figures shown next to each item come from
//  summary.findings[].stat in clips.json. The qualitative claims below (errors on
//  overlap are mostly dropped words; one model family is far less hurt by distance;
//  the accent gap only shows within one recording site) describe that run. If the
//  pipeline is rerun and the findings change, reread this file against
//  summary.findings and the pipeline report before shipping.
//
//  The section renders one item per entry of summary.findings, in the data's order,
//  and looks each up here by key. A finding with no entry here still renders (title
//  and evidence from the data) and the build logs a warning naming the missing key.
// ============================================================================

import type { Filters } from "@/lib/mapStore";

export const COPY_STATUS: "draft" | "final" = "final";

export interface Recommendation {
  /** the kind of audio to collect: a short noun phrase, shown as the item's heading */
  kind: string;
  /** why: one or two sentences. No numbers: the evidence line comes from the data. */
  why: string;
  /** what to record, 3 short specifications */
  collect: string[];
  /** optional: the map filters that show these clips, for the "see them on the map" link */
  mapFilters?: Partial<Filters>;
}

export const sectionCopy = {
  eyebrow: "05 — What data would fix this",
  title: "What data would fix this",
  lead: "Three kinds of audio to collect next, in order of how much error they explain here. The numbers under each one come straight from the results.",
};

export const recommendations: Record<string, Recommendation> = {
  overlap: {
    kind: "Overlapping speech, transcribed per speaker",
    why: "This is the largest effect in the study, and every model tested shows it. The errors are mostly dropped words rather than wrong ones: when two people talk at once, the model keeps one voice and silently loses the other, backchannels and interruptions first. A model only learns to keep both if its training transcripts do.",
    collect: [
      "Unscripted multi-party conversation with a separate, word-timed transcript for every speaker",
      "Backchannels and interruptions transcribed, not cleaned out",
      "A graded spread of overlap, from brief backchannels to sustained crosstalk, with the overlap share logged per clip",
    ],
    mapFilters: { overlap: ["yes"] },
  },
  noise: {
    kind: "The same conversation, close and far",
    why: "Error rises sharply on quiet, distant, low signal-to-noise audio, but not equally for every model: one model family here loses far less than the rest, which points to training data rather than a hard limit. In this corpus noise and microphone distance arrive together and cannot be separated, which is itself the gap to fill.",
    collect: [
      "Each conversation recorded on a close microphone and a far one at the same time, so distance can be isolated",
      "Real rooms and everyday devices: table speakerphones, laptop and phone microphones",
      "Noise level measured and logged for every clip, with noisy close-talk and quiet far-field both represented",
    ],
    mapFilters: { noise: ["high"] },
  },
  accent: {
    kind: "Non-native speakers, balanced within one recording setup",
    why: "Non-native speakers are transcribed less accurately, but the gap only shows when speakers are compared within a single recording site. Pooled across sites it is hidden, because the sites differ more than the speakers do. It is also the least certain of the three findings: it rests on few native speakers.",
    collect: [
      "Native and non-native speakers recorded in the same rooms on the same equipment",
      "Each speaker's first language on record, with consent, and many distinct speakers per language",
      "Spontaneous conversation rather than read text",
    ],
    mapFilters: { accent: ["non-native"] },
  },
};
