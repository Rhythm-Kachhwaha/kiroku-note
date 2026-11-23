import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from app.main import app

client = TestClient(app)

def test_jimaku_key_local_and_cloud_sync():
    # Test setting and getting jimaku key via secret store & turso
    with patch("app.services.secret_store.get_secret_store") as mock_secret_store:
        fake_store = MagicMock()
        fake_data = {}
        fake_store.get_secret.side_effect = lambda k: fake_data.get(k)
        fake_store.set_secret.side_effect = lambda k, v: fake_data.update({k: v})
        fake_store.delete_secret.side_effect = lambda k: fake_data.pop(k, None)
        mock_secret_store.return_value = fake_store

        # 1. Initially empty
        res = client.get("/api/link/jimaku-key")
        assert res.status_code == 200
        assert res.json() == {"has_key": False, "api_key": ""}

        # 2. Save key
        save_res = client.post("/api/link/jimaku-key", json={"api_key": "test_jimaku_token_123"})
        assert save_res.status_code == 200
        assert save_res.json()["ok"] is True
        assert save_res.json()["api_key"] == "test_jimaku_token_123"

        # 3. Retrieve key
        get_res = client.get("/api/link/jimaku-key")
        assert get_res.status_code == 200
        assert get_res.json()["has_key"] is True
        assert get_res.json()["api_key"] == "test_jimaku_token_123"
