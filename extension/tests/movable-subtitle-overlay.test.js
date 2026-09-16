const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// Load the video mining POC script into an isolated test harness
const pocScriptPath = path.resolve(__dirname, "../content/video-mining-poc.js");
const pocScript = fs.readFileSync(pocScriptPath, "utf-8");

function createMockEnvironment({ isIframe = false, isHiAnime = true, initialPosition = null } = {}) {
  const sentMessages = [];
  const eventListeners = {};
  const docEventListeners = {};
  const winEventListeners = {};
  const storageState = {
    subtitle_overlay_position: initialPosition || null
  };

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") {
          return Promise.resolve({ enabled: true });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (handler) => {
          if (!eventListeners.message) eventListeners.message = [];
          eventListeners.message.push(handler);
        }
      }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { res[k] = storageState[k]; });
          } else if (typeof keys === "string") {
            res[keys] = storageState[keys];
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items, cb) => {
          Object.assign(storageState, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach(k => delete storageState[k]);
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (handler) => {
          if (!eventListeners.storageChanged) eventListeners.storageChanged = [];
          eventListeners.storageChanged.push(handler);
        }
      }
    }
  };

  let currentSelection = "";

  class MockElement {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
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

    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = true;
      return child;
    }

    insertBefore(newNode, referenceNode) {
      if (newNode.parentElement) {
        newNode.parentElement.removeChild(newNode);
      }
      const idx = this.children.indexOf(referenceNode);
      if (idx !== -1) {
        this.children.splice(idx, 0, newNode);
      } else {
        this.children.push(newNode);
      }
      newNode.parentElement = this;
      newNode.isConnected = true;
      return newNode;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
        child.isConnected = false;
      }
      return child;
    }

    get lastElementChild() {
      return this.children.length > 0 ? this.children[this.children.length - 1] : null;
    }

    querySelector(sel) {
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        for (const c of this.children) {
          if (c.id === id) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        for (const c of this.children) {
          if (c.className && c.className.split(" ").includes(cls)) return c;
          const found = c.querySelector(sel);
          if (found) return found;
        }
      }
      return null;
    }

    querySelectorAll(sel) {
      const results = [];
      if (sel.toLowerCase() === "video") {
        for (const c of this.children) {
          if (c.tagName === "VIDEO") results.push(c);
          results.push(...c.querySelectorAll(sel));
        }
      }
      return results;
    }

    setAttribute(name, val) { this._attrs[name] = val; }
    getAttribute(name) { return this._attrs[name] || null; }
    removeAttribute(name) { delete this._attrs[name]; }

    getBoundingClientRect() { return this.rect; }

    contains(node) {
      if (!node) return false;
      let curr = node;
      while (curr) {
        if (curr === this) return true;
        curr = curr.parentElement;
      }
      return false;
    }

    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    }

    removeEventListener(event, handler) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    }

    dispatchEvent(event) {
      const handlers = this._listeners[event.type] || [];
      handlers.forEach(h => h(event));
    }
  }

  class MockVideoElement extends MockElement {
    constructor(id = "hianime-video") {
      super("video", id);
      this.currentTime = 0;
      this.duration = 120;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.textTracks = [];
      this.playbackRate = 1.0;
      this.playCount = 0;
      this.pauseCount = 0;
      this.seekCount = 0;
    }

    play() {
      this.playCount++;
      this.paused = false;
      this.dispatchEvent({ type: "play" });
    }

    pause() {
      this.pauseCount++;
      this.paused = true;
      this.dispatchEvent({ type: "pause" });
    }

    seek(time) {
      this.seekCount++;
      this.currentTime = time;
      this.dispatchEvent({ type: "timeupdate" });
      this.dispatchEvent({ type: "seeked" });
    }
  }

  const rootBody = new MockElement("body", "document-body");

  const mockDocument = {
    body: rootBody,
    documentElement: rootBody,
    fullscreenElement: null,
    createElement: (tag) => new MockElement(tag),
    createElementNS: (_ns, tag) => new MockElement(tag),
    getElementById: (id) => {
      if (rootBody.id === id) return rootBody;
      return rootBody.querySelector(`#${id}`);
    },
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    addEventListener: (event, handler) => {
      if (!docEventListeners[event]) docEventListeners[event] = [];
      docEventListeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!docEventListeners[event]) return;
      docEventListeners[event] = docEventListeners[event].filter(h => h !== handler);
    },
    dispatchEvent: (event) => {
      const handlers = docEventListeners[event.type] || [];
      handlers.forEach(h => h(event));
    },
    caretRangeFromPoint: (_x, _y) => {
      const sub = rootBody.querySelector("#ankiminer-video-subtitle");
      if (sub && sub.textContent) {
        return {
          startContainer: { nodeType: 3, nodeValue: sub.textContent, textContent: sub.textContent },
          startOffset: 0
        };
      }
      return null;
    }
  };

  const mockWindow = {
    isIframe,
    chrome: mockChrome,
    location: {
      href: isIframe ? "https://megacloud.tv/embed/test" : "https://hianime.to/watch/one-piece-100?ep=1",
      hostname: isIframe ? "megacloud.tv" : "hianime.to"
    },
    document: mockDocument,
    getSelection: () => ({
      rangeCount: currentSelection ? 1 : 0,
      toString: () => currentSelection
    }),
    addEventListener: (event, handler) => {
      if (!winEventListeners[event]) winEventListeners[event] = [];
      winEventListeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!winEventListeners[event]) return;
      winEventListeners[event] = winEventListeners[event].filter(h => h !== handler);
    },
    dispatchEvent: (event) => {
      const handlers = winEventListeners[event.type] || [];
      handlers.forEach(h => h(event));
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }

  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }

  const localStorageData = {};
  const mockLocalStorage = {
    getItem: (k) => localStorageData[k] || null,
    setItem: (k, v) => { localStorageData[k] = String(v); },
    removeItem: (k) => { delete localStorageData[k]; }
  };

  const context = {
    chrome: mockChrome,
    window: mockWindow,
    document: mockDocument,
    location: mockWindow.location,
    MutationObserver: MockMutationObserver,
    ResizeObserver: MockResizeObserver,
    localStorage: mockLocalStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Array,
    Object,
    Number,
    Math,
    String,
    Boolean,
    Date
  };

  const vm = require("node:vm");
  vm.createContext(context);
  vm.runInContext(pocScript, context);

  return {
    context,
    rootBody,
    mockDocument,
    mockWindow,
    storageState,
    sentMessages,
    eventListeners,
    docEventListeners,
    winEventListeners,
    MockElement,
    MockVideoElement,
    setSelection: (txt) => { currentSelection = txt; }
  };
}

