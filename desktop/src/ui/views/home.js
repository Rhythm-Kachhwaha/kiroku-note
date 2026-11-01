/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Expressive Editorial + Mascot Companion Landing View (Zero Fake Data).
 *
 * Displays:
 * 1. Zen Old Mincho rotating Japanese greetings in an asymmetric comic speech bubble.
 * 2. Authentic svg_cat.svg mascot on an organic tilted tactile stage with pupil/head tracking.
 * 3. Curated deterministic daily Japanese vocabulary item with JLPT badge linking to Vocab desk.
 * 4. Spacious minimalist quick launcher action stamps to study desks.
 */

const ROTATING_GREETINGS = [
  { ja: 'おはよう', en: 'ohayou — good morning, traveler.' },
  { ja: 'こんにちは', en: 'konnichiwa — good afternoon, traveler.' },
  { ja: 'おかえり', en: 'okaeri — welcome back, traveler.' },
  { ja: '今夜も勉強？', en: 'konya mo benkyou? — studying late tonight?' },
  { ja: '毎日の積み重ね', en: 'mainichi no tsumikasane — daily steady progress builds mastery.' },
  { ja: '一歩一歩進もう', en: 'ippo ippo susumou — let us step forward together one word at a time.' }
];

const CURATED_DAILY_WORDS = [
  {
    kanji: '木漏れ日',
    reading: 'こもれび',
    romaji: 'komorebi',
    meaning: 'Sunlight filtering through trees',
    jlpt: 'N2',
    category: 'Nature & Poetics'
  },
  {
    kanji: '風情',
    reading: 'ふぜい',
    romaji: 'fuzei',
    meaning: 'Taste, elegance, charm, aesthetic atmosphere',
    jlpt: 'N1',
    category: 'Aesthetics'
  },
  {
    kanji: '一期一会',
    reading: 'いちごいちえ',
    romaji: 'ichigo ichie',
    meaning: 'Once-in-a-lifetime encounter; cherish every moment',
    jlpt: 'N1',
    category: 'Proverb & Zen'
  },
  {
    kanji: '雨宿り',
    reading: 'あまやどり',
    romaji: 'amayadori',
    meaning: 'Sheltering from the rain',
    jlpt: 'N3',
    category: 'Daily Life'
  },
  {
    kanji: '陽だまり',
    reading: 'ひだまり',
    romaji: 'hidamari',
    meaning: 'Sunny spot, warm pocket of sunshine',
    jlpt: 'N2',
    category: 'Warmth'
  },
  {
    kanji: '浮世',
    reading: 'うきよ',
    romaji: 'ukiyo',
    meaning: 'Floating world, fleeting transient life',
    jlpt: 'N1',
    category: 'Culture & Art'
  },
  {
    kanji: '心づくし',
    reading: 'こころづくし',
    romaji: 'kokorozukushi',
    meaning: 'Heartfelt kindness, thorough consideration',
    jlpt: 'N1',
    category: 'Virtue'
  }
];

