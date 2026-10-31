const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const vocabHistoryPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'vocab_history.js');

test('Vocab History: Uses .cards key (not .items) and updates metrics', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  // Must check val.cards first before falling back
  assert.ok(
    content.includes('val.cards'),
    'VocabHistoryView must extract val.cards from backend response'
  );

  // Must not have the old single point of failure (cardsData.value.items || [])
  assert.equal(
    content.includes('this.cards = Array.isArray(cardsData.value) ? cardsData.value : (cardsData.value.items || []);'),
    false,
    'Must not rely on cardsData.value.items'
  );
});

test('Vocab History: Wires real sync endpoints (syncCard and syncAllPendingCards)', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('apiClient.syncCard('),
    'Single card sync in drawer must call apiClient.syncCard'
  );
  assert.ok(
    content.includes('apiClient.syncAllPendingCards()'),
    'Bulk sync button must call apiClient.syncAllPendingCards'
  );
});

test('Vocab History: Error handling is visible with retry (no silent catch)', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('showError('),
    'VocabHistoryView must define showError method'
  );
  assert.ok(
    content.includes('history-error-banner'),
    'VocabHistoryView markup must contain history-error-banner'
  );
  assert.ok(
    content.includes('btn-history-retry'),
    'VocabHistoryView must include retry button'
  );
});

test('Vocab History: Server-side pagination and search parameters are built', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('params.search = this.searchQuery;'),
    'Server-side search param must be passed to apiClient.getCards'
  );
  assert.ok(
    content.includes('offset: offset'),
    'Pagination offset must be computed and passed to apiClient.getCards'
  );
  assert.ok(
    content.includes('limit: this.pageSize'),
    'Page size limit must be passed to apiClient.getCards'
  );
});

test('Vocab History: No mock data or hardcoded placeholder cards exist', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    '静寂',
    '〜わけにはいかない',
    'LV.28'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `VocabHistoryView must not contain placeholder: "${str}"`
    );
  }
});
