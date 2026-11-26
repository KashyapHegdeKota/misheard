"""`python -m misheard <stage>`: run one stage of the pipeline, or `all`."""
import importlib
import sys

# stage name -> module with a main()
STAGES = {
    "download": "download",       # AMI annotations + meeting audio
    "clips": "clips",             # choose windows, tag them, cut the clip audio
    "transcribe": "transcribe",   # run every model on every clip (cached per model per clip)
    "embed": "embed",             # wav2vec2 embeddings -> UMAP map
    "assemble": "assemble",       # WER, alignments, summary -> web/public/data/clips.json + mp3s
    "validate": "validate",       # check clips.json against the contract
}


def main(argv: list[str]) -> None:
    for stream in (sys.stdout, sys.stderr):          # progress lines and findings contain non-ASCII (en dashes, currency)
        stream.reconfigure(encoding="utf-8", errors="replace")
    wanted = argv[1:] or ["all"]
    stages = list(STAGES) if wanted == ["all"] else wanted
    for s in stages:
        if s not in STAGES:
            sys.exit(f"unknown stage {s!r}; choose from {', '.join(STAGES)} or all")
    for s in stages:
        print(f"\n=== {s} ===", flush=True)
        importlib.import_module(f"misheard.{STAGES[s]}").main()


if __name__ == "__main__":
    main(sys.argv)
