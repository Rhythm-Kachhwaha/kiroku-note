/**
 * desktop_auth_persistence.test.js
 * Verifies DesktopStore session persistence, auth token retention across restarts,
 * and elimination of client-side synthetic mock user generation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DesktopStore } = require('../src/store.js');

test('DesktopStore: auth session persistence across instances', (t) => {
  const tmpDir = path.join(os.tmpdir(), `kiroku_auth_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const storagePath = path.join(tmpDir, 'desktop-storage.json');

  t.after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  // 1. First instance writes session
  const store1 = new DesktopStore({ storagePath });
  const session = {
    token: 'krk_live_test_token_123',
    user: {
      id: 'usr_abc123',
      sub: 'usr_abc123',
      name: 'Rhythm',
      email: 'rhythm@example.com',
      authenticated: true,
      provider: 'google'
    },
    timestamp: Date.now()
  };

  store1.set({ kiroku_auth_session: session });
  assert.deepEqual(store1.get('kiroku_auth_session'), { kiroku_auth_session: session });

  // 2. Second instance (simulating app relaunch) reloads session
  const store2 = new DesktopStore({ storagePath });
  const loaded = store2.get('kiroku_auth_session');
  assert.ok(loaded);
  assert.equal(loaded.kiroku_auth_session.token, 'krk_live_test_token_123');
  assert.equal(loaded.kiroku_auth_session.user.id, 'usr_abc123');
  assert.equal(loaded.kiroku_auth_session.user.name, 'Rhythm');

  // 3. Clear session removes it from disk
  store2.remove('kiroku_auth_session');
  assert.equal(store2.get('kiroku_auth_session').kiroku_auth_session, undefined);

  // 4. Verify disk reflects removal
  const store3 = new DesktopStore({ storagePath });
  assert.equal(store3.get('kiroku_auth_session').kiroku_auth_session, undefined);
});

test('AuthModal and TopChrome: no synthetic mock users generated', async () => {
  const authModalPath = path.join(process.cwd(), 'desktop/src/ui/components/auth_modal.js');
  const code = fs.readFileSync(authModalPath, 'utf8');

  // Must not generate Date.now() fake users
  assert.ok(!code.includes("'auth0|' + Date.now()"), 'AuthModal must not fabricate auth0 mock users');
  assert.ok(!code.includes("'cloud_learner_' + Date.now()"), 'AuthModal must not fabricate cloud_learner mock users');
  assert.ok(!code.includes('learner@auth0.kiroku.note'), 'AuthModal must not fabricate fake auth0 emails');

  // TopChrome must check DesktopStore getSession before falling back
  const topChromePath = path.join(process.cwd(), 'desktop/src/ui/shell/top_chrome.js');
  const tcCode = fs.readFileSync(topChromePath, 'utf8');
  assert.ok(tcCode.includes('window.desktopAPI?.auth?.getSession'), 'TopChrome must check desktop session');
  assert.ok(tcCode.includes("window.location?.protocol !== 'file:'"), 'TopChrome must avoid fetching file:///auth/me');
});

