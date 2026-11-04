# Kiroku Note: Web Mining and PDF-to-Question-Bank Implementation Plan
An agent should read `AGENTS.md`, `IGNORE.md`, the study/OCR maps named by the active slice, this file's Rules section, and **one slice card** per session. Do not execute the entire plan in one session.

## Rules for every session

1. **One slice per session.** Implement only the named slice. Do not start the next slice, even if time remains. End by reporting.
2. **Read only what the card lists.** Use `grep -n` to locate relevant code, then read focused ranges. Do not open whole large files such as `japanesetest4you.py` or `segmentation/parser.py` unless a card explicitly requires a specific range. Do not read `study.db`, user media, secrets, `docs/archive/`, `grammar-audits/`, vendored assets, or unrelated maps.
3. **Tests: targeted only.** Run only the commands named by the card. Never run the full backend, desktop, extension, or study suite. If a named test file does not exist, locate the closest existing test with `ls backend/tests | grep -Ei '<area>'`; create the named test if needed.
4. **Study database rules are locked.** Do not mutate existing question revisions, rewrite historical provenance, silently replace source answer claims, or bypass eligibility/review. Imports must create candidates and flow through the existing review and persistence services. Never write to the user's real `study.db` during tests.
5. **Local-first and extension boundary.** The Study Bank remains local-first and separate from `kiroku.db`, cloud queue, Anki, and extension storage. Additive API fields are acceptable only when they preserve current request/response behavior. Do not modify `extension/` or cloud queue code. If a required API change would break the extension, stop and report the contract issue.
6. **No invented answers.** Deterministic extraction may preserve an explicit answer key or source answer claim. OCR or an LLM may not invent an answer key. Conflicts remain visible and unresolved until a human decision.
7. **No auto-approval of uncertain content.** Scanned pages, low-confidence extraction, ambiguous markup, missing answers, and answer conflicts remain in review. "Accept all high confidence" must still run deterministic validation and must never accept an item with blocking issues.
8. **Source permission and politeness.** Every source profile must record its permission/license note. Check the site's terms and `robots.txt` before enabling a profile. Preserve per-domain delay and do not crawl aggressively.
9. **No heavy OCR in core.** Keep the existing OCR daemon boundary. New document OCR is an optional separately packaged component, not a dependency required by Kiroku's core backend or normal application startup.
10. **FINAL UI rules apply.** Do not edit the Bottom Dock/sliding pill or Kanji Mastery layout. The import screen must be reachable through existing Study navigation patterns. Reuse existing tokens, components, and `--ease-*` motion tokens; honor `prefers-reduced-motion`. No UI redesign.
11. **Stop and ask the user** if a task needs a FINAL component, a persistent schema migration with unclear rollback implications, a breaking browser-extension contract, a new paid/billed service by default, or more than 8 files outside the card's expected scope. Also stop after two unexplained targeted-test failures.
12. **Finish checklist:** targeted tests pass; `git diff --stat` matches the card; no real study data or secrets changed; add at most 5 concise lines to `STATUS.md`; commit with message `slice <ID>: <title>`.
13. **Reply format:** changed files, tests run and result, concise summary, manual checks needed, open issues. Do not re-print code.

### Prompt to start a slice

```text
Implement slice <ID> from docs/plans/WEB-MINING-PDF-IMPORT.md.
Read AGENTS.md, IGNORE.md, the maps named by this card, the Rules section, and only the files listed in the card.
Follow the Rules section. Run targeted tests only; never run the full suite.
Do not start another slice. Stop at the card's Done-when and report.
```

## Architecture decisions

These decisions apply to all slices.

- **One canonical ingestion pipeline.** Web pages, PDFs, scanned pages, images, pasted text, and structured JSON ultimately produce the existing `ExtractedDocument` / `IngestionResult` and candidate models, then use the existing segmentation, classification, association, normalization, deterministic validation, review, and persistence path. Do not create a second PDF-specific question persistence path.
- **Preserve the existing provider abstractions.** Acquisition already has Keenable, Parallel, and Mock providers. Improve the provider contract and crawler behavior without hard-coding Keenable into the generic crawler or introducing MCP calls into the backend. The coding agent may use the Keenable MCP for research, but runtime acquisition stays on configured backend providers.
- **Preserve source auditability.** Use the existing source, import-batch, question-source/group-source, answer-claim, revision, and content-addressed media concepts. Record source URL, source name, adapter/provider, original document hash, page number, extraction method, confidence, warnings, and permission note wherever the existing provenance contract allows. Never overwrite source claims.
- **Use the existing study API surface.** The current `POST /api/study/v1/bank/import/preview` and `POST /api/study/v1/bank/import/commit` flow is the foundation. Add an upload/inspect flow that stages a document and produces a preview; it must not persist questions until the existing commit/review path is used. Do not introduce a parallel PDF-only question persistence route.
- **Keep markup canonical.** Kiroku's markup AST and serializer already support blanks, underline, stars, and ruby. Coordinate-aware extraction should emit the canonical markup DSL, then pass through the existing parser, validator, serializer, and `render_markup_html` path. Do not implement a second markup dialect.
- **No database shortcut.** Import preview/session state may be temporary and bounded, but durable question data must use the existing persistence service and migration conventions. Keep media in `MediaStore`, never arbitrary paths supplied by the client.
- **Do not assume package choices are final.** Benchmark PDF/OCR candidates and verify licenses, package sizes, Windows/PyInstaller compatibility, and maintenance status before adding them. Prefer small optional dependencies and keep fallback behavior explicit.

