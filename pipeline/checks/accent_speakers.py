"""How many distinct people stand behind each accent group? (speaker = AMI participant id, stable across meetings)"""
import collections, json, sys
from misheard.ami import load_meetings
from misheard.common import STAGING

sys.stdout.reconfigure(encoding="utf-8")
clips = json.loads((STAGING / "clips_base.json").read_text(encoding="utf-8"))
meetings = load_meetings()


def people(cs):
    """participant -> (language, words contributed) over the given clips; words counted per raw AMI word."""
    out = collections.defaultdict(lambda: [None, 0])
    for c in cs:
        m = meetings[c["meeting"]]
        for w in c["words"]:
            s = m.speaker(w["speaker"])
            out[s.pid][0] = s.language
            out[s.pid][1] += 1
    return out


groups = {
    "all clips": clips,
    "headset, no overlap (accent contrast basis)": [c for c in clips if c["mic"] == "headset-mix" and not c["tags"]["overlap"]],
}
for name, cs in groups.items():
    print(f"\n== {name}: {len(cs)} clips")
    for acc in ("native", "non-native"):
        sub = [c for c in cs if c["tags"]["accent"] == acc]
        p = people(sub)
        langs = collections.Counter(l for l, _ in p.values())
        # speakers who actually carry the clips: those with a language that matches the clip's accent label
        print(f"  {acc}: {len(sub)} clips, {len(p)} distinct participants speak in them")
        by_lang_people = collections.defaultdict(list)
        for pid, (lang, n) in p.items():
            by_lang_people[lang].append(n)
        for lang, ns in sorted(by_lang_people.items(), key=lambda kv: -sum(kv[1])):
            print(f"      {str(lang):14s} participants {len(ns):3d}  words {sum(ns):6d}")
