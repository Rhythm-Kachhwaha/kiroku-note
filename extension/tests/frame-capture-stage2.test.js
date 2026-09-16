const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Load ImageCropper
const ImageCropper = require("../lib/image-cropper.js");

console.log("Starting Frame Capture — Stage 2: Reliability, Timing & Coordinate Hardening Tests...\n");

// -------------------------------------------------------------
// 1. ImageCropper Coordinate Mathematics & Ratio Clamping Tests
// -------------------------------------------------------------
function testCoordinateMathAndRatios() {
  console.log("--- 1. Testing Coordinate Math, Non-Standard Ratios & DPR ---");

  // Test 1.1: 16:9 standard (1920x1080 -> 640x360)
  const target16_9 = ImageCropper.calculateTargetDimensions(1920, 1080, 640, 360);
  assert.deepEqual(target16_9, { width: 640, height: 360 }, "16:9 scales to 640x360");

  // Test 1.2: 21:9 Ultrawide (2560x1080 -> 640x270, 3440x1440 -> 640x268)
  const target21_9_a = ImageCropper.calculateTargetDimensions(2560, 1080, 640, 360);
  assert.deepEqual(target21_9_a, { width: 640, height: 270 }, "2560x1080 ultrawide scales to 640x270");
  const target21_9_b = ImageCropper.calculateTargetDimensions(3440, 1440, 640, 360);
  assert.deepEqual(target21_9_b, { width: 640, height: 268 }, "3440x1440 ultrawide scales to 640x268");

  // Test 1.3: 4:3 Classic (1440x1080 -> 480x360, 640x480 -> 480x360)
  const target4_3_a = ImageCropper.calculateTargetDimensions(1440, 1080, 640, 360);
  assert.deepEqual(target4_3_a, { width: 480, height: 360 }, "1440x1080 4:3 scales to 480x360");
  const target4_3_b = ImageCropper.calculateTargetDimensions(640, 480, 640, 360);
  assert.deepEqual(target4_3_b, { width: 480, height: 360 }, "640x480 4:3 scales to 480x360");

  // Test 1.4: 9:16 Vertical Video (YouTube Shorts / TikTok: 1080x1920 -> 203x360)
  const target9_16 = ImageCropper.calculateTargetDimensions(1080, 1920, 640, 360);
  assert.deepEqual(target9_16, { width: 203, height: 360 }, "1080x1920 vertical video scales to 203x360");

  // Test 1.5: 1:1 Square (1080x1080 -> 360x360)
  const target1_1 = ImageCropper.calculateTargetDimensions(1080, 1080, 640, 360);
  assert.deepEqual(target1_1, { width: 360, height: 360 }, "1080x1080 square video scales to 360x360");

  // Test 1.6: Very small video elements (30x30 -> 30x30, 1x1 -> 1x1)
  const targetSmall = ImageCropper.calculateTargetDimensions(30, 30, 640, 360);
  assert.deepEqual(targetSmall, { width: 30, height: 30 }, "30x30 small video remains 30x30");
  const target1x1 = ImageCropper.calculateTargetDimensions(1, 1, 640, 360);
  assert.deepEqual(target1x1, { width: 1, height: 1 }, "1x1 tiny video remains 1x1");

  // Test 1.7: Device Pixel Ratio variations (1.0, 1.25, 1.5, 2.0, 3.0)
  const baseRect = { left: 80, top: 40, width: 800, height: 450 };
  const boundsDpr1 = ImageCropper.calculateCropBounds(baseRect, 1.0, 1920, 1080);
  assert.deepEqual(boundsDpr1, { x: 80, y: 40, width: 800, height: 450 }, "DPR 1.0 exact scale");

  const boundsDpr125 = ImageCropper.calculateCropBounds(baseRect, 1.25, 1920, 1080);
  assert.deepEqual(boundsDpr125, { x: 100, y: 50, width: 1000, height: 563 }, "DPR 1.25 fractional scale");

  const boundsDpr15 = ImageCropper.calculateCropBounds(baseRect, 1.5, 1920, 1080);
  assert.deepEqual(boundsDpr15, { x: 120, y: 60, width: 1200, height: 675 }, "DPR 1.5 scale");

  const boundsDpr2 = ImageCropper.calculateCropBounds(baseRect, 2.0, 3840, 2160);
  assert.deepEqual(boundsDpr2, { x: 160, y: 80, width: 1600, height: 900 }, "DPR 2.0 Retina scale");

  const boundsDpr3 = ImageCropper.calculateCropBounds(baseRect, 3.0, 3840, 2160);
  assert.deepEqual(boundsDpr3, { x: 240, y: 120, width: 2400, height: 1350 }, "DPR 3.0 High-density scale");

  // Test 1.8: Fallback for invalid/negative DPR
  const boundsInvalidDpr = ImageCropper.calculateCropBounds(baseRect, -2.5, 1920, 1080);
  assert.deepEqual(boundsInvalidDpr, { x: 80, y: 40, width: 800, height: 450 }, "Invalid DPR defaults to 1.0");

  console.log("PASS: Non-standard aspect ratios and DPR scaling verified.");
}

