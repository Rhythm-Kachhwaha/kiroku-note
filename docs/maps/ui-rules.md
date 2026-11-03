# UI rules

This is the only active UI design reference. Use existing tokens:
`--pure-black`, `--ink-black`, `--ink-surface`, `--elevated-surface`,
`--warm-paper`, `--tactile-stroke`, `--vermilion`, `--alpine-berry`,
`--organza-peach`, `--jade`, and `--amber`.

FINAL: Bottom Navigation Dock, including its sliding pill, and Kanji Mastery.
Their markup, layout, colors, geometry, and animation timing are locked. Do not
add dock items. New screens open from existing screens.

Use existing `--ease-*` tokens. Honor `prefers-reduced-motion`. Keep every
animation; performance changes may alter its driver only. No emoji: use
accessible SVG icons or plain text. Do not put micro-tags in buttons or
headings. Badges represent actual metadata only.

Load a design, animation, or visual-review skill only for an explicitly
requested design, animation, or UI-polish task.
