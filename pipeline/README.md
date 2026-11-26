# Misheard data pipeline

Builds `web/public/data/clips.json` and `web/public/audio/<id>.mp3` from the AMI Meeting Corpus (CC BY 4.0):
1,000 clips of 5–15 s, the human transcript for each, five speech models' transcripts, per-clip WER with word
alignments, condition tags, a wav2vec2 + UMAP map, and the summary the site reads.

## Rerun

Needs an NVIDIA GPU (8 GB is enough), `ffmpeg`/`ffprobe` on PATH, [uv](https://docs.astral.sh/uv/) and about 16 GB of disk.

```powershell
cd pipeline
uv sync --managed-python --python 3.12          # Python 3.12 + CUDA 12.8 PyTorch from pyproject.toml
uv run python -I -m misheard all                # download, clips, transcribe, embed, assemble, validate
uv run python -I -m misheard assemble validate  # or any stages, in this order
```

* Everything downloaded, cached or intermediate goes to `pipeline/data/` (git-ignored); only `assemble` writes into `web/public/`.
* Every stage is resumable: downloads resume, transcripts are cached per model per clip (`data/work/transcripts/<model>.jsonl`,
  keyed by a hash of the clip audio; delete a file to redo that model). All randomness uses the seed in `misheard/common.py`.
* `MISHEARD_MODELS=id,id` limits `transcribe` and `assemble` to those models (`whisper-large-v3`, the primary, must be in the
  list for `assemble`): e.g. finish the report with the models that are done, rerun with the rest later.
* `checks/` holds one-off sensitivity checks quoted in the write-up (not part of `all`): `level_sensitivity.py <model id> <step>`
  re-runs a model on loudness-normalised audio, `accent_speakers.py` counts the distinct participants behind each accent group.
* Models, decoding settings and the exact checkpoint revisions are in `misheard/models.py` and in `meta.models[].detail`;
  the metric, normalizer and tag definitions are in `meta.metric` / `meta.tags`; `validate` re-checks the delivered file against the output contract.