## Slice overview

| ID | Title | Layer | Size | Depends on | What you will see |
| :-- | :-- | :-- | :-- | :-- | :-- |
| W0 | Acquisition failure semantics and resumable crawl | backend | M | none | A failed later page is visibly PARTIAL, never silently complete |
| W1 | Explicit fetch limits, live retry and cache metadata | backend | S | W0 | Truncation and billed live fetches are visible and controlled |
| W2 | Source profiles and generic discovery strategies | backend + data | M | W0, W1 | Add a source through profile data, not a new crawler implementation |
| W3 | Source fidelity fixtures and provenance flags | backend + tests | M | W2 | Golden pages catch lost underline, ruby, choices and answers |
| P0 | PDF upload and page inspection | backend | M | none | A PDF can be uploaded, hashed and inspected without creating questions |
| P1 | Document-aware segmentation and page provenance | backend | M | P0 | Page markers, headers and real page numbers survive segmentation |
| P2 | Coordinate-aware selectable-text extraction | backend | L | P0, P1 | Text PDFs preserve reading order, ruby and underline where detectable |
| P3 | Scanned-page rasterization and OCR benchmark | backend + optional OCR | L | P0, P1 | A scanned page can be OCRed by an optional layout-aware engine |
| P4 | Candidate review and import experience | backend + desktop | L | P0, P1 | Review source page beside the parsed candidate before commit |
| P5 | Figure and choice-image extraction | backend + desktop | M | P3, P4 | Cropped figures are stored and associated with their question |
| P6 | Optional vision assist and crawler-to-PDF handoff | backend + desktop | M | P2, P3, P4, W2 | Explicit fallback for pages that deterministic extraction cannot parse |

Size: S is about 2 to 4 hours of agent work, M about half a day to a day, L about 1 to 2 days. These are planning estimates, not guarantees.

**Recommended order:** W0, W1, P0, P1, P2, W2, W3, P4, P3, P5, P6.

The order intentionally proves the smallest useful vertical slice first: reliable crawling and selectable-text PDF import before expensive OCR or optional AI work.

---

# Part A. Improving web mining

## W0. Acquisition failure semantics and resumable crawl

**Problem:** `CategoryCrawler` currently treats any exception on page 2 or later as a normal pagination end and may return `COMPLETED`. A timeout, exhausted 429, server error, blocked response, and a genuine final page must not be conflated. Acquisition already has provider and job abstractions, so this slice should strengthen those contracts rather than replace them.

**Read:** `docs/maps/study.md`; `backend/app/study/acquisition/enums.py`; `models.py` (FetchOptions, CrawlResult and job/item status models only); `crawler/category_crawler.py`; `job_service.py` (cursor and item updates only); the acquisition job/item migration definitions; focused category-crawler and job-service tests.

**Do:**

1. Define explicit page outcomes: `END_OF_CATEGORY`, `TRANSIENT_FAILURE`, `BLOCKED`, `NOT_INDEXED`, and `SUCCESS`. Map provider results/exceptions to these outcomes at the provider/crawler boundary. A true 404 or a successful page with no new eligible links may end pagination; a timeout, exhausted 429/5xx, 403, or provider-specific not-indexed response must not.
2. Add `PARTIAL` to the relevant crawl/job lifecycle only where the existing state model needs it. Keep job-level and crawl-level statuses consistent; do not add duplicate status concepts if the current job model can represent partial completion with a result field.
3. On exhausted transient failure, record the failed page number, URL, failure category, attempt count and safe diagnostic. Preserve already discovered URLs. The job must report `PARTIAL`, not `COMPLETED`.
4. Persist a resumable cursor (category URL and next page number) using the existing acquisition job/item persistence pattern. Resume from the failed page, without re-ingesting already completed items. Do not store cursor state only in process memory.
5. Preserve idempotency: normalize URLs using the existing `normalize_source_url`; do not duplicate discovered exercises or import batches when resuming.
6. Ensure a blocked/not-indexed page produces an actionable warning and does not masquerade as end-of-category.

