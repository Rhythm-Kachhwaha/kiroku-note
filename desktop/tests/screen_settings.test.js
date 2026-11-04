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

test('Settings View: Slice 24 Left rail in-page anchor navigation', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  // Left rail navigation exists with required sections
  assert.ok(content.includes('id="settings-nav-rail"'), 'SettingsView must render left rail navigation');
  assert.ok(content.includes('data-target="settings-section-level"'), 'SettingsView rail must include Level');
  assert.ok(content.includes('data-target="settings-section-dictionary-anki"'), 'SettingsView rail must include Dictionary & Anki');
  assert.ok(content.includes('data-target="settings-section-language-engine"'), 'SettingsView rail must include Language engine');
  assert.ok(content.includes('data-target="settings-section-link"'), 'SettingsView rail must include Link');
  assert.ok(content.includes('data-target="settings-section-rewards"'), 'SettingsView rail must include Rewards');
  assert.ok(content.includes('data-target="settings-section-diagnostics"'), 'SettingsView rail must include Diagnostics');

  // Link & Rewards render coming empty status
  assert.ok(content.includes('Coming in Slice 38'), 'Link section must show coming status');
  assert.ok(content.includes('Coming in Slice 33'), 'Rewards section must show coming status');
});

test('Settings View: Slice 24 Language engine card with tokenizer & dictionary status', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(content.includes('id="settings-language-engine-card"'), 'SettingsView must render language engine card');
  assert.ok(content.includes('id="select-tokenizer-mode"'), 'SettingsView must render tokenizer mode selector');
  assert.ok(content.includes('id="tokenizer-dict-display"'), 'SettingsView must render tokenizer dictionary display');
  assert.ok(content.includes('id="tokenizer-status-tag"'), 'SettingsView must render tokenizer status tag');
  assert.ok(content.includes('apiClient.getHealth('), 'SettingsView must query apiClient.getHealth for engine state');
  assert.ok(content.includes('loadTokenizerStatus('), 'SettingsView must implement loadTokenizerStatus');
});

test('Settings View: Slice 24 Yomitan card collapsed in legacy dictionary section', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(content.includes('id="settings-legacy-yomitan-details"'), 'SettingsView must render collapsed legacy Yomitan details');
  assert.ok(content.includes('Legacy dictionary provider'), 'SettingsView must label Yomitan as legacy dictionary provider');
  assert.ok(content.includes('id="yomitan-status-tag"'), 'SettingsView must maintain yomitan-status-tag inside legacy section');
});

test('Settings View: Upload Questions PDF ingestion card resides in settings', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(content.includes('id="settings-upload-questions-card"'), 'SettingsView must include Upload Questions card');
  assert.ok(content.includes('id="settings-upload-questions-mount"'), 'SettingsView must mount Upload Questions component');
  assert.ok(content.includes('renderStudyImport(uploadMount)'), 'SettingsView must call renderStudyImport');
});
