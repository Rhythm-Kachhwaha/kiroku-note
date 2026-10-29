"""Probe and record the small Yomitan contract needed by grammar work.

Run from the repository root.  A live Yomitan instance is optional; when it
is unavailable, deterministic fallback payloads document the expected shape
without pretending they are live observations.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "yomitan_sentence_tokenize_fixture.json"
ENDPOINT = "http://127.0.0.1:19633"

SENTENCE = "昨日彼に無理やり納豆を食べさせられなかった。"
FALLBACK_TOKENIZE = [
    {"content": [[
        {"text": "昨日", "reading": "きのう", "headwords": [[{"term": "昨日", "reading": "きのう", "sources": [{"originalText": "昨日", "deinflectedText": "昨日"}]}]]},
        {"text": "彼", "reading": "かれ", "headwords": [[{"term": "彼", "reading": "かれ", "sources": [{"originalText": "彼", "deinflectedText": "彼"}]}]]},
        {"text": "に", "reading": "に"},
        {"text": "無理やり", "reading": "むりやり", "headwords": [[{"term": "無理やり", "reading": "むりやり", "sources": [{"originalText": "無理やり", "deinflectedText": "無理やり"}]}]]},
        {"text": "納豆", "reading": "なっとう", "headwords": [[{"term": "納豆", "reading": "なっとう", "sources": [{"originalText": "納豆", "deinflectedText": "納豆"}]}]]},
        {"text": "を", "reading": "を"},
        {"text": "食べさせられなかった", "reading": "たべさせられなかった", "headwords": [[{"term": "食べる", "reading": "たべる", "sources": [{"originalText": "食べさせられなかった", "deinflectedText": "食べる", "inflectionRuleChainCandidates": [["使役", "受身", "否定", "過去"]]}]}]]},
        {"text": "。", "reading": ""},
    ]]}
]
FALLBACK_TERMS = {
    "dictionaryEntries": [{
        "headwords": [{"term": "食べる", "reading": "たべる"}],
        "definitions": [{"dictionary": "fallback-contract-fixture", "entries": []}],
    }]
}


def post(path: str, payload: dict) -> tuple[object, float]:
    request = Request(
        ENDPOINT + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    with urlopen(request, timeout=3) as response:
        return json.loads(response.read().decode("utf-8")), (time.perf_counter() - started) * 1000


def main() -> int:
    from app.services.yomitan import YomitanService

    live = True
    timings: dict[str, float] = {}
    try:
        tokenize, timings["tokenize_ms"] = post(
            "/tokenize", {"text": SENTENCE, "scanLength": 128, "parser": "scanning-parser"}
        )
        terms, timings["termEntries_ms"] = post("/termEntries", {"term": "食べてしまった"})
    except (OSError, URLError, TimeoutError, ValueError) as error:
        live = False
        print(f"Yomitan unavailable ({error}); writing fallback contract fixture.", file=sys.stderr)
        tokenize, terms = FALLBACK_TOKENIZE, FALLBACK_TERMS

    fixture = {
        "contract": {"endpoint": ENDPOINT, "live": live, "scanLength": 128, "parser": "scanning-parser"},
        "sentence": SENTENCE,
        "tokens": YomitanService.normalize_tokenize_tokens(tokenize),
        "inflectionCandidates": {
            "食べさせられなかった": [["使役", "受身", "否定", "過去"]],
            "食べてしまった": [["接続", "完了・遺憾", "過去"]],
        },
        "termEntries": terms,
        "timings_ms": timings,
        "notes": "Fallback values are contract-shaped fixtures, not live dictionary observations."
        if not live else "Captured from live Yomitan.",
    }
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {FIXTURE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
