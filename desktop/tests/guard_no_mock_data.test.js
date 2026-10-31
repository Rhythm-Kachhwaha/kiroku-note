import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.resolve(__dirname, '../src/ui/views');
const uiDir = path.resolve(__dirname, '../src/ui');

test('GUARD TEST: Zero forbidden mock data strings in desktop production view templates', () => {
  const forbiddenMockStrings = [
    'LV.28',
    'LV. 28',
    '7 DAY STREAK',
    '7-DAY STREAK',
    '64% MASTERY',
    '64%',
    '〜わけにはいかない',
    '昨夜の雨で庭の土が柔らかくなっている',
    '142/180',
    '142/180 (Pass)'
  ];

  const viewFiles = fs.readdirSync(viewsDir).filter(f => f.endsWith('.js'));
  assert.ok(viewFiles.length >= 8, `Expected at least 8 view files, found ${viewFiles.length}`);

  for (const file of viewFiles) {
    const fullPath = path.join(viewsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const forbidden of forbiddenMockStrings) {
      assert.ok(
        !content.includes(forbidden),
        `Found forbidden mock string "${forbidden}" in production view: ${file}`
      );
    }
  }
});

test('GUARD TEST: Zero silent catch blocks across all desktop UI code', () => {
  function getJsFilesRecursively(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
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
  assert.ok(allUiFiles.length >= 10, `Expected UI files, found ${allUiFiles.length}`);

  const silentCatchRegex = /catch\s*\([^)]*\)\s*\{\s*\}/g;

  for (const file of allUiFiles) {
    const relativePath = path.relative(uiDir, file);
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(silentCatchRegex);

    assert.equal(
      matches,
      null,
      `Found silent empty catch block in ${relativePath}: ${matches?.join(', ')}`
    );
  }
});

test('GUARD TEST: Production views attach listeners to their declared action elements', () => {
  const expectedListenersByView = {
    'home.js': [], // Home uses top chrome and bottom dock for navigation
    'vocab_main.js': ['card-mining-form', 'btn-play-audio', 'btn-toggle-known', 'btn-vocab-go-history'],
    'vocab_history.js': ['history-search-input', 'btn-sync-all-pending', 'btn-page-prev', 'btn-page-next'],
    'grammar.js': ['btn-analyze-sentence', 'sentence-input'],
    'kanji.js': ['btn-kanji-lookup', 'btn-stroke-play', 'btn-stroke-replay'],
    'study.js': ['btn-next-question'],
    'test.js': ['btn-finish-exam', 'btn-toggle-flag'],
    'settings.js': ['btn-test-anki', 'btn-toggle-ocr', 'btn-save-llm', 'btn-test-llm', 'btn-run-doctor']
  };

  for (const [filename, expectedElementIds] of Object.entries(expectedListenersByView)) {
    const fullPath = path.join(viewsDir, filename);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const elemId of expectedElementIds) {
      assert.ok(
        content.includes(`'${elemId}'`) || content.includes(`"${elemId}"`),
        `Expected view ${filename} to reference interactive element #${elemId}`
      );
      assert.ok(
        content.includes('addEventListener'),
        `Expected view ${filename} to attach event listeners`
      );
    }
  }
});
