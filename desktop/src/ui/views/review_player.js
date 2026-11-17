/**
 * Neo-Brutalist Review Stage View Component
 * Provides:
 *  1. Anki-Style Deck Overview Stage (New, Learn, Due with Animata-style spring counter animation)
 *  2. Integrated FSRS Deck Settings Modal (uncluttering Home)
 *  3. Full Neo-Brutalist Active Flashcard Reviewer (4 FSRS grades, Undo, Bury, Suspend, Audio)
 */

import { ReviewSettingsModal } from '../components/review_settings_modal.js';

export function animateCounter(element, targetValue, durationMs = 800) {
  if (!element) return;
  const target = Math.max(0, parseInt(targetValue, 10) || 0);
  if (target === 0) {
    element.textContent = '0';
    return;
  }
  const reducedMotion = typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    element.textContent = Intl.NumberFormat('en-US').format(target);
    return;
  }

  const startValue = parseInt(String(element.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0;
  if (startValue === target && element.hasAttribute('data-animated')) {
    element.textContent = Intl.NumberFormat('en-US').format(target);
    return;
  }
  element.setAttribute('data-animated', 'true');

  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Spring ease-out curve (similar to Animata stiffness: 80, damping: 60)
    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -8 * progress);
    const current = Math.round(startValue + (target - startValue) * eased);
    element.textContent = Intl.NumberFormat('en-US').format(current);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = Intl.NumberFormat('en-US').format(target);
    }
  }
  requestAnimationFrame(step);
}

function unwrapResponse(res) {
  if (!res) return null;
  if (res.data !== undefined) return res.data;
  return res;
}

export class ReviewPlayer {
  constructor(routerOrOptions = {}) {
    if (routerOrOptions && typeof routerOrOptions.navigateToTab === 'function') {
      this.router = routerOrOptions;
      this.queue = [];
      this.onGrade = null;
      this.onBury = null;
      this.onSuspend = null;
      this.onUndo = null;
      this.onFinish = null;
      this.apiBase = '';
    } else {
      const opts = routerOrOptions || {};
      this.router = opts.router || null;
      this.queue = opts.queue || [];
      this.onGrade = opts.onGrade || null;
      this.onBury = opts.onBury || null;
      this.onSuspend = opts.onSuspend || null;
      this.onUndo = opts.onUndo || null;
      this.onFinish = opts.onFinish || null;
      this.apiBase = opts.apiBase || '';
    }

    // States: 'overview' (deck stats stage) | 'reviewing' (active flashcard) | 'completed'
    this.stageState = (this.queue && this.queue.length > 0) ? 'reviewing' : 'overview';
    this.deckStats = {
      deck_name: 'N3 vocabs',
      new_count: 0,
      learn_count: 0,
      due_count: 0,
      total_due: 0,
      total_cards: 0,
      total_studied_today: 0,
      studied_seconds_today: 0,
      seconds_per_card: 0,
      buried_count: 0,
      suspended_count: 0
    };

    this.currentIndex = 0;
    this.isFlipped = false;
    this.startTime = null;
    this.element = null;
    this.container = null;
    this.boundKeyHandler = null;
    this._toastTimer = null;
    this._isBusy = false;
    this._isLoading = false;
    this.keepAlive = false;
  }

  currentCard() {
    if (!this.queue || this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  getPreferredDeck() {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('kiroku:selected-deck') ||
                       localStorage.getItem('last_used_deck') ||
                       localStorage.getItem('anki_deck');
        if (stored && stored.trim() && stored.trim() !== 'Default') {
          return stored.trim();
        }
      } catch (_) {}
    }
    return 'N3 vocabs';
  }

