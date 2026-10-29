"""Build the bundled grammar reference database from the checked-in JLPT seed."""
from __future__ import annotations

import argparse
import json
import sqlite3
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DB = ROOT / "backend" / "app" / "data" / "jlpt_reference.sqlite"
DEFAULT_OUTPUT = ROOT / "backend" / "app" / "data" / "grammar_reference.sqlite"

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
            "regex": "[ぁ-ゖァ-ヺ一-龯]+させられ(?:たくなかった|ない|る|れた)",
        }
    if key in {"ば〜ほど", "とか〜とか"}:
        marker = "ば" if key == "ば〜ほど" else "とか"
        end = "ほど" if key == "ば〜ほど" else "(?:とか|ている|る)"
        return {
            "type": "discontinuous",
            "first": f"[ぁ-ゖァ-ヺ一-龯]+{marker}",
            "second": f"[ぁ-ゖァ-ヺ一-龯]+{end}",
            "max_gap": 20,
            "clause_break": "[、。！？]",
        }
    if key == "お〜になる":
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
        part.strip().replace("〜", "").replace("～", "").replace("~", "")
        for part in pattern.split("/")
    ]
    return {"type": "pattern", "variants": alternatives, "match_mode": "auto"}


def row_for(pattern: str, level: str, meaning: str, formation: str | None,
            examples: str, source: str) -> tuple[object, ...]:
    key = pattern if source == "Kiroku matcher seed" else normalize_pattern_key(pattern)
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


def build(output: Path = DEFAULT_OUTPUT, source: Path = SOURCE_DB) -> Path:
    source_conn = sqlite3.connect(source)
    rows = source_conn.execute(
        "SELECT pattern, level, meaning, formation, examples FROM grammar "
        "ORDER BY id"
    ).fetchall()
    source_conn.close()

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    conn = sqlite3.connect(output)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE grammar_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            source TEXT NOT NULL
        );
        CREATE INDEX idx_grammar_index_level ON grammar_index(level);
        CREATE INDEX idx_grammar_index_pattern_key ON grammar_index(pattern_key);
        CREATE INDEX idx_grammar_index_group_id ON grammar_index(group_id);
        """
    )
    generated_rows = [
        row_for(pattern, level, meaning, formation, examples,
                "OpenJLPT / Tanos JLPT grammar list")
        for pattern, level, meaning, formation, examples in rows
    ]
    generated_rows.extend(
        row_for(pattern, level, meaning, formation, "[]", "Kiroku matcher seed")
        for pattern, level, meaning, formation, _ in FALLBACK_ROWS
    )
    for row in generated_rows:
        conn.execute(
            """
            INSERT INTO grammar_index
              (pattern_display, pattern_key, level, meaning_short,
               english_breakdown, formation, variants, matcher, guards,
               examples, group_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source", type=Path, default=SOURCE_DB)
    args = parser.parse_args()
    print(build(args.output, args.source))
