# Kiroku Note Desktop — Motion & Animation Inventory

This inventory documents all transitions, `@keyframes`, spring curves, and interactive animations specified in the Stitch designs (`docs/design/stitch-export/`) and `spec.md`, their implementation status in the desktop app, and notes on deferred complex polish per project directives.

## Motion Inventory Table

| Animation / Interaction | Source File & Spec Reference | CSS / Easing Curve | Implemented in Desktop | Implementation / Deferral Notes |
|-------------------------|------------------------------|--------------------|------------------------|---------------------------------|
| **Tactile Button Press** | `tactile-press:active`, `spec.md §4.A` | `translate(2px, 2px)`, shadow `1px 1px 0 #151413`, `75ms cubic-bezier(0.2, 0, 0, 1)` | **YES** | Implemented in `tactile.css` (`.tactile-btn:active`, `.tactile-pill:active`, `.choice-card:active`). |
| **Settings Gear Rotation** | `settings-rotate`, `spec.md §4.A` | `rotate(45deg)`, `0.35s cubic-bezier(0.34, 1.56, 0.64, 1)` | **YES** | Implemented in `top_chrome.css` (`.chrome-icon-btn:hover svg`). |
| **History Icon Hover** | `vocab/card-history-inventory` | `rotate(-15deg)`, `0.2s ease` | **YES** | Implemented in `top_chrome.css` (`#chrome-btn-history:hover svg`). |
| **Tab View Transitions** | `tab-pane`, `bundle.css` | `0.35s cubic-bezier(0.16, 1, 0.3, 1)` cross-fade / slide | **YES** | Implemented in `bundle.css` (`@keyframes slide-to-left`, `slide-from-right`, `slide-to-right`, `slide-from-left`). |
| **Timer Warning Pulse** | `test/test-jlpt-n3-live-simulation` | `@keyframes timer-pulse`, `1.8s infinite` | **YES** | Implemented in `bundle.css` (`.timer-urgent`, `@keyframes timer-pulse`). |
| **Pop / Badge Bounce** | `study/study-practice-drill` | `@keyframes pop-bounce`, `0.32s cubic-bezier(0.2, 0.9, 0.3, 1)` | **YES** | Implemented in `bundle.css` (`.pop-bounce`, `@keyframes pop-bounce`). |
| **Kanji Stroke Playback** | `kanji/kanji-studio-stroke-order-engine` | SVG `stroke-dasharray` / `stroke-dashoffset` interpolation | **YES** | Implemented in `kanji.js` (`playStrokes()`, `scrub()`) with real KanjiVG vector coordinates from backend. |
| **Purr-Pulse Breathing** | `home/home-canvas-active`, `spec.md §6` | `@keyframes purr-pulse`, `1.8s cubic-bezier(0.34, 1.56, 0.64, 1)` | **DEFERRED (Addendum)** | Documented; subtle SVG mascot breathing is preserved in assets; full spring pulse loop deferred to prioritize real data. |
| **Wave Pop** | `home/home-canvas-active` | `@keyframes wave-pop`, `0.38s cubic-bezier(0.34, 1.56, 0.64, 1)` | **DEFERRED (Addendum)** | Deferred per Addendum instruction ("Animation polish is DEFERRED: keep existing animations, do not delete mascot/lottie assets"). |
| **Staggered Letter-Lift** | `spec.md §4.A` | `translateY(-3px)` staggered `25ms` per letter | **DEFERRED (Addendum)** | Wordmark spans preserved in `top_chrome.js`; full spring stagger deferred per Addendum. |
| **Lottie Body Motion** | `desktop/src/ui/assets/mascot/` | JSON vectors ("Cat typing.json", "rainbow cat.json") | **DEFERRED (Addendum)** | Vendor assets retained intact without deletion. Full lottie-web integration deferred. |
| **Prefers-Reduced-Motion**| WCAG 2.1 AA | `@media (prefers-reduced-motion: reduce)` | **YES** | Fully implemented in `bundle.css` and `tactile.css`, disabling transforms and animations for accessibility. |

## Accessibility & Reduced Motion

All transitions and keyframe animations respect system accessibility settings:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