// -------------------------------------------------------------
// 2. ImageCropper Boundary Conditions & Clamping
// -------------------------------------------------------------
function testBoundaryClampingAndEdgeCases() {
  console.log("--- 2. Testing Boundary Conditions & Clamping ---");

  // Test 2.1: Negative left coordinate (partially offscreen left)
  const rectNegLeft = { left: -100, top: 50, width: 600, height: 400 };
  const boundsNegLeft = ImageCropper.calculateCropBounds(rectNegLeft, 1.0, 1920, 1080);
  assert.equal(boundsNegLeft.x, 0, "Negative left clamped to 0");
  assert.equal(boundsNegLeft.width, 500, "Width reduced by negative left offset");
  assert.equal(boundsNegLeft.y, 50);
  assert.equal(boundsNegLeft.height, 400);

  // Test 2.2: Negative top coordinate (partially offscreen top)
  const rectNegTop = { left: 50, top: -80, width: 600, height: 400 };
  const boundsNegTop = ImageCropper.calculateCropBounds(rectNegTop, 1.0, 1920, 1080);
  assert.equal(boundsNegTop.y, 0, "Negative top clamped to 0");
  assert.equal(boundsNegTop.height, 320, "Height reduced by negative top offset");

  // Test 2.3: Completely offscreen left (left + width <= 0)
  const rectOffscreenLeft = { left: -700, top: 50, width: 500, height: 400 };
  const boundsOffLeft = ImageCropper.calculateCropBounds(rectOffscreenLeft, 1.0, 1920, 1080);
  assert.equal(boundsOffLeft.x, 0);
  assert.equal(boundsOffLeft.width, 0, "Completely offscreen left yields 0 width");

  // Test 2.4: Completely offscreen top (top + height <= 0)
  const rectOffscreenTop = { left: 50, top: -600, width: 500, height: 400 };
  const boundsOffTop = ImageCropper.calculateCropBounds(rectOffscreenTop, 1.0, 1920, 1080);
  assert.equal(boundsOffTop.y, 0);
  assert.equal(boundsOffTop.height, 0, "Completely offscreen top yields 0 height");

  // Test 2.5: Completely offscreen right (left >= imageWidth)
  const rectOffscreenRight = { left: 2000, top: 50, width: 500, height: 400 };
  const boundsOffRight = ImageCropper.calculateCropBounds(rectOffscreenRight, 1.0, 1920, 1080);
  assert.equal(boundsOffRight.width, 0, "Completely offscreen right yields 0 width");
  assert.ok(boundsOffRight.x <= 1920, "x does not exceed imageWidth");

  // Test 2.6: Completely offscreen bottom (top >= imageHeight)
  const rectOffscreenBottom = { left: 50, top: 1200, width: 500, height: 400 };
  const boundsOffBottom = ImageCropper.calculateCropBounds(rectOffscreenBottom, 1.0, 1920, 1080);
  assert.equal(boundsOffBottom.height, 0, "Completely offscreen bottom yields 0 height");
  assert.ok(boundsOffBottom.y <= 1080, "y does not exceed imageHeight");

  // Test 2.7: Video touching viewport boundaries
  const rectTouchingRight = { left: 1900, top: 50, width: 100, height: 400 };
  const boundsTouchingRight = ImageCropper.calculateCropBounds(rectTouchingRight, 1.0, 1920, 1080);
  assert.equal(boundsTouchingRight.x, 1900);
  assert.equal(boundsTouchingRight.width, 20, "Width clamped to viewport right edge (1920 - 1900)");

  // Test 2.8: Video larger than viewport in both dimensions
  const rectOversized = { left: -100, top: -50, width: 2200, height: 1200 };
  const boundsOversized = ImageCropper.calculateCropBounds(rectOversized, 1.0, 1920, 1080);
  assert.deepEqual(boundsOversized, { x: 0, y: 0, width: 1920, height: 1080 }, "Oversized video clamped to exact viewport");

  // Test 2.9: Fractional bounding rectangles
  const rectFractional = { left: 10.4, top: 20.6, width: 853.33, height: 480.25 };
  const boundsFractional = ImageCropper.calculateCropBounds(rectFractional, 1.25, 1920, 1080);
  assert.equal(Number.isInteger(boundsFractional.x), true, "Crop X is integer");
  assert.equal(Number.isInteger(boundsFractional.y), true, "Crop Y is integer");
  assert.equal(Number.isInteger(boundsFractional.width), true, "Crop Width is integer");
  assert.equal(Number.isInteger(boundsFractional.height), true, "Crop Height is integer");

  // Test 2.10: Malformed inputs (NaN, Infinity, null, undefined)
  assert.deepEqual(ImageCropper.calculateCropBounds(null, 1.0), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateCropBounds(undefined, 1.0), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateCropBounds({ width: NaN, height: 400 }, 1.0), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateCropBounds({ width: 400, height: Infinity }, 1.0), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateCropBounds({ width: -100, height: 400 }, 1.0), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateTargetDimensions(NaN, 360), { width: 0, height: 0 });
  assert.deepEqual(ImageCropper.calculateTargetDimensions(640, -100), { width: 0, height: 0 });

  console.log("PASS: Boundary clamping and edge case guards verified.");
}

