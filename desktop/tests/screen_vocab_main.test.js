const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const vocabMainPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_main.js');
const bundleCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'bundle.css');

test('Vocab Main: No hardcoded 食べる or fake sample sentence on initial mount', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    '毎日りんごを一つ食べます',
    'I eat one apple every day',
    '食べる<rt id="hero-reading">たべる</rt>'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `VocabMainView must not contain placeholder: "${str}"`
    );
  }

  // Shows honest prompt / empty state
  assert.ok(
    content.includes('Search a word above...'),
    'VocabMainView must show prompt state when no word is searched'
  );
});

test('Vocab Main: Routes Japanese lookup to /api/capture and English to /api/dictionary/search-english', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(
    content.includes('apiClient.captureText('),
    'VocabMainView must call apiClient.captureText for Japanese expressions'
  );
  assert.ok(
    content.includes('apiClient.searchEnglishDictionary('),
    'VocabMainView must call apiClient.searchEnglishDictionary for English queries'
  );
});

test('Vocab Main: Fetches live Anki decks on mount and populates select-deck', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getAnkiDecks()'),
    'VocabMainView must fetch live Anki decks via apiClient.getAnkiDecks'
  );
  assert.ok(
    content.includes('select-deck'),
    'VocabMainView must update select-deck element'
  );
  assert.ok(
    content.includes("chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck'])"),
    'VocabMainView must check both anki_deck and vocab.selectedDeck from chrome storage'
  );
});

test('Vocab Main: Integrates with known-words backend API', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getKnownWords()'),
    'VocabMainView must load known words on mount'
  );
  assert.ok(
    content.includes('apiClient.markKnownWord('),
    'VocabMainView must support marking words as known'
  );
  assert.ok(
    content.includes('apiClient.unmarkKnownWord('),
    'VocabMainView must support unmarking known words'
  );
});

test('Vocab Main: Saves cards using real endpoint (saveCard) with visible error states', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(
    content.includes('apiClient.saveCard('),
    'VocabMainView must call apiClient.saveCard (/api/cards/save)'
  );
  assert.ok(
    content.includes('vocab-error-banner'),
    'VocabMainView markup must contain vocab-error-banner'
  );
  assert.ok(
    content.includes('showError('),
    'VocabMainView must define showError method'
  );
});

test('Vocab Main: Dirty state indicator #mining-unsaved-badge and draft preservation', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  assert.ok(
    content.includes('id="mining-unsaved-badge"'),
    'VocabMainView markup must define #mining-unsaved-badge'
  );
  assert.ok(
    content.includes('setDirty('),
    'VocabMainView must define setDirty method'
  );
  assert.ok(
    content.includes('saveDraft('),
    'VocabMainView must define saveDraft method'
  );
  assert.ok(
    content.includes('restoreDraft('),
    'VocabMainView must define restoreDraft method'
  );
  assert.ok(
    content.includes('clearDraft('),
    'VocabMainView must define clearDraft method'
  );
  assert.ok(
    content.includes('kiroku:vocab-mining-draft'),
    'VocabMainView must use standard storage key for mining draft persistence'
  );
});

test('Vocab Main: Structure and interactive elements match Planetoño UI contracts', () => {
  const content = fs.readFileSync(vocabMainPath, 'utf8');

  // WanaKana IME pills
  assert.ok(content.includes('ime-mode-pills'), 'Must render IME mode pills');
  assert.ok(content.includes('data-mode="hiragana"'), 'Must support hiragana pill');
  assert.ok(content.includes('data-mode="katakana"'), 'Must support katakana pill');
  assert.ok(content.includes('data-mode="english"'), 'Must support english pill');

  // Word presentation & JMdict block
  assert.ok(content.includes('id="headword-hero"'), 'Must render headword-hero block');
  assert.ok(content.includes('id="hero-pitch"'), 'Must render pitch accent badge');
  assert.ok(content.includes('id="btn-play-audio"'), 'Must render audio button');
  assert.ok(content.includes('id="btn-toggle-known"'), 'Must render known toggle button');
  assert.ok(content.includes('id="jmdict-block"'), 'Must render jmdict-block');
  assert.ok(content.includes('surface-pitch-black'), 'Must apply surface-pitch-black to jmdict-block');

  // Mining form & save action
  assert.ok(content.includes('id="card-mining-form"'), 'Must render card-mining-form');
  assert.ok(content.includes('id="btn-save-card"'), 'Must render Vermilion save card button');

  // Gap shelf
  assert.ok(content.includes('id="vocab-gaps-shelf"'), 'Must render vocab-gaps-shelf');
  assert.ok(content.includes('id="btn-refresh-gaps"'), 'Must render refresh gaps button');
});

test('Vocab Main: bundle.css styles vocabulary view with Planetoño tactile physics and pitch-black JMdict', () => {
  const css = fs.readFileSync(bundleCssPath, 'utf8');

  // Planetoño tactile borders and shadows
  assert.ok(
    css.includes('2px solid var(--tactile-stroke)') || css.includes('2px solid #151413'),
    'bundle.css must apply 2px solid tactile stroke borders to vocabulary cards'
  );
  assert.ok(
    css.includes('3px 3px 0 var(--tactile-stroke)') || css.includes('3px 3px 0 #151413'),
    'bundle.css must apply 3px 3px 0 tactile offset shadows to vocabulary cards'
  );

  // Pure black JMdict surface
  assert.ok(
    css.includes('.jmdict-card') && (css.includes('var(--pure-black)') || css.includes('#000000')),
    'bundle.css must style .jmdict-card with pure black background'
  );

  // Headword typography
  assert.ok(
    css.includes('.headword-kanji') && css.includes('var(--font-display)'),
    'bundle.css must style .headword-kanji with Zen Old Mincho (var(--font-display))'
  );

  // Responsive 2-column layout on wide screens, single-column on compact
  assert.ok(
    css.includes('.vocab-content-grid') && css.includes('grid-template-columns: 1fr'),
    'bundle.css must default .vocab-content-grid to single column stack'
  );
  assert.ok(
    css.includes('grid-template-columns: 1fr 1fr'),
    'bundle.css must expand .vocab-content-grid to 2 columns on wide screens'
  );

  // No legacy chocolate/orange colors
  const forbiddenColors = ['#26170d', '#ff8a1f', '#fff1dc'];
  for (const c of forbiddenColors) {
    assert.equal(
      css.toLowerCase().includes(c),
      false,
      `bundle.css must not contain legacy color "${c}"`
    );
  }
});

test('Vocab Main: Zero emojis across code, templates, and styles', () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  for (const filePath of [vocabMainPath, bundleCssPath]) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(emojiRegex);
    assert.equal(
      match,
      null,
      `Found forbidden emoji in ${path.basename(filePath)}: ${match?.[0]}`
    );
  }
});
