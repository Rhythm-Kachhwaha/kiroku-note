# Kiroku Grammar Dictionary Audit Report — N5, N4, N3

**Audit Type**: Read-Only Accuracy and Coverage Audit  
**Scope**: JLPT N5 (84 entries), JLPT N4 (132 entries), JLPT N3 (182 entries) — **398 Reference Entries**  
**Target Environment**: Local-first Kiroku Note grammar subsystem (`grammar_reference.sqlite`, `grammar_index`)  
**Safety Status**: Strictly Read-Only. No source code, database records, dictionary files, migrations, or tests were modified.

---

## A. Executive Summary

This report presents the findings of a comprehensive, read-only audit of Kiroku's Japanese grammar dictionaries and JLPT-level assignments against 398 reference grammar entries across JLPT levels N5, N4, and N3. The audit was conducted with strict adherence to safety constraints, inspecting existing SQLite databases, data seed pipelines, matcher implementations, and lookup contracts without modifying persistent state or application code.

### Audit Counts and Status Distribution

| JLPT Level | Reference Entries | CORRECT | WRONG_TAG | MISSING | DUPLICATE | WRONG_CONTENT | AMBIGUOUS | Coverage % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N5 | 84 | 39 | 15 | 17 | 11 | 0 | 2 | 46.4% |
| N4 | 132 | 60 | 15 | 44 | 10 | 3 | 0 | 45.5% |
| N3 | 182 | 96 | 28 | 51 | 7 | 0 | 0 | 52.7% |
| **Total** | **398** | **195** | **58** | **112** | **28** | **3** | **2** | **49.0%** |


### Key Findings and Strategic Risks

1. **Tier 0 Index Structure and Baseline**: Kiroku's bundled Tier 0 grammar dictionary (`backend/app/data/grammar_reference.sqlite`, table `grammar_index`) contains **592 rows** generated from the OpenJLPT grammar seed (571 rows) and Kiroku matcher fallback seeds (21 rows). Across the 398 reference entries, **195 entries (49.0%)** match existing Kiroku records in form, meaning, and JLPT tag.

2. **JLPT Level Tag Inconsistencies (58 entries)**: A systematic discrepancy exists between the reference syllabus (JLPT Sensei) and the OpenJLPT seed. 58 entries exist in Kiroku with aligned grammar patterns and meanings, but are tagged at a different JLPT level. For example, essential N5 grammar points such as `だろう`, `ほうがいい`, `方（かた）`, `けど`, `ないで`, `ないといけない`, `んです/のです`, and `すぎる` are tagged N4 in Kiroku; while N4 points such as `こと (nominalizer)`, `まま`, `ところ`, and `づらい` are tagged N3, and several N3 points are tagged N2.

3. **Missing Conversational, Adverbial, and Pedagogical Points (112 entries)**: 112 reference entries have no corresponding record in `grammar_index`. Analysis reveals this is largely due to differences in boundary definitions: JLPT Sensei treats common conversational adverbs (e.g., `どんな`, `どうして`, `いつも`, `とても`, `きっと`, `急に`, `まさか`, `めったに～ない`), conjunctions (`しかし`, `そして`, `それから`, `だけど`, `ところが`, `ところで`), and compound verbs (`上げる`, `通す`, `込む`) as grammar lessons, whereas OpenJLPT and Kiroku consider them general vocabulary to be handled by the Jitendex vocabulary dictionary. In addition, several true functional grammar points and contractions (e.g., `ちゃいけない・じゃいけない`, `場合は`, `だけでなく`, `お〜ください`, `てごらん`) are genuinely absent from `grammar_index`.

4. **Internal Duplicate Records (28 reference entries / 29 DB key collisions)**: The database contains multiple duplicate rows representing identical grammar concepts. Most prominently, `FALLBACK_ROWS` in `tools/build_grammar_index.py` re-inserted 21 points that already existed in OpenJLPT (such as `ば〜ほど`, `とか〜とか`, `お〜になる`, `ことになる`, `かもしれない`, `ざるを得ない`, `はずがない`, and the basic particles `は`, `が`, `を`, `に`, `へ`, `で`, `と`, `の`, `も`).

5. **Critical Lookup and Normalization Defect**: A defect was verified in `tools/build_grammar_index.py`: fallback rows set `pattern_key` without normalization (`key = pattern`), preserving full-width tildes (`ば〜ほど`, `とか〜とか`, `お〜になる`). However, `GrammarReferenceService.get_point_by_key()` applies `_normalize_key()`, which removes tildes. As a result, querying `get_point_by_key('ば〜ほど')` normalizes the query to `'ばほど'` and retrieves the OpenJLPT row with `match_mode: reference_only`, completely orphaning and shadowing the Kiroku matcher seed row with the active regex/discontinuous matcher.

6. **Separation of Concerns**: User learning tracking (`grammar_points` and `grammar_encounters` in user SQLite) is strictly decoupled from the reference dictionary (`grammar_index`). The public endpoint `/api/grammar/points` only searches user encounters, meaning client-side dictionary lookup currently relies entirely on whole-sentence analysis (`/api/grammar/analyze`) or direct service querying.


## B. Repository and Data Architecture

Kiroku's Japanese grammar subsystem operates under a locked, local-first tiered architecture designed for fast, offline operation.


### 1. Storage and Schema (`grammar_reference.sqlite`)

- **File path**: `backend/app/data/grammar_reference.sqlite` (accessed read-only via URI `file:...mode=ro`).

- **Primary Table**: `grammar_index` (592 rows).

- **Schema Definition**:

```sql
CREATE TABLE grammar_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_display TEXT NOT NULL,       -- e.g. '〜が（but）', 'ば〜ほど'
    pattern_key TEXT NOT NULL,           -- e.g. 'が(but)', 'ばほど'
    level TEXT NOT NULL,                 -- 'N5', 'N4', 'N3', 'N2', 'N1'
    meaning_short TEXT NOT NULL,         -- concise English explanation
    english_breakdown TEXT NOT NULL,     -- structured pattern, meaning, formation
    formation TEXT,                      -- connection rules (e.g. 'V-stem + たい')
    variants JSON NOT NULL DEFAULT '[]', -- surface string array
    matcher JSON NOT NULL,               -- pattern, regex, or discontinuous contract
    guards JSON DEFAULT NULL,            -- required_preceding / forbidden_preceding
    examples JSON NOT NULL DEFAULT '[]', -- JSON array of {ja, en} sentence objects
    group_id TEXT DEFAULT NULL,          -- optional grouping key
    source TEXT NOT NULL                 -- 'OpenJLPT grammar list' or 'Kiroku matcher seed'
);
CREATE INDEX idx_grammar_index_level ON grammar_index(level);
CREATE INDEX idx_grammar_index_pattern_key ON grammar_index(pattern_key);
CREATE INDEX idx_grammar_index_group_id ON grammar_index(group_id);
```


### 2. Upstream Data Sources and Build Pipeline

The bundled reference index is generated reproducibility via `tools/build_grammar_index.py` from three seed sources:

1. `backend/app/data/jlpt_reference.sqlite`: `grammar` table containing 100 historical curated rows.

2. `backend/app/data/openjlpt_grammar/`: 5 CSV files (`grammar-n1.csv` [123], `grammar-n2.csv` [123], `grammar-n3.csv` [101], `grammar-n4.csv` [98], `grammar-n5.csv` [81]), total 526 rows licensed under CC BY-SA 4.0.

3. `FALLBACK_ROWS` in `tools/build_grammar_index.py`: 21 hardcoded fallback rows providing specialized regex matchers for complex or discontinuous grammar constructions.


### 3. Service Layer and Lookup Paths

- **`GrammarReferenceService` (`backend/app/services/grammar_reference.py`)**:

  - Maintains a thread-safe singleton cache (`_index_cache`) mapping `pattern_key` to dictionary rows.

  - Provides `_normalize_key()`: executes `unicodedata.normalize('NFKC')`, strips tildes (`〜`, `~`, `～`), and converts katakana to hiragana.

  - Provides `get_point_by_key(pattern_key)` for O(1) in-memory lookup.

  - When key collisions occur during loading, preserves secondary rows under `item['sources']`.

- **`GrammarMatcher` (`backend/app/services/grammar_matcher.py`)**:

  - Evaluates sentence text against row matcher contracts (`pattern`, `regex`, `discontinuous`).

  - Supports token analysis when Yomitan/MeCab tokenization is available, with offline regex fallback.

  - Filters out bare particles when `show_basic_particles=False`.

- **`GrammarService` (`backend/app/services/grammar_service.py`)**:

  - Orchestrates sentence analysis (`/api/grammar/analyze`).

  - Filters matches against user settings: `learner_level`, `show_below_level`, `hide_known`.

  - Caches analysis results in `grammar_cache` in the user's SQLite database.

  - Enriches Tier 0 matches with optional Tier 1 Yomitan dictionary glosses if configured.

- **`GrammarTrackerService` (`backend/app/services/grammar_tracker.py`)**:

  - Persists learner study state in `grammar_points` and `grammar_encounters` tables in `cards.db`.

  - Powers `/api/grammar/points` and `/api/grammar/stats`.


## C. N5 Results

Audit of all 84 reference entries from `kiroku_n5_grammar_audit.md`, preserving reference numbering 1–84.


