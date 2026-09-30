/**
 * Session 7 Unit Test Suite: Floating Ask Drawer (Replacing Ask Tab - Phase 4A)
 * Verifies FAB, floating drawer container, focus management, tab decoupling,
 * context entry points, privacy disclosure, and zero emojis.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
const cssContent = fs.readFileSync(cssPath, "utf8");
const jsContent = fs.readFileSync(jsPath, "utf8");

function createMockElement(tagName, id = "", className = "") {
  const el = {
    tagName: tagName.toUpperCase(),
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    checked: false,
    className,
    style: {},
    _attrs: {},
    _listeners: {},
    children: [],
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] || null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(type, fn) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type || "click";
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
    },
    classList: {
      _classes: new Set(className ? className.split(" ").filter(Boolean) : []),
      add(...classes) {
        classes.forEach(c => el.classList._classes.add(c));
        el.className = Array.from(el.classList._classes).join(" ");
      },
      remove(...classes) {
        classes.forEach(c => el.classList._classes.delete(c));
        el.className = Array.from(el.classList._classes).join(" ");
      },
      contains(c) { return el.classList._classes.has(c); },
      toggle(c, force) {
        const has = el.classList._classes.has(c);
        const shouldHave = typeof force === "boolean" ? force : !has;
        if (shouldHave) {
          el.classList.add(c);
        } else {
          el.classList.remove(c);
        }
        return shouldHave;
      },
    },
    appendChild(node) { this.children.push(node); return node; },
    append(...nodes) { this.children.push(...nodes); },
    querySelector(selector) {
      if (selector.startsWith("#")) {
        const targetId = selector.slice(1);
        if (this.id === targetId) return this;
        for (const child of this.children) {
          const found = child.querySelector ? child.querySelector(selector) : null;
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(selector) { return []; },
    focus() { el._focused = true; },
    contains(other) {
      if (this === other) return true;
      for (const child of this.children) {
        if (child.contains && child.contains(other)) return true;
      }
      return false;
    }
  };
  return el;
}

function setupVM() {
  const elementsMap = {};
  function getOrCreate(sel) {
    if (!elementsMap[sel]) {
      const id = sel.startsWith("#") ? sel.slice(1) : "";
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      elementsMap[sel] = createMockElement("div", id, cls);
    }
    return elementsMap[sel];
  }

  // Pre-seed known elements
  const mockAskFab = getOrCreate("#ask-fab");
  const mockAskFabUnreadDot = getOrCreate("#ask-fab-unread-dot");
  mockAskFabUnreadDot.hidden = true;
  const mockAskFloat = getOrCreate("#ask-float");
  mockAskFloat.hidden = true;
  mockAskFloat.style.display = "none";
  const mockBtnAskMinimize = getOrCreate("#btn-ask-minimize");
  const mockBtnAskClose = getOrCreate("#btn-ask-close");
  const mockAskCloudNotice = getOrCreate("#ask-cloud-notice");
  mockAskCloudNotice.hidden = true;
  const mockAskPrivacyDisclosure = getOrCreate("#ask-privacy-disclosure");
  mockAskPrivacyDisclosure.hidden = true;
  const mockAskPrivacyProvider = getOrCreate("#ask-privacy-provider");
  const mockBtnHeroAsk = getOrCreate("#btn-hero-ask");
  const mockBtnVideoCueAsk = getOrCreate("#btn-video-cue-ask");
  const mockBtnOcrAsk = getOrCreate("#btn-ocr-ask");
  mockBtnOcrAsk.hidden = true;

  const mockExpression = getOrCreate("#expression");
  const mockReading = getOrCreate("#reading");
  const mockVideoCue = getOrCreate("#video-current-cue-preview");
  const mockAskMiningView = getOrCreate("#ask-mining-view");
  const mockAskInputBox = getOrCreate("#ask-input-box");
  const mockAskChatStream = getOrCreate("#ask-chat-stream");
  const mockAskEmptyState = getOrCreate("#ask-empty-state");
  const mockBtnAskSubmit = getOrCreate("#btn-ask-submit");
  const mockBtnAskNewChat = getOrCreate("#btn-ask-new-chat");
  const mockTabBtnAsk = getOrCreate("#tab-btn-ask");
  const mockTabBtnText = getOrCreate("#tab-btn-text");
  const mockTextMiningView = getOrCreate("#text-mining-view");
  const mockCardEditorSection = getOrCreate("#card-editor-section");

  const storageMock = {};

  const documentMock = {
    readyState: "complete",
    activeElement: mockAskFab,
    contains(node) { return true; },
    querySelector(sel) { return getOrCreate(sel); },
    querySelectorAll(sel) { return []; },
    getElementById(id) { return getOrCreate("#" + id); },
    createElement(tag) { return createMockElement(tag); },
    addEventListener(event, fn) {
      if (!this._listeners) this._listeners = {};
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type || "click";
      if (this._listeners && this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
    }
  };

  const windowMock = {
    document: documentMock,
    addEventListener(event, fn) {},
    dispatchEvent(event) {},
    setTimeout(fn, ms) { return setTimeout(fn, 0); },
    clearTimeout(id) { clearTimeout(id); },
    localStorage: {
      getItem(k) { return storageMock[k] || null; },
      setItem(k, v) { storageMock[k] = String(v); },
      removeItem(k) { delete storageMock[k]; }
    }
  };

  const chromeMock = {
    storage: {
      local: {
        get(keys, cb) {
          const res = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { res[k] = storageMock[k]; });
          } else if (typeof keys === "string") {
            res[keys] = storageMock[keys];
          } else if (typeof keys === "object" && keys !== null) {
            Object.keys(keys).forEach(k => { res[k] = storageMock[k] !== undefined ? storageMock[k] : keys[k]; });
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set(items, cb) {
          Object.assign(storageMock, items);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    },
    runtime: {
      sendMessage(msg, cb) { if (cb) cb({ ok: true }); return Promise.resolve({ ok: true }); },
      onMessage: { addListener(fn) { (this._listeners = this._listeners || []).push(fn); } }
    }
  };

  const sandbox = {
    window: windowMock,
    document: documentMock,
    chrome: chromeMock,
    localStorage: windowMock.localStorage,
    setTimeout: windowMock.setTimeout,
    clearTimeout: windowMock.clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    Event: function(type, opts) { this.type = type; this.bubbles = opts?.bubbles || false; },
    module: { exports: {} },
    exports: {}
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(jsContent, ctx);

  const exported = Object.assign(ctx, sandbox.window, sandbox.module.exports);
  return { ctx: exported, elementsMap, storageMock };
}

test("Session 7: FAB DOM Structure & Accessibility in sidepanel.html", () => {
  assert.ok(htmlContent.includes('id="ask-fab"'), "HTML must define #ask-fab");
  assert.ok(htmlContent.includes('aria-label="Ask AI"'), "FAB must have aria-label='Ask AI'");
  assert.ok(htmlContent.includes('aria-controls="ask-float"'), "FAB must have aria-controls='ask-float'");
  assert.ok(htmlContent.includes('aria-expanded="false"'), "FAB must initially have aria-expanded='false'");
  assert.ok(htmlContent.includes('id="ask-fab-unread-dot"'), "FAB must have an unread indicator dot element");
});

test("Session 7: Floating Drawer Container & Controls in sidepanel.html", () => {
  assert.ok(htmlContent.includes('<aside id="ask-float"'), "Drawer must be an <aside> element with id='ask-float'");
  assert.ok(htmlContent.includes('role="dialog"'), "Drawer must have role='dialog'");
  assert.ok(htmlContent.includes('aria-modal="false"'), "Drawer must have aria-modal='false'");
  assert.ok(htmlContent.includes('id="btn-ask-minimize"'), "Drawer header must contain #btn-ask-minimize");
  assert.ok(htmlContent.includes('id="btn-ask-close"'), "Drawer header must contain #btn-ask-close");
  assert.ok(htmlContent.includes('id="ask-cloud-notice"'), "Drawer header must contain #ask-cloud-notice");
  assert.ok(htmlContent.includes('id="ask-privacy-disclosure"'), "Drawer must contain #ask-privacy-disclosure");
});

test("Session 7: Tab Strip Decoupling in sidepanel.html", () => {
  assert.ok(
    htmlContent.includes('id="tab-btn-ask"') && htmlContent.includes('hidden') && htmlContent.includes('display: none !important;'),
    "#tab-btn-ask must be hidden with display:none in tab strip"
  );
});

test("Session 7: Context Entry Points in sidepanel.html", () => {
  assert.ok(htmlContent.includes('id="btn-hero-ask"'), "Hero expression row must contain #btn-hero-ask");
  assert.ok(htmlContent.includes('id="btn-video-cue-ask"'), "Video cue container must contain #btn-video-cue-ask");
  assert.ok(htmlContent.includes('id="btn-ocr-ask"'), "OCR area must contain #btn-ocr-ask");
});

test("Session 7: CSS Styles for FAB and Floating Drawer in sidepanel.css", () => {
  assert.ok(cssContent.includes(".ask-fab"), "CSS must style .ask-fab");
  assert.ok(cssContent.includes(".ask-fab-unread-dot"), "CSS must style .ask-fab-unread-dot");
  assert.ok(cssContent.includes(".ask-float-drawer"), "CSS must style .ask-float-drawer");
  assert.ok(cssContent.includes(".ask-float-drawer.is-minimized"), "CSS must style minimized drawer state");
  assert.ok(cssContent.includes(".btn-ask-context-entry"), "CSS must style .btn-ask-context-entry");
  assert.ok(cssContent.includes(".ask-privacy-disclosure"), "CSS must style .ask-privacy-disclosure");
});

test("Session 7: Zero Emojis Guardrail", () => {
  const askFloatMatch = htmlContent.match(/<aside id="ask-float"[\s\S]*?<\/aside>/);
  assert.ok(askFloatMatch, "Must extract ask-float markup");
  const askFloatMarkup = askFloatMatch[0];

  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(askFloatMarkup), false, "ask-float markup must contain zero emojis");
});

test("Session 7: Privacy Disclosure Logic in sidepanel.js", () => {
  const { ctx, elementsMap } = setupVM();
  const updateAskPrivacyNotice = ctx.updateAskPrivacyNotice;
  assert.equal(typeof updateAskPrivacyNotice, "function");

  const notice = elementsMap["#ask-cloud-notice"];
  const disclosure = elementsMap["#ask-privacy-disclosure"];
  const providerSpan = elementsMap["#ask-privacy-provider"];

  // Cloud provider (e.g. OpenAI)
  updateAskPrivacyNotice("openai", true);
  assert.equal(notice.hidden, false, "Cloud notice must be visible for OpenAI");
  assert.equal(disclosure.hidden, false, "Privacy disclosure must be visible for OpenAI");
  assert.equal(providerSpan.textContent, "Openai");

  // Local provider (Ollama)
  updateAskPrivacyNotice("ollama", true);
  assert.equal(notice.hidden, true, "Cloud notice must be hidden for Ollama");
  assert.equal(disclosure.hidden, true, "Privacy disclosure must be hidden for Ollama");

  // Unconfigured
  updateAskPrivacyNotice("none", false);
  assert.equal(notice.hidden, true, "Cloud notice must be hidden when unconfigured");
  assert.equal(disclosure.hidden, true, "Privacy disclosure must be hidden when unconfigured");
});

test("Session 7: openAskFloat, closeAskFloat, toggle, minimize State Management", () => {
  const { ctx, elementsMap } = setupVM();
  const mockFloat = elementsMap["#ask-float"];
  const mockFab = elementsMap["#ask-fab"];
  const mockDot = elementsMap["#ask-fab-unread-dot"];
  const mockInput = elementsMap["#ask-input-box"];

  assert.equal(ctx.isAskFloatOpen(), false);

  // 1. Open drawer
  ctx.openAskFloat();
  assert.equal(mockFloat.hidden, false, "Drawer must be unhidden when opened");
  assert.equal(mockFab.getAttribute("aria-expanded"), "true", "FAB aria-expanded must be true");
  assert.equal(mockDot.hidden, true, "Unread dot must be hidden when drawer opens");
  assert.equal(ctx.isAskFloatOpen(), true);

  // 2. Close drawer
  ctx.closeAskFloat();
  assert.equal(mockFloat.hidden, true, "Drawer must be hidden when closed");
  assert.equal(mockFab.getAttribute("aria-expanded"), "false", "FAB aria-expanded must be false");
  assert.equal(ctx.isAskFloatOpen(), false);

  // 3. Toggle drawer
  ctx.toggleAskFloat();
  assert.equal(mockFloat.hidden, false, "Toggle must open drawer when closed");
  ctx.toggleAskFloat();
  assert.equal(mockFloat.hidden, true, "Toggle must close drawer when open");

  // 4. Minimize drawer
  mockFloat.hidden = false;
  ctx.minimizeAskFloat();
  assert.equal(mockFloat.classList.contains("is-minimized"), true, "minimizeAskFloat must toggle is-minimized");
});

test("Session 7: switchMiningTab('ask') Opens Floating Drawer Without Tab Switch", () => {
  const { ctx, elementsMap } = setupVM();
  const mockFloat = elementsMap["#ask-float"];
  const mockEditor = elementsMap["#card-editor-section"];

  ctx.switchMiningTab("text");
  assert.equal(ctx.getCurrentMiningTab(), "text", "Current mining tab should be 'text'");
  assert.equal(mockEditor.hidden, false, "Card editor must be visible on 'text' tab");

  // Calling switchMiningTab('ask')
  ctx.switchMiningTab("ask");
  assert.equal(ctx.getCurrentMiningTab(), "text", "Active mining tab must remain 'text'");
  assert.equal(mockFloat.hidden, false, "Floating drawer must be opened");
  assert.equal(mockEditor.hidden, false, "Card editor must still be visible with drawer open");
});

test("Session 7: Context Entry Buttons Trigger setAskContext and openAskFloat", () => {
  const { ctx, elementsMap } = setupVM();
  const mockFloat = elementsMap["#ask-float"];
  const btnHero = elementsMap["#btn-hero-ask"];
  const btnVideo = elementsMap["#btn-video-cue-ask"];
  const btnOcr = elementsMap["#btn-ocr-ask"];
  const expr = elementsMap["#expression"];
  const reading = elementsMap["#reading"];
  const videoCue = elementsMap["#video-current-cue-preview"];
  const ctxBanner = elementsMap["#ask-context-banner"];
  const ctxText = elementsMap["#ask-context-text"];

  // 1. Hero context
  mockFloat.hidden = true;
  expr.textContent = "食べる";
  reading.textContent = "たべる";
  btnHero.dispatchEvent("click");
  assert.equal(mockFloat.hidden, false, "Clicking hero ask button must open Ask float");
  assert.equal(ctxText.textContent, "食べる (たべる)");

  // 2. Video cue context
  mockFloat.hidden = true;
  videoCue.textContent = "これは美味しいです。";
  btnVideo.dispatchEvent("click");
  assert.equal(mockFloat.hidden, false, "Clicking video cue ask button must open Ask float");
  assert.equal(ctxText.textContent, "これは美味しいです。");

  // 3. OCR context
  mockFloat.hidden = true;
  ctx.setLastOcrText("図書館で本を借ります");
  btnOcr.dispatchEvent("click");
  assert.equal(mockFloat.hidden, false, "Clicking OCR ask button must open Ask float");
  assert.equal(ctxText.textContent, "図書館で本を借ります");
});
