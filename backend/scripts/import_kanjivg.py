"""KanjiVG Ingestion Script for Kiroku Note.

Ingests a curated subset (~2,000 common Joyo / JLPT kanji) of KanjiVG SVGs
licensed under Creative Commons Attribution-Share Alike 3.0 (CC BY-SA 3.0).

Source: https://github.com/KanjiVG/kanjivg (Copyright Ulrich Apel and contributors)
License: CC BY-SA 3.0 (http://creativecommons.org/licenses/by-sa/3.0/)
"""
from __future__ import annotations

import argparse
import io
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
import urllib.request
import zipfile

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("import_kanjivg")

DEFAULT_RELEASE_URL = "https://github.com/KanjiVG/kanjivg/releases/download/r20250816/kanjivg-20250816-main.zip"


def clean_kanjivg_svg(raw_svg: str) -> str:
    """Clean a KanjiVG SVG string for inline embedding and Anki compatibility.

    - Strips XML declaration, DOCTYPE, DTD, and comments
    - Strips kvg custom namespace attributes to reduce size
    - Standardizes <svg> root element with viewBox 0 0 109 109 and class
    - Inlines robust styles for stroke paths (currentColor) and stroke numbers (#888888)
    """
    # 1. Strip everything before the <svg tag (XML declaration, DOCTYPE, DTD subsets, comments)
    if "<svg" in raw_svg:
        s = raw_svg[raw_svg.find("<svg"):]
    else:
        s = raw_svg

    # 2. Remove comments inside SVG
    s = re.sub(r"<!--.*?-->", "", s, flags=re.DOTALL)
    s = s.strip()

    # 4. Remove kvg namespace attributes to reduce payload size
    s = re.sub(r'\s+kvg:[a-zA-Z0-9]+="[^"]*"', "", s)
    s = re.sub(r'\s+xmlns:kvg="[^"]*"', "", s)

    # 5. Standardize <svg> root element
    if "<svg" in s:
        s = re.sub(
            r"<svg[^>]*>",
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109" class="stroke-order-svg" width="109" height="109">',
            s,
            count=1,
        )

    # 6. Ensure self-contained inline styles for paths and stroke numbers
    s = re.sub(
        r'(<g\s+id="[^"]*StrokePaths[^"]*"\s+)style="[^"]*"',
        r'\1style="fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;"',
        s,
    )
    # If no style attribute on StrokePaths group, inject it
    if 'id="kvg:StrokePaths' in s and 'fill:none;stroke:currentColor' not in s:
        s = re.sub(
            r'(<g\s+id="[^"]*StrokePaths[^"]*")',
            r'\1 style="fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;"',
            s,
            count=1,
        )

    s = re.sub(
        r'(<g\s+id="[^"]*StrokeNumbers[^"]*"\s+)style="[^"]*"',
        r'\1style="font-size:8px;fill:#888888;font-family:sans-serif;"',
        s,
    )
    if 'id="kvg:StrokeNumbers' in s and 'font-size:8px' not in s:
        s = re.sub(
            r'(<g\s+id="[^"]*StrokeNumbers[^"]*")',
            r'\1 style="font-size:8px;fill:#888888;font-family:sans-serif;"',
            s,
            count=1,
        )

    # Strip empty lines
    lines = [line.rstrip() for line in s.splitlines() if line.strip()]
    return "\n".join(lines)


def get_target_kanji_list(jlpt_db_path: Path) -> list[str]:
    """Retrieve curated list of kanji characters from jlpt_reference.sqlite."""
    if not jlpt_db_path.exists():
        logger.warning("JLPT reference database not found at %s. Using default kanji subset.", jlpt_db_path)
        return []

    conn = sqlite3.connect(str(jlpt_db_path))
    cursor = conn.cursor()
    rows = cursor.execute("SELECT character FROM kanji ORDER BY character ASC;").fetchall()
    conn.close()
    return [r[0] for r in rows if r and r[0]]


def char_to_codepoint(char: str) -> str:
    """Return 5-hex-digit codepoint string for character (e.g. '意' -> '0610f')."""
    return f"{ord(char):05x}"