export class HomeView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.greetingIndex = null;
    this.mouseMoveHandler = null;
    this.mouseLeaveHandler = null;
  }

  getDefaultGreetingIndex() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 0;
    if (hour >= 11 && hour < 17) return 1;
    if (hour >= 17 && hour < 22) return 2;
    return 3;
  }

  getGreeting(index = null) {
    if (typeof index === 'number') {
      return ROTATING_GREETINGS[Math.abs(index) % ROTATING_GREETINGS.length];
    }
    const idx = (this.greetingIndex !== undefined && this.greetingIndex !== null)
      ? this.greetingIndex
      : this.getDefaultGreetingIndex();
    return ROTATING_GREETINGS[idx % ROTATING_GREETINGS.length];
  }

  getDailyWord(date = new Date()) {
    const d = new Date(date);
    const dayTimestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayIndex = Math.floor(dayTimestamp / 86400000);
    const index = Math.abs(dayIndex) % CURATED_DAILY_WORDS.length;
    return CURATED_DAILY_WORDS[index];
  }

  rotateGreeting() {
    if (this.greetingIndex === null || this.greetingIndex === undefined) {
      this.greetingIndex = this.getDefaultGreetingIndex();
    }
    this.greetingIndex = (this.greetingIndex + 1) % ROTATING_GREETINGS.length;
    const greeting = this.getGreeting(this.greetingIndex);
    const jaEl = this.container?.querySelector('.speech-greeting-ja');
    const enEl = this.container?.querySelector('.speech-subtitle-en');
    if (jaEl) jaEl.textContent = greeting.ja;
    if (enEl) enEl.textContent = greeting.en;
  }

  async mount(container) {
    this.container = container;
    const greeting = this.getGreeting();
    const dailyWord = this.getDailyWord();

    this.container.innerHTML = `
      <div class="home-view-wrapper">
        <div class="home-view-container">
          <!-- Mascot & Dialogue Zone (Left Zone) -->
          <div class="home-left-zone">
            <!-- Warm Lit Ambient Glow Behind Mascot -->
            <div class="mascot-ambient-glow" aria-hidden="true"></div>

            <!-- Manga Speech Burst Dialogue -->
            <div class="comic-speech-bubble" id="speech-bubble" role="button" tabindex="0" title="Click to rotate greeting">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja font-display">${greeting.ja}</span>
                  <span class="speech-rotation-hint font-mono text-muted" aria-hidden="true">click to rotate</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Mascot Stage: Authentic Static svg_cat.svg with Organic Tilted Backing Shape -->
            <div class="mascot-stage" id="mascot-stage" role="button" tabindex="0" title="Click for mascot reaction & greeting rotation">
              <div class="organic-shape-backing" aria-hidden="true"></div>
              <div class="mascot-stamp-badge font-mono">Kiroku Note</div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <img
                  id="home-mascot-cat"
                  src="./ui/assets/mascot/svg_cat.svg"
                  class="home-cat-img"
                  alt="Kiroku Note Cat Mascot"
                />
              </div>
            </div>

            <!-- Curated Daily Japanese Word Stamp -->
            <div class="home-daily-word daily-vocab-stamp tactile-card tactile-card-interactive" id="daily-word-stamp" role="button" tabindex="0" title="Click to open Vocabulary Desk">
              <div class="daily-word-top-row">
                <div class="daily-word-badges">
                  <span class="daily-word-pill-jlpt tactile-pill tactile-pill-vermilion">${dailyWord.jlpt}</span>
                  <span class="daily-word-cat-label font-mono">${dailyWord.category}</span>
                </div>
                <span class="daily-word-stamp-action font-mono text-muted">Open in Vocab &rarr;</span>
              </div>
              <div class="daily-word-content">
                <div class="daily-word-glyph-line">
                  <ruby class="daily-word-kanji font-display">${dailyWord.kanji}<rt class="daily-word-reading font-japanese">${dailyWord.reading}</rt></ruby>
                  <span class="daily-word-romaji font-mono text-muted">${dailyWord.romaji}</span>
                </div>
                <div class="daily-word-gloss font-japanese">${dailyWord.meaning}</div>
              </div>
            </div>
          </div>

          <!-- Quick Navigation Launcher Zone (Right Zone) -->
          <div class="home-right-zone">
            <div class="home-actions-header">
              <div class="home-header-badge-row">
                <span class="tactile-pill tactile-pill-gold">STUDY COMPANION</span>
              </div>
              <h1 class="home-actions-title font-display">Japanese Desks</h1>
              <p class="home-actions-subtitle text-secondary">Select an authentic study desk to begin your session. Zero fabricated streaks or fake metrics.</p>
            </div>

            <div class="home-action-grid">
              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="vocab" role="button" tabindex="0" title="Open Vocabulary Desk">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Vocabulary Desk</div>
                  <div class="home-action-card-desc font-sans">Search JMdict dictionary, mine vocabulary cards, and annotate paragraphs.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="grammar" role="button" tabindex="0" title="Open Grammar Studio">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Grammar Studio</div>
                  <div class="home-action-card-desc font-sans">Sentence patterns, formation rules, and syllabus progression.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="kanji" role="button" tabindex="0" title="Open Kanji Tracer">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Kanji Tracer</div>
                  <div class="home-action-card-desc font-sans">KanjiVG animated stroke orders, stroke playback, and compound mining.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="study" role="button" tabindex="0" title="Open Practice Drills">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Practice Drills</div>
                  <div class="home-action-card-desc font-sans">Targeted question drills with adaptive repetition scheduling.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="test" role="button" tabindex="0" title="Open Examination">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">JLPT Examination</div>
                  <div class="home-action-card-desc font-sans">Simulated official test blocks with section countdown timers.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="settings" role="button" tabindex="0" title="Open Settings & Diagnostics">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Settings & Diagnostics</div>
                  <div class="home-action-card-desc font-sans">Universal JLPT level, AnkiConnect, OCR daemon, and doctor.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEvents();
  }

  setupEvents() {
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    const speechBubble = document.getElementById('speech-bubble');
    const dailyWordStamp = document.getElementById('daily-word-stamp');

    // Mascot reaction: jump animation & greeting rotation
    if (mascotStage && mascotWrap) {
      const handleMascotClick = () => {
        this.rotateGreeting();
        mascotWrap.style.transform = 'translateY(-14px) scale(1.05)';
        setTimeout(() => {
          mascotWrap.style.transform = 'translateY(0) scale(1)';
        }, 180);
      };

      mascotStage.addEventListener('click', handleMascotClick);
      mascotStage.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleMascotClick();
        }
      });
    }

    // Speech bubble click also rotates greeting
    if (speechBubble) {
      speechBubble.addEventListener('click', () => {
        this.rotateGreeting();
      });
      speechBubble.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.rotateGreeting();
        }
      });
    }

    // Daily word stamp navigation to Vocab desk
    if (dailyWordStamp) {
      const navigateVocab = () => {
        this.router.navigateToTab('vocab');
      };
      dailyWordStamp.addEventListener('click', navigateVocab);
      dailyWordStamp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigateVocab();
        }
      });
    }

    // Subtle pupil / head tracking on mousemove
    if (mascotStage && mascotWrap && typeof window !== 'undefined') {
      this.mouseMoveHandler = (e) => {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          return;
        }
        const rect = mascotStage.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = (e.clientX - centerX) / (window.innerWidth / 2 || 1);
        const deltaY = (e.clientY - centerY) / (window.innerHeight / 2 || 1);
        const clampedX = Math.max(-1, Math.min(1, deltaX));
        const clampedY = Math.max(-1, Math.min(1, deltaY));
        const tiltX = -clampedY * 4;
        const tiltY = clampedX * 5;
        const moveX = clampedX * 4;
        const moveY = clampedY * 3;
        mascotWrap.style.transform = `perspective(600px) rotateX(${tiltX.toFixed(1)}deg) rotateY(${tiltY.toFixed(1)}deg) translate(${moveX.toFixed(1)}px, ${moveY.toFixed(1)}px)`;
      };

      this.mouseLeaveHandler = () => {
        mascotWrap.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) translate(0px, 0px)';
      };

      window.addEventListener('mousemove', this.mouseMoveHandler);
      mascotStage.addEventListener('mouseleave', this.mouseLeaveHandler);
    }

    // Action cards navigation
    const actionCards = this.container.querySelectorAll('.home-action-card');
    actionCards.forEach(card => {
      const tab = card.dataset.tab;
      if (!tab) return;

      const navigate = () => {
        this.router.navigateToTab(tab);
      };

      card.addEventListener('click', navigate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate();
        }
      });
    });
  }

  unmount() {
    if (this.mouseMoveHandler && typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
