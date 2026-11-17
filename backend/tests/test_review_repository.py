import pytest
from datetime import datetime, timezone, timedelta
from app.db.connection import init_db, db_session
from app.repositories.review_repository import ReviewRepository

def test_deck_settings_crud_and_explanations(tmp_path):
    db_file = tmp_path / "test_kiroku.db"
    init_db(db_file)
    
    repo = ReviewRepository(db_path=db_file)
    settings = repo.get_deck_settings_with_explanations(deck_name="Default")
    
    assert "new_cards_per_day" in settings["values"]
    assert settings["values"]["new_cards_per_day"] == 20
    assert "easy_initial_cap_days" in settings["values"]
    assert settings["values"]["easy_initial_cap_days"] == 6
    assert "desired_retention" in settings["values"]
    assert settings["values"]["desired_retention"] == 0.90
    
    # Explanations must be present for every key
    assert "new_cards_per_day" in settings["explanations"]
    assert "easy_initial_cap_days" in settings["explanations"]
    assert "desired_retention" in settings["explanations"]

    # Test update
    updated = repo.update_deck_settings("Default", {
        "new_cards_per_day": 25,
        "easy_initial_cap_days": 8,
        "desired_retention": 0.85
    })
    assert updated["new_cards_per_day"] == 25
    assert updated["easy_initial_cap_days"] == 8
    assert updated["desired_retention"] == 0.85

def test_boost_limits_today(tmp_path):
    db_file = tmp_path / "test_kiroku.db"
    init_db(db_file)
    
    repo = ReviewRepository(db_path=db_file)
    boosted = repo.boost_limits_today("Default", add_new=5, add_reviews=10)
    assert boosted["extra_new_today"] == 5
    assert boosted["extra_reviews_today"] == 10

def test_fsrs_and_review_lifecycle(tmp_path):
    db_file = tmp_path / "test_kiroku.db"
    init_db(db_file)
    now = datetime.now(timezone.utc).isoformat()
    with db_session(db_file) as conn:
        conn.execute(
            """INSERT INTO cards (
                expression, reading, meaning, normalized_expression,
                normalized_reading, normalized_deck_name, created_at, updated_at
            ) VALUES ('食べる', 'たべる', 'to eat', '食べる', 'たべる', 'default', ?, ?)""",
            (now, now)
        )
        card_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()

    repo = ReviewRepository(db_path=db_file)
    
    # Get or create FSRS record
    fsrs = repo.get_or_create_fsrs(card_id)
    assert fsrs["card_id"] == card_id
    assert fsrs["state"] == 0 # NEW
    assert fsrs["reps"] == 0

    # Log review & update
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    repo.update_card_fsrs(card_id, {
        "state": 2, # REVIEW
        "stability": 6.0,
        "difficulty": 3.0,
        "reps": 1,
        "lapses": 0,
        "elapsed_days": 0,
        "scheduled_days": 6,
        "last_review": now,
        "due_date": today_str,
        "sync_state": "synced"
    })
    
    log_id = repo.log_review(
        card_id=card_id,
        rating=4, # EASY
        state=0,
        scheduled_days=6,
        elapsed_days=0,
        duration_ms=1200,
        synced_to_anki=True
    )
    assert log_id > 0

    # Check stats
    stats = repo.get_review_stats()
    assert stats["total_cards"] >= 1
    assert stats["cards_due_today"] >= 1
    assert stats["streak_days"] >= 1
