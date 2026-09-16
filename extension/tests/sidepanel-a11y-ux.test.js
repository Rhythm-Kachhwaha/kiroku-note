const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const htmlPath = fs.existsSync("extension/sidepanel/sidepanel.html")
  ? "extension/sidepanel/sidepanel.html"
  : path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

const cssPath = fs.existsSync("extension/sidepanel/sidepanel.css")
  ? "extension/sidepanel/sidepanel.css"
  : path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

const jsPath = fs.existsSync("extension/sidepanel/sidepanel.js")
  ? "extension/sidepanel/sidepanel.js"
  : path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

// ==========================================================================
// 1. Semantic Headings
// ==========================================================================
assert.ok(
  html.includes('<h2 class="section-title">CARD</h2>') ||
  html.includes('<h2 class="section-title">Card</h2>'),
  "Card section header must be an h2 heading"
);

assert.ok(
  html.includes('<h2 class="section-title">CARD PREVIEW</h2>') ||
  html.includes('<h2 class="section-title">Card Preview</h2>'),
  "Card Preview section header must be an h2 heading"
);

assert.ok(
  html.includes('<h2 class="section-title">DICTIONARY</h2>') ||
  html.includes('<h2 class="section-title">Dictionary</h2>'),
  "Dictionary section header must be an h2 heading"
);

assert.ok(
  html.includes('<h2 class="section-title">HISTORY</h2>') ||
  html.includes('<h2 class="section-title">History</h2>'),
  "History section header must be an h2 heading"
);

// ==========================================================================
// 2. ARIA Relationships & Controls
// ==========================================================================
assert.ok(
  html.includes('aria-controls="optional-fields"'),
  "toggle-optional button must have aria-controls='optional-fields'"
);

assert.ok(
  html.includes('id="preview-tab-front"') && html.includes('aria-controls="card-preview-container"'),
  "Preview tab front must have aria-controls='card-preview-container'"
);

assert.ok(
  html.includes('id="preview-tab-back"') && html.includes('aria-controls="card-preview-container"'),
  "Preview tab back must have aria-controls='card-preview-container'"
);

// Ensure dictionary section is NOT a broad live region
assert.ok(
  !html.includes('id="dictionary-section" class="dictionary-section" aria-live="polite"'),
  "dictionary-section should not have broad aria-live='polite' wrapping entire DOM tree"
);

// ==========================================================================
// 3. Contrast Tokens & Reduced Motion
// ==========================================================================
assert.ok(
  css.includes("--text-muted: #8e8a81;") || css.includes("--text-muted: #8E8A81;"),
  "--text-muted token must be updated to #8e8a81 for WCAG AA compliance (4.65:1 contrast)"
);

assert.ok(
  css.includes("@media (prefers-reduced-motion: reduce)"),
  "CSS must include @media (prefers-reduced-motion: reduce) block"
);

// ==========================================================================
// 4. Focus Visibility Rules in CSS
// ==========================================================================
assert.ok(
  css.includes(".btn-subtitles:focus-visible") || css.includes(".btn-subtitles:focus"),
  "btn-subtitles must have focus-visible styling"
);

assert.ok(
  css.includes(".btn-clear-subtitles:focus-visible") || css.includes(".btn-clear-subtitles:focus"),
  "btn-clear-subtitles must have focus-visible styling"
);

assert.ok(
  css.includes(".btn-offset:focus-visible") || css.includes(".btn-offset:focus"),
  "btn-offset must have focus-visible styling"
);

assert.ok(
  css.includes(".btn-dict-action:focus-visible") || css.includes(".btn-dict-action:focus"),
  "btn-dict-action must have focus-visible styling"
);

assert.ok(
  css.includes(".preview-tab-btn:focus-visible") || css.includes(".preview-tab-btn:focus"),
  "preview-tab-btn must have focus-visible styling"
);

assert.ok(
  css.includes(".btn-history-retry:focus-visible") || css.includes(".btn-history-retry:focus"),
  "btn-history-retry must have focus-visible styling"
);

assert.ok(
  css.includes(".btn-history-delete:focus-visible") || css.includes(".btn-history-delete:focus"),
  "btn-history-delete must have focus-visible styling"
);

assert.ok(
  css.includes(".history-item-card-btn:focus-visible") || css.includes(".history-item-card-btn:focus"),
  "history-item-card-btn must have focus-visible styling"
);

// ==========================================================================
// 5. History Non-Nested Interactive Semantics
// ==========================================================================
class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.textContent = "";
    this.eventListeners = {};
  }
  setAttribute(name, val) { this.attributes[name] = String(val); }
  getAttribute(name) { return this.attributes[name]; }
  append(...nodes) {
    nodes.forEach(n => {
      if (typeof n === "string") {
        const textNode = new MockElement("#text");
        textNode.textContent = n;
        this.children.push(textNode);
      } else {
        this.children.push(n);
      }
    });
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(event, handler) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
  }
}

