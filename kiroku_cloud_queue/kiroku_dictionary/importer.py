"""
importer.py -- Reads Yomitan dictionary zip archives and imports entries into SQLite.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import sqlite3
import time
from typing import Any, Callable
import zipfile

from .schema import (
    SCHEMA_VERSION,
    apply_build_pragmas,
    compress_content,
    create_indexes,
    create_schema,
    normalize_text,
)


def import_dictionary_zip(
    zip_path: str,
    conn: sqlite3.Connection,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> dict[str, Any]:
    """
    Import a Yomitan zip archive (Jitendex or KANJIDIC) into the SQLite database.
    Returns metadata regarding the imported dictionary and row counts.
    """
    if not os.path.exists(zip_path):
        raise FileNotFoundError(f"Dictionary archive not found: {zip_path}")

    dict_meta: dict[str, Any] = {}
    term_count = 0
    kanji_count = 0
    tag_count = 0

    with zipfile.ZipFile(zip_path, "r") as zf:
        namelist = zf.namelist()

        # 1. Read index.json
        if "index.json" in namelist:
            dict_meta = json.loads(zf.read("index.json").decode("utf-8"))
        else:
            dict_meta = {"title": os.path.basename(zip_path), "revision": "unknown"}

        dict_title = str(dict_meta.get("title") or os.path.basename(zip_path))

        # 2. Import tag banks
        tag_files = sorted([f for f in namelist if f.startswith("tag_bank_") and f.endswith(".json")])
        tag_rows_to_insert = []
        for tag_file in tag_files:
            rows = json.loads(zf.read(tag_file).decode("utf-8"))
            for r in rows:
                if not isinstance(r, list) or len(r) < 2:
                    continue
                name = str(r[0])
                category = str(r[1])
                sorting_order = float(r[2]) if len(r) > 2 and r[2] is not None else 0.0
                notes = str(r[3]) if len(r) > 3 and r[3] is not None else ""
                score = float(r[4]) if len(r) > 4 and r[4] is not None else 0.0
                tag_rows_to_insert.append((name, category, sorting_order, notes, score, dict_title))

        if tag_rows_to_insert:
            conn.executemany(
                """
                INSERT OR REPLACE INTO tags (name, category, sorting_order, notes, score, dictionary)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                tag_rows_to_insert,
            )
            tag_count += len(tag_rows_to_insert)

        # 3. Import kanji banks
        kanji_files = sorted([f for f in namelist if f.startswith("kanji_bank_") and f.endswith(".json")])
        for idx, kanji_file in enumerate(kanji_files, 1):
            rows = json.loads(zf.read(kanji_file).decode("utf-8"))
            kanji_rows_to_insert = []
            for r in rows:
                if not isinstance(r, list) or len(r) < 5:
                    continue
                character = str(r[0])
                onyomi = str(r[1]) if r[1] is not None else ""
                kunyomi = str(r[2]) if r[2] is not None else ""
                tags = str(r[3]) if r[3] is not None else ""
                meanings = r[4] if isinstance(r[4], list) else []
                stats = r[5] if len(r) > 5 and isinstance(r[5], dict) else {}

                kanji_rows_to_insert.append((
                    character,
                    onyomi,
                    kunyomi,
                    tags,
                    json.dumps(stats, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(meanings, ensure_ascii=False, separators=(",", ":")),
                    dict_title,
                ))

            if kanji_rows_to_insert:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO kanji (character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    kanji_rows_to_insert,
                )
                kanji_count += len(kanji_rows_to_insert)

            if progress_callback:
                progress_callback("kanji", idx, len(kanji_files))

        # 4. Import term banks
        term_files = sorted([f for f in namelist if f.startswith("term_bank_") and f.endswith(".json")])
        batch_size = 10000
        batch: list[tuple[Any, ...]] = []

        for idx, term_file in enumerate(term_files, 1):
            rows = json.loads(zf.read(term_file).decode("utf-8"))
            for r in rows:
                if not isinstance(r, list) or len(r) < 6:
                    continue
                term = str(r[0])
                raw_reading = str(r[1]) if r[1] is not None else ""
                reading = raw_reading.strip() or term.strip()
                def_tags = str(r[2]) if len(r) > 2 and r[2] is not None else ""
                rules = str(r[3]) if len(r) > 3 and r[3] is not None else ""
                score = float(r[4]) if len(r) > 4 and r[4] is not None else 0.0
                glossary = r[5] if isinstance(r[5], list) else [r[5]]
                sequence = int(r[6]) if len(r) > 6 and r[6] is not None else 0
                term_tags = str(r[7]) if len(r) > 7 and r[7] is not None else ""

                norm_term = normalize_text(term)
                norm_reading = normalize_text(reading)
                content_blob = compress_content(glossary)

                batch.append((
                    term,
                    reading,
                    norm_term,
                    norm_reading,
                    rules,
                    def_tags,
                    score,
                    sequence,
                    term_tags,
                    dict_title,
                    content_blob,
                ))

                if len(batch) >= batch_size:
                    conn.executemany(
                        """
                        INSERT INTO terms (term, reading, norm_term, norm_reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        batch,
                    )
                    term_count += len(batch)
                    batch = []

            if progress_callback:
                progress_callback("terms", idx, len(term_files))

        if batch:
            conn.executemany(
                """
                INSERT INTO terms (term, reading, norm_term, norm_reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            term_count += len(batch)

    return {
        "title": dict_meta.get("title", "Unknown"),
        "revision": dict_meta.get("revision", "Unknown"),
        "terms": term_count,
        "kanji": kanji_count,
        "tags": tag_count,
    }


def build_database(
    jitendex_path: str,
    kanjidic_path: str,
    output_db_path: str,
) -> dict[str, Any]:
    """
    Build a standalone kiroku_dict.sqlite file from Jitendex and KANJIDIC zip files.
    The build is idempotent, removing any existing file at output_db_path.
    """
    start_time = time.monotonic()

    # Ensure output directory exists and remove existing file for deterministic rebuild
    os.makedirs(os.path.dirname(os.path.abspath(output_db_path)), exist_ok=True)
    if os.path.exists(output_db_path):
        os.remove(output_db_path)

    temp_db_path = f"{output_db_path}.tmp"
    if os.path.exists(temp_db_path):
        os.remove(temp_db_path)

    conn = sqlite3.connect(temp_db_path)
    try:
        apply_build_pragmas(conn)
        create_schema(conn)

        with conn:
            # 1. Import Jitendex
            print(f"Importing Jitendex from: {jitendex_path}")
            jitendex_meta = import_dictionary_zip(
                jitendex_path,
                conn,
                lambda kind, cur, total: print(f"\r  Importing Jitendex {kind} banks: {cur}/{total}...", end="", flush=True) if cur % 20 == 0 or cur == total else None
            )
            print(f"\n  Jitendex imported: {jitendex_meta['terms']} terms, {jitendex_meta['tags']} tags (Revision: {jitendex_meta['revision']})")

            # 2. Import KANJIDIC
            print(f"Importing KANJIDIC from: {kanjidic_path}")
            kanjidic_meta = import_dictionary_zip(
                kanjidic_path,
                conn,
                lambda kind, cur, total: print(f"\r  Importing KANJIDIC {kind} banks: {cur}/{total}...", end="", flush=True)
            )
            print(f"\n  KANJIDIC imported: {kanjidic_meta['kanji']} kanji, {kanjidic_meta['tags']} tags (Revision: {kanjidic_meta['revision']})")

            # 3. Store metadata
            now_iso = datetime.now(timezone.utc).isoformat()
            meta_entries = [
                ("schema_version", SCHEMA_VERSION),
                ("jitendex_title", str(jitendex_meta.get("title", ""))),
                ("jitendex_revision", str(jitendex_meta.get("revision", ""))),
                ("kanjidic_title", str(kanjidic_meta.get("title", ""))),
                ("kanjidic_revision", str(kanjidic_meta.get("revision", ""))),
                ("built_at", now_iso),
            ]
            conn.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta_entries)

        # 4. Build indexes after insertion
        print("Building database indexes...")
        create_indexes(conn)

        # 5. Optimize database layout
        print("Running ANALYZE and VACUUM...")
        conn.execute("ANALYZE;")
        conn.commit()
    finally:
        conn.close()

    # Move temp database to final destination
    if os.path.exists(output_db_path):
        os.remove(output_db_path)
    os.replace(temp_db_path, output_db_path)

    elapsed_s = time.monotonic() - start_time
    final_size_bytes = os.path.getsize(output_db_path)
    final_size_mb = final_size_bytes / (1024 * 1024)

    return {
        "output_db": output_db_path,
        "size_bytes": final_size_bytes,
        "size_mb": final_size_mb,
        "elapsed_seconds": elapsed_s,
        "jitendex": jitendex_meta,
        "kanjidic": kanjidic_meta,
    }
