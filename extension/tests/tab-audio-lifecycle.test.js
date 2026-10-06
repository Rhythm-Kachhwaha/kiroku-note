const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Background Service Worker Tab Capture Handover Contract", async (t) => {
  const bgCode = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");

  await t.test("manifest declares action, commands, contextMenus, and tabCapture permissions", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
    assert.ok(manifest.permissions.includes("tabCapture"), "Must have tabCapture permission");
    assert.ok(manifest.permissions.includes("offscreen"), "Must have offscreen permission");
    assert.ok(manifest.permissions.includes("activeTab"), "Must have activeTab permission");
    assert.ok(manifest.permissions.includes("contextMenus"), "Must have contextMenus permission");
    assert.ok(manifest.action, "Must declare action");
    assert.ok(manifest.commands && manifest.commands["open-side-panel"], "Must declare open-side-panel command");
    assert.ok(manifest.commands && manifest.commands["capture-tab-audio"], "Must declare capture-tab-audio command");
  });

  await t.test("action.onClicked opens side panel and initiates tabCapture with streamId", async () => {
    let capturedStreamId = null;
    let sidePanelOpened = false;
    let offscreenMessage = null;
    let broadcastMessages = [];

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: (fn) => { mockChrome.runtime._onMessage = fn; } },
        sendMessage: async (msg) => {
          broadcastMessages.push(msg);
          if (msg.type === "START_PERSISTENT_CAPTURE") {
            offscreenMessage = msg;
            return { ok: true, state: "capturing" };
          }
          if (msg.type === "PING_OFFSCREEN") return { ok: true };
          return { ok: true };
        },
        getURL: (p) => `chrome-extension://test/${p}`
      },
      sidePanel: {
        open: async () => { sidePanelOpened = true; return true; },
        setPanelBehavior: async () => {}
      },
      action: {
        onClicked: {
          addListener: (fn) => { mockChrome.action._listener = fn; }
        }
      },
      commands: {
        onCommand: {
          addListener: (fn) => { mockChrome.commands._listener = fn; }
        }
      },
      contextMenus: {
        create: (opts) => { mockChrome.contextMenus._created = opts; },
        onClicked: {
          addListener: (fn) => { mockChrome.contextMenus._listener = fn; }
        }
      },
      tabCapture: {
        getMediaStreamId: async (opts) => {
          capturedStreamId = `stream_${opts.targetTabId}_abc123`;
          return capturedStreamId;
        }
      },
      tabs: {
        query: async () => [{ id: 101, windowId: 1, url: "https://www.youtube.com/watch?v=demo" }],
        sendMessage: async () => ({ ok: true }),
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      offscreen: {
        hasDocument: async () => true,
        createDocument: async () => {}
      },
      scripting: {
        executeScript: async () => {}
      }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(bgCode, sandbox);

    // Simulate clicking action button
    assert.equal(typeof mockChrome.action._listener, "function", "action.onClicked listener must be registered");
    await mockChrome.action._listener({ id: 101, windowId: 1, url: "https://www.youtube.com/watch?v=demo" });

    assert.ok(sidePanelOpened, "Side panel must be opened on action click");
    assert.equal(capturedStreamId, "stream_101_abc123", "tabCapture.getMediaStreamId must be called in user gesture");
    assert.ok(offscreenMessage && offscreenMessage.streamId === "stream_101_abc123", "START_PERSISTENT_CAPTURE must be sent with streamId");

    const stateBroadcast = broadcastMessages.find(m => m.type === "AUDIO_CAPTURE_STATE_CHANGED");
    assert.ok(stateBroadcast, "Must broadcast AUDIO_CAPTURE_STATE_CHANGED");
    assert.equal(stateBroadcast.state, "capturing");
    assert.equal(stateBroadcast.tabId, 101);
    assert.equal(stateBroadcast.capturing, true);
  });

  await t.test("commands.onCommand triggers user-initiated capture", async () => {
    let capturedStreamId = null;
    let sidePanelOpened = false;

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendMessage: async (msg) => {
          if (msg.type === "START_PERSISTENT_CAPTURE") return { ok: true, state: "capturing" };
          return { ok: true };
        },
        getURL: (p) => `chrome-extension://test/${p}`
      },
      sidePanel: {
        open: async () => { sidePanelOpened = true; return true; },
        setPanelBehavior: async () => {}
      },
      action: {
        onClicked: { addListener: () => {} }
      },
      commands: {
        onCommand: {
          addListener: (fn) => { mockChrome.commands._listener = fn; }
        }
      },
      contextMenus: {
        create: () => {},
        onClicked: { addListener: () => {} }
      },
      tabCapture: {
        getMediaStreamId: async (opts) => {
          capturedStreamId = `stream_${opts.targetTabId}_cmd`;
          return capturedStreamId;
        }
      },
      tabs: {
        query: async () => [{ id: 102, windowId: 1, url: "https://www.netflix.com/watch/123" }],
        sendMessage: async () => ({ ok: true }),
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      offscreen: {
        hasDocument: async () => true,
        createDocument: async () => {}
      },
      scripting: {
        executeScript: async () => {}
      }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(bgCode, sandbox);

    assert.equal(typeof mockChrome.commands._listener, "function", "commands.onCommand listener must be registered");
    await mockChrome.commands._listener("capture-tab-audio", { id: 102, windowId: 1, url: "https://www.netflix.com/watch/123" });

    assert.ok(sidePanelOpened, "Side panel must be opened on command");
    assert.equal(capturedStreamId, "stream_102_cmd", "tabCapture must acquire stream on command");
  });

  await t.test("contextMenus triggers capture for kiroku-connect-tab-audio", async () => {
    let capturedStreamId = null;

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: (fn) => { mockChrome.runtime._onInstalled = fn; } },
        onMessage: { addListener: () => {} },
        sendMessage: async (msg) => {
          if (msg.type === "START_PERSISTENT_CAPTURE") return { ok: true, state: "capturing" };
          return { ok: true };
        },
        getURL: (p) => `chrome-extension://test/${p}`
      },
      sidePanel: {
        open: async () => true,
        setPanelBehavior: async () => {}
      },
      action: {
        onClicked: { addListener: () => {} }
      },
      commands: {
        onCommand: { addListener: () => {} }
      },
      contextMenus: {
        create: (opts) => { mockChrome.contextMenus._item = opts; },
        onClicked: {
          addListener: (fn) => { mockChrome.contextMenus._listener = fn; }
        }
      },
      tabCapture: {
        getMediaStreamId: async (opts) => {
          capturedStreamId = `stream_${opts.targetTabId}_ctx`;
          return capturedStreamId;
        }
      },
      tabs: {
        query: async () => [{ id: 103, windowId: 1, url: "https://hianime.to/watch/ep-1" }],
        sendMessage: async () => ({ ok: true }),
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      offscreen: {
        hasDocument: async () => true,
        createDocument: async () => {}
      },
      scripting: {
        executeScript: async () => {}
      }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(bgCode, sandbox);

    if (mockChrome.runtime._onInstalled) {
      mockChrome.runtime._onInstalled();
    }
    assert.equal(mockChrome.contextMenus._item?.id, "kiroku-connect-tab-audio", "Context menu item must be created");

    assert.equal(typeof mockChrome.contextMenus._listener, "function", "contextMenus.onClicked listener must be registered");
    await mockChrome.contextMenus._listener(
      { menuItemId: "kiroku-connect-tab-audio" },
      { id: 103, windowId: 1, url: "https://hianime.to/watch/ep-1" }
    );

    assert.equal(capturedStreamId, "stream_103_ctx", "tabCapture must acquire stream on context menu click");
  });

  await t.test("restricted URLs (chrome://, about:, etc.) are rejected from capture", async () => {
    let capturedStreamId = null;

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendMessage: async () => ({ ok: true }),
        getURL: (p) => `chrome-extension://test/${p}`
      },
      sidePanel: {
        open: async () => true,
        setPanelBehavior: async () => {}
      },
      action: {
        onClicked: { addListener: (fn) => { mockChrome.action._listener = fn; } }
      },
      commands: { onCommand: { addListener: () => {} } },
      contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
      tabCapture: {
        getMediaStreamId: async (opts) => {
          capturedStreamId = `stream_${opts.targetTabId}`;
          return capturedStreamId;
        }
      },
      tabs: {
        query: async () => [{ id: 104, windowId: 1, url: "chrome://settings" }],
        sendMessage: async () => ({ ok: true }),
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      offscreen: {
        hasDocument: async () => true,
        createDocument: async () => {}
      },
      scripting: { executeScript: async () => {} }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(bgCode, sandbox);

    await mockChrome.action._listener({ id: 104, windowId: 1, url: "chrome://settings" });
    assert.equal(capturedStreamId, null, "Must not capture stream for chrome:// internal pages");
  });
});