**Expected files:** acquisition enums/models, `crawler/category_crawler.py`, narrowly scoped `job_service.py` or migration only if required, targeted acquisition tests.

**Verify:** targeted tests for category crawler and job service (create a focused file if missing). Include: page 1 success + page 2 timeout => PARTIAL; page 2 429 exhausted => PARTIAL; page 2 403 => BLOCKED/failed diagnostic; page 2 404 => normal end; resume starts at failed page and produces no duplicate URLs/items.

**Done when:** no transient or blocked failure on page 2+ can yield a false `COMPLETED` crawl, and a partial crawl can resume deterministically from the recorded cursor.

**Do not:** add generic source profiles, parallel fetching, UI changes or new providers in this slice.

---

## W1. Explicit fetch limits, live retry and cache metadata

**Problem:** Keenable's provider currently sends a fixed `max_chars=50000`. Fetch options already carry a `force_live` flag, but limits/truncation are not first-class and the generic crawler does not selectively retry unindexed misses. Live fetching may be a separately billed operation and must be opt-in.

**Read:** `backend/app/study/acquisition/models.py` (FetchOptions and RawFetchResult); `providers/keenable_provider.py`; `providers/base.py`; `cache.py`; relevant provider/cache tests; environment/config documentation only if the slice adds a setting.

**Do:**

1. Add a configurable `max_chars` to `FetchOptions` with a conservative, explicitly documented default (initial proposal: 200,000; make it easy to lower for public/free tier limits). Pass it through Keenable REST parameters rather than hardcoding it.
2. Detect possible truncation when the response length reaches the configured limit or provider metadata explicitly reports truncation. Record `truncated=true`, the requested limit, and a warning in fetch metadata/cache records. Do not silently treat a potentially truncated category page as complete.
3. Support one explicit live retry for a not-indexed response only when the acquisition job was started with `allow_live_fetch=true`. Keep the default false. Record that the page used live fetch so billing and provenance remain inspectable.
4. Read and honor `Retry-After` when present for 429 and retryable 5xx responses, bounded by a configured maximum. Keep jitter and current retry safeguards. Do not log API keys or sensitive request headers.
5. Ensure the cache metadata records fetch time, provider, live/indexed mode, content hash, max character limit and truncation flag. Preserve content-addressed cache behavior and existing cache compatibility.
6. A higher-limit re-fetch must be an explicit follow-up with a bounded maximum; do not create an unbounded retry loop.

**Expected files:** `models.py`, `providers/keenable_provider.py`, `cache.py`, focused tests.

**Verify:** targeted provider/cache tests: custom max_chars is sent; truncated content is flagged; Retry-After is bounded and honored; live retry occurs only when opt-in is true; no live call occurs by default; cached metadata round-trips.

**Done when:** fetch limits, truncation and paid live fetch behavior are explicit, testable and visible to acquisition jobs.

**Do not:** implement source profiles, search/discovery or concurrent fetches here.

---

## W2. Source profiles and generic discovery strategies

**Problem:** URL filters, pagination patterns, category parsing and source naming are specific to JapaneseTest4You. Kiroku already has both Keenable and Parallel provider abstractions; the source profile should select the discovery/parser behavior while the provider remains a configured transport.

**Read:** `docs/maps/study.md`; acquisition `models.py`, `orchestrator.py`, `job_service.py`, `cache.py`; `crawler/category_crawler.py`, `crawler/url_filter.py`; parser base and parser registry; provider registry; the current JapaneseTest4You parser interface (class and public methods only); source/import-batch provenance methods.

**Do:**

1. Add a small source-profile format, preferably versioned JSON files under `backend/app/study/acquisition/sources/` (or another existing data convention if one already exists). Each profile contains: `source_slug`, display name, allowed domains, discovery strategy, include/exclude URL rules, pagination/sitemap settings, level/category mapping, parser id, polite delay/concurrency limits, and a license/permission note.
2. Define a validated profile model. Reject malformed patterns, unknown parser ids, unsafe domains and unsupported strategies before a job begins.
3. Support these discovery strategies behind a shared `DiscoveredExercise` output:
   - `paginated_category`: existing WordPress-style category crawler, driven by the profile.
   - `sitemap`: parse sitemap XML and apply profile include/exclude rules.
   - `search`: call a provider capability only when that provider supports it; search results are candidates requiring user approval before crawling.
   - `manual_urls`: accept explicitly supplied URLs after domain and URL validation.
   - `pdf_links`: discover PDF links as document candidates; do not auto-download/import them in this slice.
