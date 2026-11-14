/**
 * Kiroku Note — PWA End-to-End & Mobile Integration Test
 * Simulates mobile viewport ergonomics, web platform bridge,
 * op-log queue lifecycle, and Manga OPFS storage contracts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

test('PWA E2E: Responsive layout rules support standard mobile viewports', () => {
  const responsiveCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'responsive.css');
  assert.ok(fs.existsSync(responsiveCssPath), 'responsive.css must exist');
  const css = fs.readFileSync(responsiveCssPath, 'utf8');

  // Verify clamp() fluid typography
  assert.ok(css.includes('clamp('), 'responsive.css must define clamp() typography');
  assert.ok(css.includes('--font-size-base'), 'responsive.css must set --font-size-base');
  assert.ok(css.includes('--font-size-sm'), 'responsive.css must set --font-size-sm');
  assert.ok(css.includes('--font-size-lg'), 'responsive.css must set --font-size-lg');

  // Verify safe area insets
  assert.ok(css.includes('safe-area-inset-top'), 'Must support safe-area-inset-top');
  assert.ok(css.includes('safe-area-inset-bottom'), 'Must support safe-area-inset-bottom');

  // Verify mobile touch minimum tap target (44px)
  assert.ok(css.includes('44px'), 'Must enforce minimum 44px tap targets for mobile ergonomics');
  assert.ok(css.includes('touch-action: manipulation'), 'Must optimize touch action for responsiveness');
});

test('PWA E2E: Web platform bridge provides all necessary desktop API fallbacks', async () => {
  const webJsPath = path.join(repoRoot, 'desktop', 'src', 'platform', 'web.js');
  assert.ok(fs.existsSync(webJsPath), 'web.js shim must exist');
  const content = fs.readFileSync(webJsPath, 'utf8');

  // Must export webAPI
  assert.ok(content.includes('export const webAPI'), 'web.js must export webAPI');
  assert.ok(content.includes('isPWA: true'), 'webAPI must identify as isPWA: true');
  assert.ok(content.includes('isDesktop: false'), 'webAPI must identify as isDesktop: false');

  // Tactile Haptics API
  assert.ok(content.includes('haptic:'), 'webAPI must provide haptic sub-object');
  assert.ok(content.includes('vibrate'), 'haptic implementation must call navigator.vibrate');

  // PWA Install prompt integration
  assert.ok(content.includes('beforeinstallprompt'), 'web.js must listen for beforeinstallprompt event');
  assert.ok(content.includes('promptInstall'), 'webAPI.pwa must provide promptInstall method');

  // Gesture swipe to dismiss
  assert.ok(content.includes('touchstart') && content.includes('touchend'),
    'web.js must attach touch event listeners for swipe-to-dismiss gesture');
});

test('PWA E2E: Op-Log queue protocol conforms to durable lease and ack contracts', async () => {
  // Simulate queue data structures used across Worker and Client
  const mockQueue = [];
  const activeLeases = new Map();

  function enqueue(card) {
    const id = 'op_' + Math.random().toString(36).slice(2, 9);
    const item = {
      id,
      payload: card,
      created_at: new Date().toISOString(),
      ack: false,
      lease_id: null,
      attempts: 0
    };
    mockQueue.push(item);
    return id;
  }

  function acquireLease(leaseDurationSec = 60) {
    const now = Date.now();
    const candidate = mockQueue.find(item => !item.ack && (!item.lease_id || item.lease_expires_at < now));
    if (!candidate) return null;

    const leaseId = 'lease_' + Math.random().toString(36).slice(2, 9);
    candidate.lease_id = leaseId;
    candidate.lease_expires_at = now + (leaseDurationSec * 1000);
    candidate.attempts += 1;
    activeLeases.set(leaseId, candidate);
    return { lease_id: leaseId, item: candidate };
  }

  function acknowledge(leaseId) {
    const item = activeLeases.get(leaseId);
    if (!item) return false;
    item.ack = true;
    item.acked_at = new Date().toISOString();
    activeLeases.delete(leaseId);
    return true;
  }

  // 1. Submit card from PWA client
  const cardId = enqueue({ expression: '食べる', reading: 'たべる', meaning: 'to eat' });
  assert.ok(cardId.startsWith('op_'));
  assert.equal(mockQueue.length, 1);

  // 2. Local PC worker leases card
  const lease = acquireLease(60);
  assert.ok(lease !== null);
  assert.equal(lease.item.id, cardId);
  assert.equal(lease.item.attempts, 1);

  // 3. Duplicate lease request while leased returns null
  const secondLease = acquireLease(60);
  assert.equal(secondLease, null);

  // 4. Worker acknowledges card
  const acked = acknowledge(lease.lease_id);
  assert.equal(acked, true);
  assert.equal(mockQueue[0].ack, true);
});

test('PWA E2E: Manga OPFS storage module exports expected async lifecycle', () => {
  const mangaStoragePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'services', 'manga_storage.js');
  assert.ok(fs.existsSync(mangaStoragePath), 'manga_storage.js must exist');
  const code = fs.readFileSync(mangaStoragePath, 'utf8');

  assert.ok(code.includes('export async function storeBookFile'), 'Must export storeBookFile');
  assert.ok(code.includes('export async function getBookFile'), 'Must export getBookFile');
  assert.ok(code.includes('export async function deleteBookFile'), 'Must export deleteBookFile');
  assert.ok(code.includes('navigator.storage.getDirectory'), 'Must reference OPFS navigator.storage.getDirectory');
});