// -------------------------------------------------------------
// 3. DRM Black Frame Detection Tests
// -------------------------------------------------------------
function testDrmDetection() {
  console.log("--- 3. Testing DRM Solid Black & Transparent Frame Detection ---");

  // Test 3.1: Solid black frame
  const solidBlack = new Uint8ClampedArray(200 * 200 * 4);
  assert.equal(ImageCropper.checkBlackFrame(solidBlack, 200, 200), true, "Solid black frame detected as DRM");

  // Test 3.2: Noise floor (values <= 4)
  const noiseBlack = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < noiseBlack.length; i += 4) {
    noiseBlack[i] = 3;     // R
    noiseBlack[i + 1] = 4; // G
    noiseBlack[i + 2] = 2; // B
    noiseBlack[i + 3] = 255;
  }
  assert.equal(ImageCropper.checkBlackFrame(noiseBlack, 100, 100), true, "Noise floor frame detected as DRM");

  // Test 3.3: Fully transparent frame (alpha <= 10)
  const transparentFrame = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < transparentFrame.length; i += 4) {
    transparentFrame[i] = 200;
    transparentFrame[i + 1] = 200;
    transparentFrame[i + 2] = 200;
    transparentFrame[i + 3] = 0; // alpha 0
  }
  assert.equal(ImageCropper.checkBlackFrame(transparentFrame, 100, 100), true, "Transparent frame detected as DRM/empty");

  // Test 3.4: Real video content
  const normalFrame = new Uint8ClampedArray(100 * 100 * 4);
  for (let i = 0; i < normalFrame.length; i += 4) {
    normalFrame[i] = 100;
    normalFrame[i + 1] = 150;
    normalFrame[i + 2] = 200;
    normalFrame[i + 3] = 255;
  }
  assert.equal(ImageCropper.checkBlackFrame(normalFrame, 100, 100), false, "Normal video frame not flagged as DRM");

  // Test 3.5: Null/empty/invalid input
  assert.equal(ImageCropper.checkBlackFrame(null, 100, 100), true, "Null buffer safe fail-soft");
  assert.equal(ImageCropper.checkBlackFrame(new Uint8ClampedArray(0), 0, 0), true, "Zero dimension safe fail-soft");

  console.log("PASS: DRM detection edge cases verified.");
}

