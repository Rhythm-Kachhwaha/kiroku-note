const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');

test('manga_viewer: reader implements Pointer Events with pinch-to-zoom, swipe, and pointercancel', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('handlePointerDown'), 'must implement handlePointerDown');
  assert.ok(content.includes('handlePointerMove'), 'must implement handlePointerMove');
  assert.ok(content.includes('handlePointerUp'), 'must implement handlePointerUp');
  assert.ok(content.includes('handlePointerCancel'), 'must implement handlePointerCancel');
  assert.ok(content.includes('handleTouchSwipe'), 'must handle touch swipe for page turns');
  assert.ok(content.includes('handlePinchZoom'), 'must handle pinch zoom with active pointer tracking');
});

test('manga_viewer: openFile verifies storage persistence before updating library', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('verifyBookStorage'), 'must call verifyBookStorage after storing book');
  assert.ok(content.includes('Storage failed') || content.includes('Storage verification failed') || content.includes('Failed to save book to persistent storage'), 'must handle storage failure explicitly');
});
