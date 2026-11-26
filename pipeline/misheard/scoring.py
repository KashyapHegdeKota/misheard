"""Word alignment and error rates."""
from __future__ import annotations

from itertools import permutations

import numpy as np
from rapidfuzz.distance import Levenshtein

from .common import SEED

BOOTSTRAP_RESAMPLES = 2000


def align(ref: list[str], hyp: list[str]) -> list[dict]:
    """Minimum-edit alignment (unit costs). Ties prefer match/substitution, then deletion, then insertion.
    Each op is {"op": equal|sub|del|ins, "ref": word|None, "hyp": word|None}; ops that carry a ref word
    appear in reference order."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        d[i][0] = i
    for j in range(1, m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]), d[i - 1][j] + 1, d[i][j - 1] + 1)
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append({"op": "equal" if ref[i - 1] == hyp[j - 1] else "sub", "ref": ref[i - 1], "hyp": hyp[j - 1]})
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append({"op": "del", "ref": ref[i - 1], "hyp": None})
            i -= 1
        else:
            ops.append({"op": "ins", "ref": None, "hyp": hyp[j - 1]})
            j -= 1
    ops.reverse()
    return ops


def count_errors(ops: list[dict]) -> dict[str, int]:
    return {k: sum(o["op"] == k for o in ops) for k in ("sub", "del", "ins")}


def best_order_errors(words: list[dict], hyp: list[str], time_order_errors: int) -> int:
    """Fewest errors over every reference order a human could defend: the by-start-time order used for the
    headline, or each speaker's words kept together (speakers in any order). A lower bound for overlap."""
    by_speaker: dict[str, list[str]] = {}
    for w in words:
        by_speaker.setdefault(w["speaker"], []).append(w["w"])
    best = time_order_errors
    if 1 < len(by_speaker) <= 5:
        for order in permutations(by_speaker):
            best = min(best, Levenshtein.distance([t for s in order for t in by_speaker[s]], hyp))
    return best


def bootstrap_wer(errors: np.ndarray, n_ref: np.ndarray, seed: int = SEED) -> np.ndarray:
    """Cluster bootstrap of corpus-level WER.

    `errors` and `n_ref` are (groups, clusters) sums of errors and reference words. Clusters (here: meeting series,
    i.e. the same participants in the same room) are resampled with replacement, with the same draw for every
    group so that differences between groups are paired. Returns (BOOTSTRAP_RESAMPLES, groups) WERs; a group
    with no reference words in a draw gives nan."""
    idx = np.random.default_rng(seed).integers(0, errors.shape[1], size=(BOOTSTRAP_RESAMPLES, errors.shape[1]))
    with np.errstate(invalid="ignore", divide="ignore"):
        return (errors[:, idx].sum(axis=2) / n_ref[:, idx].sum(axis=2)).T


def interval(draws: np.ndarray) -> tuple[float, float]:
    """95 % percentile interval of bootstrap draws (nan draws ignored)."""
    lo, hi = np.nanpercentile(draws, [2.5, 97.5])
    return float(lo), float(hi)
