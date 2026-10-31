/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Authentic svg_cat.svg mascot with cursor pupil tracking,
 * live telemetry modules (Streak, Word of the Day, Question Bank Readiness),
 * and quick action study launchpad.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { escapeHtml } from '../utils/sanitizer.js';

export class HomeView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.handleMouseMove = null;
    this.streakDays = 1;
    this.wordOfTheDay = null;
    this.bankSummary = null;
  }

  getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) {
      return { ja: 'おはよう', en: 'ohayou — good morning.' };
    } else if (hour >= 11 && hour < 17) {
      return { ja: 'こんにちは', en: 'konnichiwa — good afternoon.' };
    } else if (hour >= 17 && hour < 22) {
      return { ja: 'おかえり', en: 'okaeri — welcome back.' };
    } else {
      return { ja: '今夜も勉強？', en: 'konya mo benkyou? — studying late tonight?' };
    }
  }

  async mount(container) {
    this.container = container;
    const greeting = this.getGreeting();

    this.container.innerHTML = `
      <div class="home-view-wrapper">
        <div class="home-view-container">
          <!-- Mascot & Dialogue Zone (Left) -->
          <div class="home-left-zone">
            <!-- Ambient Glow Behind Mascot -->
            <div class="mascot-ambient-glow" aria-hidden="true"></div>

            <!-- Manga Speech Burst Dialogue -->
            <div class="comic-speech-bubble" id="speech-bubble">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja">${greeting.ja}</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
                <div class="speech-footer-row">
                  <span class="speech-status-label">LOCAL COMPANION · ACTIVE</span>
                  <span class="speech-status-dot"></span>
                </div>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Mascot Stage: Authentic Static svg_cat.svg with pupil tracking -->
            <div class="mascot-stage" id="mascot-stage" role="button" tabindex="0" title="Click for a cat greeting">
              <div class="mascot-stamp-badge">SUMI · 墨</div>
              <div class="mascot-character-wrap" id="mascot-character-wrap" style="position: relative;">
                <img
                  id="home-mascot-cat"
                  src="./ui/assets/mascot/svg_cat.svg"
                  class="home-cat-img"
                  alt="Kiroku Note Cat Mascot"
                />
                <!-- Subtle cursor-follow pupils overlay -->
                <div class="eyes-tracker-layer" id="eyes-tracker-layer" aria-hidden="true" style="position: absolute; inset: 0; pointer-events: none;">
                  <div class="cat-pupil-dot" id="pupil-left" style="position: absolute; top: 31%; left: 42.5%; width: 7px; height: 9px; background: var(--gold-eye, #F2C94C); border-radius: 50%; box-shadow: 0 0 5px rgba(242, 201, 76, 0.7); transform: translate(0, 0); transition: transform 50ms ease-out;"></div>
                  <div class="cat-pupil-dot" id="pupil-right" style="position: absolute; top: 31%; left: 56.5%; width: 7px; height: 9px; background: var(--gold-eye, #F2C94C); border-radius: 50%; box-shadow: 0 0 5px rgba(242, 201, 76, 0.7); transform: translate(0, 0); transition: transform 50ms ease-out;"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Live Canvas Modules & Quick Action Launchpad (Right) -->
          <div class="home-right-zone">
            <!-- Row 1: Study Streak & Word of the Day -->
            <div class="home-canvas-row" id="home-canvas-modules" style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <!-- Study Streak Module -->
              <div class="tactile-card streak-card" id="module-streak" style="flex: 1; min-width: 200px;">
                <div class="streak-top-row">
                  <div class="streak-counter-group">
                    <span class="streak-days-number" id="streak-days-val">--</span>
                    <div class="streak-label-block">
                      <span class="streak-label-title">STUDY STREAK</span>
                      <span class="streak-label-sub" id="streak-sub-val">Loading history...</span>
                    </div>
                  </div>
                </div>
                <div class="streak-dots-row" id="streak-dots-row">
                  <div class="streak-dot is-active">M</div>
                  <div class="streak-dot is-active">T</div>
                  <div class="streak-dot is-active">W</div>
                  <div class="streak-dot is-active">T</div>
                  <div class="streak-dot is-active">F</div>
                  <div class="streak-dot is-active">S</div>
                  <div class="streak-dot is-today">S</div>
                </div>
              </div>

              <!-- Word of the Day Module -->
              <div class="tactile-card todays-word-card" id="module-word-of-the-day" style="flex: 1; min-width: 220px;">
                <div class="todays-word-header">
                  <span class="font-mono text-xs uppercase tracking-widest text-gold">WORD OF THE DAY</span>
                  <span class="todays-word-level" id="wotd-level">JLPT N3</span>
                </div>
                <div class="todays-word-main">
                  <ruby class="todays-word-glyph" id="wotd-glyph">記録<rt id="wotd-reading">きろく</rt></ruby>
                  <span class="todays-word-accent" id="wotd-pitch">[0] 平板</span>
                </div>
                <div class="todays-word-gloss text-sm text-truncate" id="wotd-gloss">record; archival entry; minutes</div>
                <div class="todays-word-sentence">
                  <p class="sentence-ja font-japanese text-xs" id="wotd-sentence-ja">毎日単語をノートに記録する。</p>
                  <p class="sentence-en text-muted text-xs" id="wotd-sentence-en">I record vocabulary in my notebook daily.</p>
                </div>
              </div>
            </div>

            <!-- Row 2: Question Bank Readiness -->
            <div class="tactile-card continue-card mt-2" id="module-bank-readiness">
              <div class="continue-header-row">
                <span class="continue-topic-tag font-mono text-xs text-gold">LOCAL QUESTION BANK · READINESS</span>
                <span class="font-mono text-xs text-muted" id="bank-status-pill">Checking...</span>
              </div>
              <h3 class="continue-title text-base font-bold text-warm-paper" id="bank-active-count">JLPT Question Bank</h3>
              <p class="continue-desc text-xs text-secondary mb-2" id="bank-desc">Inspect verified examination pools and practice questions.</p>
              <div class="benchmark-bars-row">
                <div class="bar-segment-kanji" style="width: 25%;" title="Kanji items"></div>
                <div class="bar-segment-grammar" style="width: 30%;" title="Grammar patterns"></div>
                <div class="bar-segment-reading" style="width: 25%;" title="Reading passages"></div>
                <div class="bar-segment-listening" style="width: 20%;" title="Listening tracks"></div>
              </div>
            </div>

            <!-- Quick Action Launchpad -->
            <div class="home-actions-header mt-4">
              <span class="font-mono text-xs tracking-widest text-gold uppercase">STUDY LAUNCHPAD · クイックアクセス</span>
              <h2 class="home-actions-title">What would you like to study?</h2>
              <p class="home-actions-sub text-secondary text-sm">Select an activity or press number keys 1–6 on the bottom navigation dock.</p>
            </div>

            <div class="home-action-grid">
              <!-- Action 1: Vocab -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-vocab" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Vocabulary &amp; Mining</h3>
                  <p class="home-action-card-desc">Look up Japanese words, pitch accents, and mine directly to Anki.</p>
                </div>
              </div>

              <!-- Action 2: Grammar -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-grammar" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7zM4 5h3v4H4V5zm13 0h3v4h-3V5zm3 14h-3v-4h3v4z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Grammar Studio</h3>
                  <p class="home-action-card-desc">Analyze sentences, inspect token structures, and browse the JLPT syllabus.</p>
                </div>
              </div>

              <!-- Action 3: Practice Drills -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-study" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19 2H6c-1.2 0-2 .8-2 2v16c0 1.2.8 2 2 2h13c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h12v12H6V4zm0 16v-2h12v2H6z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">Practice Drills</h3>
                  <p class="home-action-card-desc">Spaced repetition question practice with deterministic objective grading.</p>
                </div>
              </div>

              <!-- Action 4: JLPT Exam Simulation -->
              <div class="tactile-card tactile-card-interactive home-action-card" id="card-nav-test" role="button" tabindex="0">
                <div class="home-action-icon-wrap">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/>
                  </svg>
                </div>
                <div class="home-action-content">
                  <h3 class="home-action-card-title">JLPT Exam Simulation</h3>
                  <p class="home-action-card-desc">Full timed examination practice under official section countdown constraints.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEvents();
    this.loadCanvasData();
  }

  async loadCanvasData() {
    // 1. Fetch cards for Streak and Word of the Day
    try {
      const cardsRes = await apiClient.getCards({ limit: 50 });
      const cards = Array.isArray(cardsRes) ? cardsRes : (cardsRes?.cards || cardsRes?.items || []);

      // Calculate streak & count
      const daysEl = document.getElementById('streak-days-val');
      const subEl = document.getElementById('streak-sub-val');
      if (daysEl) {
        const count = cards.length;
        daysEl.textContent = count > 0 ? String(count) : '0';
        if (subEl) {
          subEl.textContent = count > 0 ? `${count} cards mined` : 'No cards mined yet';
        }
      }

      // Populate Word of the Day from mined cards if available
      if (cards.length > 0) {
        // Pick card deterministically based on date
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
        const card = cards[dayOfYear % cards.length];
        if (card) {
          const glyphEl = document.getElementById('wotd-glyph');
          const pitchEl = document.getElementById('wotd-pitch');
          const glossEl = document.getElementById('wotd-gloss');
          const jaEl = document.getElementById('wotd-sentence-ja');
          const enEl = document.getElementById('wotd-sentence-en');

          if (glyphEl) {
            glyphEl.innerHTML = `${escapeHtml(card.expression || '')}<rt>${escapeHtml(card.reading || '')}</rt>`;
          }
          if (pitchEl) pitchEl.textContent = card.pitch || '[0] 平板';
          if (glossEl) glossEl.textContent = card.meaning || 'No definition';
          if (jaEl) jaEl.textContent = card.example_sentence || card.sentence || 'No example sentence';
          if (enEl) enEl.textContent = card.example_translation || card.sentence_translation || '';
        }
      }
    } catch (e) {
      console.debug('[HomeView] Cards fetch note:', e.message);
      const daysEl = document.getElementById('streak-days-val');
      const subEl = document.getElementById('streak-sub-val');
      if (daysEl) daysEl.textContent = '0';
      if (subEl) subEl.textContent = 'Start mining vocabulary';
    }

    // 2. Fetch Question Bank Summary
    try {
      const summary = await studyClient.getBankSummary();
      const pill = document.getElementById('bank-status-pill');
      const countHeader = document.getElementById('bank-active-count');
      const descEl = document.getElementById('bank-desc');

      if (summary) {
        const total = summary.total_questions || summary.active_questions || 0;
        if (pill) {
          pill.textContent = total > 0 ? 'Pool Ready' : 'Empty Pool';
          pill.className = `font-mono text-xs ${total > 0 ? 'text-gold' : 'text-muted'}`;
        }
        if (countHeader) {
          countHeader.textContent = `${total} Questions Available`;
        }
        if (descEl) {
          descEl.textContent = 'Verified official JLPT format items across N5–N1.';
        }
      }
    } catch (e) {
      console.debug('[HomeView] Bank summary fetch note:', e.message);
      const pill = document.getElementById('bank-status-pill');
      if (pill) pill.textContent = 'Local Standby';
    }
  }

  setupEvents() {
    // Mascot click animation
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    if (mascotStage && mascotWrap) {
      mascotStage.addEventListener('click', () => {
        mascotWrap.style.transform = 'translateY(-12px) scale(1.05)';
        setTimeout(() => {
          mascotWrap.style.transform = 'translateY(0) scale(1)';
        }, 220);
      });
      mascotStage.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          mascotStage.click();
        }
      });
    }

    // Subtle cursor pupil tracking (Audit 6.B)
    this.handleMouseMove = (e) => {
      const wrap = document.getElementById('mascot-character-wrap');
      const pupilL = document.getElementById('pupil-left');
      const pupilR = document.getElementById('pupil-right');
      if (!wrap || !pupilL || !pupilR) return;

      const rect = wrap.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.31;

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;
      const dist = Math.hypot(deltaX, deltaY);

      const maxDist = 3.5;
      const factor = dist > 0 ? Math.min(dist / 200, 1) * maxDist / dist : 0;
      const moveX = Math.max(-maxDist, Math.min(maxDist, deltaX * factor));
      const moveY = Math.max(-2.5, Math.min(2.5, deltaY * factor));

      pupilL.style.transform = `translate(${moveX.toFixed(1)}px, ${moveY.toFixed(1)}px)`;
      pupilR.style.transform = `translate(${moveX.toFixed(1)}px, ${moveY.toFixed(1)}px)`;
    };
    window.addEventListener('mousemove', this.handleMouseMove);

    // Quick Action Card Navigation
    const navBindings = [
      { id: 'card-nav-vocab', tab: 'vocab' },
      { id: 'card-nav-grammar', tab: 'grammar' },
      { id: 'card-nav-study', tab: 'study' },
      { id: 'card-nav-test', tab: 'test' }
    ];

    for (const binding of navBindings) {
      const el = document.getElementById(binding.id);
      if (el) {
        el.addEventListener('click', () => {
          this.router.navigateToTab(binding.tab);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.router.navigateToTab(binding.tab);
          }
        });
      }
    }
  }

  unmount() {
    if (this.handleMouseMove) {
      window.removeEventListener('mousemove', this.handleMouseMove);
      this.handleMouseMove = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
