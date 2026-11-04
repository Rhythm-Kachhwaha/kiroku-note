"""Focused R7 coverage for staged legacy API protection and pairing."""
import re
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.study.auth import clear_study_api_token, set_study_api_token
from app.config import get_allowed_origin_regex
from app.main import _is_legacy_mutation, app
from app.services.legacy_api_auth import LegacyApiAuth, legacy_api_auth


def test_pairing_code_is_single_use_and_stored_as_hash_only():
    service = LegacyApiAuth()
    service.create_pairing("ABCD-1234-EFGH-5678")
    assert "ABCD-1234-EFGH-5678" not in repr(service.__dict__)
    token = service.redeem_pairing("ABCD-1234-EFGH-5678", "chrome-extension://devextensionid")
    assert token and token.startswith("knx_")
    assert service.has_extension_token(token)
    assert service.redeem_pairing("ABCD-1234-EFGH-5678", "chrome-extension://devextensionid") is None
    assert service.revoke_extension_token(token)
    assert not service.has_extension_token(token)


def test_extension_origin_allowlist_uses_separate_opt_in_development_ids():
    env = {
        "KIROKU_EXTENSION_IDS": "productionextensionid",
        "KIROKU_ENABLE_DEV_EXTENSION_IDS": "1",
        "KIROKU_DEV_EXTENSION_IDS": "developmentextensionid",
    }
    pattern = re.compile(get_allowed_origin_regex(env))
    assert pattern.match("chrome-extension://productionextensionid")
    assert pattern.match("chrome-extension://developmentextensionid")
    assert not pattern.match("chrome-extension://foreignextensionid")


def test_every_non_study_mutation_is_covered_by_the_central_policy():
    mutation_routes = [
        route.path
        for route in app.routes
        if getattr(route, "methods", set()) & {"POST", "PUT", "PATCH", "DELETE"}
        and route.path.startswith("/api/")
        and not route.path.startswith("/api/study/")
        and not route.path.startswith("/api/auth/")
    ]
    assert mutation_routes
    for path in mutation_routes:
        request = type("Request", (), {"method": "POST", "url": type("Url", (), {"path": path})()})()
        assert _is_legacy_mutation(request)


def test_warn_and_enforce_modes_keep_desktop_and_paired_extension_requests_working(monkeypatch):
    client = TestClient(app)
    endpoint = "/api/jlpt/batch"
    payload = {"expressions": ["日本語"]}
    legacy_api_auth.missing_token_counts.clear()
    monkeypatch.setenv("KIROKU_LEGACY_TOKEN_MODE", "warn")
    assert client.post(endpoint, json=payload).status_code == 200
    assert legacy_api_auth.missing_token_counts[endpoint] == 1

    monkeypatch.setenv("KIROKU_LEGACY_TOKEN_MODE", "enforce")
    assert client.post(endpoint, json=payload).status_code == 401
    set_study_api_token("desktop-launch-token")
    assert client.post(endpoint, json=payload, headers={"Authorization": "Bearer desktop-launch-token"}).status_code == 200
    extension_token = legacy_api_auth.redeem_pairing("unused", "chrome-extension://dev")
    assert extension_token is None
    legacy_api_auth.create_pairing("PAIR-1234-ABCD-5678")
    extension_token = legacy_api_auth.redeem_pairing("PAIR-1234-ABCD-5678", "chrome-extension://dev")
    assert client.post(endpoint, json=payload, headers={"Authorization": f"Bearer {extension_token}"}).status_code == 200
    clear_study_api_token()


def test_pairing_endpoint_allows_only_configured_development_id(monkeypatch):
    monkeypatch.setenv("KIROKU_EXTENSION_PAIRING_ENABLED", "1")
    monkeypatch.setenv("KIROKU_ENABLE_DEV_EXTENSION_IDS", "1")
    monkeypatch.setenv("KIROKU_DEV_EXTENSION_IDS", "devextensionid")
    set_study_api_token("desktop-launch-token")
    client = TestClient(app)
    headers = {"Authorization": "Bearer desktop-launch-token"}
    assert client.post("/api/auth/extension-pairings/register", json={"code": "PAIR-1234-ABCD-5678"}, headers=headers).status_code == 200
    with patch("app.main.ALLOWED_ORIGIN_PATTERN", re.compile(r"^chrome-extension://devextensionid$")):
        allowed = client.post(
            "/api/auth/extension-pairings/redeem",
            json={"code": "PAIR-1234-ABCD-5678"},
            headers={"Origin": "chrome-extension://devextensionid"},
        )
    assert allowed.status_code == 200
    assert allowed.json()["token"].startswith("knx_")
    denied = client.post(
        "/api/auth/extension-pairings/redeem",
        json={"code": "PAIR-1234-ABCD-5678"},
        headers={"Origin": "chrome-extension://foreignextensionid"},
    )
    assert denied.status_code == 403
    clear_study_api_token()


