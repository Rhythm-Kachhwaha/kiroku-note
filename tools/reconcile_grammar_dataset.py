"""Reconcile Japanese grammar reference audits and seed sources into a master JSON dataset.

Outputs:
  - backend/app/data/master_grammar_dataset.json
  - backend/app/data/master_grammar_provenance.json
"""
from __future__ import annotations

import csv
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
AUDIT_DIR = ROOT / "grammar-audits"
OPENJLPT_DIR = ROOT / "backend" / "app" / "data" / "openjlpt_grammar"
CURATED_DB = ROOT / "backend" / "app" / "data" / "jlpt_reference.sqlite"

OUTPUT_MASTER = ROOT / "backend" / "app" / "data" / "master_grammar_dataset.json"
OUTPUT_PROVENANCE = ROOT / "backend" / "app" / "data" / "master_grammar_provenance.json"

LEVEL_RANKS = {"N5": 1, "N4": 2, "N3": 3, "N2": 4, "N1": 5}
RANK_TO_LEVEL = {1: "N5", 2: "N4", 3: "N3", 4: "N2", 5: "N1"}

AUDIT_FILES = [
    ("N5", AUDIT_DIR / "kiroku_n5_grammar_audit.md", 84),
    ("N4", AUDIT_DIR / "kiroku_n4_grammar_audit.md", 132),
    ("N3", AUDIT_DIR / "kiroku_n3_grammar_audit.md", 182),
    ("N2", AUDIT_DIR / "kiroku_n2_grammar_audit.md", 197),
    ("N1", AUDIT_DIR / "kiroku_n1_grammar_audit.md", 253),
]

SPECIAL_MATCHERS: dict[str, dict[str, Any]] = {
    "たい": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+たい"},
    "ている": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+て(?:いる|います|いた|いました)"},
    "前に": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+前に"},
    "後で": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+後で"},
    "くて": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+くて"},
    "上に": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+上に"},
    "抜く": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+抜(?:く|いた|いて|かない)"},
    "べく": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+べく"},
    "まい": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+まい"},
    "だに": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+だに"},
    "といいといい": {
        "type": "discontinuous",
        "first": "[ぁ-ゖァ-ヺ一-龯]+といい",
        "second": "[ぁ-ゖァ-ヺ一-龯]+といい",
        "max_gap": 20,
        "clause_break": "[、。！？]",
    },
    "めく": {"type": "regex", "regex": "[ぁ-ゖァ-ヺ一-龯]+め(?:く|い(?:て|た))"},

    "使役受身": {
        "type": "regex",
        "regex": "[ぁ-ゖァ-ヺ一-龯]+させられ(?:たくなかった|ない|る|た)",
    },
    "ことになる": {"type": "regex", "regex": "ことにな(?:る|った)"},
    "かもしれない": {"type": "regex", "regex": "かもしれない"},
    "ざるを得ない": {"type": "regex", "regex": "ざるを得ない"},
    "はずがない": {"type": "regex", "regex": "はずがない"},
    "たことがあります": {"type": "regex", "regex": "たことが(?:ある|あります)"},
    "ておく": {"type": "regex", "regex": "(?:[てで]おく|[ぁ-ゖァ-ヺ一-龯]+とく)"},
    "てしまう": {
        "type": "regex",
        "regex": "[ぁ-ゖァ-ヺ一-龯]+(?:てしま(?:う|っ(?:た|て|たら)?)|ちゃ(?:う|っ(?:た|て|たら)?))",
        "matched_formation": "V-て + {suffix}",
    },
    "なければならない": {
        "type": "regex",
        "regex": "[ぁ-ゖァ-ヺ一-龯]+(?:なければなら(?:ない|なかった)|なきゃ(?:だめ|ならない)?|なくてはいけ(?:ない|ません))",
    },
    "ばほど": {
        "type": "discontinuous",
        "first": "[ぁ-ゖァ-ヺ一-龯]+ば",
        "second": "[ぁ-ゖァ-ヺ一-龯]+ほど",
        "max_gap": 20,
        "clause_break": "[、。！？]",
    },
    "とかとか": {
        "type": "discontinuous",
        "first": "[ぁ-ゖァ-ヺ一-龯]+とか",
        "second": "[ぁ-ゖァ-ヺ一-龯]+(?:とか|ている|る)",
        "max_gap": 20,
        "clause_break": "[、。！？]",
    },
    "おになる": {"type": "regex", "regex": "お[ぁ-ゖァ-ヺ一-龯]{1,6}になる"},
    "そうだ(appearance)": {
        "type": "regex",
        "regex": "[ぁ-ゖァ-ヺ一-龯]+そうだ",
        "ambiguity_group": "そうだ",
        "confidence": "medium",
        "guards": {"forbidden_preceding": ["る", "た", "ない", "だ"]},
    },
    "そうだ(hearsay)": {
        "type": "regex",
        "regex": "[ぁ-ゖァ-ヺ一-龯]+そうだ",
        "ambiguity_group": "そうだ",
        "confidence": "high",
        "guards": {"required_preceding": ["る", "た", "ない", "だ"]},
    },
    "にもかかわらず": {"type": "regex", "regex": "にもかかわらず"},
    "にしては": {"type": "regex", "regex": "にしては"},
}

