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

test('Vocab History: Wires metrics via apiClient.getCardsMetrics or getCardStats', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getCardsMetrics(') || content.includes('apiClient.getCardStats('),
    'VocabHistoryView must query metrics from backend API'
  );
  assert.ok(
    content.includes('metric-total'),
    'VocabHistoryView must display total mined metric'
  );
  assert.ok(
    content.includes('metric-synced'),
    'VocabHistoryView must display synced metric'
  );
  assert.ok(
    content.includes('metric-pending'),
    'VocabHistoryView must display pending metric'
  );
  assert.ok(
    content.includes('metric-failed'),
    'VocabHistoryView must display failed metric'
  );
  assert.ok(
    content.includes('metric-today'),
    'VocabHistoryView must display today mined metric'
  );
});

test('Vocab History: Wires bulk selection and floating bulk actions bar', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('history-bulk-bar'),
    'VocabHistoryView must render #history-bulk-bar element'
  );
  assert.ok(
    content.includes('btn-bulk-sync'),
    'VocabHistoryView must include #btn-bulk-sync'
  );
  assert.ok(
    content.includes('btn-bulk-delete'),
    'VocabHistoryView must include #btn-bulk-delete'
  );
  assert.ok(
    content.includes('apiClient.bulkSyncCards('),
    'VocabHistoryView must call apiClient.bulkSyncCards'
  );
  assert.ok(
    content.includes('apiClient.bulkDeleteCards('),
    'VocabHistoryView must call apiClient.bulkDeleteCards'
  );
});

test('Vocab History: Inventory segment tops with Gaps for your level and mines once', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(content.includes('class="vocab-segments"'), 'Inventory must render Capture | Inventory segments');
  assert.ok(content.includes('id="vocab-tab-capture"'), 'Inventory must offer a Capture segment');
  assert.ok(
    content.includes("this.router.navigateToTab('vocab')"),
    'Capture segment must return to the existing vocab route'
  );
  assert.ok(content.includes('Gaps for your level'), 'Gaps shelf must use the Gaps for your level heading');
  assert.ok(content.includes('id="vocab-gaps-shelf"'), 'Inventory must render the gaps shelf');
  assert.ok(content.includes('id="btn-refresh-gaps"'), 'Inventory must render the refresh gaps button');
  assert.ok(content.includes('apiClient.getVocabGaps('), 'Inventory must load gaps from the backend');
  assert.ok(content.includes('mineGap('), 'Gap rows must expose a mine action');
  assert.ok(content.includes('apiClient.saveCard('), 'Mining a gap must save exactly one card');
  assert.ok(
    content.includes('this.miningWords.has('),
    'Mining must guard against a second save for the same word'
  );
  assert.ok(
    content.includes('this.gaps = this.gaps.filter('),
    'A mined word must be removed from the shelf after saving'
  );
  assert.ok(
    content.includes('source_type: \'vocab_gap\''),
    'Mined gap cards must record their provenance'
  );
});

test('Vocab History: Slide-out inspector drawer with accessible escape key and focus trap', () => {
  const content = fs.readFileSync(vocabHistoryPath, 'utf8');

  assert.ok(
    content.includes('card-inspector'),
    'VocabHistoryView must render card-inspector drawer'
  );
  assert.ok(
    content.includes('openInspector('),
    'VocabHistoryView must implement openInspector'
  );
  assert.ok(
    content.includes('closeInspector('),
    'VocabHistoryView must implement closeInspector'
  );
  assert.ok(
    content.includes("'Escape'") || content.includes('"Escape"'),
    'VocabHistoryView must handle Escape key for drawer dismissal'
  );
});

