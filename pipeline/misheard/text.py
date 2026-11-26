"""Text normalisation, applied identically to references and hypotheses.

Base: Whisper's EnglishTextNormalizer (lower-casing, punctuation removal, contractions expanded,
number words -> digits, British -> American spelling, bracketed text and the fillers
hmm/mm/mhm/mmm/uh/um removed). On top of that, four things the generic normalizer cannot know:

  * AMI writes acronyms as `T_V_` / `D_V_D_`; models write `TV`, `T.V.` or spell them out (`T V`). All are collapsed to `tv`.
  * A few spellings of the same word that no model "got wrong": ok/'kay -> okay, alright -> all right ...
    (VARIANTS below; applied to both sides).
  * Laughter transcribed as words (`ha ha`) never appears in AMI references, where laughter is a
    separate non-word event, so it is dropped from both sides like the fillers above.
  * The interjection "oh" stays "oh" (the normalizer would print it as the digit 0, "oh yeah" -> "0 yeah"); next to
    a number word it is still read as zero ("one oh one" -> 101).

Tokens with no letter or digit are dropped too: the normalizer leaves a lone "." behind when a model ends
a cut-off sentence with "..." (Whisper does this), which would otherwise count as an inserted word.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from whisper_normalizer.english import EnglishTextNormalizer

_NORMALIZER = EnglishTextNormalizer()

# Same word, different spelling. Left side (token sequence) -> right side. Applied to ref AND hyp.
VARIANTS: dict[tuple[str, ...], tuple[str, ...]] = {
    ("ok",): ("okay",),
    ("kay",): ("okay",),
    ("alright",): ("all", "right"),
    ("e", "mail"): ("email",),
}

# AMI writes acronyms with underscores (T_V_, L_C_D_), which normalize() joins; some models spell the same acronym out
# with spaces ("L C D"). Joined here too, for the acronyms AMI's remote-control scenario uses most. Closed list on purpose:
# joining arbitrary runs of letters would also reward garbled output. No reference contains a spelled-out run of these.
SPELLED_ACRONYMS = ("tv", "tvs", "lcd", "lcds", "dvd", "dvds", "cd", "cds", "vcr", "vcrs", "led", "leds", "rsi", "pda",
                    "usb", "pc", "pcs", "uk", "cpu", "ir", "rf", "uv", "pcb", "pdf", "html", "xml")
VARIANTS.update({tuple(a): (a,) for a in SPELLED_ACRONYMS})

NONLEXICAL = frozenset({"ha", "haha", "hahaha", "hahahaha", "hah", "heh", "hehe", "hehehe"})

# Whisper's normalizer reads every bare "oh" as the digit zero ("oh yeah" -> "0 yeah"), which is right in "oh five" or
# "one oh one" but not for the interjection, and the transcripts are shown on the site. A bare "oh" is shielded from it
# (spelled "ohh" while the normalizer runs, mapped back below) unless a number word sits next to it.
_NUMBER_WORDS = ("zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|"
                 "seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|point")
_BARE_OH = re.compile(r"(?<![A-Za-z'])oh(?![A-Za-z'])", re.I)
_NUMBER_BEFORE = re.compile(rf"(?<![A-Za-z])(?:{_NUMBER_WORDS})\W*$", re.I)
_NUMBER_AFTER = re.compile(rf"\W*(?:{_NUMBER_WORDS})(?![A-Za-z])", re.I)
VARIANTS[("ohh",)] = ("oh",)

_DOTTED_INITIALISM = re.compile(r"\b(?:[A-Za-z]\.){2,}")
_MAX_PATTERN = max(len(k) for k in VARIANTS)


def _collapse_initialisms(text: str) -> str:
    return _DOTTED_INITIALISM.sub(lambda m: m.group(0).replace(".", ""), text)


def _shield_oh(text: str) -> str:
    def shield(m: re.Match) -> str:
        numeric = _NUMBER_BEFORE.search(text[:m.start()]) or _NUMBER_AFTER.match(text[m.end():])
        return m.group(0) if numeric else "ohh"
    return _BARE_OH.sub(shield, text)


def _apply_variants(tokens: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(tokens):
        for n in range(min(_MAX_PATTERN, len(tokens) - i), 0, -1):
            repl = VARIANTS.get(tuple(tokens[i:i + n]))
            if repl is not None:
                out.extend(repl)
                i += n
                break
        else:
            out.append(tokens[i])
            i += 1
    return out


def normalize(text: str) -> list[str]:
    """Raw text (reference words joined by spaces, or a model hypothesis) -> normalised tokens."""
    s = _NORMALIZER(_shield_oh(_collapse_initialisms(text.replace("_", ""))))
    return [t for t in _apply_variants(s.split()) if t not in NONLEXICAL and any(ch.isalnum() for ch in t)]


def reference_tokens(raw_words: list[str]) -> tuple[list[str], list[tuple[int, int]]]:
    """Normalise a reference given as AMI words, recovering which raw words each token came from.

    The normalizer is context sensitive ("twenty five" -> "25", "he's been" -> "he has been"), so it
    must run over the whole text. To keep per-word timings we also normalise each word on its own and
    align the two token streams. Returns (tokens, spans) with spans[k] = (first, last) raw-word index.
    """
    full = normalize(" ".join(raw_words))
    per: list[tuple[str, int]] = [(t, i) for i, w in enumerate(raw_words) for t in normalize(w)]
    solo = [t for t, _ in per]
    spans: list[tuple[int, int]] = [(0, 0)] * len(full)
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, solo, full, autojunk=False).get_opcodes():
        if tag == "equal":
            for d in range(i2 - i1):
                spans[j1 + d] = (per[i1 + d][1], per[i1 + d][1])
        elif tag in ("replace", "insert"):
            if i2 > i1:
                widx = sorted({per[i][1] for i in range(i1, i2)})
            elif per:
                widx = [per[min(max(i1 - 1, 0), len(per) - 1)][1]]
            else:
                widx = [0]
            n = j2 - j1
            for k in range(n):
                lo = k * len(widx) // n
                hi = max(lo, -(-(k + 1) * len(widx) // n) - 1)
                spans[j1 + k] = (widx[lo], widx[hi])
    return full, spans
