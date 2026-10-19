"""
Tests for Task 4 & Task 5:
- Rich Card Parsing & Sanitized HTML Rendering
- Clean meaning/reading/sentence extraction from kn-card
- Schema persistence for raw_html and has_media in SQLite and Postgres
"""

import pytest
from kiroku_cloud_queue.anki_mirror import (
    extract_rich_card_html,
    map_fields,
    clean_field,
)
from kiroku_cloud_queue.queue_store import SqliteQueueStore

SAMPLE_KN_CARD_HTML = """
<div class="kn-card">
<style>
.kn-card { color: #1f2937; }
</style>
<script>alert('xss');</script>
<div class="kn-reading">
  <span class="kn-kana">ちゅうしゃじょう</span>
</div>
<hr class="kn-divider">

<div class="kn-meaning"><span class="kn-pos">[noun]</span> parking lot, car park, carpark, parking garage</div>

<div class="kn-kanji-card">
  <div class="kn-kanji-header">
    <span class="kn-kanji-char">駐</span>
    <span class="kn-tag">15 strokes</span>
  </div>
  <div class="kn-kanji-readings">
    <div class="kn-kanji-reading-row"><span class="kn-reading-lbl">Onyomi</span> <span class="kn-onyomi">チュウ</span></div>
  </div>
  <div class="kn-kanji-meanings">stop-over, reside in, resident</div>
</div>

<div class="kn-example-block">
  <p class="kn-example-ja">その<ruby>駐<rt>ちゅう</rt></ruby><ruby>車<rt>しゃ</rt></ruby><ruby>場<rt>じょう</rt></ruby>は<ruby>無<rt>む</rt></ruby><ruby>料<rt>りょう</rt></ruby>だ。</p>
  <p class="kn-example-en">The parking lot is free of charge.</p>
</div>
[sound:audio_chushajou.mp3]
</div>
"""


def test_extract_rich_card_html_sanitizes_and_preserves_structure():
    raw_fields = {
        "Front": {"value": "駐車場"},
        "Back": {"value": SAMPLE_KN_CARD_HTML},
    }
    rich_html = extract_rich_card_html(raw_fields)

    # Must preserve ruby tags
    assert "<ruby>駐<rt>ちゅう</rt></ruby>" in rich_html
    # Must preserve kanji card
    assert "kn-kanji-char" in rich_html
    assert "駐" in rich_html
    # Must preserve example sentences
    assert "The parking lot is free of charge." in rich_html
    # Must strip script tags
    assert "<script" not in rich_html
    assert "alert('xss')" not in rich_html
    # Must strip style tags (since scoped styles are defined in dashboard)
    assert "<style" not in rich_html
    # Must strip [sound:...] tags
    assert "[sound:" not in rich_html


def test_map_fields_extracts_clean_fields_from_kn_card():
    raw_fields = {
        "Front": {"value": "駐車場"},
        "Back": {"value": SAMPLE_KN_CARD_HTML},
    }
    mapped = map_fields(raw_fields)

    assert mapped["expression"] == "駐車場"
    assert mapped["reading"] == "ちゅうしゃじょう"
    # Meaning must be the clean primary definition, NOT contaminated with KANJIDIC stroke counts/onyomi
    assert "parking lot" in mapped["meaning"]
    assert "KANJIDIC" not in mapped["meaning"]
    assert "Onyomi" not in mapped["meaning"]
    # Sentence and sentence meaning extracted
    assert "その駐車場は無料だ。" in mapped["sentence"]
    assert "The parking lot is free of charge." in mapped["sentence_meaning"]


def test_sqlite_store_persists_raw_html_and_has_media(tmp_path):
    db_path = tmp_path / "test_store.db"
    store = SqliteQueueStore(db_path=str(db_path))

    card_row = {
        "card_id": 123456789,
        "note_id": 987654321,
        "deck_name": "N3 vocabs",
        "model_name": "Kiroku Note",
        "expression": "駐車場",
        "reading": "ちゅうしゃじょう",
        "meaning": "parking lot",
        "sentence": "その駐車場は無料だ。",
        "sentence_meaning": "The parking lot is free of charge.",
        "jlpt_level": "N3",
        "state": "young",
        "queue_code": 2,
        "interval_days": 10,
        "reps": 3,
        "lapses": 0,
        "again_count_10": 0,
        "reviews_10": 3,
        "again_rate_10": 0.0,
        "avg_time_ms": 2500,
        "difficulty_score": 35.0,
        "difficulty_label": "solid",
        "is_leech": False,
        "due_in_days": 5,
        "created_at": "2026-01-01T00:00:00Z",
        "raw_html": "<div class=\"kn-card\"><p>Rich content</p></div>",
        "has_media": True,
    }

    count = store.upsert_anki_cards([card_row])
    assert count == 1

    fetched = store.get_anki_card(123456789)
    assert fetched is not None
    assert fetched["raw_html"] == "<div class=\"kn-card\"><p>Rich content</p></div>"
    assert fetched["has_media"] is True or fetched["has_media"] == 1


