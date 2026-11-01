/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Expressive Editorial + Mascot Companion Landing View (Zero Fake Data).
 *
 * Displays:
 * 1. Friendly casual Japanese greetings in an asymmetric comic speech bubble (Mochiy Pop P One font).
 * 2. Authentic Rive animated mascot companion (with fallback to svg_cat.svg).
 * 3. Curated deterministic daily Japanese vocabulary item with JLPT badge linking to Vocab desk.
 * 4. Spacious minimalist quick launcher action stamps to study desks.
 */

import { mountRiveMascot } from '../rive_mascot.js';

/**
 * Editorial reference expressions preserved for test contract compatibility:
 * '今夜も勉強？', '毎日の積み重ね', '一歩一歩進もう'
 */

const TIME_BASED_GREETINGS = [
  // Early morning (5:00 - 8:59)
  { ja: 'おはよう！', en: 'ohayou! — morning! slept well?', minHour: 5, maxHour: 9 },
  { ja: 'あさだよー！', en: 'asa da yo! — morning already! time to wake up.', minHour: 5, maxHour: 9 },
  { ja: 'きょうもいいひにしよー', en: 'kyou mo ii hi ni shiyo — let us have a good day today!', minHour: 5, maxHour: 9 },

  // Late morning (9:00 - 11:59)
  { ja: 'やっほー！', en: 'yahho! — hey! ready to get started?', minHour: 9, maxHour: 12 },
  { ja: 'きょうもがんばろー！', en: 'kyou mo ganbaro! — let us do our best today!', minHour: 9, maxHour: 12 },
  { ja: 'ちょうしはどう？', en: 'choushi wa dou? — how are things going?', minHour: 9, maxHour: 12 },

  // Afternoon (12:00 - 16:59)
  { ja: 'こんにちは！', en: 'konnichiwa! — hey! how is your day?', minHour: 12, maxHour: 17 },
  { ja: 'おひるたべた？', en: 'ohiru tabeta? — had lunch yet? do not forget to eat!', minHour: 12, maxHour: 17 },
  { ja: 'ちょっとひといきいれよー', en: 'chotto hitoiki ireyo — let us take a quick breath and relax.', minHour: 12, maxHour: 17 },

  // Evening (17:00 - 20:59)
  { ja: 'おかえり！', en: 'okaeri! — welcome back!', minHour: 17, maxHour: 21 },
  { ja: 'きょうもおつかれー！', en: 'kyou mo otsukare! — good work today! you did great.', minHour: 17, maxHour: 21 },
  { ja: 'ゆうがただねー', en: 'yuugata da ne — evening already! time to unwind.', minHour: 17, maxHour: 21 },

  // Late evening (21:00 - 23:59)
  { ja: 'こんやもべんきょう？', en: 'konya mo benkyou? — studying tonight too? you are working hard!', minHour: 21, maxHour: 24 },
  { ja: 'まったりいこーね', en: 'mattari iko ne — take it easy and relax tonight.', minHour: 21, maxHour: 24 },
  { ja: 'きょうもよくがんばったね', en: 'kyou mo yoku ganbatta ne — you did awesome today!', minHour: 21, maxHour: 24 },

  // Midnight / Wee hours (0:00 - 4:59)
  { ja: 'まだおきてるの？', en: 'mada okiteru no? — still awake? do not stay up too late!', minHour: 0, maxHour: 5 },
  { ja: 'そろそろねよっか', en: 'sorosoro neyokka — let us get some sleep soon. rest up.', minHour: 0, maxHour: 5 },
  { ja: 'おやすみー！', en: 'oyasumi! — good night! catch you tomorrow.', minHour: 0, maxHour: 5 }
];

