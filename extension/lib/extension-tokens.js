/**
 * Kiroku Note - Extension Design Tokens & Tactile Physics
 * Source of Truth: Sumi & Washi Neo-Tactile Design System (tokens.css & final.md)
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.KirokuTokens = exports;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EXTENSION_TOKENS_CSS = `
    :host, .kiroku-theme {
      --ink-black: #141311;
      --pure-black: #09090b;
      --warm-paper: #F5F1E8;
      --vermilion: #D94B38;
      --vermilion-hover: #C53E2D;
      --vermilion-active: #B33424;
      --ink-surface: #18181b;
      --elevated-surface: #27272a;
      --tactile-stroke: rgba(255, 255, 255, 0.16);
      --tactile-shadow-color: rgba(0, 0, 0, 0.6);
      --alpine-berry: #F7E0BA;
      --heat-marker: #F39120;
      --industrial-aqua: #4FBBBC;
      --grammar-purple: #818CF8;
      --jade: #4EBB7B;
      --amber: #F59E0B;
      --text-primary: #F4F4F5;
      --text-secondary: #A1A1AA;
      --text-muted: #71717A;

      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-japanese: "Zen Kaku Gothic New", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-kanji: "Noto Sans JP", -apple-system, sans-serif;
      --font-badge: "Mochiy Pop One", "Zen Kaku Gothic New", sans-serif;

      --duration-fast: 180ms;
      --spring-snappy: cubic-bezier(0.34, 1.56, 0.64, 1);
      --spring-smooth: cubic-bezier(0.16, 1, 0.3, 1);
    }

    .kiroku-tactile-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: var(--font-sans);
      font-weight: 600;
      border: 1px solid var(--tactile-stroke);
      border-radius: 6px;
      box-shadow: 2px 2px 0 var(--tactile-shadow-color);
      transition: transform var(--duration-fast) var(--spring-snappy),
                  box-shadow var(--duration-fast) var(--spring-snappy),
                  background-color var(--duration-fast) ease;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }

    .kiroku-tactile-btn:hover {
      transform: translate(-1px, -1px);
      box-shadow: 3px 3px 0 var(--tactile-shadow-color);
    }

    .kiroku-tactile-btn:active {
      transform: translate(2px, 2px);
      box-shadow: 0 0 0 var(--tactile-shadow-color);
    }

    .kiroku-badge-pill {
      font-family: var(--font-badge);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--tactile-stroke);
      box-shadow: 1px 1px 0 var(--tactile-shadow-color);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  `;

  return {
    EXTENSION_TOKENS_CSS,
    colors: {
      pureBlack: "#09090b",
      warmPaper: "#F5F1E8",
      vermilion: "#D94B38",
      inkSurface: "#18181b",
      elevatedSurface: "#27272a",
      tactileStroke: "rgba(255, 255, 255, 0.16)",
      grammarPurple: "#818CF8",
      jade: "#4EBB7B",
      heatMarker: "#F39120"
    }
  };
});
