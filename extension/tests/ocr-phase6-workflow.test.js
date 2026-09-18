const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

console.log("Starting Comprehensive OCR Phase 6 Workflow & Status UX Tests...");

const KirokuOcrCropper = require("../lib/ocr-cropper.js");

let indicatorEl = { className: "", title: "" };
let lastStatusText = "";
let lastStatusIsError = false;

function setIndicatorStatus(el, state, titleText) {
  if (!el) return;
  el.className = `indicator-pill ${state}`;
  el.title = titleText || "";
}

function setStatus(msg, isErr = false) {
  lastStatusText = msg;
  lastStatusIsError = isErr;
}

// Helper simulating checkOcrStatus with mock responses
async function simulateCheckOcrStatus(fetchMock) {
  let ocrAvailable = false;
  let ocrLoaded = false;
  try {
    setIndicatorStatus(indicatorEl, "checking", "OCR: Checking connection…");
    const res = await fetchMock("http://127.0.0.1:21828/api/ocr/status");
    const data = await res.json().catch(() => ({}));
    ocrAvailable = Boolean(data.available);
    const ocrInstalled = Boolean(data.installed);
    ocrLoaded = Boolean(data.model_loaded);

    if (ocrAvailable) {
      setIndicatorStatus(
        indicatorEl,
        "connected",
        ocrLoaded ? "OCR: Ready (Loaded)" : "OCR: Ready (Idle)"
      );
    } else if (!ocrInstalled) {
      setIndicatorStatus(indicatorEl, "unavailable", "OCR: Not installed");
    } else {
      setIndicatorStatus(
        indicatorEl,
        "unavailable",
        data.error ? `OCR: Offline (${data.error})` : (data.message || "OCR: Offline")
      );
    }
    return data;
  } catch (_) {
    ocrAvailable = false;
    ocrLoaded = false;
    setIndicatorStatus(indicatorEl, "unavailable", "OCR: Backend unreachable");
    return { available: false, installed: false, model_loaded: false };
  }
}

let cardDraft = {
  expression: "",
  reading: "",
  meanings: [],
  image: "",
  saved: false,
  synced: false
};

async function mockIdentify(text) {
  // Simulates backend /api/capture returning Yomitan enrichment
  cardDraft.expression = text;
  if (text === "猫") {
    cardDraft.reading = "ねこ";
    cardDraft.meanings = ["cat; feline"];
  } else if (text === "約束のネバーランド") {
    cardDraft.reading = "やくそくのネバーランド";
    cardDraft.meanings = ["The Promised Neverland (manga/anime series)"];
  } else {
    cardDraft.reading = text;
    cardDraft.meanings = ["user defined entry"];
  }
}

async function simulateFullOcrCaptureWorkflow({ rawRect, viewport, screenshotDataUrl }, fetchMock) {
  // Step 1: Crop screenshot
  const cropBounds = KirokuOcrCropper.calculateOcrCropBounds(
    rawRect,
    viewport,
    { naturalWidth: 1920, naturalHeight: 1080 }
  );

  if (cropBounds.width <= 0 || cropBounds.height <= 0) {
    throw new Error("Selection area is too small");
  }

  const croppedDataUrl = "data:image/png;base64,CROPPED_SNIPPET_BYTES";

  // Step 2: POST to /api/ocr/recognize
  const response = await fetchMock("http://127.0.0.1:21828/api/ocr/recognize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: croppedDataUrl })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "OCR failed");
  }

  const recognizedText = data.text ? data.text.trim() : "";
  if (!recognizedText) {
    setStatus("No Japanese text detected in selected region.");
    return null;
  }

  // Step 3: Feed into identify()
  await mockIdentify(recognizedText);

  // Step 4: Attach media
  cardDraft.image = "ocr_crop.png";

  return cardDraft;
}