REFERENCE_ONLY_KEYS = {
    "か(or)", "か(question)", "ね", "よ", "の方がより",
    "ととどちらが", "の中でが一番", "てはいけない",
    "なければならない / なくてはいけない", "たりたりする", "たことがある",
    "に行く", "がある / がいる", "くなる / になる", "にする(decide)",
    "まだていない", "もうた", "あまりない", "全然ない", "何もない / 誰もない",
    "ことにする", "てあげる", "ていく", "てくる", "てくれる", "過ぎる",
    "あげる / くれる / もらう", "てくださる / ていただく", "てしまう / ちゃう",
    "てある", "らしい(hearsay/conjecture)", "ようだ", "すぎる",
    "ことができる", "える / られる(potential)",
    "れる / られる(passive)", "せられる / させられる", "おう / よう",
    "(よ)うと思う", "ようにする", "ようになる", "たがる",
    "はずだ", "か(embedded question)", "と言う", "ところだ",
    "始める / 終わる / 続ける", "出す", "ほどない", "なかなかない", "ことがある",
    "尊敬語", "謙譲語", "おする", "ても構わない", "の / こと(nominalizer)",
    "たらどう", "くする / にする(make)", "そうにする", "よう",
    "ように言う / ように頼む", "ようとする", "もばも", "まるでようだ",
    "さえば", "たらた", "ということだ", "からにかけて", "ふりをする",
    "切る / 切れない", "かける", "合う", "直す", "ほどはない", "かのようだ",
    "に至って", "を余儀なくされる", "かねる", "ことはが", "抜く",
    "てならない", "をとして", "かないかのうちに", "おそれがある", "たとえても",
    "やらやら", "ずに済む / ないで済む", "た末", "に至る / に至って / に至っては",
    "を余儀なくされる", "(よ)うがまいが / (よ)うとまいと", "(よ)うにもない",
    "つつ", "てもさしつかえない", "といったらない", "なりなり",
    "に堪える / に堪えない", "をもって", "ただのみ", "だのだの", "かれかれ",
    "くない / かった / くなかった",
    "は", "が", "を", "に", "へ", "で", "と", "の", "も", "や",
}

VOCAB_PATTERNS = {
    "どんな", "どうして", "どうやって", "いつも", "とても", "しかし", "そして",
    "それから", "だけど", "ところが", "ところで", "きっと", "急に", "まさか",
    "めったに", "ちっとも", "ちなみに", "どうせ", "いわゆる", "いきなり", "一応",
    "果して", "果たして", "いよいよ", "再び", "かつて", "一気に", "ふうに",
    "互いに", "わりに", "割に", "大して", "要するに", "滅多に",
}

