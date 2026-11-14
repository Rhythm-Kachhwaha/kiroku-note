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
      this.cues = [];
      this._originalCue = null;
      this.isMerged = false;
      this.init();
    }

    setCues(cues) {
      this.cues = Array.isArray(cues) ? cues : [];
    }

    _getCues() {
      if (Array.isArray(this.cues) && this.cues.length > 0) return this.cues;
      if (Array.isArray(this.hudHost?.cues) && this.hudHost.cues.length > 0) return this.hudHost.cues;
      return [];
    }

    init() {
      if (typeof document === "undefined") return;

      this.toolbarEl = document.createElement("div");
      this.toolbarEl.className = "kiroku-hud-sentence-bar";
      this.toolbarEl.style.display = "none";
      this.toolbarEl.style.cssText = `
        position: absolute;
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        display: none;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        background: rgba(28, 27, 25, 0.94);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(245, 241, 232, 0.16);
        border-radius: 9999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 1.5px 1.5px 0 #11100E;
        z-index: 2147483646;
        pointer-events: auto;
        opacity: 0.92;
        transition: opacity 140ms ease, transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      `;

      this.toolbarEl.addEventListener("mouseenter", () => {
        this.toolbarEl.style.opacity = "1";
      });
      this.toolbarEl.addEventListener("mouseleave", () => {
        this.toolbarEl.style.opacity = "0.92";
      });

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
        <button type="button" tabindex="-1" class="hud-sent-btn btn-merge-prev" title="Merge with previous line" style="
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11px; font-weight: 500;
          border: 1px solid rgba(245, 241, 232, 0.14); border-radius: 6px;
          background: rgba(245, 241, 232, 0.08); color: #F5F1E8; cursor: pointer;
          box-shadow: 1px 1px 0 #11100E; transition: all 120ms ease;
        ">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">
            <line x1="14" y1="8" x2="4" y2="8"></line>
            <polyline points="8 4 4 8 8 12"></polyline>
            <line x1="2" y1="3" x2="2" y2="13"></line>
          </svg>
          <span>Prev</span>
        </button>
        <button type="button" tabindex="-1" class="hud-sent-btn btn-merge-next" title="Merge with next line" style="
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11px; font-weight: 500;
          border: 1px solid rgba(245, 241, 232, 0.14); border-radius: 6px;
          background: rgba(245, 241, 232, 0.08); color: #F5F1E8; cursor: pointer;
          box-shadow: 1px 1px 0 #11100E; transition: all 120ms ease;
        ">
          <span>Next</span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">
            <line x1="2" y1="8" x2="12" y2="8"></line>
            <polyline points="8 4 12 8 8 12"></polyline>
            <line x1="14" y1="3" x2="14" y2="13"></line>
          </svg>
        </button>
        <button type="button" tabindex="-1" class="hud-sent-btn btn-unmerge" title="Reset / Unmerge cue" style="
          display: none; padding: 4px 8px; font-size: 11px; font-weight: 500;
          border: 1px solid rgba(245, 241, 232, 0.2); border-radius: 6px;
          background: rgba(245, 241, 232, 0.14); color: #F5F1E8; cursor: pointer;
          box-shadow: 1px 1px 0 #11100E; transition: all 120ms ease;
        ">Reset</button>
        <button type="button" tabindex="-1" class="hud-sent-btn btn-mine-sentence" title="Save sentence to Kiroku" style="
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 11px; font-weight: 600;
          border: 1px solid rgba(245, 241, 232, 0.25); border-radius: 6px;
          background: #D94B38; color: #FAF8F5; cursor: pointer;
          box-shadow: 1.5px 1.5px 0 #11100E; transition: all 120ms ease;
        ">Save Sentence</button>
        <button type="button" tabindex="-1" class="hud-sent-btn btn-grammar" title="Look up sentence grammar" style="
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11px; font-weight: 500;
          border: 1px solid rgba(245, 241, 232, 0.14); border-radius: 6px;
          background: rgba(245, 241, 232, 0.08); color: #F5F1E8; cursor: pointer;
          box-shadow: 1px 1px 0 #11100E; transition: all 120ms ease;
        ">Grammar</button>
        <button type="button" tabindex="-1" class="hud-sent-btn btn-transcript" title="Jump to transcript" style="
          display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11px; font-weight: 500;
          border: 1px solid rgba(245, 241, 232, 0.14); border-radius: 6px;
          background: rgba(245, 241, 232, 0.08); color: #F5F1E8; cursor: pointer;
          box-shadow: 1px 1px 0 #11100E; transition: all 120ms ease;
        ">Transcript</button>
      `;

      // Attach tactile press listeners to buttons
      if (typeof this.toolbarEl.querySelectorAll === "function") {
        const btns = this.toolbarEl.querySelectorAll(".hud-sent-btn");
        btns.forEach((btn) => {
          btn.addEventListener("pointerdown", () => {
            btn.style.transform = "translate(1px, 1px)";
            btn.style.boxShadow = "none";
          });
          const resetBtnState = () => {
            btn.style.transform = "none";
            btn.style.boxShadow = btn.classList?.contains?.("btn-mine-sentence") ? "1.5px 1.5px 0 #11100E" : "1px 1px 0 #11100E";
          };
          btn.addEventListener("pointerup", resetBtnState);
          btn.addEventListener("pointercancel", resetBtnState);
          btn.addEventListener("mouseleave", resetBtnState);
        });
      }

      this.badgeEl = document.createElement("span");
      this.badgeEl.className = "hud-1t-badge";
      this.badgeEl.style.display = "none";
      this.badgeEl.style.width = "7px";
      this.badgeEl.style.height = "7px";
      this.badgeEl.style.borderRadius = "50%";
      this.badgeEl.style.marginRight = "2px";
      this.toolbarEl.appendChild(this.badgeEl);

      if (this.hudHost?.contentContainer) {
        this.hudHost.contentContainer.appendChild(this.toolbarEl);
      }

      this._wireEvents();

      if (this.hudState && typeof this.hudState.subscribe === "function") {
        this._unsubState = this.hudState.subscribe((state) => {
          this.setCue(state.activeCue);
        });
      }

      if (this.hudHost) {
        this.hudHost.registerCleanup(() => this.destroy());
      }
    }

    _wireEvents() {
      const mineBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-mine-sentence") : null;
      const grammarBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-grammar") : null;
      const transcriptBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-transcript") : null;
      const mergePrevBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-merge-prev") : null;
      const mergeNextBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-merge-next") : null;
      const unmergeBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-unmerge") : null;

      if (mineBtn) {
        mineBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.mineSentence();
        });
      }
      if (grammarBtn) {
        grammarBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.openGrammar();
        });
      }
      if (transcriptBtn) {
        transcriptBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.jumpToTranscript();
        });
      }
      if (mergePrevBtn) {
        mergePrevBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.mergeWithPrevious();
        });
      }
      if (mergeNextBtn) {
        mergeNextBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.mergeWithNext();
        });
      }
      if (unmergeBtn) {
        unmergeBtn.addEventListener("click", (e) => {
          if (e?.target?.blur) e.target.blur();
          this.unmerge();
        });
      }
    }

    _findCurrentCueIndex() {
      const cues = this._getCues();
      if (!this.currentCue || !Array.isArray(cues) || cues.length === 0) return -1;
      const target = this._originalCue || this.currentCue;
      let idx = cues.indexOf(target);
      if (idx !== -1) return idx;
      if (typeof target.i === "number" && target.i >= 0 && target.i < cues.length) return target.i;
      return cues.findIndex(c => {
        if (!c) return false;
        return c.text === target.text && Math.abs((c.startTime || c.s || 0) - (target.startTime || target.s || 0)) < 0.1;
      });
    }

    _getCueStart(c) {
      if (!c) return 0;
      if (typeof c.startTime === "number") return c.startTime;
      if (typeof c.start === "number") return c.start > 10000 ? c.start / 1000 : c.start;
      if (typeof c.startMs === "number") return c.startMs / 1000;
      if (typeof c.s === "number") return c.s;
      return 0;
    }

    _getCueEnd(c) {
      if (!c) return 0;
      if (typeof c.endTime === "number") return c.endTime;
      if (typeof c.end === "number") return c.end > 10000 ? c.end / 1000 : c.end;
      if (typeof c.endMs === "number") return c.endMs / 1000;
      if (typeof c.e === "number") return c.e;
      return this._getCueStart(c) + 2;
    }

    mergeWithPrevious() {
      const cues = this._getCues();
      const idx = this._findCurrentCueIndex();
      if (idx > 0) {
        const prevCue = cues[idx - 1];
        if (!this._originalCue) {
          this._originalCue = { ...this.currentCue };
        }
        const combinedText = `${prevCue.text || ""} ${this.currentCue.text || ""}`.trim();
        const start = Math.min(this._getCueStart(prevCue), this._getCueStart(this.currentCue));
        const end = Math.max(this._getCueEnd(prevCue), this._getCueEnd(this.currentCue));

        this.isMerged = true;
        this.currentCue = {
          ...this.currentCue,
          text: combinedText,
          startTime: start,
          endTime: end,
          startMs: Math.round(start * 1000),
          endMs: Math.round(end * 1000),
          _mergedWithPrev: true
        };
        this._updateMergedUI();
      }
    }

    mergeWithNext() {
      const cues = this._getCues();
      const idx = this._findCurrentCueIndex();
      if (idx >= 0 && idx < cues.length - 1) {
        const nextCue = cues[idx + 1];
        if (!this._originalCue) {
          this._originalCue = { ...this.currentCue };
        }
        const combinedText = `${this.currentCue.text || ""} ${nextCue.text || ""}`.trim();
        const start = Math.min(this._getCueStart(this.currentCue), this._getCueStart(nextCue));
        const end = Math.max(this._getCueEnd(this.currentCue), this._getCueEnd(nextCue));

        this.isMerged = true;
        this.currentCue = {
          ...this.currentCue,
          text: combinedText,
          startTime: start,
          endTime: end,
          startMs: Math.round(start * 1000),
          endMs: Math.round(end * 1000),
          _mergedWithNext: true
        };
        this._updateMergedUI();
      }
    }

    unmerge() {
      if (this._originalCue) {
        this.currentCue = { ...this._originalCue };
        this._originalCue = null;
        this.isMerged = false;
        this._updateMergedUI();
      }
    }

    _updateMergedUI() {
      const unmergeBtn = this.toolbarEl?.querySelector ? this.toolbarEl.querySelector(".btn-unmerge") : null;
      if (unmergeBtn) {
        unmergeBtn.style.display = this.isMerged ? "inline-block" : "none";
      }
      if (this.hudState && typeof this.hudState.setActiveCue === "function") {
        this.hudState.activeCue = { ...this.currentCue };
      }
    }

    setCue(cue) {
      if (!this.isMerged) {
        this.currentCue = cue ? { ...cue } : null;
      }
      if (!this.toolbarEl) return;

      const hasText = Boolean(this.currentCue && this.currentCue.text && this.currentCue.text.trim());
      this.toolbarEl.style.display = hasText ? "flex" : "none";

      // 1T (1-Target / i+1) Sentence Intelligence dot indicator
      const badge = this.badgeEl || (this.toolbarEl.querySelector ? this.toolbarEl.querySelector(".hud-1t-badge") : null);
      if (badge && hasText) {
        let unknownCount = null;
        if (typeof this.currentCue.unknownCount === "number") {
          unknownCount = this.currentCue.unknownCount;
        } else if (Array.isArray(this.currentCue.unknownTokens)) {
          unknownCount = this.currentCue.unknownTokens.length;
        } else if (Array.isArray(this.currentCue.tokens)) {
          unknownCount = this.currentCue.tokens.filter(t => {
            if (!t) return false;
            const s = t.status || "unstyled";
            return s === "unseen" || s === "new" || s === "unknown";
          }).length;
        }

        if (unknownCount === 1) {
          badge.style.display = "inline-block";
          badge.style.background = "#10b981";
          badge.className = "hud-1t-badge hud-1t-target";
          badge.title = "1-Target (i+1) Sentence";
          if (badge.setAttribute) badge.setAttribute("aria-label", "1-Target (i+1) Sentence");
        } else if (unknownCount === 0) {
          badge.style.display = "inline-block";
          badge.style.background = "rgba(255, 255, 255, 0.35)";
          badge.className = "hud-1t-badge hud-1t-comprehended";
          badge.title = "Full comprehension line";
          if (badge.setAttribute) badge.setAttribute("aria-label", "Full comprehension line");
        } else {
          badge.style.display = "none";
        }
      } else if (badge) {
        badge.style.display = "none";
      }
    }

    async mineSentence() {
      if (!this.currentCue || !this.currentCue.text) return;
      const sentence = this.currentCue.text.trim();

      const mineBtn = this.toolbarEl?.querySelector(".btn-mine-sentence");
      if (mineBtn) {
        mineBtn.disabled = true;
        mineBtn.textContent = "Saving…";
      }

      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          // Send capture request for the sentence
          await chrome.runtime.sendMessage({
            type: "JAPANESE_TEXT_CAPTURED",
            text: sentence,
            sentence: sentence,
            source: "hud_sentence_mine",
            sourceType: "video",
            isMerged: Boolean(this.isMerged),
            cue: { ...this.currentCue },
            start: typeof this.currentCue.startTime === "number" ? this.currentCue.startTime : (this.currentCue.startMs ? this.currentCue.startMs / 1000 : 0),
            end: typeof this.currentCue.endTime === "number" ? this.currentCue.endTime : (this.currentCue.endMs ? this.currentCue.endMs / 1000 : 0)
          });

          if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
            try {
              window.dispatchEvent(new CustomEvent("HUD_MINE", {
                detail: {
                  text: sentence,
                  sentence: sentence,
                  isMerged: Boolean(this.isMerged),
                  cue: { ...this.currentCue }
                }
              }));
            } catch (_) {}
          }
        }
        if (mineBtn) {
          mineBtn.textContent = "Saved";
          setTimeout(() => {
            if (mineBtn) {
              mineBtn.disabled = false;
              mineBtn.textContent = "Save Sentence";
            }
          }, 2000);
        }
      } catch (err) {
        if (mineBtn) {
          mineBtn.disabled = false;
          mineBtn.textContent = "Save Sentence";
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

      // If in-page standalone popup engine is active, open it on Grammar tab!
      try {
        if (typeof window !== "undefined") {
          const popup = window.__kirokuHudPopup || (typeof getPopup === "function" ? getPopup() : null);
          if (popup && typeof popup.showAtPoint === "function") {
            const rect = this.toolbarEl ? this.toolbarEl.getBoundingClientRect() : null;
            const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
            const y = rect ? rect.top - 10 : window.innerHeight / 2;
            popup.showAtPoint(x, y, {
              surface: sentence,
              lemma: sentence,
              text: sentence,
              reading: "",
              jlpt_level: "Grammar"
            }, sentence);
            popup.switchTab("grammar");
          }
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
      if (this._unsubState) {
        try { this._unsubState(); } catch (_) {}
        this._unsubState = null;
      }
      if (this.toolbarEl && this.toolbarEl.parentElement) {
        this.toolbarEl.parentElement.removeChild(this.toolbarEl);
      }
      this.toolbarEl = null;
      this.currentCue = null;
    }
  }

  return { HudSentence };
});