async function runTests() {
  console.log("Starting Movable Subtitle Overlay & HiAnime Fullscreen Regression Tests...");

  // -------------------------------------------------------------
  // Test 1: Subtitle overlay renders normally with default bottom-center position
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("test-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 2.0, endTime: 6.0, text: "デフォルト位置テスト" }
    ]);

    video.seek(3.0);

    const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
    const box = env.mockDocument.getElementById("ankiminer-video-subtitle-box");
    const handle = env.mockDocument.getElementById("ankiminer-video-subtitle-handle");
    const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");

    assert.ok(container, "Overlay container must exist in DOM");
    assert.ok(box, "Subtitle box element must exist in DOM");
    assert.ok(handle, "Subtitle drag handle element must exist in DOM");
    assert.ok(subtitle, "Subtitle span must exist in DOM");

    assert.equal(subtitle.textContent, "デフォルト位置テスト");
    assert.equal(container.style.position, "fixed");
    assert.equal(container.style.display, "flex");
    assert.equal(container.parentElement, env.rootBody);

    const pos = poc.instance.renderer.getPosition();
    assert.equal(pos.relX, 0.5, "Default horizontal center position is 0.5");
    assert.equal(pos.relY, 0.78, "Default vertical position is 0.78");

    console.log("PASS: Test 1 - Default bottom-center rendering verified.");
  }

  // -------------------------------------------------------------
  // Test 2: Fullscreen transition keeps overlay attached, visible, and properly positioned
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const playerWrapper = new env.MockElement("div", "player-container");
    playerWrapper.rect = { top: 100, left: 50, width: 800, height: 450 };
    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };

    playerWrapper.appendChild(video);
    env.rootBody.appendChild(playerWrapper);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "フルスクリーン表示テスト" }
    ]);
    video.seek(2.0);

    const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
    const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");
    assert.equal(container.parentElement, playerWrapper, "Windowed mode mounts inside playerWrapper");
    assert.equal(container.style.position, "absolute", "Windowed mode uses absolute positioning in player container");

    // Enter fullscreen
    playerWrapper.rect = { top: 0, left: 0, width: 1920, height: 1080 };
    video.rect = { top: 0, left: 0, width: 1920, height: 1080 };
    env.mockDocument.fullscreenElement = playerWrapper;
    env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

    assert.equal(container.parentElement, playerWrapper, "Overlay maintains attachment to fullscreen container");
    assert.equal(container.style.position, "absolute", "Must use absolute positioning in fullscreen container");
    assert.equal(subtitle.textContent, "フルスクリーン表示テスト", "Cue text remains visible in fullscreen");
    assert.equal(container.style.display, "flex");

    console.log("PASS: Test 2 - Fullscreen adaptation & attachment verified.");
  }

  // -------------------------------------------------------------
  // Test 3: Exiting fullscreen restores correct attachment and positioning
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const playerWrapper = new env.MockElement("div", "player-container");
    const video = new env.MockVideoElement("hianime-video");
    playerWrapper.appendChild(video);
    env.rootBody.appendChild(playerWrapper);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "全画面解除テスト" }
    ]);
    video.seek(2.0);

    const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");

    // Enter fullscreen
    env.mockDocument.fullscreenElement = playerWrapper;
    env.mockDocument.dispatchEvent({ type: "fullscreenchange" });
    assert.equal(container.parentElement, playerWrapper);

    // Exit fullscreen
    env.mockDocument.fullscreenElement = null;
    env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

    assert.equal(container.parentElement, playerWrapper, "Exiting fullscreen maintains attachment to playerWrapper");
    assert.equal(container.style.position, "absolute", "Exiting fullscreen maintains absolute positioning");

    console.log("PASS: Test 3 - Fullscreen exit restoration verified.");
  }

  // -------------------------------------------------------------
  // Test 4: Fullscreen transitions do NOT duplicate overlays or listeners
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const playerWrapper = new env.MockElement("div", "player-container");
    const video = new env.MockVideoElement("hianime-video");
    playerWrapper.appendChild(video);
    env.rootBody.appendChild(playerWrapper);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "重複防止テスト" }
    ]);
    video.seek(2.0);

    // Multiple rapid fullscreen transitions
    for (let i = 0; i < 5; i++) {
      env.mockDocument.fullscreenElement = playerWrapper;
      env.mockDocument.dispatchEvent({ type: "fullscreenchange" });
      env.mockDocument.fullscreenElement = null;
      env.mockDocument.dispatchEvent({ type: "fullscreenchange" });
    }

    // Check count of overlay containers in entire tree
    const allContainers = [];
    function collectContainers(node) {
      if (!node) return;
      if (node.id === "ankiminer-video-overlay-container") allContainers.push(node);
      if (node.children) node.children.forEach(collectContainers);
    }
    collectContainers(env.rootBody);

    assert.equal(allContainers.length, 1, "There must be exactly ONE overlay container instance in the DOM");

    console.log("PASS: Test 4 - Zero overlay duplication verified.");
  }

  // -------------------------------------------------------------
  // Test 5: Dragging reposition updates position and relative coordinate calculation
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "ドラッグ移動テスト" }
    ]);
    video.seek(2.0);

    const handle = env.mockDocument.getElementById("ankiminer-video-subtitle-handle");
    const box = env.mockDocument.getElementById("ankiminer-video-subtitle-box");
    box.rect = { top: 0, left: 0, width: 200, height: 40 };

    // Simulate pointerdown on handle at (400, 350)
    handle.dispatchEvent({
      type: "pointerdown",
      button: 0,
      clientX: 400,
      clientY: 350,
      preventDefault: () => {},
      stopPropagation: () => {}
    });

    assert.equal(poc.instance.renderer.isDragging, true, "Dragging state must be active");

    // Simulate pointermove to upper right: dx = +200, dy = -250 (clientX: 600, clientY: 100)
    env.mockWindow.dispatchEvent({
      type: "pointermove",
      clientX: 600,
      clientY: 100
    });

    const newPos = poc.instance.renderer.getPosition();
    assert.ok(newPos.relX > 0.5, `relX must have increased towards the right: ${newPos.relX}`);
    assert.ok(newPos.relY < 0.78, `relY must have decreased towards the top: ${newPos.relY}`);

    // End drag
    env.mockWindow.dispatchEvent({
      type: "pointerup"
    });

    assert.equal(poc.instance.renderer.isDragging, false, "Dragging state must terminate on pointerup");

    console.log("PASS: Test 5 - Drag handle pointer interaction & relative update verified.");
  }

  // -------------------------------------------------------------
  // Test 6: Drag position is strictly clamped to video player bounds
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "境界テスト" }
    ]);
    video.seek(2.0);

    const handle = env.mockDocument.getElementById("ankiminer-video-subtitle-handle");
    const box = env.mockDocument.getElementById("ankiminer-video-subtitle-box");
    box.rect = { top: 0, left: 0, width: 200, height: 40 };

    // Attempt to drag far off the top-left (-5000, -5000)
    handle.dispatchEvent({ type: "pointerdown", button: 0, clientX: 400, clientY: 350, preventDefault: () => {}, stopPropagation: () => {} });
    env.mockWindow.dispatchEvent({ type: "pointermove", clientX: -5000, clientY: -5000 });
    env.mockWindow.dispatchEvent({ type: "pointerup" });

    const topLeftPos = poc.instance.renderer.getPosition();
    assert.ok(topLeftPos.relX >= 0, "relX must not be negative");
    assert.ok(topLeftPos.relY >= 0, "relY must not be negative");

    // Attempt to drag far off the bottom-right (+5000, +5000)
    handle.dispatchEvent({ type: "pointerdown", button: 0, clientX: 400, clientY: 350, preventDefault: () => {}, stopPropagation: () => {} });
    env.mockWindow.dispatchEvent({ type: "pointermove", clientX: 5000, clientY: 5000 });
    env.mockWindow.dispatchEvent({ type: "pointerup" });

    const bottomRightPos = poc.instance.renderer.getPosition();
    assert.ok(bottomRightPos.relX <= 1.0, "relX must not exceed 1.0");
    assert.ok(bottomRightPos.relY <= 1.0, "relY must not exceed 1.0");

    console.log("PASS: Test 6 - Strict player boundary clamping verified.");
  }

  // -------------------------------------------------------------
  // Test 7: Stored position is relative { relX, relY } and persists to storage
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "保存テスト" }
    ]);
    video.seek(2.0);

    // Set custom relative position
    poc.instance.renderer.setPosition({ relX: 0.25, relY: 0.15 });
    poc.instance.persistPosition({ relX: 0.25, relY: 0.15 });

    assert.deepEqual(env.storageState.subtitle_overlay_position, { relX: 0.25, relY: 0.15 });

    console.log("PASS: Test 7 - Relative position persistence verified.");
  }

  // -------------------------------------------------------------
  // Test 8: Position survives resize and maintains relative layout
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "リサイズテスト" }
    ]);
    video.seek(2.0);

    // Position at top-right
    poc.instance.renderer.setPosition({ relX: 0.8, relY: 0.2 });

    // Video resized to 1280x720
    video.rect = { top: 50, left: 100, width: 1280, height: 720 };
    poc.instance.renderer.updatePosition();

    const pos = poc.instance.renderer.getPosition();
    assert.equal(pos.relX, 0.8, "relX preserved after resize");
    assert.equal(pos.relY, 0.2, "relY preserved after resize");

    console.log("PASS: Test 8 - Position preservation across resize verified.");
  }

  // -------------------------------------------------------------
  // Test 9: Position survives fullscreen enter, exit, and re-entry
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const playerWrapper = new env.MockElement("div", "player-container");
    playerWrapper.rect = { top: 100, left: 50, width: 800, height: 450 };
    const video = new env.MockVideoElement("hianime-video");
    video.rect = { top: 100, left: 50, width: 800, height: 450 };

    playerWrapper.appendChild(video);
    env.rootBody.appendChild(playerWrapper);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "全画面往復テスト" }
    ]);
    video.seek(2.0);

    // Move to custom position in normal mode
    poc.instance.renderer.setPosition({ relX: 0.75, relY: 0.3 });

    // 1. Enter fullscreen
    playerWrapper.rect = { top: 0, left: 0, width: 1920, height: 1080 };
    video.rect = { top: 0, left: 0, width: 1920, height: 1080 };
    env.mockDocument.fullscreenElement = playerWrapper;
    env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

    assert.equal(poc.instance.renderer.getPosition().relX, 0.75, "Position preserved in fullscreen");
    assert.equal(poc.instance.renderer.getPosition().relY, 0.3, "Position preserved in fullscreen");

    // 2. Drag to new position inside fullscreen
    poc.instance.renderer.setPosition({ relX: 0.2, relY: 0.85 });

    // 3. Exit fullscreen
    playerWrapper.rect = { top: 100, left: 50, width: 800, height: 450 };
    video.rect = { top: 100, left: 50, width: 800, height: 450 };
    env.mockDocument.fullscreenElement = null;
    env.mockDocument.dispatchEvent({ type: "fullscreenchange" });

    assert.equal(poc.instance.renderer.getPosition().relX, 0.2, "New position from fullscreen preserved upon exit");
    assert.equal(poc.instance.renderer.getPosition().relY, 0.85, "New position from fullscreen preserved upon exit");

    console.log("PASS: Test 9 - Fullscreen roundtrip position preservation verified.");
  }

  // -------------------------------------------------------------
  // Test 10: Position survives HiAnime DOM container replacement/reparenting
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const oldWrapper = new env.MockElement("div", "player-container-1");
    const video = new env.MockVideoElement("hianime-video");
    oldWrapper.appendChild(video);
    env.rootBody.appendChild(oldWrapper);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "DOM再構築テスト" }
    ]);
    video.seek(2.0);

    poc.instance.renderer.setPosition({ relX: 0.4, relY: 0.6 });

    // Simulate player replacement during streaming switch
    const container = env.mockDocument.getElementById("ankiminer-video-overlay-container");
    container.parentElement.removeChild(container);
    assert.equal(container.isConnected, false);

    poc.instance.renderer.updatePosition();
    assert.equal(container.isConnected, true, "ensureMounted re-attached container");
    assert.equal(poc.instance.renderer.getPosition().relX, 0.4);
    assert.equal(poc.instance.renderer.getPosition().relY, 0.6);

    console.log("PASS: Test 10 - DOM replacement recovery & position preservation verified.");
  }

  // -------------------------------------------------------------
  // Test 11: Subtitle text selection & Yomitan/Kiroku mining work without triggering drag
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    poc.instance.syncEngine.setCues([
      { startTime: 1.0, endTime: 5.0, text: "日本語テスト" }
    ]);
    video.seek(2.0);

    const subtitle = env.mockDocument.getElementById("ankiminer-video-subtitle");

    // Text selection on subtitle span
    env.setSelection("日本語");
    subtitle.dispatchEvent({ type: "mouseup" });

    assert.equal(poc.instance.renderer.isDragging, false, "Selecting text must NOT start dragging");

    // Clear selection for hover detection test
    env.setSelection("");

    // Hover word detection
    subtitle.dispatchEvent({ type: "mouseenter" });
    subtitle.dispatchEvent({ type: "mousemove", clientX: 100, clientY: 100 });

    await new Promise(r => setTimeout(r, 220));

    const hoverMsg = env.sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED" && m.source === "subtitle_hover");
    assert.ok(hoverMsg, "Hover word lookup must fire smoothly");

    console.log("PASS: Test 11 - Text selection & hover mining independence verified.");
  }

  // -------------------------------------------------------------
  // Test 12: Playback Invariant - NO video.currentTime modification
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    video.seek(15.0);
    const initialSeekCount = video.seekCount;
    const initialCurrentTime = video.currentTime;

    const handle = env.mockDocument.getElementById("ankiminer-video-subtitle-handle");
    handle.dispatchEvent({ type: "pointerdown", button: 0, clientX: 100, clientY: 100, preventDefault: () => {}, stopPropagation: () => {} });
    env.mockWindow.dispatchEvent({ type: "pointermove", clientX: 300, clientY: 200 });
    env.mockWindow.dispatchEvent({ type: "pointerup" });

    assert.equal(video.currentTime, initialCurrentTime, "video.currentTime MUST NOT change during dragging or positioning");
    assert.equal(video.seekCount, initialSeekCount, "No seeks may be performed by dragging");

    console.log("PASS: Test 12 - Playback currentTime invariant verified.");
  }

  // -------------------------------------------------------------
  // Test 13: Playback Invariant - NO play()/pause() calls introduced by dragging/positioning
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    const initialPlayCount = video.playCount;
    const initialPauseCount = video.pauseCount;

    poc.instance.renderer.setPosition({ relX: 0.1, relY: 0.1 });
    poc.instance.renderer.resetPosition();

    assert.equal(video.playCount, initialPlayCount, "play() must not be called");
    assert.equal(video.pauseCount, initialPauseCount, "pause() must not be called");

    console.log("PASS: Test 13 - Playback play/pause invariant verified.");
  }

  // -------------------------------------------------------------
  // Test 14: Extension message control (SET_SUBTITLE_POSITION, GET_SUBTITLE_POSITION, RESET_SUBTITLE_POSITION)
  // -------------------------------------------------------------
  {
    const env = createMockEnvironment();
    const poc = env.context.window.__ANKIMINER_VIDEO_POC__;

    const video = new env.MockVideoElement("hianime-video");
    env.rootBody.appendChild(video);
    poc.instance.detector.checkVideos();

    // 1. SET_SUBTITLE_POSITION
    let response = null;
    poc.instance.handleMessage({ type: "SET_SUBTITLE_POSITION", position: { relX: 0.65, relY: 0.4 } }, null, (r) => { response = r; });
    assert.equal(response.ok, true);
    assert.equal(response.position.relX, 0.65);
    assert.equal(response.position.relY, 0.4);
    assert.equal(poc.instance.renderer.getPosition().relX, 0.65);
    assert.equal(poc.instance.renderer.getPosition().relY, 0.4);

    // 2. GET_SUBTITLE_POSITION
    response = null;
    poc.instance.handleMessage({ type: "GET_SUBTITLE_POSITION" }, null, (r) => { response = r; });
    assert.equal(response.ok, true);
    assert.equal(response.position.relX, 0.65);
    assert.equal(response.position.relY, 0.4);

    // 3. RESET_SUBTITLE_POSITION
    response = null;
    poc.instance.handleMessage({ type: "RESET_SUBTITLE_POSITION" }, null, (r) => { response = r; });
    assert.equal(response.ok, true);
    assert.equal(response.position.relX, 0.5);
    assert.equal(response.position.relY, 0.78);
    assert.equal(poc.instance.renderer.getPosition().relX, 0.5);
    assert.equal(poc.instance.renderer.getPosition().relY, 0.78);

    console.log("PASS: Test 14 - Message handlers & position reset verified.");
  }

  console.log("\n>>> ALL MOVABLE SUBTITLE OVERLAY & HIANIME FULLSCREEN TESTS PASSED! <<<\n");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
