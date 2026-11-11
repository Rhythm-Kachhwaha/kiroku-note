"""Phase 4 verification tests: invariants, tiered parsers, Keenable pilot, deterministic validation, and media."""
from __future__ import annotations

import builtins
import io
import json
import sqlite3
import struct
import sys
import types
import wave
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.study.acquisition.discovery import (
    DiscoveryStrategyRunner,
    build_domain_search_queries,
)
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.acquisition.media.audio_duration import (
    is_audio_duration_plausible,
    validate_audio_plausibility,
)
from app.study.acquisition.media.image_assets import (
    ImageAssetProcessor,
    detect_image_mime_type,
    extract_image_dimensions,
    validate_image_magic_bytes,
)
from app.study.acquisition.media.listening_splitter import (
    parse_script_timestamps,
    split_audio_by_script_or_silence,
    split_wav_by_silence,
)
from app.study.acquisition.media.pdf_media import (
    extract_pdf_pages_text,
    render_pdf_page_png,
)
from app.study.acquisition.models import RawFetchResult
from app.study.acquisition.orchestrator import AcquisitionOrchestrator
from app.study.acquisition.parsers.cotoacademy import CotoAcademyParser
from app.study.acquisition.parsers.gyanmirai import GyanMiraiParser
from app.study.acquisition.parsers.invariants import (
    apply_invariant_quarantine,
    linear_scan_exercise,
    linear_scan_source,
)
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.jlpt_official import JlptOfficialParser
from app.study.acquisition.parsers.models import (
    ParsedAnswerClaim,
    ParsedChoice,
    ParsedExercise,
    ParsedQuestion,
)
from app.study.acquisition.parsers.nihongo_pro import NihongoProParser
from app.study.acquisition.parsers.nihongomaster import NihongoMasterParser
from app.study.acquisition.parsers.registry import get_source_parser
from app.study.acquisition.pilot import run_pilot
from app.study.acquisition.providers.base import BaseAcquisitionProvider
from app.study.acquisition.providers.keenable_provider import KeenableProvider
from app.study.acquisition.reliability import (
    SourceReliabilityStatus,
    SourceReliabilityTracker,
)
from app.study.acquisition.source_profiles import (
    SourceTier,
    load_source_profile,
    load_source_profiles,
)
from app.study.connection import StudyDatabaseManager
from app.study.migrations.runner import run_migrations
from app.study.ingestion.enums import IngestAdapterKind, ReviewStatus, StageStatus
from app.study.ingestion.models import IngestInput
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.ingestion.review import ReviewService
from app.study.verification.config import AIVerificationConfig, ModelSlotConfig
from app.study.verification.deterministic import (
    DeterministicAnswerValidator,
    is_llm_explanation_allowed,
)
from app.study.verification.enums import ModelSlot, VerificationStatus
from app.study.verification.m5b_verifier import M5BVerifier
from app.study.verification.models import (
    AIChoiceInput,
    AIExplanationResponse,
    AISolveRequest,
    AISolveResponse,
    AISourceClaimInput,
    AIVerifyClaimsResponse,
)
from app.study.verification.providers.base import BaseAIProvider, ProviderRegistry
from app.study.verification.service import VerificationService


# ---------------------------------------------------------------------------
# Binary Media Test Helpers
# ---------------------------------------------------------------------------


def _make_png_bytes(width: int = 320, height: int = 240) -> bytes:
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr_len = struct.pack(">I", len(ihdr_data))
    return b"\x89PNG\r\n\x1a\n" + ihdr_len + b"IHDR" + ihdr_data + b"\x00\x00\x00\x00"


def _make_jpeg_bytes(width: int = 640, height: int = 480) -> bytes:
    sof0_payload = struct.pack(">BHHB", 8, height, width, 3) + (b"\x01\x11\x00" * 3)
    seg_len = struct.pack(">H", len(sof0_payload) + 2)
    return b"\xff\xd8\xff\xc0" + seg_len + sof0_payload + b"\xff\xd9"


def _make_webp_vp8x_bytes(width: int = 400, height: int = 300) -> bytes:
    chunk = bytearray(10)
    chunk[0] = 0x10
    chunk[4:7] = (width - 1).to_bytes(3, "little")
    chunk[7:10] = (height - 1).to_bytes(3, "little")
    riff_body = b"WEBP" + b"VP8X" + struct.pack("<I", len(chunk)) + bytes(chunk)
    return b"RIFF" + struct.pack("<I", len(riff_body)) + riff_body


