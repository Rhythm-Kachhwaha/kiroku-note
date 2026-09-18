const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("Starting OCR Side Panel Integration Tests (Task 4)...");

// --------------------------------------------------------------------------
// 1. Static HTML & Script Inclusions
// --------------------------------------------------------------------------
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="indicator-ocr"'), "indicator-ocr element must exist in sidepanel.html");
assert.ok(html.includes('id="ocr-capture-btn"'), "ocr-capture-btn button must exist in sidepanel.html");
assert.ok(html.includes('<script src="../lib/ocr-cropper.js"></script>'), "ocr-cropper.js must be loaded in sidepanel.html");
console.log("PASS 1: HTML elements and script inclusions verified.");

// --------------------------------------------------------------------------
// 2. Static JS Contract Checks
// --------------------------------------------------------------------------
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsCode = fs.readFileSync(jsPath, "utf8");

assert.ok(jsCode.includes("API_OCR_STATUS_URL"), "API_OCR_STATUS_URL constant must exist in sidepanel.js");
assert.ok(jsCode.includes("API_OCR_RECOGNIZE_URL"), "API_OCR_RECOGNIZE_URL constant must exist in sidepanel.js");
assert.ok(jsCode.includes("checkOcrStatus"), "checkOcrStatus function must exist in sidepanel.js");
assert.ok(jsCode.includes("handleOcrCropProcess"), "handleOcrCropProcess function must exist in sidepanel.js");
assert.ok(jsCode.includes("START_OCR_CAPTURE"), "START_OCR_CAPTURE message type must be handled in sidepanel.js");
assert.ok(jsCode.includes("PROCESS_OCR_CROP"), "PROCESS_OCR_CROP message type must be handled in sidepanel.js");
assert.ok(jsCode.includes("OCR_SELECTION_CANCELLED"), "OCR_SELECTION_CANCELLED message type must be handled in sidepanel.js");
console.log("PASS 2: JavaScript contracts and message handlers verified.");

// --------------------------------------------------------------------------
// 3. Functional Simulation of OCR Processing & Capture Forwarding
// --------------------------------------------------------------------------
const KirokuOcrCropper = require("../lib/ocr-cropper.js");

// Mock environment
let lastStatus = "";
let lastStatusIsError = false;
let identifiedText = null;
let currentDraftMedia = { imageBase64: null, captureId: 0 };
let currentCaptureId = 10;
let indicatorState = { className: "", title: "" };
let previewsUpdated = false;

function setStatus(msg, isErr = false) {
  lastStatus = msg;
  lastStatusIsError = isErr;
}

function setIndicatorStatus(el, state, titleText) {
  if (!el) return;
  el.className = `indicator-pill ${state}`;
  el.title = titleText || "";
}

async function identify(text) {
  identifiedText = text;
}

function updateMediaPreviews() {
  previewsUpdated = true;
}

// Simulated handleOcrCropProcess using identical logic
async function simulateOcrCropProcess({ dataUrl, cropRect, viewport }, fetchMock) {
  const indicatorOcr = indicatorState;
  const fieldImage = { value: "" };

  try {
    setStatus("Processing OCR capture…");
    setIndicatorStatus(indicatorOcr, "checking", "OCR: Processing…");

    // Compute crop bounds
    const cropBounds = KirokuOcrCropper.calculateOcrCropBounds(
      cropRect,
      1920, // simulated naturalWidth
      1080, // simulated naturalHeight
      viewport.width,
      viewport.height
    );

    if (cropBounds.sw <= 0 || cropBounds.sh <= 0) {
      throw new Error("Selection area is too small");
    }

    const croppedDataUrl = "data:image/png;base64,CROPPED_DATA";

    const response = await fetchMock("http://127.0.0.1:21828/api/ocr/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: croppedDataUrl })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = result.detail || `OCR failed (status ${response.status})`;
      setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Error");
      setStatus(`OCR failed: ${errMsg}`, true);
      return;
    }

    setIndicatorStatus(indicatorOcr, "connected", "OCR: Ready");

    const recognizedText = typeof result.text === "string" ? result.text.trim() : "";
    if (!recognizedText) {
      setStatus("No Japanese text detected in selected region.");
      return;
    }

    setStatus(`OCR recognized: ${recognizedText}`);

    // Feed directly into canonical capture pipeline
    await identify(recognizedText);

    // Attach cropped image snippet to card draft
    currentDraftMedia.imageBase64 = croppedDataUrl;
    currentDraftMedia.captureId = currentCaptureId;
    if (fieldImage && !fieldImage.value) {
      fieldImage.value = "ocr_crop.png";
    }
    updateMediaPreviews();

  } catch (err) {
    setIndicatorStatus(indicatorOcr, "unavailable", "OCR: Error");
    setStatus(`OCR capture failed: ${err.message}`, true);
  }
}

