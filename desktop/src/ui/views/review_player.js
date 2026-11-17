/**
 * Neo-Brutalist Review Player View Component
 * Handles front/back flashcard presentation, keyboard navigation, audio playback,
 * and 4-grade FSRS scheduling submissions.
 */

export class ReviewPlayer {
  constructor({ queue = [], onGrade = null, onBury = null, onSuspend = null, onUndo = null, onFinish = null, apiBase = '' } = {}) {
    this.queue = queue;
    this.currentIndex = 0;
    this.isFlipped = false;
    this.startTime = null;
    this.onGrade = onGrade;
    this.onBury = onBury;
    this.onSuspend = onSuspend;
    this.onUndo = onUndo;
    this.onFinish = onFinish;
    this.apiBase = apiBase;
    this.element = null;
    this.boundKeyHandler = null;
    this._toastTimer = null;
    this._isBusy = false;
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
          const res = await this.onUndo();
          if (res && res.status === 'ok') {
            if (this.currentIndex > 0) {
              this.currentIndex--;
            }
            this.isFlipped = false;
            this.startTime = Date.now();
            this.showToast('Review undone');
            this.updateDom();
            return;
          }
        } catch (err) {
          console.error('Failed undoing review:', err);
          this.showToast('Cannot undo');
        }
      } else if (this.currentIndex > 0) {
        this.currentIndex--;
        this.isFlipped = false;
        this.startTime = Date.now();
        this.showToast('Review undone');
        this.updateDom();
      }
    } finally {
      this._isBusy = false;
    }
  }

  flip() {
    this.isFlipped = true;
    this.playAudio();
    this.updateDom();
  }

  async grade(rating) {
    if (this._isBusy) return;
    const card = this.currentCard();
    if (!card) return;

    this._isBusy = true;
    try {
      const durationMs = this.startTime ? Date.now() - this.startTime : 1000;
      const cardId = card.id || card.card_id;

      if (this.onGrade) {
        try {
          await this.onGrade(cardId, rating, durationMs);
        } catch (err) {
          console.error('Failed submitting review grade:', err);
        }
      }

      this.currentIndex++;
      this.isFlipped = false;
      this.startTime = Date.now();

      if (this.currentIndex >= this.queue.length) {
        if (this.onFinish) {
          this.onFinish();
        }
        this.updateDom();
      } else {
        this.updateDom();
      }
    } finally {
      this._isBusy = false;
    }
  }

  playAudio() {
    const card = this.currentCard();
    if (!card || !card.audio || typeof Audio === 'undefined') return;

    try {
      let src = card.audio;
      if (!src.startsWith('data:') && !src.startsWith('http')) {
        src = `${this.apiBase}/api/media/${src}`;
      }
      const audioObj = new Audio(src);
      audioObj.play().catch(() => {});
    } catch (_) {}
  }

  render() {
    const card = this.currentCard();
    if (!card) {
      return `
        <div class="review-player-overlay" id="review-player-overlay">
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
      if (!imgSrc.startsWith('data:') && !imgSrc.startsWith('http')) {
        imgSrc = `${this.apiBase}/api/media/${imgSrc}`;
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
      <div class="review-player-overlay" id="review-player-overlay">
        <div class="player-toast-banner font-mono" id="player-toast-banner" style="display: none;"></div>
        <div class="review-player-topbar">
          <div class="topbar-left">
            <div class="review-deck-badge font-mono">${card.deck_name || 'Default'}</div>
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
            <button class="review-close-btn" type="button" aria-label="Close reviewer">&times;</button>
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

  mount(container = document.body) {
    if (typeof document === 'undefined') return;
    this.startTime = Date.now();
    this.destroy();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.render();
    this.element = wrapper.firstElementChild;
    container.appendChild(this.element);

    this.bindEvents();
  }

  updateDom() {
    if (!this.element || !this.element.parentNode) return;
    const parent = this.element.parentNode;
    const scrollY = window.scrollY || 0;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.render();
    const newEl = wrapper.firstElementChild;
    parent.replaceChild(newEl, this.element);
    this.element = newEl;

    this.bindEvents();
    window.scrollTo(0, scrollY);
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

    const closeBtn = this.element.querySelector('.review-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.destroy());
    }

    const exitBtn = this.element.querySelector('#review-exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => this.destroy());
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
    gradeBtns.forEach(btn => {
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
    // Guard against input typing
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    if (!this.currentCard()) {
      if (e.code === 'Space' || e.key === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        this.destroy();
      }
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.isFlipped) {
        this.flip();
      } else {
        this.grade(3); // Default Good
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
      this.destroy();
    }
  }

  destroy() {
    if (typeof window !== 'undefined' && this.boundKeyHandler) {
      window.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
    const el = document.getElementById('review-player-overlay');
    if (el) el.remove();
    this.element = null;
  }
}
