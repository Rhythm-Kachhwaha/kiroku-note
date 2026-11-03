# UI rules

Use established CSS tokens. Core palette: `--pure-black` #000000,
`--ink-black` #141311, `--ink-surface` #1C1B19,
`--elevated-surface` #2A2926, `--warm-paper` #F5F1E8,
`--tactile-stroke` #151413, `--vermilion` #D94B38,
`--alpine-berry` #F7E0BA, `--organza-peach` #FBEEDA,
`--jade` #4EBB7B, and `--amber` #F59E0B.

FINAL: Kanji Mastery section and Bottom Navigation Dock, including sliding pill.
Do not change their markup, layout, colors, geometry, or animation timing.

Use existing `--ease-*` motion tokens. Honor `prefers-reduced-motion`. Keep
existing animations; performance work may change their driver, not remove them.
No emoji. Use accessible SVG icons or plain text. Do not add micro-tags inside
action buttons or headers; badges are only for real data metadata.

Use design, animation, or visual-review skills only when the task explicitly
asks for design, animation, or UI polish.
