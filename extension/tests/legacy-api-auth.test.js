const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('R7 extension pairing keeps its token session-only and attaches it to local API calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel', 'sidepanel.js'), 'utf8');
  assert.match(source, /chrome\.storage\.session/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.set\([^\n]*session_token/);
  assert.match(source, /extension-pairings\/redeem/);
  assert.match(source, /headers\.set\("Authorization", `Bearer \$\{extensionAuthToken\}`\)/);
});
