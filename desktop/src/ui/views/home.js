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

import { mountRiveMascot } from '../rive_mascot.js';

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
    this.jumpTimeout = null;
    this.riveMascot = null;
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

            <div class="mascot-stage" id="mascot-stage" aria-label="Kiroku study companion" role="button" tabindex="0" title="Click companion to interact">
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

          <!-- Hero Brand Wordmark & Interactive Float Zone -->
          <div class="home-right-zone" id="home-right-zone">
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
    const speechBubble = document.getElementById('speech-bubble');
    const dailyWordStamp = document.getElementById('daily-word-stamp');

    // Mascot companion click reaction and greeting rotation
    if (mascotStage && mascotWrap) {
      const handleMascotClick = () => {
        this.rotateGreeting();
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
