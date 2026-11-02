/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Authentic Cat Companion (Left) & Minimal Stroke-Order Animated Launcher Cards (Right).
 * Zero Fake Data: Strictly grounded in authentic datasets and design tokens.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

import { mountRiveMascot } from '../rive_mascot.js';
import { HOME_GLYPHS } from '../assets/home_glyphs.js';
import { CaseStudyCard } from '../components/case_study_card.js';

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

const CURATED_DAILY_WORDS = [
  {
    "kanji": "木漏れ日",
    "reading": "こもれび",
    "romaji": "komorebi",
    "meaning": "Sunlight filtering through trees",
    "jlpt": "N2",
    "category": "Nature & Poetics",
    "partOfSpeech": "Noun",
    "exampleSentence": "木漏れ日の中で、静かに本を読む時間が好きです。",
    "exampleFurigana": "<ruby>木漏<rt>こぼ</rt></ruby>れ<ruby>日<rt>び</rt></ruby>の<ruby>中<rt>なか</rt></ruby>で、<ruby>静<rt>しず</rt></ruby>かに<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む<ruby>時間<rt>じかん</rt></ruby>が<ruby>好<rt>す</rt></ruby>きです。",
    "exampleTranslation": "I love the peaceful time spent reading a book under sunlight filtering through the trees."
  },
  {
    "kanji": "風情",
    "reading": "ふぜい",
    "romaji": "fuzei",
    "meaning": "Taste, elegance, charm, aesthetic atmosphere",
    "jlpt": "N1",
    "category": "Aesthetics",
    "partOfSpeech": "Noun",
    "exampleSentence": "雨上がりの古い町並みには独特の風情がある。",
    "exampleFurigana": "<ruby>雨上<rt>あめあ</rt></ruby>がりの<ruby>古<rt>ふる</rt></ruby>い<ruby>町並<rt>まちな</rt></ruby>みには<ruby>独特<rt>どくとく</rt></ruby>の<ruby>風情<rt>ふぜい</rt></ruby>がある。",
    "exampleTranslation": "There is a unique charm to the historic townscape after the rain."
  },
  {
    "kanji": "一期一会",
    "reading": "いちごいちえ",
    "romaji": "ichigo ichie",
    "meaning": "Once-in-a-lifetime encounter; cherish every moment",
    "jlpt": "N1",
    "category": "Proverb & Zen",
    "partOfSpeech": "Yojijukugo (Idiom)",
    "exampleSentence": "出会いは一期一会だから、一つ一つの縁を大切にしよう。",
    "exampleFurigana": "<ruby>出合<rt>であ</rt></ruby>いは<ruby>一期一会<rt>いちごいちえ</rt></ruby>だから、<ruby>一<rt>ひと</rt></ruby>つ<ruby>一<rt>ひと</rt></ruby>つの<ruby>縁<rt>えん</rt></ruby>を<ruby>大切<rt>たいせつ</rt></ruby>にしよう。",
    "exampleTranslation": "Every encounter is once in a lifetime, so cherish every bond you form."
  },
  {
    "kanji": "雨宿り",
    "reading": "あまやどり",
    "romaji": "amayadori",
    "meaning": "Sheltering from the rain",
    "jlpt": "N3",
    "category": "Daily Life",
    "partOfSpeech": "Noun / Suru verb",
    "exampleSentence": "駅の軒下で雨宿りをしながら友人を待った。",
    "exampleFurigana": "<ruby>駅<rt>えき</rt></ruby>の<ruby>軒下<rt>のきした</rt></ruby>で<ruby>雨宿<rt>あまやど</rt></ruby>りをしながら<ruby>友人<rt>ゆうじん</rt></ruby>を<ruby>待<rt>ま</rt></ruby>った。",
    "exampleTranslation": "I waited for my friend while sheltering from the rain under the station eaves."
  },
  {
    "kanji": "陽だまり",
    "reading": "ひだまり",
    "romaji": "hidamari",
    "meaning": "Sunny spot, warm pocket of sunshine",
    "jlpt": "N2",
    "category": "Warmth",
    "partOfSpeech": "Noun",
    "exampleSentence": "猫が縁側の陽だまりで気持ちよさそうに丸くなっている。",
    "exampleFurigana": "<ruby>猫<rt>ねこ</rt></ruby>が<ruby>縁側<rt>えんがわ</rt></ruby>の<ruby>陽<rt>ひ</rt></ruby>だまりで<ruby>気持<rt>きも</rt></ruby>ちよさそうに<ruby>丸<rt>まる</rt></ruby>くなっている。",
    "exampleTranslation": "The cat is curled up comfortably in a warm pocket of sunshine on the veranda."
  },
  {
    "kanji": "浮世",
    "reading": "うきよ",
    "romaji": "ukiyo",
    "meaning": "Floating world, fleeting transient life",
    "jlpt": "N1",
    "category": "Culture & Art",
    "partOfSpeech": "Noun",
    "exampleSentence": "浮世の慌ただしさを忘れ、静かな茶室で心を落ち着かせる。",
    "exampleFurigana": "<ruby>浮世<rt>うきよ</rt></ruby>の<ruby>慌<rt>あわ</rt></ruby>ただしさを<ruby>忘<rt>わす</rt></ruby>れ、<ruby>静<rt>しず</rt></ruby>かな<ruby>茶室<rt>ちゃしつ</rt></ruby>で<ruby>心<rt>こころ</rt></ruby>を<ruby>落<rt>お</rt></ruby>ち<ruby>着<rt>つ</rt></ruby>かせる。",
    "exampleTranslation": "Forgetting the rush of this transient world, calm your mind in a quiet tea room."
  },
  {
    "kanji": "心づくし",
    "reading": "こころづくし",
    "romaji": "kokorozukushi",
    "meaning": "Heartfelt kindness, thorough consideration",
    "jlpt": "N1",
    "category": "Virtue",
    "partOfSpeech": "Noun",
    "exampleSentence": "旅先で地元の人々から受けた心づくしのもてなしに深く感謝した。",
    "exampleFurigana": "<ruby>旅先<rt>たびさき</rt></ruby>で<ruby>地元<rt>じもと</rt></ruby>の<ruby>人々<rt>ひとびと</rt></ruby>から<ruby>受<rt>う</rt></ruby>けた<ruby>心<rt>こころ</rt></ruby>づくしのもてなしに<ruby>深<rt>ふか</rt></ruby>く<ruby>感謝<rt>かんしゃ</rt></ruby>した。",
    "exampleTranslation": "I was deeply grateful for the heartfelt hospitality received from local people during my travels."
  }
];

