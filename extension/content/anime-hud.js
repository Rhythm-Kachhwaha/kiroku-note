/**
 * Kiroku Note - Anime In-Page Subtitle HUD (Slice A6)
 * 
 * Provides an unobtrusive in-page HUD attached to the video container via a closed shadow root.
 * Features:
 * - Subtitle track switcher & status (Embedded, Jimaku, File, None)
 * - Auto-detect and Jimaku search triggers
 * - Drag-and-drop / file browser for SRT, ASS, VTT
 * - Offset tuning (-1000ms / -100ms / +100ms / +1000ms / Reset)
 * - Display adjustments (Font size, Top/Bottom position, Blur, Furigana)
 * - Desktop Link connection status indicator
 * - "No subtitles - Select" floating chip on playback with 0 cues
 * - Fullscreen reparenting into document.fullscreenElement
 */

(() => {
  if (typeof window !== "undefined" && window.__kirokuAnimeHudLoaded) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__kirokuAnimeHudLoaded = true;
  }

  class AnimeHud {
    constructor(video, coordinator = null) {
      this.video = video || null;
      this.coordinator = coordinator || null;
      this.host = null;
      this.shadow = null;
      this.originalParent = null;

      this.isOpen = false;
      this.subStatus = {
        source: "none",
        name: "No subtitles loaded",
        count: 0,
        offsetMs: 0
      };
      this.linkStatus = "disconnected"; // 'disconnected' | 'connecting' | 'connected' | 'unauthorized'
      this.tracks = [];
      this.displayPrefs = {
        fontSize: 24,
        position: "bottom", // 'bottom' | 'top'
        blur: true,
        furigana: true
      };

      this._noSubsDismissed = false;
      this._noSubsTimer = null;
      this._boundFullscreen = this._onFullscreenChange.bind(this);
      this._boundPlay = this._onVideoPlay.bind(this);

      if (typeof document !== "undefined") {
        this._buildDom();
        if (this.video) {
          this.attach(this.video);
        }
      }
    }

    _buildDom() {
      if (this.host) return;

      this.host = document.createElement("div");
      this.host.id = "kiroku-anime-hud-host";
      this.host.style.position = "absolute";
      this.host.style.top = "0";
      this.host.style.left = "0";
      this.host.style.width = "100%";
      this.host.style.height = "100%";
      this.host.style.pointerEvents = "none";
      this.host.style.zIndex = "2147483646";

      this.shadow = (typeof this.host.attachShadow === "function")
        ? this.host.attachShadow({ mode: "closed" })
        : this.host;

      const style = document.createElement("style");
      style.textContent = `
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #f4f4f5;
        }
        * {
          box-sizing: border-box;
          user-select: none;
        }

        /* Top-right Trigger Button */
        .hud-trigger-btn {
          pointer-events: auto;
          position: absolute;
          top: 14px;
          right: 14px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(24, 24, 27, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 20px;
          color: #f4f4f5;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
          z-index: 10;
        }
        .hud-trigger-btn:hover {
          background: rgba(39, 39, 42, 0.95);
          border-color: rgba(255, 255, 255, 0.3);
          transform: translateY(-1px);
        }
        .hud-trigger-btn:active {
          transform: translateY(0);
        }
        .hud-trigger-btn svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }

        /* "No Subtitles - Select" Floating Chip */
        .hud-no-subs-chip {
          pointer-events: auto;
          position: absolute;
          top: 56px;
          right: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: rgba(24, 24, 27, 0.9);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(245, 158, 11, 0.4);
          border-radius: 8px;
          color: #fbbf24;
          font-size: 12px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
          transition: opacity 0.3s ease, transform 0.3s ease;
          z-index: 9;
        }
        .hud-no-subs-chip.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-6px);
        }
        .hud-no-subs-chip button.chip-action {
          background: #f59e0b;
          color: #18181b;
          border: none;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .hud-no-subs-chip button.chip-close {
          background: transparent;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          font-size: 14px;
          padding: 0 2px;
        }

        /* Menu Panel */
        .hud-menu-panel {
          pointer-events: auto;
          position: absolute;
          top: 54px;
          right: 14px;
          width: 320px;
          max-height: calc(100% - 70px);
          overflow-y: auto;
          background: rgba(18, 18, 20, 0.96);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
          transition: opacity 0.15s ease, transform 0.15s ease;
          z-index: 20;
        }
        .hud-menu-panel.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-8px) scale(0.98);
        }

        /* Section Headings */
        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 8px;
        }
        .hud-title {
          font-size: 13px;
          font-weight: 600;
          color: #fafafa;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .hud-link-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.06);
          color: #a1a1aa;
        }
        .hud-link-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ef4444; /* red default */
        }
        .hud-link-dot.connected { background: #22c55e; }
        .hud-link-dot.connecting { background: #f59e0b; }
        .hud-link-dot.unauthorized { background: #ef4444; }

        /* Current Track Card */
        .hud-card {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .hud-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #71717a;
        }
        .hud-track-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .hud-track-name {
          font-size: 12px;
          font-weight: 500;
          color: #e4e4e7;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hud-source-badge {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: 4px;
          background: #3f3f46;
          color: #d4d4d8;
          text-transform: capitalize;
        }

        /* Buttons & Controls */
        .hud-btn-group {
          display: flex;
          gap: 6px;
        }
        .hud-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: #e4e4e7;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .hud-btn:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .hud-btn.primary {
          background: #2563eb;
          border-color: #3b82f6;
          color: #ffffff;
        }
        .hud-btn.primary:hover {
          background: #1d4ed8;
        }

        /* File Dropzone */
        .hud-dropzone {
          border: 1px dashed rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 12px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .hud-dropzone:hover, .hud-dropzone.dragover {
          border-color: #3b82f6;
          background: rgba(59, 130, 246, 0.08);
        }
        .hud-dropzone-text {
          font-size: 11px;
          color: #a1a1aa;
        }

        /* Offset Controls */
        .hud-offset-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          padding: 4px;
          gap: 4px;
        }
        .hud-offset-val {
          font-family: monospace;
          font-size: 12px;
          font-weight: 600;
          color: #f4f4f5;
          min-width: 60px;
          text-align: center;
        }
        .hud-mini-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          color: #e4e4e7;
          font-size: 10px;
          font-weight: 500;
          padding: 4px 6px;
          cursor: pointer;
        }
        .hud-mini-btn:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        /* Display Toggles */
        .hud-toggle-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
      `;

      const container = document.createElement("div");
      container.innerHTML = `
        <!-- Top-Right Trigger Button -->
        <button id="hud-toggle-btn" class="hud-trigger-btn" aria-label="Toggle Kiroku Subtitles HUD">
          <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z"/></svg>
          <span id="hud-trigger-label">Subs</span>
        </button>

        <!-- No Subtitles Chip -->
        <div id="hud-no-subs-chip" class="hud-no-subs-chip hidden">
          <span>No subtitles</span>
          <button id="hud-chip-select-btn" class="chip-action">Select</button>
          <button id="hud-chip-close-btn" class="chip-close" aria-label="Dismiss">✕</button>
        </div>

        <!-- Menu Panel -->
        <div id="hud-menu-panel" class="hud-menu-panel hidden">
          <div class="hud-header">
            <div class="hud-title">
              <span>Kiroku Subtitles</span>
            </div>
            <div id="hud-link-indicator" class="hud-link-pill">
              <span id="hud-link-dot" class="hud-link-dot"></span>
              <span id="hud-link-text">Offline</span>
            </div>
          </div>

          <!-- Current Active Track -->
          <div class="hud-card">
            <span class="hud-label">Active Subtitle</span>
            <div class="hud-track-row">
              <span id="hud-track-name" class="hud-track-name">No subtitles loaded</span>
              <span id="hud-source-badge" class="hud-source-badge">none</span>
            </div>
            <span id="hud-track-stats" style="font-size: 11px; color: #71717a;">0 cues</span>
          </div>

          <!-- Available Tracks List -->
          <div id="hud-tracks-section" style="display: none; flex-direction: column; gap: 4px;">
            <span class="hud-label">Available Tracks</span>
            <div id="hud-tracks-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 100px; overflow-y: auto;"></div>
          </div>

          <!-- Sourcing Actions -->
          <div class="hud-btn-group">
            <button id="hud-btn-autodetect" class="hud-btn primary">Auto-detect</button>
            <button id="hud-btn-jimaku" class="hud-btn">Search Jimaku</button>
          </div>

          <!-- Subtitle File Dropzone -->
          <div id="hud-file-dropzone" class="hud-dropzone">
            <span class="hud-dropzone-text">Drop SRT, ASS, VTT or Browse</span>
            <input type="file" id="hud-file-input" accept=".srt,.ass,.vtt,.txt" style="display: none;">
          </div>

          <!-- Subtitle Offset Section -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span class="hud-label">Timing Offset</span>
            <div class="hud-offset-row">
              <button id="hud-off-sub-1000" class="hud-mini-btn">-1s</button>
              <button id="hud-off-sub-100" class="hud-mini-btn">-100ms</button>
              <span id="hud-offset-val" class="hud-offset-val">+0ms</span>
              <button id="hud-off-add-100" class="hud-mini-btn">+100ms</button>
              <button id="hud-off-add-1000" class="hud-mini-btn">+1s</button>
              <button id="hud-off-reset" class="hud-mini-btn">Reset</button>
            </div>
          </div>

          <!-- Display Toggles -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span class="hud-label">Display Controls</span>
            <div class="hud-toggle-grid">
              <button id="hud-toggle-pos" class="hud-mini-btn">Position: Bottom</button>
              <button id="hud-toggle-size" class="hud-mini-btn">Font Size: 24px</button>
              <button id="hud-toggle-blur" class="hud-mini-btn">Blur: On</button>
              <button id="hud-toggle-furigana" class="hud-mini-btn">Furigana: On</button>
            </div>
          </div>
        </div>
      `;

      this.shadow.appendChild(style);
      this.shadow.appendChild(container);

      this._attachListeners();
    }

    _getShadowEl(id) {
      if (!this.shadow) return null;
      if (typeof this.shadow.getElementById === "function") {
        return this.shadow.getElementById(id);
      }
      if (typeof this.shadow.querySelector === "function") {
        return this.shadow.querySelector(`#${id}`);
      }
      return null;
    }

    _attachListeners() {
      const getEl = (id) => this._getShadowEl(id);

      // Toggle menu button
      getEl("hud-toggle-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMenu();
      });

      // Chip buttons
      getEl("hud-chip-select-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hideNoSubsChip();
        this.openMenu();
      });
      getEl("hud-chip-close-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this._noSubsDismissed = true;
        this.hideNoSubsChip();
      });

      // Dropzone & File Input
      const dropzone = getEl("hud-file-dropzone");
      const fileInput = getEl("hud-file-input");

      dropzone?.addEventListener("click", () => fileInput?.click());
      fileInput?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) this.handleDroppedFile(file);
      });

      dropzone?.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      });
      dropzone?.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
      });
      dropzone?.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        const file = e.dataTransfer?.files?.[0];
        if (file) this.handleDroppedFile(file);
      });

      // Sourcing Actions
      getEl("hud-btn-autodetect")?.addEventListener("click", () => {
        if (this.coordinator?.triggerAutoDetect) {
          this.coordinator.triggerAutoDetect();
        } else if (typeof window !== "undefined" && window.__kirokuAutoDetect) {
          window.__kirokuAutoDetect();
        }
      });
      getEl("hud-btn-jimaku")?.addEventListener("click", () => {
        if (this.coordinator?.triggerJimakuSearch) {
          this.coordinator.triggerJimakuSearch();
        }
      });

      // Offset Controls
      const adjustOffset = (deltaMs) => {
        let current = this.subStatus.offsetMs || 0;
        let next = deltaMs === 0 ? 0 : current + deltaMs;
        this.subStatus.offsetMs = next;
        getEl("hud-offset-val").textContent = `${next >= 0 ? "+" : ""}${next}ms`;

        if (this.coordinator?.syncEngine?.setOffsetMs) {
          this.coordinator.syncEngine.setOffsetMs(next);
        }
        if (this.coordinator?.persistOffset) {
          this.coordinator.persistOffset(next);
        }
        this._notifySubStatus();
      };

      getEl("hud-off-sub-1000")?.addEventListener("click", () => adjustOffset(-1000));
      getEl("hud-off-sub-100")?.addEventListener("click", () => adjustOffset(-100));
      getEl("hud-off-add-100")?.addEventListener("click", () => adjustOffset(100));
      getEl("hud-off-add-1000")?.addEventListener("click", () => adjustOffset(1000));
      getEl("hud-off-reset")?.addEventListener("click", () => adjustOffset(0));

      // Display Toggles
      getEl("hud-toggle-pos")?.addEventListener("click", () => {
        this.displayPrefs.position = this.displayPrefs.position === "bottom" ? "top" : "bottom";
        getEl("hud-toggle-pos").textContent = `Position: ${this.displayPrefs.position === "bottom" ? "Bottom" : "Top"}`;
        if (this.coordinator?.renderer?.setPosition) {
          this.coordinator.renderer.setPosition({
            relX: 0.5,
            relY: this.displayPrefs.position === "bottom" ? 0.8 : 0.15
          });
        }
      });

      getEl("hud-toggle-size")?.addEventListener("click", () => {
        const sizes = [18, 24, 30, 36];
        const next = sizes[(sizes.indexOf(this.displayPrefs.fontSize) + 1) % sizes.length];
        this.displayPrefs.fontSize = next;
        getEl("hud-toggle-size").textContent = `Font Size: ${next}px`;
        if (this.coordinator?.renderer?.boxEl) {
          this.coordinator.renderer.boxEl.style.fontSize = `${next}px`;
        }
      });

      getEl("hud-toggle-blur")?.addEventListener("click", () => {
        this.displayPrefs.blur = !this.displayPrefs.blur;
        getEl("hud-toggle-blur").textContent = `Blur: ${this.displayPrefs.blur ? "On" : "Off"}`;
        if (this.coordinator?.renderer?.boxEl) {
          this.coordinator.renderer.boxEl.style.backdropFilter = this.displayPrefs.blur ? "blur(8px)" : "none";
        }
      });

      getEl("hud-toggle-furigana")?.addEventListener("click", () => {
        this.displayPrefs.furigana = !this.displayPrefs.furigana;
        getEl("hud-toggle-furigana").textContent = `Furigana: ${this.displayPrefs.furigana ? "On" : "Off"}`;
      });

      // Fullscreen changes
      if (typeof document !== "undefined") {
        document.addEventListener("fullscreenchange", this._boundFullscreen);
        document.addEventListener("webkitfullscreenchange", this._boundFullscreen);
      }
    }

    attach(video) {
      if (!video) return;
      this.video = video;

      // Find appropriate container (player container or parent)
      const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
      const parent = video.parentElement;
      let container = (parent && typeof parent.closest === "function" && parent.closest(selector));
      if (!container && typeof video.closest === "function") {
        const found = video.closest(selector);
        if (found && found.tagName !== "VIDEO") {
          container = found;
        }
      }
      if (!container) {
        container = parent || (typeof document !== "undefined" ? document.body : null);
      }
      if (container && container.tagName === "VIDEO") {
        container = container.parentElement || (typeof document !== "undefined" ? document.body : null);
      }
      if (container && this.host && this.host.parentElement !== container) {
        this.originalParent = container;
        const compPos = (typeof getComputedStyle === "function") ? getComputedStyle(container)?.position : container.style?.position;
        if (!compPos || compPos === "static") {
          if (!container.style) container.style = {};
          container.style.position = "relative";
        }
        if (typeof container.appendChild === "function") {
          container.appendChild(this.host);
        }
      }

      this.video.addEventListener("play", this._boundPlay);

      // Re-attach fullscreen listeners if detached previously
      if (typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", this._boundFullscreen);
        document.removeEventListener("webkitfullscreenchange", this._boundFullscreen);
        document.addEventListener("fullscreenchange", this._boundFullscreen);
        document.addEventListener("webkitfullscreenchange", this._boundFullscreen);
      }

      // Check current subtitle state
      if (this.subStatus.count === 0 && !this.video.paused) {
        this.showNoSubsChip();
      }
    }

    detach() {
      if (this.video) {
        this.video.removeEventListener("play", this._boundPlay);
        this.video = null;
      }
      if (this.host && this.host.parentElement) {
        this.host.parentElement.removeChild(this.host);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("fullscreenchange", this._boundFullscreen);
        document.removeEventListener("webkitfullscreenchange", this._boundFullscreen);
      }
    }

    _onVideoPlay() {
      if (this.subStatus.count === 0 && !this._noSubsDismissed) {
        this.showNoSubsChip();
      }
    }

    _onFullscreenChange() {
      if (!this.host) return;
      const docFs = (typeof document !== "undefined")
        ? (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement)
        : null;
      const shadowFs = docFs?.shadowRoot?.fullscreenElement;
      const fsEl = shadowFs || docFs;

      if (fsEl) {
        // If the video itself is the fullscreen element, reparent to player container or parent
        // because HTML5 <video> elements cannot visibly render child DOM nodes
        const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
        const targetParent = (fsEl.tagName === "VIDEO")
          ? ((typeof fsEl.closest === "function" && fsEl.closest(selector)) || fsEl.parentElement || fsEl)
          : fsEl;
        if (this.host.parentElement !== targetParent) {
          if (!this.originalParent) {
            this.originalParent = this.host.parentElement;
          }
          targetParent.appendChild(this.host);
        }
      } else {
        if (this.originalParent && this.host.parentElement !== this.originalParent) {
          this.originalParent.appendChild(this.host);
        } else if (this.video) {
          const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
          const fallbackParent = (typeof this.video.closest === "function" && this.video.closest(selector)) || this.video.parentElement;
          if (fallbackParent && this.host.parentElement !== fallbackParent) {
            fallbackParent.appendChild(this.host);
          }
        }
      }
    }

    openMenu() {
      this.isOpen = true;
      this._getShadowEl("hud-menu-panel")?.classList.remove("hidden");
    }

    closeMenu() {
      this.isOpen = false;
      this._getShadowEl("hud-menu-panel")?.classList.add("hidden");
    }

    toggleMenu() {
      if (this.isOpen) {
        this.closeMenu();
      } else {
        this.openMenu();
      }
    }

    showNoSubsChip() {
      if (this._noSubsDismissed || this.subStatus.count > 0) return;
      const chip = this._getShadowEl("hud-no-subs-chip");
      if (chip) {
        chip.classList.remove("hidden");
        clearTimeout(this._noSubsTimer);
        this._noSubsTimer = setTimeout(() => {
          this.hideNoSubsChip();
        }, 6000);
      }
    }

    hideNoSubsChip() {
      clearTimeout(this._noSubsTimer);
      this._getShadowEl("hud-no-subs-chip")?.classList.add("hidden");
    }

    setSubStatus(status = {}) {
      this.subStatus = {
        source: status.source || this.subStatus.source || "none",
        name: status.name || this.subStatus.name || "No subtitles loaded",
        count: typeof status.count === "number" ? status.count : this.subStatus.count,
        offsetMs: typeof status.offsetMs === "number" ? status.offsetMs : this.subStatus.offsetMs
      };

      if (!this.shadow) return;

      const trackNameEl = this._getShadowEl("hud-track-name");
      const badgeEl = this._getShadowEl("hud-source-badge");
      const statsEl = this._getShadowEl("hud-track-stats");
      const offsetValEl = this._getShadowEl("hud-offset-val");

      if (trackNameEl) trackNameEl.textContent = this.subStatus.name;
      if (badgeEl) badgeEl.textContent = this.subStatus.source;
      if (statsEl) statsEl.textContent = `${this.subStatus.count} cues`;
      if (offsetValEl) {
        const off = this.subStatus.offsetMs;
        offsetValEl.textContent = `${off >= 0 ? "+" : ""}${off}ms`;
      }

      if (this.subStatus.count > 0) {
        this.hideNoSubsChip();
      }

      this._notifySubStatus();
    }

    setLinkStatus(status) {
      this.linkStatus = status;
      if (!this.shadow) return;
      const dot = this._getShadowEl("hud-link-dot");
      const txt = this._getShadowEl("hud-link-text");
      if (!dot || !txt) return;

      dot.className = "hud-link-dot";
      if (status === "connected") {
        dot.classList.add("connected");
        txt.textContent = "Connected";
      } else if (status === "connecting") {
        dot.classList.add("connecting");
        txt.textContent = "Connecting";
      } else if (status === "unauthorized") {
        dot.classList.add("unauthorized");
        txt.textContent = "Unauthorized";
      } else {
        txt.textContent = "Offline";
      }
    }

    setTracks(tracks) {
      this.tracks = Array.isArray(tracks) ? tracks : [];
      if (!this.shadow) return;

      const section = this._getShadowEl("hud-tracks-section");
      const list = this._getShadowEl("hud-tracks-list");
      if (!section || !list) return;

      if (this.tracks.length === 0) {
        section.style.display = "none";
        list.innerHTML = "";
        return;
      }

      section.style.display = "flex";
      list.innerHTML = "";
      this.tracks.forEach((tr, idx) => {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: rgba(255,255,255,0.04); border-radius: 4px; font-size: 11px;";
        row.innerHTML = `
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">${tr.name || tr.label || `Track ${idx + 1}`}</span>
          <button style="background: rgba(255,255,255,0.1); border: none; border-radius: 3px; color: #f4f4f5; font-size: 10px; padding: 2px 6px; cursor: pointer;">Select</button>
        `;
        row.querySelector("button")?.addEventListener("click", () => {
          if (this.coordinator?.selectTrack) {
            this.coordinator.selectTrack(tr);
          }
        });
        list.appendChild(row);
      });
    }

    async handleDroppedFile(file) {
      if (!file) return;
      try {
        let text = "";
        if (typeof file.text === "function") {
          text = await file.text();
        } else if (typeof FileReader !== "undefined") {
          text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
          });
        }

        const parser = typeof SubtitleParser !== "undefined"
          ? SubtitleParser
          : (typeof globalThis !== "undefined" ? globalThis.SubtitleParser : null);

        if (!parser) return;
        const parsed = parser.parseSubtitles(text, file.name);
        const cues = typeof parser.normalizeCues === "function" ? parser.normalizeCues(parsed) : parsed;

        if (cues && cues.length > 0) {
          if (this.coordinator?.handleCuesLoaded) {
            this.coordinator.handleCuesLoaded(cues, file.name);
          } else if (this.coordinator?.syncEngine) {
            this.coordinator.syncEngine.setCues(cues);
            if (this.coordinator.renderer) {
              this.coordinator.renderer.ensureMounted();
              this.coordinator.renderer.updatePosition();
            }
          }

          this.setSubStatus({
            source: "file",
            name: file.name,
            count: cues.length,
            offsetMs: this.coordinator?.syncEngine?.offsetMs || 0
          });

          // Also notify link bridge directly to ensure cue.list is sent
          if (typeof window !== "undefined" && window.__kirokuLinkBridge) {
            window.__kirokuLinkBridge._emitCueList?.();
          }
        }
      } catch (err) {
        console.error("[AnimeHud] Error loading file:", err);
      }
    }

    _notifySubStatus() {
      if (typeof window !== "undefined" && window.__kirokuLinkBridge?.emitToBackground) {
        window.__kirokuLinkBridge.emitToBackground("sub.status", {
          tab: window.__kirokuLinkBridge.attachedTabId || 0,
          frame: 0,
          source: this.subStatus.source,
          name: this.subStatus.name,
          count: this.subStatus.count,
          offsetMs: this.subStatus.offsetMs
        });
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AnimeHud;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.AnimeHud = AnimeHud;
  }
})();
