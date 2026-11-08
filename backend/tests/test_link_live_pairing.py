import pytest
from starlette.testclient import TestClient

from app.main import app
from app.api.study.auth import set_study_api_token, clear_study_api_token
from app.config import get_allowed_extension_ids
from app.services.legacy_api_auth import legacy_api_auth


def test_live_pairing_and_link_ws(monkeypatch):
    """Live pairing flow: desktop register -> ext redeem -> ws connect."""
    monkeypatch.setenv("KIROKU_EXTENSION_PAIRING_ENABLED", "1")
    set_study_api_token("desktop-launch-token")
    client = TestClient(app)

    try:
        # Clean legacy auth state for test
        legacy_api_auth.revoke_all_extension_tokens()

        code = "test-live-pair-code-12345"
        # Desktop registers with default legacy scopes (or empty)
        reg_resp = client.post(
            "/api/auth/extension-pairings/register",
            headers={"Authorization": "Bearer desktop-launch-token"},
            json={"code": code},
        )
        assert reg_resp.status_code == 200

        ext_id = next(iter(get_allowed_extension_ids()), "chnnchfpjephcpgamfkjnfobfnjabika")
        origin = f"chrome-extension://{ext_id}"

        # Redeem pairing
        redeem_resp = client.post(
            "/api/auth/extension-pairings/redeem",
            headers={"Origin": origin},
            json={"code": code},
        )
        assert redeem_resp.status_code == 200
        token_data = redeem_resp.json()
        ext_token = token_data["token"]
        assert ext_token

        # Connect WebSocket using the redeemed token without any bypass token
        # Expect hello.ok response.
        # In A0, this is expected RED because default scopes are {"legacy:write"}
        # and hub requires "link:rw", so it will close with 4401 or fail hello.
        with client.websocket_connect(
            "/api/link/ws",
            headers={"Origin": origin},
        ) as ws:
            ws.send_json({
                "type": "hello",
                "version": 1,
                "role": "ext",
                "token": ext_token,
                "client": "extension-test",
            })
            msg = ws.receive_json()
            assert msg.get("type") == "hello.ok", f"Expected hello.ok but got: {msg}"
    finally:
        clear_study_api_token()