FALLBACK_ROWS = [
    ("使役受身", "N4", "be made to; be forced to",
     "V-させられる", "V-させられる"),
    ("ことになる", "N4", "it is decided that; it turns out that",
     "V-る + ことになる", "ことにな(?:る|った)"),
    ("かもしれない", "N4", "might; may",
     "Plain form + かもしれない", "かもしれない"),
    ("ざるを得ない", "N2", "cannot avoid; have no choice but to",
     "V-ます stem + ざるを得ない", "ざるを得ない"),
    ("はずがない", "N3", "cannot be; there is no way",
     "Plain form + はずがない", "はずがない"),
    ("なければならない", "N4", "must; have to",
     "V-なければならない", "(?:なければなら|なきゃ)(?:ない|だめ|ならない)?"),
    ("ば〜ほど", "N3", "the more …, the more …",
     "V-ば + V-る + ほど", ""),
    ("とか〜とか", "N4", "things like … and …",
     "N/V + とか … N/V + とか", ""),
    ("お〜になる", "N4", "honorific form",
     "お + V-stem + になる", "お[ぁ-ゖァ-ヺ一-龯]{1,6}になる"),
    ("にもかかわらず", "N2", "despite; in spite of",
     "N + にもかかわらず", "にもかかわらず"),
    ("にしては", "N3", "considering; for",
     "N + にしては", "にしては"),
    ("そうだ(hearsay)", "N4", "I hear that; it is said that",
     "Plain form + そうだ", "[ぁ-ゖァ-ヺ一-龯]+そうだ"),
    ("そうだ(appearance)", "N4", "looks like; appears to",
     "V-stem / Adj-stem + そうだ", "[ぁ-ゖァ-ヺ一-龯]+そうだ"),
    ("は", "N5", "topic marker", "N + は", ""),
    ("が", "N5", "subject marker", "N + が", ""),
    ("を", "N5", "object marker", "N + を", ""),
    ("に", "N5", "time or destination marker", "N + に", ""),
    ("へ", "N5", "direction marker", "N + へ", ""),
    ("で", "N5", "place or means marker", "N + で", ""),
    ("と", "N5", "and or with marker", "N + と", ""),
    ("の", "N5", "possessive marker", "N + の", ""),
    ("も", "N5", "also marker", "N + も", ""),
]


def clean_cell(text: str) -> str:
    t = text.strip()
    t = t.replace(r"\~", "~")
    t = t.replace(r"\[", "[").replace(r"\]", "]")
    t = re.sub(r"`\\n`\{=tex\}", "", t)
    return t.strip()


def extract_label_and_url(text: str) -> tuple[str, str | None]:
    m = re.search(r"\[(.*?)\]\((.*?)(?:\s+\".*?\")?\)", text)
    if m:
        label = m.group(1).strip()
        url = m.group(2).strip()
        return label, url
    return text.strip(), None


def normalize_key(pattern: str) -> str:
    value = unicodedata.normalize("NFKC", pattern).strip()
    value = value.replace("〜", "").replace("~", "").replace("～", "")
    value = re.sub(r"[（(][^）)]*[）)]", "", value)
    value = "".join(
        chr(ord(char) - 0x60) if "\u30a1" <= char <= "\u30f6" else char
        for char in value
    )
    return value.strip()


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[-\s]+", "_", s)
    return s or "point"


