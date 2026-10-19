# Kiroku Dictionary Engine

`kiroku_dictionary` is a standalone, local-first Japanese dictionary and kanji lookup engine designed for Kiroku Note and its cloud services.

## Cleanroom Implementation & Licensing Notice

- **Kiroku Note** is licensed under the **MIT License**.
- **Yomitan** is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.
- **Cleanroom Implementation**: This engine is a completely cleanroom, independent implementation written from scratch using Python standard library primitives. No Yomitan source code, algorithms, or GPL-3.0 licensed materials have been copied, translated, or paraphrased into this package.
- Dictionary data formats (Yomitan format 3 schema) are public data specifications parsed natively using Python `zipfile`, `json`, and `sqlite3`.

## Dictionary Data Attributions

- **Jitendex**: Licensed under **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** © Stephen Kraus.
- **KANJIDIC**: Licensed under **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** © Electronic Dictionary Research and Development Group (EDRDG).
- See `ATTRIBUTION_NOTICE.md` for full copyright notices.

## Architecture

1. **Standard Library Only**: Uses exclusively Python stdlib (`sqlite3`, `json`, `zipfile`, `re`, `unicodedata`, `dataclasses`, `zlib`).
2. **Decoupled**: Does not import `backend/app` or any third-party packages, allowing lightweight standalone use in local and cloud environments.
3. **Memory-Safe & Read-Only**: Runs against an indexed SQLite file using read-only connection pragmas (`journal_mode=OFF`, `mmap_size`, bounded result sets) targeting < 150 MB RSS.
4. **Verbatim Content Storage**: Stores Jitendex structured content AST blobs verbatim with zlib compression, enabling downstream normalizers to extract rich glosses, examples, and cross-references identically.
