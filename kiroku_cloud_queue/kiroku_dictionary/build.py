"""
build.py -- CLI entry point to build kiroku_dict.sqlite from Jitendex and KANJIDIC archives.

Usage:
    python -m kiroku_dictionary.build --jitendex data/jitendex-yomitan.zip --kanjidic data/KANJIDIC_english.zip --out kiroku_dict.sqlite
"""
from __future__ import annotations

import argparse
import os
import sys

from .importer import build_database


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build standalone kiroku_dict.sqlite from Jitendex and KANJIDIC Yomitan archives."
    )
    parser.add_argument(
        "--jitendex",
        default=os.getenv("JITENDEX_ZIP", "data/jitendex-yomitan.zip"),
        help="Path to Jitendex Yomitan zip archive (or env JITENDEX_ZIP)",
    )
    parser.add_argument(
        "--kanjidic",
        default=os.getenv("KANJIDIC_ZIP", "data/KANJIDIC_english.zip"),
        help="Path to KANJIDIC Yomitan zip archive (or env KANJIDIC_ZIP)",
    )
    parser.add_argument(
        "--out",
        default=os.getenv("KIROKU_DICT_SQLITE", "kiroku_dict.sqlite"),
        help="Output SQLite database path (default: kiroku_dict.sqlite)",
    )

    args = parser.parse_args()

    if not os.path.exists(args.jitendex):
        print(f"Error: Jitendex archive not found at '{args.jitendex}'.", file=sys.stderr)
        return 1
    if not os.path.exists(args.kanjidic):
        print(f"Error: KANJIDIC archive not found at '{args.kanjidic}'.", file=sys.stderr)
        return 1

    print("================================================================================")
    print("                    Kiroku Dictionary Builder (Phase 1)                         ")
    print("================================================================================")
    print(f"  Jitendex source : {args.jitendex}")
    print(f"  KANJIDIC source : {args.kanjidic}")
    print(f"  Destination DB  : {args.out}")
    print("--------------------------------------------------------------------------------")

    result = build_database(
        jitendex_path=args.jitendex,
        kanjidic_path=args.kanjidic,
        output_db_path=args.out,
    )

    print("--------------------------------------------------------------------------------")
    print("Build completed successfully!")
    print(f"  Final database size: {result['size_mb']:.2f} MB ({result['size_bytes']} bytes)")
    print(f"  Build time taken   : {result['elapsed_seconds']:.2f} seconds")
    print(f"  Jitendex terms     : {result['jitendex']['terms']:,} (Revision: {result['jitendex']['revision']})")
    print(f"  KANJIDIC kanji     : {result['kanjidic']['kanji']:,} (Revision: {result['kanjidic']['revision']})")
    print("================================================================================")

    # Size budget check per project constraints: target < 150 MB, report if > 250 MB
    if result["size_mb"] > 250:
        print(
            f"WARNING: Database size ({result['size_mb']:.2f} MB) exceeds 250 MB ceiling!",
            file=sys.stderr,
        )
    elif result["size_mb"] <= 150:
        print(f"Size budget check: PASSED ({result['size_mb']:.2f} MB <= 150 MB target).")
    else:
        print(f"Size note: {result['size_mb']:.2f} MB is within the acceptable 150-250 MB range.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
