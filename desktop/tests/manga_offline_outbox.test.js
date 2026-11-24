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

test('manga_outbox: flushSyncOutbox handles HTTP 400, 500, network error, and idempotent 404 deletion', async () => {
  // Setup minimal DOM/storage globals for MangaView constructor in Node test environment
  if (typeof globalThis.localStorage === 'undefined') {
    const memMap = new Map();
    globalThis.localStorage = {
      getItem: (k) => memMap.get(k) || null,
      setItem: (k, v) => memMap.set(k, String(v)),
      removeItem: (k) => memMap.delete(k),
      clear: () => memMap.clear()
    };
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  const {
    enqueueSyncOutbox,
    peekSyncOutbox,
    removeSyncOutbox
  } = await import('../src/ui/services/manga_storage.js');
  const MangaViewModule = await import('../src/ui/views/manga.js');
  const MangaView = MangaViewModule.MangaView || MangaViewModule.default;

  const instance = new MangaView();
  instance._isFlushingOutbox = false;

  // Clear existing outbox items for clean test run
  const existing = await peekSyncOutbox(100);
  for (const e of existing) await removeSyncOutbox(e.id);

  // 1. Success case: item is removed on server ok: true
  const successId = await enqueueSyncOutbox({
    type: 'reading_progress',
    bookId: 'book_test_success',
    payload: { page: 1 }
  });

  instance.apiClient = {
    request: async (url, opts) => {
      return { ok: true, success: true };
    }
  };

  await instance.flushSyncOutbox();
  let remaining = await peekSyncOutbox(10);
  assert.ok(!remaining.some(i => i.id === successId), 'Acknowledged item must be removed from outbox');

  // 2. HTTP 400 Client error: item is kept, attempts incremented, error status stored
  const badId = await enqueueSyncOutbox({
    type: 'reading_progress',
    bookId: 'book_test_400',
    payload: { page: -99 }
  });

  instance.apiClient = {
    request: async () => {
      const err = new Error('Bad Request: Invalid page');
      err.status = 400;
      throw err;
    }
  };

  await instance.flushSyncOutbox();
  remaining = await peekSyncOutbox(10);
  const badItem = remaining.find(i => i.id === badId);
  assert.ok(badItem, 'Item with HTTP 400 must NOT be removed from outbox');
  assert.equal(badItem.attempts, 1);
  assert.equal(badItem.lastStatus, 400);
  await removeSyncOutbox(badId);

  // 3. HTTP 500 Server error / network failure: item kept for retry
  const serverErrId = await enqueueSyncOutbox({
    type: 'annotations',
    bookId: 'book_test_500',
    payload: { strokes: [] }
  });

  instance.apiClient = {
    request: async () => {
      const err = new Error('Internal Server Error');
      err.status = 500;
      throw err;
    }
  };

  await instance.flushSyncOutbox();
  remaining = await peekSyncOutbox(10);
  const serverItem = remaining.find(i => i.id === serverErrId);
  assert.ok(serverItem, 'Item with HTTP 500 must remain in outbox for retry');
  assert.equal(serverItem.attempts, 1);
  await removeSyncOutbox(serverErrId);

  // 4. Idempotent deletion on 404 (already deleted): treated as success and removed
  const delId = await enqueueSyncOutbox({
    type: 'delete_annotations',
    bookId: 'book_test_del_404',
    payload: { pageNum: 10 }
  });

  instance.apiClient = {
    request: async () => {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    }
  };

  await instance.flushSyncOutbox();
  remaining = await peekSyncOutbox(10);
  assert.ok(!remaining.some(i => i.id === delId), 'Idempotent 404 deletion must be acknowledged and removed');
});
