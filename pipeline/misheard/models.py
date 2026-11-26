"""The speech models under test. Each takes 16 kHz mono float32 audio and returns the raw transcript.

Decoding is deterministic everywhere (greedy or fixed-beam, temperature 0), so reruns reproduce the
transcripts bit for bit on the same hardware/library versions. Weights are cached under pipeline/data/hf.
"""
from __future__ import annotations

import gc
import importlib.metadata as md
import os
from pathlib import Path

import numpy as np
from huggingface_hub import snapshot_download

from .common import DATA, SAMPLE_RATE

HF_CACHE = DATA / "hf"


def fetch(repo: str, patterns: list[str]) -> Path:
    return Path(snapshot_download(repo, cache_dir=HF_CACHE, allow_patterns=patterns))


class Model:
    id: str
    label: str
    repo: str
    patterns: list[str]
    path: Path | None = None

    def download(self) -> None:
        self.path = fetch(self.repo, self.patterns)

    @property
    def revision(self) -> str:
        assert self.path is not None
        return self.path.name[:7]          # snapshots/<commit sha>

    def load(self) -> None:
        raise NotImplementedError

    def transcribe(self, audio: np.ndarray) -> str:
        raise NotImplementedError

    def unload(self) -> None:
        for attr in ("model", "processor"):
            if hasattr(self, attr):
                delattr(self, attr)
        gc.collect()
        import torch
        torch.cuda.empty_cache()

    @property
    def detail(self) -> str:
        raise NotImplementedError


