/**
 * Packaging & Manifest Verification Tests for Kiroku Note Extension V1
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const EXTENSION_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(EXTENSION_DIR, "..");
const DIST_DIR = path.join(PROJECT_ROOT, "dist", "extension");
const UNPACKED_DIR = path.join(DIST_DIR, "unpacked");
const ZIP_PATH = path.join(DIST_DIR, "KirokuNote-extension-v1.0.0.zip");

test("Source manifest.json validation", () => {
  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "manifest.json must exist in extension root");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3, "Must be Manifest V3");
  assert.equal(manifest.version, "1.0.0", "Version must be 1.0.0 for V1 release");
  assert.equal(manifest.name, "Kiroku Note", "Extension name must be 'Kiroku Note'");

  // Verify service worker
  assert.ok(manifest.background?.service_worker, "Service worker must be defined");
  const swPath = path.join(EXTENSION_DIR, manifest.background.service_worker);
  assert.ok(fs.existsSync(swPath), `Service worker ${manifest.background.service_worker} must exist`);

  // Verify sidepanel default path
  assert.ok(manifest.side_panel?.default_path, "Sidepanel default path must be defined");
  const spPath = path.join(EXTENSION_DIR, manifest.side_panel.default_path);
  assert.ok(fs.existsSync(spPath), `Sidepanel file ${manifest.side_panel.default_path} must exist`);

  // Verify content scripts
  assert.ok(Array.isArray(manifest.content_scripts), "Content scripts must be array");
  for (const cs of manifest.content_scripts) {
    assert.ok(Array.isArray(cs.js), "Content script js array must be defined");
    for (const jsFile of cs.js) {
      const fullJsPath = path.join(EXTENSION_DIR, jsFile);
      assert.ok(fs.existsSync(fullJsPath), `Content script ${jsFile} must exist`);
    }
  }
});

test("Packaged dist/extension/unpacked directory verification", () => {
  assert.ok(fs.existsSync(UNPACKED_DIR), "Unpacked distribution directory must exist");

  const manifestPath = path.join(UNPACKED_DIR, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), "Unpacked manifest.json must exist");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.version, "1.0.0");

  // Verify key runtime files exist in unpacked directory
  const requiredFiles = [
    "manifest.json",
    "background.js",
    "content/capture-utils.js",
    "content/content.js",
    "content/video-mining-poc.js",
    "content/adapters/netflix-adapter.js",
    "content/adapters/youtube-adapter.js",
    "content/adapters/youtube-bridge.js",
    "lib/image-cropper.js",
    "lib/subtitle-parser.js",
    "offscreen/audio-timeline-sync.js",
    "offscreen/offscreen.html",
    "offscreen/offscreen.js",
    "offscreen/pcm-worklet-processor.js",
    "offscreen/rolling-pcm-buffer.js",
    "offscreen/wav-encoder.js",
    "sidepanel/sidepanel.css",
    "sidepanel/sidepanel.html",
    "sidepanel/sidepanel.js",
  ];

  for (const file of requiredFiles) {
    const fullPath = path.join(UNPACKED_DIR, ...file.split("/"));
    assert.ok(fs.existsSync(fullPath), `Unpacked package missing required file: ${file}`);
  }

  // Audit that NO test files or development docs are in unpacked directory
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        assert.notEqual(entry.name, "tests", "tests directory must not be present in unpacked package");
        scanDir(fullPath);
      } else {
        assert.ok(!entry.name.endsWith(".test.js"), `Test file ${entry.name} leaked into package`);
        assert.ok(!entry.name.endsWith(".md"), `Markdown doc ${entry.name} leaked into package`);
      }
    }
  }

  scanDir(UNPACKED_DIR);
});

test("Distribution ZIP archive existence and integrity", () => {
  assert.ok(fs.existsSync(ZIP_PATH), `ZIP archive must exist at: ${ZIP_PATH}`);
  const stats = fs.statSync(ZIP_PATH);
  assert.ok(stats.size > 20000, `ZIP file size should be > 20KB, got ${stats.size} bytes`);
  assert.ok(stats.size < 500000, `ZIP file size should be < 500KB, got ${stats.size} bytes`);
});
