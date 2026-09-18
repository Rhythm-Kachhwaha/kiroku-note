const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backgroundPath = path.join(__dirname, "../background.js");
const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const sidepanelHtml = fs.readFileSync(htmlPath, "utf-8");
const sidepanelCss = fs.readFileSync(cssPath, "utf-8");
const backgroundJs = fs.readFileSync(backgroundPath, "utf-8");

const vm = require("node:vm");

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

vm.createContext(ctx);
vm.runInContext(backgroundJs, ctx);
const isAllowedJimakuUrl = moduleObj.exports.isAllowedJimakuUrl || ctx.isAllowedJimakuUrl;

const SubtitleParser = require("../lib/subtitle-parser.js");
const { JimakuSubtitleProvider, resolveJimakuUrl } = require("../lib/jimaku-provider.js");

test("Jimaku URL security and download path validation in background.js", () => {
  // Relative URLs should be resolved against jimaku.cc and permitted
  assert.equal(isAllowedJimakuUrl("/api/entries/search?query=frieren"), true);
  assert.equal(isAllowedJimakuUrl("/files/101/download"), true);
  assert.equal(isAllowedJimakuUrl("/api/entries/42/files/101"), true);

  // Absolute Jimaku HTTPS URLs
  assert.equal(isAllowedJimakuUrl("https://jimaku.cc/api/entries/42"), true);
  assert.equal(isAllowedJimakuUrl("https://jimaku.cc/files/42/download"), true);
  assert.equal(isAllowedJimakuUrl("https://files.jimaku.cc/subtitles/42.ass"), true);

  // Public HTTPS CDN/storage links for subtitles
  assert.equal(isAllowedJimakuUrl("https://r2.jimaku.cc/files/42.ass"), true);
  assert.equal(isAllowedJimakuUrl("https://subtitles-cdn.example.com/ep1.ass"), true);

  // SSRF loopback & private IP blocking
  assert.equal(isAllowedJimakuUrl("http://localhost:8000/hack"), false, "Must block localhost http");
  assert.equal(isAllowedJimakuUrl("https://localhost:8000/hack"), false, "Must block localhost https");
  assert.equal(isAllowedJimakuUrl("https://127.0.0.1:21828/api/cards"), false, "Must block 127.0.0.1");
  assert.equal(isAllowedJimakuUrl("https://192.168.1.1/secret"), false, "Must block 192.168.x.x");
  assert.equal(isAllowedJimakuUrl("https://10.0.0.1/admin"), false, "Must block 10.x.x.x");
  assert.equal(isAllowedJimakuUrl("https://172.16.0.1/status"), false, "Must block 172.16-31.x.x");
  assert.equal(isAllowedJimakuUrl("https://169.254.169.254/latest/meta-data"), false, "Must block link-local IP");
  assert.equal(isAllowedJimakuUrl("invalid-url-string-%%%"), false, "Must reject invalid URLs");
});

test("Sidepanel UI - Subtitle Folder selector and Jimaku download folder configuration elements exist", () => {
  assert.ok(sidepanelHtml.includes('id="btn-select-subtitles-folder"'), "Must include Folder button");
  assert.ok(sidepanelHtml.includes('id="subtitles-dir-input"'), "Must include directory input");
  assert.ok(sidepanelHtml.includes('id="subtitle-folder-bar"'), "Must include subtitle-folder-bar");
  assert.ok(sidepanelHtml.includes('id="folder-subtitles-select"'), "Must include folder-subtitles-select dropdown");
  assert.ok(sidepanelHtml.includes('id="jimaku-download-folder-input"'), "Must include Jimaku download folder input");
  assert.ok(sidepanelHtml.includes('id="toggle-save-subtitle-disk"'), "Must include auto-save toggle checkbox");
});

test("Sidepanel CSS - Styles for Subtitle Folder toolbar and select elements exist", () => {
  assert.ok(sidepanelCss.includes(".btn-subtitles-folder"), "Must style folder button");
  assert.ok(sidepanelCss.includes(".subtitle-folder-bar"), "Must style subtitle folder bar");
  assert.ok(sidepanelCss.includes(".folder-subtitles-select"), "Must style folder subtitle select");
  assert.ok(sidepanelCss.includes(".jimaku-download-path-section"), "Must style Jimaku download path section");
});

test("JimakuSubtitleProvider - Full end-to-end download flow with relative URL and cue extraction", async () => {
  const provider = new JimakuSubtitleProvider({
    parser: SubtitleParser,
    fetchFunction: async ({ url, apiKey }) => {
      assert.equal(apiKey, "auth_token_999");
      assert.equal(url, "https://jimaku.cc/files/500/download");
      return {
        ok: true,
        isJson: false,
        text: `WEBVTT

00:00:02.000 --> 00:00:05.500
魔法を使って冒険を続けよう。
`
      };
    }
  });

  provider.setApiKey("auth_token_999");
  const subData = await provider.downloadSubtitle("/files/500/download", "Frieren_Ep01.vtt");

  assert.equal(subData.source, "jimaku_search");
  assert.equal(subData.format, "vtt");
  assert.equal(subData.filename, "Frieren_Ep01.vtt");
  assert.equal(subData.cues.length, 1);
  assert.equal(subData.cues[0].text, "魔法を使って冒険を続けよう。");
  assert.ok(subData.rawText.includes("WEBVTT"));
});
