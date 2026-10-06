const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

test("Offscreen Capture Engine Hardening", async (t) => {
  const offscreenCode = fs.readFileSync(path.resolve(__dirname, "../offscreen/offscreen.js"), "utf8");
  const offscreenDir = path.resolve(__dirname, "../offscreen");
  const offscreenRequire = (id) => id.startsWith("./")
    ? require(path.resolve(offscreenDir, id))
    : require(id);

  await t.test("AudioContext automatically resumes if created in suspended state", async () => {
    let resumed = false;
    let connectedToDestination = false;
    let workletModuleLoaded = null;

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.sampleRate = 48000;
        this.destination = { id: "speaker-output" };
        this.audioWorklet = {
          addModule: async (modPath) => {
            workletModuleLoaded = modPath;
          }
        };
      }
      async resume() {
        resumed = true;
        this.state = "running";
      }
      createMediaStreamSource() {
        return {
          connect: (dest) => {
            if (dest === this.destination) connectedToDestination = true;
          },
          disconnect: () => {}
        };
      }
    }

    const sandbox = {
      window: { AudioContext: MockAudioContext },
      AudioContext: MockAudioContext,
      AudioWorkletNode: class {
        constructor() { this.port = { onmessage: null, postMessage: () => {} }; }
        disconnect() {}
      },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [{ onended: null, stop: () => {} }]
          })
        }
      },
      chrome: {
        runtime: {
          getURL: (p) => `chrome-extension://mock-id/${p}`,
          onMessage: { addListener: () => {} },
          sendMessage: async () => ({ ok: true })
        }
      },
      console,
      require: offscreenRequire,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(offscreenCode, sandbox);
    const { PersistentAudioCaptureEngine } = sandbox.module.exports;
    const engine = new PersistentAudioCaptureEngine({
      AudioContextClass: MockAudioContext,
      AudioWorkletNodeClass: sandbox.AudioWorkletNode,
      getUserMedia: sandbox.navigator.mediaDevices.getUserMedia
    });

    const res = await engine.startCapture({ streamId: "mock_stream_123" });
    assert.ok(res.ok, "Engine should start successfully");
    assert.ok(resumed, "AudioContext must be resumed from suspended state");
    assert.ok(connectedToDestination, "Stream must be mirrored to destination (speakers)");
    assert.equal(workletModuleLoaded, "chrome-extension://mock-id/offscreen/pcm-worklet-processor.js");
    assert.equal(engine.isMirroring, true, "isMirroring flag must be true");
  });

  await t.test("AudioContext statechange handles suspended state and attempts auto-resume", async () => {
    let resumeAttempts = 0;
    let stateChangeHandler = null;

    class MockAudioContext {
      constructor() {
        this.state = "running";
        this.sampleRate = 48000;
        this.destination = {};
        this.audioWorklet = { addModule: async () => {} };
      }
      addEventListener(event, fn) {
        if (event === "statechange") stateChangeHandler = fn;
      }
      async resume() {
        resumeAttempts++;
        this.state = "running";
      }
      createMediaStreamSource() {
        return { connect: () => {}, disconnect: () => {} };
      }
    }

    const sandbox = {
      window: { AudioContext: MockAudioContext },
      AudioContext: MockAudioContext,
      AudioWorkletNode: class {
        constructor() { this.port = { onmessage: null, postMessage: () => {} }; }
        disconnect() {}
      },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [{ onended: null, stop: () => {} }]
          })
        }
      },
      chrome: {
        runtime: {
          getURL: (p) => p,
          onMessage: { addListener: () => {} },
          sendMessage: async () => ({ ok: true })
        }
      },
      console,
      require: offscreenRequire,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(offscreenCode, sandbox);
    const { PersistentAudioCaptureEngine, CaptureState } = sandbox.module.exports;
    const engine = new PersistentAudioCaptureEngine({
      AudioContextClass: MockAudioContext,
      AudioWorkletNodeClass: sandbox.AudioWorkletNode,
      getUserMedia: sandbox.navigator.mediaDevices.getUserMedia
    });

    await engine.startCapture({ streamId: "mock_stream_456" });
    assert.equal(engine.state, CaptureState.CAPTURING);
    assert.ok(stateChangeHandler, "statechange listener must be registered");

    // Simulate browser power-saving suspension
    engine.audioContext.state = "suspended";
    stateChangeHandler();
    assert.equal(engine.state, CaptureState.PAUSED);
    assert.ok(resumeAttempts > 0, "Engine must attempt to auto-resume suspended AudioContext");
  });

  await t.test("ensureAudioContextRunning method exists and resumes suspended context", async () => {
    let resumed = false;

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.sampleRate = 48000;
        this.destination = {};
        this.audioWorklet = { addModule: async () => {} };
      }
      async resume() {
        resumed = true;
        this.state = "running";
      }
      createMediaStreamSource() {
        return { connect: () => {}, disconnect: () => {} };
      }
    }

    const sandbox = {
      window: { AudioContext: MockAudioContext },
      AudioContext: MockAudioContext,
      AudioWorkletNode: class {
        constructor() { this.port = { onmessage: null, postMessage: () => {} }; }
        disconnect() {}
      },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [{ onended: null, stop: () => {} }]
          })
        }
      },
      chrome: {
        runtime: {
          getURL: (p) => p,
          onMessage: { addListener: () => {} },
          sendMessage: async () => ({ ok: true })
        }
      },
      console,
      require: offscreenRequire,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(offscreenCode, sandbox);
    const { PersistentAudioCaptureEngine } = sandbox.module.exports;
    const engine = new PersistentAudioCaptureEngine({
      AudioContextClass: MockAudioContext,
      AudioWorkletNodeClass: sandbox.AudioWorkletNode,
      getUserMedia: sandbox.navigator.mediaDevices.getUserMedia
    });

    assert.equal(typeof engine.ensureAudioContextRunning, "function", "ensureAudioContextRunning must be implemented");
    engine.audioContext = new MockAudioContext();
    await engine.ensureAudioContextRunning();
    assert.ok(resumed, "ensureAudioContextRunning must resume suspended context");
  });

  await t.test("EXTRACT_SUBTITLE_AUDIO message handler ensures AudioContext is running before extraction", async () => {
    let capturedListener = null;
    let resumeCalled = false;

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.sampleRate = 48000;
        this.destination = {};
      }
      async resume() {
        resumeCalled = true;
        this.state = "running";
      }
    }

    const mockChrome = {
      runtime: {
        onMessage: {
          addListener: (fn) => { capturedListener = fn; }
        },
        sendMessage: async () => ({ ok: true }),
        getURL: (p) => p
      }
    };

    const sandbox = {
      chrome: mockChrome,
      AudioContext: MockAudioContext,
      window: { AudioContext: MockAudioContext },
      console,
      require: offscreenRequire,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(offscreenCode, sandbox);
    assert.ok(capturedListener, "chrome.runtime.onMessage listener must be registered");

    const { getEngineInstance } = sandbox.module.exports;
    const engine = getEngineInstance();
    engine.audioContext = new MockAudioContext();
    engine.syncEngine = {
      extractSubtitleAudio: async () => ({ ok: true, status: "READY", dataUrl: "data:audio/wav;base64,mock" })
    };

    let responseResult = null;
    const sendResponse = (res) => { responseResult = res; };

    const handled = capturedListener({
      type: "EXTRACT_SUBTITLE_AUDIO",
      startTime: 5.0,
      endTime: 7.0,
      timelineId: "tl_test"
    }, {}, sendResponse);

    assert.equal(handled, true, "EXTRACT_SUBTITLE_AUDIO must return true");

    // Wait a tick for async handler
    await new Promise(r => setTimeout(r, 10));
    assert.ok(resumeCalled, "AudioContext must be resumed on EXTRACT_SUBTITLE_AUDIO");
    assert.ok(responseResult && responseResult.ok, "Extraction response must succeed");
  });
});
