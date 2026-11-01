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
    this.mascotPointerFrame = null;
    this.mascotPointerPosition = null;
    this.jumpTimeout = null;
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

            <!-- Mascot Stage: opaque portrait field with cursor-tracking pupils -->
            <div class="mascot-stage" id="mascot-stage" role="button" tabindex="0" title="Click for mascot reaction & greeting rotation">
              <div class="organic-shape-backing" aria-hidden="true"></div>
              <div class="mascot-stamp-badge font-mono">Kiroku Note</div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <div class="mascot-portrait-field">
                  <img
                    id="home-mascot-cat"
                    src="./ui/assets/mascot/svg_cat.svg"
                    class="home-cat-img"
                    alt="Kiroku Note Cat Mascot"
                  />
                  <div class="mascot-eyes" aria-hidden="true">
                    <span class="mascot-eye mascot-eye-left"><span class="mascot-pupil"></span></span>
                    <span class="mascot-eye mascot-eye-right"><span class="mascot-pupil"></span></span>
                  </div>
                </div>
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
        mascotWrap.classList.add('is-reacting');
        if (this.jumpTimeout) {
          clearTimeout(this.jumpTimeout);
        }
        this.jumpTimeout = setTimeout(() => {
          mascotWrap.classList.remove('is-reacting');
          this.jumpTimeout = null;
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

    // Keep the mascot's gaze with the pointer without moving the layout.
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
        this.mascotPointerPosition = { x: clampedX, y: clampedY };
        if (this.mascotPointerFrame !== null) return;

        this.mascotPointerFrame = window.requestAnimationFrame(() => {
          const position = this.mascotPointerPosition;
          this.mascotPointerFrame = null;
          if (!position) return;
          mascotWrap.classList.add('is-tracking');
          mascotWrap.style.setProperty('--mascot-tilt-x', `${(-position.y * 3).toFixed(1)}deg`);
          mascotWrap.style.setProperty('--mascot-tilt-y', `${(position.x * 4).toFixed(1)}deg`);
          mascotWrap.style.setProperty('--mascot-shift-x', `${(position.x * 3).toFixed(1)}px`);
          mascotWrap.style.setProperty('--mascot-shift-y', `${(position.y * 2).toFixed(1)}px`);
          mascotWrap.style.setProperty('--pupil-x', `${(position.x * 4.5).toFixed(1)}px`);
          mascotWrap.style.setProperty('--pupil-y', `${(position.y * 3.5).toFixed(1)}px`);
        });
      };

      this.mouseLeaveHandler = () => {
        this.mascotPointerPosition = null;
        mascotWrap.classList.remove('is-tracking');
        ['--mascot-tilt-x', '--mascot-tilt-y', '--mascot-shift-x', '--mascot-shift-y', '--pupil-x', '--pupil-y']
          .forEach(property => mascotWrap.style.removeProperty(property));
      };

      window.addEventListener('pointermove', this.mouseMoveHandler, { passive: true });
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
    if (this.jumpTimeout) {
      clearTimeout(this.jumpTimeout);
      this.jumpTimeout = null;
    }
    if (this.mouseMoveHandler && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    if (this.mascotPointerFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.mascotPointerFrame);
      this.mascotPointerFrame = null;
    }
    this.mascotPointerPosition = null;
    this.mouseLeaveHandler = null;
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
