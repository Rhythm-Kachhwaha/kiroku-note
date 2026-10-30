# Kiroku Note — JLPT Question Bank: Milestone 3 Gate 2 Independent AI Question Verification

**Document ID:** `docs/study-bank/06-m3-ai-verification.md`  
**Milestone:** Milestone 3, Gate 2 (Independent AI Verification)  
**Date:** 2026-10-30  
**Status:** Completed & Verified  

---

## 1. Executive Summary & Architectural Boundaries

Milestone 3, Gate 2 introduces an independent two-model AI verification system layered on top of the deterministic question ingestion pipeline (Gate 1) for Kiroku Note's local-first JLPT Question Bank (`study.db`).

```text
M3 Gate 1 (Deterministic Ingestion)
    │
    ▼
Structurally Validated Question Candidate / Persisted Revision
    │
    ▼
AI Verification Service
    ├── Model A (Independent Solve) ───┐
    └── Model B (Independent Solve) ───┤
                                       ▼
                       Deterministic Comparison Engine
                                       ├── Compare Model A & Model B
                                       ├── Compare with External Source Claims
                                       └── Evaluate Ambiguity & Defectiveness
                                       ▼
                        Scenarios A–H / Verification Status
                                       │
                                       ▼
                         Pedagogical Explanation Generation
                                       │
                                       ▼
                         Human Review & Decision Ledger
```

### 1.1 Strict Separation from Gate 1
- **Gate 1 Ingestion remains 100% deterministic, offline, and untouched in core logic.**
- If AI verification is disabled, unconfigured, or offline, question extraction, classification, normalization, deterministic validation, and persistence continue operating without interruption.
- Gate 2 consumes normalized, structurally validated questions (`CandidateQuestion` or persisted `question_revision`).
- AI agreement is **never** treated as proof of correctness; human review remains authoritative.

---

## 2. Provider Abstraction & Interchangeable Adapters

The verification subsystem implements a provider-independent architecture under `app.study.verification.providers`:

```text
                      ┌──────────────────────┐
                      │    BaseAIProvider    │
                      └──────────┬───────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│   XAIProvider    │   │ OpenAICompatible  │   │   MockAIProvider  │
│ (xAI Grok API)   │   │  (Generic / Local)│   │ (Offline Testing) │
└──────────────────┘   └───────────────────┘   └───────────────────┘
```

1. **Provider Independence**: Core verification logic operates solely against `BaseAIProvider`. No provider-specific assumptions leak into the comparison or persistence engines.
2. **Standard Library HTTP**: All network communication uses standard library `urllib.request`. Zero external dependencies (no `requests`, `httpx`, or cloud SDKs).
3. **Structured Response Sanitization**: Built-in Markdown code block stripping (`clean_json_markdown`) and JSON boundary extraction handle raw model responses.
4. **Choice Key Validation**: Every model response choice key is strictly validated against the question's available choices; nonexistent choice keys are rejected as invalid model responses (`Scenario H`).
5. **Initial Adapters**:
   - `xai`: xAI Grok API adapter (defaults to `grok-2` / `https://api.x.ai/v1/chat/completions`).
   - `openai_compatible`: Generic OpenAI completions format supporting OpenAI, local proxies (vLLM, Ollama), Groq, etc.
   - `mock`: Deterministic mock provider supporting canned answers, custom latency, and simulated failure modes.

---

## 3. Environment Configuration & Desktop Readiness

Configuration is managed via `app.study.verification.config.load_verification_config_from_env()`.

