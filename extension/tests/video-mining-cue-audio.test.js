const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Video Mining POC Cue Audio Coordination", async (t) => {
  const pocCode = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

  function createTestEnvironment(customSendMessage) {
    let sentMessages = [];
    const mockChrome = {
      runtime: {
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          if (customSendMessage) {
            return await customSendMessage(msg);
          }
          return { ok: true };
        }
      },
      storage: {
        local: {
          get: (_k, cb) => (cb ? cb({}) : Promise.resolve({})),
          set: () => Promise.resolve(),
          remove: () => Promise.resolve()
        }
      }
    };

    class MockElement {
      constructor(tagName) {
        this.tagName = tagName ? tagName.toUpperCase() : "DIV";
        this.id = "";
        this.className = "";
        this.children = [];
        this.parentElement = null;
        this.style = {};
        this.textContent = "";
        this._attrs = {};
        this._listeners = {};
        this.isConnected = true;
        this.rect = { top: 100, left: 50, width: 800, height: 450 };
      }
      appendChild(c) {
        this.children.push(c);
        c.parentElement = this;
        return c;
      }
      insertBefore(newNode, refNode) {
        const idx = this.children.indexOf(refNode);
        if (idx !== -1) this.children.splice(idx, 0, newNode);
        else this.children.push(newNode);
        newNode.parentElement = this;
        return newNode;
      }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      setAttribute(k, v) { this._attrs[k] = v; }
      getAttribute(k) { return this._attrs[k]; }
      addEventListener(evt, fn) {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(fn);
      }
      removeEventListener(evt, fn) {
        if (this._listeners[evt]) {
          this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
        }
      }
      getBoundingClientRect() { return this.rect; }
      replaceChildren(...nodes) {
        this.children = [];
        this.textContent = "";
        nodes.forEach(n => {
          if (typeof n === "string") this.textContent += n;
          else this.appendChild(n);
        });
      }
    }

    const docBody = new MockElement("BODY");
    const doc = {
      body: docBody,
      createElement: (tag) => new MockElement(tag),
      createTextNode: (txt) => ({ textContent: txt }),
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const win = {
      devicePixelRatio: 1.0,
      addEventListener: () => {},
      removeEventListener: () => {},
      getSelection: () => null
    };

    class MockMutationObserver {
      observe() {}
      disconnect() {}
    }

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      document: doc,
      window: win,
      MutationObserver: MockMutationObserver,
      module: { exports: {} },
      sentMessages
    };
    sandbox.globalThis = sandbox;
    win.globalThis = sandbox;

    vm.runInNewContext(pocCode, sandbox);
    const pocInstance = win.__KIROKU_VIDEO_POC__?.instance || sandbox.module.exports?.instance;
    return { sandbox, pocInstance, sentMessages, mockChrome };
  }

  await t.test("recordSentenceAudio uses 16-bit Mono WAV format and forwards timelineId", async () => {
    let sentExtractMsg = null;
    let audioCapturedMsg = null;

    const { pocInstance, sentMessages } = createTestEnvironment(async (msg) => {
      if (msg.type === "EXTRACT_SUBTITLE_AUDIO") {
        sentExtractMsg = msg;
        return {
          ok: true,
          status: "READY",
          dataUrl: "data:audio/wav;base64,UklGR...",
          mimeType: "audio/wav",
          durationMs: 1400
        };
      }
      if (msg.type === "AUDIO_CAPTURED") {
        audioCapturedMsg = msg;
        return { ok: true };
      }
      return { ok: true };
    });

    pocInstance.activeVideo = { isConnected: true, paused: false, currentTime: 12.5 };
    pocInstance.timelineId = "tl_unit_test_99";

    const testCue = { startTime: 10.0, endTime: 12.0, text: "こんにちは世界" };
    const res = await pocInstance.recordSentenceAudio(testCue, { captureId: "cap_cue_101" });

    assert.ok(res.ok, "Extraction should succeed");
    assert.ok(sentExtractMsg, "Must send EXTRACT_SUBTITLE_AUDIO message");
    assert.equal(sentExtractMsg.type, "EXTRACT_SUBTITLE_AUDIO");
    assert.equal(sentExtractMsg.startTime, 10.0);
    assert.equal(sentExtractMsg.endTime, 12.0);
    assert.equal(sentExtractMsg.timelineId, "tl_unit_test_99");
    assert.equal(sentExtractMsg.preferredMimeType, "audio/wav", "Must specify preferredMimeType audio/wav");
    assert.ok(audioCapturedMsg, "Must broadcast AUDIO_CAPTURED message");
    assert.equal(audioCapturedMsg.mimeType, "audio/wav", "Must broadcast audio/wav format");
  });

  await t.test("JAPANESE_TEXT_CAPTURED passes cue, timelineId, and offset on subtitle hover", async () => {
    const { pocInstance, sentMessages, sandbox } = createTestEnvironment();
    pocInstance.timelineId = "tl_hover_42";
    pocInstance.syncEngine.offset = 0.25;

    const renderer = pocInstance.renderer;
    const testCue = { startTime: 5.0, endTime: 8.0, text: "日本語の勉強" };
    renderer.renderCue(testCue);

    // Mock extractJapaneseWordAtPosition
    sandbox.window.extractJapaneseWordAtPosition = () => "日本語";

    // Simulate click over subtitle
    renderer._boundSubtitleClick({ clientX: 100, clientY: 100 });

    const capturedMsg = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
    assert.ok(capturedMsg, "Must send JAPANESE_TEXT_CAPTURED on subtitle click");
    assert.equal(capturedMsg.text, "日本語");
    assert.equal(capturedMsg.source, "subtitle_click");
    assert.ok(capturedMsg.cue, "Must include cue object");
    assert.equal(capturedMsg.cue.text, "日本語の勉強");
    assert.equal(capturedMsg.timelineId, "tl_hover_42", "Must forward timelineId");
    assert.equal(capturedMsg.offset, 0.25, "Must forward offset");
  });

  await t.test("recordSentenceAudio fails soft with status broadcast when audio capture is offline", async () => {
    let statusMsg = null;

    const { pocInstance } = createTestEnvironment(async (msg) => {
      if (msg.type === "EXTRACT_SUBTITLE_AUDIO") {
        return {
          ok: false,
          error: "AUDIO_NOT_CONNECTED",
          message: "Tab audio capture is not active. Click Kiroku icon or press Alt+Shift+K to connect."
        };
      }
      if (msg.type === "AUDIO_CAPTURE_STATUS") {
        statusMsg = msg;
        return { ok: true };
      }
      return { ok: true };
    });

    pocInstance.activeVideo = { isConnected: true, paused: false, currentTime: 5.0 };
    const testCue = { startTime: 4.0, endTime: 6.0, text: "テスト" };

    const res = await pocInstance.recordSentenceAudio(testCue, { captureId: "cap_fail_soft" });

    assert.equal(res.ok, false);
    assert.equal(res.error, "AUDIO_NOT_CONNECTED");
    assert.ok(statusMsg, "Must broadcast AUDIO_CAPTURE_STATUS on failure");
    assert.equal(statusMsg.ok, false);
    assert.equal(statusMsg.error, "AUDIO_NOT_CONNECTED");
    assert.equal(statusMsg.captureId, "cap_fail_soft");
  });
});
