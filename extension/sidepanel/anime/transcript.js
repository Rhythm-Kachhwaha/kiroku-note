/**
 * Kiroku Note - Virtualized Subtitle Transcript Component (Group 5)
 *
 * Virtualized full cue list, search filtering (< 100ms), and click-to-seek.
 * Respects player capabilities: seek button / jump is hidden when seek capability is false.
 * Features:
 * - 1T (1-Target / i+1) Sentence Intelligence & filter chips (All Cues | 1T Only | Unseen Words)
 * - Sentence Merging for multi-line dialogue cues
 * - Subtle Grammar breakdown triggers per row
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.AnimeTranscript = exports.AnimeTranscript;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROW_HEIGHT = 48; // px per row for virtualization
  const BUFFER_COUNT = 6;

  class AnimeTranscript {
    constructor(options = {}) {
      this.container = options.container || null;
      this.cues = [];
      this.filteredCues = [];
      this.searchQuery = "";
      this.activeFilter = options.activeFilter || "all"; // 'all' | '1t' | 'unseen'
      this.knownWords = options.knownWords instanceof Set
        ? options.knownWords
        : new Set(Array.isArray(options.knownWords) ? options.knownWords : []);
      this.capabilities = { seek: true, ...(options.capabilities || {}) };
      this.onSeek = options.onSeek || null;
      this.onMineWord = options.onMineWord || null;
      this.onCuesUpdated = options.onCuesUpdated || null;
      this.backendUrl = options.backendUrl || "http://127.0.0.1:21828";
      this.activeCueIndex = -1;

      this.scrollTop = 0;
      this.viewportHeight = 320;
      this._boundScroll = this._handleScroll.bind(this);

      this.elements = {
        wrap: null,
        searchInput: null,
        searchClearBtn: null,
        filterChips: [],
        viewport: null,
        scrollSpacer: null,
        itemsHost: null,
        countBadge: null
      };

      if (this.container) {
        this.mount(this.container);
      }
    }

    mount(container) {
      this.container = container;
      this.container.innerHTML = `
        <div class="anime-transcript-wrap">
          <div class="anime-transcript-header">
            <div class="anime-search-input-wrap">
              <svg class="anime-search-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="7" cy="7" r="5"></circle><path d="M11 11l4 4"></path>
              </svg>
              <input type="text" class="anime-transcript-search-input" placeholder="Search cues (e.g. 食べる)…" autocomplete="off" />
              <button type="button" class="anime-search-clear-btn" title="Clear search" aria-label="Clear search" hidden>&times;</button>
            </div>
            <span class="anime-transcript-count">0 cues</span>
          </div>
          <div class="anime-transcript-filters" role="group" aria-label="Transcript filters">
            <button type="button" class="anime-filter-chip is-active" data-filter="all">All Cues</button>
            <button type="button" class="anime-filter-chip" data-filter="1t">1T Only</button>
            <button type="button" class="anime-filter-chip" data-filter="unseen">Unseen Words</button>
          </div>
          <div class="anime-transcript-viewport" tabindex="0" role="region" aria-label="Subtitle Transcript">
            <div class="anime-transcript-spacer"></div>
            <div class="anime-transcript-items"></div>
          </div>
        </div>
      `;

      this.elements.wrap = this.container.querySelector ? this.container.querySelector(".anime-transcript-wrap") : null;
      this.elements.searchInput = this.container.querySelector ? this.container.querySelector(".anime-transcript-search-input") : null;
      this.elements.searchClearBtn = this.container.querySelector ? this.container.querySelector(".anime-search-clear-btn") : null;
      this.elements.viewport = this.container.querySelector ? this.container.querySelector(".anime-transcript-viewport") : null;
      this.elements.scrollSpacer = this.container.querySelector ? this.container.querySelector(".anime-transcript-spacer") : null;
      this.elements.itemsHost = this.container.querySelector ? this.container.querySelector(".anime-transcript-items") : null;
      this.elements.countBadge = this.container.querySelector ? this.container.querySelector(".anime-transcript-count") : null;

      if (this.container.querySelectorAll) {
        this.elements.filterChips = Array.from(this.container.querySelectorAll(".anime-filter-chip"));
      }

      if (this.elements.searchInput) {
        this.elements.searchInput.addEventListener("input", (e) => {
          this.filter(e.target.value);
        });
      }

      if (this.elements.searchClearBtn) {
        this.elements.searchClearBtn.addEventListener("click", () => {
          if (this.elements.searchInput) {
            this.elements.searchInput.value = "";
          }
          this.filter("");
          if (this.elements.searchInput?.focus) {
            this.elements.searchInput.focus();
          }
        });
      }

      if (this.elements.filterChips && this.elements.filterChips.length > 0) {
        this.elements.filterChips.forEach(chip => {
          chip.addEventListener("click", () => {
            const mode = chip.dataset?.filter || chip.getAttribute?.("data-filter") || "all";
            this.setFilter(mode);
          });
        });
      }

      if (this.elements.viewport) {
        this.elements.viewport.addEventListener("scroll", this._boundScroll, { passive: true });
      }
      this.render();
    }

    setCapabilities(caps = {}) {
      this.capabilities = { ...this.capabilities, ...caps };
      this.render();
    }

    setKnownWords(words) {
      this.knownWords = words instanceof Set
        ? words
        : new Set(Array.isArray(words) ? words : []);
      for (const c of this.cues) {
        delete c._computedUnknownCount;
      }
      if (this.activeFilter !== "all") {
        this.filter(this.searchQuery);
      }
    }

    setFilter(filterMode = "all") {
      this.activeFilter = filterMode;
      if (this.elements.filterChips && this.elements.filterChips.length > 0) {
        this.elements.filterChips.forEach(chip => {
          const mode = chip.dataset?.filter || chip.getAttribute?.("data-filter");
          if (mode === filterMode) {
            chip.classList?.add("is-active");
          } else {
            chip.classList?.remove("is-active");
          }
        });
      }
      this.filter(this.searchQuery);
    }

    _getUnknownCount(cue) {
      if (!cue) return 0;
      if (typeof cue.unknownCount === "number") return cue.unknownCount;
      if (cue._computedUnknownCount !== undefined) return cue._computedUnknownCount;

      let count = 0;
      if (Array.isArray(cue.tokens) && cue.tokens.length > 0) {
        count = cue.tokens.filter(t => {
          if (!t) return false;
          const status = t.status || "unstyled";
          if (status === "known" || status === "mined" || status === "mastered" || status === "should-know" || status === "should_know") {
            return false;
          }
          if (this.knownWords.size > 0) {
            const surface = t.surface || t.text || "";
            const lemma = t.lemma || "";
            if (this.knownWords.has(surface) || this.knownWords.has(lemma)) return false;
          }
          return status === "unseen" || status === "new" || status === "unknown" || !status || status === "unstyled";
        }).length;
      } else {
        const text = cue.text || "";
        const words = text.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+/g) || [];
        if (this.knownWords.size > 0) {
          count = words.filter(w => !this.knownWords.has(w)).length;
        } else {
          count = words.filter(w => /[\u4e00-\u9faf]/.test(w)).length;
        }
      }
      cue._computedUnknownCount = count;
      return count;
    }

    setCues(cues = []) {
      this.cues = Array.isArray(cues) ? cues.map((c, idx) => {
        if (!c) return { i: idx, text: "" };
        if (c.i === undefined) {
          c.i = idx;
        }
        if (c._searchText === undefined) {
          c._searchText = (c.text || "").toLowerCase();
        }
        delete c._computedUnknownCount;
        return c;
      }) : [];
      this.filter(this.searchQuery);
    }

    filter(query = "") {
      const prevQuery = this.searchQuery;
      this.searchQuery = String(query || "").trim().toLowerCase();
      if (this.elements.searchClearBtn) {
        this.elements.searchClearBtn.hidden = !this.searchQuery;
      }

      let matching = this.cues;
      if (this.searchQuery) {
        const q = this.searchQuery;
        matching = matching.filter(c => {
          const text = c._searchText !== undefined ? c._searchText : (c?.text || "").toLowerCase();
          return text.includes(q);
        });
      }

      if (this.activeFilter === "1t") {
        matching = matching.filter(c => this._getUnknownCount(c) === 1);
      } else if (this.activeFilter === "unseen") {
        matching = matching.filter(c => this._getUnknownCount(c) > 0);
      }

      this.filteredCues = matching;

      // Reset scroll position if query changed or if current scroll is beyond content bounds
      if (prevQuery !== this.searchQuery && this.elements.viewport) {
        this.elements.viewport.scrollTop = 0;
        this.scrollTop = 0;
      } else if (this.elements.viewport && this.scrollTop > (this.filteredCues.length * ROW_HEIGHT)) {
        this.elements.viewport.scrollTop = 0;
        this.scrollTop = 0;
      }

      if (this.elements.countBadge) {
        const total = this.cues.length;
        const count = this.filteredCues.length;
        this.elements.countBadge.textContent = (this.searchQuery || this.activeFilter !== "all")
          ? `${count} / ${total}`
          : `${total} cues`;
      }

      if (this.elements.scrollSpacer) {
        this.elements.scrollSpacer.style.height = `${this.filteredCues.length * ROW_HEIGHT}px`;
      }

      this.render();
    }

    setActiveCue(activeCue) {
      if (!activeCue) {
        this.activeCueIndex = -1;
      } else {
        const idx = this.cues.findIndex(c => {
          if (c === activeCue) return true;
          if (typeof c.i === "number" && c.i === activeCue.i) return true;
          return c.text === activeCue.text && Math.abs((c.startTime || c.s || 0) - (activeCue.startTime || activeCue.s || 0)) < 0.1;
        });
        this.activeCueIndex = idx;
      }
      this.render();
    }

    scrollToActiveCue() {
      if (this.activeCueIndex < 0 || !this.elements.viewport) return;
      const filteredIndex = this.filteredCues.findIndex(c => {
        const originalIdx = typeof c.i === "number" ? c.i : this.cues.indexOf(c);
        return originalIdx === this.activeCueIndex;
      });
      if (filteredIndex >= 0) {
        const targetScroll = Math.max(0, (filteredIndex * ROW_HEIGHT) - (this.viewportHeight / 2) + (ROW_HEIGHT / 2));
        this.elements.viewport.scrollTop = targetScroll;
      }
    }

    _handleScroll() {
      if (!this.elements.viewport) return;
      this.scrollTop = this.elements.viewport.scrollTop;
      this.viewportHeight = this.elements.viewport.clientHeight || 320;
      this.renderVirtualRows();
    }

    render() {
      if (!this.elements.viewport || !this.elements.itemsHost) return;
      this.viewportHeight = this.elements.viewport.clientHeight || 320;
      if (this.elements.scrollSpacer) {
        this.elements.scrollSpacer.style.height = `${this.filteredCues.length * ROW_HEIGHT}px`;
      }
      this.renderVirtualRows();
    }

    renderVirtualRows() {
      if (!this.elements.itemsHost) return;
      const count = this.filteredCues.length;
      if (count === 0) {
        this.elements.itemsHost.innerHTML = `
          <div class="anime-empty-state">
            ${this.searchQuery ? "No matching cues found" : "No subtitles loaded"}
          </div>
        `;
        this.elements.itemsHost.style.transform = "none";
        return;
      }

      const startIndex = Math.max(0, Math.min(count - 1, Math.floor(this.scrollTop / ROW_HEIGHT) - BUFFER_COUNT));
      const endIndex = Math.min(count, Math.max(startIndex + 1, Math.ceil((this.scrollTop + this.viewportHeight) / ROW_HEIGHT) + BUFFER_COUNT));

      this.elements.itemsHost.style.transform = `translateY(${startIndex * ROW_HEIGHT}px)`;

      const fragment = document.createDocumentFragment();
      for (let i = startIndex; i < endIndex; i++) {
        const cue = this.filteredCues[i];
        const row = document.createElement("div");
        row.className = "anime-transcript-row";
        row.dataset.index = String(i);

        const originalIdx = typeof cue.i === "number" ? cue.i : this.cues.indexOf(cue);
        if (originalIdx === this.activeCueIndex) {
          row.classList.add("is-active");
        }

        const startSec = typeof cue.startTime === "number"
          ? cue.startTime
          : (typeof cue.s === "number" ? cue.s : (cue.startMs ? cue.startMs / 1000 : 0));
        const timeStr = this.formatTime(startSec);

        // 1. Time / Seek button
        const canSeek = Boolean(this.capabilities.seek !== false);
        const timeBtn = document.createElement("button");
        timeBtn.type = "button";
        timeBtn.className = "anime-transcript-time";
        timeBtn.textContent = timeStr;
        if (!canSeek) {
          timeBtn.classList.add("anime-seek-disabled");
          timeBtn.setAttribute("aria-disabled", "true");
          timeBtn.title = "Seeking not supported on this video player";
        } else {
          timeBtn.title = `Jump to ${timeStr}`;
          timeBtn.addEventListener("click", (e) => {
            if (e?.stopPropagation) e.stopPropagation();
            this.handleSeekClick(cue, startSec);
          });
        }
        row.appendChild(timeBtn);

        // 2. Text Span
        const textSpan = document.createElement("span");
        textSpan.className = "anime-transcript-text";
        textSpan.textContent = cue.text || "";
        textSpan.title = cue.text || "";
        row.appendChild(textSpan);

        // 3. Row Actions (Merge with next cue & Explain grammar)
        const actionsWrap = document.createElement("div");
        actionsWrap.className = "anime-transcript-row-actions";

        const mergeBtn = document.createElement("button");
        mergeBtn.type = "button";
        mergeBtn.className = "anime-row-action-btn btn-merge-next";
        mergeBtn.textContent = "+";
        mergeBtn.title = "Merge with next cue";
        if (mergeBtn.setAttribute) mergeBtn.setAttribute("aria-label", "Merge with next cue");
        mergeBtn.addEventListener("click", (e) => {
          if (e?.stopPropagation) e.stopPropagation();
          this.mergeWithNext(originalIdx);
        });
        actionsWrap.appendChild(mergeBtn);

        const grammarBtn = document.createElement("button");
        grammarBtn.type = "button";
        grammarBtn.className = "anime-row-action-btn btn-explain-grammar";
        grammarBtn.textContent = "Grammar";
        grammarBtn.title = "Explain sentence grammar";
        if (grammarBtn.setAttribute) grammarBtn.setAttribute("aria-label", "Explain sentence grammar");
        grammarBtn.addEventListener("click", (e) => {
          if (e?.stopPropagation) e.stopPropagation();
          this.explainGrammar(cue);
        });
        actionsWrap.appendChild(grammarBtn);

        row.appendChild(actionsWrap);

        if (canSeek) {
          row.style.cursor = "pointer";
          row.addEventListener("click", () => {
            this.handleSeekClick(cue, startSec);
          });
        }

        fragment.appendChild(row);
      }

      this.elements.itemsHost.replaceChildren(fragment);
    }

    mergeWithNext(originalIndex) {
      if (originalIndex < 0 || originalIndex >= this.cues.length - 1) return;
      const cueA = this.cues[originalIndex];
      const cueB = this.cues[originalIndex + 1];
      if (!cueA || !cueB) return;

      const getCueStart = (c) => typeof c.startTime === "number" ? c.startTime : (typeof c.startMs === "number" ? c.startMs / 1000 : (typeof c.s === "number" ? c.s : (c.start || 0)));
      const getCueEnd = (c) => typeof c.endTime === "number" ? c.endTime : (typeof c.endMs === "number" ? c.endMs / 1000 : (typeof c.e === "number" ? c.e : (c.end || (getCueStart(c) + 2))));

      const start = Math.min(getCueStart(cueA), getCueStart(cueB));
      const end = Math.max(getCueEnd(cueA), getCueEnd(cueB));
      const combinedText = `${cueA.text || ""} ${cueB.text || ""}`.trim();

      const mergedCue = {
        ...cueA,
        text: combinedText,
        _searchText: combinedText.toLowerCase(),
        startTime: start,
        endTime: end,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        tokens: [...(cueA.tokens || []), ...(cueB.tokens || [])],
        _merged: true
      };
      delete mergedCue._computedUnknownCount;

      this.cues.splice(originalIndex, 2, mergedCue);
      this.cues.forEach((c, idx) => { c.i = idx; });

      this.filter(this.searchQuery);

      if (typeof this.onCuesUpdated === "function") {
        this.onCuesUpdated(this.cues);
      }
    }

    async explainGrammar(cue) {
      if (!cue || !cue.text) return;
      const sentence = cue.text.trim();
      const backendUrl = (this.backendUrl || "http://127.0.0.1:21828").replace(/\/+$/, "");

      try {
        if (typeof fetch === "function") {
          const res = await fetch(`${backendUrl}/api/grammar/explain`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sentence })
          });
          const data = res.ok ? await res.json() : null;
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "SP_OPEN_GRAMMAR",
              text: sentence,
              explanation: data
            }).catch(() => {});
          }
          return;
        }
      } catch (_) {}

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "SP_OPEN_GRAMMAR",
          text: sentence
        }).catch(() => {});
      }
    }

    handleSeekClick(cue, startSec) {
      if (this.capabilities.seek === false) return;
      const ms = Math.round(startSec * 1000);
      if (typeof this.onSeek === "function") {
        this.onSeek(cue, ms);
      } else {
        this.defaultSeek(ms);
      }
    }

    defaultSeek(ms) {
      if (typeof broadcastToActiveVideo === "function") {
        broadcastToActiveVideo({ type: "SEEK_TO", ms });
      }
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "SEEK_TO", ms }).catch(() => {});
      }
    }

    formatTime(sec) {
      if (typeof sec !== "number" || isNaN(sec) || sec < 0) return "00:00";
      const totalSec = Math.floor(sec);
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const mm = String(mins).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      if (hrs > 0) {
        return `${hrs}:${mm}:${ss}`;
      }
      return `${mm}:${ss}`;
    }

    destroy() {
      if (this.elements.viewport) {
        this.elements.viewport.removeEventListener("scroll", this._boundScroll);
      }
      if (this.container) {
        this.container.innerHTML = "";
      }
    }
  }

  return { AnimeTranscript };
});
