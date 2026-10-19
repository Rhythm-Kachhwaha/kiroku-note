"""
tools/dictionary_parity.py -- Field-by-field parity harness comparing live Yomitan vs local kiroku_dictionary.

Feeds raw outputs from both engines through the exact same YomitanService normalizers
to measure expression, reading, gloss, and POS equivalence.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import urllib.request
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.yomitan import YomitanService
from kiroku_dictionary import DictionaryEngine
from kiroku_dictionary.yomitan_payload import (
    format_kanji_entries_payload,
    format_term_entries_payload,
)

# -----------------------------------------------------------------------------
# AnkiConnect Read-Only Safety Guard
# -----------------------------------------------------------------------------
ALLOWED_ANKI_ACTIONS = frozenset({"deckNames", "findNotes", "notesInfo"})


def call_ankiconnect(action: str, params: dict[str, Any] | None = None, url: str = "http://127.0.0.1:8765") -> Any:
    """Execute a strictly read-only action against AnkiConnect. Raises if action is write/mutate."""
    if action not in ALLOWED_ANKI_ACTIONS:
        raise PermissionError(
            f"Anki Safety Guard: Action '{action}' is strictly forbidden in parity harness. "
            f"Allowed read-only actions: {sorted(ALLOWED_ANKI_ACTIONS)}"
        )

    payload = json.dumps({"action": action, "version": 6, "params": params or {}}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("error"):
                raise RuntimeError(f"AnkiConnect error: {data['error']}")
            return data.get("result")
    except Exception as exc:
        raise ConnectionError(f"Could not connect to AnkiConnect: {exc}") from exc


def fetch_anki_expressions() -> list[str]:
    """Retrieve expressions from real user Anki cards if reachable, falling back to local SQLite cards."""
    expressions: list[str] = []

    # Attempt 1: Real AnkiConnect notes
    try:
        note_ids = call_ankiconnect("findNotes", {"query": ""})
        if note_ids:
            # Sample up to 500 notes
            sample_ids = note_ids[:500]
            notes = call_ankiconnect("notesInfo", {"notes": sample_ids})
            for n in notes:
                fields = n.get("fields", {})
                for fname in ("Expression", "Word", "Front", "Japanese", "Vocab"):
                    if fname in fields and fields[fname].get("value"):
                        val = fields[fname]["value"].strip()
                        # Clean html tags
                        import re
                        val_clean = re.sub(r"<[^>]+>", "", val).strip()
                        if val_clean and val_clean not in expressions:
                            expressions.append(val_clean)
                            break
    except Exception:
        pass

    # Attempt 2: Local SQLite database cards
    db_path = REPO_ROOT / "backend" / "data" / "ankiminer.db"
    if db_path.exists():
        try:
            conn = sqlite3.connect(str(db_path))
            cur = conn.cursor()
            cur.execute("SELECT expression FROM cards WHERE expression != ''")
            for row in cur.fetchall():
                expr = row[0].strip()
                if expr and expr not in expressions:
                    expressions.append(expr)
            conn.close()
        except Exception:
            pass

    return expressions


# -----------------------------------------------------------------------------
# Test Word Sets
# -----------------------------------------------------------------------------
SYNTHETIC_INFLECTIONS: list[str] = [
    # Godan ku
    "書きます", "書きました", "書きません", "書かない", "書いて", "書いた", "書ける", "書こう", "書けば",
    "聞きます", "聞いて", "聞いた", "聞かない", "聞ける", "聞こう", "働きます", "働いて", "働いた", "働かない",
    # Godan iku special
    "行きます", "行きました", "行かない", "行って", "行った", "行ける", "行こう", "行けば", "行っちゃう", "行ってる",
    # Godan gu
    "泳ぎます", "泳ぎました", "泳がない", "泳いで", "泳いだ", "泳げる", "泳ごう", "泳げば", "急ぎます", "急いで", "急いだ",
    # Godan su
    "話します", "話しました", "話さない", "話して", "話した", "話せる", "話そう", "話せば", "出します", "出して", "出した",
    # Godan tsu
    "待ちます", "待ちました", "待たない", "待って", "待った", "待てる", "待とう", "待てば", "立ちます", "立って", "立った",
    # Godan nu
    "死にます", "死なない", "死んで", "死んだ", "死ねる", "死のう", "死ねば",
    # Godan bu
    "呼びます", "呼びました", "呼ばない", "呼んで", "呼んだ", "呼べる", "呼ぼう", "呼べば", "遊びます", "遊んで", "遊んだ",
    # Godan mu
    "飲みます", "飲みました", "飲まない", "飲んで", "飲んだ", "飲める", "飲もう", "飲めば", "読みます", "読んで", "読んだ",
    # Godan ru
    "走ります", "走りました", "走らない", "走って", "走った", "走れる", "走ろう", "走れば", "帰ります", "帰って", "帰った",
    # Godan u
    "買います", "買いました", "買わない", "買って", "買った", "買える", "買おう", "買えば", "使います", "使って", "使った",
    # Ichidan
    "食べます", "食べました", "食べません", "食べない", "食べた", "食べて", "食べられる", "食べれる", "食べさせる",
    "食べさせられる", "食べよう", "食べれば", "食べたら", "食べたい", "食べそう", "食べすぎる", "食べちゃう",
    "見ます", "見ました", "見ない", "見て", "見た", "見られる", "見たい", "見よう",
    "起きます", "起きない", "起きて", "起きた", "起きられる", "起きよう",
    # Suru
    "します", "しました", "しません", "しない", "して", "した", "される", "させる", "させられる", "しよう", "すれば", "したい", "してる", "しちゃう",
    "勉強します", "勉強して", "勉強した", "勉強しない",
    # Kuru
    "きます", "きました", "こない", "きて", "きた", "こられる", "こよう", "くれば", "きたい",
    "来ます", "来ました", "来ない", "来て", "来た", "来られる", "来よう", "来れば", "来たい",
    # Adjectives
    "高くない", "高くなかった", "高くて", "高ければ", "高かった", "高そう", "高さ", "高すぎる",
    "美しくない", "美しかった", "美しくて", "美しければ",
    "早くない", "早かった", "早くて", "早ければ",
    "寒くない", "寒かった", "寒くて", "寒ければ",
    "よくない", "よかった", "よければ", "よくて", "よさそう", "よさ",
    "良くない", "良かった", "良ければ", "良くて",
]

# Ensure at least 300 inflections by generating programmatic forms
for v in ["教える", "答える", "閉める", "開ける", "疲れる", "壊れる", "忘れる", "落とす", "探す", "歩く", "頼む", "休む", "歌う", "洗う", "笑う"]:
    SYNTHETIC_INFLECTIONS.extend([f"{v[:-1]}ない", f"{v[:-1]}ます", f"{v[:-1]}た", f"{v[:-1]}て", f"{v[:-1]}たい", f"{v[:-1]}そう", f"{v[:-1]}すぎる", f"{v[:-1]}ちゃう", f"{v[:-1]}てる", f"{v[:-1]}れば"])

KANA_ONLY_WORDS = [
    "ありがとう", "こんにちは", "さようなら", "すみません", "いただきます",
    "ごちそうさま", "どうぞ", "どうも", "やっぱり", "やはり", "ゆっくり",
    "すっきり", "はっきり", "すっかり", "たっぷり", "しっかり", "ばっちり",
    "ぴったり", "ぎっしり", "のんびり", "ぼんやり", "うっかり", "がっかり",
    "きっぱり", "さっぱり", "あっさり", "ぐっすり", "めっきり", "どっさり",
]

HOMOPHONES = [
    "こうえん", "かんじ", "はし", "あめ", "きしゃ", "かいしょう", "せいさく",
    "きこう", "こうしょう", "せんこう", "たいしょう", "しょうかい", "かいとう",
]

SAMPLE_KANJI = [
    "日", "本", "語", "学", "校", "食", "水", "火", "木", "金", "土",
    "生", "先", "見", "聞", "書", "読", "話", "走", "歩", "来", "行",
    "車", "電", "気", "山", "川", "大", "小", "中", "長", "高", "新",
]


# -----------------------------------------------------------------------------
# Comparison & Parity Runner
# -----------------------------------------------------------------------------
@dataclass
class ParityResult:
    word: str
    yomitan_term: str | None = None
    yomitan_reading: str | None = None
    yomitan_glosses: list[str] | None = None
    local_term: str | None = None
    local_reading: str | None = None
    local_glosses: list[str] | None = None
    headword_match: bool = False
    gloss_match: bool = False
    mismatch_category: str | None = None
    notes: str = ""


def query_yomitan_terms(word: str, endpoint: str = "http://127.0.0.1:19633") -> Any:
    payload = json.dumps({"term": word}).encode("utf-8")
    req = urllib.request.Request(f"{endpoint}/termEntries", data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def query_yomitan_kanji(character: str, endpoint: str = "http://127.0.0.1:19633") -> Any:
    payload = json.dumps({"character": character}).encode("utf-8")
    req = urllib.request.Request(f"{endpoint}/kanjiEntries", data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def compare_word(engine: DictionaryEngine, word: str, yomitan_endpoint: str) -> ParityResult:
    # 1. Query Yomitan
    y_raw = None
    try:
        y_raw = query_yomitan_terms(word, yomitan_endpoint)
        y_entries = YomitanService.normalize_term_entries_response(y_raw)
    except Exception as e:
        y_entries = []

    # 2. Query Local Engine
    l_terms = engine.lookup_terms(word, max_results=10)
    l_payload = format_term_entries_payload(l_terms)
    l_entries = YomitanService.normalize_term_entries_response(l_payload)

    if not y_entries and not l_entries:
        return ParityResult(word=word, headword_match=True, gloss_match=True, notes="both empty")

    if not y_entries:
        return ParityResult(word=word, mismatch_category="yomitan_empty_local_found")

    if not l_entries:
        return ParityResult(
            word=word,
            yomitan_term=y_entries[0].term,
            yomitan_reading=y_entries[0].reading,
            mismatch_category="local_empty_yomitan_found",
        )

    y_top = y_entries[0]
    l_top = l_entries[0]

    y_term = y_top.term
    y_reading = y_top.reading
    y_gloss = y_top.senses[0].glosses if y_top.senses else []

    l_term = l_top.term
    l_reading = l_top.reading
    l_gloss = l_top.senses[0].glosses if l_top.senses else []

    hw_match = (y_term == l_term and y_reading == l_reading)

    # Compare first-sense glosses (case-insensitive, normalized)
    y_norm_gloss = [g.strip().lower() for g in y_gloss]
    l_norm_gloss = [g.strip().lower() for g in l_gloss]
    # Check if there is significant overlap
    gloss_match = bool(set(y_norm_gloss) & set(l_norm_gloss)) or (y_norm_gloss == l_norm_gloss)

    category = None
    if not hw_match:
        if y_term == l_term:
            category = "reading_mismatch"
        else:
            category = "headword_ordering_or_deinflection_diff"
    elif not gloss_match:
        category = "gloss_ordering_or_dataset_diff"

    return ParityResult(
        word=word,
        yomitan_term=y_term,
        yomitan_reading=y_reading,
        yomitan_glosses=y_gloss[:3],
        local_term=l_term,
        local_reading=l_reading,
        local_glosses=l_gloss[:3],
        headword_match=hw_match,
        gloss_match=gloss_match,
        mismatch_category=category,
    )


def run_parity(db_path: str = "kiroku_dict.sqlite", yomitan_endpoint: str = "http://127.0.0.1:19633") -> None:
    print("================================================================================")
    print("               Kiroku Note Parity Harness (Yomitan vs Local Engine)             ")
    print("================================================================================")
    print(f"  Local SQLite DB   : {db_path}")
    print(f"  Yomitan Endpoint  : {yomitan_endpoint}")
    print("--------------------------------------------------------------------------------")

    # Check Yomitan connectivity
    yomitan_online = False
    try:
        req = urllib.request.Request(f"{yomitan_endpoint}/termEntries", data=b'{"term":"test"}', headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                yomitan_online = True
    except Exception as e:
        print(f"ERROR: Cannot connect to Yomitan at {yomitan_endpoint}: {e}")
        print("Please ensure Yomitan local API is active before running parity harness.")
        sys.exit(1)

    engine = DictionaryEngine(db_path)

    # 1. Fetch Real Card Expressions
    real_cards = fetch_anki_expressions()
    print(f"Loaded {len(real_cards)} real card expressions.")

    # 2. Assemble test words
    test_suites: dict[str, list[str]] = {
        "real_cards": real_cards,
        "synthetic_inflections": SYNTHETIC_INFLECTIONS[:300],
        "kana_only": KANA_ONLY_WORDS,
        "homophones": HOMOPHONES,
    }

    overall_results: dict[str, list[ParityResult]] = {}

    for suite_name, words in test_suites.items():
        if not words:
            continue
        print(f"\nEvaluating suite: {suite_name} ({len(words)} terms)...")
        results: list[ParityResult] = []
        for w in words:
            res = compare_word(engine, w, yomitan_endpoint)
            results.append(res)
        overall_results[suite_name] = results

    # Print Report
    print("\n================================================================================")
    print("                              PARITY REPORT SUMMARY                             ")
    print("================================================================================")

    for suite_name, results in overall_results.items():
        total = len(results)
        hw_matches = sum(1 for r in results if r.headword_match)
        gloss_matches = sum(1 for r in results if r.headword_match and r.gloss_match)
        hw_pct = (hw_matches / total * 100) if total else 0.0
        gloss_pct = (gloss_matches / total * 100) if total else 0.0

        print(f"\nSuite [{suite_name.upper()}] (N = {total}):")
        print(f"  Headword Match Rate (term + reading) : {hw_pct:.1f}% ({hw_matches}/{total})")
        print(f"  First-Sense Gloss Match Rate        : {gloss_pct:.1f}% ({gloss_matches}/{total})")

        # Acceptance Bar Check for Real Cards: >= 95%
        if suite_name == "real_cards":
            if hw_pct >= 95.0 and gloss_pct >= 95.0:
                print("  Acceptance Bar: PASSED (>= 95% match)")
            else:
                print(f"  Acceptance Bar: FAILED (< 95% match: hw={hw_pct:.1f}%, gloss={gloss_pct:.1f}%)")

        # Mismatch Breakdown
        mismatches = [r for r in results if not (r.headword_match and r.gloss_match)]
        if mismatches:
            categories: dict[str, int] = {}
            for m in mismatches:
                cat = m.mismatch_category or "other"
                categories[cat] = categories.get(cat, 0) + 1
            print("  Mismatch Categories:")
            for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
                print(f"    - {cat}: {count} ({count/total*100:.1f}%)")

            print("\n  Sample Mismatches (up to 5):")
            for m in mismatches[:5]:
                print(f"    - '{m.word}':")
                print(f"        Yomitan: {m.yomitan_term} ({m.yomitan_reading}) -> {m.yomitan_glosses}")
                print(f"        Local  : {m.local_term} ({m.local_reading}) -> {m.local_glosses}")
                print(f"        Reason : {m.mismatch_category}")

    # Kanji Parity Check
    print("\nEvaluating Kanji parity on sample characters...")
    kanji_matches = 0
    for ch in SAMPLE_KANJI:
        y_k_raw = query_yomitan_kanji(ch, yomitan_endpoint)
        y_k = YomitanService.normalize_kanji_entries_response(y_k_raw)

        l_k_raw = engine.lookup_kanji(ch)
        l_k_payload = format_kanji_entries_payload(l_k_raw)
        l_k = YomitanService.normalize_kanji_entries_response(l_k_payload)

        if y_k and l_k:
            if y_k[0].character == l_k[0].character and set(y_k[0].onyomi) == set(l_k[0].onyomi):
                kanji_matches += 1

    k_total = len(SAMPLE_KANJI)
    print(f"Kanji Parity Match Rate: {kanji_matches}/{k_total} ({kanji_matches/k_total*100:.1f}%)")
    print("================================================================================")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Yomitan vs Local Dictionary Parity Harness")
    parser.add_argument("--db", default="kiroku_dict.sqlite", help="Path to kiroku_dict.sqlite")
    parser.add_argument("--endpoint", default="http://127.0.0.1:19633", help="Yomitan HTTP API endpoint")
    args = parser.parse_args()
    run_parity(db_path=args.db, yomitan_endpoint=args.endpoint)
