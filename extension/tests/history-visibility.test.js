const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const htmlContent = fs.readFileSync(htmlPath, "utf8");
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
      add(c) { el.classList._classes.add(c); el.className = Array.from(el.classList._classes).join(" "); },
      remove(c) { el.classList._classes.delete(c); el.className = Array.from(el.classList._classes).join(" "); },
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
    replaceChildren(...nodes) { this.children = nodes; },
    append(...nodes) { this.children.push(...nodes); },
    focus() {},
    select() {},
  };
  return el;
}

test("Session 4: History Panel Visibility and Isolation", async (t) => {
  await t.test("HTML DOM markup validation", () => {
    // 1. #history-section starts hidden in HTML
    assert.ok(
      htmlContent.includes('id="history-section"') && htmlContent.includes('hidden'),
      "#history-section must exist and start hidden in HTML"
    );

    // 2. #setting-show-history exists but its container row is hidden from user UI
    assert.ok(
      htmlContent.includes('id="setting-show-history"'),
      "#setting-show-history input ID must be preserved for DOM/test compatibility"
    );
    assert.ok(
      htmlContent.includes('class="settings-row" hidden style="display:none;"') ||
      htmlContent.includes('hidden style="display:none;"'),
      "Show History settings row must be hidden from settings UI"
    );
  });

  await t.test("Behavioral test: applyTabVisibility and tab switching isolation", async () => {
    // Construct mock DOM
    const mockHistorySection = createMockElement("section", "history-section");
    mockHistorySection.hidden = true;
    mockHistorySection.style.display = "none";

    const mockTextMiningView = createMockElement("div", "text-mining-view");
    const mockVideoMiningView = createMockElement("div", "video-mining-view");
    const mockQuickAddMiningView = createMockElement("div", "quickadd-mining-view");
    const mockAskMiningView = createMockElement("div", "ask-mining-view");
    const mockCardEditorSection = createMockElement("section", "card-editor-section");
    const mockHistoryContentContainer = createMockElement("div", "history-content-container");

    const mockTabBtnText = createMockElement("button", "tab-btn-text");
    const mockTabBtnVideo = createMockElement("button", "tab-btn-video");
    const mockTabBtnQuickAdd = createMockElement("button", "tab-btn-quickadd");
    const mockTabBtnAsk = createMockElement("button", "tab-btn-ask");
    const mockTabBtnHistory = createMockElement("button", "tab-btn-history");

    const mockSettingShowHistory = createMockElement("input", "setting-show-history");
    const mockFieldDeckSelect = createMockElement("select", "field-deck-select");
    mockFieldDeckSelect.value = "Default";

    const elementsMap = {
      "#history-section": mockHistorySection,
      "#text-mining-view": mockTextMiningView,
      "#video-mining-view": mockVideoMiningView,
      "#quickadd-mining-view": mockQuickAddMiningView,
      "#ask-mining-view": mockAskMiningView,
      "#card-editor-section": mockCardEditorSection,
      "#history-content-container": mockHistoryContentContainer,
      "#tab-btn-text": mockTabBtnText,
      "#tab-btn-video": mockTabBtnVideo,
      "#tab-btn-quickadd": mockTabBtnQuickAdd,
      "#tab-btn-ask": mockTabBtnAsk,
      "#tab-btn-history": mockTabBtnHistory,
      "#setting-show-history": mockSettingShowHistory,
      "#field-deck-select": mockFieldDeckSelect,
    };

    const mockDocument = {
      querySelector(sel) {
        return elementsMap[sel] || createMockElement("div", sel.replace("#", ""));
      },
      querySelectorAll() { return []; },
      getElementById(id) {
        return elementsMap[`#${id}`] || null;
      },
      createElement(tag) { return createMockElement(tag); },
      createTextNode(txt) { return { textContent: txt }; },
      addEventListener() {},
      removeEventListener() {},
    };

    const mockStorage = {};
    const mockChrome = {
      storage: {
        local: {
          get: async (keys) => {
            if (typeof keys === "string") return { [keys]: mockStorage[keys] };
            if (Array.isArray(keys)) {
              const res = {};
              keys.forEach(k => { res[k] = mockStorage[k]; });
              return res;
            }
            return { ...mockStorage };
          },
          set: async (items) => {
            Object.assign(mockStorage, items);
          },
        },
      },
      runtime: {
        sendMessage: async () => ({}),
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
    };

    const sandbox = {
      document: mockDocument,
      window: {
        addEventListener() {},
        location: { href: "" },
      },
      chrome: mockChrome,
      localStorage: {
        getItem: (k) => mockStorage[k] || null,
        setItem: (k, v) => { mockStorage[k] = String(v); },
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({}),
      }),
      console,
      setTimeout: (fn) => fn(),
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      Event: function(type) { this.type = type; },
      CustomEvent: function(type, detail) { this.type = type; this.detail = detail; },
      module: { exports: {} },
    };

    vm.createContext(sandbox);
    vm.runInContext(jsContent, sandbox);

    const {
      switchMiningTab,
      applyTabVisibility,
      applyHistoryVisibility,
      loadStoredCardTemplateSettings,
      saveStoredCardTemplateSettings,
      currentCardTemplateSettings,
    } = sandbox.module.exports;

    assert.equal(typeof applyTabVisibility, "function", "applyTabVisibility must be exported");
    assert.equal(typeof applyHistoryVisibility, "function", "applyHistoryVisibility must be exported");

    // 1. Initial / Text Tab state
    switchMiningTab("text");
    assert.equal(mockHistorySection.hidden, true, "History section must be hidden on text tab");
    assert.equal(mockHistorySection.style.display, "none", "History display style must be 'none' on text tab");

    // 2. Calling applyHistoryVisibility() should NOT unhide history
    applyHistoryVisibility();
    assert.equal(mockHistorySection.hidden, true, "applyHistoryVisibility() must be a no-op and keep history hidden on text tab");
    assert.equal(mockHistorySection.style.display, "none", "History display style must remain 'none'");

    // 3. Loading stored card template settings with show_history: true must NOT unhide history on text tab
    mockStorage["kiroku.card_template_settings"] = {
      Default: {
        show_history: true,
        front: {},
        back: {},
      }
    };
    await loadStoredCardTemplateSettings();
    assert.equal(mockHistorySection.hidden, true, "loadStoredCardTemplateSettings must not unhide history on text tab");
    assert.equal(mockHistorySection.style.display, "none");

    // 4. Saving card template settings with show_history: true must NOT unhide history on text tab
    currentCardTemplateSettings.show_history = true;
    await saveStoredCardTemplateSettings("Default");
    assert.equal(mockHistorySection.hidden, true, "saveStoredCardTemplateSettings must not unhide history on text tab");
    assert.equal(mockHistorySection.style.display, "none");

    // 5. Video Tab state
    switchMiningTab("video");
    assert.equal(mockHistorySection.hidden, true, "History section must be hidden on video tab");
    assert.equal(mockHistorySection.style.display, "none", "History display style must be 'none' on video tab");

    await saveStoredCardTemplateSettings("Default");
    assert.equal(mockHistorySection.hidden, true, "Saving settings on video tab must not show history");

    // 6. Ask Tab state
    switchMiningTab("ask");
    assert.equal(mockHistorySection.hidden, true, "History section must be hidden on ask tab");
    assert.equal(mockHistorySection.style.display, "none", "History display style must be 'none' on ask tab");

    await saveStoredCardTemplateSettings("Default");
    assert.equal(mockHistorySection.hidden, true, "Saving settings on ask tab must not show history");

    // 7. QuickAdd Tab state
    switchMiningTab("quickadd");
    assert.equal(mockHistorySection.hidden, true, "History section must be hidden on quickadd tab");
    assert.equal(mockHistorySection.style.display, "none", "History display style must be 'none' on quickadd tab");

    // 8. History Tab state
    switchMiningTab("history");
    assert.equal(mockHistorySection.hidden, false, "History section must be visible when on history tab");
    assert.equal(mockHistorySection.style.display, "", "History display style must be empty when on history tab");

    // 9. Switch back to Text Tab
    switchMiningTab("text");
    assert.equal(mockHistorySection.hidden, true, "Switching back to text tab must hide history section");
    assert.equal(mockHistorySection.style.display, "none", "History display style must be 'none'");
  });
});