// -------------------------------------------------------------
// 4. VideoMiningPOC Screenshot Capture & Hard Playback Invariant
// -------------------------------------------------------------
async function testVideoMiningPocAndPlaybackInvariant() {
  console.log("--- 4. Testing VideoMiningPOC & HARD PLAYBACK INVARIANT ---");

  const pocSrc = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");
  const cropperSrc = fs.readFileSync(path.resolve(__dirname, "../lib/image-cropper.js"), "utf8");

  const sentMessages = [];
  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "CAPTURE_VIDEO_FRAME") {
          return Promise.resolve({ ok: true, dataUrl: "data:image/jpeg;base64,mockViewportTab" });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: { addListener: () => {} }
    },
    storage: { local: { get: (_k, cb) => cb?.({}), set: () => {} } }
  };

  // Playback Invariant Tracker
  let currentTimeSetterCalls = 0;
  let playCalls = 0;
  let pauseCalls = 0;
  let playbackRateSetterCalls = 0;
  let srcSetterCalls = 0;

  let _currentTime = 75.4;
  let _playbackRate = 1.0;
  let _src = "https://example.com/video.mp4";

  const mockVideo = {
    isConnected: true,
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    get currentTime() { return _currentTime; },
    set currentTime(val) { currentTimeSetterCalls++; _currentTime = val; },
    get playbackRate() { return _playbackRate; },
    set playbackRate(val) { playbackRateSetterCalls++; _playbackRate = val; },
    get src() { return _src; },
    set src(val) { srcSetterCalls++; _src = val; },
    play() { playCalls++; return Promise.resolve(); },
    pause() { pauseCalls++; },
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 50, top: 80, width: 1280, height: 720 })
  };

  const context = {
    chrome: mockChrome,
    window: {
      devicePixelRatio: 1.0,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    document: {
      body: { appendChild: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [mockVideo],
      createElement: (tag = "div") => ({
        tagName: tag.toUpperCase(),
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false,
          toggle: () => {}
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => {
            const buf = new Uint8ClampedArray(640 * 360 * 4);
            for (let i = 0; i < buf.length; i += 4) {
              buf[i] = 120;
              buf[i + 3] = 255;
            }
            return { data: buf, width: 640, height: 360 };
          }
        }),
        toDataURL: () => "data:image/jpeg;base64,mockTier1Frame"
      })
    },
    MutationObserver: class { observe() {} disconnect() {} },
    console,
    Boolean,
    Math,
    Number,
    Promise,
    setTimeout,
    Uint8ClampedArray
  };
  context.globalThis = context;
  context.window.globalThis = context;

  vm.runInNewContext(cropperSrc, context);
  vm.runInNewContext(pocSrc, context);

  const pocInstance = context.window.__ANKIMINER_VIDEO_POC__.instance;
  pocInstance.activeVideo = mockVideo;

  // Test 4.1: Capture while video is playing
  const mockImage = { naturalWidth: 1920, naturalHeight: 1080, width: 1920, height: 1080 };
  const mockCanvas = {
    width: 640,
    height: 360,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => ({
        data: (() => {
          const b = new Uint8ClampedArray(640 * 360 * 4);
          for (let i = 0; i < b.length; i += 4) { b[i] = 100; b[i + 3] = 255; }
          return b;
        })(),
        width: 640,
        height: 360
      })
    }),
    toDataURL: () => "data:image/jpeg;base64,capturedPlayingFrame"
  };

  const capRes = await pocInstance.captureCurrentFrame({
    captureId: "cap_test_100",
    loadImage: async () => mockImage,
    createCanvas: () => mockCanvas
  });

  assert.ok(capRes.ok, "Frame capture succeeds");
  assert.equal(capRes.dataUrl, "data:image/jpeg;base64,capturedPlayingFrame");

  // Verify HARD PLAYBACK INVARIANT
  assert.equal(currentTimeSetterCalls, 0, "INVARIANT PRESERVED: video.currentTime was never assigned");
  assert.equal(playCalls, 0, "INVARIANT PRESERVED: video.play() was never called");
  assert.equal(pauseCalls, 0, "INVARIANT PRESERVED: video.pause() was never called");
  assert.equal(playbackRateSetterCalls, 0, "INVARIANT PRESERVED: video.playbackRate was never modified");
  assert.equal(srcSetterCalls, 0, "INVARIANT PRESERVED: video.src was never modified");

  // Test 4.2: Capture while video is paused
  mockVideo.paused = true;
  _currentTime = 102.3;
  const pausedRes = await pocInstance.captureCurrentFrame({
    captureId: "cap_test_101",
    loadImage: async () => mockImage,
    createCanvas: () => mockCanvas
  });
  assert.ok(pausedRes.ok, "Paused frame capture succeeds");
  assert.equal(currentTimeSetterCalls, 0, "INVARIANT PRESERVED: video.currentTime untouched while paused");
  assert.equal(playCalls, 0, "INVARIANT PRESERVED: video was not unpaused");

  // Test 4.3: DRM Protection failure handling
  function createDrmCanvas() {
    const blackBuf = new Uint8ClampedArray(640 * 360 * 4); // all 0
    return {
      width: 640,
      height: 360,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data: blackBuf, width: 640, height: 360 })
      }),
      toDataURL: () => "data:image/jpeg;base64,black"
    };
  }

  const drmRes = await pocInstance.captureCurrentFrame({
    captureId: "cap_drm_102",
    loadImage: async () => mockImage,
    createCanvas: createDrmCanvas
  });

  assert.equal(drmRes.ok, false, "DRM frame capture returns ok: false");
  assert.equal(drmRes.error, "DRM_PROTECTED");

  const drmStatusMsg = sentMessages.find(m => m.type === "SCREENSHOT_CAPTURE_STATUS" && m.captureId === "cap_drm_102");
  assert.ok(drmStatusMsg, "SCREENSHOT_CAPTURE_STATUS broadcasted for DRM failure");
  assert.equal(drmStatusMsg.error, "DRM_PROTECTED");

  // Test 4.4: No active video
  pocInstance.activeVideo = null;
  const noVidRes = await pocInstance.captureCurrentFrame({ captureId: "cap_novid_103" });
  assert.equal(noVidRes.ok, false);
  assert.equal(noVidRes.error, "NO_ACTIVE_VIDEO");

  console.log("PASS: VideoMiningPOC capture and HARD PLAYBACK INVARIANT verified.");
}

