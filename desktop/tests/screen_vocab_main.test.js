const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const vocabMainPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_main.js');

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

