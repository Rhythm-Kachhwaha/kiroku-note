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

      this._loadStoredPrefs().catch(() => {});

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

        /* Top-right Trigger Button — Dark Obsidian Neo-Brutalist (Zero backdrop-filter) */
        .hud-trigger-btn {
          pointer-events: auto;
          position: absolute;
          top: 14px;
          right: 14px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: #1C1B19;
          border: 2px solid #000000;
          outline: 1px solid #32302C;
          outline-offset: -3px;
          border-radius: 2px;
          color: #F0ECE3;
          cursor: pointer;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease, color 140ms ease, border-color 140ms ease;
          box-shadow: 4px 4px 0 #000000;
          z-index: 10;
        }
        .hud-trigger-btn:hover {
          background: #2E2C28;
          color: #F0ECE3;
          border-color: #D94B38;
          outline-color: transparent;
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0 #000000;
        }
        .hud-trigger-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 1px 1px 0 #000000;
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
          padding: 6px 10px;
          background: #1C1B19;
          border: 2px solid #D94B38;
          border-radius: 2px;
          color: #F0ECE3;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          box-shadow: 4px 4px 0 #000000;
          transition: opacity 0.2s ease, transform 0.2s ease;
          z-index: 9;
        }
        .hud-no-subs-chip.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-6px);
        }
        .hud-no-subs-chip button.chip-action {
          background: #D94B38;
          color: #F0ECE3;
          border: 2px solid #000000;
          border-radius: 2px;
          padding: 3px 8px;
          font-size: 10.5px;
          font-weight: 800;
          text-transform: uppercase;
          cursor: pointer;
          box-shadow: 2px 2px 0 #000000;
          transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
        }
        .hud-no-subs-chip button.chip-action:hover {
          background: #E55A47;
          transform: translate(-1.5px, -1.5px);
          box-shadow: 4px 4px 0 #000000;
        }
        .hud-no-subs-chip button.chip-close {
          background: transparent;
          border: none;
          color: #C9C3B8;
          cursor: pointer;
          font-size: 14px;
          padding: 0 2px;
        }

        /* Menu Panel — Dark Obsidian Neo-Brutalist Slab (Zero backdrop-filter) */
        .hud-menu-panel {
          pointer-events: auto;
          position: absolute;
          top: 52px;
          right: 14px;
          width: 304px;
          max-height: calc(100% - 64px);
          overflow-y: auto;
          background-color: #1C1B19;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
          background-size: 20px 20px;
          border: 3px solid #000000;
          outline: 1px solid #32302C;
          outline-offset: -4px;
          border-radius: 2px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 7px 7px 0 #000000;
          transform-origin: top right;
          transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1), transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
          z-index: 20;
          box-sizing: border-box;
          user-select: none;
        }
        .hud-menu-panel.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-4px) scale(0.98);
        }
        .hud-menu-panel::-webkit-scrollbar,
        .hud-tracks-list::-webkit-scrollbar {
          width: 6px;
        }
        .hud-menu-panel::-webkit-scrollbar-track,
        .hud-tracks-list::-webkit-scrollbar-track {
          background: #100F0E;
        }
        .hud-menu-panel::-webkit-scrollbar-thumb,
        .hud-tracks-list::-webkit-scrollbar-thumb {
          background: #46433D;
          border-radius: 1px;
        }
        .hud-menu-panel::-webkit-scrollbar-thumb:hover,
        .hud-tracks-list::-webkit-scrollbar-thumb:hover {
          background: #D94B38;
        }

        /* Section Headings */
        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid #32302C;
          padding-bottom: 8px;
        }
        .hud-title {
          font-size: 12.5px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #F0ECE3;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .hud-badge-cues {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10px;
          font-weight: 800;
          color: #C9C3B8;
          background: #262522;
          border: 1.5px solid #000000;
          padding: 1px 6px;
          border-radius: 2px;
        }
        .hud-close-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border: 2px solid #000000;
          background: #262522;
          color: #C9C3B8;
          cursor: pointer;
          border-radius: 2px;
          transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
        }
        .hud-close-icon:hover {
          color: #F0ECE3;
          background: #D94B38;
          transform: translate(-1px, -1px);
        }
        .hud-link-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 9.5px;
          padding: 2px 7px;
          border-radius: 2px;
          background: #100F0E;
          border: 1.5px solid #32302C;
          color: #C9C3B8;
          font-weight: 800;
          text-transform: uppercase;
        }
        .hud-link-dot {
          width: 6px;
          height: 6px;
          border-radius: 1px;
          background: #4EBB7B;
        }
        .hud-link-dot.connected { background: #4EBB7B; }
        .hud-link-dot.ready { background: #4EBB7B; }
        .hud-link-dot.connecting { background: #D94B38; }
        .hud-link-dot.offline { background: #8E8A81; }
        .hud-link-dot.unauthorized { background: #D94B38; }

        /* Current Track Card */
        .hud-card {
          background: #100F0E;
          border: 2px solid #32302C;
          border-radius: 2px;
          box-shadow: 3px 3px 0 #000000;
          padding: 9px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .hud-label {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8E8A81;
          font-weight: 800;
        }
        .hud-track-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .hud-track-name {
          font-size: 12px;
          font-weight: 700;
          color: #F0ECE3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hud-source-badge {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 9.5px;
          padding: 2px 6px;
          border-radius: 2px;
          background: #262522;
          border: 1.5px solid #000000;
          color: #D94B38;
          text-transform: uppercase;
          font-weight: 800;
        }

        /* Buttons & Controls — Dark Neo-Brutalist Hover Physics */
        .hud-btn-group {
          display: flex;
          align-items: stretch;
          gap: 6px;
        }
        .hud-btn {
          flex: 1;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          background: #262522;
          border: 2px solid #000000;
          border-radius: 2px;
          color: #F0ECE3;
          padding: 0 8px;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 3px 3px 0 #000000;
          transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 120ms ease, border-color 120ms ease;
        }
        .hud-btn:hover {
          background: #33312D;
          color: #F0ECE3;
          border-color: #D94B38;
          transform: translate(-1.5px, -1.5px);
          box-shadow: 4.5px 4.5px 0 #000000;
        }
        .hud-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 1px 1px 0 #000000;
        }
        .hud-btn.primary {
          background: #D94B38;
          border-color: #000000;
          color: #F0ECE3;
          box-shadow: 3px 3px 0 #000000;
        }
        .hud-btn.primary:hover {
          background: #E55A47;
          color: #F0ECE3;
          border-color: #000000;
          transform: translate(-1.5px, -1.5px);
          box-shadow: 4.5px 4.5px 0 #000000;
        }
        .hud-btn.primary:active {
          transform: translate(2px, 2px);
          box-shadow: 1px 1px 0 #000000;
        }
        .hud-btn.hud-btn-icon {
          flex: 0 0 34px;
          padding: 0;
        }
        .hud-btn.hud-btn-compact {
          flex: 0 0 auto;
          padding: 0 8px;
        }

        @keyframes uploadArrowBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .upload-icon-animated {
          display: inline-block;
          transition: transform 120ms ease;
        }
        #hud-btn-upload-trigger:hover .upload-icon-animated {
          animation: uploadArrowBounce 0.8s ease-in-out infinite;
          color: #D94B38;
        }

        /* File Dropzone */
        .hud-dropzone {
          border: 2px dashed #46433D;
          border-radius: 2px;
          padding: 11px;
          text-align: center;
          cursor: pointer;
          background: #100F0E;
          transition: border-color 0.14s ease, background 0.14s ease;
        }
        .hud-dropzone:hover, .hud-dropzone.dragover {
          border-color: #D94B38;
          background: #1A1816;
        }
        .hud-dropzone-text {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10.5px;
          font-weight: 700;
          color: #C9C3B8;
        }

        /* Collapsible Source Drawer */
        .hud-source-drawer {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .hud-source-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 6px 8px;
          cursor: pointer;
          transition: border-color 120ms ease, background-color 120ms ease;
        }
        .hud-source-header:hover {
          border-color: #D94B38;
          background: #171513;
        }
        .hud-source-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .hud-source-drawer.is-collapsed .hud-source-body {
          display: none;
        }
        .hud-chevron-svg {
          transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
          flex-shrink: 0;
          color: #C9C3B8;
        }
        .hud-source-drawer.is-collapsed .hud-source-chevron {
          transform: rotate(-90deg);
        }
        .hud-tracks-drawer.is-collapsed .hud-tracks-chevron {
          transform: rotate(-90deg);
        }
        .hud-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          background: #262522;
          border: 2px solid #000000;
          border-radius: 2px;
          color: #F0ECE3;
          cursor: pointer;
          box-shadow: 2px 2px 0 #000000;
          transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 120ms ease, border-color 120ms ease;
        }
        .hud-icon-btn:hover {
          background: #33312D;
          border-color: #D94B38;
        }
        .hud-tracks-filter-row {
          padding: 5px 5px 0 5px;
          display: flex;
        }
        .hud-bottom-controls {
          display: grid;
          grid-template-columns: 1fr 1.35fr;
          gap: 6px;
          align-items: stretch;
        }
        .hud-bottom-controls .hud-size-stepper {
          height: 100%;
          min-height: 38px;
        }
        .hud-bottom-controls .hud-slider-group {
          grid-column: auto;
          padding: 5px 8px;
          gap: 3px;
          box-shadow: 3px 3px 0 #000000;
          border: 2px solid #000000;
          background: #262522;
        }

        /* Well Cards (Track Info, Sync, Tracks Drawer) */
        .hud-well {
          background: #100F0E;
          border: 2px solid #32302C;
          border-radius: 2px;
          box-shadow: 2px 2px 0 #000000;
        }
        .hud-track-info-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 6px 8px;
        }
        .hud-sync-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 7px;
          gap: 6px;
        }
        .hud-sync-label {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 9.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #8E8A81;
          text-transform: uppercase;
        }
        .hud-sync-controls {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .hud-tracks-drawer {
          display: none;
          flex-direction: column;
          background: #100F0E;
          border: 2px solid #32302C;
          border-radius: 2px;
          box-shadow: 2px 2px 0 #000000;
          overflow: hidden;
        }
        .hud-tracks-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 5px 7px;
          background: #161513;
          border-bottom: 1.5px solid #32302C;
        }
        .hud-tracks-filter {
          flex: 1;
          min-width: 0;
          height: 24px;
          background: #0B0A09;
          border: 1.5px solid #32302C;
          border-radius: 2px;
          color: #F0ECE3;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10px;
          padding: 0 6px;
          outline: none;
        }
        .hud-tracks-filter:focus {
          border-color: #D94B38;
        }
        .hud-tracks-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
          max-height: 148px;
          overflow-y: auto;
          padding: 5px;
        }
        .hud-tracks-drawer.is-collapsed .hud-tracks-list,
        .hud-tracks-drawer.is-collapsed .hud-tracks-filter-row {
          display: none;
        }
        .hud-track-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 5px 7px;
          background: #1C1B19;
          border: 1.5px solid #2A2824;
          border-radius: 2px;
          cursor: pointer;
          transition: background-color 100ms ease, border-color 100ms ease;
        }
        .hud-track-item:hover {
          background: #282623;
          border-color: #D94B38;
        }
        .hud-track-item.is-loading {
          border-color: #D94B38;
          opacity: 0.75;
        }
        .hud-track-item-label {
          font-size: 10.5px;
          font-weight: 600;
          color: #F0ECE3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .hud-track-item-btn {
          flex: 0 0 auto;
          background: #262522;
          border: 1.5px solid #000000;
          border-radius: 2px;
          color: #F0ECE3;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 9.5px;
          font-weight: 800;
          text-transform: uppercase;
          padding: 2px 6px;
          cursor: pointer;
        }
        .hud-track-item:hover .hud-track-item-btn {
          background: #D94B38;
        }

        /* Offset Controls */
        .hud-offset-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #100F0E;
          border: 2px solid #32302C;
          border-radius: 2px;
          padding: 4px;
          gap: 4px;
        }
        .hud-offset-val {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 10.5px;
          font-weight: 800;
          color: #F0ECE3;
          min-width: 44px;
          text-align: center;
        }
        .hud-mini-btn {
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #262522;
          border: 2px solid #000000;
          border-radius: 2px;
          color: #F0ECE3;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          white-space: nowrap;
          padding: 0 8px;
          cursor: pointer;
          box-shadow: 3px 3px 0 #000000;
          transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 120ms ease, border-color 120ms ease;
        }
        .hud-mini-btn.hud-sync-btn {
          height: 24px;
          padding: 0 6px;
          font-size: 9.5px;
          box-shadow: 2px 2px 0 #000000;
        }
        .hud-mini-btn:hover {
          background: #33312D;
          border-color: #D94B38;
          transform: translate(-1.5px, -1.5px);
          box-shadow: 4.5px 4.5px 0 #000000;
        }
        .hud-mini-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 1px 1px 0 #000000;
        }

        /* Display Toggles */
        .hud-toggle-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        /* Stepper & Size Control */
        .hud-size-stepper {
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #262522;
          border: 2px solid #000000;
          border-radius: 2px;
          padding: 0 4px;
          box-shadow: 3px 3px 0 #000000;
          user-select: none;
          box-sizing: border-box;
        }
        .hud-stepper-btn {
          background: transparent;
          border: none;
          color: #F0ECE3;
          cursor: pointer;
          padding: 4px;
          border-radius: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 120ms ease, color 120ms ease;
        }
        .hud-stepper-btn:hover {
          background: #D94B38;
          color: #F0ECE3;
        }
        .hud-stepper-btn:active {
          transform: scale(0.92);
        }
        .stepper-minus-svg,
        .stepper-plus-svg {
          transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .hud-size-display {
          font-size: 11px;
          font-weight: 800;
          color: #F0ECE3;
          font-family: "JetBrains Mono", Consolas, monospace;
          min-width: 36px;
          text-align: center;
          cursor: pointer;
        }
        .hud-size-display:hover {
          color: #D94B38;
        }

        /* Brutalist Range Slider for Opacity */
        .hud-slider-group {
          grid-column: span 2;
          display: flex;
          flex-direction: column;
          gap: 5px;
          background: #100F0E;
          border: 2px solid #32302C;
          border-radius: 2px;
          padding: 7px 9px;
          box-shadow: 3px 3px 0 #000000;
          box-sizing: border-box;
        }
        .hud-slider-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          color: #C9C3B8;
        }
        .hud-slider-val {
          font-family: "JetBrains Mono", Consolas, monospace;
          font-size: 11px;
          font-weight: 800;
          color: #D94B38;
        }
        .hud-range-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 7px;
          border-radius: 1px;
          border: 1.5px solid #000000;
          background: linear-gradient(to right, #D94B38 var(--slider-pct, 100%), #262522 var(--slider-pct, 100%));
          outline: none;
          margin: 4px 0 2px 0;
          cursor: pointer;
        }
        .hud-range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 1px;
          background: #F0ECE3;
          border: 2px solid #000000;
          box-shadow: 2px 2px 0 #000000;
          cursor: pointer;
        }
        .hud-range-slider:hover::-webkit-slider-thumb {
          background: #D94B38;
          transform: scale(1.1);
        }
        .hud-range-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 1px;
          background: #F0ECE3;
          border: 2px solid #000000;
          box-shadow: 2px 2px 0 #000000;
          cursor: pointer;
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
              <span id="hud-track-stats" class="hud-badge-cues" style="display: none;">0 cues</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div id="hud-link-pill" class="hud-link-pill" style="display: none;">
                <span id="hud-link-dot" class="hud-link-dot offline"></span>
                <span id="hud-link-text">Offline</span>
              </div>
              <button type="button" id="hud-menu-close-btn" class="hud-close-icon" aria-label="Close">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>
              </button>
            </div>
          </div>

          <!-- Collapsible Subtitle Source Section -->
          <div id="hud-source-drawer" class="hud-source-drawer">
            <div id="hud-source-header" class="hud-well hud-source-header" role="button" tabindex="0" aria-expanded="true" title="Expand or collapse subtitle source controls">
              <span id="hud-track-name" class="hud-track-name">No subtitles loaded</span>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                <span id="hud-source-badge" class="hud-source-badge">none</span>
                <svg class="hud-chevron-svg hud-source-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>

            <div class="hud-source-body">
              <!-- Tracks Selection List (collapsible & searchable) -->
              <div id="hud-tracks-section" class="hud-tracks-drawer">
                <div class="hud-tracks-header">
                  <span id="hud-tracks-count-label" class="hud-label">Tracks</span>
                  <button type="button" id="hud-tracks-collapse-btn" class="hud-icon-btn" aria-expanded="true" aria-label="Collapse tracks" title="Collapse or expand tracks">
                    <svg class="hud-chevron-svg hud-tracks-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                </div>
                <div class="hud-tracks-filter-row">
                  <input type="text" id="hud-tracks-filter" class="hud-tracks-filter" placeholder="Filter episode or group..." autocomplete="off" />
                </div>
                <div id="hud-tracks-list" class="hud-tracks-list"></div>
              </div>

              <!-- Sourcing Actions (Jimaku key configured in sidepanel) -->
              <div class="hud-btn-group">
                <button type="button" id="hud-btn-autodetect" class="hud-btn primary" title="Auto-detect tracks from video">Auto</button>
                <button type="button" id="hud-btn-jimaku" class="hud-btn" title="Search Jimaku subtitles">Jimaku</button>
                <button type="button" id="hud-btn-upload-trigger" class="hud-btn hud-btn-icon" title="Upload subtitle file" aria-label="Upload subtitle file">
                  <svg class="upload-icon-animated" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </button>
                <input type="file" id="hud-file-input" accept=".srt,.ass,.vtt,.txt" style="display: none;">
              </div>
            </div>
          </div>

          <!-- Timing Offset Section -->
          <div class="hud-well hud-sync-bar">
            <span class="hud-sync-label">Sync</span>
            <div class="hud-sync-controls">
              <button type="button" id="hud-off-sub-100" class="hud-mini-btn hud-sync-btn">-100ms</button>
              <span id="hud-offset-val" class="hud-offset-val">+0ms</span>
              <button type="button" id="hud-off-add-100" class="hud-mini-btn hud-sync-btn">+100ms</button>
              <button type="button" id="hud-off-reset" class="hud-mini-btn hud-sync-btn">Reset</button>
            </div>
          </div>

          <!-- Display Controls (2x2 toggles + balanced Size/Opacity row) -->
          <div class="hud-toggle-grid">
            <button type="button" id="hud-toggle-visibility" class="hud-mini-btn" aria-label="Toggle subtitles visibility" title="Toggle subtitles visibility">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span style="margin-left:5px;">Show</span>
            </button>
            <button type="button" id="hud-toggle-pos" class="hud-mini-btn">Pos: Bottom</button>
            <button type="button" id="hud-toggle-furigana" class="hud-mini-btn" title="Cycle furigana mode">Furi: Hover</button>
            <button type="button" id="hud-toggle-blur" class="hud-mini-btn">Blur: Off</button>
          </div>

          <div class="hud-bottom-controls">
            <div id="hud-toggle-size" class="hud-size-stepper" title="Subtitle font size">
              <button type="button" id="hud-size-dec" class="hud-stepper-btn" aria-label="Decrease font size" title="Smaller font (-2px)">
                <svg class="stepper-minus-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <span id="hud-font-size-val" class="hud-size-display" title="Click to cycle font size">26px</span>
              <button type="button" id="hud-size-inc" class="hud-stepper-btn" aria-label="Increase font size" title="Larger font (+2px)">
                <svg class="stepper-plus-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <div class="hud-slider-group">
              <div class="hud-slider-header">
                <span>Opacity</span>
                <span id="hud-opacity-val" class="hud-slider-val">100%</span>
              </div>
              <input type="range" id="hud-opacity-slider" min="0" max="100" step="5" value="100" class="hud-range-slider" aria-label="Subtitle opacity slider">
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

      // Toggle menu button with tactile drag support
      const toggleBtn = getEl("hud-toggle-btn");
      if (toggleBtn) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        toggleBtn.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          isDragging = false;
          startX = e.clientX;
          startY = e.clientY;
          const rect = toggleBtn.getBoundingClientRect();
          const hostRect = this.host?.getBoundingClientRect() || { left: 0, top: 0 };
          initialLeft = rect.left - hostRect.left;
          initialTop = rect.top - hostRect.top;
          try { toggleBtn.setPointerCapture(e.pointerId); } catch (_) {}

          const onPointerMove = (moveEv) => {
            moveEv.stopPropagation();
            const dx = moveEv.clientX - startX;
            const dy = moveEv.clientY - startY;
            if (!isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
              isDragging = true;
            }
            if (isDragging) {
              const newLeft = Math.max(4, initialLeft + dx);
              const newTop = Math.max(4, initialTop + dy);
              toggleBtn.style.left = `${newLeft}px`;
              toggleBtn.style.top = `${newTop}px`;
              toggleBtn.style.right = "auto";
            }
          };

          const onPointerUp = (upEv) => {
            upEv.stopPropagation();
            toggleBtn.removeEventListener("pointermove", onPointerMove);
            toggleBtn.removeEventListener("pointerup", onPointerUp);
            toggleBtn.removeEventListener("pointercancel", onPointerUp);
            try { toggleBtn.releasePointerCapture(upEv.pointerId); } catch (_) {}
            if (isDragging) {
              const pos = { left: toggleBtn.style.left, top: toggleBtn.style.top };
              try {
                if (typeof chrome !== "undefined" && chrome.storage?.local) {
                  chrome.storage.local.set({ kiroku_hud_btn_pos: pos });
                }
              } catch (_) {}
            }
          };

          toggleBtn.addEventListener("pointermove", onPointerMove);
          toggleBtn.addEventListener("pointerup", onPointerUp);
          toggleBtn.addEventListener("pointercancel", onPointerUp);
        });

        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isDragging) {
            isDragging = false;
            return;
          }
          this.toggleMenu();
        });
      }

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

      const menuPanel = this._getShadowEl("hud-menu-panel");
      if (menuPanel) {
        ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "touchstart"].forEach((ev) => {
          menuPanel.addEventListener(ev, (e) => e.stopPropagation());
        });
        menuPanel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      }

      const sourceDrawer = this._getShadowEl("hud-source-drawer");
      const sourceHeader = this._getShadowEl("hud-source-header");
      if (sourceHeader && sourceDrawer) {
        const toggleSourceDrawer = (e) => {
          e.stopPropagation();
          const collapsed = sourceDrawer.classList.toggle("is-collapsed");
          if (typeof sourceHeader.setAttribute === "function") {
            sourceHeader.setAttribute("aria-expanded", String(!collapsed));
          }
        };
        sourceHeader.addEventListener("click", toggleSourceDrawer);
        sourceHeader.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleSourceDrawer(e);
          }
        });
      }

      const tracksSection = this._getShadowEl("hud-tracks-section");
      const tracksCollapseBtn = this._getShadowEl("hud-tracks-collapse-btn");
      if (tracksCollapseBtn && tracksSection) {
        tracksCollapseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const collapsed = tracksSection.classList.toggle("is-collapsed");
          tracksCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
        });
      }

      const tracksFilterInput = this._getShadowEl("hud-tracks-filter");
      if (tracksFilterInput) {
        ["keydown", "keyup", "keypress", "input"].forEach((ev) => {
          tracksFilterInput.addEventListener(ev, (e) => e.stopPropagation());
        });
        tracksFilterInput.addEventListener("input", () => {
          const q = (tracksFilterInput.value || "").trim().toLowerCase();
          const list = this._getShadowEl("hud-tracks-list");
          if (!list) return;
          const rows = list.children;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const text = (row.dataset?.trackName || row.textContent || "").toLowerCase();
            row.style.display = !q || text.includes(q) ? "flex" : "none";
          }
        });
      }

      getEl("hud-menu-close-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeMenu();
      });

      // Sourcing Actions
      getEl("hud-btn-autodetect")?.addEventListener("click", async () => {
        let detected = false;
        if (this.coordinator?.triggerAutoDetect) {
          detected = await this.coordinator.triggerAutoDetect();
          if (detected) return;
        }
        if (this.video && this.video.textTracks) {
          for (let i = 0; i < this.video.textTracks.length; i++) {
            const tr = this.video.textTracks[i];
            const lang = (tr.language || "").toLowerCase();
            const label = (tr.label || "").toLowerCase();
            if (lang.startsWith("ja") || label.includes("japanese") || label.includes("日本語")) {
              try { if (tr.mode === "disabled") tr.mode = "hidden"; } catch (_) {}
              detected = true;
              this.updateTrackStatus({
                source: "embedded",
                name: tr.label || "Japanese Track",
                count: tr.cues?.length || 0
              });
              break;
            }
          }
        }
        if (typeof window !== "undefined" && window.__kirokuAutoDetect) {
          window.__kirokuAutoDetect();
        } else if (!detected) {
          this.triggerJimakuSearch();
        }
      });

      getEl("hud-btn-jimaku")?.addEventListener("click", () => {
        this.triggerJimakuSearch();
      });

      // Helper to query all active subtitle elements across hosts and document
      const getActiveSubEls = () => {
        const els = [];
        if (this.coordinator?.renderer?.subtitleEl) els.push(this.coordinator.renderer.subtitleEl);
        if (this.coordinator?.renderer?.boxEl) els.push(this.coordinator.renderer.boxEl);
        if (this.coordinator?.renderer?.container) els.push(this.coordinator.renderer.container);
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host?.primaryCueEl) els.push(host.primaryCueEl);
        if (typeof document !== "undefined") {
          document.querySelectorAll(".subtitle-display-bubble, .hud-primary-cue, #ankiminer-video-overlay-container, #ankiminer-video-subtitle-box, #ankiminer-video-subtitle").forEach((el) => {
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
          this.saveEpisodeState({ offsetMs: next }).catch(() => {});
        }, 300);

        this._notifySubStatus();
      };

      getEl("hud-off-sub-100")?.addEventListener("click", () => adjustOffset(-100));
      getEl("hud-off-add-100")?.addEventListener("click", () => adjustOffset(100));
      getEl("hud-off-sub-200")?.addEventListener("click", () => adjustOffset(-100));
      getEl("hud-off-add-200")?.addEventListener("click", () => adjustOffset(100));
      getEl("hud-off-reset")?.addEventListener("click", () => adjustOffset(0));

      // Display Toggles
      getEl("hud-toggle-visibility")?.addEventListener("click", () => {
        const isCurrentlyVisible = this.displayPrefs.showJa !== false;
        const next = !isCurrentlyVisible;
        this.displayPrefs.showJa = next;
        if (this.coordinator?.setSubtitlesDisplay) {
          this.coordinator.setSubtitlesDisplay(next);
        }
        if (this.coordinator?.renderer?.setDisplayEnabled) {
          this.coordinator.renderer.setDisplayEnabled(next);
        }
        getActiveSubEls().forEach((el) => {
          el.style.setProperty("display", next ? "" : "none", "important");
        });
        const btn = getEl("hud-toggle-visibility");
        this._renderVisibilityBtn(btn, next);
        this._saveStoredPrefs().catch(() => {});
      });

      getEl("hud-toggle-pos")?.addEventListener("click", () => {
        const next = this.displayPrefs.position === "bottom" ? "top" : "bottom";
        this.displayPrefs.position = next;
        if (this.coordinator?.renderer?.setPosition) {
          this.coordinator.renderer.setPosition({
            relX: 0.5,
            relY: next === "bottom" ? 0.78 : 0.12
          });
        }
        if (this.coordinator?.renderer?.updatePosition) {
          this.coordinator.renderer.updatePosition();
        }
        getActiveSubEls().forEach((el) => {
          if (next === "top") {
            el.style.setProperty("top", "40px", "important");
            el.style.setProperty("bottom", "auto", "important");
          } else {
            el.style.setProperty("top", "auto", "important");
            el.style.setProperty("bottom", "58px", "important");
          }
        });
        const btn = getEl("hud-toggle-pos");
        if (btn) btn.textContent = `Pos: ${next === "bottom" ? "Bottom" : "Top"}`;
        this._saveStoredPrefs().catch(() => {});
      });

      // Font Size Controls (Stepper with animated +/- SVGs and cycle click)
      const applyFontSize = (size) => {
        const clamped = Math.max(16, Math.min(48, Math.round(size)));
        this.displayPrefs.fontSize = clamped;
        if (this.coordinator?.renderer?.setFontSize) {
          this.coordinator.renderer.setFontSize(clamped);
        }
        getActiveSubEls().forEach((el) => {
          el.style.setProperty("font-size", `${clamped}px`, "important");
          el.style.setProperty("fontSize", `${clamped}px`, "important");
        });
        const valEl = getEl("hud-font-size-val");
        if (valEl) valEl.textContent = `${clamped}px`;
        const legacyBtn = getEl("hud-toggle-size");
        if (legacyBtn && legacyBtn.tagName === "BUTTON") legacyBtn.textContent = `Font: ${clamped}px`;
        this._saveStoredPrefs().catch(() => {});
      };

      const presetSizes = [18, 22, 26, 32, 38];
      getEl("hud-size-dec")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = this.displayPrefs.fontSize || 26;
        applyFontSize(cur - 2);
      });
      getEl("hud-size-inc")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = this.displayPrefs.fontSize || 26;
        applyFontSize(cur + 2);
      });
      getEl("hud-font-size-val")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const cur = this.displayPrefs.fontSize || 26;
        const next = presetSizes[(presetSizes.indexOf(cur) + 1) % presetSizes.length] || 26;
        applyFontSize(next);
      });
      getEl("hud-toggle-size")?.addEventListener("click", (e) => {
        if (e.target.closest?.("#hud-size-dec") || e.target.closest?.("#hud-size-inc") || e.target.id === "hud-font-size-val") return;
        const cur = this.displayPrefs.fontSize || 26;
        const next = presetSizes[(presetSizes.indexOf(cur) + 1) % presetSizes.length] || 26;
        applyFontSize(next);
      });

      getEl("hud-toggle-blur")?.addEventListener("click", () => {
        this.displayPrefs.blur = !this.displayPrefs.blur;
        const isBlurred = this.displayPrefs.blur;
        if (this.coordinator?.renderer?.setBlur) {
          this.coordinator.renderer.setBlur(isBlurred);
        }
        getActiveSubEls().forEach((el) => {
          if (isBlurred) {
            el.classList.add("is-blurred");
            el.style.setProperty("filter", "blur(6px)", "important");
          } else {
            el.classList.remove("is-blurred");
            el.style.setProperty("filter", "none", "important");
          }
        });
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host) {
          host.setPlaybackMode(isBlurred ? "blur_hover" : "always");
        }
        const btn = getEl("hud-toggle-blur");
        if (btn) btn.textContent = `Blur: ${isBlurred ? "On" : "Off"}`;
        this._saveStoredPrefs().catch(() => {});
      });

      // Opacity Controls (Controls subtitle background alpha; preserves text legibility)
      const applyOpacity = (num) => {
        const clamped = Math.max(0.0, Math.min(1.0, num));
        this.displayPrefs.opacity = clamped;
        if (this.coordinator?.renderer?.setOpacity) {
          this.coordinator.renderer.setOpacity(clamped);
        }
        const pct = Math.round(clamped * 100);
        const valEl = getEl("hud-opacity-val");
        if (valEl) valEl.textContent = `${pct}%`;
        const slider = getEl("hud-opacity-slider");
        if (slider) {
          if (typeof document !== "undefined" && document.activeElement !== slider) {
            slider.value = String(pct);
          }
          if (typeof slider.style?.setProperty === "function") {
            slider.style.setProperty("--slider-pct", `${pct}%`);
          } else if (slider.style) {
            slider.style["--slider-pct"] = `${pct}%`;
          }
        }
        getActiveSubEls().forEach((el) => {
          if (el.id === "ankiminer-video-subtitle-box" || el.classList?.contains?.("subtitle-display-bubble") || el.classList?.contains?.("hud-primary-cue")) {
            el.style.setProperty("background-color", `rgba(0, 0, 0, ${clamped})`, "important");
            el.style.setProperty("background", `rgba(0, 0, 0, ${clamped})`, "important");
            el.style.setProperty("opacity", "1", "important");
          }
        });
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host && typeof host.setOpacity === "function") {
          host.setOpacity(clamped);
        }
        const legacyBtn = getEl("hud-toggle-opacity");
        if (legacyBtn && legacyBtn.tagName === "BUTTON") legacyBtn.textContent = `Opacity: ${pct}%`;
        this._saveStoredPrefs().catch(() => {});
      };

      const opacitySlider = getEl("hud-opacity-slider");
      if (opacitySlider) {
        const initOpacity = typeof this.displayPrefs.opacity === "number" ? this.displayPrefs.opacity : 1.0;
        const initPct = Math.round(initOpacity * 100);
        opacitySlider.value = String(initPct);
        if (typeof opacitySlider.style?.setProperty === "function") {
          opacitySlider.style.setProperty("--slider-pct", `${initPct}%`);
        } else if (opacitySlider.style) {
          opacitySlider.style["--slider-pct"] = `${initPct}%`;
        }
        const valEl = getEl("hud-opacity-val");
        if (valEl) valEl.textContent = `${initPct}%`;

        opacitySlider.addEventListener("pointerdown", (e) => e.stopPropagation());
        opacitySlider.addEventListener("mousedown", (e) => e.stopPropagation());
        opacitySlider.addEventListener?.("input", (e) => {
          const val = parseInt(e.target.value, 10) / 100;
          applyOpacity(val);
        });
        opacitySlider.addEventListener?.("change", (e) => {
          const val = parseInt(e.target.value, 10) / 100;
          applyOpacity(val);
        });
      }

      getEl("hud-toggle-furigana")?.addEventListener("click", () => {
        const modes = ["hover", "always", "hidden"];
        const current = this.displayPrefs.furiganaMode || "hover";
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        this.displayPrefs.furiganaMode = next;
        const labels = { hover: "Furi: Hover", always: "Furi: On", hidden: "Furi: Off" };
        const btn = getEl("hud-toggle-furigana");
        if (btn) btn.textContent = labels[next] || "Furi: Hover";
        const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
        if (host?.setFuriganaMode) {
          host.setFuriganaMode(next);
        }
        if (this.coordinator?.renderer?.setFuriganaMode) {
          this.coordinator.renderer.setFuriganaMode(next);
          if (this.coordinator.syncEngine?.currentCue) {
            this.coordinator.renderer.renderCue(this.coordinator.syncEngine.currentCue);
          }
        }
        this._saveStoredPrefs().catch(() => {});
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
        this._saveStoredPrefs().catch(() => {});
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
      this.restoreEpisodeState().catch(() => {});
    }

    async _getPageContext() {
      let url = typeof location !== "undefined" ? location.href : "";
      let title = typeof document !== "undefined" ? document.title : "";
      let domEpisode = null;
      const isIframe = typeof window !== "undefined" && window.top && window !== window.top;
      if (isIframe && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const tabInfo = await chrome.runtime.sendMessage({ type: "GET_TAB_INFO" });
          if (tabInfo?.ok) {
            if (tabInfo.url) url = tabInfo.url;
            if (tabInfo.title) title = tabInfo.title;
            if (typeof tabInfo.domEpisode === "number") domEpisode = tabInfo.domEpisode;
          }
        } catch (_) {}
      }
      return { url, title, domEpisode };
    }

    async getEpisodeKey() {
      const { url, title } = await this._getPageContext();
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

        // Restore cached subtitle cues specifically for this episode/video link
        const { url: ctxUrl } = await this._getPageContext();
        const pageUrl = ctxUrl || (typeof location !== "undefined" ? (location.origin + location.pathname + (location.search || "")) : "");
        if (pageUrl && typeof chrome !== "undefined" && chrome.storage?.local) {
          const cacheKeyEnc = "kiroku_sub_url_" + encodeURIComponent(pageUrl);
          const cacheKeyRaw = "kiroku_sub_url_" + pageUrl;
          chrome.storage.local.get([cacheKeyEnc, cacheKeyRaw], (res) => {
            const cached = res?.[cacheKeyEnc] || res?.[cacheKeyRaw] || null;
            if (cached && Array.isArray(cached.cues) && cached.cues.length > 0) {
              if (this.coordinator?.handleCuesLoaded) {
                this.coordinator.handleCuesLoaded(cached.cues, cached.filename);
              } else if (this.coordinator?.syncEngine) {
                this.coordinator.syncEngine.setCues(cached.cues);
              }
              const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
              if (host) host.setCues(cached.cues);
              this.setSubStatus({
                source: "file",
                name: cached.filename || "subtitles",
                count: cached.cues.length,
                offsetMs: cached.offsetMs || 0
              });
              if (this.coordinator?.setSubtitlesDisplay) {
                this.coordinator.setSubtitlesDisplay(true);
              }
            }
          });
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
        let epNum = null;
        if (!query) {
          const { url, title: rawTitle, domEpisode } = await this._getPageContext();
          const titleParser = typeof TitleParser !== "undefined" ? TitleParser : (globalThis.TitleParser || null);
          if (titleParser?.cleanAnimeTitle) {
            const parsed = titleParser.cleanAnimeTitle(rawTitle, url);
            query = parsed.title || rawTitle;
            epNum = parsed.episode ?? domEpisode;
          } else {
            query = rawTitle;
            epNum = domEpisode;
          }
        }
        if (!query) return;

        let apiKey = "";
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("jimaku_api_key");
          apiKey = stored?.jimaku_api_key || "";
        }
        if (!apiKey && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            const keyResp = await chrome.runtime.sendMessage({ type: "GET_JIMAKU_KEY" });
            if (keyResp?.ok && keyResp.apiKey) {
              apiKey = keyResp.apiKey;
            }
          } catch (_) {}
        }
        if (!apiKey) {
          const trackNameEl = this._getShadowEl("hud-track-name");
          if (trackNameEl) trackNameEl.textContent = "Set Jimaku key in sidepanel";
          return;
        }

        const statsEl = this._getShadowEl("hud-track-stats");
        if (statsEl) statsEl.textContent = "Searching…";

        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          const res = await chrome.runtime.sendMessage({
            type: "JIMAKU_SEARCH",
            query,
            apiKey
          });
          if (res?.ok && Array.isArray(res.entries) && res.entries.length > 0) {
            const primaryEntry = res.entries[0];
            const filesResp = await chrome.runtime.sendMessage({
              type: "FETCH_JIMAKU_API",
              url: `https://jimaku.cc/api/entries/${primaryEntry.id}/files`,
              apiKey
            }).catch(() => null);

            const rawFiles = filesResp?.ok ? (Array.isArray(filesResp.data) ? filesResp.data : (filesResp.data?.files || [])) : [];
            const mappedTracks = rawFiles.map((file, idx) => {
              const rawDl = file.download_url || file.url || (file.id ? `https://jimaku.cc/api/entries/${primaryEntry.id}/files/${file.id}` : "");
              const downloadUrl = rawDl.startsWith("http://") || rawDl.startsWith("https://") ? rawDl : `https://jimaku.cc${rawDl.startsWith("/") ? "" : "/"}${rawDl}`;
              return {
                id: `jimaku-file-${file.id || idx}`,
                name: file.name || `Episode Track ${idx + 1}`,
                source: "jimaku",
                file,
                entryId: primaryEntry.id,
                downloadUrl
              };
            });

            if (mappedTracks.length === 0) {
              res.entries.forEach((entry, idx) => {
                mappedTracks.push({
                  id: `jimaku-${entry.id || idx}`,
                  name: entry.japanese_name || entry.name || `Entry #${entry.id}`,
                  source: "jimaku",
                  entry,
                  entryId: entry.id
                });
              });
            }

            this.setTracks(mappedTracks);
            const section = this._getShadowEl("hud-tracks-section");
            if (section) section.style.display = "flex";
            if (statsEl) statsEl.textContent = `${mappedTracks.length} tracks`;

            // Auto-detect and auto-load subtitle matching current episode
            if (epNum !== null && mappedTracks.length > 0) {
              const titleParser = typeof TitleParser !== "undefined" ? TitleParser : (globalThis.TitleParser || null);
              const matchingTrack = mappedTracks.find(t => {
                if (!t.file?.name) return false;
                if (titleParser?.cleanAnimeTitle) {
                  const fParsed = titleParser.cleanAnimeTitle(t.file.name);
                  if (fParsed.episode === epNum) return true;
                }
                const epRegex = new RegExp(`(?:^|[^0-9])(?:ep|episode|e|#|第)?\\s*0*${epNum}(?:話|[vV]\\d)?(?:[^0-9]|$)`, "i");
                return epRegex.test(t.file.name);
              });

              if (matchingTrack && matchingTrack.downloadUrl) {
                const dlResp = await chrome.runtime.sendMessage({
                  type: "FETCH_JIMAKU_API",
                  url: matchingTrack.downloadUrl,
                  apiKey
                });
                const subText = dlResp?.text || (typeof dlResp?.data === "string" ? dlResp.data : "");
                if (dlResp?.ok && subText) {
                  const parser = typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null);
                  if (parser) {
                    const parsed = parser.parseSubtitles(subText, matchingTrack.name);
                    const cues = typeof parser.normalizeCues === "function" ? parser.normalizeCues(parsed) : parsed;
                    if (cues && cues.length > 0) {
                      await this._ingestAndSyncSubtitles(cues, matchingTrack.name, "jimaku");
                      if (statsEl) statsEl.textContent = `Auto-loaded Ep.${epNum}`;
                      if (section) {
                        section.classList.add("is-collapsed");
                        const collapseBtn = this._getShadowEl("hud-tracks-collapse-btn");
                        if (collapseBtn) {
                          collapseBtn.setAttribute("aria-expanded", "false");
                        }
                      }
                    }
                  }
                }
              }
            }
          } else if (res?.error === "UNAUTHORIZED" || (res?.message && res.message.includes("401"))) {
            if (statsEl) statsEl.textContent = "Invalid Key";
            const modal = this._getShadowEl("hud-jimaku-modal");
            if (modal) {
              modal.style.display = "flex";
              const msgEl = this._getShadowEl("hud-jimaku-msg");
              if (msgEl) msgEl.textContent = "Invalid API key, please update:";
            }
          } else {
            if (statsEl) statsEl.textContent = "0 tracks found";
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
        const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
        // If native video was requested fullscreen directly, redirect to player container so overlays stay visible in top layer
        if (fsEl.tagName === "VIDEO" && this.video) {
          const container = (typeof fsEl.closest === "function" && fsEl.closest(selector)) || fsEl.parentElement;
          if (container && container !== fsEl && typeof container.requestFullscreen === "function") {
            container.requestFullscreen().catch(() => {});
          }
        }
        const targetParent = (fsEl.tagName === "VIDEO")
          ? ((typeof fsEl.closest === "function" && fsEl.closest(selector)) || fsEl.parentElement || fsEl)
          : fsEl;
        if (targetParent) {
          const compPos = typeof getComputedStyle === "function" ? getComputedStyle(targetParent)?.position : targetParent.style?.position;
          if (!compPos || compPos === "static") {
            if (!targetParent.style) targetParent.style = {};
            targetParent.style.position = "relative";
          }
        }
        if (this.host.parentElement !== targetParent && targetParent) {
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

      // Schedule delayed check in case layout or player wrapper transitions asynchronously
      if (this._fsTimer) clearTimeout(this._fsTimer);
      this._fsTimer = setTimeout(() => {
        const currentFs = (typeof document !== "undefined")
          ? (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement)
          : null;
        if (currentFs && this.host) {
          const selector = ".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video, .player-container, [id*='player']";
          const target = (currentFs.tagName === "VIDEO")
            ? ((typeof currentFs.closest === "function" && currentFs.closest(selector)) || currentFs.parentElement || currentFs)
            : currentFs;
          if (target && this.host.parentElement !== target) {
            target.appendChild(this.host);
          }
        }
      }, 120);
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
      // Intentionally suppressed per user request to avoid blocking video playback controls and timeline
      return;
    }

    hideNoSubsChip() {
      clearTimeout(this._noSubsTimer);
      this._getShadowEl("hud-no-subs-chip")?.classList.add("hidden");
    }

    updateTrackStatus(status) {
      return this.setSubStatus(status);
    }

    async _ingestAndSyncSubtitles(cues, filename, source = "file", skipCoord = false) {
      if (!cues || !cues.length) return;

      const host = typeof getHudHostForVideo === "function" ? getHudHostForVideo(this.video) : null;
      if (host) {
        host.setCues(cues);
      }

      if (!skipCoord) {
        if (this.coordinator?.handleCuesLoaded) {
          this.coordinator.handleCuesLoaded(cues, filename);
        } else if (this.coordinator?.syncEngine) {
          this.coordinator.syncEngine.setCues(cues);
          if (typeof this.coordinator.broadcastActiveCue === "function") {
            this.coordinator.broadcastActiveCue(this.coordinator.syncEngine.currentCue);
          }
        }
      }

      if (this.coordinator?.setSubtitlesDisplay) {
        this.coordinator.setSubtitlesDisplay(true);
      } else if (this.coordinator?.renderer?.setDisplayEnabled) {
        this.coordinator.renderer.setDisplayEnabled(true);
      }

      this.setSubStatus({
        source: source,
        name: filename,
        count: cues.length,
        offsetMs: this.coordinator?.syncEngine?.offsetMs || 0
      });

      // Persist active cues in local storage keyed by top-level episode URL
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const { url: ctxUrl } = await this._getPageContext();
          const pageUrl = ctxUrl || (typeof location !== "undefined" ? (location.origin + location.pathname + (location.search || "")) : "");
          const storageUpdate = {
            active_subtitle_cues: cues,
            active_subtitle_filename: filename
          };
          if (pageUrl) {
            storageUpdate["kiroku_sub_url_" + encodeURIComponent(pageUrl)] = {
              url: pageUrl,
              filename,
              cues,
              offsetMs: this.subStatus?.offsetMs || 0,
              timestamp: Date.now()
            };
          }
          await chrome.storage.local.set(storageUpdate);
        }
      } catch (_) {}

      // Asynchronously sync cues to backend and durable outbox in background
      try {
        const cueHash = (typeof SubtitleParser !== "undefined" && typeof SubtitleParser.computeHash === "function")
          ? SubtitleParser.computeHash(cues)
          : (filename ? `sub_${filename}_${cues.length}` : `sub_${cues.length}_${Date.now()}`);

        let series = this.coordinator?.episodeMeta?.series || "";
        let episodeNumber = this.coordinator?.episodeMeta?.episodeNumber ?? null;
        let episodeKey = this.coordinator?.episodeMeta?.episodeKey || "";
        let title = this.coordinator?.episodeMeta?.title || (filename ? filename.replace(/\.[^/.]+$/, "") : (typeof document !== "undefined" ? document.title : "Immersion Video"));
        let mediaType = this.coordinator?.episodeMeta?.mediaType || "anime";
        let site = this.coordinator?.episodeMeta?.site || (typeof location !== "undefined" ? location.hostname : "local");

        const titleParser = (typeof TitleParser !== "undefined")
          ? TitleParser
          : (typeof window !== "undefined" && window.TitleParser ? window.TitleParser : null);

        if ((!series || !episodeNumber) && titleParser) {
          const { url: pageUrl, title: rawDocTitle, domEpisode } = await this._getPageContext();
          const parsed = titleParser.cleanAnimeTitle(filename || rawDocTitle, pageUrl);
          if (parsed && parsed.title) {
            if (!series) series = parsed.title;
            const resolvedEp = parsed.episode ?? domEpisode;
            if (episodeNumber === null && resolvedEp !== null && resolvedEp !== undefined) {
              episodeNumber = resolvedEp;
            }
          }
          if (!episodeKey && typeof titleParser.parseEpisodeKey === "function") {
            const parsedKey = titleParser.parseEpisodeKey(pageUrl, rawDocTitle);
            episodeKey = typeof parsedKey === "string" ? parsedKey : (parsedKey?.episodeKey || "");
          }
        }

        const syncPayload = {
          hash: cueHash,
          title: title,
          series: series || undefined,
          episode_number: (typeof episodeNumber === "number" && episodeNumber > 0) ? episodeNumber : 1,
          episode_key: episodeKey || undefined,
          site: site,
          media_type: mediaType,
          cues: cues.slice(0, 5000)
        };
        const minedCount = this.coordinator?.sessionLogger?.wordsMined || 0;
        if (minedCount >= 1) {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "EPISODE_SYNC_SUBTITLES",
              payload: {
                ...syncPayload,
                mined_words: Array.from(this.coordinator?.sessionLogger?.minedWordsSet || [])
              }
            }).catch(() => {});
          }
        } else if (this.coordinator) {
          this.coordinator._pendingSubtitleSync = syncPayload;
        }
      } catch (_) {}
    }

    _renderVisibilityBtn(btn, visible) {
      if (!btn) return;
      const eyeOpen = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      const eyeOff = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
      btn.innerHTML = `${visible ? eyeOpen : eyeOff}<span style="margin-left:5px;">${visible ? "Show" : "Hide"}</span>`;
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
        const sourceDrawer = this._getShadowEl("hud-source-drawer");
        const sourceHeader = this._getShadowEl("hud-source-header");
        if (sourceDrawer && !sourceDrawer.classList.contains("is-collapsed")) {
          sourceDrawer.classList.add("is-collapsed");
          if (typeof sourceHeader?.setAttribute === "function") {
            sourceHeader.setAttribute("aria-expanded", "false");
          }
        }
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
      const countLabel = this._getShadowEl("hud-tracks-count-label");
      const collapseBtn = this._getShadowEl("hud-tracks-collapse-btn");
      const filterInput = this._getShadowEl("hud-tracks-filter");
      if (!section || !list) return;

      if (this.tracks.length === 0) {
        section.style.display = "none";
        list.innerHTML = "";
        return;
      }

      section.style.display = "flex";
      section.classList.remove("is-collapsed");
      const sourceDrawer = this._getShadowEl("hud-source-drawer");
      const sourceHeader = this._getShadowEl("hud-source-header");
      if (sourceDrawer && sourceDrawer.classList.contains("is-collapsed")) {
        sourceDrawer.classList.remove("is-collapsed");
        if (typeof sourceHeader?.setAttribute === "function") {
          sourceHeader.setAttribute("aria-expanded", "true");
        }
      }
      if (collapseBtn) {
        collapseBtn.setAttribute("aria-expanded", "true");
      }
      if (countLabel) {
        countLabel.textContent = `Tracks (${this.tracks.length})`;
      }
      if (filterInput) {
        filterInput.value = "";
      }

      list.innerHTML = "";
      const frag = document.createDocumentFragment();
      const getJimakuKey = async () => {
        let apiKey = "";
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const stored = await chrome.storage.local.get("jimaku_api_key");
          apiKey = stored?.jimaku_api_key || "";
        }
        if (!apiKey && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            const keyResp = await chrome.runtime.sendMessage({ type: "GET_JIMAKU_KEY" });
            if (keyResp?.ok && keyResp.apiKey) apiKey = keyResp.apiKey;
          } catch (_) {}
        }
        return apiKey;
      };

      this.tracks.forEach((tr, idx) => {
        const name = tr.name || tr.label || `Track ${idx + 1}`;
        const row = document.createElement("div");
        row.className = "hud-track-item";
        row.dataset.trackName = name;
        row.title = name;

        const labelSpan = document.createElement("span");
        labelSpan.className = "hud-track-item-label";
        labelSpan.textContent = name;

        const selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "hud-track-item-btn";
        selectBtn.textContent = "Select";

        row.appendChild(labelSpan);
        row.appendChild(selectBtn);

        const handleSelect = async (e) => {
          e.stopPropagation();
          if (row.classList.contains("is-loading")) return;

          if (tr.source === "jimaku") {
            let downloadUrl = tr.downloadUrl || (tr.file && (tr.file.download_url || tr.file.url));
            if (!downloadUrl && tr.file?.id && tr.entryId) {
              downloadUrl = `https://jimaku.cc/api/entries/${tr.entryId}/files/${tr.file.id}`;
            }

            row.classList.add("is-loading");
            selectBtn.textContent = "...";
            try {
              const apiKey = await getJimakuKey();

              // If entry was clicked without a file, fetch entry files and show them
              if (!downloadUrl && tr.entry?.id && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                const filesResp = await chrome.runtime.sendMessage({
                  type: "FETCH_JIMAKU_API",
                  url: `https://jimaku.cc/api/entries/${tr.entry.id}/files`,
                  apiKey
                });
                const files = filesResp?.ok ? (Array.isArray(filesResp.data) ? filesResp.data : (filesResp.data?.files || [])) : [];
                if (files.length > 0) {
                  const mapped = files.map((f, i) => ({
                    id: `jimaku-file-${f.id || i}`,
                    name: f.name || `File ${i + 1}`,
                    source: "jimaku",
                    file: f,
                    entryId: tr.entry.id,
                    downloadUrl: f.download_url || f.url || `https://jimaku.cc/api/entries/${tr.entry.id}/files/${f.id}`
                  }));
                  this.setTracks(mapped);
                  return;
                }
              }

              if (downloadUrl && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                const dlResp = await chrome.runtime.sendMessage({
                  type: "FETCH_JIMAKU_API",
                  url: downloadUrl,
                  apiKey
                });
                const subText = dlResp?.text || (typeof dlResp?.data === "string" ? dlResp.data : "");
                if (dlResp?.ok && subText) {
                  const parser = typeof SubtitleParser !== "undefined" ? SubtitleParser : (globalThis.SubtitleParser || null);
                  if (parser) {
                    const parsed = parser.parseSubtitles(subText, tr.name || "jimaku.ass");
                    const cues = typeof parser.normalizeCues === "function" ? parser.normalizeCues(parsed) : parsed;
                    if (cues && cues.length > 0) {
                      await this._ingestAndSyncSubtitles(cues, tr.name || "jimaku.ass", "jimaku");
                      section.classList.add("is-collapsed");
                      if (collapseBtn) {
                        collapseBtn.setAttribute("aria-expanded", "false");
                      }
                      return;
                    }
                  }
                }
              }
              selectBtn.textContent = "Failed";
              setTimeout(() => { selectBtn.textContent = "Select"; }, 1500);
            } catch (_) {
              selectBtn.textContent = "Error";
              setTimeout(() => { selectBtn.textContent = "Select"; }, 1500);
            } finally {
              row.classList.remove("is-loading");
            }
          } else if (this.coordinator?.selectTrack) {
            this.coordinator.selectTrack(tr);
            section.classList.add("is-collapsed");
            if (collapseBtn) {
              collapseBtn.setAttribute("aria-expanded", "false");
            }
          }
        };

        row.addEventListener("click", handleSelect);
        selectBtn.addEventListener("click", handleSelect);
        frag.appendChild(row);
      });
      list.appendChild(frag);
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
          if (this.coordinator?.handleDroppedFile) {
            await this.coordinator.handleDroppedFile(file);
          }
          await this._ingestAndSyncSubtitles(cues, file.name, "file");
        }
      } catch (err) {
        console.error("[AnimeHud] Error loading file:", err);
      }
    }

    async _loadStoredPrefs() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get(["kiroku.hud.prefs", "kiroku_hud_btn_pos"]);
          if (res && res["kiroku.hud.prefs"]) {
            this.displayPrefs = { ...this.displayPrefs, ...res["kiroku.hud.prefs"] };
            this._applyStoredPrefs();
          }
          if (res?.kiroku_hud_btn_pos) {
            const btn = this._getShadowEl("hud-toggle-btn");
            if (btn && res.kiroku_hud_btn_pos.left && res.kiroku_hud_btn_pos.top) {
              btn.style.left = res.kiroku_hud_btn_pos.left;
              btn.style.top = res.kiroku_hud_btn_pos.top;
              btn.style.right = "auto";
            }
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
        if (el && el.tagName === "BUTTON") el.textContent = `Font Size: ${this.displayPrefs.fontSize}px`;
        const valEl = getEl("hud-font-size-val");
        if (valEl) valEl.textContent = `${this.displayPrefs.fontSize}px`;
        if (this.coordinator?.renderer?.setFontSize) {
          this.coordinator.renderer.setFontSize(this.displayPrefs.fontSize);
        }
      }
      if (this.displayPrefs.opacity !== undefined) {
        const pct = Math.round(this.displayPrefs.opacity * 100);
        const slider = getEl("hud-opacity-slider");
        if (slider) {
          slider.value = String(pct);
          if (typeof slider.style?.setProperty === "function") {
            slider.style.setProperty("--slider-pct", `${pct}%`);
          } else if (slider.style) {
            slider.style["--slider-pct"] = `${pct}%`;
          }
        }
        const valEl = getEl("hud-opacity-val");
        if (valEl) valEl.textContent = `${pct}%`;
        if (this.coordinator?.renderer?.setOpacity) {
          this.coordinator.renderer.setOpacity(this.displayPrefs.opacity);
        }
      }
      if (this.displayPrefs.position) {
        const posBtn = getEl("hud-toggle-pos");
        if (posBtn) posBtn.textContent = `Pos: ${this.displayPrefs.position === "bottom" ? "Bottom" : "Top"}`;
        if (this.coordinator?.renderer?.setPosition) {
          this.coordinator.renderer.setPosition(this.displayPrefs.position);
        }
      }
      if (this.displayPrefs.showJa !== undefined) {
        const visBtn = getEl("hud-toggle-visibility");
        this._renderVisibilityBtn(visBtn, this.displayPrefs.showJa !== false);
        if (this.coordinator?.setSubtitlesDisplay) {
          this.coordinator.setSubtitlesDisplay(this.displayPrefs.showJa);
        } else if (this.coordinator?.renderer?.setDisplayEnabled) {
          this.coordinator.renderer.setDisplayEnabled(this.displayPrefs.showJa);
        }
      }
      {
        const furiMode = this.displayPrefs.furiganaMode || (this.displayPrefs.furigana === false ? "hidden" : "hover");
        this.displayPrefs.furiganaMode = furiMode;
        const labels = { hover: "Furi: Hover", always: "Furi: On", hidden: "Furi: Off" };
        const el = getEl("hud-toggle-furigana");
        if (el) el.textContent = labels[furiMode] || "Furi: Hover";
        if (this.coordinator?.renderer?.setFuriganaMode) {
          this.coordinator.renderer.setFuriganaMode(furiMode);
        }
      }
      if (this.displayPrefs.blur !== undefined) {
        const el = getEl("hud-toggle-blur");
        if (el) el.textContent = `Blur: ${this.displayPrefs.blur ? "On" : "Off"}`;
        if (this.coordinator?.renderer?.setBlur) {
          this.coordinator.renderer.setBlur(this.displayPrefs.blur);
        }
      }
    }

    _notifySubStatus() {
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AnimeHud;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.AnimeHud = AnimeHud;
  }
})();
