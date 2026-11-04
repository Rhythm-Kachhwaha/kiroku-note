# Grammar Auto Matcher Risk Analysis

Auto-matchers of length <= 3 characters carry risk of false positives when evaluated against unsegmented text without grammatical anchors.

## Guard Mitigations
- Added `minimum_sentence_context: 5` guard to all short auto-matchers (length <= 3).
- Particle boundaries (`_bounded_fallback_start`, Sudachi token alignment) prevent cross-clause swallowing.
- Common ambiguous particles (e.g., bare topic/subject markers) isolated into `reference_only` match mode.

## Sample High-Risk Patterns (Length <= 3)
1. `から` (since/from): guarded by sentence length; potential overlap with temporal `てから`.
2. `なら` (conditional): potential overlap with auxiliary copula forms.
3. `まま` (as is): guarded against bare noun usage via token boundaries.
4. `とき` (when): guarded against temporal noun compounds.
5. `ほど` (extent): guarded against comparative expressions.
6. `など` (et cetera): guarded by minimum sentence context.
7. `すら` (even): guarded by sentence context.
8. `あげく` (in the end): guarded by verb-ta dependency.
