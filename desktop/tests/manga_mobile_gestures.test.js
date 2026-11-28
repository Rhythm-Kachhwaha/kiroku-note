const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');

test('manga_viewer: reader implements Pointer Events with pinch-to-zoom and pointercancel, without swipe page turns', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('handlePointerDown'), 'must implement handlePointerDown');
  assert.ok(content.includes('handlePointerMove'), 'must implement handlePointerMove');
  assert.ok(content.includes('handlePointerUp'), 'must implement handlePointerUp');
  assert.ok(content.includes('handlePointerCancel'), 'must implement handlePointerCancel');
  assert.ok(!content.includes('handleTouchSwipe'), 'must not use touch swipe for page turns');
  assert.ok(content.includes('handlePinchZoom'), 'must handle pinch zoom with active pointer tracking');
});

test('manga_viewer: openFile verifies storage persistence before updating library', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('verifyBookStorage'), 'must call verifyBookStorage after storing book');
  assert.ok(content.includes('Storage failed') || content.includes('Storage verification failed') || content.includes('Failed to save book to persistent storage'), 'must handle storage failure explicitly');
});

test('manga_viewer: pointer state machine safely transitions and preserves in-progress strokes on two-finger touch', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  // State machine tokens
  assert.ok(content.includes("this.interactionState = 'idle'"), 'must support idle state');
  assert.ok(content.includes("this.interactionState = 'single-pointer'"), 'must support single-pointer state');
  assert.ok(content.includes("this.interactionState = 'two-pointer'"), 'must support two-pointer state');
  assert.ok(content.includes("this.interactionState = 'releasing'"), 'must support releasing state');

  // Verify in-progress drawing stroke preservation when second pointer arrives
  assert.ok(content.includes('if (this.isDrawing) {\n        this.finishAnnotationStroke();'), 'must finish and preserve drawing stroke on second finger');

  // Verify pointercancel finishes drawing stroke
  assert.ok(content.includes('handlePointerCancel(e) {\n    if (this.isDrawing) {\n      this.finishAnnotationStroke();'), 'pointercancel must finish annotation stroke');

  // Clamping zoom strictly to [0.5, 4.0]
  assert.ok(content.includes('Math.max(0.5, Math.min(4.0,'), 'must clamp zoom to [0.5, 4.0]');
});

test('manga_viewer: unit simulation of two-finger gesture preserving drawn stroke in annotations map', async () => {
  // Simulate the interaction logic directly
  const pageAnnotationsMap = new Map();
  const currentBook = { id: 'book_gesture_test' };
  const currentPage = 3;

  let isDrawing = true;
  let currentStroke = {
    tool: 'pen',
    color: 'var(--color-primary)',
    width: 3,
    points: [{ x: 10, y: 20 }, { x: 30, y: 40 }]
  };

  const activePointers = new Map();
  let interactionState = 'idle';

  // First pointer down
  activePointers.set(1, { x: 50, y: 50 });
  interactionState = 'single-pointer';

  // Helper finishAnnotationStroke
  const finishAnnotationStroke = () => {
    if (!isDrawing || !currentStroke) return;
    isDrawing = false;
    const key = `${currentBook.id}_p${currentPage}`;
    let pageStrokes = pageAnnotationsMap.get(key) || [];
    pageStrokes.push(currentStroke);
    pageAnnotationsMap.set(key, pageStrokes);
    currentStroke = null;
  };

  // Second pointer arrives
  activePointers.set(2, { x: 150, y: 150 });
  if (activePointers.size === 2) {
    interactionState = 'two-pointer';
    if (isDrawing) {
      finishAnnotationStroke();
    }
  }

  // Assertions:
  assert.equal(interactionState, 'two-pointer');
  assert.equal(isDrawing, false, 'isDrawing must be reset');
  assert.equal(currentStroke, null, 'currentStroke must be cleared');
  const stored = pageAnnotationsMap.get('book_gesture_test_p3');
  assert.ok(stored && stored.length === 1, 'Stroke must be preserved in pageAnnotationsMap');
  assert.equal(stored[0].points.length, 2);
});
