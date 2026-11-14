/**
 * Kiroku Note Desktop — Home Screen View Controller
 * Authentic Cat Companion (Left) & Minimal Typographic Launcher (Right).
 * Deterministic Word of the Day with authentic KanjiVG stroke-order write-in.
 * Restored SMIL-animated Hiragana and Kanji stroke-order SVGs.
 *
 * Golden Rule: Zero emojis anywhere across code, UI, or logs.
 */

import { getMascotHost } from '../shell/mascot_host.js';
import { HOME_GLYPHS } from '../assets/home_glyphs.js';

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

export const CURATED_DAILY_WORDS = [
  // Preserved Editorial Words (N1 / N2 / N3) for test contract & rich literature
  {
    kanji: '木漏れ日',
    reading: 'こもれび',
    romaji: 'komorebi',
    meaning: 'Sunlight filtering through trees',
    jlpt: 'N2',
    category: 'Nature & Poetics',
    partOfSpeech: 'Noun',
    exampleSentence: '木漏れ日の中で、静かに本を読む時間が好きです。',
    exampleFurigana: '<ruby>木漏<rt>こぼ</rt></ruby>れ<ruby>日<rt>び</rt></ruby>の<ruby>中<rt>なか</rt></ruby>で、<ruby>静<rt>しず</rt></ruby>かに<ruby>本<rt>ほん</rt></ruby>を<ruby>読<rt>よ</rt></ruby>む<ruby>時間<rt>じかん</rt></ruby>が<ruby>好<rt>す</rt></ruby>きです。',
    exampleTranslation: 'I love the peaceful time spent reading a book under sunlight filtering through the trees.'
  },
  {
    kanji: '風情',
    reading: 'ふぜい',
    romaji: 'fuzei',
    meaning: 'Taste, elegance, charm, aesthetic atmosphere',
    jlpt: 'N1',
    category: 'Aesthetics',
    partOfSpeech: 'Noun',
    exampleSentence: '雨上がりの古い町並みには独特の風情がある。',
    exampleFurigana: '<ruby>雨上<rt>あめあ</rt></ruby>がりの<ruby>古<rt>ふる</rt></ruby>い<ruby>町並<rt>まちな</rt></ruby>みには<ruby>独特<rt>どくとく</rt></ruby>の<ruby>風情<rt>ふぜい</rt></ruby>がある。',
    exampleTranslation: 'There is a unique charm to the historic townscape after the rain.'
  },
  {
    kanji: '一期一会',
    reading: 'いちごいちえ',
    romaji: 'ichigo ichie',
    meaning: 'Once-in-a-lifetime encounter; cherish every moment',
    jlpt: 'N1',
    category: 'Proverb & Zen',
    partOfSpeech: 'Yojijukugo (Idiom)',
    exampleSentence: '出会いは一期一会だから、一つ一つの縁を大切にしよう。',
    exampleFurigana: '<ruby>出合<rt>であ</rt></ruby>いは<ruby>一期一会<rt>いちごいちえ</rt></ruby>だから、<ruby>一<rt>ひと</rt></ruby>つ<ruby>一<rt>ひと</rt></ruby>つの<ruby>縁<rt>えん</rt></ruby>を<ruby>大切<rt>たいせつ</rt></ruby>にしよう。',
    exampleTranslation: 'Every encounter is once in a lifetime, so cherish every bond you form.'
  },
  {
    kanji: '雨宿り',
    reading: 'あまやどり',
    romaji: 'amayadori',
    meaning: 'Sheltering from the rain',
    jlpt: 'N3',
    category: 'Daily Life',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '駅の軒下で雨宿りをしながら友人を待った。',
    exampleFurigana: '<ruby>駅<rt>えき</rt></ruby>の<ruby>軒下<rt>のきした</rt></ruby>で<ruby>雨宿<rt>あまやど</rt></ruby>りをしながら<ruby>友人<rt>ゆうじん</rt></ruby>を<ruby>待<rt>ま</rt></ruby>った。',
    exampleTranslation: 'I waited for my friend while sheltering from the rain under the station eaves.'
  },
  {
    kanji: '陽だまり',
    reading: 'ひだまり',
    romaji: 'hidamari',
    meaning: 'Sunny spot, warm pocket of sunshine',
    jlpt: 'N2',
    category: 'Warmth',
    partOfSpeech: 'Noun',
    exampleSentence: '猫が縁側の陽だまりで気持ちよさそうに丸くなっている。',
    exampleFurigana: '<ruby>猫<rt>ねこ</rt></ruby>が<ruby>縁側<rt>えんがわ</rt></ruby>の<ruby>陽<rt>ひ</rt></ruby>だまりで<ruby>気持<rt>きも</rt></ruby>ちよさそうに<ruby>丸<rt>まる</rt></ruby>くなっている。',
    exampleTranslation: 'The cat is curled up comfortably in a warm pocket of sunshine on the veranda.'
  },
  {
    kanji: '浮世',
    reading: 'うきよ',
    romaji: 'ukiyo',
    meaning: 'Floating world, fleeting transient life',
    jlpt: 'N1',
    category: 'Culture & Art',
    partOfSpeech: 'Noun',
    exampleSentence: '浮世の慌ただしさを忘れ、静かな茶室で心を落ち着かせる。',
    exampleFurigana: '<ruby>浮世<rt>うきよ</rt></ruby>の<ruby>慌<rt>あわ</rt></ruby>ただしさを<ruby>忘<rt>わす</rt></ruby>れ、<ruby>静<rt>しず</rt></ruby>かな<ruby>茶室<rt>ちゃしつ</rt></ruby>で<ruby>心<rt>こころ</rt></ruby>を<ruby>落<rt>お</rt></ruby>ち<ruby>着<rt>つ</rt></ruby>かせる。',
    exampleTranslation: 'Forgetting the rush of this transient world, calm your mind in a quiet tea room.'
  },
  {
    kanji: '心づくし',
    reading: 'こころづくし',
    romaji: 'kokorozukushi',
    meaning: 'Heartfelt kindness, thorough consideration',
    jlpt: 'N1',
    category: 'Virtue',
    partOfSpeech: 'Noun',
    exampleSentence: '旅先で地元の人々から受けた心づくしのもてなしに深く感謝した。',
    exampleFurigana: '<ruby>旅先<rt>たびさき</rt></ruby>で<ruby>地元<rt>じもと</rt></ruby>の<ruby>人々<rt>ひとびと</rt></ruby>から<ruby>受<rt>う</rt></ruby>けた<ruby>心<rt>こころ</rt></ruby>づくしのもてなしに<ruby>深<rt>ふか</rt></ruby>く<ruby>感謝<rt>かんしゃ</rt></ruby>した。',
    exampleTranslation: 'I was deeply grateful for the heartfelt hospitality received from local people during my travels.'
  },

  // Practical Core N4 Vocabulary (Everyday conversational essentials)
  {
    kanji: '約束',
    reading: 'やくそく',
    romaji: 'yakusoku',
    meaning: 'Promise, agreement, arrangement',
    jlpt: 'N4',
    category: 'Social & Daily',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '友達と週末に映画を見る約束をしました。',
    exampleFurigana: '<ruby>友達<rt>ともだち</rt></ruby>と<ruby>週末<rt>しゅうまつ</rt></ruby>に<ruby>映画<rt>えいが</rt></ruby>を<ruby>見<rt>み</rt></ruby>る<ruby>約束<rt>やくそく</rt></ruby>をしました。',
    exampleTranslation: 'I made a promise with my friend to see a movie this weekend.'
  },
  {
    kanji: '準備',
    reading: 'じゅんび',
    romaji: 'junbi',
    meaning: 'Preparation, arrangements, getting ready',
    jlpt: 'N4',
    category: 'Daily Life',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '明日の旅行の準備はもう終わりましたか。',
    exampleFurigana: '<ruby>明日<rt>あした</rt></ruby>の<ruby>旅行<rt>りょこう</rt></ruby>の<ruby>準備<rt>じゅんび</rt></ruby>はもう<ruby>終<rt>お</rt></ruby>わりましたか。',
    exampleTranslation: 'Have you finished preparing for tomorrow\'s trip yet?'
  },
  {
    kanji: '連絡',
    reading: 'れんらく',
    romaji: 'renraku',
    meaning: 'Contact, communication, getting in touch',
    jlpt: 'N4',
    category: 'Communication',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '駅に着いたらすぐに連絡してください。',
    exampleFurigana: '<ruby>駅<rt>えき</rt></ruby>に<ruby>着<rt>つ</rt></ruby>いたらすぐに<ruby>連絡<rt>れんらく</rt></ruby>してください。',
    exampleTranslation: 'Please contact me as soon as you arrive at the station.'
  },
  {
    kanji: '案内',
    reading: 'あんない',
    romaji: 'annai',
    meaning: 'Guidance, showing around, information',
    jlpt: 'N4',
    category: 'Navigation',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '東京の街を親切に案内してくれました。',
    exampleFurigana: '<ruby>東京<rt>とうきょう</rt></ruby>の<ruby>街<rt>まち</rt></ruby>を<ruby>親切<rt>しんせつ</rt></ruby>に<ruby>案内<rt>あんない</rt></ruby>してくれました。',
    exampleTranslation: 'They kindly showed me around the city of Tokyo.'
  },

  // Practical Core N5 Vocabulary
  {
    kanji: '時間',
    reading: 'じかん',
    romaji: 'jikan',
    meaning: 'Time, hours',
    jlpt: 'N5',
    category: 'Basics',
    partOfSpeech: 'Noun',
    exampleSentence: '日本語を勉強する時間を毎日作っています。',
    exampleFurigana: '<ruby>日本語<rt>にほんご</rt></ruby>を<ruby>勉強<rt>べんきょう</rt></ruby>する<ruby>時間<rt>じかん</rt></ruby>を<ruby>毎日<rt>まいにち</rt></ruby><ruby>作<rt>つく</rt></ruby>っています。',
    exampleTranslation: 'I make time to study Japanese every day.'
  },
  {
    kanji: '食事',
    reading: 'しょくじ',
    romaji: 'shokuji',
    meaning: 'Meal, dining',
    jlpt: 'N5',
    category: 'Daily Life',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '家族と一緒に楽しい食事の時間を過ごした。',
    exampleFurigana: '<ruby>家族<rt>かぞく</rt></ruby>と<ruby>一緒<rt>いっしょ</rt></ruby>に<ruby>楽<rt>たの</rt></ruby>しい<ruby>食事<rt>しょくじ</rt></ruby>の<ruby>時間<rt>じかん</rt></ruby>を<ruby>過<rt>す</rt></ruby>ごした。',
    exampleTranslation: 'I spent a wonderful mealtime together with my family.'
  },

  // Practical Core N3 Vocabulary
  {
    kanji: '遠慮',
    reading: 'えんりょ',
    romaji: 'enryo',
    meaning: 'Restraint, hesitation, holding back',
    jlpt: 'N3',
    category: 'Social Etiquette',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: 'どうぞ遠慮しないでたくさん召し上がってください。',
    exampleFurigana: 'どうぞ<ruby>遠慮<rt>えんりょ</rt></ruby>しないでたくさん<ruby>召<rt>め</rt></ruby>し<ruby>上<rt>あ</rt></ruby>がってください。',
    exampleTranslation: 'Please do not hesitate and eat as much as you like.'
  },
  {
    kanji: '経験',
    reading: 'けいけん',
    romaji: 'keiken',
    meaning: 'Experience, practical knowledge',
    jlpt: 'N3',
    category: 'Growth',
    partOfSpeech: 'Noun / Suru verb',
    exampleSentence: '日本での生活はとても貴重な経験になりました。',
    exampleFurigana: '<ruby>日本<rt>にほん</rt></ruby>での<ruby>生活<rt>せいかつ</rt></ruby>はとても<ruby>貴重<rt>きちょう</rt></ruby>な<ruby>経験<rt>けいけん</rt></ruby>になりました。',
    exampleTranslation: 'Living in Japan became an invaluable experience.'
  }
];

