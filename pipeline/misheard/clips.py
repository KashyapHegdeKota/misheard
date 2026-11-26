"""Stage 2: choose ~1,000 windows, tag them, cut the audio.

Sampling is a designed experiment, not a random draw, so every condition has hundreds of clips and the
conditions are not confounded with each other. Each clip is one cell of overlap x accent x microphone:

    overlap     : >= 10 % of the clip's speech time has two or more people talking (annotations); else < 10 %
    accent      : "native" = <= 10 % of reference words from non-native speakers, "non-native" = >= 90 %
                  (AMI native-language metadata); mixed clips are not sampled
    microphone  : the clip is cut from ONE recording: headset mix (must measure >= 10 dB SNR) or the far-field
                  table microphone, Array1 mic 1 (must measure < 10 dB, i.e. the "noisy" condition)

Quotas (QUOTAS) make each condition appear on exactly 40 % of clips, pairwise independent (every pair of
conditions co-occurs on 16 % of clips = 0.4 x 0.4), with the single-condition cells enlarged so that
clean-vs-one-condition contrasts rest on 160-200 clips each. Cells are filled scarcest first, with a
per-meeting cap and no two clips of one meeting overlapping in time.
"""
from __future__ import annotations

import json
import math
import random
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from . import ami
from .audio import SnrEstimator, frame_power, read_wav
from .common import AUDIO_RAW, CLIP_WAV, MICS, SAMPLE_RATE, SEED, STAGING, ensure
from .download import selected_meetings
from .text import reference_tokens
from .windows import MeetingWindows, Window

# (overlap, accent, mic) -> number of clips
QUOTAS: dict[tuple[bool, str, str], int] = {
    (False, "native", "headset-mix"): 200,       # clean
    (True, "native", "headset-mix"): 160,        # overlapping only
    (False, "non-native", "headset-mix"): 160,   # accented only
    (False, "native", "far-field"): 160,         # noisy only
    (True, "non-native", "headset-mix"): 80,     # overlapping + accented
    (True, "native", "far-field"): 80,           # noisy + overlapping
    (False, "non-native", "far-field"): 80,      # noisy + accented
    (True, "non-native", "far-field"): 80,       # all three
}
N_CLIPS = sum(QUOTAS.values())

OVERLAP_FROM = 0.10          # overlap_ratio threshold for the `overlap` flag
ACCENT_PURITY = 0.10         # native: share of non-native words <= this; non-native: >= 1 - this
HIGH_NOISE_BELOW_DB = 10.0   # SNR buckets: high noise < 10 dB <= mid < 20 dB <= low
LOW_NOISE_FROM_DB = 20.0
MIN_REF_TOKENS = 8           # after normalisation (fillers such as "uh" are dropped)
MIN_SEPARATION = 1.0         # s between two clips of one meeting


@dataclass
class Candidate:
    w: Window
    snr: dict[str, float | None]      # by mic name; None if that recording is missing


def _survey_meeting(mid: str) -> tuple[str, list[Candidate], dict[str, float]]:
    meeting = ami.load_meetings()[mid]
    tr = ami.load_transcript(meeting)
    wins = MeetingWindows(meeting, tr).candidates()
    power = {}
    for mic, tag in MICS.items():
        path = AUDIO_RAW / mid / f"{mid}.{tag}.wav"
        if path.exists():
            power[mic] = frame_power(read_wav(path))
    n = min(len(p) for p in power.values())
    est = SnrEstimator(tr, n)
    floors, snr = {}, {}
    for mic, p in power.items():
        try:
            noise = est.noise_floor(p[:n])
        except ValueError as e:                     # no usable background frames: this recording cannot be tagged
            print(f"  {mid} {mic}: {e}", flush=True)
            continue
        floors[mic] = 10 * math.log10(noise)
        snr[mic] = [est.snr_db(p[:n], noise, w.start, w.end) for w in wins]
    return mid, [Candidate(w, {mic: (snr[mic][i] if mic in snr else None) for mic in MICS})
                 for i, w in enumerate(wins)], floors