4. Keep Keenable search optional and behind a provider capability interface. Do not make the generic crawler call Keenable-specific REST endpoints directly. Parallel/Mock providers should remain usable where they implement the capability.
5. Make `source_slug` an explicit required value in cache operations and pass it from the profile through every fetch. Remove the JapaneseTest4You default as the implicit source identity for generic calls.
6. Keep JapaneseTest4You behavior working through a profile and its existing parser. Do not rewrite the 700-line parser merely to make the profile abstraction.
7. Search results must be staged as discovery candidates with title, URL, source profile and match reason; require the user to approve which URLs become a crawl job.

**Expected files:** new profile model/loader and source JSON; focused crawler strategies; cache/orchestrator wiring; parser registry integration; tests. Keep the initial profile for JapaneseTest4You functionally equivalent to current behavior.

**Verify:** targeted profile/strategy tests: current JapaneseTest4You category profile produces the same normalized URLs; a sitemap fixture finds allowed exercises and excludes noise; manual URLs reject a host outside the profile; search discovery is approval-gated; PDF links are surfaced as candidates; source_slug is correct in cache paths/metadata; unknown parser or strategy fails before crawl.

**Done when:** a second source can be added through a profile and existing strategy/parser implementations, without editing generic crawler code.

**Do not:** auto-crawl unapproved search results, implement a generic AI parser, or add a second acquisition transport.

---

## W3. Source fidelity fixtures and provenance flags

**Problem:** Keenable's markdown conversion may alter page layout and may lose underlines or ruby. Japanese questions rely on these marks. This must be measured with reproducible fixtures before trusting additional sources.

**Read:** relevant parser models and base interface; `japanesetest4you.py` public parse entry points and the specific markup/choice/answer handling ranges; existing raw acquisition cache fixture pattern; `backend/app/study/markup/`; provenance model and question-source persistence; focused parser tests.

**Do:**

1. Add three small golden fixtures per supported source profile, covering distinct question families that depend on source structure (for example: underlined target word, grammar choice, passage/reading question). Store only permitted fixture content and document the source/permission.
2. Assert parsed output includes correct stem, underline markup, ruby where present, choice count and labels, answer claim, group association and source URL. Test from cached fixtures so tests are offline and deterministic.
3. Add a fidelity result to parse/acquisition metadata. Flags should be explicit and conservative, e.g. `underline_unverified`, `ruby_unverified`, `choice_layout_ambiguous`, `answer_key_missing`, `source_markup_loss_suspected`.
4. Propagate relevant flags into candidate review reasons or warnings using the existing review model. Do not add a second review state machine.
5. Add a developer conformance tool that compares provider markdown with direct HTML only where access is permitted. It should produce a report; it must not silently switch fetch behavior in production.
6. If a profile consistently loses a required structure, mark that profile as unsuitable for automatic parsing until a reviewed extraction method is available. Direct HTML is an option only after terms/permission and parser tests are established.

**Expected files:** source fixtures, parser tests, small fidelity utility, metadata/provenance mapping, tests.

**Verify:** tests parse each fixture offline and detect intentionally degraded fixtures where underline, ruby, choices or answer keys have been removed.

**Done when:** every active source profile has golden fixtures, required markup fidelity is tested, and uncertain extraction becomes visible to human review.

**Do not:** assume markdown fidelity based on a single page or automatically approve a profile based on its own reported counts.

---

# Part B. PDF-to-question-bank import

## P0. PDF upload and page inspection

**Problem:** Kiroku already has `PdfTextInputAdapter`, `ScannedImageInputAdapter`, `ExtractedDocument`, `IngestionPipeline`, a review service, and import preview/commit routes. The missing piece is a safe upload/inspect lifecycle that chooses a route per page and feeds the canonical pipeline. This slice must not create question rows.

**Read:** `docs/maps/study.md`; `backend/app/api/study/bank.py` (existing import preview/commit routes only); `schemas.py` import DTOs; `deps.py` media/database dependencies; `backend/app/study/ingestion/adapters/pdf_text.py`; `models.py` (`IngestInput`, `ExtractedPage`, `ExtractedDocument`); app upload/body size conventions and auth dependencies; targeted import tests.

**Do:**

