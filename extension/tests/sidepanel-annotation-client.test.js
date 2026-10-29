const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mock Element supporting classes, datasets, attributes, children, event delegation
class MockElement {
  constructor(tagName = "div", id = "", className = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this._textContent = "";
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.style = {};
    this.scrollHeight = 20;
    this.value = "";

    const classesSet = new Set(className ? className.split(/\s+/).filter(Boolean) : []);
    this.classList = {
      _classes: classesSet,
      add: (...classes) => {
        classes.forEach(c => classesSet.add(c));
      },
      remove: (...classes) => {
        classes.forEach(c => classesSet.delete(c));
      },
      toggle: (c, force) => {
        if (force === undefined) {
          if (classesSet.has(c)) classesSet.delete(c);
          else classesSet.add(c);
        } else if (force) {
          classesSet.add(c);
        } else {
          classesSet.delete(c);
        }
      },
      contains: (c) => classesSet.has(c)
    };
  }

  get className() {
    return Array.from(this.classList._classes).join(" ");
  }

  set className(val) {
    this.classList._classes.clear();
    if (val) {
      String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
    }
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => (c.textContent !== undefined ? c.textContent : "")).join("");
    }
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach(n => {
      if (typeof n === "string") {
        this.appendChild(new MockTextNode(n));
      } else if (n) {
        this.appendChild(n);
      }
    });
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach(n => {
      if (typeof n === "string") {
        this.children.push(new MockTextNode(n));
      } else if (n) {
        n.parentNode = this;
        this.children.push(n);
      }
    });
    this._textContent = "";
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camelKey] = String(val);
    }
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      delete this.dataset[camelKey];
    }
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  dispatchEvent(event) {
    const evt = typeof event === "string" ? { type: event, target: this, bubbles: true } : event;
    if (!evt.target) evt.target = this;
    const listeners = this._listeners[evt.type] || [];
    for (const fn of listeners) {
      fn(evt);
    }
    if (evt.bubbles !== false && this.parentNode && typeof this.parentNode.dispatchEvent === "function") {
      this.parentNode.dispatchEvent(evt);
    }
    return true;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  matches(selector) {
    if (!selector) return false;
    if (selector.includes(",")) {
      return selector.split(",").some(s => this.matches(s.trim()));
    }
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    if (selector.startsWith("[") && selector.endsWith("]")) {
      const attrExpr = selector.slice(1, -1);
      const [attrName, expectedVal] = attrExpr.split("=");
      if (!expectedVal) return this.getAttribute(attrName) !== null;
      const cleanExpected = expectedVal.replace(/^["']|["']$/g, "");
      return this.getAttribute(attrName) === cleanExpected;
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (!child || typeof child.matches !== "function") continue;
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (!child || typeof child.matches !== "function") continue;
        if (child.matches(selector)) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

class MockTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

// Setup full mock sandbox for sidepanel.js
function createSidepanelSandbox(customFetch) {
  const mockStorage = {
    active_sub_size: "large"
  };

  const previewEl = new MockElement(
    "div",
    "video-current-cue-preview",
    "video-cue-preview video-sub-text waiting active-sub-size-large"
  );
  previewEl.textContent = "Waiting for playback…";

  const sizeControls = new MockElement("div", "active-sub-size-controls", "active-sub-size-controls");
  const btnSmall = new MockElement("button", "btn-sub-size-small", "sub-size-btn");
  btnSmall.setAttribute("data-size", "small");
  btnSmall.textContent = "S";

  const btnMedium = new MockElement("button", "btn-sub-size-medium", "sub-size-btn");
  btnMedium.setAttribute("data-size", "medium");
  btnMedium.textContent = "M";

  const btnLarge = new MockElement("button", "btn-sub-size-large", "sub-size-btn active");
  btnLarge.setAttribute("data-size", "large");
  btnLarge.setAttribute("aria-pressed", "true");
  btnLarge.textContent = "L";

  const btnXLarge = new MockElement("button", "btn-sub-size-xlarge", "sub-size-btn");
  btnXLarge.setAttribute("data-size", "xlarge");
  btnXLarge.textContent = "XL";

  sizeControls.appendChild(btnSmall);
  sizeControls.appendChild(btnMedium);
  sizeControls.appendChild(btnLarge);
  sizeControls.appendChild(btnXLarge);

  const domElements = {
    "video-current-cue-preview": previewEl,
    "active-sub-size-controls": sizeControls,
    "btn-sub-size-small": btnSmall,
    "btn-sub-size-medium": btnMedium,
    "btn-sub-size-large": btnLarge,
    "btn-sub-size-xlarge": btnXLarge,
    "active-sub-grammar-slot": new MockElement("div", "active-sub-grammar-slot"),
    "btn-mine-full-sentence": new MockElement("button", "btn-mine-full-sentence"),
    "recent-cues-section": new MockElement("div", "recent-cues-section"),
    "recent-cues-list": new MockElement("ul", "recent-cues-list"),
    "video-mining-view": new MockElement("div", "video-mining-view"),
    "card-editor-section": new MockElement("div", "card-editor-section"),
    "field-expression": new MockElement("input", "field-expression"),
    "field-reading": new MockElement("input", "field-reading"),
    "field-example-sentence": new MockElement("textarea", "field-example-sentence"),
    "expression": new MockElement("span", "expression"),
    "reading": new MockElement("span", "reading")
  };

  const storageListeners = [];
  const mockChrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === "string") return { [keys]: mockStorage[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach(k => { out[k] = mockStorage[k]; });
            return out;
          }
          return { ...mockStorage };
        },
        set: async (obj) => {
          Object.assign(mockStorage, obj);
          storageListeners.forEach(listener => {
            const changes = {};
            Object.keys(obj).forEach(k => {
              changes[k] = { newValue: obj[k] };
            });
            listener(changes, "local");
          });
        },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach(k => delete mockStorage[k]);
        }
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn)
      }
    },
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} }
    },
    tabs: {
      sendMessage: async () => ({})
    }
  };

  const identifiedCalls = [];

  const sandbox = {
    chrome: mockChrome,
    document: {
      querySelector: (sel) => {
        const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
        if (idMatch && domElements[idMatch[1]]) return domElements[idMatch[1]];
        if (sel === "#video-current-cue-preview") return previewEl;
        if (sel === "#active-sub-size-controls") return sizeControls;
        return new MockElement("div");
      },
      querySelectorAll: (sel) => {
        if (sel.includes("sub-size-btn") || sel.includes("[data-size]")) {
          return [btnSmall, btnMedium, btnLarge, btnXLarge];
        }
        return [];
      },
      createElement: (tag) => new MockElement(tag),
      createTextNode: (txt) => new MockTextNode(txt),
      addEventListener: () => {},
      body: new MockElement("body"),
      getElementById: (id) => domElements[id] || new MockElement("div", id)
    },
    window: {
      location: { href: "chrome-extension://test/sidepanel.html" },
      addEventListener: () => {},
      identify: (word, options) => {
        identifiedCalls.push({ word, options });
      }
    },
    Event: class Event {
      constructor(type, init) {
        this.type = type;
        if (init) Object.assign(this, init);
      }
    },
    fetch: customFetch || (async () => ({ ok: false })),
    console,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    mockStorage,
    domElements,
    identifiedCalls,
    identify: async (word, options) => {
      identifiedCalls.push({ word, options });
    }
  };

  vm.createContext(sandbox);
  const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
  const jsContent = fs.readFileSync(jsPath, "utf8");
  vm.runInContext(jsContent, sandbox);

  return { sandbox, domElements, previewEl, sizeControls, mockStorage, identifiedCalls };
}

