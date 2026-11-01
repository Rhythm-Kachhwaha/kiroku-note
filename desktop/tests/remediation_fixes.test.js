const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const uiDir = path.join(repoRoot, 'desktop', 'src', 'ui');

test('Fix 1: bottom_dock.js bypasses keys during test and study modes', () => {
  const content = fs.readFileSync(path.join(uiDir, 'shell', 'bottom_dock.js'), 'utf8');
  assert.ok(
    content.includes("this.activeTab === 'test' || this.activeTab === 'study'"),
    'bottom_dock.js must bypass key navigation in active exam or study modes'
  );
});

test('Fix 2: kanji.js uses deck_name in saveCard payload', () => {
  const content = fs.readFileSync(path.join(uiDir, 'views', 'kanji.js'), 'utf8');
  assert.ok(
    content.includes('deck_name: targetDeck') || content.includes('deck_name:'),
    'kanji.js must use deck_name parameter to match SaveCardRequest schema'
  );
  assert.equal(
    content.includes("deck: 'Japanese::Vocab'"),
    false,
    'kanji.js must not use obsolete deck parameter'
  );
});

test('Fix 3 & 5: Zero alert() or confirm() calls across all desktop UI code', () => {
  function getJsFilesRecursively(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(getJsFilesRecursively(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allUiFiles = getJsFilesRecursively(uiDir);
  const dialogRegex = /\b(alert|confirm)\s*\(/;

  for (const file of allUiFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(dialogRegex);
    assert.equal(
      match,
      null,
      `Found native blocking dialog call in ${path.relative(uiDir, file)}: ${match?.[0]}`
    );
  }
});

test('Fix 4: vocab_main.js uses valid design token CSS variables for status dots', () => {
  const content = fs.readFileSync(path.join(uiDir, 'views', 'vocab_main.js'), 'utf8');
  assert.ok(
    content.includes('var(--status-green)'),
    'vocab_main.js must use var(--status-green) for saved indicator dot'
  );
  assert.ok(
    content.includes('var(--status-red)'),
    'vocab_main.js must use var(--status-red) for error indicator dot'
  );
  assert.equal(
    content.includes('var(--green)'),
    false,
    'vocab_main.js must not reference undefined var(--green)'
  );
  assert.equal(
    content.includes('var(--red)'),
    false,
    'vocab_main.js must not reference undefined var(--red)'
  );
});

test('Fix 6: test.js supports multi-section exam progression', () => {
  const content = fs.readFileSync(path.join(uiDir, 'views', 'test.js'), 'utf8');
  assert.ok(
    content.includes('studyClient.startExamSection('),
    'test.js must call studyClient.startExamSection when transitioning between exam blocks'
  );
  assert.ok(
    content.includes('this.currentSectionIndex < this.sections.length - 1'),
    'test.js must check for remaining exam sections before completing session'
  );
});

test('Fix 7: vocab_history.js provides wired bulk sync and bulk delete actions', () => {
  const content = fs.readFileSync(path.join(uiDir, 'views', 'vocab_history.js'), 'utf8');
  assert.ok(
    content.includes('id="history-bulk-bar"'),
    'vocab_history.js must render history-bulk-bar element'
  );
  assert.ok(
    content.includes('id="btn-bulk-sync"'),
    'vocab_history.js must provide btn-bulk-sync button'
  );
  assert.ok(
    content.includes('id="btn-bulk-delete"'),
    'vocab_history.js must provide btn-bulk-delete button'
  );
  assert.ok(
    content.includes('apiClient.bulkSyncCards('),
    'vocab_history.js must invoke apiClient.bulkSyncCards with selected card IDs'
  );
  assert.ok(
    content.includes('apiClient.bulkDeleteCards('),
    'vocab_history.js must invoke apiClient.bulkDeleteCards with selected card IDs'
  );
});

test('Fix 8: shell.css guards bottom dock against compact viewport clipping', () => {
  const content = fs.readFileSync(path.join(uiDir, 'shell', 'shell.css'), 'utf8');
  assert.ok(
    content.includes('@media (max-width: 540px)'),
    'shell.css must collapse dock text labels below 540px'
  );
  assert.ok(
    content.includes('max-width: calc(100vw - 2rem)'),
    'shell.css must constrain bottom dock to viewport boundaries'
  );
});

test('Fix 9: assets_map.js synchronizes home companion mascot path', () => {
  const content = fs.readFileSync(path.join(uiDir, 'assets_map.js'), 'utf8');
  assert.ok(
    content.includes('./ui/assets/mascot/svg_cat.svg'),
    'assets_map.js home companion must point to ./ui/assets/mascot/svg_cat.svg'
  );
});

test('Fix 10: Preferences persistence is wired across views', () => {
  const vocabContent = fs.readFileSync(path.join(uiDir, 'views', 'vocab_main.js'), 'utf8');
  const kanjiContent = fs.readFileSync(path.join(uiDir, 'views', 'kanji.js'), 'utf8');
  const grammarContent = fs.readFileSync(path.join(uiDir, 'views', 'grammar.js'), 'utf8');

  assert.ok(
    vocabContent.includes("window.chrome.storage.local.set({ 'vocab.selectedDeck'"),
    'vocab_main.js must persist deck selection'
  );
  assert.ok(
    vocabContent.includes("window.chrome.storage.local.get('vocab.selectedDeck')"),
    'vocab_main.js must restore deck selection'
  );
  assert.ok(
    vocabContent.includes("window.chrome.storage.local.set({ 'vocab.imeMode'"),
    'vocab_main.js must persist IME mode'
  );
  assert.ok(
    kanjiContent.includes("window.chrome.storage.local.set({ 'kanji.activeLevel'"),
    'kanji.js must persist activeLevel'
  );
  assert.ok(
    grammarContent.includes("window.chrome.storage.local.set({ 'grammar.currentSyllabusLevel'"),
    'grammar.js must persist syllabus level'
  );
});

