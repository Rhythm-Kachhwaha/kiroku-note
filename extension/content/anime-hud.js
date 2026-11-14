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
      this.linkStatus = "ready"; // 'ready' | 'connected' | 'connecting' | 'offline' | 'unauthorized'
      this.tracks = [];
      this.displayPrefs = {
        fontSize: 24,
        position: "bottom", // 'bottom' | 'top'
        blur: true,
        furigana: true,
        showJa: true,
        showNative: false,
        learningMode: false
      };

      this._noSubsDismissed = false;
      this._noSubsTimer = null;
      this._boundFullscreen = this._onFullscreenChange.bind(this);
      this._boundPlay = this._onVideoPlay.bind(this);

      this._loadStoredPrefs();

      // Listen to runtime messages for Link connection status
      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.type === "LINK_STATUS" && msg.status) {
            this.setLinkStatus(msg.status === "ok" || msg.status === "connected" ? "connected" : msg.status);
          }
        });
      }

      // Query initial status gracefully
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "GET_LINK_STATUS" }).then((res) => {
          if (res && res.status) {
            this.setLinkStatus(res.status === "ok" || res.status === "connected" ? "connected" : res.status);
          }
        }).catch(() => {});
      }

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
          font-family: "Noto Sans JP", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #F5F1E8;
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
          padding: 6px 12px;
          background: rgba(28, 27, 25, 0.90);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(245, 241, 232, 0.18);
          border-radius: 9999px;
          color: #F5F1E8;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45), 1.5px 1.5px 0 #11100E;
          z-index: 10;
        }
        .hud-trigger-btn:hover {
          background: rgba(42, 41, 38, 0.96);
          border-color: rgba(245, 241, 232, 0.3);
          transform: translateY(-1px);
        }
        .hud-trigger-btn:active {
          transform: translateY(0);
          box-shadow: 0 0 0;
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
          background: rgba(28, 27, 25, 0.94);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(245, 158, 11, 0.5);
          border-radius: 8px;
          color: #F59E0B;
          font-size: 12px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 1.5px 1.5px 0 #11100E;
          transition: opacity 0.3s ease, transform 0.3s ease;
          z-index: 9;
        }
        .hud-no-subs-chip.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-6px);
        }
        .hud-no-subs-chip button.chip-action {
          background: #F59E0B;
          color: #141311;
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
          color: rgba(245, 241, 232, 0.6);
          cursor: pointer;
          font-size: 14px;
          padding: 0 2px;
        }

        /* Menu Panel - Sleek Floating Player Dropdown */
        .hud-menu-panel {
          pointer-events: auto;
          position: absolute;
          top: 48px;
          right: 14px;
          width: 264px;
          background: rgba(28, 27, 25, 0.98);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(245, 241, 232, 0.14);
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.75), 1.5px 1.5px 0 #11100E;
          transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 20;
          box-sizing: border-box;
          user-select: none;
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
          border-bottom: 1px solid rgba(245, 241, 232, 0.1);
          padding-bottom: 6px;
        }
        .hud-title {
          font-size: 13px;
          font-weight: 700;
          color: #F5F1E8;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .hud-badge-cues {
          font-size: 10px;
          font-weight: 600;
          color: rgba(245, 241, 232, 0.65);
          background: rgba(245, 241, 232, 0.08);
          padding: 1px 6px;
          border-radius: 4px;
        }
        .hud-close-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border: none;
          background: transparent;
          color: rgba(245, 241, 232, 0.6);
          cursor: pointer;
          border-radius: 4px;
          transition: color 120ms ease, background 120ms ease;
        }
        .hud-close-icon:hover {
          color: #F5F1E8;
          background: rgba(245, 241, 232, 0.1);
        }
          color: #F5F1E8;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .hud-link-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          padding: 3px 8px;
          border-radius: 9999px;
          background: rgba(245, 241, 232, 0.06);
          border: 1px solid rgba(245, 241, 232, 0.12);
          color: rgba(245, 241, 232, 0.75);
          font-weight: 500;
        }
        .hud-link-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #4EBB7B;
          box-shadow: 0 0 6px rgba(78, 187, 123, 0.4);
        }
        .hud-link-dot.connected { background: #4EBB7B; box-shadow: 0 0 6px rgba(78, 187, 123, 0.6); }
        .hud-link-dot.ready { background: #4EBB7B; box-shadow: 0 0 6px rgba(78, 187, 123, 0.4); }
        .hud-link-dot.connecting { background: #F59E0B; box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
        .hud-link-dot.offline { background: rgba(245, 241, 232, 0.4); box-shadow: none; }
        .hud-link-dot.unauthorized { background: #D94B38; box-shadow: 0 0 6px rgba(217, 75, 56, 0.4); }

        /* Current Track Card */
        .hud-card {
          background: rgba(245, 241, 232, 0.05);
          border: 1px solid rgba(245, 241, 232, 0.09);
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
          color: rgba(245, 241, 232, 0.5);
          font-weight: 600;
        }
        .hud-track-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .hud-track-name {
          font-size: 12px;
          font-weight: 600;
          color: #F5F1E8;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hud-source-badge {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 4px;
          background: #2A2926;
          border: 1px solid rgba(245, 241, 232, 0.12);
          color: rgba(245, 241, 232, 0.85);
          text-transform: capitalize;
          font-weight: 500;
        }

        /* Buttons & Controls - Planetoño Tactile */
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
          background: rgba(245, 241, 232, 0.08);
          border: 1px solid rgba(245, 241, 232, 0.14);
          border-radius: 6px;
          color: #F5F1E8;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 1.5px 1.5px 0 #11100E;
          transition: transform 100ms ease, box-shadow 100ms ease, background 120ms ease;
        }
        .hud-btn:hover {
          background: rgba(245, 241, 232, 0.14);
        }
        .hud-btn:active {
          transform: translate(1px, 1px);
          box-shadow: 0 0 0;
        }
        .hud-btn.primary {
          background: #D94B38;
          border-color: rgba(245, 241, 232, 0.2);
          color: #FAF8F5;
          box-shadow: 1.5px 1.5px 0 #11100E;
        }
        .hud-btn.primary:hover {
          background: #C53E2D;
        }
        .hud-btn.primary:active {
          transform: translate(1px, 1px);
          box-shadow: 0 0 0;
        }

        /* File Dropzone */
        .hud-dropzone {
          border: 1px dashed rgba(245, 241, 232, 0.22);
          border-radius: 8px;
          padding: 12px;
          text-align: center;
          cursor: pointer;
          background: rgba(245, 241, 232, 0.02);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .hud-dropzone:hover, .hud-dropzone.dragover {
          border-color: #D94B38;
          background: rgba(217, 75, 56, 0.06);
        }
        .hud-dropzone-text {
          font-size: 11px;
          color: rgba(245, 241, 232, 0.6);
        }

        /* Offset Controls */
        .hud-offset-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(245, 241, 232, 0.03);
          border: 1px solid rgba(245, 241, 232, 0.07);
          border-radius: 6px;
          padding: 4px;
          gap: 4px;
        }
        .hud-offset-val {
          font-family: monospace;
          font-size: 12px;
          font-weight: 700;
          color: #F5F1E8;
          min-width: 58px;
          text-align: center;
        }
        .hud-mini-btn {
          background: rgba(245, 241, 232, 0.08);
          border: 1px solid rgba(245, 241, 232, 0.12);
          border-radius: 5px;
          color: #F5F1E8;
          font-size: 11px;
          font-weight: 500;
          padding: 5px 7px;
          cursor: pointer;
          box-shadow: 1px 1px 0 #11100E;
          transition: transform 100ms ease, box-shadow 100ms ease, background 120ms ease;
        }
        .hud-mini-btn:hover {
          background: rgba(245, 241, 232, 0.15);
        }
        .hud-mini-btn:active {
          transform: translate(1px, 1px);
          box-shadow: 0 0 0;
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
          <button id="hud-chip-close-btn" class="chip-close" aria-label="Dismiss"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
        </div>

        <!-- Menu Panel -->
        <div id="hud-menu-panel" class="hud-menu-panel hidden">
          <div class="hud-header">
            <div class="hud-title">
              <span>Subtitles</span>
              <span id="hud-track-stats" class="hud-badge-cues">0 cues</span>
            </div>
            <button type="button" id="hud-menu-close-btn" class="hud-close-icon" aria-label="Close">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>
            </button>
          </div>

          <!-- Active Subtitle Track Info -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(245, 241, 232, 0.04); border: 1px solid rgba(245, 241, 232, 0.08); border-radius: 6px; padding: 6px 8px;">
            <span id="hud-track-name" style="font-size: 11px; font-weight: 600; color: #F5F1E8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">No subtitles loaded</span>
            <span id="hud-source-badge" class="hud-source-badge" style="font-size: 9px; padding: 1px 5px;">none</span>
          </div>

          <!-- Sourcing Actions -->
          <div class="hud-btn-group">
            <button id="hud-btn-autodetect" class="hud-btn primary" title="Auto-detect tracks from video">Auto-detect</button>
            <button id="hud-btn-jimaku" class="hud-btn" title="Search Jimaku subtitles">Jimaku</button>
            <button id="hud-btn-upload-trigger" class="hud-btn" title="Upload subtitle file">Upload</button>
            <input type="file" id="hud-file-input" accept=".srt,.ass,.vtt,.txt" style="display: none;">
          </div>

          <!-- Timing Offset Section -->
          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(245, 241, 232, 0.03); border: 1px solid rgba(245, 241, 232, 0.08); border-radius: 6px; padding: 4px 6px;">
            <span style="font-size: 10px; font-weight: 700; color: rgba(245, 241, 232, 0.55); text-transform: uppercase;">Sync</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              <button id="hud-off-sub-200" class="hud-mini-btn" style="padding: 3px 6px;">-200ms</button>
              <span id="hud-offset-val" class="hud-offset-val" style="min-width: 48px; font-size: 11px;">+0ms</span>
              <button id="hud-off-add-200" class="hud-mini-btn" style="padding: 3px 6px;">+200ms</button>
              <button id="hud-off-reset" class="hud-mini-btn" style="padding: 3px 6px;">Reset</button>
            </div>
          </div>

          <!-- Display Controls -->
          <div class="hud-toggle-grid">
            <button id="hud-toggle-visibility" class="hud-mini-btn">Subtitles: Visible</button>
            <button id="hud-toggle-pos" class="hud-mini-btn">Position: Bottom</button>
            <button id="hud-toggle-size" class="hud-mini-btn">Font: 24px</button>
            <button id="hud-toggle-blur" class="hud-mini-btn">Blur: Off</button>
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

      // File upload trigger
      const fileInput = getEl("hud-file-input");
      getEl("hud-btn-upload-trigger")?.addEventListener("click", () => fileInput?.click());
      fileInput?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) this.handleDroppedFile(file);
      });

      getEl("hud-menu-close-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeMenu();
      });

      // Sourcing Actions
      getEl("hud-btn-autodetect")?.addEventListener("click", () => {
        let foundJa = false;
        if (this.video && this.video.textTracks) {
          for (let i = 0; i < this.video.textTracks.length; i++) {
            const tr = this.video.textTracks[i];
            const lang = (tr.language || "").toLowerCase();
            const label = (tr.label || "").toLowerCase();
            if (lang.startsWith("ja") || label.includes("japanese") || label.includes("日本語")) {
              tr.mode = "showing";
              foundJa = true;
              this.updateTrackStatus({
                source: "embedded",
                name: tr.label || "Japanese Track",
                count: tr.cues?.length || 0
              });
              break;
            }
          }
        }
        if (this.coordinator?.triggerAutoDetect) {
          this.coordinator.triggerAutoDetect();
        } else if (typeof window !== "undefined" && window.__kirokuAutoDetect) {
          window.__kirokuAutoDetect();
        } else if (!foundJa) {
          this.triggerJimakuSearch();
        }
      });

      getEl("hud-btn-jimaku")?.addEventListener("click", () => {
        if (this.coordinator?.triggerJimakuSearch) {
          this.coordinator.triggerJimakuSearch();
        } else {
          this.triggerJimakuSearch();
        }
      });

      // Helper to query all active subtitle elements across hosts and document
      const getActiveSubEls = () => {
        const els = [];
        if (this.coordinator?.renderer?.subtitleEl) els.push(this.coordinator.renderer.subtitleEl);
        if (this.coordinator?.renderer?.container) els.push(this.coordinator.renderer.container);
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host?.primaryCueEl) els.push(host.primaryCueEl);
        if (typeof document !== "undefined") {
          document.querySelectorAll(".subtitle-display-bubble, .hud-primary-cue").forEach((el) => {
            if (!els.includes(el)) els.push(el);
          });
        }
        return els;
      };

      // Offset Controls
      let offsetDebounceTimer = null;
      const adjustOffset = (deltaMs) => {
        let current = this.subStatus.offsetMs || 0;
        let next = deltaMs === 0 ? 0 : current + deltaMs;
        this.subStatus.offsetMs = next;
        const offsetValEl = getEl("hud-offset-val");
        if (offsetValEl) {
          offsetValEl.textContent = `${next >= 0 ? "+" : ""}${next}ms`;
        }

        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host?.setOffsetMs) {
          host.setOffsetMs(next);
        }
        if (this.coordinator?.syncEngine?.setOffsetMs) {
          this.coordinator.syncEngine.setOffsetMs(next);
        }
        if (this.coordinator?.persistOffset) {
          this.coordinator.persistOffset(next);
        }

        clearTimeout(offsetDebounceTimer);
        offsetDebounceTimer = setTimeout(() => {
          this.saveEpisodeState({ offsetMs: next });
        }, 300);

        this._notifySubStatus();
      };

      getEl("hud-off-sub-200")?.addEventListener("click", () => adjustOffset(-200));
      getEl("hud-off-add-200")?.addEventListener("click", () => adjustOffset(200));
      getEl("hud-off-reset")?.addEventListener("click", () => adjustOffset(0));

      // Display Toggles
      getEl("hud-toggle-visibility")?.addEventListener("click", () => {
        const isCurrentlyVisible = this.displayPrefs.showJa !== false;
        const next = !isCurrentlyVisible;
        this.displayPrefs.showJa = next;
        if (this.coordinator?.setSubtitlesDisplay) {
          this.coordinator.setSubtitlesDisplay(next);
        } else if (this.coordinator?.renderer?.setDisplayEnabled) {
          this.coordinator.renderer.setDisplayEnabled(next);
        }
        getActiveSubEls().forEach((el) => {
          el.style.display = next ? "" : "none";
        });
        const btn = getEl("hud-toggle-visibility");
        if (btn) btn.textContent = `Subtitles: ${next ? "Visible" : "Hidden"}`;
      });

      getEl("hud-toggle-pos")?.addEventListener("click", () => {
        const next = this.displayPrefs.position === "bottom" ? "top" : "bottom";
        this.displayPrefs.position = next;
        if (this.coordinator?.renderer?.setPosition) {
          this.coordinator.renderer.setPosition({
            relX: 0.5,
            relY: next === "bottom" ? 0.82 : 0.12
          });
        }
        getActiveSubEls().forEach((el) => {
          if (next === "top") {
            el.style.top = "40px";
            el.style.bottom = "auto";
          } else {
            el.style.top = "auto";
            el.style.bottom = "58px";
          }
        });
        const btn = getEl("hud-toggle-pos");
        if (btn) btn.textContent = `Position: ${next === "bottom" ? "Bottom" : "Top"}`;
      });

      getEl("hud-toggle-size")?.addEventListener("click", () => {
        const sizes = [18, 22, 26, 32];
        const next = sizes[(sizes.indexOf(this.displayPrefs.fontSize) + 1) % sizes.length];
        this.displayPrefs.fontSize = next;
        getActiveSubEls().forEach((el) => {
          el.style.fontSize = `${next}px`;
        });
        const btn = getEl("hud-toggle-size");
        if (btn) btn.textContent = `Font: ${next}px`;
      });

      getEl("hud-toggle-blur")?.addEventListener("click", () => {
        this.displayPrefs.blur = !this.displayPrefs.blur;
        const isBlurred = this.displayPrefs.blur;
        getActiveSubEls().forEach((el) => {
          if (isBlurred) {
            el.classList.add("is-blurred");
            el.style.filter = "blur(6px)";
          } else {
            el.classList.remove("is-blurred");
            el.style.filter = "none";
          }
        });
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host) {
          host.setPlaybackMode(isBlurred ? "blur_hover" : "always");
        }
        const btn = getEl("hud-toggle-blur");
        if (btn) btn.textContent = `Blur: ${isBlurred ? "On" : "Off"}`;
      });

      getEl("hud-toggle-furigana")?.addEventListener("click", () => {
        const modes = ["hover", "always", "hidden"];
        const current = this.displayPrefs.furiganaMode || "hover";
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        this.displayPrefs.furiganaMode = next;
        const labels = { hover: "Furigana: Hover", always: "Furigana: Always", hidden: "Furigana: Off" };
        getEl("hud-toggle-furigana").textContent = labels[next] || "Furigana: Hover";
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host) {
          host.setFuriganaMode(next);
        }
        this._saveStoredPrefs();
      });

      getEl("hud-toggle-mode")?.addEventListener("click", () => {
        const modes = [
          { key: "always", label: "Mode: Always Show" },
          { key: "unknown_only", label: "Mode: Only Unknown" },
          { key: "blur_hover", label: "Mode: Blur Until Hover" },
          { key: "autopause", label: "Mode: Auto-Pause" }
        ];
        const currentMode = this.displayPrefs.playbackMode || "always";
        const currentIndex = modes.findIndex((m) => m.key === currentMode);
        const nextObj = modes[(currentIndex + 1) % modes.length];
        this.displayPrefs.playbackMode = nextObj.key;
        getEl("hud-toggle-mode").textContent = nextObj.label;
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host) {
          host.setPlaybackMode(nextObj.key);
        }
        this._saveStoredPrefs();
      });

      getEl("hud-btn-open-panel")?.addEventListener("click", () => {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "SP_OPEN_GRAMMAR" }).catch(() => {});
          }
        } catch (_) {}
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

      // Restore track + offset from episode-store on mount
      this.restoreEpisodeState();
    }

    async getEpisodeKey() {
      const url = typeof location !== "undefined" ? location.href : "";
      const title = typeof document !== "undefined" ? document.title : "";
      const parser = typeof TitleParser !== "undefined" ? TitleParser : (globalThis.TitleParser || null);
      if (parser && typeof parser.parseEpisodeKey === "function") {
        return parser.parseEpisodeKey(url, title);
      }
      return "generic/unknown/unknown";
    }

    async restoreEpisodeState() {
      try {
        const episodeKey = await this.getEpisodeKey();
        const store = typeof defaultEpisodeStore !== "undefined"
          ? defaultEpisodeStore
          : (typeof EpisodeStore !== "undefined" ? new EpisodeStore() : (globalThis.defaultEpisodeStore || null));
        if (!store) return;

        const ep = await store.getEpisode(episodeKey);
        if (!ep) return;

        if (typeof ep.offsetMs === "number" && !isNaN(ep.offsetMs)) {
          this.subStatus.offsetMs = ep.offsetMs;
          const offsetValEl = this._getShadowEl("hud-offset-val");
          if (offsetValEl) {
            offsetValEl.textContent = `${ep.offsetMs >= 0 ? "+" : ""}${ep.offsetMs}ms`;
          }
          if (this.coordinator?.syncEngine?.setOffsetMs) {
            this.coordinator.syncEngine.setOffsetMs(ep.offsetMs);
          }
          if (this.coordinator?.persistOffset) {
            this.coordinator.persistOffset(ep.offsetMs);
          }
        }

        if (ep.sourceId && this.tracks && this.tracks.length > 0) {
          const matchTrack = this.tracks.find(t => t.id === ep.sourceId || t.name === ep.sourceId);
          if (matchTrack && this.coordinator?.selectTrack) {
            this.coordinator.selectTrack(matchTrack);
          }
        }
      } catch (_) {}
    }

    async saveEpisodeState(partial = {}) {
      try {
        const episodeKey = await this.getEpisodeKey();
        const store = typeof defaultEpisodeStore !== "undefined"
          ? defaultEpisodeStore
          : (typeof EpisodeStore !== "undefined" ? new EpisodeStore() : (globalThis.defaultEpisodeStore || null));
        if (!store) return;
        await store.setEpisode(episodeKey, partial);
      } catch (_) {}
    }

    async triggerJimakuSearch(customQuery = "") {
      try {
        let query = customQuery;
        if (!query) {
          const rawTitle = typeof document !== "undefined" ? document.title : "";
          const url = typeof location !== "undefined" ? location.href : "";
          const titleParser = typeof TitleParser !== "undefined" ? TitleParser : (globalThis.TitleParser || null);
          if (titleParser?.cleanAnimeTitle) {
            const parsed = titleParser.cleanAnimeTitle(rawTitle, url);
            query = parsed.title || rawTitle;
          } else {
            query = rawTitle;
          }
        }
        if (!query) return;

        let apiKey = "";
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("jimaku_api_key");
          apiKey = stored?.jimaku_api_key || "";
        }

        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          const res = await chrome.runtime.sendMessage({
            type: "JIMAKU_SEARCH",
            query,
            apiKey
          });
          if (res?.ok && Array.isArray(res.entries)) {
            const mappedTracks = res.entries.map((entry, idx) => ({
              id: `jimaku-${entry.id || idx}`,
              name: entry.name || entry.title || `Jimaku Track ${idx + 1}`,
              source: "jimaku",
              entry
            }));
            this.setTracks(mappedTracks);
            const section = this._getShadowEl("hud-tracks-section");
            if (section) section.style.display = "flex";
          }
        }
      } catch (_) {}
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
      } else if (status === "offline" || status === "disconnected") {
        dot.classList.add("offline");
        txt.textContent = "Offline";
      } else {
        dot.classList.add("ready");
        txt.textContent = "Ready";
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
          const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
          if (host) {
            host.setCues(cues);
          }
          if (this.coordinator?.handleDroppedFile) {
            await this.coordinator.handleDroppedFile(file);
          } else if (this.coordinator?.handleCuesLoaded) {
            this.coordinator.handleCuesLoaded(cues, file.name);
          } else if (this.coordinator?.syncEngine) {
            this.coordinator.syncEngine.setCues(cues);
          }
          if (this.coordinator?.setSubtitlesDisplay) {
            this.coordinator.setSubtitlesDisplay(true);
          } else if (this.coordinator?.renderer?.setDisplayEnabled) {
            this.coordinator.renderer.setDisplayEnabled(true);
          }

          this.setSubStatus({
            source: "file",
            name: file.name,
            count: cues.length,
            offsetMs: this.coordinator?.syncEngine?.offsetMs || 0
          });

          // Also notify link bridge directly to ensure sub.status and cue.list are sent to Desktop
          if (typeof window !== "undefined" && window.__kirokuLinkBridge) {
            this._notifySubStatus();
            window.__kirokuLinkBridge._emitCueList?.();
          }
        }
      } catch (err) {
        console.error("[AnimeHud] Error loading file:", err);
      }
    }

    async _loadStoredPrefs() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get("kiroku.hud.prefs");
          if (res && res["kiroku.hud.prefs"]) {
            this.displayPrefs = { ...this.displayPrefs, ...res["kiroku.hud.prefs"] };
            this._applyStoredPrefs();
          }
        }
      } catch (_) {}
    }

    async _saveStoredPrefs() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({ "kiroku.hud.prefs": this.displayPrefs });
        }
      } catch (_) {}
    }

    _applyStoredPrefs() {
      const getEl = (id) => this._getShadowEl(id);
      if (this.displayPrefs.fontSize) {
        const el = getEl("hud-toggle-size");
        if (el) el.textContent = `Font Size: ${this.displayPrefs.fontSize}px`;
      }
      if (this.displayPrefs.furigana !== undefined) {
        const el = getEl("hud-toggle-furigana");
        if (el) el.textContent = `Furigana: ${this.displayPrefs.furigana ? "On" : "Off"}`;
      }
      if (this.displayPrefs.blur !== undefined) {
        const el = getEl("hud-toggle-blur");
        if (el) el.textContent = `Blur: ${this.displayPrefs.blur ? "On" : "Off"}`;
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
