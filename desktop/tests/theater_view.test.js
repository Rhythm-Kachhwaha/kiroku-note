const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  TheaterViewController,
  KNOWN_DRM_HOSTS,
  DRM_PROTECTED_MESSAGE
} = require('../src/theater_view.js');

function createMockElectron() {
  class MockWebContents {
    constructor() {
      this.listeners = {};
      this.currentUrl = '';
      this.sentMessages = [];
      this.windowOpenHandler = null;
    }

    on(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    emit(event, ...args) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(fn => fn(...args));
      }
    }

    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    }

    loadURL(url) {
      this.currentUrl = url;
      return Promise.resolve();
    }

    send(channel, data) {
      this.sentMessages.push({ channel, data });
    }
  }

  class MockWebContentsView {
    constructor(options = {}) {
      this.options = options;
      this.webContents = new MockWebContents();
      this.bounds = null;
    }

    setBounds(b) {
      this.bounds = b;
    }
  }

  class MockBaseWindow {
    constructor() {
      this.children = [];
      this.contentView = {
        addChildView: (view) => this.children.push(view),
        removeChildView: (view) => {
          this.children = this.children.filter(v => v !== view);
        }
      };
    }
  }

  return {
    WebContentsView: MockWebContentsView,
    BaseWindow: MockBaseWindow
  };
}

describe('Slice 43 — Theater Tier 2 (Site in Kiroku, Non-DRM)', () => {
  it('creates WebContentsView with strict security options', () => {
    const mockElectron = createMockElectron();
    const controller = new TheaterViewController({
      electron: mockElectron,
      preloadPath: '/path/to/theater_preload.js'
    });

    const view = controller.initView();
    assert.ok(view);

    const prefs = view.options.webPreferences;
    assert.equal(prefs.sandbox, true, 'Sandbox must be true');
    assert.equal(prefs.contextIsolation, true, 'contextIsolation must be true');
    assert.equal(prefs.nodeIntegration, false, 'nodeIntegration must be false');
    assert.equal(prefs.partition, 'persist:theater', 'Partition must be persist:theater');
    assert.equal(prefs.preload, '/path/to/theater_preload.js');

    // setWindowOpenHandler must deny popups
    assert.ok(view.webContents.windowOpenHandler);
    const windowOpenResult = view.webContents.windowOpenHandler({ url: 'https://malicious.com' });
    assert.deepEqual(windowOpenResult, { action: 'deny' });
  });

  it('prompts and respects user approval on first host visit', async () => {
    const mockElectron = createMockElectron();
    let promptHostname = null;

    const controller = new TheaterViewController({
      electron: mockElectron,
      onAskHostApproval: async (hostname) => {
        promptHostname = hostname;
        return hostname === 'animestore.jp'; // only approve animestore.jp
      }
    });

    // 1. Visit approved host
    const res1 = await controller.openUrl('https://animestore.jp/watch/123');
    assert.equal(res1.ok, true);
    assert.equal(promptHostname, 'animestore.jp');
    assert.ok(controller.approvedHosts.has('animestore.jp'));

    // 2. Visit denied host
    const res2 = await controller.openUrl('https://sketchy-stream.net/video');
    assert.equal(res2.ok, false);
    assert.equal(res2.approved, false);
    assert.equal(controller.approvedHosts.has('sketchy-stream.net'), false);
  });

  it('guards navigation and redirects to unapproved hosts', async () => {
    const mockElectron = createMockElectron();
    let promptCount = 0;

    const controller = new TheaterViewController({
      electron: mockElectron,
      initialApprovedHosts: ['safe-site.com'],
      onAskHostApproval: async () => {
        promptCount++;
        return false; // Deny redirects
      }
    });

    controller.initView();
    const wc = controller.view.webContents;

    // Simulate navigation to unapproved host
    let prevented = false;
    const mockEvent = {
      preventDefault: () => { prevented = true; }
    };

    wc.emit('will-navigate', mockEvent, 'https://evil-redirect.com/login');
    assert.equal(prevented, true, 'Navigation to unapproved host must be prevented');
  });

  it('blocks known DRM hosts upfront and presents plain message', async () => {
    const mockElectron = createMockElectron();
    let drmNotification = null;

    const controller = new TheaterViewController({
      electron: mockElectron,
      onDrmDetected: (info) => {
        drmNotification = info;
      }
    });

    for (const host of ['netflix.com', 'www.disneyplus.com', 'hulu.com', 'primevideo.com']) {
      const res = await controller.openUrl(`https://${host}/title/800`);
      assert.equal(res.ok, false);
      assert.equal(res.drm, true);
      assert.equal(res.message, DRM_PROTECTED_MESSAGE);
      assert.equal(controller.isDrmProtected, true);
    }

    assert.ok(drmNotification);
    assert.equal(drmNotification.reason, 'known_drm_host');
  });

  it('handles runtime DRM detection from EME / encrypted events and closes view', () => {
    const mockElectron = createMockElectron();
    const mockWindow = new mockElectron.BaseWindow();
    let notified = null;

    const controller = new TheaterViewController({
      electron: mockElectron,
      mainWindow: mockWindow,
      onDrmDetected: (info) => {
        notified = info;
      }
    });

    controller.initView();
    controller.isOpen = true;
    mockWindow.contentView.addChildView(controller.view);

    // Simulate runtime EME notification
    const res = controller.handleDrmDetection({
      reason: 'eme_request:com.widevine.alpha',
      keySystem: 'com.widevine.alpha'
    });

    assert.equal(res.drm, true);
    assert.equal(res.message, DRM_PROTECTED_MESSAGE);
    assert.equal(controller.isOpen, false);
    assert.equal(mockWindow.children.length, 0, 'View must be removed from window on DRM detection');
    assert.equal(notified.message, DRM_PROTECTED_MESSAGE);
  });

  it('relays playback commands to WebContentsView bridge', async () => {
    const mockElectron = createMockElectron();
    const controller = new TheaterViewController({
      electron: mockElectron,
      initialApprovedHosts: ['approved-anime.com']
    });

    await controller.openUrl('https://approved-anime.com/ep1');

    const cmdRes = controller.sendCommand('cmd.play');
    assert.equal(cmdRes.ok, true);

    const messages = controller.view.webContents.sentMessages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].channel, 'theater:bridge:command');
    assert.equal(messages[0].data.cmd, 'cmd.play');
  });
});