class Whisper(Model):
    """OpenAI Whisper through faster-whisper (CTranslate2)."""

    def __init__(self, id: str, label: str, repo: str):
        self.id, self.label, self.repo = id, label, repo
        self.patterns = ["*.json", "*.txt", "model.bin"]

    def load(self) -> None:
        import torch  # noqa: F401  # loads the CUDA 12 / cuDNN 9 DLLs that ctranslate2 needs on Windows
        from faster_whisper import WhisperModel
        self.download()
        self.model = WhisperModel(str(self.path), device="cuda", compute_type="float16")

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _ = self.model.transcribe(
            audio, language="en", task="transcribe", beam_size=5, temperature=0.0,
            condition_on_previous_text=False, vad_filter=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()

    @property
    def detail(self) -> str:
        return (f"{self.repo} @ {self.revision} (CTranslate2, float16) via faster-whisper {md.version('faster-whisper')}; "
                "language=en, beam 5, temperature 0 without fallback, no VAD filter, no previous-text conditioning, "
                "library-default no-speech/log-prob thresholds, 30 s window (each clip is one window)")


class Wav2Vec2CTC(Model):
    """wav2vec 2.0 with a CTC head: character output, greedy decoding, no language model."""

    def __init__(self, id: str, label: str, repo: str):
        self.id, self.label, self.repo = id, label, repo
        self.patterns = ["*.json", "*.txt", "pytorch_model.bin"]

    def load(self) -> None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
        self.download()
        self.processor = Wav2Vec2Processor.from_pretrained(self.path)
        self.model = Wav2Vec2ForCTC.from_pretrained(self.path).to("cuda").eval()

    def transcribe(self, audio: np.ndarray) -> str:
        import torch
        inputs = self.processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").to("cuda")
        with torch.inference_mode():
            ids = self.model(inputs.input_values).logits.argmax(-1)
        return self.processor.batch_decode(ids)[0]

    @property
    def detail(self) -> str:
        return (f"{self.repo} @ {self.revision} (fp32, transformers {md.version('transformers')}); greedy CTC decoding, "
                "no language model; fine-tuned on LibriSpeech 960 h only (read audiobooks)")


class Parakeet(Model):
    """NVIDIA FastConformer-TDT transducer, through transformers."""

    def __init__(self, id: str, label: str, repo: str):
        self.id, self.label, self.repo = id, label, repo
        self.patterns = ["*.json", "*.model", "*.txt", "model.safetensors"]

    def load(self) -> None:
        from transformers import AutoModelForTDT, AutoProcessor
        self.download()
        self.processor = AutoProcessor.from_pretrained(self.path)
        self.model = AutoModelForTDT.from_pretrained(self.path, dtype="auto").to("cuda").eval()

    def transcribe(self, audio: np.ndarray) -> str:
        import torch
        inputs = self.processor(audio, sampling_rate=SAMPLE_RATE)
        inputs.to(self.model.device, dtype=self.model.dtype)
        with torch.inference_mode():
            out = self.model.generate(**inputs, return_dict_in_generate=True)
        text = self.processor.decode(out.sequences, skip_special_tokens=True)
        return text[0] if isinstance(text, list) else text

    @property
    def detail(self) -> str:
        return (f"{self.repo} @ {self.revision} (fp32, transformers {md.version('transformers')}); "
                "greedy TDT decoding; multilingual checkpoint, no language forcing")


class Moonshine(Model):
    """Moonshine (Useful Sensors): small encoder-decoder for on-device ASR."""

    def __init__(self, id: str, label: str, repo: str):
        self.id, self.label, self.repo = id, label, repo
        self.patterns = ["*.json", "*.txt", "model.safetensors"]

    def load(self) -> None:
        from transformers import AutoProcessor, MoonshineForConditionalGeneration
        self.download()
        self.processor = AutoProcessor.from_pretrained(self.path)
        self.model = MoonshineForConditionalGeneration.from_pretrained(self.path).to("cuda").eval()

    def transcribe(self, audio: np.ndarray) -> str:
        import torch
        inputs = self.processor(audio, return_tensors="pt", sampling_rate=SAMPLE_RATE).to("cuda")
        max_length = int(inputs.attention_mask.sum(-1).max().item() * 6.5 / SAMPLE_RATE)   # model card: 6.5 tokens/s cap
        with torch.inference_mode():
            ids = self.model.generate(**inputs, max_length=max_length)
        return self.processor.decode(ids[0], skip_special_tokens=True)

    @property
    def detail(self) -> str:
        return (f"{self.repo} @ {self.revision} (fp32, transformers {md.version('transformers')}); greedy decoding, "
                "max 6.5 tokens per second of audio (the model card's hallucination-loop guard)")


# Order = order of the face-off table. The first Whisper is the primary model.
MODELS: list[Model] = [
    Whisper("whisper-large-v3", "Whisper large-v3", "Systran/faster-whisper-large-v3"),
    Whisper("whisper-small", "Whisper small", "Systran/faster-whisper-small"),
    Parakeet("parakeet-tdt-0.6b-v3", "NVIDIA Parakeet TDT 0.6B v3", "nvidia/parakeet-tdt-0.6b-v3"),
    Wav2Vec2CTC("wav2vec2-large-960h", "wav2vec 2.0 large (CTC)", "facebook/wav2vec2-large-960h-lv60-self"),
    Moonshine("moonshine-base", "Moonshine base", "moonshine-ai/moonshine-base"),
]
PRIMARY = "whisper-large-v3"


def selected_models() -> list[Model]:
    """MODELS, or the subset named in env MISHEARD_MODELS="id,id" (kept in MODELS order).

    transcribe runs only the selected models; assemble scores and reports only the selected ones, so a run can be
    finished with the models that are done and redone with the rest later.
    """
    only = [m for m in os.environ.get("MISHEARD_MODELS", "").split(",") if m]
    if unknown := set(only) - {m.id for m in MODELS}:
        raise SystemExit(f"unknown model(s) {sorted(unknown)}; choose from {[m.id for m in MODELS]}")
    return [m for m in MODELS if not only or m.id in only]


def download_all() -> None:
    for m in MODELS:
        m.download()
        print(f"{m.id}: {m.path}", flush=True)
    fetch("facebook/wav2vec2-base", ["*.json", "pytorch_model.bin"])


if __name__ == "__main__":
    download_all()
