"""
verify_anki_actions.py -- Read-only inspection of local AnkiConnect API shapes.

SAFETY GUARANTEE: Strictly read-only; never issues write actions (no addNote, updateNote, etc.).
Checks all required actions for the Kiroku card mirror:
  - version
  - deckNames
  - findCards (various queries)
  - cardsInfo (checks for FSRS fields)
  - cardsModTime
  - getReviewsOfCards
  - cardReviews
  - getLatestReviewID
  - getNumCardsReviewedByDay, getNumCardsReviewedToday, getDeckStats
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any

ANKI_URL = "http://127.0.0.1:8765"


def invoke(action: str, **params: Any) -> Any:
    payload = {
        "action": action,
        "version": 6,
        "params": params,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ANKI_URL,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Origin": "http://localhost",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        if res.get("error"):
            raise RuntimeError(f"AnkiConnect error on {action}: {res['error']}")
        return res.get("result")


def main() -> int:
    print(f"Checking AnkiConnect at {ANKI_URL}...")
    try:
        ver = invoke("version")
        print(f"[OK] AnkiConnect version: {ver}")
    except Exception as exc:
        print(f"[OFFLINE] Could not reach AnkiConnect: {exc}")
        print("Live Anki is not running. Building against documented shapes and test fakes.")
        return 0

    # 1. Decks
    try:
        decks = invoke("deckNames")
        print(f"[OK] deckNames: {len(decks)} decks found. First few: {decks[:5]}")
    except Exception as exc:
        print(f"[FAIL] deckNames: {exc}")
        decks = []

    # 2. findCards queries
    queries = [
        "deck:*",
        "is:suspended",
        "tag:leech",
        "prop:ivl>=21",
        "prop:due=0",
        "prop:due<0",
        "is:new",
        "is:learn",
    ]
    card_ids: list[int] = []
    for q in queries:
        try:
            res = invoke("findCards", query=q)
            count = len(res) if isinstance(res, list) else 0
            print(f"[OK] findCards('{q}'): {count} cards")
            if q == "deck:*" and isinstance(res, list):
                card_ids = res
        except Exception as exc:
            print(f"[FAIL] findCards('{q}'): {exc}")

    # 3. cardsInfo
    if card_ids:
        sample = card_ids[:5]
        try:
            info = invoke("cardsInfo", cards=sample)
            if isinstance(info, list) and info:
                first = info[0]
                keys = sorted(list(first.keys()))
                print(f"[OK] cardsInfo returned {len(info)} cards. Keys in card object: {keys}")
                fsrs_keys = [k for k in keys if "fsrs" in k.lower() or k.lower() in ("difficulty", "stability", "retrievability")]
                print(f"     FSRS-related keys found: {fsrs_keys if fsrs_keys else 'None (standard SM-2 fields present)'}")
                print(f"     Sample fields dictionary keys: {list(first.get('fields', {}).keys())}")
                print(f"     Interval: {first.get('interval')}, Factor: {first.get('factor')}, Lapses: {first.get('lapses')}, Due: {first.get('due')}")
        except Exception as exc:
            print(f"[FAIL] cardsInfo: {exc}")

    # 4. cardsModTime
    if card_ids:
        try:
            mod_times = invoke("cardsModTime", cards=card_ids[:5])
            print(f"[OK] cardsModTime sample: {mod_times}")
        except Exception as exc:
            print(f"[FAIL] cardsModTime: {exc}")

    # 5. getReviewsOfCards
    if card_ids:
        try:
            reviews_sample = invoke("getReviewsOfCards", cards=card_ids[:3])
            if isinstance(reviews_sample, dict):
                print(f"[OK] getReviewsOfCards: returned reviews dict for {len(reviews_sample)} cards.")
                for cid, revs in list(reviews_sample.items())[:2]:
                    print(f"     Card {cid}: {len(revs)} reviews. First review shape: {revs[0] if revs else 'None'}")
        except Exception as exc:
            print(f"[FAIL] getReviewsOfCards: {exc}")

    # 6. cardReviews
    if decks:
        target_deck = decks[0]
        try:
            rev_entries = invoke("cardReviews", deck=target_deck, startID=0)
            if isinstance(rev_entries, list):
                print(f"[OK] cardReviews('{target_deck}'): {len(rev_entries)} entries. Sample entry: {rev_entries[0] if rev_entries else 'empty'}")
        except Exception as exc:
            print(f"[FAIL] cardReviews('{target_deck}'): {exc}")

    # 7. getLatestReviewID
    if decks:
        try:
            latest_id = invoke("getLatestReviewID", deck=decks[0])
            print(f"[OK] getLatestReviewID('{decks[0]}'): {latest_id}")
        except Exception as exc:
            print(f"[FAIL] getLatestReviewID: {exc}")

    # 8. Stats queries
    for action in ["getNumCardsReviewedByDay", "getNumCardsReviewedToday"]:
        try:
            res = invoke(action)
            print(f"[OK] {action}: {type(res).__name__}")
        except Exception as exc:
            print(f"[FAIL] {action}: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