### 3.1 Environment Variables
| Variable | Description | Default |
|---|---|---|
| `KIROKU_AI_ENABLED` | Global toggle for AI verification | `true` if keys configured, else `false` |
| `KIROKU_AI_MODEL_A_PROVIDER` | Provider identifier for Model A | `xai` |
| `KIROKU_AI_MODEL_A_MODEL` | Model name for Model A | `grok-2` |
| `KIROKU_AI_MODEL_A_API_KEY` | API secret key for Model A (also reads `XAI_API_KEY`) | `""` |
| `KIROKU_AI_MODEL_A_BASE_URL` | Base API endpoint override for Model A | `None` |
| `KIROKU_AI_MODEL_B_PROVIDER` | Provider identifier for Model B | `openai_compatible` |
| `KIROKU_AI_MODEL_B_MODEL` | Model name for Model B | `gpt-4o-mini` |
| `KIROKU_AI_MODEL_B_API_KEY` | API secret key for Model B (also reads `OPENAI_API_KEY`) | `""` |
| `KIROKU_AI_MODEL_B_BASE_URL` | Base API endpoint override for Model B | `None` |
| `KIROKU_AI_TIMEOUT` | Upstream request timeout in seconds (clamped 5.0–180.0) | `60.0` |
| `KIROKU_AI_MAX_RETRIES` | Maximum retry attempts for 5xx/429 errors (clamped 0–5) | `2` |
| `KIROKU_AI_MAX_CONCURRENCY` | Maximum concurrent question verifications (clamped 1–10) | `2` |

### 3.2 Security & Desktop Isolation
- API keys are excluded from `ModelSlotConfig.__repr__`, stringification, and dictionary exports (`to_safe_dict`).
- API keys are **never** stored in SQLite `study.db` or written to diagnostic logs.
- Configuration is decoupled so future Kiroku Desktop settings can inject configuration objects directly into `VerificationService` without code changes.

---

## 4. Multi-Stage Verification Workflow

### 4.1 Stage 1: Independent Solving (Zero Early Anchoring)
To prevent anchoring bias and cross-model contamination, Model A and Model B independently solve each question in complete isolation:
- **Never provided**: Source answer keys, external claim rationale, or the other model's output.
- **Provided**: Plain stem, formatted choices, instruction text, JLPT level, question category, format code/family, passage/context text, audio transcript (listening questions).
- **Special F2 Handling**: For Sentence Composition (`sentence_composition`), models are explicitly instructed that the 4 choices are fragments to rearrange, and the target answer is the fragment belonging in the starred (★) position.
- **Mandatory Schema**: Models must return choice key, self-reported confidence (`high`, `medium`, `low`), detailed choice-by-choice analysis, question validity (`valid`, `ambiguous`, `defective`), and ambiguity flags.

### 4.2 Stage 2: External Source Claim Verification
After both models independently commit to an answer:
- External source answer claims (from `source_answer_claim` or candidate drafts) are presented to both models.
- Each model evaluates whether each source claim is `supported`, `contradicted`, or a `plausible_alternative`.
- If a model reconsiders its opinion upon seeing the claim, the revision is noted without altering or overwriting its initial Stage 1 independent answer.

---

## 5. Deterministic Comparison Engine (`DeterministicComparator`)

Comparison uses 100% deterministic rules without invoking a third LLM arbitrator.

### 5.1 Scenario Matrix
| Scenario | Condition | Resulting Status | Human Action |
|---|---|---|---|
| **Scenario A** | Both models agree with single source answer key | `AGREEMENT` | Standard human review |
| **Scenario B** | Both models agree; no source answer key exists | `AI_AGREEMENT_UNCONFIRMED` | Standard human review |
| **Scenario C** | One model agrees with source; one model disagrees | `MODEL_DISAGREEMENT` | Priority human review |
| **Scenario D** | Both models disagree with source answer key | `SOURCE_ANSWER_CONFLICT` | High-priority human review |
| **Scenario E** | Models disagree with each other; no source answer exists | `MODEL_DISAGREEMENT` | Priority human review |
| **Scenario F** | External source answer claims conflict with each other | `SOURCE_CLAIM_CONFLICT` | High-priority human review |
| **Scenario G** | Question flagged as ambiguous or defective by either model | `QUESTION_AMBIGUOUS` | Editorial human review |
| **Scenario H** | Upstream model failure, timeout, or invalid choice key | `VERIFICATION_FAILED` | Can retry failed model |

