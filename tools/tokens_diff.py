import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

tokens_json_path = REPO_ROOT / "docs" / "design" / "stitch-export" / "_design-system" / "tokens.json"
global_css_path = REPO_ROOT / "docs" / "design" / "stitch-export" / "_design-system" / "global.css"
tokens_css_path = REPO_ROOT / "desktop" / "src" / "ui" / "styles" / "tokens.css"
diff_md_path = REPO_ROOT / "docs" / "desktop-wireup" / "tokens-diff.md"

with open(tokens_json_path, "r", encoding="utf-8") as f:
    tokens_data = json.load(f)

with open(global_css_path, "r", encoding="utf-8") as f:
    global_css_text = f.read()

with open(tokens_css_path, "r", encoding="utf-8") as f:
    tokens_css_text = f.read()

# Extract vars from global.css
global_vars = {}
for match in re.finditer(r"--([\w-]+)\s*:\s*([^;]+);", global_css_text):
    global_vars[match.group(1)] = match.group(2).strip()

# Extract vars from tokens.css
desktop_vars = {}
for match in re.finditer(r"--([\w-]+)\s*:\s*([^;]+);", tokens_css_text):
    desktop_vars[match.group(1)] = match.group(2).strip()

# Analyze diff
diff_entries = []

# All tokens from tokens.json
all_token_keys = set()
for color_key, val in tokens_data.get("colors", {}).items():
    var_name = color_key.replace("_", "-")
    all_token_keys.add((color_key, var_name, "color", str(val)))

for space_key, val in tokens_data.get("spacing", {}).items():
    var_name = space_key
    all_token_keys.add((space_key, var_name, "spacing", str(val)))

for font_key, val in tokens_data.get("fontFamilies", {}).items():
    var_name = f"font-{font_key}"
    all_token_keys.add((font_key, var_name, "typography", str(val)))

# Write markdown report
lines = [
    "# Token Diff Analysis: tokens.css vs Stitch tokens.json and global.css",
    "",
    "| Stitch Token Key | CSS Variable | Stitch Canonical Value | Desktop Value | Status / Mapping Reason |",
    "|------------------|--------------|------------------------|---------------|-------------------------|",
]

for orig_key, var_name, category, canonical in sorted(all_token_keys):
    desktop_val = desktop_vars.get(var_name) or desktop_vars.get(orig_key)
    if desktop_val is None:
        status = "Added to tokens.css (mapped to canonical)"
    elif desktop_val.lower() == canonical.lower():
        status = "Exact Match"
    else:
        status = f"Adapted for Desktop: {desktop_val}"
    lines.append(f"| `{orig_key}` | `--{var_name}` | `{canonical}` | `{desktop_val or canonical}` | {status} |")

lines.append("")
lines.append("## Desktop-Specific Extensions")
lines.append("")
lines.append("| CSS Variable | Value | Purpose |")
lines.append("|--------------|-------|---------|")
for var_name, val in sorted(desktop_vars.items()):
    if var_name not in [x[1] for x in all_token_keys] and var_name not in [x[0] for x in all_token_keys]:
        lines.append(f"| `--{var_name}` | `{val}` | Tactile interaction, safe areas, status flags |")

diff_md_path.parent.mkdir(parents=True, exist_ok=True)
with open(diff_md_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"Generated {diff_md_path}")

