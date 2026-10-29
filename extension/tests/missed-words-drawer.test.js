const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mock Element supporting classes, datasets, attributes, children, event delegation, click
class MockElement {
  constructor(tagName = "div", id = "", className = "", doc = null) {
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
    this._document = doc;

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
    if (this._document) child._document = this._document;
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
        if (this._document) n._document = this._document;
        this.children.push(n);
      }
    });
    this._textContent = "";
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === "hidden") {
      this.hidden = true;
    }
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camelKey] = String(val);
    }
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.attributes[name] !== undefined;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "hidden") {
      this.hidden = false;
    }
    if (name.startsWith("data-")) {
      const camelKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      delete this.dataset[camelKey];
    }
  }

  addEventListener(type, listener) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(l => l !== listener);
  }

  dispatchEvent(event) {
    const evt = typeof event === "string" ? { type: event, target: this, bubbles: true } : event;
    if (!evt.target) evt.target = this;
    if (typeof evt.stopPropagation !== "function") {
      evt.stopPropagation = () => { evt._stopped = true; };
    }
    if (typeof evt.preventDefault !== "function") {
      evt.preventDefault = () => { evt._defaultPrevented = true; };
    }
    const listeners = (this._listeners[evt.type] || []).slice();
    for (const fn of listeners) {
      fn(evt);
    }
    if (evt.bubbles !== false && !evt._stopped && this.parentNode && typeof this.parentNode.dispatchEvent === "function") {
      this.parentNode.dispatchEvent(evt);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this, bubbles: true });
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

