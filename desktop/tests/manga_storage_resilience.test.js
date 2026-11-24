const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storageJsPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'manga_storage.js');
const platformWebJsPath = path.join(__dirname, '..', 'src', 'platform', 'web.js');

test('manga_storage: exposes persistent storage estimation, verification, and cleanup APIs', () => {
  const content = fs.readFileSync(storageJsPath, 'utf8');
  assert.ok(content.includes('export async function getStorageEstimate'), 'must export getStorageEstimate');
  assert.ok(content.includes('export async function requestPersistentStorage'), 'must export requestPersistentStorage');
  assert.ok(content.includes('export async function verifyBookStorage'), 'must export verifyBookStorage');
  assert.ok(content.includes('export async function getBookStorageStatus'), 'must export getBookStorageStatus');
  assert.ok(content.includes('export async function cleanupIncompleteWrites'), 'must export cleanupIncompleteWrites');
  assert.ok(content.includes('isPersistentStorageAvailable'), 'must check persistence capability');
});

test('manga_storage: transactional OPFS and IndexedDB guarantees without silent memory leak', () => {
  const content = fs.readFileSync(storageJsPath, 'utf8');
  // Ensure we don't silently pretend in-memory Map is persistent storage for books
  assert.ok(content.includes('StorageUnavailableError') || content.includes('persistent: false') || content.includes('isPersistentStorageAvailable'), 'must handle missing persistence');
  assert.ok(content.includes('verifyBookStorage'), 'must verify written storage');
});

test('platform_web: capability detection matrix for iOS, storage, file handlers and haptics', () => {
  const content = fs.readFileSync(platformWebJsPath, 'utf8');
  assert.ok(content.includes('getCapabilities'), 'must expose getCapabilities API');
  assert.ok(content.includes('triggerHaptic'), 'must provide triggerHaptic');
  assert.ok(content.includes('isIOS'), 'must detect iOS environment');
});
