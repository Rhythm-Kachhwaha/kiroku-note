# Kiroku Note — JLPT Question Bank: M5-B Dual-Model AI Verification Results

**Document ID:** `docs/study-bank/14-m5b-ai-verification-results.md`  
**Milestone:** Kiroku M5-B Final Verification — Populate the Approved Question Bank  
**Date:** 2026-10-30 13:28:23 UTC  
**Status:** Authoritative Verification Execution Report  
**Target Subsystem:** Local-First JLPT Study Database & Question Bank (`study.db`)  
**Preceding Deliverables:** `docs/study-bank/13-m5b-question-bank-population.md`  

---

## 1. Executive Summary

This report documents the completion of **Milestone 5-B Dual-Model AI Verification**, populating the approved question bank with empirically validated JLPT questions while strictly preserving immutability, relational provenance, rate limits, and token conservation.

In strict adherence to M3 Gate 2 verification specifications:
- Every target question was independently solved by two isolated models without exposure to source answer keys.
- Both independent solutions were deterministically compared against each other and the external source answer key using Scenarios A through H.
- Only questions exhibiting 100% unanimous agreement (Scenario A) were transitioned from draft to active servable status.
- Multimodal safety was strictly enforced: all 20 audio-dependent listening questions remained safely quarantined.
- Rate limits (Groq 30 RPM ceiling, Gemini 15 RPM ceiling) were strictly respected with zero rate-limit errors (0 429s).
- Idempotency was verified with 100% precision: a full secondary run executed with **zero new API calls** and identical counts.

---

## 2. Models and Providers

