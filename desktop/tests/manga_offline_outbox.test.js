const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const storageJsPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'manga_storage.js');

test('manga_outbox: exports enqueue, peek, remove, and update outbox APIs in manga_storage', () => {
  const content = fs.readFileSync(storageJsPath, 'utf8');
  assert.ok(content.includes('export async function enqueueSyncOutbox'), 'must export enqueueSyncOutbox');
  assert.ok(content.includes('export async function peekSyncOutbox'), 'must export peekSyncOutbox');
  assert.ok(content.includes('export async function removeSyncOutbox'), 'must export removeSyncOutbox');
  assert.ok(content.includes('export async function updateSyncOutboxItem'), 'must export updateSyncOutboxItem');
});

test('manga_outbox: manga.js wires outbox enqueue for progress, strokes, and deletions', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes("enqueueSyncOutbox({\n        type: 'reading_progress'"), 'must enqueue reading_progress');
  assert.ok(content.includes("enqueueSyncOutbox({\n        type: 'annotations'"), 'must enqueue annotations');
  assert.ok(content.includes("enqueueSyncOutbox({\n        type: 'delete_annotations'"), 'must enqueue delete_annotations');
  assert.ok(content.includes('flushSyncOutbox'), 'must implement flushSyncOutbox');
  assert.ok(content.includes("window.addEventListener('online'"), 'must auto-flush outbox when online');
  assert.ok(content.includes("document.addEventListener('visibilitychange'"), 'must auto-flush outbox on visibility change');
});

test('manga_outbox: unit test of outbox persistence, FIFO ordering, and retry updates', async () => {
  const {
    enqueueSyncOutbox,
    peekSyncOutbox,
    removeSyncOutbox,
    updateSyncOutboxItem
  } = await import('../src/ui/services/manga_storage.js');

  const id1 = await enqueueSyncOutbox({
    type: 'reading_progress',
    bookId: 'book_alpha',
    payload: { page: 5 }
  });
  assert.ok(id1 && typeof id1 === 'string', 'Must generate outbox ID string');

  // Small delay to ensure timestamp difference
  await new Promise(r => setTimeout(r, 10));

  const id2 = await enqueueSyncOutbox({
    type: 'annotations',
    bookId: 'book_alpha',
    payload: { page: 5, strokeCount: 3 }
  });
  assert.ok(id2 && typeof id2 === 'string', 'Must generate second outbox ID string');

  // Peek should return both in FIFO order
  const peeked = await peekSyncOutbox(10);
  assert.ok(peeked.length >= 2, 'Must return at least the two enqueued items');

  const idx1 = peeked.findIndex(i => i.id === id1);
  const idx2 = peeked.findIndex(i => i.id === id2);
  assert.ok(idx1 >= 0 && idx2 >= 0, 'Both items must be present in outbox');
  assert.ok(idx1 < idx2, 'Earlier item must precede later item (FIFO)');

  // Test updating retry attempts
  await updateSyncOutboxItem(id1, { attempts: 1 });
  const peekedAfterUpdate = await peekSyncOutbox(10);
  const updatedItem1 = peekedAfterUpdate.find(i => i.id === id1);
  assert.equal(updatedItem1.attempts, 1, 'Attempts counter must be incremented');

  // Test removing processed items
  await removeSyncOutbox(id1);
  await removeSyncOutbox(id2);

  const peekedAfterRemove = await peekSyncOutbox(10);
  assert.ok(!peekedAfterRemove.some(i => i.id === id1), 'Item 1 must be removed');
  assert.ok(!peekedAfterRemove.some(i => i.id === id2), 'Item 2 must be removed');
});
