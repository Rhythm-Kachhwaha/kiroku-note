const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting OCR Background Routing Tests (Task 3)...");

const bgPath = path.resolve(__dirname, "../background.js");
const bgCode = fs.readFileSync(bgPath, "utf8");

function createBackgroundSandbox() {
  const runtimeMessageListeners = [];
  const tabMessages = [];
  const runtimeMessages = [];
  let captureVisibleTabResult = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  let captureVisibleTabError = null;

  const sandbox = {
    console,
    isMiningModeEnabled: false,
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: {
          addListener: (fn) => runtimeMessageListeners.push(fn)
        },
        sendMessage: (msg) => {
          runtimeMessages.push(msg);
          return Promise.resolve({ ok: true });
        }
      },
      sidePanel: {
        setPanelBehavior: () => Promise.resolve()
      },
      tabs: {
        query: (queryInfo) => {
          return Promise.resolve([{ id: 101, url: "https://example.com/manga", windowId: 1 }]);
        },
        sendMessage: (tabId, msg) => {
          tabMessages.push({ tabId, msg });
          return Promise.resolve({ ok: true });
        },
        captureVisibleTab: (windowIdOrOptions, maybeOptions) => {
          if (captureVisibleTabError) {
            return Promise.reject(captureVisibleTabError);
          }
          return Promise.resolve(captureVisibleTabResult);
        }
      },
      scripting: {
        executeScript: () => Promise.resolve([{ result: true }])
      }
    },
    runtimeMessageListeners,
    tabMessages,
    runtimeMessages,
    setCaptureResult: (res) => { captureVisibleTabResult = res; },
    setCaptureError: (err) => { captureVisibleTabError = err; }
  };

  vm.createContext(sandbox);
  vm.runInContext(bgCode, sandbox);
  return sandbox;
}

// Test 1: START_OCR_CAPTURE routes START_OCR_SELECTION to active tab
const sb1 = createBackgroundSandbox();
const msgHandler = sb1.runtimeMessageListeners[0];

let response1 = null;
msgHandler({ type: "START_OCR_CAPTURE" }, {}, (res) => { response1 = res; });

// Wait microtasks
setTimeout(() => {
  assert.equal(response1?.ok, true, "START_OCR_CAPTURE must respond ok: true");
  const tabMsg = sb1.tabMessages.find(m => m.msg?.type === "START_OCR_SELECTION");
  assert.ok(tabMsg, "Must forward START_OCR_SELECTION to active tab");
  assert.equal(tabMsg.tabId, 101);
  console.log("PASS: START_OCR_CAPTURE forwards to active tab.");

  // Test 2: OCR_REGION_SELECTED captures screenshot and forwards PROCESS_OCR_CROP to runtime
  let response2 = null;
  msgHandler({
    type: "OCR_REGION_SELECTED",
    rect: { left: 50, top: 60, width: 200, height: 100 },
    viewport: { innerWidth: 1000, innerHeight: 800 },
    devicePixelRatio: 2
  }, { tab: { windowId: 1 } }, (res) => { response2 = res; });

  setTimeout(() => {
    assert.equal(response2?.ok, true, "OCR_REGION_SELECTED must respond ok: true");
    const cropMsg = sb1.runtimeMessages.find(m => m.type === "PROCESS_OCR_CROP");
    assert.ok(cropMsg, "Must broadcast PROCESS_OCR_CROP to runtime");
    assert.ok(cropMsg.dataUrl.startsWith("data:image/png;base64,"), "Must carry screenshot dataUrl");
    assert.deepEqual(cropMsg.rect, { left: 50, top: 60, width: 200, height: 100 });
    assert.equal(cropMsg.devicePixelRatio, 2);
    console.log("PASS: OCR_REGION_SELECTED captures screenshot and broadcasts PROCESS_OCR_CROP.");

    // Test 3: OCR_SELECTION_CANCELLED forwards to runtime
    msgHandler({
      type: "OCR_SELECTION_CANCELLED",
      reason: "escape"
    }, {}, () => {});

    const cancelMsg = sb1.runtimeMessages.find(m => m.type === "OCR_SELECTION_CANCELLED");
    assert.ok(cancelMsg, "Must forward OCR_SELECTION_CANCELLED to runtime");
    assert.equal(cancelMsg.reason, "escape");
    console.log("PASS: OCR_SELECTION_CANCELLED forwarding verified.");

    console.log("ALL OCR BACKGROUND ROUTING TESTS PASSED SUCCESSFULLY!");
  }, 50);
}, 50);