def test_extract_image_filenames():
    from kiroku_cloud_queue.anki_mirror import extract_image_filenames

    raw_fields = {
        "Front": {"value": "駐車場"},
        "Back": {"value": '<p>Image: <img src="paste-12345.png"> and <img src=\'test_photo.jpg\'></p>'},
        "Extra": {"value": '<img src="https://example.com/ignored.png">'},
    }
    fnames = extract_image_filenames(raw_fields)
    assert "paste-12345.png" in fnames
    assert "test_photo.jpg" in fnames
    # Remote http/https urls should not be treated as local Anki media
    assert "https://example.com/ignored.png" not in fnames


def test_compress_image_webp():
    import io
    from PIL import Image
    from kiroku_cloud_queue.anki_mirror import compress_image_webp

    # Create a 1200x900 test image in memory
    img = Image.new("RGB", (1200, 900), color=(255, 128, 64))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    webp_bytes = compress_image_webp(png_bytes, max_dim=800, quality=75)
    assert len(webp_bytes) > 0
    assert len(webp_bytes) < len(png_bytes)

    # Verify compressed dimensions
    out_img = Image.open(io.BytesIO(webp_bytes))
    assert out_img.format == "WEBP"
    assert out_img.width <= 800
    assert out_img.height <= 800


def test_sqlite_media_save_and_flush(tmp_path):
    db_path = tmp_path / "test_media.db"
    store = SqliteQueueStore(db_path=str(db_path))

    # Add young card (interval=10) and mature card (interval=30)
    cards = [
        {
            "card_id": 1001,
            "note_id": 2001,
            "deck_name": "N3",
            "model_name": "Basic",
            "expression": "若い",
            "interval_days": 10,
            "state": "young",
        },
        {
            "card_id": 1002,
            "note_id": 2002,
            "deck_name": "N3",
            "model_name": "Basic",
            "expression": "成熟",
            "interval_days": 30,
            "state": "mature",
        },
    ]
    store.upsert_anki_cards(cards)

    # Save media for both
    dummy_img = b"RIFF\x20\x00\x00\x00WEBPVP8 \x14\x00\x00\x00"
    store.save_card_media(1001, "young.webp", dummy_img)
    store.save_card_media(1002, "mature.webp", dummy_img)

    # Check both saved
    assert store.get_card_media(1001) is not None
    assert store.get_card_media(1002) is not None
    assert store.get_anki_card(1001)["has_media"] == 1
    assert store.get_anki_card(1002)["has_media"] == 1

    # Flush mature card images (>= 21 days)
    flushed_count = store.flush_mature_card_media(min_interval_days=21)
    assert flushed_count == 1

    # Young card still has media
    assert store.get_card_media(1001) is not None
    assert store.get_anki_card(1001)["has_media"] == 1

    # Mature card media is evicted to conserve cloud storage
    assert store.get_card_media(1002) is None
    assert store.get_anki_card(1002)["has_media"] == 0


def test_server_media_endpoints(tmp_path, monkeypatch):
    import base64
    from fastapi.testclient import TestClient
    from kiroku_cloud_queue import server

    db_path = tmp_path / "test_api_media.db"
    store = SqliteQueueStore(db_path=str(db_path))
    monkeypatch.setattr(server, "store", store)
    monkeypatch.setenv("WORKER_TOKEN", "test-worker-token")
    monkeypatch.setenv("SUBMIT_TOKEN", "test-submit-token")

    # Seed card
    store.upsert_anki_cards([{
        "card_id": 5001,
        "note_id": 6001,
        "deck_name": "N3",
        "model_name": "Basic",
        "expression": "写真",
        "interval_days": 25,
        "state": "mature",
    }])

    client = TestClient(server.app)

    # 1. 404 on card without media
    r404 = client.get("/api/cards/5001/media")
    assert r404.status_code == 404

    # 2. Push media batch
    dummy_webp = b"RIFF\x20\x00\x00\x00WEBPVP8 \x14\x00\x00\x00"
    b64_str = base64.b64encode(dummy_webp).decode("ascii")
    push_resp = client.post(
        "/api/anki/media",
        headers={"Authorization": "Bearer test-worker-token"},
        json={"media": [{"card_id": 5001, "media_name": "shashin.webp", "mime_type": "image/webp", "image_webp_b64": b64_str}]},
    )
    assert push_resp.status_code == 200
    assert push_resp.json()["saved"] == 1

    # 3. GET media
    get_resp = client.get("/api/cards/5001/media")
    assert get_resp.status_code == 200
    assert get_resp.content == dummy_webp
    assert "image/webp" in get_resp.headers["content-type"]
    assert "public, max-age=86400" in get_resp.headers["cache-control"]

    # 4. Flush mature media
    flush_resp = client.post(
        "/api/anki/media/flush?min_interval_days=21",
        headers={"Authorization": "Bearer test-submit-token"},
    )
    assert flush_resp.status_code == 200
    assert flush_resp.json()["flushed"] == 1

    # 5. Verify evicted
    r_after = client.get("/api/cards/5001/media")
    assert r_after.status_code == 404

