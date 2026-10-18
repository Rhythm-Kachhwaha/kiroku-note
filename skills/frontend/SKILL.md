# Frontend Skill

- Build the extension Side Panel with vanilla HTML, CSS, and JavaScript only. Do not add React, Electron, Node.js runtime code, or unnecessary abstractions.
- Read `DESIGN.md` before UI work. The panel is dark, narrow (about 400–600px), keyboard-first, minimal, and utility-like; use the design system's typography, spacing, restrained warm/coral accents, modest radii, and low-chrome discipline rather than its cream marketing layouts.
- Keep Japanese expression visually prominent. Avoid gradients, glassmorphism, giant headings, excessive cards/widgets, generic purple/blue AI styling, and gratuitous animation.
- Zero OS emojis: never use raw Unicode/OS emojis in any UI, buttons, tabs, empty states, or badges. Use clean, accessible inline vector SVG icons exclusively.
- Keep UI state local and explicit. Request provider-neutral drafts from FastAPI; never embed JLPT logic or call Yomitan/AnkiConnect directly.
- Preserve shortcuts: Ctrl/Cmd+Enter add, Ctrl/Cmd+K word focus, Ctrl/Cmd+Shift+M meaning focus, Esc closes optional fields, unless a documented implementation reason changes them.
- Keep the Side Panel usable at its narrow width. Prefer simple vertical layouts and progressive disclosure for optional fields; do not solve overflow by making the UI dense or horizontally scrollable.