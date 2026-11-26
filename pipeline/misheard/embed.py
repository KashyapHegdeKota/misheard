"""Stage 4: the map. Each clip -> wav2vec 2.0 embedding -> UMAP -> (x, y) in [-1, 1].

Embedding: facebook/wav2vec2-base (self-supervised, no ASR fine-tuning); the hidden states of all 13 layers
are mean-pooled over time and then averaged over layers (no layer is hand-picked), so a clip's point reflects
how it sounds (speaker, channel, noise, overlap, speaking style), not what the transcript says.
Reduction: z-scored features -> UMAP (cosine, 15 neighbours, min_dist 0.15, fixed seed); each axis is then
min-max scaled to [-1, 1].
"""
from __future__ import annotations

import json

import numpy as np
from tqdm import tqdm

from .audio import read_wav
from .common import CLIP_WAV, SAMPLE_RATE, SEED, STAGING, WORK, ensure
from .models import fetch

EMBEDDINGS = WORK / "embeddings.npz"
MODEL = "facebook/wav2vec2-base"


def embed_clips(ids: list[str]) -> np.ndarray:
    import torch
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2Model
    path = fetch(MODEL, ["*.json", "pytorch_model.bin"])
    extractor = Wav2Vec2FeatureExtractor.from_pretrained(path)
    model = Wav2Vec2Model.from_pretrained(path).to("cuda").eval()
    out = []
    for cid in tqdm(ids, desc="wav2vec2 embeddings", mininterval=30):
        inputs = extractor(read_wav(CLIP_WAV / f"{cid}.wav"), sampling_rate=SAMPLE_RATE, return_tensors="pt").to("cuda")
        with torch.inference_mode():
            hidden = model(**inputs, output_hidden_states=True).hidden_states      # 13 x (1, T, 768)
        out.append(torch.stack([h.mean(dim=1)[0] for h in hidden]).mean(dim=0).cpu().numpy())
    return np.stack(out)


def project(x: np.ndarray) -> np.ndarray:
    import umap
    z = (x - x.mean(0)) / (x.std(0) + 1e-8)
    xy = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.15, metric="cosine", random_state=SEED).fit_transform(z)
    return 2 * (xy - xy.min(0)) / (xy.max(0) - xy.min(0)) - 1


def main() -> None:
    ensure(WORK, STAGING)
    ids = [c["id"] for c in json.loads((STAGING / "clips_base.json").read_text(encoding="utf-8"))]
    if EMBEDDINGS.exists() and list(np.load(EMBEDDINGS)["ids"]) == ids:
        x = np.load(EMBEDDINGS)["x"]
    else:
        x = embed_clips(ids)
        np.savez(EMBEDDINGS, ids=np.array(ids), x=x)
    xy = project(x)
    (STAGING / "map.json").write_text(
        json.dumps({cid: [round(float(a), 3), round(float(b), 3)] for cid, (a, b) in zip(ids, xy)}), encoding="utf-8")
    print(f"map for {len(ids)} clips written")
