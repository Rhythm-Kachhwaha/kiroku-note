const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// 1. Verify HTML Structure
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

test("Session 9: Header Consolidation - Unified Status Indicator & Popover", () => {
  // Brand section contains unified status indicator
  assert.ok(html.includes('id="unified-service-status-wrap"'), "#unified-service-status-wrap must exist in brand header");
  assert.ok(html.includes('id="unified-status-btn"'), "#unified-status-btn must exist");
  assert.ok(html.includes('id="unified-status-dot"'), "#unified-status-dot must exist");
  assert.ok(html.includes('id="unified-status-text"'), "#unified-status-text must exist");
  assert.ok(html.includes('id="service-status-popover"'), "#service-status-popover tooltip must exist");

  // Popover detail elements
  assert.ok(html.includes('id="popover-dot-yomitan"'), "#popover-dot-yomitan must exist");
  assert.ok(html.includes('id="popover-detail-yomitan"'), "#popover-detail-yomitan must exist");
  assert.ok(html.includes('id="popover-dot-anki"'), "#popover-dot-anki must exist");
  assert.ok(html.includes('id="popover-detail-anki"'), "#popover-detail-anki must exist");
  assert.ok(html.includes('id="popover-dot-ocr"'), "#popover-dot-ocr must exist");
  assert.ok(html.includes('id="popover-detail-ocr"'), "#popover-detail-ocr must exist");
  assert.ok(html.includes('id="popover-dot-ai"'), "#popover-dot-ai must exist");
  assert.ok(html.includes('id="popover-detail-ai"'), "#popover-detail-ai must exist");

  // Legacy indicator dots preserved hidden for backward compatibility
  assert.ok(html.includes('id="indicator-yomitan"'), "Legacy #indicator-yomitan preserved");
  assert.ok(html.includes('id="indicator-anki"'), "Legacy #indicator-anki preserved");
  assert.ok(html.includes('id="indicator-ocr"'), "Legacy #indicator-ocr preserved");

  // Japanese input toggle relocated out of header right nav into card editor
  const headerRightNavMatch = html.match(/<div class="header-right-nav">([\s\S]*?)<\/div>/);
  assert.ok(headerRightNavMatch, "header-right-nav must exist");
  assert.ok(!headerRightNavMatch[1].includes('id="btn-editor-jp-mode"'), "btn-editor-jp-mode must NOT be in header-right-nav");
  assert.ok(html.includes('id="btn-editor-jp-mode"'), "btn-editor-jp-mode must exist in card editor");

  const cardSettingsSecMatch = html.match(/<div id="card-settings-section"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(cardSettingsSecMatch, "card-settings-section must exist");
  assert.ok(cardSettingsSecMatch[0].includes('id="btn-editor-jp-mode"'), "btn-editor-jp-mode relocated to card editor");
});

test("Session 9: Settings Regrouping into 4 Clean Sections & Compact Grid", () => {
  // 4 Groups exist
  assert.ok(html.includes('id="settings-group-display"'), "#settings-group-display must exist");
  assert.ok(html.includes('id="settings-group-card"'), "#settings-group-card must exist");
  assert.ok(html.includes('id="settings-group-connections"'), "#settings-group-connections must exist");
  assert.ok(html.includes('id="settings-group-video"'), "#settings-group-video must exist");

  // Compact Grid for Front / Back Fields
  assert.ok(html.includes('class="card-template-grid"'), ".card-template-grid must exist in Card settings");
  assert.ok(html.includes('id="setting-front-reading"'), "#setting-front-reading preserved");
  assert.ok(html.includes('id="setting-front-meaning"'), "#setting-front-meaning preserved");
  assert.ok(html.includes('id="setting-front-kanji-reading"'), "#setting-front-kanji-reading preserved");
  assert.ok(html.includes('id="setting-front-hint"'), "#setting-front-hint preserved");
  assert.ok(html.includes('id="setting-back-reading"'), "#setting-back-reading preserved");
  assert.ok(html.includes('id="setting-back-meaning"'), "#setting-back-meaning preserved");
  assert.ok(html.includes('id="setting-back-hint"'), "#setting-back-hint preserved");

  // Redundant Connection Indicators legend is removed
  assert.ok(!html.includes('class="service-legend-box"'), "Redundant service-legend-box must be removed");
  assert.ok(!html.includes('Connection Indicators</span>'), "Connection Indicators legend title removed");

  // Dynamic AnkiConnect URL display elements
  assert.ok(html.includes('id="anki-connect-url-val"'), "#anki-connect-url-val must exist for dynamic URL display");
  assert.ok(html.includes('id="anki-connect-status-val"'), "#anki-connect-status-val must exist for dynamic status display");
});

test("Session 9: CSS Styling Rules for Unified Status and Compact Grid", () => {
  const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.ok(css.includes(".unified-service-status-wrap"), "CSS must style .unified-service-status-wrap");
  assert.ok(css.includes(".unified-status-btn"), "CSS must style .unified-status-btn");
  assert.ok(css.includes(".unified-status-dot"), "CSS must style .unified-status-dot");
  assert.ok(css.includes(".service-status-popover"), "CSS must style .service-status-popover");
  assert.ok(css.includes(".card-template-grid"), "CSS must style .card-template-grid");
  assert.ok(css.includes(".card-side-col"), "CSS must style .card-side-col");
});

test("Session 9: Logic - Unified Status Indicator State and AnkiConnect Dynamic URL", async () => {
  const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
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
      style: {},
      _attrs: {},
      _listeners: {},
      children: [],
      setAttribute(k, v) { this._attrs[k] = String(v); },
      getAttribute(k) { return this._attrs[k] || null; },
      removeAttribute(k) { delete this._attrs[k]; },
      hasAttribute(k) { return k in this._attrs; },
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
      _classes: new Set(className ? className.split(/\s+/).filter(Boolean) : []),
      get className() {
        return Array.from(this._classes).join(" ");
      },
      set className(val) {
        this._classes.clear();
        if (typeof val === "string") {
          val.trim().split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
        }
      },
      classList: {
        add(...cls) { cls.forEach(c => el._classes.add(c)); },
        remove(...cls) { cls.forEach(c => el._classes.delete(c)); },
        contains(c) { return el._classes.has(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (el._classes.has(c)) { el._classes.delete(c); return false; }
            else { el._classes.add(c); return true; }
          }
          if (force) el._classes.add(c); else el._classes.delete(c);
          return force;
        }
      },
      replaceChildren(...nodes) { this.children = nodes; },
      appendChild(node) { this.children.push(node); return node; },
      append(...nodes) { this.children.push(...nodes); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() {},
      contains() { return false; },
    };
    return el;
  }

  const elementsMap = {};
  function getOrCreate(sel) {
    if (!elementsMap[sel]) {
      const id = sel.startsWith("#") ? sel.slice(1) : "";
      const cls = sel.startsWith(".") ? sel.slice(1) : "";
      elementsMap[sel] = createMockElement("div", id, cls);
    }
    return elementsMap[sel];
  }

  // Pre-seed required elements
  const mockUnifiedDot = getOrCreate("#unified-status-dot");
  const mockUnifiedText = getOrCreate("#unified-status-text");
  const mockUnifiedBtn = getOrCreate("#unified-status-btn");
  const mockPopover = getOrCreate("#service-status-popover");
  mockPopover.hidden = true;

  const mockYomiDot = getOrCreate("#popover-dot-yomitan");
  const mockYomiDetail = getOrCreate("#popover-detail-yomitan");
  const mockAnkiDot = getOrCreate("#popover-dot-anki");
  const mockAnkiDetail = getOrCreate("#popover-detail-anki");
  const mockOcrDot = getOrCreate("#popover-dot-ocr");
  const mockOcrDetail = getOrCreate("#popover-detail-ocr");
  const mockAiDot = getOrCreate("#popover-dot-ai");
  const mockAiDetail = getOrCreate("#popover-detail-ai");

  const mockIndYomitan = getOrCreate("#indicator-yomitan");
  const mockIndAnki = getOrCreate("#indicator-anki");
  const mockIndOcr = getOrCreate("#indicator-ocr");
  const mockLlmStatus = getOrCreate("#llm-status-label");

  const mockAnkiUrlVal = getOrCreate("#anki-connect-url-val");
  const mockAnkiStatusVal = getOrCreate("#anki-connect-status-val");

  const mockDoc = {
    querySelector: (sel) => elementsMap[sel] || getOrCreate(sel),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
    createTextNode: (t) => t,
    addEventListener: () => {},
    documentElement: { style: { setProperty() {} } },
    body: createMockElement("body"),
  };

  const sandbox = {
    document: mockDoc,
    window: {
      addEventListener: () => {},
      confirm: () => true,
    },
    chrome: {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        }
      },
      runtime: {
        sendMessage: async () => ({}),
        onMessage: { addListener: () => {} }
      }
    },
    fetch: async (url) => {
      if (url.includes("/api/anki/status")) {
        return {
          ok: true,
          json: async () => ({
            connected: true,
            version: 6,
            endpoint_url: "http://192.168.1.100:8765"
          })
        };
      }
      if (url.includes("/api/anki/decks")) {
        return {
          ok: true,
          json: async () => ({ connected: true, decks: ["Default"] })
        };
      }
      return { ok: false };
    },
    console,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    module: { exports: {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(jsContent, sandbox);

  const sidepanel = sandbox.module.exports;
  assert.ok(sidepanel.updateUnifiedStatusIndicator, "updateUnifiedStatusIndicator must be exported");
  assert.ok(sidepanel.fetchAnkiConnectUrl, "fetchAnkiConnectUrl must be exported");

  // 1. Test updateUnifiedStatusIndicator when Yomitan and Anki are connected
  mockIndYomitan.className = "indicator-pill connected";
  mockIndYomitan.title = "Yomitan: Ready";
  mockIndAnki.className = "indicator-pill connected";
  mockIndAnki.title = "Anki: Connected";
  mockIndOcr.className = "indicator-pill connected";
  mockIndOcr.title = "OCR: Ready";

  sidepanel.updateUnifiedStatusIndicator();

  assert.equal(mockUnifiedDot.className, "unified-status-dot connected", "Unified dot must be 'connected' when all connected");
  assert.equal(mockUnifiedText.textContent, "Online", "Unified text must display 'Online'");
  assert.equal(mockYomiDot.className, "status-dot-mini connected", "Yomitan popover dot connected");
  assert.equal(mockAnkiDot.className, "status-dot-mini connected", "Anki popover dot connected");

  // 2. Test updateUnifiedStatusIndicator when Anki is checking
  mockIndAnki.className = "indicator-pill checking";
  mockIndAnki.title = "Anki: Checking connection…";
  sidepanel.updateUnifiedStatusIndicator();
  assert.equal(mockUnifiedDot.className, "unified-status-dot checking", "Unified dot must be 'checking'");
  assert.equal(mockUnifiedText.textContent, "Checking…", "Unified text must display 'Checking…'");

  // 3. Test updateUnifiedStatusIndicator when Anki is offline
  mockIndAnki.className = "indicator-pill unavailable";
  mockIndAnki.title = "Anki: Not connected";
  sidepanel.updateUnifiedStatusIndicator();
  assert.equal(mockUnifiedDot.className, "unified-status-dot partial", "Unified dot must reflect partial connection");
  assert.equal(mockUnifiedText.textContent, "Anki Offline", "Unified text must display 'Anki Offline'");

  // 4. Test fetchAnkiConnectUrl populates dynamic URL
  await sidepanel.fetchAnkiConnectUrl();
  assert.equal(mockAnkiUrlVal.textContent, "192.168.1.100:8765", "AnkiConnect URL must be dynamically populated from backend endpoint_url");
  assert.equal(mockAnkiStatusVal.textContent, "Connected", "AnkiConnect status must display 'Connected'");
});