def test_persisted_tokens_survive_restart(tmp_path):
    db_file = tmp_path / "test_auth.db"
    auth1 = LegacyApiAuth(db_path=db_file)
    auth1.create_pairing("CODE-1111-2222-3333")
    token = auth1.redeem_pairing("CODE-1111-2222-3333", "chrome-extension://test", scopes=["legacy:write", "link:rw"], label="test-ext")
    assert token and token.startswith("knx_")
    assert auth1.has_extension_token(token)
    assert auth1.has_extension_token(token, required_scope="link:rw")
    assert auth1.has_extension_token(token, required_scope="legacy:write")
    assert auth1.get_token_scopes(token) == frozenset({"legacy:write", "link:rw"})

    # Simulate backend restart with a new instance pointing to the same SQLite database
    auth2 = LegacyApiAuth(db_path=db_file)
    assert auth2.has_extension_token(token)
    assert auth2.has_extension_token(token, required_scope="link:rw")
    assert auth2.has_scope(token, "link:rw")
    assert auth2.has_scope(token, "legacy:write")
    assert auth2.get_token_scopes(token) == frozenset({"legacy:write", "link:rw"})

    # Revoke deletes row from SQLite
    assert auth2.revoke_extension_token(token)
    assert not auth2.has_extension_token(token)

    # Verify deleted row does not reload on next restart
    auth3 = LegacyApiAuth(db_path=db_file)
    assert not auth3.has_extension_token(token)
    assert auth3.get_token_scopes(token) == frozenset()


def test_pairing_scopes_default_and_link_rw(tmp_path):
    db_file = tmp_path / "test_scopes.db"
    auth = LegacyApiAuth(db_path=db_file)

    # Default pairing gives legacy:write only
    auth.create_pairing("CODE-DEFAULT")
    token_default = auth.redeem_pairing("CODE-DEFAULT", "chrome-extension://test")
    assert auth.get_token_scopes(token_default) == frozenset({"legacy:write"})
    assert auth.has_extension_token(token_default, required_scope="legacy:write")
    assert not auth.has_extension_token(token_default, required_scope="link:rw")

    # Explicit link:rw request
    auth.create_pairing("CODE-LINK")
    token_link = auth.redeem_pairing("CODE-LINK", "chrome-extension://test", scopes=["link:rw"])
    assert auth.get_token_scopes(token_link) == frozenset({"link:rw"})
    assert auth.has_extension_token(token_link, required_scope="link:rw")
    assert not auth.has_extension_token(token_link, required_scope="legacy:write")

    # Unknown scopes fall back to default
    auth.create_pairing("CODE-UNKNOWN")
    token_unknown = auth.redeem_pairing("CODE-UNKNOWN", "chrome-extension://test", scopes=["invalid:scope"])
    assert auth.get_token_scopes(token_unknown) == frozenset({"legacy:write"})


def test_pairing_endpoint_returns_requested_scopes(monkeypatch):
    monkeypatch.setenv("KIROKU_EXTENSION_PAIRING_ENABLED", "1")
    monkeypatch.setenv("KIROKU_ENABLE_DEV_EXTENSION_IDS", "1")
    monkeypatch.setenv("KIROKU_DEV_EXTENSION_IDS", "devextensionid")
    set_study_api_token("desktop-launch-token")
    client = TestClient(app)
    headers = {"Authorization": "Bearer desktop-launch-token"}

    # 1. Pairing with link:rw requested
    assert client.post("/api/auth/extension-pairings/register", json={"code": "PAIR-SCOPE-LINK-01"}, headers=headers).status_code == 200
    with patch("app.main.ALLOWED_ORIGIN_PATTERN", re.compile(r"^chrome-extension://devextensionid$")):
        res_link = client.post(
            "/api/auth/extension-pairings/redeem",
            json={"code": "PAIR-SCOPE-LINK-01", "scopes": ["link:rw"]},
            headers={"Origin": "chrome-extension://devextensionid"},
        )
    assert res_link.status_code == 200
    data_link = res_link.json()
    assert data_link["token"].startswith("knx_")
    assert data_link["scope"] == "link:rw"
    assert data_link["scopes"] == ["link:rw"]

    # 2. Pairing with default (no scopes specified)
    assert client.post("/api/auth/extension-pairings/register", json={"code": "PAIR-SCOPE-DEF-02"}, headers=headers).status_code == 200
    with patch("app.main.ALLOWED_ORIGIN_PATTERN", re.compile(r"^chrome-extension://devextensionid$")):
        res_def = client.post(
            "/api/auth/extension-pairings/redeem",
            json={"code": "PAIR-SCOPE-DEF-02"},
            headers={"Origin": "chrome-extension://devextensionid"},
        )
    assert res_def.status_code == 200
    data_def = res_def.json()
    assert data_def["token"].startswith("knx_")
    assert data_def["scope"] == "legacy:write"
    assert data_def["scopes"] == ["legacy:write"]

    clear_study_api_token()


def test_revoke_all_clears_database(tmp_path):
    db_file = tmp_path / "test_revoke_all.db"
    auth = LegacyApiAuth(db_path=db_file)
    auth.create_pairing("CODE-REV-1")
    tok1 = auth.redeem_pairing("CODE-REV-1", "chrome-extension://test")
    auth.create_pairing("CODE-REV-2")
    tok2 = auth.redeem_pairing("CODE-REV-2", "chrome-extension://test")
    assert auth.has_extension_token(tok1)
    assert auth.has_extension_token(tok2)

    revoked_count = auth.revoke_all_extension_tokens()
    assert revoked_count == 2
    assert not auth.has_extension_token(tok1)
    assert not auth.has_extension_token(tok2)

    # Persists through restart
    auth_restarted = LegacyApiAuth(db_path=db_file)
    assert not auth_restarted.has_extension_token(tok1)
    assert not auth_restarted.has_extension_token(tok2)
    assert auth_restarted.status()["paired_extensions"] == 0