async function createSidepanelSandbox(options = {}) {
  const { customFetch, initialStorage = {}, initialMinedWords = [], initialMarkedKnown = [] } = options;
  const mockStorage = {
    active_sub_size: "large",
    ...initialStorage
  };

  const doc = {
    activeElement: null,
    body: null,
    querySelector: null,
    querySelectorAll: null,
    createElement: null,
    createTextNode: null,
    addEventListener: () => {},
    getElementById: null
  };

  // Drawer Elements
  const videoMissedWordsDrawer = new MockElement("div", "video-missed-words-drawer", "video-missed-words-drawer", doc);
  const videoMissedWordsHeader = new MockElement("div", "video-missed-words-header", "missed-words-header", doc);
  videoMissedWordsHeader.setAttribute("role", "button");
  videoMissedWordsHeader.setAttribute("tabindex", "0");
  videoMissedWordsHeader.setAttribute("aria-expanded", "false");
  videoMissedWordsHeader.setAttribute("aria-controls", "video-missed-words-body");

  const titleWrap = new MockElement("div", "", "missed-words-title-wrap", doc);
  const titleSpan = new MockElement("span", "", "missed-words-title", doc);
  titleSpan.textContent = "Did I miss a word?";
  const videoMissedWordsBadge = new MockElement("span", "video-missed-words-badge", "missed-words-count-badge", doc);
  videoMissedWordsBadge.textContent = "0";
  titleWrap.appendChild(titleSpan);
  titleWrap.appendChild(videoMissedWordsBadge);

  const chevronSpan = new MockElement("span", "", "missed-words-chevron", doc);
  chevronSpan.setAttribute("aria-hidden", "true");

  videoMissedWordsHeader.appendChild(titleWrap);
  videoMissedWordsHeader.appendChild(chevronSpan);

  const videoMissedWordsBody = new MockElement("div", "video-missed-words-body", "missed-words-body", doc);
  videoMissedWordsBody.hidden = true;
  videoMissedWordsBody.setAttribute("hidden", "");

  const videoMissedWordsList = new MockElement("div", "video-missed-words-list", "missed-words-list", doc);
  videoMissedWordsBody.appendChild(videoMissedWordsList);

  videoMissedWordsDrawer.appendChild(videoMissedWordsHeader);
  videoMissedWordsDrawer.appendChild(videoMissedWordsBody);

  // Subtitle / Preview elements
  const previewEl = new MockElement("div", "video-current-cue-preview", "video-cue-preview video-sub-text waiting active-sub-size-large", doc);
  previewEl.textContent = "Waiting for playback…";
  const recentCuesSection = new MockElement("div", "recent-cues-section", "recent-cues-section", doc);
  const recentCuesList = new MockElement("ul", "recent-cues-list", "recent-cues-list", doc);
  recentCuesSection.appendChild(recentCuesList);

  // Card editor & tabs
  const cardEditorSection = new MockElement("section", "card-editor-section", "card-editor-section", doc);
  const cardEditor = new MockElement("form", "card-editor", "card-editor", doc);
  const fieldExpression = new MockElement("input", "field-expression", "form-control", doc);
  const fieldReading = new MockElement("input", "field-reading", "form-control", doc);
  const fieldMeaning = new MockElement("textarea", "field-meaning", "form-control", doc);
  const saveCardBtn = new MockElement("button", "save-card-btn", "btn-primary", doc);
  cardEditor.appendChild(fieldExpression);
  cardEditor.appendChild(fieldReading);
  cardEditor.appendChild(fieldMeaning);
  cardEditor.appendChild(saveCardBtn);
  cardEditorSection.appendChild(cardEditor);

  const tabBtnVideo = new MockElement("button", "tab-btn-video", "tab-btn active", doc);
  const videoMiningView = new MockElement("div", "video-mining-view", "video-mining-view", doc);
  videoMiningView.appendChild(previewEl);
  videoMiningView.appendChild(recentCuesSection);
  videoMiningView.appendChild(videoMissedWordsDrawer);

  const domElements = {
    "video-missed-words-drawer": videoMissedWordsDrawer,
    "video-missed-words-header": videoMissedWordsHeader,
    "video-missed-words-badge": videoMissedWordsBadge,
    "video-missed-words-count": videoMissedWordsBadge,
    "video-missed-words-body": videoMissedWordsBody,
    "video-missed-words-list": videoMissedWordsList,
    "video-current-cue-preview": previewEl,
    "recent-cues-section": recentCuesSection,
    "recent-cues-list": recentCuesList,
    "card-editor-section": cardEditorSection,
    "card-editor": cardEditor,
    "field-expression": fieldExpression,
    "field-reading": fieldReading,
    "field-meaning": fieldMeaning,
    "save-card-btn": saveCardBtn,
    "tab-btn-video": tabBtnVideo,
    "video-mining-view": videoMiningView,
  };

  doc.querySelector = (sel) => {
    const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
    if (idMatch && domElements[idMatch[1]]) return domElements[idMatch[1]];
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      if (domElements[id]) return domElements[id];
      return new MockElement("div", id, "", doc);
    }
    return new MockElement("div", "", "", doc);
  };

  doc.querySelectorAll = (sel) => {
    const results = [];
    Object.values(domElements).forEach(el => {
      if (el && typeof el.matches === "function" && el.matches(sel)) results.push(el);
      if (el && typeof el.querySelectorAll === "function") {
        results.push(...el.querySelectorAll(sel));
      }
    });
    return results;
  };

  doc.getElementById = (id) => domElements[id] || null;
  doc.createElement = (tag) => new MockElement(tag, "", "", doc);
  doc.createTextNode = (txt) => new MockTextNode(txt);
  doc.body = new MockElement("body", "", "", doc);

  const fetchCalls = [];
  const defaultFetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url.includes("/api/known-words/mark")) {
      const body = JSON.parse(options.body || "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, word: body.word }),
      };
    }
    if (url.includes("/api/known-words")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          etag: '"test-etag"',
          mined_words: initialMinedWords,
          marked_known: initialMarkedKnown,
        }),
      };
    }
    if (url.includes("/api/cards/save")) {
      const body = JSON.parse(options.body || "{}");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          id: 123,
          expression: body.expression,
          reading: body.reading || "",
          meaning: body.meaning || "",
          sync_status: "pending",
          is_new: true,
          is_duplicate: false,
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const runtimeListeners = [];
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
        },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach(k => delete mockStorage[k]);
        }
      },
      onChanged: {
        addListener: () => {}
      }
    },
    runtime: {
      sendMessage: async () => ({}),
      onMessage: {
        addListener: (fn) => runtimeListeners.push(fn)
      }
    },
    tabs: {
      sendMessage: async () => ({})
    }
  };

  const identifiedCalls = [];

  const sandbox = {
    chrome: mockChrome,
    document: doc,
    window: {
      location: { href: "chrome-extension://test/sidepanel.html" },
      addEventListener: () => {},
      identify: (word, opts) => {
        identifiedCalls.push({ word, opts });
      }
    },
    Event: class Event {
      constructor(type, init) {
        this.type = type;
        if (init) Object.assign(this, init);
      }
    },
    fetch: customFetch || defaultFetch,
    console,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    mockStorage,
    domElements,
    identifiedCalls,
    fetchCalls,
    runtimeListeners,
    identify: (word, opts) => {
      identifiedCalls.push({ word, opts });
    }
  };

  vm.createContext(sandbox);
  const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
  const jsContent = fs.readFileSync(jsPath, "utf8");
  vm.runInContext(jsContent, sandbox);

  return {
    sandbox,
    domElements,
    identifiedCalls,
    fetchCalls,
    runtimeListeners,
    drawer: videoMissedWordsDrawer,
    header: videoMissedWordsHeader,
    badge: videoMissedWordsBadge,
    body: videoMissedWordsBody,
    list: videoMissedWordsList,
    exports: sandbox.module.exports,
  };
}