def _make_wav_with_silence(sample_rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        tone = struct.pack("<h", 5000) * int(sample_rate * 0.6)
        silence = struct.pack("<h", 0) * int(sample_rate * 0.7)
        wf.writeframes(tone + silence + tone)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 1. Hardened Parser AST & Anti-False-Key Invariants
# ---------------------------------------------------------------------------


def test_jt4u_duplicate_question_number_is_caught_and_quarantined() -> None:
    md = """
# JLPT N4 Grammar Practice Test 01

Question 1:
きょうは　あめ（　　）　ふっています。
が
を
に
で

Question 2:
えき（　　）　ともだちと　あいました。
で
を
が
へ

Question 5:
きのう　おそく（　　）　べんきょうしました。
まで
から
より
ほど

Question 4:
あした　とうきょう（　　）　いきます。
へ
で
を
が

Question 5:
にほんご（　　）　すきです。
が
を
に
で

Answer Key:
Question 1: 1 (が)
Question 2: 1 (で)
Question 3: 2 (が)
Question 4: 1 (へ)
Question 5: 1 (が)
"""
    parser = JapaneseTest4YouParser()
    ex = parser.parse(md, url="https://japanesetest4you.com/jlpt-n4-grammar-exercise-01/")
    codes = {v["code"] for v in ex.invariant_violations}
    assert ex.quarantined is True
    assert "DUPLICATE_QUESTION_NUMBER" in codes
    assert "NON_CONTIGUOUS_NUMBERING" in codes
    assert "ORPHAN_ANSWER_KEY" in codes
    assert any(q.is_quarantined for q in ex.questions)


def test_jt4u_missing_blank_marker_is_caught_and_quarantined() -> None:
    md = """
# JLPT N4 Grammar Practice Test 02

Question 1:
きのう　いえで　ほんを　よみました。
1. が
2. を
3. に
4. で

Answer Key:
Question 1: 2 (を)
"""
    parser = JapaneseTest4YouParser()
    ex = parser.parse(md, url="https://japanesetest4you.com/jlpt-n4-grammar-exercise-02/")
    codes = {v["code"] for v in ex.invariant_violations}
    assert ex.quarantined is True
    assert "MISSING_BLANK_MARKER" in codes
    assert ex.questions[0].is_quarantined is True


def test_jt4u_extra_fifth_choice_caught_on_non_kanji_and_valid_kanji_preserved() -> None:
    # Non-kanji question with 5 choices should trigger INVALID_CHOICE_COUNT
    bad_grammar_md = """
# JLPT N5 Grammar Practice Test 03

Question 1:
これは　わたし（　　）　ほんです。
の
を
に
で
へ

Answer Key:
Question 1: 1 (の)
"""
    parser = JapaneseTest4YouParser()
    bad_ex = parser.parse(bad_grammar_md, url="https://japanesetest4you.com/jlpt-n5-grammar-exercise-03/")
    assert bad_ex.quarantined is True
    assert "INVALID_CHOICE_COUNT" in {v["code"] for v in bad_ex.invariant_violations}

    # Valid kanji-reading question where first choice line repeats underlined stem target word
    kanji_md = """Title: JLPT N5 – Kanji Exercise 01
URL: https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-kanji-exercise-1/

しけんは 来月 です。

1. 来月
くげつ
らいがつ
くがつ
らいげつ

**Answer Key:**

Question 1: 4 (来月: らいげつ)
"""
    good_ex = parser.parse(kanji_md, url="https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-kanji-exercise-1/")
    assert good_ex.quarantined is False
    assert len(good_ex.questions) == 1
    assert len(good_ex.questions[0].choices) == 4


def test_invariants_missing_answer_key_residue_and_full_linear_scan() -> None:
    ex = ParsedExercise(
        source_name="TestSource",
        title="Multi-Error Exercise",
        url="https://example.com/q1",
        section="grammar",
        jlpt_level="N4",
        questions=[
            ParsedQuestion(
                external_id="q1",
                question_number=1,
                format_code="sentential_grammar_1",
                stem="これは {blank} です。",
                choices=[
                    ParsedChoice(ordinal=1, label="1", text="<b>ほん</b>"),
                    ParsedChoice(ordinal=2, label="2", text="ぺん"),
                    ParsedChoice(ordinal=3, label="3", text="かみ"),
                    ParsedChoice(ordinal=4, label="4", text="いす"),
                ],
                answer=ParsedAnswerClaim(question_number=1, claimed_ordinal=1),
            ),
            ParsedQuestion(
                external_id="q2",
                question_number=2,
                format_code="sentential_grammar_1",
                stem="きのう いきました。",  # missing {blank}
                choices=[
                    ParsedChoice(ordinal=1, label="1", text="へ"),
                    ParsedChoice(ordinal=2, label="2", text="で"),
                    ParsedChoice(ordinal=3, label="3", text="を"),
                    ParsedChoice(ordinal=4, label="4", text="から"),
                ],
                answer=None,  # missing answer key
            ),
            ParsedQuestion(
                external_id="q4",  # skipped 3!
                question_number=4,
                format_code="sentential_grammar_1",
                stem="えき {blank} あいます。",
                choices=[
                    ParsedChoice(ordinal=1, label="1", text="で"),
                    ParsedChoice(ordinal=2, label="2", text="で"),  # duplicate choice!
                    ParsedChoice(ordinal=3, label="3", text="に"),
                    ParsedChoice(ordinal=4, label="4", text="へ"),
                ],
                answer=ParsedAnswerClaim(question_number=4, claimed_ordinal=5),  # out of range!
            ),
        ],
    )

    report = linear_scan_exercise(ex)
    assert report.passed is False
    assert report.quarantined is True
    # Linear scan MUST inspect ALL 3 questions without early stop
    assert set(report.per_question_violations.keys()) == {1, 2, 4}
    all_codes = {v.code for v in report.violations}
    assert "HTML_MARKDOWN_RESIDUE" in all_codes
    assert "MISSING_BLANK_MARKER" in all_codes
    assert "MISSING_ANSWER_KEY" in all_codes
    assert "NON_CONTIGUOUS_NUMBERING" in all_codes
    assert "DUPLICATE_CHOICE" in all_codes
    assert "ANSWER_OUT_OF_RANGE" in all_codes

    source_report = linear_scan_source([ex])
    assert source_report.total_exercises == 1
    assert source_report.quarantined_exercises == 1
    assert source_report.passed is False

    apply_invariant_quarantine(ex, report)
    assert ex.quarantined is True
    assert all(q.is_quarantined for q in ex.questions)

    # Quarantine rule: IngestionPipeline(..., auto_approve=True) MUST NOT auto-approve!
    pipeline = IngestionPipeline()
    ingest_res = pipeline.run(
        IngestInput(
            adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
            content=ex.to_m3_structured_payload(),
            source_name="TestSource",
            auto_approve=True,
        ),
        persist=False,
    )
    assert ingest_res.status != StageStatus.APPROVED
    assert all(c.review_status == ReviewStatus.NEEDS_REVIEW for c in ingest_res.questions)
    approved = ReviewService().approve_all_valid(ingest_res.questions)
    assert approved == 0


# ---------------------------------------------------------------------------
# 2. Tiered Source Profiles & Site Parsers
# ---------------------------------------------------------------------------


def test_tiered_source_profiles_and_registry_resolution() -> None:
    by_slug = load_source_profiles()
    for expected in (
        "jlpt_official",
        "japanesetest4you",
        "cotoacademy",
        "gyanmirai",
        "nihongomaster",
        "nihongo_pro",
        "tatoeba",
    ):
        assert expected in by_slug
        parser = get_source_parser(by_slug[expected].parser_id)
        assert parser is not None

    assert by_slug["jlpt_official"].tier == "A"
    assert by_slug["cotoacademy"].tier == "B"
    assert by_slug["gyanmirai"].tier == "B"
    assert by_slug["tatoeba"].tier == "corpus"


def test_coto_nihongomaster_nihongo_pro_parsers_clean_output() -> None:
    sample_md = """
# JLPT N4 Grammar Drill

Question 1:
あした　ともだち（　　）　えいがを　みます。
1. と
2. を
3. が
4. に

Answer Key:
1. 1
"""
    for parser in (CotoAcademyParser(), NihongoMasterParser()):
        ex = parser.parse(sample_md, url="https://example.com/n4-grammar")
        assert ex.quarantined is False
        assert len(ex.questions) == 1
        assert ex.questions[0].answer is not None
        assert ex.questions[0].answer.claimed_ordinal == 1

    radio_md = """
# JLPT N5 Vocabulary Quiz

1. まいにち　（　　）を　のみます。
<input type="radio" name="q1" value="1"> みず
<input type="radio" name="q1" value="2"> ほん
<input type="radio" name="q1" value="3"> いす
<input type="radio" name="q1" value="4"> つくえ

Answer Key:
1: 1
"""
    pro_ex = NihongoProParser().parse(radio_md, url="https://nihongo-pro.com/quiz")
    assert pro_ex.quarantined is False
    assert len(pro_ex.questions) == 1
    assert [c.text for c in pro_ex.questions[0].choices] == ["みず", "ほん", "いす", "つくえ"]


def test_gyanmirai_listening_picture_choices_and_hidden_transcript() -> None:
    listening_md = """
# JLPT N5 Listening Practice Paper 1

[Audio](https://gyanmirai.com/wp-content/uploads/n5-listening-q1.mp3)

Question 1:
おとこのひとと　おんなのひとが　はなしています。おんなのひとは　どれを　かいますか。
1. ![Option 1](https://gyanmirai.com/img/q1-opt1.png)
2. ![Option 2](https://gyanmirai.com/img/q1-opt2.png)
3. ![Option 3](https://gyanmirai.com/img/q1-opt3.png)
4. ![Option 4](https://gyanmirai.com/img/q1-opt4.png)

<details><summary>Script</summary>
おんな：すみません、りんごを　ひとつ　ください。
</details>

Answer Key:
Question 1: 2
"""
    parser = GyanMiraiParser()
    ex = parser.parse(listening_md, url="https://gyanmirai.com/jlpt-n5-listening/")
    assert ex.section == "listening"
    assert ex.quarantined is False
    assert len(ex.questions) == 1
    q = ex.questions[0]
    assert q.audio_urls == ["https://gyanmirai.com/wp-content/uploads/n5-listening-q1.mp3"]
    assert all(c.image_url is not None for c in q.choices)
    assert q.transcript is not None and "りんご" in q.transcript
    assert q.transcript_hidden_until_submit is True

    payload = ex.to_m3_structured_payload()
    q_payload = payload["questions"][0]
    assert q_payload["metadata"]["transcript_hidden_until_submit"] is True
    assert q_payload["metadata"]["reveal_transcript_on_submit"] is True
    assert q_payload["choices"][0]["image_url"] == "https://gyanmirai.com/img/q1-opt1.png"


def test_jlpt_official_parser_pdf_and_script() -> None:
    pdf_pages = [
        {
            "page_number": 1,
            "text": """
# JLPT N5 Sample Listening

1番
おんなのひとは　なにを　たべますか。
1. パン
2. ごはん
3. ラーメン
4. うどん
""",
        }
    ]
    parser = JlptOfficialParser()
    ex = parser.parse_pdf(
        b"%PDF-1.4 dummy",
        url="https://www.jlpt.jp/samples/n5/N5_listening.pdf",
        title="JLPT N5 Sample Listening",
        audio_urls=["https://www.jlpt.jp/samples/n5/N5Q1.mp3"],
        script_text="女：あしたのあさは　パンを　たべます。",
        answer_key_text="Question 1: 1",
        pdf_extractor=lambda _src: pdf_pages,
    )
    assert ex.quarantined is False
    assert len(ex.questions) == 1
    assert ex.questions[0].transcript_hidden_until_submit is True
    assert ex.questions[0].audio_urls == ["https://www.jlpt.jp/samples/n5/N5Q1.mp3"]


# ---------------------------------------------------------------------------
# 3. Keenable Domain Search, 10-Page Pilot Runner & Reliability Tracker
# ---------------------------------------------------------------------------


def test_domain_search_queries_and_keenable_search() -> None:
    coto = load_source_profile("cotoacademy")
    queries = build_domain_search_queries(coto, levels=["N4"], sections=["grammar"])
    assert any("site:cotoacademy.com" in q and "N4" in q for q in queries)

    def _handler(request: httpx.Request) -> httpx.Response:
        assert "/v1/search/public" in request.url.path
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "url": "https://cotoacademy.com/jlpt-n4-grammar-quiz/",
                        "title": "JLPT N4 Grammar Quiz",
                    },
                    {
                        "url": "https://unrelated-domain.example/spam",
                        "title": "Spam",
                    },
                ]
            },
        )

    provider = KeenableProvider(
        api_key="",
        client=httpx.Client(transport=httpx.MockTransport(_handler)),
    )
    runner = DiscoveryStrategyRunner(coto)
    candidates = runner.search_profile(provider, levels=["N4"], sections=["grammar"])
    assert len(candidates) == 1
    assert candidates[0].url == "https://cotoacademy.com/jlpt-n4-grammar-quiz/"


