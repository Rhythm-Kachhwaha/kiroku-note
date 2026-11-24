"""
Security verification suite for Kiroku Anime:
1. Authentication: Cryptographic JWT verification, expiration, malformed/missing rejection.
2. User data isolation: user_anime_progress queries strictly scoped to authenticated user.
3. Poster SSRF protection: domain allowlist, loopback/private IP blocking, redirect guards, magic bytes.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.cloud import (
    DEFAULT_JWT_SECRET,
    _resolve_user_id,
    verify_jwt_token,
)
from app.api.link_episode import (
    _is_safe_host,
    _validate_image_bytes,
    _validate_safe_ip,
)
from app.main import app


def _mint_jwt(
    payload: dict,
    secret: str = DEFAULT_JWT_SECRET,
    header: dict | None = None,
) -> str:
    h = header or {"alg": "HS256", "typ": "JWT"}
    enc_h = base64.urlsafe_b64encode(json.dumps(h).encode()).decode().rstrip("=")
    enc_p = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    data = f"{enc_h}.{enc_p}".encode("utf-8")
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), data, hashlib.sha256).digest()).decode().rstrip("=")
    return f"{enc_h}.{enc_p}.{sig}"


# --- 1. Authentication Tests ---

def test_jwt_valid_signature_and_claims():
    payload = {
        "sub": "user_alpha_123",
        "exp": int(time.time()) + 3600,
        "iss": "kiroku-auth",
        "aud": "kiroku-app"
    }
    token = _mint_jwt(payload)
    verified = verify_jwt_token(token)
    assert verified is not None
    assert verified["sub"] == "user_alpha_123"

    user_id = _resolve_user_id(f"Bearer {token}")
    assert user_id == "user_alpha_123"


def test_jwt_reject_expired():
    payload = {
        "sub": "user_expired",
        "exp": int(time.time()) - 10,
        "iss": "kiroku-auth",
    }
    token = _mint_jwt(payload)
    assert verify_jwt_token(token) is None
    with pytest.raises(HTTPException) as exc_info:
        _resolve_user_id(f"Bearer {token}")
    assert exc_info.value.status_code == 401


def test_jwt_reject_tampered_payload():
    payload = {"sub": "user_normal", "exp": int(time.time()) + 3600}
    token = _mint_jwt(payload)
    parts = token.split(".")
    # Tamper with payload to escalate identity
    tampered_p = base64.urlsafe_b64encode(json.dumps({"sub": "admin", "exp": int(time.time()) + 3600}).encode()).decode().rstrip("=")
    tampered_token = f"{parts[0]}.{tampered_p}.{parts[2]}"

    assert verify_jwt_token(tampered_token) is None
    with pytest.raises(HTTPException) as exc_info:
        _resolve_user_id(f"Bearer {tampered_token}")
    assert exc_info.value.status_code == 401


def test_jwt_reject_invalid_signature():
    payload = {"sub": "user_forged", "exp": int(time.time()) + 3600}
    forged_token = _mint_jwt(payload, secret="attacker-random-secret")
    assert verify_jwt_token(forged_token) is None
    with pytest.raises(HTTPException) as exc_info:
        _resolve_user_id(f"Bearer {forged_token}")
    assert exc_info.value.status_code == 401


def test_auth_reject_missing_and_malformed():
    with pytest.raises(HTTPException) as exc1:
        _resolve_user_id(None)
    assert exc1.value.status_code == 401

    with pytest.raises(HTTPException) as exc2:
        _resolve_user_id("")
    assert exc2.value.status_code == 401

    with pytest.raises(HTTPException) as exc3:
        _resolve_user_id("Basic someuser:pass")
    assert exc3.value.status_code == 401

    with pytest.raises(HTTPException) as exc4:
        _resolve_user_id("Bearer ")
    assert exc4.value.status_code == 401


def test_auth_production_rejects_default_dev_secret(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    payload = {"sub": "prod_user", "exp": int(time.time()) + 3600}
    token = _mint_jwt(payload, secret=DEFAULT_JWT_SECRET)
    assert verify_jwt_token(token) is None


# --- 2. User Data Isolation Tests ---

def test_user_anime_progress_isolation(monkeypatch):
    """Verify that User A and User B cannot read each other's progress even with matching series IDs."""
    from app.api.cloud import get_user_anime_progress, save_user_anime_progress, AnimeProgressRecord

    # Mock in-memory database store for Turso
    db: list[dict] = []

    mock_turso = MagicMock()
    mock_turso.is_configured = True

    def mock_execute(sql, args=None):
        args = args or []
        sql_upper = sql.upper().strip()
        if "INSERT INTO USER_ANIME_PROGRESS" in sql_upper:
            # (user_id, series_id, episode_number, last_position_ms, duration_ms, ...)
            uid, sid, ep_num = args[0], args[1], args[2]
            pos, dur, comp, mined = args[3], args[4], args[5], args[6]
            rec = {
                "user_id": uid,
                "series_id": sid,
                "episode_number": ep_num,
                "last_position_ms": pos,
                "duration_ms": dur,
                "completed": comp,
                "mined_card_count": mined,
                "last_watched_at": args[7],
                "poster_url": args[8],
                "series_title": args[9],
                "title_native": args[10],
                "title_english": args[11],
                "synopsis": args[12],
                "media_type": args[13],
            }
            # Remove existing matching primary key
            for idx, existing in enumerate(list(db)):
                if existing["user_id"] == uid and existing["series_id"] == sid and existing["episode_number"] == ep_num:
                    db.pop(idx)
                    break
            db.append(rec)
            return []
        elif "SELECT" in sql_upper and "FROM USER_ANIME_PROGRESS" in sql_upper:
            uid = args[0]
            sid = args[1] if len(args) > 1 else None
            results = [r for r in db if r["user_id"] == uid]
            if sid:
                results = [r for r in results if r["series_id"] == sid]
            return results
        return []

    mock_turso.execute.side_effect = mock_execute
    monkeypatch.setattr("app.api.cloud.get_turso_client", lambda: mock_turso)

    token_a = _mint_jwt({"sub": "user_alice", "exp": int(time.time()) + 3600})
    token_b = _mint_jwt({"sub": "user_bob", "exp": int(time.time()) + 3600})

    # Alice saves progress on Frieren ep 1 (pos: 150000ms)
    save_user_anime_progress(
        AnimeProgressRecord(
            series_id="frieren-beyond-journey",
            series_title="Frieren",
            episode_number=1,
            last_position_ms=150000,
            duration_ms=1440000,
            completed=0,
            mined_card_count=5
        ),
        authorization=f"Bearer {token_a}"
    )

    # Bob saves progress on the SAME series ep 1 (pos: 45000ms)
    save_user_anime_progress(
        AnimeProgressRecord(
            series_id="frieren-beyond-journey",
            series_title="Frieren",
            episode_number=1,
            last_position_ms=45000,
            duration_ms=1440000,
            completed=0,
            mined_card_count=1
        ),
        authorization=f"Bearer {token_b}"
    )

    # Alice queries Frieren progress
    res_a = get_user_anime_progress(series_id="frieren-beyond-journey", authorization=f"Bearer {token_a}")
    assert len(res_a["progress"]) == 1
    assert res_a["progress"][0]["last_position_ms"] == 150000
    assert res_a["progress"][0]["mined_card_count"] == 5

    # Bob queries Frieren progress
    res_b = get_user_anime_progress(series_id="frieren-beyond-journey", authorization=f"Bearer {token_b}")
    assert len(res_b["progress"]) == 1
    assert res_b["progress"][0]["last_position_ms"] == 45000
    assert res_b["progress"][0]["mined_card_count"] == 1

    # Bob cannot see Alice's data, Alice cannot see Bob's data
    assert res_a["progress"][0]["last_position_ms"] != res_b["progress"][0]["last_position_ms"]


