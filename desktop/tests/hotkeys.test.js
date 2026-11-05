/**
 * Tests for Global Hotkeys & Study-Pause (Slice 45).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const hotkeysModulePath = path.join(repoRoot, 'desktop', 'src', 'hotkeys.js');
const settingsViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'settings.js');
const mainPath = path.join(repoRoot, 'desktop', 'src', 'main.js');

const { HotkeyManager, DEFAULT_HOTKEYS_CONFIG, checkStudyPause } = require(hotkeysModulePath);

test('HotkeyManager: Default configuration invariants', () => {
  assert.equal(DEFAULT_HOTKEYS_CONFIG.enabled, false, 'Global hotkeys must default to OFF');
  assert.equal(DEFAULT_HOTKEYS_CONFIG.study_pause_enabled, false, 'Study-pause must default to OFF');
  assert.equal(DEFAULT_HOTKEYS_CONFIG.study_pause_gap_threshold, 2, 'Default gap word threshold must be 2');

  const shortcuts = DEFAULT_HOTKEYS_CONFIG.shortcuts;
  assert.ok(shortcuts['cmd.pause_play'], 'Must define pause/play shortcut');
  assert.ok(shortcuts['cmd.prev_cue'], 'Must define prev cue shortcut');
  assert.ok(shortcuts['cmd.next_cue'], 'Must define next cue shortcut');
  assert.ok(shortcuts['cmd.replay_cue'], 'Must define replay cue shortcut');
  assert.ok(shortcuts['cmd.loop'], 'Must define loop shortcut');
});

test('HotkeyManager: checkStudyPause logic', () => {
  // Disabled: never pauses
  assert.equal(checkStudyPause(5, 2, false), false);
  assert.equal(checkStudyPause(2, 2, false), false);

  // Enabled, default threshold 2:
  assert.equal(checkStudyPause(1, 2, true), false);
  assert.equal(checkStudyPause(2, 2, true), true);
  assert.equal(checkStudyPause(3, 2, true), true);

  // Custom threshold 3:
  assert.equal(checkStudyPause(2, 3, true), false);
  assert.equal(checkStudyPause(3, 3, true), true);
  assert.equal(checkStudyPause(4, 3, true), true);
});

test('HotkeyManager: Mock registration & dispatch', () => {
  const registered = new Map();
  const mockGlobalShortcut = {
    register: (accelerator, callback) => {
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      registered.delete(accelerator);
    },
    unregisterAll: () => {
      registered.clear();
    }
  };

  const sentMessages = [];
  const mockMainWindow = {
    webContents: {
      send: (channel, payload) => {
        sentMessages.push({ channel, payload });
      }
    }
  };

  // 1. When disabled, register does not hook shortcuts
  const manager = new HotkeyManager({
    globalShortcut: mockGlobalShortcut,
    getMainWindow: () => mockMainWindow,
    config: { enabled: false }
  });

  const resDisabled = manager.register();
  assert.equal(resDisabled, false);
  assert.equal(registered.size, 0);

  // 2. Enable and register
  manager.updateConfig({ enabled: true });
  assert.ok(registered.size >= 5, 'Should register at least 5 shortcuts');

  // 3. Trigger pause/play accelerator
  const pauseAccelerator = DEFAULT_HOTKEYS_CONFIG.shortcuts['cmd.pause_play'];
  const pauseCb = registered.get(pauseAccelerator);
  assert.ok(pauseCb, 'Pause shortcut callback must be registered');

  pauseCb();
  assert.ok(sentMessages.length >= 1, 'Should send IPC message to renderer');
  const found = sentMessages.find(m => m.payload?.command === 'cmd.pause_play');
  assert.ok(found, 'Payload must contain command cmd.pause_play');

  // 4. Trigger next cue
  const nextAccelerator = DEFAULT_HOTKEYS_CONFIG.shortcuts['cmd.next_cue'];
  const nextCb = registered.get(nextAccelerator);
  nextCb();
  const nextFound = sentMessages.find(m => m.payload?.command === 'cmd.next_cue');
  assert.ok(nextFound, 'Payload must contain command cmd.next_cue');

  // 5. Unregister
  manager.unregister();
  assert.equal(registered.size, 0, 'All shortcuts must be cleared on unregister');
});

test('Settings: Link section contains Global Hotkeys and Study-Pause rows', () => {
  const settingsCode = fs.readFileSync(settingsViewPath, 'utf8');

  // Global hotkeys row verification
  assert.ok(settingsCode.includes('Global Hotkeys'), 'Settings must include Global Hotkeys card');
  assert.ok(settingsCode.includes('setting-global-hotkeys-enabled'), 'Must include global hotkeys checkbox');
  assert.ok(settingsCode.includes('CmdOrCtrl+Alt+Space'), 'Must display pause/play shortcut');
  assert.ok(settingsCode.includes('CmdOrCtrl+Alt+Left'), 'Must display prev cue shortcut');
  assert.ok(settingsCode.includes('CmdOrCtrl+Alt+Right'), 'Must display next cue shortcut');
  assert.ok(settingsCode.includes('CmdOrCtrl+Alt+R'), 'Must display replay cue shortcut');
  assert.ok(settingsCode.includes('CmdOrCtrl+Alt+L'), 'Must display loop shortcut');

  // Study-pause row verification
  assert.ok(settingsCode.includes('Study-Pause'), 'Settings must include Study-Pause card');
  assert.ok(settingsCode.includes('setting-study-pause-enabled'), 'Must include study pause checkbox');
  assert.ok(settingsCode.includes('setting-study-pause-threshold'), 'Must include study pause threshold selector');
  assert.ok(settingsCode.includes('Pause when line has &gt;= N gap words'), 'Must include study pause string');
});

test('Main process: ONLY registers and unregisters HotkeyManager', () => {
  const mainCode = fs.readFileSync(mainPath, 'utf8');
  assert.ok(mainCode.includes("require('./hotkeys')"), 'Must import HotkeyManager in main.js');
  assert.ok(mainCode.includes('hotkeyManager.register()'), 'Must call hotkeyManager.register()');
  assert.ok(mainCode.includes('hotkeyManager.unregister()'), 'Must call hotkeyManager.unregister()');
});
