/**
 * Neo-Brutalist Review Player / Screen View Component
 * Handles front/back flashcard presentation, keyboard navigation, audio playback,
 * image context rendering, and 4-grade FSRS scheduling submissions.
 * Supports both standalone component mounting and router view lifecycle.
 */

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

  async bury() {
    if (this._isBusy) return;
    const card = this.currentCard();
    if (!card) return;
    this._isBusy = true;
    const cardId = card.id || card.card_id;
    if (this.onBury) {
      try {
        await this.onBury(cardId);
      } catch (err) {
        console.error('Failed burying card:', err);
      }
    }
    this.showToast('Card buried until tomorrow');
    setTimeout(() => {
      this.currentIndex++;
      this.isFlipped = false;
      this.startTime = Date.now();
      if (this.currentIndex >= this.queue.length && this.onFinish) {
        this.onFinish();
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
    if (this.onSuspend) {
      try {
        await this.onSuspend(cardId);
      } catch (err) {
        console.error('Failed suspending card:', err);
      }
    }
    this.showToast('Card suspended');
    setTimeout(() => {
      this.currentIndex++;
      this.isFlipped = false;
      this.startTime = Date.now();
      if (this.currentIndex >= this.queue.length && this.onFinish) {
        this.onFinish();
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
        try {
          await this.onUndo();
        } catch (err) {
          console.error('Failed undoing review:', err);
        }
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

    if (this.onGrade) {
      try {
        await this.onGrade(cardId, rating, durationMs);
      } catch (err) {
        console.error('Failed submitting grade:', err);
      }
    }

    this.currentIndex++;
    this.isFlipped = false;
    this.startTime = Date.now();

    if (this.currentIndex >= this.queue.length && this.onFinish) {
      this.onFinish();
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

  render() {
    if (this._isLoading) {
      return `
        <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
          <div class="brutalist-card review-finished-card">
            <h2 class="finished-title">Loading Reviews...</h2>
            <p class="finished-desc">Preparing your flashcard queue.</p>
          </div>
        </div>
      `.trim();
    }

    const card = this.currentCard();
    if (!card) {
      return `
        <div class="review-player-overlay review-screen-stage" id="review-player-overlay">
          <div class="brutalist-card review-finished-card">
            <h2 class="finished-title">Reviews Complete</h2>
            <p class="finished-desc">You have reviewed all cards currently due in this session.</p>
            <button class="brutalist-btn btn-finish" type="button" id="review-exit-btn">Return to Home</button>
          </div>
        </div>
      `.trim();
    }

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
            <button type="button" class="player-back-btn font-mono" id="btn-player-back" title="Back to Home (Esc)">
              &larr; Back
            </button>
            <div class="review-deck-badge font-mono">${card.deck_name || 'N3 vocabs'}</div>
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

  async loadQueue() {
    try {
      if (typeof window !== 'undefined' && window.desktopAPI?.getBackendInfo) {
        const info = await window.desktopAPI.getBackendInfo();
        if (info && info.port) {
          this.apiBase = `http://${info.host || '127.0.0.1'}:${info.port}`;
        }
      }
    } catch (_) {}
    if (!this.apiBase) {
      this.apiBase = 'http://127.0.0.1:21828';
    }

    let deck = 'N3 vocabs';
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('kiroku:selected-deck') ||
                       localStorage.getItem('last_used_deck') ||
                       localStorage.getItem('anki_deck');
        if (saved && saved.trim() && saved.trim() !== 'Default') {
          deck = saved.trim();
        }
      }
    } catch (_) {}

    try {
      let data = null;
      if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
        data = await window.desktopAPI.api.request({ path: '/api/review/queue', query: { deck_name: deck } });
      } else {
        const res = await fetch(`${this.apiBase}/api/review/queue?deck_name=${encodeURIComponent(deck)}`);
        data = await res.json();
      }
      this.queue = (data && (data.cards || data.queue)) ? (data.cards || data.queue) : [];
      this.currentIndex = 0;
      this.isFlipped = false;
    } catch (err) {
      console.error('[ReviewScreen] Failed to load review queue:', err);
      this.queue = [];
    }

    if (!this.onGrade) {
      this.onGrade = async (cardId, rating, durationMs) => {
        if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
          return await window.desktopAPI.api.request({
            path: '/api/review/answer',
            method: 'POST',
            body: { card_id: cardId, rating, duration_ms: durationMs }
          });
        }
        return await fetch(`${this.apiBase}/api/review/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_id: cardId, rating, duration_ms: durationMs })
        }).then((r) => r.json());
      };
    }

    if (!this.onBury) {
      this.onBury = async (cardId) => {
        if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
          return await window.desktopAPI.api.request({
            path: '/api/review/bury',
            method: 'POST',
            body: { card_id: cardId }
          });
        }
        return await fetch(`${this.apiBase}/api/review/bury`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_id: cardId })
        }).then((r) => r.json());
      };
    }

    if (!this.onSuspend) {
      this.onSuspend = async (cardId) => {
        if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
          return await window.desktopAPI.api.request({
            path: '/api/review/suspend',
            method: 'POST',
            body: { card_id: cardId }
          });
        }
        return await fetch(`${this.apiBase}/api/review/suspend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_id: cardId })
        }).then((r) => r.json());
      };
    }

    if (!this.onUndo) {
      this.onUndo = async () => {
        if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
          return await window.desktopAPI.api.request({
            path: '/api/review/undo',
            method: 'POST'
          });
        }
        return await fetch(`${this.apiBase}/api/review/undo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).then((r) => r.json());
      };
    }
  }

  async mount(container = document.body) {
    if (typeof document === 'undefined') return;
    this.container = container;
    this.startTime = Date.now();
    this.destroy();

    if ((!this.queue || this.queue.length === 0) && this.router) {
      this._isLoading = true;
      this.updateDom();
      await this.loadQueue();
      this._isLoading = false;
    }

    this.updateDom();
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
    if (typeof window !== 'undefined') {
      window.scrollTo(0, scrollY);
    }
  }

  bindEvents() {
    if (!this.element) return;

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
      backBtn.addEventListener('click', () => this.exit());
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

    if (!this.currentCard()) {
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
      this.exit();
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