// -------------------------------------------------------------
// Tests for Missed Words Drawer
// -------------------------------------------------------------

test("Missed Words Drawer: Clicking #video-missed-words-header toggles #video-missed-words-body open/closed", async () => {
  const { header, body, drawer } = await createSidepanelSandbox();

  // Initial state: hidden
  assert.equal(body.hidden, true, "Body should initially be hidden");
  assert.equal(header.getAttribute("aria-expanded"), "false", "Header aria-expanded should initially be false");
  assert.equal(drawer.classList.contains("expanded"), false, "Drawer should not have expanded class initially");

  // First click: expands
  header.click();
  assert.equal(body.hidden, false, "Body should be visible after click");
  assert.equal(header.getAttribute("aria-expanded"), "true", "Header aria-expanded should be true after click");
  assert.equal(drawer.classList.contains("expanded"), true, "Drawer should have expanded class after click");

  // Second click: collapses
  header.click();
  assert.equal(body.hidden, true, "Body should be hidden after second click");
  assert.equal(header.getAttribute("aria-expanded"), "false", "Header aria-expanded should be false after second click");
  assert.equal(drawer.classList.contains("expanded"), false, "Drawer should not have expanded class after second click");
});

test("Missed Words Drawer: Aggregation collects tokens with status === 'should-know' from cues and deduplicates by lemma/surface", async () => {
  const { runtimeListeners, list, badge, exports } = await createSidepanelSandbox();

  const cue1 = {
    id: "cue-1",
    startTime: 1.0,
    text: "毎朝走るのが好きです",
    tokens: [
      { surface: "毎朝", lemma: "毎朝", reading: "まいあさ", status: "unstyled" },
      { surface: "走る", lemma: "走る", reading: "はしる", status: "should-know", jlpt_level: "N5" },
    ]
  };

  // Dispatch SUBTITLE_CUE_CHANGED message or call handler
  const onMessage = runtimeListeners[0];
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue: cue1 });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue1);
  }

  // Verify item added
  assert.equal(badge.textContent.trim(), "1", "Badge should count 1 missed word");
  let items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 1, "Should render 1 missed word item in drawer");
  assert.equal(items[0].querySelector(".missed-word-surface")?.textContent.trim(), "走る");
  assert.equal(items[0].querySelector(".missed-word-reading")?.textContent.trim(), "はしる");
  assert.equal(items[0].querySelector(".missed-word-jlpt")?.textContent.trim(), "N5");

  // Cue 2 plays with inflected form of the same lemma "走る"
  const cue2 = {
    id: "cue-2",
    startTime: 5.0,
    text: "昨日は走った",
    tokens: [
      { surface: "走った", lemma: "走る", reading: "はしった", status: "should-know", jlpt_level: "N5" },
    ]
  };

  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue: cue2 });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue2);
  }

  // Deduplicated by lemma "走る"
  assert.equal(badge.textContent.trim(), "1", "Badge should remain 1 after deduplicated lemma");
  items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 1, "Drawer item count should remain 1");

  // Cue 3 plays with backend status 'should_know' (underscore)
  const cue3 = {
    id: "cue-3",
    startTime: 9.0,
    text: "ご飯を食べる",
    tokens: [
      { surface: "食べる", lemma: "食べる", reading: "たべる", status: "should_know", jlpt_level: "N5" },
    ]
  };

  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue: cue3 });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue3);
  }

  // Added second item
  assert.equal(badge.textContent.trim(), "2", "Badge should reflect 2 missed words");
  items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 2, "Drawer should now contain 2 missed word items");
});

