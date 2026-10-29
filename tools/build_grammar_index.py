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
            id INTEGER PRIMARY KEY,
            pattern_display TEXT NOT NULL,
            pattern_key TEXT NOT NULL UNIQUE,
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
        CREATE INDEX idx_grammar_index_group_id ON grammar_index(group_id);
        """
    )
    seen: set[str] = set()
    for pattern, level, meaning, formation, examples in rows:
        key = normalize_pattern_key(pattern)
        if key in seen:
            continue
        seen.add(key)
        examples_json = examples if examples else "[]"
        conn.execute(
            """
            INSERT INTO grammar_index
              (pattern_display, pattern_key, level, meaning_short,
               english_breakdown, formation, variants, matcher, guards,
               examples, group_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pattern,
                key,
                level,
                meaning,
                breakdown(pattern, meaning, formation),
                formation,
                "[]",
                json.dumps({"type": "pattern", "pattern_key": key}, ensure_ascii=False),
                None,
                examples_json,
                None,
                "OpenJLPT / Tanos JLPT grammar list",
            ),
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
