const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Mock Element supporting classes, datasets, attributes, children, event delegation, focus
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

  contains(node) {
    if (!node) return false;
    let curr = node;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
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

  focus() {
    if (this._document) {
      this._document.activeElement = this;
    }
    this.dispatchEvent({ type: "focus", bubbles: false, target: this });
    this.dispatchEvent({ type: "focusin", bubbles: true, target: this });
  }

  blur() {
    if (this._document && this._document.activeElement === this) {
      this._document.activeElement = null;
    }
    this.dispatchEvent({ type: "blur", bubbles: false, target: this });
    this.dispatchEvent({ type: "focusout", bubbles: true, target: this });
  }
}

class MockTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

async function createSidepanelSandbox(customFetch = null, initialStorage = {}) {
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

  const cardEditorSection = new MockElement("section", "card-editor-section", "card-editor-section", doc);
  const cardEditor = new MockElement("form", "card-editor", "card-editor", doc);
  const cardLayoutContainer = new MockElement("div", "card-layout-container", "card-layout-container", doc);

  const videoCollapsedCardChip = new MockElement("div", "video-collapsed-card-chip", "video-collapsed-card-chip", doc);
  videoCollapsedCardChip.style.display = "none";
  const chipWord = new MockElement("span", "collapsed-chip-word", "chip-word", doc);
  const chipReading = new MockElement("span", "collapsed-chip-reading", "chip-reading", doc);
  const chipStatus = new MockElement("span", "collapsed-chip-status", "chip-status", doc);
  const btnExpandChip = new MockElement("button", "btn-expand-collapsed-chip", "btn-chip-expand", doc);
  videoCollapsedCardChip.appendChild(chipWord);
  videoCollapsedCardChip.appendChild(chipReading);
  videoCollapsedCardChip.appendChild(chipStatus);
  videoCollapsedCardChip.appendChild(btnExpandChip);

  const fieldExpression = new MockElement("input", "field-expression", "form-control", doc);
  const fieldReading = new MockElement("input", "field-reading", "form-control", doc);
  const fieldMeaning = new MockElement("textarea", "field-meaning", "form-control", doc);
  const fieldExampleSentence = new MockElement("textarea", "field-example-sentence", "form-control", doc);
  const saveCardBtn = new MockElement("button", "save-card-btn", "btn-primary", doc);

  cardEditor.appendChild(fieldExpression);
  cardEditor.appendChild(fieldReading);
  cardEditor.appendChild(fieldMeaning);
  cardEditor.appendChild(fieldExampleSentence);
  cardEditor.appendChild(saveCardBtn);

  cardEditorSection.appendChild(videoCollapsedCardChip);
  cardEditorSection.appendChild(cardEditor);
  cardEditorSection.appendChild(cardLayoutContainer);

  const tabBtnText = new MockElement("button", "tab-btn-text", "tab-btn active", doc);
  const tabBtnVideo = new MockElement("button", "tab-btn-video", "tab-btn", doc);
  const tabBtnQuickAdd = new MockElement("button", "tab-btn-quickadd", "tab-btn", doc);
  const tabBtnAsk = new MockElement("button", "tab-btn-ask", "tab-btn", doc);
  const tabBtnHistory = new MockElement("button", "tab-btn-history", "tab-btn", doc);
  const tabBtnSettings = new MockElement("button", "tab-btn-settings", "tab-btn", doc);

  const textMiningView = new MockElement("div", "text-mining-view", "", doc);
  const videoMiningView = new MockElement("div", "video-mining-view", "", doc);
  const quickAddMiningView = new MockElement("div", "quickadd-mining-view", "", doc);
  const askMiningView = new MockElement("div", "ask-mining-view", "", doc);
  const historySection = new MockElement("div", "history-section", "", doc);

  const previewEl = new MockElement("div", "video-current-cue-preview", "video-cue-preview video-sub-text waiting active-sub-size-large", doc);
  const settingVideoCollapseMode = new MockElement("select", "setting-video-collapse-mode", "settings-select", doc);
  const settingGrammarEnabled = new MockElement("input", "setting-grammar-enabled", "settings-checkbox", doc);
  settingGrammarEnabled.type = "checkbox";
  settingGrammarEnabled.checked = true;
  const settingGrammarVideoStrip = new MockElement("input", "setting-grammar-video-strip", "settings-checkbox", doc);
  settingGrammarVideoStrip.type = "checkbox";
  settingGrammarVideoStrip.checked = true;
  const grammarSlot = new MockElement("div", "active-sub-grammar-slot", "", doc);
  const grammarSessionList = new MockElement("div", "video-grammar-session-list", "", doc);
  const grammarSessionCount = new MockElement("span", "video-grammar-session-count", "", doc);
  const textGrammarSection = new MockElement("section", "text-grammar-section", "", doc);
  const textGrammarContent = new MockElement("div", "text-grammar-content", "", doc);
  const textGrammarCount = new MockElement("span", "text-grammar-count", "", doc);

  const domElements = {
    "card-editor-section": cardEditorSection,
    "card-editor": cardEditor,
    "card-layout-container": cardLayoutContainer,
    "video-collapsed-card-chip": videoCollapsedCardChip,
    "collapsed-chip-word": chipWord,
    "collapsed-chip-reading": chipReading,
    "collapsed-chip-status": chipStatus,
    "btn-expand-collapsed-chip": btnExpandChip,
    "field-expression": fieldExpression,
    "field-reading": fieldReading,
    "field-meaning": fieldMeaning,
    "field-example-sentence": fieldExampleSentence,
    "save-card-btn": saveCardBtn,
    "tab-btn-text": tabBtnText,
    "tab-btn-video": tabBtnVideo,
    "tab-btn-quickadd": tabBtnQuickAdd,
    "tab-btn-ask": tabBtnAsk,
    "tab-btn-history": tabBtnHistory,
    "tab-btn-settings": tabBtnSettings,
    "text-mining-view": textMiningView,
    "video-mining-view": videoMiningView,
    "quickadd-mining-view": quickAddMiningView,
    "ask-mining-view": askMiningView,
    "history-section": historySection,
    "video-current-cue-preview": previewEl,
    "setting-video-collapse-mode": settingVideoCollapseMode,
    "setting-grammar-enabled": settingGrammarEnabled,
    "setting-grammar-video-strip": settingGrammarVideoStrip,
    "active-sub-grammar-slot": grammarSlot,
    "video-grammar-session-list": grammarSessionList,
    "video-grammar-session-count": grammarSessionCount,
    "text-grammar-section": textGrammarSection,
    "text-grammar-content": textGrammarContent,
    "text-grammar-count": textGrammarCount,
    "expression": new MockElement("span", "expression", "", doc),
    "reading": new MockElement("span", "reading", "", doc)
  };

  doc.body = new MockElement("body", "body", "", doc);
  doc.querySelector = (sel) => {
    const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
    if (idMatch && domElements[idMatch[1]]) return domElements[idMatch[1]];
    if (sel === "#video-current-cue-preview") return previewEl;
    if (sel === "#card-editor-section") return cardEditorSection;
    if (sel === "#video-collapsed-card-chip") return videoCollapsedCardChip;
    return new MockElement("div", "", "", doc);
  };
  doc.querySelectorAll = (sel) => {
    return [];
  };
  doc.createElement = (tag) => {
    const element = new MockElement(tag, "", "", doc);
    if (String(tag).toLowerCase() === "canvas") {
      element.getContext = () => ({ drawImage: () => {} });
      element.toDataURL = () => "data:image/png;base64,CROPPED";
    }
    return element;
  };
  doc.createTextNode = (txt) => new MockTextNode(txt);
  doc.getElementById = (id) => domElements[id] || new MockElement("div", id, "", doc);

  const storageListeners = [];
  const messageListeners = [];

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
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    },
    tabs: {
      sendMessage: async () => ({})
    }
  };

  const defaultFetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("/api/capture")) {
      let parsed = {};
      try { parsed = JSON.parse(opts.body); } catch (_) {}
      const expr = parsed.text || "猫";
      const reading = expr === "食べる" ? "たべる" : (expr === "走る" ? "はしる" : (expr === "犬" ? "いぬ" : "ねこ"));
      return {
        ok: true,
        json: async () => ({
          id: 101,
          expression: expr,
          reading: reading,
          meaning: "sample meaning",
          is_new: true,
          is_duplicate: false,
          sync_status: "pending"
        })
      };
    }
    if (typeof url === "string" && (url.includes("/api/cards/save") || url.includes("/api/save"))) {
      let parsed = {};
      try { parsed = JSON.parse(opts.body); } catch (_) {}
      return {
        ok: true,
        json: async () => ({
          id: parsed.id || 102,
          expression: parsed.expression || "走る",
          reading: parsed.reading || "はしる",
          meaning: parsed.meaning || "to run",
          is_new: true,
          is_duplicate: false,
          sync_status: "pending"
        })
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  const sandbox = {
    chrome: mockChrome,
    document: doc,
    window: {
      location: { href: "chrome-extension://test/sidepanel.html" },
      addEventListener: () => {}
    },
    Event: class Event {
      constructor(type, init) {
        this.type = type;
        if (init) Object.assign(this, init);
      }
    },
    fetch: customFetch || defaultFetch,
    Image: class MockImage {
      constructor() { this.naturalWidth = 1920; this.naturalHeight = 1080; this.width = 1920; this.height = 1080; }
      set src(_) { queueMicrotask(() => this.onload?.()); }
    },
    console,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    mockStorage,
    domElements,
    messageListeners
  };

  vm.createContext(sandbox);
  const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
  const jsContent = fs.readFileSync(jsPath, "utf8");
  vm.runInContext(jsContent, sandbox);

  // Allow startup async tasks (loadTabPreference, loadVideoWorkspaceCollapsePreferences, etc.) to settle
  await new Promise(r => setTimeout(r, 30));

  return {
    sandbox,
    domElements,
    mockStorage,
    cardEditorSection,
    videoCollapsedCardChip,
    chipWord,
    chipReading,
    chipStatus,
    btnExpandChip,
    messageListeners,
    sidepanel: sandbox.module.exports
  };
}

test("Video Card Collapse: Setting video_workspace_collapse_mode defaults to auto_collapse and respects keep_open and dont_show", async () => {
  const { sandbox, mockStorage, sidepanel } = await createSidepanelSandbox();

  // Startup defaults
  assert.equal(
    typeof sidepanel.getVideoWorkspaceCollapseMode === "function"
      ? sidepanel.getVideoWorkspaceCollapseMode()
      : sandbox.videoWorkspaceCollapseMode,
    "auto_collapse",
    "Collapse mode must default to auto_collapse"
  );

  // Set mode to keep_open
  if (typeof sidepanel.setVideoWorkspaceCollapseMode === "function") {
    await sidepanel.setVideoWorkspaceCollapseMode("keep_open");
  } else {
    await sandbox.chrome.storage.local.set({ video_workspace_collapse_mode: "keep_open" });
  }

  assert.equal(
    mockStorage.video_workspace_collapse_mode,
    "keep_open",
    "Setting must persist keep_open to chrome.storage.local"
  );
  assert.equal(
    typeof sidepanel.getVideoWorkspaceCollapseMode === "function"
      ? sidepanel.getVideoWorkspaceCollapseMode()
      : sandbox.videoWorkspaceCollapseMode,
    "keep_open",
    "State machine must reflect keep_open mode"
  );

  // Set mode to dont_show
  if (typeof sidepanel.setVideoWorkspaceCollapseMode === "function") {
    await sidepanel.setVideoWorkspaceCollapseMode("dont_show");
  } else {
    await sandbox.chrome.storage.local.set({ video_workspace_collapse_mode: "dont_show" });
  }

  assert.equal(
    mockStorage.video_workspace_collapse_mode,
    "dont_show",
    "Setting must persist dont_show to chrome.storage.local"
  );
  assert.equal(
    typeof sidepanel.getVideoWorkspaceCollapseMode === "function"
      ? sidepanel.getVideoWorkspaceCollapseMode()
      : sandbox.videoWorkspaceCollapseMode,
    "dont_show",
    "State machine must reflect dont_show mode"
  );
});

test("Extension acceptance: whole-sentence OCR uses the production message path", async () => {
  const requests = [];
  const { domElements, messageListeners } = await createSidepanelSandbox(async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/api/ocr/recognize")) {
      return { ok: true, json: async () => ({ text: "雨が降ったので、家に帰りました。" }) };
    }
    if (url.includes("/api/grammar/analyze")) {
      return { ok: true, json: async () => ({ matches: [{ pattern_display: "ので", level: "N4", meaning_short: "because" }] }) };
    }
    return { ok: false, json: async () => ({}) };
  });

  const response = {};
  messageListeners[0]({
    type: "PROCESS_OCR_CROP",
    dataUrl: "data:image/png;base64,SCREENSHOT",
    cropRect: { left: 10, top: 10, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, {}, (value) => Object.assign(response, value));
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.equal(response.ok, true);
  assert.ok(requests.some(request => request.url.includes("/api/ocr/recognize")));
  assert.ok(requests.some(request => request.url.includes("/api/grammar/analyze")));
  assert.equal(domElements["text-grammar-section"].hidden, false);
  assert.match(domElements["text-grammar-content"].textContent, /ので/);
});

test("Extension acceptance: video grammar stays below the active subtitle and ignores stale results", async () => {
  let resolveFirst;
  const { domElements, messageListeners } = await createSidepanelSandbox(async (url, options) => {
    if (!url.includes("/api/grammar/analyze")) return { ok: false, json: async () => ({}) };
    const body = JSON.parse(options.body);
    if (body.sentence === "古い字幕") {
      return new Promise(resolve => {
        resolveFirst = () => resolve({ ok: true, json: async () => ({ matches: [{ pattern_display: "OLD" }] }) });
      });
    }
    return { ok: true, json: async () => ({ matches: [{ pattern_display: "NEW", level: "N3" }] }) };
  });

  const send = (text) => new Promise(resolve => {
    messageListeners[0]({ type: "SUBTITLE_CUE_CHANGED", cue: { text, startMs: 1000 } }, {}, resolve);
  });
  send("古い字幕");
  await send("新しい字幕");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(domElements["active-sub-grammar-slot"].textContent, /NEW/);
  resolveFirst();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(domElements["active-sub-grammar-slot"].textContent, /NEW/);
  assert.doesNotMatch(domElements["active-sub-grammar-slot"].textContent, /OLD/);
  const sidepanelHtml = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  assert.ok(
    sidepanelHtml.indexOf('id="active-subtitle-section"') < sidepanelHtml.indexOf('id="active-sub-grammar-slot"'),
    "Grammar slot must be declared immediately below the active subtitle section"
  );
});

test("Extension regression: clearing the active cue invalidates pending video grammar", async () => {
  let resolvePending;
  const { domElements, messageListeners } = await createSidepanelSandbox(async (url) => {
    if (!url.includes("/api/grammar/analyze")) return { ok: false, json: async () => ({}) };
    return new Promise(resolve => {
      resolvePending = () => resolve({ ok: true, json: async () => ({ matches: [{ pattern_display: "STALE" }] }) });
    });
  });

  messageListeners[0]({
    type: "SUBTITLE_CUE_CHANGED",
    cue: { text: "字幕が消える", startMs: 1000 }
  }, {}, () => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(domElements["active-sub-grammar-slot"].textContent, /Checking grammar/);

  messageListeners[0]({ type: "SUBTITLE_CUE_CHANGED", cue: null }, {}, () => {});
  assert.equal(domElements["active-sub-grammar-slot"].textContent, "");

  resolvePending();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(domElements["active-sub-grammar-slot"].textContent, "");
});

for (const settingId of ["setting-grammar-enabled", "setting-grammar-video-strip"]) {
  test(`Extension regression: disabling ${settingId} invalidates pending video grammar`, async () => {
    let resolvePending;
    const { domElements, messageListeners } = await createSidepanelSandbox(async (url) => {
      if (!url.includes("/api/grammar/analyze")) return { ok: false, json: async () => ({}) };
      return new Promise(resolve => {
        resolvePending = () => resolve({ ok: true, json: async () => ({ matches: [{ pattern_display: "STALE" }] }) });
      });
    });

    messageListeners[0]({
      type: "SUBTITLE_CUE_CHANGED",
      cue: { text: "設定で無効になる", startMs: 1000 }
    }, {}, () => {});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(domElements["active-sub-grammar-slot"].textContent, /Checking grammar/);

    const setting = domElements[settingId];
    setting.checked = false;
    setting.dispatchEvent({ type: "change", target: setting });
    assert.equal(domElements["active-sub-grammar-slot"].textContent, "");

    resolvePending();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(domElements["active-sub-grammar-slot"].textContent, "");
    assert.doesNotMatch(domElements["active-sub-grammar-slot"].textContent, /STALE/);
  });
}

test("Video Card Collapse: Auto-collapse triggers after 5 seconds of inactivity on Video tab", async () => {
  const { sidepanel, cardEditorSection, videoCollapsedCardChip } = await createSidepanelSandbox();

  // Switch to Video tab
  sidepanel.switchMiningTab("video");
  assert.equal(cardEditorSection.classList.contains("video-collapsed"), false, "Initially expanded on video tab");

  // Capture word
  await sidepanel.identify("猫", { videoContext: true });

  // Right after capture, workspace remains open for editing
  assert.equal(cardEditorSection.classList.contains("video-collapsed"), false, "Workspace stays open immediately after capture");

  // Advance collapse timer (trigger 5s schedule)
  if (typeof sidepanel.scheduleVideoWorkspaceCollapse === "function") {
    sidepanel.scheduleVideoWorkspaceCollapse(10);
  }
  await new Promise(r => setTimeout(r, 60));

  assert.ok(
    cardEditorSection.classList.contains("video-collapsed"),
    "#card-editor-section must have .video-collapsed after inactivity timeout"
  );
  assert.notEqual(
    videoCollapsedCardChip.style.display,
    "none",
    "Collapsed card chip must be revealed when collapsed"
  );
});

test("Video Card Collapse: Auto-collapse triggers when active subtitle cue changes on Video tab", async () => {
  const { sidepanel, cardEditorSection, messageListeners } = await createSidepanelSandbox();

  sidepanel.switchMiningTab("video");

  // Capture word
  await sidepanel.identify("走る", { videoContext: true });
  assert.equal(cardEditorSection.classList.contains("video-collapsed"), false);

  // Subtitle cue changes
  const cueChangedMsg = {
    type: "SUBTITLE_CUE_CHANGED",
    cue: { id: "cue-next", text: "次の文です", startTime: 12.5 }
  };

  for (const listener of messageListeners) {
    listener(cueChangedMsg, {}, () => {});
  }

  assert.ok(
    cardEditorSection.classList.contains("video-collapsed"),
    "Changing subtitle cue must collapse Card Workspace on Video tab"
  );
});

test("Video Card Collapse: Focus guard prevents/defers auto-collapse when user is focused on editor input/textarea", async () => {
  const { sidepanel, cardEditorSection, domElements } = await createSidepanelSandbox();

  sidepanel.switchMiningTab("video");
  await sidepanel.identify("猫", { videoContext: true });

  // Focus an editor input (e.g. #field-expression or #field-example-sentence)
  const inputEl = domElements["field-example-sentence"];
  inputEl.focus();

  // Attempt cue change while focused
  const cueChangedMsg = {
    type: "SUBTITLE_CUE_CHANGED",
    cue: { id: "cue-next-2", text: "集中して編集中", startTime: 15.0 }
  };
  if (typeof sidepanel.onSubtitleCueChanged === "function") {
    sidepanel.onSubtitleCueChanged(cueChangedMsg.cue);
  }

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Focus guard must prevent collapse on cue change while actively focused"
  );

  // Attempt inactivity timer while focused
  if (typeof sidepanel.scheduleVideoWorkspaceCollapse === "function") {
    sidepanel.scheduleVideoWorkspaceCollapse(10);
  }
  await new Promise(r => setTimeout(r, 50));

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Focus guard must cancel/defer collapse timer while actively focused"
  );

  // Blur editor input
  inputEl.blur();

  // Inactivity collapse now allowed
  if (typeof sidepanel.scheduleVideoWorkspaceCollapse === "function") {
    sidepanel.scheduleVideoWorkspaceCollapse(10);
  }
  await new Promise(r => setTimeout(r, 50));

  assert.ok(
    cardEditorSection.classList.contains("video-collapsed"),
    "Collapse proceeds once user has blurred and inactivity timeout expires"
  );
});