const mockHistoryList = new MockElement("div");
const mockContext = {
  document: {
    createElement: (tag) => new MockElement(tag),
    createTextNode: (t) => {
      const el = new MockElement("#text");
      el.textContent = t;
      return el;
    },
  },
  historyCardsList: mockHistoryList,
  selectedHistoryCardId: 10,
  openSavedCard: () => {},
  retrySyncFromHistory: () => {},
  deleteLocalCard: () => {},
};

const renderCardsFnSrc = jsContent.slice(
  jsContent.indexOf("function renderHistoryCards"),
  jsContent.indexOf("async function openSavedCard")
);
vm.runInNewContext(renderCardsFnSrc, mockContext);

mockContext.renderHistoryCards([
  { id: 10, expression: "猫", reading: "ねこ", meaning: "cat", deck_name: "Default", sync_status: "synced" },
  { id: 11, expression: "犬", reading: "いぬ", meaning: "dog", deck_name: "Default", sync_status: "failed", sync_error: "offline" }
]);

assert.equal(mockHistoryList.children.length, 2, "Should render 2 history card items");
const renderedItem = mockHistoryList.children[0];

// Crucial: Container should NOT be role="button" or tabIndex=0
assert.equal(renderedItem.getAttribute("role"), undefined, "Container article must not have role='button'");
assert.equal(renderedItem.tabIndex, undefined, "Container article must not have tabIndex=0");

const cardBtn = renderedItem.children.find(c => c.className && c.className.includes("history-item-card-btn"));
assert.ok(cardBtn, "History item must contain a .history-item-card-btn button element");
assert.equal(cardBtn.tagName, "BUTTON", ".history-item-card-btn must be a native BUTTON element");

const actionsContainer = renderedItem.children.find(c => c.className === "history-item-actions");
assert.ok(actionsContainer, "Actions container must be a sibling to card button");

// ==========================================================================
// 6. Loading States, Zero-Result Feedback & Non-blocking Confirmations
// ==========================================================================
assert.ok(
  html.includes('id="dict-loading-indicator"'),
  "sidepanel.html must include #dict-loading-indicator"
);

assert.ok(
  html.includes('id="dict-empty-notice"'),
  "sidepanel.html must include #dict-empty-notice"
);

assert.ok(
  !jsContent.includes("window.confirm"),
  "sidepanel.js must not use blocking window.confirm() dialogs"
);

assert.ok(
  jsContent.includes("confirm-replace") && jsContent.includes("confirm-delete"),
  "sidepanel.js must support inline 2-click confirmation classes (confirm-replace, confirm-delete)"
);

// ==========================================================================
// 7. First-Run Experience & Empty States
// ==========================================================================
assert.ok(
  html.includes('id="first-run-guide"'),
  "sidepanel.html must include #first-run-guide section"
);

assert.ok(
  html.includes('id="btn-dismiss-first-run"'),
  "sidepanel.html must include #btn-dismiss-first-run button"
);

assert.ok(
  css.includes(".first-run-guide"),
  "sidepanel.css must include .first-run-guide styles"
);

assert.ok(
  jsContent.includes("checkFirstRunStatus") && jsContent.includes("dismissFirstRunGuide"),
  "sidepanel.js must include first-run guide state management functions"
);

// ==========================================================================
// 8. Strict Constraint Verification: NO KEYBOARD SHORTCUTS ADDED
// ==========================================================================
// Ensure we didn't add any global Ctrl+Enter, Ctrl+K, Ctrl+Shift+M or shortcut managers
assert.ok(
  !jsContent.includes("ctrlKey && event.key === 'Enter'") &&
  !jsContent.includes("event.ctrlKey && event.key === 'k'") &&
  !jsContent.includes("event.ctrlKey && event.key === 'm'"),
  "No keyboard shortcuts may be added in Stage 6/7"
);

// ==========================================================================
// 9. Stage 7.5 CSP Hardening & Offline Local Font Verification
// ==========================================================================
assert.ok(
  html.includes('<meta http-equiv="Content-Security-Policy"'),
  "sidepanel.html must include Content-Security-Policy meta tag"
);

assert.ok(
  !html.includes("fonts.googleapis.com") && !html.includes("fonts.gstatic.com"),
  "sidepanel.html must not contain external Google Fonts CDN links"
);

assert.ok(
  css.includes('@font-face') && css.includes('Noto Sans JP') && css.includes('Noto Serif JP'),
  "sidepanel.css must include @font-face declarations for Japanese typography"
);

console.log("PASS: All accessibility, focus, loading state, first-run guide, semantics, and Stage 7.5 CSP/font tests verified.");