class _FakePilotProvider(BaseAcquisitionProvider):
    def __init__(self, pages: dict[str, str]) -> None:
        self._pages = pages

    @property
    def provider_name(self) -> str:
        return "fake_pilot"

    def is_configured(self) -> bool:
        return True

    def fetch_page(self, url: str, options: Any = None) -> RawFetchResult:
        if url not in self._pages:
            raise RuntimeError("404")
        return RawFetchResult(
            url=url,
            title="JLPT N5 Grammar Practice",
            raw_markdown=self._pages[url],
            status_code=200,
            provider=self.provider_name,
        )


def test_pilot_runner_caps_at_10_pages_and_quarantines_unreliable_source() -> None:
    good_md = """
# JLPT N5 Grammar Quiz

Question 1:
きょうは　がっこう（　　）　いきます。
1. へ
2. を
3. で
4. と

Answer Key:
1: 1
"""
    bad_md = """
# JLPT N5 Broken Quiz

Question 1:
きょうは　あめです。
1. が
2. を
3. に
4. で
"""
    urls = [f"https://cotoacademy.com/quiz-{i}" for i in range(1, 13)]
    coto = load_source_profile("cotoacademy")

    # 12 URLs passed -> max_pages=10 bounds pilot strictly to 10 pages, all healthy
    good_provider = _FakePilotProvider({u: good_md for u in urls})
    ok_report = run_pilot(urls, coto, provider=good_provider, max_pages=10, error_threshold=0.25)
    assert ok_report.pages_attempted == 10
    assert ok_report.quarantined is False
    assert ok_report.reliability_status == SourceReliabilityStatus.HEALTHY

    # Inject 4 bad pages out of 10 (40% > 25% threshold) -> automatic source quarantine
    mixed_pages = {u: (bad_md if idx < 4 else good_md) for idx, u in enumerate(urls[:10])}
    bad_provider = _FakePilotProvider(mixed_pages)
    tracker = SourceReliabilityTracker(default_error_threshold=0.25)
    bad_report = run_pilot(
        urls,
        coto,
        provider=bad_provider,
        max_pages=10,
        error_threshold=0.25,
        tracker=tracker,
    )
    assert bad_report.pages_failed == 4
    assert bad_report.quarantined is True
    assert bad_report.reliability_status == SourceReliabilityStatus.QUARANTINED
    assert tracker.is_quarantined("cotoacademy") is True


