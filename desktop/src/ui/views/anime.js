/**
 * Kiroku Note Desktop — Anime Companion View
 * Live companion screen connecting to browser extension / link hub for anime subtitle mining.
 * Mimics standard tab header with uplifting wordmark letters, live cue box, and playback controls.
 */

import { LinkClient } from '../services/link_client.js';
import { LinkStore } from '../services/link_store.js';
import { LinkMineService } from '../services/link_mine.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { apiClient } from '../services/api_client.js';
import { getUniversalJlptLevel } from '../utils/learner.js';
import { ShadowingRecorder } from '../services/shadowing_recorder.js';

const JLPT_ORDER = { 'N5': 1, 'N4': 2, 'N3': 3, 'N2': 4, 'N1': 5 };

function isGrammarAboveLevel(pointLevel, userLevel) {
  const pRank = JLPT_ORDER[pointLevel] || 0;
  const uRank = JLPT_ORDER[userLevel] || 0;
  return pRank > uRank;
}

function containsKanji(str) {
  return /[\u4e00-\u9faf\u3400-\u4dbf]/.test(str || '');
}

function shouldShowFurigana(tokenLevel, learnerLevel) {
  if (!learnerLevel) return true;
  if (!tokenLevel) return true;
  const pRank = JLPT_ORDER[tokenLevel] || 0;
  const uRank = JLPT_ORDER[learnerLevel] || 0;
  return pRank >= uRank;
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
    this.linkMineService = options.linkMineService || null;
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
    this.furiganaEnabled = true;
    this.hoverGlossOnlyPaused = Boolean(options.hoverGlossOnlyPaused);
    this.inspectorOpen = true;
    this.inspectedWord = null;
    this.currentFilter = 'all';
    this.lastLoadedHash = null;
    this._fetchingGrammar = new Set();
    this._positionSaveTimer = null;
    this._lastSavedPositionSec = null;
    this.resumePositionMs = 0;
    this.sessionMinedCount = 0;
    this.gapWordsQueue = [];
    this.lastQueuedBatch = [];

    // Smart Pause & Session Stats (Slice 30)
    this.smartPauseEnabled = false;
    this.smartPauseThreshold = 2;
    this.smartAutoReplay = false;
    this._lastPausedCueIdx = null;
    this._replayedCueIdx = null;
    this.sessionStartTime = Date.now();
    this.sessionWatchSeconds = 0;
    this._lastPlayTick = null;
    this.seenCueIndices = new Set();
    this.sessionLinesSeen = 0;
    this.sessionGapWordsSeen = 0;

    // Subtitle Blurring & Listening Mode
    this.blurSubtitlesEnabled = (typeof localStorage !== 'undefined' && localStorage.getItem('kiroku_blur_subtitles_enabled') === 'true');

    // Dual Subtitles
    this.dualSubtitlesEnabled = (typeof localStorage !== 'undefined' && localStorage.getItem('kiroku_dual_subtitles_enabled') !== 'false');

    // Shadowing Mode
    this.shadowingRecorder = new ShadowingRecorder();
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
    if (!this.linkMineService) {
      this.linkMineService = new LinkMineService({
        linkStore: this.linkStore,
        apiClient: this.apiClient
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
              <button type="button" class="anime-control-btn btn-sm ${this.blurSubtitlesEnabled ? 'active' : ''}" id="btn-anime-toggle-blur" aria-label="Toggle Subtitle Blur (Hotkey B)">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                <span id="anime-blur-label">Blur: ${this.blurSubtitlesEnabled ? 'On' : 'Off'}</span>
              </button>
              <button type="button" class="anime-control-btn btn-sm ${this.dualSubtitlesEnabled ? 'active' : ''}" id="btn-anime-toggle-dual" aria-label="Toggle Dual Subtitles">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z"/></svg>
                <span id="anime-dual-label">Dual: ${this.dualSubtitlesEnabled ? 'On' : 'Off'}</span>
              </button>
              <button type="button" class="anime-control-btn btn-sm" id="btn-anime-toggle-inspector" aria-label="Toggle Inspector Panel">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H5V5h9v12zm5 0h-3V5h3v12z"/></svg>
                <span>Inspector</span>
              </button>
              <span class="anime-site-chip" id="anime-connection-chip">Disconnected</span>
            </div>
          </div>

          <!-- Main Companion Grid -->
          <div class="anime-layout-grid ${this.inspectorOpen ? 'has-inspector' : ''}" id="anime-layout-grid">
            <!-- Left: Live Subtitle Box & Remote Controls -->
            <div class="anime-player-card">
              <div class="anime-session-strip">
                <div class="anime-session-title">
                  <span id="anime-active-title">No active video stream</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="badge-1t anime-cue-1t-badge" id="anime-cue-1t-badge" style="display: none;" title="1-Target sentence (i+1)">1T</span>
                  <span class="anime-mined-counter" id="anime-mined-counter">0 mined</span>
                  <div class="anime-time-indicator" id="anime-time-indicator">00:00 / 00:00</div>
                </div>
              </div>

              <!-- Resume Prompt Banner (Slice 28) -->
              <div class="anime-resume-banner" id="anime-resume-banner" style="display: none;">
                <span class="anime-resume-text" id="anime-resume-text">Resume playback?</span>
                <div class="flex items-center gap-2">
                  <button type="button" class="anime-control-btn btn-primary anime-resume-btn" id="btn-anime-resume">
                    Resume
                  </button>
                  <button type="button" class="anime-control-btn anime-resume-btn" id="btn-anime-dismiss-resume">
                    Dismiss
                  </button>
                </div>
              </div>

              <!-- Live Japanese Subtitle Cue Display -->
              <div class="anime-live-cue-box" id="anime-cue-box">
                <div class="anime-live-cue-japanese anime-live-cue-text ${this.blurSubtitlesEnabled ? 'is-blurred' : ''}" id="anime-cue-text">
                  <span class="anime-live-cue-empty">Start playback in browser with Kiroku Extension to mine Japanese dialogue</span>
                </div>
                <div class="anime-secondary-cue-text" id="anime-secondary-cue-text"></div>
              </div>

              <!-- Unknown-density sparkline (Slice 28) -->
              <div class="anime-sparkline-card" id="anime-sparkline-card">
                <div class="anime-sparkline-header">
                  <span>Dialogue Unknown Density</span>
                  <div class="anime-sparkline-legend">
                    <div class="anime-sparkline-legend-item">
                      <span class="anime-sparkline-dot is-easiest"></span>
                      <span>Easiest 5</span>
                    </div>
                    <div class="anime-sparkline-legend-item">
                      <span class="anime-sparkline-dot is-hardest"></span>
                      <span>Hardest 5</span>
                    </div>
                  </div>
                </div>
                <div class="anime-sparkline-track" id="anime-sparkline-track" aria-label="Unknown density timeline sparkline">
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
                    <button type="button" class="anime-control-btn" id="btn-anime-next-ep" aria-label="Next episode in browser" title="Next Episode" disabled>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                      <span>Next Ep</span>
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-replay-cue" aria-label="Replay current line">
                      Replay
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-loop" aria-label="Loop current line">
                      <span id="anime-btn-loop-label">Loop</span>
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <button type="button" class="anime-control-btn" id="btn-anime-export-condensed" aria-label="Export Condensed Audio">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                      <span>Condensed Audio</span>
                    </button>
                    <button type="button" class="anime-control-btn" id="btn-anime-queue-gaps" aria-label="Queue gap words">
                      Queue Gaps
                    </button>
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
                      <option value="only-1t">1-Target (i+1) sentences</option>
                      <option value="grammar-above">Grammar above my level</option>
                    </select>
                    <button type="button" class="anime-control-btn btn-sm" id="btn-anime-toggle-coloring" aria-label="Toggle token coloring">
                      <span id="anime-coloring-label">Colors: On</span>
                    </button>
                    <button type="button" class="anime-control-btn btn-sm" id="btn-anime-toggle-furigana" aria-label="Toggle selective furigana">
                      <span id="anime-furigana-label">Furigana: On</span>
                    </button>
                  </div>
                </div>

                <div class="anime-transcript-list" id="anime-transcript-list" tabindex="0" role="region" aria-label="Dialogue transcript">
                  <div class="anime-transcript-empty" id="anime-transcript-empty">
                    No dialogue cues loaded yet
                  </div>
                </div>
              </div>

              <!-- Review Queue Card (Slice 29) -->
              <div class="anime-queue-card" id="anime-queue-card" style="display: none;">
                <div class="anime-queue-header">
                  <div class="anime-queue-title">
                    <span>Review Gap Words Queue</span>
                    <span class="anime-queue-badge" id="anime-queue-count">0</span>
                  </div>
                  <div class="anime-queue-actions">
                    <button type="button" class="anime-control-btn btn-sm" id="btn-queue-undo">Undo</button>
                    <button type="button" class="anime-control-btn btn-primary btn-sm" id="btn-queue-mine-all">Mine All</button>
                    <button type="button" class="anime-control-btn btn-sm" id="btn-queue-clear">Clear</button>
                  </div>
                </div>
                <div class="anime-queue-chips" id="anime-queue-chips"></div>
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

            <!-- Smart Pause & Study Mode (Slice 30) -->
            <div class="anime-smart-pause-card" id="anime-smart-pause-card">
              <div class="anime-sidebar-title">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                Smart Pause
              </div>
              <div class="anime-status-row">
                <label for="anime-smart-pause-toggle" style="cursor: pointer;">Auto-pause on unknown</label>
                <input type="checkbox" id="anime-smart-pause-toggle" ${this.smartPauseEnabled ? 'checked' : ''} />
              </div>
              <div class="anime-status-row" id="anime-smart-pause-threshold-row">
                <span>Gap word threshold</span>
                <input type="number" id="anime-smart-pause-threshold" min="1" max="10" value="${this.smartPauseThreshold}" style="width: 48px; text-align: center; background: var(--surface); color: var(--text-primary); border: 1px solid var(--tactile-stroke); border-radius: var(--radius-sm);" />
              </div>
              <div class="anime-status-row">
                <label for="anime-smart-auto-replay" style="cursor: pointer;">Auto-replay line once</label>
                <input type="checkbox" id="anime-smart-auto-replay" ${this.smartAutoReplay ? 'checked' : ''} />
              </div>
            </div>

            <!-- Watch History & Series Grouping (Slice 28) -->
            <div class="anime-history-card" id="anime-history-card">
              <div class="anime-sidebar-title">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                Watch History
              </div>
              <div class="anime-history-list" id="anime-history-list">
                <span class="text-xs text-muted" style="text-align: center; padding: 1rem 0;">No watch history yet</span>
              </div>
            </div>

            <!-- Collapsible Migaku-Style Inspector Panel (Vocab Top + Grammar Below) -->
            <div class="anime-inspector-panel" id="anime-inspector-panel" style="${this.inspectorOpen ? '' : 'display: none;'}">
              <div class="anime-inspector-header">
                <div class="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                  <span class="font-bold">Inspector</span>
                </div>
                <button type="button" class="anime-inspector-close-btn" id="btn-anime-close-inspector" aria-label="Collapse inspector">&times;</button>
              </div>

              <!-- Top: Dedicated Vocab Card -->
              <div class="anime-inspector-vocab tactile-card" id="anime-inspector-vocab">
                <div class="anime-inspector-card-header mb-2">
                  <span class="text-xs font-mono text-gold">Vocabulary Target</span>
                </div>
                <div id="anime-inspector-vocab-content">
                  <p class="text-xs text-muted">Click any subtitle word to inspect definitions and capture audio.</p>
                </div>
              </div>

              <!-- Bottom: Sentence Grammar Breakdown -->
              <div class="anime-inspector-grammar tactile-card" id="anime-inspector-grammar">
                <div class="anime-inspector-card-header mb-2">
                  <span class="text-xs font-mono text-gold">Sentence Grammar Breakdown</span>
                </div>
                <div class="anime-inspector-grammar-list" id="anime-inspector-grammar-list">
                  <p class="text-xs text-muted">Pause playback or select dialogue lines to examine grammar points.</p>
                </div>
              </div>

              <!-- Shadowing Practice Card -->
              <div class="anime-inspector-shadowing tactile-card" id="anime-inspector-shadowing">
                <div class="anime-inspector-card-header mb-2 flex items-center justify-between">
                  <span class="text-xs font-mono text-gold">Shadowing & Pronunciation</span>
                  <span class="text-xs text-muted" id="anime-shadow-status">Ready</span>
                </div>
                <div class="anime-shadow-controls flex items-center gap-2">
                  <button type="button" class="anime-control-btn btn-sm" id="btn-anime-shadow-record" aria-label="Record Voice (Hotkey S)">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
                    <span id="anime-shadow-record-label">Record</span>
                  </button>
                  <button type="button" class="anime-control-btn btn-sm" id="btn-anime-shadow-compare" aria-label="Compare Audio Playback" disabled>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Play Mic</span>
                  </button>
                </div>
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

    const btnNextEp = this.container.querySelector('#btn-anime-next-ep');
    btnNextEp?.addEventListener('click', () => {
      this.linkStore?.nextEpisode();
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
      this.mineActiveLine();
    });

    const btnExportCondensed = this.container.querySelector('#btn-anime-export-condensed');
    btnExportCondensed?.addEventListener('click', () => {
      this.exportCondensedAudio();
    });

    // Queue gap words button
    const btnQueueGaps = this.container.querySelector('#btn-anime-queue-gaps');
    btnQueueGaps?.addEventListener('click', () => {
      this.queueGapWords();
    });

    const btnQueueMineAll = this.container.querySelector('#btn-queue-mine-all');
    btnQueueMineAll?.addEventListener('click', () => {
      this.mineAllQueued();
    });

    const btnQueueUndo = this.container.querySelector('#btn-queue-undo');
    btnQueueUndo?.addEventListener('click', () => {
      this.undoQueue();
    });

    const btnQueueClear = this.container.querySelector('#btn-queue-clear');
    btnQueueClear?.addEventListener('click', () => {
      this.clearQueue();
    });

    // Quick-mine button & token click delegation
    this.container.addEventListener('click', (e) => {
      const btnInspectorMine = e.target.closest('.btn-inspector-mine');
      if (btnInspectorMine && btnInspectorMine.dataset.surface) {
        e.stopPropagation();
        const surface = btnInspectorMine.dataset.surface;
        const activeCue = this.linkStore?.activeCue;
        btnInspectorMine.disabled = true;
        btnInspectorMine.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Mined</span>`;
        this.mineToken(surface, activeCue, this._inspectedChip);
        return;
      }

      const btnMine = e.target.closest('.btn-quick-mine');
      if (btnMine && btnMine.dataset.surface) {
        e.stopPropagation();
        const surface = btnMine.dataset.surface;
        const activeCue = this.linkStore?.activeCue;
        const chip = this._activeHoveredChip;
        btnMine.disabled = true;
        btnMine.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Mined</span>`;
        this.mineToken(surface, activeCue, chip);
        return;
      }

      const tokenChip = e.target.closest('.anime-token-chip');
      if (tokenChip && tokenChip.dataset.surface) {
        const surface = tokenChip.dataset.surface;
        const transcriptItem = tokenChip.closest('.anime-transcript-item');
        let cue = null;
        if (transcriptItem && transcriptItem.dataset.cueIndex) {
          const idx = parseInt(transcriptItem.dataset.cueIndex, 10);
          cue = this.linkStore?.cues?.find(c => c.i === idx) || null;
        } else {
          cue = this.linkStore?.activeCue || null;
        }
        this.mineToken(surface, cue, tokenChip);
        this.inspectToken(tokenChip);
      }
    });

    // Subtitle blur toggle
    const btnToggleBlur = this.container.querySelector('#btn-anime-toggle-blur');
    btnToggleBlur?.addEventListener('click', () => {
      this.toggleBlurSubtitles();
    });

    // Dual subtitles toggle
    const btnToggleDual = this.container.querySelector('#btn-anime-toggle-dual');
    btnToggleDual?.addEventListener('click', () => {
      this.toggleDualSubtitles();
    });

    // Shadowing record and compare buttons
    const btnShadowRecord = this.container.querySelector('#btn-anime-shadow-record');
    btnShadowRecord?.addEventListener('click', () => {
      this.toggleShadowRecording();
    });

    const btnShadowCompare = this.container.querySelector('#btn-anime-shadow-compare');
    btnShadowCompare?.addEventListener('click', () => {
      this.shadowingRecorder?.playRecording();
    });

    // Inspector toggle buttons
    const btnToggleInspector = this.container.querySelector('#btn-anime-toggle-inspector');
    btnToggleInspector?.addEventListener('click', () => {
      this.toggleInspector();
    });

    const btnCloseInspector = this.container.querySelector('#btn-anime-close-inspector');
    btnCloseInspector?.addEventListener('click', () => {
      this.toggleInspector(false);
    });

    // In-situ hover gloss triggers for live cue tokens
    this.container.addEventListener('mouseover', (e) => {
      const chip = e.target.closest('.anime-token-chip');
      if (chip && chip.dataset.surface) {
        this.showHoverGloss(chip);
      }
    });

    this.container.addEventListener('mouseout', (e) => {
      const chip = e.target.closest('.anime-token-chip');
      const related = e.relatedTarget;
      if (chip && (!related || !related.closest || !related.closest('.anime-hover-gloss'))) {
        this.scheduleHideHoverGloss();
      }
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

    // Smart pause controls (Slice 30)
    const smartPauseToggle = this.container.querySelector('#anime-smart-pause-toggle');
    smartPauseToggle?.addEventListener('change', (e) => {
      this.smartPauseEnabled = !!e.target.checked;
    });

    const smartPauseThreshold = this.container.querySelector('#anime-smart-pause-threshold');
    smartPauseThreshold?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) {
        this.smartPauseThreshold = val;
      }
    });

    const smartAutoReplay = this.container.querySelector('#anime-smart-auto-replay');
    smartAutoReplay?.addEventListener('change', (e) => {
      this.smartAutoReplay = !!e.target.checked;
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

    // Furigana toggle button
    const btnToggleFurigana = this.container.querySelector('#btn-anime-toggle-furigana');
    btnToggleFurigana?.addEventListener('click', () => {
      this.furiganaEnabled = !this.furiganaEnabled;
      const label = this.container.querySelector('#anime-furigana-label');
      if (label) {
        label.textContent = this.furiganaEnabled ? 'Furigana: On' : 'Furigana: Off';
      }
      this.updateFromStore();
      this.renderTranscriptList();
    });

    // Resume button
    const btnResume = this.container.querySelector('#btn-anime-resume');
    btnResume?.addEventListener('click', () => {
      if (this.resumePositionMs > 0) {
        this.linkStore?.seek(this.resumePositionMs / 1000);
        this._dismissResumeBanner();
      }
    });

    // Dismiss resume button
    const btnDismissResume = this.container.querySelector('#btn-anime-dismiss-resume');
    btnDismissResume?.addEventListener('click', () => {
      this._dismissResumeBanner();
    });

    // Sparkline click delegation
    const sparklineTrack = this.container.querySelector('#anime-sparkline-track');
    sparklineTrack?.addEventListener('click', (e) => {
      const bar = e.target.closest('.anime-sparkline-bar');
      if (bar && bar.dataset.start !== undefined) {
        const s = parseFloat(bar.dataset.start);
        if (!isNaN(s)) {
          this.linkStore?.seek(s);
        }
      }
    });

    // Throttled position saving every 15s while playing
    if (!this._positionSaveTimer && typeof setInterval !== 'undefined') {
      this._positionSaveTimer = setInterval(() => {
        this._savePositionIfPlaying();
      }, 15000);
      if (this._positionSaveTimer && typeof this._positionSaveTimer.unref === 'function') {
        this._positionSaveTimer.unref();
      }
    }

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
      } else if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        this.toggleBlurSubtitles();
      } else if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        this.toggleDualSubtitles();
      } else if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.toggleShadowRecording();
      } else if (e.code === 'Tab' || e.key === 'Tab') {
        e.preventDefault();
        this.toggleInspector();
      } else if (e.code === 'KeyN' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        const summary = this.linkStore?.getStatusSummary() || {};
        const isConnected = summary.status === 'connected';
        const hasNext = Boolean(summary.videoState?.hasNextEpisode || summary.activeSession?.hasNextEpisode);
        if (isConnected && hasNext) {
          this.linkStore?.nextEpisode();
        }
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

  async mineActiveLine() {
    const summary = this.linkStore?.getStatusSummary() || {};
    const activeCue = this.linkStore?.activeCue;
    const text = activeCue?.text || '';

    // If linkMineService is available, use it (handles clip + card creation + known mark)
    if (this.linkMineService) {
      try {
        const res = await this.linkMineService.mineWord({
          cue: activeCue,
          session: summary.activeSession,
          expression: text
        });
        if (res && res.ok && !res.isDuplicate) {
          this.sessionMinedCount++;
          this._updateMinedBadge();
        }
        return res;
      } catch (err) {
        console.debug('[AnimeView] mineActiveLine error:', err);
      }
    } else if (this.linkStore) {
      // Direct clip fallback (slice 26 controls emission)
      const reqId = 'clip-' + Date.now();
      const s = activeCue ? activeCue.s : (summary.videoState?.t || 0);
      const e = activeCue ? activeCue.e : (s + 3.0);
      this.linkStore.requestClip(reqId, s, e, ['image', 'audio']);
    }
  }

  async exportCondensedAudio() {
    const cues = this.linkStore?.cues || [];
    if (!cues.length) return null;
    const btn = this.container?.querySelector('#btn-anime-export-condensed');
    if (btn) btn.disabled = true;

    try {
      const res = await this.apiClient.request('/api/link/export-condensed-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cues })
      });
      return res;
    } catch (err) {
      console.warn('[AnimeView] exportCondensedAudio error:', err);
      return null;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async mineToken(surface, cue = null, tokenEl = null) {
    if (!this.linkMineService || !surface) return;
    const summary = this.linkStore?.getStatusSummary() || {};
    const effectiveCue = cue || this.linkStore?.activeCue;

    try {
      const res = await this.linkMineService.mineWord({
        cue: effectiveCue,
        session: summary.activeSession,
        expression: surface
      });
      if (res && res.ok) {
        if (!res.isDuplicate) {
          this.sessionMinedCount++;
          this._updateMinedBadge();
        }
        if (tokenEl) {
          tokenEl.classList.remove('is-gap', 'is-unknown', 'is-new', 'token-gap', 'token-unknown');
          tokenEl.classList.add('is-mined', 'token-mined');
        }
      }
      return res;
    } catch (err) {
      console.debug('[AnimeView] mineToken error:', err);
    }
  }

  queueGapWords() {
    const cueHash = this.linkStore?.cueHash;
    const activeCue = this.linkStore?.activeCue;
    const newItems = [];

    // Gaps from active cue
    if (activeCue) {
      const ann = this.annotatedCuesMap.get(`${cueHash}:${activeCue.i}`);
      const gapWords = ann && Array.isArray(ann.gap_words) ? ann.gap_words : [];
      for (const w of gapWords) {
        if (!this.gapWordsQueue.some(item => item.word === w)) {
          newItems.push({ word: w, cue: activeCue });
        }
      }
    }

    // Gaps from current episode cues if active cue had none or to complete batch
    if (newItems.length === 0 && this.linkStore?.cues) {
      for (const cue of this.linkStore.cues) {
        const ann = this.annotatedCuesMap.get(`${cueHash}:${cue.i}`);
        const gapWords = ann && Array.isArray(ann.gap_words) ? ann.gap_words : [];
        for (const w of gapWords) {
          if (!this.gapWordsQueue.some(item => item.word === w) && !newItems.some(item => item.word === w)) {
            newItems.push({ word: w, cue });
          }
        }
      }
    }

    if (newItems.length > 0) {
      this.lastQueuedBatch = newItems;
      this.gapWordsQueue.push(...newItems);
      this.renderQueueCard();
    }
  }

  async mineAllQueued() {
    if (!this.linkMineService || this.gapWordsQueue.length === 0 || this.isMiningAll) return;
    this.isMiningAll = true;
    const summary = this.linkStore?.getStatusSummary() || {};
    const toMine = [...this.gapWordsQueue];

    for (const item of toMine) {
      try {
        const res = await this.linkMineService.mineWord({
          cue: item.cue,
          session: summary.activeSession,
          expression: item.word
        });
        if (res && res.ok && !res.isDuplicate) {
          this.sessionMinedCount++;
        }
      } catch (_) {}
    }

    this.gapWordsQueue = [];
    this.lastQueuedBatch = [];
    this.isMiningAll = false;
    this._updateMinedBadge();
    this.renderQueueCard();
  }

  undoQueue() {
    if (this.lastQueuedBatch.length > 0) {
      const wordsToRemove = new Set(this.lastQueuedBatch.map(x => x.word));
      this.gapWordsQueue = this.gapWordsQueue.filter(item => !wordsToRemove.has(item.word));
      this.lastQueuedBatch = [];
    } else if (this.gapWordsQueue.length > 0) {
      this.gapWordsQueue.pop();
    }
    this.renderQueueCard();
  }

  clearQueue() {
    this.gapWordsQueue = [];
    this.lastQueuedBatch = [];
    this.renderQueueCard();
  }

  renderQueueCard() {
    const card = this.container?.querySelector('#anime-queue-card');
    const badge = this.container?.querySelector('#anime-queue-count');
    const chipsContainer = this.container?.querySelector('#anime-queue-chips');
    if (!card) return;

    const count = this.gapWordsQueue.length;
    if (badge) badge.textContent = String(count);

    if (count === 0) {
      card.style.display = 'none';
      if (chipsContainer) chipsContainer.innerHTML = '';
      return;
    }

    card.style.display = 'flex';
    if (chipsContainer) {
      chipsContainer.innerHTML = this.gapWordsQueue.map((item, idx) => `
        <span class="anime-queue-chip" data-index="${idx}">
          ${escapeHtml(item.word)}
          <span class="anime-queue-chip-remove" data-word="${escapeHtml(item.word)}">&times;</span>
        </span>
      `).join('');
    }
  }

  _updateMinedBadge() {
    const counterEl = this.container?.querySelector('#anime-mined-counter');
    if (counterEl) {
      counterEl.textContent = `${this.sessionMinedCount} mined`;
    }
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

    // Next episode button availability
    const btnNextEp = this.container.querySelector('#btn-anime-next-ep');
    if (btnNextEp) {
      const hasNext = Boolean(summary.videoState?.hasNextEpisode || summary.activeSession?.hasNextEpisode);
      btnNextEp.disabled = !isConnected || !hasNext;
      if (hasNext) {
        btnNextEp.removeAttribute('title');
      } else {
        btnNextEp.setAttribute('title', isConnected ? 'No next episode detected on streaming page' : 'Extension disconnected');
      }
    }

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

    // Subtitle text with interactive tokens
    const cueTextEl = this.container.querySelector('#anime-cue-text');
    if (cueTextEl) {
      if (summary.activeCue?.text) {
        const cueHash = summary.cueHash;
        const activeIdx = summary.activeCue.i;
        const ann = (cueHash && typeof activeIdx === 'number')
          ? this.annotatedCuesMap.get(`${cueHash}:${activeIdx}`)
          : null;

        if (ann && Array.isArray(ann.tokens) && ann.tokens.length > 0) {
          cueTextEl.innerHTML = this.renderCueTokens(ann.tokens);
        } else {
          cueTextEl.innerHTML = `<span class="anime-cue-plain">${escapeHtml(summary.activeCue.text)}</span>`;
        }
      } else if (summary.activeSession) {
        cueTextEl.innerHTML = `<span class="anime-live-cue-empty">Listening for dialogue subtitles...</span>`;
      } else {
        cueTextEl.innerHTML = `<span class="anime-live-cue-empty">Start playback in browser with Kiroku Extension to mine Japanese dialogue</span>`;
      }
      cueTextEl.classList.toggle('is-blurred', this.blurSubtitlesEnabled);
    }

    // Secondary translation subtitle
    const secEl = this.container.querySelector('#anime-secondary-cue-text');
    if (secEl) {
      if (!this.dualSubtitlesEnabled) {
        secEl.textContent = '';
        secEl.classList.add('is-hidden');
      } else {
        secEl.classList.remove('is-hidden');
        const secondary = summary.activeCue?.secondary_text || summary.activeCue?.secondaryText || '';
        secEl.textContent = secondary;
        secEl.classList.toggle('is-blurred', this.blurSubtitlesEnabled);
      }
    }

    // Live 1T badge update in session strip
    const badge1t = this.container.querySelector('#anime-cue-1t-badge');
    if (badge1t) {
      const activeCue = summary.activeCue;
      const ann = (summary.cueHash && activeCue && typeof activeCue.i === 'number')
        ? this.annotatedCuesMap.get(`${summary.cueHash}:${activeCue.i}`)
        : null;
      const is1T = this.is1TCue(ann);
      badge1t.style.display = is1T ? 'inline-flex' : 'none';
    }

    // Transcript cues fetching and rendering
    if (summary.cueHash && summary.cueHash !== this.lastLoadedHash) {
      this.lastLoadedHash = summary.cueHash;
      this.fetchCuesAnalysis(summary.cueHash);
      this.checkResumePosition(summary.cueHash);
    }
    this.renderTranscriptList();
    this.renderSparkline();
    this.fetchWatchHistory();

    // Sentence grammar refresh on pause for inspector
    if (summary.videoState?.paused && summary.cueHash && summary.activeCue?.i !== undefined) {
      this.refreshInspectorGrammar(summary.cueHash, summary.activeCue.i);
    }

    // Video playback watch time tracking (Slice 30)
    const now = Date.now();
    if (this._lastPlayTick && summary.videoState && !summary.videoState.paused) {
      const deltaSec = (now - this._lastPlayTick) / 1000;
      if (deltaSec > 0 && deltaSec < 5) {
        this.sessionWatchSeconds += deltaSec;
      }
    }
    this._lastPlayTick = now;

    // Active cue evaluation for seen stats & smart pause (Slice 30)
    const activeCue = summary.activeCue;
    if (activeCue && activeCue.i !== undefined) {
      if (!this.seenCueIndices.has(activeCue.i)) {
        this.seenCueIndices.add(activeCue.i);
        this.sessionLinesSeen++;
        const ann = (summary.cueHash ? this.annotatedCuesMap.get(`${summary.cueHash}:${activeCue.i}`) : null) || this.annotatedCuesMap.get(activeCue.i);
        const gapWordsCount = ann?.gap_words ? ann.gap_words.length : 0;
        this.sessionGapWordsSeen += gapWordsCount;

        if (this.smartPauseEnabled && gapWordsCount >= this.smartPauseThreshold) {
          if (this.smartAutoReplay && this._replayedCueIdx !== activeCue.i) {
            this._replayedCueIdx = activeCue.i;
            this.linkStore?.seek(activeCue.s);
          } else if (this._lastPausedCueIdx !== activeCue.i) {
            this._lastPausedCueIdx = activeCue.i;
            this.linkStore?.pause();
          }
        }
      }
    }
  }

  async checkResumePosition(hash) {
    if (!hash || !this.apiClient) return;
    try {
      const res = await this.apiClient.request(`/api/link/episodes/${encodeURIComponent(hash)}`);
      if (res && res.last_position_ms && res.last_position_ms > 5000) {
        const curSec = this.linkStore?.videoState?.t || 0;
        if (curSec < 10) {
          this.resumePositionMs = res.last_position_ms;
          const resumeTextEl = this.container?.querySelector('#anime-resume-text');
          const resumeBannerEl = this.container?.querySelector('#anime-resume-banner');
          if (resumeTextEl) {
            resumeTextEl.textContent = `Resume at ${this._formatTime(res.last_position_ms / 1000)}?`;
          }
          if (resumeBannerEl) {
            resumeBannerEl.style.display = 'flex';
          }
        }
      }
    } catch (_) {}
  }

  _dismissResumeBanner() {
    const resumeBannerEl = this.container?.querySelector('#anime-resume-banner');
    if (resumeBannerEl) {
      resumeBannerEl.style.display = 'none';
    }
    this.resumePositionMs = 0;
  }

  _savePositionIfPlaying() {
    if (!this.linkStore || !this.apiClient) return;
    const summary = this.linkStore.getStatusSummary();
    console.log('TRACE checkpoint 1, summary.activeCue:', summary.activeCue);
    if (!summary.videoState || summary.videoState.paused || !summary.cueHash) return;
    const curSec = summary.videoState.t || 0;
    if (this._lastSavedPositionSec !== null && Math.abs(curSec - this._lastSavedPositionSec) < 5) return;
    this._lastSavedPositionSec = curSec;
    const posMs = Math.round(curSec * 1000);
    this.apiClient.request(`/api/link/episodes/${encodeURIComponent(summary.cueHash)}/position`, {
      method: 'POST',
      body: {
        last_position_ms: posMs,
        title: summary.activeSession?.title || '',
        site: summary.activeSession?.site || ''
      }
    }).catch(err => console.debug('[AnimeView] savePosition failed:', err));
  }

  renderSparkline() {
    const track = this.container?.querySelector('#anime-sparkline-track');
    if (!track) return;

    const allCues = this.linkStore?.cues || [];
    const cueHash = this.linkStore?.cueHash;
    const activeCueIndex = this.linkStore?.activeCueIndex;

    if (allCues.length === 0) {
      track.innerHTML = '<span class="text-xs text-muted" style="margin: auto;">No cues for sparkline</span>';
      return;
    }

    const cuesWithCounts = allCues.map((cue) => {
      const ann = this.annotatedCuesMap.get(`${cueHash}:${cue.i}`);
      const count = ann && Array.isArray(ann.gap_words) ? ann.gap_words.length : 0;
      return { cue, count };
    });

    const maxCount = Math.max(1, ...cuesWithCounts.map(x => x.count));

    // Sort to determine easiest 5 and hardest 5
    const sorted = [...cuesWithCounts].sort((a, b) => a.count - b.count);
    const easiest5 = new Set(sorted.slice(0, 5).map(x => x.cue.i));
    const hardest5 = new Set(sorted.slice(-5).map(x => x.cue.i));

    track.innerHTML = cuesWithCounts.map(({ cue, count }) => {
      const heightPct = Math.max(15, Math.round((count / maxCount) * 100));
      const isActive = cue.i === activeCueIndex;
      let extraClass = '';
      if (isActive) extraClass += ' is-active';
      if (hardest5.has(cue.i)) extraClass += ' is-hardest';
      else if (easiest5.has(cue.i)) extraClass += ' is-easiest';

      const timeStr = this._formatTime(cue.s);
      return `<div class="anime-sparkline-bar${extraClass}" data-cue-index="${cue.i}" data-start="${cue.s}" style="height: ${heightPct}%;" title="[${timeStr}] Cue #${cue.i + 1}: ${count} unknown"></div>`;
    }).join('');
  }

  async fetchWatchHistory() {
    const listEl = this.container?.querySelector('#anime-history-list');
    if (!listEl || !this.apiClient || this._fetchingHistory) return;
    this._fetchingHistory = true;
    try {
      const groups = await this.apiClient.request('/api/link/series');
      if (Array.isArray(groups) && groups.length > 0) {
        let html = '';
        for (const group of groups) {
          const seriesTitle = escapeHtml(group.series || 'Series');
          html += `<div class="anime-status-row" style="font-weight: 700; color: var(--industrial-aqua); border: none; padding-top: 0.5rem;">${seriesTitle}</div>`;
          for (const ep of (group.episodes || [])) {
            const epTitle = escapeHtml(ep.title || 'Episode');
            const knownPct = typeof ep.known_pct === 'number' ? ep.known_pct : 0;
            const posStr = ep.last_position_ms ? ` • Pos: ${this._formatTime(ep.last_position_ms / 1000)}` : '';
            html += `
              <div class="anime-history-item" data-hash="${escapeHtml(ep.hash)}" data-pos="${ep.last_position_ms || 0}">
                <span class="anime-history-item-title">${epTitle}</span>
                <div class="anime-history-item-meta">
                  <span class="anime-history-known">${knownPct}% known</span>
                  <span>${ep.mined} mined${posStr}</span>
                </div>
              </div>
            `;
          }
        }
        listEl.innerHTML = html;
      }
    } catch (_) {
    } finally {
      this._fetchingHistory = false;
    }
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

  is1TCue(ann) {
    if (!ann) return false;
    if (Array.isArray(ann.gap_words)) {
      return ann.gap_words.length === 1;
    }
    if (Array.isArray(ann.tokens)) {
      const unknownCount = ann.tokens.filter(tok => tok.status === 'gap' || tok.status === 'unknown' || tok.status === 'new').length;
      return unknownCount === 1;
    }
    return false;
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
    } else if (this.currentFilter === 'only-1t') {
      filtered = allCues.filter(cue => {
        const ann = this.annotatedCuesMap.get(`${cueHash}:${cue.i}`);
        return this.is1TCue(ann);
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
      const is1T = this.is1TCue(ann);
      const badge1tHtml = is1T ? `<span class="badge-1t" title="1-Target sentence (i+1)">1T</span>` : '';

      html += `
        <div class="anime-transcript-item ${isActive ? 'is-active active' : ''} ${is1T ? 'is-1t' : ''}" data-cue-index="${cue.i}" data-start="${cue.s}">
          <div class="anime-transcript-meta">
            <span class="anime-transcript-time">[${timeLabel}]</span>
            <span>Cue #${cue.i + 1}</span>
            ${badge1tHtml}
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

  async _flushSessionStats() {
    if (!this.apiClient) return;
    const summary = this.linkStore?.getStatusSummary() || {};
    const activeSession = summary.activeSession;
    if (this.sessionLinesSeen === 0 && this.sessionMinedCount === 0 && this.sessionWatchSeconds < 1) {
      return;
    }
    const payload = {
      session_id: activeSession ? `tab-${activeSession.tab}` : `anime-${Date.now()}`,
      site: activeSession?.site || '',
      title: activeSession?.title || '',
      watch_seconds: Math.round(this.sessionWatchSeconds * 10) / 10,
      lines_seen: this.sessionLinesSeen,
      words_mined: this.sessionMinedCount,
      gap_words_seen: this.sessionGapWordsSeen,
    };
    try {
      await this.apiClient.request('/api/link/sessions', {
        method: 'POST',
        body: payload
      });
    } catch (err) {
      console.debug('[AnimeView] Failed to save session stats:', err);
    }
  }

  renderCueTokens(tokens) {
    if (!tokens || !tokens.length) return '';
    return tokens.map(tok => {
      const surface = escapeHtml(tok.surface || '');
      const lemma = escapeHtml(tok.lemma || tok.surface || '');
      const reading = escapeHtml(tok.reading || '');
      const gloss = escapeHtml(tok.gloss || '');
      const jlpt = escapeHtml(tok.jlpt_level || '');
      const status = tok.status || 'unstyled';
      const statusClass = (this.showTokenColors && status !== 'unstyled') ? `is-${status} token-${status}` : '';

      const rawSurface = tok.surface || '';
      const rawReading = tok.reading || '';
      const hasKanji = containsKanji(rawSurface);
      const showRuby = this.furiganaEnabled && hasKanji && rawReading && rawReading !== rawSurface && shouldShowFurigana(tok.jlpt_level, this.learnerLevel);

      const displayContent = showRuby
        ? `<ruby>${surface}<rt>${reading}</rt></ruby>`
        : surface;

      return `<span class="anime-token-chip ${statusClass}" data-surface="${surface}" data-lemma="${lemma}" data-reading="${reading}" data-gloss="${gloss}" data-jlpt="${jlpt}" data-status="${status}"><span class="anime-token-surface">${displayContent}</span></span>`;
    }).join('');
  }

  showHoverGloss(chip) {
    if (!this.container) return;
    if (this.hoverGlossOnlyPaused && this.linkStore?.videoState && !this.linkStore.videoState.paused) {
      return;
    }
    if (!this.hoverGlossEl) {
      this.hoverGlossEl = document.createElement('div');
      this.hoverGlossEl.className = 'anime-hover-gloss';
      this.hoverGlossEl.style.display = 'none';
      this.container.appendChild(this.hoverGlossEl);

      this.hoverGlossEl.addEventListener('mouseenter', () => {
        if (this._hoverGlossHideTimer) {
          clearTimeout(this._hoverGlossHideTimer);
          this._hoverGlossHideTimer = null;
        }
      });
      this.hoverGlossEl.addEventListener('mouseleave', () => {
        this.scheduleHideHoverGloss();
      });
    }

    if (this._hoverGlossHideTimer) {
      clearTimeout(this._hoverGlossHideTimer);
      this._hoverGlossHideTimer = null;
    }

    this._activeHoveredChip = chip;
    const { surface = '', lemma = '', reading = '', gloss = '', jlpt = '', status = '' } = chip.dataset;
    const displayWord = lemma || surface;
    const isMined = status === 'mined' || chip.classList.contains('is-mined');

    this.hoverGlossEl.innerHTML = `
      <div class="anime-hover-gloss-header">
        <span class="gloss-lemma">${escapeHtml(displayWord)}</span>
        ${reading ? `<span class="gloss-reading">${escapeHtml(reading)}</span>` : ''}
        ${jlpt ? `<span class="gloss-badge">${escapeHtml(jlpt)}</span>` : ''}
      </div>
      <div class="gloss-body">
        <div class="gloss-definition">${escapeHtml(gloss || 'Context definition')}</div>
      </div>
      <div class="gloss-footer">
        <button type="button" class="btn-quick-mine tactile-btn ${isMined ? 'is-mined' : ''}" id="btn-hover-quick-mine" data-surface="${escapeHtml(surface)}" ${isMined ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
            ${isMined
              ? '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>'
              : '<path d="M7 2v11h3v9l7-12h-4l4-8z"/>'
            }
          </svg>
          <span>${isMined ? 'Mined' : 'Quick Mine'}</span>
        </button>
      </div>
    `;

    const rect = chip.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    this.hoverGlossEl.style.display = 'block';
    const glossWidth = this.hoverGlossEl.offsetWidth || 220;
    const glossHeight = this.hoverGlossEl.offsetHeight || 90;

    let left = (rect.left - containerRect.left) + (rect.width / 2) - (glossWidth / 2);
    left = Math.max(8, Math.min(left, containerRect.width - glossWidth - 8));

    let top = (rect.top - containerRect.top) - glossHeight - 8;
    if (top < 8) {
      top = (rect.bottom - containerRect.top) + 8;
    }

    this.hoverGlossEl.style.left = `${left}px`;
    this.hoverGlossEl.style.top = `${top}px`;
  }

  scheduleHideHoverGloss() {
    if (this._hoverGlossHideTimer) {
      clearTimeout(this._hoverGlossHideTimer);
    }
    this._hoverGlossHideTimer = setTimeout(() => {
      if (this.hoverGlossEl) {
        this.hoverGlossEl.style.display = 'none';
      }
      this._activeHoveredChip = null;
    }, 180);
  }

  inspectToken(chip) {
    if (!chip) return;
    this._inspectedChip = chip;
    const { surface = '', lemma = '', reading = '', gloss = '', jlpt = '', status = '' } = chip.dataset;
    const isMined = status === 'mined' || chip.classList.contains('is-mined');
    const displayWord = lemma || surface;

    const vocabContent = this.container?.querySelector('#anime-inspector-vocab-content');
    if (vocabContent) {
      vocabContent.innerHTML = `
        <div class="inspector-word-row">
          <span class="inspector-word-head">${escapeHtml(displayWord)}</span>
          ${reading ? `<span class="inspector-word-reading">${escapeHtml(reading)}</span>` : ''}
          ${jlpt ? `<span class="inspector-badge">${escapeHtml(jlpt)}</span>` : ''}
        </div>
        <div class="inspector-word-def mt-2">
          ${escapeHtml(gloss || 'Context vocabulary definition')}
        </div>
        <div class="inspector-word-actions mt-3">
          <button type="button" class="btn-inspector-mine tactile-btn ${isMined ? 'is-mined' : ''}" data-surface="${escapeHtml(surface)}" ${isMined ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              ${isMined
                ? '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>'
                : '<path d="M7 2v11h3v9l7-12h-4l4-8z"/>'
              }
            </svg>
            <span>${isMined ? 'Mined' : 'Quick Mine'}</span>
          </button>
        </div>
      `;
    }

    if (!this.inspectorOpen) {
      this.toggleInspector(true);
    }
  }

  async refreshInspectorGrammar(hash, i) {
    const listEl = this.container?.querySelector('#anime-inspector-grammar-list');
    if (!listEl) return;

    const key = `${hash}:${i}`;
    let points = this.cueGrammarMap.get(key);

    if (!points && hash && typeof i === 'number') {
      await this.fetchCueGrammar(hash, i);
      points = this.cueGrammarMap.get(key);
    }

    if (Array.isArray(points) && points.length > 0) {
      listEl.innerHTML = points.map(pt => {
        const title = escapeHtml(pt.point || pt.title || '');
        const lvl = escapeHtml(pt.level || '');
        const desc = escapeHtml(pt.meaning || pt.description || pt.notes || '');
        return `
          <div class="inspector-grammar-item">
            <div class="flex items-center justify-between">
              <span class="inspector-grammar-title">${title}</span>
              ${lvl ? `<span class="inspector-badge">${lvl}</span>` : ''}
            </div>
            ${desc ? `<p class="inspector-grammar-desc">${desc}</p>` : ''}
          </div>
        `;
      }).join('');
    } else {
      listEl.innerHTML = `<p class="text-xs text-muted">No specific JLPT grammar patterns identified in this line.</p>`;
    }
  }

  toggleBlurSubtitles(forceState = null) {
    this.blurSubtitlesEnabled = forceState !== null ? forceState : !this.blurSubtitlesEnabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kiroku_blur_subtitles_enabled', String(this.blurSubtitlesEnabled));
    }
    const cueEl = this.container?.querySelector('#anime-cue-text');
    if (cueEl) {
      cueEl.classList.toggle('is-blurred', this.blurSubtitlesEnabled);
    }
    const secEl = this.container?.querySelector('#anime-secondary-cue-text');
    if (secEl) {
      secEl.classList.toggle('is-blurred', this.blurSubtitlesEnabled);
    }
    const label = this.container?.querySelector('#anime-blur-label');
    if (label) {
      label.textContent = this.blurSubtitlesEnabled ? 'Blur: On' : 'Blur: Off';
    }
    const btn = this.container?.querySelector('#btn-anime-toggle-blur');
    if (btn) {
      btn.classList.toggle('active', this.blurSubtitlesEnabled);
    }
  }

  toggleDualSubtitles(forceState = null) {
    this.dualSubtitlesEnabled = forceState !== null ? forceState : !this.dualSubtitlesEnabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('kiroku_dual_subtitles_enabled', String(this.dualSubtitlesEnabled));
    }
    const secEl = this.container?.querySelector('#anime-secondary-cue-text');
    if (secEl) {
      secEl.classList.toggle('is-hidden', !this.dualSubtitlesEnabled);
      secEl.classList.toggle('is-blurred', this.blurSubtitlesEnabled);
    }
    const label = this.container?.querySelector('#anime-dual-label');
    if (label) {
      label.textContent = this.dualSubtitlesEnabled ? 'Dual: On' : 'Dual: Off';
    }
    const btn = this.container?.querySelector('#btn-anime-toggle-dual');
    if (btn) {
      btn.classList.toggle('active', this.dualSubtitlesEnabled);
    }
    this.updateFromStore();
  }

  async toggleShadowRecording() {
    if (!this.shadowingRecorder) return;
    const btnRecord = this.container?.querySelector('#btn-anime-shadow-record');
    const label = this.container?.querySelector('#anime-shadow-record-label');
    const status = this.container?.querySelector('#anime-shadow-status');
    const btnCompare = this.container?.querySelector('#btn-anime-shadow-compare');

    if (!this.shadowingRecorder.isRecording) {
      try {
        await this.shadowingRecorder.startRecording();
        if (label) label.textContent = 'Stop';
        if (btnRecord) btnRecord.classList.add('active');
        if (status) status.textContent = 'Recording...';
      } catch (err) {
        console.warn('[AnimeView] Failed to start shadowing record:', err);
        if (status) status.textContent = 'Mic Error';
      }
    } else {
      try {
        const result = await this.shadowingRecorder.stopRecording();
        if (label) label.textContent = 'Record';
        if (btnRecord) btnRecord.classList.remove('active');
        if (status) status.textContent = 'Recorded';
        if (btnCompare && result?.url) {
          btnCompare.disabled = false;
        }
      } catch (err) {
        console.warn('[AnimeView] Failed to stop shadowing record:', err);
      }
    }
  }

  toggleInspector(forceState = null) {
    this.inspectorOpen = forceState !== null ? forceState : !this.inspectorOpen;
    const panel = this.container?.querySelector('#anime-inspector-panel');
    const grid = this.container?.querySelector('#anime-layout-grid');
    if (panel) {
      panel.style.display = this.inspectorOpen ? 'flex' : 'none';
    }
    if (grid) {
      grid.classList.toggle('has-inspector', this.inspectorOpen);
    }
  }

  unmount() {
    this._flushSessionStats();
    if (this.shadowingRecorder) {
      this.shadowingRecorder.dispose();
    }
    if (this._positionSaveTimer) {
      clearInterval(this._positionSaveTimer);
      this._positionSaveTimer = null;
    }
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
