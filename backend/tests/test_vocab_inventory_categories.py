"""Tests for Vocabulary Inventory POS and Category Filtering."""
from pathlib import Path
import sqlite3
import pytest
from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app


@pytest.fixture
def inventory_test_db(tmp_path: Path) -> Path:
    db_file = tmp_path / "test_inventory_cat.sqlite"
    init_db(db_file)
    with sqlite3.connect(str(db_file)) as conn:
        # Insert word_states
        words = [
            ("ゆっくり", "ゆっくり", "slowly", "N5"),
            ("ざあざあ", "ざあざあ", "pouring rain", "N3"),
            ("開ける", "あける", "to open", "N5"),
            ("開く", "あく", "to open", "N5"),
            ("食べる", "たべる", "to eat", "N5"),
            ("新しい", "あたらしい", "new", "N5"),
            ("静か", "しずか", "quiet", "N5"),
            ("本", "ほん", "book", "N5"),
            ("コンピューター", "コンピューター", "computer", "N5"),
        ]
        for expr, read, meaning, lvl in words:
            conn.execute(
                """
                INSERT INTO word_states (expression, reading, state, updated_at)
                VALUES (?, ?, 'known', '2026-11-13T10:00:00Z')
                """,
                (expr, read),
            )
            conn.execute(
                """
                INSERT INTO cards (expression, reading, meaning, jlpt_level, source_type, normalized_expression, normalized_reading, normalized_deck_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'quick_add', ?, ?, 'default', '2026-11-13T10:00:00Z', '2026-11-13T10:00:00Z')
                """,
                (expr, read, meaning, lvl, expr, read),
            )

        # Map sequence IDs in word_categories
        # 101: 開ける (vt), 102: 開く (vi), 103: ゆっくり (adverb), 104: ざあざあ (onomatopoeia:giongo)
        conn.execute("UPDATE word_states SET sequence_id = 101 WHERE expression = '開ける'")
        conn.execute("UPDATE word_states SET sequence_id = 102 WHERE expression = '開く'")
        conn.execute("UPDATE word_states SET sequence_id = 103 WHERE expression = 'ゆっくり'")
        conn.execute("UPDATE word_states SET sequence_id = 104 WHERE expression = 'ざあざあ'")

        conn.execute(
            "INSERT INTO word_categories (sequence_id, category, subtype, updated_at) VALUES (?, ?, ?, ?)",
            (101, "verb_transitive", "", "2026-11-13T10:00:00Z"),
        )
        conn.execute(
            "INSERT INTO word_categories (sequence_id, category, subtype, updated_at) VALUES (?, ?, ?, ?)",
            (102, "verb_intransitive", "", "2026-11-13T10:00:00Z"),
        )
        conn.execute(
            "INSERT INTO word_categories (sequence_id, category, subtype, updated_at) VALUES (?, ?, ?, ?)",
            (103, "adverb", "", "2026-11-13T10:00:00Z"),
        )
        conn.execute(
            "INSERT INTO word_categories (sequence_id, category, subtype, updated_at) VALUES (?, ?, ?, ?)",
            (104, "onomatopoeia", "giongo", "2026-11-13T10:00:00Z"),
        )
        conn.commit()

    return db_file


def test_filter_by_adverb_and_onomatopoeia(monkeypatch, inventory_test_db: Path):
    monkeypatch.setenv("KIROKU_DB_PATH", str(inventory_test_db))
    client = TestClient(app)

    # Filter adverb
    res_adv = client.get("/api/vocab/inventory?category=adverb&include_reference=false")
    assert res_adv.status_code == 200
    items_adv = res_adv.json()["items"]
    expressions_adv = [i["expression"] for i in items_adv]
    assert "ゆっくり" in expressions_adv

    # Filter onomatopoeia
    res_on = client.get("/api/vocab/inventory?category=onomatopoeia&include_reference=false")
    assert res_on.status_code == 200
    items_on = res_on.json()["items"]
    expressions_on = [i["expression"] for i in items_on]
    assert "ざあざあ" in expressions_on

    # Filter on-mim alias
    res_onmim = client.get("/api/vocab/inventory?category=on-mim&include_reference=false")
    assert res_onmim.status_code == 200
    items_onmim = res_onmim.json()["items"]
    assert any(i["expression"] == "ざあざあ" for i in items_onmim)


def test_filter_by_transitive_and_intransitive_verbs(monkeypatch, inventory_test_db: Path):
    monkeypatch.setenv("KIROKU_DB_PATH", str(inventory_test_db))
    client = TestClient(app)

    # Filter verb_transitive
    res_vt = client.get("/api/vocab/inventory?category=verb_transitive&include_reference=false")
    assert res_vt.status_code == 200
    items_vt = res_vt.json()["items"]
    expressions_vt = [i["expression"] for i in items_vt]
    assert "開ける" in expressions_vt
    assert "開く" not in expressions_vt

    # Filter vt alias
    res_vt_alias = client.get("/api/vocab/inventory?category=vt&include_reference=false")
    assert res_vt_alias.status_code == 200
    assert any(i["expression"] == "開ける" for i in res_vt_alias.json()["items"])

    # Filter verb_intransitive
    res_vi = client.get("/api/vocab/inventory?category=verb_intransitive&include_reference=false")
    assert res_vi.status_code == 200
    items_vi = res_vi.json()["items"]
    expressions_vi = [i["expression"] for i in items_vi]
    assert "開く" in expressions_vi
    assert "開ける" not in expressions_vi


def test_filter_by_adjectives_and_nouns(monkeypatch, inventory_test_db: Path):
    monkeypatch.setenv("KIROKU_DB_PATH", str(inventory_test_db))
    client = TestClient(app)

    # Filter adjective
    res_adj = client.get("/api/vocab/inventory?category=adjective&include_reference=false")
    assert res_adj.status_code == 200
    items_adj = res_adj.json()["items"]
    expressions_adj = [i["expression"] for i in items_adj]
    assert "新しい" in expressions_adj

    # Filter adj-i alias
    res_adji = client.get("/api/vocab/inventory?category=adj-i&include_reference=false")
    assert res_adji.status_code == 200
    assert any(i["expression"] == "新しい" for i in res_adji.json()["items"])

    # Filter noun
    res_noun = client.get("/api/vocab/inventory?category=noun&include_reference=false")
    assert res_noun.status_code == 200
    items_noun = res_noun.json()["items"]
    expressions_noun = [i["expression"] for i in items_noun]
    assert "本" in expressions_noun
