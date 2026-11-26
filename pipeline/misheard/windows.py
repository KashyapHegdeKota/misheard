"""Candidate clip windows and their annotation-derived tags.

A window starts and ends at a *cut point*: the middle of a silence (no word from any speaker, with a
30 ms safety margin around each word) lasting at least 120 ms. So a window never splits a word of any
speaker, and the reference for it is simply "every word whose time falls inside".
"""
from __future__ import annotations

import bisect
from collections import Counter
from dataclasses import dataclass

import numpy as np

from .ami import Meeting, Transcript

MIN_DUR, MAX_DUR = 5.0, 15.0
MIN_WORDS = 8                 # reference words (fragments excluded)
MIN_SPEECH_FRACTION = 0.5     # share of the window covered by someone speaking
CUT_PAD = 0.03                # s of margin around each word when looking for silences
CUT_MIN_SILENCE = 0.12        # s, silence needed (after padding) to place a cut point
SPEAKER_BRIDGE = 0.10         # s: a speaker's pauses shorter than this do not end their speech (overlap)
OVERLAP_MIN = 0.10            # s: simultaneous speech shorter than this is alignment jitter, not overlap
RATE_BRIDGE = 0.50            # s: pauses shorter than this count as speaking time (speech rate)


@dataclass
class Window:
    meeting: str
    start: float
    end: float
    lo: int                   # transcript.words[lo:hi] = everything inside the window (fragments included)
    hi: int
    n_words: int              # reference words (fragments excluded)
    speaker_words: dict[str, int]
    n_speakers: int
    overlap_ratio: float
    wpm: float
    speech_fraction: float
    non_native_share: float
    languages: list[str]      # native languages of the speakers present, by descending word count

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def id(self) -> str:
        return f"{self.meeting}_{int(round(self.start * 10)):05d}"


def merge(intervals: list[tuple[float, float]], bridge: float) -> list[tuple[float, float]]:
    """Union of intervals, joining those separated by at most `bridge` seconds."""
    out: list[tuple[float, float]] = []
    for s, e in sorted(intervals):
        if out and s - out[-1][1] <= bridge:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def _overlap(per_speaker: dict[str, list[tuple[float, float]]]) -> tuple[float, float]:
    """(seconds with >= 1 speaker, seconds of simultaneous speech lasting >= OVERLAP_MIN)."""
    events = sorted((t, d) for ivs in per_speaker.values() for s, e in ivs for t, d in ((s, 1), (e, -1)))
    active, last, speech, overlap, run = 0, 0.0, 0.0, 0.0, 0.0
    for t, d in events:
        if active >= 1:
            speech += t - last
        if active >= 2:
            run += t - last
        elif run:
            overlap += run if run >= OVERLAP_MIN else 0.0
            run = 0.0
        active += d
        last = t
    return speech, overlap


class MeetingWindows:
    """Lookup structures over one meeting's transcript, used to propose and describe windows."""

    def __init__(self, meeting: Meeting, tr: Transcript):
        self.meeting = meeting
        self.tr = tr
        self.starts = [w.start for w in tr.words]
        self.flagged_starts = [s for s, _ in tr.flagged]
        self.languages = {s.agent: s.language for s in meeting.speakers}
        busy = merge([(w.start - CUT_PAD, w.end + CUT_PAD) for w in tr.words]
                     + [(s - CUT_PAD, e + CUT_PAD) for s, e in tr.flagged], 0.0)
        self.cuts = np.array([(a[1] + b[0]) / 2 for a, b in zip(busy, busy[1:]) if b[0] - a[1] >= CUT_MIN_SILENCE])

    def describe(self, t0: float, t1: float) -> Window | None:
        """Tags for the window [t0, t1], or None if it is unusable (too few words, dubious reference...)."""
        lo, hi = bisect.bisect_left(self.starts, t0), bisect.bisect_left(self.starts, t1)
        inside = self.tr.words[lo:hi]
        ref = [w for w in inside if not w.fragment]
        if len(ref) < MIN_WORDS:
            return None
        k = bisect.bisect_left(self.flagged_starts, t0)
        if k < len(self.tr.flagged) and self.tr.flagged[k][0] < t1:
            return None                              # untranscribed, foreign or mispronounced stretch inside
        counts = Counter(w.speaker for w in ref)
        if any(self.languages[a] is None for a in counts):
            return None                              # AMI has no native-language record for a speaker here
        per_speaker: dict[str, list[tuple[float, float]]] = {}
        for w in inside:
            per_speaker.setdefault(w.speaker, []).append((w.start, w.end))
        speech, overlap = _overlap({a: merge(v, SPEAKER_BRIDGE) for a, v in per_speaker.items()})
        if speech / (t1 - t0) < MIN_SPEECH_FRACTION:
            return None
        speaking = sum(e - s for v in per_speaker.values() for s, e in merge(v, RATE_BRIDGE))
        non_native = sum(n for a, n in counts.items() if self.languages[a] != "English")
        return Window(
            meeting=self.meeting.id, start=t0, end=t1, lo=lo, hi=hi, n_words=len(ref),
            speaker_words=dict(counts), n_speakers=len(counts), overlap_ratio=overlap / speech,
            wpm=60.0 * len(ref) / speaking, speech_fraction=speech / (t1 - t0),
            non_native_share=non_native / len(ref),
            languages=list(dict.fromkeys(self.languages[a] for a, _ in counts.most_common())),
        )

    def candidates(self) -> list[Window]:
        """Every usable window of MIN_DUR..MAX_DUR s between two cut points (they overlap heavily in time)."""
        out: list[Window] = []
        for i, c in enumerate(self.cuts):
            lo = np.searchsorted(self.cuts, c + MIN_DUR, side="left")
            hi = np.searchsorted(self.cuts, c + MAX_DUR, side="right")
            for j in range(max(lo, i + 1), hi):
                w = self.describe(float(c), float(self.cuts[j]))
                if w is not None:
                    out.append(w)
        return out
