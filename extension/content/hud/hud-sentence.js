/**
 * Kiroku Note - HUD Sentence Actions
 *
 * Responsibilities:
 * - Save active sentence as example / card
 * - Mine selected words
 * - Mine whole sentence (findMostProminentWord / identify)
 * - Open Grammar panel
 * - Jump to sidepanel transcript
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HudSentence = exports.HudSentence;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class HudSentence {
    constructor(hudHost, hudState) {
      this.hudHost = hudHost;
      this.hudState = hudState;
      this.toolbarEl = null;
      this.currentCue = null;
      this.init();
    }

    init() {
      if (typeof document === "undefined") return;

      this.toolbarEl = document.createElement("div");
      this.toolbarEl.className = "kiroku-hud-sentence-bar";
      this.toolbarEl.style.display = "none";
      this.toolbarEl.style.cssText = `
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        display: none;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: rgba(24, 24, 27, 0.9);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        z-index: 2147483646;
        pointer-events: auto;
      `;

      // Prevent video player play/pause toggle when interacting with sentence action bar
      const stopEvent = (e) => {
        if (e && typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      };
      this.toolbarEl.addEventListener("pointerdown", stopEvent);
      this.toolbarEl.addEventListener("mousedown", stopEvent);
      this.toolbarEl.addEventListener("click", stopEvent);

      this.toolbarEl.innerHTML = `
        <button class="hud-sent-btn btn-mine-sentence" title="Mine whole sentence" style="
          padding: 4px 8px; font-size: 11px; font-weight: 500; border: none; border-radius: 4px;
          background: #d4884f; color: #18181b; cursor: pointer;
        ">Mine Sentence</button>
        <button class="hud-sent-btn btn-grammar" title="Look up sentence grammar" style="
          padding: 4px 8px; font-size: 11px; font-weight: 500; border: none; border-radius: 4px;
          background: rgba(255,255,255,0.12); color: #f4f4f5; cursor: pointer;
        ">Grammar</button>
        <button class="hud-sent-btn btn-transcript" title="Jump to transcript" style="
          padding: 4px 8px; font-size: 11px; font-weight: 500; border: none; border-radius: 4px;
          background: rgba(255,255,255,0.12); color: #f4f4f5; cursor: pointer;
        ">Transcript</button>
      `;

      if (this.hudHost?.contentContainer) {
        this.hudHost.contentContainer.appendChild(this.toolbarEl);
      }

      this._wireEvents();

      if (this.hudHost) {
        this.hudHost.registerCleanup(() => this.destroy());
      }
    }

    _wireEvents() {
      const mineBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-mine-sentence") : null;
      const grammarBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-grammar") : null;
      const transcriptBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-transcript") : null;

      if (mineBtn) {
        mineBtn.addEventListener("click", () => this.mineSentence());
      }
      if (grammarBtn) {
        grammarBtn.addEventListener("click", () => this.openGrammar());
      }
      if (transcriptBtn) {
        transcriptBtn.addEventListener("click", () => this.jumpToTranscript());
      }
    }

    setCue(cue) {
      this.currentCue = cue ? { ...cue } : null;
      if (!this.toolbarEl) return;

      const hasText = Boolean(this.currentCue && this.currentCue.text && this.currentCue.text.trim());
      this.toolbarEl.style.display = hasText ? "flex" : "none";
    }

    async mineSentence() {
      if (!this.currentCue || !this.currentCue.text) return;
      const sentence = this.currentCue.text.trim();

      const mineBtn = this.toolbarEl?.querySelector(".btn-mine-sentence");
      if (mineBtn) {
        mineBtn.disabled = true;
        mineBtn.textContent = "Mining…";
      }

      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          // Send capture request for the sentence
          await chrome.runtime.sendMessage({
            type: "JAPANESE_TEXT_CAPTURED",
            text: sentence,
            source: "hud_sentence_mine",
            sourceType: "video",
            cue: { ...this.currentCue }
          });
        }
        if (mineBtn) {
          mineBtn.textContent = "Mined!";
          setTimeout(() => {
            if (mineBtn) {
              mineBtn.disabled = false;
              mineBtn.textContent = "Mine Sentence";
            }
          }, 2000);
        }
      } catch (err) {
        if (mineBtn) {
          mineBtn.disabled = false;
          mineBtn.textContent = "Mine Sentence";
        }
      }
    }

    async openGrammar() {
      if (!this.currentCue || !this.currentCue.text) return;
      const sentence = this.currentCue.text.trim();
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          await chrome.runtime.sendMessage({
            type: "SP_OPEN_GRAMMAR",
            text: sentence
          });
        }
      } catch (_) {}
    }

    async jumpToTranscript() {
      if (!this.currentCue) return;
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          await chrome.runtime.sendMessage({
            type: "SP_SCROLL_TRANSCRIPT",
            cue: { ...this.currentCue }
          });
        }
      } catch (_) {}
    }

    destroy() {
      if (this.toolbarEl && this.toolbarEl.parentElement) {
        this.toolbarEl.parentElement.removeChild(this.toolbarEl);
      }
      this.toolbarEl = null;
      this.currentCue = null;
    }
  }

  return { HudSentence };
});
