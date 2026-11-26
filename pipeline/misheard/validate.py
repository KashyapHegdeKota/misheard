"""Stage 6: check the delivered clips.json (and the mp3s next to it) against the output contract.

Everything here is recomputed from the file itself; word-error counts are cross-checked with jiwer, an
implementation independent of misheard.scoring. Exits non-zero (and prints every problem) if anything fails.
"""
from __future__ import annotations

import datetime
import json
import math
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import jiwer

from .common import WEB_AUDIO, WEB_DATA

CONDITIONS = ("clean", "noisy", "overlapping", "accented")
OPS = ("equal", "sub", "del", "ins")
MP3_BITRATE_KBPS = (40, 56)          # nominal 48 kbps
DURATION_TOLERANCE_S = 0.15          # mp3 encoder delay / padding

problems: list[str] = []


def check(ok: bool, message: str) -> bool:
    if not ok:
        problems.append(message)
    return ok


def is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def is_str(x) -> bool:
    return isinstance(x, str) and x != ""


def noise_bucket(snr_db: float) -> str:
    return "high" if snr_db < 10 else "mid" if snr_db < 20 else "low"


def jiwer_errors(ref: list[str], hyp: list[str]) -> int:
    o = jiwer.process_words(" ".join(ref), " ".join(hyp) if hyp else "")
    return o.substitutions + o.deletions + o.insertions


def check_ops(cid: str, model: str, ref: list[str], r: dict) -> int:
    """Validate one result; returns its error count."""
    where = f"{cid}/{model}"
    hyp = r["hyp"].split()
    ops = r["ops"]
    bad = False
    for o in ops:
        kind, rw, hw = o.get("op"), o.get("ref"), o.get("hyp")
        bad |= not check(set(o) == {"op", "ref", "hyp"} and kind in OPS, f"{where}: malformed op {o}")
        if kind == "equal":
            bad |= not check(rw is not None and rw == hw, f"{where}: equal op with different words {o}")
        elif kind == "sub":
            bad |= not check(rw is not None and hw is not None and rw != hw, f"{where}: bad sub {o}")
        elif kind == "del":
            bad |= not check(rw is not None and hw is None, f"{where}: bad del {o}")
        elif kind == "ins":
            bad |= not check(rw is None and hw is not None, f"{where}: bad ins {o}")
    if bad:
        return -1
    check([o["ref"] for o in ops if o["ref"] is not None] == ref, f"{where}: ref-bearing ops do not reproduce ref")
    check([o["hyp"] for o in ops if o["hyp"] is not None] == hyp, f"{where}: hyp-bearing ops do not reproduce hyp")
    errors = sum(o["op"] != "equal" for o in ops)
    check(is_num(r["wer"]) and r["wer"] == round(errors / len(ref), 3), f"{where}: wer {r['wer']} != {errors}/{len(ref)}")
    independent = jiwer_errors(ref, hyp)
    check(errors == independent, f"{where}: {errors} errors but jiwer counts {independent}")
    check(all(any(ch.isalnum() for ch in t) for t in hyp), f"{where}: hypothesis has a token without letters or digits")
    return errors


def group_wer(clips: list[dict], model: str, errors: dict) -> tuple[float | None, int]:
    if not clips:
        return None, 0
    e = sum(errors[(c["id"], model)] for c in clips)
    n = sum(len(c["ref"].split()) for c in clips)
    return round(e / n, 3), len(clips)


def probe(clip: dict) -> tuple[str, dict | str]:
    path = WEB_AUDIO / f"{clip['id']}.mp3"
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=codec_name,sample_rate,channels,bit_rate:format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True)
    if p.returncode:
        return clip["id"], p.stderr.strip() or "ffprobe failed"
    j = json.loads(p.stdout)
    # decode the whole file: it must decode without errors and carry signal (the mp3s are gain-normalised, so a
    # peak far below 0 dBFS would mean silence)
    d = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True)
    peak = re.search(r"max_volume: (-?[\d.]+) dB", d.stderr)
    if d.returncode or not peak or "rror" in d.stderr:
        return clip["id"], f"decode failed: {d.stderr.strip()[-200:]}"
    return clip["id"], {**j["streams"][0], "duration": float(j["format"]["duration"]), "max_volume": float(peak.group(1))}


