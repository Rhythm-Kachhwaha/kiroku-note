import json
import sys
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

headers = {'Authorization': 'Bearer test-worker-token', 'Accept': 'application/json'}

def test_endpoint(name, url, method='GET', body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    if body:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=5) as resp:
        res = json.loads(resp.read().decode())
        print(f'{name} HTTP {resp.status}: {list(res.keys())}')
        return res

status = test_endpoint('GET /api/anki/status', 'http://127.0.0.1:8000/api/anki/status')
print(f"  Status card_count: {status.get('card_count')}")

cards = test_endpoint('GET /api/cards', 'http://127.0.0.1:8000/api/cards?limit=5')
first = cards['items'][0]
print(f"  Card 1: {first['expression']} ({first['reading']}) -> diff: {first['difficulty_label']} ({first['difficulty_score']})")

overview = test_endpoint('GET /api/stats/overview', 'http://127.0.0.1:8000/api/stats/overview?range=90d')
print(f"  Overview series: growth={len(overview['growth_curve'])}, states={len(overview['state_breakdown'])}, weak_words={len(overview['weak_words'])}")

study = test_endpoint('GET /api/study/session', 'http://127.0.0.1:8000/api/study/session?mode=weakest&limit=3')
study_cards = study.get('cards') or study.get('items') or []
first_cid = study_cards[0]['card_id']
print(f"  Study session card 1: {study_cards[0]['expression']}")

review = test_endpoint('POST /api/study/review', 'http://127.0.0.1:8000/api/study/review', method='POST', body={
    'card_id': first_cid,
    'rating': 3,
    'time_ms': 2500,
    'session_id': 'test-session-1',
    'review_uuid': f'uuid-{first_cid}-1',
})
print(f"  Review recorded: box={review['box']}, next_due={review['due_at']}")
print("\nALL LIVE ENDPOINTS VERIFIED ON RUNNING SERVER!")
