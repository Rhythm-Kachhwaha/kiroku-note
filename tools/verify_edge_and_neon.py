"""
Verification script for Neon PostgreSQL and Render Tokenizer live integration.
"""
import os
import json
import urllib.request
import psycopg2

NEON_HOST = os.environ.get('NEON_HOST', 'ep-withered-cake-ar7rbuli.c-4.us-west-2.aws.neon.tech')
NEON_HOSTADDR = os.environ.get('NEON_HOSTADDR', '34.211.130.9')
NEON_DB = os.environ.get('NEON_DB', 'neondb')
NEON_USER = os.environ.get('NEON_USER', 'neondb_owner')
NEON_PASSWORD = os.environ.get('NEON_PASSWORD', '')

def verify():
    print("=== 1. Checking Neon PostgreSQL Tables & Data ===")
    conn = psycopg2.connect(
        dbname=NEON_DB, user=NEON_USER, password=NEON_PASSWORD,
        host=NEON_HOST, hostaddr=NEON_HOSTADDR, port=5432, sslmode='require'
    )
    cur = conn.cursor()

    checks = [
        ('grammar_index', 896),
        ('grammar_enrichment', 95),
        ('jlpt_vocab', 8334),
        ('jlpt_kanji', 2211),
        ('kanji_strokes', 2211),
        ('format', 20),
        ('format_level', 81),
        ('exam_profile', 5),
        ('exam_section_config', 13),
        ('question', 2603),
        ('revision_choice', 11451),
        ('kanji', 10384),
    ]

    for table, expected in checks:
        cur.execute(f"SELECT count(*) FROM {table}")
        cnt = cur.fetchone()[0]
        status = "PASS" if cnt >= expected else "WAIT"
        print(f"  [{status}] {table}: {cnt} rows (expected >= {expected})")
        assert cnt >= expected, f"Table {table} count {cnt} < {expected}"

    cur.execute("SELECT count(*) FROM terms")
    terms_cnt = cur.fetchone()[0]
    print(f"  [PASS] terms: {terms_cnt} rows currently migrated")

    print("\n=== 2. Testing Sample Queries ===")
    # Stroke query
    cur.execute("SELECT character, svg FROM kanji_strokes WHERE character = '日'")
    stroke = cur.fetchone()
    assert stroke and '<svg' in stroke[1], "Kanji stroke SVG missing"
    print("  [PASS] Kanji stroke SVG for '日' retrieved successfully.")

    # Grammar query
    cur.execute("SELECT concept_id, pattern_display, level FROM grammar_index WHERE level = 'N3' LIMIT 3")
    grammar_rows = cur.fetchall()
    assert len(grammar_rows) == 3, "N3 Grammar concepts query failed"
    print(f"  [PASS] N3 Grammar query returned {len(grammar_rows)} concepts: {[r[1] for r in grammar_rows]}")

    # Study Question Bank query
    cur.execute("""
        SELECT q.id, q.level, q.format_code, qr.stem_markup
        FROM question q
        JOIN question_revision qr ON q.current_revision_id = qr.id
        WHERE q.level = 'N3'
        LIMIT 2
    """)
    q_rows = cur.fetchall()
    assert len(q_rows) == 2, "Question query failed"
    print(f"  [PASS] JLPT N3 Questions retrieved: {[r[0] for r in q_rows]}")

    conn.close()

    print("\n=== 3. Testing Live Render Sudachi Tokenizer ===")
    req = urllib.request.Request(
        'https://kiroku-cloud-queue.onrender.com/api/tokenize',
        data=json.dumps({'text': '私は毎日漢字を復習します', 'mode': 'C'}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode('utf-8'))
        tokens = data.get('tokens', [])
        assert len(tokens) > 0, "No tokens returned from Render"
        surfaces = [t['surface'] for t in tokens]
        print(f"  [PASS] Render Tokenizer live: {surfaces}")

    print("\n=== ALL VERIFICATION CHECKS PASSED ===")

if __name__ == '__main__':
    verify()