def parse_audits() -> list[dict[str, Any]]:
    entries = []
    for level, path, count in AUDIT_FILES:
        content = path.read_text(encoding="utf-8")
        level_entries = []
        if "`\\n`{=tex}" in content:
            parts = content.split("`\\n`{=tex}")
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                collapsed = " ".join(part.split())
                if collapsed.startswith(r"\|"):
                    collapsed = collapsed[2:]
                elif collapsed.startswith("|"):
                    collapsed = collapsed[1:]
                else:
                    continue
                if collapsed.endswith(r"\|"):
                    collapsed = collapsed[:-2]
                elif collapsed.endswith("|"):
                    collapsed = collapsed[:-1]
                cells = [clean_cell(c) for c in re.split(r"(?:\\\||\|)", collapsed)]
                if len(cells) < 4:
                    continue
                ref_num_str = cells[0].replace("\\", "").strip()
                if not ref_num_str.isdigit():
                    continue
                ref_num = int(ref_num_str)
                romanized, url1 = extract_label_and_url(cells[1])
                japanese, url2 = extract_label_and_url(cells[2])
                meaning = cells[3]
                url = url1 or url2
                level_entries.append({
                    "source": f"JLPT Sensei {level}",
                    "source_level": level,
                    "ref_num": ref_num,
                    "romanized": romanized,
                    "japanese": japanese,
                    "meaning": meaning,
                    "url": url,
                })
        else:
            for line in content.splitlines():
                line = line.strip()
                if not line.startswith("|"):
                    continue
                line_content = line.strip("|")
                cells = [clean_cell(c) for c in re.split(r"(?<!\\)\|", line_content)]
                if len(cells) < 4:
                    continue
                ref_num_str = cells[0].strip()
                if not ref_num_str.isdigit():
                    continue
                ref_num = int(ref_num_str)
                romanized, url1 = extract_label_and_url(cells[1])
                japanese, url2 = extract_label_and_url(cells[2])
                if level == "N3":
                    romanized, japanese = japanese, romanized
                meaning = cells[3]
                url = url1 or url2
                level_entries.append({
                    "source": f"JLPT Sensei {level}",
                    "source_level": level,
                    "ref_num": ref_num,
                    "romanized": romanized,
                    "japanese": japanese,
                    "meaning": meaning,
                    "url": url,
                })
        assert len(level_entries) == count, f"Failed reading {level}: {len(level_entries)} != {count}"
        entries.extend(level_entries)
    return entries


