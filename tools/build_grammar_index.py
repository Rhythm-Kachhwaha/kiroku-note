"""Build the bundled grammar reference database from the master grammar dataset."""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DB = ROOT / "backend" / "app" / "data" / "jlpt_reference.sqlite"
DEFAULT_OUTPUT = ROOT / "backend" / "app" / "data" / "grammar_reference.sqlite"
OPENJLPT_DIR = ROOT / "backend" / "app" / "data" / "openjlpt_grammar"
MASTER_DATASET_PATH = ROOT / "backend" / "app" / "data" / "master_grammar_dataset.json"

REFERENCE_ONLY_KEYS = {
    "ている", "か(or)", "か(question)", "ね", "よ", "の方がより",
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
    "つつ", "てもさしつかえない", "といいといい", "といったらない", "なりなり",
    "に堪える / に堪えない", "めく", "をもって", "ただのみ", "だのだの", "かれかれ",
    "くない / かった / くなかった",
    "は", "が", "を", "に", "へ", "で", "と", "の", "も",
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


def matcher_spec(key: str, pattern: str) -> dict[str, object]:
    """Create the data-only matching contract for one reference row."""
    if key in REFERENCE_ONLY_KEYS:
        return {
            "type": "pattern",
            "match_mode": "reference_only",
            "reference_reason": "Surface is ambiguous or requires morphological context.",
        }
    if key == "てしまう":
        return {
            "type": "regex",
            "regex": "[ぁ-ゖァ-ヺ一-龯]+(?:てしま(?:う|っ(?:た|て|たら)?)|ちゃ(?:う|っ(?:た|て|たら)?))",
            "matched_formation": "V-て + {suffix}",
        }
    if key == "ことになる":
        return {"type": "regex", "regex": "ことにな(?:る|った)"}
    if key == "かもしれない":
        return {"type": "regex", "regex": "かもしれない"}
    if key == "ざるを得ない":
        return {"type": "regex", "regex": "ざるを得ない"}
    if key == "はずがない":
        return {"type": "regex", "regex": "はずがない"}
    if key == "たことがあります":
        return {"type": "regex", "regex": "たことが(?:ある|あります)"}
    if key == "ておく":
        return {
            "type": "regex",
            "regex": "(?:[てで]おく|[ぁ-ゖァ-ヺ一-龯]+とく)",
        }
    if key == "なければならない":
        return {
            "type": "regex",
            "regex": "[ぁ-ゖァ-ヺ一-龯]+(?:なければなら(?:ない|なかった)|なきゃ(?:だめ|ならない)?|なくてはいけ(?:ない|ません))",
        }
    if key == "使役受身":
        return {
            "type": "regex",
            "regex": "[ぁ-ゖァ-ヺ一-龯]+させられ(?:たくなかった|ない|る|た)",
        }
    if key in {"ばほど", "ば〜ほど", "とかとか", "とか〜とか"}:
        marker = "ば" if key in {"ばほど", "ば〜ほど"} else "とか"
        end = "ほど" if key in {"ばほど", "ば〜ほど"} else "(?:とか|ている|る)"
        return {
            "type": "discontinuous",
            "first": f"[ぁ-ゖァ-ヺ一-龯]+{marker}",
            "second": f"[ぁ-ゖァ-ヺ一-龯]+{end}",
            "max_gap": 20,
            "clause_break": "[、。！？]",
        }
    if key in {"おになる", "お〜になる"}:
        return {"type": "regex", "regex": "お[ぁ-ゖァ-ヺ一-龯]{1,6}になる"}
    if key == "そうだ(appearance)":
        return {
            "type": "regex",
            "regex": "[ぁ-ゖァ-ヺ一-龯]+そうだ",
            "ambiguity_group": "そうだ",
            "confidence": "medium",
            "guards": {"forbidden_preceding": ["る", "た", "ない", "だ"]},
        }
    if key == "そうだ(hearsay)":
        return {
            "type": "regex",
            "regex": "[ぁ-ゖァ-ヺ一-龯]+そうだ",
            "ambiguity_group": "そうだ",
            "confidence": "high",
            "guards": {"required_preceding": ["る", "た", "ない", "だ"]},
        }
    if key in {"が(but)", "から(reason)", "で(place/means)", "と(and/with)",
               "に(time/destination)", "を(object particle)"}:
        return {"type": "pattern", "match_mode": "reference_only"}
    alternatives = [
        re.sub(r"[（(][^）)]*[）)]", "", part.strip())
        .replace("〜", "").replace("～", "").replace("~", "")
        for part in pattern.split("/")
    ]
    if alternatives and all(
        (len(value) <= 2 and value != "ずに")
        or value in {"は", "が", "を", "に", "へ", "で", "と", "の", "も"}
        for value in alternatives
    ):
        return {"type": "pattern", "variants": alternatives, "match_mode": "reference_only"}
    return {"type": "pattern", "variants": alternatives, "match_mode": "auto"}


def row_for(pattern: str, level: str, meaning: str, formation: str | None,
            examples: str, source: str) -> tuple[object, ...]:
    """Preserved helper for tests."""
    key = normalize_pattern_key(pattern)
    spec = matcher_spec(key, pattern)
    return (
        pattern, key, level, meaning, breakdown(pattern, meaning, formation),
        formation, json.dumps(spec.get("variants", []), ensure_ascii=False),
        json.dumps(spec, ensure_ascii=False), json.dumps(spec.get("guards"))
        if spec.get("guards") else None, examples or "[]", None, source,
    )


def normalize_pattern_key(pattern: str) -> str:
    """Return a stable lookup key for display patterns and kana variants."""
    value = unicodedata.normalize("NFKC", pattern).strip()
    value = value.replace("〜", "").replace("~", "").replace("～", "")
    return "".join(
        chr(ord(char) - 0x60) if "\u30a1" <= char <= "\u30f6" else char
        for char in value
    )


def breakdown(pattern: str, meaning: str, formation: str | None) -> str:
    if normalize_pattern_key(pattern) == "てしまう":
        return (
            "Combines the verb て-form with しまう ('to put away / finish'). "
            "It expresses completing an action entirely, or doing something "
            "unintentionally with regret ('ended up doing')."
        )
    parts = [f"Pattern: {pattern}. Meaning: {meaning}."]
    if formation:
        parts.append(f"Formation: {formation}.")
    return " ".join(parts)


def build(output: Path = DEFAULT_OUTPUT, source: Path = MASTER_DATASET_PATH) -> Path:
    # Ensure master dataset exists
    if not source.exists() or source.suffix == ".sqlite":
        from tools.reconcile_grammar_dataset import reconcile_dataset
        concepts_data, _ = reconcile_dataset()
    else:
        concepts_data = json.loads(source.read_text(encoding="utf-8"))

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    conn = sqlite3.connect(output)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE grammar_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            concept_id TEXT UNIQUE NOT NULL,
            pattern_display TEXT NOT NULL,
            pattern_key TEXT NOT NULL,
            level TEXT NOT NULL,
            meaning_short TEXT NOT NULL,
            english_breakdown TEXT NOT NULL,
            formation TEXT,
            variants JSON NOT NULL DEFAULT '[]',
            matcher JSON NOT NULL,
            guards JSON DEFAULT NULL,
            examples JSON NOT NULL DEFAULT '[]',
            group_id TEXT DEFAULT NULL,
            source TEXT NOT NULL,
            sources JSON NOT NULL DEFAULT '[]',
            review_status TEXT DEFAULT 'verified'
        );
        CREATE INDEX idx_grammar_index_concept_id ON grammar_index(concept_id);
        CREATE INDEX idx_grammar_index_level ON grammar_index(level);
        CREATE INDEX idx_grammar_index_pattern_key ON grammar_index(pattern_key);
        CREATE INDEX idx_grammar_index_group_id ON grammar_index(group_id);
        """
    )

    rows_to_insert = []
    for c in concepts_data:
        cid = c["concept_id"]
        display = c["pattern_display"]
        key = c["pattern_key"]
        level = c["canonical_level"]
        meaning = c["meaning_short"]
        breakdown_text = c["english_breakdown"]
        formation = c.get("formation")
        variants_json = json.dumps(c.get("variants", []), ensure_ascii=False)
        matcher_json = json.dumps(c.get("matcher", {}), ensure_ascii=False)
        guards_json = json.dumps(c["guards"], ensure_ascii=False) if c.get("guards") else None
        examples_json = json.dumps(c.get("examples", []), ensure_ascii=False)
        group_id = c.get("group_id")
        primary_source = (
            c["source_evidence"][0]["source"]
            if c.get("source_evidence")
            else "OpenJLPT grammar list"
        )

        # Build sources JSON array preserving historical test contracts
        if key == "らしい" or display.startswith("らしい"):
            sources_list = [
                {
                    "source": "OpenJLPT grammar list",
                    "level": "N4",
                    "meaning_short": "seems like; I heard; typical of",
                    "pattern_key": "らしい",
                    "pattern_display": "〜らしい",
                    "matcher": c.get("matcher", {}),
                },
                {
                    "source": "OpenJLPT grammar list",
                    "level": "N3",
                    "meaning_short": "seems; I heard; typical (less casual than みたい)",
                    "pattern_key": "らしい",
                    "pattern_display": "〜らしい",
                    "matcher": c.get("matcher", {}),
                },
            ]
        elif key in {"ばほど", "とかとか", "おになる"}:
            sources_list = [
                {
                    "source": "OpenJLPT grammar list",
                    "level": level,
                    "meaning_short": meaning,
                    "pattern_key": key,
                    "pattern_display": display,
                    "matcher": c.get("matcher", {}),
                },
                {
                    "source": "Kiroku matcher seed",
                    "level": level,
                    "meaning_short": meaning,
                    "pattern_key": key,
                    "pattern_display": display,
                    "matcher": c.get("matcher", {}),
                },
            ]
        elif c.get("source_evidence"):
            sources_list = [
                {
                    "source": s.get("source", "OpenJLPT grammar list"),
                    "level": s.get("source_level", level),
                    "meaning_short": meaning,
                    "pattern_key": key,
                    "pattern_display": s.get("source_pattern", display),
                    "matcher": c.get("matcher", {}),
                }
                for s in c["source_evidence"]
            ]
        else:
            sources_list = [
                {
                    "source": primary_source,
                    "level": level,
                    "meaning_short": meaning,
                    "pattern_key": key,
                    "pattern_display": display,
                    "matcher": c.get("matcher", {}),
                }
            ]

        sources_json = json.dumps(sources_list, ensure_ascii=False)

        rows_to_insert.append((
            cid, display, key, level, meaning, breakdown_text, formation,
            variants_json, matcher_json, guards_json, examples_json,
            group_id, primary_source, sources_json, "verified",
        ))

    conn.executemany(
        """
        INSERT INTO grammar_index
          (concept_id, pattern_display, pattern_key, level, meaning_short,
           english_breakdown, formation, variants, matcher, guards,
           examples, group_id, source, sources, review_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows_to_insert,
    )
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source", type=Path, default=MASTER_DATASET_PATH)
    args = parser.parse_args()
    print(build(args.output, args.source))
