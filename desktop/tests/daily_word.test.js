import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeView, CURATED_DAILY_WORDS } from '../src/ui/views/home.js';

test('Daily Word Client: Curated words provide deterministic fallback by date', () => {
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);

  // Determinism test: same date returns identical curated word
  const dateStr = '2026-11-02';
  const word1 = homeView.getDailyWord(dateStr);
  const word2 = homeView.getDailyWord(dateStr);
  const word3 = homeView.getDailyWord(dateStr);

  assert.equal(word1.kanji, word2.kanji);
  assert.equal(word2.kanji, word3.kanji);
  assert.equal(word1.reading, word2.reading);
  assert.equal(word1.meaning, word2.meaning);
  assert.equal(word1.jlpt, word2.jlpt);
});

test('Daily Word Client: Date rollover produces a different deterministic word', () => {
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);

  const wordDay1 = homeView.getDailyWord('2026-11-02');
  const wordDay2 = homeView.getDailyWord('2026-11-03');

  // Consecutive days index to different curated words
  assert.notEqual(wordDay1.kanji, wordDay2.kanji);
});

test('Daily Word Client: Renders stroke vectors when stroke_svgs is present', () => {
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);

  const testWordWithStrokes = {
    word: '木漏れ日',
    reading: 'こもれび',
    meaning: 'Sunlight filtering through trees',
    jlpt_level: 'N2',
    has_kanji: true,
    kanji_characters: ['木', '漏', '日'],
    stroke_svgs: {
      '木': '<svg><path d="M50 20 L50 80" /></svg>',
      '漏': '<svg><path d="M10 20 L30 80" /></svg>',
      '日': '<svg><path d="M20 20 L80 20" /></svg>'
    },
    example_sentence: '木漏れ日の中で本を読む。',
    example_translation: 'Reading a book in the sunlight filtering through trees.'
  };

  const html = homeView.renderWordOfTheDayCard(testWordWithStrokes);

  assert.ok(html.includes('class="wotd-stroke-container"'), 'Renders stroke container');
  assert.ok(html.includes('class="wotd-stroke-path"'), 'Renders stroke paths');
  assert.ok(html.includes('こもれび'), 'Renders reading');
  assert.ok(html.includes('Sunlight filtering through trees'), 'Renders meaning');
  assert.ok(html.includes('class="wotd-example-drawer"'), 'Renders example drawer');
  assert.ok(html.includes('btn-wotd-replay'), 'Renders replay button');
  assert.ok(html.includes('btn-wotd-add'), 'Renders add button');
});

test('Daily Word Client: Kana-only word falls back to clip-path reveal', () => {
  const routerMock = { navigateToTab: () => {} };
  const homeView = new HomeView(routerMock);

  const kanaWord = {
    word: 'ゆらゆら',
    reading: 'ゆらゆら',
    meaning: 'Swaying gently, flickering',
    jlpt_level: 'N3',
    has_kanji: false,
    kanji_characters: [],
    stroke_svgs: {},
    example_sentence: '',
    example_translation: ''
  };

  const html = homeView.renderWordOfTheDayCard(kanaWord);

  assert.ok(html.includes('class="wotd-mask-reveal-wrap"'), 'Renders mask reveal wrapper');
  assert.ok(html.includes('wotd-word-text'), 'Renders word text for mask animation');
  assert.ok(html.includes('style="display: none;"'), 'Hides empty example sentence cleanly');
});