def survey() -> tuple[dict[str, list[Candidate]], dict[str, dict[str, float]]]:
    mids = selected_meetings()
    cands, floors = {}, {}
    with ProcessPoolExecutor(max_workers=3) as pool:
        for i, (mid, c, f) in enumerate(pool.map(_survey_meeting, mids), 1):
            cands[mid], floors[mid] = c, f
            print(f"  surveyed {i}/{len(mids)} {mid}: {len(c)} candidate windows", flush=True)
    return cands, floors


def noise_bucket(snr: float) -> str:
    return "high" if snr < HIGH_NOISE_BELOW_DB else "mid" if snr < LOW_NOISE_FROM_DB else "low"


def cell_of(c: Candidate, mic: str) -> tuple[bool, str, str] | None:
    snr = c.snr[mic]
    if snr is None or (snr < HIGH_NOISE_BELOW_DB) != (mic == "far-field"):
        return None
    share = c.w.non_native_share
    accent = "native" if share <= ACCENT_PURITY else "non-native" if share >= 1 - ACCENT_PURITY else None
    return None if accent is None else (c.w.overlap_ratio >= OVERLAP_FROM, accent, mic)


def timed_reference(words: list[ami.Word], t0: float) -> tuple[list[str], list[dict]]:
    """Normalised reference tokens with times (relative to the clip start) and speaker letters."""
    ref = sorted((w for w in words if not w.fragment), key=lambda w: (w.start, w.end, w.speaker))
    toks, spans = reference_tokens([w.text for w in ref])
    out, i = [], 0
    while i < len(toks):
        lo, hi = spans[i]
        j = i
        while j + 1 < len(toks) and spans[j + 1] == (lo, hi):
            j += 1
        s, e = min(w.start for w in ref[lo:hi + 1]), max(w.end for w in ref[lo:hi + 1])
        n = j - i + 1
        for k in range(n):       # several tokens from one span (e.g. "won't" -> will not) share its time equally
            out.append({"w": toks[i + k], "start": round(s + (e - s) * k / n - t0, 3),
                        "end": round(s + (e - s) * (k + 1) / n - t0, 3), "speaker": ref[lo].speaker})
        i = j + 1
    return toks, out


def select(cands: dict[str, list[Candidate]]) -> tuple[list[tuple[Candidate, str, tuple]], dict]:
    rng = random.Random(SEED)
    targets = QUOTAS
    pools: dict[tuple, list[tuple[Candidate, str]]] = defaultdict(list)
    for mid in sorted(cands):
        for c in cands[mid]:
            for mic in MICS:
                key = cell_of(c, mic)
                if key is not None:
                    pools[key].append((c, mic))
    taken: dict[str, list[tuple[float, float]]] = defaultdict(list)
    chosen: list[tuple[Candidate, str, tuple]] = []
    report = {}
    transcripts: dict[str, ami.Transcript] = {}
    for key in sorted(targets, key=lambda k: len(pools[k]) / targets[k]):        # scarcest cell first
        pool = sorted(pools[key], key=lambda cm: (cm[0].w.id, cm[1]))
        rng.shuffle(pool)
        n_meetings = len({c.w.meeting for c, _ in pool})
        cap = max(2, math.ceil(1.25 * targets[key] / max(n_meetings, 1)))
        per_meeting: Counter = Counter()
        got = 0
        for relax in (1, 2, 4, 1_000):
            for c, mic in pool:
                if got >= targets[key]:
                    break
                w, mid = c.w, c.w.meeting
                if per_meeting[mid] >= cap * relax or any(
                        w.start < e + MIN_SEPARATION and s - MIN_SEPARATION < w.end for s, e in taken[mid]):
                    continue
                tr = transcripts.setdefault(mid, ami.load_transcript(ami.load_meetings()[mid]))
                if len(timed_reference(tr.words[w.lo:w.hi], w.start)[0]) < MIN_REF_TOKENS:
                    continue
                taken[mid].append((w.start, w.end))
                per_meeting[mid] += 1
                chosen.append((c, mic, key))
                got += 1
        report["/".join(map(str, key))] = {"target": targets[key], "got": got, "pool": len(pool), "meetings": n_meetings}
    return chosen, report


