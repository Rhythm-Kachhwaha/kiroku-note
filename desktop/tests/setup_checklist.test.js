const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const settingsViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'settings.js');
const sidepanelJsPath = path.join(repoRoot, 'extension', 'sidepanel', 'sidepanel.js');

test('Settings View: Includes Setup Checklist section and navigation anchor', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes('id="settings-section-checklist"'),
    'SettingsView must render #settings-section-checklist section'
  );
  assert.ok(
    content.includes('data-target="settings-section-checklist"'),
    'SettingsView must render checklist left rail anchor link'
  );
  assert.ok(
    content.includes('id="setup-checklist-items"'),
    'SettingsView must render #setup-checklist-items container'
  );
  assert.ok(
    content.includes('id="btn-refresh-checklist"'),
    'SettingsView must render #btn-refresh-checklist button'
  );
});

test('Settings View: Wires /api/setup/checklist fetching and action buttons', () => {
  const content = fs.readFileSync(settingsViewPath, 'utf8');

  assert.ok(
    content.includes("apiClient.request('/api/setup/checklist')"),
    'SettingsView must call /api/setup/checklist via apiClient'
  );
  assert.ok(
    content.includes('loadSetupChecklist('),
    'SettingsView must implement loadSetupChecklist method'
  );
  assert.ok(
    content.includes('handleCopyPairingCode('),
    'SettingsView must implement handleCopyPairingCode method'
  );
  assert.ok(
    content.includes('provision_dictionary'),
    'SettingsView must handle provision_dictionary fix action'
  );
  assert.ok(
    content.includes('copy_pairing_code'),
    'SettingsView must handle copy_pairing_code fix action'
  );
});

test('Extension Sidepanel: Defines setup checklist check and banner trigger', () => {
  const content = fs.readFileSync(sidepanelJsPath, 'utf8');

  assert.ok(
    content.includes('/api/setup/checklist'),
    'Extension sidepanel.js must reference /api/setup/checklist'
  );
  assert.ok(
    content.includes('checkSetupChecklist'),
    'Extension sidepanel.js must implement checkSetupChecklist'
  );
  assert.ok(
    content.includes('setup-failure'),
    'Extension sidepanel.js must surface setup failure via banner'
  );
});
