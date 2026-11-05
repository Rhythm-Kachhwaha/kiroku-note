const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createBootEnvironment, runSidepanelInVm } = require("./helpers/dom_boot.js");

const ROOT_DIR = path.resolve(__dirname, "../..");
const EXTENSION_DIR = path.join(ROOT_DIR, "extension");
const HTML_PATH = path.join(EXTENSION_DIR, "sidepanel", "sidepanel.html");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");

test("Test A: Parse every <script src> in sidepanel.html honoring type=module", () => {
  assert.ok(fs.existsSync(HTML_PATH), "sidepanel.html must exist");
  const html = fs.readFileSync(HTML_PATH, "utf8");

  // Regex for <script ... src="..." ...>
  const scriptRegex = /<script\b([^>]*)src=["']([^"']+)["']([^>]*)>/gi;
  let match;
  const scripts = [];
  while ((match = scriptRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const src = match[2];
    const isModule = /type=["']module["']/i.test(fullTag);
    scripts.push({ src, isModule, fullTag });
  }

  assert.ok(scripts.length > 0, "At least one script tag must be found in sidepanel.html");

  for (const script of scripts) {
    const absPath = path.resolve(path.dirname(HTML_PATH), script.src);
    assert.ok(fs.existsSync(absPath), `Script path must exist: ${absPath}`);

    const args = ["--check"];
    if (script.isModule) {
      args.push("--input-type=module");
    }
    args.push(absPath);

    const proc = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(
      proc.status,
      0,
      `Script ${script.src} (module=${script.isModule}) failed syntax check: ${proc.stderr || proc.stdout}`
    );
  }
});

test("Test B: Concat manifest content_scripts[0].js in order and parse for cross-file redeclarations", () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.ok(manifest.content_scripts && manifest.content_scripts.length > 0, "content_scripts must be declared");

  const cs = manifest.content_scripts[0];
  assert.ok(Array.isArray(cs.js), "content_scripts[0].js must be an array");

  const combinedCode = cs.js
    .map(relPath => {
      const fullPath = path.join(EXTENSION_DIR, relPath);
      assert.ok(fs.existsSync(fullPath), `Content script ${relPath} must exist`);
      return fs.readFileSync(fullPath, "utf8");
    })
    .join("\n;\n");

  // Run node --check with stdin
  const proc = spawnSync(process.execPath, ["--check"], {
    input: combinedCode,
    encoding: "utf8"
  });

  assert.equal(
    proc.status,
    0,
    `Combined content_scripts failed syntax check: ${proc.stderr || proc.stdout}`
  );
});

test("Test C: Every script path in html + manifest exists", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const scriptRegex = /<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    const fullPath = path.resolve(path.dirname(HTML_PATH), src);
    assert.ok(fs.existsSync(fullPath), `HTML script path must exist: ${src} -> ${fullPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.background?.service_worker) {
    assert.ok(
      fs.existsSync(path.join(EXTENSION_DIR, manifest.background.service_worker)),
      `background.service_worker must exist: ${manifest.background.service_worker}`
    );
  }

  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) {
      assert.ok(
        fs.existsSync(path.join(EXTENSION_DIR, js)),
        `content_script file must exist: ${js}`
      );
    }
  }
});

test("Test D: Run sidepanel.js in VM, assert no throw, toggle Text/Video tabs", async () => {
  const env = createBootEnvironment();
  assert.doesNotThrow(() => {
    runSidepanelInVm(env);
  }, "sidepanel top-level script must execute in VM without throwing");

  // Allow any initial async microtasks to settle
  await new Promise(r => setTimeout(r, 20));

  const tabBtnText = env.document.getElementById("tab-btn-text");
  const tabBtnVideo = env.document.getElementById("tab-btn-video");
  const textMiningView = env.document.getElementById("text-mining-view");
  const videoMiningView = env.document.getElementById("video-mining-view");

  assert.ok(tabBtnText, "tab-btn-text must exist");
  assert.ok(tabBtnVideo, "tab-btn-video must exist");

  // Initially, clicking tabBtnVideo should switch to video
  tabBtnVideo.click();
  await new Promise(r => setTimeout(r, 20));

  assert.equal(tabBtnVideo.classList.contains("active"), true, "tab-btn-video must have active class after click");
  assert.equal(tabBtnText.classList.contains("active"), false, "tab-btn-text must not have active class");
  assert.equal(videoMiningView.hidden, false, "videoMiningView must not be hidden when active");
  assert.equal(textMiningView.hidden, true, "textMiningView must be hidden when video active");

  // Clicking tabBtnText should switch back to text
  tabBtnText.click();
  await new Promise(r => setTimeout(r, 20));

  assert.equal(tabBtnText.classList.contains("active"), true, "tab-btn-text must have active class after click");
  assert.equal(tabBtnVideo.classList.contains("active"), false, "tab-btn-video must not have active class");
  assert.equal(textMiningView.hidden, false, "textMiningView must not be hidden when text active");
  assert.equal(videoMiningView.hidden, true, "videoMiningView must be hidden when text active");
});