# ---------------------------------------------------------------------------
# 4. Deterministic Answer Validation & Zero LLM Overwrites
# ---------------------------------------------------------------------------


class _FakeDictionaryEngine:
    def lookup_terms(self, query: str, max_results: int = 20, mode: str = "word") -> list[dict[str, str]]:
        table = {
            "天気": [{"term": "天気", "reading": "てんき"}],
            "電気": [{"term": "電気", "reading": "でんき"}],
            "学校": [{"term": "学校", "reading": "がっこう"}],
            "日本語": [{"term": "日本語", "reading": "にほんご"}],
            "本": [{"term": "本", "reading": "ほん"}],
        }
        return table.get(query, [])


def test_deterministic_validator_catches_bad_scraped_reading_and_blocks_llm_overwrite() -> None:
    validator = DeterministicAnswerValidator(dict_engine=_FakeDictionaryEngine())

    # Valid reading claim: 天気 -> てんき (choice 1)
    good = validator.validate_question_fields(
        external_id="kanji-ok",
        format_code="kanji_reading",
        stem="きょうは　{u|天気}が　いいです。",
        choices=[(1, "てんき"), (2, "でんき"), (3, "げんき"), (4, "てき")],
        scraped_ordinal=1,
    )
    assert good.status == "agreed"
    assert good.disagreement is False

    # Bad scraped key: claims choice 2 (でんき) for 天気!
    bad = validator.validate_question_fields(
        external_id="kanji-bad",
        format_code="kanji_reading",
        stem="きょうは　{u|天気}が　いいです。",
        choices=[(1, "てんき"), (2, "でんき"), (3, "げんき"), (4, "てき")],
        scraped_ordinal=2,
    )
    assert bad.status == "disagreement"
    assert bad.disagreement is True
    assert bad.review_required is True
    assert 1 in bad.deterministic_candidate_ordinals

    # Grammar blank-fill check runs sentence_analysis.analyze + produces choice analyses
    grammar_res = validator.validate_question_fields(
        external_id="grammar-1",
        format_code="sentential_grammar_1",
        stem="わたしは　日本語{blank}　べんきょうします。",
        choices=[(1, "を"), (2, "っ"), (3, "ん"), (4, "ゎ")],
        scraped_ordinal=1,
    )
    assert len(grammar_res.choice_analyses) == 4
    assert grammar_res.choice_analyses[0].resolved_count >= grammar_res.choice_analyses[1].resolved_count


