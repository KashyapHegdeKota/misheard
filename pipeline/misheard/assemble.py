"""Stage 5: score every model, compute the summary, write clips.json and the mp3s into web/public.

Everything in the output is computed from the per-clip data produced by the earlier stages; nothing is typed in.
"""
from __future__ import annotations

import datetime
import json
import shutil
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from rapidfuzz.distance import Levenshtein

from .ami import load_meetings
from .audio import read_wav
from .clips import HIGH_NOISE_BELOW_DB, LOW_NOISE_FROM_DB, OVERLAP_FROM
from .common import CLIP_WAV, STAGING, WEB_AUDIO, WEB_DATA, ensure
from .models import PRIMARY, Model, selected_models
from .scoring import align, best_order_errors, bootstrap_wer, count_errors, interval
from .text import normalize
from .transcribe import transcripts

MIN_BIN_CLIPS = 20            # chart bins with fewer clips are merged into a neighbour
PLAYBACK_RMS_DBFS = -23.0     # mp3 loudness (gain only); the models never see this gain
PLAYBACK_PEAK = 0.89          # -1 dBFS ceiling

CONDITIONS = ("clean", "noisy", "overlapping", "accented")

# AMI meeting ids start with the recording site and kind of meeting (ES1002a, IS1004c, IB4005, IN1001).
SITES = {"ES": "Edinburgh scenario meetings", "IS": "Idiap scenario meetings",
         "IB": "Idiap non-scenario meetings (IB)", "IN": "Idiap non-scenario meetings (IN)"}


def site_of(c: dict) -> str:
    return c["meeting"][:2]


# ----------------------------------------------------------------------------------------------- scoring

def score(clips: list[dict], models: list[Model]) -> dict[str, dict[str, dict]]:
    """results[...] on every clip, plus private per-clip error counts: scores[model][clip id].

    Each record also names the clip's cluster, its meeting series (same participants, same room), which is the
    unit resampled by the bootstrap."""
    series_of = {mid: m.series for mid, m in load_meetings().items()}
    column = {s: i for i, s in enumerate(sorted({series_of[c["meeting"]] for c in clips}))}
    scores: dict[str, dict[str, dict]] = {}
    for model in models:
        raw = transcripts(model.id, clips)
        scores[model.id] = {}
        for c in clips:
            hyp = normalize(raw[c["id"]])
            ref = c["ref"].split()
            ops = align(ref, hyp)
            counts = count_errors(ops)
            errors = sum(counts.values())
            assert errors == Levenshtein.distance(ref, hyp)
            c.setdefault("results", {})[model.id] = {"hyp": " ".join(hyp), "wer": round(errors / len(ref), 3), "ops": ops}
            scores[model.id][c["id"]] = {**counts, "errors": errors, "n": len(ref), "cluster": column[series_of[c["meeting"]]],
                                         "best_order": best_order_errors(c["words"], hyp, errors)}
    return scores


def series_sums(clips: list[dict], scores: dict[str, dict], key: str = "errors") -> tuple[np.ndarray, np.ndarray]:
    """Errors and reference words of `clips`, summed per meeting series (one entry per series in the sample)."""
    k = 1 + max(r["cluster"] for r in scores.values())
    e, n = np.zeros(k), np.zeros(k)
    for c in clips:
        r = scores[c["id"]]
        e[r["cluster"]] += r[key]
        n[r["cluster"]] += r["n"]
    return e, n


def wer_of(clips: list[dict], scores: dict[str, dict], key: str = "errors") -> dict:
    """Corpus-level WER (total errors / total reference words) with a 95 % interval from a bootstrap over meeting series."""
    if not clips:
        return {"wer": None, "n": 0}
    e, n = series_sums(clips, scores, key)
    present = n > 0                                  # resample the series that occur in this group
    lo, hi = interval(bootstrap_wer(e[present][None], n[present][None])[:, 0])
    return {"wer": round(float(e.sum() / n.sum()), 3), "n": len(clips), "ci95": [round(lo, 3), round(hi, 3)]}


