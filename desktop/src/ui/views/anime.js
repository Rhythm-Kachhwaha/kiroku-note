/**
 * Kiroku Note Desktop — Anime Companion View
 * Live companion screen connecting to browser extension / link hub for anime subtitle mining.
 * Mimics standard tab header with uplifting wordmark letters, live cue box, and playback controls.
 */

import { LinkClient } from '../services/link_client.js';
import { LinkStore } from '../services/link_store.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { apiClient } from '../services/api_client.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

const JLPT_ORDER = { 'N5': 1, 'N4': 2, 'N3': 3, 'N2': 4, 'N1': 5 };

function isGrammarAboveLevel(pointLevel, userLevel) {
  const pRank = JLPT_ORDER[pointLevel] || 0;
  const uRank = JLPT_ORDER[userLevel] || 0;
  return pRank > uRank;
}

export class AnimeView {
  constructor(router, options = {}) {
    this.router = router;
    this.options = options;
    this.apiClient = options.apiClient || apiClient;
    this.learnerLevel = options.learnerLevel || (typeof getUniversalJlptLevel === 'function' ? getUniversalJlptLevel() : 'N4');
    this.container = null;
    this.linkClient = options.linkClient || null;
    this.linkStore = options.linkStore || null;
    this._statusListener = null;
    this._sessionListener = null;
    this._stateListener = null;
    this._cueListener = null;
    this._activeCueListener = null;
    this._keyListener = null;
    this.subtitleOffset = 0;
    this.isLooping = false;
    this.annotatedCuesMap = new Map();
    this.cueGrammarMap = new Map();
    this.showTokenColors = true;
    this.currentFilter = 'all';
    this.lastLoadedHash = null;
    this._fetchingGrammar = new Set();
  }

  async mount(container) {
    this.container = container;
    this._initStore();
    this.render();
    this.setupEvents();
    this.updateFromStore();
  }

