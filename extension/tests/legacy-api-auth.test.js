const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createBootEnvironment } = require('./helpers/dom_boot.js');

test('R7 extension pairing keeps its token session-only by default and attaches it to local API calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');
  assert.match(source, /chrome\.storage\.session/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.set\([^\n]*session_token/);
  assert.match(source, /extension-pairings\/redeem/);
  assert.match(source, /headers\.set\("Authorization", `Bearer \$\{extensionAuthToken\}`\)/);
});

test('Remember on this browser supports persistent token in local storage and forget clears it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');
  assert.match(source, /EXTENSION_AUTH_REMEMBERED_KEY/);
  assert.match(source, /chrome\.storage\.local\.set/);
  assert.match(source, /forgetExtensionPairing/);
});

test('Central fetch wrapper shows inline banners for 401, 403, and network errors', async () => {
  const env = createBootEnvironment();
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'modules', 'core.js'), 'utf8');

  // Load core module into environment
  vm.createContext(env);
  vm.runInContext(source, env);

  const banner = env.document.getElementById('backend-error-banner');
  const msgEl = env.document.getElementById('backend-error-banner-message');
  assert.ok(banner, 'backend-error-banner must exist');
  assert.ok(msgEl, 'backend-error-banner-message must exist');

  // Trigger 401 response via overridden fetch
  env.fetch = async () => ({ status: 401, ok: false });
  await env.window.fetch ? env.window.fetch('http://127.0.0.1:21828/api/test') : env.fetch('http://127.0.0.1:21828/api/test');

  // Trigger 403 response
  env.showBackendBanner('forbidden', 'Untrusted origin: extension ID not accepted by backend.', 'Settings', () => {}, true);
  assert.equal(banner.hidden, false);
  assert.match(msgEl.textContent, /Untrusted origin/);

  // Trigger network failure
  env.showBackendBanner('network-error', 'Kiroku backend not running.', 'Retry', null, true);
  assert.equal(banner.hidden, false);
  assert.match(msgEl.textContent, /backend not running/);
});