def only(c: dict, cond: str) -> bool:
    return c["conditions"] == [cond]


def by_condition(clips: list[dict], scores: dict[str, dict[str, dict]]) -> tuple[dict, dict]:
    """Exclusive groups (a clip counts under a condition only if it is that clip's ONLY condition; `all` is every
    clip) and non-exclusive groups (every clip carrying the condition)."""
    exclusive, anyflag = {}, {}
    for m, sc in scores.items():
        exclusive[m] = {k: wer_of([c for c in clips if only(c, k)], sc) for k in CONDITIONS}
        exclusive[m]["all"] = wer_of(clips, sc)
        anyflag[m] = {k: wer_of([c for c in clips if k in c["conditions"]], sc) for k in CONDITIONS[1:]}
    return exclusive, anyflag


def by_condition_by_site(clips: list[dict], scores: dict[str, dict[str, dict]]) -> dict:
    """The exclusive-group table again within each recording site: {model: {site: {condition: {wer, n}}}}."""
    out: dict = {}
    for m, sc in scores.items():
        out[m] = {}
        for site in sorted({site_of(c) for c in clips}):
            here = [c for c in clips if site_of(c) == site]
            cells = {k: wer_of([c for c in here if only(c, k)], sc) for k in CONDITIONS} | {"all": wer_of(here, sc)}
            out[m][site] = {k: {"wer": v["wer"], "n": v["n"]} for k, v in cells.items()}
    return out


# ----------------------------------------------------------------------------------------------- findings

def _merge_small(edges: list[float], counts: list[int]) -> list[float]:
    edges, counts = list(edges), list(counts)
    while len(counts) > 1 and min(counts) < MIN_BIN_CLIPS:
        i = int(np.argmin(counts))
        j = i + 1 if i == 0 or (i + 1 < len(counts) and counts[i + 1] <= counts[i - 1]) else i - 1
        lo = min(i, j)
        counts[lo] += counts.pop(max(i, j))
        edges.pop(lo + 1)
    return edges


def numeric_bins(subset: list[dict], value, edges: list[float], label) -> list[tuple[str, list[dict]]]:
    """Group `subset` by value into [edge_k, edge_k+1); bins with < MIN_BIN_CLIPS clips are merged."""
    counts = [sum(edges[k] <= value(c) < edges[k + 1] for c in subset) for k in range(len(edges) - 1)]
    edges = _merge_small(edges, counts)
    return [(label(edges[k], edges[k + 1]), [c for c in subset if edges[k] <= value(c) < edges[k + 1]])
            for k in range(len(edges) - 1)]


NO_OVERLAP_BELOW = 0.001      # overlap_ratio is stored to 3 decimals: below this it is exactly 0


def pct_label(lo: float, hi: float) -> str:
    if hi == float("inf"):
        return f"{lo:.0%}+"
    if hi <= NO_OVERLAP_BELOW:
        return "no overlap"
    if lo <= NO_OVERLAP_BELOW:
        return f"under {hi:.0%}"
    return f"{lo:.0%}–{hi:.0%}"


def snr_label(lo: float, hi: float) -> str:
    if lo == -float("inf"):
        return f"<{hi:g} dB"
    if hi == float("inf"):
        return f"{lo:g}+ dB"
    return f"{lo:g}–{hi:g} dB"


NATIVE, NON_NATIVE = "Native English", "Non-native (all)"
ACCENT_PHRASES = {NATIVE: "native-English speakers", NON_NATIVE: "non-native speakers", "Other non-native": "other non-native speakers"}


