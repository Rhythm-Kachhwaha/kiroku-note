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

      this._boundDocKeyDown = this._onDocKeyDown.bind(this);
      this._boundDocClick = this._onDocClick.bind(this);
      this._boundReposition = this.reposition.bind(this);

      this.init();
    }

    init() {
      if (typeof document === "undefined") return;

      if (this.hudHost?.contentContainer) {
        // Mounted inside video HUD host
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

        .hud-popup-tabs {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(245, 241, 232, 0.10);
          padding-bottom: 6px;
        }

        .hud-tab-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(245, 241, 232, 0.05);
          border: 1px solid var(--subtle-border);
          padding: 3px 12px;
          border-radius: 5px;
          font-size: 12px;
          font-weight: 600;
          color: rgba(245, 241, 232, 0.65);
          cursor: pointer;
          transform: translate(-1px, -1px);
          box-shadow: 1px 1px 0 var(--tactile-stroke);
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease;
        }

        .hud-tab-btn.is-active {
          background: rgba(245, 241, 232, 0.16);
          border-color: rgba(245, 241, 232, 0.25);
          color: var(--warm-paper);
          font-weight: 700;
        }

        .hud-tab-btn:hover:not(.is-active) {
          transform: translate(-1.5px, -1.5px);
          box-shadow: 1.5px 1.5px 0 var(--tactile-stroke);
          color: var(--warm-paper);
          background: rgba(245, 241, 232, 0.10);
        }

        .hud-tab-btn:active {
          transform: translate(0, 0);
          box-shadow: 0 0 0 transparent;
        }

        .hud-action-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          background: none;
          border: none;
          color: rgba(245, 241, 232, 0.60);
          cursor: pointer;
          user-select: none;
          transition: color 120ms ease;
        }

        .hud-action-icon-btn:hover {
          color: var(--warm-paper);
        }

        .tactile-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 16px;
          font-size: 12px;
          font-weight: 700;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          cursor: pointer;
          user-select: none;
          transform: translate(-2px, -2px);
          box-shadow: 2px 2px 0 var(--tactile-stroke);
          transition: transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease, background-color 140ms ease;
        }

        .tactile-btn:hover {
          transform: translate(-2.5px, -2.5px);
          box-shadow: 2.5px 2.5px 0 var(--tactile-stroke);
        }

        .tactile-btn:active {
          transform: translate(0, 0);
          box-shadow: 0 0 0 transparent;
        }

        .hud-popup-mine-btn {
          background: var(--vermilion);
          color: #F5F1E8;
          border-color: rgba(255, 255, 255, 0.22);
        }

        .hud-popup-mine-btn:hover {
          background: var(--vermilion-hover);
        }

        .hud-status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 5px 11px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 5px;
          border: 1px solid var(--subtle-border);
          background: var(--ink-surface);
          color: rgba(245, 241, 232, 0.70);
          cursor: pointer;
          transform: translate(-1.5px, -1.5px);
          box-shadow: 1.5px 1.5px 0 var(--tactile-stroke);
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease;
        }

        .hud-status-pill:hover {
          transform: translate(-2px, -2px);
          box-shadow: 2px 2px 0 var(--tactile-stroke);
          color: var(--warm-paper);
          background: rgba(245, 241, 232, 0.10);
        }

        .hud-status-pill:active {
          transform: translate(0, 0);
          box-shadow: 0 0 0 transparent;
        }

        .hud-status-pill.is-active-known {
          background: rgba(78, 187, 123, 0.22);
          color: var(--jade);
          border-color: rgba(78, 187, 123, 0.55);
        }

        .hud-status-pill.is-active-unknown {
          background: rgba(243, 145, 32, 0.22);
          color: var(--heat-marker);
          border-color: rgba(243, 145, 32, 0.55);
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
        background: rgba(28, 27, 25, 0.98);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(245, 241, 232, 0.12);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75), 2px 2px 0 #151413;
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
      this.currentTargetToken = token;
      this.currentTargetSpan = targetSpan || null;
      this.fixedAnchorPoint = null;
      this.activeCue = cue;
      this.activeContextSentence = contextSentence || cue?.text || "";
      this.isOpen = true;
      this.activeTab = "word";
      this.render();
      this.reposition();
    }

    async showAtPoint(x, y, token, contextSentence = "") {
      if (!token) return;
      this.currentTargetToken = token;
      this.currentTargetSpan = null;
      this.fixedAnchorPoint = { x, y };
      this.activeCue = null;
      this.activeContextSentence = contextSentence || "";
      this.isOpen = true;
      this.activeTab = "word";
      this.render();
      this.reposition();
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
          <div style="display:flex; gap:6px;">
            <button type="button" class="hud-tab-btn ${this.activeTab === "word" ? "is-active" : ""}" data-tab="word">Word</button>
            <button type="button" class="hud-tab-btn ${this.activeTab === "grammar" ? "is-active" : ""}" data-tab="grammar">Grammar</button>
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
              <div class="hud-headword-kanji" style="font-size:18px; font-weight:700; color:#F5F1E8; font-family:'Noto Sans JP', sans-serif; line-height:1.2;">${escapeHtml(surface)}</div>
            </div>
            <span class="hud-badge-jlpt ${status === "mined" ? "is-mined" : ""}">
              ${status === "mined" ? "Saved" : escapeHtml(jlptLevel)}
            </span>
          </div>

          <div class="hud-popup-meaning" style="font-size:12.5px; line-height:1.45; color:rgba(245,241,232,0.88); max-height:100px; overflow-y:auto; padding-right:4px;">
            Looking up…
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap:8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" tabindex="-1" class="tactile-btn hud-popup-mine-btn hud-btn-mine">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                <span>${status === "mined" ? "Saved" : "Save"}</span>
              </button>
            </div>
            <div class="hud-status-group" style="display:flex; gap:6px; align-items:center;">
              <button type="button" class="hud-status-pill hud-btn-known ${status === "known" ? "is-active-known" : ""}" data-status="known">Known</button>
              <button type="button" class="hud-status-pill hud-btn-unknown ${status === "unknown" ? "is-active-unknown" : ""}" data-status="unknown">Unknown</button>
            </div>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-grammar" style="display:${this.activeTab === "grammar" ? "flex" : "none"}; flex-direction:column; gap:9px;">
          <div style="font-size:12px; color:rgba(245,241,232,0.70); border-bottom:1px solid rgba(245,241,232,0.08); padding-bottom:4px;">
            Sentence Grammar Analysis
          </div>
          <div class="hud-grammar-content" style="font-size:12px; line-height:1.45; color:rgba(245,241,232,0.85); max-height:130px; overflow-y:auto;">
            Analyzing sentence…
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:2px;">
            <button type="button" class="tactile-btn hud-grammar-mine-btn" style="background:#4FBBBC; color:#141311;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Mine Grammar</span>
            </button>
          </div>
        </div>
      `;

      this.popupEl.style.display = "flex";

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

      tabBtns?.forEach((b) => {
        if (b.dataset.tab === tab) {
          b.classList.add("is-active");
        } else {
          b.classList.remove("is-active");
        }
      });

      if (tab === "grammar") {
        this.loadGrammarDetails();
      }

      this.reposition();
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

    _renderMeaning(data) {
      if (!this.popupEl) return;
      const meaningEl = this.popupEl.querySelector(".hud-popup-meaning");
      if (!meaningEl) return;
      let gloss = "";
      if (Array.isArray(data.glossary)) {
        gloss = data.glossary.map((g) => `• ${escapeHtml(g)}`).join("<br>");
      } else if (Array.isArray(data.entries) && data.entries[0]?.glossary) {
        gloss = data.entries[0].glossary.map((g) => `• ${escapeHtml(g)}`).join("<br>");
      } else if (typeof data.glossary === "string" && data.glossary.trim()) {
        gloss = data.glossary.split(/;\s*|\n+/).filter(Boolean).map((g) => `• ${escapeHtml(g.trim())}`).join("<br>");
      } else if (data.meaning) {
        gloss = data.meaning.split(/;\s*|\n+/).filter(Boolean).map((g) => `• ${escapeHtml(g.trim())}`).join("<br>");
      } else {
        gloss = "No definition found.";
      }
      meaningEl.innerHTML = gloss;
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

      const patterns = Array.isArray(data.patterns) ? data.patterns : (data.matches || []);
      if (!patterns.length) {
        grammarEl.innerHTML = `<span style="color:rgba(245,241,232,0.60);">No matching grammar patterns found.</span>`;
        return;
      }

      this.grammarData = patterns[0];

      let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
      for (const p of patterns) {
        html += `
          <div style="border-left:3px solid #4FBBBC; padding-left:8px; background:rgba(79,187,188,0.06); border-radius:0 4px 4px 0; padding:6px 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
              <span style="font-weight:700; color:#4FBBBC; font-family:var(--font-japanese);">${escapeHtml(p.display || p.pattern || p.title || "")}</span>
              <span class="hud-badge-jlpt" style="font-size:10px; padding:1px 5px; background:rgba(79,187,188,0.2); color:#4FBBBC; border:1px solid rgba(79,187,188,0.4);">${escapeHtml(p.level || "Grammar")}</span>
            </div>
            <div style="font-size:11.5px; color:rgba(245,241,232,0.85); line-height:1.4;">${escapeHtml(p.meaning || p.explanation || "")}</div>
          </div>
        `;
      }
      html += `</div>`;
      grammarEl.innerHTML = html;
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
        if (p.dataset.status === status) {
          p.classList.add(status === "known" ? "is-active-known" : "is-active-unknown");
          p.classList.remove(status === "known" ? "is-active-unknown" : "is-active-known");
          p.style.background = status === "known" ? "rgba(78, 187, 123, 0.22)" : "rgba(243, 145, 32, 0.22)";
          p.style.color = status === "known" ? "#4EBB7B" : "#F39120";
          p.style.borderColor = status === "known" ? "rgba(78, 187, 123, 0.55)" : "rgba(243, 145, 32, 0.55)";
        } else {
          p.classList.remove("is-active-known", "is-active-unknown");
          p.style.background = "#1C1B19";
          p.style.color = "rgba(245, 241, 232, 0.70)";
          p.style.borderColor = "rgba(245, 241, 232, 0.12)";
        }
      });
    }

    reposition() {
      if (!this.isOpen || !this.popupEl) return;
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

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (this.popupEl) {
        this.popupEl.style.display = "none";
      }
      this.currentTargetToken = null;
      this.currentTargetSpan = null;
      this.fixedAnchorPoint = null;
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