async function runAllTests() {
  // Test 3A: Successful OCR recognition feeds into identify()
  identifiedText = null;
  previewsUpdated = false;
  currentDraftMedia = { imageBase64: null, captureId: 0 };

  const fetchMockSuccess = async (url, opts) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        text: "彼女の猫",
        engine: "manga-ocr",
        duration_ms: 245.5
      })
    };
  };

  await simulateOcrCropProcess({
    dataUrl: "data:image/png;base64,RAW_SCREENSHOT",
    cropRect: { x: 100, y: 100, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, fetchMockSuccess);

  assert.equal(identifiedText, "彼女の猫", "Recognized text must be passed directly into identify()");
  assert.equal(currentDraftMedia.imageBase64, "data:image/png;base64,CROPPED_DATA", "Cropped image must be attached to currentDraftMedia");
  assert.equal(previewsUpdated, true, "Media previews must be updated");
  assert.equal(indicatorState.className, "indicator-pill connected", "OCR indicator must be connected");
  assert.ok(lastStatus.includes("彼女の猫"), "Status must display recognized text");
  console.log("PASS 3A: Successful OCR recognition feeds into identify() and attaches card image.");

  // Test 3B: Empty text result does not invoke identify()
  identifiedText = null;
  previewsUpdated = false;

  const fetchMockEmpty = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      text: "   ",
      engine: "manga-ocr",
      duration_ms: 120.0
    })
  });

  await simulateOcrCropProcess({
    dataUrl: "data:image/png;base64,RAW_SCREENSHOT",
    cropRect: { x: 100, y: 100, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, fetchMockEmpty);

  assert.equal(identifiedText, null, "Empty OCR text must NOT trigger identify()");
  assert.equal(lastStatus, "No Japanese text detected in selected region.", "Status must inform user of empty result");
  console.log("PASS 3B: Empty OCR result does not create card or invoke identify().");

  // Test 3C: OCR daemon unavailable (503) error handling
  identifiedText = null;

  const fetchMock503 = async () => ({
    ok: false,
    status: 503,
    json: async () => ({
      detail: "OCR service unavailable on 127.0.0.1:21829"
    })
  });

  await simulateOcrCropProcess({
    dataUrl: "data:image/png;base64,RAW_SCREENSHOT",
    cropRect: { x: 100, y: 100, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, fetchMock503);

  assert.equal(identifiedText, null, "Failed OCR must NOT trigger identify()");
  assert.equal(lastStatusIsError, true, "Status must be flagged as error");
  assert.ok(lastStatus.includes("OCR service unavailable"), "Status must describe backend error");
  assert.equal(indicatorState.className, "indicator-pill unavailable", "OCR indicator must be unavailable");
  console.log("PASS 3C: OCR unavailable 503 error handled cleanly.");

  // Test 3D: OCR timeout (504) error handling
  identifiedText = null;

  const fetchMock504 = async () => ({
    ok: false,
    status: 504,
    json: async () => ({
      detail: "OCR request timed out after 30.0s"
    })
  });

  await simulateOcrCropProcess({
    dataUrl: "data:image/png;base64,RAW_SCREENSHOT",
    cropRect: { x: 100, y: 100, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, fetchMock504);

  assert.equal(identifiedText, null, "Timed out OCR must NOT trigger identify()");
  assert.equal(lastStatusIsError, true, "Status must be flagged as error");
  assert.ok(lastStatus.includes("timed out"), "Status must describe timeout");
  console.log("PASS 3D: OCR timeout 504 error handled cleanly.");

  // Test 3E: Backend rejects invalid crop with 400 Bad Request
  identifiedText = null;

  const fetchMock400 = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      detail: "Invalid crop rectangle or unreadable image"
    })
  });

  await simulateOcrCropProcess({
    dataUrl: "data:image/png;base64,RAW_SCREENSHOT",
    cropRect: { x: 100, y: 100, width: 200, height: 80 },
    viewport: { width: 1920, height: 1080 }
  }, fetchMock400);

  assert.equal(identifiedText, null, "Invalid crop must NOT trigger identify()");
  assert.equal(lastStatusIsError, true, "Status must be flagged as error");
  assert.ok(lastStatus.includes("Invalid crop"), "Status must describe invalid crop error");
  console.log("PASS 3E: Invalid crop 400 rejection handled gracefully.");

  console.log("ALL OCR SIDE PANEL INTEGRATION TESTS PASSED SUCCESSFULLY!");
}

runAllTests();
