/**
 * Kiroku Note Desktop — Vocab Watch Segment (Slice 39)
 * Live sentence panel, token chips (known/gap/new), cue navigation,
 * controls bar, grammar accordion, and keyboard shortcuts.
 */

import { LinkStore } from '../services/link_store.js';
import { LinkMineService } from '../services/link_mine.js';
import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

export class VocabWatchView {
  constructor(options = {}) {
    this.router = options.router || null;
    this.apiClient = options.apiClient || apiClient;
    this.linkClient = options.linkClient || null;
    this.linkStore = options.linkStore || null;
    this.linkMineService = options.linkMineService || new LinkMineService({
      linkStore: this.linkStore,
      apiClient: this.apiClient
    });
    this.container = null;
    this.learnerLevel = options.learnerLevel || 'N4';

    this.state = 'not-connected'; // 'not-connected' | 'connected-no-video' | 'watching'
    this.activeCue = null;
    this.activeCueIndex = null;
    this.prevCue = null;
    this.nextCue = null;
    this.session = null;
    this.videoState = { t: 0, paused: true, rate: 1 };
    this.cues = [];

    this.annotationsCache = new Map(); // cue text -> token array
    this.grammarData = null;
    this.grammarOpen = false;
    this.hoverPauseEnabled = false;
    this.offsetMs = 0;
    this.popoverEl = null;
    this.isFetchingAnnotations = false;

    this._statusListener = null;
    this._sessionListener = null;
    this._stateListener = null;
    this._cueListener = null;
    this._activeCueListener = null;
    this._keydownListener = null;
    this._outsideClickListener = null;
  }

