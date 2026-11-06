/**
 * Slice 38 Unit & Integration Tests: Desktop Link Client & Store
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const fixturesDir = path.resolve(__dirname, 'fixtures', 'link');

function loadFixture(filename) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, filename), 'utf8'));
}

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sentMessages = [];
    MockWebSocket.instances.push(this);

    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (typeof this.onopen === 'function') this.onopen();
      if (this._listeners['open']) {
        this._listeners['open'].forEach(fn => fn());
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

  close(code = 1000, reason = '') {
    this.readyState = 3; // CLOSED
    if (typeof this.onclose === 'function') this.onclose({ code, reason });
    if (this._listeners['close']) {
      this._listeners['close'].forEach(fn => fn({ code, reason }));
    }
  }

  simulateServerMessage(msgObj) {
    const data = JSON.stringify(msgObj);
    if (typeof this.onmessage === 'function') this.onmessage({ data });
    if (this._listeners['message']) {
      this._listeners['message'].forEach(fn => fn({ data }));
    }
  }
}
MockWebSocket.instances = [];

test('LinkClient: handshake hello and hello.ok authentication flow', async () => {
  MockWebSocket.instances = [];
  const { LinkClient } = await import('../src/ui/services/link_client.js');

  const client = new LinkClient({
    wsUrl: 'ws://127.0.0.1:21828/api/link/ws',
    token: 'test-desktop-control-token',
    clientId: 'kiroku-desktop/2.1.0',
    WebSocketClass: MockWebSocket
  });

  await client.start();
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.equal(MockWebSocket.instances.length, 1);
  const ws = MockWebSocket.instances[0];

  assert.equal(ws.sentMessages.length, 1, 'Client must send hello upon opening socket');
  const helloEnvelope = JSON.parse(ws.sentMessages[0]);
  assert.equal(helloEnvelope.v, 1);
  assert.equal(helloEnvelope.type, 'hello');
  assert.equal(helloEnvelope.src, 'desk');
  assert.equal(helloEnvelope.payload.role, 'desk');
  assert.equal(helloEnvelope.payload.token, 'test-desktop-control-token');

  // Server replies with hello.ok
  const helloOk = loadFixture('hello_ok.json');
  ws.simulateServerMessage(helloOk);

  assert.equal(client.authenticated, true, 'Client should be authenticated');
  assert.equal(client.status, 'connected');
  assert.equal(client.sid, helloOk.payload.sid);

  client.stop();
});

test('LinkClient: sendCommand constructs valid desk envelope', async () => {
  MockWebSocket.instances = [];
  const { LinkClient } = await import('../src/ui/services/link_client.js');

  const client = new LinkClient({
    wsUrl: 'ws://127.0.0.1:21828/api/link/ws',
    token: 'test-desktop-control-token',
    WebSocketClass: MockWebSocket
  });

  await client.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  const ws = MockWebSocket.instances[0];
  ws.simulateServerMessage(loadFixture('hello_ok.json'));

  // Send play and seek commands
  client.sendCommand('cmd.play', {});
  client.sendCommand('cmd.seek', { t: 42.5 });

  assert.equal(ws.sentMessages.length, 3); // hello + cmd.play + cmd.seek
  const playMsg = JSON.parse(ws.sentMessages[1]);
  assert.equal(playMsg.v, 1);
  assert.equal(playMsg.type, 'cmd.play');
  assert.equal(playMsg.src, 'desk');

  const seekMsg = JSON.parse(ws.sentMessages[2]);
  assert.equal(seekMsg.type, 'cmd.seek');
  assert.equal(seekMsg.payload.t, 42.5);

  // Invalid command rejection
  assert.throws(() => {
    client.sendCommand('invalid.action', {});
  }, /Invalid command type/);

  client.stop();
});

test('LinkStore: updates session, state, and cues from client events', async () => {
  MockWebSocket.instances = [];
  const { LinkClient } = await import('../src/ui/services/link_client.js');
  const { LinkStore } = await import('../src/ui/services/link_store.js');

  const client = new LinkClient({
    wsUrl: 'ws://127.0.0.1:21828/api/link/ws',
    token: 'test-desktop-control-token',
    WebSocketClass: MockWebSocket
  });

  const store = new LinkStore(client);

  await client.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  const ws = MockWebSocket.instances[0];
  ws.simulateServerMessage(loadFixture('hello_ok.json'));

  assert.equal(store.status, 'connected');

  // 1. Simulate video.attach
  const attachFixture = loadFixture('video_attach.json');
  ws.simulateServerMessage(attachFixture);

  assert.equal(store.sessions.size, 1);
  assert.equal(store.activeSession.site, attachFixture.payload.site);
  assert.equal(store.activeSession.title, attachFixture.payload.title);

  // 2. Simulate cue.list
  const cueListFixture = loadFixture('cue_list.json');
  ws.simulateServerMessage(cueListFixture);

  assert.equal(store.cues.length, cueListFixture.payload.cues.length);
  assert.equal(store.cueHash, cueListFixture.payload.hash);

  // 3. Simulate video.state (time matches first cue)
  const stateFixture = loadFixture('video_state.json');
  ws.simulateServerMessage(stateFixture);

  assert.equal(store.videoState.t, stateFixture.payload.t);
  assert.equal(store.videoState.paused, stateFixture.payload.paused);

  // 4. Simulate cue.active
  const cueActiveFixture = loadFixture('cue_active.json');
  ws.simulateServerMessage(cueActiveFixture);

  assert.equal(store.activeCueIndex, cueActiveFixture.payload.i);
  assert.ok(store.activeCue);
  assert.equal(store.activeCue.i, cueActiveFixture.payload.i);

  // 5. Test command delegation through store
  store.play();
  store.seek(10.5);

  const summary = store.getStatusSummary();
  assert.equal(summary.connected, true);
  assert.equal(summary.cueCount, cueListFixture.payload.cues.length);
  assert.equal(summary.activeSession.title, attachFixture.payload.title);

  client.stop();
});

test('LinkClient: sends heartbeat pings at interval when connected', async () => {
  MockWebSocket.instances = [];
  const { LinkClient } = await import('../src/ui/services/link_client.js');

  const client = new LinkClient({
    wsUrl: 'ws://127.0.0.1:21828/api/link/ws',
    token: 'test-token',
    heartbeatIntervalMs: 50,
    WebSocketClass: MockWebSocket
  });

  await client.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  const ws = MockWebSocket.instances[0];
  ws.simulateServerMessage(loadFixture('hello_ok.json'));

  assert.equal(client.authenticated, true);
  await new Promise(resolve => setTimeout(resolve, 120));

  const pingMessages = ws.sentMessages.map(m => JSON.parse(m)).filter(m => m.type === 'ping');
  assert.ok(pingMessages.length >= 1, 'Should have sent at least one ping');
  assert.equal(pingMessages[0].v, 1);
  assert.equal(pingMessages[0].src, 'desk');

  client.stop();
  const msgCountAfterStop = ws.sentMessages.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(ws.sentMessages.length, msgCountAfterStop, 'No pings sent after stop');
});