  showToast(msg) {
    if (!this.element) return;
    const toast = this.element.querySelector('#player-toast-banner');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        if (toast) toast.style.display = 'none';
      }, 1500);
    }
  }

  async sendApiRequest(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body || undefined;
    const query = options.query || undefined;

    if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
      try {
        const raw = await window.desktopAPI.api.request({ path, method, body, query });
        return unwrapResponse(raw);
      } catch (err) {
        console.debug('[Review] IPC request error, falling back to fetch:', err);
      }
    }

    const base = this.apiBase || 'http://127.0.0.1:21828';
    let url = `${base}${path}`;
    if (query) {
      const q = new URLSearchParams(query).toString();
      url += `?${q}`;
    }
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return await res.json();
  }

  async loadOverviewData() {
    this._isLoading = true;
    const deck = this.getPreferredDeck();

    try {
      if (typeof window !== 'undefined' && window.desktopAPI?.getBackendInfo) {
        const info = await window.desktopAPI.getBackendInfo();
        if (info && info.port) {
          this.apiBase = `http://${info.host || '127.0.0.1'}:${info.port}`;
        }
      }
    } catch (_) {}
    if (!this.apiBase) this.apiBase = 'http://127.0.0.1:21828';

    try {
      const stats = await this.sendApiRequest('/api/review/stats', { query: { deck_name: deck } });
      if (stats) {
        this.deckStats = {
          deck_name: deck,
          new_count: stats.new_count ?? stats.new_cards_due_count ?? 0,
          learn_count: stats.learn_count ?? stats.learning_count ?? 0,
          due_count: stats.due_count ?? stats.reviews_due_count ?? 0,
          total_due: stats.cards_due_today ?? 0,
          total_cards: stats.total_cards ?? 0,
          total_studied_today: stats.total_studied_today ?? stats.reviews_done_today ?? 0,
          studied_seconds_today: stats.studied_seconds_today ?? 0,
          seconds_per_card: stats.seconds_per_card ?? 0,
          buried_count: stats.buried_count ?? 0,
          suspended_count: stats.suspended_count ?? 0
        };
      }
    } catch (err) {
      console.error('[Review] Failed to load deck overview stats:', err);
    } finally {
      this._isLoading = false;
    }
  }

  async startStudySession() {
    this._isLoading = true;
    this.updateDom();
    const deck = this.getPreferredDeck();

    try {
      const data = await this.sendApiRequest('/api/review/queue', { query: { deck_name: deck } });
      this.queue = (data && (data.cards || data.queue)) ? (data.cards || data.queue) : [];
      this.currentIndex = 0;
      this.isFlipped = false;
      this.stageState = (this.queue.length > 0) ? 'reviewing' : 'completed';
      this.startTime = Date.now();
    } catch (err) {
      console.error('[Review] Failed loading review queue:', err);
      this.queue = [];
      this.stageState = 'completed';
    } finally {
      this._isLoading = false;
      this.updateDom();
    }
  }

  async openDeckSettings() {
    const deck = this.getPreferredDeck();
    try {
      const [settingsData, decksData, statsData] = await Promise.all([
        this.sendApiRequest('/api/review/settings', { query: { deck_name: deck } }).catch(() => ({ values: {}, explanations: {} })),
        this.sendApiRequest('/api/review/decks').catch(() => ({ decks: [deck] })),
        this.sendApiRequest('/api/review/stats', { query: { deck_name: deck } }).catch(() => ({}))
      ]);

      const availableDecks = (decksData?.decks && decksData.decks.length) ? decksData.decks : [deck];
      const modal = new ReviewSettingsModal({
        currentDeck: availableDecks.includes(deck) ? deck : availableDecks[0],
        availableDecks: availableDecks,
        buriedCount: statsData?.buried_count || 0,
        values: settingsData?.values || {},
        explanations: settingsData?.explanations || {},
        onSave: async (updatedValues) => {
          await this.sendApiRequest('/api/review/settings', {
            method: 'PUT',
            body: { deck_name: modal.currentDeck || deck, ...updatedValues }
          });
          await this.loadOverviewData();
          this.updateOverviewCounters();
        },
        onDeckChange: async (newDeck) => {
          try {
            localStorage.setItem('kiroku:selected-deck', newDeck);
          } catch (_) {}
          const [newSet, newStat] = await Promise.all([
            this.sendApiRequest('/api/review/settings', { query: { deck_name: newDeck } }).catch(() => ({ values: {} })),
            this.sendApiRequest('/api/review/stats', { query: { deck_name: newDeck } }).catch(() => ({}))
          ]);
          await this.loadOverviewData();
          this.updateOverviewCounters();
          return { values: newSet?.values || {}, buriedCount: newStat?.buried_count || 0 };
        },
        onCreateDeck: async (deckName) => {
          const res = await this.sendApiRequest('/api/review/decks/create', {
            method: 'POST',
            body: { deck_name: deckName }
          });
          await this.loadOverviewData();
          this.updateOverviewCounters();
          return res;
        },
        onUnbury: async (targetDeck) => {
          const res = await this.sendApiRequest('/api/review/unbury', {
            method: 'POST',
            body: { deck_name: targetDeck }
          });
          await this.loadOverviewData();
          this.updateOverviewCounters();
          return res;
        },
        onSyncAnki: async (targetDeck) => {
          const res = await this.sendApiRequest('/api/review/sync-anki', {
            method: 'POST',
            body: { deck_name: targetDeck }
          });
          await this.loadOverviewData();
          this.updateOverviewCounters();
          return res;
        }
      });
      modal.mount(document.body);
    } catch (err) {
      console.error('[Review] Failed to open deck settings:', err);
    }
  }

  async bury() {
    if (this._isBusy) return;
    const card = this.currentCard();
    if (!card) return;
    this._isBusy = true;
    const cardId = card.id || card.card_id;
    try {
      if (this.onBury) {
        await this.onBury(cardId);
      } else {
        await this.sendApiRequest('/api/review/bury', { method: 'POST', body: { card_id: cardId } });
      }
    } catch (err) {
      console.error('Failed burying card:', err);
    }
    this.showToast('Card buried until tomorrow');
    setTimeout(() => {
      this.currentIndex++;
      this.isFlipped = false;
      this.startTime = Date.now();
      if (this.currentIndex >= this.queue.length) {
        this.stageState = 'completed';
        if (this.onFinish) this.onFinish();
      }
      this._isBusy = false;
      this.updateDom();
    }, 200);
  }

  async suspend() {
    if (this._isBusy) return;
    const card = this.currentCard();
    if (!card) return;
    this._isBusy = true;
    const cardId = card.id || card.card_id;
    try {
      if (this.onSuspend) {
        await this.onSuspend(cardId);
      } else {
        await this.sendApiRequest('/api/review/suspend', { method: 'POST', body: { card_id: cardId } });
      }
    } catch (err) {
      console.error('Failed suspending card:', err);
    }
    this.showToast('Card suspended');
    setTimeout(() => {
      this.currentIndex++;
      this.isFlipped = false;
      this.startTime = Date.now();
      if (this.currentIndex >= this.queue.length) {
        this.stageState = 'completed';
        if (this.onFinish) this.onFinish();
      }
      this._isBusy = false;
      this.updateDom();
    }, 200);
  }

  async undo() {
    if (this._isBusy || this.currentIndex === 0) return;
    this._isBusy = true;
    try {
      if (this.onUndo) {
        await this.onUndo();
      } else {
        await this.sendApiRequest('/api/review/undo', { method: 'POST' });
      }
      this.showToast('Review undone');
      setTimeout(() => {
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        this.isFlipped = false;
        this.startTime = Date.now();
        this._isBusy = false;
        this.updateDom();
      }, 200);
    } catch (_) {
      this._isBusy = false;
    }
  }

  flip() {
    if (this.isFlipped) return;
    this.isFlipped = true;
    this.updateDom();
  }

  async grade(rating) {
    if (this._isBusy) return;
    const card = this.currentCard();
    if (!card) return;
    this._isBusy = true;

    const durationMs = this.startTime ? Date.now() - this.startTime : 1000;
    const cardId = card.id || card.card_id;

    try {
      if (this.onGrade) {
        await this.onGrade(cardId, rating, durationMs);
      } else {
        await this.sendApiRequest('/api/review/answer', {
          method: 'POST',
          body: { card_id: cardId, rating, duration_ms: durationMs }
        });
      }
    } catch (err) {
      console.error('Failed submitting grade:', err);
    }

    this.currentIndex++;
    this.isFlipped = false;
    this.startTime = Date.now();

    if (this.currentIndex >= this.queue.length) {
      this.stageState = 'completed';
      if (this.onFinish) this.onFinish();
    }

    this._isBusy = false;
    this.updateDom();
  }

  playAudio() {
    const card = this.currentCard();
    if (!card || !card.audio) return;
    try {
      let audioUrl = card.audio;
      if (!audioUrl.startsWith('data:') && !audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
        const base = this.apiBase || 'http://127.0.0.1:21828';
        audioUrl = `${base}/api/media/${encodeURIComponent(audioUrl)}`;
      }
      const audio = new Audio(audioUrl);
      audio.play().catch((err) => {
        console.warn('Audio playback prevented or failed:', err);
      });
    } catch (_) {}
  }

  exit() {
    this.destroy();
    if (this.router && typeof this.router.navigateToTab === 'function') {
      this.router.navigateToTab('home');
    }
  }

  renderOverviewStage() {
    const stats = this.deckStats;
    const studiedText = stats.total_studied_today > 0
      ? `Studied ${stats.total_studied_today} cards in ${stats.studied_seconds_today} seconds today (${stats.seconds_per_card}s/card)`
      : `No cards studied yet today.`;

    return `
      <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
        <div class="review-player-topbar">
          <div class="topbar-left">
            <button type="button" class="player-back-btn font-mono" id="btn-player-back" title="Back to Home (Esc)">
              &larr; Home
            </button>
            <div class="review-deck-badge font-mono">${stats.deck_name}</div>
          </div>
          <div class="topbar-actions">
            <button type="button" class="player-action-btn btn-settings" id="btn-overview-settings" title="FSRS & Anki Deck Options">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Deck Options</span>
            </button>
          </div>
        </div>

        <div class="brutalist-card review-overview-card">
          <div class="deck-stats-table-wrap">
            <table class="deck-overview-table">
              <thead>
                <tr>
                  <th class="col-deck">Deck</th>
                  <th class="col-new">New</th>
                  <th class="col-learn">Learn</th>
                  <th class="col-due">Due</th>
                </tr>
              </thead>
              <tbody>
                <tr class="deck-row-active">
                  <td class="cell-deck">${stats.deck_name}</td>
                  <td class="cell-new font-mono"><span class="animata-counter count-new" data-target="${stats.new_count}">0</span></td>
                  <td class="cell-learn font-mono"><span class="animata-counter count-learn" data-target="${stats.learn_count}">0</span></td>
                  <td class="cell-due font-mono"><span class="animata-counter count-due" data-target="${stats.due_count}">0</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="deck-studied-summary font-sans">
            ${studiedText}
          </div>

          <div class="deck-overview-actions">
            <button type="button" class="brutalist-btn btn-study-now" id="btn-study-now">
              <span>Study Now</span>
              <kbd class="key-badge">Space</kbd>
            </button>
          </div>
        </div>
      </div>
    `.trim();
  }

  renderReviewingStage() {
    const card = this.currentCard();
    if (!card) return this.renderCompletedStage();

    const intervals = card.intervals || {
      again: '<10m',
      hard: '1d',
      good: '3d',
      easy: '6d'
    };

    const progressStr = `${this.currentIndex + 1} / ${this.queue.length}`;
    const expr = card.expression || '';
    const reading = card.reading || '';
    const meaning = card.meaning || '';
    const sentence = card.example_sentence || '';
    const hasImage = Boolean(card.image);
    const hasAudio = Boolean(card.audio);

    let imageHtml = '';
    if (hasImage) {
      let imgSrc = card.image;
      if (typeof imgSrc === 'string' && imgSrc.includes('<img')) {
        const match = imgSrc.match(/src=["']([^"']+)["']/i);
        if (match) imgSrc = match[1];
      }
      if (!imgSrc.startsWith('data:') && !imgSrc.startsWith('http://') && !imgSrc.startsWith('https://')) {
        const base = this.apiBase || 'http://127.0.0.1:21828';
        imgSrc = `${base}/api/media/${encodeURIComponent(imgSrc)}`;
      }
      imageHtml = `
        <div class="card-media-frame">
          <img src="${imgSrc}" alt="Visual context cue" class="card-screenshot" />
        </div>
      `;
    }

    let sentenceHtml = '';
    if (sentence) {
      let highlighted = sentence;
      if (expr) {
        highlighted = highlighted.replaceAll(expr, `<mark class="sentence-target">${expr}</mark>`);
      }
      sentenceHtml = `<div class="card-sentence-wrap">${highlighted}</div>`;
    }

    return `
      <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
        <div class="player-toast-banner font-mono" id="player-toast-banner" style="display: none;"></div>
        <div class="review-player-topbar">
          <div class="topbar-left">
            <button type="button" class="player-back-btn font-mono" id="btn-player-back" title="Back to Deck Overview (Esc)">
              &larr; Overview
            </button>
            <div class="review-deck-badge font-mono">${card.deck_name || this.getPreferredDeck()}</div>
            <div class="review-progress-counter font-mono">${progressStr}</div>
          </div>
          <div class="topbar-actions">
            <button type="button" class="player-action-btn btn-undo" id="btn-player-undo" title="Undo Last Review (Z)" ${this.currentIndex === 0 ? 'disabled' : ''}>
              <span>Undo</span> <kbd class="key-hint font-mono">Z</kbd>
            </button>
            <button type="button" class="player-action-btn btn-bury" id="btn-player-bury" title="Bury Card Until Tomorrow (B)">
              <span>Bury</span> <kbd class="key-hint font-mono">B</kbd>
            </button>
            <button type="button" class="player-action-btn btn-suspend" id="btn-player-suspend" title="Suspend Card Indefinitely (S)">
              <span>Suspend</span> <kbd class="key-hint font-mono">S</kbd>
            </button>
            <button class="review-close-btn" type="button" id="btn-player-close" aria-label="Close reviewer">&times;</button>
          </div>
        </div>

        <div class="brutalist-card review-card ${this.isFlipped ? 'card-flipped' : ''}">
          ${imageHtml}

          <div class="card-content-area">
            <div class="card-expression">${expr}</div>

            ${this.isFlipped ? `
              <div class="card-back-details">
                ${reading && reading !== expr ? `<div class="card-reading">${reading}</div>` : ''}
                <div class="card-meaning">${meaning}</div>
                ${sentenceHtml}
                ${hasAudio ? `
                  <button class="btn-replay-audio" type="button" title="Replay Audio (R)">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                    <span>Replay Audio</span>
                  </button>
                ` : ''}
              </div>
            ` : ''}
          </div>

          <div class="card-action-footer">
            ${!this.isFlipped ? `
              <button class="brutalist-btn btn-show-answer" type="button" id="btn-show-answer">
                <span>Show Answer</span>
                <kbd class="key-badge">Space</kbd>
              </button>
            ` : `
              <div class="grading-buttons-grid">
                <button class="grade-btn grade-again" type="button" data-grade="1">
                  <span class="grade-label">Again</span>
                  <span class="grade-ivl">${intervals.again || '<10m'}</span>
                  <kbd class="grade-key">1</kbd>
                </button>
                <button class="grade-btn grade-hard" type="button" data-grade="2">
                  <span class="grade-label">Hard</span>
                  <span class="grade-ivl">${intervals.hard || '1d'}</span>
                  <kbd class="grade-key">2</kbd>
                </button>
                <button class="grade-btn grade-good" type="button" data-grade="3">
                  <span class="grade-label">Good</span>
                  <span class="grade-ivl">${intervals.good || '3d'}</span>
                  <kbd class="grade-key">3</kbd>
                </button>
                <button class="grade-btn grade-easy" type="button" data-grade="4">
                  <span class="grade-label">Easy</span>
                  <span class="grade-ivl">${intervals.easy || '6d'}</span>
                  <kbd class="grade-key">4</kbd>
                </button>
              </div>
            `}
          </div>
        </div>
      </div>
    `.trim();
  }

  renderCompletedStage() {
    return `
      <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
        <div class="brutalist-card review-finished-card">
          <h2 class="finished-title">Reviews Complete</h2>
          <p class="finished-desc">You have reviewed all cards currently due in this session.</p>
          <div class="completed-actions-row">
            <button class="brutalist-btn btn-finish" type="button" id="review-exit-btn">Return to Home</button>
            <button class="player-action-btn btn-back-overview" type="button" id="btn-back-overview">Deck Overview</button>
          </div>
        </div>
      </div>
    `.trim();
  }

  render() {
    if (this._isLoading) {
      return `
        <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
          <div class="brutalist-card review-finished-card">
            <h2 class="finished-title">Loading Reviews...</h2>
            <p class="finished-desc">Connecting to deck repository and synchronizing FSRS parameters.</p>
          </div>
        </div>
      `.trim();
    }

    if (this.stageState === 'overview') {
      return this.renderOverviewStage();
    }
    if (this.stageState === 'completed' || (!this.queue || this.queue.length === 0)) {
      return this.renderCompletedStage();
    }
    return this.renderReviewingStage();
  }

  updateOverviewCounters() {
    if (!this.element) return;
    const stats = this.deckStats;
    const cellDeck = this.element.querySelector('.cell-deck');
    if (cellDeck) cellDeck.textContent = stats.deck_name;

    const badgeDeck = this.element.querySelector('.review-deck-badge');
    if (badgeDeck) badgeDeck.textContent = stats.deck_name;

    const summaryEl = this.element.querySelector('.deck-studied-summary');
    if (summaryEl) {
      summaryEl.textContent = stats.total_studied_today > 0
        ? `Studied ${stats.total_studied_today} cards in ${stats.studied_seconds_today} seconds today (${stats.seconds_per_card}s/card)`
        : `No cards studied yet today.`;
    }

    const cNew = this.element.querySelector('.count-new');
    if (cNew) {
      cNew.setAttribute('data-target', stats.new_count);
      animateCounter(cNew, stats.new_count, 750);
    }

    const cLearn = this.element.querySelector('.count-learn');
    if (cLearn) {
      cLearn.setAttribute('data-target', stats.learn_count);
      animateCounter(cLearn, stats.learn_count, 750);
    }

    const cDue = this.element.querySelector('.count-due');
    if (cDue) {
      cDue.setAttribute('data-target', stats.due_count);
      animateCounter(cDue, stats.due_count, 750);
    }
  }

  triggerCounterAnimations() {
    if (!this.element) return;
    const counters = this.element.querySelectorAll('.animata-counter');
    counters.forEach((el) => {
      const target = parseInt(el.getAttribute('data-target'), 10) || 0;
      animateCounter(el, target, 750);
    });
  }

  onShow() {
    if (this.stageState === 'overview' && this.router) {
      this.loadOverviewData().then(() => {
        this.updateOverviewCounters();
      });
    }
  }

  async mount(container = document.body) {
    if (typeof document === 'undefined') return;
    this.container = container;
    this.destroy();

    // Render immediately so screen transition from Home is instantaneous (0ms)
    this.updateDom();

    // Load fresh stats in background and smoothly roll up numbers once received
    if (this.stageState === 'overview' && this.router) {
      this.loadOverviewData().then(() => {
        this.updateOverviewCounters();
      });
    }
  }

  updateDom() {
    if (!this.container && !this.element) return;
    const scrollY = typeof window !== 'undefined' ? (window.scrollY || 0) : 0;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.render();
    const newEl = wrapper.firstElementChild;

    if (this.element && this.element.parentNode) {
      this.element.parentNode.replaceChild(newEl, this.element);
    } else if (this.container) {
      this.container.innerHTML = '';
      this.container.appendChild(newEl);
    }
    this.element = newEl;

    this.bindEvents();
    if (this.stageState === 'overview') {
      this.triggerCounterAnimations();
    }
    if (typeof window !== 'undefined') {
      window.scrollTo(0, scrollY);
    }
  }

  bindEvents() {
    if (!this.element) return;

    // Overview Stage triggers
    const studyNowBtn = this.element.querySelector('#btn-study-now');
    if (studyNowBtn) {
      studyNowBtn.addEventListener('click', () => this.startStudySession());
    }

    const overviewSettingsBtn = this.element.querySelector('#btn-overview-settings');
    if (overviewSettingsBtn) {
      overviewSettingsBtn.addEventListener('click', () => this.openDeckSettings());
    }

    const backOverviewBtn = this.element.querySelector('#btn-back-overview');
    if (backOverviewBtn) {
      backOverviewBtn.addEventListener('click', () => {
        this.stageState = 'overview';
        this.loadOverviewData().then(() => this.updateDom());
      });
    }

    // Review Stage triggers
    const showBtn = this.element.querySelector('#btn-show-answer');
    if (showBtn) {
      showBtn.addEventListener('click', () => this.flip());
    }

    const replayBtn = this.element.querySelector('.btn-replay-audio');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => this.playAudio());
    }

    const backBtn = this.element.querySelector('#btn-player-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.stageState === 'reviewing') {
          this.stageState = 'overview';
          this.loadOverviewData().then(() => this.updateDom());
        } else {
          this.exit();
        }
      });
    }

    const closeBtn = this.element.querySelector('#btn-player-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.exit());
    }

    const exitBtn = this.element.querySelector('#review-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => this.exit());
    }

    const undoBtn = this.element.querySelector('#btn-player-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undo());
    }

    const buryBtn = this.element.querySelector('#btn-player-bury');
    if (buryBtn) {
      buryBtn.addEventListener('click', () => this.bury());
    }

    const suspendBtn = this.element.querySelector('#btn-player-suspend');
    if (suspendBtn) {
      suspendBtn.addEventListener('click', () => this.suspend());
    }

    const gradeBtns = this.element.querySelectorAll('.grade-btn');
    gradeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const grade = parseInt(btn.getAttribute('data-grade'), 10);
        this.grade(grade);
      });
    });

    if (!this.boundKeyHandler && typeof window !== 'undefined') {
      this.boundKeyHandler = (e) => this.handleKeyDown(e);
      window.addEventListener('keydown', this.boundKeyHandler);
    }
  }

  handleKeyDown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (this.stageState === 'overview') {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        this.startStudySession();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.exit();
      }
      return;
    }

    if (this.stageState === 'completed' || !this.currentCard()) {
      if (e.code === 'Space' || e.key === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        this.exit();
      }
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.isFlipped) {
        this.flip();
      } else {
        this.grade(3);
      }
    } else if (e.key === '1' && this.isFlipped) {
      e.preventDefault();
      this.grade(1);
    } else if (e.key === '2' && this.isFlipped) {
      e.preventDefault();
      this.grade(2);
    } else if (e.key === '3' && this.isFlipped) {
      e.preventDefault();
      this.grade(3);
    } else if (e.key === '4' && this.isFlipped) {
      e.preventDefault();
      this.grade(4);
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      this.playAudio();
    } else if (e.code === 'KeyB') {
      e.preventDefault();
      this.bury();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      this.suspend();
    } else if (e.code === 'KeyZ') {
      e.preventDefault();
      if (this.currentIndex > 0) {
        this.undo();
      }
    } else if (e.code === 'Escape') {
      e.preventDefault();
      this.stageState = 'overview';
      this.loadOverviewData().then(() => this.updateDom());
    }
  }

  destroy() {
    if (typeof window !== 'undefined' && this.boundKeyHandler) {
      window.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
    if (this.element && this.element.parentNode && this.element.parentNode !== this.container) {
      this.element.remove();
    }
    this.element = null;
  }
}