test("Missed Words Drawer: Words already in mined cards or known_words are excluded from collection", async () => {
  const { runtimeListeners, list, badge, exports } = await createSidepanelSandbox({
    initialMinedWords: ["食べる"],
    initialMarkedKnown: ["走る"],
  });

  // If exports provide setKnownWords, pre-seed
  if (typeof exports.setKnownWords === "function") {
    exports.setKnownWords({ mined_words: ["食べる"], marked_known: ["走る"] });
  }

  const cue = {
    id: "cue-x",
    startTime: 2.0,
    text: "走って食べる猫",
    tokens: [
      { surface: "走る", lemma: "走る", reading: "はしる", status: "should-know", jlpt_level: "N5" },
      { surface: "食べる", lemma: "食べる", reading: "たべる", status: "should-know", jlpt_level: "N5" },
      { surface: "猫", lemma: "猫", reading: "ねこ", status: "should-know", jlpt_level: "N5" },
    ]
  };

  const onMessage = runtimeListeners[0];
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue);
  }

  // Only "猫" should be collected because "走る" is in known_words and "食べる" is in mined cards
  assert.equal(badge.textContent.trim(), "1", "Badge should count 1 (only 猫)");
  const items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 1, "Only 1 item should be rendered");
  assert.equal(items[0].querySelector(".missed-word-surface")?.textContent.trim(), "猫");
});

test("Missed Words Drawer: [Mine] button triggers identify(token.surface)", async () => {
  const { runtimeListeners, list, identifiedCalls, exports } = await createSidepanelSandbox();

  const cue = {
    id: "cue-mine",
    startTime: 12.0,
    text: "本を読む",
    tokens: [
      { surface: "読む", lemma: "読む", reading: "よむ", status: "should-know", jlpt_level: "N5" },
    ]
  };

  const onMessage = runtimeListeners[0];
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue);
  }

  const items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 1, "Must have 1 item");
  const mineBtn = items[0].querySelector(".missed-word-btn-mine") || items[0].querySelector("[data-action='mine']");
  assert.ok(mineBtn, "Item must contain [Mine] button");

  mineBtn.click();

  assert.ok(identifiedCalls.length > 0, "identify must have been called");
  assert.equal(identifiedCalls[0].word, "読む", "identify should be called with surface '読む'");
});

test("Missed Words Drawer: [Mark Known] button calls POST /api/known-words/mark, removes item, and decrements badge", async () => {
  const { runtimeListeners, list, badge, fetchCalls, exports } = await createSidepanelSandbox();

  const cue = {
    id: "cue-mark",
    startTime: 20.0,
    text: "本を読む犬",
    tokens: [
      { surface: "読む", lemma: "読む", reading: "よむ", status: "should-know", jlpt_level: "N5" },
      { surface: "犬", lemma: "犬", reading: "いぬ", status: "should-know", jlpt_level: "N5" },
    ]
  };

  const onMessage = runtimeListeners[0];
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue);
  }

  assert.equal(badge.textContent.trim(), "2", "Badge should initially be 2");
  let items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 2, "Must have 2 items");

  // Find Mark Known button for '読む'
  const targetItem = items.find(it => it.querySelector(".missed-word-surface")?.textContent.trim() === "読む");
  assert.ok(targetItem, "Target item for '読む' must exist");
  const markKnownBtn = targetItem.querySelector(".missed-word-btn-mark-known") || targetItem.querySelector("[data-action='mark-known']");
  assert.ok(markKnownBtn, "Must have [Mark Known] button");

  markKnownBtn.click();

  // Wait a microtick for async fetch
  await new Promise(resolve => setTimeout(resolve, 10));

  // Verify fetch call to POST /api/known-words/mark
  const markCall = fetchCalls.find(c => c.url.includes("/api/known-words/mark"));
  assert.ok(markCall, "Must call /api/known-words/mark");
  assert.equal(markCall.options.method, "POST");
  const parsedBody = JSON.parse(markCall.options.body);
  assert.equal(parsedBody.word, "読む");

  // Verify item removed and badge decremented
  assert.equal(badge.textContent.trim(), "1", "Badge should decrement to 1");
  items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 1, "Only 1 item should remain in drawer");
  assert.equal(items[0].querySelector(".missed-word-surface")?.textContent.trim(), "犬");

  // Subsequent cues with '読む' should be excluded because it's now known
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue);
  }
  assert.equal(badge.textContent.trim(), "1", "Badge should remain 1");
});

test("Missed Words Drawer: Saving a card excludes and removes that word from the drawer", async () => {
  const { runtimeListeners, list, badge, domElements, exports } = await createSidepanelSandbox();

  const cue = {
    id: "cue-save",
    startTime: 30.0,
    text: "美しい景色",
    tokens: [
      { surface: "美しい", lemma: "美しい", reading: "うつくしい", status: "should-know", jlpt_level: "N4" },
    ]
  };

  const onMessage = runtimeListeners[0];
  if (onMessage) {
    await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });
  } else if (typeof exports.harvestMissedWords === "function") {
    exports.harvestMissedWords(cue);
  }

  assert.equal(badge.textContent.trim(), "1", "Badge should be 1");
  assert.equal(list.querySelectorAll(".missed-word-item").length, 1, "Must have 1 item");

  // Simulate user filling card editor and saving
  domElements["field-expression"].value = "美しい";
  domElements["field-reading"].value = "うつくしい";
  domElements["field-meaning"].value = "beautiful";

  await exports.saveCard();

  assert.equal(badge.textContent.trim(), "0", "Badge should decrement to 0 after card is saved");
  assert.equal(list.querySelectorAll(".missed-word-item").length, 0, "Drawer item should be removed");
});