  ensureStyles() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('vocab-watch-style')) {
      const link = document.createElement('link');
      link.id = 'vocab-watch-style';
      link.rel = 'stylesheet';
      link.href = './ui/styles/views/watch.css';
      document.head?.appendChild(link);
    }
  }

  async mount(container) {
    this.container = container;
    this.ensureStyles();
    try {
      this.learnerLevel = await getUniversalJlptLevel();
    } catch (err) {
      console.debug('[VocabWatch] getUniversalJlptLevel fallback:', err);
    }

    this._initStore();
    this.render();
    this.setupEvents();
    this.syncFromStore();
  }

  _initStore() {
    if (!this.linkStore) {
      if (this.linkClient) {
        this.linkStore = window.kirokuLinkStore || new LinkStore(this.linkClient);
      }
    }
    if (this.linkMineService && this.linkStore) {
      this.linkMineService.linkStore = this.linkStore;
    }
  }

  syncFromStore() {
    if (!this.linkStore) {
      this.state = 'not-connected';
      this.render();
      return;
    }

    const summary = this.linkStore.getStatusSummary ? this.linkStore.getStatusSummary() : {
      connected: this.linkStore.status === 'connected',
      status: this.linkStore.status,
      activeSession: this.linkStore.activeSession,
      videoState: this.linkStore.videoState,
      activeCue: this.linkStore.activeCue,
      activeCueIndex: this.linkStore.activeCueIndex,
      cues: this.linkStore.cues || []
    };

    this.cues = this.linkStore.cues || [];
    this.session = summary.activeSession;
    this.videoState = summary.videoState || { t: 0, paused: true, rate: 1 };
    this.activeCue = summary.activeCue;
    this.activeCueIndex = summary.activeCueIndex;

    this._updateState(summary);
    this.render();
    if (this.activeCue) {
      this.handleCueChange(this.activeCue);
    }
  }

  _updateState(summary) {
    if (!summary || !summary.connected) {
      this.state = 'not-connected';
    } else if (!this.session && (!this.cues || this.cues.length === 0)) {
      this.state = 'connected-no-video';
    } else {
      this.state = 'watching';
    }
  }

  formatTime(seconds = 0) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(m)}:${pad(rem)}`;
  }

  render() {
    if (!this.container) return;

    if (this.state === 'not-connected') {
      this.container.innerHTML = `
        <div class="watch-view-wrapper" tabindex="0">
          <div class="watch-state-card tactile-card">
            <h2 class="text-xl font-bold font-display text-warm-paper mb-1">Watch (Not Connected)</h2>
            <p class="text-secondary font-sans mb-3">Kiroku Link is not connected to any browser session.</p>
            <div class="watch-steps">
              <div class="watch-step">
                <span class="watch-step-num">1</span>
                <span>Open Google Chrome or Chromium with the Kiroku Note Extension installed.</span>
              </div>
              <div class="watch-step">
                <span class="watch-step-num">2</span>
                <span>Ensure the Kiroku Link server is running on local port 21828.</span>
              </div>
              <div class="watch-step">
                <span class="watch-step-num">3</span>
                <span>Open YouTube, Netflix, or anime streaming in Chrome with Japanese subtitles enabled.</span>
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (this.state === 'connected-no-video') {
      this.container.innerHTML = `
        <div class="watch-view-wrapper" tabindex="0">
          <div class="watch-state-card tactile-card">
            <h2 class="text-xl font-bold font-display text-warm-paper mb-1">Connected — Waiting for Video</h2>
            <p class="text-secondary font-sans mb-2">Connected to browser extension, but no video tab is currently active.</p>
            <p class="text-xs text-muted font-sans">Start playing a video with subtitles in your paired browser tab.</p>
          </div>
        </div>
      `;
      return;
    }

    // Watching state
    const site = this.session?.site || 'WEB';
    const title = this.session?.title || 'Active Video';
    const currentTime = this.formatTime(this.videoState?.t || 0);
    const durationTime = this.formatTime(this.session?.duration || 0);
    const isPaused = Boolean(this.videoState?.paused);

    this.container.innerHTML = `
      <div class="watch-view-wrapper" id="watch-view-panel" tabindex="0">
        <!-- Session Header -->
        <header class="watch-session-header tactile-card">
          <div class="watch-session-meta">
            <span class="watch-site-badge font-mono">${escapeHtml(site)}</span>
            <span class="watch-session-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          </div>
          <div class="watch-session-time font-mono">
            <span id="watch-time-display">${currentTime} / ${durationTime}</span>
          </div>
        </header>

        <!-- Watching Stage -->
        <div class="watch-stage">
          <!-- Previous Line Peek -->
          <div class="watch-peek-box watch-peek-prev font-japanese" id="watch-peek-prev" title="Click to jump to previous line">
            ${this.prevCue ? escapeHtml(this.prevCue.text) : '<span class="text-xs text-muted">— Previous line —</span>'}
          </div>

          <!-- Active Sentence Card -->
          <div class="watch-active-card tactile-card">
            <div class="watch-active-tokens font-japanese" id="watch-active-tokens">
              ${this._renderTokensPlaceholder()}
            </div>

            <div class="watch-active-actions">
              <button type="button" class="watch-ctrl-btn" id="btn-watch-add-card" title="Mine current line to Anki">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                <span>Add Card</span>
              </button>
            </div>
          </div>

          <!-- Next Line Peek -->
          <div class="watch-peek-box watch-peek-next font-japanese" id="watch-peek-next" title="Click to jump to next line">
            ${this.nextCue ? escapeHtml(this.nextCue.text) : '<span class="text-xs text-muted">— Next line —</span>'}
          </div>

          <!-- Grammar Analysis Collapsible Accordion -->
          <div class="watch-grammar-accordion" id="watch-grammar-accordion">
            <div class="watch-grammar-header" id="watch-grammar-header">
              <span>Grammar Points (${this.grammarData?.points?.length || 0})</span>
              <span class="font-mono text-xs">${this.grammarOpen ? '▲' : '▼'}</span>
            </div>
            <div class="watch-grammar-body" id="watch-grammar-body" style="display: ${this.grammarOpen ? 'flex' : 'none'};">
              ${this._renderGrammarChips()}
            </div>
          </div>
        </div>

        <!-- Controls Bar -->
        <div class="watch-controls-bar tactile-card">
          <div class="watch-ctrl-group">
            <button type="button" class="watch-ctrl-btn btn-play-pause" id="btn-watch-play-pause">
              ${isPaused ? 'Play' : 'Pause'}
            </button>
            <button type="button" class="watch-ctrl-btn" id="btn-watch-seek-back" title="Seek -5s">-5s</button>
            <button type="button" class="watch-ctrl-btn" id="btn-watch-seek-fwd" title="Seek +5s">+5s</button>
          </div>

          <div class="watch-ctrl-group">
            <button type="button" class="watch-ctrl-btn" id="btn-watch-prev-cue" title="Previous cue (Left Arrow)">◀ Prev</button>
            <button type="button" class="watch-ctrl-btn" id="btn-watch-replay-cue" title="Replay active cue (R)">Replay</button>
            <button type="button" class="watch-ctrl-btn" id="btn-watch-next-cue" title="Next cue (Right Arrow)">Next ▶</button>
            <button type="button" class="watch-ctrl-btn" id="btn-watch-loop-cue" title="Loop cue (L)">Loop</button>
          </div>

          <div class="watch-ctrl-group">
            <label class="text-xs text-muted font-sans" for="watch-rate-select">Speed</label>
            <select class="watch-ctrl-select font-mono" id="watch-rate-select">
              <option value="0.75" ${this.videoState.rate === 0.75 ? 'selected' : ''}>0.75x</option>
              <option value="1" ${this.videoState.rate === 1 || !this.videoState.rate ? 'selected' : ''}>1.0x</option>
              <option value="1.25" ${this.videoState.rate === 1.25 ? 'selected' : ''}>1.25x</option>
              <option value="1.5" ${this.videoState.rate === 1.5 ? 'selected' : ''}>1.5x</option>
              <option value="2" ${this.videoState.rate === 2 ? 'selected' : ''}>2.0x</option>
            </select>
          </div>

          <div class="watch-ctrl-group">
            <span class="text-xs text-muted font-sans">Offset:</span>
            <button type="button" class="watch-ctrl-btn" data-offset="-100" id="btn-watch-offset-minus">-100ms</button>
            <button type="button" class="watch-ctrl-btn" data-offset="0" id="btn-watch-offset-zero">0</button>
            <button type="button" class="watch-ctrl-btn" data-offset="100" id="btn-watch-offset-plus">+100ms</button>
          </div>

          <div class="watch-ctrl-group">
            <label class="watch-hover-pause-toggle">
              <input type="checkbox" id="watch-hover-pause-chk" ${this.hoverPauseEnabled ? 'checked' : ''} />
              <span>Hover pause</span>
            </label>
          </div>
        </div>
      </div>
    `;

    this._bindWatchingEvents();
  }

  _renderTokensPlaceholder() {
    if (!this.activeCue || !this.activeCue.text) {
      return '<span class="text-muted font-sans text-base">Waiting for subtitle cue...</span>';
    }
    const cached = this.annotationsCache.get(this.activeCue.text);
    if (cached && Array.isArray(cached)) {
      return this._generateTokenChipsHtml(cached);
    }
    return `<span>${escapeHtml(this.activeCue.text)}</span>`;
  }

  _generateTokenChipsHtml(tokens) {
    if (!tokens || !tokens.length) {
      return `<span>${escapeHtml(this.activeCue?.text || '')}</span>`;
    }
    return tokens.map((t, idx) => {
      let statusClass = 'is-unstyled';
      if (t.status === 'mined' || t.status === 'known' || t.known) {
        statusClass = 'is-known';
      } else if (t.status === 'should_know' || t.status === 'gap') {
        statusClass = 'is-gap';
      } else if (t.status === 'new' || t.is_new) {
        statusClass = 'is-new';
      }

      const surface = escapeHtml(t.surface || t.word || '');
      const reading = t.reading ? `<span class="watch-token-ruby">${escapeHtml(t.reading)}</span>` : '';
      return `
        <button type="button" class="watch-token-chip ${statusClass}" data-token-index="${idx}" data-surface="${surface}" data-reading="${escapeHtml(t.reading || '')}" data-lemma="${escapeHtml(t.lemma || t.surface || '')}">
          ${reading}
          <span class="watch-token-surface">${surface}</span>
        </button>
      `;
    }).join('');
  }

  _renderGrammarChips() {
    if (!this.grammarData || !this.grammarData.points || this.grammarData.points.length === 0) {
      return '<span class="text-xs text-muted font-sans">No grammar points identified for this sentence.</span>';
    }
    return this.grammarData.points.map((p) => `
      <div class="watch-grammar-chip">
        <span class="watch-grammar-level">${escapeHtml(p.level || 'N?')}</span>
        <span>${escapeHtml(p.title || p.point || '')}</span>
      </div>
    `).join('');
  }

  setupEvents() {
    if (!this.linkStore) return;

    this._statusListener = (newStatus) => {
      this.syncFromStore();
    };
    this._sessionListener = (session) => {
      this.session = session;
      this.syncFromStore();
    };
    this._stateListener = (state) => {
      this.videoState = state;
      this._updatePlaybackUi();
    };
    this._cueListener = (cues) => {
      this.cues = cues || [];
      this.prefetchAnnotations(this.cues, 0);
      this.syncFromStore();
    };
    this._activeCueListener = (cue, idx) => {
      this.activeCue = cue;
      this.activeCueIndex = idx;
      this._updateCueSurroundings();
      this.handleCueChange(cue);
    };

    this.linkStore.on('status', this._statusListener);
    this.linkStore.on('session', this._sessionListener);
    this.linkStore.on('video:state', this._stateListener);
    this.linkStore.on('cues', this._cueListener);
    this.linkStore.on('cue:active', this._activeCueListener);

    // Keyboard handlers
    this._keydownListener = (e) => this.handleKeyDown(e);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._keydownListener);
    }

    // Outside click for dictionary popover
    this._outsideClickListener = (e) => {
      if (this.popoverEl && !this.popoverEl.contains(e.target) && !e.target.closest('.watch-token-chip')) {
        this.closePopover();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this._outsideClickListener);
    }
  }

  _bindWatchingEvents() {
    if (this.state !== 'watching' || typeof document === 'undefined') return;

    const playPauseBtn = document.getElementById('btn-watch-play-pause');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.linkStore?.toggle();
      });
    }

    const seekBackBtn = document.getElementById('btn-watch-seek-back');
    if (seekBackBtn) {
      seekBackBtn.addEventListener('click', () => {
        this.linkStore?.seek(undefined, -5);
      });
    }

    const seekFwdBtn = document.getElementById('btn-watch-seek-fwd');
    if (seekFwdBtn) {
      seekFwdBtn.addEventListener('click', () => {
        this.linkStore?.seek(undefined, 5);
      });
    }

    const prevCueBtn = document.getElementById('btn-watch-prev-cue');
    if (prevCueBtn) {
      prevCueBtn.addEventListener('click', () => {
        this.jumpPrevCue();
      });
    }

    const nextCueBtn = document.getElementById('btn-watch-next-cue');
    if (nextCueBtn) {
      nextCueBtn.addEventListener('click', () => {
        this.jumpNextCue();
      });
    }

    const replayBtn = document.getElementById('btn-watch-replay-cue');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        this.replayActiveCue();
      });
    }

    const loopBtn = document.getElementById('btn-watch-loop-cue');
    if (loopBtn) {
      loopBtn.addEventListener('click', () => {
        this.loopActiveCue();
      });
    }

    const rateSelect = document.getElementById('watch-rate-select');
    if (rateSelect) {
      rateSelect.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0) {
          this.linkStore?.setRate(val);
        }
      });
    }

    // Offset buttons
    const btnOffsetMinus = document.getElementById('btn-watch-offset-minus');
    const btnOffsetZero = document.getElementById('btn-watch-offset-zero');
    const btnOffsetPlus = document.getElementById('btn-watch-offset-plus');
    if (btnOffsetMinus) {
      btnOffsetMinus.addEventListener('click', () => {
        this.offsetMs -= 100;
        this.linkStore?.setOffset(this.offsetMs);
      });
    }
    if (btnOffsetZero) {
      btnOffsetZero.addEventListener('click', () => {
        this.offsetMs = 0;
        this.linkStore?.setOffset(0);
      });
    }
    if (btnOffsetPlus) {
      btnOffsetPlus.addEventListener('click', () => {
        this.offsetMs += 100;
        this.linkStore?.setOffset(this.offsetMs);
      });
    }

    // Hover pause toggle
    const hoverChk = document.getElementById('watch-hover-pause-chk');
    if (hoverChk) {
      hoverChk.addEventListener('change', (e) => {
        this.hoverPauseEnabled = e.target.checked;
      });
    }

    // Peek line jumps
    const peekPrev = document.getElementById('watch-peek-prev');
    if (peekPrev) {
      peekPrev.addEventListener('click', () => this.jumpPrevCue());
    }
    const peekNext = document.getElementById('watch-peek-next');
    if (peekNext) {
      peekNext.addEventListener('click', () => this.jumpNextCue());
    }

    // Grammar toggle
    const grammarHeader = document.getElementById('watch-grammar-header');
    if (grammarHeader) {
      grammarHeader.addEventListener('click', () => {
        this.grammarOpen = !this.grammarOpen;
        const body = document.getElementById('watch-grammar-body');
        if (body) {
          body.style.display = this.grammarOpen ? 'flex' : 'none';
        }
        const arrow = grammarHeader.querySelector('.text-xs');
        if (arrow) arrow.textContent = this.grammarOpen ? '▲' : '▼';
      });
    }

    // Add card button
    const btnAddCard = document.getElementById('btn-watch-add-card');
    if (btnAddCard) {
      btnAddCard.addEventListener('click', () => {
        this.mineCurrentLine(btnAddCard);
      });
    }

    this._bindTokenChipEvents();
  }

  _bindTokenChipEvents() {
    if (typeof document === 'undefined') return;
    const tokensStage = document.getElementById('watch-active-tokens');
    if (!tokensStage) return;

    const chips = tokensStage.querySelectorAll('.watch-token-chip');
    chips.forEach((chip) => {
      chip.addEventListener('mouseenter', () => {
        if (this.hoverPauseEnabled && !this.videoState.paused) {
          this.linkStore?.pause();
        }
      });

      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDictionaryPopover(chip);
      });
    });
  }

  _updatePlaybackUi() {
    if (typeof document === 'undefined') return;
    const playPauseBtn = document.getElementById('btn-watch-play-pause');
    if (playPauseBtn) {
      playPauseBtn.textContent = this.videoState.paused ? 'Play' : 'Pause';
    }
    const timeDisplay = document.getElementById('watch-time-display');
    if (timeDisplay) {
      const cur = this.formatTime(this.videoState.t);
      const dur = this.formatTime(this.session?.duration || 0);
      timeDisplay.textContent = `${cur} / ${dur}`;
    }
  }

  _updateCueSurroundings() {
    if (!this.cues || this.cues.length === 0 || this.activeCueIndex === null) {
      this.prevCue = null;
      this.nextCue = null;
      return;
    }
    const curIdx = this.cues.findIndex(c => c.i === this.activeCueIndex);
    this.prevCue = curIdx > 0 ? this.cues[curIdx - 1] : null;
    this.nextCue = curIdx >= 0 && curIdx < this.cues.length - 1 ? this.cues[curIdx + 1] : null;
  }

  async handleCueChange(cue) {
    if (!cue || !cue.text) return;
    this._updateCueSurroundings();
    if (typeof document === 'undefined') return;

    const peekPrev = document.getElementById('watch-peek-prev');
    if (peekPrev) {
      peekPrev.innerHTML = this.prevCue ? escapeHtml(this.prevCue.text) : '<span class="text-xs text-muted">— Previous line —</span>';
    }

    const peekNext = document.getElementById('watch-peek-next');
    if (peekNext) {
      peekNext.innerHTML = this.nextCue ? escapeHtml(this.nextCue.text) : '<span class="text-xs text-muted">— Next line —</span>';
    }

    // Check cached annotations
    const tokensStage = document.getElementById('watch-active-tokens');
    if (tokensStage) {
      const cached = this.annotationsCache.get(cue.text);
      if (cached) {
        tokensStage.innerHTML = this._generateTokenChipsHtml(cached);
        this._bindTokenChipEvents();
      } else {
        tokensStage.innerHTML = `<span>${escapeHtml(cue.text)}</span>`;
        this.fetchCueAnnotation(cue);
      }
    }

    // Trigger prefetch for next 40 cues
    const curIdx = this.cues.findIndex(c => c.i === cue.i);
    if (curIdx >= 0) {
      this.prefetchAnnotations(this.cues, curIdx);
    }

    // Grammar analyze current sentence
    this.fetchGrammar(cue.text);
  }

  async fetchCueAnnotation(cue) {
    if (!cue?.text || !this.apiClient) return;
    try {
      const payload = {
        cues: [{ id: cue.i || 0, text: cue.text, start: cue.s || 0, end: cue.e || 0 }],
        learner_level: this.learnerLevel
      };
      const res = await this.apiClient.request('/api/subtitle/annotate', {
        method: 'POST',
        body: payload
      });
      const annotated = res?.cues?.[0]?.tokens;
      if (annotated) {
        this.annotationsCache.set(cue.text, annotated);
        if (this.activeCue?.text === cue.text) {
          const tokensStage = document.getElementById('watch-active-tokens');
          if (tokensStage) {
            tokensStage.innerHTML = this._generateTokenChipsHtml(annotated);
            this._bindTokenChipEvents();
          }
        }
      }
    } catch (err) {
      console.debug('[VocabWatch] Annotation failed for cue:', err);
    }
  }

  async prefetchAnnotations(cues, startIndex = 0) {
    if (this.isFetchingAnnotations || !cues || !cues.length || !this.apiClient) return;
    const batch = cues.slice(startIndex, startIndex + 40).filter(c => c.text && !this.annotationsCache.has(c.text));
    if (!batch.length) return;

    this.isFetchingAnnotations = true;
    try {
      const formatted = batch.map(c => ({
        id: c.i || 0,
        text: c.text,
        start: c.s || 0,
        end: c.e || 0
      }));
      const res = await this.apiClient.request('/api/subtitle/annotate', {
        method: 'POST',
        body: { cues: formatted, learner_level: this.learnerLevel }
      });
      if (res?.cues && Array.isArray(res.cues)) {
        res.cues.forEach(ac => {
          if (ac.text && ac.tokens) {
            this.annotationsCache.set(ac.text, ac.tokens);
          }
        });
      }
    } catch (err) {
      console.debug('[VocabWatch] Prefetch annotations failed:', err);
    } finally {
      this.isFetchingAnnotations = false;
    }
  }

  async fetchGrammar(sentence) {
    if (!sentence || !this.apiClient) return;
    try {
      const res = await this.apiClient.request('/api/grammar/analyze', {
        method: 'POST',
        body: { sentence, learner_level: this.learnerLevel }
      });
      this.grammarData = res;
      if (typeof document !== 'undefined') {
        const countEl = document.querySelector('#watch-grammar-header span:first-child');
        if (countEl) countEl.textContent = `Grammar Points (${res?.points?.length || 0})`;
        const bodyEl = document.getElementById('watch-grammar-body');
        if (bodyEl) bodyEl.innerHTML = this._renderGrammarChips();
      }
    } catch (err) {
      console.debug('[VocabWatch] Grammar analyze failed:', err);
    }
  }

  jumpPrevCue() {
    this.linkStore?.jumpCue({ delta: -1 });
  }

  jumpNextCue() {
    this.linkStore?.jumpCue({ delta: 1 });
  }

  replayActiveCue() {
    if (this.activeCue && typeof this.activeCue.s === 'number') {
      this.linkStore?.seek(this.activeCue.s);
      this.linkStore?.play();
    }
  }

  loopActiveCue() {
    if (this.activeCue && typeof this.activeCue.s === 'number' && typeof this.activeCue.e === 'number') {
      this.linkStore?.loop(this.activeCue.s, this.activeCue.e);
    }
  }

  handleKeyDown(e) {
    // Check if watch panel or its descendants have focus
    const panel = document.getElementById('watch-view-panel');
    if (!panel || (!panel.contains(document.activeElement) && document.activeElement !== document.body)) {
      return;
    }
    // Ignore if input/textarea is focused
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (e.code === 'Space') {
      e.preventDefault();
      this.linkStore?.toggle();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      this.jumpPrevCue();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      this.jumpNextCue();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.replayActiveCue();
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      this.loopActiveCue();
    }
  }

  async showDictionaryPopover(chipEl) {
    this.closePopover();
    const surface = chipEl.dataset.surface || '';
    const reading = chipEl.dataset.reading || '';
    const lemma = chipEl.dataset.lemma || surface;

    const popover = document.createElement('div');
    popover.className = 'watch-popover tactile-card';
    popover.innerHTML = `
      <div class="watch-popover-head">
        <span class="watch-popover-term">${escapeHtml(surface)}</span>
        <span class="watch-popover-reading">${escapeHtml(reading)}</span>
      </div>
      <div class="watch-popover-gloss" id="popover-gloss-content">
        <span class="text-xs text-muted">Searching dictionary...</span>
      </div>
      <div class="watch-popover-actions">
        <button type="button" class="watch-ctrl-btn" id="btn-popover-add-card">Add to Anki</button>
      </div>
    `;

    document.body.appendChild(popover);
    this.popoverEl = popover;

    // Position near chip
    const rect = chipEl.getBoundingClientRect();
    popover.style.top = `${Math.max(10, rect.bottom + window.scrollY + 6)}px`;
    popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 300, rect.left + window.scrollX))}px`;

    // Fetch dictionary details
    let glossText = '';
    try {
      const searchRes = await (this.apiClient.searchDictionary ? this.apiClient.searchDictionary(lemma) : this.apiClient.captureText(lemma));
      const entry = Array.isArray(searchRes) ? searchRes[0] : (searchRes?.results?.[0] || searchRes);
      if (entry) {
        glossText = entry.glossary?.join('; ') || entry.meaning || entry.definition || (Array.isArray(entry.definitions) ? entry.definitions.join('; ') : entry.definitions) || 'Definition found.';
      } else {
        glossText = 'No dictionary definition found.';
      }
    } catch (_) {
      glossText = 'Lookup failed.';
    }

    const glossContainer = popover.querySelector('#popover-gloss-content');
    if (glossContainer) glossContainer.textContent = glossText;

    const addBtn = popover.querySelector('#btn-popover-add-card');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.mineTerm(surface, reading, glossText, addBtn);
      });
    }
  }

  closePopover() {
    if (this.popoverEl && this.popoverEl.parentNode) {
      this.popoverEl.parentNode.removeChild(this.popoverEl);
      this.popoverEl = null;
    }
  }

  openQuickAddWithCurrentCue() {
    const inputSentence = document.getElementById('input-sentence');
    if (inputSentence && this.activeCue) {
      inputSentence.value = this.activeCue.text || '';
    }
    const dock = document.getElementById('vocab-quick-add-dock');
    if (dock) {
      dock.classList.remove('is-collapsed');
    }
  }

  openQuickAddWithTerm(expression, reading, meaning) {
    const inputExpr = document.getElementById('input-expression');
    const inputRead = document.getElementById('input-reading');
    const inputMean = document.getElementById('input-meaning');
    const inputSentence = document.getElementById('input-sentence');

    if (inputExpr) inputExpr.value = expression;
    if (inputRead) inputRead.value = reading;
    if (inputMean) inputMean.value = meaning;
    if (inputSentence && this.activeCue) {
      inputSentence.value = this.activeCue.text || '';
    }

    const dock = document.getElementById('vocab-quick-add-dock');
    if (dock) {
      dock.classList.remove('is-collapsed');
    }
  }

  async mineTerm(surface, reading, meaning, triggerBtn = null) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Mining...';
    }
    const res = await this.linkMineService.mineWord({
      expression: surface,
      reading: reading,
      meaning: meaning,
      cue: this.activeCue,
      session: this.session
    });

    if (res.ok) {
      this.markTokenKnown(surface);
      if (triggerBtn) {
        triggerBtn.textContent = res.timedOut ? 'Saved (no media)' : 'Saved to Anki!';
      }
      setTimeout(() => this.closePopover(), 900);
      return res;
    } else {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = 'Retry Mine';
        triggerBtn.onclick = () => this.mineTerm(surface, reading, meaning, triggerBtn);
      }
      this.showInlineNotice(res.error || 'Failed to create card', 'error');
      return res;
    }
  }

  async mineCurrentLine(triggerBtn = null) {
    if (!this.activeCue) return;
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Mining line...';
    }
    const res = await this.linkMineService.mineWord({
      expression: this.activeCue.text,
      reading: '',
      meaning: '',
      cue: this.activeCue,
      session: this.session
    });

    if (res.ok) {
      if (triggerBtn) {
        triggerBtn.textContent = res.timedOut ? 'Line saved (no media)' : 'Line saved!';
        setTimeout(() => {
          triggerBtn.disabled = false;
          triggerBtn.textContent = 'Add Card';
        }, 1500);
      }
      return res;
    } else {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = 'Retry line';
        triggerBtn.onclick = () => this.mineCurrentLine(triggerBtn);
      }
      this.showInlineNotice(res.error || 'Failed to mine line', 'error');
      return res;
    }
  }

  markTokenKnown(surface) {
    if (!surface) return;
    if (this.activeCue?.text && this.annotationsCache.has(this.activeCue.text)) {
      const tokens = this.annotationsCache.get(this.activeCue.text);
      if (Array.isArray(tokens)) {
        tokens.forEach((t) => {
          if (t.surface === surface || t.lemma === surface) {
            t.status = 'known';
            t.known = true;
          }
        });
      }
    }
    if (typeof document !== 'undefined') {
      const chips = document.querySelectorAll(`.watch-token-chip[data-surface="${surface}"]`);
      chips.forEach((c) => {
        c.classList.remove('is-gap', 'is-new', 'is-unstyled');
        c.classList.add('is-known');
      });
    }
  }

  showInlineNotice(message, type = 'info') {
    if (typeof document === 'undefined') return;
    let noticeEl = document.getElementById('watch-inline-notice');
    if (!noticeEl) {
      noticeEl = document.createElement('div');
      noticeEl.id = 'watch-inline-notice';
      noticeEl.className = 'watch-peek-box font-sans text-xs';
      noticeEl.style.marginTop = '8px';
      const stage = document.querySelector('.watch-stage');
      if (stage) stage.appendChild(noticeEl);
    }
    noticeEl.textContent = message;
    noticeEl.style.display = 'block';
    setTimeout(() => {
      if (noticeEl) noticeEl.style.display = 'none';
    }, 4000);
  }

  unmount() {
    if (this.linkStore) {
      if (this._statusListener) this.linkStore.off('status', this._statusListener);
      if (this._sessionListener) this.linkStore.off('session', this._sessionListener);
      if (this._stateListener) this.linkStore.off('video:state', this._stateListener);
      if (this._cueListener) this.linkStore.off('cues', this._cueListener);
      if (this._activeCueListener) this.linkStore.off('cue:active', this._activeCueListener);
    }
    if (this._keydownListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._keydownListener);
    }
    if (this._outsideClickListener && typeof document !== 'undefined') {
      document.removeEventListener('click', this._outsideClickListener);
    }
    this.closePopover();
  }
}

// Auto-wire on import into #vocab-watch-container when available
if (typeof document !== 'undefined') {
  const mountVocabWatch = () => {
    const container = document.getElementById('vocab-watch-container');
    if (container && !container.__vocabWatchInstance) {
      const view = new VocabWatchView();
      container.__vocabWatchInstance = view;
      view.mount(container);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountVocabWatch);
  } else {
    mountVocabWatch();
  }

  const tabWatch = document.getElementById('vocab-tab-watch');
  if (tabWatch) {
    tabWatch.addEventListener('click', () => {
      setTimeout(mountVocabWatch, 0);
    });
  }
}
