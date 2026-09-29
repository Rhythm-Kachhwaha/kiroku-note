const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const HTML_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.html");
const CSS_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.css");
const JS_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.js");

test("Tier 2 Session 2: T2-G Unified health check endpoint and handler", () => {
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(js.includes('API_HEALTH_URL'), "sidepanel.js must define API_HEALTH_URL");
  assert.ok(js.includes('/api/health'), "sidepanel.js must point to /api/health");
  assert.ok(js.includes('async function checkHealthStatus'), "sidepanel.js must define checkHealthStatus");
  assert.ok(js.includes('checkHealthStatus().catch'), "startup sequence must invoke checkHealthStatus()");
});

test("Tier 2 Session 2: T2-F History CSV Export button and handler", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(html.includes('id="btn-export-cards"'), "sidepanel.html must include #btn-export-cards");
  assert.ok(html.includes('Export CSV'), "sidepanel.html must have Export CSV label");
  assert.ok(css.includes('.btn-export-cards'), "sidepanel.css must style .btn-export-cards");
  assert.ok(js.includes('async function exportCardsCsv'), "sidepanel.js must define exportCardsCsv");
  assert.ok(js.includes('/export'), "sidepanel.js export must call /api/cards/export");
  assert.ok(js.includes('createObjectURL'), "exportCardsCsv must trigger download with createObjectURL");
});

test("Tier 2 Session 2: T2-C Verb metadata toggle & Anki Back preview", () => {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  assert.ok(html.includes('id="setting-show-verb-type"'), "sidepanel.html must include #setting-show-verb-type toggle");
  assert.ok(html.includes('Show Verb Type'), "sidepanel.html must have 'Show Verb Type' label");

  assert.ok(js.includes('show_verb_type: true'), "DEFAULT_CARD_TEMPLATE_SETTINGS must include show_verb_type: true");
  assert.ok(js.includes('settingShowVerbType'), "sidepanel.js must bind settingShowVerbType");
  assert.ok(js.includes('kn-verb-type'), "sidepanel.js preview must render kn-verb-type");
  assert.ok(js.includes('kn-transitivity'), "sidepanel.js preview must render kn-transitivity");
});

test("Tier 2 Session 2: T2-K POS tag priority and dictionary view declutter classes", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");
  const js = fs.readFileSync(JS_PATH, "utf8");

  // CSS Declutter rules
  assert.ok(css.includes('.dict-sense-tags .kn-pos'), "sidepanel.css must style .dict-sense-tags .kn-pos");
  assert.ok(css.includes('.dict-sense-gloss-list li'), "sidepanel.css must tighten .dict-sense-gloss-list li");
  assert.ok(css.includes('.dict-extra-dicts-badge'), "sidepanel.css must style .dict-extra-dicts-badge");

  // JS Class applications
  assert.ok(js.includes('dict-sense-tags'), "sidepanel.js must apply dict-sense-tags class");
  assert.ok(js.includes('dict-extra-dicts-badge'), "sidepanel.js must apply dict-extra-dicts-badge class");

  // POS priority logic (noun > adverb > verb > aux)
  assert.ok(js.includes('isNoun'), "updateHeroBadges must check noun priority");
  assert.ok(js.includes('isAdverb'), "updateHeroBadges must check adverb priority");
  assert.ok(js.includes('noun · suru'), "updateHeroBadges must render 'noun · suru' when noun has suru verb");
});
