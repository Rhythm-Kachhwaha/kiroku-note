"""Every repository path named in docs/maps/*.md must exist.

Parses backtick-quoted paths from the area maps and asserts each resolves to
something on disk (glob patterns allowed). Paths that are API routes, shell
commands, placeholders, or URLs are intentionally excluded.
"""
from pathlib import Path
import re
import glob as globmod

BT = "`"
REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "docs" / "maps"


def _named_paths():
    paths = set()
    for map_file in sorted(MAPS_DIR.glob("*.md")):
        text = map_file.read_text(encoding="utf-8")
        for match in re.finditer(BT + r"([^" + BT + r"]+)" + BT + r"(\s*\(planned\))?", text):
            if match.group(2):
                continue
            token = match.group(1).strip()
            if "(planned)" in token:
                continue
            # Skip API routes, shell commands, env/placeholder tokens, URLs.
            if token.startswith("/api/"):
                continue
            if "%" in token or "$" in token or "<" in token or ">" in token:
                continue
            if any(token.startswith(prefix + " ") for prefix in ("node", "python", "npm", "taskkill")):
                continue
            head = token.split("/")[0].split("\\")[0]
            if head not in {p.name for p in REPO_ROOT.iterdir() if p.is_dir()}:
                continue
            paths.add(token)
    return sorted(paths)


def test_map_paths_exist():
    named = _named_paths()
    assert named, "no map paths were extracted"
    missing = []
    for token in named:
        if globmod.has_magic(token):
            ok = bool(globmod.glob(str(REPO_ROOT / token), recursive=True))
        else:
            ok = (REPO_ROOT / token).exists()
        if not ok:
            missing.append(token)
    assert not missing, f"map paths missing from repository: {missing}"
