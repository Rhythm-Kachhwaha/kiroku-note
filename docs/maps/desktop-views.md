# Desktop views

Desktop UI lives in `desktop/src/ui/`; views live in `desktop/src/ui/views/` and share the shell. Reuse validated vanilla web UI with desktop overrides focused on Quick Add and History. Keep SQLite authoritative and preserve simultaneous browser-extension access.

The Bottom Dock and Kanji Mastery section are FINAL. Do not change their markup, layout, colors, or animation timing. Screens must be reached from existing screens rather than by adding dock items.

Use only named desktop tests: `node --test desktop/tests/<name>.test.js`.