test("Token rendering logic: When cue has tokens, #video-current-cue-preview renders inline spans with appropriate classes (mined, should-know, unstyled)", async () => {
  const { sandbox, domElements, previewEl } = createSidepanelSandbox();
  const sidepanel = sandbox.module.exports;

  assert.ok(sidepanel, "sidepanel.js must export modules");
  assert.ok(typeof sidepanel.updateVideoCuePreviewText === "function", "updateVideoCuePreviewText must be exported");

  // Prepare cue with 3 token states (mined, unstyled, should-know)
  const tokens = [
    { surface: "猫", lemma: "猫", reading: "ねこ", status: "mined", jlpt_level: "N5" },
    { surface: "が", lemma: "が", reading: "が", status: "unstyled", jlpt_level: null },
    { surface: "走る", lemma: "走る", reading: "はしる", status: "should-know", jlpt_level: "N5" }
  ];

  const cue = {
    id: "cue-1",
    text: "猫が走る",
    tokens
  };

  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(cue);
  } else {
    sandbox.currentActiveCue = cue;
  }

  sidepanel.updateVideoCuePreviewText("猫が走る");

  // Preview must contain 3 child spans
  assert.equal(previewEl.children.length, 3, "Must render exactly 3 token spans");

  const [span1, span2, span3] = previewEl.children;

  // Verify Span 1: mined
  assert.equal(span1.textContent, "猫");
  assert.ok(span1.classList.contains("sub-token"), "Must have class sub-token");
  assert.ok(span1.classList.contains("mined"), "Must have class mined");
  assert.equal(span1.getAttribute("data-surface"), "猫");
  assert.equal(span1.getAttribute("data-lemma"), "猫");
  assert.equal(span1.getAttribute("data-status"), "mined");

  // Verify Span 2: unstyled
  assert.equal(span2.textContent, "が");
  assert.ok(span2.classList.contains("sub-token"), "Must have class sub-token");
  assert.ok(span2.classList.contains("unstyled"), "Must have class unstyled");
  assert.equal(span2.getAttribute("data-surface"), "が");
  assert.equal(span2.getAttribute("data-lemma"), "が");
  assert.equal(span2.getAttribute("data-status"), "unstyled");

  // Verify Span 3: should-know
  assert.equal(span3.textContent, "走る");
  assert.ok(span3.classList.contains("sub-token"), "Must have class sub-token");
  assert.ok(span3.classList.contains("should-know"), "Must have class should-know");
  assert.equal(span3.getAttribute("data-surface"), "走る");
  assert.equal(span3.getAttribute("data-lemma"), "走る");
});