class _SpyAIProvider(BaseAIProvider):
    def __init__(self, slot: ModelSlot, choice_key: str) -> None:
        super().__init__(model="spy")
        self.name = f"spy_{slot.value}"
        self._slot = slot
        self._choice_key = choice_key
        self.explanation_calls = 0

    def solve_question(self, req: AISolveRequest) -> AISolveResponse:
        return AISolveResponse(
            selected_choice_key=self._choice_key,
            reasoning="reason",
        )

    def verify_source_claims(self, req: Any) -> AIVerifyClaimsResponse:
        return AIVerifyClaimsResponse(assessments=[])

    def generate_explanation(self, req: Any) -> AIExplanationResponse:
        self.explanation_calls += 1
        return AIExplanationResponse(
            target_choice_key=self._choice_key,
            summary="Explanation",
            correct_choice_analysis="Correct",
        )


def test_zero_llm_overwrite_blocks_explanation_without_validated_agreement() -> None:
    cfg = AIVerificationConfig(
        enabled=True,
        model_a=ModelSlotConfig(provider="p1", model="m1", api_key="k1"),
        model_b=ModelSlotConfig(provider="p2", model="m2", api_key="k2"),
    )
    prov_a = _SpyAIProvider(ModelSlot.MODEL_A, "2")
    prov_b = _SpyAIProvider(ModelSlot.MODEL_B, "2")
    service = VerificationService(
        config=cfg,
        provider_a=prov_a,
        provider_b=prov_b,
        skip_source_verify=True,
        deterministic_validator=DeterministicAnswerValidator(dict_engine=_FakeDictionaryEngine()),
    )

    req = AISolveRequest(
        question_id="q-overwrite",
        format_code="kanji_reading",
        structural_family="multiple_choice",
        level="N5",
        category="vocab",
        stem_markup="{u|天気}が いいです。",
        stem_plain="{u|天気}が いいです。",
        choices=[
            AIChoiceInput(choice_key="1", label="1", text="てんき"),
            AIChoiceInput(choice_key="2", label="2", text="でんき"),
            AIChoiceInput(choice_key="3", label="3", text="げんき"),
            AIChoiceInput(choice_key="4", label="4", text="てき"),
        ],
    )

    # 1. No source claims -> AI_AGREEMENT_UNCONFIRMED -> explanation MUST NOT run
    unconfirmed = service.verify_solve_request(req, source_claims=[])
    assert unconfirmed.comparison is not None
    assert unconfirmed.comparison.status == VerificationStatus.AI_AGREEMENT_UNCONFIRMED
    assert unconfirmed.explanation is None
    assert prov_a.explanation_calls == 0

    # 2. Models agree on "2", source claims "1" -> SOURCE_ANSWER_CONFLICT -> MUST NOT run
    conflict = service.verify_solve_request(
        req,
        source_claims=[
            AISourceClaimInput(claim_id=1, source_name="S", claimed_choice_key="1")
        ],
    )
    assert conflict.comparison is not None
    assert conflict.comparison.status == VerificationStatus.SOURCE_ANSWER_CONFLICT
    assert conflict.explanation is None
    assert prov_a.explanation_calls == 0

    # 3. Models AND source claim bad reading "2" (でんき), but dictionary disagrees -> MUST NOT run
    bad_det = service.verify_solve_request(
        req,
        source_claims=[
            AISourceClaimInput(claim_id=2, source_name="S", claimed_choice_key="2")
        ],
    )
    assert bad_det.comparison is not None
    assert bad_det.comparison.status == VerificationStatus.AGREEMENT
    assert bad_det.explanation is None
    assert prov_a.explanation_calls == 0

    assert is_llm_explanation_allowed(
        VerificationStatus.AGREEMENT,
        [AISourceClaimInput(claim_id=3, source_name="S", claimed_choice_key="1")],
        "1",
        deterministic_result=None,
    ) is True


