"""Signal measurements: frame power and the speech-to-background SNR tag.

SNR definition (per clip, per microphone):
  * background noise power N = median 25 ms-frame power over the frames of the *whole meeting* that are at
    least 250 ms away from any annotated word, laugh/cough or dubious stretch of any speaker;
  * speech power S = mean frame power over the clip's frames that fall inside annotated speech;
  * SNR = 10 log10((S - N) / N).
Speech activity comes from AMI's per-speaker forced-aligned words, so no VAD errors enter the estimate, and
the noise floor does not depend on whether the clip itself happens to contain a pause.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from .ami import Transcript
from .common import SAMPLE_RATE
from .windows import merge

WIN, HOP = 400, 160                 # 25 ms frames every 10 ms at 16 kHz
SPEECH_BRIDGE = 0.2                 # s: join word intervals separated by less than this into "speech"
QUIET_MARGIN = 0.25                 # s clear of any annotated sound when estimating the noise floor
MIN_QUIET_FRAMES = 500              # 5 s of background needed for a trustworthy floor


def read_wav(path: Path) -> np.ndarray:
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if sr != SAMPLE_RATE or x.ndim != 1:
        raise ValueError(f"{path}: expected 16 kHz mono, got {sr} Hz, shape {x.shape}")
    return x


def frame_power(x: np.ndarray) -> np.ndarray:
    """Mean square of each 25 ms frame (10 ms hop), computed in chunks to keep memory flat."""
    n = (len(x) - WIN) // HOP + 1
    out = np.empty(n)
    step = 20_000                                       # frames per chunk (~64 MB of float64)
    for f0 in range(0, n, step):
        f1 = min(n, f0 + step)
        seg = x[f0 * HOP:(f1 - 1) * HOP + WIN].astype(np.float64)
        out[f0:f1] = (np.lib.stride_tricks.sliding_window_view(seg, WIN)[::HOP] ** 2).mean(axis=1)
    return out


def _inside(centers: np.ndarray, intervals: list[tuple[float, float]]) -> np.ndarray:
    if not intervals:
        return np.zeros(len(centers), dtype=bool)
    s, e = np.array(intervals).T
    k = np.searchsorted(s, centers, side="right") - 1
    return (k >= 0) & (centers <= e[np.maximum(k, 0)])


class SnrEstimator:
    """Annotation-derived speech / quiet frame masks for one meeting; apply them to any microphone's power."""

    def __init__(self, tr: Transcript, n_frames: int):
        self.centers = np.arange(n_frames) * HOP / SAMPLE_RATE + WIN / (2 * SAMPLE_RATE)
        self.speech = _inside(self.centers, merge([(w.start, w.end) for w in tr.words], SPEECH_BRIDGE))
        every = [(w.start, w.end) for w in tr.words] + tr.vocal + tr.flagged
        self.quiet = ~_inside(self.centers, merge([(s - QUIET_MARGIN, e + QUIET_MARGIN) for s, e in every], 0.0))

    def noise_floor(self, power: np.ndarray) -> float:
        n = min(len(power), len(self.quiet))
        quiet = power[:n][self.quiet[:n]]
        if len(quiet) < MIN_QUIET_FRAMES:
            raise ValueError(f"only {len(quiet)} background frames; cannot estimate a noise floor")
        return float(np.median(quiet))

    def snr_db(self, power: np.ndarray, noise: float, t0: float, t1: float) -> float | None:
        f0, f1 = int(np.searchsorted(self.centers, t0)), int(np.searchsorted(self.centers, t1))
        p = power[f0:f1][self.speech[f0:f1]]
        if len(p) == 0:
            return None
        return float(10 * np.log10(max(p.mean() - noise, 1e-3 * noise) / noise))