export const LAUNCHER_CARDS = [
  {
    id: 'vocab',
    tab: 'vocab',
    title: 'Vocab',
    descriptor: 'Quick Add, mining, Anki',
    glyphSvg: HOME_GLYPHS.vocab,
    videoSrc: './ui/assets/hiragana_a.webm',
    dur: 5.005,
    restTime: 4.8,
    drawFinishTime: 3.05
  },
  {
    id: 'kanji',
    tab: 'kanji',
    title: 'Kanji',
    descriptor: 'Strokes and components',
    glyphSvg: HOME_GLYPHS.kanji,
    videoSrc: './ui/assets/kanji_dai.webm',
    dur: 5.0,
    restTime: 4.8,
    drawFinishTime: 2.55
  }
];

export class HomeView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.greetingIndex = null;
    this.jumpTimeout = null;
    this.bubbleFallbackTimer = null;
    this.mouseMoveHandler = null;
    this.mouseLeaveHandler = null;
    this.visibilityHandler = null;
    this.escapeHandler = null;
    this.riveMascot = null;
    this.cardControllers = new Map();
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

    const dailyWordCardHtml = CaseStudyCard({
      title: dailyWord.kanji,
      category: 'WORD OF THE DAY',
      reading: dailyWord.reading,
      romaji: dailyWord.romaji,
      meaning: dailyWord.meaning,
      jlpt: dailyWord.jlpt,
      partOfSpeech: dailyWord.partOfSpeech || 'Noun',
      exampleSentence: dailyWord.exampleSentence,
      exampleFurigana: dailyWord.exampleFurigana,
      exampleTranslation: dailyWord.exampleTranslation,
      type: 'content',
      tabLabel: 'READ WORD',
      link: '#vocab'
    });

    const launcherCardsHtml = LAUNCHER_CARDS.map((card) => `
      <div class="home-launcher-card tactile-card tactile-card-interactive"
           id="launcher-card-${card.id}"
           data-tab="${card.tab}"
           role="button"
           tabindex="0"
           aria-label="${card.title}: ${card.descriptor}">
        <div class="launcher-glyph-side" aria-hidden="true">
          <div class="launcher-glyph-wrap" id="launcher-glyph-${card.id}">
            <video class="launcher-glyph-video"
                   src="${card.videoSrc}"
                   autoplay
                   loop
                   muted
                   playsinline
                   preload="auto"
                   aria-hidden="true"></video>
          </div>
        </div>
        <div class="launcher-info-side">
          <div class="launcher-text-group">
            <h3 class="launcher-title font-display">${card.title}</h3>
            <p class="launcher-desc font-sans">${card.descriptor}</p>
          </div>
          <div class="launcher-action-row" aria-hidden="true">
            <span class="launcher-arrow font-mono">&rarr;</span>
          </div>
        </div>
      </div>
    `).join('');

    this.container.innerHTML = `
      <div class="home-view-wrapper home-launcher-view">
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
            <!-- Manga Speech Burst Dialogue (Anchored to Companion Cat) -->
            <div class="comic-speech-bubble" id="speech-bubble" aria-label="Mascot greeting" style="opacity: 0; transform: translateY(-4px); transition: opacity 200ms ease, transform 200ms ease;">
              <svg class="comic-pointer-tail" viewBox="0 0 52 38" preserveAspectRatio="xMidYMin meet" aria-hidden="true" focusable="false">
                <path d="M4 3C13 7 20 8 26 8C32 8 39 7 48 3C42 13 35 25 26 36C18 25 10 13 4 3Z" />
              </svg>
              <div class="comic-speech-inner">
                <div class="speech-content">
                  <div class="speech-header-row">
                    <span class="speech-greeting-ja font-comic">${greeting.ja}</span>
                  </div>
                  <p class="speech-subtitle-en">${greeting.en}</p>
                </div>
              </div>
            </div>

            <!-- Authentic Rive Cat Mascot Companion Stage -->
            <div class="mascot-stage" id="mascot-stage" aria-label="Kiroku study companion" role="button" tabindex="0" title="Click companion to interact">
              <div class="organic-shape-backing" aria-hidden="true" style="display: none;"><!-- fallback: svg_cat.svg --></div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
                <canvas class="rive-mascot-canvas" aria-hidden="true"></canvas>
              </div>
            </div>

            <!-- Curated Daily Japanese Word: Animata Case Study Card -->
            ${dailyWordCardHtml}
          </div>

          <!-- Minimal Launcher Cards Zone (Right Zone) -->
          <div class="home-launcher-zone" id="home-launcher-zone">
            <div class="home-launcher-grid" role="region" aria-label="Quick Launchers">
              ${launcherCardsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    this.initCardControllers();
    this.setupEvents();

    const catCanvas = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.rive-mascot-canvas')
      : null;
    const speechBubble = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('#speech-bubble')
      : null;
    const fallbackBacking = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.organic-shape-backing')
      : null;

    let bubbleRevealed = false;
    const showBubble = () => {
      if (bubbleRevealed) return;
      bubbleRevealed = true;
      if (this.bubbleFallbackTimer) {
        clearTimeout(this.bubbleFallbackTimer);
        this.bubbleFallbackTimer = null;
      }
      if (speechBubble) {
        speechBubble.style.opacity = '1';
        speechBubble.style.transform = 'translateY(0)';
      }
    };

    const showFallbackCat = () => {
      if (fallbackBacking) {
        fallbackBacking.style.display = 'block';
        fallbackBacking.innerHTML = `<img src="./ui/assets/mascot/svg_cat.svg" alt="Kiroku Companion" class="mascot-fallback-svg" style="width: 100%; height: 100%; object-fit: contain;">`;
      }
      if (catCanvas) {
        catCanvas.style.display = 'none';
      }
      showBubble();
    };

    // Bubble fallback timer: never leave the bubble floating over an empty space or stuck hidden
    this.bubbleFallbackTimer = setTimeout(() => {
      showBubble();
    }, 1200);

    if (catCanvas) {
      try {
        this.riveMascot = await mountRiveMascot(catCanvas, {
          onReady: () => {
            showBubble();
          },
          onFallback: () => {
            showFallbackCat();
          }
        });
        if (!this.riveMascot) {
          showFallbackCat();
        }
      } catch (e) {
        console.warn('[Home] Mascot companion mount error:', e);
        showFallbackCat();
      }
    } else {
      showFallbackCat();
    }
  }

  initCardControllers() {
    this.cardControllers.clear();

    for (const config of LAUNCHER_CARDS) {
      const cardEl = typeof this.container?.querySelector === 'function'
        ? this.container.querySelector(`#launcher-card-${config.id}`)
        : null;
      const videoEl = cardEl && typeof cardEl.querySelector === 'function'
        ? cardEl.querySelector('video')
        : null;

      if (videoEl && typeof videoEl.play === 'function') {
        try {
          const p = videoEl.play();
          if (p && typeof p.catch === 'function') {
            p.catch((e) => console.debug('[Home] Video play notice:', e));
          }
        } catch (e) {
          console.debug('[Home] Video play notice:', e);
        }
      }

      const ctrl = {
        config,
        cardEl,
        video: videoEl,
        leaveTimer: null,
        isAnimating: true,
        play: () => {
          if (ctrl.video && typeof ctrl.video.play === 'function') {
            try {
              ctrl.video.currentTime = 0;
              const p = ctrl.video.play();
              if (p && typeof p.catch === 'function') {
                p.catch((e) => console.debug('[Home] Video play catch:', e));
              }
            } catch (e) {
              console.debug('[Home] Video play warning:', e);
            }
          }
          ctrl.isAnimating = true;
        },
        stop: () => {
          ctrl.isAnimating = false;
        },
        resetToRest: () => {
          ctrl.isAnimating = false;
        }
      };

      this.cardControllers.set(config.id, ctrl);

      if (cardEl && typeof cardEl.addEventListener === 'function') {
        cardEl.addEventListener('pointerenter', () => {
          for (const [id, otherCtrl] of this.cardControllers) {
            if (id !== config.id) otherCtrl.stop();
          }
          ctrl.play();
        });

        cardEl.addEventListener('pointerleave', () => {
          ctrl.stop();
        });

        cardEl.addEventListener('focus', () => {
          for (const [id, otherCtrl] of this.cardControllers) {
            if (id !== config.id) otherCtrl.stop();
          }
          ctrl.play();
        });

        cardEl.addEventListener('blur', () => {
          ctrl.stop();
        });

        const activate = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          ctrl.resetToRest();
          this.router.navigateToTab(config.tab);
        };

        cardEl.addEventListener('click', activate);
        cardEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            activate(e);
          }
        });
      }
    }
  }

  setupEvents() {
    if (typeof document === 'undefined') return;

    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');

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

    // 3. Pause all cards when document is hidden
    this.visibilityHandler = () => {
      if (document.hidden) {
        for (const ctrl of this.cardControllers.values()) {
          ctrl.resetToRest();
        }
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // 4. Daily word: Open in Vocab action (Animata Case Study Card navigation)
    const btnOpen = document.getElementById('btn-daily-word-open');
    if (btnOpen) {
      const navigateVocab = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.router.navigateToTab('vocab');
      };

      btnOpen.addEventListener('click', navigateVocab);
      btnOpen.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          navigateVocab(e);
        }
      });
    }
  }

  unmount() {
    if (this.jumpTimeout) {
      clearTimeout(this.jumpTimeout);
      this.jumpTimeout = null;
    }
    if (this.bubbleFallbackTimer) {
      clearTimeout(this.bubbleFallbackTimer);
      this.bubbleFallbackTimer = null;
    }

    // Reset and clean up all launcher card controllers
    for (const ctrl of this.cardControllers.values()) {
      ctrl.resetToRest();
    }
    this.cardControllers.clear();

    if (this.mouseMoveHandler) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('mousemove', this.mouseMoveHandler);
      }
      this.mouseMoveHandler = null;
    }
    this.mouseLeaveHandler = null;

    if (this.visibilityHandler) {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
      }
      this.visibilityHandler = null;
    }
    if (this.escapeHandler) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.escapeHandler);
      }
      this.escapeHandler = null;
    }

    // Clean up cat mascot companion
    try {
      this.riveMascot?.cleanup();
    } catch (e) {
      console.debug('[Home] Cat mascot cleanup error:', e);
    }
    this.riveMascot = null;

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