def test_m5b_verifier_quarantines_deterministic_disagreement(tmp_path: Path) -> None:
    study_dir = tmp_path / "study"
    study_dir.mkdir()
    db_mgr = StudyDatabaseManager(study_dir / "study.db")
    mig_conn = db_mgr.get_connection()
    try:
        run_migrations(mig_conn)
    finally:
        mig_conn.close()

    with db_mgr.write_tx() as conn:
        conn.execute(
            "INSERT INTO source (id, name, source_type) VALUES (1, 'TestSrc', 'web_capture');"
        )
        conn.execute(
            """
            INSERT INTO question (id, external_id, format_code, level, category, status)
            VALUES (10, 'uid-10', 'kanji_reading', 'N5', 'vocabulary', 'draft');
            """
        )
        conn.execute(
            """
            INSERT INTO question_revision (
                id, question_id, format_code, revision_number, stem_markup,
                payload_json, validation_status, content_fingerprint
            )
            VALUES (100, 10, 'kanji_reading', 1, '{u|天気}が いいです。', '{}', 'valid', 'fp-100');
            """
        )
        conn.execute("UPDATE question SET current_revision_id = 100 WHERE id = 10;")
        for ord_num, text in [(1, "てんき"), (2, "でんき"), (3, "げんき"), (4, "てき")]:
            conn.execute(
                """
                INSERT INTO revision_choice (id, question_revision_id, choice_key, label, ordinal, text_markup)
                VALUES (?, 100, ?, ?, ?, ?);
                """,
                (200 + ord_num, str(ord_num), str(ord_num), ord_num, text),
            )
        conn.execute(
            """
            INSERT INTO source_answer_claim (id, question_revision_id, source_id, choice_id, source_label)
            VALUES (300, 100, 1, 202, '2');
            """
        )

    cfg = AIVerificationConfig(
        enabled=True,
        model_a=ModelSlotConfig(provider="p1", model="m1", api_key="k1"),
        model_b=ModelSlotConfig(provider="p2", model="m2", api_key="k2"),
    )
    det_val = DeterministicAnswerValidator(dict_engine=_FakeDictionaryEngine())
    # Both models + bad source claim say choice "2", yet dictionary says 天気 != でんき
    svc = VerificationService(
        config=cfg,
        provider_a=_SpyAIProvider(ModelSlot.MODEL_A, "2"),
        provider_b=_SpyAIProvider(ModelSlot.MODEL_B, "2"),
        skip_source_verify=True,
        skip_explanations=True,
        deterministic_validator=det_val,
    )
    verifier = M5BVerifier(
        study_dir=study_dir,
        service=svc,
        deterministic_validator=det_val,
    )
    stats = verifier.run_verification(reuse_cached=False)
    assert stats.approved_count == 0
    assert stats.quarantined_count == 1
    assert stats.quarantine_reasons.get("DETERMINISTIC_ANSWER_DISAGREEMENT") == 1

    with db_mgr.read() as conn:
        status = conn.execute("SELECT status FROM question WHERE id = 10;").fetchone()["status"]
        assert status == "draft"