def main() -> None:
    path = WEB_DATA / "clips.json"
    def reject(constant: str):                      # Python writes NaN / Infinity; JSON.parse in the browser throws on them
        raise SystemExit(f"{path.name} contains the non-JSON literal {constant}")

    data = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject)
    check(set(data) >= {"meta", "clips", "summary"}, "top-level keys meta/clips/summary missing")
    meta, clips, summary = data["meta"], data["clips"], data["summary"]

    # ---- meta
    for k in ("dataset", "primary_model", "metric", "generated_at"):
        check(is_str(meta.get(k)), f"meta.{k} missing")
    check("CC BY 4.0" in meta["dataset"], "meta.dataset does not state the license")
    models = meta["models"]
    ids = [m["id"] for m in models]
    check(len(ids) >= 2 and len(set(ids)) == len(ids), "need >= 2 distinct models")
    check(all(set(m) >= {"id", "label", "detail"} and all(is_str(m[k]) for k in ("id", "label", "detail")) for m in models),
          "every model needs id, label, detail")
    check(all(re.search(r"@ [0-9a-f]{7}\b", m["detail"]) and re.search(r"greedy|beam", m["detail"]) for m in models),
          "every model detail must state the checkpoint revision and the decoding (greedy / beam) settings")
    check(meta["primary_model"] in ids and meta["primary_model"].startswith("whisper"), "primary_model must be a whisper model id")
    check(sum(m["id"].startswith("whisper") for m in models) >= 1 and any(not m["id"].startswith("whisper") for m in models),
          "need a Whisper model and at least one other family")
    check(meta["n_clips"] == len(clips), f"meta.n_clips {meta['n_clips']} != {len(clips)}")
    try:
        datetime.date.fromisoformat(meta["generated_at"][:10])
    except ValueError:
        check(False, "meta.generated_at is not an ISO date")
    for word in ("normaliz", "corpus", "overlap"):
        check(word in meta["metric"].lower(), f"meta.metric should mention '{word}'")
    primary = meta["primary_model"]

    # ---- clips
    check(len({c["id"] for c in clips}) == len(clips), "clip ids are not unique")
    errors: dict[tuple[str, str], int] = {}
    wpm_by_speed: dict[str, list[float]] = {"slow": [], "normal": [], "fast": []}
    for c in clips:
        cid = c["id"]
        need = {"id", "x", "y", "audio", "duration", "meeting", "mic", "tags", "conditions", "ref", "words", "results"}
        if not check(set(c) >= need, f"{cid}: missing {need - set(c)}"):
            continue
        check(is_num(c["x"]) and -1 <= c["x"] <= 1 and is_num(c["y"]) and -1 <= c["y"] <= 1, f"{cid}: x/y outside [-1, 1]")
        check(c["audio"] == f"audio/{cid}.mp3", f"{cid}: audio path {c['audio']}")
        check(is_num(c["duration"]) and 5 <= c["duration"] <= 15, f"{cid}: duration {c['duration']}")
        check(c["mic"] in ("headset-mix", "far-field"), f"{cid}: mic {c['mic']}")
        check(cid.startswith(c["meeting"] + "_"), f"{cid}: id does not start with its meeting")
        t = c["tags"]
        need_t = {"snr_db", "noise", "overlap_ratio", "overlap", "wpm", "speed", "n_speakers", "accent", "native_languages"}
        if check(set(t) >= need_t, f"{cid}: tags missing {need_t - set(t)}"):
            check(is_num(t["snr_db"]), f"{cid}: snr_db")
            # snr_db is stored rounded to 0.1 dB, the bucket was assigned from the unrounded value
            buckets = {noise_bucket(t["snr_db"] - 0.05), noise_bucket(t["snr_db"] + 0.05)}
            check(t["noise"] in buckets, f"{cid}: noise bucket {t['noise']} vs snr_db {t['snr_db']}")
            check(is_num(t["overlap_ratio"]) and 0 <= t["overlap_ratio"] <= 1, f"{cid}: overlap_ratio")
            check(isinstance(t["overlap"], bool) and t["overlap"] == (t["overlap_ratio"] >= 0.10), f"{cid}: overlap flag vs ratio {t['overlap_ratio']}")
            check(is_num(t["wpm"]) and t["wpm"] > 0 and t["speed"] in wpm_by_speed, f"{cid}: wpm/speed")
            if t["speed"] in wpm_by_speed:
                wpm_by_speed[t["speed"]].append(t["wpm"])
            check(isinstance(t["n_speakers"], int) and t["n_speakers"] >= 1, f"{cid}: n_speakers")
            check(t["accent"] in ("native", "non-native"), f"{cid}: accent")
            check(isinstance(t["native_languages"], list) and t["native_languages"] and all(is_str(x) for x in t["native_languages"]),
                  f"{cid}: native_languages")
            # n_speakers counts everyone with a word in the window, including speakers whose only words (fillers,
            # fragments) are dropped by the normalizer, so words[] can show fewer speakers but never more
            check(t["n_speakers"] >= len({w["speaker"] for w in c["words"]}), f"{cid}: n_speakers {t['n_speakers']} vs speakers in words")
            expect = [k for k, on in (("noisy", t["noise"] == "high"), ("overlapping", t["overlap"]),
                                      ("accented", t["accent"] == "non-native")) if on] or ["clean"]
            check(sorted(c["conditions"]) == sorted(expect) and set(c["conditions"]) <= set(CONDITIONS),
                  f"{cid}: conditions {c['conditions']} vs tags {expect}")
        ref = c["ref"].split()
        check(len(ref) >= 8 and is_str(c["ref"]), f"{cid}: ref too short")
        words = c["words"]
        check([w["w"] for w in words] == ref, f"{cid}: words[] tokens differ from ref")
        last_start: dict[str, float] = {}       # one speaker's words are sequential; different speakers interleave freely
        for w in words:
            ok = set(w) == {"w", "start", "end", "speaker"} and is_num(w["start"]) and is_num(w["end"]) and is_str(w["speaker"])
            check(ok and 0 <= w["start"] <= w["end"] <= c["duration"] + 0.01 and w["start"] >= last_start.get(w["speaker"], 0) - 1e-9,
                  f"{cid}: bad word timing {w}")
            if ok:
                last_start[w["speaker"]] = w["start"]
        check(set(c["results"]) == set(ids), f"{cid}: results keys {sorted(c['results'])}")
        for m in ids:
            r = c["results"].get(m)
            if r is None or not check(set(r) >= {"hyp", "wer", "ops"} and isinstance(r["hyp"], str), f"{cid}/{m}: result shape"):
                continue
            errors[(cid, m)] = max(check_ops(cid, m, ref, r), 0)
    if all(wpm_by_speed.values()):
        check(max(wpm_by_speed["slow"]) < min(wpm_by_speed["normal"]) and max(wpm_by_speed["normal"]) <= min(wpm_by_speed["fast"]),
              "speed buckets overlap in wpm")

    # ---- summary
    by = summary["by_condition"]
    check(set(by) == set(ids), "summary.by_condition models != meta.models")
    pick = {"clean": lambda c: c["conditions"] == ["clean"], "noisy": lambda c: c["conditions"] == ["noisy"],
            "overlapping": lambda c: c["conditions"] == ["overlapping"], "accented": lambda c: c["conditions"] == ["accented"],
            "all": lambda c: True}
    for m in ids:
        for k, sel in pick.items():
            got = by[m][k]
            wer, n = group_wer([c for c in clips if sel(c)], m, errors)
            check(got["n"] == n and got["wer"] == wer, f"by_condition[{m}][{k}] = {got['wer']}/{got['n']}, recomputed {wer}/{n}")
        # independent aggregate: jiwer over the concatenated references and hypotheses
        o = jiwer.process_words([c["ref"] for c in clips], [c["results"][m]["hyp"] for c in clips])
        jw = round(o.wer, 3)
        check(by[m]["all"]["wer"] == jw, f"by_condition[{m}].all wer {by[m]['all']['wer']} but jiwer corpus WER {jw}")
    # the same table within each recording site (meeting id prefix), recomputed independently
    by_site = summary["by_condition_by_site"]
    for m in ids:
        check(sum(cells["all"]["n"] for cells in by_site[m].values()) == len(clips), f"by_condition_by_site[{m}] does not cover every clip")
        for site, cells in by_site[m].items():
            here = [c for c in clips if c["meeting"][:2] == site]
            for k, sel in pick.items():
                wer, n = group_wer([c for c in here if sel(c)], m, errors)
                check(cells[k]["n"] == n and cells[k]["wer"] == wer, f"by_condition_by_site[{m}][{site}][{k}] != recomputed {wer}/{n}")
    h = summary["headline"]
    check(h["model"] == primary and h["from_condition"] in CONDITIONS and h["to_condition"] in CONDITIONS, "headline fields")
    check(h["from_wer"] == by[h["model"]][h["from_condition"]]["wer"] and h["to_wer"] == by[h["model"]][h["to_condition"]]["wer"],
          "headline wer values differ from by_condition")
    f = summary["findings"]
    check(len(f) == 3, f"need exactly 3 findings, got {len(f)}")
    by_id = {c["id"]: c for c in clips}
    for x in f:
        check(all(is_str(x.get(k)) for k in ("key", "title", "stat")) and any(ch.isdigit() for ch in x["stat"]), f"finding {x.get('key')}: text fields")
        ch = x["chart"]
        check(is_str(ch["x_label"]) and is_str(ch["y_label"]), f"finding {x['key']}: chart labels")
        check({s["model"] for s in ch["series"]} == set(ids), f"finding {x['key']}: chart series models")
        labels = [[p["label"] for p in s["points"]] for s in ch["series"]]
        check(all(lab == labels[0] for lab in labels) and len(labels[0]) >= 2, f"finding {x['key']}: points differ between series")
        for s in ch["series"]:
            check(all(is_str(p["label"]) and is_num(p["wer"]) and p["wer"] >= 0 and isinstance(p["n"], int) and p["n"] >= 1 for p in s["points"]),
                  f"finding {x['key']}: bad point in {s['model']}")
            check(sum(p["n"] for p in s["points"]) <= len(clips), f"finding {x['key']}: more clips than exist")
        prim = next(s for s in ch["series"] if s["model"] == primary)
        quoted = [float(v) for v in re.findall(r"(\d+\.\d)%", x["stat"])]       # the stat quotes its WERs with one decimal
        values = {round(p["wer"] * 100, 1) for p in prim["points"]}
        check(len(quoted) >= 2 and set(quoted) <= values, f"finding {x['key']}: stat quotes {quoted}, the primary model's chart has {sorted(values)}")
        check(x["example_clip"] in by_id, f"finding {x['key']}: example_clip unknown")
    check(len({x["key"] for x in f}) == 3, "finding keys not distinct")
    w10 = summary["worst10"]
    expect10 = [c["id"] for c in sorted(clips, key=lambda c: (-c["results"][primary]["wer"], -len(c["ref"].split()), c["id"]))[:10]]
    check(len(w10) == 10 and w10 == expect10, "worst10 is not the 10 clips with the highest primary WER (ties: longer reference first)")
    check(all(len(by_id[i]["ref"].split()) >= 8 for i in w10 if i in by_id), "worst10 clip with < 8 ref words")
    k = by_id.get(summary["karaoke_clip"])
    if check(k is not None, "karaoke_clip unknown"):
        check(5 <= k["duration"] <= 8, f"karaoke clip duration {k['duration']}")
        check(sum(o["op"] == "sub" for o in k["results"][primary]["ops"]) >= 3, "karaoke clip: primary model makes < 3 substitutions")

    # ---- audio
    with ThreadPoolExecutor(max_workers=8) as pool:
        probed = dict(pool.map(probe, clips))
    total = 0
    for c in clips:
        info = probed[c["id"]]
        if not check(isinstance(info, dict), f"{c['id']}: mp3 unreadable: {info}"):
            continue
        total += (WEB_AUDIO / f"{c['id']}.mp3").stat().st_size
        check(info["codec_name"] == "mp3" and int(info["channels"]) == 1, f"{c['id']}: mp3 codec/channels {info}")
        check(MP3_BITRATE_KBPS[0] * 1000 <= int(info["bit_rate"]) <= MP3_BITRATE_KBPS[1] * 1000, f"{c['id']}: bit rate {info['bit_rate']}")
        check(abs(info["duration"] - c["duration"]) <= DURATION_TOLERANCE_S, f"{c['id']}: mp3 {info['duration']:.2f}s vs duration {c['duration']}")
        check(info["max_volume"] > -20, f"{c['id']}: mp3 looks silent (peak {info['max_volume']} dB)")
    extra = {p.name for p in WEB_AUDIO.glob("*.mp3")} - {f"{c['id']}.mp3" for c in clips}
    check(not extra, f"{len(extra)} mp3 files without a clip, e.g. {sorted(extra)[:3]}")

    n_checked = len(clips) * len(ids)
    if problems:
        print(f"{len(problems)} problems:")
        for p in problems[:60]:
            print("  -", p)
        sys.exit(1)
    print(f"OK: {len(clips)} clips x {len(ids)} models ({n_checked} results) satisfy the contract; "
          f"{len(clips)} mp3s, {total / 1e6:.1f} MB ({total / len(clips) / 1e3:.0f} KB/clip); "
          f"corpus WER matches jiwer for every model")
