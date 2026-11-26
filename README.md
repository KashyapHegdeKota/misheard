<img src="assets/icon.svg" width="64" height="64" alt="">

# Misheard

**A map of where speech models get it wrong.**

Misheard runs five open speech-recognition models over 1,000 clips of real meeting
audio, scores every transcript against the human one, and shows the result as a single
interactive page: every dot on the map is a clip you can play and read.

The point is to show which kinds of conversational audio today's models still mishear,
and therefore which kinds of audio are worth collecting next.

## What the page shows

| Section | What it does |
| --- | --- |
| Hero | The 1,000 clips as drifting dots, colored green to red by word error rate, with the headline number |
| Hear it vs. read it | One clip plays while its transcript appears word by word, with the model's mistakes marked |
| Three findings | One chart and one playable example for each of the three strongest effects |
| The map | Filter by noise, overlap, accent, speed and model; click a dot for its waveform, audio and both transcripts |
| Hear the worst 10 | A player that steps through the ten clips the primary model got most wrong |
| Model face-off | Models by conditions, shaded by error rate |
| What data would fix this | The three kinds of audio to collect next, and why |

Every number, label and transcript on the page is read from
[`web/public/data/clips.json`](web/public/data/clips.json). Nothing about the results is
written into a component.

## Results

Word error rate by condition. Each column is an exclusive group: "noisy" means noisy
and neither overlapping nor accented, and so on.

| Model | Clean (200) | Noisy (160) | Overlapping (160) | Accented (160) | All (1,000) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whisper large-v3 | 11.2% | 21.2% | 25.2% | 13.4% | 22.2% |
| Whisper small | 13.6% | 24.0% | 26.9% | 15.4% | 25.3% |
| NVIDIA Parakeet TDT 0.6B v3 | 10.7% | 13.3% | 22.8% | 10.5% | 18.4% |
| wav2vec 2.0 large (CTC) | 25.0% | 52.4% | 39.6% | 29.6% | 43.6% |
| Moonshine base | 20.6% | 30.1% | 32.7% | 17.4% | 30.5% |

Three findings for Whisper large-v3, each measured within one recording site:

1. **Overlapping speech.** 11.2% with no overlap, rising to 39.7% when 30% or more of
   the clip has two people talking (84 and 21 clips; Edinburgh, headset mix, native
   speakers). All five models show the same ordering.
2. **Distant, noisy audio.** 29.8% below 5 dB signal-to-noise against 11.8% at 20–30 dB
   (30 and 44 clips; Edinburgh, native speakers, no overlap). Parakeet is far less
   affected: 17.2% in the same low-SNR group.
3. **Non-native English.** 12.2% for non-native speakers against 6.8% for native
   speakers (124 and 56 clips; Idiap, headset mix, no overlap).

Speaking speed showed no significant effect.

## Method

- **Dataset.** [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/) (CC BY 4.0).
  1,000 clips of 5–15 s from 73 meetings: 600 cut from the headset mix and 400 from a
  far-field table microphone, each with the corpus's human word-level transcript.
- **Models.** Whisper large-v3 and small (via faster-whisper), NVIDIA Parakeet TDT 0.6B
  v3, wav2vec 2.0 large and Moonshine base. Exact checkpoints and decoding settings are
  in `meta.models[].detail` in `clips.json`.
- **Metric.** Word error rate: substitutions, deletions and insertions over reference
  words, after Whisper's English text normalizer is applied identically to both sides.
  Aggregates are corpus-level (total errors over total reference words), not a mean of
  per-clip rates.
- **Tags.** Noise is estimated signal-to-noise ratio; overlap is the share of speech
  time with two or more speakers, from the annotations; accent is native versus
  non-native English, from AMI's speaker metadata; speed is words per minute.
- **Map.** Clips are embedded with wav2vec2 and laid out in 2D with UMAP. Position
  reflects how a clip sounds, not how badly it was transcribed.

## Caveats

- **Designed sample.** The clips are stratified so each condition has enough examples.
  The overall error rate describes this sample, not AMI as a whole.
- **Recording site is confounded with accent.** Most native-English clips come from
  Edinburgh and most non-native clips from Idiap, and Edinburgh is harder for every
  model. Pooled across sites the accent gap is about 2 points and not significant, which
  is why each finding compares groups within one site. The headline and the face-off
  table are pooled.
- **Noise is confounded with microphone distance.** Every noisy clip is far-field. About
  3 points of Whisper large-v3's far-field error disappears if the quiet audio is
  loudness-normalized first.
- **Overlap scoring.** The reference orders all speakers' words by start time. A fairer
  best-of-orderings variant changes the overlap result by at most 0.5 points.
- **Small groups.** Some comparisons rest on few clips or speakers; the accent finding
  rests on 10 native-English participants. Counts are shown next to each number.
- **Training exposure.** Whether any of these models saw AMI during training is unknown.

## Repository layout

```
pipeline/   Python pipeline: download, cut clips, transcribe, score, tag, embed, assemble
web/        Next.js site, the clips.json it reads, and the clip audio
assets/     Project icon
```

## Run the site

Needs Node 22.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in web/out
```

The site is a static export with no server code or environment variables. See
[`web/README.md`](web/README.md) for the data contract and the browser checks.

## Rerun the pipeline

Needs an NVIDIA GPU (8 GB is enough), `ffmpeg`, [uv](https://docs.astral.sh/uv/) and
about 16 GB of disk.

```bash
cd pipeline
uv sync --managed-python --python 3.12
uv run python -I -m misheard all
```

Stages are resumable and seeded. See [`pipeline/README.md`](pipeline/README.md) for
details.

## Credits

Audio and transcripts are from the AMI Meeting Corpus, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Built by Kashyap Hegde Kota.
