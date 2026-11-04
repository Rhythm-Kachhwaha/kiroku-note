const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..');
const hashesPath = path.join(__dirname, 'final_lock.hashes.json');
const expectedHashes = JSON.parse(fs.readFileSync(hashesPath, 'utf8'));

function sha256(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

test('FINAL Lock: views/kanji.css mastery section hash matches', () => {
  const kanjiCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'kanji.css');
  const content = fs.readFileSync(kanjiCssPath, 'utf8');
  const startMarker = '/* FINAL:KANJI-MASTERY START */';
  const endMarker = '/* FINAL:KANJI-MASTERY END */';
  assert.ok(content.includes(startMarker), 'kanji.css must contain FINAL:KANJI-MASTERY START marker');
  assert.ok(content.includes(endMarker), 'kanji.css must contain FINAL:KANJI-MASTERY END marker');

  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker) + endMarker.length;
  const block = content.slice(start, end);
  const hash = sha256(block);

  assert.equal(hash, expectedHashes.kanji_css_mastery, 'FINAL locked: ask owner');
});

test('FINAL Lock: shell.css dock rules block hash matches', () => {
  const shellCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'shell.css');
  const content = fs.readFileSync(shellCssPath, 'utf8');
  const startMarker = '/* FINAL:BOTTOM-DOCK START */';
  const endMarker = '/* FINAL:BOTTOM-DOCK END */';
  assert.ok(content.includes(startMarker), 'shell.css must contain FINAL:BOTTOM-DOCK START marker');
  assert.ok(content.includes(endMarker), 'shell.css must contain FINAL:BOTTOM-DOCK END marker');

  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker) + endMarker.length;
  const block = content.slice(start, end);
  const hash = sha256(block);

  assert.equal(hash, expectedHashes.shell_css_dock, 'FINAL locked: ask owner');
});

test('FINAL Lock: bottom_dock.js component hash matches', () => {
  const bottomDockJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'bottom_dock.js');
  const content = fs.readFileSync(bottomDockJsPath, 'utf8');
  const hash = sha256(content);

  assert.equal(hash, expectedHashes.bottom_dock_js, 'FINAL locked: ask owner');
});

test('FINAL Lock: kanji.js mastery section markup function hash matches', () => {
  const kanjiJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'kanji.js');
  const content = fs.readFileSync(kanjiJsPath, 'utf8');
  const startMarker = '<!-- FINAL:KANJI-MASTERY-MARKUP START -->';
  const endMarker = '<!-- FINAL:KANJI-MASTERY-MARKUP END -->';
  assert.ok(content.includes(startMarker), 'kanji.js must contain FINAL:KANJI-MASTERY-MARKUP START marker');
  assert.ok(content.includes(endMarker), 'kanji.js must contain FINAL:KANJI-MASTERY-MARKUP END marker');

  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker) + endMarker.length;
  const block = content.slice(start, end);
  const hash = sha256(block);

  assert.equal(hash, expectedHashes.kanji_mastery_markup, 'FINAL locked: ask owner');
});