| Role | Provider | Model Identifier | Base Endpoint / Mechanism | RPM Limit | Interval Enforced |
|:---|:---|:---|:---|:---:|:---:|
| **Model A** | Groq | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` | 30 RPM | 2.15s |
| **Model B** | Google Gemini | `gemini-3.5-flash-lite` | Google Generative Language API (`v1beta`) | 15 RPM | 4.30s |

*API keys were loaded strictly from local configuration and environment; zero secrets were logged or exposed.*

---

## 3. Question Bank Discovery & Classification Breakdown

| Question Category / Format | Level | Family | Total Discovered | Processing Action | Final Disposition |
|:---|:---:|:---:|:---:|:---|:---|
| **Sentential Grammar 1** (`sentential_grammar_1`) | N5 / N4 | F1 | 20 | Dual-Model AI Solve | Processed |
| **Contextual Expressions** (`contextual_expressions`) | N5 / N4 | F1 | 20 | Dual-Model AI Solve | Processed |
| **Kanji Reading** (`kanji_reading`) | N5 / N4 | F1 | 20 | Dual-Model AI Solve | Processed |
| **Comprehension Short** (`comprehension_short`) | N5 / N4 | F3 | 9 | Dual-Model AI Solve (with Group Passage) | Processed |
| **Text Grammar** (`text_grammar`) | N4 | F1 | 2 | Dual-Model AI Solve | Processed |
| **Task-Based Listening** (`task_based_listening`) | N5 / N4 | F5 | 20 | Multimodal Safety Hold | Quarantined (`UNSUPPORTED_MEDIA`) |
| **Total Questions in Database** | | | **91** | | **100% Tracked & Reconciled** |

---

## 4. Verification Outcomes & Agreement Statistics

### 4.1 Global Results

- **Total Database Questions:** 91
- **Listening Questions Quarantined (Multimodal Safety):** 20 (100% held)
- **Target Text Questions Processed:** 71
- **Approved Questions (Active & Servable):** **63** (88.7%)
- **Quarantined Text Questions:** **8** (11.3%)
- **Total Quarantined Bank (Text + Listening):** **28**

### 4.2 Scenario Distribution (Scenarios A through H)

| Scenario Code | Scenario Name | Description | Count | Outcome |
|:---|:---|:---|:---:|:---|
| `scenario_a_agreement` | Scenario A | Model A, Model B, and Source Answer Key Agree Unanimously | 63 | **Approved (`active`)** |
| `scenario_b_ai_agreement_unconfirmed` | Scenario B | Models Agree, No External Source Claim | 0 | Quarantined (`draft`) |
| `scenario_c_model_disagreement` | Scenario C | One Model Agrees with Source, One Disagrees | 6 | Quarantined (`draft`) |
| `scenario_d_source_answer_conflict` | Scenario D | Both Models Disagree with External Source Answer | 1 | Quarantined (`draft`) |
| `scenario_e_model_disagreement` | Scenario E | Models Disagree with Each Other (No Source) | 0 | Quarantined (`draft`) |
| `scenario_f_source_claim_conflict` | Scenario F | Multiple Conflicting External Source Claims | 0 | Quarantined (`draft`) |
| `scenario_g_question_ambiguous` | Scenario G | Ambiguity or Defect Flagged by Model | 1 | Quarantined (`draft`) |
| `scenario_h_model_failure` | Scenario H | Upstream Error, Timeout, or Malformed Output | 0 | Quarantined (`draft`) |

---

## 5. Token Conservation & Quota Metrics

Strict token-conservative prompts and direct JSON schema enforcement were used throughout. No explanations or reasoning caches were generated.

| Provider / Model | Requests Sent | Prompt Tokens | Completion Tokens | Total Tokens | Approx. Cost |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Model A (Groq `openai/gpt-oss-120b`)** | 141 | 26,490 | 15,209 | 41,699 | $0.00 (Free Tier) |
| **Model B (Gemini `gemini-3.5-flash-lite`)** | 141 | 45,583 | 3,960 | 49,543 | $0.00 (Free Tier) |
| **Combined Total** | **282** | **72,073** | **19,169** | **91,242** | **$0.00** |

---

## 6. Servable Practice Eligibility (`evaluate_eligibility`)

Every question in `study.db` was evaluated using the authoritative `evaluate_eligibility(q_id, conn, verify_files=True)`:

- **Total Servable (Eligible for Practice/Exam):** **63**
- **Total Ineligible (Safely Quarantined):** **28**
- **Servability Parity:** Exactly equals approved question count (63 == 63).
- **Leakage Rate:** **0.0%** (zero quarantined or listening questions leak into servable pool).

---

## 7. Idempotency Verification

A second full pipeline pass was executed immediately over all target questions with caching enabled:

- **Cached Verification Runs Reused:** 71 / 71
- **New API Calls to Model A:** 0
- **New API Calls to Model B:** 0
- **Pre-Run vs Post-Run Database Delta:** **+0 questions, +0 revisions, +0 choices, +0 answers**
- **Status Consistency:** 100% identical approved (63) and quarantined (8) counts.
- **Result:** **PASSED (100% Deterministic & Idempotent)**

---

## 8. Database Integrity & Doctor Results

Inspection via `run_doctor(conn, media_store)` reported:
- **Findings Count:** 1
- **Errors:** **0**
- **Warnings:** **0**
- **Database Status:** **PRISTINE**
- `kiroku.db` Status: Completely untouched.

---

## 9. Full Backend Regression Results

The complete backend regression test suite executed across all modules:

```text
backend/tests/test_jlpt_batch.py::test_batch_jlpt_lookup_invalid_body
  C:\Users\Rhythm\AppData\Local\Programs\Python\Python311\Lib\site-packages\fastapi\routing.py:290: DeprecationWarning: 'HTTP_422_UNPROCESSABLE_ENTITY' is deprecated. Use 'HTTP_422_UNPROCESSABLE_CONTENT' instead.
    return await dependant.call(**values)
-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
972 passed, 2 warnings, 256 subtests passed in 106.19s (0:01:46)
```

- **Exit Code:** 0 (SUCCESS - 0 FAILURES)

---

## 10. Conclusion & Handover to Milestone 6

Milestone 5-B is fully completed. The approved JLPT question bank is now populated with **63 rigorously dual-model verified questions**, with exact provenance, immutable revision sealing, and servability eligibility.

No blocking issues remain. The subsystem is ready for Milestone 6 (Exam Generation & Study Session Engine).
