"""Stage 3: run every model on every clip.

Raw hypotheses are cached per model in TRANSCRIPTS/<model>.jsonl, one line per clip, appended and flushed as
we go, keyed by clip id AND a hash of the clip's audio, so a crash loses at most one clip and a changed clip
set can never serve a stale transcript.
"""
from __future__ import annotations

import hashlib
import json
import time

from tqdm import tqdm

from .audio import read_wav
from .common import CLIP_WAV, STAGING, TRANSCRIPTS, ensure
from .models import selected_models


def audio_hash(clip_id: str) -> str:
    return hashlib.sha1((CLIP_WAV / f"{clip_id}.wav").read_bytes()).hexdigest()[:12]


def load_cache(model_id: str) -> dict[str, dict]:
    path = TRANSCRIPTS / f"{model_id}.jsonl"
    cache: dict[str, dict] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                cache[r["id"]] = r
    return cache


def transcripts(model_id: str, clips: list[dict]) -> dict[str, str]:
    """Raw transcript per clip id; raises if any clip is missing or was transcribed from different audio."""
    cache = load_cache(model_id)
    out = {}
    for c in clips:
        r = cache.get(c["id"])
        if r is None or r["audio"] != audio_hash(c["id"]):
            raise KeyError(f"{model_id}: no valid transcript for {c['id']}; run the transcribe stage")
        out[c["id"]] = r["text"]
    return out


def main() -> None:
    ensure(TRANSCRIPTS)
    clips = json.loads((STAGING / "clips_base.json").read_text(encoding="utf-8"))
    hashes = {c["id"]: audio_hash(c["id"]) for c in clips}
    for model in selected_models():
        cache = load_cache(model.id)
        todo = [c["id"] for c in clips if cache.get(c["id"], {}).get("audio") != hashes[c["id"]]]
        if not todo:
            print(f"{model.id}: all {len(clips)} clips cached", flush=True)
            continue
        model.load()
        seconds = 0.0
        with open(TRANSCRIPTS / f"{model.id}.jsonl", "a", encoding="utf-8") as f:
            for cid in tqdm(todo, desc=model.id, mininterval=30):
                audio = read_wav(CLIP_WAV / f"{cid}.wav")
                t0 = time.time()
                text = model.transcribe(audio)
                seconds += time.time() - t0
                f.write(json.dumps({"id": cid, "audio": hashes[cid], "text": text}, ensure_ascii=False) + "\n")
                f.flush()
        print(f"{model.id}: {len(todo)} clips in {seconds:.0f}s of model time", flush=True)
        model.unload()