1. Add a multipart PDF upload/inspect endpoint under the existing study bank import route family. Follow the current `/api/study/v1` router prefix, auth, dependency, error and response conventions. Use a dedicated staged-import service rather than placing extraction, file handling and preview state directly in the route module.
2. Validate extension, MIME hint and PDF signature; do not trust client-supplied MIME alone. Enforce explicit maximum file size, maximum page count, timeouts and bounded temporary storage. Reject encrypted/unsupported PDFs with actionable errors; never attempt path traversal or arbitrary filesystem paths.
3. Compute SHA-256 while streaming the upload to a temporary staging location. Use it for idempotency and safe duplicate detection. Do not treat filename as identity.
4. Return an `import_id` and an inspection summary without persisting questions. The summary includes per-page text character count, Japanese-character ratio, replacement/`(cid:...)` indicators, image coverage estimate, page dimensions, and an initial route classification.
5. Classify **per page**, not per file: selectable text, garbled/poor text layer, image-only, or mixed. The first implementation may use existing pypdf extraction as a signal; keep the classifier injectable so coordinate extraction can replace it in P2.
6. Support a manual "force OCR" override per page in the staged import model, but do not invoke OCR in P0.
7. Retain only bounded staged state with expiry and cleanup. If Kiroku restarts, an expired or missing stage must produce a clear re-upload message. Do not store PDF bytes in `_IMPORT_PREVIEWS` or an unbounded process-global dictionary.
8. Keep the current text/JSON preview and commit contracts working. The upload flow should produce the same canonical preview items and use the same commit endpoint/review service where feasible.

**Expected files:** new staged-import service/model; import route/schema additions; PDF adapter integration; focused upload/triage tests. Add a migration only if durable import-job state is essential; first evaluate the existing acquisition/import-batch records.

**Verify:** upload tests for valid text PDF, image-only PDF, mixed PDF, malformed signature, oversized file, too many pages, encrypted PDF, same-file hash/idempotency, expired stage, and no question persistence during inspection.

**Done when:** a PDF can be safely uploaded and inspected page-by-page and returns an import id plus clear route summary, with zero question revisions persisted.

**Do not:** add OCR libraries, desktop UI, or question persistence in this slice.

---

## P1. Document-aware segmentation and page provenance

**Problem:** The segmenter currently receives page markers as raw text and can mistake page numbers for question numbers. Some draft creation paths default group/question page numbers to 1. Repeated headers and footers can contaminate parsing. Existing `ExtractedPage` already carries a 1-based page number, so preserve structured page boundaries instead of flattening them irreversibly.

**Read:** `backend/app/study/ingestion/models.py` (`ExtractedPage`, `ExtractedDocument`, draft models); `adapters/pdf_text.py`; `segmentation/parser.py` (page marker handling, `_segment_raw_text`, question/group draft construction only); `segmentation/patterns.py` question-start patterns; page-number and segmentation tests.

**Do:**

1. Preserve a page-to-text representation through segmentation. Avoid treating the synthetic `=== Page N ===` marker as ordinary question text. The segmenter should know the current page number as it walks content.
2. Carry the real 1-based page number into every `QuestionDraft` and `GroupDraft` created from document input. Do not force all candidates to page 1.
3. Recognize and ignore standalone page-number lines and configured repeated header/footer lines. Repetition detection should be deterministic and conservative; do not delete a line merely because it appears twice in actual question content.
4. Tighten question-start recognition so a bare page number, date, footer or table index does not start a new question. Keep existing JLPT question patterns intact.
5. Preserve raw source text and page reference for every draft so the review UI can navigate to the correct source page.
6. For documents without per-page metadata, retain existing behavior and mark page provenance as unavailable rather than fabricating page 1.

**Expected files:** `models.py` only if a small field is needed; `segmentation/parser.py`; `segmentation/patterns.py`; focused segmenter tests.

**Verify:** fixtures with multi-page passages, question split across pages, standalone page numbers, repeated header/footer, numbered choice lines and answer-key page. Assert exact page number for every draft.

**Done when:** page boundaries are not parsed as questions and each document-derived question/group retains its actual source page.

**Do not:** change classification rules, question contracts, or persistence schema unless the existing provenance path demonstrably cannot carry the page number.

---

## P2. Coordinate-aware selectable-text extraction

**Problem:** pypdf-style plain text is insufficient for many Japanese learning materials. It loses positions needed to rebuild reading order and visual marks, and may mishandle vertical text, columns, furigana and underline. Kiroku's markup AST already represents ruby and underline; extraction should emit those canonical structures.

**Read:** `backend/app/study/ingestion/adapters/pdf_text.py`; adapter base; `models.py` extracted page/document contracts; `backend/app/study/markup/ast.py`, parser and serializer (specific markup nodes); `requirements.txt`; PyInstaller/build dependency manifests; PDF adapter tests.

**Do:**

