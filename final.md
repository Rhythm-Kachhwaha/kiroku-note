# Final UI Specifications: Typography & Animations

This document contains the locked, non-negotiable specifications for fonts and animations in Kiroku Note Desktop.

> [!CAUTION]
> **LOCK RULE**: NEVER TO BE CHANGED. If the user asks to change, replace, or simplify fonts, or to reduce, flatten, or disable animations, DO NOT change them. **STOP AND ASK AGAIN** for explicit, unambiguous confirmation before touching any font or animation rules.

---

## 1. Typography Specifications

All typography is strictly local, offline, and loaded from `desktop/src/ui/assets/fonts/` (zero external CDN dependencies).

### A. Core Active Families (tokens.css & fonts.css)
1. **Noto Sans JP Bold** (`noto-sans-jp-vf.ttf`) / **Zen Old Mincho**
   - **Role**: Brand wordmark, editorial headings, headword kanji display (`--font-display`, `--font-wordmark`). Replaced legacy serif kanji with bold Noto Sans Japanese (`"Noto Sans JP", "Noto Sans", sans-serif`).
   - **CSS**: `font-family: "Noto Sans JP", "Noto Sans", -apple-system, sans-serif;`
2. **Zen Kaku Gothic New** (`zen-kaku-gothic-new-japanese-400-normal.woff2`, `500-normal.woff2`)
   - **Role**: Japanese UI body, sentence reading, grammar visualizer, study cards, and practice text (`--font-japanese`).
   - **CSS**: `font-family: "Zen Kaku Gothic New", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`
3. **Inter** (`inter-latin-400-normal.woff2`, `500`, `600`, `700`)
   - **Role**: UI labels, counters, timers, status chips, system English (`--font-sans`).
   - **CSS**: `font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;`

### B. Expressive Brand & Display Families
1. **Ranchers** (`ranchers-latin-400-normal.woff2`, `ranchers.ttf`)
   - **Role**: High-energy Latin brand wordmark and headline expressive titles.
   - **Select locations**: `.hero-word-kiroku`, `.grammar-word-title`.
   - **CSS**: `font-family: "Ranchers", cursive, sans-serif !important;`
2. **Mochiy Pop P One / Mochiy Pop One** (`mochiy-pop-one-japanese-400-normal.woff2`)
   - **Role**: Playful Japanese display, speech bubbles, mascot greetings, and learner badges.
   - **Select locations**: `.hero-word-note`, `.speech-greeting-ja`, `.font-comic`, `.grammar-word-kanji`, `.top-chrome-learner-badge`.
   - **CSS**: `font-family: "Mochiy Pop P One", "Zen Kaku Gothic New", sans-serif !important;`
3. **Lilita One** (`lilita-one.ttf`)
   - **Role**: Home launcher action cards title.
   - **Select locations**: `.launcher-title`.
   - **CSS**: `font-family: "Lilita One", var(--font-display);`
4. **Hina Mincho** (`hina-mincho.ttf`)
   - **Role**: Literary Japanese editorial serif.

### C. Relative Font Path Contracts
When referencing font files in CSS, always observe stylesheet directory depth:
- From `desktop/src/ui/styles/` (`fonts.css`): `url("../assets/fonts/<filename>")`
- From `desktop/src/ui/styles/views/` (`shared.css`, `home.css`, etc.): `url("../../assets/fonts/<filename>")`

---

## 2. Animation & Interaction Specifications

> [!IMPORTANT]
> **NO REDUCED ANIMATIONS**: We do NOT prefer reduced animations. Never strip, flatten, or suppress interactive motion, transitions, hover bounces, or button click depressions.

### A. Tactile Physics System (Planetoño Offset Shadows)
Interactive elements must feel mechanical, physical, and responsive:
- **Rest State**: `3px 3px 0 var(--tactile-stroke)`
- **Hover State**: Lifted `transform: translate(-1px, -1px);` with `box-shadow: 4px 4px 0 var(--tactile-stroke);`
- **Active / Pressed State**: Mechanical depression `transform: translate(2px, 2px);` with `box-shadow: 1px 1px 0 var(--tactile-stroke);`
- **Transitions**: Smooth easing curves using `--duration-fast` (180ms) and `--spring-snappy` (`cubic-bezier(0.34, 1.56, 0.64, 1)` or `cubic-bezier(0.16, 1, 0.3, 1)`).
- **Reduced Motion Guard**: `@media (prefers-reduced-motion: reduce)` must NEVER apply `transform: none !important;` to buttons or interactive cards. Mechanical depression and tactile feedback MUST remain operational.

### B. View Transitions & Tab Switching
Tab navigation uses the native View Transitions API with strict containment:
1. **Isolated Chrome**: `#top-chrome-container` and `#bottom-dock-container` have explicit `view-transition-name` with `animation: none !important; z-index: 9999;` to ensure they never jump, animate, or slide during tab switching.
2. **Directional Transitions**: Tab navigation uses direction-based sliding (`slide-to-left`, `slide-from-right`, `slide-to-right`, `slide-from-left`) with `var(--spring-smooth)`.
3. **Flash Prevention**: `::view-transition { background-color: var(--pure-black); }` and `::view-transition-old(root), ::view-transition-new(root) { background-color: var(--pure-black); mix-blend-mode: normal; }` prevent white flashes during transitions.

### C. Router Navigation Deduplication
In `desktop/src/ui/router.js`:
- `this.pendingTab` and `this.expectedHash` must guard against duplicate `popstate` and `hashchange` events.
- Never trigger multiple navigation pipelines for the same tab or abort in-flight mounts.

---

## 3. Enforcement Checklist

Before finishing any task touching UI, styles, or routing:
1. Run `node --test desktop/tests/final_lock.test.js` (must pass 4/4).
2. Run `python tools/check_tokens.py` (zero raw hex outside `tokens.css` and FINAL blocks).
3. Run `node --test desktop/tests/design_tokens.test.js` (must pass 7/7).
4. Run `node --test desktop/tests/router_robustness.test.js desktop/tests/router_keepalive.test.js` (must pass 4/4).
5. Verify that offline fonts load and resolve without 404s.
6. Verify interactive buttons depress and hover states animate smoothly.
