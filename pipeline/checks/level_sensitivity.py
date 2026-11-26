"""Does input level matter for a model? Re-run it on every k-th clip with the gain normalised to -23 dBFS RMS (peak <= 0.95)
and compare with the cached transcripts, which come from the raw clip audio.

    uv run python -I checks/level_sensitivity.py whisper-large-v3 5      # model id, step (5 = every 5th clip)

Needs the transcribe stage to have run. Not part of `all`; the results are quoted in the report, not in clips.json."""
import json, sys, time
import numpy as np
from misheard.audio import read_wav
from misheard.common import CLIP_WAV, STAGING, TRANSCRIPTS
from misheard.models import MODELS
from misheard.scoring import align
from misheard.text import normalize

sys.stdout.reconfigure(encoding="utf-8")
model_id = sys.argv[1]
step = int(sys.argv[2])
clips = {c["id"]: c for c in json.loads((STAGING / "clips_base.json").read_text(encoding="utf-8"))}
cached = {}
for line in (TRANSCRIPTS / f"{model_id}.jsonl").read_text(encoding="utf-8").splitlines():
    if line.strip():
        r = json.loads(line)
        cached[r["id"]] = r["text"]
ids = sorted(cached)[::step]
m = next(m for m in MODELS if m.id == model_id)
m.load()


def gain_to(x, rms_dbfs, peak):
    rms = float(np.sqrt(np.mean(x.astype(np.float64) ** 2)))
    gain = min(10 ** (rms_dbfs / 20) / max(rms, 1e-9), peak / max(float(np.abs(x).max()), 1e-9))
    return (x * gain).astype(np.float32)


def errors(cid, text):
    ref = clips[cid]["ref"].split()
    return sum(o["op"] != "equal" for o in align(ref, normalize(text))), len(ref)


tot_raw = tot_norm = n_words = changed = better = worse = 0
empty_raw = empty_norm = 0
t0 = time.time()
by_mic = {}
for cid in ids:
    a = read_wav(CLIP_WAV / f"{cid}.wav")
    text = m.transcribe(gain_to(a, -23.0, 0.95))
    e_raw, n = errors(cid, cached[cid])
    e_norm, _ = errors(cid, text)
    tot_raw += e_raw
    tot_norm += e_norm
    n_words += n
    changed += normalize(text) != normalize(cached[cid])
    better += e_norm < e_raw
    worse += e_norm > e_raw
    empty_raw += not cached[cid].strip()
    empty_norm += not text.strip()
    d = by_mic.setdefault((clips[cid]["meeting"][:2], clips[cid]["mic"]), [0, 0, 0])
    d[0] += e_raw; d[1] += e_norm; d[2] += n
print(f"{model_id}: {len(ids)} clips (every {step}th), {time.time() - t0:.0f}s")
print(f"raw level       : {tot_raw}/{n_words} = {tot_raw / n_words:.3f} WER, {empty_raw} empty")
print(f"normalised level: {tot_norm}/{n_words} = {tot_norm / n_words:.3f} WER, {empty_norm} empty")
print(f"transcript differs on {changed} clips; normalised better on {better}, worse on {worse}")
for mic, (a, b, n) in sorted(by_mic.items()):
    print(f"  {mic}: raw {a / n:.3f} -> normalised {b / n:.3f} ({n} words)")