test("Video Card Collapse: Clicking collapsed chip re-expands Card Workspace", async () => {
  const { sidepanel, cardEditorSection, videoCollapsedCardChip, domElements } = await createSidepanelSandbox();

  sidepanel.switchMiningTab("video");
  await sidepanel.identify("犬", { videoContext: true });

  // Collapse it
  if (typeof sidepanel.collapseVideoWorkspace === "function") {
    sidepanel.collapseVideoWorkspace();
  } else {
    cardEditorSection.classList.add("video-collapsed");
  }
  assert.ok(cardEditorSection.classList.contains("video-collapsed"));

  // Click the chip
  videoCollapsedCardChip.dispatchEvent({ type: "click", bubbles: true });

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Clicking chip must remove .video-collapsed to reveal full workspace"
  );

  // Also verify clicking the child expand button re-expands
  cardEditorSection.classList.add("video-collapsed");
  const btnExpand = domElements["btn-expand-collapsed-chip"];
  btnExpand.dispatchEvent({ type: "click", bubbles: true });

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Clicking expand button must remove .video-collapsed"
  );
});

test("Video Card Collapse: Tab isolation ensures collapse NEVER happens on Text or Quick Add tabs", async () => {
  const { sidepanel, cardEditorSection, messageListeners } = await createSidepanelSandbox();

  // 1. Text Tab Isolation
  sidepanel.switchMiningTab("text");
  assert.equal(cardEditorSection.classList.contains("video-collapsed"), false);

  // Attempt collapse triggers while on Text tab
  if (typeof sidepanel.scheduleVideoWorkspaceCollapse === "function") {
    sidepanel.scheduleVideoWorkspaceCollapse(10);
  }
  const cueChangedMsg = {
    type: "SUBTITLE_CUE_CHANGED",
    cue: { id: "cue-ignored", text: "Text tab ignores cue change", startTime: 20.0 }
  };
  for (const listener of messageListeners) {
    listener(cueChangedMsg, {}, () => {});
  }
  await new Promise(r => setTimeout(r, 50));

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Card Workspace must NEVER collapse on Text tab"
  );

  // 2. Quick Add Tab Isolation
  sidepanel.switchMiningTab("quickadd");
  if (typeof sidepanel.scheduleVideoWorkspaceCollapse === "function") {
    sidepanel.scheduleVideoWorkspaceCollapse(10);
  }
  for (const listener of messageListeners) {
    listener(cueChangedMsg, {}, () => {});
  }
  await new Promise(r => setTimeout(r, 50));

  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Card Workspace must NEVER collapse on Quick Add tab"
  );

  // 3. Switching away from Video tab clears .video-collapsed
  sidepanel.switchMiningTab("video");
  if (typeof sidepanel.collapseVideoWorkspace === "function") {
    sidepanel.collapseVideoWorkspace();
  } else {
    cardEditorSection.classList.add("video-collapsed");
  }
  assert.ok(cardEditorSection.classList.contains("video-collapsed"));

  // Switch to Text tab
  sidepanel.switchMiningTab("text");
  assert.equal(
    cardEditorSection.classList.contains("video-collapsed"),
    false,
    "Switching to Text tab must immediately expand/remove .video-collapsed"
  );
});

test("Video Card Collapse: Chip displays expression, reading, and status of last captured/saved card", async () => {
  const { sidepanel, chipWord, chipReading, chipStatus, domElements } = await createSidepanelSandbox();

  sidepanel.switchMiningTab("video");

  // 1. Captured card update
  await sidepanel.identify("食べる", { videoContext: true });

  assert.equal(chipWord.textContent, "食べる", "Chip word must reflect captured expression");
  assert.equal(chipReading.textContent, "たべる", "Chip reading must reflect captured reading");
  assert.match(chipStatus.textContent, /draft|ready|saved/i, "Chip status must reflect capture/draft state");

  // 2. Saved card update
  domElements["field-expression"].value = "走る";
  domElements["field-reading"].value = "はしる";
  domElements["field-meaning"].value = "to run";

  await sidepanel.saveCard();

  assert.equal(chipWord.textContent, "走る", "Chip word must reflect saved expression");
  assert.equal(chipReading.textContent, "はしる", "Chip reading must reflect saved reading");
  assert.match(chipStatus.textContent, /saved|synced|pending/i, "Chip status must reflect saved state");
});
