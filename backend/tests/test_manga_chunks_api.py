import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_manga_chunks_lifecycle(client):
    book_id = "test_chunked_book_vol1"
    headers = {"Authorization": "Bearer mock-test-token"}

    # Mock Turso in-memory tables
    fake_books = {}
    fake_chunks = {}

    def mock_execute(sql, args=None):
        args = args or []
        sql_upper = sql.strip().upper()
        if "INSERT INTO USER_MANGA_CHUNKS" in sql_upper:
            # [user_id, book_id, chunk_index, total_chunks, chunk_data, now_sec]
            key = (args[0], args[1], args[2])
            fake_chunks[key] = {
                "chunk_index": args[2],
                "total_chunks": args[3],
                "chunk_data": args[4],
                "created_at": args[5]
            }
            return []
        if "SELECT CHUNK_INDEX, TOTAL_CHUNKS" in sql_upper:
            # user_id, book_id
            matched = [v for k, v in fake_chunks.items() if k[0] == args[0] and k[1] == args[1]]
            matched.sort(key=lambda x: x["chunk_index"])
            return matched
        if "INSERT INTO USER_MANGA_BOOKS" in sql_upper:
            fake_books[args[1]] = {"book_id": args[1], "title": args[2], "has_file": False}
            return []
        if "DELETE FROM USER_MANGA_CHUNKS" in sql_upper:
            for k in list(fake_chunks.keys()):
                if k[0] == args[0] and k[1] == args[1]:
                    del fake_chunks[k]
            return []
        if "SELECT B.BOOK_ID" in sql_upper:
            res = []
            for b_id, b in fake_books.items():
                has_chunks = any(k[1] == b_id for k in fake_chunks)
                res.append({
                    "book_id": b_id,
                    "title": b["title"],
                    "filename": f"{b_id}.cbz",
                    "file_type": "cbz",
                    "size": 6000000,
                    "total_pages": 150,
                    "uploaded_at": 1000,
                    "cover_url": "",
                    "current_page": 1,
                    "completed": False,
                    "last_read_at": None,
                    "has_file": has_chunks
                })
            return res
        return []

    def mock_fetchone(sql, args=None):
        args = args or []
        sql_upper = sql.strip().upper()
        if "FROM USER_MANGA_CHUNKS" in sql_upper:
            # user_id, book_id, chunk_index
            key = (args[0], args[1], args[2])
            return fake_chunks.get(key)
        return None

    mock_turso = MagicMock()
    mock_turso.is_configured = True
    mock_turso.execute.side_effect = mock_execute
    mock_turso.fetchone.side_effect = mock_fetchone
    mock_turso.execute_transaction.side_effect = lambda stmts: [mock_execute(s[0], s[1]) for s in stmts]

    with patch("app.api.cloud.get_turso_client", return_value=mock_turso):
        # 1. Register book metadata
        meta_payload = {
            "book_id": book_id,
            "title": "Test Chunked Manga Vol 1",
            "filename": "test_vol1.cbz",
            "file_type": "cbz",
            "size": 6000000,
            "total_pages": 150,
            "file_data": "",
            "cover_url": "data:image/jpeg;base64,mock"
        }
        res = client.post("/api/user/manga/upload", json=meta_payload, headers=headers)
        assert res.status_code == 200

        # 2. Upload 3 chunks
        chunks_data = ["AAAABBBB", "CCCCDDDD", "EEEEFFFF"]
        for idx, data in enumerate(chunks_data):
            chunk_res = client.post(
                f"/api/user/manga/{book_id}/chunk",
                json={"chunk_index": idx, "total_chunks": 3, "chunk_data": data},
                headers=headers
            )
            assert chunk_res.status_code == 200
            assert chunk_res.json()["chunk_index"] == idx

        # 3. Verify chunks metadata
        info_res = client.get(f"/api/user/manga/{book_id}/chunks", headers=headers)
        assert info_res.status_code == 200
        info_data = info_res.json()
        assert info_data["total_chunks"] == 3
        assert info_data["uploaded_count"] == 3
        assert info_data["complete"] is True

        # 4. Download each chunk and verify
        assembled = ""
        for idx in range(3):
            c_res = client.get(f"/api/user/manga/{book_id}/chunk/{idx}", headers=headers)
            assert c_res.status_code == 200
            c_json = c_res.json()
            assert c_json["chunk_index"] == idx
            assembled += c_json["chunk_data"]
        assert assembled == "AAAABBBBCCCCDDDDEEEEFFFF"

        # 5. Verify /api/user/manga/list reports has_file as True
        list_res = client.get("/api/user/manga/list", headers=headers)
        assert list_res.status_code == 200
        books = list_res.json().get("books", [])
        matching = [b for b in books if b["id"] == book_id or b["book_id"] == book_id]
        assert len(matching) == 1
        assert matching[0]["has_file"] is True

        # 6. Delete book and verify chunks are cleaned up
        del_res = client.delete(f"/api/user/manga/{book_id}", headers=headers)
        assert del_res.status_code == 200
        after_info = client.get(f"/api/user/manga/{book_id}/chunks", headers=headers)
        assert after_info.json()["uploaded_count"] == 0