def determine_matcher(key: str, pattern: str, variants: list[str]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if key in SPECIAL_MATCHERS:
        spec = dict(SPECIAL_MATCHERS[key])
        guards = spec.pop("guards", None)
        return spec, guards
    if key in REFERENCE_ONLY_KEYS:
        return {"type": "pattern", "variants": variants, "match_mode": "reference_only"}, None
    if any(k in REFERENCE_ONLY_KEYS for k in variants):
        return {"type": "pattern", "variants": variants, "match_mode": "reference_only"}, None
    if key in VOCAB_PATTERNS or any(v in VOCAB_PATTERNS for v in variants):
        return {"type": "pattern", "variants": variants, "match_mode": "reference_only"}, None
    if all((len(v) <= 2 and v != "ずに") or v in {"は", "が", "を", "に", "へ", "で", "と", "の", "も"} for v in variants):
        return {"type": "pattern", "variants": variants, "match_mode": "reference_only"}, None
    return {"type": "pattern", "variants": variants, "match_mode": "auto"}, None


def reconcile_dataset() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    audits = parse_audits()

    # Load OpenJLPT rows
    openjlpt_list = []
    for csv_path in sorted(OPENJLPT_DIR.glob("grammar-n*.csv")):
        with csv_path.open(encoding="utf-8-sig", newline="") as csv_file:
            for item in csv.DictReader(csv_file):
                pat = (item.get("pattern") or "").strip()
                lvl = (item.get("level") or "").strip().upper()
                if not pat or lvl not in LEVEL_RANKS:
                    continue
                openjlpt_list.append({
                    "source": "OpenJLPT",
                    "source_level": lvl,
                    "pattern": pat,
                    "norm_key": normalize_key(pat),
                    "meaning": (item.get("meaning") or "").strip(),
                    "formation": (item.get("formation") or "").strip() or None,
                    "example_ja": (item.get("example_ja") or "").strip(),
                    "example_en": (item.get("example_en") or "").strip(),
                })

    # Load Curated rows
    curated_list = []
    conn = sqlite3.connect(CURATED_DB)
    for r in conn.execute("SELECT id, pattern, level, meaning, formation, examples FROM grammar ORDER BY id").fetchall():
        curated_list.append({
            "source": "JLPT Reference Curated",
            "curated_id": r[0],
            "pattern": r[1],
            "norm_key": normalize_key(r[1]),
            "source_level": r[2],
            "meaning": r[3],
            "formation": r[4],
            "examples": json.loads(r[5]) if r[5] else [],
        })
    conn.close()

    concepts: list[dict[str, Any]] = []

    # Pre-populate special colliding concepts to prevent shadowing
    souda_app: dict[str, Any] = {
        "slug": "souda_appearance",
        "pattern_display": "そうだ (appearance)",
        "pattern_key": "そうだ(appearance)",
        "meaning_short": "looks like; appears to",
        "formation": "V-stem / Adj-stem + そうだ",
        "variants": ["そうだ", "そうに", "そうな"],
        "examples": [{"ja": "雨が降りそうだ。", "en": "It looks like it will rain."}],
        "group_id": "そうだ",
        "source_evidence": [],
    }
    souda_hear: dict[str, Any] = {
        "slug": "souda_hearsay",
        "pattern_display": "そうだ (hearsay)",
        "pattern_key": "そうだ(hearsay)",
        "meaning_short": "I hear that; it is said that",
        "formation": "Plain form + そうだ",
        "variants": ["そうだ", "そうです"],
        "examples": [{"ja": "明日は雨が降るそうだ。", "en": "I hear it will rain tomorrow."}],
        "group_id": "そうだ",
        "source_evidence": [],
    }
    rashii_conj: dict[str, Any] = {
        "slug": "rashii_conjecture",
        "pattern_display": "らしい (conjecture)",
        "pattern_key": "らしい",
        "meaning_short": "seems like; I heard; typical of",
        "formation": "Plain form + らしい",
        "variants": ["らしい"],
        "examples": [{"ja": "彼は来ないらしい。", "en": "It seems he won't come."}],
        "group_id": "らしい",
        "source_evidence": [
            {
                "source": "OpenJLPT grammar list",
                "source_level": "N4",
                "source_pattern": "〜らしい",
                "meaning": "seems like; I heard; typical of",
            }
        ],
    }
    rashii_typ: dict[str, Any] = {
        "slug": "rashii_typical",
        "pattern_display": "らしい (typical)",
        "pattern_key": "らしい",
        "meaning_short": "seems; I heard; typical (less casual than みたい)",
        "formation": "Noun + らしい",
        "variants": ["らしい", "らしく", "らしくない"],
        "examples": [{"ja": "彼らしくない。", "en": "That's not like him."}],
        "group_id": "らしい",
        "source_evidence": [
            {
                "source": "OpenJLPT grammar list",
                "source_level": "N3",
                "source_pattern": "〜らしい",
                "meaning": "seems; I heard; typical (less casual than みたい)",
            }
        ],
    }

    noni_cont: dict[str, Any] = {
        "slug": "noni_contrast",
        "pattern_display": "のに (contrast)",
        "pattern_key": "のに",
        "meaning_short": "although; in spite of; even though",
        "formation": "Plain form + のに",
        "variants": ["のに"],
        "examples": [{"ja": "一生懸命勉強したのに、試験に落ちた。", "en": "Although I studied hard, I failed the exam."}],
        "group_id": "のに",
        "source_evidence": [],
    }
    noni_purp: dict[str, Any] = {
        "slug": "noni_purpose",
        "pattern_display": "のに (purpose)",
        "pattern_key": "のに",
        "meaning_short": "for the purpose of; in order to",
        "formation": "V-dictionary + のに",
        "variants": ["のに"],
        "examples": [{"ja": "この辞書は漢字を調べるのに便利だ。", "en": "This dictionary is convenient for looking up kanji."}],
        "group_id": "のに",
        "source_evidence": [],
    }
    shieki_ukemi: dict[str, Any] = {
        "slug": "shieki_ukemi",
        "pattern_display": "使役受身",
        "pattern_key": "使役受身",
        "meaning_short": "be made to; be forced to (causative-passive)",
        "formation": "V-させられる",
        "variants": ["させられる", "される", "使役受身"],
        "examples": [{"ja": "母に部屋を掃除させられた。", "en": "I was made by my mother to clean the room."}],
        "group_id": "使役受身",
        "source_evidence": [{"source": "Kiroku matcher seed", "source_level": "N4", "source_pattern": "使役受身"}],
    }

    nakereba_naranai: dict[str, Any] = {
        "slug": "nakereba_naranai",
        "pattern_display": "なければならない",
        "pattern_key": "なければならない",
        "meaning_short": "must; have to; need to do",
        "formation": "V-なければならない",
        "variants": ["なければならない", "なくてはいけない", "なきゃ", "なくてはならない", "なきゃならない", "なきゃだめ"],
        "examples": [{"ja": "行かなければならない。", "en": "I must go."}],
        "group_id": "なければならない",
        "source_evidence": [{"source": "Kiroku matcher seed", "source_level": "N4", "source_pattern": "なければならない"}],
    }

    concepts.extend([souda_app, souda_hear, rashii_conj, rashii_typ, noni_cont, noni_purp, shieki_ukemi, nakereba_naranai])

    # Ingest OpenJLPT rows
    for oj in openjlpt_list:
        k = oj["norm_key"]
        if k in {"くて / で", "くて"}:
            k = "くて"
        elif k in {"上 / 上に", "上に"}:
            k = "上に"
        target = None
        if k == "そうだ":
            target = souda_hear if "hear" in oj["meaning"].lower() else souda_app
        elif k == "らしい":
            target = rashii_conj if oj["source_level"] in {"N4", "N3"} and "hear" in oj["meaning"].lower() else rashii_typ
        elif k == "のに":
            target = noni_cont if "although" in oj["meaning"].lower() or "even" in oj["meaning"].lower() else noni_purp
        elif k in {"なければならない", "なければならない / なくてはいけない"}:
            target = nakereba_naranai
        else:
            for c in concepts:
                if c["pattern_key"] == k:
                    target = c
                    break
        if target:
            target["source_evidence"].append({
                "source": "OpenJLPT",
                "source_level": oj["source_level"],
                "source_pattern": oj["pattern"],
            })
            if oj["example_ja"] and not target.get("examples"):
                target["examples"] = [{"ja": oj["example_ja"], "en": oj["example_en"]}]
            if oj["formation"] and not target.get("formation"):
                target["formation"] = oj["formation"]
        else:
            variants = [
                re.sub(r"[（(][^）)]*[）)]", "", part.strip()).replace("〜", "").replace("～", "").replace("~", "")
                for part in oj["pattern"].split("/")
            ]
            slug = slugify(re.sub(r"[（(][^）)]*[）)]", "", oj["pattern"]))
            new_c = {
                "slug": slug,
                "pattern_display": oj["pattern"],
                "pattern_key": k,
                "meaning_short": oj["meaning"],
                "formation": oj["formation"],
                "variants": [v for v in variants if v],
                "examples": [{"ja": oj["example_ja"], "en": oj["example_en"]}] if oj["example_ja"] else [],
                "group_id": None,
                "source_evidence": [{
                    "source": "OpenJLPT",
                    "source_level": oj["source_level"],
                    "source_pattern": oj["pattern"],
                }],
            }
            concepts.append(new_c)

    # Ingest Curated rows
    for cur in curated_list:
        k = cur["norm_key"]
        target = None
        for c in concepts:
            if c["pattern_key"] == k:
                target = c
                break
        if target:
            target["source_evidence"].append({
                "source": "JLPT Reference Curated",
                "source_level": cur["source_level"],
                "source_pattern": cur["pattern"],
                "curated_id": cur["curated_id"],
            })
            if cur["examples"] and not target.get("examples"):
                target["examples"] = cur["examples"]
            if cur["formation"] and not target.get("formation"):
                target["formation"] = cur["formation"]
        else:
            variants = [
                re.sub(r"[（(][^）)]*[）)]", "", part.strip()).replace("〜", "").replace("～", "").replace("~", "")
                for part in cur["pattern"].split("/")
            ]
            slug = slugify(re.sub(r"[（(][^）)]*[）)]", "", cur["pattern"]))
            new_c = {
                "slug": slug,
                "pattern_display": cur["pattern"],
                "pattern_key": k,
                "meaning_short": cur["meaning"],
                "formation": cur["formation"],
                "variants": [v for v in variants if v],
                "examples": cur["examples"] or [],
                "group_id": None,
                "source_evidence": [{
                    "source": "JLPT Reference Curated",
                    "source_level": cur["source_level"],
                    "source_pattern": cur["pattern"],
                    "curated_id": cur["curated_id"],
                }],
            }
            concepts.append(new_c)

    # Attach FALLBACK_ROWS to corresponding concepts
    for pat, lvl, meaning, formation, _ in FALLBACK_ROWS:
        k = normalize_key(pat)
        target = None
        if pat.startswith("そうだ"):
            target = souda_hear if "hearsay" in pat else souda_app
        elif pat == "使役受身":
            target = shieki_ukemi
        else:
            for c in concepts:
                if c["pattern_key"] == k:
                    target = c
                    break
        if target:
            if not any(s.get("source") == "Kiroku matcher seed" for s in target["source_evidence"]):
                target["source_evidence"].append({
                    "source": "Kiroku matcher seed",
                    "source_level": lvl,
                    "source_pattern": pat,
                })

    # Ingest Reference Audits (848 entries)
    provenance_entries = []

    for a in audits:
        lvl = a["source_level"]
        num = a["ref_num"]
        rom = a["romanized"]
        jp = a["japanese"]
        mean = a["meaning"]
        url = a["url"]

        clean_jp = re.sub(r"[（(][^）)]*[）)]", "", jp).strip()
        k = normalize_key(clean_jp)

        target = None
        status = "EQUIVALENT"
        notes = ""

        if k in {"くて / で", "くて"}:
            k = "くて"
        elif k in {"上 / 上に", "上に"}:
            k = "上に"
        if k == "そうだ":
            if "appear" in mean.lower() or "look" in mean.lower() or "seem" in mean.lower():
                target = souda_app
            else:
                target = souda_hear
        elif k == "らしい":
            if lvl == "N4" or "seem" in mean.lower() or "hear" in mean.lower():
                target = rashii_conj
            else:
                target = rashii_typ
        elif k == "のに":
            if "purpose" in mean.lower() or "order to" in mean.lower():
                target = noni_purp
            else:
                target = noni_cont
        elif k in {"させられる", "される", "使役受身"}:
            target = shieki_ukemi
        elif k in {"なければならない", "なくてはいけない", "なくてはならない", "なきゃ", "なくちゃ"}:
            target = nakereba_naranai
        elif k in {"ばほど", "ば〜ほど"}:
            for c in concepts:
                if c["pattern_key"] in {"ばほど", "ば〜ほど"}:
                    target = c
                    break
        elif k in {"とかとか", "とか〜とか"}:
            for c in concepts:
                if c["pattern_key"] in {"とかとか", "とか〜とか"}:
                    target = c
                    break
        elif k in {"おになる", "お〜になる"}:
            for c in concepts:
                if c["pattern_key"] in {"おになる", "お〜になる"}:
                    target = c
                    break

        if not target:
            for c in concepts:
                if c["pattern_key"] == k:
                    target = c
                    break

        if not target:
            parts = [normalize_key(p) for p in re.split(r"[/・～〜]", clean_jp) if p.strip()]
            for p in parts:
                for c in concepts:
                    if c["pattern_key"] == p or p in c["variants"]:
                        target = c
                        break
                if target:
                    break

        evidence_item = {
            "source": f"JLPT Sensei {lvl}",
            "source_level": lvl,
            "source_pattern": jp,
            "ref_num": num,
        }

        if target:
            target["source_evidence"].append(evidence_item)
            for v in re.split(r"[/・]", clean_jp):
                v_clean = v.strip().replace("〜", "").replace("～", "").replace("~", "")
                if v_clean and v_clean not in target["variants"]:
                    target["variants"].append(v_clean)
        else:
            is_vocab = (
                k in VOCAB_PATTERNS
                or any(vp in mean.lower() for vp in ["adverb", "conjunction", "particle"])
                or any(clean_jp.startswith(vp) for vp in VOCAB_PATTERNS)
            )
            status = "VOCAB_REFERENCE" if is_vocab else "NEW_CONCEPT"
            notes = "Reference entry added as canonical concept" if not is_vocab else "Classified as vocabulary / conversational reference point"

            variants = [
                v.strip().replace("〜", "").replace("～", "").replace("~", "")
                for v in re.split(r"[/・]", clean_jp)
                if v.strip()
            ]
            slug = slugify(rom.split("/")[0]) if rom else slugify(clean_jp)
            target = {
                "slug": slug,
                "pattern_display": clean_jp,
                "pattern_key": k,
                "meaning_short": mean,
                "formation": None,
                "variants": variants or [clean_jp],
                "examples": [],
                "group_id": None,
                "source_evidence": [evidence_item],
            }
            concepts.append(target)

        provenance_entries.append({
            "source_level": lvl,
            "ref_num": num,
            "romanized": rom,
            "japanese": jp,
            "meaning": mean,
            "url": url,
            "target_concept": target,
            "status": status,
            "notes": notes,
        })

    # Second pass: Compute canonical level using easiest-supported-level rule and assign IDs
    used_ids = set()
    final_concepts: list[dict[str, Any]] = []

    for c in concepts:
        source_ranks = [LEVEL_RANKS[s["source_level"]] for s in c["source_evidence"] if s.get("source_level") in LEVEL_RANKS]
        if source_ranks:
            can_rank = min(source_ranks)
            can_level = RANK_TO_LEVEL[can_rank]
        else:
            can_level = "N5"
        c["canonical_level"] = can_level

        base_id = f"c_{can_level.lower()}_{c['slug']}"
        cid = base_id
        counter = 2
        while cid in used_ids:
            cid = f"{base_id}_{counter}"
            counter += 1
        used_ids.add(cid)
        c["concept_id"] = cid

        matcher, guards = determine_matcher(c["pattern_key"], c["pattern_display"], c["variants"])
        c["matcher"] = matcher
        c["guards"] = guards

        breakdown_parts = [f"Pattern: {c['pattern_display']}. Meaning: {c['meaning_short']}."]
        if c.get("formation"):
            breakdown_parts.append(f"Formation: {c['formation']}.")
        c["english_breakdown"] = " ".join(breakdown_parts)

        c.pop("slug", None)
        final_concepts.append(c)

    # Finalize provenance records
    final_prov_records = []
    status_counts: dict[str, int] = {}
    for pe in provenance_entries:
        target = pe.pop("target_concept")
        pe["concept_id"] = target["concept_id"]
        # Refine status if EQUIVALENT vs LEVEL_RECONCILED
        if pe["status"] in ("EQUIVALENT", "LEVEL_RECONCILED"):
            if pe["source_level"] == target["canonical_level"]:
                pe["status"] = "EQUIVALENT"
            else:
                pe["status"] = "LEVEL_RECONCILED"
                pe["notes"] = f"Reconciled from {pe['source_level']} to {target['canonical_level']} by easiest-level rule"

        status_counts[pe["status"]] = status_counts.get(pe["status"], 0) + 1
        final_prov_records.append(pe)

    provenance_doc = {
        "summary": {
            "total_reference_entries": len(final_prov_records),
            "total_canonical_concepts": len(final_concepts),
            "counts_by_status": status_counts,
            "counts_by_level": {lvl: sum(1 for p in final_prov_records if p["source_level"] == lvl) for lvl in LEVEL_RANKS},
        },
        "reference_entries": final_prov_records,
    }

    return final_concepts, provenance_doc


def main():
    print("Reconciling grammar dataset across all JLPT levels...")
    concepts, provenance = reconcile_dataset()

    OUTPUT_MASTER.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MASTER.write_text(json.dumps(concepts, ensure_ascii=False, indent=2), encoding="utf-8")
    OUTPUT_PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {len(concepts)} canonical concepts to {OUTPUT_MASTER}")
    print(f"Wrote {len(provenance['reference_entries'])} provenance records to {OUTPUT_PROVENANCE}")
    print(f"Summary: {provenance['summary']}")


if __name__ == "__main__":
    main()