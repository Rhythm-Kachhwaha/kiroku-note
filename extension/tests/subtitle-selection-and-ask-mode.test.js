/**
 * Tests for:
 * 1. Compound word extraction & single-letter hiragana fixes in extractJapaneseWordAtPosition
 * 2. Video subtitle overlay: no orange highlighting on hover; user selection & click-to-capture
 * 3. Fullscreen hook all_frames registration and Element.prototype interception
 * 4. Ask mode context insertion ("Add to Input") without sending
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const manifestPath = path.resolve(__dirname, "../manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const hookPath = path.resolve(__dirname, "../content/fullscreen-hook.js");
const hookCode = fs.readFileSync(hookPath, "utf8");
const sidepanelHtmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const sidepanelHtml = fs.readFileSync(sidepanelHtmlPath, "utf8");
const sidepanelJsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const sidepanelJs = fs.readFileSync(sidepanelJsPath, "utf8");
const pocPath = path.resolve(__dirname, "../content/video-mining-poc.js");

// ---------------------------------------------------------------------------
// 1. Manifest & Fullscreen Hook Tests
// ---------------------------------------------------------------------------
test("Manifest registers fullscreen-hook.js across all frames", () => {
  const hookEntry = manifest.content_scripts.find(cs =>
    cs.js && cs.js.includes("content/fullscreen-hook.js")
  );
  assert.ok(hookEntry, "fullscreen-hook.js must be registered in content_scripts");
  assert.equal(hookEntry.all_frames, true, "fullscreen-hook.js must run with all_frames: true for iframe video players");
});

test("fullscreen-hook.js hooks Element.prototype.requestFullscreen for video elements", () => {
  assert.ok(
    hookCode.includes("Element.prototype.requestFullscreen"),
    "fullscreen-hook.js must intercept Element.prototype.requestFullscreen"
  );
});

// ---------------------------------------------------------------------------
// 2. Ask Mode "Add to Input" Tests
// ---------------------------------------------------------------------------
test("sidepanel.html includes Add to Input button in ask context banner", () => {
  assert.ok(
    sidepanelHtml.includes('id="btn-ctx-insert"'),
    "sidepanel.html must define #btn-ctx-insert in ask-context-actions"
  );
});

test("sidepanel.js wires #btn-ctx-insert to populate ask-input-box without sending", () => {
  assert.ok(
    sidepanelJs.includes("btn-ctx-insert") || sidepanelJs.includes("btnCtxInsert"),
    "sidepanel.js must reference #btn-ctx-insert"
  );
});

// ---------------------------------------------------------------------------
// 3. Compound Word & Hiragana Extraction (extractJapaneseWordAtPosition)
// ---------------------------------------------------------------------------
function loadPocInContext() {
  const sentMessages = [];
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
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    sentMessages,
    chrome: {
      runtime: {
        sendMessage: (msg) => {
          sentMessages.push(msg);
          return Promise.resolve({ ok: true });
        },
        onMessage: { addListener: () => {} }
      },
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve({})
        }
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          style: {},
          children: [],
          textContent: "",
          appendChild: (c) => { el.children.push(c); return c; },
          replaceChildren: (...newChildren) => { el.children = [...newChildren]; el.textContent = ""; },
          addEventListener: () => {},
          removeEventListener: () => {},
          setAttribute: () => {},
          removeAttribute: () => {}
        };
        return el;
      },
      createTextNode: (txt) => ({ textContent: txt })
    }
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(pocPath, "utf8");
  vm.runInContext(code, ctx);
  return { ctx, sandbox, sentMessages };
}

test("extractJapaneseWordAtPosition extracts compound kanji words without splitting", () => {
  const { sandbox } = loadPocInContext();
  const extractFn = sandbox.window.extractJapaneseWordAtPosition;
  assert.ok(typeof extractFn === "function", "extractJapaneseWordAtPosition must be exposed on window");

  const elem = { textContent: "この学校生活は楽しい" };
  // Mock caret inside 学校 (offset 2)
  sandbox.document.caretRangeFromPoint = () => ({
    startContainer: { nodeType: 3, nodeValue: elem.textContent, textContent: elem.textContent },
    startOffset: 2
  });

  const wordGakkou = extractFn(elem, 10, 10);
  assert.equal(wordGakkou, "学校生活", "Clicking/hovering inside compound noun must extract full compound noun '学校生活'");

  // Mock caret inside 生活 (offset 4)
  sandbox.document.caretRangeFromPoint = () => ({
    startContainer: { nodeType: 3, nodeValue: elem.textContent, textContent: elem.textContent },
    startOffset: 4
  });

  const wordSeikatsu = extractFn(elem, 20, 10);
  assert.equal(wordSeikatsu, "学校生活", "Clicking/hovering second part of compound noun must also extract '学校生活'");
});

test("extractJapaneseWordAtPosition does not extract isolated 1-letter hiragana particle", () => {
  const { sandbox } = loadPocInContext();
  const extractFn = sandbox.window.extractJapaneseWordAtPosition;

  const elem = { textContent: "公園に行った" };
  // Mock caret on particle に (offset 2)
  sandbox.document.caretRangeFromPoint = () => ({
    startContainer: { nodeType: 3, nodeValue: elem.textContent, textContent: elem.textContent },
    startOffset: 2
  });

  const wordNi = extractFn(elem, 10, 10);
  assert.notEqual(wordNi, "に", "Caret on particle に must not return isolated 1-letter hiragana 'に'");
});

test("SubtitleOverlayRenderer does not highlight words in orange or auto-capture on mousemove", () => {
  const { sandbox, sentMessages } = loadPocInContext();
  const poc = sandbox.window.__ANKIMINER_VIDEO_POC__;
  assert.ok(poc, "POC must exist");

  const renderer = new poc.SubtitleOverlayRenderer();
  const subtitleEl = {
    tagName: "SPAN",
    className: "ankiminer-video-subtitle",
    style: {},
    children: [],
    textContent: "日本語を勉強する",
    replaceChildren: function(...args) {
      this.children = [...args];
      this.textContent = args.map(a => a.textContent || "").join("");
    },
    addEventListener: () => {}
  };
  renderer.subtitleEl = subtitleEl;
  renderer.currentCue = { text: "日本語を勉強する" };

  // Trigger mousemove on subtitle
  renderer._boundSubtitleMouseMove({ clientX: 10, clientY: 10 });

  // Wait 250ms past old debounce
  return new Promise((resolve) => {
    setTimeout(() => {
      // Must NOT send JAPANESE_TEXT_CAPTURED with source: "subtitle_hover"
      const hoverCapture = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED" && m.source === "subtitle_hover");
      assert.equal(hoverCapture, undefined, "Moving mouse over subtitle overlay must NOT dispatch JAPANESE_TEXT_CAPTURED");

      // SubtitleEl must NOT have replaced children with video-sub-highlight
      const hasOrangeHighlight = subtitleEl.children.some(c => c.className === "video-sub-highlight");
      assert.equal(hasOrangeHighlight, false, "Subtitle overlay must NOT insert orange highlight on hover");
      resolve();
    }, 250);
  });
});

test("SubtitleOverlayRenderer mouseup with text selection captures selected compound word", () => {
  const { sandbox, sentMessages } = loadPocInContext();
  const poc = sandbox.window.__ANKIMINER_VIDEO_POC__;
  const renderer = new poc.SubtitleOverlayRenderer();

  let propagationStopped = false;
  const mockEvent = {
    stopPropagation: () => { propagationStopped = true; },
    preventDefault: () => {}
  };

  sandbox.window.getSelection = () => ({
    toString: () => "学校生活",
    isCollapsed: false,
    rangeCount: 1
  });

  renderer.subtitleEl = {
    textContent: "この学校生活は楽しい",
    style: {}
  };
  renderer.currentCue = { text: "この学校生活は楽しい" };

  renderer._boundSubtitleMouseUp(mockEvent);

  const captureMsg = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Mouse selection must dispatch JAPANESE_TEXT_CAPTURED");
  assert.equal(captureMsg.text, "学校生活", "Captured text must match exact user selection");
  assert.equal(propagationStopped, true, "MouseUp on subtitle must stop propagation to prevent video player actions");
});

test("SubtitleOverlayRenderer click on subtitle extracts and captures word at position", () => {
  const { sandbox, sentMessages } = loadPocInContext();
  const poc = sandbox.window.__ANKIMINER_VIDEO_POC__;
  const renderer = new poc.SubtitleOverlayRenderer();

  let propagationStopped = false;
  const mockClickEvent = {
    clientX: 25,
    clientY: 10,
    stopPropagation: () => { propagationStopped = true; },
    preventDefault: () => {}
  };

  sandbox.window.getSelection = () => ({
    toString: () => "",
    isCollapsed: true,
    rangeCount: 0
  });

  const fullText = "この学校生活は楽しい";
  const subEl = { textContent: fullText, style: {} };
  renderer.subtitleEl = subEl;
  renderer.currentCue = { text: fullText };

  sandbox.document.caretRangeFromPoint = () => ({
    startContainer: { nodeType: 3, nodeValue: fullText, textContent: fullText },
    startOffset: 2
  });

  renderer._boundSubtitleClick(mockClickEvent);

  const captureMsg = sentMessages.find(m => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Clicking subtitle must dispatch JAPANESE_TEXT_CAPTURED");
  assert.equal(captureMsg.text, "学校生活", "Captured text must be the word at click position");
  assert.equal(propagationStopped, true, "Click on subtitle must stop propagation");
});

// ---------------------------------------------------------------------------
// 4. Subtitle History: Compound Highlighting, Lone Particles & Drag-Selection
// ---------------------------------------------------------------------------
test("Subtitle History: Groups compound words and attaches verb inflections into orange hover spans", () => {
  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = "";
      this.children = [];
      this.textContent = "";
      this._listeners = {};
      this.title = "";
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children) {
      this.children = [...children];
    }
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }
    dispatchEvent(e) {
      const fns = this._listeners[e.type] || [];
      fns.forEach(fn => fn(e));
    }
  }

  const mockRecentList = new MockElement("ul");
  const mockRecentSection = new MockElement("div");
  const minedWords = [];

  const sandbox = {
    console,
    Intl,
    Array,
    String,
    Set,
    Boolean,
    recentCuesList: mockRecentList,
    recentCuesSection: mockRecentSection,
    recentSubtitleCues: [
      { text: "学校生活について話しましょう", startTime: 10 },
      { text: "林檎を食べた", startTime: 25 }
    ],
    currentActiveCue: null,
    isRecentSubsEnabled: true,
    formatSubtitleTimestamp: () => "00:10",
    seekToSubtitleCue: () => {},
    mineSubtitleCueWord: async (cue, word) => {
      minedWords.push({ cue, word });
    },
    document: {
      createElement: (tag) => new MockElement(tag),
      createTextNode: (text) => ({ textContent: text, nodeType: 3 })
    },
    window: {
      getSelection: () => ({ toString: () => "" })
    }
  };

  vm.createContext(sandbox);

  const jsContent = fs.readFileSync(sidepanelJsPath, "utf8");
  const renderCode = jsContent.match(/function renderRecentCuesList[\s\S]*?\n\}/)?.[0];
  assert.ok(renderCode, "renderRecentCuesList function must exist in sidepanel.js");

  vm.runInContext(renderCode, sandbox);
  sandbox.renderRecentCuesList();

  assert.equal(mockRecentList.children.length, 2, "Must render 2 cue items in history");

  // First item: "学校生活について話しましょう"
  const item1 = mockRecentList.children[0];
  const textSpan1 = item1.children.find(c => c.className === "recent-cue-text");
  assert.ok(textSpan1, "Must have recent-cue-text span");

  // Filter word spans (these have class recent-cue-word which turns orange on hover)
  const wordSpans1 = textSpan1.children.filter(c => c.className === "recent-cue-word");
  const wordTexts1 = wordSpans1.map(w => w.textContent);

  assert.ok(
    wordTexts1.includes("学校生活"),
    `History must merge contiguous kanji compound '学校生活'. Got: ${JSON.stringify(wordTexts1)}`
  );
  assert.ok(
    wordTexts1.includes("話しましょう"),
    `History must merge verb inflections '話しましょう'. Got: ${JSON.stringify(wordTexts1)}`
  );

  // Second item: "林檎を食べた"
  const item2 = mockRecentList.children[1];
  const textSpan2 = item2.children.find(c => c.className === "recent-cue-text");
  const wordSpans2 = textSpan2.children.filter(c => c.className === "recent-cue-word");
  const wordTexts2 = wordSpans2.map(w => w.textContent);

  assert.ok(
    wordTexts2.includes("林檎"),
    `History must have word span for '林檎'. Got: ${JSON.stringify(wordTexts2)}`
  );
  assert.ok(
    wordTexts2.includes("食べた"),
    `History must merge verb inflection '食べた'. Got: ${JSON.stringify(wordTexts2)}`
  );
  assert.equal(
    wordTexts2.includes("を"),
    false,
    "Lone 1-character particle 'を' must NOT be wrapped in an orange hoverable word span"
  );
});

test("Subtitle History: Mouse selection in recent cue triggers mining of custom selection", () => {
  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = "";
      this.children = [];
      this.textContent = "";
      this._listeners = {};
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    replaceChildren(...children) {
      this.children = [...children];
    }
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }
    dispatchEvent(e) {
      const fns = this._listeners[e.type] || [];
      fns.forEach(fn => fn(e));
    }
  }

  const mockRecentList = new MockElement("ul");
  const mockRecentSection = new MockElement("div");
  const minedWords = [];

  let currentSelectedText = "生活について";

  const sandbox = {
    console,
    Intl,
    Array,
    String,
    Set,
    Boolean,
    recentCuesList: mockRecentList,
    recentCuesSection: mockRecentSection,
    recentSubtitleCues: [
      { text: "学校生活について話しましょう", startTime: 10 }
    ],
    currentActiveCue: null,
    isRecentSubsEnabled: true,
    formatSubtitleTimestamp: () => "00:10",
    seekToSubtitleCue: () => {},
    mineSubtitleCueWord: async (cue, word) => {
      minedWords.push({ cue, word });
    },
    document: {
      createElement: (tag) => new MockElement(tag),
      createTextNode: (text) => ({ textContent: text, nodeType: 3 })
    },
    window: {
      getSelection: () => ({
        toString: () => currentSelectedText
      })
    }
  };

  vm.createContext(sandbox);

  const jsContent = fs.readFileSync(sidepanelJsPath, "utf8");
  const renderCode = jsContent.match(/function renderRecentCuesList[\s\S]*?\n\}/)?.[0];
  vm.runInContext(renderCode, sandbox);
  sandbox.renderRecentCuesList();

  const item = mockRecentList.children[0];
  const textSpan = item.children.find(c => c.className === "recent-cue-text");

  let stopped = false;
  textSpan.dispatchEvent({
    type: "mouseup",
    stopPropagation: () => { stopped = true; }
  });

  assert.equal(minedWords.length, 1, "Drag selection mouseup must mine the selected text");
  assert.equal(minedWords[0].word, "生活について", "Mined text must match user drag selection");
  assert.equal(stopped, true, "MouseUp on history must stop propagation");
});

test("Live video overlay subtitle strictly remains clean text without orange highlighting", () => {
  const { sandbox } = loadPocInContext();
  const poc = sandbox.window.__ANKIMINER_VIDEO_POC__;
  const renderer = new poc.SubtitleOverlayRenderer();

  const subtitleEl = {
    tagName: "SPAN",
    className: "ankiminer-video-subtitle",
    style: { color: "#ffffff" },
    children: [],
    textContent: "",
    replaceChildren: function(...args) {
      this.children = [...args];
      this.textContent = args.map(a => a.textContent || "").join("");
    }
  };
  const container = {
    setAttribute: () => {},
    removeAttribute: () => {},
    style: {}
  };

  renderer.subtitleEl = subtitleEl;
  renderer.container = container;

  // Render a subtitle cue on the video
  renderer.renderCue({ text: "学校生活について話しましょう" });

  assert.equal(subtitleEl.textContent, "学校生活について話しましょう", "Live subtitle text must be set directly");
  assert.equal(subtitleEl.children.length, 0, "Live subtitle must NOT inject child spans for orange highlighting");
  assert.equal(
    subtitleEl.children.some(c => c.className === "video-sub-highlight" || c.className === "recent-cue-word"),
    false,
    "Live subtitle must NEVER contain video-sub-highlight or recent-cue-word"
  );
});


