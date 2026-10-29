# Grammar dictionaries

Kiroku's bundled grammar index (Tier 0) works offline and supplies matching,
JLPT levels, and short English explanations. A designated Yomitan grammar
dictionary (Tier 1) is optional enrichment; it never replaces the local
index and is only queried when a sentence is analyzed.

## Setup

1. Install Yomitan in Chromium/Brave.
2. Import a Japanese grammar dictionary through Yomitan's settings.
3. Open Kiroku **Settings → Grammar Settings**, enter the dictionary name,
   and choose **Test Grammar Setup**.

Open conversion projects and personal grammar notes can be useful sources.
Check the source package's licence and redistribution terms before importing
or sharing a dictionary. Some third-party grammar dictionaries include
vocabulary, idioms, or duplicate entries; Kiroku treats their results as
supporting context rather than authoritative matches.

The basic-particle filter hides standalone particles by default while retaining
compound points. Enable **Show Basic Particles** only when a sentence-level
particle review is desired.

## Matcher data contract

Each row in `grammar_index.matcher` is JSON and is interpreted offline by the
backend. The supported forms are:

- `{"type":"pattern","variants":[...],"match_mode":"auto"}` for literal
  surface variants. `match_mode:"reference_only"` intentionally suppresses
  automatic matching for ambiguous or bare-particle references.
- `{"type":"regex","regex":"..."}` for a controlled regular expression.
  `inflection` may specify one required form: `て`, `た`, `ない`,
  `ます-stem`, `dictionary`, or `plain`; the matcher uses token data when
  available and the regex as the offline fallback.
- `{"type":"discontinuous","first":"...","second":"...","max_gap":20}`
  for two forms in one clause. `guards` can require or forbid preceding or
  following forms and can set `minimum_sentence_context`.

Optional `variants`, `guards`, `ambiguity_group`, `confidence`, and
`matched_formation` fields are data-only metadata; they never replace the
bundled Tier 0 point.
