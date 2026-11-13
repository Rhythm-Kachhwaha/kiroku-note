import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vocabInvPath = path.resolve(__dirname, '../src/ui/views/vocab/vocab_inventory.js');

test('Vocab Inventory: View module exists and exports VocabInventoryComponent', () => {
  assert.ok(fs.existsSync(vocabInvPath), 'vocab_inventory.js must exist on disk');
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  assert.ok(content.includes('export class VocabInventoryComponent'), 'Must export VocabInventoryComponent class');
});

test('Vocab Inventory: Renders telemetry metrics grid with 5 pods', () => {
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  assert.ok(content.includes('inv-metric-total'), 'Must render total tracked metric pod');
  assert.ok(content.includes('inv-metric-known'), 'Must render known words metric pod');
  assert.ok(content.includes('inv-metric-learning'), 'Must render learning words metric pod');
  assert.ok(content.includes('inv-metric-unseen'), 'Must render unseen gaps metric pod');
  assert.ok(content.includes('inv-metric-filtered'), 'Must render filtered total metric pod');
});

test('Vocab Inventory: Filters row includes level, status, category, and debounced search', () => {
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  assert.ok(content.includes('id="inv-search-input"'), 'Must have search input element');
  assert.ok(content.includes('inv-level-pill'), 'Must render JLPT level filter pills');
  assert.ok(content.includes('inv-state-pill'), 'Must render state filter pills');
  assert.ok(content.includes('id="inv-select-category"'), 'Must render category selector');
});

test('Vocab Inventory: Multi-select floating bulk action bar and actions', () => {
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  assert.ok(content.includes('id="inv-bulk-bar"'), 'Must render floating bulk bar container');
  assert.ok(content.includes('id="btn-bulk-known"'), 'Must have bulk mark known button');
  assert.ok(content.includes('id="btn-bulk-learning"'), 'Must have bulk mark learning button');
  assert.ok(content.includes('id="btn-bulk-ignored"'), 'Must have bulk mark ignored button');
  assert.ok(content.includes('id="btn-bulk-study"'), 'Must have bulk study selected button');
  assert.ok(content.includes('id="btn-inv-study-these"'), 'Must have Study these action button');
  assert.ok(content.includes('apiClient.bulkSetWordStates('), 'Must wire bulkSetWordStates to API');
});

test('Vocab Inventory: Slide-over inspector drawer with status controls and practice action', () => {
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  assert.ok(content.includes('id="inv-drawer"'), 'Must render slide-over drawer');
  assert.ok(content.includes('id="inv-drawer-backdrop"'), 'Must render drawer backdrop');
  assert.ok(content.includes('openDrawer('), 'Must implement openDrawer method');
  assert.ok(content.includes('closeDrawer('), 'Must implement closeDrawer method');
  assert.ok(content.includes('btn-drawer-practice-word'), 'Must provide practice word action in drawer');
});

test('Vocab Inventory: Zero emojis across code and templates', () => {
  const content = fs.readFileSync(vocabInvPath, 'utf8');
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.ok(!emojiRegex.test(content), 'Zero emojis allowed in vocab inventory component');
});