test("Missed Words Drawer: Keyboard navigation (Enter / Space) toggles drawer", async () => {
  const { header, body, drawer } = await createSidepanelSandbox();

  assert.equal(body.hidden, true);

  // Press Enter on header
  header.dispatchEvent({ type: "keydown", key: "Enter", bubbles: true });
  assert.equal(body.hidden, false, "Enter key should expand body");
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.equal(drawer.classList.contains("expanded"), true);

  // Press Space on header
  header.dispatchEvent({ type: "keydown", key: " ", bubbles: true });
  assert.equal(body.hidden, true, "Space key should collapse body");
  assert.equal(header.getAttribute("aria-expanded"), "false");
  assert.equal(drawer.classList.contains("expanded"), false);
});

test("Missed Words Drawer: [Mark Known] uses lemma when different from surface, or surface when lemma absent", async () => {
  const { runtimeListeners, list, fetchCalls } = await createSidepanelSandbox();

  const cue = {
    id: "cue-lemma",
    startTime: 40.0,
    text: "飲んだお茶",
    tokens: [
      { surface: "飲んだ", lemma: "飲む", reading: "のんだ", status: "should-know", jlpt_level: "N5" },
      { surface: "お茶", lemma: "", reading: "おちゃ", status: "should-know", jlpt_level: "N5" },
    ]
  };

  const onMessage = runtimeListeners[0];
  await onMessage({ type: "SUBTITLE_CUE_CHANGED", cue });

  const items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 2);

  // Mark '飲んだ' known -> should send lemma '飲む'
  const item1 = items.find(it => it.querySelector(".missed-word-surface")?.textContent.trim() === "飲んだ");
  assert.ok(item1);
  const btnKnown1 = item1.querySelector(".missed-word-btn-mark-known");
  btnKnown1.click();
  await new Promise(r => setTimeout(r, 10));

  const markCall1 = fetchCalls.find(c => c.url.includes("/api/known-words/mark") && c.options.body.includes("飲む"));
  assert.ok(markCall1, "Must call /api/known-words/mark with lemma '飲む'");

  // Mark 'お茶' known -> should fallback to surface 'お茶'
  const item2 = list.querySelectorAll(".missed-word-item")[0];
  assert.equal(item2.querySelector(".missed-word-surface")?.textContent.trim(), "お茶");
  const btnKnown2 = item2.querySelector(".missed-word-btn-mark-known");
  btnKnown2.click();
  await new Promise(r => setTimeout(r, 10));

  const markCall2 = fetchCalls.find(c => c.url.includes("/api/known-words/mark") && c.options.body.includes("お茶"));
  assert.ok(markCall2, "Must call /api/known-words/mark with surface 'お茶'");
});

test("Missed Words Drawer: RECENT_CUES_UPDATED harvests should-know tokens from all recent cues", async () => {
  const { runtimeListeners, list, badge } = await createSidepanelSandbox();

  const recentCues = [
    {
      id: "rc-1",
      startTime: 10.0,
      text: "空が青い",
      tokens: [
        { surface: "空", lemma: "空", reading: "そら", status: "should-know", jlpt_level: "N5" },
        { surface: "青い", lemma: "青い", reading: "あおい", status: "should-know", jlpt_level: "N5" },
      ]
    },
    {
      id: "rc-2",
      startTime: 15.0,
      text: "海も青い",
      tokens: [
        { surface: "海", lemma: "海", reading: "うみ", status: "should-know", jlpt_level: "N5" },
        { surface: "青い", lemma: "青い", reading: "あおい", status: "should-know", jlpt_level: "N5" }, // duplicate
      ]
    }
  ];

  const onMessage = runtimeListeners[0];
  await onMessage({ type: "RECENT_CUES_UPDATED", cues: recentCues });

  // 3 unique missed words: 空, 青い, 海
  assert.equal(badge.textContent.trim(), "3", "Should aggregate 3 unique missed words");
  const items = list.querySelectorAll(".missed-word-item");
  assert.equal(items.length, 3, "List should render 3 items");
});

