import json
import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "backend"))

from app.main import app

schema = app.openapi()
out1 = repo_root / "desktop" / "tests" / "fixtures" / "openapi.json"
out2 = repo_root / "docs" / "desktop-wireup" / "openapi.json"

out1.write_text(json.dumps(schema, indent=2), encoding="utf-8")
out2.write_text(json.dumps(schema, indent=2), encoding="utf-8")
print(f"Exported OpenAPI schema with {len(schema.get('paths', {}))} paths.")
