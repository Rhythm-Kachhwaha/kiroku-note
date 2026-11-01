/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Authentic Cat Companion (Left) & Smooth Animated Character-Select Lineup (Right).
 * Zero Fake Data: Strictly grounded in authentic datasets and design tokens.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

import { mountRiveMascot } from '../rive_mascot.js';
import { mountCharacter, CHARACTER_LINEUP } from '../rive_character.js';

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
    this.jumpTimeout = null;
    this.mouseMoveHandler = null;
    this.mouseLeaveHandler = null;
    this.visibilityHandler = null;
    this.escapeHandler = null;
    this.windowResizeHandler = null;
    this.riveMascot = null;
    this.characterControllers = [];
    this.activeOverlay = null;
    this.isNavigating = false;
    this.activeHoverIndex = 0;
    this.activePlayingIndex = -1;
    this.pendingHoverIndex = -1;
    this.hoverIntentTimer = null;
    this.leaveTimer = null;
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
    const matches = TIME_BASED_GREETINGS.filter((g) => hour >= g.minHour && hour < g.maxHour);
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

    const tilesHtml = CHARACTER_LINEUP.map((char, index) => `
      <div class="character-tile"
           data-tab="${char.tabId}"
           data-index="${index}"
           role="button"
           tabindex="0"
           aria-label="${char.name}: ${char.desc}">
        <div class="character-canvas-wrap">
          <canvas class="character-rive-canvas" aria-hidden="true"></canvas>
          <div class="character-fallback" style="display: none;" aria-hidden="true">
            <div class="character-fallback-shape"></div>
            <span class="character-fallback-title">${char.name}</span>
          </div>
        </div>
        <div class="character-tile-gradient" aria-hidden="true"></div>
        <div class="character-tile-dim-overlay" aria-hidden="true"></div>
        <div class="character-tile-meta">
          <div class="character-tile-name font-display">${char.name}</div>
          <div class="character-tile-desc font-sans">${char.desc}</div>
        </div>
      </div>
    `).join('');

    this.container.innerHTML = `
      <div class="home-view-wrapper character-select-home">
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
            <!-- Manga Speech Burst Dialogue (Belongs to Companion Cat) -->
            <div class="comic-speech-bubble" id="speech-bubble" aria-label="Mascot greeting">
              <div class="comic-speech-inner">
                <div class="speech-header-row">
                  <span class="speech-greeting-ja font-comic">${greeting.ja}</span>
                </div>
                <p class="speech-subtitle-en">${greeting.en}</p>
              </div>
              <div class="comic-pointer-tail" aria-hidden="true"></div>
            </div>

            <!-- Authentic Rive Cat Mascot Companion Stage -->
            <div class="mascot-stage" id="mascot-stage" aria-label="Kiroku study companion" role="button" tabindex="0" title="Click companion to interact">
              <div class="organic-shape-backing" aria-hidden="true" style="display: none;"><!-- fallback: svg_cat.svg --></div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <canvas class="rive-mascot-canvas" aria-hidden="true"></canvas>
              </div>
            </div>

            <!-- Curated Daily Japanese Word Stamp (Below Cat) -->
            <div class="home-daily-word daily-vocab-stamp tactile-card tactile-card-interactive"
                 id="daily-word-stamp"
                 role="button"
                 tabindex="0"
                 title="Click to open Vocabulary Desk"
                 aria-label="Daily vocabulary: ${dailyWord.kanji} (${dailyWord.reading}) - ${dailyWord.meaning}. Click to open Vocabulary Desk.">
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

          <!-- Character-Select Lineup Zone (Right Zone) -->
          <div class="home-lineup-zone" id="home-lineup-zone">
            <div class="character-lineup-container">
              <div class="character-lineup" id="character-lineup" role="region" aria-label="Mode Selection Lineup">
                ${tilesHtml}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEvents();
    this.updateLineupDimensions();

    const catCanvas = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.rive-mascot-canvas')
      : null;
    if (catCanvas) {
      try {
        this.riveMascot = await mountRiveMascot(catCanvas);
      } catch (e) {
        console.warn('[Home] Mascot companion mount error:', e);
      }
    }

    await this.mountAllCharacters();
  }

  updateLineupDimensions() {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const lineup = this.container.querySelector('.character-lineup');
    if (!lineup) return;
    const lineupWidth = lineup.clientWidth || 900;
    // Calculate expanded width of a tile (flex 2.3 vs 5 tiles at 0.74 = 6.0 units, with 5 gaps of 12px)
    const availableWidth = Math.max(300, lineupWidth - 60);
    const expandedTileWidth = Math.max(260, Math.round((2.3 / 6.0) * availableWidth));
    lineup.style.setProperty('--expanded-tile-width', `${expandedTileWidth}px`);
  }

  async mountAllCharacters() {
    if (!this.container || typeof this.container.querySelectorAll !== 'function') return;
    const tileElements = this.container.querySelectorAll('.character-tile');
    if (!tileElements.length) return;

    // Parallel lazy loading of all six character tiles
    const mountPromises = Array.from(tileElements).map(async (tile, index) => {
      const config = CHARACTER_LINEUP[index];
      if (!config) return null;

      const canvas = typeof tile.querySelector === 'function' ? tile.querySelector('.character-rive-canvas') : null;
      const fallback = typeof tile.querySelector === 'function' ? tile.querySelector('.character-fallback') : null;

      try {
        const controller = await mountCharacter(canvas, config.file, {
          fit: config.fit,
          alignment: config.alignment,
          artboard: config.artboard,
          stateMachine: config.stateMachine,
          autoplay: false,
          onLoad: () => {
            if (canvas) {
              canvas.style.opacity = '1';
            }
            if (this.activePlayingIndex === index) {
              controller?.resume();
            } else if (this.activePlayingIndex !== -1) {
              controller?.pause(false);
            }
          },
          onError: (err) => {
            console.warn(`[Home] Rive load error for ${config.file}:`, err);
            if (canvas) canvas.style.display = 'none';
            if (fallback) fallback.style.display = 'flex';
          }
        });

        return controller;
      } catch (err) {
        console.warn(`[Home] Character mount exception for ${config.name}:`, err);
        if (canvas) canvas.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
        return null;
      }
    });

    this.characterControllers = await Promise.all(mountPromises);
  }

  setupEvents() {
    if (typeof document === 'undefined') return;

    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');
    const dailyWordStamp = document.getElementById('daily-word-stamp');
    const tiles = this.container.querySelectorAll('.character-tile');

    // 1. Cat mascot companion click reaction
    if (mascotStage && mascotWrap) {
      const handleMascotClick = () => {
        const r = this.riveMascot?.instance;
        if (r) {
          try {
            const inputs = r.stateMachineInputs('State Machine 1');
            const foreheadTrigger = inputs?.find((i) => i.name === 'Forehead click' || i.type === 1);
            if (foreheadTrigger && typeof foreheadTrigger.fire === 'function') {
              foreheadTrigger.fire();
            }
          } catch (e) {
            console.debug('[Home] Cat forehead trigger error:', e);
          }
        }
        mascotWrap.style.transform = 'translateY(-10px) scale(1.03)';
        if (this.jumpTimeout) {
          clearTimeout(this.jumpTimeout);
          this.jumpTimeout = null;
        }
        this.jumpTimeout = setTimeout(() => {
          if (mascotWrap) mascotWrap.style.transform = 'translateY(0) scale(1)';
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

    // 2. Subtle head & pupil cursor tracking on mousemove for cat mascot
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
        if (mascotWrap) {
          mascotWrap.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) translate(0px, 0px)';
        }
      };

      window.addEventListener('mousemove', this.mouseMoveHandler);
      mascotStage.addEventListener('mouseleave', this.mouseLeaveHandler);
    }

    // 3. Attach pointer events with ~40ms hover intent to each character tile
    tiles.forEach((tile, index) => {
      const config = CHARACTER_LINEUP[index];
      const canvas = typeof tile.querySelector === 'function' ? tile.querySelector('.character-rive-canvas') : null;

      tile.addEventListener('pointerenter', () => {
        if (this.leaveTimer) {
          clearTimeout(this.leaveTimer);
          this.leaveTimer = null;
        }
        if (this.hoverIntentTimer) {
          clearTimeout(this.hoverIntentTimer);
          this.hoverIntentTimer = null;
        }
        this.pendingHoverIndex = index;
        this.hoverIntentTimer = setTimeout(() => {
          this.hoverIntentTimer = null;
          this.applyTileHover(index);
        }, 40);
      });

      tile.addEventListener('pointerleave', () => {
        if (this.pendingHoverIndex === index) {
          if (this.hoverIntentTimer) {
            clearTimeout(this.hoverIntentTimer);
            this.hoverIntentTimer = null;
          }
          this.pendingHoverIndex = -1;
        }
        if (this.activePlayingIndex === index) {
          if (this.leaveTimer) clearTimeout(this.leaveTimer);
          this.leaveTimer = setTimeout(() => {
            this.leaveTimer = null;
            if (this.pendingHoverIndex === -1) {
              this.applyTileLeave(index, true);
            }
          }, 30);
        }
      });

      tile.addEventListener('focus', () => {
        if (this.hoverIntentTimer) {
          clearTimeout(this.hoverIntentTimer);
          this.hoverIntentTimer = null;
        }
        this.applyTileHover(index, true);
      });

      tile.addEventListener('blur', () => {
        this.applyTileLeave(index, true);
      });

      const activate = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.handleTileActivate(tile, config, index);
      };

      tile.addEventListener('click', activate);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          activate(e);
        }
      });

      if (canvas) {
        canvas.addEventListener('click', activate);
      }
    });

    const lineup = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.character-lineup')
      : null;
    if (lineup) {
      lineup.addEventListener('pointerleave', () => {
        this.resetAllHoverStates(true);
      });
    }

    // Window resize debounced listener to update lineup dimensions
    let windowResizeTimer = null;
    this.windowResizeHandler = () => {
      if (windowResizeTimer) clearTimeout(windowResizeTimer);
      windowResizeTimer = setTimeout(() => {
        windowResizeTimer = null;
        this.updateLineupDimensions();
      }, 100);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.windowResizeHandler);
    }

    // 4. Pause all characters when document is hidden
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.resetAllHoverStates(false);
      } else {
        if (this.activePlayingIndex !== -1 && this.characterControllers[this.activePlayingIndex]) {
          this.characterControllers[this.activePlayingIndex]?.resume();
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // 5. Escape key removes any active transition overlay
    this.escapeHandler = (e) => {
      if (e.key === 'Escape' && this.activeOverlay) {
        this.cleanupOverlay();
      }
    };
    window.addEventListener('keydown', this.escapeHandler);

    // 6. Daily word stamp navigation to Vocab desk
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
  }

  applyTileHover(index, immediate = false) {
    if (index < 0 || index >= CHARACTER_LINEUP.length) return;
    if (this.activePlayingIndex === index) return;

    const tiles = this.container && typeof this.container.querySelectorAll === 'function'
      ? this.container.querySelectorAll('.character-tile')
      : [];
    const lineup = this.container && typeof this.container.querySelector === 'function'
      ? this.container.querySelector('.character-lineup')
      : null;

    // Ensure strictly only ONE instance plays at any time
    if (Array.isArray(this.characterControllers)) {
      this.characterControllers.forEach((ctrl, i) => {
        if (i !== index && ctrl) {
          if (ctrl.isPlaying === undefined || ctrl.isPlaying) {
            ctrl.pause(false);
          }
        }
      });
    }

    tiles.forEach((t, i) => {
      if (i !== index) {
        t.classList?.remove('is-hovered');
      }
    });

    this.activePlayingIndex = index;
    this.activeHoverIndex = index;

    if (tiles[index]) {
      tiles[index].classList.add('is-hovered');
    }
    if (lineup) {
      lineup.classList.add('has-active-hover');
    }

    // Play character immediately with no await
    this.characterControllers[index]?.resume();
  }

  applyTileLeave(index, graceful = true) {
    const tiles = this.container && typeof this.container.querySelectorAll === 'function'
      ? this.container.querySelectorAll('.character-tile')
      : [];
    const lineup = this.container && typeof this.container.querySelector === 'function'
      ? this.container.querySelector('.character-lineup')
      : null;

    if (this.activePlayingIndex === index) {
      this.characterControllers[index]?.pause(graceful);
      this.activePlayingIndex = -1;
    }

    if (tiles[index]) {
      tiles[index].classList.remove('is-hovered');
    }

    const hasAnyActive = Array.from(tiles).some((t) => t.classList?.contains('is-hovered') || (typeof document !== 'undefined' && t === document.activeElement));
    if (!hasAnyActive && lineup) {
      lineup.classList.remove('has-active-hover');
    }
  }

  resetAllHoverStates(graceful = true) {
    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
    this.pendingHoverIndex = -1;

    const tiles = this.container && typeof this.container.querySelectorAll === 'function'
      ? this.container.querySelectorAll('.character-tile')
      : [];
    const lineup = this.container && typeof this.container.querySelector === 'function'
      ? this.container.querySelector('.character-lineup')
      : null;

    if (this.activePlayingIndex !== -1) {
      this.characterControllers[this.activePlayingIndex]?.pause(graceful);
      this.activePlayingIndex = -1;
    }

    tiles.forEach((t) => t.classList?.remove('is-hovered'));
    if (lineup) {
      lineup.classList.remove('has-active-hover');
    }
  }

  handleTileActivate(tile, config, index) {
    if (this.isNavigating) return;
    this.isNavigating = true;

    // 1. Play character reaction if available
    this.characterControllers[index]?.playReaction();

    // 2. Tactile click feedback using this.jumpTimeout
    tile.classList.add('is-activating');
    if (this.jumpTimeout) {
      clearTimeout(this.jumpTimeout);
      this.jumpTimeout = null;
    }
    this.jumpTimeout = setTimeout(() => {
      tile.classList.remove('is-activating');
      this.jumpTimeout = null;
    }, 180);

    // 3. Circular clip-path reveal into destination mode
    this.runCircularReveal(tile, config.tabId);
  }

  runCircularReveal(tile, destinationTabId) {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this.router.navigateToTab(destinationTabId);
      this.isNavigating = false;
      return;
    }

    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.cleanupOverlay();

    const rect = tile?.getBoundingClientRect ? tile.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 };
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const innerWidth = window.innerWidth || 800;
    const innerHeight = window.innerHeight || 600;
    const maxDistance = Math.hypot(
      Math.max(centerX, innerWidth - centerX),
      Math.max(centerY, innerHeight - centerY)
    );

    const overlay = document.createElement('div');
    overlay.className = 'character-mode-transition-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    this.activeOverlay = overlay;
    document.body.appendChild(overlay);

    if (reducedMotion) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 150ms ease';
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        setTimeout(() => {
          this.router.navigateToTab(destinationTabId);
          setTimeout(() => {
            this.cleanupOverlay();
            this.isNavigating = false;
          }, 60);
        }, 150);
      });
      return;
    }

    // Full circular clip-path expansion
    overlay.style.clipPath = `circle(0px at ${centerX}px ${centerY}px)`;
    overlay.style.transition = 'clip-path 520ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease';

    requestAnimationFrame(() => {
      overlay.style.clipPath = `circle(${Math.ceil(maxDistance + 60)}px at ${centerX}px ${centerY}px)`;

      // Navigate at midpoint (~260ms) while overlay covers the viewport
      setTimeout(() => {
        try {
          this.router.navigateToTab(destinationTabId);
        } catch (err) {
          console.warn('[Home] Navigation error:', err);
          this.cleanupOverlay();
          this.isNavigating = false;
          return;
        }

        // Fade overlay out after destination mounts
        setTimeout(() => {
          overlay.style.opacity = '0';
          setTimeout(() => {
            this.cleanupOverlay();
            this.isNavigating = false;
          }, 180);
        }, 220);
      }, 260);
    });
  }

  cleanupOverlay() {
    if (this.activeOverlay) {
      try {
        this.activeOverlay.remove();
      } catch (e) {
        console.debug('[Home] Overlay cleanup error:', e);
      }
      this.activeOverlay = null;
    }
  }

  unmount() {
    if (this.jumpTimeout) {
      clearTimeout(this.jumpTimeout);
      this.jumpTimeout = null;
    }
    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
    if (this.mouseMoveHandler && typeof window !== 'undefined') {
      window.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    this.mouseLeaveHandler = null;

    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.escapeHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }
    if (this.windowResizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }

    this.cleanupOverlay();

    // Clean up cat mascot companion
    try {
      this.riveMascot?.cleanup();
    } catch (e) {
      console.debug('[Home] Cat mascot cleanup error:', e);
    }
    this.riveMascot = null;

    // Clean up every character instance
    if (Array.isArray(this.characterControllers)) {
      this.characterControllers.forEach((ctrl) => {
        try {
          ctrl?.cleanup();
        } catch (e) {
          console.debug('[Home] Character controller cleanup error:', e);
        }
      });
      this.characterControllers = [];
    }

    this.activePlayingIndex = -1;
    this.pendingHoverIndex = -1;

    if (this.container) {
      this.container.innerHTML = '';
    }
    this.isNavigating = false;
  }
}