1. Benchmark candidate text/layout libraries on a small fixture set before choosing. Evaluate pypdfium2 and pdfminer.six as initial candidates. Verify current license, Windows support, wheel size, PyInstaller behavior, maintenance and coordinate fidelity before adding a runtime dependency. Do not bundle PyMuPDF without a deliberate license review.
2. Add a coordinate-aware extraction result with characters or spans, bounding boxes, font size, text direction, page dimensions and source page. Keep the public adapter output as the existing `ExtractedDocument`; extend `ExtractedPage` with optional structured line/region metadata rather than replacing the model.
3. Reconstruct line order with deterministic geometry rules. Support horizontal and vertical Japanese text and multi-column pages with test fixtures. If ordering is ambiguous, lower confidence and require review.
4. Detect furigana candidates using relative size and position, but only emit `[base|reading]` when the association is sufficiently clear. Otherwise preserve text and flag `ruby_unverified`; never attach a reading to the wrong base silently.
5. Detect underlines from vector line objects where available. Associate only a horizontal line close to the glyph baseline and spanning the target run. Emit canonical `{u|...}` markup only when unambiguous; otherwise flag `underline_unverified`.
6. Preserve printed stars and blank symbols. Normalize typography only through explicit tested mappings; do not turn arbitrary punctuation or blank-looking spaces into question blanks.
7. Strip repeated headers/footers using page geometry and conservative repeated-text detection.
8. Keep pypdf as a fallback only if coordinate extraction fails. Record method and reason in extraction metadata.

**Expected files:** PDF adapter or focused extractor module, extraction models, dependency/build manifests only after benchmark, targeted fixtures/tests.

**Verify:** fixture cases for normal horizontal Japanese, vertical Japanese, columns, ruby, vector underline, stars/blanks and broken font maps. Assert order, page number, canonical markup and confidence flags.

**Done when:** selectable-text PDFs produce stable candidate text and preserve ruby/underline when detectable; uncertain constructs are flagged rather than guessed.

**Do not:** introduce OCR, AI vision, or desktop preview UI in this slice.

---

## P3. Scanned-page rasterization and OCR benchmark

**Problem:** Current `ScannedImageInputAdapter` sends complete images to the existing manga-ocr service. That engine is intended for short cropped text regions and should remain useful for screen-snips, not become the default whole-page PDF OCR. Whole-page OCR needs rasterization, layout detection and line-level recognition.

**Read:** `docs/maps/ocr.md`; `backend/app/study/ingestion/adapters/scanned_image.py`; `backend/app/services/ocr_service.py`; `ocr_server/server.py` (service contract and process lifecycle only); `models.py` extracted media/page fields; OCR packaging specs and targeted OCR tests.

**Do:**

1. Add PDF page rasterization behind an injectable renderer. Benchmark pypdfium2 at approximately 200 and 300 DPI for text legibility, memory, speed, image size, Windows and PyInstaller behavior. Enforce page pixel and total-job memory limits.
2. Benchmark NDLOCR-Lite first as the preferred layout-aware Japanese candidate, then RapidOCR/PaddleOCR or YomiToku if the initial benchmark is inadequate. Verify exact licenses and model redistribution rules before packaging. Treat all recommendations from the original proposal as candidates, not pre-approved dependencies.
3. Do not replace the existing manga-ocr endpoint or bundle another heavy model into the core backend. Implement a separate optional OCR component/daemon contract, following the existing isolated OCR companion pattern. It must be downloadable/installable separately and report its availability/version.
4. The optional document OCR endpoint accepts one rasterized page and returns ordered text lines/regions with bounding boxes and confidence, not only one flattened string.
5. Route only pages classified B/C or manually forced to OCR. Mixed pages should preserve reliable selectable text while OCRing image-only regions where practical.
6. Store page image and extracted region metadata through the existing content-addressed media path where needed. Do not store arbitrary temporary paths in candidates.
7. Underline detection on scans is low-confidence image analysis. Record `underline_unverified` or equivalent unless the benchmark demonstrates reliable detection on the relevant fixture class.
8. If OCR service is unavailable, preserve the staged import and show an actionable optional-component message. Do not crash normal Kiroku startup or silently discard the PDF.

**Expected files:** isolated rasterizer/OCR client contract, optional OCR daemon package/spec and installer manifest only after benchmark, adapter integration, tests and fixture metadata.

**Verify:** OCR benchmark report for the chosen fixture pages; tests for daemon unavailable, timeout, malformed response, page dimensions, line ordering, confidence propagation and no core dependency on the OCR package.

**Done when:** scanned pages can be processed through an optional layout-aware OCR service and return page-level regions, while the core app remains functional without that service.

**Do not:** send whole PDF files to manga-ocr, make OCR a required dependency, or approve OCR candidates automatically.

---

## P4. Candidate review and import experience

**Problem:** Backend preview/commit and candidate review services already exist, but users need one desktop flow to inspect PDF extraction and decide what enters the bank. The interface should reuse the existing Study sub-screen navigation and components; this is not a redesign.

**Read:** `docs/maps/study.md`, `docs/maps/desktop-views.md`, `docs/maps/ui-rules.md`; existing bank import endpoints and DTOs in `backend/app/api/study/bank.py` / `schemas.py`; import client methods in desktop study client; the way Study opens sub-screens; existing cards, drawers, tabs and file-drop components; focused API/UI tests.

**Do:**

