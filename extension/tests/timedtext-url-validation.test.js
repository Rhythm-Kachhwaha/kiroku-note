/**
 * Tests for isAllowedTimedtextUrl — Stage 7.3 YouTube timedtext URL validation.
 *
 * Verifies that background.js correctly allows only real YouTube/Google CDN
 * hosts and rejects malformed, private, localhost, and deceptive URLs.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

// Load background.js in a minimal mock context so module.exports works
const bgPath = fs.existsSync("extension/background.js")
  ? "extension/background.js"
  : path.resolve(__dirname, "../background.js");

const bgSrc = fs.readFileSync(bgPath, "utf8");

// Minimal browser-API stubs required for background.js to load without error
const moduleObj = { exports: {} };
const ctx = {
  chrome: {
    runtime: { onInstalled: { addListener: () => {} }, onMessage: { addListener: () => {} }, sendMessage: () => Promise.resolve(), getURL: (p) => `chrome-extension://fake/${p}`, getContexts: () => Promise.resolve([]) },
    tabs: { query: () => Promise.resolve([]), onActivated: { addListener: () => {} }, onUpdated: { addListener: () => {} }, onRemoved: { addListener: () => {} }, sendMessage: () => Promise.resolve(), captureVisibleTab: () => Promise.resolve(""), },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    offscreen: { hasDocument: () => Promise.resolve(false), createDocument: () => Promise.resolve() },
    scripting: { executeScript: () => Promise.resolve() },
    storage: { local: { set: () => {}, remove: () => {}, get: () => Promise.resolve({}) } },
    tabCapture: { getMediaStreamId: () => Promise.resolve("fake-stream") },
  },
  console,
  setTimeout,
  clearTimeout,
  Promise,
  URL,
  fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve("") }),
  module: moduleObj,
};

try {
  vm.runInNewContext(bgSrc, ctx);
} catch (e) {
  // Ignore chrome API errors from environment — we only need isAllowedTimedtextUrl
}

const isAllowedTimedtextUrl = ctx.module.exports.isAllowedTimedtextUrl;
assert.equal(typeof isAllowedTimedtextUrl, "function", "isAllowedTimedtextUrl must be exported");

console.log("Starting timedtext URL validation tests...");

// ── ALLOWED ─────────────────────────────────────────────────────────────────

assert.ok(
  isAllowedTimedtextUrl("https://www.youtube.com/api/timedtext?v=abc&lang=ja&fmt=srv3"),
  "Real YouTube timedtext URL must be allowed"
);

assert.ok(
  isAllowedTimedtextUrl("https://www.youtube.com/api/timedtext?v=abc&lang=ja&fmt=srv3&tlang=ja"),
  "Auto-translated YouTube timedtext URL must be allowed"
);

assert.ok(
  isAllowedTimedtextUrl("https://r1---sn-abc.googlevideo.com/videoplayback?something"),
  "Google video CDN URL must be allowed"
);

assert.ok(
  isAllowedTimedtextUrl("https://i.ytimg.com/vi/abc/maxresdefault.jpg"),
  "ytimg.com CDN URL must be allowed"
);

assert.ok(
  isAllowedTimedtextUrl("https://storage.googleapis.com/some-bucket/timedtext"),
  "googleapis.com URL must be allowed"
);

assert.ok(
  isAllowedTimedtextUrl("https://youtube.com/api/timedtext?v=abc"),
  "Bare youtube.com (no subdomain) must be allowed"
);

console.log("PASS: Allowed URLs accepted.");

// ── REJECTED — DECEPTIVE HOSTNAMES ──────────────────────────────────────────

assert.ok(
  !isAllowedTimedtextUrl("https://evil-youtube.com/api/timedtext"),
  "evil-youtube.com must be rejected (not a subdomain of youtube.com)"
);

assert.ok(
  !isAllowedTimedtextUrl("https://fakeyoutube.com/api/timedtext"),
  "fakeyoutube.com must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://notyoutube.com/timedtext"),
  "notyoutube.com must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://evil-googlevideo.com/video"),
  "evil-googlevideo.com must be rejected"
);

console.log("PASS: Deceptive hostnames rejected.");

// ── REJECTED — LOCALHOST / PRIVATE NETWORK ───────────────────────────────────

assert.ok(
  !isAllowedTimedtextUrl("https://localhost/timedtext"),
  "localhost must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("http://127.0.0.1:8000/api/capture"),
  "Loopback IP must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://192.168.1.1/secret"),
  "Private 192.168.x.x must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://10.0.0.1/internal"),
  "Private 10.x.x.x must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://172.16.0.1/internal"),
  "Private 172.16.x.x must be rejected"
);

console.log("PASS: Localhost and private IPs rejected.");

// ── REJECTED — ARBITRARY EXTERNAL DOMAINS ────────────────────────────────────

assert.ok(
  !isAllowedTimedtextUrl("https://attacker.example.com/payload"),
  "Arbitrary external domain must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl("https://example.com/timedtext"),
  "example.com must be rejected"
);

console.log("PASS: Arbitrary external domains rejected.");

// ── REJECTED — WRONG PROTOCOL ────────────────────────────────────────────────

assert.ok(
  !isAllowedTimedtextUrl("http://www.youtube.com/api/timedtext"),
  "Plain HTTP to youtube.com must be rejected (must be HTTPS)"
);

assert.ok(
  !isAllowedTimedtextUrl("ftp://www.youtube.com/timedtext"),
  "FTP scheme must be rejected"
);

console.log("PASS: Wrong protocols rejected.");

// ── REJECTED — MALFORMED ─────────────────────────────────────────────────────

assert.ok(
  !isAllowedTimedtextUrl("not-a-url"),
  "Malformed non-URL string must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl(""),
  "Empty string must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl(null),
  "null must be rejected"
);

assert.ok(
  !isAllowedTimedtextUrl(undefined),
  "undefined must be rejected"
);

console.log("PASS: Malformed URLs rejected.");

console.log("ALL TIMEDTEXT URL VALIDATION TESTS PASSED!");