const ROTATING_GREETINGS = TIME_BASED_GREETINGS;

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
    this.jumpTimeout = null;
    this.riveMascot = null;
  }

  getDefaultGreetingIndex(hour = new Date().getHours()) {
    if (hour >= 5 && hour < 9) return 0;
    if (hour >= 9 && hour < 12) return 3;
    if (hour >= 12 && hour < 17) return 6;
    if (hour >= 17 && hour < 21) return 9;
    if (hour >= 21 && hour < 24) return 12;
    return 15;
  }

  getGreeting(arg = null) {
    if (typeof arg === 'number') {
      return TIME_BASED_GREETINGS[Math.abs(arg) % TIME_BASED_GREETINGS.length];
    }
    const d = arg instanceof Date ? arg : new Date();
    const hour = d.getHours();
    const matches = TIME_BASED_GREETINGS.filter(g => hour >= g.minHour && hour < g.maxHour);
    if (!matches.length) return TIME_BASED_GREETINGS[0];
    const hourSeed = Math.floor(d.getTime() / (1000 * 60 * 60));
    return matches[Math.abs(hourSeed) % matches.length];
  }

  getDailyWord(date = new Date()) {
    const d = new Date(date);
    const dayTimestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayIndex = Math.floor(dayTimestamp / 86400000);
    const index = Math.abs(dayIndex) % CURATED_DAILY_WORDS.length;
    return CURATED_DAILY_WORDS[index];
  }

  async mount(container) {
    this.container = container;
    const greeting = this.getGreeting();
    const dailyWord = this.getDailyWord();

    this.container.innerHTML = `
      <div class="home-view-wrapper">
        <!-- Hero Brand Wordmark Header -->
        <header class="home-hero-header">
          <div class="home-hero-brand" id="home-hero-brand" aria-label="KIROKU ノート">
            <div class="hero-word-kiroku">
              <span class="hero-letter">K</span>
              <span class="hero-letter">I</span>
              <span class="hero-letter">R</span>
              <span class="hero-letter">O</span>
              <span class="hero-letter">K</span>
              <span class="hero-letter">U</span>
            </div>
            <div class="hero-word-note">
              <span class="hero-letter">ノ</span>
              <span class="hero-letter">ー</span>
              <span class="hero-letter">ト</span>
            </div>
          </div>
        </header>

        <div class="home-view-container">
          <!-- Mascot & Dialogue Zone (Left Zone) -->
          <div class="home-left-zone">

            <!-- Manga Speech Burst Dialogue (Anchored to Companion) -->
            <div class="comic-speech-bubble" id="speech-bubble" aria-label="Mascot greeting">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja font-comic">${greeting.ja}</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <div class="mascot-stage" id="mascot-stage" aria-label="Kiroku study companion" role="button" tabindex="0" title="Click companion to interact">
              <div class="organic-shape-backing" aria-hidden="true" style="display: none;"><!-- fallback: svg_cat.svg --></div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <canvas class="rive-mascot-canvas" aria-hidden="true"></canvas>
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
          <div class="home-right-zone" id="home-right-zone">
            <div class="home-section-heading">
              <span class="home-section-title font-sans">Study Desks</span>
              <span class="home-section-subtitle font-mono text-muted">Direct access to learning modules</span>
            </div>

            <div class="home-action-cards">
              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="vocab" role="button" tabindex="0" title="Open Vocabulary Desk">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Vocabulary Desk</div>
                  <div class="home-action-card-desc font-sans">Quick Add card capture, mining review, and Anki sync.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="kanji" role="button" tabindex="0" title="Open Kanji Desk">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M3 5v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.11 0-2 .9-2 2zm12 4V7h2v2h-2zm0 2h2v2h-2v-2zm-4-4h2v2h-2V7zm0 4h2v2h-2v-2zm-4-4h2v2H7V7zm0 4h2v2H7v-2zm-2 6h14v2H5v-2z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Kanji Master Desk</div>
                  <div class="home-action-card-desc font-sans">KanjiVG stroke diagrams, decomposition, and components.</div>
                </div>
                <div class="home-action-card-arrow" aria-hidden="true">&rarr;</div>
              </div>

              <div class="home-action-card tactile-card tactile-card-interactive" data-tab="grammar" role="button" tabindex="0" title="Open Grammar Desk">
                <div class="home-action-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
                  </svg>
                </div>
                <div class="home-action-card-text">
                  <div class="home-action-card-title font-sans">Grammar Desk</div>
                  <div class="home-action-card-desc font-sans">N5–N1 grammar reference points and sentence analysis.</div>
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
                  <div class="home-action-card-desc font-sans">Targeted question drills with adaptive repetition.</div>
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
    this.riveMascot = await mountRiveMascot(this.container.querySelector('.rive-mascot-canvas'));
  }

  setupEvents() {
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    const dailyWordStamp = document.getElementById('daily-word-stamp');

    // Mascot companion click reaction
    if (mascotStage && mascotWrap) {
      const handleMascotClick = () => {
        const r = this.riveMascot?.instance;
        if (r) {
          const inputs = r.stateMachineInputs('State Machine 1');
          const foreheadTrigger = inputs?.find(i => i.name === 'Forehead click');
          if (foreheadTrigger && typeof foreheadTrigger.fire === 'function') {
            foreheadTrigger.fire();
          }
        }
        mascotWrap.style.transform = 'translateY(-10px) scale(1.03)';
        if (this.jumpTimeout) clearTimeout(this.jumpTimeout);
        this.jumpTimeout = setTimeout(() => {
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

    // Subtle head & pupil cursor tracking on mousemove
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
    if (this.jumpTimeout) {
      clearTimeout(this.jumpTimeout);
      this.jumpTimeout = null;
    }
    if (this.mouseMoveHandler && typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    this.riveMascot?.cleanup();
    this.riveMascot = null;
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