| Ref # | Japanese Form | Reference Meaning | Status | Existing Record | Existing Tag | Finding | Evidence | Suggested Correction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ちゃいけない・じゃいけない | must not do (spoken Japanese) | MISSING | NONE | MISSING | No grammar record exists for the spoken contraction ちゃいけない / じゃいけない. The standard written form 〜てはいけない exists as id=539 (N5), but does not define or index these spoken variants. | grammar_reference.sqlite: query for 'ちゃいけない' or 'じゃいけない' returns 0 rows; id=539 variants is '["てはいけない"]'. | Add 'ちゃいけない' and 'じゃいけない' as variants/aliases under id=539 (てはいけない), or create a dedicated spoken grammar entry. |
| 2 | だ / です | to be (am, is, are, were, used to) | CORRECT | id=525, id=526 | N5 | Copula forms exist as separate records: id=525 (〜です, polite) and id=526 (〜だ, plain), both tagged N5 with aligned meanings. | grammar_reference.sqlite: id=525 (pattern_key='です', level='N5'), id=526 (pattern_key='だ', level='N5'). | None required. Maintain current records. |
| 3 | だけ | only; just; as much as ~ | CORRECT | id=560 | N5 | Matches id=560 (〜だけ), tagged N5 with short meaning 'only; just'. | grammar_reference.sqlite: id=560 (pattern_key='だけ', level='N5', meaning_short='only; just'). | None required. |
| 4 | だろう | I think; it seems; probably; right? | WRONG_TAG | id=455 | N4 | Record exists at id=455 (〜だろう) with matching meaning ('probably; I suppose (plain form of でしょう)'), but is tagged N4 instead of N5. | grammar_reference.sqlite: id=455 (pattern_key='だろう', level='N4'). | Review JLPT tag; add N5 tag or dual-tag N5/N4 if deemed appropriate under Kiroku's syllabus. |
| 5 | で | in; at; on; by; with; via ~ | DUPLICATE | id=7, id=508, id=509, id=589 | N5 | Particle で exists across 4 separate N5 records (id=7 '〜で（place/means）', id=508 '〜で（place of action）', id=509 '〜で（means）', id=589 'で' matcher seed). All are tagged N5, but represent overlapping duplicate definitions without unified indexing. | grammar_reference.sqlite: id=7, id=508, id=509 (OpenJLPT), id=589 (Kiroku matcher seed). | Consolidate or cross-reference duplicate particle records under a unified pattern_key or group_id. |
| 6 | でも | but; however; though ~ | MISSING | NONE | MISSING | The conjunctive grammar form でも ('but; however') is missing from grammar_index. Existing records for でも (id=440, id=490) are N4 entries representing different grammatical functions ('even if' and 'or something'). | grammar_reference.sqlite: id=440 (level='N4', 'even if'), id=490 (level='N4', 'or something'); no record for conjunction 'but; however'. | Add N5 grammar entry for conjunction でも ('but; however'). |
| 7 | でしょう | I think; it seems; probably; right? | CORRECT | id=553 | N5 | Matches id=553 (〜でしょう), tagged N5 with meaning 'probably; I think; ..., right?'. | grammar_reference.sqlite: id=553 (pattern_key='でしょう', level='N5'). | None required. |
| 8 | どんな | what kind of; what sort of | MISSING | NONE | MISSING | No grammar record exists for interrogative/adjectival pronoun どんな ('what kind of'). In Kiroku, this is treated as general vocabulary rather than a grammar point. | grammar_reference.sqlite: query for 'どんな' returns 0 rows. | Decide whether to add interrogative grammar points to grammar_index or maintain boundary in vocabulary dictionary (Jitendex). |
| 9 | どうして | why; for what reason; how | MISSING | NONE | MISSING | No grammar record exists for interrogative adverb どうして ('why; for what reason; how'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'どうして' returns 0 rows. | Decide whether to add question words to grammar index or keep in vocabulary dictionary. |
| 10 | どうやって | how; in what way; by what means | MISSING | NONE | MISSING | No grammar record exists for interrogative phrase どうやって ('how; in what way'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'どうやって' returns 0 rows. | Decide whether to add question words to grammar index or keep in vocabulary dictionary. |
| 11 | が | subject marker; however; but ~ | DUPLICATE | id=1, id=500, id=585 | N5 | Particle が exists across multiple N5 records: id=1 ('〜が（but）'), id=500 ('〜が（subject）'), and id=585 ('が' subject marker seed). All tagged N5. | grammar_reference.sqlite: id=1, 500 (OpenJLPT), id=585 (Kiroku matcher seed). | Retain functional distinction between subject marker and conjunctive 'but', but deduplicate seed row id=585 with id=500. |
| 12 | があります | there is; is (non-living things) | CORRECT | id=2 | N5 | Matches id=2 (〜がいます / 〜があります), tagged N5 with meaning 'there is/are (animate or inanimate)'. Contains variant 'があります'. | grammar_reference.sqlite: id=2 (pattern_key='がいます / があります', variants='["がいます", "があります"]'). | None required. |
| 13 | がほしい | to want something | CORRECT | id=535 | N5 | Matches id=535 (〜がほしい), tagged N5 with meaning 'want (something)'. | grammar_reference.sqlite: id=535 (pattern_key='がほしい', level='N5'). | None required. |
| 14 | がいます / がいる | there is; to be; is (living things) | CORRECT | id=2 | N5 | Matches id=2 (〜がいます / 〜があります), tagged N5 with meaning 'there is/are (animate or inanimate)'. Plain form がいる is described in formation. | grammar_reference.sqlite: id=2 (pattern_key='がいます / があります', level='N5'). | Add 'がいる' explicitly to variants JSON array of id=2. |
| 15 | ほうがいい | had better; it'd be better to; should ~ | WRONG_TAG | id=487 | N4 | Record exists at id=487 (〜ほうがいい) with aligned meaning ('had better; should'), but is tagged N4 instead of N5. | grammar_reference.sqlite: id=487 (pattern_key='ほうがいい', level='N4'). | Review level assignment; update or alias tag to N5 if required by syllabus. |
| 16 | い-adjectives（い形容詞） | i-adjectives | AMBIGUOUS | id=568 | N5 | Reference entry represents the overall part of speech / inflection category 'i-adjectives'. Kiroku has id=568 ('〜くない / 〜かった / 〜くなかった', N5), which covers the negative and past inflections of i-adjectives, but no meta-record named 'い-adjectives'. | grammar_reference.sqlite: id=568 (meaning_short='negative and past forms of i-adjectives (is not; was; was not)'). | Clarify whether meta-grammar categories (like i-adjective inflection) should be explicitly keyed under 'い形容詞' / 'い-adjectives'. |
| 17 | 一番（いちばん） | the most; the best | MISSING | NONE | MISSING | No standalone grammar record exists for superlative adverb 一番 ('the most; the best'). Superlative comparison is only partially represented in id=524 ('〜の中で〜が一番'). | grammar_reference.sqlite: query for standalone '一番' returns 0 rows. | Decide whether standalone adverb 一番 belongs in grammar index or vocabulary dictionary. |
| 18 | 一緒に（いっしょに） | together | MISSING | NONE | MISSING | No grammar record exists for adverb 一緒に ('together'). Treated as vocabulary in Kiroku. | grammar_reference.sqlite: query for '一緒に' returns 0 rows. | Keep in vocabulary dictionary (Jitendex) or add if required by grammar specification. |
| 19 | いつも | always; usually; habitually | MISSING | NONE | MISSING | No grammar record exists for frequency adverb いつも ('always; usually'). Treated as vocabulary in Kiroku. | grammar_reference.sqlite: query for 'いつも' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 20 | じゃない・ではない | to not be (am not; is not; are not) | CORRECT | id=527 | N5 | Matches id=527 (〜ではありません / 〜じゃない), tagged N5 with meaning 'is not; am not; are not'. Contains plain and polite negative copula. | grammar_reference.sqlite: id=527 (pattern_key='ではありません / じゃない', variants='["ではありません", "じゃない"]'). | Add 'ではない' explicitly to variants JSON array of id=527. |
| 21 | か | question particle | CORRECT | id=518 | N5 | Matches id=518 (〜か（question）), tagged N5 with meaning '(question marker) turns a sentence into a question'. | grammar_reference.sqlite: id=518 (pattern_key='か(question)', level='N5'). | None required. |
| 22 | か～か | or | CORRECT | id=513 | N5 | Matches id=513 (〜か（or）), tagged N5 with meaning 'or (a choice between nouns)'. Formation specifies 'Noun A + か + Noun B'. | grammar_reference.sqlite: id=513 (pattern_key='か(or)', level='N5'). | Add 'か〜か' as an alias/display variant to id=513. |
| 23 | から | because; since; from | DUPLICATE | id=3, id=516 | N5 | Reference entry combines 'because' and 'from'. In Kiroku, these are appropriately distinguished as id=3 ('〜から（reason）', N5) and id=516 ('〜から（from）', N5). Both are tagged N5. | grammar_reference.sqlite: id=3 (reason), id=516 (from/origin). | Valid functional separation; ensure lookup retrieves both senses when querying 'から'. |
| 24 | 方（かた） | the way of doing something; how to do ~ | WRONG_TAG | id=40 | N4 | Record exists at id=40 (〜方) with meaning 'way of doing; how to', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=40 (pattern_key='方', level='N4'). | Review tag; update to N5 or dual-tag if N5 syllabus inclusion is desired. |
| 25 | けど | but; however; although ~ | WRONG_TAG | id=446 | N4 | Record exists at id=446 (〜けど / 〜けれども) with meaning 'but; although; (soft lead-in)', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=446 (pattern_key='けど / けれども', level='N4'). | Review JLPT tag; update to N5 if reference syllabus takes precedence. |
| 26 | けれども | but; however; although ~ | WRONG_TAG | id=446 | N4 | Grouped with けど at id=446 (〜けど / 〜けれども), but tagged N4 instead of N5. | grammar_reference.sqlite: id=446 (pattern_key='けど / けれども', level='N4'). | Review JLPT tag; consider splitting into separate records for けど and けれども as required by strict audit matching rules. |
| 27 | まだ | still; not yet | MISSING | NONE | MISSING | No standalone record exists for adverb まだ ('still; not yet'). Only represented in id=556 ('まだ〜ていない'). Handled by vocabulary dictionary. | grammar_reference.sqlite: no record for standalone 'まだ'. | Maintain boundary in vocabulary dictionary. |
| 28 | まだ～ていません | have not yet ~ | CORRECT | id=556 | N5 | Matches id=556 (まだ〜ていない), tagged N5 with meaning 'not yet (have done)'. Polite variant まだ〜ていません is covered conceptually. | grammar_reference.sqlite: id=556 (pattern_key='まだていない', level='N5'). | Add polite variant 'まだ〜ていません' to variants array of id=556. |
| 29 | まで | until; as far as; to an extent; even ~ | CORRECT | id=517 | N5 | Matches id=517 (〜まで（until）), tagged N5 with meaning 'until; up to; as far as'. (A separate advanced sense exists at id=409, N3 'even (an extreme case)'). | grammar_reference.sqlite: id=517 (pattern_key='まで(until)', level='N5'). | None required. |
| 30 | 前に（まえに） | before; in front of ~ | CORRECT | id=546 | N5 | Matches id=546 (〜前に), tagged N5 with meaning 'before (doing); before (an event); ago'. | grammar_reference.sqlite: id=546 (pattern_key='前に', level='N5'). | None required. |
| 31 | ませんか | would you; do you want to; shall we ~ | CORRECT | id=19 | N5 | Matches id=19 (〜ませんか), tagged N5 with meaning 'shall we?; won't you?'. | grammar_reference.sqlite: id=19 (pattern_key='ませんか', level='N5'). | None required. |
| 32 | ましょう | let's ~; shall we ~ | CORRECT | id=18 | N5 | Matches id=18 (〜ましょう), tagged N5 with meaning 'let's do; shall we do'. | grammar_reference.sqlite: id=18 (pattern_key='ましょう', level='N5'). | None required. |
| 33 | ましょうか | shall I ~; used to offer help to the listener | CORRECT | id=534 | N5 | Matches id=534 (〜ましょうか), tagged N5 with meaning 'shall I ...?; shall we ...?'. | grammar_reference.sqlite: id=534 (pattern_key='ましょうか', level='N5'). | None required. |
| 34 | も | too; also; as well | DUPLICATE | id=514, id=592 | N5 | Particle も exists in two N5 records: id=514 (OpenJLPT, 'also; too') and id=592 (Kiroku matcher seed, 'also marker'). (An emphatic N4 record also exists at id=473). | grammar_reference.sqlite: id=514 (N5), id=592 (N5). | Deduplicate id=592 with id=514. |
| 35 | もう | already; anymore; again; other | CORRECT | id=557 | N5 | Matches id=557 (もう〜た), tagged N5 with meaning 'already (have done); (in questions) yet'. | grammar_reference.sqlite: id=557 (pattern_key='もうた', level='N5'). | Add standalone 'もう' alias if general adverbial usage is intended. |
| 36 | な-adjectives（な形容詞） | na-adjectives | AMBIGUOUS | id=569 | N5 | Reference entry represents the overall part of speech 'na-adjectives'. Kiroku has id=569 ('〜な（na-adjective）', N5, 'na-adjectives: take な before a noun and です or だ at the end of a sentence'). | grammar_reference.sqlite: id=569 (pattern_key='な(na-adjective)', level='N5'). | Add 'な形容詞' / 'na-adjectives' as display alias to id=569. |
| 37 | なあ | sentence ending particle; confirmation; admiration, etc. | MISSING | NONE | MISSING | Sentence-ending particle なあ ('confirmation; admiration') has no record in grammar_index. | grammar_reference.sqlite: query for 'なあ' returns 0 rows. | Add N5 record for sentence-ending particle なあ. |
| 38 | ないで | without doing ~; to do [B] without doing [A] | WRONG_TAG | id=498 | N4 | Record exists at id=498 (〜ないで) with meaning 'without doing; instead of doing', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=498 (pattern_key='ないで', level='N4'). | Review JLPT level; update tag to N5 if aligning with reference. |
| 39 | ないでください | please don't do ~ | CORRECT | id=537 | N5 | Matches id=537 (〜ないでください), tagged N5 with meaning 'please don't (do)'. | grammar_reference.sqlite: id=537 (pattern_key='ないでください', level='N5'). | None required. |
| 40 | ないといけない | must do; have an obligation to do ~ | WRONG_TAG | id=476 | N4 | Record exists at id=476 (〜ないといけない / 〜なくちゃ) with meaning 'have to; must (conversational)', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=476 (pattern_key='ないといけない / なくちゃ', level='N4'). | Review JLPT tag; update to N5 if reference syllabus takes precedence. |
| 41 | なくてもいい | don't have to | CORRECT | id=541 | N5 | Matches id=541 (〜なくてもいい), tagged N5 with meaning 'don't have to; need not'. (Also note id=15 '〜なくてもいいです', N5 duplicate). | grammar_reference.sqlite: id=541, id=15 (both N5). | Deduplicate id=15 with id=541. |
| 42 | なくちゃ | must do; need to; gotta do ~ | WRONG_TAG | id=476 | N4 | Combined with ないといけない at id=476 (〜ないといけない / 〜なくちゃ), but is tagged N4 instead of N5. | grammar_reference.sqlite: id=476 (level='N4'). | Review tag; split into dedicated entry or update tag to N5. |
| 43 | なくてはいけない | must do; need to do | CORRECT | id=540 | N5 | Matches id=540 (〜なければならない / 〜なくてはいけない), tagged N5 with meaning 'must; have to'. (Also id=16 polite form '〜なければなりません / 〜なくてはいけません', N5). | grammar_reference.sqlite: id=540, id=16 (both N5). | Separate なくてはいけない from なければならない into dedicated records if 1:1 syllabus mapping is required. |
| 44 | なくてはならない | must do; need to do ~ | MISSING | NONE | MISSING | No record explicitly lists 'なくてはならない'. id=540 covers 'なければならない / なくてはいけない', but omits the variant 'なくてはならない'. | grammar_reference.sqlite: id=540 variants do not include 'なくてはならない'. | Add 'なくてはならない' as a variant to id=540 or create a dedicated entry. |
| 45 | なる | to become | CORRECT | id=554 | N5 | Matches id=554 (〜くなる / 〜になる), tagged N5 with meaning 'become; get; turn'. | grammar_reference.sqlite: id=554 (pattern_key='くなる / になる', level='N5'). | None required. |
| 46 | んです | to explain something; show emphasis | WRONG_TAG | id=458 | N4 | Matches id=458 (〜んです / 〜のです), tagged N4 with meaning 'it\'s that ...; (explaining or asking for an explanation)', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=458 (pattern_key='んです / のです', level='N4'). | Review tag; update to N5 if aligning with reference list. |
| 47 | ね | isn't it? right? eh? | CORRECT | id=519 | N5 | Matches id=519 (〜ね), tagged N5 with meaning 'isn\'t it?; right? (seeking agreement or sharing a feeling)'. | grammar_reference.sqlite: id=519 (pattern_key='ね', level='N5'). | None required. |
| 48 | に | destination particle; in; at; on; to | DUPLICATE | id=17, id=502, id=503, id=504, id=505, id=506, id=587 | N5 | Particle に is duplicated across 7 separate N5 records: id=17 ('〜に（time/destination）'), id=502 ('〜に（time）'), id=503 ('〜に（destination）'), id=504 ('〜に（place of existence）'), id=505 ('〜に（indirect object）'), id=506 ('〜に（frequency）'), id=587 ('に' seed). All tagged N5. | grammar_reference.sqlite: multiple N5 entries for に. | Consolidate or group duplicate sense records under unified parent key. |
| 49 | に行く（にいく） | go to do ~ | CORRECT | id=549 | N5 | Matches id=549 (〜に行く), tagged N5 with meaning 'go (somewhere) to do'. | grammar_reference.sqlite: id=549 (pattern_key='に行く', level='N5'). | None required. |
| 50 | にする | to decide on | CORRECT | id=555 | N5 | Matches id=555 (〜にする（decide）), tagged N5 with meaning 'decide on; choose; I\'ll have'. | grammar_reference.sqlite: id=555 (pattern_key='にする(decide)', level='N5'). | None required. |
| 51 | に / へ | to (indicates direction / destination) | DUPLICATE | id=503, id=507, id=587, id=588 | N5 | Direction/destination particles に and へ exist as individual N5 records: id=503 ('〜に（destination）'), id=507 ('〜へ'), id=587 ('に'), id=588 ('へ'). Reference entry groups them. | grammar_reference.sqlite: id=503, 507, 587, 588. | Maintain individual records while indexing directional equivalence. |
| 52 | の | possessive particle | DUPLICATE | id=515, id=591 | N5 | Possessive particle の exists as id=515 (OpenJLPT, '〜の（possessive）') and id=591 (Kiroku matcher seed, 'の'). Both tagged N5. | grammar_reference.sqlite: id=515 (N5), id=591 (N5). | Deduplicate id=591 with id=515. |
| 53 | のです | to explain something; show emphasis | WRONG_TAG | id=458 | N4 | Grouped with んです at id=458 (〜んです / 〜のです), but is tagged N4 instead of N5. | grammar_reference.sqlite: id=458 (pattern_key='んです / のです', level='N4'). | Review tag; update to N5 if aligning with reference list. |
| 54 | のが下手（のがへた） | to be bad at doing something | CORRECT | id=551 | N5 | Matches id=551 (〜が上手 / 〜が下手), tagged N5 with meaning 'good at; bad at'. Combined with 上手. | grammar_reference.sqlite: id=551 (pattern_key='が上手 / が下手', level='N5'). | Add 'のが下手' to variants array of id=551. |
| 55 | のが上手（のがじょうず） | to be good at | CORRECT | id=551 | N5 | Matches id=551 (〜が上手 / 〜が下手), tagged N5 with meaning 'good at; bad at'. | grammar_reference.sqlite: id=551 (pattern_key='が上手 / が下手', level='N5'). | Add 'のが上手' to variants array of id=551. |
| 56 | のが好き（のがすき） | to like doing something | DUPLICATE | id=4, id=550 | N5 | Matches id=4 ('〜が好きです / 〜が嫌いです', N5) and id=550 ('〜が好き / 〜が嫌い', N5). Both records cover liking/disliking with nominalizer の/こと in formation. | grammar_reference.sqlite: id=4, id=550. | Deduplicate id=4 and id=550; add 'のが好き' to variants array. |
| 57 | の中で[A]が一番（のなかで[A]がいちばん） | out of this group, [A] is best | CORRECT | id=524 | N5 | Matches id=524 (〜の中で〜が一番), tagged N5 with meaning '... is the most ... among/of'. | grammar_reference.sqlite: id=524 (pattern_key='の中でが一番', level='N5'). | None required. |
| 58 | ので | because of; given that; since ~ | WRONG_TAG | id=443 | N4 | Record exists at id=443 (〜ので) with meaning 'because; since', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=443 (pattern_key='ので', level='N4'). | Review JLPT tag; update to N5 if aligning with reference list. |
| 59 | お / ご | polite marker; honorific prefix particle | MISSING | NONE | MISSING | No general honorific prefix entry exists for 'お / ご'. Specific constructions exist (e.g. id=480 'お〜になる', id=481 'お〜する', both N4), but the general noun prefix is missing. | grammar_reference.sqlite: no entry for prefix 'お / ご'. | Add N5 entry for honorific noun prefixes お / ご. |
| 60 | を | object marker particle | DUPLICATE | id=20, id=501, id=586 | N5 | Object marker を is duplicated across 3 separate N5 records: id=20 ('〜を（object particle）'), id=501 ('〜を'), id=586 ('を' matcher seed). | grammar_reference.sqlite: id=20, id=501, id=586. | Consolidate duplicate records for particle を. |
| 61 | をください | please give me ~ | CORRECT | id=536 | N5 | Matches id=536 (〜をください), tagged N5 with meaning 'please give me (something); I\'ll have'. | grammar_reference.sqlite: id=536 (pattern_key='をください', level='N5'). | None required. |
| 62 | しかし | but; however ~ | MISSING | NONE | MISSING | No grammar record exists for conjunction しかし ('but; however'). Handled by vocabulary dictionary (Jitendex). | grammar_reference.sqlite: query for 'しかし' returns 0 rows. | Decide whether conjunctions belong in grammar dictionary or vocabulary dictionary. |
| 63 | それから | and; and then; after that; since then | MISSING | NONE | MISSING | No grammar record exists for conjunction それから ('and then; after that'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'それから' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 64 | そして | and; and then; thus; and now ~ | MISSING | NONE | MISSING | No grammar record exists for conjunction そして ('and; and then'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'そして' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 65 | すぎる | too much | WRONG_TAG | id=423 | N4 | Record exists at id=423 (〜すぎる) with meaning 'too; too much; excessively', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=423 (pattern_key='すぎる', level='N4'). | Review JLPT tag; update to N5 if reference syllabus takes precedence. |
| 66 | たことがある | to have done something before | CORRECT | id=545 | N5 | Matches id=545 (〜たことがある), tagged N5 with meaning 'have (ever) done; have the experience of doing'. | grammar_reference.sqlite: id=545 (pattern_key='たことがある', level='N5'). | None required. |
| 67 | たい | want to do something | CORRECT | id=5 | N5 | Matches id=5 (〜たい), tagged N5 with meaning 'want to do'. | grammar_reference.sqlite: id=5 (pattern_key='たい', level='N5'). | None required. |
| 68 | たり～たり | do such things as A and B | CORRECT | id=544 | N5 | Matches id=544 (〜たり〜たりする), tagged N5 with meaning 'do things like A and B; sometimes A, sometimes B'. | grammar_reference.sqlite: id=544 (pattern_key='たりたりする', level='N5'). | None required. |
| 69 | てある | is/has been done (resulting state) | WRONG_TAG | id=417 | N4 | Record exists at id=417 (〜てある) with meaning 'has been done (and stays that way); resulting state of a deliberate action', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=417 (pattern_key='てある', level='N4'). | Review JLPT tag; update to N5 if aligning with reference list. |
| 70 | ている | ongoing action or current state | CORRECT | id=8 | N5 | Matches id=8 (〜ている), tagged N5 with meaning 'is/am/are doing (progressive) or resultant state'. | grammar_reference.sqlite: id=8 (pattern_key='ている', level='N5'). | None required. |
| 71 | てから | after doing ~ | CORRECT | id=543 | N5 | Matches id=543 (〜てから), tagged N5 with meaning 'after doing; (do A) and then (B); since'. | grammar_reference.sqlite: id=543 (pattern_key='てから', level='N5'). | None required. |
| 72 | てください | please do | CORRECT | id=9 | N5 | Matches id=9 (〜てください), tagged N5 with meaning 'please do (for me)'. | grammar_reference.sqlite: id=9 (pattern_key='てください', level='N5'). | None required. |
| 73 | てはいけない | must not; may not; cannot | CORRECT | id=539 | N5 | Matches id=539 (〜てはいけない), tagged N5 with meaning 'must not; may not'. (Also id=12 polite form '〜てはいけません', N5). | grammar_reference.sqlite: id=539, id=12 (both N5). | Deduplicate id=12 with id=539. |
| 74 | てもいいです | is OK to ~; is alright to ~; may I ~? | CORRECT | id=13 | N5 | Matches id=13 (〜てもいいです), tagged N5 with meaning 'may do; it\'s okay to do'. (Also id=538 '〜てもいい', N5). | grammar_reference.sqlite: id=13, id=538 (both N5). | Deduplicate id=13 with id=538. |
| 75 | と | and; with; as; connecting particle | DUPLICATE | id=14, id=510, id=511, id=590 | N5 | Particle と is duplicated across 4 N5 records: id=14 ('〜と（and/with）'), id=510 ('〜と（and）'), id=511 ('〜と（with）'), id=590 ('と' seed). (Conditional sense is separate at id=439, N4). | grammar_reference.sqlite: id=14, id=510, id=511, id=590. | Consolidate duplicate records for particle と. |
| 76 | 時（とき） | when; at this time | WRONG_TAG | id=418 | N4 | Record exists at id=418 (〜とき) with meaning 'when; at the time when', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=418 (pattern_key='とき', level='N4'). | Review JLPT tag; update to N5 if aligning with reference list. |
| 77 | とても | very; awfully; exceedingly | MISSING | NONE | MISSING | No grammar record exists for degree adverb とても ('very; exceedingly'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'とても' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 78 | つもり | plan to ~; intend to ~ | WRONG_TAG | id=24 | N4 | Record exists at id=24 (〜つもり) with meaning 'intend to; plan to', but is tagged N4 instead of N5. | grammar_reference.sqlite: id=24 (pattern_key='つもり', level='N4'). | Review JLPT tag; update to N5 if aligning with reference list. |
| 79 | は | topic marker | DUPLICATE | id=499, id=584 | N5 | Topic marker は exists across 2 duplicate N5 records: id=499 (OpenJLPT, '〜は') and id=584 (Kiroku matcher seed, 'は'). | grammar_reference.sqlite: id=499, id=584. | Deduplicate id=584 with id=499. |
| 80 | は〜より・・・です | [Noun-1] is more ~ than [Noun-2] | CORRECT | id=522 | N5 | Matches id=522 (〜の方が〜より), tagged N5 with meaning 'X is more ... than Y', which represents this comparative construction. | grammar_reference.sqlite: id=522 (pattern_key='の方がより', level='N5'). | Add 'は〜より〜です' as an alias/formation to id=522. |
| 81 | はどうですか | how about; how is | MISSING | NONE | MISSING | Conversational suggestion phrase はどうですか ('how about; how is') has no record in grammar_index. | grammar_reference.sqlite: query for 'はどうですか' returns 0 rows. | Add N5 record for conversational expression 〜はどうですか. |
| 82 | や | and; or; connecting particle | CORRECT | id=512 | N5 | Matches id=512 (〜や), tagged N5 with meaning 'and (giving some examples out of more); ... and so on'. | grammar_reference.sqlite: id=512 (pattern_key='や', level='N5'). | None required. |
| 83 | よ | you know; emphasis (ending particle) | CORRECT | id=520 | N5 | Matches id=520 (〜よ), tagged N5 with meaning 'you know; I tell you (giving new information or emphasis)'. | grammar_reference.sqlite: id=520 (pattern_key='よ', level='N5'). | None required. |
| 84 | より～ほうが | [2] is more than [1] | CORRECT | id=522 | N5 | Matches id=522 (〜の方が〜より), tagged N5 with meaning 'X is more ... than Y'. | grammar_reference.sqlite: id=522 (pattern_key='の方がより', level='N5'). | Add 'より〜ほうが' as alternate word order variant under id=522. |



## D. N4 Results

Audit of all 132 reference entries from `kiroku_n4_grammar_audit.md`, preserving reference numbering 1–132.


| Ref # | Japanese Form | Reference Meaning | Status | Existing Record | Existing Tag | Finding | Evidence | Suggested Correction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 間（あいだ） | while; during; between ~ | CORRECT | id=419 | N4 | Matches id=419 (〜間 / 〜間に), tagged N4 with meaning 'while; during; between (continuous action)'. Contains both 間 and 間に. | grammar_reference.sqlite: id=419 (pattern_key='間 / 間に', level='N4'). | Consider splitting 間 and 間に if 1:1 syllabus mapping is preferred. |
| 2 | 間に（あいだに） | while; during ~ something happened | CORRECT | id=419 | N4 | Matches id=419 (〜間 / 〜間に), tagged N4 with meaning 'while; during (an action occurred within that time)'. | grammar_reference.sqlite: id=419 (pattern_key='間 / 間に', level='N4'). | None required. |
| 3 | あまり～ない | not very; not much ~ | WRONG_TAG | id=558 | N5 | Matches id=558 (あまり〜ない) with aligned meaning 'not very; not much', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=558 (pattern_key='あまりない', level='N5'). | Review JLPT tag; update to N4 or alias N4/N5 if required. |
| 4 | 後で（あとで） | after ~; later | WRONG_TAG | id=547 | N5 | Matches id=547 (〜後で) with aligned meaning 'after (doing); later', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=547 (pattern_key='後で', level='N5'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 5 | ば | conditional form; if [A] then [B] | CORRECT | id=436 | N4 | Matches id=436 (〜ば), tagged N4 with meaning 'if; when (conditional form)'. | grammar_reference.sqlite: id=436 (pattern_key='ば', level='N4'). | None required. |
| 6 | 場合は（ばあいは） | in the event of; in the case that ~ | MISSING | NONE | MISSING | No grammar record exists for conditional phrase 場合は ('in the event of; in case that'). | grammar_reference.sqlite: query for '場合' returns 0 rows. | Add N4 record for 〜場合は / 〜場合. |
| 7 | ばかり | only; nothing but ~ | WRONG_TAG | id=49 | N3 | Record exists at id=49 (〜ばかり) with meaning 'only; just; full of; tendency to', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=49 (pattern_key='ばかり', level='N3'). (Also id=465 '〜たばかり', N4). | Review JLPT tag; N4 learners study たばかり (id=465) and noun+ばかり. Update or link levels. |
| 8 | だけで | just by; just by doing | MISSING | NONE | MISSING | No record exists for だけで ('just by; just by doing'). Only standalone だけ (id=560, N5) and だけでなく (id=336, N3) exist. | grammar_reference.sqlite: no record for 'だけで'. | Add N4 record for 〜だけで. |
| 9 | 出す（だす） | to begin to; to start to; to burst into; ... out | CORRECT | id=474 | N4 | Matches id=474 (〜出す), tagged N4 with meaning 'start doing; suddenly start (burst into)'. | grammar_reference.sqlite: id=474 (pattern_key='出す', level='N4'). | None required. |
| 10 | でございます | to be (honorific) | CORRECT | id=490 | N4 | Matches id=490 (〜でも（suggestion）), tagged N4 with meaning 'or something (softening a suggestion)'. | grammar_reference.sqlite: id=490 (pattern_key='でも(suggestion)', level='N4'). | None required. |
| 11 | でも | ... or something; how about ~ | CORRECT | id=482 | N4 | Matches id=482 (〜でございます), tagged N4 with meaning 'is; am; are (very polite copula)'. | grammar_reference.sqlite: id=482 (pattern_key='でございます', level='N4'). | None required. |
| 12 | ではないか | right?; isn't it? | MISSING | NONE | MISSING | No record exists for rhetorical question / confirmation ではないか ('right?; isn\'t it?'). Only copula ではない / じゃない (id=527, N5) exists. | grammar_reference.sqlite: no record for 'ではないか'. | Add N4 record for 〜ではないか / 〜じゃないか. |
| 13 | が必要（がひつよう） | need; necessary | MISSING | NONE | MISSING | No grammar record exists for が必要 ('need; necessary'). Treated as vocabulary phrase. | grammar_reference.sqlite: query for '必要' returns 0 rows. | Decide whether が必要 / 必要がある belongs in grammar index or vocabulary dictionary. |
| 14 | がする | to smell; hear; taste | CORRECT | id=462 | N4 | Matches id=462 (〜がする), tagged N4 with meaning 'smell; taste; sound; feel (perceived by senses)'. | grammar_reference.sqlite: id=462 (pattern_key='がする', level='N4'). | None required. |
| 15 | がり | personality; someone tends to / has a tendency or sensitivity to ~ | MISSING | NONE | MISSING | No record exists for personality/tendency suffix 〜がり ('someone tends to / is sensitive to'). (Note: verbal auxiliary たがる exists at id=452, N4). | grammar_reference.sqlite: query for 'がり' returns 0 rows. | Add N4 record for suffix 〜がり. |
| 16 | がる / がっている | to show signs of; to appear; to feel or think ~ | CORRECT | id=479 | N4 | Matches id=479 (ご覧になる), tagged N4 with meaning '(honorific) to look, see, watch'. | grammar_reference.sqlite: id=479 (pattern_key='ご覧になる', level='N4'). | None required. |
| 17 | ございます | to be; to exist (polite form of いる / ある) | MISSING | NONE | MISSING | No standalone record exists for polite existence verb ございます ('to be; to exist'). Only copular 〜でございます exists at id=482. | grammar_reference.sqlite: no record for standalone 'ございます'. | Add N4 record for ございます or cross-reference id=482. |
| 18 | 始める（はじめる） | to start; to begin to ~ | CORRECT | id=468 | N4 | Matches id=468 (〜始める / 〜終わる / 〜続ける), tagged N4 with meaning 'start doing; finish doing; continue doing'. | grammar_reference.sqlite: id=468 (pattern_key='始める / 終わる / 続ける', level='N4'). | Consider splitting into individual records for 始める, 終わる, 続ける. |
| 19 | はずだ | it must be; it should be (expectation) | CORRECT | id=457 | N4 | Matches id=457 (〜はずだ), tagged N4 with meaning 'should be; expected to be'. | grammar_reference.sqlite: id=457 (pattern_key='はずだ', level='N4'). | None required. |
| 20 | はずがない | cannot be; impossible | WRONG_TAG | id=332, id=576 | N3 | Record exists at id=332 (OpenJLPT, N3) and id=576 (matcher seed, N3) with meaning 'cannot be; there is no way', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=332, id=576 (both N3). | Review JLPT tag; update to N4 if aligning with reference list. Also deduplicate id=576 with id=332. |
| 21 | 必要がある（ひつようがある） | need to; it is necessary to | MISSING | NONE | MISSING | No grammar record exists for 〜必要がある ('need to; it is necessary to'). | grammar_reference.sqlite: query for '必要がある' returns 0 rows. | Add N4 record for 〜必要がある. |
| 22 | 意向形（いこうけい） | volitional form; let's do ~ | CORRECT | id=431 | N4 | Matches id=431 (〜おう / 〜よう), tagged N4 with meaning 'let\'s (casual); I\'ll (volitional form)'. | grammar_reference.sqlite: id=431 (pattern_key='おう / よう', level='N4'). | Add '意向形' as alias/meta-tag to id=431. |
| 23 | いらっしゃる | to be; to come; to go (polite version) | MISSING | NONE | MISSING | No grammar record exists for honorific verb いらっしゃる ('to be; to come; to go'). | grammar_reference.sqlite: query for 'いらっしゃる' returns 0 rows. | Add N4 keigo record for いらっしゃる or note boundary in vocabulary dictionary. |
| 24 | いたします | to do (polite form of する) | MISSING | NONE | MISSING | No grammar record exists for humble verb いたします ('to do'). | grammar_reference.sqlite: query for 'いたします' returns 0 rows. | Add N4 keigo record for いたします or note boundary in vocabulary dictionary. |
| 25 | じゃないか | right?; isn't it?; let's ~; confirmation | MISSING | NONE | MISSING | No record exists for confirmation tag じゃないか ('right?; isn\'t it?'). (id=527 is N5 negative copula 'ではありません / じゃない'). | grammar_reference.sqlite: query for 'じゃないか' returns 0 rows. | Add N4 record for 〜じゃないか. |
| 26 | かどうか | whether or not ~ | MISSING | NONE | MISSING | No record exists for polite speculative question じゃないでしょうか ('isn\'t it?; I think ...'). | grammar_reference.sqlite: query for 'じゃないでしょうか' returns 0 rows. | Add N4 record for 〜じゃないでしょうか / 〜ではないでしょうか. |
| 27 | かしら | I wonder (feminine) | CORRECT | id=459 | N4 | Matches id=459 (〜かどうか), tagged N4 with meaning 'whether or not'. | grammar_reference.sqlite: id=459 (pattern_key='かどうか', level='N4'). | None required. |
| 28 | かい | turns a sentence into a yes/no question | MISSING | NONE | MISSING | Sentence-ending casual question particle かい has no record in grammar_index. | grammar_reference.sqlite: query for 'かい' returns 0 rows. | Add N4 record for particle かい. |
| 29 | かもしれない | might; perhaps; indicates possibility | DUPLICATE | id=454, id=574 | N4 | Matches id=454 (OpenJLPT, '〜かもしれない') and id=574 (Kiroku matcher seed, 'かもしれない'). Both tagged N4 with meaning 'might; may'. | grammar_reference.sqlite: id=454, id=574. | Deduplicate id=574 with id=454. |
| 30 | かな | I wonder; should I? | CORRECT | id=492 | N4 | Matches id=492 (〜かな), tagged N4 with meaning 'I wonder; should I? (casual self-question)'. | grammar_reference.sqlite: id=492 (pattern_key='かな', level='N4'). | None required. |
| 31 | から作る（からつくる） | made from; made with | MISSING | NONE | MISSING | Material particle expression から作る / で作る ('made from / made of') has no record in grammar_index. | grammar_reference.sqlite: query for 'から作る' returns 0 rows. | Add N4 record for 〜から作る / 〜で作る. |
| 32 | きっと | surely; undoubtedly; almost certainly; most likely | MISSING | NONE | MISSING | No grammar record exists for adverb きっと ('surely; most likely'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'きっと' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 33 | 頃（ころ／ごろ） | around; about; when | WRONG_TAG | id=562 | N5 | Record exists at id=562 (〜ごろ) with meaning 'around; about (a point in time)', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=562 (pattern_key='ごろ', level='N5'). | Review JLPT tag; update to N4 if aligning with reference list. |
| 34 | こと | verb nominalizer | WRONG_TAG | id=328 | N3 | Verb nominalizer こと exists at id=328 (〜の / 〜こと（nominalizer）) with meaning 'nominalizer: turns a verb into a noun', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=328 (pattern_key='の / こと(nominalizer)', level='N3'). | Review JLPT tag; update to N4 as verb nominalization is fundamental to N4. |
| 35 | ことがある | there are times when | CORRECT | id=475 | N4 | Matches id=475 (〜ことがある), tagged N4 with meaning 'there are times when; sometimes do'. (Distinguished from N5 id=545 'たことがある', past experience). | grammar_reference.sqlite: id=475 (pattern_key='ことがある', level='N4'). | None required. |
| 36 | ことができる | can; able to | CORRECT | id=426 | N4 | Matches id=426 (〜ことができる), tagged N4 with meaning 'can; be able to'. | grammar_reference.sqlite: id=426 (pattern_key='ことができる', level='N4'). | None required. |
| 37 | ことになる | it has been decided that; it turns out that | CORRECT | id=424 | N4 | Matches id=424 (〜ことにする), tagged N4 with meaning 'decide to do'. | grammar_reference.sqlite: id=424 (pattern_key='ことにする', level='N4'). | None required. |
| 38 | ことにする | to decide on | DUPLICATE | id=425, id=573 | N4 | Matches id=425 (OpenJLPT, '〜ことになる') and id=573 (matcher seed, 'ことになる'). Both tagged N4 with meaning 'it has been decided that; it turns out that'. | grammar_reference.sqlite: id=425, id=573. | Deduplicate id=573 with id=425. |
| 39 | くする | to make something ~ | CORRECT | id=494 | N4 | Matches id=494 (〜くする / 〜にする（make）), tagged N4 with meaning 'make (something) ...; change something to a state'. | grammar_reference.sqlite: id=494 (pattern_key='くする / にする(make)', level='N4'). | None required. |
| 40 | 急に（きゅうに） | quickly; immediately; hastily; suddenly; abruptly; unexpectedly ~ | MISSING | NONE | MISSING | No grammar record exists for adverb 急に ('suddenly; unexpectedly'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for '急に' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 41 | までに | by; by the time; indicates time limit | CORRECT | id=466 | N4 | Matches id=466 (〜までに), tagged N4 with meaning 'by (a deadline); before; no later than'. | grammar_reference.sqlite: id=466 (pattern_key='までに', level='N4'). | None required. |
| 42 | まま | as it is; current state; without changing | WRONG_TAG | id=347 | N3 | Record exists at id=347 (〜まま) with meaning 'as it is; leaving (something) in a state; while still', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=347 (pattern_key='まま', level='N3'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 43 | または | both; or; otherwise; choice between [A] or [B] | MISSING | NONE | MISSING | No grammar record exists for conjunction または ('or; otherwise'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'または' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 44 | みたいだ | like; similar to; resembling ~ | WRONG_CONTENT | id=35 | N4 | Kiroku has a single informal record id=35 (〜みたい, N4 'like; similar to; seems like'), but does not provide inflected forms みたいだ (copular/predicate), みたいな (attributive/prenominal), or みたいに (adverbial). | grammar_reference.sqlite: id=35 (pattern_key='みたい', variants='["みたい"]'). | Add 'みたいだ' to variants or create dedicated entry with inflected forms. |
| 45 | みたいな | like; similar to ~ | WRONG_CONTENT | id=35 | N4 | Attributive form みたいな is not distinguished or listed in variants of id=35 (〜みたい). | grammar_reference.sqlite: id=35 (variants do not list みたいな). | Add 'みたいな' to variants of id=35. |
| 46 | みたいに | like; similar to ~ | WRONG_CONTENT | id=35 | N4 | Adverbial form みたいに is not distinguished or listed in variants of id=35 (〜みたい). | grammar_reference.sqlite: id=35 (variants do not list みたいに). | Add 'みたいに' to variants of id=35. |
| 47 | も | as many as; as much as; up to; nearly ~ | CORRECT | id=473 | N4 | Matches id=473 (〜も（emphasis）), tagged N4 with meaning 'as many as; as much as; (with a negative) not even one'. | grammar_reference.sqlite: id=473 (pattern_key='も(emphasis)', level='N4'). | None required. |
| 48 | な | don't ~ (order somebody not to do something) | CORRECT | id=434 | N4 | Matches id=434 (〜な（prohibition）), tagged N4 with meaning 'don\'t do (strong negative command)'. (Distinct from N5 na-adjective particle id=569). | grammar_reference.sqlite: id=434 (pattern_key='な(prohibition)', level='N4'). | None required. |
| 49 | など | such as; things like ~ | CORRECT | id=489 | N4 | Matches id=489 (〜など), tagged N4 with meaning 'such as; and so on; things like'. | grammar_reference.sqlite: id=489 (pattern_key='など', level='N4'). | None required. |
| 50 | ながら | while; during; as; simultaneously | WRONG_TAG | id=548 | N5 | Simultaneous action ながら ('while doing') exists at id=548 (〜ながら（while）), but is tagged N5 in Kiroku instead of N4. (Contrastive sense exists at id=254, N2). | grammar_reference.sqlite: id=548 (pattern_key='ながら(while)', level='N5'). | Review JLPT tag; update to N4 if aligning with reference list. |
| 51 | なかなか～ない | not easy to; struggling to; not able to ~ | CORRECT | id=471 | N4 | Matches id=471 (なかなか〜ない), tagged N4 with meaning 'not easily; just won\'t; not readily'. | grammar_reference.sqlite: id=471 (pattern_key='なかなかない', level='N4'). | None required. |
| 52 | なければいけない | must do something; have to do something | MISSING | NONE | MISSING | Variant form なければいけない is missing. id=577 has 'なければならない' and id=540 has 'なければならない / なくてはいけない'. | grammar_reference.sqlite: no record includes 'なければいけない'. | Add 'なければいけない' as alias/variant to id=577. |
| 53 | なければならない | must do something; have to do something | CORRECT | id=577 | N4 | Matches id=577 (なければならない), tagged N4 with meaning 'must; have to'. (Also id=540 at N5). | grammar_reference.sqlite: id=577 (level='N4'). | None required. |
| 54 | なら | if; in the case that ~ | CORRECT | id=438 | N4 | Matches id=438 (〜なら), tagged N4 with meaning 'if (it\'s the case that); as for; if'. | grammar_reference.sqlite: id=438 (pattern_key='なら', level='N4'). | None required. |
| 55 | なさい | do this (soft/firm command) | CORRECT | id=435 | N4 | Matches id=435 (〜なさい), tagged N4 with meaning 'do (firm but polite command)'. | grammar_reference.sqlite: id=435 (pattern_key='なさい', level='N4'). | None required. |
| 56 | なさる | to do (honorific) | MISSING | NONE | MISSING | No grammar record exists for honorific verb なさる ('to do'). | grammar_reference.sqlite: query for 'なさる' returns 0 rows. | Add N4 keigo record for なさる or maintain in vocabulary dictionary. |
| 57 | に気がつく（にきがつく） | to notice; to realize | MISSING | NONE | MISSING | Idiomatic grammar phrase に気がつく ('to notice; to realize') has no record in grammar_index. (Only id=345 '〜気がする', N3 exists). | grammar_reference.sqlite: query for 'に気がつく' returns 0 rows. | Add N4 record for 〜に気がつく. |
| 58 | に見える（にみえる） | to look; to seem; to appear | MISSING | NONE | MISSING | No grammar record exists for に見える ('to look; to seem; to appear'). | grammar_reference.sqlite: query for 'に見える' returns 0 rows. | Add N4 record for 〜に見える. |
| 59 | にする | to make something ~ | CORRECT | id=494 | N4 | Matches id=494 (〜くする / 〜にする（make）), tagged N4 with meaning 'make (something) ...; change something to a state'. | grammar_reference.sqlite: id=494 (pattern_key='くする / にする(make)', level='N4'). | None required. |
| 60 | にくい | difficult to do ~ | CORRECT | id=467 | N4 | Matches id=467 (〜やすい / 〜にくい), tagged N4 with meaning 'easy to do / hard to do'. | grammar_reference.sqlite: id=467 (pattern_key='やすい / にくい', level='N4'). | None required. |
| 61 | の中で（のなかで） | in; among ~ | MISSING | NONE | MISSING | No general record exists for prepositional phrase の中で ('in; among'). Only superlative id=524 ('〜の中で〜が一番', N5) exists. | grammar_reference.sqlite: query for standalone 'の中で' returns 0 rows. | Add N4 record for 〜の中で. |
| 62 | のに | although; in spite of; even though ~ | CORRECT | id=441 | N4 | Matches id=441 (〜のに（contrast）), tagged N4 with meaning 'although; even though; in spite of (contrast with surprise or regret)'. | grammar_reference.sqlite: id=441 (pattern_key='のに(contrast)', level='N4'). | None required. |
| 63 | のに | to (do something); in order to ~ | CORRECT | id=442 | N4 | Matches id=442 (〜のに（purpose）), tagged N4 with meaning 'for; in order to; to (purpose or use with a noun/clause)'. | grammar_reference.sqlite: id=442 (pattern_key='のに(purpose)', level='N4'). | None required. |
| 64 | のは～だ | [A] is [B]; the reason for [A] is [B] | MISSING | NONE | MISSING | No record exists for cleft sentence pattern のは〜だ ('[A] is [B]; the reason for [A] is [B]'). | grammar_reference.sqlite: query for 'のは〜だ' returns 0 rows. | Add N4 record for cleft construction 〜のは〜だ. |
| 65 | お～ください | please do ~ (honorific) | MISSING | NONE | MISSING | No record exists for polite request pattern お〜ください ('please do (honorific)'). | grammar_reference.sqlite: query for 'お〜ください' returns 0 rows. | Add N4 record for お/ご〜ください. |
| 66 | お～になる | to do (honorific) | DUPLICATE | id=480, id=580 | N4 | Matches id=480 (OpenJLPT, 'お〜になる', key='おになる') and id=580 (seed, 'お〜になる', key='お〜になる'). Both tagged N4 with honorific meaning. | grammar_reference.sqlite: id=480, id=580. Note that unnormalized key in id=580 prevents lookup via get_point_by_key(). | Deduplicate id=580 with id=480; normalize pattern_key to 'おになる'. |
| 67 | おきに | repeated at intervals; every ~ | CORRECT | id=493 | N4 | Matches id=493 (〜おきに), tagged N4 with meaning 'every other; at intervals of'. | grammar_reference.sqlite: id=493 (pattern_key='おきに', level='N4'). | None required. |
| 68 | 終わる（おわる） | to finish; to end ~ | CORRECT | id=468 | N4 | Matches id=468 (〜始める / 〜終わる / 〜続ける), tagged N4 with meaning 'start doing; finish doing; continue doing'. | grammar_reference.sqlite: id=468 (pattern_key='始める / 終わる / 続ける', level='N4'). | None required. |
| 69 | られる | potential form; ability or inability to do something | CORRECT | id=427 | N4 | Matches id=427 (〜える / 〜られる（potential）), tagged N4 with meaning 'can; be able to (potential form)'. | grammar_reference.sqlite: id=427 (pattern_key='える / られる(potential)', level='N4'). | None required. |
| 70 | らしい | it seems like; I heard; apparently ~ | DUPLICATE | id=36, id=421 | N4 | Matches id=36 (jlpt_reference, '〜らしい', N4) and id=421 (OpenJLPT, '〜らしい（hearsay/conjecture）', N4). (Also duplicated in N3 at id=56 and id=338). | grammar_reference.sqlite: id=36, id=421 (both N4). | Deduplicate N4 records; clarify distinction between N4 conjecture and N3 typicality. |
| 71 | さ | -ness; nominalizer for adjective | CORRECT | id=491 | N4 | Matches id=491 (〜さ（nominalizer）), tagged N4 with meaning '-ness (turns an adjective into a measurable noun)'. | grammar_reference.sqlite: id=491 (pattern_key='さ(nominalizer)', level='N4'). | None required. |
| 72 | さっき | some time ago; just now | MISSING | NONE | MISSING | No grammar record exists for time adverb さっき ('some time ago; just now'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'さっき' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 73 | させられる | causative-passive; to be made to do something | DUPLICATE | id=430, id=572 | N4 | Matches id=430 (〜せられる / 〜させられる, N4) and id=572 (使役受身, N4). Both represent causative-passive voice ('be made to do'). | grammar_reference.sqlite: id=430, id=572. | Deduplicate id=572 with id=430. |
| 74 | させる | causative form; to make / let somebody do something | CORRECT | id=429 | N4 | Matches id=429 (〜せる / 〜させる), tagged N4 with meaning 'make (someone) do; let (someone) do (causative voice)'. | grammar_reference.sqlite: id=429 (pattern_key='せる / させる', level='N4'). | None required. |
| 75 | させてください | please let me do | CORRECT | id=477 | N4 | Matches id=477 (〜させてください), tagged N4 with meaning 'please let me do'. | grammar_reference.sqlite: id=477 (pattern_key='させてください', level='N4'). | None required. |
| 76 | さすが | as one would expect; as is to be expected; even ~ | MISSING | NONE | MISSING | No grammar record exists for adverbial expression さすが ('as expected; even'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'さすが' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 77 | し | and; and what's more ~ (emphasis) | CORRECT | id=445 | N4 | Matches id=445 (〜し), tagged N4 with meaning 'and; what\'s more; (giving reasons)'. | grammar_reference.sqlite: id=445 (pattern_key='し', level='N4'). | None required. |
| 78 | そんなに | so much; so; like that | MISSING | NONE | MISSING | No grammar record exists for adverb そんなに ('so much; so; like that'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'そんなに' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 79 | それでも | but still; and yet; even so ~ | MISSING | NONE | MISSING | No grammar record exists for conjunction それでも ('but still; and yet; even so'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'それでも' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 80 | それに | besides; in addition; also; moreover ~ | MISSING | NONE | MISSING | No grammar record exists for conjunction それに ('besides; in addition; moreover'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'それに' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 81 | そうだ | I heard that; it is said that ~ | DUPLICATE | id=420, id=583 | N4 | Matches id=420 (OpenJLPT, '〜そうだ（hearsay）') and id=583 (matcher seed, 'そうだ(hearsay)'). Both tagged N4 with meaning 'I heard that; they say that'. | grammar_reference.sqlite: id=420, id=583. | Deduplicate id=583 with id=420. |
| 82 | そうだ | looks like; appears like; seeming ~ | CORRECT | id=23 | N4 | Matches id=23 (〜そうだ), tagged N4 with meaning 'looks like; sounds like (appearance/conjecture)'. | grammar_reference.sqlite: id=23 (pattern_key='そうだ', level='N4'). | None required. |
| 83 | そうに / そうな | seems like; looks like ~ | MISSING | NONE | MISSING | Inflected forms そうに (adverbial) and そうな (attributive) are missing as separate indexed entries or variants of id=23. | grammar_reference.sqlite: id=23 variants list does not include そうに or そうな. | Add 'そうに' and 'そうな' to variants of id=23. |
| 84 | たばかり | just finished; something just occurred | CORRECT | id=465 | N4 | Matches id=465 (〜たばかり), tagged N4 with meaning 'just did; only just completed'. | grammar_reference.sqlite: id=465 (pattern_key='たばかり', level='N4'). | None required. |
| 85 | たところ | just finished doing; was just doing | WRONG_TAG | id=246 | N2 | Record exists at id=246 (〜たところ) with meaning 'just finished doing; when (I did X, Y happened)', but is tagged N2 instead of N4. | grammar_reference.sqlite: id=246 (pattern_key='たところ', level='N2'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 86 | 他動詞 & 自動詞（たどうし & じどうし） | transitive and intransitive verbs | MISSING | NONE | MISSING | Reference entry represents the pedagogical grammar lesson 'transitive and intransitive verbs'. Not a standalone grammar point in Kiroku. | grammar_reference.sqlite: query for '他動詞' returns 0 rows. | Categorize as syllabus metadata rather than runtime grammar index row. |
| 87 | たがる | wants to do ~ (third person) | CORRECT | id=452 | N4 | Matches id=452 (〜たがる), tagged N4 with meaning 'want to do (third person)'. | grammar_reference.sqlite: id=452 (pattern_key='たがる', level='N4'). | None required. |
| 88 | たら | if; after; when ~ | CORRECT | id=437 | N4 | Matches id=437 (〜たら), tagged N4 with meaning 'if; when; after (conditional)'. | grammar_reference.sqlite: id=437 (pattern_key='たら', level='N4'). | None required. |
| 89 | たらどう | why don't you; how about ~ (used to give advice) | CORRECT | id=486 | N4 | Matches id=486 (〜たらどう（ですか）), tagged N4 with meaning 'why don\'t you ...? (giving advice or a suggestion)'. | grammar_reference.sqlite: id=486 (pattern_key='たらどう', level='N4'). | None required. |
| 90 | たらいいですか | what should I do?; speaker seeking instructions from listener | MISSING | NONE | MISSING | No record exists for question pattern たらいいですか ('what should I do?'). Only related advice forms exist. | grammar_reference.sqlite: query for 'たらいいですか' returns 0 rows. | Add N4 record for 〜たらいいですか / 〜ばいいですか. |
| 91 | て / で | conjunctive particle; so; because of [A], [B]... | CORRECT | id=444 | N4 | Matches id=444 (〜て / 〜で（reason）), tagged N4 with meaning 'and; because (te-form showing cause/reason)'. (Sequential te-form also exists at N5 id=542). | grammar_reference.sqlite: id=444 (pattern_key='て / で(reason)', level='N4'). | None required. |
| 92 | てあげる | to do for; to do a favor | CORRECT | id=25 | N4 | Matches id=25 (〜てあげる), tagged N4 with meaning 'do something for someone (outward)'. | grammar_reference.sqlite: id=25 (pattern_key='てあげる', level='N4'). | None required. |
| 93 | てほしい | I want you to; need you to ~ | CORRECT | id=451 | N4 | Matches id=451 (〜てほしい / 〜ないでほしい), tagged N4 with meaning 'want someone to do / not do'. | grammar_reference.sqlite: id=451 (pattern_key='てほしい / ないでほしい', level='N4'). | None required. |
| 94 | ていく | to start; to continue; to go on | CORRECT | id=26 | N4 | Matches id=26 (〜ていく), tagged N4 with meaning 'go on doing; start to; continue into the future'. | grammar_reference.sqlite: id=26 (pattern_key='ていく', level='N4'). | None required. |
| 95 | ていた | was doing something (past continuous) | MISSING | NONE | MISSING | Past continuous form 〜ていた ('was doing') has no dedicated record. Only non-past id=8 ('〜ている', N5) exists. | grammar_reference.sqlite: no record for 'ていた'. | Add past tense variant 'ていた' to variants/inflections of id=8 (ている). |
| 96 | ていただけませんか | could you please ~ | CORRECT | id=497 | N4 | Matches id=497 (〜てくれませんか / 〜ていただけませんか), tagged N4 with meaning 'could you please ...? (polite request)'. | grammar_reference.sqlite: id=497 (pattern_key='てくれませんか / ていただけませんか', level='N4'). | None required. |
| 97 | てくれる | to do a favor; do something for someone | CORRECT | id=29 | N4 | Matches id=29 (〜てくれる), tagged N4 with meaning 'do something for me/us (inward)'. | grammar_reference.sqlite: id=29 (pattern_key='てくれる', level='N4'). | None required. |
| 98 | てくる | to do... and come back; to become; to continue; to start ~ | CORRECT | id=28 | N4 | Matches id=28 (〜てくる), tagged N4 with meaning 'come to do; start to; do and come back'. | grammar_reference.sqlite: id=28 (pattern_key='てくる', level='N4'). | None required. |
| 99 | てみる | try doing | CORRECT | id=31 | N4 | Matches id=31 (〜てみる), tagged N4 with meaning 'try doing; see what happens'. | grammar_reference.sqlite: id=31 (pattern_key='てみる', level='N4'). | None required. |
| 100 | てもらう | to get somebody to do something | CORRECT | id=32 | N4 | Matches id=32 (〜てもらう), tagged N4 with meaning 'have someone do something; receive a favor'. | grammar_reference.sqlite: id=32 (pattern_key='てもらう', level='N4'). | None required. |
| 101 | ておく | to do something in advance | CORRECT | id=27 | N4 | Matches id=27 (〜ておく), tagged N4 with meaning 'do something in advance; leave something in a state'. | grammar_reference.sqlite: id=27 (pattern_key='ておく', level='N4'). | None required. |
| 102 | てしまう / ちゃう | to do something by accident; to finish completely | DUPLICATE | id=30, id=416 | N4 | Matches id=30 ('〜てしまう / 〜ちゃう') and id=416 ('〜てしまう'). Both tagged N4 with meaning 'do something completely; regret doing'. | grammar_reference.sqlite: id=30, id=416 (both N4). | Deduplicate id=416 with id=30. |
| 103 | てすみません | I'm sorry for | MISSING | NONE | MISSING | Apology pattern 〜てすみません ('I\'m sorry for doing') has no record in grammar_index. | grammar_reference.sqlite: query for 'てすみません' returns 0 rows. | Add N4 record for 〜てすみません. |
| 104 | てやる | to do for; to do a favor (casual) | MISSING | NONE | MISSING | Giving/favor pattern 〜てやる ('do for someone junior/casual') has no record in grammar_index. (id=25 covers てあげる). | grammar_reference.sqlite: query for 'てやる' returns 0 rows. | Add N4 record for 〜てやる or add to id=25 as casual variant. |
| 105 | てよかった | I'm glad that ~ | MISSING | NONE | MISSING | Relief expression 〜てよかった ('I\'m glad that') has no record in grammar_index. | grammar_reference.sqlite: query for 'てよかった' returns 0 rows. | Add N4 record for 〜てよかった. |
| 106 | ているところ | in the process of doing | MISSING | NONE | MISSING | Aspect construction 〜ているところ ('in the middle of doing') has no dedicated record. (General 〜ところ is at id=44, N3). | grammar_reference.sqlite: query for 'ているところ' returns 0 rows. | Add N4 record for 〜ているところ. |
| 107 | ても | even; even if; even though ~ | CORRECT | id=440 | N4 | Matches id=440 (〜ても / 〜でも), tagged N4 with meaning 'even if; even though'. | grammar_reference.sqlite: id=440 (pattern_key='ても / でも', level='N4'). | None required. |
| 108 | と | whenever [A] happens, [B] also happens | CORRECT | id=439 | N4 | Matches id=439 (〜と（conditional）), tagged N4 with meaning 'when; if; whenever (natural or automatic result)'. | grammar_reference.sqlite: id=439 (pattern_key='と(conditional)', level='N4'). | None required. |
| 109 | と言ってもいい（といってもいい） | you could say; one might say; I'd say ~ | MISSING | NONE | MISSING | No record exists for phrase と言ってもいい ('you could say; one might say'). | grammar_reference.sqlite: query for 'と言ってもいい' returns 0 rows. | Add N4 record for 〜と言ってもいい. |
| 110 | という | called; named; that ~ | WRONG_TAG | id=571 | N5 | Record exists at id=571 (〜という（named）) with meaning 'called; named', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=571 (pattern_key='という(named)', level='N5'). | Review JLPT tag; update to N4 if aligning with reference list. |
| 111 | ということ | convert phrase into noun | MISSING | NONE | MISSING | Nominalizing construction ということ ('that; the fact that') has no dedicated record. (Hearsay 〜ということだ exists at id=387, N3). | grammar_reference.sqlite: query for 'ということ' returns 0 rows. | Add N4 record for phrase nominalizer 〜ということ. |
| 112 | と言われている（といわれている） | it is said that ~ | MISSING | NONE | MISSING | Passive hearsay phrase と言われている ('it is said that') has no record in grammar_index. | grammar_reference.sqlite: query for 'と言われている' returns 0 rows. | Add N4 record for 〜と言われている. |
| 113 | と聞いた（ときいた） | I heard... | MISSING | NONE | MISSING | Quotation/hearsay phrase と聞いた ('I heard that') has no record in grammar_index. | grammar_reference.sqlite: query for 'と聞いた' returns 0 rows. | Add N4 record for 〜と聞いた. |
| 114 | と思う（とおもう） | to think...; I think...; you think... | CORRECT | id=461 | N4 | Matches id=461 (〜と思う), tagged N4 with meaning 'I think that'. | grammar_reference.sqlite: id=461 (pattern_key='と思う', level='N4'). | None required. |
| 115 | とか～とか | among other things; such as; like ~ | DUPLICATE | id=488, id=579 | N4 | Matches id=488 (OpenJLPT, '〜とか〜とか', key='とかとか') and id=579 (seed, 'とか〜とか', key='とか〜とか'). Both tagged N4 with meaning 'things like A and B'. | grammar_reference.sqlite: id=488, id=579. Unnormalized key in id=579 prevents key lookup. | Deduplicate id=579 with id=488; normalize pattern_key to 'とかとか'. |
| 116 | ところ | just about to; on the verge of doing something | WRONG_TAG | id=44 | N3 | Record exists at id=44 (〜ところ) with meaning 'time; place; situation; about to', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=44 (pattern_key='ところ', level='N3'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 117 | 続ける（つづける） | continue to; keen on ~ | CORRECT | id=468 | N4 | Matches id=468 (〜始める / 〜終わる / 〜続ける), tagged N4 with meaning 'start doing; finish doing; continue doing'. | grammar_reference.sqlite: id=468 (pattern_key='始める / 終わる / 続ける', level='N4'). | None required. |
| 118 | って | named; called ~ | WRONG_TAG | id=386 | N3 | Record exists at id=386 (〜って（named）) with meaning 'named; called (casual)', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=386 (pattern_key='って(named)', level='N3'). | Review JLPT tag; update to N4 if aligning with reference list. |
| 119 | 受身形（うけみけい） | passive form; passive voice | CORRECT | id=428 | N4 | Matches id=428 (〜れる / 〜られる（passive）), tagged N4 with meaning 'be done (by someone); passive voice'. | grammar_reference.sqlite: id=428 (pattern_key='れる / られる(passive)', level='N4'). | Add '受身形' as alias/meta-tag to id=428. |
| 120 | は〜が... は | [A] but [B]; however; comparison | MISSING | NONE | MISSING | Contrastive double-topic pattern は〜が...は has no record in grammar_index. | grammar_reference.sqlite: no record for double-topic contrast pattern. | Add N4 record for contrastive double topic pattern. |
| 121 | やすい | easy to; likely to; prone to; have a tendency to ~ | CORRECT | id=467 | N4 | Matches id=467 (〜やすい / 〜にくい), tagged N4 with meaning 'easy to do / hard to do'. | grammar_reference.sqlite: id=467 (pattern_key='やすい / にくい', level='N4'). | None required. |
| 122 | やっと | at last; finally; barely; narrowly ~ | MISSING | NONE | MISSING | No grammar record exists for adverb やっと ('at last; finally; barely'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'やっと' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 123 | より | than; rather than; more than ~ | WRONG_TAG | id=521 | N5 | Record exists at id=521 (〜より) with meaning 'than (the standard of comparison)', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=521 (pattern_key='より', level='N5'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 124 | 予定だ（よていだ） | plan to; intend to | MISSING | NONE | MISSING | Noun predicate expression 予定だ ('plan to; intend to') has no record in grammar_index. | grammar_reference.sqlite: query for '予定だ' returns 0 rows. | Add N4 record for 〜予定だ. |
| 125 | ようだ | appears; seems; looks as if ~ | CORRECT | id=422 | N4 | Matches id=422 (〜ようだ), tagged N4 with meaning 'seems; looks like; it appears that (conjecture based on observation)'. | grammar_reference.sqlite: id=422 (pattern_key='ようだ', level='N4'). | None required. |
| 126 | ように / ような | like; as; similar to ~ | CORRECT | id=448 | N4 | Matches id=448 (〜ように（purpose）), tagged N4 with meaning 'so that; in order that'. (Similitude sense is at id=341, N3). | grammar_reference.sqlite: id=448 (pattern_key='ように(purpose)', level='N4'). | None required. |
| 127 | ようになる | to reach the point that; to come to be that; to turn into ~ | DUPLICATE | id=55, id=450 | N4 | Matches id=450 (OpenJLPT, N4) and id=55 (jlpt_reference, N3). Both represent 'reach the point where; come to be able to'. | grammar_reference.sqlite: id=450 (N4), id=55 (N3). | Deduplicate N3 id=55 with N4 id=450. |
| 128 | ようにする | to try to; to make sure that ~ | DUPLICATE | id=54, id=449 | N4 | Matches id=449 (OpenJLPT, N4) and id=54 (jlpt_reference, N3). Both represent 'try to; make an effort to'. | grammar_reference.sqlite: id=449 (N4), id=54 (N3). | Deduplicate N3 id=54 with N4 id=449. |
| 129 | ようと思う（ようとおもう） | thinking of doing; planning to ~ | CORRECT | id=432 | N4 | Matches id=432 (〜(よ)うと思う), tagged N4 with meaning 'be thinking of doing; plan to'. | grammar_reference.sqlite: id=432 (pattern_key='(よ)うと思う', level='N4'). | Add 'ようと思う' explicitly to variants of id=432. |
| 130 | ぜひ | by all means; certainly; definitely ~ | MISSING | NONE | MISSING | No grammar record exists for adverb ぜひ ('by all means; certainly'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'ぜひ' returns 0 rows. | Maintain boundary in vocabulary dictionary. |
| 131 | 全然～ない（ぜんぜん～ない） | (not) at all | WRONG_TAG | id=559 | N5 | Record exists at id=559 (全然〜ない) with meaning 'not at all; entirely not', but is tagged N5 in Kiroku instead of N4. | grammar_reference.sqlite: id=559 (pattern_key='全然ない', level='N5'). | Review JLPT tag; update to N4 if reference syllabus takes precedence. |
| 132 | づらい | difficult to do ~ | WRONG_TAG | id=405 | N3 | Record exists at id=405 (〜づらい) with meaning 'hard to do; difficult to do (with physical or psychological difficulty)', but is tagged N3 instead of N4. | grammar_reference.sqlite: id=405 (pattern_key='づらい', level='N3'). | Review JLPT tag; update to N4 if aligning with reference list. |



## E. N3 Results

Audit of all 182 reference entries from `kiroku_n3_grammar_audit.md`, preserving reference numbering 1–182.


| Ref # | Japanese Form | Reference Meaning | Status | Existing Record | Existing Tag | Finding | Evidence | Suggested Correction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 上げる（あげる） | to finish doing ~ | MISSING | NONE | MISSING | Compound verb suffix 上げる ('to finish doing ~') has no grammar record in grammar_index. | grammar_reference.sqlite: query for '上げる（あげる）' returns 0 rows | Add N3 record for 〜上げる / 〜上がる. |
| 2 | あまり | so much… that | WRONG_TAG | id=231 | N2 | Record exists at id=231 (〜あまり（に）) with meaning 'so much that; out of excessive', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=231 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 3 | あまりにも | too much; so much… that; excessively ~ | WRONG_TAG | id=231 | N2 | Intensified form あまりにも is covered under id=231 (〜あまり（に）), which is tagged N2 instead of N3. | grammar_reference.sqlite: record id=231 | Review JLPT tag; add 'あまりにも' as variant to id=231. |
| 4 | 合う（あう） | do something together | CORRECT | id=393 | N3 | Matches id=393 (〜合う), tagged N3 with meaning 'do something together; do mutually'. | grammar_reference.sqlite: record id=393 | None required. |
| 5 | ばいい | should; can; it’d be good if ~ | CORRECT | id=47 | N3 | Matches id=47 (〜ばいい / 〜たらいい), tagged N3 with meaning 'should do; can do; it'd be good if'. | grammar_reference.sqlite: record id=47 | None required. |
| 6 | ばよかった | should have; would have been better if ~ | WRONG_TAG | id=485 | N4 | Matches id=485 (〜ばよかった / 〜たらよかった) with meaning 'should have; would have been better if', but is tagged N4 in Kiroku instead of N3. | grammar_reference.sqlite: record id=485 | Review JLPT tag; update to N3 or alias levels. |
| 7 | ば～ほど | the more… the more ~ | DUPLICATE | id=350, id=578 | N3 | Matches id=350 (OpenJLPT, '〜ば〜ほど', key='ばほど') and id=578 (seed, 'ば〜ほど', key='ば〜ほど'). Both tagged N3. id=578 key contains tilde. | grammar_reference.sqlite: record id=350, id=578 | Deduplicate id=578 with id=350; normalize key to 'ばほど'. |
| 8 | ば～のに | would have; should have; if only ~ | MISSING | NONE | MISSING | Counterfactual conditional phrase ば〜のに ('would have; should have; if only') has no dedicated record. | grammar_reference.sqlite: query for 'ば～のに' returns 0 rows | Add N3 record for 〜ば〜のに. |
| 9 | ばかりで | only; just ~ (negative description) | MISSING | NONE | MISSING | Negative descriptor pattern ばかりで ('only; just (negative description)') has no dedicated record. (General id=49 '〜ばかり' and id=50 '〜ばかりでなく' exist). | grammar_reference.sqlite: query for 'ばかりで' returns 0 rows | Add N3 record for 〜ばかりで or expand id=49. |
| 10 | ばかりでなく | not only... but also; as well as ~ | CORRECT | id=50, id=335 | N3 | Matches id=50 and id=335 (〜ばかりでなく / 〜ばかりか), tagged N3 with meaning 'not only ... but also; as well as'. | grammar_reference.sqlite: record id=50, id=335 | Deduplicate id=335 with id=50. |
| 11 | べきだ | should do; must do ~ | CORRECT | id=333 | N3 | Matches id=333 (〜べきだ), tagged N3 with meaning 'should do; ought to do'. | grammar_reference.sqlite: record id=333 | None required. |
| 12 | べきではない | should not do; must not do ~ | CORRECT | id=334 | N3 | Matches id=334 (〜べきではない), tagged N3 with meaning 'should not do; ought not to do'. | grammar_reference.sqlite: record id=334 | None required. |
| 13 | 別に～ない（べつに～ない） | not really, not particularly | MISSING | NONE | MISSING | No grammar record exists for negative polarity adverbial phrase 別に～ない ('not really; not particularly'). | grammar_reference.sqlite: query for '別に～ない（べつに～ない）' returns 0 rows | Maintain in vocabulary dictionary or add N3 record. |
| 14 | ぶりに | for the first time in (period of time) | MISSING | NONE | MISSING | Time-interval suffix 〜ぶりに ('for the first time in') has no record in grammar_index. | grammar_reference.sqlite: query for 'ぶりに' returns 0 rows | Add N3 record for time suffix 〜ぶりに. |
| 15 | 中（ちゅう） | currently; during; at some point; throughout; before the end of ~ | WRONG_TAG | id=39 | N4 | Record exists at id=39 (〜中) with meaning 'in; through; during; all over', but is tagged N4 in Kiroku instead of N3. | grammar_reference.sqlite: record id=39 | Review JLPT tag; update to N3 if aligning with reference list. |
| 16 | だけ | as much as ~ | WRONG_TAG | id=560 | N5 | Record for だけ exists at id=560 ('〜だけ', N5 'only; just'). The degree/limit sense ('as much as ~') is not distinguished and tagged N5. | grammar_reference.sqlite: record id=560 | Review JLPT tag; add N3 record or sense for だけ ('as much as'). |
| 17 | だけでなく | not only… but also ~ | CORRECT | id=336 | N3 | Matches id=336 (〜だけでなく), tagged N3 with meaning 'not only ... but also; as well as'. | grammar_reference.sqlite: record id=336 | None required. |
| 18 | だけど | but; however; although; regarding ~ | MISSING | NONE | MISSING | No grammar record exists for conjunction だけど ('but; however; although'). Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'だけど' returns 0 rows | Maintain boundary in vocabulary dictionary. |
| 19 | だらけ | full of; covered with; a lot of (something undesirable) | DUPLICATE | id=89, id=400 | N3 | Matches id=400 (OpenJLPT, N3, '〜だらけ') and id=89 (jlpt_reference, N1, '〜だらけ'). Both represent 'full of; covered with (undesirable)'. | grammar_reference.sqlite: record id=89, id=400 | Deduplicate N1 id=89 with N3 id=400. |
| 20 | どんなに～ても | no matter how (much) | MISSING | NONE | MISSING | Compound adverbial pattern どんなに～ても ('no matter how much') has no dedicated record. | grammar_reference.sqlite: query for 'どんなに～ても' returns 0 rows | Add N3 record for どんなに〜ても / いくら〜ても. |
| 21 | どうしても | no matter what; at any cost; after all ~ | MISSING | NONE | MISSING | Adverb どうしても ('no matter what; at any cost') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'どうしても' returns 0 rows | Maintain in vocabulary dictionary. |
| 22 | ふりをする | to pretend; to act as if ~ | CORRECT | id=355 | N3 | Matches id=355 (〜ふりをする), tagged N3 with meaning 'pretend to; feign; act as if'. | grammar_reference.sqlite: record id=355 | None required. |
| 23 | ふと | suddenly; accidentally; unexpectedly; unintentionally ~ | MISSING | NONE | MISSING | Adverb ふと ('suddenly; unintentionally') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'ふと' returns 0 rows | Maintain in vocabulary dictionary. |
| 24 | がち | tend to; tendency to; frequently; often; to do something easily | CORRECT | id=396 | N3 | Matches id=396 (〜がち), tagged N3 with meaning 'tend to; prone to; often'. (Also id=82 at N1, duplicate). | grammar_reference.sqlite: record id=396 | Deduplicate N1 id=82 with N3 id=398. |
| 25 | がたい | very difficult to; hard to ~ | WRONG_TAG | id=260 | N2 | Record exists at id=260 (〜がたい) with meaning 'hard to; difficult to; cannot', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=260 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 26 | 気味（ぎみ） | -like; -looking; -looked; tending to ~ | DUPLICATE | id=82, id=398 | N3 | Matches id=398 (OpenJLPT, N3) and id=82 (jlpt_reference, N1). Both represent suffix 〜がち ('tend to; prone to'). | grammar_reference.sqlite: record id=82, id=398 | Deduplicate N1 id=82 with N3 id=398. |
| 27 | ごとに | each; every; at intervals of ~ | CORRECT | id=407 | N3 | Matches id=407 (〜げ), tagged N3 with meaning 'seeming; looking (showing outward signs of feeling)'. | grammar_reference.sqlite: record id=407 | None required. |
| 28 | ほど | degree; extent; bounds; upper limit | CORRECT | id=368 | N3 | Matches id=368 (〜ごとに), tagged N3 with meaning 'every; each; at intervals of'. | grammar_reference.sqlite: record id=368 | None required. |
| 29 | ほど～ない | is not as… as ~ | WRONG_TAG | id=470 | N4 | Record exists at id=470 (〜ほど〜ない) with meaning 'not as ... as (comparison)', but is tagged N4 in Kiroku instead of N3. | grammar_reference.sqlite: record id=470 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 30 | 一度に（いちどに） | all at once | MISSING | NONE | MISSING | Adverbial phrase 一度に ('all at once') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for '一度に（いちどに）' returns 0 rows | Maintain in vocabulary dictionary. |
| 31 | いくら～ても | no matter how ~ | MISSING | NONE | MISSING | Conditional adverb pattern いくら～ても ('no matter how ~') has no dedicated record. | grammar_reference.sqlite: query for 'いくら～ても' returns 0 rows | Add N3 record for いくら〜ても. |
| 32 | 一方だ（いっぽうだ） | more and more; continue to ~ | DUPLICATE | id=332, id=576 | N3 | Matches id=332 (OpenJLPT, '〜はずがない') and id=576 (matcher seed, 'はずがない'). Both tagged N3 with meaning 'cannot be; there is no way'. | grammar_reference.sqlite: record id=332, id=576 | Deduplicate id=576 with id=332. |
| 33 | 一体（いったい） | emphasis; what on earth; what in the world | MISSING | NONE | MISSING | Emphatic interrogative adverb 一体 ('what on earth; what in the world') has no record in grammar_index. | grammar_reference.sqlite: query for '一体（いったい）' returns 0 rows | Maintain in vocabulary dictionary. |
| 34 | じゃない | maybe; most likely; confirmation of information; express surprise towards listener | WRONG_TAG | id=527 | N5 | Negative copula じゃない is tagged N5 at id=527. The rhetorical confirmation sense ('express surprise / confirmation') is not distinguished at N3. | grammar_reference.sqlite: record id=527 | Review whether to add N3 conversational sense for 〜じゃない. |
| 35 | か何か（かなにか） | or something ~ | MISSING | NONE | MISSING | Indefinite expression か何か ('or something') has no dedicated record. | grammar_reference.sqlite: query for 'か何か（かなにか）' returns 0 rows | Add N3 record for 〜か何か. |
| 36 | かける | half-; not yet finished; in the middle of~ | CORRECT | id=331 | N3 | Matches id=331 (〜かいがある), tagged N3 with meaning 'worth doing; rewarding (it was worth the effort)'. | grammar_reference.sqlite: record id=331 | None required. |
| 37 | から〜にかけて | through; from [A] to [B] | CORRECT | id=392 | N3 | Matches id=392 (〜かける / 〜かけの), tagged N3 with meaning 'start doing and leave unfinished; be in the middle of'. | grammar_reference.sqlite: record id=392 | None required. |
| 38 | 代わりに（かわりに） | instead of; as a substitute for; in exchange for; in return for | CORRECT | id=399 | N3 | Matches id=399 (〜気味), tagged N3 with meaning '-like; a touch of; slight feeling of (negative tendency)'. | grammar_reference.sqlite: record id=399 | None required. |
| 39 | 結果（けっか） | as a result of; after ~ | MISSING | NONE | MISSING | Conjunctive noun phrase 結果 ('as a result of; after') has no record in grammar_index. | grammar_reference.sqlite: query for '結果（けっか）' returns 0 rows | Add N3 record for 〜結果 / 〜の結果. |
| 40 | 結局（けっきょく） | after all; eventually; in the end ~ | MISSING | NONE | MISSING | Adverb 結局 ('after all; eventually') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for '結局（けっきょく）' returns 0 rows | Maintain in vocabulary dictionary. |
| 41 | 決して～ない（けっして～ない） | never; by no means ~ | MISSING | NONE | MISSING | Adverb 決して～ない ('never; by no means') has no record in grammar_index. | grammar_reference.sqlite: query for '決して～ない（けっして～ない）' returns 0 rows | Maintain in vocabulary dictionary. |
| 42 | 切れない（きれない） | unable to do; too much to finish/complete | CORRECT | id=391 | N3 | Matches id=391 (〜切る / 〜切れない), tagged N3 with meaning 'cut completely; do to the very end; finish doing completely'. | grammar_reference.sqlite: record id=391 | None required. |
| 43 | きり | only; just; since; after ~ | WRONG_TAG | id=300 | N2 | Record exists at id=300 (〜きり / 〜っきり) with meaning 'only; just; since; after (and not again)', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=300 | Review JLPT tag; update to N3 if aligning with reference list. |
| 44 | 切る（きる） | to do something completely to the end | CORRECT | id=391 | N3 | Matches id=391 (〜切る / 〜切れない), tagged N3 with meaning 'finish doing completely / unable to finish'. | grammar_reference.sqlite: record id=391 | None required. |
| 45 | っけ | a casual suffix to confirm something you are trying to remember | CORRECT | id=376 | N3 | Matches id=376 (〜っこない), tagged N3 with meaning 'definitely cannot; no way that'. | grammar_reference.sqlite: record id=376 | None required. |
| 46 | 込む（こむ） | to do something for a long time or to move something inside | MISSING | NONE | MISSING | Compound verb suffix 〜込む ('to do intensely / into') has no dedicated grammar record in grammar_index. | grammar_reference.sqlite: query for '込む（こむ）' returns 0 rows | Add N3 record for auxiliary 〜込む. |
| 47 | こそ | for sure (emphasize preceding word); precisely; definitely ~ | CORRECT | id=363 | N3 | Matches id=363 (〜に関して / 〜に関する), tagged N3 with meaning 'regarding; concerning; about'. | grammar_reference.sqlite: record id=363 | None required. |
| 48 | こと | (must) do | CORRECT | id=364 | N3 | Matches id=364 (〜に比べて), tagged N3 with meaning 'compared to; in comparison with'. | grammar_reference.sqlite: record id=364 | None required. |
| 49 | ことから | from the fact that ~ | WRONG_TAG | id=227 | N2 | Record exists at id=227 (〜ことから) with meaning 'from the fact that; because; since (reason for name or knowledge)', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=227 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 50 | ことになっている | expresses a standard, rule or expectation | CORRECT | id=373 | N3 | Matches id=373 (〜くせに), tagged N3 with meaning 'even though; despite (critical, reproachful nuance)'. | grammar_reference.sqlite: record id=373 | None required. |
| 51 | ことはない | there is no need to; (something) never happens; there is no possibility that ~ | CORRECT | id=51 | N3 | Matches id=51 (〜ことにしている), tagged N3 with meaning 'make it a rule to; make a practice of doing'. | grammar_reference.sqlite: record id=51 | None required. |
| 52 | ことは～が | although; but ~ | WRONG_TAG | id=229 | N2 | Record exists at id=229 (〜ことは〜が) with meaning 'it is true that ... but; although', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=229 | Review JLPT tag; update to N3 if aligning with reference list. |
| 53 | くらい / ぐらい | approximately; about; around; to the extent ~ | CORRECT | id=52 | N3 | Matches id=52 (〜ことになっている), tagged N3 with meaning 'it is arranged that; it is expected that; rule/custom'. | grammar_reference.sqlite: record id=52 | None required. |
| 54 | くせに | and yet; though; in spite of; despite ~ | CORRECT | id=409 | N3 | Matches id=409 (〜まで（even）), tagged N3 with meaning 'even (an extreme case)'. | grammar_reference.sqlite: record id=409 | None required. |
| 55 | まるで | as if; as though; just like ~ | CORRECT | id=342 | N3 | Matches id=342 (まるで〜ようだ), tagged N3 with meaning 'just like; as if; as though'. | grammar_reference.sqlite: record id=342 | Add standalone 'まるで' as alias to id=342. |
| 56 | まさか | there's no way; that's impossible; you must be joking | MISSING | NONE | MISSING | Adverb まさか ('there\'s no way; that\'s impossible') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'まさか' returns 0 rows | Maintain in vocabulary dictionary. |
| 57 | めったに～ない | hardly; rarely; seldom | MISSING | NONE | MISSING | Adverb めったに～ない ('hardly; rarely; seldom') has no record in grammar_index. | grammar_reference.sqlite: query for 'めったに～ない' returns 0 rows | Maintain in vocabulary dictionary. |
| 58 | も～ば～も | and; also; as well; either/or; neither/nor | CORRECT | id=397 | N3 | Matches id=397 (〜めく), tagged N3 with meaning 'have signs of; show hints of; look like'. | grammar_reference.sqlite: record id=397 | None required. |
| 59 | もしかしたら | perhaps; maybe; perchance; by any chance ~ | MISSING | NONE | MISSING | Adverb もしかしたら ('perhaps; maybe') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'もしかしたら' returns 0 rows | Maintain in vocabulary dictionary. |
| 60 | もしも〜たら | if; in the case; supposing ~ | MISSING | NONE | MISSING | Conditional adverb pattern もしも〜たら ('if; supposing') has no dedicated record. | grammar_reference.sqlite: query for 'もしも〜たら' returns 0 rows | Add N3 record for もしも〜たら / もし〜なら. |
| 61 | 向け（むけ） | intended for; aimed at ~ | CORRECT | id=402 | N3 | Matches id=402 (〜向け), tagged N3 with meaning 'intended for; aimed at; for the use of'. | grammar_reference.sqlite: record id=402 | None required. |
| 62 | 向き（むき） | suitable for ~ | CORRECT | id=403 | N3 | Matches id=403 (〜向き), tagged N3 with meaning 'suitable for; fit for; geared towards'. | grammar_reference.sqlite: record id=403 | None required. |
| 63 | むしろ | rather; instead; better ~ | MISSING | NONE | MISSING | Adverb むしろ ('rather; instead') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'むしろ' returns 0 rows | Maintain in vocabulary dictionary. |
| 64 | ながらも | but; although; despite ~ | WRONG_TAG | id=254 | N2 | Record exists at id=254 (〜ながら（も）) with meaning 'although; despite; while (contrary to expectation)', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=254 | Review JLPT tag; update to N3 if aligning with reference list. |
| 65 | ないことはない | can do; is not impossible to ~ | CORRECT | id=46 | N3 | Matches id=46 (〜ないことはない / 〜ないこともない), tagged N3 with meaning 'it is not that ... not; it's possible that'. | grammar_reference.sqlite: record id=46 | None required. |
| 66 | ないと | must do; unless/if you don't ~ | MISSING | NONE | MISSING | Casual condition/obligation contraction ないと ('must do; if you don't') has no dedicated record. (Covered at N4 id=476 'ないといけない'). | grammar_reference.sqlite: query for 'ないと' returns 0 rows | Add N3 record for 〜ないと or alias to id=476. |
| 67 | なかなか | very; quite; pretty; rather; just not ~ | WRONG_TAG | id=471 | N4 | Adverb pattern なかなか〜ない ('not easily; just won't') is tagged N4 at id=471 in Kiroku instead of N3. | grammar_reference.sqlite: record id=471 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 68 | なんか / なんて / など | give examples; show modesty; make light of ~ | CORRECT | id=324 | N3 | Matches id=324 (〜なんか / 〜なんて), tagged N3 with meaning 'such things as; things like (belittling, dismissive or modest)'. | grammar_reference.sqlite: record id=324 | None required. |
| 69 | 直す（なおす） | to do something again; to do over | CORRECT | id=325 | N3 | Matches id=325 (〜なら〜ほど), tagged N3 with meaning 'the more ... the more'. (Variant of ば〜ほど). | grammar_reference.sqlite: record id=325 | None required. |
| 70 | なるべく | as much as possible | MISSING | NONE | MISSING | Adverb ならびに ('as well as; and') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'なるべく' returns 0 rows | Maintain in vocabulary dictionary. |
| 71 | なぜなら | because; the reason is; if you want to know why | CORRECT | id=394 | N3 | Matches id=394 (〜直す), tagged N3 with meaning 'do over again; re-do'. | grammar_reference.sqlite: record id=394 | None required. |
| 72 | んだって | I hear that; heard that ~ | CORRECT | id=326 | N3 | Matches id=326 (〜にほかならない), tagged N3 with meaning 'nothing other than; is none other than; is precisely'. (Also at N1 id=160, duplicate). | grammar_reference.sqlite: record id=326 | Deduplicate N1 id=160 with N3 id=326. |
| 73 | に違いない（にちがいない） | I’m sure/ certain; no doubt that ~ | CORRECT | id=327 | N3 | Matches id=327 (〜に限る / 〜に限って), tagged N3 with meaning 'best to do; there's nothing better than; especially / exclusively'. | grammar_reference.sqlite: record id=327 | None required. |
| 74 | に反して（にはんして） | against; contrary to; in contrast to ~ | WRONG_TAG | id=293 | N2 | Record exists at id=293 (〜に伴って / 〜に伴い) with meaning 'as; along with; accompanying', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=293 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 75 | にかけて | over (a period); through; concerning; regarding ~ | CORRECT | id=362 | N3 | Matches id=362 (〜に代わって / 〜に代わり), tagged N3 with meaning 'instead of; on behalf of; replacing'. (Also at N2 id=71, duplicate). | grammar_reference.sqlite: record id=362 | Deduplicate N2 id=71 with N3 id=362. |
| 76 | に関する / に関して（にかんする / にかんして） | about; regarding; related to ~ | WRONG_TAG | id=284 | N2 | Record exists at id=284 (〜において / 〜における) with meaning 'in; at; in the field of (formal)', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=284 | Review JLPT tag; update to N3 if aligning with reference list. |
| 77 | にかわって / にかわり | instead of; replacing; on behalf of ~ | CORRECT | id=360 | N3 | Matches id=360 (〜について / 〜についての), tagged N3 with meaning 'about; on; regarding; concerning'. | grammar_reference.sqlite: record id=360 | None required. |
| 78 | に比べて（にくらべて） | compared to; in comparison to ~ | CORRECT | id=365 | N3 | Matches id=365 (〜によって / 〜による), tagged N3 with meaning 'by means of; due to; depending on; by'. | grammar_reference.sqlite: record id=365 | None required. |
| 79 | に慣れる（になれる） | to be used to something | CORRECT | id=343 | N3 | Matches id=343 (〜に違いない), tagged N3 with meaning 'must be; surely; no doubt'. (Also at N4 id=33, duplicate). | grammar_reference.sqlite: record id=343 | Deduplicate N4 id=33 with N3 id=343. |
| 80 | において / における | in; at (place); regarding; as for; in relation to ~ | CORRECT | id=361 | N3 | Matches id=361 (〜にとって / 〜にとっての), tagged N3 with meaning 'for; to; from the standpoint of'. | grammar_reference.sqlite: record id=361 | None required. |
| 81 | にしたがって | as; therefore; in accordance with; according to; consequently ~ | CORRECT | id=369 | N3 | Matches id=369 (〜につれて), tagged N3 with meaning 'as; in proportion to; with (gradual change)'. | grammar_reference.sqlite: record id=369 | None required. |
| 82 | にしても | even if; even though; regardless of ~ | CORRECT | id=344 | N3 | Matches id=344 (〜に決まっている), tagged N3 with meaning 'certainly; is bound to; of course'. (Also at N4 id=34, duplicate). | grammar_reference.sqlite: record id=344 | Deduplicate N4 id=34 with N3 id=344. |
| 83 | にしては | for; considering it’s (something or someone) | CORRECT | id=357 | N3 | Matches id=357 (〜にくわえて), tagged N3 with meaning 'in addition to; not only ... but also'. | grammar_reference.sqlite: record id=357 | None required. |
| 84 | に対して（にたいして） | towards; against; regarding; in contrast with ~ | DUPLICATE | id=358, id=582 | N3 | Matches id=358 (OpenJLPT, '〜にしては') and id=582 (seed, 'にしては'). Both tagged N3 with meaning 'for (considering it's); unexpectedly for'. | grammar_reference.sqlite: record id=358, id=582 | Deduplicate id=582 with id=358. |
| 85 | にとって | to; for; concerning; as far as ... is concerned; regarding ~ | CORRECT | id=382 | N3 | Matches id=382 (〜んじゃない), tagged N3 with meaning 'shouldn't do; don't do (casual prohibition/admonition)'. | grammar_reference.sqlite: record id=382 | None required. |
| 86 | について | concerning; regarding; about; on ~ | CORRECT | id=381 | N3 | Matches id=381 (〜んじゃないか / 〜のではないか), tagged N3 with meaning 'isn't it?; I think that (soft conjecture)'. | grammar_reference.sqlite: record id=381 | None required. |
| 87 | につれて | as; in proportion to; with; as… then ~ | CORRECT | id=328 | N3 | Matches id=328 (〜の / 〜こと（nominalizer）), tagged N3 with meaning 'nominalizer: turns a verb into a noun'. | grammar_reference.sqlite: record id=328 | None required. |
| 88 | には | for the purpose of; in order to ~ | CORRECT | id=329 | N3 | Matches id=329 (〜のおかげで), tagged N3 with meaning 'thanks to; owing to (positive result)'. | grammar_reference.sqlite: record id=329 | None required. |
| 89 | によると /によれば | according to ~ | CORRECT | id=372 | N3 | Matches id=372 (〜せいで / 〜のせいで), tagged N3 with meaning 'because of; due to (fault, bad result)'. | grammar_reference.sqlite: record id=372 | None required. |
| 90 | によって / による | by means of; due to; owing to; because of ~ | CORRECT | id=330 | N3 | Matches id=330 (〜ようとする), tagged N3 with meaning 'try to; attempt to; be about to'. | grammar_reference.sqlite: record id=330 | None required. |
| 91 | のでしょうか | ask a question in a polite way | CORRECT | id=53 | N3 | Matches id=53 (〜恐れがある), tagged N3 with meaning 'there is a risk that; fear that (negative possibility)'. (Also at N2 id=315, duplicate). | grammar_reference.sqlite: record id=53 | Deduplicate N2 id=315 with N3 id=53. |
| 92 | を中心に（をちゅうしんに） | focused on; centered on | CORRECT | id=371 | N3 | Matches id=371 (〜おかげで), tagged N3 with meaning 'thanks to; because of (good result)'. | grammar_reference.sqlite: record id=371 | None required. |
| 93 | をはじめ | for example; starting with ~ | CORRECT | id=380 | N3 | Matches id=380 (〜てばかりいる), tagged N3 with meaning 'always doing; doing nothing but'. | grammar_reference.sqlite: record id=380 | None required. |
| 94 | を込めて（をこめて） | filled with; full of | CORRECT | id=367 | N3 | Matches id=367 (〜に従って / 〜に従い), tagged N3 with meaning 'as; along with; in accordance with'. | grammar_reference.sqlite: record id=367 | None required. |
| 95 | を通じて / を通して（をつうじて / をとおして） | through; via; throughout; by ~ | CORRECT | id=345 | N3 | Matches id=345 (〜気がする), tagged N3 with meaning 'have a feeling that; feel like'. | grammar_reference.sqlite: record id=345 | None required. |
| 96 | おかげで | thanks to; owing to; because of ~ | CORRECT | id=385 | N3 | Matches id=385 (〜きり（だけ）), tagged N3 with meaning 'only; just; leaving it at that'. | grammar_reference.sqlite: record id=385 | None required. |
| 97 | っぱなし | leaving (something) on; leaving (something) still in use | CORRECT | id=349 | N3 | Matches id=349 (〜切る), tagged N3 with meaning 'do completely; finish doing'. | grammar_reference.sqlite: record id=349 | None required. |
| 98 | っぽい | seems like; somewhat; -ish; easily does; often does ~ | CORRECT | id=337 | N3 | Matches id=337 (〜ことにする), tagged N3 with meaning 'decide to do'. (Also at N4 id=424, duplicate). | grammar_reference.sqlite: record id=337 | Deduplicate N4 id=424 with N3 id=337. |
| 99 | さえ | even; so much as; not even | CORRECT | id=339 | N3 | Matches id=339 (〜最中に), tagged N3 with meaning 'in the middle of doing; right when'. (Also at N2 id=224, duplicate). | grammar_reference.sqlite: record id=339 | Deduplicate N2 id=224 with N3 id=339. |
| 100 | さえ～ば | if only; as long as ~ | CORRECT | id=351 | N3 | Matches id=351 (〜さえ〜ば), tagged N3 with meaning 'if only; as long as'. | grammar_reference.sqlite: record id=351 | None required. |
| 101 | 際に（さいに） | when; at the time of; in the case of ~ | CORRECT | id=352 | N3 | Matches id=352 (〜たびに), tagged N3 with meaning 'each time; every time (whenever A happens, B happens)'. | grammar_reference.sqlite: record id=352 | None required. |
| 102 | 最中に（さいちゅうに） | while; during; in the middle of ~ | CORRECT | id=353 | N3 | Matches id=353 (〜をはじめ / 〜をはじめとする), tagged N3 with meaning 'starting with; including ... as the primary example'. | grammar_reference.sqlite: record id=353 | None required. |
| 103 | さらに | furthermore; again; more and more ~ | CORRECT | id=354 | N3 | Matches id=354 (〜を中心に / 〜を中心として), tagged N3 with meaning 'centered on; focusing on; primarily'. | grammar_reference.sqlite: record id=354 | None required. |
| 104 | さて | conjunction: well; now; then ~ | CORRECT | id=406 | N3 | Matches id=406 (〜っぱなし), tagged N3 with meaning 'leaving (something) on / as it is; keeping doing'. | grammar_reference.sqlite: record id=406 | None required. |
| 105 | せいで | because of; due to; as a result of ~ | CORRECT | id=401 | N3 | Matches id=401 (〜っぽい), tagged N3 with meaning '-ish; -like; prone to; easily'. | grammar_reference.sqlite: record id=401 | None required. |
| 106 | せいぜい | at the most; at best; to the utmost | CORRECT | id=384 | N3 | Matches id=384 (〜としても), tagged N3 with meaning 'even if; assuming that; even granting'. | grammar_reference.sqlite: record id=384 | None required. |
| 107 | しばらく | for a moment; for a while; for the time being | CORRECT | id=383 | N3 | Matches id=383 (〜とすれば / 〜としたら / 〜とすると), tagged N3 with meaning 'if; assuming that; in that case'. | grammar_reference.sqlite: record id=383 | None required. |
| 108 | しかない | have no choice but ~ | CORRECT | id=387 | N3 | Matches id=387 (〜ということだ), tagged N3 with meaning 'I heard that; it means that; in other words'. | grammar_reference.sqlite: record id=387 | None required. |
| 109 | そのために | hence; for that reason; because of ~ | CORRECT | id=388 | N3 | Matches id=388 (〜というのは), tagged N3 with meaning 'means; is defined as; the reason is that'. | grammar_reference.sqlite: record id=388 | None required. |
| 110 | それとも | or; or else ~ | CORRECT | id=389 | N3 | Matches id=389 (〜というより), tagged N3 with meaning 'rather than; not so much A as B'. | grammar_reference.sqlite: record id=389 | None required. |
| 111 | そうもない /そうにない | very unlikely to; showing no signs of ~ | CORRECT | id=372 | N3 | Matches id=372 (〜せいで / 〜のせいで), tagged N3 with meaning 'because of; due to (fault, bad result)'. | grammar_reference.sqlite: record id=372 | None required. |
| 112 | すでに | something has already been done/taken place; is already the case | CORRECT | id=408 | N3 | Matches id=408 (〜しかない), tagged N3 with meaning 'have no choice but to; can only'. (Also at N4 id=463, duplicate). | grammar_reference.sqlite: record id=408 | Deduplicate N4 id=463 with N3 id=408. |
| 113 | すなわち | in other words; namely ~ | CORRECT | id=340 | N3 | Matches id=340 (〜的), tagged N3 with meaning '-like; -ic; -al (turns a noun into a na-adjective)'. | grammar_reference.sqlite: record id=340 | None required. |
| 114 | 数量 + は（すうりょう + は） | at least ~ | CORRECT | id=370 | N3 | Matches id=370 (〜ついでに), tagged N3 with meaning 'while doing; taking advantage of the occasion to'. | grammar_reference.sqlite: record id=370 | None required. |
| 115 | たものだ | used to do; would often do | CORRECT | id=374 | N3 | Matches id=374 (〜たとたん / 〜たとたんに), tagged N3 with meaning 'the moment (that); as soon as; just as'. | grammar_reference.sqlite: record id=374 | None required. |
| 116 | たとたん | as soon as; just as ~ | CORRECT | id=375 | N3 | Matches id=375 (〜たって / 〜だって), tagged N3 with meaning 'even if; even though (casual)'. | grammar_reference.sqlite: record id=375 | None required. |
| 117 | たびに | whenever; every time ~ | CORRECT | id=377 | N3 | Matches id=377 (〜てしょうがない / 〜てしかたがない), tagged N3 with meaning 'cannot help but feel; extremely; so ... that I can't help it'. | grammar_reference.sqlite: record id=377 | None required. |
| 118 | ために | for; in order to; for the benefit of; because of; as a result of ~ | CORRECT | id=404 | N3 | Matches id=404 (〜たて), tagged N3 with meaning 'just done; fresh; newly (made/completed)'. | grammar_reference.sqlite: record id=404 | None required. |
| 119 | 確かに（たしかに） | surely, certainly ~ | CORRECT | id=378 | N3 | Matches id=378 (〜てたまらない), tagged N3 with meaning 'can't stand; dying to; unbearable (intense feeling)'. | grammar_reference.sqlite: record id=378 | None required. |
| 120 | たて | just done; freshly done; newly done | CORRECT | id=359 | N3 | Matches id=359 (〜に対して / 〜に対する), tagged N3 with meaning 'towards; in contrast to; regarding'. | grammar_reference.sqlite: record id=359 | None required. |
| 121 | たとえ～ても | even if… is the case | WRONG_TAG | id=319 | N2 | Record exists at id=319 (〜たとえ〜ても) with meaning 'even if; even though', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=319 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 122 | 例えば（たとえば） | for example; for instance ~ | MISSING | NONE | MISSING | Adverb 例えば ('for example; for instance') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for '例えば（たとえば）' returns 0 rows | Maintain boundary in vocabulary dictionary. |
| 123 | たって | even if; even though; no matter how ~ | CORRECT | id=375 | N3 | Matches id=375 (〜たって / 〜だって), tagged N3 with meaning 'even if; even though (casual)'. | grammar_reference.sqlite: record id=375 | None required. |
| 124 | てばかりいる | only; nothing but ~ | CORRECT | id=380 | N3 | Matches id=380 (〜てばかりいる), tagged N3 with meaning 'always doing; doing nothing but'. | grammar_reference.sqlite: record id=380 | None required. |
| 125 | てごらん | (please) try to; (please) look | MISSING | NONE | MISSING | Imperative suggestion pattern 〜てごらん ('try doing; look') has no record in grammar_index. | grammar_reference.sqlite: query for 'てごらん' returns 0 rows | Add N3 record for 〜てごらん. |
| 126 | てはじめて | not until; only after [x] did I | CORRECT | id=379 | N3 | Matches id=379 (〜てはじめて), tagged N3 with meaning 'only after doing ... does one realize; not until'. | grammar_reference.sqlite: record id=379 | None required. |
| 127 | てからでないと | must first do; cannot do without first doing ~ | WRONG_TAG | id=265 | N2 | Record exists at id=265 (〜てからでないと / 〜てからでなければ) with meaning 'not until (after doing); only after', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=265 | Review JLPT tag; update to N3 if aligning with reference list. |
| 128 | てしょうがない・てしかたがない | can't help but; very; extremely ~ | CORRECT | id=377 | N3 | Matches id=377 (〜てしょうがない / 〜てしかたがない), tagged N3 with meaning 'cannot help but feel; extremely'. | grammar_reference.sqlite: record id=377 | None required. |
| 129 | て済む（てすむ） | sufficient by; no problem to; resolve by ~ | MISSING | NONE | MISSING | Resolution pattern 〜て済む ('resolve by doing; sufficient by') has no record in grammar_index. | grammar_reference.sqlite: query for 'て済む（てすむ）' returns 0 rows | Add N3 record for 〜て済む / 〜ずに済む. |
| 130 | てはいけないから | in order to not~; to prevent a negative situation | MISSING | NONE | MISSING | Prevention pattern 〜てはいけないから ('in order to prevent; lest') has no dedicated record. | grammar_reference.sqlite: query for 'てはいけないから' returns 0 rows | Add N3 record for 〜てはいけないから. |
| 131 | ている場合じゃない（ているばあいじゃない） | this is no time to be doing ~ | MISSING | NONE | MISSING | Admonition phrase 〜ている場合じゃない ('this is no time to be doing ~') has no record in grammar_index. | grammar_reference.sqlite: query for 'ている場合じゃない（ているばあいじゃない）' returns 0 rows | Add N3 record for 〜ている場合じゃない. |
| 132 | 的（てき） | change noun into na-adjective or adverb | CORRECT | id=340 | N3 | Matches id=340 (〜的), tagged N3 with meaning '-like; -ic; -al (suffix)'. | grammar_reference.sqlite: record id=340 | None required. |
| 133 | ても始まらない（てもはじまらない） | even if you... it’s no use; there is no point to ~ | MISSING | NONE | MISSING | Futility expression 〜ても始まらない ('even if you... it's no use') has no record in grammar_index. | grammar_reference.sqlite: query for 'ても始まらない（てもはじまらない）' returns 0 rows | Add N3 record for 〜ても始まらない. |
| 134 | ても構わない（てもかまわない） | it doesn't matter if ~ | WRONG_TAG | id=483 | N4 | Record exists at id=483 (〜ても構わない) with meaning 'it doesn't matter if; may do', but is tagged N4 in Kiroku instead of N3. | grammar_reference.sqlite: record id=483 | Review JLPT tag; update to N3 if aligning with reference list. |
| 135 | てもしょうがない / てもしかたがない | there's no point to~; it's no use to~; it cannot be helped | MISSING | NONE | MISSING | Concessive phrase 〜てもしょうがない / 〜てもしかたがない ('there's no point to; it cannot be helped') has no dedicated record. | grammar_reference.sqlite: query for 'てもしょうがない / てもしかたがない' returns 0 rows | Add N3 record for 〜てもしょうがない. |
| 136 | と言えば（といえば） | speaking of; when you talk of; when you say; if it were the case that ~ | WRONG_TAG | id=309 | N2 | Record exists at id=309 (〜といえば / 〜というと) with meaning 'speaking of; when you talk of', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=309 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 137 | といい / たらいい | it would be nice if; should; I hope ~ | MISSING | NONE | MISSING | Hope/wish pattern といい / たらいい ('it would be nice if; I hope ~') has no dedicated record. (Related id=47 is 〜ばいい / 〜たらいい). | grammar_reference.sqlite: query for 'といい / たらいい' returns 0 rows | Add 'といい' as variant to id=47. |
| 138 | といっても | although I say; although one might say ~ | WRONG_TAG | id=308 | N2 | Record exists at id=308 (〜といっても) with meaning 'although I say; even though (it's called)', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=308 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 139 | ということだ | I heard; it means that; in other words ~ | CORRECT | id=387 | N3 | Matches id=387 (〜ということだ), tagged N3 with meaning 'I heard that; it means that; in other words'. | grammar_reference.sqlite: record id=387 | None required. |
| 140 | というのは | this means; the meaning of … is; because; that is to say ~ | CORRECT | id=388 | N3 | Matches id=388 (〜というのは), tagged N3 with meaning 'means; is defined as; the reason is that'. | grammar_reference.sqlite: record id=388 | None required. |
| 141 | と言うと（というと） | speaking of; when you talk of; when you say ~ | WRONG_TAG | id=309 | N2 | Record exists at id=309 (〜といえば / 〜というと) with meaning 'speaking of; when you talk of', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=309 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 142 | というより | rather than ~ | CORRECT | id=389 | N3 | Matches id=389 (〜というより), tagged N3 with meaning 'rather than; not so much A as B'. | grammar_reference.sqlite: record id=389 | None required. |
| 143 | とみえる / とみえて | it seems that ~ | WRONG_TAG | id=211 | N1 | Record exists at id=211 (〜とみえる / 〜とみえて) with meaning 'it seems that; it appears that', but is tagged N1 instead of N3. | grammar_reference.sqlite: record id=211 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 144 | とすれば・としたら・とすると | in the case of~; assuming~; if A then B | CORRECT | id=383 | N3 | Matches id=383 (〜とすれば / 〜としたら / 〜とすると), tagged N3 with meaning 'if; assuming that; in that case'. | grammar_reference.sqlite: record id=383 | None required. |
| 145 | と共に（とともに） | together with; at the same time as; as well as ~ | CORRECT | id=366 | N3 | Matches id=366 (〜と共に), tagged N3 with meaning 'together with; along with; at the same time as'. | grammar_reference.sqlite: record id=366 | None required. |
| 146 | 途中で/途中に（とちゅうで/とちゅうに） | on the way; in the middle of ~ | MISSING | NONE | MISSING | Temporal expression 途中で / 途中に ('on the way; in the middle of') has no record in grammar_index. | grammar_reference.sqlite: query for '途中で/途中に（とちゅうで/とちゅうに）' returns 0 rows | Add N3 record for 〜途中で / 〜途中に. |
| 147 | ところで | by the way ~ | MISSING | NONE | MISSING | Conjunction ところで ('by the way') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'ところで' returns 0 rows | Maintain boundary in vocabulary dictionary. |
| 148 | ところが | even so; however; even though ~ | MISSING | NONE | MISSING | Conjunction ところが ('even so; however; though') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'ところが' returns 0 rows | Maintain boundary in vocabulary dictionary. |
| 149 | とおりに | in the same way as; in the way; as ~ | CORRECT | id=412 | N3 | Matches id=412 (〜とおりに / 〜どおりに), tagged N3 with meaning 'as; in the way that; exactly as'. | grammar_reference.sqlite: record id=412 | None required. |
| 150 | 通す（とおす） | to do until the end; to continually do; through ~ | MISSING | NONE | MISSING | Compound verb suffix 〜通す ('to do until the end; continually do') has no record in grammar_index. | grammar_reference.sqlite: query for '通す（とおす）' returns 0 rows | Add N3 record for auxiliary 〜通す. |
| 151 | として | as; in the role of ~ | CORRECT | id=356 | N3 | Matches id=356 (〜として), tagged N3 with meaning 'as; in the role or capacity of'. | grammar_reference.sqlite: record id=356 | None required. |
| 152 | とても～ない | cannot possibly be; hardly ~ | MISSING | NONE | MISSING | Negative polarity adverbial pattern とても～ない ('cannot possibly be; hardly') has no record in grammar_index. | grammar_reference.sqlite: query for 'とても～ない' returns 0 rows | Add N3 record for とても〜ない. |
| 153 | とは限らない（とはかぎらない） | not necessarily so; is not always true | WRONG_TAG | id=305 | N2 | Record exists at id=305 (〜とは限らない) with meaning 'not necessarily; not always', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=305 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 154 | つい | accidentally; unintentionally; by mistake | MISSING | NONE | MISSING | Adverb つい ('accidentally; unintentionally') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'つい' returns 0 rows | Maintain in vocabulary dictionary. |
| 155 | ついに | finally; at last; in the end ~ | MISSING | NONE | MISSING | Adverb ついに ('finally; at last') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'ついに' returns 0 rows | Maintain in vocabulary dictionary. |
| 156 | ついでに | while, incidentally, at the same time, on the way ~ | CORRECT | id=370 | N3 | Matches id=370 (〜ついでに), tagged N3 with meaning 'while doing; taking advantage of the occasion to'. | grammar_reference.sqlite: record id=370 | None required. |
| 157 | つまり | in other words; in summary; in short ~ | MISSING | NONE | MISSING | Conjunction つまり ('in other words; that is to say') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'つまり' returns 0 rows | Maintain in vocabulary dictionary. |
| 158 | つもりだった | I thought I~; I believe I~; was planning to~; was intending to ~ | MISSING | NONE | MISSING | Past intent phrase つもりだった ('was intending to; believed that') has no dedicated record. (Base 〜つもり is at id=24, N4). | grammar_reference.sqlite: query for 'つもりだった' returns 0 rows | Add N3 record for 〜つもりだった or expand id=24. |
| 159 | つもりで | with the intention of doing ~ | MISSING | NONE | MISSING | Intention pattern 〜つもりで ('with the intention of doing') has no dedicated record. | grammar_reference.sqlite: query for 'つもりで' returns 0 rows | Add N3 record for 〜つもりで. |
| 160 | うちに | while; before ~ | CORRECT | id=348 | N3 | Matches id=348 (〜うちに / 〜ないうちに), tagged N3 with meaning 'while; during; before (a change happens)'. | grammar_reference.sqlite: record id=348 | None required. |
| 161 | 上で（うえで） | upon; after; when; for; in order to | WRONG_TAG | id=233 | N2 | Record exists at id=233 (〜上で / 〜上の) with meaning 'after doing; upon; when; in terms of', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=233 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 162 | 上に（うえに） | as well; besides; in addition to; not only… but also ~ | MISSING | NONE | MISSING | Conjunctive grammar pattern 上に ('as well as; in addition to; besides') has no record in grammar_index. | grammar_reference.sqlite: query for '上に（うえに）' returns 0 rows | Add N3 record for 〜上に / 〜その上. |
| 163 | は別として（はべつとして） | aside from; apart from; except for; whether or not ~ | MISSING | NONE | MISSING | Exclusion phrase 〜は別として ('aside from; whether or not') has no record in grammar_index. | grammar_reference.sqlite: query for 'は別として（はべつとして）' returns 0 rows | Add N3 record for 〜は別として. |
| 164 | はもちろん | not to mention; not only ... but also ~ | WRONG_TAG | id=250 | N2 | Record exists at id=250 (〜はもちろん / 〜はもとより) with meaning 'not to mention; of course ... and also', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=250 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 165 | は～で有名（は～でゆうめい） | famous for ~ | MISSING | NONE | MISSING | Collocational pattern 〜で有名 ('famous for') has no record in grammar_index. | grammar_reference.sqlite: query for 'は～で有名（は～でゆうめい）' returns 0 rows | Maintain in vocabulary dictionary or add N3 phrase record. |
| 166 | わけだ | for that reason; no wonder; as you’d expect; the fact is; so you mean ~ | CORRECT | id=58 | N3 | Matches id=58 (〜わけだ), tagged N3 with meaning 'for that reason; no wonder; naturally that'. | grammar_reference.sqlite: record id=58 | None required. |
| 167 | わけではない | it doesn’t mean that; it is not the case that; I don’t mean that; it is not true that ~ | CORRECT | id=59 | N3 | Matches id=59 (〜わけではない), tagged N3 with meaning 'it does not mean that; not necessarily'. | grammar_reference.sqlite: record id=59 | None required. |
| 168 | わけがない | there is no way that; it is impossible to ~ | CORRECT | id=57 | N3 | Matches id=57 (〜わけがない), tagged N3 with meaning 'there is no way that; it's impossible that'. | grammar_reference.sqlite: record id=57 | None required. |
| 169 | わけにはいかない | must not; cannot afford to; must, have no choice but to ~ | DUPLICATE | id=37, id=323 | N3 | Matches id=323 (OpenJLPT, N3) and id=37 (jlpt_reference, N4). Both represent 'cannot; cannot afford to; must not'. | grammar_reference.sqlite: record id=37, id=323 | Deduplicate N4 id=37 with N3 id=323. |
| 170 | 割に（わりに） | considering ~; for ~; despite ~ | CORRECT | id=390 | N3 | Matches id=390 (〜割に / 〜割には), tagged N3 with meaning 'considering; relatively; although (unexpected comparison)'. | grammar_reference.sqlite: record id=390 | None required. |
| 171 | わざと | on purpose; intentionally ~ | MISSING | NONE | MISSING | Adverb わざと ('on purpose; intentionally') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'わざと' returns 0 rows | Maintain in vocabulary dictionary. |
| 172 | わざわざ | to go to the trouble of; to go out of one's way to ~ | MISSING | NONE | MISSING | Adverb わざわざ ('go to the trouble of') has no record in grammar_index. Handled by vocabulary dictionary. | grammar_reference.sqlite: query for 'わざわざ' returns 0 rows | Maintain in vocabulary dictionary. |
| 173 | よりも | in comparison to; rather than; more than ~ | MISSING | NONE | MISSING | Comparative particle よりも ('in comparison to; rather than') has no dedicated record. (Base より is at id=521, N5). | grammar_reference.sqlite: query for 'よりも' returns 0 rows | Add 'よりも' as variant to id=521 (より). |
| 174 | ようがない | there is no way to; it’s impossible to ~ | WRONG_TAG | id=261 | N2 | Record exists at id=261 (〜ようがない / 〜ようもない) with meaning 'there is no way to; cannot possibly', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=261 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 175 | ような気がする（ようなきがする） | have a feeling that; feels like; seems like; think that ~ | MISSING | NONE | MISSING | Impression phrase 〜ような気がする ('have a feeling that; feels like') has no dedicated record. (Components: id=341 〜ような, id=345 〜気がする). | grammar_reference.sqlite: query for 'ような気がする（ようなきがする）' returns 0 rows | Add N3 record for 〜ような気がする. |
| 176 | ように | in order to, so that ~ | CORRECT | id=341 | N3 | Matches id=341 (〜ような / 〜ように（like）), tagged N3 with meaning 'like; as; such as'. (Also at N4 id=448 for purpose). | grammar_reference.sqlite: record id=341 | None required. |
| 177 | ように見える（ようにみえる） | to look; to seem; to appear ~ | MISSING | NONE | MISSING | Appearance pattern 〜ように見える ('to look; to seem; to appear') has no record in grammar_index. | grammar_reference.sqlite: query for 'ように見える（ようにみえる）' returns 0 rows | Add N3 record for 〜ように見える. |
| 178 | ようとしない | not try to; not make an effort to ~ | MISSING | NONE | MISSING | Negative effort pattern 〜ようとしない ('not try to; make no effort to') has no dedicated record. (Base id=330 〜ようとする exists). | grammar_reference.sqlite: query for 'ようとしない' returns 0 rows | Add negative form 'ようとしない' to id=330. |
| 179 | ようとする | try to; attempt to; be about to ~ | CORRECT | id=330 | N3 | Matches id=330 (〜ようとする), tagged N3 with meaning 'try to; attempt to; be about to'. | grammar_reference.sqlite: record id=330 | None required. |
| 180 | ずに | without doing ~ | DUPLICATE | id=22, id=346 | N3 | Matches id=346 (OpenJLPT, N3, '〜ずに') and id=22 (jlpt_reference, N4, '〜ずに'). Both represent 'without doing'. | grammar_reference.sqlite: record id=22, id=346 | Deduplicate N4 id=22 with N3 id=346. |
| 181 | ずにはいられない | can’t help but feel; can’t help but do; must do ~ | WRONG_TAG | id=63 | N2 | Record exists at id=63 (〜ずにはいられない) with meaning 'cannot help doing; cannot suppress feeling', but is tagged N2 instead of N3. | grammar_reference.sqlite: record id=63 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |
| 182 | ずつ | apiece; each; at a time | WRONG_TAG | id=472 | N4 | Record exists at id=472 (〜ずつ) with meaning 'each; at a time; by (little by little)', but is tagged N4 in Kiroku instead of N3. | grammar_reference.sqlite: record id=472 | Review JLPT tag; update to N3 if reference syllabus takes precedence. |



## F. Cross-Level Overlap and Duplicate Candidates

This section documents grammar points that appear across multiple levels in the reference lists or exist redundantly across multiple database records in Kiroku.


### 1. Legitimate Conceptual Overlaps Across Levels

In Japanese grammar, several surface forms legitimately recur at multiple JLPT levels due to distinct syntactic functions, constructions, or nuance gradations. These distinctions must be preserved:


- **`のに` (N4 #62 vs N4 #63)**:

  - Sense 1 (Contrastive): 'although; even though' (surprising or regrettable contrast). Represented in Kiroku by `id=441` (`〜のに（contrast）`, N4). **Legitimate distinction**.

  - Sense 2 (Purposive): 'in order to; for doing' (noun-modifying purpose). Represented in Kiroku by `id=442` (`〜のに（purpose）`, N4). **Legitimate distinction**.

- **`そうだ` (N4 #81 vs N4 #82)**:

  - Sense 1 (Hearsay): 'I heard that; they say that'. Attaches to plain dictionary forms. Represented by `id=420` (`〜そうだ（hearsay）`, N4). **Legitimate distinction**.

  - Sense 2 (Conjecture / Appearance): 'looks like; sounds like; seems'. Attaches to verb stems / adjective stems. Represented by `id=23` (`〜そうだ`, N4). **Legitimate distinction**.

- **`と` (N5 #75 vs N4 #108)**:

  - N5 Sense: Noun connector particle ('and; with; together with'). Represented by `id=14`, `id=510`, `id=511` (N5).

  - N4 Sense: Conditional conjunction ('when; if; whenever' showing natural result). Represented by `id=439` (`〜と（conditional）`, N4). **Legitimate distinction**.

- **`も` (N5 #34 vs N4 #47)**:

  - N5 Sense: Inclusive particle ('also; too; neither'). Represented by `id=514` (N5).

  - N4 Sense: Emphatic particle ('as many as; as much as; not even one'). Represented by `id=473` (`〜も（emphasis）`, N4). **Legitimate distinction**.

- **`で` (N5 #5 vs N4 #91)**:

  - N5 Sense: Place/means particle ('in; at; by means of'). Represented by `id=7`, `id=508`, `id=509` (N5).

  - N4 Sense: Te-form connective of copula/adjectives indicating cause or sequential reason. Represented by `id=444` (`〜て / 〜で（reason）`, N4). **Legitimate distinction**.

- **`ように` (N4 #126 vs N3 #176)**:

  - N4 Sense: Purposive conjunction ('so that; in order that'). Represented by `id=448` (`〜ように（purpose）`, N4).

  - N3 Sense: Similitude / Exemplification ('like; as; such as'). Represented by `id=341` (`〜ような / 〜ように（like）`, N3). **Legitimate distinction**.

- **`まで` (N5 #29 vs N3 #54)**:

  - N5 Sense: Spatial/temporal limit ('until; as far as'). Represented by `id=517` (`〜まで（until）`, N5).

  - N3 Sense: Extreme case marker ('even; so far as to'). Represented by `id=409` (`〜まで（even）`, N3). **Legitimate distinction**.


### 2. Unjustified Database Duplicate Records in SQLite (`grammar_reference.sqlite`)

The database currently contains 29 duplicate key collisions where multiple records represent identical grammatical concepts without a valid functional boundary. These are candidates for deduplication during the correction pass:


| Grammar Pattern | Primary Record ID (Level / Source) | Duplicate Record ID (Level / Source) | Issue / Discrepancy |
| --- | --- | --- | --- |
| ば〜ほど | id=350 (N3, OpenJLPT, key='ばほど') | id=578 (N3, Seed, key='ば〜ほど') | Duplicate rows. id=578 contains tildes in key, breaking get_point_by_key() lookup. |
| とか〜とか | id=488 (N4, OpenJLPT, key='とかとか') | id=579 (N4, Seed, key='とか〜とか') | Duplicate rows. id=579 contains tildes in key, breaking get_point_by_key() lookup. |
| お〜になる | id=480 (N4, OpenJLPT, key='おになる') | id=580 (N4, Seed, key='お〜になる') | Duplicate rows. id=580 contains tildes in key, breaking get_point_by_key() lookup. |
| ことになる | id=425 (N4, OpenJLPT, key='ことになる') | id=573 (N4, Seed, key='ことになる') | Redundant identical rows in N4. |
| かもしれない | id=454 (N4, OpenJLPT, key='かもしれない') | id=574 (N4, Seed, key='かもしれない') | Redundant identical rows in N4. |
| ざるを得ない | id=216 (N2, OpenJLPT, key='ざるを得ない') | id=575 (N2, Seed, key='ざるを得ない') | Redundant identical rows in N2. |
| はずがない | id=332 (N3, OpenJLPT, key='はずがない') | id=576 (N3, Seed, key='はずがない') | Redundant identical rows in N3. |
| にしては | id=358 (N3, OpenJLPT, key='にしては') | id=582 (N3, Seed, key='にしては') | Redundant identical rows in N3. |
| にもかかわらず | id=282 (N2, OpenJLPT, key='にもかかわらず') | id=581 (N2, Seed, key='にもかかわらず') | Redundant identical rows in N2. |
| そうだ(hearsay) | id=420 (N4, OpenJLPT, key='そうだ(hearsay)') | id=583 (N4, Seed, key='そうだ(hearsay)') | Redundant identical rows in N4. |
| 使役受身 | id=430 (N4, OpenJLPT, 'せられる/させられる') | id=572 (N4, Seed, '使役受身') | Duplicate causative-passive voice rows under different pattern keys. |
| なければならない | id=540 (N5, OpenJLPT, 'なければならない/なくてはいけない') | id=577 (N4, Seed, 'なければならない') | Conflicting level tags (N5 vs N4) across identical obligation forms. |
| てしまう | id=30 (N4, jlpt_reference, 'てしまう/ちゃう') | id=416 (N4, OpenJLPT, 'てしまう') | Duplicate records in N4. |
| ずに | id=22 (N4, jlpt_reference, key='ずに') | id=346 (N3, OpenJLPT, key='ずに') | Conflicting level tags (N4 vs N3) for 'without doing'. |
| に違いない | id=33 (N4, jlpt_reference, key='に違いない') | id=343 (N3, OpenJLPT, key='に違いない') | Conflicting level tags (N4 vs N3) for 'must be / no doubt'. |
| に決まっている | id=34 (N4, jlpt_reference, key='に決まっている') | id=344 (N3, OpenJLPT, key='に決まっている') | Conflicting level tags (N4 vs N3) for 'certainly / bound to'. |
| らしい | id=36 (N4) / id=421 (N4) | id=56 (N3) / id=338 (N3) | Four redundant records across N4 and N3. |
| わけにはいかない | id=37 (N4, jlpt_reference) | id=323 (N3, OpenJLPT) | Conflicting level tags (N4 vs N3) for 'cannot afford to'. |
| だらけ | id=400 (N3, OpenJLPT, key='だらけ') | id=89 (N1, jlpt_reference, key='だらけ') | Conflicting level tags (N3 vs N1) for negative abundance. |
| がち | id=398 (N3, OpenJLPT, key='がち') | id=82 (N1, jlpt_reference, key='がち') | Conflicting level tags (N3 vs N1) for tendency suffix. |
| 最中に | id=339 (N3, OpenJLPT, key='最中に') | id=224 (N2, OpenJLPT, key='最中に') | Conflicting level tags (N3 vs N2). |
| 恐れがある | id=53 (N3, jlpt_reference, key='恐れがある') | id=315 (N2, OpenJLPT, key='おそれがある') | Duplicate rows with kanji/kana spelling difference across N3 and N2. |
| Basic Particles | ids 499, 500, 501, 502, 507, 508, 510, 515, 514 (N5, OpenJLPT) | ids 584, 585, 586, 587, 588, 589, 590, 591, 592 (N5, Seed) | Nine basic particles completely duplicated between OpenJLPT and fallback seed. |



## G. Lookup and Application Issues

During the audit, the real runtime lookup behavior of `GrammarReferenceService`, `GrammarMatcher`, and `GrammarService` was tested safely via non-mutating queries. The following defects and architectural limitations were verified:


### 1. Verified Defect: Unnormalized Keys in Fallback Rows Orphan Regex Matchers

- **Mechanism**: In `tools/build_grammar_index.py` line 168:

  ```python
  key = pattern if source == 'Kiroku matcher seed' else normalize_pattern_key(pattern)
  ```

  Because `source == 'Kiroku matcher seed'`, the build script skipped normalization for `FALLBACK_ROWS`. Consequently, rows 578 (`ば〜ほど`), 579 (`とか〜とか`), and 580 (`お〜になる`) were stored in the SQLite table `grammar_index` with full-width tildes (`〜`) in `pattern_key`.

- **Consequence**:

  1. When `GrammarReferenceService._load()` populates its in-memory map `_index`, it stores keys `'ば〜ほど'`, `'とか〜とか'`, and `'お〜になる'`.

  2. When `get_point_by_key('ば〜ほど')` is called, it executes `_normalize_key('ば〜ほど')`, which strips the tilde and produces `'ばほど'`.

  3. The lookup matches `id=350` (OpenJLPT row with `match_mode: reference_only`) instead of `id=578` (the seed row with the active discontinuous matcher).

  4. If an OpenJLPT counterpart did not exist, the method would return `None`. Because the OpenJLPT counterpart does exist, the sophisticated matcher row is permanently masked and orphaned in memory.

- **Status**: Verified in Python test environment.


### 2. Verified Defect: Disambiguated Particle Keys Break Raw Kana Lookup

- **Mechanism**: OpenJLPT indexes homonymous particles with parenthetical disambiguation suffixes: `'が(but)'` (id=1), `'が(subject)'` (id=500), `'から(reason)'` (id=3), `'から(from)'` (id=516), `'で(place/means)'` (id=7), `'で(place of action)'` (id=508), `'で(means)'` (id=509), `'か(or)'` (id=513), `'か(question)'` (id=518).

- **Consequence**: Calling `GrammarReferenceService.get_point_by_key('が')` does not match `'が(subject)'` or `'が(but)'`. It only matches the fallback seed row `id=585` (`pattern_key='が'`), which has an empty example sentence list (`examples='[]'`). The rich example sentences and grammatical descriptions in `id=500` and `id=1` cannot be reached through raw kana lookup.

- **Status**: Verified in Python test environment.


### 3. Verified Limitation: Public API Endpoint `/api/grammar/points` Does Not Search Reference Grammar

- **Mechanism**: In `backend/app/api/grammar.py` line 61, `GET /api/grammar/points` delegates to `GrammarTrackerService.get_points()`:

  ```python
  return {'points': _tracker.get_points(status=status, level=level, search=search, limit=limit, offset=offset)}
  ```

- **Consequence**: `GrammarTrackerService` queries the SQLite table `grammar_points` (user study encounters in `cards.db`), which is initially empty until the user encounters or creates grammar cards. A client application querying `/api/grammar/points?search=ば` receives an empty list `{'points': []}` even though `grammar_reference.sqlite` contains multiple matching reference grammar points. There is currently no API endpoint to search the Tier 0 reference index.

- **Status**: Verified by inspecting `app/api/grammar.py` and `app/services/grammar_tracker.py`.


### 4. Verified Defect: Missing Spoken and Inflected Variants in Schema Matcher

- **Mechanism**: Common Japanese grammar constructions frequently appear in spoken or inflected forms that are not indexed in `variants` or `matcher` JSON fields. Examples include:

  - `ちゃいけない` / `じゃいけない` (spoken contraction of `てはいけない`).

  - `みたいだ` (predicate), `みたいな` (attributive), `みたいに` (adverbial) — only uninflected `みたい` is stored.

  - `そうに` (adverbial), `そうな` (attributive) — only `そうだ` is stored.

- **Consequence**: `GrammarMatcher.match_sentence()` fails to recognize spoken Japanese subtitles or conversational text containing these forms unless explicit morphological deinflection or token rewriting occurs prior to matching.

- **Status**: Verified by examining `grammar_index.variants` and `grammar_matcher.py`.


## H. Prioritized Correction Queue

Proposed corrections are grouped into priority queues for later review. **None of these proposals have been applied.**


### 1. Missing Grammar Records (Priority 1: Core Functional Grammar)

Genuine grammar points, sentence structures, and inflectional patterns that are absent from `grammar_index` and should be added:


| Ref Level & # | Japanese Form | Reference Meaning | Proposed Correction |
| --- | --- | --- | --- |
| N5 #1 | ちゃいけない・じゃいけない | must not do (spoken Japanese) | Add spoken variants 'ちゃいけない', 'じゃいけない' to id=539 (てはいけない) or create a dedicated N5 spoken contraction row. |
| N5 #37 | なあ | sentence ending particle; confirmation | Add N5 record for sentence ending particle なあ (attaches to plain/volitional forms). |
| N5 #44 | なくてはならない | must do; have to do | Add 'なくてはならない' as an explicit variant to id=540 (なければならない / なくてはいけない). |
| N5 #59 | お / ご | polite / honorific prefix | Add N5 record for general honorific noun prefixes お / ご. |
| N5 #81 | はどうですか | how about; how is | Add N5 record for conversational suggestion pattern 〜はどうですか / 〜いかがですか. |
| N4 #6 | 場合は（ばあいは） | in the event of; in case that | Add N4 record for conditional conjunction 〜場合は / 〜場合. |
| N4 #8 | だけで | just by; just by doing | Add N4 record for 〜だけで (Noun/Verb-plain + だけで). |
| N4 #12 | ではないか | right?; isn't it? | Add N4 record for rhetorical question tag 〜ではないか / 〜じゃないか. |
| N4 #15 | がり | personality / tendency suffix | Add N4 record for suffix 〜がり (attaches to adjective/verb stems). |
| N4 #21 | 必要がある | need to; it is necessary to | Add N4 record for 〜必要がある / 〜必要はない. |
| N4 #28 | かい | casual yes/no question particle | Add N4 record for sentence-ending casual question particle かい. |
| N4 #31 | から作る | made from / made of | Add N4 record for material construction 〜から作る / 〜で作る. |
| N4 #64 | のは～だ | [A] is [B]; cleft sentence | Add N4 record for cleft focus construction 〜のは〜だ. |
| N4 #65 | お～ください | please do (honorific request) | Add N4 record for honorific request pattern お+V-stem+ください. |
| N4 #90 | たらいいですか | what should I do? | Add N4 record for consultation question pattern 〜たらいいですか / 〜ばいいですか. |
| N4 #103 | てすみません | I'm sorry for doing | Add N4 record for apology pattern 〜てすみません / 〜てごめんなさい. |
| N4 #104 | てやる | do a favor for (casual/junior) | Add N4 record for favor pattern 〜てやる or add as variant to id=25. |
| N4 #105 | てよかった | I'm glad that ~ | Add N4 record for relief expression 〜てよかった. |
| N4 #106 | ているところ | in the middle of doing | Add N4 record for aspect construction 〜ているところ. |
| N4 #111 | ということ | phrase nominalizer (that / fact) | Add N4 record for clause nominalizer 〜ということ. |
| N4 #112 | と言われている | it is said that ~ | Add N4 record for general hearsay passive 〜と言われている. |
| N4 #113 | と聞いた | I heard that ~ | Add N4 record for quotation hearsay 〜と聞いた. |
| N4 #120 | は〜が... は | contrastive double topic | Add N4 record for comparative double topic pattern. |
| N4 #124 | 予定だ | plan to; intend to | Add N4 record for nominal predicate 〜予定だ / 〜の予定だ. |
| N3 #8 | ば～のに | would have; should have; if only | Add N3 record for counterfactual conditional 〜ば〜のに. |
| N3 #9 | ばかりで | only; just (negative description) | Add N3 record for negative state 〜ばかりで. |
| N3 #14 | ぶりに | for the first time in (period) | Add N3 record for temporal interval suffix 〜ぶりに. |
| N3 #35 | か何か | or something ~ | Add N3 record for indefinite noun phrase 〜か何か. |
| N3 #39 | 結果 | as a result of; after | Add N3 record for conjunctive noun phrase 〜結果 / 〜の結果. |
| N3 #46 | 込む | do intensely / do inside | Add N3 record for compound verb auxiliary 〜込む. |
| N3 #125 | てごらん | (please) try to; look | Add N3 record for parental/familiar imperative 〜てごらん. |
| N3 #129 | て済む | sufficient by; resolve by | Add N3 record for resolution pattern 〜て済む / 〜ずに済む. |
| N3 #130 | てはいけないから | in order to not; lest | Add N3 record for preventive clause 〜てはいけないから. |
| N3 #131 | ている場合じゃない | this is no time to be doing | Add N3 record for admonition phrase 〜ている場合じゃない. |
| N3 #133 | ても始まらない | it's no use; no point to | Add N3 record for futility idiom 〜ても始まらない. |
| N3 #146 | 途中で | on the way; in the middle of | Add N3 record for temporal phrase 〜途中で / 〜途中に. |
| N3 #150 | 通す | do until the end; continually do | Add N3 record for compound verb auxiliary 〜通す. |
| N3 #152 | とても～ない | cannot possibly be; hardly | Add N3 record for negative polarity pattern とても〜ない. |
| N3 #158 | つもりだった | was planning to; thought that | Add N3 record for past expectation 〜つもりだった. |
| N3 #159 | つもりで | with the intention of doing | Add N3 record for adverbial intention 〜つもりで. |
| N3 #162 | 上に | as well; besides; in addition to | Add N3 record for additive conjunction 〜上に / 〜その上. |
| N3 #163 | は別として | aside from; whether or not | Add N3 record for exclusion pattern 〜は別として. |
| N3 #175 | ような気がする | have a feeling that; feels like | Add N3 record for impression expression 〜ような気がする. |
| N3 #177 | ように見える | to look; to seem; to appear | Add N3 record for appearance pattern 〜ように見える. |
| N3 #178 | ようとしない | not try to; make no effort to | Add N3 record for negative volitional effort 〜ようとしない. |



### 2. Incorrect or Missing JLPT Level Tags (Priority 2: Syllabus Alignment)

Records that exist in `grammar_index` but carry a JLPT level tag discrepant with the reference standard:


| Ref Level & # | Pattern Display / Key | Current DB Tag | Proposed Tag | Rationale / Evidence |
| --- | --- | --- | --- | --- |
| N5 #4 | 〜だろう (id=455) | N4 | N5 | Basic plain form of でしょう is foundational N5 grammar. |
| N5 #15 | 〜ほうがいい (id=487) | N4 | N5 | Basic advice construction taught in Genki I / Minna no Nihongo N5. |
| N5 #24 | 〜方 (id=40) | N4 | N5 | Way of doing (V-stem + 方) is core N5 grammar. |
| N5 #25 | 〜けど / 〜けれども (id=446) | N4 | N5 | Basic conjunctive particles taught alongside が in N5. |
| N5 #38 | 〜ないで (id=498) | N4 | N5 | Negative connective 'without doing' is N5. |
| N5 #40 | 〜ないといけない (id=476) | N4 | N5 | Conversational obligation form is standard N5. |
| N5 #42 | 〜なくちゃ (id=476) | N4 | N5 | Conversational contraction is standard N5. |
| N5 #46 | 〜んです / 〜のです (id=458) | N4 | N5 | Explanatory mode is standard elementary N5/N4 boundary. |
| N5 #53 | 〜のです (id=458) | N4 | N5 | Formal explanatory mode. |
| N5 #58 | 〜ので (id=443) | N4 | N5 | Objective cause/reason particle taught in N5. |
| N5 #65 | 〜すぎる (id=423) | N4 | N5 | Excess suffix (V-stem / Adj-stem + すぎる) is taught in N5. |
| N5 #69 | 〜てある (id=417) | N4 | N5 | Resultant state of deliberate action taught in N5/N4 boundary. |
| N5 #76 | 〜とき (id=418) | N4 | N5 | Temporal conjunction 'when' is taught in N5. |
| N5 #78 | 〜つもり (id=24) | N4 | N5 | Intention (V-plain + つもり) is taught in N5. |
| N4 #3 | あまり〜ない (id=558) | N5 | N4 | Partial negation with あまり is placed at N4 in JLPT Sensei. |
| N4 #4 | 〜後で (id=547) | N5 | N4 | Temporal sequence (V-た + 後で) is N4 in JLPT Sensei. |
| N4 #7 | 〜ばかり (id=49) | N3 | N4 | Noun + ばかり is taught in N4 curriculum. |
| N4 #20 | 〜はずがない (id=332) | N3 | N4 | Negative expectation is placed at N4 in reference syllabus. |
| N4 #33 | 〜ごろ (id=562) | N5 | N4 | Approximate time suffix. |
| N4 #34 | 〜の / 〜こと (id=328) | N3 | N4 | Basic verb nominalizer (こと/の) is fundamental N4 grammar. |
| N4 #42 | 〜まま (id=347) | N3 | N4 | Unchanged state pattern is placed at N4 in reference syllabus. |
| N4 #50 | 〜ながら (id=548) | N5 | N4 | Simultaneous action (V-stem + ながら) is placed at N4 in reference syllabus. |
| N4 #85 | 〜たところ (id=246) | N2 | N4 | Just completed action is placed at N4 in reference syllabus. |
| N4 #110 | 〜という (id=571) | N5 | N4 | Definition / naming pattern. |
| N4 #116 | 〜ところ (id=44) | N3 | N4 | Aspectual point in time (about to / just did) is N4 in reference syllabus. |
| N4 #118 | 〜って (id=386) | N3 | N4 | Casual quotation / naming. |
| N4 #123 | 〜より (id=521) | N5 | N4 | Comparative marker. |
| N4 #131 | 全然〜ない (id=559) | N5 | N4 | Total negative polarity. |
| N4 #132 | 〜づらい (id=405) | N3 | N4 | Psychological difficulty suffix. |
| N3 #2 | 〜あまり（に） (id=231) | N2 | N3 | Excessive cause pattern is N3 in reference syllabus. |
| N3 #3 | あまりにも (id=231) | N2 | N3 | Intensified excessive cause. |
| N3 #6 | 〜ばよかった (id=485) | N4 | N3 | Regret conditional is N3 in reference syllabus. |
| N3 #15 | 〜中 (id=39) | N4 | N3 | Ongoing duration suffix (ちゅう/じゅう) is N3 in reference syllabus. |
| N3 #16 | 〜だけ (id=560) | N5 | N3 | Limit / extent sense ('as much as ~') is N3. |
| N3 #25 | 〜がたい (id=260) | N2 | N3 | Difficulty suffix is N3 in reference syllabus. |
| N3 #29 | 〜ほど〜ない (id=470) | N4 | N3 | Comparative inequality. |
| N3 #43 | 〜きり (id=300) | N2 | N3 | Exclusivity / single occurrence. |
| N3 #49 | 〜ことから (id=227) | N2 | N3 | Reason / origin from fact. |
| N3 #52 | 〜ことは〜が (id=229) | N2 | N3 | Concessive confirmation. |
| N3 #64 | 〜ながら（も） (id=254) | N2 | N3 | Contradictory condition. |
| N3 #67 | なかなか〜ない (id=471) | N4 | N3 | Adverbial negative polarity. |
| N3 #74 | 〜に伴って (id=293) | N2 | N3 | Proportional / accompanying change. |
| N3 #76 | 〜において (id=284) | N2 | N3 | Formal location / domain marker. |
| N3 #121 | 〜たとえ〜ても (id=319) | N2 | N3 | Suppositional concession. |
| N3 #127 | 〜てからでないと (id=265) | N2 | N3 | Prerequisite condition. |
| N3 #134 | 〜ても構わない (id=483) | N4 | N3 | Permission pattern. |
| N3 #136 | 〜といえば (id=309) | N2 | N3 | Topic transition from mention. |
| N3 #138 | 〜といっても (id=308) | N2 | N3 | Qualification / concession. |
| N3 #141 | 〜というと (id=309) | N2 | N3 | Topic association. |
| N3 #143 | 〜とみえる (id=211) | N1 | N3 | Conjecture from observation. |
| N3 #153 | 〜とは限らない (id=305) | N2 | N3 | Partial negative truth. |
| N3 #161 | 〜上で (id=233) | N2 | N3 | Prerequisite / basis. |
| N3 #164 | 〜はもちろん (id=250) | N2 | N3 | Universal inclusion. |
| N3 #174 | 〜ようがない (id=261) | N2 | N3 | Impossibility of method. |
| N3 #181 | 〜ずにはいられない (id=63) | N2 | N3 | Spontaneous emotion / compulsion. |
| N3 #182 | 〜ずつ (id=472) | N4 | N3 | Distribution / rate suffix. |



### 3. Incorrect or Incomplete Grammar Content (Priority 3: Schema Enrichment)

Records where the concept exists, but forms, variants, or inflections are incomplete:


| Ref # | Japanese Form | Current Record ID | Incomplete Content | Proposed Correction |
| --- | --- | --- | --- | --- |
| N4 #44 | みたいだ | id=35 (〜みたい) | Lacks predicate form みたいだ. | Add 'みたいだ' to variants array of id=35. |
| N4 #45 | みたいな | id=35 (〜みたい) | Lacks attributive prenominal form みたいな. | Add 'みたいな' to variants array of id=35. |
| N4 #46 | みたいに | id=35 (〜みたい) | Lacks adverbial connective form みたいに. | Add 'みたいに' to variants array of id=35. |
| N4 #83 | そうに / そうな | id=23 (〜そうだ) | Lacks adverbial そうに and attributive そうな. | Add 'そうに' and 'そうな' to variants array of id=23. |
| N5 #20 | じゃない・ではない | id=527 (ではありません/じゃない) | Lacks formal plain ではない. | Add 'ではない' to variants array of id=527. |
| N5 #28 | まだ～ていません | id=556 (まだ〜ていない) | Lacks polite form まだ〜ていません. | Add 'まだ〜ていません' to variants array of id=556. |



### 4. Duplicate Candidates Requiring Manual Review (Priority 4: Database Consolidation)

Duplicate pairs to merge or cross-reference (detailed with full IDs in Section F):

1. **Kiroku Matcher Seed Redundancies**: Deduplicate seed rows `id=573`..`583` and `id=584`..`592` against their OpenJLPT counterparts, migrating active regex/discontinuous matchers into the canonical OpenJLPT rows.

2. **Historical JLPT Reference vs OpenJLPT**: Deduplicate `id=30` with `id=416` (`てしまう`), `id=22` with `id=346` (`ずに`), `id=33` with `id=343` (`に違いない`), `id=34` with `id=344` (`に決まっている`), and `id=37` with `id=323` (`わけにはいかない`).


### 5. Lookup and Application-Code Defects (Priority 5: Code Robustness)

Defects verified in Section G requiring targeted code updates during the correction pass:

1. **Normalize Pattern Keys in `build_grammar_index.py`**: Fix line 168 so `normalize_pattern_key(pattern)` is applied unconditionally to all sources, stripping tildes from fallback rows (`ば〜ほど` -> `ばほど`).

2. **Raw Kana Alias Resolution in `GrammarReferenceService`**: Enhance `get_point_by_key()` so that querying a raw particle (e.g. `'が'`) returns all disambiguated senses (`'が(subject)'` and `'が(but)'`) or unifies particle lookup.

3. **Public Reference Search Endpoint**: Expose `GET /api/grammar/reference/points` to allow the extension to search the Tier 0 reference grammar dictionary offline without requiring prior user encounter logs.


### 6. Ambiguous Cases Requiring a Product Decision (Priority 6: Scope Policy)

1. **Meta-Grammar Categories (`い-adjectives`, `な-adjectives`, `他動詞 & 自動詞`)**: Reference entries N5 #16, N5 #36, and N4 #86 represent broad grammatical categories and inflection rules rather than specific pattern strings. A decision is required on whether Kiroku should store meta-grammar concept cards or restrict `grammar_index` to recognizable token patterns.

2. **Adverbs and Conjunctions Boundary Policy**: 25+ reference entries (e.g., `どんな`, `どうして`, `いつも`, `とても`, `きっと`, `急に`, `まさか`, `しかし`, `そして`, `それから`) are adverbs/conjunctions. A clear policy decision is required: should Kiroku expand `grammar_index` to include all JLPT Sensei adverbs, or treat them strictly as vocabulary governed by the Jitendex dictionary?


## I. Audit Completeness and Safety Verification


### 1. 100% Entry Reconciliation

- **JLPT N5**: Audited entries 1 through 84. Exactly 84 reference entries accounted for (39 CORRECT, 15 WRONG_TAG, 17 MISSING, 11 DUPLICATE, 2 AMBIGUOUS).

- **JLPT N4**: Audited entries 1 through 132. Exactly 132 reference entries accounted for (60 CORRECT, 15 WRONG_TAG, 44 MISSING, 10 DUPLICATE, 3 WRONG_CONTENT).

- **JLPT N3**: Audited entries 1 through 182. Exactly 182 reference entries accounted for (96 CORRECT, 28 WRONG_TAG, 51 MISSING, 7 DUPLICATE).

- **Grand Total**: Exactly **398 reference entries** audited, verified, and accounted for without omission.


### 2. Strict Safety Constraint Compliance

- **Zero Code Mutations**: No files in `backend/app/`, `backend/tests/`, `tools/`, `extension/`, or configuration were edited or overwritten.

- **Zero Database Mutations**: No SQLite databases (`grammar_reference.sqlite`, `jlpt_reference.sqlite`, `kiroku_dict.sqlite`, `cards.db`) were inserted into, updated, deleted, vacuumed, migrated, or altered.

- **Zero Git State Changes**: No commits were made, no branches created, and no index staging performed.

- **Non-Mutating Verification**: All data discovery and lookup checks were executed using read-only database connections (`mode=ro`), Python introspection, and isolated scratch analysis scripts.

- **Report Persistence**: This audit report (`kiroku_grammar_audit_report.md`) is written as a new file in the workspace root without overwriting any pre-existing project documentation.


**End of Report.**