def accent_groups(subset: list[dict]) -> list[tuple[str, list[dict]]]:
    native = [c for c in subset if c["tags"]["accent"] == "native"]
    non = [c for c in subset if c["tags"]["accent"] == "non-native"]
    by_lang: dict[str, list[dict]] = {}
    for c in non:
        by_lang.setdefault(c["tags"]["native_languages"][0], []).append(c)     # dominant speaker's language
    langs = [(lang.title(), cs) for lang, cs in sorted(by_lang.items(), key=lambda kv: -len(kv[1])) if len(cs) >= MIN_BIN_CLIPS][:3]
    listed = {c["id"] for _, cs in langs for c in cs}
    rest = [c for c in non if c["id"] not in listed]
    # "Non-native (all)" pools the language groups below it: it is the headline contrast, the rest is the breakdown
    groups = [(NATIVE, native), (NON_NATIVE, non)] + langs + ([("Other non-native", rest)] if langs and rest else [])
    return [g for g in groups if g[1]]


def one_site(subset: list[dict]) -> tuple[str, list[dict]]:
    """The clips of `subset` from the single site that supplies most of them.

    The sample is balanced on microphone, overlap and accent but not on recording site, and sites differ a lot in difficulty
    (native-English clips come mostly from Edinburgh, non-native ones mostly from Idiap), so a pooled comparison would mix
    the factor with the site. Every finding therefore compares groups within one site."""
    counts = Counter(site_of(c) for c in subset)
    site = max(sorted(counts), key=counts.get)
    return site, [c for c in subset if site_of(c) == site]


def factors(clips: list[dict], speed: dict) -> dict[str, dict]:
    headset = lambda c: c["mic"] == "headset-mix"
    native = lambda c: c["tags"]["accent"] == "native"
    quiet = lambda c: not c["tags"]["overlap"]
    s_overlap, overlap = one_site([c for c in clips if headset(c) and native(c)])
    s_noise, noise = one_site([c for c in clips if native(c) and quiet(c)])
    s_accent, accent = one_site([c for c in clips if headset(c) and quiet(c)])
    s_speed, pace = one_site([c for c in clips if headset(c) and quiet(c) and native(c)])
    return {
        "overlap": {
            "title": "Overlapping speech", "x_label": "Share of clip with overlapping speech",
            "basis": f"headset mix, native-English speakers; {SITES[s_overlap]} only",
            "phrase": lambda g: "clips with no overlapping speech" if g == "no overlap" else f"clips with {g} overlapping speech",
            "groups": numeric_bins(overlap, lambda c: c["tags"]["overlap_ratio"],
                                   [0, NO_OVERLAP_BELOW, OVERLAP_FROM, 0.20, 0.30, float("inf")], pct_label)},
        "noise": {
            "title": "Distant, noisy audio", "x_label": "Estimated signal-to-noise ratio",
            "basis": f"native-English speakers, no overlapping speech; headset-mix and far-field clips; {SITES[s_noise]} only",
            "phrase": lambda g: f"clips at {g} SNR",
            "groups": numeric_bins(noise, lambda c: c["tags"]["snr_db"],
                                   [-float("inf"), 0, 5, HIGH_NOISE_BELOW_DB, LOW_NOISE_FROM_DB, 30, float("inf")], snr_label)},
        "accent": {
            "title": "Non-native English", "x_label": "Speaker's native language",
            "basis": f"headset mix, no overlapping speech; {SITES[s_accent]} only",
            "phrase": lambda g: ACCENT_PHRASES.get(g, f"{g} speakers"),
            "contrast": (NON_NATIVE, NATIVE),          # categorical factor: pooled non-native vs native, not the two extremes
            "groups": accent_groups(accent)},
        "speed": {
            "title": "Speaking speed", "x_label": f"Speaking rate (slow < {speed['slow_below_wpm']}, fast > {speed['fast_above_wpm']} words/min)",
            "basis": f"headset mix, native-English speakers, no overlapping speech; {SITES[s_speed]} only",
            "phrase": lambda g: f"{g.lower()}-paced speech",
            "groups": [(s.capitalize(), [c for c in pace if c["tags"]["speed"] == s]) for s in ("slow", "normal", "fast")]},
    }


