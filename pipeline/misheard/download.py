"""Stage 1: fetch the AMI annotations and the meeting audio (resumable, verified by size)."""
from __future__ import annotations

import random
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

import requests
import soundfile as sf

from .ami import load_meetings
from .common import ANNOTATIONS, AUDIO_RAW, MICS, RAW, SEED, ensure

BASE = "https://groups.inf.ed.ac.uk/ami"
ANNOTATIONS_ZIP_URL = f"{BASE}/AMICorpusAnnotations/ami_public_manual_1.6.2.zip"
ANNOTATIONS_ZIP = RAW / "annotations_zip" / "ami_public_manual_1.6.2.zip"
EXTRACT = ("words/", "corpusResources/", "corpusdoc/")

# Which meetings. TNO scenario meetings (TS*) are excluded: AMI records no native language for their speakers,
# so an accent tag would be a guess. Of the rest:
#  * every session of the Idiap scenario series that carry most of the non-native speech (scarcest condition:
#    non-native speakers *and* overlapping talk), plus the dev/test series IS1008 and IS1009;
#  * two seeded-random sessions of every Edinburgh scenario series (mostly native English) and of IS1002/IS1005;
#  * a handful of Idiap non-scenario meetings (other native languages: Persian, Telugu, Czech, Swiss German, ...).
FULL_SERIES = ["IS1000", "IS1001", "IS1003", "IS1004", "IS1006", "IS1007", "IS1008", "IS1009"]
SAMPLED_SERIES = [f"ES20{n:02d}" for n in range(2, 17)] + ["IS1002", "IS1005"]
SINGLE_MEETINGS = ["IB4001", "IB4002", "IB4005", "IN1001", "IN1002", "IN1008", "IN1014"]
SESSIONS_PER_SAMPLED_SERIES = 2
EXCLUDED = {"ES2010d": "both recordings are 2-channel files; every other AMI file is mono"}


def selected_meetings() -> list[str]:
    by_series: dict[str, list[str]] = {}
    for mid, m in load_meetings().items():
        by_series.setdefault(m.series, []).append(mid)
    chosen: list[str] = []
    rng = random.Random(SEED)
    for s in FULL_SERIES:
        chosen += sorted(by_series[s])
    for s in SAMPLED_SERIES:
        sessions = sorted(by_series[s])
        picks = rng.sample(sessions, SESSIONS_PER_SAMPLED_SERIES)      # draw first so exclusions never shift later draws
        picks = [m for m in picks if m not in EXCLUDED]
        picks += [m for m in sessions if m not in picks and m not in EXCLUDED][:SESSIONS_PER_SAMPLED_SERIES - len(picks)]
        chosen += sorted(picks)
    return chosen + SINGLE_MEETINGS


def fetch_annotations() -> None:
    if (ANNOTATIONS / "corpusResources" / "meetings.xml").exists():
        return
    ensure(ANNOTATIONS_ZIP.parent, ANNOTATIONS)
    _download(requests.Session(), ANNOTATIONS_ZIP_URL, ANNOTATIONS_ZIP)
    with zipfile.ZipFile(ANNOTATIONS_ZIP) as z:
        for name in z.namelist():
            if name.startswith(EXTRACT):
                z.extract(name, ANNOTATIONS)          # ZipFile.extract strips absolute and `..` components
    print("annotations extracted")


def _download_once(session: requests.Session, url: str, dest) -> bool:
    head = session.head(url, allow_redirects=True, timeout=60)
    if head.status_code == 404:
        return False
    head.raise_for_status()
    size = int(head.headers["Content-Length"])
    if dest.exists() and dest.stat().st_size == size:
        return True
    ensure(dest.parent)
    part = dest.with_name(dest.name + ".part")
    pos = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={pos}-"} if pos else {}
    with session.get(url, headers=headers, stream=True, timeout=120) as r:
        r.raise_for_status()
        resumed = pos > 0 and r.status_code == 206
        with open(part, "ab" if resumed else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if part.stat().st_size != size:
        raise IOError(f"{url}: got {part.stat().st_size} of {size} bytes")
    part.replace(dest)
    return True


def _download(session: requests.Session, url: str, dest, tries: int = 6) -> bool:
    """Download `url` to `dest`, resuming a .part file and backing off on throttling (503) or network errors.
    Returns False only if the server says the file does not exist."""
    for attempt in range(tries):
        try:
            return _download_once(session, url, dest)
        except (requests.RequestException, IOError) as e:
            if attempt == tries - 1:
                raise
            wait = 5 * 2 ** attempt
            print(f"  retry in {wait}s after {type(e).__name__}: {url.rsplit('/', 1)[-1]}", flush=True)
            time.sleep(wait)
    return False


def _fetch_audio(job: tuple[str, str]) -> tuple[str, str, bool | str]:
    mid, mic = job
    name = f"{mid}.{MICS[mic]}.wav"
    try:
        ok = _download(requests.Session(), f"{BASE}/AMICorpusMirror/amicorpus/{mid}/audio/{name}",
                       AUDIO_RAW / mid / name)
        if ok:
            info = sf.info(AUDIO_RAW / mid / name)
            assert info.samplerate == 16000 and info.channels == 1, (name, info)
        return mid, mic, ok
    except Exception as e:
        return mid, mic, f"{type(e).__name__}: {e}"


def main() -> None:
    fetch_annotations()
    meetings = selected_meetings()
    jobs = [(mid, mic) for mid in meetings for mic in MICS]
    print(f"{len(meetings)} meetings, {len(jobs)} audio files")
    missing, failed = [], []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i, (mid, mic, result) in enumerate(pool.map(_fetch_audio, jobs), 1):
            if result is False:
                missing.append((mid, mic))
            elif result is not True:
                failed.append((mid, mic, result))
            if i % 10 == 0 or i == len(jobs):
                print(f"  {i}/{len(jobs)} files", flush=True)
    if missing:
        print("not on the mirror (those meetings are used for the headset mix only):", missing)
    if failed:
        raise SystemExit(f"{len(failed)} downloads failed (rerun to resume): {failed}")