1. Add an Import sub-screen reachable from the existing Study screen. Do not add a new top-level tab or dock item.
2. Support the inputs in the existing backend pipeline: PDF, image, pasted text, structured JSON, and URL/manual web source. URL acquisition must call the existing acquisition job/profile services; do not let the desktop download arbitrary URLs itself.
3. The flow has three steps:
   - **Add:** drop/choose file or paste text/URL; collect level, source name, citation and permission note.
   - **Inspect:** show page count and per-page route/confidence summary; allow force-OCR for a page when the optional service is installed.
   - **Review:** show source page/image on one side and parsed question/group on the other; allow correction, approve/reject, and navigation between candidate items.
4. Render candidate markup using the existing safe markup renderer/DTO fields. Confirm that blanks, underlines, stars and ruby look correct before enabling approval.
5. Show review reason codes and source answer conflicts in plain language. A missing or disputed answer must not appear as correct.
6. A bulk action may approve only candidates with no blocking validation issues and above a conservative, test-backed confidence threshold. It must still call `ReviewService` validation and leave uncertain/scanned items in review.
7. Commit approved candidates through the existing import commit/persistence path. Use idempotency keys, show committed/skipped/failed counts, and allow retry without duplicating questions or import batches.
8. Display provenance in candidate detail: source, citation/URL, page, extraction method, confidence and fidelity flags.
9. Honor accessibility, keyboard navigation, file-size feedback, loading/cancellation states and reduced motion. Preserve existing visual design and FINAL areas.

**Expected files:** desktop Study sub-screen and service/client additions; small additive API DTO/route wiring if needed; targeted desktop and backend tests.

**Verify:** UI helper tests for candidate navigation/filtering; API tests for preview/commit idempotency; manual check with one selectable-text PDF and one low-confidence/scanned fixture. Confirm no new dock/tab and no FINAL component changes.

**Done when:** the user can add a PDF, inspect extraction, correct/approve candidates and commit them through the canonical pipeline without leaving the Study area.

**Do not:** create another question editor, bypass review, modify question revisions after commit, or redesign Study navigation.

---

## P5. Figure and choice-image extraction

**Problem:** JLPT material may contain diagrams, picture choices and figures that plain text extraction cannot represent. Kiroku already has content-addressed `MediaStore`, media assets, and association logic; use them rather than inventing file storage.

**Read:** `backend/app/study/media.py`; `ingestion/models.py` extracted media and attached asset fields; `ingestion/association/`; `ingestion/persistence.py` media registration and association methods; `contracts/` choice media fields; focused media/association tests; P4 review image rendering.

**Do:**

1. Extract page image regions using PDF coordinate/render data. Keep the original page image for review and crop candidate figures/choice images only when region boundaries are supported by layout or explicit human selection.
2. Register image bytes through `MediaStore.register_bytes` within the existing database transaction and content-addressed lifecycle. Do not store absolute paths or client paths.
3. Associate regions with the nearest question/choice only when layout order and proximity are unambiguous. Otherwise show them as unattached review assets.
4. Preserve original pixel dimensions, MIME type, source page, bounding box and extraction method in asset metadata.
5. Reuse existing required-asset validation and eligibility checks. A question requiring an illustration cannot become eligible while its asset is missing.
6. In the review screen, display crops and allow a human to reassign or remove a wrong association before commit.

**Expected files:** narrow extractor/association/persistence additions; review image component integration; targeted tests.

**Verify:** tests for content hash deduplication, path confinement, correct page/region metadata, association, unattached-region fallback and missing required asset validation.

**Done when:** question figures and picture choices can be previewed and persisted through MediaStore, with ambiguous associations held for review.

**Do not:** add a second media directory, infer association solely from filename, or loosen eligibility rules.

---

## P6. Optional vision assist and crawler-to-PDF handoff

**Problem:** Some source pages and PDFs will remain difficult for deterministic extraction. An LLM can assist with structuring a page, but must remain optional, auditable and unable to fabricate answers. The crawler may also discover PDFs, but those must enter the same import pipeline.

**Read:** `docs/maps/llm.md`, `docs/maps/study.md`; current provider configuration and secret storage boundary; P4 staged import/review flow; W2 `pdf_links` strategy; existing structured JSON adapter; answer-key parser and source-answer-claim provenance.

**Do:**

