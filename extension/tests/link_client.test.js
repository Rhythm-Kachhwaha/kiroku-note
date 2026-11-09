/**
 * Slice 37 Unit & Integration Tests: Extension Link Client & Bridge
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { LinkClient } = require(path.resolve(__dirname, "../link/link-client.js"));
const { LinkBridge } = require(path.resolve(__dirname, "../content/link-bridge.js"));

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sentMessages = [];
    MockWebSocket.instances.push(this);

    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (typeof this.onopen === "function") this.onopen();
      if (this._listeners["open"]) {
        this._listeners["open"].forEach(fn => fn());
      }
    }, 10);

    this._listeners = {};
  }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (typeof this.onclose === "function") this.onclose();
    if (this._listeners["close"]) {
      this._listeners["close"].forEach(fn => fn());
    }
  }

  simulateServerMessage(msgObj) {
    const data = JSON.stringify(msgObj);
    if (typeof this.onmessage === "function") this.onmessage({ data });
    if (this._listeners["message"]) {
      this._listeners["message"].forEach(fn => fn({ data }));
    }
  }
}
MockWebSocket.instances = [];

test("LinkClient: offline/unpaired behaves as silent no-op", async () => {
  MockWebSocket.instances = [];
  const client = new LinkClient({
    token: null,
    WebSocketClass: MockWebSocket
  });

  await client.start();
  assert.equal(client.connected, false, "Client must not connect without a token");
  assert.equal(MockWebSocket.instances.length, 0, "No WebSocket opened when token is absent");
});

test("LinkClient: handshake hello, authentication and heartbeat", async () => {
  MockWebSocket.instances = [];
  const client = new LinkClient({
    token: "ext-valid-token-123",
    clientId: "test-client-ext",
    heartbeatIntervalMs: 100,
    WebSocketClass: MockWebSocket
  });

  await client.start();
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.equal(MockWebSocket.instances.length, 1);
  const ws = MockWebSocket.instances[0];

  // Verify hello message was sent immediately on open
  assert.equal(ws.sentMessages.length, 1);
  const helloMsg = JSON.parse(ws.sentMessages[0]);
  assert.equal(helloMsg.type, "hello");
  assert.equal(helloMsg.src, "ext");
  assert.equal(helloMsg.payload.token, "ext-valid-token-123");
  assert.equal(helloMsg.payload.role, "ext");

  // Server replies hello.ok
  ws.simulateServerMessage({
    v: 1,
    id: "ok-1",
    ts: Date.now(),
    type: "hello.ok",
    src: "hub",
    payload: { client: "test-client-ext", role: "ext" }
  });

  assert.equal(client.authenticated, true);

  // Heartbeat triggers ping
  await new Promise(resolve => setTimeout(resolve, 150));
  const hasPing = ws.sentMessages.some(m => JSON.parse(m).type === "ping");
  assert.ok(hasPing, "Heartbeat ping must be sent when authenticated");

  // Test server ping -> client pong reply
  const pingLenBefore = ws.sentMessages.length;
  ws.simulateServerMessage({
    v: 1,
    id: "srv-ping-1",
    ts: Date.now(),
    type: "ping",
    src: "hub",
    payload: {}
  });

  const pongSent = ws.sentMessages.slice(pingLenBefore).some(m => JSON.parse(m).type === "pong");
  assert.ok(pongSent, "Client must respond with pong when server sends ping");

  client.stop();
});

test("LinkBridge: attaches to active video, emits video.attach and video.state", () => {
  const sentToBackground = [];
  const mockRuntime = {
    sendMessage: (msg) => {
      sentToBackground.push(msg);
      return Promise.resolve({ ok: true });
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {}
    }
  };

  const listeners = {};
  const mockVideo = {
    currentTime: 42.5,
    duration: 120.0,
    paused: false,
    playbackRate: 1.0,
    play: async () => {},
    pause: () => {},
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener: () => {}
  };

  const bridge = new LinkBridge({
    getVideoHelper: () => mockVideo,
    getPocInstance: () => ({
      syncEngine: {
        cues: [
          { startTime: 40.0, endTime: 45.0, text: "こんにちは", tokens: [] }
        ]
      }
    }),
    chromeRuntime: mockRuntime,
    isDrmSite: () => false
  });

  bridge.attachedTabId = 42;
  bridge._checkVideo();

  assert.equal(bridge.attached, true);
  const attachMsg = sentToBackground.find(m => m.linkType === "video.attach");
  assert.ok(attachMsg, "Must emit video.attach");
  assert.equal(attachMsg.payload.tab, 42);
  assert.equal(attachMsg.payload.duration, 120.0);
  assert.equal(attachMsg.payload.drm, false);

  const stateMsg = sentToBackground.find(m => m.linkType === "video.state");
  assert.ok(stateMsg, "Must emit video.state");
  assert.equal(stateMsg.payload.t, 42.5);
  assert.equal(stateMsg.payload.paused, false);

  bridge.stop();
});

test("LinkBridge: executes commands (cmd.play, cmd.pause, cmd.seek, cmd.jump)", () => {
  let playCalled = false;
  let pauseCalled = false;

  const mockVideo = {
    currentTime: 10.0,
    duration: 200.0,
    paused: true,
    play: async () => { playCalled = true; mockVideo.paused = false; },
    pause: () => { pauseCalled = true; mockVideo.paused = true; },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const bridge = new LinkBridge({
    getVideoHelper: () => mockVideo,
    getPocInstance: () => null,
    chromeRuntime: null,
    isDrmSite: () => false
  });

  bridge.activeVideo = mockVideo;
  bridge.attached = true;

  // cmd.play
  const playRes = bridge.executeCommand("cmd.play");
  assert.equal(playRes, true);
  assert.equal(playCalled, true);

  // cmd.pause
  const pauseRes = bridge.executeCommand("cmd.pause");
  assert.equal(pauseRes, true);
  assert.equal(pauseCalled, true);

  // cmd.seek
  const seekRes = bridge.executeCommand("cmd.seek", { t: 88.5 });
  assert.equal(seekRes, true);
  assert.equal(mockVideo.currentTime, 88.5);

  // cmd.jump
  const jumpRes = bridge.executeCommand("cmd.jump", { delta: -10 });
  assert.equal(jumpRes, true);
  assert.equal(mockVideo.currentTime, 78.5);

  // cmd.toggle
  mockVideo.paused = true;
  const toggleRes1 = bridge.executeCommand("cmd.toggle");
  assert.equal(toggleRes1, true);
  assert.equal(mockVideo.paused, false);
  const toggleRes2 = bridge.executeCommand("cmd.toggle");
  assert.equal(toggleRes2, true);
  assert.equal(mockVideo.paused, true);

  // cmd.rate
  const rateRes = bridge.executeCommand("cmd.rate", { v: 1.5 });
  assert.equal(rateRes, true);
  assert.equal(mockVideo.playbackRate, 1.5);

  // cmd.loop cleanly manages timeupdate listener
  const listeners = [];
  mockVideo.addEventListener = (ev, fn) => listeners.push({ ev, fn });
  mockVideo.removeEventListener = (ev, fn) => {
    const idx = listeners.findIndex(l => l.ev === ev && l.fn === fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
  bridge.executeCommand("cmd.loop", { s: 10, e: 15 });
  assert.equal(listeners.filter(l => l.ev === "timeupdate").length, 1);
  // Re-looping must clear previous listener before attaching new one
  bridge.executeCommand("cmd.loop", { s: 20, e: 25 });
  assert.equal(listeners.filter(l => l.ev === "timeupdate").length, 1);
  // Pausing must remove loop listener
  bridge.executeCommand("cmd.pause");
  assert.equal(listeners.filter(l => l.ev === "timeupdate").length, 0);
});

test("LinkBridge: cmd.seek supports relative delta seek (E5)", () => {
  const mockVideo = {
    currentTime: 25.0,
    duration: 300.0,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const bridge = new LinkBridge({
    getVideoHelper: () => mockVideo,
    getPocInstance: () => null,
    chromeRuntime: null,
    isDrmSite: () => false
  });
  bridge.activeVideo = mockVideo;
  bridge.attached = true;

  // Relative forward +5s
  const seekDeltaRes = bridge.executeCommand("cmd.seek", { delta: 5 });
  assert.equal(seekDeltaRes, true);
  assert.equal(mockVideo.currentTime, 30.0);

  // Relative backward -10s
  bridge.executeCommand("cmd.seek", { delta: -10 });
  assert.equal(mockVideo.currentTime, 20.0);

  // Absolute seek
  bridge.executeCommand("cmd.seek", { t: 50.0 });
  assert.equal(mockVideo.currentTime, 50.0);
});

test("LinkBridge: _emitCueList formats cues with {i, s, e, text} and hash (E2)", () => {
  const sentToBackground = [];
  const mockRuntime = {
    sendMessage: (msg) => {
      sentToBackground.push(msg);
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener: () => {}, removeListener: () => {} }
  };

  const mockCues = [
    { startTime: 1.5, endTime: 3.0, text: "テスト字幕", tokens: [{ surface: "テスト" }] },
    { startTime: 4.0, endTime: 6.5, rawText: "二行目", tokens: [] }
  ];

  const bridge = new LinkBridge({
    getVideoHelper: () => ({ duration: 100, addEventListener: () => {}, removeEventListener: () => {} }),
    getPocInstance: () => ({
      syncEngine: { cues: mockCues }
    }),
    chromeRuntime: mockRuntime,
    isDrmSite: () => false
  });

  bridge.attachedTabId = 7;
  bridge._emitCueList();

  const cueListMsg = sentToBackground.find(m => m.linkType === "cue.list");
  assert.ok(cueListMsg, "Must emit cue.list");
  assert.equal(cueListMsg.payload.tab, 7);
  assert.ok(typeof cueListMsg.payload.hash === "string" && cueListMsg.payload.hash.length > 0, "hash must be non-empty string");
  assert.equal(cueListMsg.payload.cues.length, 2);

  const firstCue = cueListMsg.payload.cues[0];
  assert.equal(firstCue.i, 0);
  assert.equal(firstCue.s, 1.5);
  assert.equal(firstCue.e, 3.0);
  assert.equal(firstCue.text, "テスト字幕");
  assert.equal(firstCue.tokens, undefined, "tokens must be omitted per CueItem schema");

  const secondCue = cueListMsg.payload.cues[1];
  assert.equal(secondCue.i, 1);
  assert.equal(secondCue.s, 4.0);
  assert.equal(secondCue.e, 6.5);
  assert.equal(secondCue.text, "二行目");
});

test("LinkBridge: emitActiveCue sends {tab, i, secondary_text} without extra wrapper (E3)", () => {
  const sentToBackground = [];
  const mockRuntime = {
    sendMessage: (msg) => {
      sentToBackground.push(msg);
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener: () => {}, removeListener: () => {} }
  };

  const bridge = new LinkBridge({
    getVideoHelper: () => null,
    getPocInstance: () => null,
    chromeRuntime: mockRuntime,
    isDrmSite: () => false
  });
  bridge.attachedTabId = 12;

  // Active cue present
  bridge.emitActiveCue({ id: 3, startTime: 10, endTime: 15, text: "台詞", secondary_text: "subtitle EN" });
  assert.equal(sentToBackground.length, 1);
  const activeMsg = sentToBackground[0];
  assert.equal(activeMsg.linkType, "cue.active");
  assert.equal(activeMsg.payload.tab, 12);
  assert.equal(activeMsg.payload.i, 3);
  assert.equal(activeMsg.payload.secondary_text, "subtitle EN");
  assert.equal(activeMsg.payload.cue, undefined, "nested cue wrapper must be absent");

  // Active cue cleared (null)
  bridge.emitActiveCue(null);
  assert.equal(sentToBackground.length, 2);
  const clearMsg = sentToBackground[1];
  assert.equal(clearMsg.payload.tab, 12);
  assert.equal(clearMsg.payload.i, null);
  assert.equal(clearMsg.payload.secondary_text, null);
});

test("LinkBridge: fallback title for video.attach when document.title is empty (E4)", () => {
  const bridge = new LinkBridge({
    getVideoHelper: () => null,
    getPocInstance: () => null,
    chromeRuntime: null,
    isDrmSite: () => false
  });

  const title = bridge._getVideoTitle();
  assert.ok(typeof title === "string" && title.length >= 1, "Title must be at least min_length 1");
});

test("LinkBridge: handles SUBTITLE_CUE_CHANGED runtime message via LINK_CMD (E7)", () => {
  let emittedCue = null;
  const bridge = new LinkBridge({
    getVideoHelper: () => null,
    getPocInstance: () => null,
    chromeRuntime: null,
    isDrmSite: () => false
  });
  bridge.emitActiveCue = (cue) => {
    emittedCue = cue;
  };

  bridge._handleRuntimeMessage({
    type: "LINK_CMD",
    cmdType: "SUBTITLE_CUE_CHANGED",
    payload: {
      cue: { id: 5, text: "リレー確認" }
    }
  });

  assert.ok(emittedCue, "emitActiveCue must be called when LINK_CMD SUBTITLE_CUE_CHANGED arrives");
  assert.equal(emittedCue.id, 5);
  assert.equal(emittedCue.text, "リレー確認");
});

test("LinkBridge: auto-start inside IIFE attaches to window.__kirokuLinkBridge (E1)", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const bridgeSrc = fs.readFileSync(path.resolve(__dirname, "../content/link-bridge.js"), "utf8");

  const mockWindow = {};
  const ctx = {
    window: mockWindow,
    globalThis: mockWindow,
    document: { title: "Test Window" },
    location: { hostname: "test.com" },
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: () => {}, removeListener: () => {} }
      }
    },
    setInterval: () => 1,
    clearInterval: () => {}
  };

  vm.runInNewContext(bridgeSrc, ctx);
  assert.ok(mockWindow.__kirokuLinkBridge, "window.__kirokuLinkBridge must be instantiated and attached");
  assert.equal(typeof mockWindow.__kirokuLinkBridge.executeCommand, "function");
});

test("background.js: VIDEO_MINING_SCRIPTS includes link/clip.js and relays SUBTITLE_CUE_CHANGED (E6, E7, E8)", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const bgSrc = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");

  let messageListener = null;
  const sentTabMessages = [];
  const moduleObj = { exports: {} };

  const ctx = {
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: {
          addListener: (fn) => { messageListener = fn; }
        },
        sendMessage: () => Promise.resolve(),
      },
      tabs: {
        query: () => Promise.resolve([]),
        onActivated: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        sendMessage: (tabId, msg) => {
          sentTabMessages.push({ tabId, msg });
          return Promise.resolve({ ok: true });
        }
      },
      sidePanel: { setPanelBehavior: () => Promise.resolve() },
      scripting: { executeScript: () => Promise.resolve() },
      storage: { local: { set: () => {}, remove: () => {}, get: () => Promise.resolve({}) } },
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
    URL,
    module: moduleObj
  };

  vm.runInNewContext(bgSrc, ctx);

  // E8: VIDEO_MINING_SCRIPTS check
  const scripts = moduleObj.exports.VIDEO_MINING_SCRIPTS;
  assert.ok(Array.isArray(scripts), "VIDEO_MINING_SCRIPTS must be an array");
  assert.ok(scripts.includes("link/clip.js"), "VIDEO_MINING_SCRIPTS must contain link/clip.js");

  // E7: SUBTITLE_CUE_CHANGED relay check
  assert.ok(typeof messageListener === "function", "Message listener must be registered");
  let responseVal = null;
  const handled = messageListener(
    { type: "SUBTITLE_CUE_CHANGED", cue: { id: 1, text: "字幕" } },
    { tab: { id: 99 } },
    (resp) => { responseVal = resp; }
  );

  assert.equal(handled, true);
  assert.equal(responseVal?.ok, true);
  assert.equal(sentTabMessages.length, 1);
  assert.equal(sentTabMessages[0].tabId, 99);
  assert.equal(sentTabMessages[0].msg.type, "LINK_CMD");
  assert.equal(sentTabMessages[0].msg.cmdType, "SUBTITLE_CUE_CHANGED");
  assert.equal(sentTabMessages[0].msg.payload.type, "SUBTITLE_CUE_CHANGED");
});
