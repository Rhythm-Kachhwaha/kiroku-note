/**
 * Kiroku Note - Unified In-Page Shadow DOM Popup & Mine Engine
 *
 * Responsibilities:
 * - Isolated Shadow-DOM floating card for Web Text, Video Subtitles, and OCR
 * - Dual tabs: Word (definitions, reading, status) & Grammar (pattern breakdown, rules)
 * - 1-Click Mine Word / Mine Grammar triggering HUD_MINE with KirokuToast feedback
 * - Planetoño tactile button physics (mechanical depression translate(2px, 2px))
 * - LRU lookup cache for instant dictionary responses
 * - Clamps dynamically to viewport bounds; Esc to dismiss, Alt+M to quick-mine
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HudPopup = exports.HudPopup;
    root.lookupCache = exports.lookupCache;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class SimpleLRU {
    constructor(limit = 250) {
      this.limit = limit;
      this.map = new Map();
    }
    has(key) {
      return this.map.has(key);
    }
    get(key) {
      if (!this.map.has(key)) return null;
      const val = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, val);
      return val;
    }
    set(key, val) {
      if (this.map.has(key)) this.map.delete(key);
      else if (this.map.size >= this.limit) {
        const first = this.map.keys().next().value;
        this.map.delete(first);
      }
      this.map.set(key, val);
    }
  }

  const lookupCache = new SimpleLRU(250);
  const grammarCache = new SimpleLRU(100);
  const sentenceTokensCache = new SimpleLRU(100);

  class HudPopup {
    constructor(hudHost = null, hudState = null) {
      this.hudHost = hudHost;
      this.hudState = hudState;
      this.hostEl = null;
      this.shadow = null;
      this.popupEl = null;
      this.currentTargetToken = null;
      this.currentTargetSpan = null;
      this.activeCue = null;
      this.activeContextSentence = "";
      this.fixedAnchorPoint = null; // { x, y } for text selection or OCR
      this.isOpen = false;
      this.isMining = false;
      this.activeTab = "word"; // 'word' | 'grammar'
      this.grammarData = null;

      this._userDragged = false;
      this._isDragging = false;
      this._dragStartX = 0;
      this._dragStartY = 0;
      this._dragStartLeft = 0;
      this._dragStartTop = 0;
      this._boundDragStart = this._onDragStart.bind(this);
      this._boundDragMove = this._onDragMove.bind(this);
      this._boundDragEnd = this._onDragEnd.bind(this);

      this._boundDocKeyDown = this._onDocKeyDown.bind(this);
      this._boundDocClick = this._onDocClick.bind(this);
      this._boundReposition = this.reposition.bind(this);

      this.init();
    }

    init() {
      if (typeof document === "undefined") return;

      if (this.hudHost?.contentContainer) {
        // Mounted inside video HUD host
        const existingStyle = this.hudHost.contentContainer.querySelector?.("#kiroku-hud-popup-styles");
        if (!existingStyle) {
          const style = document.createElement("style");
          style.id = "kiroku-hud-popup-styles";
          style.textContent = this._getStyleSheet();
          this.hudHost.contentContainer.appendChild(style);
        }
        this.popupEl = document.createElement("div");
        this.popupEl.className = "kiroku-hud-popup";
        this.hudHost.contentContainer.appendChild(this.popupEl);
      } else {
        // Standalone in-page host (Shadow DOM) for web text and OCR
        this.hostEl = document.createElement("div");
        this.hostEl.id = "kiroku-standalone-popup-host";
        this.hostEl.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          z-index: 2147483647;
          pointer-events: none;
        `;
        try {
          this.shadow = this.hostEl.attachShadow({ mode: "open" });
        } catch (_) {
          this.shadow = this.hostEl;
        }

        const style = document.createElement("style");
        style.textContent = this._getStyleSheet();
        this.shadow.appendChild(style);

        this.popupEl = document.createElement("div");
        this.popupEl.className = "kiroku-hud-popup";
        this.shadow.appendChild(this.popupEl);
        document.body.appendChild(this.hostEl);
      }

      this._applyPopupStyles();

      // Stop propagation so video play/pause or web page clicks don't swallow popup clicks
      const stopEvent = (e) => {
        if (e && typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      };
      this.popupEl.addEventListener("pointerdown", stopEvent);
      this.popupEl.addEventListener("mousedown", stopEvent);
      this.popupEl.addEventListener("click", stopEvent);
      this.popupEl.addEventListener("dblclick", stopEvent);

      document.addEventListener("keydown", this._boundDocKeyDown, true);
      document.addEventListener("pointerdown", this._boundDocClick);
      window.addEventListener("resize", this._boundReposition);

      if (this.hudState && typeof this.hudState.subscribe === "function") {
        this._unsubState = this.hudState.subscribe((state) => {
          if (this.isOpen && this.activeCue && state.activeCue && state.activeCue !== this.activeCue) {
            this.close();
          }
        });
      }

      if (this.hudHost) {
        this.hudHost.registerCleanup(() => this.destroy());
      }
    }

    _getStyleSheet() {
      return `
        :host, .kiroku-hud-popup {
          --nb-void: #000000;
          --nb-ground: #141311;
          --nb-surface: #1C1B19;
          --nb-surface-2: #262522;
          --nb-surface-3: #33312D;
          --nb-well: #100F0E;
          --nb-paper: #F0ECE3;
          --nb-cream: #C9C3B8;
          --nb-muted: #8E8A81;
          --nb-border: #32302C;
          --nb-border-strong: #46433D;
          --nb-stroke: #000000;
          --nb-vermilion: #D94B38;
          --nb-vermilion-hover: #E55A47;
          --nb-vermilion-active: #B83A2A;
          --nb-jade: #4EBB7B;
          --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-japanese: "Zen Kaku Gothic New", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-kanji: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, Menlo, monospace;
        }

        .kiroku-hud-popup {
          position: fixed;
          display: none;
          flex-direction: column;
          gap: 12px;
          min-width: 318px;
          max-width: 380px;
          padding: 14px;
          background-color: var(--nb-surface);
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
          background-size: 20px 20px;
          border: 3px solid var(--nb-stroke);
          outline: 1px solid var(--nb-border);
          outline-offset: -4px;
          border-radius: 2px;
          box-shadow: 7px 7px 0 var(--nb-stroke);
          color: var(--nb-paper);
          font-family: var(--font-sans);
          font-size: 13px;
          z-index: 2147483647;
          pointer-events: auto;
          box-sizing: border-box;
          user-select: text;
        }

        .kiroku-hud-popup * {
          box-sizing: border-box;
        }

        .kiroku-hud-popup button {
          box-sizing: border-box;
          font-family: inherit;
          margin: 0;
          outline: none;
          border-radius: 2px;
          user-select: none;
          -webkit-user-select: none;
        }

        /* Header Bar */
        .hud-popup-tabs {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          border-bottom: 2px solid var(--nb-border);
          padding-bottom: 10px;
          cursor: grab;
          user-select: none;
        }

        .hud-popup-tabs:active {
          cursor: grabbing;
        }

        .hud-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .hud-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .hud-inspector-header {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          background: var(--nb-surface-2);
          color: var(--nb-muted);
          border: 2px solid var(--nb-stroke);
          box-shadow: 2px 2px 0 var(--nb-stroke);
          cursor: grab;
          flex-shrink: 0;
          transition: background-color 140ms ease, color 140ms ease;
        }

        .hud-inspector-header:hover {
          background: var(--nb-surface-3);
          color: var(--nb-paper);
        }

        .hud-tabs-segmented {
          display: inline-flex;
          align-items: center;
          background: var(--nb-well);
          border: 2px solid var(--nb-stroke);
          border-radius: 2px;
          padding: 0;
          gap: 0;
          box-shadow: 3px 3px 0 var(--nb-stroke);
        }

        .hud-tab-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--nb-surface-2);
          border: none;
          border-right: 2px solid var(--nb-stroke);
          padding: 5px 12px;
          border-radius: 0;
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--nb-cream);
          cursor: pointer;
          transition: background-color 140ms ease, color 140ms ease;
        }

        .hud-tab-btn:last-child {
          border-right: none;
        }

        .hud-tab-btn.is-active {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
          font-weight: 900;
        }

        .hud-tab-btn:hover:not(.is-active) {
          background: var(--nb-surface-3);
          color: var(--nb-paper);
        }

        .hud-action-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 2px;
          background: var(--nb-surface-2);
          border: 2px solid var(--nb-stroke);
          color: var(--nb-cream);
          box-shadow: 2px 2px 0 var(--nb-stroke);
          cursor: pointer;
          transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, color 140ms ease, border-color 140ms ease;
        }

        .hud-action-icon-btn:hover {
          background: var(--nb-surface-3);
          color: var(--nb-paper);
          border-color: var(--nb-vermilion);
          transform: translate(-1.5px, -1.5px);
          box-shadow: 4px 4px 0 var(--nb-stroke);
        }

        .hud-action-icon-btn.hud-popup-close-btn:hover {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
          border-color: var(--nb-stroke);
        }

        .hud-action-icon-btn:active {
          transform: translate(1.5px, 1.5px);
          box-shadow: 1px 1px 0 var(--nb-stroke);
        }

        /* Word Hero Display */
        .hud-word-hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }

        .hud-word-header {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .hud-headword-kanji {
          font-family: var(--font-kanji);
          font-size: 28px;
          font-weight: 900;
          color: var(--nb-vermilion);
          line-height: 1.15;
          letter-spacing: -0.02em;
          word-break: break-word;
        }

        .hud-surface-parens {
          font-size: 13px;
          font-weight: 700;
          color: var(--nb-muted);
          margin-left: 6px;
        }

        .hud-reading-furigana {
          font-family: var(--font-japanese);
          font-size: 13px;
          font-weight: 700;
          color: var(--nb-cream);
          letter-spacing: 0.04em;
        }

        .hud-badge-jlpt {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 2px;
          border: 2px solid var(--nb-stroke);
          box-shadow: 3px 3px 0 var(--nb-stroke);
          background: var(--nb-surface-2);
          color: var(--nb-cream);
          flex-shrink: 0;
        }

        .hud-badge-jlpt.is-mined {
          background: var(--nb-jade);
          color: #0B0A09;
          border-color: var(--nb-stroke);
        }

        /* Meaning Block */
        .hud-popup-meaning {
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.5;
          color: var(--nb-paper);
          max-height: 135px;
          overflow-y: auto;
          padding-bottom: 10px;
          padding-right: 4px;
          border-bottom: 2px solid var(--nb-border);
        }

        .hud-meaning-line {
          margin-bottom: 4px;
        }

        .hud-meaning-idx {
          font-family: var(--font-mono);
          color: var(--nb-vermilion);
          font-weight: 800;
          margin-right: 6px;
        }

        /* Context Sentence Sub-Box */
        .hud-context-box {
          background: var(--nb-well);
          border: 2px solid var(--nb-border);
          box-shadow: 3px 3px 0 var(--nb-stroke);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .hud-context-caption {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--nb-muted);
        }

        .hud-sentence-words-box {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 3px;
          font-family: var(--font-japanese);
          font-size: 14px;
          font-weight: 600;
          line-height: 1.5;
          user-select: none;
        }

        .hud-sentence-word-token {
          display: inline-flex;
          align-items: center;
          padding: 1px 4px;
          border-radius: 2px;
          cursor: pointer;
          color: var(--nb-paper);
          transition: background-color 120ms ease, color 120ms ease;
        }

        .hud-sentence-word-token:hover:not(.is-active) {
          background: var(--nb-surface-3);
          color: var(--nb-paper);
        }

        .hud-sentence-word-token.is-active {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
          font-weight: 800;
          padding: 1px 5px;
        }

        /* Neo-Brutalist Action Stack — Dark Borders + Hard Black Shadows + Anime Review Hover Physics */
        .hud-actions-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 2px;
        }

        .hud-status-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .hud-status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 8px 10px;
          background: var(--nb-surface-2);
          color: var(--nb-paper);
          border: 2px solid var(--nb-stroke);
          border-radius: 2px;
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 4px 4px 0 var(--nb-stroke);
          transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, color 140ms ease;
        }

        .hud-status-pill:hover {
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0 var(--nb-stroke);
        }

        .hud-status-pill:active {
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0 var(--nb-stroke);
        }

        .hud-status-pill.hud-btn-known:hover,
        .hud-status-pill.hud-btn-known.is-active-known {
          background: var(--nb-jade);
          color: #0B0A09;
          border-color: var(--nb-stroke);
        }

        .hud-status-pill.hud-btn-unknown:hover,
        .hud-status-pill.hud-btn-unknown.is-active-unknown {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
          border-color: var(--nb-stroke);
        }

        .tactile-btn,
        .hud-popup-mine-btn,
        .hud-grammar-mine-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          width: 100%;
          padding: 9px 14px;
          font-family: var(--font-sans);
          font-size: 12.5px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          border-radius: 2px;
          border: 2.5px solid var(--nb-stroke);
          box-shadow: 4px 4px 0 var(--nb-stroke);
          cursor: pointer;
          transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, color 140ms ease;
        }

        .hud-popup-mine-btn {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
        }

        .hud-popup-mine-btn:hover:not(:disabled) {
          background: var(--nb-vermilion-hover);
          color: var(--nb-paper);
          border-color: var(--nb-stroke);
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0 var(--nb-stroke);
        }

        .hud-popup-mine-btn:active:not(:disabled) {
          background: var(--nb-vermilion-active);
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0 var(--nb-stroke);
        }

        .hud-popup-mine-btn.is-saved,
        .hud-popup-mine-btn:disabled {
          background: var(--nb-jade);
          color: #0B0A09;
          cursor: default;
          transform: none;
          box-shadow: 3px 3px 0 var(--nb-stroke);
        }

        .hud-grammar-mine-btn {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
        }

        .hud-grammar-mine-btn:hover:not(:disabled) {
          background: var(--nb-vermilion-hover);
          color: var(--nb-paper);
          border-color: var(--nb-stroke);
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0 var(--nb-stroke);
        }

        .hud-grammar-mine-btn:active:not(:disabled) {
          background: var(--nb-vermilion-active);
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0 var(--nb-stroke);
        }

        .hud-shortcuts-footer {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 700;
          color: var(--nb-muted);
          text-align: center;
          letter-spacing: 0.03em;
          padding-top: 2px;
        }

        /* Grammar Pane */
        .hud-grammar-content {
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--nb-paper);
          max-height: 260px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .hud-grammar-empty {
          color: var(--nb-muted);
          font-size: 12px;
        }

        .hud-grammar-error {
          color: var(--nb-vermilion);
          font-size: 12px;
          font-weight: 700;
        }

        .hud-grammar-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .hud-grammar-card {
          background: var(--nb-well);
          border: 2px solid var(--nb-border);
          border-left: 4px solid var(--nb-vermilion);
          border-radius: 2px;
          box-shadow: 4px 4px 0 var(--nb-stroke);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: opacity 160ms ease, transform 160ms ease;
        }

        .hud-grammar-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .hud-grammar-title {
          font-family: var(--font-japanese);
          font-size: 16px;
          font-weight: 900;
          color: var(--nb-vermilion);
        }

        .hud-grammar-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .hud-grammar-level {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          padding: 2px 6px;
          background: var(--nb-surface-2);
          color: var(--nb-cream);
          border: 1.5px solid var(--nb-stroke);
          box-shadow: 2px 2px 0 var(--nb-stroke);
        }

        .hud-grammar-dismiss-btn {
          background: var(--nb-surface-2);
          border: 1.5px solid var(--nb-stroke);
          color: var(--nb-cream);
          border-radius: 2px;
          width: 20px;
          height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
          padding: 0;
          transition: background-color 120ms ease, color 120ms ease;
        }

        .hud-grammar-dismiss-btn:hover {
          background: var(--nb-vermilion);
          color: var(--nb-paper);
        }

        .hud-grammar-meaning {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--nb-paper);
          line-height: 1.45;
        }

        .hud-grammar-formation {
          font-family: var(--font-japanese);
          font-size: 11px;
          font-weight: 700;
          background: var(--nb-surface);
          color: var(--nb-cream);
          border: 1.5px solid var(--nb-border);
          padding: 4px 8px;
        }

        .hud-grammar-example {
          font-family: var(--font-japanese);
          font-size: 11.5px;
          color: var(--nb-cream);
          border-left: 2px solid var(--nb-border-strong);
          padding-left: 8px;
        }
      `;
    }

    _applyPopupStyles() {
      if (!this.popupEl) return;
      this.popupEl.style.cssText = `
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 12px;
        min-width: 318px;
        max-width: 380px;
        padding: 14px;
        background-color: #1C1B19;
        background-image: linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
        background-size: 20px 20px;
        border: 3px solid #000000;
        outline: 1px solid #32302C;
        outline-offset: -4px;
        border-radius: 2px;
        box-shadow: 7px 7px 0 #000000;
        color: #F0ECE3;
        font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        pointer-events: auto;
        box-sizing: border-box;
      `;
    }

    setCue(cue) {
      if (this.isOpen && this.activeCue && cue && (cue !== this.activeCue && cue.text !== this.activeCue.text)) {
        this.close();
      }
      this.activeCue = cue;
      if (cue?.text) this.activeContextSentence = cue.text;
    }

    _onDocKeyDown(e) {
      if (!this.isOpen) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
        return;
      }
      if (e.altKey && (e.key.toLowerCase() === "m" || e.code === "KeyM")) {
        e.preventDefault();
        e.stopPropagation();
        if (this.activeTab === "grammar") {
          this.mineCurrentGrammar();
        } else {
          this.mineCurrentWord();
        }
      }
    }

    _onDocClick(e) {
      if (!this.isOpen || !this.popupEl) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.includes(this.popupEl) || path.includes(this.hostEl)) return;
      if (this.hostEl && (this.hostEl === e.target || this.hostEl.contains(e.target))) return;
      if (this.currentTargetSpan && (this.currentTargetSpan.contains(e.target) || path.includes(this.currentTargetSpan))) return;
      if (this.popupEl.contains(e.target)) return;
      this.close();
    }

    async showForToken(token, targetSpan, cue = null, contextSentence = "") {
      if (!token) return;
      this._userDragged = false;
      const sent = contextSentence || cue?.text || "";
      const tokensList = cue?.tokens || sentenceTokensCache.get(sent) || [];
      if ((!token.lemma || token.lemma === token.surface) && tokensList.length > 0) {
        const match = tokensList.find(t => t.surface === token.surface);
        if (match?.lemma) {
          token = { ...token, lemma: match.lemma, reading: token.reading || match.reading };
        }
      }
      this.currentTargetToken = token;
      this.currentTargetSpan = targetSpan || null;
      this.fixedAnchorPoint = null;
      this.activeCue = cue;
      this.activeContextSentence = sent;
      this.isOpen = true;
      this.activeTab = "word";
      this.render();
      this.reposition();
    }

    async showAtPoint(x, y, token, contextSentence = "") {
      if (!token) return;
      this._userDragged = false;
      const sent = contextSentence || "";
      const tokensList = sentenceTokensCache.get(sent) || [];
      if ((!token.lemma || token.lemma === token.surface) && tokensList.length > 0) {
        const match = tokensList.find(t => t.surface === token.surface);
        if (match?.lemma) {
          token = { ...token, lemma: match.lemma, reading: token.reading || match.reading };
        }
      }
      this.currentTargetToken = token;
      this.currentTargetSpan = null;
      this.fixedAnchorPoint = { x, y };
      this.activeCue = null;
      this.activeContextSentence = sent;
      this.isOpen = true;
      this.activeTab = "word";
      this.render();
      this.reposition();
    }

    tokenizeSentence(sentence) {
      if (!sentence || typeof sentence !== "string") return [];
      const text = sentence.trim();
      if (!text) return [];
      if (sentenceTokensCache.has(text)) {
        return sentenceTokensCache.get(text);
      }
      if (this.activeCue && (this.activeCue.text === text || this.activeCue.text === sentence) && Array.isArray(this.activeCue.tokens) && this.activeCue.tokens.length > 0) {
        return this.activeCue.tokens;
      }
      this._fetchSudachiTokens(text);
      return [{
        surface: text,
        lemma: text,
        text: text,
        reading: "",
        status: "unstyled"
      }];
    }

    _fetchSudachiTokens(sentence) {
      if (!sentence || sentenceTokensCache.has(sentence)) return;
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "TOKENIZE_SENTENCE", text: sentence }).then((resp) => {
          if (resp?.ok && Array.isArray(resp.tokens) && resp.tokens.length > 0) {
            const cleanTokens = resp.tokens.map(t => ({
              surface: t.surface,
              lemma: t.lemma || t.surface,
              reading: t.reading || "",
              status: t.status || "unstyled",
              jlpt_level: t.jlpt_level || ""
            })).filter(t => t.surface && t.surface.trim().length > 0);
            sentenceTokensCache.set(sentence, cleanTokens);
            if (this.isOpen && (this.activeContextSentence === sentence || this.activeCue?.text === sentence)) {
              const box = this.popupEl?.querySelector(".hud-sentence-words-box");
              if (box) {
                const activeSurface = this.currentTargetToken?.surface || "";
                box.innerHTML = cleanTokens.map((tok, idx) => {
                  const surf = (tok.surface || "").trim();
                  if (!surf) return "";
                  const isActive = surf === activeSurface || tok.lemma === activeSurface;
                  return `<span class="hud-sentence-word-token ${isActive ? "is-active" : ""}" data-surface="${escapeHtml(surf)}" data-idx="${idx}" title="Click to inspect">${escapeHtml(surf)}</span>`;
                }).join("");
                box.querySelectorAll(".hud-sentence-word-token").forEach((tokSpan) => {
                  tokSpan.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const clickedSurface = tokSpan.getAttribute("data-surface");
                    if (!clickedSurface) return;
                    const found = cleanTokens.find(t => t.surface === clickedSurface) || {
                      surface: clickedSurface,
                      lemma: clickedSurface,
                      status: "unstyled"
                    };
                    this.currentTargetToken = found;
                    this.render();
                    this.loadWordDetails(found.lemma || clickedSurface);
                  });
                });
              }
            }
          }
        }).catch(() => {});
      }
    }

    _renderSentenceWordsBox(sentence, activeSurface) {
      if (!sentence || typeof sentence !== "string") return "";
      this._fetchSudachiTokens(sentence);
      const tokens = this.tokenizeSentence(sentence);
      if (!tokens || tokens.length === 0) return "";

      const wordsHtml = tokens.map((tok, idx) => {
        const surf = (tok.surface || "").trim();
        if (!surf) return "";
        const isActive = surf === activeSurface || tok.lemma === activeSurface;
        return `<span class="hud-sentence-word-token ${isActive ? "is-active" : ""}" data-surface="${escapeHtml(surf)}" data-idx="${idx}" title="Click to inspect">${escapeHtml(surf)}</span>`;
      }).join("");

      return `
        <div class="hud-sentence-words-box" title="Click any word to inspect">
          ${wordsHtml}
        </div>
      `;
    }

    render() {
      if (!this.popupEl || !this.currentTargetToken) return;

      const surface = this.currentTargetToken.surface || this.currentTargetToken.text || "";
      const lemma = this.currentTargetToken.lemma || surface;
      const reading = this.currentTargetToken.reading || "";
      const status = this.currentTargetToken.status || "unstyled";
      const jlptLevel = this.currentTargetToken.jlpt_level || "";
      const sentence = this.activeContextSentence || this.activeCue?.text || "";

      const contextHtml = sentence && sentence !== surface
        ? `
          <div class="hud-context-box">
            <div class="hud-context-caption">CONTEXT</div>
            ${this._renderSentenceWordsBox(sentence, surface)}
          </div>
        `
        : "";

      this.popupEl.innerHTML = `
        <div class="hud-popup-tabs">
          <div class="hud-header-left">
            <div class="hud-inspector-header hud-drag-handle" title="Drag to move popover">
              <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true">
                <circle cx="3" cy="3" r="1.4" fill="currentColor"/>
                <circle cx="7" cy="3" r="1.4" fill="currentColor"/>
                <circle cx="3" cy="7" r="1.4" fill="currentColor"/>
                <circle cx="7" cy="7" r="1.4" fill="currentColor"/>
                <circle cx="3" cy="11" r="1.4" fill="currentColor"/>
                <circle cx="7" cy="11" r="1.4" fill="currentColor"/>
              </svg>
            </div>
            <div class="hud-tabs-segmented">
              <button type="button" class="hud-tab-btn ${this.activeTab === "word" ? "is-active" : ""}" data-tab="word">Word</button>
              <button type="button" class="hud-tab-btn ${this.activeTab === "grammar" ? "is-active" : ""}" data-tab="grammar">Grammar</button>
            </div>
          </div>
          <div class="hud-header-right">
            <button type="button" class="hud-action-icon-btn hud-popup-dict-btn" title="Search Dictionary" aria-label="Search Dictionary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            </button>
            <button type="button" class="hud-action-icon-btn hud-popup-close-btn" title="Close" aria-label="Close">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"><path d="M2 2l8 8M10 2l-8 8"/></svg>
            </button>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-word" style="display:${this.activeTab === "word" ? "flex" : "none"}; flex-direction:column; gap:10px;">
          <div class="hud-word-hero">
            <div class="hud-word-header">
              <div class="hud-headword-kanji">
                ${escapeHtml(lemma || surface)}
                ${lemma && surface && lemma !== surface ? `<span class="hud-surface-parens">(${escapeHtml(surface)})</span>` : ""}
              </div>
              ${reading && reading !== surface ? `<div class="hud-reading-furigana">${escapeHtml(reading)}</div>` : ""}
            </div>
            <span class="hud-badge-jlpt ${status === "mined" ? "is-mined" : ""}" style="display:${status === "mined" || jlptLevel ? "inline-flex" : "none"};">
              ${status === "mined" ? "Saved" : escapeHtml(jlptLevel)}
            </span>
          </div>

          <div class="hud-popup-meaning">
            Looking up…
          </div>

          ${contextHtml}

          <div class="hud-actions-stack">
            <div class="hud-status-group">
              <button type="button" class="hud-status-pill hud-btn-known ${status === "known" ? "is-active-known" : ""}" data-status="known">Known</button>
              <button type="button" class="hud-status-pill hud-btn-unknown ${status === "unknown" ? "is-active-unknown" : ""}" data-status="unknown">Unknown</button>
            </div>
            <button type="button" tabindex="-1" class="tactile-btn hud-popup-mine-btn hud-btn-mine ${status === "mined" ? "is-saved" : ""}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="square"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>${status === "mined" ? "Saved" : "Save to Deck"}</span>
            </button>
            <div class="hud-shortcuts-footer">[Alt+M] Save  •  [Esc] Close</div>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-grammar" style="display:${this.activeTab === "grammar" ? "flex" : "none"}; flex-direction:column; gap:10px;">
          <div class="hud-grammar-content">
            Analyzing sentence…
          </div>
          <div class="hud-actions-stack">
            <button type="button" class="tactile-btn hud-grammar-mine-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="square"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Mine Grammar</span>
            </button>
          </div>
        </div>
      `;

      this.popupEl.style.display = "flex";

      // Attach drag handle exclusively to .hud-drag-handle
      const dragHandle = this.popupEl.querySelector?.(".hud-drag-handle");
      if (dragHandle) {
        dragHandle.addEventListener("pointerdown", this._boundDragStart);
      }

      // Attach tab events
      if (typeof this.popupEl.querySelectorAll === "function") {
        this.popupEl.querySelectorAll(".hud-tab-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tab = btn.dataset.tab;
            if (tab) this.switchTab(tab);
          });
        });
      }

      // Attach word token click events in the sentence inspector strip
      if (typeof this.popupEl.querySelectorAll === "function") {
        this.popupEl.querySelectorAll(".hud-sentence-word-token").forEach((tokSpan) => {
          tokSpan.addEventListener("click", (e) => {
            e.stopPropagation();
            const clickedSurface = tokSpan.getAttribute("data-surface");
            if (!clickedSurface) return;
            const sent = this.activeContextSentence || this.activeCue?.text || "";
            const sentenceTokens = sentenceTokensCache.get(sent) || this.activeCue?.tokens || [];
            const found = sentenceTokens.find(t => t.surface === clickedSurface || t.lemma === clickedSurface) || {
              surface: clickedSurface,
              lemma: clickedSurface,
              text: clickedSurface,
              status: "unstyled"
            };
            this.currentTargetToken = found;
            this.render();
            this.loadWordDetails(found.lemma || clickedSurface);
          });
        });
      }

      this.popupEl.querySelector?.(".hud-popup-close-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });

      const dictBtn = this.popupEl.querySelector?.(".hud-popup-dict-btn");
      if (dictBtn) {
        dictBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const term = lemma || surface;
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "OPEN_DICTIONARY",
              term: term,
              sentence: this.activeContextSentence || this.activeCue?.text || ""
            }).catch(() => {});
          }
        });
      }

      // Wire save button
      const mineBtn = this.popupEl.querySelector?.(".hud-popup-mine-btn");
      if (mineBtn) {
        if (status === "mined") {
          mineBtn.disabled = true;
          mineBtn.style.opacity = "0.7";
        } else {
          mineBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.mineCurrentWord();
          });
        }
      }

      // Wire grammar mine button
      const grammarMineBtn = this.popupEl.querySelector?.(".hud-grammar-mine-btn");
      if (grammarMineBtn) {
        grammarMineBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.mineCurrentGrammar();
        });
      }

      // Wire status pills
      if (typeof this.popupEl.querySelectorAll === "function") {
        this.popupEl.querySelectorAll(".hud-status-pill").forEach((pill) => {
          pill.addEventListener("click", (e) => {
            e.stopPropagation();
            const st = e.currentTarget?.dataset?.status;
            if (st) this.setWordStatus(lemma || surface, st);
          });
        });
      }

      // Load Word details
      this.loadWordDetails(lemma || surface);

      // If activeTab is grammar, load grammar
      if (this.activeTab === "grammar") {
        this.loadGrammarDetails();
      }
    }

    switchTab(tab) {
      this.activeTab = tab;
      const wordPane = this.popupEl?.querySelector(".hud-pane-word");
      const grammarPane = this.popupEl?.querySelector(".hud-pane-grammar");
      const tabBtns = (typeof this.popupEl?.querySelectorAll === "function") ? this.popupEl.querySelectorAll(".hud-tab-btn") : [];

      if (wordPane && grammarPane) {
        wordPane.style.display = tab === "word" ? "flex" : "none";
        grammarPane.style.display = tab === "grammar" ? "flex" : "none";
      }

      if (this.popupEl) {
        if (tab === "grammar") {
          this.popupEl.style.minWidth = "380px";
          this.popupEl.style.maxWidth = "460px";
        } else {
          this.popupEl.style.minWidth = "318px";
          this.popupEl.style.maxWidth = "380px";
        }
      }

      tabBtns?.forEach((b) => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle("is-active", isActive);
      });

      if (tab === "grammar") {
        this.loadGrammarDetails();
      }

      this.reposition();
    }

    _fetchWordData(term) {
      return this.loadWordDetails(term);
    }

    async loadWordDetails(term) {
      const cached = lookupCache.get(term);
      if (cached) {
        this._applyEnrichment(cached);
        this._renderMeaning(cached);
        return;
      }

      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          const resp = await chrome.runtime.sendMessage({
            type: "HUD_LOOKUP",
            text: term
          });
          if (resp && resp.ok && resp.data) {
            lookupCache.set(term, resp.data);
            this._applyEnrichment(resp.data);
            this._renderMeaning(resp.data);
          } else if (resp && resp.error) {
            this._renderMeaningError(resp.error);
          }
        }
      } catch (_) {
        this._renderMeaningError("Kiroku backend offline");
      }
    }

    _applyEnrichment(data) {
      if (!data || !this.currentTargetToken) return;
      const primaryEntry = Array.isArray(data.entries) ? data.entries[0] : null;
      const newExpression = data.expression || primaryEntry?.term || primaryEntry?.norm_term || "";
      const newReading = data.reading || primaryEntry?.reading || "";
      const newLevel = data.jlpt_level || data.level || primaryEntry?.level || "";

      const curSurface = this.currentTargetToken.surface || this.currentTargetToken.text || "";

      if (newExpression && newExpression !== curSurface) {
        this.currentTargetToken.lemma = newExpression;
      }
      if (newReading) {
        this.currentTargetToken.reading = newReading;
      }
      if (newLevel) {
        this.currentTargetToken.jlpt_level = newLevel;
      }

      // Update kanji headword in DOM
      const kanjiEl = this.popupEl?.querySelector?.(".hud-headword-kanji");
      if (kanjiEl) {
        const curLemma = this.currentTargetToken.lemma || curSurface;
        if (curLemma && curSurface && curLemma !== curSurface) {
          kanjiEl.innerHTML = `${escapeHtml(curLemma)} <span class="hud-surface-parens">(${escapeHtml(curSurface)})</span>`;
        } else {
          kanjiEl.textContent = curLemma || curSurface;
        }
      }

      // Update furigana reading in DOM
      const headerEl = this.popupEl?.querySelector?.(".hud-word-header");
      if (headerEl) {
        let furiganaEl = headerEl.querySelector?.(".hud-reading-furigana");
        const curReading = this.currentTargetToken.reading || "";
        if (curReading && curReading !== curSurface) {
          if (!furiganaEl) {
            furiganaEl = document.createElement("div");
            furiganaEl.className = "hud-reading-furigana";
            headerEl.appendChild(furiganaEl);
          }
          furiganaEl.textContent = curReading;
        }
      }

      // Update JLPT level badge in DOM
      const badgeEl = this.popupEl?.querySelector?.(".hud-badge-jlpt");
      if (badgeEl) {
        if (this.currentTargetToken.status === "mined") {
          badgeEl.textContent = "Saved";
          badgeEl.classList.add?.("is-mined");
          badgeEl.style.display = "inline-flex";
        } else if (newLevel) {
          badgeEl.textContent = newLevel;
          badgeEl.classList.remove?.("is-mined");
          badgeEl.style.display = "inline-flex";
        } else if (!this.currentTargetToken.jlpt_level) {
          badgeEl.style.display = "none";
        }
      }
    }

    async loadGrammarDetails() {
      const sentence = this.activeContextSentence || this.activeCue?.text || "";
      const grammarEl = this.popupEl?.querySelector(".hud-grammar-content");
      if (!grammarEl) return;

      if (!sentence) {
        grammarEl.innerHTML = `<span class="hud-grammar-empty">No context sentence available for grammar analysis.</span>`;
        return;
      }

      const cached = grammarCache.get(sentence);
      if (cached) {
        this._renderGrammar(cached);
        return;
      }

      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          const resp = await chrome.runtime.sendMessage({
            type: "GRAMMAR_ANALYZE",
            sentence
          });
          if (resp && resp.ok && resp.data) {
            grammarCache.set(sentence, resp.data);
            this._renderGrammar(resp.data);
          } else {
            grammarEl.innerHTML = `<span class="hud-grammar-empty">No distinct grammar patterns detected in sentence.</span>`;
          }
        }
      } catch (_) {
        grammarEl.innerHTML = `<span class="hud-grammar-error">Grammar analysis unavailable</span>`;
      }
    }

    _extractYomitanGlosses(node) {
      if (!node) return [];
      if (typeof node === "string") {
        const s = node.trim();
        return (s && !s.startsWith("{") && !s.startsWith("<") && s !== "[object Object]") ? [s] : [];
      }
      if (Array.isArray(node)) {
        return node.flatMap(n => this._extractYomitanGlosses(n)).filter(Boolean);
      }
      if (typeof node !== "object") return [];

      const cType = String(node.data?.content || node["data-content"] || node["data-sc-content"] || "").toLowerCase();
      const cClass = String(node.data?.class || node.className || node.class || "").toLowerCase();
      if (cType.includes("attribution") || cType.includes("extra") || cType.includes("example") ||
          cType.includes("part-of-speech") || cType.includes("tag") || cType.includes("dictionary") ||
          cClass.includes("attribution") || cClass.includes("extra") || cClass.includes("example") || cClass.includes("pos-tag")) {
        return [];
      }

      if (cType === "glossary" || node.tag === "ol" || node.tag === "ul") {
        const items = [];
        const findLi = (n) => {
          if (!n) return;
          if (Array.isArray(n)) return n.forEach(findLi);
          if (n.tag === "li") {
            const txt = this._extractNodeCleanText(n);
            if (txt) items.push(txt);
          } else if (n.content) {
            findLi(n.content);
          }
        };
        findLi(node.content || node);
        if (items.length > 0) return items;
      }

      if (node.content) return this._extractYomitanGlosses(node.content);
      if (node.glossary) return this._extractYomitanGlosses(node.glossary);
      if (node.definition) return this._extractYomitanGlosses(node.definition);
      if (node.definitions) return this._extractYomitanGlosses(node.definitions);
      if (node.meanings) return this._extractYomitanGlosses(node.meanings);
      if (Array.isArray(node.glosses)) return this._extractYomitanGlosses(node.glosses);

      const txt = this._extractNodeCleanText(node);
      return txt ? [txt] : [];
    }

    _extractNodeCleanText(node) {
      if (!node) return "";
      if (typeof node === "string") return node.trim();
      if (Array.isArray(node)) return node.map(n => this._extractNodeCleanText(n)).filter(Boolean).join(" ");
      if (typeof node === "object") {
        if (node.tag === "rt") return "";
        const cType = String(node.data?.content || node["data-content"] || "").toLowerCase();
        const cClass = String(node.data?.class || node.className || "").toLowerCase();
        if (cType.includes("attribution") || cType.includes("example") || cType.includes("part-of-speech") ||
            cClass.includes("attribution") || cClass.includes("example")) return "";
        if (node.text) return String(node.text).trim();
        if (node.content) return this._extractNodeCleanText(node.content);
      }
      return "";
    }

    _extractPlainText(node) {
      if (!node) return "";
      if (typeof node === "string") {
        const s = node.trim();
        if (/^<.*object at 0x[0-9a-fA-F]+>$/i.test(s) || s === "[object Object]") return "";
        return s;
      }
      if (typeof node === "number" || typeof node === "boolean") return String(node);
      const glosses = this._extractYomitanGlosses(node);
      return glosses.length > 0 ? glosses.join("; ") : "";
    }

    _renderMeaning(data) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      let lines = [];

      // 1. If data.meaning is a clean formatted text string, prioritize it!
      if (typeof data?.meaning === "string" && data.meaning.trim() && !data.meaning.trim().startsWith("{") && !data.meaning.trim().startsWith("[")) {
        lines = data.meaning.trim().split(/\r?\n/)
          .map(l => l.trim().replace(/^\d+[\.\)]\s*/, "").replace(/^\[[^\]]+\]\s*/, "").trim())
          .filter(Boolean);
      }

      // 2. Check top-level senses
      if (lines.length === 0 && Array.isArray(data?.senses) && data.senses.length > 0) {
        for (const s of data.senses) {
          const gloss = Array.isArray(s.glosses) ? s.glosses.join("; ") : (s.gloss || s.definition || s.meaning || s);
          const text = this._extractPlainText(gloss);
          if (text && !lines.includes(text)) {
            lines.push(text);
          }
          if (lines.length >= 6) break;
        }
      }

      // 3. Check structured Yomitan entries/senses/definitions
      if (lines.length === 0 && Array.isArray(data?.entries) && data.entries.length > 0) {
        for (const entry of data.entries) {
          if (Array.isArray(entry.senses) && entry.senses.length > 0) {
            for (const sense of entry.senses) {
              if (Array.isArray(sense.glosses) && sense.glosses.length > 0) {
                const senseTexts = sense.glosses.map((g) => this._extractPlainText(g)).filter(Boolean);
                if (senseTexts.length > 0) {
                  lines.push(senseTexts.join(", "));
                }
              }
            }
          } else if (Array.isArray(entry.definitions) && entry.definitions.length > 0) {
            for (const def of entry.definitions) {
              const text = this._extractPlainText(def);
              if (text && !lines.includes(text)) {
                lines.push(text);
              }
            }
          } else if (Array.isArray(entry.meanings) && entry.meanings.length > 0) {
            for (const m of entry.meanings) {
              const text = this._extractPlainText(m);
              if (text && !lines.includes(text)) {
                lines.push(text);
              }
            }
          } else if (Array.isArray(entry.glossary) && entry.glossary.length > 0) {
            for (const g of entry.glossary) {
              const text = this._extractPlainText(g);
              if (text && !lines.includes(text)) {
                lines.push(text);
              }
            }
          } else if (entry.definition || entry.meaning) {
            const text = this._extractPlainText(entry.definition || entry.meaning);
            if (text && !lines.includes(text)) {
              lines.push(text);
            }
          }
          if (lines.length >= 6) break;
        }
      }

      // 3. Fallback to glossary or definitions list
      if (lines.length === 0 && Array.isArray(data?.glossary)) {
        lines = data.glossary.map((g) => this._extractPlainText(g)).filter(Boolean);
      }
      if (lines.length === 0 && Array.isArray(data?.definitions)) {
        lines = data.definitions.map((g) => this._extractPlainText(g)).filter(Boolean);
      }
      if (lines.length === 0 && Array.isArray(data?.meanings)) {
        lines = data.meanings.map((g) => this._extractPlainText(g)).filter(Boolean);
      }
      if (lines.length === 0 && (data?.definition || data?.translation)) {
        const val = this._extractPlainText(data.definition || data.translation);
        if (val) lines.push(val);
      }

      // 4. Fallback to string meaning
      if (lines.length === 0 && data?.meaning) {
        let rawMeaning = data.meaning;
        if (typeof rawMeaning === "object") {
          rawMeaning = this._extractPlainText(rawMeaning);
        }
        if (typeof rawMeaning === "string") {
          const trimmed = rawMeaning.trim();
          if (trimmed.startsWith("{") || (trimmed.startsWith("[") && !trimmed.startsWith("[v") && !trimmed.startsWith("[n"))) {
            try {
              const parsed = JSON.parse(trimmed);
              const extracted = this._extractPlainText(parsed);
              if (extracted) lines.push(extracted);
            } catch (_) {}
          }
          if (lines.length === 0) {
            lines = trimmed.split(/\n+/).map((l) => {
              const s = l.trim();
              if (/^<.*object at 0x[0-9a-fA-F]+>$/i.test(s) || s === "[object Object]") return "";
              return s;
            }).filter(Boolean);
          }
        }
      }

      if (lines.length === 0) {
        meaningEl.innerHTML = `<span style="color:rgba(245,241,232,0.60);">No definition found.</span>`;
        this.reposition();
        return;
      }

      const formatted = lines.map((line, idx) => {
        const clean = line.replace(/^[•\-\*]\s*/, "").trim();
        if (/^\d+[\.\)]\s*/.test(clean)) {
          return `<div class="hud-meaning-line">${escapeHtml(clean)}</div>`;
        }
        if (lines.length > 1) {
          return `<div class="hud-meaning-line"><span class="hud-meaning-idx">${idx + 1}.</span>${escapeHtml(clean)}</div>`;
        }
        return `<div class="hud-meaning-line">${escapeHtml(clean)}</div>`;
      }).join("");

      meaningEl.innerHTML = formatted;
      this.reposition();
    }

    _renderMeaningError(errText) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      meaningEl.innerHTML = `<span style="color:#f87171;">${escapeHtml(errText || "Lookup failed")}</span>`;
      this.reposition();
    }

    _renderGrammar(data) {
      if (!this.popupEl) return;
      const grammarEl = this.popupEl.querySelector(".hud-grammar-content");
      if (!grammarEl) return;

      const allPatterns = Array.isArray(data?.points)
        ? data.points
        : (Array.isArray(data?.patterns) ? data.patterns : (data?.matches || []));

      // Read dumped grammar from local storage
      let dumpedSet = new Set();
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("kiroku_dumped_grammar", (res) => {
            if (Array.isArray(res?.kiroku_dumped_grammar)) {
              dumpedSet = new Set(res.kiroku_dumped_grammar);
            }
            this._renderGrammarList(allPatterns, dumpedSet, grammarEl);
          });
          return;
        }
      } catch (_) {}
      this._renderGrammarList(allPatterns, dumpedSet, grammarEl);
    }

    _renderGrammarList(allPatterns, dumpedSet, grammarEl) {
      const patterns = allPatterns.filter(p => {
        const title = p.pattern_display || p.pattern_key || p.text || p.display || p.pattern || p.title || "";
        return !dumpedSet.has(title) && !dumpedSet.has(p.pattern_key) && !dumpedSet.has(p.name);
      });

      if (!patterns.length) {
        grammarEl.innerHTML = `<span class="hud-grammar-empty">No matching grammar patterns found.</span>`;
        return;
      }

      this.grammarData = patterns[0];

      let html = `<div class="hud-grammar-list">`;
      for (const p of patterns) {
        const title = p.pattern_display || p.pattern_key || p.text || p.display || p.pattern || p.title || "";
        const level = p.level || p.jlpt || "Grammar";
        const meaning = p.meaning_short || p.english_breakdown || p.meaning || p.explanation || "";
        const formation = p.formation ? `<div class="hud-grammar-formation">${escapeHtml(p.formation)}</div>` : "";
        const example = p.example_sentence ? `<div class="hud-grammar-example">${escapeHtml(p.example_sentence)}</div>` : "";

        html += `
          <div class="hud-grammar-card">
            <div class="hud-grammar-card-head">
              <span class="hud-grammar-title">${escapeHtml(title)}</span>
              <div class="hud-grammar-meta">
                <span class="hud-grammar-level">${escapeHtml(level)}</span>
                <button type="button" class="hud-grammar-dismiss-btn" data-key="${escapeHtml(title)}" data-pkey="${escapeHtml(p.pattern_key || title)}" title="Hide this grammar point (already known)">×</button>
              </div>
            </div>
            <div class="hud-grammar-meaning">${escapeHtml(meaning)}</div>
            ${formation}
            ${example}
          </div>
        `;
      }
      html += `</div>`;
      grammarEl.innerHTML = html;

      // Attach dismiss handler
      grammarEl.querySelectorAll(".hud-grammar-dismiss-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const key = btn.dataset.key;
          const pkey = btn.dataset.pkey || key;
          const card = btn.closest(".hud-grammar-card");
          if (card) {
            card.style.opacity = "0";
            card.style.transform = "scale(0.85)";
            setTimeout(() => card.remove(), 160);
          }
          try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
              chrome.storage.local.get("kiroku_dumped_grammar", (res) => {
                const list = Array.isArray(res?.kiroku_dumped_grammar) ? res.kiroku_dumped_grammar : [];
                if (!list.includes(key)) list.push(key);
                if (pkey && !list.includes(pkey)) list.push(pkey);
                chrome.storage.local.set({ kiroku_dumped_grammar: list });
              });
            }
          } catch (_) {}
        });
      });

      this.reposition();
    }

    async mineCurrentWord() {
      if (!this.currentTargetToken || this.isMining) return;
      const mineBtn = this.popupEl?.querySelector(".hud-popup-mine-btn");
      if (mineBtn) {
        mineBtn.disabled = true;
        mineBtn.textContent = "Saving…";
      }
      this.isMining = true;

      const surface = this.currentTargetToken.surface || this.currentTargetToken.text || "";
      const lemma = this.currentTargetToken.lemma || surface;
      const reading = this.currentTargetToken.reading || "";
      const sentence = this.activeContextSentence || this.activeCue?.text || "";
      const rawMeaning = (this.popupEl?.querySelector(".hud-popup-meaning")?.textContent || "").trim();
      const meaning = rawMeaning.startsWith("Looking up") || rawMeaning.startsWith("No definition") ? "" : rawMeaning;

      try {
        let resp = null;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          resp = await chrome.runtime.sendMessage({
            type: "HUD_MINE",
            card: {
              expression: lemma || surface,
              reading: reading,
              meaning: meaning,
              example_sentence: sentence,
              source_type: this.activeCue ? "video" : "web"
            }
          });
        }

        if (resp && resp.ok) {
          if (mineBtn) {
            mineBtn.textContent = "Saved";
            mineBtn.classList.add("is-saved");
            mineBtn.style.background = "#4EBB7B";
            mineBtn.style.color = "#000000";
          }
          this.currentTargetToken.status = "mined";
          const badgeEl = this.popupEl?.querySelector?.(".hud-badge-jlpt");
          if (badgeEl) {
            badgeEl.textContent = "Saved";
            badgeEl.classList.add("is-mined");
            badgeEl.style.display = "inline-flex";
          }

          if (this.currentTargetSpan) {
            this.currentTargetSpan.classList.add("mined");
            this.currentTargetSpan.style.color = "#d4884f";
            this.currentTargetSpan.style.textDecoration = "underline";
            this.currentTargetSpan.style.textDecorationColor = "rgba(212, 136, 79, 0.45)";
          }

          // Trigger tactile floating toast with Undo
          if (typeof KirokuToast !== "undefined" && KirokuToast.show) {
            KirokuToast.show({
              term: lemma || surface,
              reading: reading,
              cardId: resp.card_id || resp.cardId
            });
          }
        } else {
          if (mineBtn) {
            mineBtn.disabled = false;
            mineBtn.textContent = "Save";
          }
        }
      } catch (_) {
        if (mineBtn) {
          mineBtn.disabled = false;
          mineBtn.textContent = "Save";
        }
      } finally {
        this.isMining = false;
      }
    }

    async mineCurrentGrammar() {
      if (!this.grammarData || this.isMining) return;
      const grammarBtn = this.popupEl?.querySelector(".hud-grammar-mine-btn");
      if (grammarBtn) {
        grammarBtn.disabled = true;
        grammarBtn.textContent = "Saving…";
      }
      this.isMining = true;

      const sentence = this.activeContextSentence || this.activeCue?.text || "";
      const pattern = this.grammarData.pattern || this.grammarData.display || "";

      try {
        let resp = null;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          resp = await chrome.runtime.sendMessage({
            type: "GRAMMAR_MINE",
            grammar: {
              pattern,
              meaning: this.grammarData.meaning || this.grammarData.explanation || "",
              sentence: sentence,
              level: this.grammarData.level || "Grammar"
            }
          });
        }

        if (resp && resp.ok) {
          if (grammarBtn) {
            grammarBtn.textContent = "Saved";
            grammarBtn.classList.add("is-saved");
            grammarBtn.style.background = "#4EBB7B";
            grammarBtn.style.color = "#000000";
          }
          if (typeof KirokuToast !== "undefined" && KirokuToast.show) {
            KirokuToast.show({
              term: pattern,
              message: "Grammar Card Saved",
              cardId: resp.card_id || resp.cardId
            });
          }
        } else {
          if (grammarBtn) {
            grammarBtn.disabled = false;
            grammarBtn.textContent = "Mine Grammar";
          }
        }
      } catch (_) {
        if (grammarBtn) {
          grammarBtn.disabled = false;
          grammarBtn.textContent = "Mine Grammar";
        }
      } finally {
        this.isMining = false;
      }
    }

    async setWordStatus(word, status) {
      if (!word) return;
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          await chrome.runtime.sendMessage({
            type: "SET_WORD_STATUS",
            word,
            status
          });
        }
      } catch (_) {}
      if (this.currentTargetToken) {
        this.currentTargetToken.status = status;
      }
      const pills = this.popupEl?.querySelectorAll(".hud-status-pill");
      pills?.forEach((p) => {
        const pStatus = p.dataset.status;
        if (pStatus === status) {
          p.classList.add(status === "known" ? "is-active-known" : "is-active-unknown");
          p.classList.remove(status === "known" ? "is-active-unknown" : "is-active-known");
        } else {
          p.classList.remove("is-active-known", "is-active-unknown");
        }
      });
    }

    reposition() {
      if (!this.isOpen || !this.popupEl || this._userDragged) return;
      try {
        const popupWidth = this.popupEl.offsetWidth || 280;
        const popupHeight = this.popupEl.offsetHeight || 160;

        let targetX = 0;
        let targetY = 0;
        let targetH = 20;

        if (this.fixedAnchorPoint) {
          targetX = this.fixedAnchorPoint.x;
          targetY = this.fixedAnchorPoint.y;
        } else if (this.currentTargetSpan) {
          const rect = this.currentTargetSpan.getBoundingClientRect();
          targetX = rect.left + rect.width / 2;
          targetY = rect.top;
          targetH = rect.height;
        } else {
          return;
        }

        let left = targetX - popupWidth / 2;
        let top = targetY - popupHeight - 10;

        if (top < 10) {
          top = targetY + targetH + 10;
        }

        const maxLeft = Math.max(10, window.innerWidth - popupWidth - 14);
        left = Math.max(10, Math.min(maxLeft, left));
        const maxTop = Math.max(10, window.innerHeight - popupHeight - 14);
        top = Math.max(10, Math.min(maxTop, top));

        this.popupEl.style.left = `${Math.round(left)}px`;
        this.popupEl.style.top = `${Math.round(top)}px`;
      } catch (_) {}
    }

    _onDragStart(e) {
      if (!e) return;
      if (e.target?.closest?.("button") || e.target?.closest?.("a") || e.target?.closest?.("input")) return;
      this._isDragging = true;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
      const rect = this.popupEl.getBoundingClientRect();
      this._dragStartLeft = rect.left;
      this._dragStartTop = rect.top;
      if (this.popupEl) {
        this.popupEl.style.cursor = "grabbing";
      }
      if (typeof document !== "undefined") {
        document.addEventListener("pointermove", this._boundDragMove, true);
        document.addEventListener("pointerup", this._boundDragEnd, true);
      }
      e.preventDefault();
      e.stopPropagation();
    }

    _onDragMove(e) {
      if (!this._isDragging || !this.popupEl || !e) return;
      const dx = e.clientX - this._dragStartX;
      const dy = e.clientY - this._dragStartY;
      const popupWidth = this.popupEl.offsetWidth || 300;
      const popupHeight = this.popupEl.offsetHeight || 180;
      let nextLeft = this._dragStartLeft + dx;
      let nextTop = this._dragStartTop + dy;
      const maxLeft = Math.max(10, (typeof window !== "undefined" ? window.innerWidth : 1000) - popupWidth - 10);
      const maxTop = Math.max(10, (typeof window !== "undefined" ? window.innerHeight : 800) - popupHeight - 10);
      nextLeft = Math.max(10, Math.min(maxLeft, nextLeft));
      nextTop = Math.max(10, Math.min(maxTop, nextTop));
      this.popupEl.style.left = `${Math.round(nextLeft)}px`;
      this.popupEl.style.top = `${Math.round(nextTop)}px`;
      this._userDragged = true;
      e.preventDefault();
      e.stopPropagation();
    }

    _onDragEnd(e) {
      if (!this._isDragging) return;
      this._isDragging = false;
      if (this.popupEl) {
        this.popupEl.style.cursor = "";
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("pointermove", this._boundDragMove, true);
        document.removeEventListener("pointerup", this._boundDragEnd, true);
      }
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (this.popupEl) {
        this.popupEl.style.display = "none";
      }
      this.currentTargetToken = null;
      this.currentTargetSpan = null;
      this.fixedAnchorPoint = null;
      if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        document.querySelectorAll(".video-sub-token.is-active").forEach(el => el.classList.remove("is-active"));
      }
    }

    destroy() {
      this.close();
      if (this._unsubState) {
        try { this._unsubState(); } catch (_) {}
        this._unsubState = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", this._boundDocKeyDown, true);
        document.removeEventListener("pointerdown", this._boundDocClick, true);
        document.removeEventListener("pointermove", this._boundDragMove, true);
        document.removeEventListener("pointerup", this._boundDragEnd, true);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", this._boundReposition);
      }
      if (this.popupEl && this.popupEl.parentElement) {
        this.popupEl.parentElement.removeChild(this.popupEl);
      }
      if (this.hostEl && this.hostEl.parentElement) {
        this.hostEl.parentElement.removeChild(this.hostEl);
      }
      this.popupEl = null;
      this.hostEl = null;
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return { HudPopup, lookupCache, grammarCache };
});
