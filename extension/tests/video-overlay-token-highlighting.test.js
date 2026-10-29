/**
 * Unit Tests: Live Video Overlay Token Highlighting Preserving Yomitan / Hover Scanning
 * 
 * Verifies:
 * 1. SubtitleOverlayRenderer.renderCue(cue) renders inline token <span> elements when cue.tokens is provided:
 *    - <span class="video-sub-token mined" ...>
 *    - <span class="video-sub-token should-know" ...>
 *    - <span class="video-sub-token unstyled" ...>
 * 2. Fallback: when cue.tokens is undefined or empty, it renders this.subtitleEl.textContent = cue.text.
 * 3. Preserves hover scanning: spans are display: inline, have transparent background, zero margins/padding.
 * 4. Yomitan/hover auto-pause: subtitleEl mouseenter, mouseleave, and mousemove listeners continue to lock/pause.
 * 5. Text selection / click handlers on subtitleEl continue to capture text.
 * 6. VideoMiningPOC message handling: UPDATE_ANNOTATED_CUES and LOAD_SUBTITLE_CUES update in-memory annotated cues.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pocPath = path.resolve(__dirname, "../content/video-mining-poc.js");

function createMockEnvironment() {
  const sentMessages = [];
  const messageListeners = [];
  const storageData = {};

  class MockElement {
    constructor(tagName) {
      this.tagName = tagName ? tagName.toUpperCase() : "DIV";
      this.id = "";
      this.className = "";
      this.children = [];
      this.parentElement = null;
      this.style = {
        setProperty: (prop, val) => {
          this.style[prop] = val;
        }
      };
      this._textContent = "";
      this._attrs = {};
      this._listeners = {};
      this.isConnected = true;
    }

    get textContent() {
      if (this.children.length > 0) {
        return this.children.map(c => c.textContent).join("");
      }
      return this._textContent;
    }

    set textContent(val) {
      this._textContent = String(val ?? "");
      this.children = [];
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      this.children.push(child);
      child.parentElement = this;
      child.isConnected = true;
      return child;
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

    replaceChildren(...newChildren) {
      this.children = [];
      this._textContent = "";
      for (const child of newChildren) {
        if (child) this.appendChild(child);
      }
    }

    setAttribute(name, val) {
      this._attrs[name] = String(val);
    }

    getAttribute(name) {
      return this._attrs[name] !== undefined ? this._attrs[name] : null;
    }

    removeAttribute(name) {
      delete this._attrs[name];
    }

    hasAttribute(name) {
      return name in this._attrs;
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
      const match = (el) => {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          if (el.className && el.className.split(" ").includes(cls)) return true;
        } else if (sel.toLowerCase() === el.tagName.toLowerCase()) {
          return true;
        }
        return false;
      };
      const traverse = (el) => {
        for (const c of el.children) {
          if (match(c)) results.push(c);
          traverse(c);
        }
      };
      traverse(this);
      return results;
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
      if (!event.target) event.target = this;
      let curr = this;
      let stopped = false;
      const origStop = event.stopPropagation;
      event.stopPropagation = () => {
        stopped = true;
        if (typeof origStop === "function") origStop.call(event);
      };
      while (curr && !stopped) {
        const handlers = curr._listeners[event.type] || [];
        for (const h of handlers) {
          h.call(curr, event);
        }
        curr = curr.parentElement;
      }
    }

    getBoundingClientRect() {
      return { top: 100, left: 100, width: 800, height: 450 };
    }
  }

  const mockHead = new MockElement("HEAD");
  const mockBody = new MockElement("BODY");

  const mockDocument = {
    head: mockHead,
    body: mockBody,
    documentElement: mockBody,
    createElement: (tag) => new MockElement(tag),
    createTextNode: (txt) => {
      const node = new MockElement("#text");
      node._textContent = txt;
      return node;
    },
    getElementById: (id) => {
      if (id === "ankiminer-video-overlay-styles") {
        return mockHead.querySelector("#" + id) || mockBody.querySelector("#" + id);
      }
      return mockBody.querySelector("#" + id);
    },
    querySelector: (sel) => mockBody.querySelector(sel) || mockHead.querySelector(sel),
    querySelectorAll: (sel) => [...mockHead.querySelectorAll(sel), ...mockBody.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Intl,
    Array,
    String,
    Math,
    Number,
    Boolean,
    RegExp,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    document: mockDocument,
    sentMessages,
    messageListeners,
    chrome: {
      runtime: {
        sendMessage: (msg) => {
          sentMessages.push(msg);
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener: (fn) => messageListeners.push(fn)
        }
      },
      storage: {
        local: {
          get: (keys, cb) => {
            const res = {};
            if (Array.isArray(keys)) {
              keys.forEach(k => { res[k] = storageData[k]; });
            } else if (typeof keys === "string") {
              res[keys] = storageData[keys];
            }
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (obj, cb) => {
            Object.assign(storageData, obj);
            if (cb) cb();
            return Promise.resolve();
          },
          remove: (keys, cb) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach(k => delete storageData[k]);
            if (cb) cb();
            return Promise.resolve();
          }
        },
        onChanged: {
          addListener: () => {}
        }
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    getSelection: () => ({
      toString: () => "",
      isCollapsed: true,
      rangeCount: 0
    })
  };
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(pocPath, "utf8");
  vm.runInContext(code, ctx);

  const poc = sandbox.window.__ANKIMINER_VIDEO_POC__ || sandbox.window.__KIROKU_VIDEO_POC__;
  return { sandbox, poc, sentMessages, messageListeners, mockDocument };
}

// ---------------------------------------------------------------------------
// Step 1.1: renderCue renders inline token spans when cue.tokens is provided
// ---------------------------------------------------------------------------
test("SubtitleOverlayRenderer.renderCue renders inline token spans for mined, should-know, and unstyled tokens", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    id: "cue-1",
    startTime: 1.0,
    endTime: 3.5,
    text: "日本語の勉強をする",
    tokens: [
      { surface: "日本語", lemma: "日本語", reading: "にほんご", status: "mined", jlpt_level: "N5" },
      { surface: "の", lemma: "の", reading: "の", status: "unstyled" },
      { surface: "勉強", lemma: "勉強", reading: "べんきょう", status: "should-know", jlpt_level: "N5" },
      { surface: "を", lemma: "を", reading: "を", status: "unstyled" },
      { surface: "する", lemma: "する", reading: "する", status: "mined", jlpt_level: "N5" }
    ]
  };

  renderer.renderCue(cue);

  assert.ok(renderer.subtitleEl, "subtitleEl must exist");
  assert.equal(renderer.subtitleEl.children.length, 5, "Must render exactly 5 token spans");

  const [t1, t2, t3, t4, t5] = renderer.subtitleEl.children;

  // Verify classes
  assert.ok(t1.className.includes("video-sub-token"), "t1 must have video-sub-token class");
  assert.ok(t1.className.includes("mined"), "t1 must have mined class");
  assert.equal(t1.textContent, "日本語");
  assert.equal(t1.getAttribute("data-surface"), "日本語");
  assert.equal(t1.getAttribute("data-lemma"), "日本語");
  assert.equal(t1.getAttribute("data-status"), "mined");
  assert.equal(t1.getAttribute("data-reading"), "にほんご");
  assert.equal(t1.getAttribute("data-jlpt-level"), "N5");

  assert.ok(t2.className.includes("video-sub-token"), "t2 must have video-sub-token class");
  assert.ok(t2.className.includes("unstyled"), "t2 must have unstyled class");
  assert.equal(t2.textContent, "の");

  assert.ok(t3.className.includes("video-sub-token"), "t3 must have video-sub-token class");
  assert.ok(t3.className.includes("should-know"), "t3 must have should-know class");
  assert.equal(t3.textContent, "勉強");
  assert.equal(t3.getAttribute("data-lemma"), "勉強");

  assert.ok(t4.className.includes("video-sub-token"), "t4 must have video-sub-token class");
  assert.ok(t4.className.includes("unstyled"), "t4 must have unstyled class");
  assert.equal(t4.textContent, "を");

  assert.ok(t5.className.includes("video-sub-token"), "t5 must have video-sub-token class");
  assert.ok(t5.className.includes("mined"), "t5 must have mined class");
  assert.equal(t5.textContent, "する");
});

test("SubtitleOverlayRenderer.renderCue normalizes status 'should_know' to 'should-know'", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    id: "cue-2",
    startTime: 4.0,
    endTime: 6.0,
    text: "食べる",
    tokens: [
      { surface: "食べる", lemma: "食べる", reading: "たべる", status: "should_know" }
    ]
  };

  renderer.renderCue(cue);

  const span = renderer.subtitleEl.children[0];
  assert.ok(span, "Span must be created");
  assert.ok(span.className.includes("video-sub-token"), "Must have video-sub-token class");
  assert.ok(span.className.includes("should-know"), "Must have normalized should-know class");
  assert.equal(span.textContent, "食べる");
});

// ---------------------------------------------------------------------------
// Step 1.2: Fallback when cue.tokens is undefined or empty
// ---------------------------------------------------------------------------
test("SubtitleOverlayRenderer.renderCue falls back to raw textContent when cue.tokens is undefined", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    startTime: 1.0,
    endTime: 3.0,
    text: "雨が降っている"
    // tokens undefined
  };

  renderer.renderCue(cue);

  assert.equal(renderer.subtitleEl.children.length, 0, "No child spans when tokens is undefined");
  assert.equal(renderer.subtitleEl.textContent, "雨が降っている", "Must set subtitleEl.textContent directly");
});

test("SubtitleOverlayRenderer.renderCue falls back to raw textContent when cue.tokens is empty array", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    startTime: 1.0,
    endTime: 3.0,
    text: "猫がいる",
    tokens: []
  };

  renderer.renderCue(cue);

  assert.equal(renderer.subtitleEl.children.length, 0, "No child spans when tokens is empty");
  assert.equal(renderer.subtitleEl.textContent, "猫がいる", "Must set subtitleEl.textContent directly");
});

// ---------------------------------------------------------------------------
// Step 1.3: Preserves hover scanning (display: inline, transparent bg, 0 margins/padding)
// ---------------------------------------------------------------------------
test("Preserves hover scanning: spans are display: inline, transparent background, zero margins/padding", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    text: "花が咲く",
    tokens: [
      { surface: "花", status: "mined" },
      { surface: "が", status: "unstyled" },
      { surface: "咲く", status: "should-know" }
    ]
  };

  renderer.renderCue(cue);

  for (const span of renderer.subtitleEl.children) {
    // Check inline display and transparent background to preserve continuous Yomitan scan ranges
    assert.equal(span.style.display, "inline", "Token span display must be inline");
    assert.equal(span.style.background, "transparent", "Token span background must be transparent");
    assert.ok(span.style.margin === "0px" || span.style.margin === "0" || !span.style.margin, "Margin must be 0");
    assert.ok(span.style.padding === "0px" || span.style.padding === "0" || !span.style.padding, "Padding must be 0");
  }
});

test("Overlay CSS stylesheet rules are injected for .video-sub-token styles", () => {
  const { poc, mockDocument } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);

  const styleEl = mockDocument.getElementById("ankiminer-video-overlay-styles");
  assert.ok(styleEl, "ankiminer-video-overlay-styles stylesheet must be mounted");
  const css = styleEl.textContent || "";
  assert.ok(css.includes(".video-sub-token"), "Must include .video-sub-token rule");
  assert.ok(css.includes("#d4884f"), "Must include mined color #d4884f");
  assert.ok(css.includes("#5db872"), "Must include should-know color #5db872");
  assert.ok(css.includes("underline"), "Must include subtle underline style");
});

// ---------------------------------------------------------------------------
// Step 1.4: Yomitan / hover auto-pause (mouseenter, mouseleave, mousemove lock)
// ---------------------------------------------------------------------------
test("Yomitan/hover auto-pause: mouseenter, mouseleave, and mousemove listeners lock/unlock hover state", () => {
  const { poc } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    text: "日本語の勉強",
    tokens: [
      { surface: "日本語", status: "mined" },
      { surface: "の", status: "unstyled" },
      { surface: "勉強", status: "should-know" }
    ]
  };
  renderer.renderCue(cue);

  assert.equal(renderer.isHoverLocked, false, "Hover lock initially false");

  // MouseEnter locks
  renderer.subtitleEl.dispatchEvent({ type: "mouseenter" });
  assert.equal(renderer.isHoverLocked, true, "MouseEnter must lock hover state");

  // MouseLeave unlocks
  renderer.subtitleEl.dispatchEvent({ type: "mouseleave" });
  assert.equal(renderer.isHoverLocked, false, "MouseLeave must unlock hover state");

  // MouseMove locks
  renderer.subtitleEl.dispatchEvent({ type: "mousemove" });
  assert.equal(renderer.isHoverLocked, true, "MouseMove must lock hover state");

  // While locked, cue clearing keeps current cue stable
  renderer.renderCue(null);
  assert.equal(renderer.currentCue, null, "currentCue set to null");
  assert.equal(renderer.subtitleEl.children.length, 3, "Subtitle elements stay visible while hover locked");

  // Once mouse leaves, pending cue is rendered
  renderer.subtitleEl.dispatchEvent({ type: "mouseleave" });
  assert.equal(renderer.isHoverLocked, false, "Hover lock released");
  assert.equal(renderer.subtitleEl.children.length, 0, "Cleared cue rendered after hover leaves");
});

// ---------------------------------------------------------------------------
// Step 1.5: Text selection / click handlers on subtitleEl continue to capture text
// ---------------------------------------------------------------------------
test("Text selection on tokenized subtitleEl dispatches JAPANESE_TEXT_CAPTURED", () => {
  const { poc, sandbox, sentMessages } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    text: "学校生活は楽しい",
    tokens: [
      { surface: "学校生活", status: "mined" },
      { surface: "は", status: "unstyled" },
      { surface: "楽しい", status: "should-know" }
    ]
  };
  renderer.renderCue(cue);

  sandbox.getSelection = () => ({
    toString: () => "学校生活",
    isCollapsed: false,
    rangeCount: 1
  });

  let stopped = false;
  renderer.subtitleEl.dispatchEvent({
    type: "mouseup",
    stopPropagation: () => { stopped = true; }
  });

  const captureMsg = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Must dispatch JAPANESE_TEXT_CAPTURED");
  assert.equal(captureMsg.text, "学校生活");
  assert.equal(captureMsg.source, "subtitle_selection");
  assert.equal(stopped, true, "Must stop propagation");
});

test("Click on individual token span captures the clicked token", () => {
  const { poc, sentMessages } = createMockEnvironment();
  const renderer = new poc.SubtitleOverlayRenderer();
  const mockVideo = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  renderer.mount(mockVideo);
  renderer.setDisplayEnabled(true);

  const cue = {
    text: "日本語の勉強",
    tokens: [
      { surface: "日本語", status: "mined" },
      { surface: "の", status: "unstyled" },
      { surface: "勉強", status: "should-know" }
    ]
  };
  renderer.renderCue(cue);

  const minedTokenSpan = renderer.subtitleEl.children[0];

  let stopped = false;
  minedTokenSpan.dispatchEvent({
    type: "click",
    target: minedTokenSpan,
    clientX: 120,
    clientY: 110,
    stopPropagation: () => { stopped = true; }
  });

  const captureMsg = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Must dispatch JAPANESE_TEXT_CAPTURED on click");
  assert.equal(captureMsg.text, "日本語", "Captured word must be the clicked token surface");
  assert.equal(captureMsg.source, "subtitle_click");
  assert.equal(stopped, true, "Must stop event propagation");
});

// ---------------------------------------------------------------------------
// Step 2 & Context: Message handling for annotated cues
// ---------------------------------------------------------------------------
test("VideoMiningPOC handles UPDATE_ANNOTATED_CUES message to enrich in-memory cues and active display", () => {
  const { poc } = createMockEnvironment();
  const instance = poc.instance;
  const mockVideo = {
    currentTime: 1.5,
    duration: 120,
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 450 }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  instance.detector.activeVideo = mockVideo;
  instance.activeVideo = mockVideo;
  instance.syncEngine.attach(mockVideo);
  instance.renderer.mount(mockVideo);
  instance.renderer.setDisplayEnabled(true);

  // Initial unannotated cues loaded
  instance.syncEngine.setCues([
    { id: "c1", startTime: 1.0, endTime: 3.0, text: "日本語の勉強" }
  ]);
  instance.syncEngine.sync(true);

  assert.equal(instance.renderer.subtitleEl.children.length, 0, "Initially unannotated text");
  assert.equal(instance.renderer.subtitleEl.textContent, "日本語の勉強");

  // Receive UPDATE_ANNOTATED_CUES runtime message
  let responsePayload = null;
  instance.handleMessage(
    {
      type: "UPDATE_ANNOTATED_CUES",
      cues: [
        {
          id: "c1",
          text: "日本語の勉強",
          tokens: [
            { surface: "日本語", status: "mined", lemma: "日本語" },
            { surface: "の", status: "unstyled" },
            { surface: "勉強", status: "should-know", lemma: "勉強" }
          ]
        }
      ]
    },
    {},
    (res) => { responsePayload = res; }
  );

  assert.ok(responsePayload?.ok, "UPDATE_ANNOTATED_CUES must return ok: true");
  assert.equal(instance.syncEngine.cues[0].tokens?.length, 3, "In-memory cue must receive tokens");
  assert.equal(instance.renderer.subtitleEl.children.length, 3, "Active display must be re-rendered with token spans");
  assert.ok(instance.renderer.subtitleEl.children[0].className.includes("mined"));
  assert.ok(instance.renderer.subtitleEl.children[2].className.includes("should-know"));
});