def finding(key: str, f: dict, scores: dict, labels: dict[str, str]) -> dict:
    """Chart over every model for one factor, and the primary model's strongest contrast within it."""
    groups = [(lab, cs) for lab, cs in f["groups"] if cs]
    series = [{"model": m, "points": [{"label": lab, **wer_of(cs, sc)} for lab, cs in groups]} for m, sc in scores.items()]
    prim = [wer_of(cs, scores[PRIMARY]) for _, cs in groups]
    if "contrast" in f:                  # (group of interest, baseline), by label
        names = [lab for lab, _ in groups]
        hi, lo = (names.index(lab) for lab in f["contrast"])
    else:                                # ordinal factor: the two extremes among groups with enough clips
        reliable = [i for i, p in enumerate(prim) if p["n"] >= MIN_BIN_CLIPS]
        hi, lo = max(reliable, key=lambda i: prim[i]["wer"]), min(reliable, key=lambda i: prim[i]["wer"])
    # Is the gap real? Paired bootstrap over meeting series of the difference between the two groups' corpus-level WER.
    (e_hi, n_hi), (e_lo, n_lo) = (series_sums(groups[i][1], scores[PRIMARY]) for i in (hi, lo))
    present = (n_hi + n_lo) > 0                      # resample the series that occur in either group
    draws = bootstrap_wer(np.stack([e_hi, e_lo])[:, present], np.stack([n_hi, n_lo])[:, present])
    low, high = interval(draws[:, 0] - draws[:, 1])
    gap = abs(prim[hi]["wer"] - prim[lo]["wer"])
    significant = bool(low > 0 or high < 0)          # the 95 % interval of the difference excludes zero
    stat = (f"{labels[PRIMARY]}'s word error rate is {prim[hi]['wer']:.1%} on {f['phrase'](groups[hi][0])} versus "
            f"{prim[lo]['wer']:.1%} on {f['phrase'](groups[lo][0])} (n = {prim[hi]['n']} and {prim[lo]['n']} clips; {f['basis']}"
            f"{'' if significant else '; this gap is within sampling noise'}).")
    # Example: the clip most typical of the worst group (WER closest to that group's WER), of moderate length.
    pool = [c for c in groups[hi][1] if 12 <= len(c["ref"].split()) <= 30 and c["duration"] <= 12
            and c["results"][PRIMARY]["wer"] <= 1.0]
    pool = pool or [c for c in groups[hi][1] if c["results"][PRIMARY]["wer"] <= 1.0] or groups[hi][1]
    example = min(pool, key=lambda c: (abs(c["results"][PRIMARY]["wer"] - prim[hi]["wer"]), c["id"]))
    return {"key": key, "title": f["title"], "stat": stat,
            "chart": {"x_label": f["x_label"], "y_label": "Word error rate", "series": series},
            "basis": f["basis"], "example_clip": example["id"],
            "_gap": gap, "_significant": significant}


# ----------------------------------------------------------------------------------------------- picks

def worst_key(c: dict) -> tuple:
    """Highest primary WER first; ties (every all-deleted clip scores exactly 1.0) go to the longer reference."""
    return (-c["results"][PRIMARY]["wer"], -len(c["ref"].split()), c["id"])


def pick_worst(clips: list[dict], k: int = 10) -> list[str]:
    return [c["id"] for c in sorted((c for c in clips if len(c["ref"].split()) >= 8), key=worst_key)[:k]]


