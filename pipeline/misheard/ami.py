"""AMI corpus metadata and manual word-level transcripts (NXT XML, annotations release 1.6.2 / 1.7)."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from functools import lru_cache

from .common import ANNOTATIONS

NS = "{http://nite.sourceforge.net/}"

# Typos in participants.xml.
_LANGUAGE_FIX = {"Chines": "Chinese", "Czeque": "Czech", "romanian": "Romanian", "Mandarin Chinese": "Chinese"}


@dataclass(frozen=True)
class Speaker:
    agent: str              # per-meeting label A..E (also the word-file suffix)
    pid: str                # participant id, stable across meetings
    language: str | None    # native language as recorded by AMI; None when AMI has no record


@dataclass(frozen=True)
class Meeting:
    id: str
    kind: str               # "scenario" | "nonscenario"
    partition: str | None   # AMI scenario partition: "train" | "dev" | "test" (unseen); None for non-scenario
    duration: float
    speakers: tuple[Speaker, ...]

    @property
    def series(self) -> str:
        return re.match(r"[A-Z]+\d+", self.id).group(0)

    def speaker(self, agent: str) -> Speaker:
        return next(s for s in self.speakers if s.agent == agent)


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    speaker: str            # agent letter
    text: str
    fragment: bool          # truncated word ("disadvant"): audible speech, but not a reference word


@dataclass
class Transcript:
    words: list[Word]                          # sorted by (start, end, speaker)
    vocal: list[tuple[float, float]]           # laughs, coughs, ... (non-word sounds)
    flagged: list[tuple[float, float]]         # gaps, transcription errors, foreign or mispronounced words


@lru_cache(maxsize=1)
def load_meetings() -> dict[str, Meeting]:
    base = ANNOTATIONS / "corpusResources"
    participants = {}
    for p in ET.parse(base / "participants.xml").getroot().findall("participant"):
        lang = (p.get("native_language") or "").strip()
        participants[p.get(NS + "id")] = _LANGUAGE_FIX.get(lang, lang) or None
    meetings = {}
    for m in ET.parse(base / "meetings.xml").getroot().findall("meeting"):
        if m.get("seen_type") == "development":
            partition = "dev"
        elif m.get("visibility") == "unseen":
            partition = "test"
        elif m.get("seen_type") == "training":
            partition = "train"
        else:
            partition = None
        speakers = tuple(
            Speaker(s.get("nxt_agent"), s.get("global_name"), participants.get(s.get("global_name")))
            for s in sorted(m.findall("speaker"), key=lambda s: s.get("nxt_agent"))
        )
        obs = m.get("observation")
        meetings[obs] = Meeting(obs, m.get("type"), partition, float(m.get("duration")), speakers)
    return meetings


def load_transcript(meeting: Meeting) -> Transcript:
    words, vocal, flagged = [], [], []
    for spk in meeting.speakers:
        root = ET.parse(ANNOTATIONS / "words" / f"{meeting.id}.{spk.agent}.words.xml").getroot()
        for el in root:
            tag = el.tag.split("}")[-1]
            start, end = el.get("starttime"), el.get("endtime")
            if start is None or end is None:
                continue
            start, end = float(start), float(end)
            if tag == "w":
                if el.get("punc") == "true":
                    continue
                words.append(Word(start, end, spk.agent, el.text or "", el.get("trunc") == "true"))
                if el.get("pron") or el.get("mispronounced"):
                    flagged.append((start, end))
            elif tag == "vocalsound":
                vocal.append((start, end))
            elif tag in ("gap", "transformerror"):
                flagged.append((start, end))
    words.sort(key=lambda w: (w.start, w.end, w.speaker))
    return Transcript(words, sorted(vocal), sorted(flagged))