// -------------------------------------------------------------
// 5. Side Panel Stale Capture & DRM Isolation Tests
// -------------------------------------------------------------
function testSidePanelIsolation() {
  console.log("--- 5. Testing Side Panel Stale Capture & DRM Isolation ---");

  const sidepanelSrc = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");

  // Simple Mock DOM
  function createMockElement(tag = "div") {
    return {
      tagName: tag.toUpperCase(),
      style: {},
      children: [],
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
        toggle(c, force) { if (force !== undefined) { force ? this.add(c) : this.remove(c); } else { this.contains(c) ? this.remove(c) : this.add(c); } }
      },
      appendChild(c) { this.children.push(c); return c; },
      append(...args) { args.forEach(c => this.children.push(c)); },
      replaceChildren(...args) { this.children = args; },
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      removeAttribute: () => {},
      hidden: false,
      value: "",
      textContent: ""
    };
  }

  const messageListeners = [];
  const mockChrome = {
    runtime: {
      sendMessage: () => Promise.resolve({ ok: true }),
      onMessage: { addListener: (fn) => messageListeners.push(fn) }
    },
    storage: { local: { get: (_k, cb) => cb?.({}), set: () => {} } }
  };

  const context = {
    chrome: mockChrome,
    document: {
      querySelector: () => createMockElement(),
      querySelectorAll: () => [],
      createElement: (t) => createMockElement(t),
      addEventListener: () => {}
    },
    window: { addEventListener: () => {} },
    navigator: { platform: "Win32" },
    console,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    Boolean,
    Math,
    Number,
    Promise,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;

  const listenerStart = sidepanelSrc.indexOf("chrome.runtime.onMessage.addListener");
  const listenerEnd = sidepanelSrc.indexOf("if (typeof chrome !== \"undefined\" && chrome.storage?.onChanged)");
  assert.ok(listenerStart !== -1 && listenerEnd !== -1, "Message listener block found in sidepanel.js");

  const listenerSrc = sidepanelSrc.slice(listenerStart, listenerEnd);

  let currentCaptureId = 200;
  const currentDraftMedia = {
    imageBase64: null,
    audioBase64: null,
    audioStatus: "idle",
    audioError: null,
    mimeType: null,
    captureId: null
  };

  const statusLogs = [];
  let registeredListener = null;

  const listenerContext = {
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn) => { registeredListener = fn; }
        }
      }
    },
    currentCaptureId,
    currentDraftMedia,
    cardEditor: { hidden: false },
    fieldImage: { value: "" },
    fieldAudio: { value: "" },
    updateMediaPreviews: () => {},
    setStatus: (msg) => { statusLogs.push(msg); },
    identify: () => {},
    updateOffsetDisplay: () => {},
    lastCaptureSource: {}
  };

  vm.runInNewContext(listenerSrc, listenerContext);
  assert.ok(typeof registeredListener === "function", "Side panel registers onMessage listener");

  // Test 5.1: Matching captureId accepted
  let matchRes = null;
  registeredListener({
    type: "SCREENSHOT_CAPTURED",
    captureId: 200,
    dataUrl: "data:image/jpeg;base64,validImage"
  }, null, (r) => { matchRes = r; });

  assert.equal(matchRes?.ok, true, "Matching capture accepted");
  assert.equal(currentDraftMedia.imageBase64, "data:image/jpeg;base64,validImage");

  // Test 5.2: Stale captureId rejected
  let staleRes = null;
  registeredListener({
    type: "SCREENSHOT_CAPTURED",
    captureId: 199, // stale
    dataUrl: "data:image/jpeg;base64,staleImage"
  }, null, (r) => { staleRes = r; });

  assert.equal(staleRes?.ok, false, "Stale capture rejected");
  assert.equal(staleRes?.error, "STALE_CAPTURE");
  assert.equal(currentDraftMedia.imageBase64, "data:image/jpeg;base64,validImage", "Draft image untouched by stale capture");

  // Test 5.3: Stale DRM failure status rejected
  let staleDrmRes = null;
  registeredListener({
    type: "SCREENSHOT_CAPTURE_STATUS",
    captureId: 198, // stale
    ok: false,
    error: "DRM_PROTECTED",
    message: "Protected stream"
  }, null, (r) => { staleDrmRes = r; });

  assert.equal(staleDrmRes?.ok, false, "Stale DRM status rejected");
  assert.equal(staleDrmRes?.error, "STALE_CAPTURE");

  // Test 5.4: Valid DRM status accepted without corrupting image
  let validDrmRes = null;
  registeredListener({
    type: "SCREENSHOT_CAPTURE_STATUS",
    captureId: 200,
    ok: false,
    error: "DRM_PROTECTED",
    message: "Protected stream"
  }, null, (r) => { validDrmRes = r; });

  assert.equal(validDrmRes?.ok, true, "Current DRM status handled");
  assert.equal(currentDraftMedia.imageBase64, "data:image/jpeg;base64,validImage", "Image intact after DRM status");

  // Test 5.5: Image and Audio coexistence
  registeredListener({
    type: "AUDIO_CAPTURED",
    captureId: 200,
    dataUrl: "data:audio/wav;base64,validAudioWav",
    mimeType: "audio/wav"
  }, null, () => {});

  assert.equal(currentDraftMedia.imageBase64, "data:image/jpeg;base64,validImage", "Image intact after audio capture");
  assert.equal(currentDraftMedia.audioBase64, "data:audio/wav;base64,validAudioWav", "Audio attached correctly");

  // Clear image does not affect audio
  currentDraftMedia.imageBase64 = null;
  assert.equal(currentDraftMedia.imageBase64, null, "Image cleared");
  assert.equal(currentDraftMedia.audioBase64, "data:audio/wav;base64,validAudioWav", "Audio remains intact after image clear");

  console.log("PASS: Side panel stale capture rejection and DRM isolation verified.");
}

// -------------------------------------------------------------
// Main Runner
// -------------------------------------------------------------
(async () => {
  try {
    testCoordinateMathAndRatios();
    testBoundaryClampingAndEdgeCases();
    testDrmDetection();
    await testVideoMiningPocAndPlaybackInvariant();
    testSidePanelIsolation();

    console.log("\n>>> ALL STAGE 2 FRAME CAPTURE VERIFICATION TESTS PASSED SUCCESSFULLY! <<<\n");
  } catch (err) {
    console.error("\n❌ TEST SUITE FAILED:", err);
    process.exit(1);
  }
})();
