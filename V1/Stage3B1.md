# Kiroku Note — V1.0 Stage 3B.1 Report: Dictionary Normalization Engine

**Document Path:** `V1/Stage3B1.md`  
**Execution Type:** Backend Normalizer Implementation & Domain Models (Stage 3B.1)  
**Date:** 2026-09-16  
**Status:** COMPLETE  

---

## 1. Executive Summary

Stage 3B.1 delivers the provider-neutral dictionary normalization engine and domain dataclasses for **Kiroku Note**. 

Previously, dictionary parsing was ad-hoc and aggressively stripped linguistic metadata (discarding polysemous senses, detaching POS tags from their respective senses, dropping linguistic/field tags, and permanently removing ruby annotations from example sentences).

This stage implements a clean, robust, and safe recursive AST normalizer in `YomitanService` and provider-neutral domain models, while preserving 100% backward compatibility for existing API endpoints (`/api/capture`), persistence in SQLite, `CardService`, and the Side Panel extension.

---

## 2. What Changed

1. **Provider-Neutral Domain Models (`backend/app/services/yomitan.py`):**
   - Defined frozen dataclasses: `ExampleSentence`, `PitchAccent`, `FrequencyRank`, `DictionarySense`, `DictionaryEntry`, `EnrichedTerm`, and `IdentifiedTerm`.
   - Added backward-compatible aliases `Example = ExampleSentence` and `Sense = DictionarySense` with positional argument preservation.
2. **Safe Recursive AST Normalizer (`backend/app/services/yomitan.py`):**
   - Implemented `normalize_term_entries_response` with safe structured content parsing.
   - Extracts sense-bound POS, linguistic tags (`misc-info`), field/domain tags (`field-info`), and contextual notes (`sense-note`, `xref`, `reference`).
   - Extracts example sentence pairs, preserving clean Japanese surface text in `japanese` and ruby annotations in `reading` (e.g., `映[えい]画[が]`).
   - Extracts pitch accent positions/mora information from both `pitches` and `pronunciations` keys, computing Tokyo dialect pattern names (`heiban`, `atamadaka`, `nakadaka`, `odaka`).
   - Extracts frequency statistics (`frequencies` array with rank, score, and display value).
   - Extracts alternative headwords and readings (`alt_terms`, `alt_readings`).
3. **Pydantic API Model Compatibility (`backend/app/schemas.py`):**
   - Extended Pydantic schemas (`Example`, `PitchAccent`, `FrequencyRank`, `Sense`, `DictionaryEntry`, and `CaptureResponse.jlpt_level`) using `Field(default_factory=list)` to guarantee safe serialization and backward compatibility.
4. **Focused Unit Tests (`backend/tests/test_dictionary_ast.py`):**
   - Added 24 comprehensive unit tests covering all 16 required linguistic and edge-case scenarios.

---

## 3. Preserved Data

| Data Element | Field Path | Preservation Strategy |
| :--- | :--- | :--- |
| **Multiple Senses** | `DictionaryEntry.senses` | Preserves all numbered senses per entry without premature truncation. |
| **Sense-Bound POS** | `DictionarySense.parts_of_speech` | Binds grammatical classifications directly to the sense that produced them. |
| **Linguistic Tags** | `DictionarySense.tags` | Preserves usage markers (e.g. `usually kana`, `archaic`, `slang`, `colloquial`). |
| **Field/Domain Tags** | `DictionarySense.field_tags` | Preserves domain-specific tags (e.g. `computing`, `medicine`, `astronomy`, `math`). |
| **Notes & XRefs** | `DictionarySense.notes` | Preserves notes, see-also cross-references, and antonym references. |
| **Example Sentences** | `DictionarySense.examples` | Preserves Japanese sentence, English translation, and ruby furigana. |
| **Ruby / Furigana** | `ExampleSentence.reading` | Preserves bracketed ruby annotation (e.g. `映[えい]画[が]`) alongside clean text. |
| **Pitch Accent** | `DictionaryEntry.pitches` | Preserves downstep integer, pattern classification, nasal and devoice positions. |
| **Frequency Ranks** | `DictionaryEntry.frequencies` | Preserves frequency rank, corpus name, score, and display badge value. |
| **Alt Headwords** | `DictionaryEntry.alt_terms` / `alt_readings` | Preserves alternative kanji spellings and alternative readings. |
| **Attribution** | `DictionaryEntry.dictionary` / `dictionary_alias` | Preserves full dictionary name and user-defined dictionary alias. |

