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
