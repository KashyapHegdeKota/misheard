"""Paths and constants shared by every stage."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # pipeline/
REPO = ROOT.parent
DATA = ROOT / "data"                                  # git-ignored: downloads, caches, intermediates
RAW = DATA / "raw"
ANNOTATIONS = RAW / "annotations"
AUDIO_RAW = RAW / "audio"                             # AUDIO_RAW/<meeting>/<meeting>.<mic>.wav
WORK = DATA / "work"
CLIP_WAV = WORK / "clip_wav"                          # exact 16 kHz audio each model hears
TRANSCRIPTS = WORK / "transcripts"                    # raw hypotheses: <model>.jsonl (append-only cache)
STAGING = DATA / "out"                                # assembled outputs, copied into web/public by `publish`
WEB_DATA = REPO / "web" / "public" / "data"
WEB_AUDIO = REPO / "web" / "public" / "audio"

SAMPLE_RATE = 16_000
SEED = 20241125            # one seed for every stochastic step (sampling, UMAP, bootstrap)

# Microphones. `mic` in clips.json uses the first spelling.
MICS = {"headset-mix": "Mix-Headset", "far-field": "Array1-01"}


def ensure(*dirs: Path) -> None:
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
