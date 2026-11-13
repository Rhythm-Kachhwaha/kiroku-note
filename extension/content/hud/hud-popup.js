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
      document.addEventListener("pointerdown", this._boundDocClick, true);
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
          --pure-black: #09090b;
          --warm-paper: #F5F1E8;
          --vermilion: #D94B38;
          --vermilion-hover: #C53E2D;
          --ink-surface: #18181b;
          --elevated-surface: #27272a;
          --tactile-stroke: rgba(255, 255, 255, 0.16);
          --tactile-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
          --accent-primary: #d4884f;
          --accent-primary-hover: #e0945b;
          --accent-grammar: #818cf8;
          --jade: #4EBB7B;
          --text-primary: #f4f4f5;
          --text-secondary: #a1a1aa;
          --text-muted: #71717a;
          --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --font-japanese: "Zen Kaku Gothic New", -apple-system, sans-serif;
          --font-kanji: "Noto Sans JP", sans-serif;
          --font-badge: "Mochiy Pop One", "Zen Kaku Gothic New", sans-serif;
        }

        .kiroku-hud-popup {
          position: fixed;
          display: none;
          flex-direction: column;
          gap: 10px;
          min-width: 260px;
          max-width: 340px;
          padding: 12px 14px;
          background: rgba(24, 24, 27, 0.96);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid var(--tactile-stroke);
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 3px 3px 0 rgba(0, 0, 0, 0.8);
          color: var(--text-primary);
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
          gap: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 6px;
        }

        .hud-tab-btn {
          background: none;
          border: none;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background-color 140ms ease, color 140ms ease;
        }

        .hud-tab-btn.is-active {
          background: rgba(255, 255, 255, 0.12);
          color: var(--text-primary);
        }

        .hud-tab-btn:hover:not(.is-active) {
          color: var(--text-primary);
        }

        .tactile-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          border: 1px solid var(--tactile-stroke);
          box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.6);
          cursor: pointer;
          user-select: none;
          transition: transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms ease, background-color 140ms ease;
        }

        .tactile-btn:hover {
          transform: translate(-1px, -1px);
          box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.6);
        }

        .tactile-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 0 0 0 transparent;
        }

        .hud-popup-mine-btn {
          background: var(--accent-primary);
          color: #18181b;
        }

        .hud-popup-mine-btn:hover {
          background: var(--accent-primary-hover);
        }

        .hud-status-pill {
          padding: 2px 6px;
          font-size: 10px;
          font-weight: 600;
          border-radius: 4px;
          border: 1px solid var(--tactile-stroke);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 140ms ease;
        }

        .hud-status-pill.is-active-known {
          background: rgba(78, 187, 123, 0.2);
          color: #4ebb7b;
          border-color: rgba(78, 187, 123, 0.4);
        }

        .hud-badge-jlpt {
          font-family: var(--font-badge);
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid var(--tactile-stroke);
          box-shadow: 1px 1px 0 rgba(0, 0, 0, 0.5);
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-secondary);
        }

        .hud-badge-jlpt.is-mined {
          background: rgba(212, 136, 79, 0.25);
          color: var(--accent-primary);
          border-color: rgba(212, 136, 79, 0.4);
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
        min-width: 260px;
        max-width: 340px;
        padding: 12px 14px;
        background: rgba(24, 24, 27, 0.96);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 3px 3px 0 rgba(0, 0, 0, 0.8);
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
      if (this.currentTargetSpan && this.currentTargetSpan.contains(e.target)) return;
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

      this.popupEl.innerHTML = `
        <div class="hud-popup-tabs" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; gap:6px;">
            <button type="button" class="hud-tab-btn ${this.activeTab === "word" ? "is-active" : ""}" data-tab="word" style="background:${this.activeTab === "word" ? "rgba(255,255,255,0.15)" : "none"}; border:none; color:#f4f4f5; font-size:12px; font-weight:600; padding:2px 8px; border-radius:4px; cursor:pointer;">Word</button>
            <button type="button" class="hud-tab-btn ${this.activeTab === "grammar" ? "is-active" : ""}" data-tab="grammar" style="background:${this.activeTab === "grammar" ? "rgba(255,255,255,0.15)" : "none"}; border:none; color:#a1a1aa; font-size:12px; font-weight:600; padding:2px 8px; border-radius:4px; cursor:pointer;">Grammar</button>
          </div>
          <button type="button" class="hud-popup-close-btn" style="background:none; border:none; color:#71717a; font-size:14px; cursor:pointer; padding:2px 4px; display:inline-flex; align-items:center;" aria-label="Close"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
        </div>

        <div class="hud-tab-pane hud-pane-word" style="display:${this.activeTab === "word" ? "flex" : "none"}; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div>
              <div style="font-size:17px; font-weight:700; color:#f4f4f5; font-family:'Noto Sans JP', sans-serif;">${escapeHtml(surface)}</div>
              ${reading && reading !== surface ? `<div style="font-size:12px; color:#a1a1aa; font-family:'Zen Kaku Gothic New', sans-serif;">${escapeHtml(reading)}</div>` : ""}
            </div>
            <span class="hud-badge-jlpt ${status === "mined" ? "is-mined" : ""}" style="font-size:11px; padding:2px 6px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:${status === "mined" ? "rgba(212,136,79,0.25)" : "rgba(255,255,255,0.08)"}; color:${status === "mined" ? "#d4884f" : "#a1a1aa"};">
              ${status === "mined" ? "Mined" : escapeHtml(jlptLevel)}
            </span>
          </div>

          <div class="hud-popup-meaning" style="font-size:12px; line-height:1.45; color:#d4d4d8; max-height:85px; overflow-y:auto; padding-right:4px;">
            Looking up…
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px; gap:6px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <button type="button" tabindex="-1" class="tactile-btn hud-popup-mine-btn" style="
                display:inline-flex; align-items:center; gap:5px;
                padding:5px 12px; background:#d4884f; color:#18181b;
                border:1px solid rgba(255,255,255,0.2); border-radius:6px; font-size:12px; font-weight:700;
                cursor:pointer;
              ">
                ${status === "mined" ? "Already Mined" : "Mine Word"}
              </button>
            </div>
            <div class="hud-status-group" style="display:flex; gap:3px;">
              <button type="button" class="hud-status-pill" data-status="known" style="padding:2px 6px; font-size:10px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:#18181b; color:#a1a1aa; cursor:pointer;">Known</button>
              <button type="button" class="hud-status-pill" data-status="unknown" style="padding:2px 6px; font-size:10px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:#18181b; color:#a1a1aa; cursor:pointer;">Unknown</button>
            </div>
          </div>
        </div>

        <div class="hud-tab-pane hud-pane-grammar" style="display:${this.activeTab === "grammar" ? "flex" : "none"}; flex-direction:column; gap:8px;">
          <div style="font-size:12px; color:#a1a1aa; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:4px;">
            Sentence Grammar Analysis
          </div>
          <div class="hud-grammar-content" style="font-size:12px; line-height:1.45; color:#d4d4d8; max-height:110px; overflow-y:auto;">
            Analyzing sentence…
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:2px;">
            <button type="button" class="tactile-btn hud-grammar-mine-btn" style="
              display:inline-flex; align-items:center; gap:5px;
              padding:5px 12px; background:#818cf8; color:#09090b;
              border:1px solid rgba(255,255,255,0.2); border-radius:6px; font-size:12px; font-weight:700;
              cursor:pointer;
            ">
              Mine Grammar
            </button>
          </div>
        </div>
      `;

      this.popupEl.style.display = "flex";

      // Attach tab events
      if (typeof this.popupEl.querySelectorAll === "function") {
        this.popupEl.querySelectorAll(".hud-tab-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const tab = btn.dataset.tab;
            if (tab) this.switchTab(tab);
          });
        });
      }

      this.popupEl.querySelector?.(".hud-popup-close-btn")?.addEventListener("click", () => this.close());

      // Wire mine button
      const mineBtn = this.popupEl.querySelector?.(".hud-popup-mine-btn");
      if (mineBtn) {
        if (status === "mined") {
          mineBtn.disabled = true;
          mineBtn.style.opacity = "0.7";
        } else {
          mineBtn.addEventListener("click", () => this.mineCurrentWord());
        }
      }

      // Wire grammar mine button
      const grammarMineBtn = this.popupEl.querySelector?.(".hud-grammar-mine-btn");
      if (grammarMineBtn) {
        grammarMineBtn.addEventListener("click", () => this.mineCurrentGrammar());
      }

      // Wire status pills
      if (typeof this.popupEl.querySelectorAll === "function") {
        this.popupEl.querySelectorAll(".hud-status-pill").forEach((pill) => {
          pill.addEventListener("click", (e) => {
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
          b.style.background = "rgba(255,255,255,0.15)";
          b.style.color = "#f4f4f5";
        } else {
          b.style.background = "none";
          b.style.color = "#a1a1aa";
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
      const gloss = data.glossary || data.meaning || (Array.isArray(data.entries) ? data.entries[0]?.glossary?.join?.("; ") : "") || "No definition found.";
      meaningEl.textContent = gloss;
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
        grammarEl.innerHTML = `<span style="color:#a1a1aa;">No matching grammar patterns found.</span>`;
        return;
      }

      this.grammarData = patterns[0];

      let html = `<div style="display:flex; flex-direction:column; gap:6px;">`;
      for (const p of patterns) {
        html += `
          <div style="border-left:2px solid #818cf8; padding-left:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:700; color:#818cf8;">${escapeHtml(p.display || p.pattern || p.title || "")}</span>
              <span style="font-size:10px; color:#a1a1aa;">${escapeHtml(p.level || "Grammar")}</span>
            </div>
            <div style="font-size:11px; color:#d4d4d8;">${escapeHtml(p.meaning || p.explanation || "")}</div>
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
        mineBtn.textContent = "Mining…";
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
            mineBtn.textContent = "Mined!";
            mineBtn.style.background = "#22c55e";
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
            mineBtn.textContent = "Mine Word";
          }
        }
      } catch (_) {
        if (mineBtn) {
          mineBtn.disabled = false;
          mineBtn.textContent = "Mine Word";
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
        grammarBtn.textContent = "Mining…";
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
            grammarBtn.textContent = "Mined!";
            grammarBtn.style.background = "#22c55e";
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
          const pills = this.popupEl?.querySelectorAll(".hud-status-pill");
          pills?.forEach((p) => {
            if (p.dataset.status === status) {
              p.style.background = status === "known" ? "rgba(78, 187, 123, 0.2)" : "rgba(243, 145, 32, 0.2)";
              p.style.color = status === "known" ? "#4ebb7b" : "#f39120";
            } else {
              p.style.background = "#18181b";
              p.style.color = "#a1a1aa";
            }
          });
        }
      } catch (_) {}
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
