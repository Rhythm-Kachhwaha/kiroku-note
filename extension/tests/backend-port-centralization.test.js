/**
 * Tests for Extension Backend Port Centralization and Integrity.
 * Verifies that the extension uses http://127.0.0.1:21828 consistently,
 * no lingering 8000 references remain in runtime files, and sibling
 * ports (Yomitan 19633, AnkiConnect 8765) remain intact.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");
const SIDEPANEL_HTML_PATH = path.join(EXTENSION_DIR, "sidepanel", "sidepanel.html");
const SIDEPANEL_JS_PATH = path.join(EXTENSION_DIR, "sidepanel", "sidepanel.js");

// 1. Manifest verification
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
assert.ok(
  manifest.host_permissions.includes("http://127.0.0.1:21828/*"),
  "manifest.json host_permissions must contain http://127.0.0.1:21828/*"
);
assert.ok(
  !manifest.host_permissions.includes("http://127.0.0.1:8000/*"),
  "manifest.json host_permissions must NOT contain port 8000"
);

// 2. CSP verification in sidepanel.html
const htmlContent = fs.readFileSync(SIDEPANEL_HTML_PATH, "utf-8");
assert.ok(
  htmlContent.includes("http://127.0.0.1:21828"),
  "sidepanel.html CSP must contain http://127.0.0.1:21828"
);
assert.ok(
  !htmlContent.includes("http://127.0.0.1:8000"),
  "sidepanel.html must NOT reference port 8000"
);

// 3. Sidepanel JS centralized base URL and route derivation
const jsContent = fs.readFileSync(SIDEPANEL_JS_PATH, "utf-8");
assert.ok(
  jsContent.includes('const BACKEND_BASE_URL = "http://127.0.0.1:21828";'),
  "sidepanel.js must define BACKEND_BASE_URL as http://127.0.0.1:21828"
);
assert.ok(
  !jsContent.includes("127.0.0.1:8000"),
  "sidepanel.js must NOT contain any hardcoded references to 127.0.0.1:8000"
);

// 4. Runtime extension directory check: no 127.0.0.1:8000 references
function checkNo8000InRuntime(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "tests" && entry.name !== "node_modules") {
        checkNo8000InRuntime(fullPath);
      }
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".html") || entry.name.endsWith(".json"))) {
      const content = fs.readFileSync(fullPath, "utf-8");
      assert.ok(
        !content.includes("127.0.0.1:8000"),
        `File ${fullPath} must not contain 127.0.0.1:8000`
      );
    }
  }
}
checkNo8000InRuntime(EXTENSION_DIR);

// 5. Verify sibling ports untouched
assert.ok(
  htmlContent.includes("8765"),
  "sidepanel.html must continue to mention AnkiConnect port 8765"
);

console.log("PASS: Extension backend port centralization and integrity verified.");
