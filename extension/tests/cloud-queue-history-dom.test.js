const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

test('Sidepanel HTML: sync-progress-modal must be closed before history-source-subnav', () => {
  const html = fs.readFileSync('extension/sidepanel/sidepanel.html', 'utf8');
  const modalStart = html.indexOf('id="sync-progress-modal"');
  assert.ok(modalStart > 0, 'sync-progress-modal exists');

  const btnDismiss = html.indexOf('id="btn-dismiss-sync-modal"');
  assert.ok(btnDismiss > modalStart, 'btn-dismiss-sync-modal exists inside modal');

  const modalEnd = html.indexOf('</div>', btnDismiss);
  const subnav = html.indexOf('class="history-source-subnav"');
  const cardsList = html.indexOf('id="history-cards-list"');

  assert.ok(modalEnd > 0, 'modal has closing tag');
  assert.ok(subnav > 0, 'history-source-subnav exists');
  assert.ok(cardsList > 0, 'history-cards-list exists');

  assert.ok(modalEnd < subnav, 'Modal closing tag must come BEFORE history-source-subnav');
  assert.ok(subnav < cardsList, 'history-source-subnav must come BEFORE history-cards-list');
});

test('Sidepanel JS: setHistorySourceFilter calls loadHistory and exports functions correctly', () => {
  const js = fs.readFileSync('extension/sidepanel/sidepanel.js', 'utf8');
  assert.ok(!js.includes('loadHistoryCards()'), 'No undefined loadHistoryCards calls in sidepanel.js');
  assert.ok(js.includes('loadHistory()'), 'loadHistory is used');
  assert.ok(js.includes('currentHistorySource'), 'currentHistorySource is defined');
  assert.ok(js.includes('const historyCardsList = document.querySelector("#history-cards-list");'), 'historyCardsList must be declared with querySelector');
});

test('Sidepanel UI: Cloud subnav and card badges use vector SVG icons rather than emojis', () => {
  const html = fs.readFileSync('extension/sidepanel/sidepanel.html', 'utf8');
  assert.ok(!html.includes('☁️ Cloud'), 'No raw cloud emoji in subnav HTML');
  assert.ok(html.includes('icon-cloud'), 'Cloud subnav has SVG icon with icon-cloud class');

  const js = fs.readFileSync('extension/sidepanel/sidepanel.js', 'utf8');
  assert.ok(!js.includes('icon = "☁️"'), 'No raw cloud emoji in history card source badges');
  assert.ok(!js.includes('icon = "⚡"'), 'No raw lightning emoji in history card source badges');
});

test('Sidepanel UI: Cloud queue refresh button uses vector SVG icon and connects to cloud pull', () => {
  const html = fs.readFileSync('extension/sidepanel/sidepanel.html', 'utf8');
  assert.ok(html.includes('id="btn-refresh-cloud-queue"'), 'btn-refresh-cloud-queue exists in sidepanel.html');
  assert.ok(html.includes('class="icon-refresh"'), 'Refresh button uses SVG icon with icon-refresh class');
  assert.ok(!html.includes('🔄'), 'No raw reload emoji used');

  const js = fs.readFileSync('extension/sidepanel/sidepanel.js', 'utf8');
  assert.ok(js.includes('btnRefreshCloudQueue'), 'btnRefreshCloudQueue element is queried in JS');
  assert.ok(js.includes('/api/cloud/pull'), 'Calls /api/cloud/pull endpoint');
});