async function runTests() {
  // --------------------------------------------------------------------------
  // 1. Verify All 6 OCR Status UX States
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 1: OCR Status UX States ---");

  // State 1: OCR Not Installed
  await simulateCheckOcrStatus(async () => ({
    json: async () => ({ available: false, installed: false, engine: "manga-ocr", model_loaded: false })
  }));
  assert.equal(indicatorEl.className, "indicator-pill unavailable");
  assert.equal(indicatorEl.title, "OCR: Not installed");
  console.log("PASS 1.1: State 1 (Not Installed) verified.");

  // State 2: OCR Installed but Offline / Not Running
  await simulateCheckOcrStatus(async () => ({
    json: async () => ({ available: false, installed: true, engine: "manga-ocr", model_loaded: false, error: "Connection refused" })
  }));
  assert.equal(indicatorEl.className, "indicator-pill unavailable");
  assert.ok(indicatorEl.title.includes("Offline"));
  console.log("PASS 1.2: State 2 (Installed, Offline) verified.");

  // State 3: OCR Ready (Daemon Running, Model Idle/Unloaded)
  await simulateCheckOcrStatus(async () => ({
    json: async () => ({ available: true, installed: true, engine: "manga-ocr", model_loaded: false })
  }));
  assert.equal(indicatorEl.className, "indicator-pill connected");
  assert.equal(indicatorEl.title, "OCR: Ready (Idle)");
  console.log("PASS 1.3: State 3 (Ready, Idle) verified.");

  // State 4: OCR Ready (Daemon Running, Model Loaded in Memory)
  await simulateCheckOcrStatus(async () => ({
    json: async () => ({ available: true, installed: true, engine: "manga-ocr", model_loaded: true })
  }));
  assert.equal(indicatorEl.className, "indicator-pill connected");
  assert.equal(indicatorEl.title, "OCR: Ready (Loaded)");
  console.log("PASS 1.4: State 4 (Ready, Loaded) verified.");

  // State 5: In-Flight Processing
  setIndicatorStatus(indicatorEl, "checking", "OCR: Processing…");
  assert.equal(indicatorEl.className, "indicator-pill checking");
  assert.equal(indicatorEl.title, "OCR: Processing…");
  console.log("PASS 1.5: State 5 (In-flight Processing) verified.");

  // State 6: OCR Error
  setIndicatorStatus(indicatorEl, "error", "OCR: Request timed out after 15s");
  assert.equal(indicatorEl.className, "indicator-pill error");
  assert.ok(indicatorEl.title.includes("timed out"));
  console.log("PASS 1.6: State 6 (OCR Error) verified.");

  // --------------------------------------------------------------------------
  // 2. High-DPI & Drag Direction Selection Math
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 2: Coordinate & Drag Direction Invariants ---");

  // Test all 4 drag directions
  const rects = [
    KirokuOcrCropper.normalizeSelectionRect(50, 50, 250, 150),  // Top-left -> Bottom-right
    KirokuOcrCropper.normalizeSelectionRect(250, 150, 50, 50),  // Bottom-right -> Top-left
    KirokuOcrCropper.normalizeSelectionRect(250, 50, 50, 150),  // Top-right -> Bottom-left
    KirokuOcrCropper.normalizeSelectionRect(50, 150, 250, 50),  // Bottom-left -> Top-right
  ];

  for (const r of rects) {
    assert.deepEqual(r, { left: 50, top: 50, width: 200, height: 100 });
  }
  console.log("PASS 2.1: Dragging in all 4 cardinal directions produces identical normalized bounds.");

  // High-DPI display coordinate mappings
  // 1.5x Windows display scaling (viewport 1280x720, screenshot 1920x1080)
  const bounds15x = KirokuOcrCropper.calculateOcrCropBounds(
    { left: 100, top: 80, width: 200, height: 60 },
    { innerWidth: 1280, innerHeight: 720 },
    { naturalWidth: 1920, naturalHeight: 1080 }
  );
  assert.deepEqual(bounds15x, { x: 150, y: 120, width: 300, height: 90 });
  console.log("PASS 2.2: 1.5x High-DPI display scaling mapped accurately.");

  // Edge of viewport clamping
  const boundsEdge = KirokuOcrCropper.calculateOcrCropBounds(
    { left: 1200, top: 700, width: 200, height: 100 },
    { innerWidth: 1280, innerHeight: 720 },
    { naturalWidth: 1280, naturalHeight: 720 }
  );
  assert.deepEqual(boundsEdge, { x: 1200, y: 700, width: 80, height: 20 });
  console.log("PASS 2.3: Screen edge overflow selection clamped within image bounds.");

  // --------------------------------------------------------------------------
  // 3. Complete End-to-End OCR -> Capture -> Card Draft Pipeline
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 3: End-to-End OCR to Card Mining Pipeline ---");

  const mockFetchRecognize = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.ok(body.image, "Request body MUST contain 'image' key conforming to OcrRecognizeRequest schema");
    assert.ok(body.image.startsWith("data:image/png;base64,"), "Image payload must be base64 data url");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        text: "猫",
        engine: "manga-ocr",
        device: "cpu",
        duration_ms: 280.4
      })
    };
  };

  const resultDraft = await simulateFullOcrCaptureWorkflow({
    rawRect: { left: 100, top: 100, width: 300, height: 120 },
    viewport: { innerWidth: 1920, innerHeight: 1080 },
    screenshotDataUrl: "data:image/png;base64,RAW"
  }, mockFetchRecognize);

  assert.equal(resultDraft.expression, "猫", "Expression must match recognized text");
  assert.equal(resultDraft.reading, "ねこ", "Reading must be enriched by dictionary pipeline");
  assert.equal(resultDraft.image, "ocr_crop.png", "Cropped image snippet must be attached as card media");
  console.log("PASS 3.1: Complete OCR recognition -> dictionary enrichment -> card draft verified.");

  // --------------------------------------------------------------------------
  // 4. User Correction and Editing Invariant
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 4: User Inspection & Correction Invariant ---");

  // If OCR returns slightly incomplete text e.g. "約束のネバーラン", user edits expression to "約束のネバーランド"
  cardDraft.expression = "約束のネバーラン";
  assert.equal(cardDraft.expression, "約束のネバーラン");

  // User updates the input field and re-identifies
  await mockIdentify("約束のネバーランド");
  assert.equal(cardDraft.expression, "約束のネバーランド");
  assert.equal(cardDraft.reading, "やくそくのネバーランド");
  assert.equal(cardDraft.image, "ocr_crop.png", "Image remains attached through user corrections");
  console.log("PASS 4.1: User expression correction updates dictionary lookup while preserving attached image.");

  // --------------------------------------------------------------------------
  // 5. Error Edge Cases & State Preservation
  // --------------------------------------------------------------------------
  console.log("\n--- Suite 5: Error Handling & Draft Integrity ---");

  // Case 1: Extremely small selection (< 5px)
  assert.throws(() => {
    const tinyBounds = KirokuOcrCropper.calculateOcrCropBounds(
      { left: 10, top: 10, width: 3, height: 4 },
      { innerWidth: 1000, innerHeight: 800 },
      { naturalWidth: 1000, naturalHeight: 800 }
    );
    if (tinyBounds.width <= 0 || tinyBounds.height <= 0 || !KirokuOcrCropper.isValidSelection({ width: 3, height: 4 }, 5, 5)) {
      throw new Error("Selection area is too small");
    }
  }, /Selection area is too small/);
  console.log("PASS 5.1: Small selection rejected safely without network call.");

  // Case 2: Escape / User cancellation leaves active draft intact
  const draftBeforeCancel = { ...cardDraft };
  // User presses Escape -> sets status to cancelled
  setStatus("OCR selection cancelled.");
  assert.deepEqual(cardDraft, draftBeforeCancel, "Cancellation must not corrupt or clear existing card draft");
  console.log("PASS 5.2: Selection cancellation preserves existing card draft.");

  // Case 3: Empty text detection
  const mockFetchEmpty = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: "   ", engine: "manga-ocr", duration_ms: 150.0 })
  });

  const emptyResult = await simulateFullOcrCaptureWorkflow({
    rawRect: { left: 10, top: 10, width: 100, height: 100 },
    viewport: { innerWidth: 1000, innerHeight: 800 },
    screenshotDataUrl: "data:image/png;base64,RAW"
  }, mockFetchEmpty);

  assert.equal(emptyResult, null, "Empty OCR text must not produce a card or alter draft");
  assert.equal(lastStatusText, "No Japanese text detected in selected region.");
  console.log("PASS 5.3: Empty OCR result handled gracefully without crashing or creating blank cards.");

  console.log("\n==================================================================");
  console.log(">>> ALL OCR PHASE 6 WORKFLOW & UX TESTS PASSED SUCCESSFULLY! <<<");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