---

## 4. Safety & Robustness Guarantees

1. **AST Depth Clamping:** Bounded traversal at `MAX_AST_DEPTH = 32` prevents recursion exhaustion or stack overflow on pathologically nested ASTs.
2. **Per-Entry Error Isolation:** Each dictionary entry and definition is parsed within an isolated try-catch block; a corrupted or malformed entry from one dictionary never breaks valid entries from other dictionaries.
3. **Missing Field Graceful Degradation:** All domain fields use safe defaults (empty lists, `None`, empty strings) when dictionary providers omit optional metadata.
4. **Data-Only Output:** Output consists strictly of strongly-typed Python dataclasses and Pydantic models; zero raw HTML is generated or rendered.

---

## 5. Backward Compatibility

- **/api/capture Endpoint:** Continues returning JSON responses conforming to `CaptureResponse` with zero breaking changes.
- **CardService:** Functions without modification; existing draft synthesis and SQLite lookups operate seamlessly.
- **SQLite Storage:** Existing saved cards in SQLite deserialize without schema migration errors.
- **Frontend Side Panel:** Untouched; receives existing fields plus non-breaking rich structured data.
- **Media & Subtitle Pipelines:** Video mining, frame capture, audio extraction, and subtitle synchronization remain 100% untouched.

---

## 6. Verification Results

### Automated Test Suite Execution
- **Focused Dictionary AST Suite:** `python -m pytest tests/test_dictionary_ast.py -v`  
  **Result:** **24 passed** in 0.25s (100% pass)
- **Existing Yomitan / Capture Suites:** `python -m pytest tests/test_yomitan.py tests/test_dictionary.py tests/test_capture_integration.py tests/test_capture_route.py -v`  
  **Result:** **13 passed** in 0.75s (100% pass)
- **Full Backend Regression Suite:** `python -m pytest -v`  
  **Result:** **159 passed** (4 subtests passed) in 6.43s (0 failures, 0 regressions)
- **Full Extension Regression Suite:** `node --test extension/tests/*.test.js`  
  **Result:** **26 passed** in 2.37s (0 failures, 0 regressions)

### Live Yomitan HTTP Verification (Port 19633)
Live test queries executed against running local Yomitan server:
1. **`映画` (`えいが`):**
   - 1 dictionary entry parsed from `Jitendex.org [2026-08-11]`.
   - Primary: `True`, POS: `['noun']`, Senses: 1 (`movie`, `film`).
   - Example extracted: `その映画をもう一度見たいな。`, ruby: `その映[えい]画[が]をもう一[いち]度[ど]見[み]たいな。`, translation: `I want to see the movie again.`
2. **`食べる` (`たべる`):**
   - 5 dictionary entries parsed (primary verb + 4 variant kanji/historical forms).
   - Entry 0 (Primary verb): 2 distinct senses (`to eat` [POS: `1-dan`, `transitive`] and `to live on (e.g. one's salary)`).
   - Example extracted with ruby annotations and translation.
3. **`掛ける` (`かける`):**
   - 6 dictionary entries parsed.
   - Entry 0 (Primary verb): **25 distinct senses** fully parsed with sense-bound POS (`1-dan`, `transitive`, `suffix`), tags (`kana`), field tags (`math`), notes, and examples.

---

## 7. Stage 3B.2 Handoff

The dictionary normalization foundation is complete and tested. The next stage (**Stage 3B.2**) will:
1. Update `CardService` to consume the normalized `DictionaryEntry` and `DictionarySense` structures.
2. Implement multi-sense card draft synthesis (`synthesize_default_meaning` formatting polysemous words as numbered lines: `1. to hang up\n2. to put on`).
3. Synthesize primary example sentences and translations from normalized sense examples.
4. Keep frontend rendering and Side Panel DOM changes for subsequent frontend tasks.