1. Add an explicit per-import "Use vision assist" opt-in, off by default. Make it clear that page images leave the local machine and identify the configured provider before the user confirms.
2. Send only pages that fail triage/segmentation or are explicitly selected. Apply page count, payload size, timeout and cost limits; do not send the complete PDF by default.
3. Require strict structured output conforming to the existing structured JSON adapter schema. Validate all output locally through the canonical parser, normalizer and deterministic validator. Model output is an untrusted candidate, never a trusted question.
4. Do not accept an answer key generated solely by the model. Answers must come from an explicit answer-key region/source claim or user input. If the model suggests an answer, store it only as an unverified suggestion and keep the item blocked from approval.
5. Preserve provider/model/version, request timestamp, page number, prompt/schema version and a hash of the sent page in import metadata, without logging secrets or unnecessary page content.
6. Add a crawler action for discovered PDF links that creates a staged import referencing the approved source profile and URL. Download through the existing SSRF/domain-allowlisted acquisition downloader, enforce size/content-type/redirect restrictions, then hand off to P0. Do not auto-commit.
7. Keep vision assist and PDF auto-download disabled unless the user explicitly enables them per operation/profile.

**Expected files:** optional vision-assist service/provider adapter; staged-import orchestration; acquisition-to-import handoff; focused tests and privacy/help copy.

**Verify:** tests for opt-in required, provider unavailable, malformed JSON, schema rejection, fabricated answer key rejected, metadata recorded, cost/size limits, redirect/SSRF rejection and crawler PDF link entering P0 staging without question persistence.

**Done when:** deterministic import remains the default; explicit vision assist can improve candidate structure without supplying trusted answers; discovered PDFs feed the same staged review path.

**Do not:** put LLM calls in the deterministic `IngestionPipeline`, send content without per-import consent, or let AI output bypass validation/review.

---

## Shared test and fixture plan

Build a small, redistributable fixture collection and keep expected candidate output next to each fixture. Use synthetic or explicitly permitted material; do not commit copyrighted PDFs or scraped full pages without permission. For non-redistributable source fixtures, store redacted/minimal excerpts or generated structural fixtures and document how to obtain the original locally.

| Fixture class | Initial count | Purpose |
| :-- | :-- | :-- |
| Clean selectable text, horizontal | 4 | baseline and Japanese character fidelity |
| Broken character map / CID output | 2 | triage routes to OCR/review |
| Vertical text | 2 | reading order |
| Furigana / ruby | 2 | canonical ruby markup |
| Underlined target words | 3 | canonical underline markup |
| Scanned pages | 3 | OCR route and confidence |
| Mixed text + image | 2 | per-page/region routing |
| Answer-key pages | 2 | explicit answer extraction and conflict handling |
| Diagram/picture choices | 2 | MediaStore association |

Measure: Japanese character error rate for OCR, question-boundary precision/recall, reading-order accuracy, correct choice count, page provenance accuracy, answer-key attachment, ruby/underline preservation, image association, duplicate prevention and preview/commit idempotency.

Suggested gates before relying on a route:
- Selectable-text page boundary accuracy: at least 95% on the fixture set.
- Scanned-page boundary accuracy: at least 85% on the fixture set.
- No fabricated answer keys in any test.
- No scanned/low-confidence candidate auto-approved.
- Page number and source hash retained for every imported question/group.
- Existing import preview/commit behavior remains backward-compatible.

All imported content still goes through human review. Accuracy gates enable a route; they do not waive review.

## Suggested implementation order

| Order | Slice | Reason |
| :-- | :-- | :-- |
| 1 | W0 | Prevent silent data loss in existing crawler jobs |
| 2 | W1 | Make fetch limits, rate limiting and live billing explicit |
| 3 | P0 | Establish safe PDF upload and per-page inspection |
| 4 | P1 | Fix document segmentation and source-page provenance |
| 5 | P2 | Deliver useful text-PDF import without OCR dependencies |
| 6 | W2 | Generalize source discovery after crawler reliability is proven |
| 7 | W3 | Lock source fidelity with fixtures before adding sources |
| 8 | P4 | Provide the full user-facing review and commit flow |
| 9 | P3 | Add optional OCR after text import and review work |
| 10 | P5 | Add figure/choice image support after review can display it |
| 11 | P6 | Add optional AI and PDF-link handoff last |

Each row is a separate agent task/session. Reassess the plan after P2 and P4 based on real PDFs and user review feedback; do not pull later slices forward just because a dependency appears easy.

## Parking lot (needs the user's confirmation before any agent touches it)

- Automatic recurring crawl schedules/background refresh.
- Broad web search over arbitrary domains without a source profile and permission review.
- More than two concurrent fetches per domain or cross-domain crawl fan-out.
- Auto-accepting scraped content or scanned OCR based only on model confidence.
- Cloud storage/sync for study PDFs, extracted questions, or study.db.
- LLM-generated answer keys, explanations treated as authoritative, or unattended question-bank publishing.
- Bundling large OCR/vision models into the core Kiroku installer.
- Replacing existing question revisions or deleting historical source-answer claims.
- Replacing the current Keenable/Parallel provider abstraction with MCP runtime calls.
- Any new top-level navigation tab or change to FINAL UI components.
