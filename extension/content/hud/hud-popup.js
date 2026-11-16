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
          --ink-black: #141311;
          --pure-black: #000000;
          --warm-paper: #F5F1E8;
          --vermilion: #D94B38;
          --vermilion-hover: #C53E2D;
          --vermilion-active: #B33424;
          --ink-surface: #1C1B19;
          --elevated-surface: #2A2926;
          --tactile-stroke: #151413;
          --subtle-border: rgba(245, 241, 232, 0.12);
          --alpine-berry: #F7E0BA;
          --jade: #4EBB7B;
          --amber: #F59E0B;
          --heat-marker: #F39120;
          --industrial-aqua: #4FBBBC;
          --paper-muted: rgba(245, 241, 232, 0.70);
          --paper-subtle: rgba(245, 241, 232, 0.45);
          --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-japanese: "Zen Kaku Gothic New", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-kanji: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          --font-badge: "Mochiy Pop One", "Mochiy Pop P One", "Zen Kaku Gothic New", sans-serif;
        }

        .kiroku-hud-popup {
          position: fixed;
          display: none;
          flex-direction: column;
          gap: 10px;
          min-width: 290px;
          max-width: 360px;
          padding: 12px 14px;
          background: rgba(28, 27, 25, 0.98);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid var(--subtle-border);
          border-radius: 10px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75), 2px 2px 0 var(--tactile-stroke);
          color: var(--warm-paper);
          font-family: var(--font-sans);
          font-size: 13px;
          z-index: 2147483647;
          pointer-events: auto;
          box-sizing: border-box;
          user-select: text;
        }

        .kiroku-hud-popup button {
          box-sizing: border-box;
          font-family: inherit;
          margin: 0;
          outline: none;
          user-select: none;
          -webkit-user-select: none;
        }

        .hud-popup-tabs {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(245, 241, 232, 0.10);
          padding-bottom: 6px;
          cursor: grab;
          user-select: none;
        }

        .hud-popup-tabs:active {
          cursor: grabbing;
        }

        .hud-tabs-segmented {
          display: inline-flex !important;
          align-items: center !important;
          background: #1C1B19 !important;
          border: 1.5px solid rgba(245, 241, 232, 0.22) !important;
          border-radius: 6px !important;
          padding: 2px !important;
          gap: 2px !important;
          box-shadow: 1.5px 1.5px 0 #151413 !important;
        }

        .hud-tab-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          background: rgba(245, 241, 232, 0.08) !important;
          border: 1px solid rgba(245, 241, 232, 0.15) !important;
          padding: 3px 12px !important;
          border-radius: 4px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          color: rgba(245, 241, 232, 0.75) !important;
          cursor: pointer !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          box-shadow: 1px 1px 0 var(--tactile-stroke, #151413) !important;
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease, border-color 120ms ease !important;
        }

        .hud-tab-btn.is-active {
          background: #FAF8F5 !important;
          border-color: #FAF8F5 !important;
          color: #141311 !important;
          font-weight: 800 !important;
          box-shadow: 1.5px 1.5px 0 var(--tactile-stroke, #151413) !important;
        }

        .hud-tab-btn:hover:not(.is-active) {
          transform: translate(-1px, -1px) !important;
          box-shadow: 2px 2px 0 var(--tactile-stroke, #151413) !important;
          color: #FFFFFF !important;
          background: rgba(245, 241, 232, 0.18) !important;
          border-color: rgba(245, 241, 232, 0.35) !important;
        }

        .hud-tab-btn:active {
          transform: translate(1px, 1px) !important;
          box-shadow: 0 0 0 transparent !important;
        }

        .hud-action-icon-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 24px !important;
          height: 24px !important;
          border-radius: 4px !important;
          background: none !important;
          border: none !important;
          color: rgba(245, 241, 232, 0.60) !important;
          cursor: pointer !important;
          user-select: none !important;
          transition: color 120ms ease !important;
        }

        .hud-action-icon-btn:hover {
          color: var(--warm-paper) !important;
        }

        .tactile-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 6px !important;
          padding: 6px 16px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          border-radius: 6px !important;
          border: 1.5px solid rgba(255, 255, 255, 0.16) !important;
          cursor: pointer !important;
          user-select: none !important;
          transform: translate(-1px, -1px) !important;
          box-shadow: 2px 2px 0 var(--tactile-stroke, #151413) !important;
          transition: transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease, background-color 140ms ease !important;
        }

        .tactile-btn:hover {
          transform: translate(-1.5px, -1.5px) !important;
          box-shadow: 3px 3px 0 var(--tactile-stroke, #151413) !important;
        }

        .tactile-btn:active {
          transform: translate(1px, 1px) !important;
          box-shadow: 0 0 0 transparent !important;
        }

        .hud-popup-mine-btn {
          background: var(--vermilion, #D94B38) !important;
          color: #FAF8F5 !important;
          padding: 6px 14px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          border: 1.5px solid rgba(255, 255, 255, 0.35) !important;
          border-radius: 6px !important;
          box-shadow: 2px 2px 0 #151413 !important;
          cursor: pointer !important;
        }

        .hud-popup-mine-btn:hover {
          background: var(--vermilion-hover, #C53E2D) !important;
          transform: translate(-1px, -1px) !important;
          box-shadow: 3px 3px 0 #151413 !important;
        }

        .hud-status-pill {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 5px 12px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          border-radius: 6px !important;
          cursor: pointer !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          box-shadow: 2px 2px 0 #151413 !important;
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease, border-color 120ms ease !important;
        }

        .hud-status-pill.hud-btn-known {
          background: rgba(78, 187, 123, 0.14) !important;
          border: 1.5px solid rgba(78, 187, 123, 0.50) !important;
          color: #4EBB7B !important;
        }

        .hud-status-pill.hud-btn-known:hover {
          background: rgba(78, 187, 123, 0.25) !important;
          border-color: #4EBB7B !important;
          color: #6ee7b7 !important;
          transform: translate(-1px, -1px) !important;
          box-shadow: 3px 3px 0 #151413 !important;
        }

        .hud-status-pill.hud-btn-known.is-active-known {
          background: #4EBB7B !important;
          border-color: #4EBB7B !important;
          color: #141311 !important;
          font-weight: 800 !important;
        }

        .hud-status-pill.hud-btn-unknown {
          background: rgba(243, 145, 32, 0.14) !important;
          border: 1.5px solid rgba(243, 145, 32, 0.50) !important;
          color: #F39120 !important;
        }

        .hud-status-pill.hud-btn-unknown:hover {
          background: rgba(243, 145, 32, 0.25) !important;
          border-color: #F39120 !important;
          color: #fbbf24 !important;
          transform: translate(-1px, -1px) !important;
          box-shadow: 3px 3px 0 #151413 !important;
        }

        .hud-status-pill.hud-btn-unknown.is-active-unknown {
          background: #F39120 !important;
          border-color: #F39120 !important;
          color: #141311 !important;
          font-weight: 800 !important;
        }

        .hud-status-pill:active {
          transform: translate(1px, 1px) !important;
          box-shadow: 0 0 0 transparent !important;
        }

        .hud-inspector-header {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: grab;
          user-select: none;
          color: rgba(245, 241, 232, 0.60);
        }

        .hud-sentence-words-box {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          background: #000000;
          border: 1.5px solid rgba(245, 241, 232, 0.14);
          border-radius: 8px;
          padding: 8px 12px;
          font-family: var(--font-japanese);
          font-size: 15px;
          line-height: 1.5;
          letter-spacing: 0.05em;
          user-select: none;
        }

        .hud-sentence-word-token {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          color: var(--warm-paper);
          transition: all 120ms ease;
          border-bottom: 2px solid transparent;
        }

        .hud-sentence-word-token:hover:not(.is-active) {
          background: rgba(226, 218, 194, 0.16);
          color: #F7E0BA;
        }

        .hud-sentence-word-token.is-active {
          background: var(--vermilion);
          color: #FFFFFF;
          font-weight: 700;
          border-radius: 6px;
          padding: 2px 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        }

        .hud-status-pill.is-active-known {
          background: rgba(78, 187, 123, 0.22) !important;
          color: var(--jade, #4EBB7B) !important;
          border-color: rgba(78, 187, 123, 0.65) !important;
        }

        .hud-status-pill.is-active-unknown {
          background: rgba(243, 145, 32, 0.22) !important;
          color: var(--heat-marker, #F39120) !important;
          border-color: rgba(243, 145, 32, 0.65) !important;
        }

        .hud-grammar-mine-btn {
          background: #4FBBBC !important;
          color: #000000 !important;
          border: 1.5px solid #151413 !important;
          box-shadow: 2px 2px 0 #151413 !important;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 700;
        }

        .hud-badge-jlpt {
          font-family: var(--font-badge);
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
          border: 1px solid rgba(0, 0, 0, 0.25);
          box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.4);
          background: var(--alpine-berry);
          color: var(--ink-black);
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }

        .hud-badge-jlpt.is-mined {
          background: var(--vermilion);
          color: #F5F1E8;
          border-color: rgba(0, 0, 0, 0.3);
        }
      `;
    }

    _applyPopupStyles() {
      if (!this.popupEl) return;
      this.popupEl.style.cssText = `
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 10px;
        min-width: 290px;
        max-width: 360px;
        padding: 12px 14px;
        background: #000000;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1.5px solid rgba(245, 241, 232, 0.16);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.90), 2px 2px 0 #151413;
        color: #F5F1E8;
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
      const jlptLevel = this.currentTargetToken.jlpt_level || "N4";
      const sentence = this.activeContextSentence || this.activeCue?.text || "";

      this.popupEl.innerHTML = `
        <div class="hud-popup-tabs">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="hud-inspector-header hud-drag-handle" title="Drag to move popover" style="cursor: grab; display: flex; align-items: center; color: rgba(245, 241, 232, 0.65); padding: 2px;">
              <svg width="10" height="13" viewBox="0 0 10 14" fill="none">
                <circle cx="3" cy="3" r="1.2" fill="currentColor"/>
                <circle cx="7" cy="3" r="1.2" fill="currentColor"/>
                <circle cx="3" cy="7" r="1.2" fill="currentColor"/>
                <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
                <circle cx="3" cy="11" r="1.2" fill="currentColor"/>
                <circle cx="7" cy="11" r="1.2" fill="currentColor"/>
              </svg>
            </div>
            <div class="hud-tabs-segmented" style="display:inline-flex; align-items:center; background:#1C1B19; border:1.5px solid rgba(245,241,232,0.22); border-radius:6px; padding:2px; gap:3px; box-shadow:1.5px 1.5px 0 #151413;">
              <button type="button" class="hud-tab-btn ${this.activeTab === "word" ? "is-active" : ""}" data-tab="word" style="background:${this.activeTab === "word" ? "#FAF8F5" : "rgba(245,241,232,0.08)"}; color:${this.activeTab === "word" ? "#141311" : "rgba(245,241,232,0.75)"}; font-weight:${this.activeTab === "word" ? "800" : "700"}; border:${this.activeTab === "word" ? "1px solid #FAF8F5" : "1px solid rgba(245,241,232,0.16)"}; border-radius:4px; padding:4px 13px; font-size:11.5px; cursor:pointer; box-shadow:${this.activeTab === "word" ? "1.5px 1.5px 0 #151413" : "1px 1px 0 #151413"};">Word</button>
              <button type="button" class="hud-tab-btn ${this.activeTab === "grammar" ? "is-active" : ""}" data-tab="grammar" style="background:${this.activeTab === "grammar" ? "#FAF8F5" : "rgba(245,241,232,0.08)"}; color:${this.activeTab === "grammar" ? "#141311" : "rgba(245,241,232,0.75)"}; font-weight:${this.activeTab === "grammar" ? "800" : "700"}; border:${this.activeTab === "grammar" ? "1px solid #FAF8F5" : "1px solid rgba(245,241,232,0.16)"}; border-radius:4px; padding:4px 13px; font-size:11.5px; cursor:pointer; box-shadow:${this.activeTab === "grammar" ? "1.5px 1.5px 0 #151413" : "1px 1px 0 #151413"};">Grammar</button>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <button type="button" class="hud-action-icon-btn hud-popup-dict-btn" title="Search Dictionary" aria-label="Search Dictionary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
            </button>
            <button type="button" class="hud-action-icon-btn hud-popup-close-btn" title="Close" aria-label="Close">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>
            </button>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-word" style="display:${this.activeTab === "word" ? "flex" : "none"}; flex-direction:column; gap:9px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div class="hud-word-header" style="display:flex; flex-direction:column; gap:2px;">
              ${reading && reading !== surface ? `<div class="hud-reading-furigana" style="font-size:12px; color:rgba(245,241,232,0.70); font-family:'Zen Kaku Gothic New', sans-serif; letter-spacing:0.04em;">${escapeHtml(reading)}</div>` : ""}
              <div class="hud-headword-kanji" style="font-size:18px; font-weight:700; color:#F5F1E8; font-family:'Noto Sans JP', sans-serif; line-height:1.2;">
                ${escapeHtml(lemma || surface)}
                ${lemma && surface && lemma !== surface ? `<span style="font-size:12px; font-weight:400; color:rgba(245,241,232,0.60); margin-left:6px;">(${escapeHtml(surface)})</span>` : ""}
              </div>
            </div>
            <span class="hud-badge-jlpt ${status === "mined" ? "is-mined" : ""}">
              ${status === "mined" ? "Saved" : escapeHtml(jlptLevel)}
            </span>
          </div>

          <div class="hud-popup-meaning" style="font-size:12.5px; line-height:1.5; color:rgba(245,241,232,0.92); max-height:140px; overflow-y:auto; padding-right:4px;">
            Looking up…
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; gap:8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" tabindex="-1" class="tactile-btn hud-popup-mine-btn hud-btn-mine" style="background:#D94B38; color:#FAF8F5; border:1.5px solid rgba(255,255,255,0.35); border-radius:6px; padding:6px 14px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:2px 2px 0 #151413; display:inline-flex; align-items:center; gap:5px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>${status === "mined" ? "Saved" : "Save"}</span>
              </button>
            </div>
            <div class="hud-status-group" style="display:flex; gap:6px; align-items:center;">
              <button type="button" class="hud-status-pill hud-btn-known ${status === "known" ? "is-active-known" : ""}" data-status="known" style="background:${status === "known" ? "#4EBB7B" : "rgba(78, 187, 123, 0.14)"}; color:${status === "known" ? "#141311" : "#4EBB7B"}; border:1.5px solid ${status === "known" ? "#4EBB7B" : "rgba(78, 187, 123, 0.50)"}; border-radius:6px; padding:5px 12px; font-size:11.5px; font-weight:${status === "known" ? "800" : "700"}; cursor:pointer; box-shadow:2px 2px 0 #151413;">Known</button>
              <button type="button" class="hud-status-pill hud-btn-unknown ${status === "unknown" ? "is-active-unknown" : ""}" data-status="unknown" style="background:${status === "unknown" ? "#F39120" : "rgba(243, 145, 32, 0.14)"}; color:${status === "unknown" ? "#141311" : "#F39120"}; border:1.5px solid ${status === "unknown" ? "#F39120" : "rgba(243, 145, 32, 0.50)"}; border-radius:6px; padding:5px 12px; font-size:11.5px; font-weight:${status === "unknown" ? "800" : "700"}; cursor:pointer; box-shadow:2px 2px 0 #151413;">Unknown</button>
            </div>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-grammar" style="display:${this.activeTab === "grammar" ? "flex" : "none"}; flex-direction:column; gap:10px;">
          <div style="font-size:12px; font-weight:600; color:rgba(245,241,232,0.70); border-bottom:1px solid rgba(245,241,232,0.10); padding-bottom:5px;">
            Sentence Grammar Analysis
          </div>
          <div class="hud-grammar-content" style="font-size:13px; line-height:1.5; color:rgba(245,241,232,0.92); max-height:260px; overflow-y:auto; padding-right:6px; scrollbar-width:thin; scrollbar-color:rgba(79,187,188,0.35) transparent;">
            Analyzing sentence…
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:4px;">
            <button type="button" class="tactile-btn hud-grammar-mine-btn" style="background:#4FBBBC; color:#141311; font-weight:700; padding:6px 16px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
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
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "OPEN_DICTIONARY", term: lemma || surface }).catch(() => {});
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
          this.popupEl.style.minWidth = "290px";
          this.popupEl.style.maxWidth = "360px";
        }
      }

      tabBtns?.forEach((b) => {
        const isActive = b.dataset.tab === tab;
        b.classList.toggle("is-active", isActive);
        b.style.background = isActive ? "#FAF8F5" : "rgba(245, 241, 232, 0.08)";
        b.style.color = isActive ? "#141311" : "rgba(245, 241, 232, 0.75)";
        b.style.border = isActive ? "1px solid #FAF8F5" : "1px solid rgba(245, 241, 232, 0.16)";
        b.style.fontWeight = isActive ? "800" : "700";
        b.style.boxShadow = isActive ? "1.5px 1.5px 0 #151413" : "1px 1px 0 #151413";
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
            this._renderMeaning(resp.data);
          } else if (resp && resp.error) {
            this._renderMeaningError(resp.error);
          }
        }
      } catch (_) {
        this._renderMeaningError("Kiroku backend offline");
      }
    }

    async loadGrammarDetails() {
      const sentence = this.activeContextSentence || this.activeCue?.text || "";
      const grammarEl = this.popupEl?.querySelector(".hud-grammar-content");
      if (!grammarEl) return;

      if (!sentence) {
        grammarEl.innerHTML = `<span style="color:#a1a1aa;">No context sentence available for grammar analysis.</span>`;
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
            grammarEl.innerHTML = `<span style="color:#a1a1aa;">No distinct grammar patterns detected in sentence.</span>`;
          }
        }
      } catch (_) {
        grammarEl.innerHTML = `<span style="color:#f87171;">Grammar analysis unavailable</span>`;
      }
    }

    _extractPlainText(node) {
      if (!node) return "";
      if (typeof node === "string") {
        const s = node.trim();
        if (/^<.*object at 0x[0-9a-fA-F]+>$/i.test(s) || s === "[object Object]") return "";
        return s;
      }
      if (typeof node === "number" || typeof node === "boolean") return String(node);
      if (Array.isArray(node)) {
        return node.map((n) => this._extractPlainText(n)).filter(Boolean).join(", ");
      }
      if (typeof node === "object") {
        if (node.tag === "rt") return "";
        if (typeof node.text === "string" && node.text.trim()) return node.text.trim();
        if (node.content) return this._extractPlainText(node.content);
        if (node.glossary) return this._extractPlainText(node.glossary);
        if (node.meaning) return this._extractPlainText(node.meaning);
        if (node.definition) return this._extractPlainText(node.definition);
        if (node.definitions) return this._extractPlainText(node.definitions);
        if (node.meanings) return this._extractPlainText(node.meanings);
        if (node.translation) return this._extractPlainText(node.translation);
        if (Array.isArray(node.glosses)) return this._extractPlainText(node.glosses);
        if (Array.isArray(node.entries)) return this._extractPlainText(node.entries);
        if (Array.isArray(node.senses)) return this._extractPlainText(node.senses);
      }
      return "";
    }

    _renderMeaning(data) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      let lines = [];

      // 1. Check structured Yomitan entries/senses
      if (Array.isArray(data?.entries) && data.entries.length > 0) {
        for (const entry of data.entries) {
          if (Array.isArray(entry.senses)) {
            for (const sense of entry.senses) {
              if (Array.isArray(sense.glosses) && sense.glosses.length > 0) {
                const senseTexts = sense.glosses.map((g) => this._extractPlainText(g)).filter(Boolean);
                if (senseTexts.length > 0) {
                  lines.push(senseTexts.join(", "));
                }
              }
            }
          }
          if (lines.length >= 6) break;
        }
      }

      // 2. Fallback to glossary or definitions list
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

      // 3. Fallback to string meaning
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
          return `<div style="margin-bottom:3px;">${escapeHtml(clean)}</div>`;
        }
        if (lines.length > 1) {
          return `<div style="margin-bottom:3px;"><span style="color:rgba(245,241,232,0.5); font-weight:600; margin-right:4px;">${idx + 1}.</span>${escapeHtml(clean)}</div>`;
        }
        return `<div>• ${escapeHtml(clean)}</div>`;
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
        grammarEl.innerHTML = `<span style="color:rgba(245,241,232,0.60);">No matching grammar patterns found (or all hidden).</span>`;
        return;
      }

      this.grammarData = patterns[0];

      let html = `<div style="display:flex; flex-direction:column; gap:10px;">`;
      for (const p of patterns) {
        const title = p.pattern_display || p.pattern_key || p.text || p.display || p.pattern || p.title || "";
        const level = p.level || p.jlpt || "Grammar";
        const meaning = p.meaning_short || p.english_breakdown || p.meaning || p.explanation || "";
        const formation = p.formation ? `<div style="font-size:11px; background:rgba(79,187,188,0.12); color:#4FBBBC; padding:3px 8px; border-radius:4px; font-family:'Zen Kaku Gothic New', sans-serif;"><span style="opacity:0.75; font-weight:600; margin-right:4px;">Formation:</span>${escapeHtml(p.formation)}</div>` : "";
        const example = p.example_sentence ? `<div style="font-size:11.5px; color:rgba(245,241,232,0.70); font-family:var(--font-japanese); margin-top:2px; font-style:italic;">“${escapeHtml(p.example_sentence)}”</div>` : "";

        html += `
          <div class="hud-grammar-card" style="border-left:3.5px solid #4FBBBC; background:rgba(79,187,188,0.08); border-radius:0 8px 8px 0; padding:10px 12px; display:flex; flex-direction:column; gap:5px; border-top:1px solid rgba(79,187,188,0.15); border-right:1px solid rgba(79,187,188,0.15); border-bottom:1px solid rgba(79,187,188,0.15); transition: opacity 160ms ease, transform 160ms ease;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:700; font-size:14.5px; color:#4FBBBC; font-family:var(--font-japanese);">${escapeHtml(title)}</span>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="hud-badge-jlpt" style="font-size:10.5px; padding:2px 8px; background:rgba(79,187,188,0.22); color:#4FBBBC; border:1px solid rgba(79,187,188,0.45); border-radius:4px;">${escapeHtml(level)}</span>
                <button type="button" class="hud-grammar-dismiss-btn" data-key="${escapeHtml(title)}" data-pkey="${escapeHtml(p.pattern_key || title)}" title="Hide this grammar point (already known)" style="background:rgba(245,241,232,0.10); border:1px solid rgba(245,241,232,0.18); color:rgba(245,241,232,0.50); border-radius:50%; width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; line-height:1; padding:0;">×</button>
              </div>
            </div>
            <div style="font-size:12.5px; color:rgba(245,241,232,0.95); line-height:1.5;">${escapeHtml(meaning)}</div>
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
            mineBtn.style.background = "#4EBB7B";
          }
          this.currentTargetToken.status = "mined";

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
            grammarBtn.style.background = "#4EBB7B";
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
          p.style.background = status === "known" ? "#4EBB7B" : "#F39120";
          p.style.color = "#141311";
          p.style.borderColor = status === "known" ? "#4EBB7B" : "#F39120";
        } else {
          p.classList.remove("is-active-known", "is-active-unknown");
          if (pStatus === "known") {
            p.style.background = "rgba(78, 187, 123, 0.14)";
            p.style.color = "#4EBB7B";
            p.style.borderColor = "rgba(78, 187, 123, 0.50)";
          } else {
            p.style.background = "rgba(243, 145, 32, 0.14)";
            p.style.color = "#F39120";
            p.style.borderColor = "rgba(243, 145, 32, 0.50)";
          }
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
      if (typeof document !== "undefined") {
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
