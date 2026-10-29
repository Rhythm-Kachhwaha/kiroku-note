# Kiroku Note — N5–N1 Grammar Reconciliation Report

## Executive Summary

This report documents the end-to-end reconciliation of all 848 reference audit entries across JLPT levels N5 through N1 against OpenJLPT and curated seeds in Kiroku Note.

- **Total Reference Audit Entries Accounted For:** 848 / 848 (100.0%)
  - N5: 84 entries
  - N4: 132 entries
  - N3: 182 entries
  - N2: 197 entries
  - N1: 253 entries
- **Canonical Grammar Concepts:** 900
- **Provenance Breakdown:**
  - `EQUIVALENT`: 396 entries directly mapped to equivalent concepts in curated and OpenJLPT seeds.
  - `NEW_CONCEPT`: 333 reference audit entries cleanly promoted to canonical concepts with active or reference-only matchers.
  - `LEVEL_RECONCILED`: 84 entries where cross-source level variances were resolved via the strict easiest-supported-level rule.
  - `VOCAB_REFERENCE`: 35 entries representing standalone lexical vocabulary, bare counters, or basic particles maintained for reference lookups.

---

## Easiest-Supported-Level Rule

In accordance with Kiroku Note's learner-first principle, when multiple sources document a grammar pattern at different JLPT levels, the canonical level is assigned to the easiest (lowest difficulty) supported level:

$$\text{Canonical Level} = \arg\min (\text{rank}(\text{source})), \quad \text{where } \text{rank}(\text{N5}) = 1 < \text{rank}(\text{N4}) = 2 < \text{rank}(\text{N3}) = 3 < \text{rank}(\text{N2}) = 4 < \text{rank}(\text{N1}) = 5$$

### Key Examples of Level Reconciliation
1. **`上に` (`ue ni`)**:
   - Reference Audit N3 Ref #162: N3 (`上に（うえに）`, "as well; besides; in addition to").
   - OpenJLPT N2 Seed: N2 (`〜上（に）`, "besides; on top of; in addition to").
   - **Resolution:** Canonicalized to **N3** (`c_n3_ue_ni`) following `N3 < N2`.
2. **`はずだ` (`hazu da`)**:
   - OpenJLPT lists as N4. Reference audit lists under N3.
   - **Resolution:** Canonicalized to **N4** following `N4 < N3`.
3. **`わけだ` (`wake da`)**:
   - Curated seed and OpenJLPT list as N4/N3.
   - **Resolution:** Canonicalized to **N4** following `N4 < N3`.

---

## Collision Resolution & Semantic Preservation

To prevent data loss caused by key collisions where homographic forms carry distinct grammatical meanings or syntactic requirements, canonical concepts use stable `concept_id` strings (e.g. `c_<level>_<slug>`) and preserve all source entries:

1. **`そうだ` (Appearance vs. Hearsay)**:
   - `c_n4_souda_app` (`そうだ(appearance)`): Pattern for conjectural appearance ("looks like, seems like"), inflecting with `stem + そうだ`.
   - `c_n4_souda_hear` (`そうだ(hearsay)`): Pattern for reported speech / hearsay ("I heard that..."), following dictionary forms.
2. **`らしい` (Conjecture vs. Typicality)**:
   - `c_n4_point_78` / `c_n3_rashii`: Conjectural modality ("seems like; I heard that") vs suffixal typicality ("acting like; typical of").
3. **`のに` (Contrast vs. Purpose)**:
   - `のに(contrast)`: Clause connector indicating unexpected contrast ("although; even though").
   - `のに(purpose)`: Substantive particle indicating utility/purpose ("for the purpose of; in order to").

Both the database schema and runtime services (`GrammarReferenceService`, `GrammarMatcher`) look up concepts by both `pattern_key` and unique `concept_id`, allowing overlapping patterns with distinct semantics to be recognized without mutual suppression.

---

## Database Index & Reproducibility

- The SQLite database `backend/app/data/grammar_reference.sqlite` is compiled reproducibly from `backend/app/data/master_grammar_dataset.json` via `tools/build_grammar_index.py`.
- Schema includes:
  - `concept_id`: Primary unique concept identifier.
  - `pattern_key`: Canonical normalized lookup key.
  - `pattern_display`: Formatted Japanese representation.
  - `level`: Reconciled JLPT level (N5..N1).
  - `meaning_short`: English gloss.
  - `sources`: JSON array containing all source references, URLs, and attribution data.
  - `matcher_type`, `matcher_blob`: Compiled pattern/regex matching specifications.
- Reproducibility verification: Compiling to a temporary database matches row count and contents exactly (`900` rows, `PRAGMA integrity_check: OK`).

---

## Licensing and Attributions

The grammar data incorporated in Kiroku Note respects all upstream licensing and attribution terms:

1. **OpenJLPT Grammar Data**:
   - Source: OpenJLPT (open-jlpt/openjlpt)
   - License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
   - Attribution: Derived from OpenJLPT grammar definitions and examples.
2. **Hanabira Grammar**:
   - License: Creative Commons Attribution 4.0 International (CC BY 4.0)
   - Attribution: Portions of grammar descriptions and patterns are adapted from Hanabira.org.
3. **Tatoeba Project**:
   - License: Creative Commons Attribution 2.0 France (CC BY 2.0 FR)
   - Attribution: Example sentences sourced from Tatoeba.org and volunteer contributors.
4. **JLPT Sensei Audit Reference Data**:
   - Source: Factual audit listings compiled for coverage reference and provenance tracking.