test("Token rendering logic: Backend status 'should_know' with underscore maps to 'should-know' class", async () => {
  const { sandbox, previewEl } = createSidepanelSandbox();
  const sidepanel = sandbox.module.exports;

  const tokens = [
    { surface: "日本語", lemma: "日本語", reading: "にほんご", status: "should_know", jlpt_level: "N5" }
  ];

  const cue = { id: "cue-2", text: "日本語", tokens };
  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(cue);
  } else {
    sandbox.currentActiveCue = cue;
  }

  sidepanel.updateVideoCuePreviewText("日本語");

  assert.equal(previewEl.children.length, 1);
  const span = previewEl.children[0];
  assert.ok(span.classList.contains("sub-token"), "Must have sub-token class");
  assert.ok(span.classList.contains("should-know"), "should_know must produce should-know CSS class");
  assert.equal(span.textContent, "日本語");
});

test("Token rendering logic: Tokens resolved from annotatedCuesCache by cue ID or text", async () => {
  const { sandbox, previewEl } = createSidepanelSandbox();
  const sidepanel = sandbox.module.exports;

  assert.ok(sidepanel.annotatedCuesCache, "annotatedCuesCache must be exported");

  const tokens = [
    { surface: "勉強", lemma: "勉強", reading: "べんきょう", status: "mined", jlpt_level: "N5" }
  ];

  // Store in cache by text
  sidepanel.annotatedCuesCache.set("勉強する", tokens);

  const cue = { id: "cue-3", text: "勉強する" };
  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(cue);
  } else {
    sandbox.currentActiveCue = cue;
  }

  sidepanel.updateVideoCuePreviewText("勉強する");

  assert.equal(previewEl.children.length, 1);
  assert.equal(previewEl.children[0].textContent, "勉強");
  assert.ok(previewEl.children[0].classList.contains("mined"));
});

test("Graceful degradation: When backend is offline or annotation is missing, plain text renders normally without crashing", async () => {
  const { sandbox, previewEl } = createSidepanelSandbox(async () => {
    throw new Error("Failed to fetch (offline)");
  });
  const sidepanel = sandbox.module.exports;

  // 1. Calling annotateLoadedSubtitles when backend is offline must not throw
  assert.ok(typeof sidepanel.annotateLoadedSubtitles === "function", "annotateLoadedSubtitles must exist");
  await assert.doesNotReject(async () => {
    await sidepanel.annotateLoadedSubtitles([{ id: "offline-cue", text: "雨が降る" }]);
  });

  // 2. Rendering cue with missing annotations must fall back to plain text
  const unannotatedCue = { id: "unannotated", text: "雨が降る" };
  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(unannotatedCue);
  } else {
    sandbox.currentActiveCue = unannotatedCue;
  }

  sidepanel.updateVideoCuePreviewText("雨が降る");
  assert.equal(previewEl.textContent, "雨が降る");
  assert.equal(previewEl.children.length, 0, "No token spans when unannotated");
});

test("Token click: Clicking a .sub-token triggers word identification for token.surface", async () => {
  const { sandbox, previewEl, identifiedCalls } = createSidepanelSandbox();
  const sidepanel = sandbox.module.exports;

  const tokens = [
    { surface: "走る", lemma: "走る", reading: "はしる", status: "should-know", jlpt_level: "N5" }
  ];
  const cue = { id: "cue-click", text: "走る", tokens };
  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(cue);
  } else {
    sandbox.currentActiveCue = cue;
  }

  sidepanel.updateVideoCuePreviewText("走る");

  assert.equal(previewEl.children.length, 1);
  const tokenSpan = previewEl.children[0];

  // Dispatch click on the token span
  tokenSpan.dispatchEvent({ type: "click", target: tokenSpan, bubbles: true });

  // Verify identify was called for token.surface
  assert.ok(identifiedCalls.length > 0, "identify must be called upon token click");
  assert.equal(identifiedCalls[0].word, "走る", "Word passed to identify must match token.surface");
});

