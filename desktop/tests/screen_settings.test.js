const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const settingsViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'settings.js');

test('Settings View: No silent catch blocks in production controller', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    !content.includes('catch (_) {}'),
    'SettingsView must not contain empty silent catch blocks'
  );
  assert.ok(
    content.includes('settings-error-banner'),
    'SettingsView must include visible settings-error-banner element'
  );
  assert.ok(
    content.includes('showError('),
    'SettingsView must implement visible showError method'
  );
});

test('Settings View: Wires AnkiConnect status test via apiClient.getAnkiStatus', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getAnkiStatus('),
    'SettingsView must call apiClient.getAnkiStatus to test AnkiConnect'
  );
  assert.ok(
    content.includes('btn-test-anki'),
    'SettingsView must attach click listener to btn-test-anki'
  );
  assert.ok(
    content.includes('anki-status-tag'),
    'SettingsView must update anki-status-tag badge'
  );
});

test('Settings View: Configurable Anki mining deck selector via apiClient.getAnkiDecks', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getAnkiDecks('),
    'SettingsView must call apiClient.getAnkiDecks to load live decks'
  );
  assert.ok(
    content.includes('select-settings-deck'),
    'SettingsView must render select-settings-deck element'
  );
  assert.ok(
    content.includes('anki_deck') || content.includes('vocab.selectedDeck'),
    'SettingsView must persist selected deck preference'
  );
});

test('Settings View: Wires OCR daemon lifecycle via apiClient.startOcr and stopOcr', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getOcrStatus('),
    'SettingsView must check initial OCR status on mount'
  );
  assert.ok(
    content.includes('apiClient.startOcr('),
    'SettingsView must call apiClient.startOcr when starting daemon'
  );
  assert.ok(
    content.includes('apiClient.stopOcr('),
    'SettingsView must call apiClient.stopOcr when stopping daemon'
  );
});

test('Settings View: Wires LLM config loading, saving and latency testing', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getLlmConfig('),
    'SettingsView must fetch current LLM configuration on mount'
  );
  assert.ok(
    content.includes('apiClient.updateLlmConfig('),
    'SettingsView must call apiClient.updateLlmConfig on save'
  );
  assert.ok(
    content.includes('apiClient.testLlm('),
    'SettingsView must call apiClient.testLlm when testing connection latency'
  );
  assert.ok(
    content.includes('btn-save-llm'),
    'SettingsView must attach click listener to btn-save-llm'
  );
  assert.ok(
    content.includes('btn-test-llm'),
    'SettingsView must attach click listener to btn-test-llm'
  );
});

test('Settings View: Wires Doctor diagnostics and desktop supervisor controls', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('studyClient.getDiagnostics('),
    'SettingsView must call studyClient.getDiagnostics on doctor check'
  );
  assert.ok(
    content.includes('window.desktopAPI?.openUserDataFolder'),
    'SettingsView must bridge to openUserDataFolder'
  );
  assert.ok(
    content.includes('window.desktopAPI?.retryBackend'),
    'SettingsView must bridge to retryBackend'
  );
});