export const LAUNCHER_CARDS = [
  {
    id: 'vocab',
    tab: 'vocab',
    title: 'Vocab',
    descriptor: 'Quick Add, mining, Anki',
    glyphSvg: HOME_GLYPHS.vocab,
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
    dur: 5.0,
    restTime: 4.8,
    drawFinishTime: 2.55
  }
];

const MENU_ITEMS = [
  {
    id: 'vocab',
    tab: 'vocab',
    title: 'Vocabulary & Quick Add',
    descriptor: 'Mining capture, definitions, and Anki review',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`
  },
  {
    id: 'kanji',
    tab: 'kanji',
    title: 'Kanji Studio',
    descriptor: 'Stroke order vectors, radicals, and compounds',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`
  },
  {
    id: 'grammar',
    tab: 'grammar',
    title: 'Grammar Index',
    descriptor: 'JLPT syntax patterns, formations, and rules',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>`
  },
  {
    id: 'study',
    tab: 'study',
    title: 'Practice Drills',
    descriptor: 'Adaptive drills, difficulty ratings, and repetition',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`
  },
  {
    id: 'test',
    tab: 'test',
    title: 'Exam Simulator',
    descriptor: 'Timed JLPT N5–N1 mock tests and diagnostic scoring',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
  },
  {
    id: 'history',
    tab: 'vocab-history',
    title: 'Mined Card Archives',
    descriptor: 'Saved cards, Anki sync history, and export ledger',
    icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`
  }
];

export class HomeView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.activeListenerCount = 0;
    this._lastRefreshAt = 0;
    this.container = null;
    this.greetingIndex = null;
    this.jumpTimeout = null;
    this.bubbleFallbackTimer = null;
    this.mouseMoveHandler = null;
    this.mouseEnterHandler = null;
    this.mouseLeaveHandler = null;
    this.tiltFrame = null;
    this.tiltTarget = { x: 0, y: 0 };
    this.tiltCurrent = { x: 0, y: 0 };
    this.tiltStage = null;
    this.cardIntersectionObserver = null;
    this.visibilityHandler = null;
    this.escapeHandler = null;
    this.midnightTimer = null;
    this.writeInTimeout = null;
    this.riveMascot = null;
    this.cardControllers = new Map();
    this.currentDailyWord = null;
    this.dueReviewsCount = null;
    this.dailyStreak = null;
    this.currentLearnerLevel = 'N4';
    this.speechClickCycle = 0;
    this.lastGrammarPoint = null;
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

  getDailyWord(date = new Date(), level = null) {
    const d = new Date(date);
    const dayTimestamp = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dayIndex = Math.floor(dayTimestamp / 86400000);
    const pool = (level && typeof level === 'string')
      ? CURATED_DAILY_WORDS.filter((w) => w.jlpt?.toLowerCase() === level.toLowerCase())
      : null;
    const candidates = (pool && pool.length > 0) ? pool : CURATED_DAILY_WORDS;
    const index = Math.abs(dayIndex) % candidates.length;
    return candidates[index];
  }

  formatDateIso(date = new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async getBackendProxy() {
    try {
      const mod = await import('../services/' + 'api_' + 'client.js');
      return mod[Object.keys(mod)[0]] || null;
    } catch (e) {
      console.debug('[Home] Backend proxy load warning:', e);
      return null;
    }
  }

  async fetchStudySummary() {
    try {
      const proxy = await this.getBackendProxy();
      if (proxy && typeof proxy.request === 'function') {
        const stats = await proxy.request('/api/cards/stats');
        if (stats && typeof stats.due_cards === 'number') {
          this.dueReviewsCount = stats.due_cards;
          this.dailyStreak = stats.streak || 0;
          this.updateSpeechBubble();
          this.updateStudyDueBadge();
        }
      }
    } catch (e) {
      console.debug('[Home] Study summary load notice:', e);
    }
  }

  updateSpeechBubble() {
    const speechEl = this.container ? this.container.querySelector('#speech-bubble') : null;
    if (!speechEl) return;
    const jaSpan = speechEl.querySelector('.speech-greeting-ja');
    const enP = speechEl.querySelector('.speech-subtitle-en');
    const greeting = this.getAdaptiveGreeting();
    if (jaSpan) jaSpan.textContent = greeting.ja;
    if (enP) enP.textContent = greeting.en;
  }

  updateStudyDueBadge() {
    const badge = this.container ? this.container.querySelector('#home-study-due-badge') : null;
    if (!badge) return;
    if (this.dueReviewsCount !== null && this.dueReviewsCount > 0) {
      badge.textContent = `${this.dueReviewsCount} DUE`;
      badge.classList.remove('is-caught-up');
    } else if (this.dueReviewsCount === 0) {
      badge.textContent = 'CAUGHT UP';
      badge.classList.add('is-caught-up');
    }
  }

  getAdaptiveGreeting() {
    const base = this.getGreeting();
    if (this.speechClickCycle === 1) {
      return {
        ja: '一歩一歩進もう！毎日の積み重ねが力になるよ。',
        en: 'One step at a time! Daily consistency builds mastery.'
      };
    }
    if (this.speechClickCycle === 2) {
      return {
        ja: '今夜も勉強？無理せず自分のペースでいこう！',
        en: 'Studying tonight too? Take it at your own comfortable pace!'
      };
    }
    if (this.dueReviewsCount !== null) {
      if (this.dueReviewsCount > 0) {
        return {
          ja: `${base.ja} 今日の復習は${this.dueReviewsCount}件あるよ！`,
          en: `${base.en} — ${this.dueReviewsCount} reviews due today!`
        };
      } else {
        return {
          ja: `${base.ja} 今日の復習はバッチリ完了！えらい！`,
          en: `${base.en} — All caught up for today! Great work!`
        };
      }
    }
    return base;
  }

  async mount(container) {
    this.container = container;
    this.currentLearnerLevel = 'N4';
    if (typeof localStorage !== 'undefined') {
      try {
        const lvl = localStorage.getItem('learner_jlpt_level') || localStorage.getItem('learner.jlptLevel');
        if (lvl) this.currentLearnerLevel = lvl;
        const lastPt = localStorage.getItem('kiroku.last_grammar_point') || localStorage.getItem('grammar.lastPoint');
        if (lastPt) this.lastGrammarPoint = lastPt;
      } catch (e) {
        console.debug('[Home] LocalStorage read notice:', e);
      }
    }

    const greeting = this.getAdaptiveGreeting();
    const fallbackWord = this.getDailyWord(new Date(), this.currentLearnerLevel);
    this.currentDailyWord = {
      word: fallbackWord.kanji,
      reading: fallbackWord.reading,
      romaji: fallbackWord.romaji,
      meaning: fallbackWord.meaning,
      jlpt_level: fallbackWord.jlpt,
      category: fallbackWord.category,
      partOfSpeech: fallbackWord.partOfSpeech,
      example_sentence: fallbackWord.exampleSentence,
      example_translation: fallbackWord.exampleTranslation,
      is_saved: false,
      has_kanji: true,
      stroke_svgs: {},
      date: this.formatDateIso()
    };

    // Render Home Shell (Asymmetric Bento Grid)
    const launcherCardsHtml = LAUNCHER_CARDS.map((card) => `
      <div class="home-launcher-card tactile-card tactile-card-interactive bento-card bento-card-${card.id}"
           id="launcher-card-${card.id}"
           data-tab="${card.tab}"
           role="button"
           tabindex="0"
           aria-label="${card.title}: ${card.descriptor}">
        <div class="launcher-glyph-side" aria-hidden="true">
          <div class="launcher-glyph-wrap" id="launcher-glyph-${card.id}">
            ${card.glyphSvg}
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

    const grammarPointLabel = this.lastGrammarPoint || `${this.currentLearnerLevel} Syllabus`;

    this.container.innerHTML = `
      <div class="home-view-wrapper">
        <!-- Hero Brand Wordmark Header -->
        <header class="home-hero-header">
          <h1 class="home-hero-brand" id="home-hero-brand" aria-label="KIROKU ノート">
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
          </h1>
        </header>

        <div class="home-view-container">
          <!-- Left Zone: Companion Mascot Stage & Adaptive Speech Bubble -->
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
              <div class="organic-shape-backing" aria-hidden="true" style="display: none;"></div>
              <div class="mascot-character-wrap" id="mascot-character-wrap">
              </div>
            </div>
          </div>

          <!-- Right Zone: 6-Card Hub Grid & Square Word of the Day Stamp -->
          <div class="home-launcher-zone home-right-zone" id="home-launcher-zone">
            <!-- 6-Card Destination Bento Hub Grid (Row 1: Study Pillars, Row 2: Immersion & Practice) -->
            <div class="home-launcher-grid" role="region" aria-label="Study Destinations">
              <!-- Top Row: Hero Cards (Vocab, Kanji, Grammar) -->
              <div class="home-bento-hero-row">
                ${launcherCardsHtml}

                <!-- Grammar Studio Bento Card with Continue Option -->
                <div class="home-launcher-card tactile-card tactile-card-interactive bento-card bento-card-grammar"
                     id="launcher-card-grammar"
                     data-tab="grammar"
                     role="button"
                     tabindex="0"
                     aria-label="Grammar: JLPT syntax patterns and rules">
                  <div class="bento-grammar-content">
                    <div class="bento-card-header">
                      <span class="bento-grammar-pill font-japanese">文法</span>
                      <span class="launcher-arrow font-mono" aria-hidden="true">&rarr;</span>
                    </div>
                    <div class="launcher-text-group">
                      <h3 class="launcher-title font-display">Grammar</h3>
                      <p class="launcher-desc font-sans">JLPT syntax patterns</p>
                    </div>
                    <div class="bento-grammar-action">
                      <button type="button" class="bento-resume-btn font-mono" id="btn-grammar-continue" title="Resume grammar study">
                        <span class="resume-label">Continue:</span>
                        <span class="resume-point font-japanese">${grammarPointLabel}</span>
                        <span class="resume-arrow font-mono" aria-hidden="true">&rarr;</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Bottom Row: Sub-Cards (Study Drills, Anime, Manga) -->
              <div class="home-bento-sub-row">
                <!-- Card 1: Study Drills with Pending Reviews Badge -->
                <div class="home-launcher-card bento-sub-card tactile-card tactile-card-interactive"
                     id="launcher-card-study"
                     data-tab="study"
                     role="button"
                     tabindex="0"
                     aria-label="Study Drills: Adaptive repetition and practice">
                  <div class="bento-sub-card-header">
                    <div class="bento-sub-badge-group">
                      <div class="bento-sub-icon-wrap" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                      </div>
                      <span class="bento-due-pill font-mono" id="home-study-due-badge">PRACTICE</span>
                    </div>
                    <span class="launcher-arrow font-mono" aria-hidden="true">&rarr;</span>
                  </div>
                  <div class="launcher-text-group">
                    <h3 class="launcher-title font-display">Study Drills</h3>
                    <p class="launcher-desc font-sans">SRS reviews & bursts</p>
                  </div>
                </div>

                <!-- Card 2: Anime Theater -->
                <div class="home-launcher-card bento-sub-card tactile-card tactile-card-interactive"
                     id="launcher-card-anime"
                     data-tab="anime"
                     role="button"
                     tabindex="0"
                     aria-label="Anime: Subtitle sync and video immersion">
                  <div class="bento-sub-card-header">
                    <div class="bento-sub-badge-group">
                      <div class="bento-sub-icon-wrap" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                          <line x1="7" y1="2" x2="7" y2="22"></line>
                          <line x1="17" y1="2" x2="17" y2="22"></line>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                        </svg>
                      </div>
                      <span class="bento-media-pill font-mono">ANIME</span>
                    </div>
                    <span class="launcher-arrow font-mono" aria-hidden="true">&rarr;</span>
                  </div>
                  <div class="launcher-text-group">
                    <h3 class="launcher-title font-display">Anime</h3>
                    <p class="launcher-desc font-sans">Subtitle theater & player</p>
                  </div>
                </div>

                <!-- Card 3: Manga Reader -->
                <div class="home-launcher-card bento-sub-card tactile-card tactile-card-interactive"
                     id="launcher-card-manga"
                     data-tab="manga"
                     role="button"
                     tabindex="0"
                     aria-label="Manga: Reader and OCR bubble capture">
                  <div class="bento-sub-card-header">
                    <div class="bento-sub-badge-group">
                      <div class="bento-sub-icon-wrap" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                        </svg>
                      </div>
                      <span class="bento-media-pill font-mono">MANGA</span>
                    </div>
                    <span class="launcher-arrow font-mono" aria-hidden="true">&rarr;</span>
                  </div>
                  <div class="launcher-text-group">
                    <h3 class="launcher-title font-display">Manga</h3>
                    <p class="launcher-desc font-sans">Reader & OCR mining</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Square Word of the Day Stamp (Placed Below All Destination Cards) -->
            <div class="home-wotd-zone">
              <div class="home-daily-word daily-vocab-stamp tactile-card wotd-square-stamp"
                   id="daily-word-stamp"
                   role="region"
                   tabindex="0"
                   aria-label="Word of the day: ${this.currentDailyWord.word} (${this.currentDailyWord.reading}) - ${this.currentDailyWord.meaning}">
                ${this.renderWordOfTheDayCard(this.currentDailyWord)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.initCardControllers();
    this.setupEvents();
    this.setupMascot();
    this.scheduleMidnightRollover();

    // Trigger initial word write-in animation
    this.triggerWordWriteIn();

    // Hydrate Word of the Day dynamically from backend in background
    this._lastRefreshAt = Date.now();
    this.hydrateDailyWord();
    this.fetchStudySummary();
  }

  renderWordOfTheDayCard(data) {
    const hasExample = Boolean(data.example_sentence && data.example_sentence.trim());
    const isSaved = Boolean(data.is_saved);

    return `
      <div class="wotd-card-inner wotd-square-inner">
        <!-- Top Meta & Controls Header -->
        <div class="wotd-header-row">
          <div class="wotd-badge-group">
            <span class="wotd-section-tag font-mono">WORD OF THE DAY</span>
            <span class="wotd-jlpt-pill font-mono">${data.jlpt_level || 'N4'}</span>
            ${data.category ? `<span class="wotd-category-pill font-mono">${data.category}</span>` : ''}
          </div>
          <div class="wotd-actions-row">
            <button class="wotd-btn-replay"
                    id="btn-wotd-replay"
                    type="button"
                    aria-label="Replay write-in animation"
                    title="Replay stroke order">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
            <button class="wotd-bookmark-btn ${isSaved ? 'is-added' : ''}"
                    id="btn-wotd-add"
                    type="button"
                    role="button"
                    ${isSaved ? 'disabled' : ''}
                    aria-label="${isSaved ? 'Saved in Kiroku' : 'Add to Kiroku'}"
                    title="${isSaved ? 'Saved in Kiroku' : 'Save to Kiroku'}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
              <span class="wotd-bookmark-label font-mono">${isSaved ? 'Added' : 'Save'}</span>
            </button>
          </div>
        </div>

        <!-- Main Word Display & Kana / Romaji Reading -->
        <div class="wotd-main-display">
          <div class="wotd-word-surface" id="wotd-word-surface">
            ${this.renderWordGlyphs(data)}
          </div>
          <div class="wotd-details-row is-revealed" id="wotd-details-row">
            <div class="wotd-reading-line">
              <span class="wotd-reading font-japanese">${data.reading || ''}</span>
              ${data.romaji ? `<span class="wotd-romaji font-mono">${data.romaji}</span>` : ''}
            </div>
            <div class="wotd-meaning-text font-sans">${data.meaning || ''}</div>
          </div>
        </div>

        <!-- Footer Link to Vocab Desk -->
        <div class="wotd-footer-row">
          <a href="#vocab" class="wotd-link-vocab font-mono" id="btn-daily-word-open" title="Open in Vocabulary Desk">
            <span>Open in Vocab Desk</span>
            <span class="wotd-arrow font-mono" aria-hidden="true">&rarr;</span>
          </a>
        </div>

        <!-- Collapsible Drawer Container (Reveals on Hover, Focus, or Tap) -->
        <div class="wotd-collapsible-wrapper" id="wotd-collapsible-wrapper">
          <div class="wotd-collapsible-inner">
            <!-- Example Sentence Context Inset -->
            <div class="wotd-example-drawer" id="wotd-example-drawer" style="${hasExample ? '' : 'display: none;'}">
              <div class="wotd-example-block">
                <div class="wotd-example-label font-mono">EXAMPLE</div>
                <p class="wotd-example-ja font-japanese">${data.example_sentence || ''}</p>
                ${data.example_translation ? `<p class="wotd-example-en font-sans">${data.example_translation}</p>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderWordGlyphs(data) {
    const kanjiChars = (data.kanji_characters && data.kanji_characters.length)
      ? data.kanji_characters
      : Array.from(data.word || '').filter((ch) => ch >= '\u4e00' && ch <= '\u9fff');

    // Case 1: Kanji stroke vectors available
    if (kanjiChars.length > 0 && data.stroke_svgs && Object.keys(data.stroke_svgs).length > 0) {
      const renderedChars = Array.from(data.word || '').map((char, charIdx) => {
        const svg = data.stroke_svgs[char];
        if (svg) {
          // Extract paths from KanjiVG SVG string
          const pathMatches = Array.from(svg.matchAll(/<path[^>]+d="([^"]+)"[^>]*>/g)).map((m) => m[1]);
          if (pathMatches.length > 0) {
            const pathsHtml = pathMatches.map((d, i) => `
              <path class="wotd-stroke-path"
                    data-char-idx="${charIdx}"
                    data-stroke-idx="${i}"
                    d="${d}"
                    fill="none"
                    stroke="var(--vermilion)"
                    stroke-width="3.6"
                    stroke-linecap="round"
                    stroke-linejoin="round" />
            `).join('');

            return `
              <div class="wotd-stroke-char" data-char="${char}">
                <svg viewBox="0 0 109 109" width="48" height="48" class="wotd-stroke-svg" aria-hidden="true" focusable="false">
                  ${pathsHtml}
                </svg>
              </div>
            `;
          }
        }
        // Fallback for kana / characters inside mixed words
        return `<span class="wotd-plain-char font-japanese" style="color: var(--vermilion);">${char}</span>`;
      }).join('');

      return `<div class="wotd-stroke-container" id="wotd-stroke-container">${renderedChars}</div>`;
    }

    // Case 2: Clean left-to-right mask/clip-path reveal of glyph text
    return `
      <div class="wotd-mask-reveal-wrap">
        <span class="wotd-word-text font-japanese" id="wotd-word-text" style="color: var(--vermilion);">${data.word}</span>
      </div>
    `;
  }

  renderLauncherMenu() {
    return MENU_ITEMS.map((item) => `
      <div class="home-launcher-card home-menu-item tactile-card-interactive"
           id="launcher-card-${item.id}"
           data-tab="${item.tab}"
           role="button"
           tabindex="0"
           aria-label="${item.title}: ${item.descriptor}">
        <div class="home-menu-icon-wrap" aria-hidden="true">
          ${item.icon}
        </div>
        <div class="home-menu-text-wrap">
          <span class="home-menu-title font-display">${item.title}</span>
          <span class="home-menu-desc font-sans">${item.descriptor}</span>
        </div>
        <div class="home-menu-arrow font-mono" aria-hidden="true">&rarr;</div>
      </div>
    `).join('');
  }

  triggerWordWriteIn() {
    if (typeof document === 'undefined') return;

    if (this.writeInTimeout) {
      clearTimeout(this.writeInTimeout);
      this.writeInTimeout = null;
    }

    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const strokePaths = this.container ? Array.from(this.container.querySelectorAll('.wotd-stroke-path')) : [];
    const maskText = this.container ? this.container.querySelector('.wotd-word-text') : null;
    const detailsRow = this.container ? this.container.querySelector('#wotd-details-row') : null;

    if (reducedMotion) {
      // Immediate final resting frame
      strokePaths.forEach((path) => {
        path.style.strokeDasharray = 'none';
        path.style.strokeDashoffset = '0';
        path.style.transition = 'none';
      });
      if (maskText) {
        maskText.style.clipPath = 'none';
        maskText.style.transition = 'none';
      }
      if (detailsRow) {
        detailsRow.classList.add('is-revealed');
      }
      return;
    }

    // Hide details during write-in
    if (detailsRow) {
      detailsRow.classList.remove('is-revealed');
    }

    if (strokePaths.length > 0) {
      // Fluid stroke duration (160ms - 260ms feels like natural Japanese calligraphy)
      const strokeDur = Math.max(160, Math.min(260, Math.floor(1800 / strokePaths.length)));

      // Initialize all strokes hidden
      strokePaths.forEach((path) => {
        let len = 100;
        try {
          if (typeof path.getTotalLength === 'function') {
            len = Math.ceil(path.getTotalLength()) || 100;
          }
        } catch (e) {
          console.debug('[Home] Path length computation fallback:', e);
        }

        path.style.strokeDasharray = `${len} ${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.style.transition = 'none';
      });

      // Animate strokes sequentially using native CSS transitions
      strokePaths.forEach((path, i) => {
        const delay = i * strokeDur;
        setTimeout(() => {
          path.style.transition = `stroke-dashoffset ${strokeDur}ms cubic-bezier(0.23, 1, 0.32, 1)`;
          path.style.strokeDashoffset = '0';
        }, delay + 30);
      });

      const totalTime = strokePaths.length * strokeDur + 120;
      this.writeInTimeout = setTimeout(() => {
        if (detailsRow) detailsRow.classList.add('is-revealed');
        this.writeInTimeout = null;
      }, totalTime);
      if (this.writeInTimeout && typeof this.writeInTimeout.unref === 'function') {
        this.writeInTimeout.unref();
      }
    } else if (maskText) {
      // Clean left-to-right clip-path reveal
      maskText.style.clipPath = 'inset(0 100% 0 0)';
      maskText.style.transition = 'none';

      requestAnimationFrame(() => {
        maskText.style.transition = 'clip-path 650ms cubic-bezier(0.23, 1, 0.32, 1)';
        maskText.style.clipPath = 'inset(0 0 0 0)';
      });

      this.writeInTimeout = setTimeout(() => {
        if (detailsRow) detailsRow.classList.add('is-revealed');
        this.writeInTimeout = null;
      }, 700);
      if (this.writeInTimeout && typeof this.writeInTimeout.unref === 'function') {
        this.writeInTimeout.unref();
      }
    } else {
      if (detailsRow) detailsRow.classList.add('is-revealed');
    }
  }

  async hydrateDailyWord(requestedDate = null) {
    const proxy = await this.getBackendProxy();
    if (!proxy || typeof proxy.getDailyWord !== 'function') return;

    try {
      const todayIso = requestedDate || this.formatDateIso();
      const res = await proxy.getDailyWord({ date: todayIso });
      if (res && res.word) {
        this.currentDailyWord = res;
        const cardContainer = document.getElementById('daily-word-stamp');
        if (cardContainer) {
          cardContainer.innerHTML = this.renderWordOfTheDayCard(this.currentDailyWord);
          this.setupWordCardEvents();
          this.triggerWordWriteIn();
        }
      }
    } catch (err) {
      console.debug('[Home] Daily word hydration notice:', err);
    }
  }

  scheduleMidnightRollover() {
    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const msUntilMidnight = Math.max(1000, nextMidnight.getTime() - now.getTime());

    this.midnightTimer = setTimeout(() => {
      this.hydrateDailyWord();
      this.scheduleMidnightRollover();
    }, msUntilMidnight);
    if (this.midnightTimer && typeof this.midnightTimer.unref === 'function') {
      this.midnightTimer.unref();
    }
  }

  initCardControllers() {
    this.cardControllers.clear();

    for (const config of LAUNCHER_CARDS) {
      const cardEl = typeof this.container?.querySelector === 'function'
        ? this.container.querySelector(`#launcher-card-${config.id}`)
        : null;
      const svgEl = cardEl && typeof cardEl.querySelector === 'function'
        ? cardEl.querySelector('svg')
        : null;

      const reducedMotion = typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // In normal mode, ensure animations are unpaused and start from stroke 1
      try {
        if (reducedMotion) {
          if (svgEl?.pauseAnimations) svgEl.pauseAnimations();
          if (svgEl?.setCurrentTime) svgEl.setCurrentTime(config.restTime);
        } else {
          if (svgEl?.setCurrentTime) svgEl.setCurrentTime(0);
          if (svgEl?.animationsPaused?.()) {
            svgEl.unpauseAnimations();
          }
        }
      } catch (e) {
        console.debug('[Home] SVG animation init warning:', e);
      }

      const ctrl = {
        config,
        cardEl,
        svg: svgEl,
        leaveTimer: null,
        isAnimating: true,
        inViewport: true,
        play: () => {
          if (ctrl.leaveTimer) {
            clearTimeout(ctrl.leaveTimer);
            ctrl.leaveTimer = null;
          }
          const glyphWrap = ctrl.cardEl?.querySelector?.('.launcher-glyph-wrap');
          if (glyphWrap) glyphWrap.classList.remove('is-easing-out');

          if (reducedMotion || document.hidden === true) {
            try {
              ctrl.svg?.pauseAnimations?.();
              ctrl.svg?.setCurrentTime?.(ctrl.config.restTime);
            } catch (e) {
              console.debug('[Home] SVG pause error:', e);
            }
            return;
          }

          try {
            if (ctrl.svg) {
              if (typeof ctrl.svg.setCurrentTime === 'function') {
                ctrl.svg.setCurrentTime(0);
              }
              if (typeof ctrl.svg.unpauseAnimations === 'function' && ctrl.svg.animationsPaused?.()) {
                ctrl.svg.unpauseAnimations();
              }
            }
            ctrl.isAnimating = true;
          } catch (e) {
            console.debug('[Home] SVG play warning:', e);
          }
        },
        stop: () => {
          if (ctrl.leaveTimer) {
            clearTimeout(ctrl.leaveTimer);
            ctrl.leaveTimer = null;
          }
          if (reducedMotion) {
            try {
              ctrl.svg?.pauseAnimations?.();
              ctrl.svg?.setCurrentTime?.(ctrl.config.restTime);
            } catch (e) {
              console.debug('[Home] SVG stop notice:', e);
            }
          }
        },
        resetToRest: () => {
          if (ctrl.leaveTimer) {
            clearTimeout(ctrl.leaveTimer);
            ctrl.leaveTimer = null;
          }
        }
      };

      this.cardControllers.set(config.id, ctrl);

      if (cardEl && typeof cardEl.addEventListener === 'function') {
        cardEl.addEventListener('pointerenter', () => {
          ctrl.play();
        });

        cardEl.addEventListener('focus', () => {
          ctrl.play();
        });

        cardEl.addEventListener('click', (e) => {
          e?.preventDefault?.();
          this.router.navigateToTab(config.tab);
        });

        cardEl.addEventListener('keydown', (e) => {
          if (e?.key === 'Enter' || e?.key === ' ') {
            e?.preventDefault?.();
            this.router.navigateToTab(config.tab);
          }
        });
      }
    }
  }

  setupEvents() {
    if (typeof document === 'undefined') return;

    this.setupMascotInteractions();
    this.setupWordCardEvents();
    this.setupLauncherNavigation();

    // Click on speech bubble cycles through study status & greetings
    const speechBubble = this.container ? this.container.querySelector('#speech-bubble') : null;
    if (speechBubble) {
      speechBubble.style.cursor = 'pointer';
      speechBubble.addEventListener('click', () => {
        this.speechClickCycle = (this.speechClickCycle + 1) % 3;
        this.updateSpeechBubble();
      });
    }

    // Grammar Bento Card & Continue button
    const cardGrammar = this.container ? this.container.querySelector('#launcher-card-grammar') : null;
    if (cardGrammar) {
      cardGrammar.addEventListener('click', (e) => {
        e.preventDefault();
        this.router.navigateToTab('grammar');
      });
      cardGrammar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.router.navigateToTab('grammar');
        }
      });
    }
    const btnGrammarContinue = this.container ? this.container.querySelector('#btn-grammar-continue') : null;
    if (btnGrammarContinue) {
      btnGrammarContinue.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.router.navigateToTab('grammar');
      });
    }

    // Study Drills Card
    const cardStudy = this.container ? this.container.querySelector('#launcher-card-study') : null;
    if (cardStudy) {
      cardStudy.addEventListener('click', (e) => {
        e.preventDefault();
        this.router.navigateToTab('study');
      });
      cardStudy.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.router.navigateToTab('study');
        }
      });
    }

    // Anime Theater Card
    const cardAnime = this.container ? this.container.querySelector('#launcher-card-anime') : null;
    if (cardAnime) {
      cardAnime.addEventListener('click', (e) => {
        e.preventDefault();
        this.router.navigateToTab('anime');
      });
      cardAnime.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.router.navigateToTab('anime');
        }
      });
    }

    // Manga Reader Card
    const cardManga = this.container ? this.container.querySelector('#launcher-card-manga') : null;
    if (cardManga) {
      cardManga.addEventListener('click', (e) => {
        e.preventDefault();
        this.router.navigateToTab('manga');
      });
      cardManga.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.router.navigateToTab('manga');
        }
      });
    }

    // Pause looping SVGs when document is hidden (minimize to tray)
    this.visibilityHandler = () => {
      if (document.hidden) {
        for (const ctrl of this.cardControllers.values()) {
          ctrl.stop();
        }
      } else {
        for (const ctrl of this.cardControllers.values()) {
          ctrl.play();
        }
      }
    };
  }

  onShow() {
    if (this.visibilityHandler) {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    this.activeListenerCount = this.visibilityHandler ? 1 : 0;
    if (Date.now() - this._lastRefreshAt > 30000) {
      this._lastRefreshAt = Date.now();
      this.hydrateDailyWord();
      this.fetchStudySummary();
    }
    // Resume and rewind stroke animations on view activation
    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      for (const ctrl of this.cardControllers.values()) {
        ctrl.inViewport = true;
        try {
          if (ctrl.svg) {
            if (typeof ctrl.svg.setCurrentTime === 'function') {
              ctrl.svg.setCurrentTime(0);
            }
            if (typeof ctrl.svg.unpauseAnimations === 'function' && ctrl.svg.animationsPaused?.()) {
              ctrl.svg.unpauseAnimations();
            }
          }
        } catch (e) {
          console.debug('[Home] SVG onShow resume warning:', e);
        }
      }
    }
    if (this.riveMascot) {
      this.riveMascot.lastSurfaceSize = null;
      this.riveMascot.resume();
      requestAnimationFrame(() => {
        this.riveMascot?.resize?.();
        requestAnimationFrame(() => {
          this.riveMascot?.resize?.();
        });
      });
    }
    this.scheduleTiltReset();
  }

  onHide() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    for (const ctrl of this.cardControllers.values()) {
      try {
        if (ctrl.svg && typeof ctrl.svg.pauseAnimations === 'function') {
          ctrl.svg.pauseAnimations();
        }
      } catch (e) {
        console.debug('[Home] SVG hide notice:', e);
      }
    }
    this.stopTiltTracking();
    this.riveMascot?.pause?.();
    this.activeListenerCount = 0;
  }

  setupMascot() {
    const speechBubble = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('#speech-bubble')
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

    const mascotSlot = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.mascot-character-wrap')
      : null;
    const fallbackBacking = typeof this.container?.querySelector === 'function'
      ? this.container.querySelector('.organic-shape-backing')
      : null;

    const showFallbackCat = () => {
      if (fallbackBacking) {
        fallbackBacking.style.display = 'none';
        fallbackBacking.innerHTML = '';
      }
      if (mascotSlot) {
        mascotSlot.style.display = 'flex';
        mascotSlot.innerHTML = `<img src="./ui/assets/mascot/Cat typing.svg" alt="Kiroku Companion" class="mascot-fallback-svg" style="width: 100%; height: 100%; object-fit: contain;">`;
      }
      showBubble();
    };

    if (mascotSlot) {
      const host = getMascotHost();
      host.ensureCreated().then(() => {
        if (!this.container || !mascotSlot.parentNode) return;
        host.attach(mascotSlot, {
          onReady: () => {
            showBubble();
          },
          onFallback: () => {
            showFallbackCat();
          }
        });
        this.riveMascot = host;
      }).catch((e) => {
        console.debug('[Home] Mascot mount warning:', e);
        showFallbackCat();
      });

      this.bubbleFallbackTimer = setTimeout(() => {
        showBubble();
      }, 700);
      if (this.bubbleFallbackTimer && typeof this.bubbleFallbackTimer.unref === 'function') {
        this.bubbleFallbackTimer.unref();
      }
    }
  }

  setupMascotInteractions() {
    const mascotStage = document.getElementById('mascot-stage');
    const mascotWrap = document.getElementById('mascot-character-wrap');

    if (mascotStage && mascotWrap) {
      const setChinHold = (active) => {
        const r = this.riveMascot?.instance;
        if (r) {
          try {
            const inputs = r.stateMachineInputs('State Machine 1');
            const chinInput = inputs?.find((i) => i.name === 'Chin hold' || i.type === 59);
            if (chinInput) {
              chinInput.value = Boolean(active);
            }
          } catch (e) {
            console.debug('[Home] Chin hold interaction error:', e);
          }
        }
      };

      mascotStage.addEventListener('pointerdown', (e) => {
        if (e.button === 0) setChinHold(true);
      });
      const releaseChin = () => setChinHold(false);
      mascotStage.addEventListener('pointerup', releaseChin);
      mascotStage.addEventListener('pointerleave', releaseChin);
      mascotStage.addEventListener('pointercancel', releaseChin);

      const handleMascotClick = () => {
        const r = this.riveMascot?.instance;
        if (r) {
          try {
            const inputs = r.stateMachineInputs('State Machine 1');
            const foreheadTrigger = inputs?.find((i) => i.name === 'Forehead click' || i.type === 58 || i.type === 1);
            if (foreheadTrigger && typeof foreheadTrigger.fire === 'function') {
              foreheadTrigger.fire();
            }
          } catch (e) {
            console.debug('[Home] Path length computation fallback:', e);
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

      // Subtle mouse tracking
      if (typeof window !== 'undefined') {
        this.tiltStage = mascotStage;
        this.mouseEnterHandler = () => {
          window.addEventListener('pointermove', this.mouseMoveHandler);
        };
        this.mouseMoveHandler = (e) => {
          if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
          }
          const rect = mascotStage.getBoundingClientRect();
          const margin = 48;
          if (
            e.clientX < rect.left - margin ||
            e.clientX > rect.right + margin ||
            e.clientY < rect.top - margin ||
            e.clientY > rect.bottom + margin
          ) {
            this.stopTiltTracking();
            this.scheduleTiltReset();
            return;
          }
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const deltaX = (e.clientX - centerX) / (window.innerWidth / 2 || 1);
          const deltaY = (e.clientY - centerY) / (window.innerHeight / 2 || 1);
          const clampedX = Math.max(-1, Math.min(1, deltaX));
          const clampedY = Math.max(-1, Math.min(1, deltaY));
          this.tiltTarget = {
            x: clampedX,
            y: clampedY
          };
          this.scheduleTiltFrame();
        };

        this.mouseLeaveHandler = () => {
          this.scheduleTiltReset();
        };

        mascotStage.addEventListener('pointerenter', this.mouseEnterHandler);
        mascotStage.addEventListener('mouseleave', this.mouseLeaveHandler);
      }
    }
  }

  scheduleTiltFrame() {
    if (this.tiltFrame !== null) return;
    const requestFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 0);
    this.tiltFrame = requestFrame(() => {
      this.tiltFrame = null;
      const ease = 0.18;
      this.tiltCurrent.x += (this.tiltTarget.x - this.tiltCurrent.x) * ease;
      this.tiltCurrent.y += (this.tiltTarget.y - this.tiltCurrent.y) * ease;
      const tiltX = -this.tiltCurrent.y * 4;
      const tiltY = this.tiltCurrent.x * 5;
      const moveX = this.tiltCurrent.x * 4;
      const moveY = this.tiltCurrent.y * 3;
      if (this.tiltStage) {
        const mascotWrap = document.getElementById('mascot-character-wrap');
        if (mascotWrap) {
          mascotWrap.style.transform = `perspective(600px) rotateX(${tiltX.toFixed(1)}deg) rotateY(${tiltY.toFixed(1)}deg) translate(${moveX.toFixed(1)}px, ${moveY.toFixed(1)}px)`;
        }
      }
      if (
        Math.abs(this.tiltTarget.x - this.tiltCurrent.x) > 0.01 ||
        Math.abs(this.tiltTarget.y - this.tiltCurrent.y) > 0.01
      ) {
        this.scheduleTiltFrame();
      }
    });
  }

  scheduleTiltReset() {
    this.tiltTarget = { x: 0, y: 0 };
    this.scheduleTiltFrame();
  }

  stopTiltTracking() {
    if (this.mouseMoveHandler && typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.mouseMoveHandler);
    }
  }

  setupWordCardEvents() {
    const cardEl = document.getElementById('daily-word-stamp');
    const btnReplay = document.getElementById('btn-wotd-replay');
    const btnAdd = document.getElementById('btn-wotd-add');
    const btnOpen = document.getElementById('btn-daily-word-open');

    // 1. Replay button: re-runs write-in animation
    if (btnReplay) {
      btnReplay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.triggerWordWriteIn();
      });
    }

    // 2. Add to Kiroku bookmark button: save card via SQLite-first path
    if (btnAdd) {
      btnAdd.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.currentDailyWord || this.currentDailyWord.is_saved || btnAdd.disabled) return;

        btnAdd.disabled = true;
        const labelSpan = btnAdd.querySelector('.wotd-bookmark-label');
        if (labelSpan) labelSpan.textContent = 'Saving...';
        else btnAdd.textContent = 'Saving...';

        try {
          const proxy = await this.getBackendProxy();
          if (proxy && typeof proxy.saveCard === 'function') {
            await proxy.saveCard({
              expression: this.currentDailyWord.word,
              reading: this.currentDailyWord.reading,
              meaning: this.currentDailyWord.meaning,
              example_sentence: this.currentDailyWord.example_sentence || '',
              example_translation: this.currentDailyWord.example_translation || '',
              jlpt_level: this.currentDailyWord.jlpt_level || 'N3',
              deck_name: 'Default',
              tags: 'word-of-the-day'
            });
          }
          this.currentDailyWord.is_saved = true;
          if (labelSpan) labelSpan.textContent = 'Added';
          else btnAdd.textContent = 'Added';
          btnAdd.classList.add('is-added');
          btnAdd.setAttribute('title', 'Saved in Kiroku');
          btnAdd.setAttribute('aria-label', 'Saved in Kiroku');
          const svgEl = btnAdd.querySelector('svg');
          if (svgEl) svgEl.setAttribute('fill', 'currentColor');
        } catch (err) {
          console.warn('[Home] Save card warning:', err);
          btnAdd.disabled = false;
          if (labelSpan) labelSpan.textContent = 'Retry Save';
          else btnAdd.textContent = 'Retry Save';
        }
      });
    }

    // 3. Open in Vocab Desk navigation
    if (btnOpen) {
      const navVocab = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this.router.navigateToTab('vocab');
      };
      btnOpen.addEventListener('click', navVocab);
      btnOpen.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          navVocab(e);
        }
      });
    }

    // 4. Card keyboard focus navigation to vocab desk on Enter if not clicking internal controls, and tap toggle for touch
    if (cardEl) {
      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('#btn-wotd-replay') ||
          e.target.closest('#btn-wotd-add') ||
          e.target.closest('#btn-daily-word-open') ||
          e.target.closest('button') ||
          e.target.closest('a')) {
          return;
        }
        cardEl.classList.toggle('is-expanded');
      });

      cardEl.addEventListener('keydown', (e) => {
        if (e.target === cardEl && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          this.router.navigateToTab('vocab');
        }
      });
    }
  }

  setupLauncherNavigation() {
    if (!this.container) return;

    // Attach click and keyboard handlers to all launcher entries
    const menuItems = this.container.querySelectorAll('.home-menu-item');
    menuItems.forEach((item) => {
      const tabId = item.getAttribute('data-tab');
      if (!tabId) return;

      const navigate = () => {
        this.router.navigateToTab(tabId);
      };

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate();
      });

      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          navigate();
        }
      });
    });

    // Stroke showcase cards navigation
    const showVocab = document.getElementById('showcase-glyph-vocab');
    if (showVocab) {
      showVocab.addEventListener('click', () => this.router.navigateToTab('vocab'));
    }
    const showKanji = document.getElementById('showcase-glyph-kanji');
    if (showKanji) {
      showKanji.addEventListener('click', () => this.router.navigateToTab('kanji'));
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
    if (this.midnightTimer) {
      clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }
    if (this.writeInTimeout) {
      clearTimeout(this.writeInTimeout);
      this.writeInTimeout = null;
    }

    // Reset card controllers
    for (const ctrl of this.cardControllers.values()) {
      ctrl.resetToRest();
    }
    this.cardControllers.clear();
    this.cardIntersectionObserver?.disconnect();
    this.cardIntersectionObserver = null;

    this.stopTiltTracking();
    if (this.tiltFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.tiltFrame);
      else clearTimeout(this.tiltFrame);
      this.tiltFrame = null;
    }
    if (this.tiltStage && this.mouseEnterHandler) {
      this.tiltStage.removeEventListener('pointerenter', this.mouseEnterHandler);
    }
    this.mouseMoveHandler = null;
    this.mouseEnterHandler = null;
    this.mouseLeaveHandler = null;

    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = null;

    if (this.escapeHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.escapeHandler);
    }
    this.escapeHandler = null;

    getMascotHost().detach();
    this.riveMascot = null;

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
