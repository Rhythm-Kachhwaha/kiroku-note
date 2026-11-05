"""Client-profile contract tests ensuring extension, desktop, and local profiles
maintain expected authentication and origin protection semantics across all modes.
"""
from __future__ import annotations

from pathlib import Path
import re
import pytest
from fastapi.testclient import TestClient

from app.api.study.auth import clear_study_api_token, set_study_api_token
from app.config import DEFAULT_EXTENSION_IDS
from app.main import app
from app.services.legacy_api_auth import legacy_api_auth


CLIENTS_MAP_PATH = Path(__file__).resolve().parent.parent.parent / "docs" / "maps" / "clients.md"


def _parse_clients_map() -> list[dict[str, str]]:
    assert CLIENTS_MAP_PATH.exists(), f"Missing {CLIENTS_MAP_PATH}"
    content = CLIENTS_MAP_PATH.read_text(encoding="utf-8")
    entries: list[dict[str, str]] = []

    lines = [line.strip() for line in content.splitlines() if line.strip().startswith("|")]
    if len(lines) < 2:
        return entries

    headers = [col.strip().lower() for col in lines[0].split("|")[1:-1]]
    for line in lines[2:]:
        cols = [col.strip() for col in line.split("|")[1:-1]]
        if len(cols) == len(headers):
            entry = dict(zip(headers, cols))
            entries.append(entry)
    return entries


def test_every_openapi_route_appears_in_clients_map():
    """Assert every API route defined in FastAPI appears in docs/maps/clients.md."""
    entries = _parse_clients_map()
    assert entries, "No entries parsed from clients.md"

    mapped = {(e["method"].upper(), e["route"]) for e in entries}

    openapi_routes = set()
    for route in app.routes:
        if hasattr(route, "methods") and route.path.startswith("/api"):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                openapi_routes.add((method.upper(), route.path))

    missing = openapi_routes - mapped
    assert not missing, f"OpenAPI routes missing from docs/maps/clients.md: {sorted(missing)}"

    # Validate allowed client values and auth types
    allowed_clients = {"ext", "desk", "both"}
    allowed_auth = {"none", "legacy_token", "desk_bearer", "desk_token", "ext_origin"}

    for entry in entries:
        assert entry["clients"] in allowed_clients, f"Invalid clients '{entry['clients']}' in {entry}"
        assert entry["auth"] in allowed_auth, f"Invalid auth '{entry['auth']}' in {entry}"


PROFILES = [
    "ext_pinned_no_token",
    "ext_paired_token",
    "desk_bearer",
    "no_origin_local",
    "foreign_origin",
]

MODES = ["off", "warn", "enforce"]

REPRESENTATIVE_ROUTES = [
    {"category": "none", "method": "GET", "path": "/api/health", "payload": None},
    {"category": "legacy_token", "method": "POST", "path": "/api/jlpt/batch", "payload": {"expressions": ["テスト"]}},
    {"category": "desk_bearer", "method": "GET", "path": "/api/study/v1/bank/summary", "payload": None},
    {"category": "desk_token", "method": "POST", "path": "/api/auth/extension-pairings/register", "payload": {"code": "TEST-CODE-1234-ABCD"}},
    {"category": "ext_origin", "method": "POST", "path": "/api/auth/extension-pairings/redeem", "payload": {"code": "NONEXISTENT-CODE"}},
]


@pytest.fixture(scope="module")
def paired_extension_token():
    pinned_id = DEFAULT_EXTENSION_IDS[0]
    code = "CODE-PAIR-CONTRACT-TEST-KEY"
    legacy_api_auth._attempts.clear()
    legacy_api_auth.create_pairing(code)
    token = legacy_api_auth.redeem_pairing(code, f"chrome-extension://{pinned_id}")
    yield token
    if token:
        legacy_api_auth.revoke_extension_token(token)


@pytest.mark.parametrize("profile", PROFILES)
@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("route_spec", REPRESENTATIVE_ROUTES, ids=lambda r: f"{r['method']}_{r['category']}")
def test_client_profile_matrix(monkeypatch, paired_extension_token: str, profile: str, mode: str, route_spec: dict):
    """Matrix test exercising client profiles x legacy token modes x route categories."""
    desktop_token = "secret-desktop-launch-token-12345"
    set_study_api_token(desktop_token)
    monkeypatch.setenv("KIROKU_LEGACY_TOKEN_MODE", mode)

    pinned_id = DEFAULT_EXTENSION_IDS[0]
    client = TestClient(app)

    headers = {}
    if profile == "ext_pinned_no_token":
        headers["Origin"] = f"chrome-extension://{pinned_id}"
    elif profile == "ext_paired_token":
        headers["Origin"] = f"chrome-extension://{pinned_id}"
        headers["Authorization"] = f"Bearer {paired_extension_token}"
    elif profile == "desk_bearer":
        headers["Origin"] = "http://127.0.0.1:21828"
        headers["Authorization"] = f"Bearer {desktop_token}"
    elif profile == "foreign_origin":
        headers["Origin"] = "https://untrusted-foreign-site.com"
    elif profile == "no_origin_local":
        pass

    method = route_spec["method"]
    path = route_spec["path"]
    payload = route_spec["payload"]
    category = route_spec["category"]

    try:
        if method == "GET":
            response = client.get(path, headers=headers)
        elif method == "POST":
            response = client.post(path, json=payload, headers=headers)
        else:
            raise ValueError(f"Unsupported test method: {method}")

        status = response.status_code

        # Foreign origin mutating requests are rejected with 403
        if profile == "foreign_origin" and method in ("POST", "PUT", "PATCH", "DELETE"):
            assert status == 403, f"Expected 403 for foreign origin mutation on {path}, got {status}"
            return

        if category == "none":
            assert status == 200, f"Expected 200 for public GET {path}, got {status}"

        elif category == "desk_bearer":
            if profile == "desk_bearer":
                assert status == 200, f"Expected 200 for desktop study endpoint, got {status}"
            else:
                assert status == 401, f"Expected 401 for study endpoint without desktop bearer, got {status}"

        elif category == "desk_token":
            if profile == "desk_bearer":
                assert status == 200, f"Expected 200 for desktop control endpoint, got {status}"
            else:
                assert status == 401, f"Expected 401 for desktop control endpoint without desktop bearer, got {status}"

        elif category == "legacy_token":
            if mode in ("off", "warn"):
                assert status == 200, f"Expected 200 in mode '{mode}' for {path}, got {status}"
            elif mode == "enforce":
                if profile in ("ext_paired_token", "desk_bearer"):
                    assert status == 200, f"Expected 200 in enforce mode with valid token, got {status}"
                else:
                    assert status == 401, f"Expected 401 in enforce mode without valid token, got {status}"

        elif category == "ext_origin":
            if profile in ("ext_pinned_no_token", "ext_paired_token"):
                # Untrusted origin check passes; code not found -> 401
                assert status in (200, 401, 429), f"Unexpected status {status} for extension origin redeem"
            else:
                # Other non-extension profiles (desktop, local, foreign) must be rejected with 403
                assert status == 403, f"Expected 403 for non-extension redeem, got {status}"

    finally:
        clear_study_api_token()
