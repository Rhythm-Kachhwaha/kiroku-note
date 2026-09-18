const assert = require("node:assert/strict");
const {
  calculateOcrCropBounds,
  isValidSelection,
  normalizeSelectionRect,
} = require("../lib/ocr-cropper.js");

console.log("Starting OCR Cropper & Coordinate Math Tests...");

// 1. Test normalizeSelectionRect (handling drag in all 4 directions)
// Drag from top-left (10, 20) to bottom-right (110, 120)
const rectSE = normalizeSelectionRect(10, 20, 110, 120);
assert.deepEqual(rectSE, { left: 10, top: 20, width: 100, height: 100 });

// Drag from bottom-right (110, 120) to top-left (10, 20)
const rectNW = normalizeSelectionRect(110, 120, 10, 20);
assert.deepEqual(rectNW, { left: 10, top: 20, width: 100, height: 100 });

// Drag from top-right (110, 20) to bottom-left (10, 120)
const rectSW = normalizeSelectionRect(110, 20, 10, 120);
assert.deepEqual(rectSW, { left: 10, top: 20, width: 100, height: 100 });

// Drag from bottom-left (10, 120) to top-right (110, 20)
const rectNE = normalizeSelectionRect(10, 120, 110, 20);
assert.deepEqual(rectNE, { left: 10, top: 20, width: 100, height: 100 });

console.log("PASS: 4-directional selection rectangle normalization verified.");

// 2. Test calculateOcrCropBounds
// Standard 1x scale (1000x800 viewport == 1000x800 screenshot)
const bounds1x = calculateOcrCropBounds(
  { left: 100, top: 50, width: 200, height: 80 },
  { innerWidth: 1000, innerHeight: 800 },
  { naturalWidth: 1000, naturalHeight: 800 }
);
assert.deepEqual(bounds1x, { x: 100, y: 50, width: 200, height: 80 });

// 2x Retina / High-DPI scaling (1000x800 viewport -> 2000x1600 screenshot)
const bounds2x = calculateOcrCropBounds(
  { left: 100, top: 50, width: 200, height: 80 },
  { innerWidth: 1000, innerHeight: 800 },
  { naturalWidth: 2000, naturalHeight: 1600 }
);
assert.deepEqual(bounds2x, { x: 200, y: 100, width: 400, height: 160 });

// 1.25x Windows display scaling (1000x800 viewport -> 1250x1000 screenshot)
const bounds125 = calculateOcrCropBounds(
  { left: 80, top: 40, width: 120, height: 60 },
  { innerWidth: 1000, innerHeight: 800 },
  { naturalWidth: 1250, naturalHeight: 1000 }
);
assert.deepEqual(bounds125, { x: 100, y: 50, width: 150, height: 75 });

// Edge case: Clamping to image bounds (selection extends past right/bottom)
const boundsClamped = calculateOcrCropBounds(
  { left: 900, top: 700, width: 300, height: 200 },
  { innerWidth: 1000, innerHeight: 800 },
  { naturalWidth: 1000, naturalHeight: 800 }
);
assert.deepEqual(boundsClamped, { x: 900, y: 700, width: 100, height: 100 });

// Edge case: Negative left/top coordinates (clamped to 0)
const boundsNeg = calculateOcrCropBounds(
  { left: -20, top: -10, width: 100, height: 100 },
  { innerWidth: 1000, innerHeight: 800 },
  { naturalWidth: 1000, naturalHeight: 800 }
);
assert.deepEqual(boundsNeg, { x: 0, y: 0, width: 80, height: 90 });

console.log("PASS: Multi-DPI crop bounds and clamping calculations verified.");

// 3. Test isValidSelection
assert.equal(isValidSelection({ width: 5, height: 20 }, 10, 10), false, "Rejects width < 10");
assert.equal(isValidSelection({ width: 20, height: 5 }, 10, 10), false, "Rejects height < 10");
assert.equal(isValidSelection({ width: 0, height: 0 }, 10, 10), false, "Rejects 0x0");
assert.equal(isValidSelection(null, 10, 10), false, "Rejects null");
assert.equal(isValidSelection({ width: 10, height: 10 }, 10, 10), true, "Accepts exact minimum");
assert.equal(isValidSelection({ width: 150, height: 50 }, 10, 10), true, "Accepts valid selection");

console.log("PASS: Selection dimension validation verified.");
console.log("ALL OCR CROPPER TESTS PASSED SUCCESSFULLY!");