def import_kanjivg(
    source_path: str | None = None,
    output_db_path: Path | None = None,
    jlpt_db_path: Path | None = None,
    limit: int | None = None,
) -> int:
    """Ingest curated KanjiVG SVGs into SQLite database."""
    base_dir = Path(__file__).resolve().parent.parent
    if output_db_path is None:
        output_db_path = base_dir / "app" / "data" / "kanji_strokes.sqlite"
    if jlpt_db_path is None:
        jlpt_db_path = base_dir / "app" / "data" / "jlpt_reference.sqlite"

    target_kanji = get_target_kanji_list(jlpt_db_path)
    logger.info("Loaded %d target kanji characters from reference database.", len(target_kanji))

    if limit and limit > 0:
        target_kanji = target_kanji[:limit]

    # Map codepoint -> character
    codepoint_to_char = {char_to_codepoint(ch): ch for ch in target_kanji}

    # Open zip file: local or download
    zip_bytes: io.BytesIO | None = None
    zf: zipfile.ZipFile | None = None

    if source_path and Path(source_path).is_file():
        logger.info("Opening local source zip: %s", source_path)
        zf = zipfile.ZipFile(source_path, "r")
    elif source_path and Path(source_path).is_dir():
        logger.info("Using local SVG directory: %s", source_path)
        # We will read files directly below
    else:
        logger.info("Downloading KanjiVG main release from %s...", DEFAULT_RELEASE_URL)
        req = urllib.request.Request(
            DEFAULT_RELEASE_URL,
            headers={"User-Agent": "KirokuNote-KanjiVG-Importer/1.0"},
        )
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        logger.info("Downloaded %d bytes. Opening zip archive...", len(data))
        zip_bytes = io.BytesIO(data)
        zf = zipfile.ZipFile(zip_bytes, "r")

    output_db_path.parent.mkdir(parents=True, exist_ok=True)
    temp_db_path = output_db_path.with_suffix(".tmp")
    if temp_db_path.exists():
        temp_db_path.unlink()

    conn = sqlite3.connect(str(temp_db_path))
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE kanji_strokes (
            character TEXT PRIMARY KEY,
            codepoint TEXT NOT NULL,
            svg TEXT NOT NULL
        );
    """)
    cursor.execute("CREATE INDEX idx_kanji_strokes_codepoint ON kanji_strokes(codepoint);")

    imported_count = 0

    if zf is not None:
        # Reading from zipfile
        namelist = zf.namelist()
        # Create map of filename basename -> full zip path
        name_map = {}
        for name in namelist:
            base = os.path.basename(name)
            if base.endswith(".svg") and not base.startswith("._"):
                cp = base[:-4].lower()
                name_map[cp] = name

        for cp, char in codepoint_to_char.items():
            zip_name = name_map.get(cp)
            if not zip_name:
                continue
            with zf.open(zip_name) as f:
                raw_content = f.read().decode("utf-8", errors="replace")
            cleaned_svg = clean_kanjivg_svg(raw_content)
            cursor.execute(
                "INSERT INTO kanji_strokes (character, codepoint, svg) VALUES (?, ?, ?);",
                (char, cp, cleaned_svg),
            )
            imported_count += 1
        zf.close()
    elif source_path and Path(source_path).is_dir():
        src_dir = Path(source_path)
        for cp, char in codepoint_to_char.items():
            candidate = src_dir / f"{cp}.svg"
            if not candidate.exists():
                continue
            raw_content = candidate.read_text(encoding="utf-8", errors="replace")
            cleaned_svg = clean_kanjivg_svg(raw_content)
            cursor.execute(
                "INSERT INTO kanji_strokes (character, codepoint, svg) VALUES (?, ?, ?);",
                (char, cp, cleaned_svg),
            )
            imported_count += 1

    conn.commit()
    conn.close()

    # Move temporary db to final location
    if output_db_path.exists():
        output_db_path.unlink()
    temp_db_path.rename(output_db_path)

    logger.info("Successfully imported %d kanji stroke diagrams to %s", imported_count, output_db_path)
    return imported_count


def main():
    parser = argparse.ArgumentParser(description="Ingest KanjiVG SVGs into Kiroku Note SQLite dataset.")
    parser.add_argument("--source", type=str, help="Path to local KanjiVG zip file or SVG directory.")
    parser.add_argument("--output", type=Path, help="Path to output kanji_strokes.sqlite database.")
    parser.add_argument("--jlpt-db", type=Path, help="Path to reference jlpt_reference.sqlite database.")
    parser.add_argument("--limit", type=int, help="Optional maximum kanji to ingest.")
    args = parser.parse_args()

    count = import_kanjivg(
        source_path=args.source,
        output_db_path=args.output,
        jlpt_db_path=args.jlpt_db,
        limit=args.limit,
    )
    print(f"Imported {count} kanji stroke diagrams.")


if __name__ == "__main__":
    main()
