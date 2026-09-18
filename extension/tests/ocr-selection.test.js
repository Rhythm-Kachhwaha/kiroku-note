const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting OCR Selection Overlay Tests (Task 2)...");

// 1. Verify manifest.json includes ocr-selection.js
const manifestPath = path.resolve(__dirname, "../manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const contentScriptFiles = manifest.content_scripts[0].js;

assert.ok(
  contentScriptFiles.includes("lib/ocr-cropper.js"),
  "manifest.json content_scripts must include lib/ocr-cropper.js"
);
assert.ok(
  contentScriptFiles.includes("content/ocr-selection.js"),
  "manifest.json content_scripts must include content/ocr-selection.js"
);
console.log("PASS: manifest.json content_scripts declaration verified.");

// 2. Test ocr-selection.js logic in sandbox
const scriptPath = path.resolve(__dirname, "../content/ocr-selection.js");
const scriptCode = fs.readFileSync(scriptPath, "utf8");

class MockElement {
  constructor(tag, id = "") {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = "";
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this._listeners = {};
    this.textContent = "";
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
  removeEventListener(evt, fn) {
    if (!this._listeners[evt]) return;
    this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
  }
  dispatchEvent(evt) {
    const listeners = this._listeners[evt.type] || [];
    listeners.forEach(fn => fn(evt));
  }
}

function createSandbox() {
  const documentListeners = {};
  const windowListeners = {};
  const sentMessages = [];

  const body = new MockElement("BODY");
  const doc = {
    body,
    documentElement: body,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      const find = (el) => {
        if (el.id === id) return el;
        for (const c of el.children) {
          const res = find(c);
          if (res) return res;
        }
        return null;
      };
      return find(body);
    },
    addEventListener: (evt, fn) => {
      if (!documentListeners[evt]) documentListeners[evt] = [];
      documentListeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (!documentListeners[evt]) return;
      documentListeners[evt] = documentListeners[evt].filter(f => f !== fn);
    }
  };

  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 2,
    addEventListener: (evt, fn) => {
      if (!windowListeners[evt]) windowListeners[evt] = [];
      windowListeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (!windowListeners[evt]) return;
      windowListeners[evt] = windowListeners[evt].filter(f => f !== fn);
    }
  };

  const chromeRuntimeListeners = [];
  const sandbox = {
    document: doc,
    window: win,
    console,
    KirokuOcrCropper: require("../lib/ocr-cropper.js"),
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn) => chromeRuntimeListeners.push(fn)
        },
        sendMessage: (msg) => {
          sentMessages.push(msg);
          return Promise.resolve({ ok: true });
        }
      }
    },
    documentListeners,
    windowListeners,
    sentMessages,
    chromeRuntimeListeners
  };

  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox);
  return sandbox;
}

// Test overlay mount on START_OCR_SELECTION message
const sb = createSandbox();
assert.equal(sb.chromeRuntimeListeners.length > 0, true, "Must register onMessage listener");

// Trigger START_OCR_SELECTION
const onMessage = sb.chromeRuntimeListeners[0];
let sendResponseCalled = false;
onMessage({ type: "START_OCR_SELECTION" }, {}, () => { sendResponseCalled = true; });

const overlay = sb.document.getElementById("kiroku-ocr-overlay");
assert.ok(overlay, "#kiroku-ocr-overlay must be mounted in document");
assert.equal(overlay.style.position, "fixed");
assert.equal(overlay.style.cursor, "crosshair");

// Test Escape key cancels overlay
const keydownListeners = sb.documentListeners["keydown"] || [];
assert.ok(keydownListeners.length > 0, "Must attach keydown listener for Escape");
keydownListeners[0]({ key: "Escape", preventDefault: () => {} });

assert.equal(sb.document.getElementById("kiroku-ocr-overlay"), null, "Overlay must be removed after Escape");
assert.ok(sb.sentMessages.some(m => m.type === "OCR_SELECTION_CANCELLED"), "Must send OCR_SELECTION_CANCELLED on Escape");

console.log("PASS: Overlay mounting and Escape cancellation verified.");

// Test dragging to select region
const sb2 = createSandbox();
const onMessage2 = sb2.chromeRuntimeListeners[0];
onMessage2({ type: "START_OCR_SELECTION" }, {}, () => {});

const overlay2 = sb2.document.getElementById("kiroku-ocr-overlay");
const mousedownListeners = overlay2._listeners["mousedown"] || [];
assert.ok(mousedownListeners.length > 0, "Overlay must attach mousedown listener");

// Start drag at (100, 150)
mousedownListeners[0]({ clientX: 100, clientY: 150, preventDefault: () => {} });

// Move to (300, 250)
const mousemoveListeners = sb2.documentListeners["mousemove"] || [];
assert.ok(mousemoveListeners.length > 0, "Must attach mousemove listener");
mousemoveListeners[0]({ clientX: 300, clientY: 250, preventDefault: () => {} });

const selectionBox = sb2.document.getElementById("kiroku-ocr-selection");
assert.ok(selectionBox, "Selection box must exist during drag");
assert.equal(selectionBox.style.left, "100px");
assert.equal(selectionBox.style.top, "150px");
assert.equal(selectionBox.style.width, "200px");
assert.equal(selectionBox.style.height, "100px");

// Release mouse at (300, 250) -> confirms selection
const mouseupListeners = sb2.documentListeners["mouseup"] || [];
assert.ok(mouseupListeners.length > 0, "Must attach mouseup listener");
mouseupListeners[0]({ clientX: 300, clientY: 250, preventDefault: () => {} });

assert.equal(sb2.document.getElementById("kiroku-ocr-overlay"), null, "Overlay must be removed after selection");
const selectedMsg = sb2.sentMessages.find(m => m.type === "OCR_REGION_SELECTED");
assert.ok(selectedMsg, "Must send OCR_REGION_SELECTED message on confirmation");
assert.equal(selectedMsg.rect.left, 100);
assert.equal(selectedMsg.rect.top, 150);
assert.equal(selectedMsg.rect.width, 200);
assert.equal(selectedMsg.rect.height, 100);
assert.equal(selectedMsg.devicePixelRatio, 2);
assert.equal(selectedMsg.viewport.innerWidth, 1200);

console.log("PASS: Drag-to-select and confirmation message verified.");

// Test small accidental click cancellation (< 10px)
const sb3 = createSandbox();
const onMessage3 = sb3.chromeRuntimeListeners[0];
onMessage3({ type: "START_OCR_SELECTION" }, {}, () => {});

const overlay3 = sb3.document.getElementById("kiroku-ocr-overlay");
overlay3._listeners["mousedown"][0]({ clientX: 100, clientY: 100, preventDefault: () => {} });
sb3.documentListeners["mouseup"][0]({ clientX: 104, clientY: 104, preventDefault: () => {} });

assert.equal(sb3.document.getElementById("kiroku-ocr-overlay"), null, "Overlay must be removed on small click");
assert.ok(sb3.sentMessages.some(m => m.type === "OCR_SELECTION_CANCELLED"), "Must cancel small selection");

console.log("PASS: Accidental small drag cancellation verified.");
console.log("ALL OCR SELECTION TESTS PASSED SUCCESSFULLY!");