def pick_karaoke(clips: list[dict]) -> tuple[str, str]:
    """A short, clean clip a listener can follow, where the primary model makes several clear substitutions.

    "Intelligible" cannot be measured; the proxy is: headset mix, >= 20 dB SNR, one speaker, no overlap, and at
    least one other model transcribes it with half the primary's errors or fewer."""
    def clear_subs(c):
        return sum(o["op"] == "sub" and Levenshtein.normalized_distance(o["ref"], o["hyp"]) >= 0.3
                   for o in c["results"][PRIMARY]["ops"])

    def others_better(c):
        w = c["results"][PRIMARY]["wer"]
        return any(r["wer"] <= w / 2 for m, r in c["results"].items() if m != PRIMARY)

    tiers = [
        ("single speaker, headset, SNR>=20, another model makes <= half the errors",
         lambda c: c["mic"] == "headset-mix" and c["tags"]["n_speakers"] == 1 and c["tags"]["snr_db"] >= 20 and others_better(c)),
        ("single speaker, headset, SNR>=20",
         lambda c: c["mic"] == "headset-mix" and c["tags"]["n_speakers"] == 1 and c["tags"]["snr_db"] >= 20),
        ("headset, no overlap", lambda c: c["mic"] == "headset-mix" and not c["tags"]["overlap"]),
        ("any clip", lambda c: True),
    ]
    for min_subs in (3, 2, 1):
        for name, extra in tiers:
            pool = [c for c in clips if 5 <= c["duration"] <= 8 and len(c["ref"].split()) >= 10
                    and extra(c) and clear_subs(c) >= min_subs]
            if pool:
                best = max(pool, key=lambda c: (clear_subs(c), -c["results"][PRIMARY]["wer"], c["id"]))
                return best["id"], f"{name}; {clear_subs(best)} clear substitutions"
    raise RuntimeError("no 5-8 s clip with a clear substitution")


# ----------------------------------------------------------------------------------------------- audio

def encode_mp3(clip_id: str, dest) -> None:
    x = read_wav(CLIP_WAV / f"{clip_id}.wav")
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    gain = min(10 ** (PLAYBACK_RMS_DBFS / 20) / max(rms, 1e-9), PLAYBACK_PEAK / max(float(np.abs(x).max()), 1e-9))
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", "16000", "-ac", "1", "-i", "-",
         "-c:a", "libmp3lame", "-b:a", "48k", "-ar", "16000", "-ac", "1", "-map_metadata", "-1", str(dest)],
        input=(x * gain).astype("<f4").tobytes(), check=True)


# ----------------------------------------------------------------------------------------------- main