test("Font size controls: Clicking S, M, L, XL toggles .active-sub-size-* classes on #video-current-cue-preview and persists to storage", async () => {
  const { sandbox, previewEl, domElements, mockStorage } = createSidepanelSandbox();
  const sidepanel = sandbox.module.exports;

  assert.ok(typeof sidepanel.setActiveSubSize === "function", "setActiveSubSize must be exported");

  // Initial default must be large
  assert.ok(previewEl.classList.contains("active-sub-size-large"), "Default font size class must be active-sub-size-large");

  // Click Small (S)
  const btnSmall = domElements["btn-sub-size-small"];
  btnSmall.dispatchEvent({ type: "click", target: btnSmall, bubbles: true });

  assert.ok(previewEl.classList.contains("active-sub-size-small"), "Must toggle .active-sub-size-small");
  assert.ok(!previewEl.classList.contains("active-sub-size-large"), "Must remove .active-sub-size-large");
  assert.equal(mockStorage.active_sub_size, "small", "Must persist 'small' to storage");

  // Click Medium (M)
  const btnMedium = domElements["btn-sub-size-medium"];
  btnMedium.dispatchEvent({ type: "click", target: btnMedium, bubbles: true });

  assert.ok(previewEl.classList.contains("active-sub-size-medium"), "Must toggle .active-sub-size-medium");
  assert.ok(!previewEl.classList.contains("active-sub-size-small"), "Must remove .active-sub-size-small");
  assert.equal(mockStorage.active_sub_size, "medium", "Must persist 'medium' to storage");

  // Click XL (XL)
  const btnXLarge = domElements["btn-sub-size-xlarge"];
  btnXLarge.dispatchEvent({ type: "click", target: btnXLarge, bubbles: true });

  assert.ok(previewEl.classList.contains("active-sub-size-xlarge"), "Must toggle .active-sub-size-xlarge");
  assert.ok(!previewEl.classList.contains("active-sub-size-medium"), "Must remove .active-sub-size-medium");
  assert.equal(mockStorage.active_sub_size, "xlarge", "Must persist 'xlarge' to storage");

  // Click Large (L)
  const btnLarge = domElements["btn-sub-size-large"];
  btnLarge.dispatchEvent({ type: "click", target: btnLarge, bubbles: true });

  assert.ok(previewEl.classList.contains("active-sub-size-large"), "Must toggle back to .active-sub-size-large");
  assert.equal(mockStorage.active_sub_size, "large", "Must persist 'large' to storage");
});

test("Integration: annotateLoadedSubtitles sends batch cues to /api/subtitle/annotate and updates active preview", async () => {
  let requestedUrl = null;
  let requestedBody = null;

  const mockResponse = {
    version: 1,
    cues: [
      {
        id: "c1",
        tokens: [
          { surface: "猫", lemma: "猫", reading: "ねこ", status: "mined", jlpt_level: "N5" }
        ]
      }
    ]
  };

  const { sandbox, previewEl } = createSidepanelSandbox(async (url, opts) => {
    requestedUrl = url;
    requestedBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => mockResponse
    };
  });
  const sidepanel = sandbox.module.exports;

  const activeCue = { id: "c1", text: "猫" };
  if (typeof sidepanel.setCurrentActiveCue === "function") {
    sidepanel.setCurrentActiveCue(activeCue);
  } else {
    sandbox.currentActiveCue = activeCue;
  }

  await sidepanel.annotateLoadedSubtitles([activeCue]);

  assert.ok(requestedUrl.includes("/api/subtitle/annotate"), "Must call /api/subtitle/annotate");
  assert.equal(requestedBody.cues.length, 1);
  assert.equal(requestedBody.cues[0].text, "猫");

  // Tokens must be in annotatedCuesCache
  assert.ok(sidepanel.annotatedCuesCache.has("c1") || sidepanel.annotatedCuesCache.has("猫"), "Tokens must be cached in annotatedCuesCache");

  // Active preview should be re-rendered with token
  assert.equal(previewEl.children.length, 1);
  assert.equal(previewEl.children[0].textContent, "猫");
  assert.ok(previewEl.children[0].classList.contains("mined"));
});