# --- 3. Poster Proxy SSRF Security Tests ---

def test_poster_safe_host_allowlist():
    assert _is_safe_host("anilist.co") is True
    assert _is_safe_host("s4.anilist.co") is True
    assert _is_safe_host("i.ytimg.com") is True
    assert _is_safe_host("cdn.myanimelist.net") is True

    # Attackers trying suffix collision
    assert _is_safe_host("evil-anilist.co") is False
    assert _is_safe_host("attackerytimg.com") is False
    assert _is_safe_host("localhost") is False
    assert _is_safe_host("127.0.0.1") is False
    assert _is_safe_host("169.254.169.254") is False


def test_poster_ip_anti_ssrf_blocking():
    # Loopback
    with pytest.raises(HTTPException) as exc_loopback:
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 0))]):
            _validate_safe_ip("anilist.co")
    assert exc_loopback.value.status_code == 403

    # Cloud metadata link-local
    with pytest.raises(HTTPException) as exc_meta:
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("169.254.169.254", 0))]):
            _validate_safe_ip("anilist.co")
    assert exc_meta.value.status_code == 403

    # Private LAN
    with pytest.raises(HTTPException) as exc_lan:
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("192.168.1.50", 0))]):
            _validate_safe_ip("anilist.co")
    assert exc_lan.value.status_code == 403


def test_poster_magic_bytes_validation():
    # JPEG magic bytes
    jpeg_data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00"
    assert _validate_image_bytes(jpeg_data) == "image/jpeg"

    # PNG magic bytes
    png_data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    assert _validate_image_bytes(png_data) == "image/png"

    # HTML / Script attack
    html_data = b"<!DOCTYPE html><html><script>alert(1)</script></html>"
    with pytest.raises(HTTPException) as exc_html:
        _validate_image_bytes(html_data)
    assert exc_html.value.status_code == 400


def test_poster_endpoint_via_client():
    client = TestClient(app)

    # Disallowed host
    resp = client.get("/api/link/poster?url=https://evil.com/poster.jpg")
    assert resp.status_code == 403

    # Userinfo in URL
    resp_userinfo = client.get("/api/link/poster?url=https://user:pass@anilist.co/poster.jpg")
    assert resp_userinfo.status_code == 400