# ---------------------------------------------------------------------------
# 5. Multi-Modal Listening Media Pipeline
# ---------------------------------------------------------------------------


def test_image_magic_bytes_dimensions_and_sha256_dedupe() -> None:
    png = _make_png_bytes(320, 240)
    jpeg = _make_jpeg_bytes(640, 480)
    webp = _make_webp_vp8x_bytes(400, 300)

    assert detect_image_mime_type(png) == "image/png"
    assert detect_image_mime_type(jpeg) == "image/jpeg"
    assert detect_image_mime_type(webp) == "image/webp"

    assert extract_image_dimensions(png) == (320, 240)
    assert extract_image_dimensions(jpeg) == (640, 480)
    assert extract_image_dimensions(webp) == (400, 300)

    with pytest.raises(ValueError):
        validate_image_magic_bytes(b"<html>not an image</html>")
    with pytest.raises(ValueError):
        validate_image_magic_bytes(png, expected_ext=".jpg")

    proc = ImageAssetProcessor()
    m1 = proc.process_bytes(png, expected_ext=".png", original_url="https://example.com/1.png")
    m2 = proc.process_bytes(png, expected_ext=".png", original_url="https://example.com/copy.png")
    assert m1.sha256 == m2.sha256
    assert m1.is_duplicate is False
    assert m2.is_duplicate is True
    assert m1.pixel_width == 320 and m1.pixel_height == 240


def test_audio_plausibility_and_listening_splitter() -> None:
    assert is_audio_duration_plausible(12_000) is True
    assert is_audio_duration_plausible(100) is False
    assert is_audio_duration_plausible(5_000_000) is False
    ok_dur, ok_msg = validate_audio_plausibility(15_000)
    assert ok_dur is True and ok_msg is None
    bad_dur, bad_msg = validate_audio_plausibility(50)
    assert bad_dur is False and bad_msg is not None

    wav_data = _make_wav_with_silence()
    silence_segments = split_wav_by_silence(wav_data, silence_threshold=300, min_silence_ms=300)
    assert len(silence_segments) == 2
    assert all(seg.data is not None and seg.data.startswith(b"RIFF") for seg in silence_segments)

    script = """
1番 (0:00 - 0:25) おんな：すみません、りんごをください。
2番 (0:25 - 0:55) おとこ：えきは　どちらですか。
"""
    cues = parse_script_timestamps(script)
    assert len(cues) == 2
    assert cues[0].start_ms == 0 and cues[0].end_ms == 25_000

    script_segments = split_audio_by_script_or_silence(
        b"\x00" * 16,
        ext=".mp3",
        script_text=script,
        total_duration_ms=60_000,
    )
    assert len(script_segments) == 2
    assert script_segments[1].start_ms == 25_000
    assert script_segments[1].duration_ms == 30_000


def test_pdf_media_lazy_fitz_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    real_import = builtins.__import__

    def _no_fitz(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "fitz":
            raise ImportError("No module named 'fitz'")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "fitz", raising=False)
    monkeypatch.setattr(builtins, "__import__", _no_fitz)
    with pytest.raises(ImportError, match="PyMuPDF"):
        extract_pdf_pages_text(b"%PDF-1.4")

    # Restore real import before testing injected fake fitz module
    monkeypatch.undo()

    class _FakePixmap:
        def tobytes(self, fmt: str = "png") -> bytes:
            assert fmt == "png"
            return _make_png_bytes(100, 100)

    class _FakePage:
        def get_text(self, mode: str = "text") -> Any:
            return "Page text sample" if mode == "text" else [(0, 0, 10, 10, "Page text sample")]

        def get_pixmap(self, **_kwargs: Any) -> _FakePixmap:
            return _FakePixmap()

    class _FakeDoc(list):
        def close(self) -> None:
            pass

    fake_fitz = types.SimpleNamespace(
        Rect=lambda *coords: tuple(coords),
        open=lambda **_kwargs: _FakeDoc([_FakePage()]),
    )
    pages = extract_pdf_pages_text(b"%PDF-1.4", fitz_module=fake_fitz)
    assert len(pages) == 1
    assert pages[0]["text"] == "Page text sample"
    png_bytes = render_pdf_page_png(b"%PDF-1.4", page_index=0, crop_rect=(0, 0, 50, 50), fitz_module=fake_fitz)
    assert detect_image_mime_type(png_bytes) == "image/png"


# ---------------------------------------------------------------------------
# 6. Edge-Case Hardening Regressions
# ---------------------------------------------------------------------------


