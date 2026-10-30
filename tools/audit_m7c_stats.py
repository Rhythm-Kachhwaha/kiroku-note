"""
M7-C Final Audit Script.
"""
from __future__ import annotations

from collections import Counter
import json
import sqlite3
from app.config import get_study_dir

conn = sqlite3.connect(get_study_dir() / "study.db")
conn.row_factory = sqlite3.Row

print("=== OVERALL COUNTS ===")
total_q = conn.execute("SELECT COUNT(*) FROM question;").fetchone()[0]
n4_q = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4';").fetchone()[0]
n5_q = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5';").fetchone()[0]
print(f"Total Questions: {total_q} (N4: {n4_q}, N5: {n5_q})")

n4_active = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'active';").fetchone()[0]
n4_draft = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N4' AND status = 'draft';").fetchone()[0]
print(f"N4 Active (Approved): {n4_active} | N4 Draft: {n4_draft}")

n5_active = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5' AND status = 'active';").fetchone()[0]
n5_draft = conn.execute("SELECT COUNT(*) FROM question WHERE level = 'N5' AND status = 'draft';").fetchone()[0]
print(f"N5 Active (Approved): {n5_active} | N5 Draft: {n5_draft}")

print("\n=== N4 ACTIVE BY CATEGORY & FORMAT ===")
cur = conn.execute("""
    SELECT category, format_code, COUNT(*) as cnt 
    FROM question 
    WHERE level = 'N4' AND status = 'active' 
    GROUP BY category, format_code
    ORDER BY category, format_code;
""")
for r in cur.fetchall():
    print(f"  [{r['category']}] {r['format_code']}: {r['cnt']}")

print("\n=== N4 DRAFT BREAKDOWN ===")
draft_rows = conn.execute("""
    SELECT q.id, q.format_code,
           COUNT(qra.asset_id) as asset_count,
           SUM(CASE WHEN a.kind = 'audio' THEN 1 ELSE 0 END) as audio_cnt,
           SUM(CASE WHEN a.kind = 'diagram' THEN 1 ELSE 0 END) as diagram_cnt,
           vr.comparison_scenario
    FROM question q
    JOIN question_revision qr ON q.current_revision_id = qr.id
    LEFT JOIN question_revision_asset qra ON qr.id = qra.question_revision_id
    LEFT JOIN asset a ON qra.asset_id = a.id
    LEFT JOIN verification_run vr ON qr.id = vr.question_revision_id
    WHERE q.level = 'N4' AND q.status = 'draft'
    GROUP BY q.id;
""").fetchall()

multimodal = [r for r in draft_rows if (r["audio_cnt"] and r["audio_cnt"] > 0) or (r["diagram_cnt"] and r["diagram_cnt"] > 0) or r["format_code"] == "task_based_listening"]
verified_disputed = [r for r in draft_rows if r["comparison_scenario"] is not None and r not in multimodal]
unverified_text = [r for r in draft_rows if r["comparison_scenario"] is None and r not in multimodal]

print(f"  Total Draft in N4: {len(draft_rows)}")
print(f"  Multimodal Quarantined (Audio/Diagram): {len(multimodal)}")
print(f"  Verified Quarantined / Disputed Text: {len(verified_disputed)}")
print(f"  Unverified Text Candidates: {len(unverified_text)}")

print("\n  Verified Disputed Scenarios:")
for sc, count in Counter(r["comparison_scenario"] for r in verified_disputed).most_common():
    print(f"    - {sc}: {count}")

print("\n  Unverified Text Formats:")
for fmt, count in Counter(r["format_code"] for r in unverified_text).most_common():
    print(f"    - {fmt}: {count}")

print("\n=== ALL-TIME VERIFICATION RUNS (N4) ===")
total_vr = conn.execute("SELECT COUNT(*) FROM verification_run;").fetchone()[0]
n4_vr = conn.execute("""
    SELECT COUNT(vr.id) 
    FROM verification_run vr 
    JOIN question_revision qr ON vr.question_revision_id = qr.id 
    JOIN question q ON qr.question_id = q.id 
    WHERE q.level = 'N4';
""").fetchone()[0]
print(f"Total Verification Runs: {total_vr} (N4: {n4_vr})")

cur = conn.execute("""
    SELECT vr.comparison_scenario, COUNT(*) as cnt
    FROM verification_run vr
    JOIN question_revision qr ON vr.question_revision_id = qr.id
    JOIN question q ON qr.question_id = q.id
    WHERE q.level = 'N4'
    GROUP BY vr.comparison_scenario
    ORDER BY cnt DESC;
""")
for r in cur.fetchall():
    print(f"  - {r['comparison_scenario']}: {r['cnt']}")

