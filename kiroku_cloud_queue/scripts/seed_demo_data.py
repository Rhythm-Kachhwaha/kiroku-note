"""
seed_demo_data.py -- Seed synthetic collection for local dashboard preview & performance testing.

Generates:
  - 3,000 realistic cards with Japanese vocabulary, readings, definitions, context sentences,
    JLPT levels (N5-N1), realistic intervals, lapses, FSRS difficulty scores and labels.
  - 2 years (730 days) of daily review series (anki_daily) with growth, retention counts, and state distributions.
  - Anki stats snapshot (latest) and metadata.
  - Performance benchmark for card queries and stats overview.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import random
import sys
import time

sys.path.insert(0, str(Path(__file__).parent.parent))

from queue_store import SqliteQueueStore

SAMPLE_VOCAB = [
    ("約束", "やくそく", "promise; appointment; agreement", "約束を守ることが一番大切です。", "Keeping a promise is most important.", "N3"),
    ("勉強", "べんきょう", "study; diligence; hard work", "毎日日本語を熱心に勉強しています。", "I study Japanese diligently every day.", "N5"),
    ("漢字", "かんじ", "Chinese characters; kanji", "この漢字の書き順を覚えたいです。", "I want to memorize the stroke order of this kanji.", "N5"),
    ("読書", "どくしょ", "reading books", "秋の夜長に読書を楽しむのが好きです。", "I like enjoying reading on long autumn nights.", "N3"),
    ("記憶", "きおく", "memory; recollection; remembrance", "あの旅の記憶は今でも鮮明に残っています。", "The memories of that trip remain vivid even now.", "N2"),
    ("挑戦", "ちょうせん", "challenge; defiance; attempt", "新しい分野に挑戦することを恐れない。", "Not afraid to challenge new fields.", "N2"),
    ("希望", "きぼう", "hope; aspiration; wish", "未来への希望を胸に歩み続けます。", "Continuing to walk with hope for the future.", "N3"),
    ("改善", "かいぜん", "improvement; betterment; kaizen", "業務プロセスの継続的な改善が必要です。", "Continuous improvement of work processes is necessary.", "N2"),
    ("自然", "しぜん", "nature; natural; spontaneous", "手つかずの自然の中で静かに過ごす。", "Spending time quietly in untouched nature.", "N4"),
    ("感謝", "かんしゃ", "gratitude; thanks; appreciation", "支えてくれた周囲の人々に感謝します。", "I thank the people around who supported me.", "N3"),
    ("偶然", "ぐうぜん", "coincidence; by chance; unexpectedly", "街で偶然昔の友人にばったり会った。", "I ran into an old friend by chance in the street.", "N2"),
    ("慎重", "しんちょう", "discreet; prudent; cautious", "重大な決定は慎重に行わなければならない。", "Important decisions must be made cautiously.", "N1"),
    ("曖昧", "あいまい", "ambiguous; vague; indistinct", "返事を曖昧にしてその場を濁した。", "Gave a vague answer to gloss over the moment.", "N1"),
    ("執着", "しゅうちゃく", "attachment; fixation; obsession", "過去の失敗に執着していても始まらない。", "Dwelling on past failures won't get you anywhere.", "N1"),
    ("繊細", "せんさい", "delicate; sensitive; subtle", "彼女の作品は非常に繊細な美しさを持つ。", "Her artwork possesses an extraordinarily delicate beauty.", "N1"),
    ("諦める", "あきらめる", "to give up; to abandon", "困難に直面しても最後まで諦めない。", "Even facing hardship, never give up until the end.", "N3"),
    ("食べる", "たべる", "to eat", "朝ごはんを美味しく食べる。", "Eating breakfast deliciously.", "N5"),
    ("飲む", "のむ", "to drink", "冷たい水を一杯飲む。", "Drink a glass of cold water.", "N5"),
    ("行く", "いく", "to go", "明日東京へ行く予定です。", "I plan to go to Tokyo tomorrow.", "N5"),
    ("見る", "みる", "to see; to look; to watch", "富士山の美しい景色を見る。", "Looking at the beautiful scenery of Mt. Fuji.", "N5"),
]

DECKS = [
    "Japanese::Core 2.3k",
    "Japanese::Mining",
    "Japanese::Anime Vocab",
    "Japanese::JLPT N2 Grammar",
    "Japanese::Yotsuba",
]


def seed_collection(db_path: Path, num_cards: int = 3000) -> None:
    print(f"Initializing store at {db_path}...")
    store = SqliteQueueStore(db_path=db_path)
    now = datetime.now(timezone.utc)
    base_timestamp_ms = int((now - timedelta(days=730)).timestamp() * 1000)

    # 1. Generate Cards
    print(f"Generating {num_cards} synthetic cards...")
    cards = []
    card_births = []

    for i in range(num_cards):
        template = SAMPLE_VOCAB[i % len(SAMPLE_VOCAB)]
        expr = template[0] if i < len(SAMPLE_VOCAB) else f"{template[0]}_{i}"
        reading = template[1]
        meaning = template[2]
        sentence = template[3]
        sentence_meaning = template[4]
        jlpt = template[5]

        deck = random.choice(DECKS)
        # Random creation date within the past 730 days
        day_offset = random.randint(0, 729)
        c_time_ms = base_timestamp_ms + (day_offset * 86400 * 1000) + random.randint(0, 86399000)
        card_id = c_time_ms
        card_births.append((day_offset, card_id))

        # Realistic lifecycle distributions
        r_type = random.random()
        if r_type < 0.10:
            state = "new"
            interval = 0
            reps = 0
            lapses = 0
            score = None
            label = "new"
            due_in_days = None
            is_leech = False
        elif r_type < 0.20:
            state = "learning"
            interval = 1
            reps = random.randint(1, 4)
            lapses = random.randint(0, 2)
            score = round(random.uniform(40.0, 75.0), 1)
            label = "hard" if score >= 60 else "normal"
            due_in_days = 0
            is_leech = False
        elif r_type < 0.55:
            state = "young"
            interval = random.randint(3, 20)
            reps = random.randint(3, 10)
            lapses = random.randint(0, 4)
            score = round(random.uniform(25.0, 65.0), 1)
            label = "hard" if score >= 60 else ("normal" if score >= 30 else "easy")
            due_in_days = random.randint(-2, 14)
            is_leech = False
        elif r_type < 0.92:
            state = "mature"
            interval = random.randint(21, 360)
            reps = random.randint(6, 30)
            lapses = random.randint(0, 3)
            score = round(random.uniform(5.0, 40.0), 1)
            label = "solid" if score < 10 else ("easy" if score < 30 else "normal")
            due_in_days = random.randint(1, 45)
            is_leech = False
        else:
            # Leeches / High Difficulty
            state = "mature" if random.random() > 0.4 else "learning"
            interval = random.randint(1, 30)
            reps = random.randint(15, 50)
            lapses = random.randint(8, 16)
            score = round(random.uniform(70.0, 95.0), 1)
            label = "leech"
            due_in_days = random.randint(-4, 3)
            is_leech = True

        again_count_10 = min(reps, random.randint(0, 4))
        reviews_10 = min(reps, 10)
        again_rate_10 = round(again_count_10 / reviews_10, 2) if reviews_10 > 0 else 0.0

        created_iso = datetime.fromtimestamp(card_id / 1000.0, tz=timezone.utc).isoformat()

        cards.append({
            "card_id": card_id,
            "note_id": card_id + 500000,
            "deck_name": deck,
            "model_name": "Kiroku Note",
            "expression": expr,
            "reading": reading,
            "meaning": meaning,
            "sentence": sentence,
            "sentence_meaning": sentence_meaning,
            "jlpt_level": jlpt,
            "state": state,
            "queue_code": 2 if state == "mature" else (0 if state == "new" else 1),
            "interval_days": interval,
            "reps": reps,
            "lapses": lapses,
            "again_count_10": again_count_10,
            "reviews_10": reviews_10,
            "again_rate_10": again_rate_10,
            "avg_time_ms": random.randint(1500, 8000),
            "difficulty_score": score,
            "difficulty_label": label,
            "is_leech": is_leech,
            "fsrs_difficulty": round(score / 10.0, 2) if score is not None else None,
            "fsrs_stability": float(interval) if interval > 0 else None,
            "fsrs_retrievability": 0.90 if interval > 0 else None,
            "due_in_days": due_in_days,
            "created_at": created_iso,
            "first_review_at": created_iso if reps > 0 else None,
            "last_review_at": now.isoformat() if reps > 0 else None,
            "mod_at": created_iso,
            "synced_at": now.isoformat(),
        })

    # Upsert cards in batches
    batch_size = 500
    for i in range(0, len(cards), batch_size):
        chunk = cards[i : i + batch_size]
        store.upsert_anki_cards(chunk)
    print(f"Successfully upserted {len(cards)} cards.")

    # 2. Generate Daily Series (anki_daily) over 730 days
    print("Generating 730 daily activity rows...")
    daily_rows = []
    cum_cards = 0

    # Count births by day
    birth_by_day = {}
    for d_off, _ in card_births:
        birth_by_day[d_off] = birth_by_day.get(d_off, 0) + 1

    for d in range(730):
        cur_date = (now - timedelta(days=730 - d)).date()
        date_str = cur_date.strftime("%Y-%m-%d")

        new_today = birth_by_day.get(d, 0)
        cum_cards += new_today

        # Activity levels
        rev_count = random.randint(15, 80)
        again = max(0, int(rev_count * random.uniform(0.04, 0.16)))
        hard = max(0, int(rev_count * random.uniform(0.05, 0.15)))
        good = max(0, int(rev_count * random.uniform(0.50, 0.70)))
        easy = max(0, rev_count - again - hard - good)

        true_ret_den = rev_count - random.randint(0, 5)
        true_ret_num = true_ret_den - again

        mat_den = max(0, int(true_ret_den * random.uniform(0.5, 0.85)))
        mat_num = max(0, mat_den - int(again * 0.7))

        # Approximate lifecycle curve
        progress_factor = d / 730.0
        n_mature = int(cum_cards * 0.55 * progress_factor)
        n_young = int(cum_cards * 0.25 * math.sin(progress_factor * math.pi))
        n_learning = int(cum_cards * 0.10)
        n_new = max(0, cum_cards - n_mature - n_young - n_learning)

        daily_rows.append({
            "day": date_str,
            "reviews": rev_count,
            "again": again,
            "hard": hard,
            "good": good,
            "easy": easy,
            "time_ms": rev_count * random.randint(2200, 3800),
            "true_retention_num": true_ret_num,
            "true_retention_den": true_ret_den,
            "mature_retention_num": mat_num,
            "mature_retention_den": mat_den,
            "new_cards_added": new_today,
            "total_cards": cum_cards,
            "n_new": n_new,
            "n_learning": n_learning,
            "n_young": n_young,
            "n_mature": n_mature,
            "n_suspended": int(cum_cards * 0.02),
        })

    for i in range(0, len(daily_rows), 500):
        store.upsert_anki_daily(daily_rows[i : i + 500])
    print(f"Successfully upserted {len(daily_rows)} daily rows.")

    # 3. Set Meta & Anki Stats Snapshot
    store.set_anki_meta("last_mirror_sync_at", now.isoformat())
    store.set_anki_meta("last_full_reconcile_at", now.isoformat())
    store.set_anki_meta("card_count", str(num_cards))
    store.set_anki_meta("schema_version", "1.0")

    fake_stats_snapshot = {
        "today_reviewed": 42,
        "current_streak": 28,
        "best_streak": 54,
        "total_reviews": sum(d["reviews"] for d in daily_rows),
        "days_studied_past_year": 340,
        "cards_reviewed_by_day": [[d["day"], d["reviews"]] for d in daily_rows[-365:]],
        "decks": [
            {"name": "Japanese::Core 2.3k", "new": 10, "review": 25, "total": 1800},
            {"name": "Japanese::Mining", "new": 15, "review": 18, "total": 850},
            {"name": "Japanese::Anime Vocab", "new": 5, "review": 12, "total": 350},
        ],
        "summary": {
            "total_cards": num_cards,
            "total_due_today": 55,
            "total_new_due": 30,
            "total_review_due": 25,
            "total_learn_due": 8,
        },
    }
    store.save_anki_stats(fake_stats_snapshot)
    print("Snapshot saved.")

    # 4. Performance Benchmark
    print("\n--- Performance Benchmark ---")
    t0 = time.perf_counter()
    res = store.query_anki_cards(limit=30, offset=0, sort="difficulty", dir="desc")
    t_list = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    stats = store.get_stats_overview(range_key="90d")
    t_stats = (time.perf_counter() - t0) * 1000

    print(f"query_anki_cards (30 items, total {res[1]}): {t_list:.2f} ms")
    print(f"get_stats_overview (90d series): {t_stats:.2f} ms")
    assert t_list < 300.0, f"Query cards exceeded 300ms: {t_list:.2f}ms"
    assert t_stats < 300.0, f"Stats overview exceeded 300ms: {t_stats:.2f}ms"
    print("Benchmark PASSED (all queries < 300ms locally).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed synthetic demo data for dashboard.")
    parser.add_argument("--db-path", type=str, default="cloud_queue.db", help="Path to SQLite DB")
    parser.add_argument("--count", type=int, default=3000, help="Number of cards to generate")
    args = parser.parse_args()

    target_db = Path(__file__).parent.parent / args.db_path
    seed_collection(target_db, num_cards=args.count)