  _initStore() {
    if (!this.linkClient) {
      this.linkClient = new LinkClient();
      this.linkStore = new LinkStore(this.linkClient);
      this.linkClient.start().catch((err) => {
        console.warn('[AnimeView] LinkClient failed to start:', err);
      });
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="anime-view-wrapper">
        <div class="anime-view-container">
          <!-- Page Header: Uplifting Letters & Katakana Subhead -->
          <div class="anime-header-row grammar-header-row">
            <div>
              <div class="grammar-brand-header" aria-label="Anime アニメ">
                <h1 class="grammar-word-title" aria-label="ANIME">
                  <span class="hero-letter">A</span><span class="hero-letter">N</span><span class="hero-letter">I</span><span class="hero-letter">M</span><span class="hero-letter">E</span>
                </h1>
                <span class="grammar-word-kanji" aria-label="アニメ">
                  <span class="hero-letter">ア</span><span class="hero-letter">ニ</span><span class="hero-letter">メ</span>
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="anime-site-chip" id="anime-connection-chip">Disconnected</span>
            </div>
          </div>

          <!-- Main Companion Grid -->
          <div class="anime-layout-grid">
            <!-- Left: Live Subtitle Box & Remote Controls -->
            <div class="anime-player-card">
              <div class="anime-session-strip">
                <div class="anime-session-title">
                  <span id="anime-active-title">No active video stream</span>
                </div>
                <div class="anime-time-indicator" id="anime-time-indicator">00:00 / 00:00</div>
              </div>

              <!-- Live Japanese Subtitle Cue Display -->
              <div class="anime-live-cue-box" id="anime-cue-box">
                <div class="anime-live-cue-japanese" id="anime-cue-text">
                  <span class="anime-live-cue-empty">Start playback in browser with Kiroku Extension to mine Japanese dialogue</span>
                </div>
              </div>

              <!-- Controls Bar -->
              <div class="anime-controls-bar">
                <div class="anime-controls-subrow">
                  <div class="flex items-center gap-2">
                    <button type="button" class="anime-control-btn btn-primary" id="btn-anime-toggle" aria-label="Play or Pause">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                      <span id="anime-btn-play-label">Play</span>
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-seek-back" aria-label="Rewind 5 seconds">
                      -5s
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-seek-fwd" aria-label="Fast forward 5 seconds">
                      +5s
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-prev-cue" aria-label="Previous line">
                      Prev Line
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-next-cue" aria-label="Next line">
                      Next Line
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-replay-cue" aria-label="Replay current line">
                      Replay
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-loop" aria-label="Loop current line">
                      <span id="anime-btn-loop-label">Loop</span>
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <button type="button" class="anime-control-btn btn-primary" id="btn-anime-clip" aria-label="Clip Dialogue">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                      <span>Mine Line</span>
                    </button>
                  </div>
                </div>

                <div class="anime-controls-subrow pt-1">
                  <!-- Speed Selector -->
                  <div class="anime-control-group" aria-label="Playback Speed">
                    <span class="text-xs text-muted" style="padding: 0 0.25rem;">Speed</span>
                    <button type="button" class="anime-control-btn anime-rate-btn" data-rate="0.75">0.75x</button>
                    <button type="button" class="anime-control-btn anime-rate-btn active" data-rate="1">1x</button>
                    <button type="button" class="anime-control-btn anime-rate-btn" data-rate="1.25">1.25x</button>
                    <button type="button" class="anime-control-btn anime-rate-btn" data-rate="1.5">1.5x</button>
                  </div>

                  <!-- Subtitle Offset -->
                  <div class="anime-control-group" aria-label="Subtitle Offset">
                    <span class="text-xs text-muted" style="padding: 0 0.25rem;">Offset</span>
                    <button type="button" class="anime-control-btn" id="btn-anime-offset-minus" aria-label="Minus 100ms">-100ms</button>
                    <button type="button" class="anime-control-btn" id="btn-anime-offset-zero" aria-label="Reset 0ms">0</button>
                    <button type="button" class="anime-control-btn" id="btn-anime-offset-plus" aria-label="Plus 100ms">+100ms</button>
                    <span class="anime-offset-badge" id="anime-offset-badge">0ms</span>
                  </div>
                </div>
              </div>

              <!-- Transcript Strip Section (Slice 27) -->
              <div class="anime-transcript-container" id="anime-transcript-container">
                <div class="anime-transcript-header">
                  <div class="flex items-center gap-2">
                    <span class="anime-transcript-title">Transcript Strip</span>
                    <span class="anime-cues-badge" id="anime-cues-badge">0 cues</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <select class="anime-transcript-filter" id="anime-transcript-filter" aria-label="Filter transcript">
                      <option value="all">All lines</option>
                      <option value="max1gap">Lines with &le; 1 unknown</option>
                      <option value="grammar-above">Grammar above my level</option>
                    </select>
                    <button type="button" class="anime-control-btn btn-sm" id="btn-anime-toggle-coloring" aria-label="Toggle token coloring">
                      <span id="anime-coloring-label">Colors: On</span>
                    </button>
                  </div>
                </div>

                <div class="anime-transcript-list" id="anime-transcript-list" tabindex="0" role="region" aria-label="Dialogue transcript">
                  <div class="anime-transcript-empty" id="anime-transcript-empty">
                    No dialogue cues loaded yet
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Sidebar: Hub & Stream Diagnostics -->
            <div class="anime-sidebar-card">
              <div class="anime-sidebar-title">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
                Companion Status
              </div>

              <div class="anime-status-row">
                <span>Link Hub</span>
                <span class="anime-status-val" id="anime-hub-status">127.0.0.1:21828</span>
              </div>
              <div class="anime-status-row">
                <span>Active Source</span>
                <span class="anime-status-val" id="anime-source-name">—</span>
              </div>
              <div class="anime-status-row">
                <span>Cues Loaded</span>
                <span class="anime-status-val" id="anime-cues-count">0</span>
              </div>
              <div class="anime-status-row">
                <span>DRM Mode</span>
                <span class="anime-status-val" id="anime-drm-status">Companion</span>
              </div>

              <div class="pt-2">
                <p class="text-xs text-muted" style="line-height: 1.4;">
                  Supported video sites: YouTube, Netflix, Crunchyroll, and local videos.
                  Dialogue cues synchronize automatically when active.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    if (!this.container) return;

    const btnToggle = this.container.querySelector('#btn-anime-toggle');
    const btnSeekBack = this.container.querySelector('#btn-anime-seek-back');
    const btnSeekFwd = this.container.querySelector('#btn-anime-seek-fwd');
    const btnPrevCue = this.container.querySelector('#btn-anime-prev-cue');
    const btnNextCue = this.container.querySelector('#btn-anime-next-cue');
    const btnReplayCue = this.container.querySelector('#btn-anime-replay-cue');
    const btnLoop = this.container.querySelector('#btn-anime-loop');
    const btnClip = this.container.querySelector('#btn-anime-clip');

    btnToggle?.addEventListener('click', () => {
      this.linkStore?.toggle();
    });

    btnSeekBack?.addEventListener('click', () => {
      this.linkStore?.seek(undefined, -5);
    });

    btnSeekFwd?.addEventListener('click', () => {
      this.linkStore?.seek(undefined, 5);
    });

    btnPrevCue?.addEventListener('click', () => {
      this.linkStore?.jumpCue({ delta: -1 });
    });

    btnNextCue?.addEventListener('click', () => {
      this.linkStore?.jumpCue({ delta: 1 });
    });

    btnReplayCue?.addEventListener('click', () => {
      const activeCue = this.linkStore?.activeCue;
      if (activeCue) {
        this.linkStore.seek(activeCue.s);
      }
    });

    btnLoop?.addEventListener('click', () => {
      this.toggleLoop();
    });

    btnClip?.addEventListener('click', () => {
      this.clipActiveCue();
    });

    // Speed selector buttons
    const rateBtns = this.container.querySelectorAll('.anime-rate-btn');
    rateBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const rate = parseFloat(btn.dataset.rate);
        if (!isNaN(rate)) {
          this.linkStore?.setRate(rate);
          this._updateRateButtons(rate);
        }
      });
    });

    // Offset buttons
    const btnOffsetMinus = this.container.querySelector('#btn-anime-offset-minus');
    const btnOffsetZero = this.container.querySelector('#btn-anime-offset-zero');
    const btnOffsetPlus = this.container.querySelector('#btn-anime-offset-plus');

    btnOffsetMinus?.addEventListener('click', () => {
      this.subtitleOffset = (this.subtitleOffset || 0) - 100;
      this.linkStore?.setOffset(this.subtitleOffset);
      this._updateOffsetBadge();
    });

    btnOffsetZero?.addEventListener('click', () => {
      this.subtitleOffset = 0;
      this.linkStore?.setOffset(0);
      this._updateOffsetBadge();
    });

    btnOffsetPlus?.addEventListener('click', () => {
      this.subtitleOffset = (this.subtitleOffset || 0) + 100;
      this.linkStore?.setOffset(this.subtitleOffset);
      this._updateOffsetBadge();
    });

    // Transcript list click delegation
    const listEl = this.container.querySelector('#anime-transcript-list');
    listEl?.addEventListener('click', (e) => {
      const item = e.target.closest('.anime-transcript-item');
      if (item && item.dataset.start !== undefined) {
        const startTime = parseFloat(item.dataset.start);
        if (!isNaN(startTime)) {
          this.linkStore?.seek(startTime);
        }
      }
    });

    // Filter dropdown change
    const filterSelect = this.container.querySelector('#anime-transcript-filter');
    filterSelect?.addEventListener('change', (e) => {
      this.currentFilter = e.target.value;
      this.renderTranscriptList();
    });

    // Color toggle button
    const btnToggleColor = this.container.querySelector('#btn-anime-toggle-coloring');
    btnToggleColor?.addEventListener('click', () => {
      this.showTokenColors = !this.showTokenColors;
      const label = this.container.querySelector('#anime-coloring-label');
      if (label) {
        label.textContent = this.showTokenColors ? 'Colors: On' : 'Colors: Off';
      }
      const listContainer = this.container.querySelector('#anime-transcript-list');
      listContainer?.classList.toggle('hide-token-colors', !this.showTokenColors);
      this.renderTranscriptList();
    });

    // Local keyboard navigation
    this._keyListener = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.linkStore?.toggle();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.linkStore?.jumpCue({ delta: -1 });
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.linkStore?.jumpCue({ delta: 1 });
      } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        const activeCue = this.linkStore?.activeCue;
        if (activeCue) {
          this.linkStore?.seek(activeCue.s);
        }
      } else if (e.code === 'KeyL' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        this.toggleLoop();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._keyListener);
    }

    if (this.linkStore) {
      this._statusListener = () => this.updateFromStore();
      this._sessionListener = () => this.updateFromStore();
      this._stateListener = () => this.updateFromStore();
      this._cueListener = () => this.updateFromStore();
      this._activeCueListener = () => this.updateFromStore();

      this.linkStore.on('status', this._statusListener);
      this.linkStore.on('session', this._sessionListener);
      this.linkStore.on('video:state', this._stateListener);
      this.linkStore.on('cues', this._cueListener);
      this.linkStore.on('cue:active', this._activeCueListener);
    }
  }

  toggleLoop() {
    const activeCue = this.linkStore?.activeCue;
    this.isLooping = !this.isLooping;
    if (this.isLooping && activeCue) {
      this.linkStore?.loop(activeCue.s, activeCue.e, 99);
    } else if (!this.isLooping && activeCue) {
      this.linkStore?.loop(activeCue.s, activeCue.e, 1);
    } else if (this.isLooping) {
      const t = this.linkStore?.videoState?.t || 0;
      this.linkStore?.loop(t, t + 3, 99);
    }
    this._updateLoopButton();
  }

  clipActiveCue() {
    const activeCue = this.linkStore?.activeCue;
    const reqId = 'clip-' + Date.now();
    const s = activeCue ? activeCue.s : (this.linkStore?.videoState?.t || 0);
    const e = activeCue ? activeCue.e : (s + 3.0);
    this.linkStore?.requestClip(reqId, s, e, ['image', 'audio']);
  }

  _updateLoopButton() {
    const btnLoop = this.container?.querySelector('#btn-anime-loop');
    const label = this.container?.querySelector('#anime-btn-loop-label');
    if (btnLoop) {
      btnLoop.classList.toggle('active', this.isLooping);
      btnLoop.classList.toggle('is-active', this.isLooping);
    }
    if (label) {
      label.textContent = this.isLooping ? 'Looping' : 'Loop';
    }
  }

  _updateRateButtons(activeRate) {
    const rateBtns = this.container?.querySelectorAll('.anime-rate-btn');
    rateBtns?.forEach((btn) => {
      const r = parseFloat(btn.dataset.rate);
      const isMatch = Math.abs(r - activeRate) < 0.05;
      btn.classList.toggle('active', isMatch);
      btn.classList.toggle('is-active', isMatch);
    });
  }

  _updateOffsetBadge() {
    const badge = this.container?.querySelector('#anime-offset-badge');
    if (badge) {
      const val = this.subtitleOffset || 0;
      badge.textContent = `${val > 0 ? '+' : ''}${val}ms`;
    }
  }

  updateFromStore() {
    if (!this.container || !this.linkStore) return;

    const summary = this.linkStore.getStatusSummary();
    const isConnected = summary.status === 'connected';

    // Connection chip
    const chip = this.container.querySelector('#anime-connection-chip');
    if (chip) {
      chip.textContent = isConnected ? 'Connected' : 'Listening';
      if (chip.style) {
        chip.style.color = isConnected ? 'var(--industrial-aqua)' : 'var(--text-muted)';
      }
    }

    // Controls disabled state + tooltip when disconnected
    const controlBtns = this.container.querySelectorAll('.anime-controls-bar button');
    controlBtns.forEach((btn) => {
      if (!isConnected) {
        btn.disabled = true;
        btn.setAttribute('title', 'Extension disconnected');
      } else {
        btn.disabled = false;
        btn.removeAttribute('title');
      }
    });

    // Active title
    const titleEl = this.container.querySelector('#anime-active-title');
    if (titleEl) {
      titleEl.textContent = summary.activeSession?.title || 'No active video stream';
    }

    // Source name
    const sourceEl = this.container.querySelector('#anime-source-name');
    if (sourceEl) {
      sourceEl.textContent = summary.activeSession?.site ? summary.activeSession.site.toUpperCase() : '—';
    }

    // DRM status
    const drmEl = this.container.querySelector('#anime-drm-status');
    if (drmEl) {
      drmEl.textContent = summary.activeSession?.drm ? 'DRM Stream' : 'Open Stream';
    }

    // Cues count
    const cuesCountEl = this.container.querySelector('#anime-cues-count');
    if (cuesCountEl) {
      cuesCountEl.textContent = String(summary.cueCount);
    }

    // Time indicator
    const timeEl = this.container.querySelector('#anime-time-indicator');
    if (timeEl && summary.videoState) {
      const cur = this._formatTime(summary.videoState.t || 0);
      const dur = this._formatTime(summary.activeSession?.duration || 0);
      timeEl.textContent = `${cur} / ${dur}`;
    }

    // Play/Pause button label
    const playLabel = this.container.querySelector('#anime-btn-play-label');
    if (playLabel && summary.videoState) {
      playLabel.textContent = summary.videoState.paused ? 'Play' : 'Pause';
    }

    // Reflect rate from videoState
    if (summary.videoState && typeof summary.videoState.rate === 'number') {
      this._updateRateButtons(summary.videoState.rate);
    }

    // Subtitle text
    const cueTextEl = this.container.querySelector('#anime-cue-text');
    if (cueTextEl) {
      if (summary.activeCue?.text) {
        cueTextEl.innerHTML = `<span>${escapeHtml(summary.activeCue.text)}</span>`;
      } else if (summary.activeSession) {
        cueTextEl.innerHTML = `<span class="anime-live-cue-empty">Listening for dialogue subtitles...</span>`;
      } else {
        cueTextEl.innerHTML = `<span class="anime-live-cue-empty">Start playback in browser with Kiroku Extension to mine Japanese dialogue</span>`;
      }
    }

    // Transcript cues fetching and rendering
    if (summary.cueHash && summary.cueHash !== this.lastLoadedHash) {
      this.lastLoadedHash = summary.cueHash;
      this.fetchCuesAnalysis(summary.cueHash);
    }
    this.renderTranscriptList();
  }

  async fetchCuesAnalysis(hash) {
    if (!hash || !this.apiClient) return;
    try {
      const res = await this.apiClient.request(`/api/link/cues/${encodeURIComponent(hash)}`);
      if (res && Array.isArray(res.cues)) {
        for (const cue of res.cues) {
          this.annotatedCuesMap.set(`${hash}:${cue.i}`, cue);
        }
        this.renderTranscriptList();
      }
    } catch (err) {
      console.debug('[AnimeView] fetchCuesAnalysis fallback:', err);
    }
  }

  async fetchCueGrammar(hash, i) {
    if (!hash || typeof i !== 'number' || !this.apiClient) return;
    const key = `${hash}:${i}`;
    if (this._fetchingGrammar.has(key)) return;
    this._fetchingGrammar.add(key);
    try {
      const res = await this.apiClient.request(`/api/link/cue-grammar?hash=${encodeURIComponent(hash)}&i=${i}`);
      if (res && Array.isArray(res.points)) {
        this.cueGrammarMap.set(key, res.points);
        this.renderTranscriptList();
      }
    } catch (err) {
      console.debug('[AnimeView] fetchCueGrammar fallback:', err);
    } finally {
      this._fetchingGrammar.delete(key);
    }
  }

  renderTranscriptList() {
    const listEl = this.container?.querySelector('#anime-transcript-list');
    const badgeEl = this.container?.querySelector('#anime-cues-badge');
    if (!listEl) return;

    const allCues = this.linkStore?.cues || [];
    const cueHash = this.linkStore?.cueHash;
    const activeCueIndex = this.linkStore?.activeCueIndex;

    if (badgeEl) {
      badgeEl.textContent = `${allCues.length} cues`;
    }

    if (allCues.length === 0) {
      listEl.innerHTML = `<div class="anime-transcript-empty" id="anime-transcript-empty">No dialogue cues loaded yet</div>`;
      return;
    }

    // Apply filters
    let filtered = allCues;
    if (this.currentFilter === 'max1gap') {
      filtered = allCues.filter(cue => {
        const ann = this.annotatedCuesMap.get(`${cueHash}:${cue.i}`);
        if (!ann) return true; // Keep until analyzed
        const gapCount = Array.isArray(ann.gap_words) ? ann.gap_words.length : 0;
        return gapCount <= 1;
      });
    } else if (this.currentFilter === 'grammar-above') {
      filtered = allCues.filter(cue => {
        const points = this.cueGrammarMap.get(`${cueHash}:${cue.i}`);
        if (!points || points.length === 0) return false;
        return points.some(pt => isGrammarAboveLevel(pt.level, this.learnerLevel));
      });
    }

    // Virtualization beyond 300 cues
    let displayCues = filtered;
    let topSpacerHeight = 0;
    let bottomSpacerHeight = 0;
    const CUE_HEIGHT_ESTIMATE = 64;

    if (filtered.length > 300) {
      const activeIdxInFiltered = filtered.findIndex(c => c.i === activeCueIndex);
      const center = activeIdxInFiltered >= 0 ? activeIdxInFiltered : 0;
      const windowStart = Math.max(0, center - 60);
      const windowEnd = Math.min(filtered.length, windowStart + 180);
      topSpacerHeight = windowStart * CUE_HEIGHT_ESTIMATE;
      bottomSpacerHeight = (filtered.length - windowEnd) * CUE_HEIGHT_ESTIMATE;
      displayCues = filtered.slice(windowStart, windowEnd);
    }

    let html = '';
    if (topSpacerHeight > 0) {
      html += `<div style="height: ${topSpacerHeight}px; pointer-events: none;"></div>`;
    }

    for (const cue of displayCues) {
      const isActive = cue.i === activeCueIndex;
      const ann = this.annotatedCuesMap.get(`${cueHash}:${cue.i}`);
      const grammarPoints = this.cueGrammarMap.get(`${cueHash}:${cue.i}`) || [];

      // If active and grammar not fetched, trigger prefetch
      if (isActive && cueHash && !this.cueGrammarMap.has(`${cueHash}:${cue.i}`)) {
        this.fetchCueGrammar(cueHash, cue.i);
      }

      // Build tokens / text
      let textContent = '';
      if (ann && Array.isArray(ann.tokens) && ann.tokens.length > 0) {
        textContent = ann.tokens.map(tok => {
          const status = tok.status || 'unstyled';
          const surface = escapeHtml(tok.surface || '');
          const statusClass = (this.showTokenColors && status !== 'unstyled') ? `is-${status} token-${status}` : '';
          return `<span class="anime-token-chip ${statusClass}" data-surface="${surface}" data-status="${status}"><span class="anime-token-surface">${surface}</span></span>`;
        }).join('');
      } else {
        textContent = escapeHtml(cue.text || '');
      }

      // Build grammar chips
      let grammarHtml = '';
      if (grammarPoints.length > 0) {
        grammarHtml = `<div class="anime-cue-grammar-row">` + grammarPoints.map(pt => {
          const above = isGrammarAboveLevel(pt.level, this.learnerLevel);
          const title = escapeHtml(pt.point || pt.title || '');
          const lvl = escapeHtml(pt.level || '');
          return `<span class="anime-grammar-chip ${above ? 'is-above-level' : ''}" data-level="${lvl}">${title} <small>${lvl}</small></span>`;
        }).join('') + `</div>`;
      }

      const timeLabel = this._formatTime(cue.s);
      html += `
        <div class="anime-transcript-item ${isActive ? 'is-active active' : ''}" data-cue-index="${cue.i}" data-start="${cue.s}">
          <div class="anime-transcript-meta">
            <span class="anime-transcript-time">[${timeLabel}]</span>
            <span>Cue #${cue.i + 1}</span>
          </div>
          <div class="anime-transcript-text">
            ${textContent}
          </div>
          ${grammarHtml}
        </div>
      `;
    }

    if (bottomSpacerHeight > 0) {
      html += `<div style="height: ${bottomSpacerHeight}px; pointer-events: none;"></div>`;
    }

    listEl.innerHTML = html;

    // Auto-scroll active item into view
    const activeEl = listEl.querySelector('.anime-transcript-item.is-active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      try {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (_) {}
    }
  }

  _formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  unmount() {
    if (this._keyListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._keyListener);
      this._keyListener = null;
    }
    if (this.linkStore) {
      if (this._statusListener) this.linkStore.off('status', this._statusListener);
      if (this._sessionListener) this.linkStore.off('session', this._sessionListener);
      if (this._stateListener) this.linkStore.off('video:state', this._stateListener);
      if (this._cueListener) this.linkStore.off('cues', this._cueListener);
      if (this._activeCueListener) this.linkStore.off('cue:active', this._activeCueListener);
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }
}
