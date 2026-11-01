const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const uiDir = path.join(repoRoot, 'desktop', 'src', 'ui');

test('Batch C: tactile.css implements user-select: text on .tactile-input and uses shadow tokens', () => {
  const tactilePath = path.join(uiDir, 'styles', 'tactile.css');
  const content = fs.readFileSync(tactilePath, 'utf8');

  // Caret selection in Electron
  assert.ok(
    content.includes('.tactile-input') && content.includes('user-select: text;'),
    'tactile.css must specify user-select: text; for .tactile-input'
  );

  // Uses shadow tokens
  assert.ok(content.includes('var(--shadow-md)'), 'tactile.css must use var(--shadow-md)');
  assert.ok(content.includes('var(--shadow-lg)'), 'tactile.css must use var(--shadow-lg)');
  assert.ok(content.includes('var(--shadow-pressed)'), 'tactile.css must use var(--shadow-pressed)');

  // No raw shadow literals
  const rawShadowRegex = /box-shadow:\s*[1-4]px\s+[1-4]px\s+0\s+var\(--tactile-stroke\)/;
  assert.equal(
    rawShadowRegex.test(content),
    false,
    'tactile.css must not use raw shadow literals with var(--tactile-stroke)'
  );
});

test('Batch C: bundle.css and codebase contain no legacy chocolate/orange hex fallbacks', () => {
  const bundlePath = path.join(uiDir, 'styles', 'bundle.css');
  const bundleContent = fs.readFileSync(bundlePath, 'utf8');
  assert.equal(/#26170D|#FF8A1F|#FFF1DC/i.test(bundleContent), false, 'bundle.css must not contain forbidden legacy colors');
});

test('Batch C: bottom_dock.js restricts arrow keys to dock focus and caps rAF retries at 5', () => {
  const dockPath = path.join(uiDir, 'shell', 'bottom_dock.js');
  const content = fs.readFileSync(dockPath, 'utf8');

  assert.ok(
    content.includes("document.activeElement?.closest('#bottom-dock')") ||
    content.includes("document.activeElement?.closest('.nav-tab-item')"),
    'bottom_dock.js must restrict ArrowLeft/ArrowRight to when dock or nav-tab-item has focus'
  );

  assert.ok(
    content.includes('retryCount < 5') || content.includes('retryCount <= 5'),
    'bottom_dock.js must cap updatePillPosition retries when width is 0'
  );
});

test('Batch C: top_chrome.js evaluates missing telemetry keys to null (is-checking)', () => {
  const chromePath = path.join(uiDir, 'shell', 'top_chrome.js');
  const content = fs.readFileSync(chromePath, 'utf8');

  assert.ok(
    content.includes('null') && (content.includes('resolveStatus') || content.includes('=== undefined')),
    'top_chrome.js must evaluate missing service keys to null'
  );
});

test('Batch C: home.js manages this.jumpTimeout lifecycle and resets mouseLeaveHandler', () => {
  const homePath = path.join(uiDir, 'views', 'home.js');
  const content = fs.readFileSync(homePath, 'utf8');

  assert.ok(content.includes('this.jumpTimeout = null;'), 'home.js must initialize this.jumpTimeout');
  assert.ok(content.includes('clearTimeout(this.jumpTimeout);'), 'home.js must clear jumpTimeout on unmount');
  assert.ok(content.includes('this.mouseLeaveHandler = null;'), 'home.js must explicitly assign this.mouseLeaveHandler = null on unmount');
});

test('Batch C: vocab_main.js falls back to #input-expression, supports candidate keys, and outside clicks', () => {
  const vocabPath = path.join(uiDir, 'views', 'vocab_main.js');
  const content = fs.readFileSync(vocabPath, 'utf8');

  // Fallbacks to input-expression
  assert.ok(
    content.includes("document.getElementById('input-expression')?.value?.trim()"),
    'vocab_main.js must fall back to #input-expression for audio TTS or mark known'
  );

  // Candidate row Enter/Space
  assert.ok(
    content.includes("e.key === 'Enter' || e.key === ' '"),
    'vocab_main.js must handle Enter/Space on candidate autocomplete rows'
  );

  // Outside click listener
  assert.ok(
    content.includes('_outsideClickListener'),
    'vocab_main.js must track and dismiss candidate dropdown on outside click'
  );

  // rt has class font-japanese in restoreDraft
  assert.ok(
    content.includes('<rt id="hero-reading" class="font-japanese">'),
    'vocab_main.js restoreDraft must assign font-japanese class to rt'
  );
});

test('Batch C: grammar.js handles stored level check, visualizer overlap guard, and bracket furigana', () => {
  const grammarPath = path.join(uiDir, 'views', 'grammar.js');
  const content = fs.readFileSync(grammarPath, 'utf8');

  // Stored level check before univLevel fallback
  assert.ok(
    content.includes('storedLevel'),
    'grammar.js must check stored syllabus level explicitly before univLevel fallback'
  );

  // Overlap guard
  assert.ok(
    content.includes('lastIdx = Math.max(lastIdx, idx + display.length)'),
    'grammar.js must guard token visualizer slice overlap on compound grammar points'
  );

  // Bracket furigana [漢字|かんじ]
  assert.ok(
    content.includes('.replace(/\\[([^\\]|]+)\\|([^\\]]+)\\]/g'),
    'grammar.js formatExampleJapanese must support [漢字|かんじ] syntax'
  );
});

test('Batch C: test.js preserves inner span in finish button and displays notice on 0 filter matches', () => {
  const testPath = path.join(uiDir, 'views', 'test.js');
  const content = fs.readFileSync(testPath, 'utf8');

  assert.ok(
    content.includes('innerSpan') || content.includes("btnFinish.querySelector('span')"),
    'test.js confirmSubmitSection must preserve inner span when resetting button'
  );

  assert.ok(
    content.includes('showNotice('),
    'test.js must show notice/toast when format filter yields 0 matches and falls back'
  );
});

test('Batch C: settings.js has btn-toggle-key-visibility class and vocab_history guards btnSave', () => {
  const settingsPath = path.join(uiDir, 'views', 'settings.js');
  const settingsContent = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(
    settingsContent.includes('class="btn-toggle-key-visibility"'),
    'settings.js must apply btn-toggle-key-visibility class to API key visibility toggle'
  );

  const historyPath = path.join(uiDir, 'views', 'vocab_history.js');
  const historyContent = fs.readFileSync(historyPath, 'utf8');
  assert.ok(
    historyContent.includes('document.body.contains(btnSave)'),
    'vocab_history.js must guard btnSave with document.body.contains inside 1.5s timeout'
  );
});