def main() -> None:
    base = json.loads((STAGING / "clips_base.json").read_text(encoding="utf-8"))
    report = json.loads((STAGING / "sampling_report.json").read_text(encoding="utf-8"))
    xy = json.loads((STAGING / "map.json").read_text(encoding="utf-8"))
    speed = report["speed_thresholds"]
    models = selected_models()
    if PRIMARY not in {m.id for m in models}:
        raise SystemExit(f"MISHEARD_MODELS must include the primary model {PRIMARY}")
    labels = {m.id: m.label for m in models}

    clips = []
    for b in base:
        tags = dict(b["tags"])
        if not tags["overlap"] and tags["overlap_ratio"] >= OVERLAP_FROM:
            # the flag was set on the unrounded ratio (< 0.10); show it rounded down so ratio and flag agree
            tags["overlap_ratio"] = round(OVERLAP_FROM - 0.001, 3)
        clips.append({
            "id": b["id"], "x": xy[b["id"]][0], "y": xy[b["id"]][1], "audio": f"audio/{b['id']}.mp3",
            "duration": round(b["duration"], 2), "meeting": b["meeting"], "mic": b["mic"], "tags": tags,
            "conditions": b["conditions"], "ref": b["ref"], "words": b["words"],
        })
    scores = score(clips, models)
    exclusive, anyflag = by_condition(clips, scores)
    per_site = by_condition_by_site(clips, scores)

    # Headline: the primary model's clean -> single-condition contrast with the largest WER.
    prim = exclusive[PRIMARY]
    target = max(("noisy", "overlapping", "accented"), key=lambda k: prim[k]["wer"])
    headline = {"model": PRIMARY, "from_condition": "clean", "to_condition": target,
                "from_wer": prim["clean"]["wer"], "to_wer": prim[target]["wer"],
                "from_n": prim["clean"]["n"], "to_n": prim[target]["n"],
                "from_ci95": prim["clean"]["ci95"], "to_ci95": prim[target]["ci95"]}

    found = [finding(k, f, scores, labels) for k, f in factors(clips, speed).items()]
    found.sort(key=lambda f: (not f["_significant"], -f["_gap"]))
    for f in found:
        print(f"finding {f['key']:8s} gap {f['_gap']:.3f} significant={f['_significant']}  {f['stat']}")
    findings = [{k: v for k, v in f.items() if not k.startswith("_")} for f in found[:3]]

    karaoke, karaoke_tier = pick_karaoke(clips)
    print("karaoke tier:", karaoke_tier)
    ov_clips = {"overlapping": [c for c in clips if only(c, "overlapping")], "any_overlap_flag": [c for c in clips if c["tags"]["overlap"]]}
    summary = {
        "by_condition": exclusive, "headline": headline, "findings": findings,
        "worst10": pick_worst(clips), "karaoke_clip": karaoke,
        "by_condition_any": anyflag, "by_condition_by_site": per_site,
        "overlap_convention": {m: {k: {"time_order": wer_of(cs, sc)["wer"], "best_order": wer_of(cs, sc, "best_order")["wer"]}
                                   for k, cs in ov_clips.items()} for m, sc in scores.items()},
    }

    for m in models:
        m.download()          # resolves the cached snapshot, so meta.models[].detail can state the exact revision
    nat = [c for c in clips if c["tags"]["accent"] == "native"]
    non = [c for c in clips if c["tags"]["accent"] == "non-native"]
    s_nat, k_nat = Counter(site_of(c) for c in nat).most_common(1)[0]
    s_non, k_non = Counter(site_of(c) for c in non).most_common(1)[0]
    n_head = sum(c["mic"] == "headset-mix" for c in clips)
    n_series = len({load_meetings()[c["meeting"]].series for c in clips})
    meta = {
        "dataset": (f"AMI Meeting Corpus (CC BY 4.0): {len(clips)} clips of 5–15 s from {report['meetings_used']} meetings "
                    f"({n_head} cut from the headset mix, {len(clips) - n_head} from a far-field table microphone) "
                    "with the corpus's human word-level transcripts"),
        "models": [{"id": m.id, "label": m.label, "detail": m.detail} for m in models],
        "primary_model": PRIMARY,
        "metric": ("WER = (substitutions + deletions + insertions) / reference words, after Whisper's English text normalizer "
                   "(plus a small spelling-variant map) is applied identically to reference and hypothesis, so fillers (uh, um, mm), "
                   "laughter and unfinished word fragments are not scored; aggregates are "
                   "corpus-level (total errors / total reference words), not means of per-clip WER; with overlapping speech the "
                   "reference orders every speaker's words by start time, which penalises models that transcribe speakers one "
                   "after the other (summary.overlap_convention shows the best-of-orderings variant)"),
        "input": ("Every model is fed the clip's 16 kHz mono PCM exactly as cut from the recording: no loudness normalization, no "
                  "voice-activity detection. Far-field recordings are much quieter than the headset mix. Parakeet and wav2vec 2.0 "
                  "normalize the level inside their feature extractors; Whisper's log-mel front end depends on it, and a check on "
                  "every 5th clip (checks/level_sensitivity.py) found far-field WER about 3 points lower with normalized audio and "
                  "headset WER unchanged; Moonshine's front end does not normalize either, but normalizing changed its overall WER "
                  "by 0.3 point on all 1,000 clips"),
        "normalization": ("Whisper's EnglishTextNormalizer (lower case, punctuation and bracketed text removed, contractions expanded, "
                          "number words to digits, British to American spelling, the fillers hmm/mm/mhm/mmm/uh/um removed), applied "
                          "identically to reference and hypothesis, plus: acronyms written with underscores or dots, and a closed list "
                          "of spelled-out ones, are joined (T_V_, T.V., 'T V' -> tv); ok/'kay -> okay, alright -> all right, e mail -> "
                          "email; laughter written as words (ha ha) and tokens with no letter or digit are dropped; a bare 'oh' stays "
                          "'oh' (the normalizer prints it as the digit 0). Not unified, so they count as errors: compound spellings "
                          "(touch screen / touchscreen) and different ways of writing money and decimals"),
        "n_clips": len(clips),
        "generated_at": datetime.date.today().isoformat(),
        "uncertainty": ("ci95 and 'within sampling noise' come from a bootstrap that resamples whole meeting series (the same "
                        f"participants in the same room; {n_series} series in this sample) 2,000 times with a fixed seed, because "
                        "clips from one series are not independent; 'significant' means the 95 % interval of the difference "
                        "between two groups excludes zero"),
        "tags": {
            "noise": (f"estimated speech-to-background SNR: mean power of annotated-speech frames vs the median power of the "
                      f"meeting's frames far from any annotated sound, per microphone; low >= {LOW_NOISE_FROM_DB:g} dB, "
                      f"mid {HIGH_NOISE_BELOW_DB:g}-{LOW_NOISE_FROM_DB:g} dB, high < {HIGH_NOISE_BELOW_DB:g} dB. In this sample every "
                      "high-noise clip is a far-field clip and every other clip is headset mix, so noise and microphone distance cannot "
                      "be separated; the references were transcribed from close-talk headsets, so some far-field words are barely "
                      "audible in the room microphone"),
            "overlap": f"overlap_ratio = share of speech time with two or more speakers at once (annotations); overlap = ratio >= {OVERLAP_FROM:g}",
            "speed": f"wpm = reference words per minute of speaking time; slow < {speed['slow_below_wpm']}, fast > {speed['fast_above_wpm']} (dataset quartiles)",
            "accent": ("AMI's recorded native language of each speaker: non-native when at least half the clip's words come from "
                       "non-native-English speakers (sampled clips are >= 90 % one or the other). Not a perceptual accent rating"),
            "conditions": ("noisy = high noise (far-field microphone, SNR < 10 dB); overlapping = overlap flag; accented = non-native; "
                           "clean = none of these. summary.by_condition counts a clip only when that is its ONLY condition; "
                           "summary.by_condition_any counts every clip carrying the condition"),
        },
        "sampling": ("balanced design: each of noisy / overlapping / accented is on 40 % of clips, pairwise independent, with the "
                     "single-condition cells enlarged; windows start and end in silences so no word is cut. The sample is stratified "
                     "on purpose, so its overall WER describes this sample, not AMI as a whole. It is not balanced on recording site: "
                     f"{k_nat / len(nat):.0%} of the native-English clips come from {SITES[s_nat]} and {k_non / len(non):.0%} of the "
                     f"non-native clips from {SITES[s_non]}, and the sites differ in difficulty ({labels[PRIMARY]} on clean clips: "
                     f"{per_site[PRIMARY][s_nat]['clean']['wer']:.1%} in {SITES[s_nat]}, "
                     f"{per_site[PRIMARY][s_non]['clean']['wer']:.1%} in {SITES[s_non]}), so each finding compares groups "
                     "within one site and summary.by_condition_by_site repeats the condition table per site"),
        "sites": SITES,
    }

    ensure(STAGING / "audio")
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda c: encode_mp3(c["id"], STAGING / "audio" / f"{c['id']}.mp3"), clips))
    out = {"meta": meta, "clips": clips, "summary": summary}
    (STAGING / "clips.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    ensure(WEB_DATA, WEB_AUDIO)
    keep = {f"{c['id']}.mp3" for c in clips}
    for stale in WEB_AUDIO.glob("*.mp3"):
        if stale.name not in keep:
            stale.unlink()
    for c in clips:
        shutil.copy2(STAGING / "audio" / f"{c['id']}.mp3", WEB_AUDIO / f"{c['id']}.mp3")
    shutil.copy2(STAGING / "clips.json", WEB_DATA / "clips.json")
    print(f"wrote {WEB_DATA / 'clips.json'} ({(WEB_DATA / 'clips.json').stat().st_size / 1e6:.1f} MB) and {len(clips)} mp3s")
