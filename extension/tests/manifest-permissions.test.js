const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../..");

test("T8: Manifest permissions contract covers all chrome.<api> calls in runtime extension files", () => {
  const manifestPath = path.join(ROOT_DIR, "extension", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const granted = new Set([
    ...(manifest.permissions || []),
    ...(manifest.optional_permissions || [])
  ]);

  // APIs built into Chrome or standard extension namespaces that do not require explicit permissions
  const builtins = new Set([
    "runtime",
    "extension",
    "windows", // window management in background/action
    "action",  // chrome.action is granted by 'action' manifest key
    "commands" // chrome.commands is granted by 'commands' manifest key
  ]);

  const runtimeFiles = [
    "extension/background.js",
    "extension/sidepanel/sidepanel.js",
    "extension/content/content.js",
    "extension/content/video-mining.js",
    "extension/content/link-bridge.js",
    "extension/link/link-client.js",
    "extension/link/clip.js"
  ];

  const apiRegex = /chrome\.([a-zA-Z0-9_]+)/g;
  const missing = new Set();

  for (const rel of runtimeFiles) {
    const fullPath = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    let match;
    while ((match = apiRegex.exec(content)) !== null) {
      const api = match[1];
      if (builtins.has(api)) continue;
      if (!granted.has(api)) {
        missing.add(api);
      }
    }
  }

  // Expect 'storage' and 'alarms' to be present.
  assert.equal(
    missing.has("storage"),
    false,
    `chrome.storage is used in extension runtime but missing in manifest.json permissions: ${Array.from(missing).join(", ")}`
  );
  assert.equal(
    missing.has("alarms"),
    false,
    `chrome.alarms is needed for background link keep-alive alarms but missing in manifest.json permissions`
  );
});

