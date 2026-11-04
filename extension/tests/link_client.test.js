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
});
