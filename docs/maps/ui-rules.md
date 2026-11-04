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

## Palette Roles
- `--iron-core`: Code and debug wells.
- `--industrial-aqua`: Grammar clauses, particles, N3 accents.
- `--rust-signal`: Errors, destructive actions, timer < 5min.
- `--heat-marker`: Streak count, progress indicators, hard difficulty badges.
- `--architectural-cream`: Table headers, inactive filter pills.

## FINAL Specifications
- **Bottom Navigation Dock**: 6 items, pill radius 9999px, 1.5px stroke, 4px hard tactile shadow.
- **Kanji Mastery**: Collapsed by default, grid-rows 0fr -> 1fr 220ms bezier transition, limit select options 36/100/all.

## Change Protocol
Any change to FINAL-locked components (Bottom Dock, Kanji Mastery) strictly requires explicit owner confirmation, followed by updating hashes in `desktop/tests/final_lock.hashes.json`.