### 5.2 Verification Statuses
The status model separates verification state from ingestion and eligibility:
- `not_verified`: Initial state prior to AI evaluation.
- `pending`: Verification currently in progress.
- `agreement`: Both models agree with external source.
- `ai_agreement_unconfirmed`: Both models agree; no external source available.
- `model_disagreement`: Disagreement between models or between one model and source.
- `source_answer_conflict`: Both models reject the external source answer.
- `source_claim_conflict`: Multiple external sources contradict each other.
- `question_ambiguous`: Question flagged with multiple valid answers or defects.
- `verification_failed`: Upstream API timeout or parsing error.
- `needs_human_review`: Explicitly awaiting human determination.
- `human_approved`: Formally accepted by human reviewer.
- `human_corrected`: Human reviewer corrected the answer.
- `human_rejected`: Human reviewer rejected the question as defective/invalid.

---

## 6. Pedagogical Explanation Synthesis

Pedagogical explanations are synthesized after independent solving:
1. **Target Selection & Safety Boundary**:
   - Synthesized **only** when both models agree on the target choice (Scenarios A, B, and concordant D).
   - When models disagree (Scenarios C, E, or divergent D), when external source claims conflict (Scenario F), when a question is flagged ambiguous/defective (Scenario G), or on model failure (Scenario H), **no canonical explanation is generated**.
   - Model A and Model B independent reasoning and choice analyses are preserved in `verification_model_response`. No fabricated consensus is created.
2. **Breakdown Structure**:
   - Concise summary in English.
   - Detailed analysis of why target choice is correct.
   - Comprehensive distractor breakdown explaining why each incorrect choice fails.
   - Grammar patterns, kanji readings, and contextual passage clues.
3. **Attribution**:
   - Records generating model slot (`model_a` or `model_b`), model name, and provider.
   - Retains `is_human_approved` boolean flag.

---

## 7. Persistence Schema & Immutability (`0003_ai_verification.sql`)

Four STRICT SQLite tables added to `study.db`:

```text
┌───────────────────────────────┐
│       verification_run        │ (Tracks execution attempts per revision)
└───────────────┬───────────────┘
                │
                ├────────────────────────────────────────┐
                ▼                                        ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ verification_model_response   │        │     question_explanation      │
│  (Immutable model audit log)  │        │   (Pedagogical explanations)  │
└───────────────────────────────┘        └───────────────────────────────┘
                │
                ▼
┌───────────────────────────────┐
│  verification_human_decision  │ (Immutable audit ledger of human actions)
└───────────────────────────────┘
```

### 7.1 Engine-Level Triggers
- `trg_verification_run_no_delete`: Deletion of verification runs is rejected.
- `trg_verification_model_response_no_update`: Model execution logs are immutable.
- `trg_verification_model_response_no_delete`: Model execution logs cannot be deleted.
- `trg_verification_human_decision_no_update`: Human decision logs are immutable.
- `trg_verification_human_decision_no_delete`: Human decision logs cannot be deleted.
- `trg_question_explanation_no_delete`: Explanations cannot be deleted.

---

## 8. Human Review Workflow & Non-Mutating Revision Branching

Human review decisions are submitted through `VerificationReviewService`:
1. **Inspection**: Reviewers inspect question content, choices, source claims, Model A/B solutions, comparator results, and generated explanations via `get_review_bundle`.
2. **Decisions**:
   - `ACCEPT`: Marks run `human_approved` and sets `question_explanation.is_human_approved = 1`.
   - `CORRECT`: Human specifies the true correct choice.
     - **Sealed Revision Preservation**: Sealed revision $N$ is never mutated.
     - A new revision $N+1$ is inserted, choices duplicated, and `revision_answer` inserted with `answer_origin = 'user_entered'`.
     - The new revision is sealed, and `question.current_revision_id` is advanced.
     - Historical revisions and source answer claims remain completely intact.
   - `AMBIGUOUS`: Marks run `question_ambiguous`.
   - `DEFECTIVE` / `REJECT`: Marks run `human_rejected` and updates question status to `retired`.
   - `REVERIFY`: Queues a new verification attempt.