def test_listening_missing_audio_image_and_transcript_caught() -> None:
    from app.study.acquisition.parsers.models import AudioAssociation

    ex = ParsedExercise(
        source_name="TestListening",
        title="Listening Audit",
        url="https://example.com/n5-listening",
        section="listening",
        jlpt_level="N5",
        questions=[
            ParsedQuestion(
                external_id="Q1",
                question_number=1,
                format_code="task_based_listening",
                stem="おんなのひとは　なにを　かいますか。",
                choices=[
                    ParsedChoice(ordinal=1, label="1", text="1"),
                    ParsedChoice(ordinal=2, label="2", text="2"),
                    ParsedChoice(ordinal=3, label="3", text="3"),
                    ParsedChoice(ordinal=4, label="4", text="4"),
                ],
                answer=ParsedAnswerClaim(question_number=1, claimed_ordinal=2),
                audio=None,
                image_urls=[],
                transcript=None,
            ),
            ParsedQuestion(
                external_id="Q2",
                question_number=2,
                format_code="task_based_listening",
                stem="おとこのひとは　どこへ　いきますか。",
                choices=[
                    ParsedChoice(ordinal=1, label="1", text="1", image_url="https://example.com/1.png"),
                    ParsedChoice(ordinal=2, label="2", text="2"),
                    ParsedChoice(ordinal=3, label="3", text="3", image_url="https://example.com/3.png"),
                    ParsedChoice(ordinal=4, label="4", text="4", image_url="https://example.com/4.png"),
                ],
                answer=ParsedAnswerClaim(question_number=2, claimed_ordinal=1),
                audio=AudioAssociation(track_url="https://example.com/q2.mp3", scope="question", target_id="Q2"),
                transcript="おとこ：えきへ　いきます。",
            ),
        ],
    )
    report = linear_scan_exercise(ex)
    assert report.passed is False
    assert report.quarantined is True
    q1_codes = {v.code for v in report.per_question_violations[1]}
    assert {"MISSING_AUDIO", "MISSING_LISTENING_IMAGE", "MISSING_TRANSCRIPT"} <= q1_codes
    q2_codes = {v.code for v in report.per_question_violations[2]}
    assert "MISSING_LISTENING_IMAGE" in q2_codes


def test_discovery_empty_search_queries_and_keenable_403_search() -> None:
    tatoeba = load_source_profile("tatoeba")
    queries = build_domain_search_queries(tatoeba)
    assert any("site:tatoeba.org JLPT N5 quiz" in q for q in queries)

    def _forbid_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden"})

    provider = KeenableProvider(
        api_key="",
        client=httpx.Client(transport=httpx.MockTransport(_forbid_handler)),
    )
    with pytest.raises(PermissionError):
        provider.search("site:cotoacademy.com JLPT N4")


def test_conflicting_inline_vs_answer_key_and_pilot_non_contiguous_error() -> None:
    from app.study.acquisition.parsers.tatoeba import TatoebaParser

    conflicted_md = """
# JLPT N4 Grammar Practice

Question 1:
きょうは　あめ（　　）　ふっています。
1. が
2. を
3. に
4. で
Answer: 2

Answer Key:
Question 1: 1 (が)
"""
    ex = TatoebaParser().parse(conflicted_md, url="https://tatoeba.org/quiz/1")
    assert ex.quarantined is True
    assert "ANSWER_CONFLICT" in {v["code"] for v in ex.invariant_violations}

    skipped_num_md = """
# JLPT N5 Grammar Quiz

Question 1:
これは　ほん（　　）　です。
1. が
2. を
3. に
4. で

Question 3:
えき（　　）　いきます。
1. へ
2. を
3. で
4. が

Answer Key:
Question 1: 1
Question 3: 1
"""
    coto = load_source_profile("cotoacademy")
    urls = ["https://cotoacademy.com/skip-1", "https://cotoacademy.com/skip-2"]
    provider = _FakePilotProvider({u: skipped_num_md for u in urls})
    report = run_pilot(urls, coto, provider=provider, max_pages=10, error_threshold=0.25)
    assert report.pages_failed == 2
    assert report.quarantined is True


def test_gif_dimensions_and_orthography_deterministic_validation() -> None:
    gif = b"GIF89a" + struct.pack("<HH", 120, 90) + b"\x00\x00\x00;"
    assert detect_image_mime_type(gif) == "image/gif"
    assert extract_image_dimensions(gif) == (120, 90)

    validator = DeterministicAnswerValidator(dict_engine=_FakeDictionaryEngine())
    disagree = validator.validate_question_fields(
        external_id="ortho-1",
        format_code="orthography",
        stem="{u|てんき}が いいです。",
        choices=[(1, "天気"), (2, "電気"), (3, "学校"), (4, "本")],
        scraped_ordinal=2,
    )
    assert disagree.status == "disagreement"
    assert disagree.review_required is True
    assert disagree.deterministic_candidate_ordinals == [1]

    skipped = validator.validate_question_fields(
        external_id="ortho-unknown",
        format_code="orthography",
        stem="{u|みち}を あるく。",
        choices=[(1, "未知A"), (2, "未知B"), (3, "未知C"), (4, "未知D")],
        scraped_ordinal=1,
    )
    assert skipped.status == "skipped"
    assert skipped.review_required is False
