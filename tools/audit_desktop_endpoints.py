"""Audit desktop UI endpoints against backend OpenAPI schema and verify route health.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.api.study.auth import set_study_api_token, clear_study_api_token


def normalize_template_path(raw_path: str) -> str:
    """Normalize JS template literal path variables to OpenAPI {var} format."""
    p = raw_path

    # Clean query string if attached to raw path
    if "?" in p:
        p = p.split("?")[0]

    # Study bank question / exam / session templates
    p = re.sub(r"/api/study/v1/bank/questions/\$\{[^}]+\}/provenance", "/api/study/v1/bank/questions/{id}/provenance", p)
    p = re.sub(r"/api/study/v1/bank/questions/\$\{[^}]+\}/reports", "/api/study/v1/bank/questions/{id}/reports", p)
    p = re.sub(r"/api/study/v1/bank/questions/\$\{[^}]+\}", "/api/study/v1/bank/questions/{id}", p)
    p = re.sub(r"/api/study/v1/bank/reports/\$\{[^}]+\}", "/api/study/v1/bank/reports/{report_id}", p)
    p = re.sub(r"/api/study/v1/bank/import/pdf/\$\{[^}]+\}/pages", "/api/study/v1/bank/import/pdf/{import_id}/pages", p)
    p = re.sub(r"/api/study/v1/bank/import/pdf/\$\{[^}]+\}/preview", "/api/study/v1/bank/import/pdf/{import_id}/preview", p)
    p = re.sub(r"/api/study/v1/bookmarks/\$\{[^}]+\}", "/api/study/v1/bookmarks/{question_id}", p)
    p = re.sub(r"/api/study/v1/exam/blueprints/\$\{[^}]+\}", "/api/study/v1/exam/blueprints/{level}", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/result", "/api/study/v1/exam/sessions/{id}/result", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/complete", "/api/study/v1/exam/sessions/{id}/complete", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/items/\$\{[^}]+\}/answer", "/api/study/v1/exam/sessions/{id}/items/{item}/answer", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/items/\$\{[^}]+\}/flag", "/api/study/v1/exam/sessions/{id}/items/{item}/flag", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/items/\$\{[^}]+\}", "/api/study/v1/exam/sessions/{id}/items/{item}", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/sections/\$\{[^}]+\}/pause", "/api/study/v1/exam/sessions/{id}/sections/{section}/pause", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/sections/\$\{[^}]+\}/resume", "/api/study/v1/exam/sessions/{id}/sections/{section}/resume", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/sections/\$\{[^}]+\}/start", "/api/study/v1/exam/sessions/{id}/sections/{section}/start", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}/sections/\$\{[^}]+\}/submit", "/api/study/v1/exam/sessions/{id}/sections/{section}/submit", p)
    p = re.sub(r"/api/study/v1/exam/sessions/\$\{[^}]+\}", "/api/study/v1/exam/sessions/{id}", p)
    p = re.sub(r"/api/study/v1/history/incorrect/\$\{[^}]+\}", "/api/study/v1/history/incorrect/{question_id}", p)
    p = re.sub(r"/api/study/v1/media/\$\{[^}]+\}", "/api/study/v1/media/{asset_id_or_sha256}", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/next", "/api/study/v1/practice/sessions/{id}/next", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/results", "/api/study/v1/practice/sessions/{id}/results", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/answer", "/api/study/v1/practice/sessions/{id}/answer", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/answers", "/api/study/v1/practice/sessions/{id}/answers", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/abandon", "/api/study/v1/practice/sessions/{id}/abandon", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/complete", "/api/study/v1/practice/sessions/{id}/complete", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}/feedback", "/api/study/v1/practice/sessions/{id}/feedback", p)
    p = re.sub(r"/api/study/v1/practice/sessions/\$\{[^}]+\}", "/api/study/v1/practice/sessions/{id}", p)

    # Core cards / kanji / grammar templates
    p = re.sub(r"/api/cards/\$\{[^}]+\}/sync", "/api/cards/{card_id}/sync", p)
    p = re.sub(r"/api/cards/\$\{[^}]+\}", "/api/cards/{card_id}", p)
    p = re.sub(r"/api/grammar/points/\$\{[^}]+\}/encounters", "/api/grammar/points/{pattern_key}/encounters", p)
    p = re.sub(r"/api/grammar/points/\$\{[^}]+\}", "/api/grammar/points/{pattern_key}", p)
    p = re.sub(r"/api/kanji/strokes/\$\{[^}]+\}", "/api/kanji/strokes/{character}", p)
    p = re.sub(r"/api/kanji/details/\$\{[^}]+\}", "/api/kanji/details/{character}", p)
    p = re.sub(r"/api/kanji/compounds/\$\{[^}]+\}", "/api/kanji/compounds/{character}", p)
    p = re.sub(r"/api/known-words/mark/\$\{[^}]+\}", "/api/known-words/mark/{word}", p)
    p = re.sub(r"/api/link/cues/\$\{[^}]+\}", "/api/link/cues/{cue_hash}", p)
    p = re.sub(r"/api/link/episodes/\$\{[^}]+\}", "/api/link/episodes/{cue_hash}", p)
    p = re.sub(r"/api/link/primer/\$\{[^}]+\}", "/api/link/primer/{cue_hash}", p)
    p = re.sub(r"/api/media/\$\{[^}]+\}", "/api/media/{filename}", p)

    return p


def extract_desktop_routes(ui_dir: Path) -> list[tuple[str, str, str]]:
    """Scan all desktop UI sources and extract (method, route, source_file) tuples."""
    results: set[tuple[str, str, str]] = set()

    for file_path in ui_dir.rglob("*"):
        if file_path.suffix not in (".js", ".html"):
            continue
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception:
            continue

        rel_path = file_path.resolve().relative_to(REPO_ROOT.resolve()).as_posix()

        # 1. Matches this.request(...) calls with balanced parentheses
        for m in re.finditer(r"(?:this\.)?request\s*\(", content):
            start = m.end()
            depth = 1
            i = start
            while i < len(content) and depth > 0:
                if content[i] == '(':
                    depth += 1
                elif content[i] == ')':
                    depth -= 1
                i += 1
            call_text = content[start:i-1]
            p_match = re.search(r"[`'\"](/api/[^`'\"]+)[`'\"]", call_text)
            if p_match:
                path_val = p_match.group(1)
                m_match = re.search(r"method:\s*[`'\"]([A-Z]+)[`'\"]", call_text)
                method = m_match.group(1).upper() if m_match else "GET"
                norm = normalize_template_path(path_val)
                results.add((method, norm, rel_path))

        # 2. Matches any standalone string literals containing /api/
        for m in re.finditer(r"[`'\"](/api/[a-zA-Z0-9_\-\$\{}/]+)[`'\"]", content):
            raw_path = m.group(1)
            norm = normalize_template_path(raw_path)
            if not any(r[1] == norm for r in results):
                results.add(("GET", norm, rel_path))

    return sorted(results, key=lambda x: (x[1], x[0]))


def test_safe_route(client: TestClient, method: str, path: str, desktop_token: str) -> str:
    """Call a safe GET route and classify response status."""
    test_path = path
    test_path = test_path.replace("{id}", "1").replace("{card_id}", "1")
    test_path = test_path.replace("{character}", "%E9%A3%9F")  # 食
    test_path = test_path.replace("{pattern_key}", "te_shimau")
    test_path = test_path.replace("{word}", "%E6%97%A5%E6%9C%AC")  # 日本
    test_path = test_path.replace("{level}", "N5")
    test_path = test_path.replace("{filename}", "dummy.jpg")
    test_path = test_path.replace("{cue_hash}", "dummy")
    test_path = test_path.replace("{report_id}", "1")
    test_path = test_path.replace("{import_id}", "1")
    test_path = test_path.replace("{item}", "0")
    test_path = test_path.replace("{asset_id_or_sha256}", "dummy")

    headers = {
        "Origin": "http://127.0.0.1:21828",
        "Authorization": f"Bearer {desktop_token}"
    }

    try:
        if method == "GET":
            res = client.get(test_path, headers=headers)
        else:
            return "mutation"

        code = res.status_code
        if 200 <= code < 300:
            return "ok"
        elif code in (401, 403):
            return "auth"
        elif code == 404:
            # Distinguish missing route vs missing DB entity
            try:
                body = res.json()
                if body.get("detail") == "Not Found":
                    return "404"
                else:
                    return "ok"
            except Exception:
                return "404"
        elif code == 405:
            return "405"
        elif code == 422:
            return "422"
        elif code >= 500:
            return "5xx"
        return str(code)
    except Exception as exc:
        return f"err: {exc}"


def main() -> int:
    ui_dir = REPO_ROOT / "desktop" / "src" / "ui"
    openapi_fixture = REPO_ROOT / "desktop" / "tests" / "fixtures" / "openapi.json"

    openapi = json.loads(openapi_fixture.read_text(encoding="utf-8"))
    openapi_paths = openapi.get("paths", {})

    desktop_routes = extract_desktop_routes(ui_dir)
    print(f"Discovered {len(desktop_routes)} endpoint usages across desktop UI.")

    desktop_token = "secret-desktop-audit-token-12345"
    set_study_api_token(desktop_token)
    client = TestClient(app)

    results = []
    has_errors = False

    for method, path, src in desktop_routes:
        in_openapi = path in openapi_paths
        if in_openapi:
            allowed_methods = [m.upper() for m in openapi_paths[path].keys() if m.upper() not in ("HEAD", "OPTIONS")]
            method_ok = method in allowed_methods
        else:
            method_ok = False

        status_class = "ok"
        if not in_openapi:
            status_class = "404"
            has_errors = True
        elif not method_ok:
            status_class = "405"
            has_errors = True
        elif method == "GET":
            status_class = test_safe_route(client, method, path, desktop_token)

        results.append({
            "method": method,
            "path": path,
            "status": status_class,
            "in_openapi": in_openapi,
            "source": src
        })

    clear_study_api_token()

    # Format markdown table
    table_lines = [
        "## Desktop Endpoint Audit Results",
        "",
        "| Method | Endpoint | Status | OpenAPI | Source |",
        "|---|---|---|---|---|"
    ]

    for r in results:
        table_lines.append(
            f"| {r['method']} | `{r['path']}` | {r['status']} | {'yes' if r['in_openapi'] else 'NO'} | {r['source']} |"
        )
    table_lines.append("")

    # Update docs/maps/desktop-views.md
    doc_path = REPO_ROOT / "docs" / "maps" / "desktop-views.md"
    current_doc = doc_path.read_text(encoding="utf-8")
    audit_header = "## Desktop Endpoint Audit Results"
    if audit_header in current_doc:
        current_doc = current_doc.split(audit_header)[0].strip() + "\n\n"
    new_doc = current_doc.strip() + "\n\n" + "\n".join(table_lines)
    doc_path.write_text(new_doc, encoding="utf-8")
    print(f"Updated {doc_path} with audit table ({len(results)} rows).")

    # Summary
    errors = [r for r in results if r["status"] in ("404", "405")]
    if errors:
        print(f"\n[FAIL] Found {len(errors)} routes with 404/405 errors:")
        for e in errors:
            print(f"  - {e['method']} {e['path']} ({e['status']}) in {e['source']}")
        return 1
    else:
        print(f"\n[SUCCESS] All {len(results)} desktop endpoints exist in OpenAPI with zero 404/405 errors.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