def build_clip(c: Candidate, mic: str, tr: ami.Transcript, meeting: ami.Meeting) -> dict:
    w = c.w
    words = tr.words[w.lo:w.hi]
    toks, timed = timed_reference(words, w.start)
    snr = c.snr[mic]
    return {
        "id": w.id, "meeting": w.meeting, "mic": mic, "start": round(w.start, 3), "end": round(w.end, 3),
        "duration": round(w.duration, 3), "partition": meeting.partition,
        "tags": {
            "snr_db": round(snr, 1), "noise": noise_bucket(snr),
            "overlap_ratio": round(w.overlap_ratio, 3), "overlap": w.overlap_ratio >= OVERLAP_FROM,
            "wpm": round(w.wpm), "n_speakers": w.n_speakers,
            "accent": "non-native" if w.non_native_share >= 0.5 else "native", "native_languages": w.languages,
        },
        "non_native_share": round(w.non_native_share, 3),
        "ref": " ".join(toks), "words": timed,
    }


def write_wav(clip: dict) -> None:
    path = AUDIO_RAW / clip["meeting"] / f"{clip['meeting']}.{MICS[clip['mic']]}.wav"
    a, b = round(clip["start"] * SAMPLE_RATE), round(clip["end"] * SAMPLE_RATE)
    pcm, sr = sf.read(path, start=a, stop=b, dtype="int16")
    assert sr == SAMPLE_RATE and len(pcm) == b - a, (clip["id"], len(pcm), b - a)
    sf.write(CLIP_WAV / f"{clip['id']}.wav", pcm, SAMPLE_RATE, subtype="PCM_16")


def add_bucket_tags(clips: list[dict]) -> dict:
    """Speed buckets: slow = slowest quarter of the dataset, fast = fastest quarter (rounded to 5 wpm)."""
    lo, hi = (5 * round(np.percentile([c["tags"]["wpm"] for c in clips], q) / 5) for q in (25, 75))
    for c in clips:
        t = c["tags"]
        t["speed"] = "slow" if t["wpm"] < lo else "fast" if t["wpm"] > hi else "normal"
        c["conditions"] = (["noisy"] if t["noise"] == "high" else []) + (["overlapping"] if t["overlap"] else [])             + (["accented"] if t["accent"] == "non-native" else []) or ["clean"]
    return {"slow_below_wpm": lo, "fast_above_wpm": hi}


def main() -> None:
    ensure(CLIP_WAV, STAGING)
    cands, floors = survey()
    chosen, cells = select(cands)
    meetings = ami.load_meetings()
    transcripts = {mid: ami.load_transcript(meetings[mid]) for mid in {c.w.meeting for c, _, _ in chosen}}
    clips = [build_clip(c, mic, transcripts[c.w.meeting], meetings[c.w.meeting]) for c, mic, _ in chosen]
    clips.sort(key=lambda c: c["id"])
    speed = add_bucket_tags(clips)
    for clip in clips:
        write_wav(clip)
    report = {
        "n_clips": len(clips), "cells": cells, "speed_thresholds": speed, "noise_floor_db": floors,
        "thresholds": {"overlap_from": OVERLAP_FROM, "accent_purity": ACCENT_PURITY,
                       "high_noise_below_db": HIGH_NOISE_BELOW_DB, "low_noise_from_db": LOW_NOISE_FROM_DB},
        "meetings_used": len({c["meeting"] for c in clips}),
        "candidate_windows": {mid: len(v) for mid, v in cands.items()},
    }
    (STAGING / "clips_base.json").write_text(json.dumps(clips, indent=1), encoding="utf-8")
    (STAGING / "sampling_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(cells, indent=1))
    print(f"{len(clips)} clips from {report['meetings_used']} meetings; speed buckets {speed}")
