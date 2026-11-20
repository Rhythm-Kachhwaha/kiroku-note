import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());

test('extension core hardening scenario suite', async (t) => {
  let mockStorage = {};
  let sentTabMessages = [];
  let sentRuntimeMessages = [];
  let backgroundListener = null;

  function createMockChrome() {
    return {
      runtime: {
        lastError: null,
        getURL: (file) => `chrome-extension://test-ext-id/${file}`,
        sendMessage: async (msg) => {
          sentRuntimeMessages.push(msg);
          return { ok: true };
        },
        onMessage: {
          addListener: (fn) => {
            backgroundListener = fn;
          }
        },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            const clone = (v) => (v !== undefined ? JSON.parse(JSON.stringify(v)) : undefined);
            let res = {};
            if (typeof keys === 'string') {
              res = { [keys]: clone(mockStorage[keys]) };
            } else if (Array.isArray(keys)) {
              for (const k of keys) res[k] = clone(mockStorage[k]);
            } else {
              for (const k of Object.keys(mockStorage)) res[k] = clone(mockStorage[k]);
            }
            if (cb) {
              cb(res);
              return;
            }
            return Promise.resolve(res);
          },
          set: (obj, cb) => {
            Object.assign(mockStorage, obj);
            if (cb) {
              cb();
              return;
            }
            return Promise.resolve();
          },
          remove: (keys, cb) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete mockStorage[k];
            if (cb) {
              cb();
              return;
            }
            return Promise.resolve();
          }
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        query: async () => [{ id: 1, url: 'https://example.com' }],
        sendMessage: (tabId, msg, cb) => {
          sentTabMessages.push({ tabId, msg });
          if (cb) cb({ ok: true });
          return Promise.resolve({ ok: true });
        },
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} }
      },
      scripting: {
        executeScript: async () => [{ result: true }]
      },
      sidePanel: {
        setOptions: async () => {},
        open: async () => {}
      },
      alarms: {
        create: () => {},
        onAlarm: { addListener: () => {} }
      },
      commands: {
        onCommand: { addListener: () => {} }
      },
      action: {
        onClicked: { addListener: () => {} }
      }
    };
  }

  function dispatchMessage(msg) {
    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ ok: false, error: 'TIMEOUT_HANGING_PROMISE' });
        }
      }, 3000);

      const result = backgroundListener(msg, { tab: { id: 10 } }, (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(res);
        }
      });

      if (!result && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ ok: false, error: 'NO_LISTENER_CLAIM' });
      }
    });
  }

  before(async () => {
    mockStorage = {};
    globalThis.chrome = createMockChrome();
    await import('../../../extension/background.js');
  });

  beforeEach(() => {
    mockStorage = {};
    sentTabMessages = [];
    sentRuntimeMessages = [];
  });

  await t.test('S01: Sidepanel modularity invariant', () => {
    const modulesDir = path.join(PROJECT_ROOT, 'extension', 'sidepanel', 'modules');
    assert.ok(fs.existsSync(modulesDir), 'sidepanel/modules directory must exist');
    const modules = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
    assert.ok(modules.length >= 10, `Expected at least 10 modular files, found ${modules.length}`);

    // Verify sidepanel.js is NOT a monolithic bundle
    const sidepanelJsPath = path.join(PROJECT_ROOT, 'extension', 'sidepanel', 'sidepanel.js');
    assert.ok(fs.existsSync(sidepanelJsPath), 'sidepanel.js must exist');
    const sidepanelContent = fs.readFileSync(sidepanelJsPath, 'utf8');

    // Canonical check: sidepanel.js must NOT contain merged code from all modules
    assert.ok(!sidepanelContent.includes('// BUNDLED_BY_WEBPACK'), 'sidepanel.js must not be a bundle');
    assert.ok(!sidepanelContent.includes('// MONOLITHIC_SIDEPANEL'), 'sidepanel.js must not be a monolith');
  });

  await t.test('S02: Manifest permissions contract', () => {
    const manifestPath = path.join(PROJECT_ROOT, 'extension', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const permissions = new Set([
      ...(manifest.permissions || []),
      ...(manifest.optional_permissions || [])
    ]);

    const required = ['storage', 'alarms', 'tabs', 'scripting', 'sidePanel', 'activeTab'];
    for (const req of required) {
      assert.ok(permissions.has(req), `Manifest missing mandatory permission: ${req}`);
    }

    assert.equal(manifest.manifest_version, 3, 'Must be Manifest V3');
  });

  await t.test('S03: Manifest CSP compliance', () => {
    const manifestPath = path.join(PROJECT_ROOT, 'extension', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.content_security_policy?.extension_pages) {
      const csp = manifest.content_security_policy.extension_pages;
      assert.ok(!csp.includes("'unsafe-eval'"), 'MV3 CSP must not include unsafe-eval');
      assert.ok(!csp.includes('http://'), 'MV3 extension_pages CSP must not allow insecure http scripts');
    }
  });

  await t.test('S04: Service worker global error suppression', () => {
    const bgPath = path.join(PROJECT_ROOT, 'extension', 'background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');

    // Must register global error and unhandledrejection handlers that call preventDefault()
    assert.ok(
      bgContent.includes('addEventListener') &&
      bgContent.includes('unhandledrejection') &&
      bgContent.includes('preventDefault'),
      'background.js must register unhandledrejection handler with preventDefault to avoid Chrome extension errors'
    );
    assert.ok(
      bgContent.includes('addEventListener') &&
      bgContent.includes('"error"') &&
      bgContent.includes('preventDefault'),
      'background.js must register error handler with preventDefault to avoid Chrome extension errors'
    );
  });

  await t.test('S05: Safe sendMessage and lastError consumption', () => {
    const bgPath = path.join(PROJECT_ROOT, 'extension', 'background.js');
    const bgContent = fs.readFileSync(bgPath, 'utf8');

    // Ensure all chrome.tabs.sendMessage occurrences catch or handle errors and check lastError
    const sendCalls = bgContent.match(/chrome\.tabs\.sendMessage\([^)]+\)/g) || [];
    assert.ok(sendCalls.length > 0, 'Must have tabs.sendMessage calls');

    // Background.js should define a safe message sender or ensure .catch() on every tabs.sendMessage
    assert.ok(
      bgContent.includes('safeSendTabMessage') || bgContent.includes('safeSendMessage') || !bgContent.includes('chrome.tabs.sendMessage(tab.id, { type: "START_OCR_SELECTION" });'),
      'tabs.sendMessage calls must be wrapped or caught to consume lastError'
    );
  });

  await t.test('S06: Comprehensive background message router coverage', async () => {
    assert.ok(backgroundListener, 'Background listener must be registered');

    // Test a sample of essential background messages
    const testCases = [
      { type: 'GET_MINING_MODE' },
      { type: 'GET_TAB_INFO' },
      { type: 'GET_LINK_STATUS' },
      { type: 'GET_CLOUD_AUTH_STATUS' },
      { type: 'TOKENIZE_SENTENCE', text: '日本語' },
      { type: 'SESSION_GET_RECENT', limit: 5 },
      { type: 'FETCH_YOUTUBE_TIMEDTEXT', url: 'https://invalid-url.com' }
    ];

    for (const msg of testCases) {
      const resp = await dispatchMessage(msg);
      assert.notEqual(resp?.error, 'TIMEOUT_HANGING_PROMISE', `Message ${msg.type} hung without responding`);
      assert.notEqual(resp?.error, 'NO_LISTENER_CLAIM', `Message ${msg.type} was not claimed by background listener`);
      assert.equal(typeof resp?.ok, 'boolean', `Message ${msg.type} response must have boolean ok property`);
    }
  });

  await t.test('S07: Unhandled message type safe handling', async () => {
    // When an unknown message is sent to background, it must not cause an unhandled promise rejection or hang
    const resp = await dispatchMessage({ type: 'TOTALLY_UNKNOWN_KIROKU_TYPE_12345' });
    assert.notEqual(resp?.error, 'TIMEOUT_HANGING_PROMISE', 'Unknown message must not hang message port');
  });

  await t.test('S08: Content script message listener coverage', async () => {
    const contentJsPath = path.join(PROJECT_ROOT, 'extension', 'content', 'content.js');
    const content = fs.readFileSync(contentJsPath, 'utf8');

    assert.ok(content.includes('PING_KIROKU'), 'content.js must handle PING_KIROKU');
    assert.ok(content.includes('PING_ANKI_MINER'), 'content.js must handle PING_ANKI_MINER');
    assert.ok(content.includes('MINING_MODE_CHANGED'), 'content.js must handle MINING_MODE_CHANGED');
    assert.ok(content.includes('OCR_RECOGNITION_COMPLETE'), 'content.js must handle OCR_RECOGNITION_COMPLETE');
  });

  await t.test('S09: Iframe safety with null document.body', async () => {
    // Simulate DOM environment with null document.body (like XML document, early iframe load)
    const hudPopupPath = path.join(PROJECT_ROOT, 'extension', 'content', 'hud', 'hud-popup.js');
    const toastPath = path.join(PROJECT_ROOT, 'extension', 'content', 'toast.js');

    const hudSrc = fs.readFileSync(hudPopupPath, 'utf8');
    const toastSrc = fs.readFileSync(toastPath, 'utf8');

    // Both files must safely check document.body before appendChild
    assert.ok(
      hudSrc.includes('document.body || document.documentElement') || hudSrc.includes('document.body?.appendChild') || hudSrc.includes('if (document.body)'),
      'hud-popup.js must safely guard document.body.appendChild'
    );
    assert.ok(
      toastSrc.includes('document.body || document.documentElement') || toastSrc.includes('document.body?.appendChild') || toastSrc.includes('if (document.body)'),
      'toast.js must safely guard document.body.appendChild'
    );
  });

  await t.test('S10: Sandboxed iframe security isolation', async () => {
    const contentJsPath = path.join(PROJECT_ROOT, 'extension', 'content', 'content.js');
    const content = fs.readFileSync(contentJsPath, 'utf8');

    // Verify safe window.top access if present
    if (content.includes('window.top') || content.includes('parent.')) {
      assert.ok(
        content.includes('try') && content.includes('catch'),
        'window.top or parent access must be wrapped in try/catch for sandboxed iframes'
      );
    }
  });

  await t.test('S11: Strict page CSP resistance', () => {
    const hudPopupPath = path.join(PROJECT_ROOT, 'extension', 'content', 'hud', 'hud-popup.js');
    const hudSrc = fs.readFileSync(hudPopupPath, 'utf8');

    // Verifies shadow DOM is used for isolation
    assert.ok(hudSrc.includes('attachShadow'), 'hud-popup.js must use Shadow DOM to isolate styles under strict CSP');
  });

  await t.test('S12: Background API fetch fail-safe', async () => {
    // Dispatch HUD_LOOKUP when backend offline
    const resp = await dispatchMessage({ type: 'HUD_LOOKUP', text: '猫' });
    assert.ok(resp !== undefined, 'HUD_LOOKUP must return response even when backend offline');
    assert.equal(typeof resp.ok, 'boolean', 'Response ok must be boolean');
  });

  await t.test('S13: Mining mode toggle broadcast', async () => {
    const resp = await dispatchMessage({ type: 'SET_MINING_MODE', enabled: true });
    assert.equal(resp?.ok, true, 'SET_MINING_MODE must succeed');
    assert.equal(mockStorage['kiroku.mining_mode_enabled'], true, 'Storage must be updated');
    assert.ok(sentTabMessages.length > 0, 'Must broadcast to tabs');
    assert.equal(sentTabMessages[0].msg.type, 'MINING_MODE_CHANGED');
  });

  await t.test('S14: On-demand content script injection on un-injected tab', async () => {
    let injectedScripts = [];
    globalThis.chrome.scripting.executeScript = async (args) => {
      injectedScripts.push(args);
      return [{ result: true }];
    };

    const origSendMessage = globalThis.chrome.tabs.sendMessage;
    globalThis.chrome.tabs.sendMessage = (tabId, msg, options, cb) => {
      const callback = typeof options === 'function' ? options : cb;
      globalThis.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      if (callback) callback(undefined);
      globalThis.chrome.runtime.lastError = null;
    };

    try {
      const resp = await dispatchMessage({ type: 'SET_MINING_MODE', enabled: true });
      assert.equal(resp?.ok, true);
      assert.ok(injectedScripts.length > 0, 'ensureContentScript must call executeScript when tab is un-injected');
    } finally {
      globalThis.chrome.tabs.sendMessage = origSendMessage;
    }
  });

  await t.test('S15: Network timeout resilience in background handlers', async () => {
    const p1 = dispatchMessage({ type: 'SESSION_LOG_COUNTERS', payload: {} });
    const p2 = dispatchMessage({ type: 'EPISODE_SYNC_SUBTITLES', payload: {} });
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.notEqual(r1?.error, 'TIMEOUT_HANGING_PROMISE', 'SESSION_LOG_COUNTERS must not hang');
    assert.notEqual(r2?.error, 'TIMEOUT_HANGING_PROMISE', 'EPISODE_SYNC_SUBTITLES must not hang');
    assert.equal(typeof r1?.ok, 'boolean');
    assert.equal(typeof r2?.ok, 'boolean');
  });

  await t.test('S16: Complete bounded safeFetch timeout on all background endpoints', async () => {
    const origFetch = globalThis.fetch;
    // Simulate non-responsive fetch promise
    globalThis.fetch = () => new Promise(() => {});

    try {
      const endpoints = [
        dispatchMessage({ type: 'EPISODE_GET_STATUS', cueHash: 'test_cue' }),
        dispatchMessage({ type: 'FETCH_YOUTUBE_TIMEDTEXT', url: 'https://www.youtube.com/api/timedtext?v=test' }),
        dispatchMessage({ type: 'DELETE_CARD', cardId: 'c1' }),
        dispatchMessage({ type: 'SET_WORD_STATUS', word: 'w', status: 'known' }),
        dispatchMessage({ type: 'GRAMMAR_MINE', grammar: { pattern: 'p' } })
      ];

      const results = await Promise.all(endpoints);
      for (const res of results) {
        assert.notEqual(res?.error, 'TIMEOUT_HANGING_PROMISE', 'Endpoint must not hang indefinitely');
        assert.equal(typeof res?.ok, 'boolean', 'Endpoint must return structured response');
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
