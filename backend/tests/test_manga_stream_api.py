import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.manga_stream import get_manga_dir, _reset_manga_state_for_test

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_manga_state():
    _reset_manga_state_for_test()
    yield
    _reset_manga_state_for_test()


def test_manga_lan_info():
    res = client.get("/api/manga/lan-info")
    assert res.status_code == 200
    data = res.json()
    assert "lan_ip" in data
    assert "port" in data
    assert "base_url" in data
    assert "books" in data
    assert isinstance(data["books"], list)


def test_manga_ticket_and_streaming():
    manga_dir = get_manga_dir()
    test_file = manga_dir / "volume_test.pdf"
    content = b"%PDF-1.4 streamable manga volume test content with bytes 1234567890"
    test_file.write_bytes(content)

    try:
        # 1. Issue ticket for existing book
        ticket_res = client.post("/api/manga/ticket", json={"book_id": "volume_test"})
        assert ticket_res.status_code == 200
        ticket_data = ticket_res.json()
        assert "ticket" in ticket_data
        assert ticket_data["book_id"] == "volume_test"
        ticket = ticket_data["ticket"]

        # 2. Stream without ticket should be 422/401
        err_res = client.get("/api/manga/stream/volume_test")
        assert err_res.status_code in {401, 422}

        # 3. Stream with invalid ticket should be 401
        invalid_res = client.get("/api/manga/stream/volume_test?ticket=invalid_ticket_xyz")
        assert invalid_res.status_code == 401

        # 4. Stream full binary with valid ticket
        full_res = client.get(f"/api/manga/stream/volume_test?ticket={ticket}")
        assert full_res.status_code == 200
        assert full_res.content == content
        assert "pdf" in full_res.headers.get("content-type", "").lower()

        # 5. Stream partial range (HTTP 206)
        range_res = client.get(
            f"/api/manga/stream/volume_test?ticket={ticket}",
            headers={"Range": "bytes=0-7"}
        )
        assert range_res.status_code == 206
        assert range_res.content == content[0:8]
        assert "bytes 0-7/" in range_res.headers.get("content-range", "")

    finally:
        if test_file.exists():
            test_file.unlink()


def test_manga_ticket_missing_book():
    res = client.post("/api/manga/ticket", json={"book_id": "nonexistent_book_999"})
    assert res.status_code == 404


def test_manga_upload_and_stream():
    content = b"%PDF-1.4 uploaded manga buffer for lan phone streaming"
    upload_res = client.post(
        "/api/manga/upload?book_id=uploaded_vol_1&filename=vol1.pdf&title=Uploaded+Volume+1",
        content=content,
        headers={"Content-Type": "application/octet-stream"}
    )
    assert upload_res.status_code == 200
    assert upload_res.json()["uploaded"] is True

    # Now ticket creation succeeds immediately
    ticket_res = client.post("/api/manga/ticket", json={"book_id": "uploaded_vol_1"})
    assert ticket_res.status_code == 200
    ticket = ticket_res.json()["ticket"]

    # Streaming the uploaded file works
    stream_res = client.get(f"/api/manga/stream/uploaded_vol_1?ticket={ticket}")
    assert stream_res.status_code == 200
    assert stream_res.content == content


def test_manga_lan_host_header_allowed():
    # LAN phones on Wi-Fi access via RFC 1918 IPs (192.168.x.x, 10.x.x.x, 172.16.x.x)
    for host in ["192.168.1.105:21828", "10.0.0.42:21828", "172.20.10.3:21828"]:
        res = client.get("/api/manga/lan-info", headers={"Host": host})
        assert res.status_code == 200, f"Expected host {host} to be allowed"



