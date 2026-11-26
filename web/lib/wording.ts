// Words for things the data names with short keys. Only wording lives here:
// no numbers, and unknown keys fall back to the key itself.

const CONDITION_LABELS: Record<string, string> = {
  clean: "Clean",
  noisy: "Noisy",
  overlapping: "Overlapping",
  accented: "Accented",
};

/** Column order for the face-off table; unknown conditions go after these. */
export const CONDITION_ORDER = ["clean", "noisy", "overlapping", "accented"];

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const conditionLabel = (key: string) => CONDITION_LABELS[key] ?? capitalize(key.replace(/[_-]+/g, " "));

/** "when two people talk at once": how the hero sentence names the harder condition. */
export function conditionPhrase(key: string): string {
  switch (key) {
    case "overlapping":
      return "when two people talk at once";
    case "noisy":
      return "when the room gets noisy";
    case "accented":
      return "with non-native accents";
    case "clean":
      return "on clean audio";
    default:
      return `on ${key.replace(/[_-]+/g, " ")} audio`;
  }
}

/** "Whisper large-v3" -> "Whisper": the family name, for running prose.
 *  Cuts the label before the first token that looks like a size or version. */
export function modelFamily(label: string): string {
  const tokens = label.trim().split(/\s+/);
  const stop = tokens.findIndex(
    (t, i) => i > 0 && (/^(tiny|base|small|medium|large|xl|xxl|turbo|distil[-\w]*|lite|mini|nano)\b/i.test(t) || /^[v(]?\d/i.test(t)),
  );
  const head = (stop === -1 ? tokens : tokens.slice(0, stop)).join(" ");
  return head || label;
}

/** Display order for known tag values; anything else sorts after, alphabetically. */
const TAG_ORDER: Record<string, string[]> = {
  noise: ["low", "mid", "high"],
  speed: ["slow", "normal", "fast"],
  accent: ["native", "non-native"],
  overlap: ["no", "yes"],
};

export function sortTagValues(group: string, values: string[]): string[] {
  const order = TAG_ORDER[group] ?? [];
  const rank = (v: string) => {
    const i = order.indexOf(v);
    return i === -1 ? order.length : i;
  };
  return [...values].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const FILTER_GROUPS = [
  { key: "noise", label: "Noise" },
  { key: "overlap", label: "Overlap" },
  { key: "accent", label: "Accent" },
  { key: "speed", label: "Speed" },
] as const;

export type FilterGroupKey = (typeof FILTER_GROUPS)[number]["key"];

export const tagValueLabel = (group: string, value: string) => {
  if (group === "overlap") return value === "yes" ? "Overlapping speech" : "No overlap";
  return capitalize(value);
};
