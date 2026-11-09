/**
 * Kiroku Note - Virtualized Subtitle Transcript Component (Group 5)
 *
 * Virtualized full cue list, search filtering (< 100ms), and click-to-seek.
 * Respects player capabilities: seek button / jump is hidden when seek capability is false.
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
      this.capabilities = { seek: true, ...(options.capabilities || {}) };
      this.onSeek = options.onSeek || null;
      this.onMineWord = options.onMineWord || null;
      this.activeCueIndex = -1;

      this.scrollTop = 0;
      this.viewportHeight = 320;
      this._boundScroll = this._handleScroll.bind(this);

      this.elements = {
        wrap: null,
        searchInput: null,
        searchClearBtn: null,
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
          <div class="anime-transcript-viewport" tabindex="0" role="region" aria-label="Subtitle Transcript">
            <div class="anime-transcript-spacer"></div>
            <div class="anime-transcript-items"></div>
          </div>
        </div>
      `;

      this.elements.wrap = this.container.querySelector(".anime-transcript-wrap");
      this.elements.searchInput = this.container.querySelector(".anime-transcript-search-input");
      this.elements.searchClearBtn = this.container.querySelector(".anime-search-clear-btn");
      this.elements.viewport = this.container.querySelector(".anime-transcript-viewport");
      this.elements.scrollSpacer = this.container.querySelector(".anime-transcript-spacer");
      this.elements.itemsHost = this.container.querySelector(".anime-transcript-items");
      this.elements.countBadge = this.container.querySelector(".anime-transcript-count");

      this.elements.searchInput.addEventListener("input", (e) => {
        this.filter(e.target.value);
      });

      this.elements.searchClearBtn.addEventListener("click", () => {
        this.elements.searchInput.value = "";
        this.filter("");
        this.elements.searchInput.focus();
      });

      this.elements.viewport.addEventListener("scroll", this._boundScroll, { passive: true });
      this.render();
    }

    setCapabilities(caps = {}) {
      this.capabilities = { ...this.capabilities, ...caps };
      this.render();
    }

    setCues(cues = []) {
      this.cues = Array.isArray(cues) ? cues : [];
      this.filter(this.searchQuery);
    }

    filter(query = "") {
      this.searchQuery = String(query || "").trim().toLowerCase();
      if (this.elements.searchClearBtn) {
        this.elements.searchClearBtn.hidden = !this.searchQuery;
      }

      if (!this.searchQuery) {
        this.filteredCues = [...this.cues];
      } else {
        const q = this.searchQuery;
        this.filteredCues = this.cues.filter(c => {
          const text = (c?.text || "").toLowerCase();
          return text.includes(q);
        });
      }

      if (this.elements.countBadge) {
        const total = this.cues.length;
        const matching = this.filteredCues.length;
        this.elements.countBadge.textContent = this.searchQuery
          ? `${matching} / ${total}`
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

      const startIndex = Math.max(0, Math.floor(this.scrollTop / ROW_HEIGHT) - BUFFER_COUNT);
      const endIndex = Math.min(count, Math.ceil((this.scrollTop + this.viewportHeight) / ROW_HEIGHT) + BUFFER_COUNT);

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

        // Time / Seek button
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
            e.stopPropagation();
            this.handleSeekClick(cue, startSec);
          });
        }
        row.appendChild(timeBtn);

        // Text
        const textSpan = document.createElement("span");
        textSpan.className = "anime-transcript-text";
        textSpan.textContent = cue.text || "";
        textSpan.title = cue.text || "";
        row.appendChild(textSpan);

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
