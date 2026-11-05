const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DesktopStore } = require('../src/store');

test('hardware_acceleration: DesktopStore supports getConfig and setConfig with defaults', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiroku-store-test-'));
  const testStoragePath = path.join(tmpDir, 'desktop-storage.json');

  const store = new DesktopStore({ storagePath: testStoragePath });
  assert.equal(typeof store.getConfig, 'function', 'store.getConfig should be a function');
  assert.equal(typeof store.setConfig, 'function', 'store.setConfig should be a function');

  // Default value when key not set
  assert.equal(store.getConfig('hardware_acceleration', true), true);

  // Set to false and verify persistence
  store.setConfig('hardware_acceleration', false);
  assert.equal(store.getConfig('hardware_acceleration', true), false);

  // Reload store from disk
  const reloaded = new DesktopStore({ storagePath: testStoragePath });
  assert.equal(reloaded.getConfig('hardware_acceleration', true), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('hardware_acceleration: main.js registers settings:restart-app and evaluates hardware_acceleration', () => {
  const mainJsPath = path.join(__dirname, '..', 'src', 'main.js');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  assert.ok(
    mainContent.includes('settings:restart-app'),
    'main.js must register settings:restart-app IPC handler'
  );
  assert.ok(
    mainContent.includes('hardware_acceleration'),
    'main.js must check hardware_acceleration configuration'
  );
  assert.ok(
    mainContent.includes('app.disableHardwareAcceleration'),
    'main.js must support disabling hardware acceleration'
  );
});

test('hardware_acceleration: settings.js renders toggle and restart affordance without emoji', () => {
  const settingsJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'settings.js');
  const settingsContent = fs.readFileSync(settingsJsPath, 'utf8');

  assert.ok(
    settingsContent.includes('toggle-hardware-acceleration'),
    'settings.js must render toggle-hardware-acceleration checkbox'
  );
  assert.ok(
    settingsContent.includes('btn-restart-app'),
    'settings.js must render btn-restart-app button'
  );
  assert.ok(
    settingsContent.includes('settings:restart-app') || settingsContent.includes('restartApp'),
    'settings.js must call restart action'
  );

  // No emoji check
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(settingsContent), false, 'settings.js must not contain emoji');
});

