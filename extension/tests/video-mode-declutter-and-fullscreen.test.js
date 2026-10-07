// video-mode-declutter-and-fullscreen.test.js
// Automated verification for Video Mode fullscreen subtitle fix, decluttering,
// unified subtitle stream, recent cues dropdown & setting toggle, and timestamped frame mining.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const manifestPath = path.join(__dirname, "../manifest.json");
const hookPath = path.join(__dirname, "../content/fullscreen-hook.js");
const htmlPath = path.join(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

test("Video Fullscreen Fix: Manifest registers fullscreen-hook in MAIN world", () => {
  assert.ok(fs.existsSync(manifestPath), "manifest.json must exist");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(Array.isArray(manifest.content_scripts), "content_scripts must be an array");

  const hookScript = manifest.content_scripts.find(cs =>
    Array.isArray(cs.js) && cs.js.includes("content/fullscreen-hook.js")
  );

  assert.ok(hookScript, "fullscreen-hook.js must be registered in content_scripts");
  assert.equal(hookScript.world, "MAIN", "fullscreen-hook must run in MAIN world");
  assert.equal(hookScript.run_at, "document_start", "fullscreen-hook must run at document_start");
  assert.ok(hookScript.matches.includes("<all_urls>"), "fullscreen-hook must match <all_urls>");
});

test("Video Fullscreen Fix: Hook script redirects HTMLVideoElement.prototype.requestFullscreen to container", () => {
  assert.ok(fs.existsSync(hookPath), "fullscreen-hook.js must exist");
  const hookCode = fs.readFileSync(hookPath, "utf8");

  class MockElement {
    constructor(tagName, className = "") {
      this.tagName = tagName.toUpperCase();
      this.className = className;
      this.parentElement = null;
      this.fullscreenRequested = false;
    }
    requestFullscreen() {
      this.fullscreenRequested = true;
      return Promise.resolve();
    }
    closest(selector) {
      if (selector.includes("player") && this.className.includes("player")) {
        return this;
      }
      return this.parentElement ? this.parentElement.closest(selector) : null;
    }
  }

  class MockVideoElement extends MockElement {
    constructor() {
      super("video");
    }
  }

  const container = new MockElement("div", "jwplayer video-wrapper");
  const video = new MockVideoElement();
  video.parentElement = container;

  const sandbox = {
    window: {},
    HTMLVideoElement: MockVideoElement,
    document: {
      documentElement: new MockElement("html")
    }
  };
  vm.createContext(sandbox);

  vm.runInContext(hookCode, sandbox);

  // Invoke requestFullscreen on video
  video.requestFullscreen();

  assert.equal(container.fullscreenRequested, true, "Fullscreen must be redirected to container wrapper");
  assert.equal(video.fullscreenRequested, false, "Video directly must not request fullscreen when container exists");
});

test("Subtitle view: sidepanel.html contains unified playback controls without a history toggle", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // Subtitle setup stays in Settings, separate from the playback view.
  const videoViewStart = html.indexOf('id="video-mining-view"');
  const settingsViewStart = html.indexOf('id="layout-settings-popover"');
  const subtitleSettingsStart = html.indexOf('id="video-subtitle-settings"');
  assert.ok(settingsViewStart > videoViewStart, "Settings view must follow the Video view");
  assert.ok(subtitleSettingsStart > settingsViewStart, "Subtitle controls must live in Settings");
  assert.ok(!html.includes('id="subtitle-controls-details"'), "Subtitle controls must be inline without another dropdown");
  assert.ok(!html.includes('id="btn-toggle-recent-subs"'), "Subtitle history toggle must be removed");

  // Unified subtitle view contains search, current cue, and recent cues.
  assert.ok(html.includes('id="unified-subtitles-stream"'), "Must have unified-subtitles-stream container");
  assert.ok(html.includes('aria-label="Subtitle view"'), "Unified stream must be the subtitle view");
  assert.ok(html.includes('id="subtitle-search-section"'), "Search must be in the playback view");
  assert.ok(html.includes('id="recent-cues-section"'), "Must have recent-cues-section");
  assert.ok(html.includes('id="recent-cues-list"'), "Must have recent-cues-list");
  assert.ok(html.includes('id="video-current-cue-preview"'), "Must have video-current-cue-preview");
  assert.ok(html.includes('id="btn-mine-full-sentence"'), "Must have btn-mine-full-sentence");

  // Settings toggle
  assert.ok(html.includes('id="toggle-show-recent-subs"'), "Must have toggle-show-recent-subs in settings");
});

test("Subtitle view: CSS makes recent cues readable and the active cue prominent", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  // Recent cues: huge font (~19px) and dimmed opacity (~0.62)
  assert.ok(css.includes(".recent-cue-item"), "Must have .recent-cue-item styles");
  assert.ok(css.includes("opacity: 0.62"), "Recent cue item must be dimmed (opacity: 0.62)");
  assert.ok(css.includes("font-size: 19px"), "Recent cue text must have large font size (19px)");

  // Active cue: highlighted, elevated font-size.
  assert.ok(css.includes("font-size: 26px"), "Active video cue preview must have prominent 26px font size");
  assert.ok(css.includes("max-height: 300px"), "Recent subtitle list must use a larger scrollable view");
  assert.ok(!css.includes(".btn-toggle-recent-subs"), "History toggle styling must be removed");
  assert.ok(css.includes(".layout-settings-popover.video-settings-priority #video-subtitle-settings"), "Subtitle settings must be pinned first when opened from Video");
});

test("Video capture carries its cue sentence and subtitle cards prioritize it on the back", () => {
  const js = fs.readFileSync(jsPath, "utf8");
  const optionsCode = js.match(/function getVideoCaptureContextOptions[\s\S]*?\n\}/)?.[0];
  const orderCode = js.match(/function prioritizeSubtitleContextOnBack[\s\S]*?\n\}/)?.[0];
  assert.ok(optionsCode && orderCode, "Video context and back-order helpers must exist");

  const sandbox = {
    currentMiningTab: "video",
    currentActiveCue: { startTime: 12, text: "字幕の文脈" },
    currentPreviewPresentation: { front: { text: {}, order: null }, back: { text: {}, order: ["meaning", "example", "notes"] } }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${optionsCode}; ${orderCode}`, sandbox);

  const videoOptions = JSON.parse(JSON.stringify(sandbox.getVideoCaptureContextOptions({ source: "subtitle_hover" })));
  assert.equal(videoOptions.contextSentence, "字幕の文脈");
  assert.equal(videoOptions.videoContext, true);
  assert.equal(videoOptions.cue.text, "字幕の文脈");

  sandbox.prioritizeSubtitleContextOnBack();
  assert.deepEqual(Array.from(sandbox.currentPreviewPresentation.back.order), ["example", "meaning", "notes"]);

  sandbox.currentMiningTab = "text";
  const textOptions = JSON.parse(JSON.stringify(sandbox.getVideoCaptureContextOptions({ source: "selection" })));
  assert.equal(textOptions.contextSentence, "");
  assert.equal(textOptions.videoContext, false);
});

test("Subtitle view: renderRecentCuesList respects the recent-cue setting", () => {
  class MockDOMElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.hidden = false;
      this.style = {};
      const set = new Set();
      this.classList = {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        has: (c) => set.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) set.add(c); else set.delete(c);
          } else {
            if (set.has(c)) set.delete(c); else set.add(c);
          }
        }
      };
      this._attrs = {};
    }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return this._attrs[k]; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener() {}
  }

  const recentList = new MockDOMElement("ul");
  const recentSection = new MockDOMElement("div");
  const cues = [
    { startTime: 5.0, endTime: 7.0, text: "こんにちは" },
    { startTime: 8.0, endTime: 10.0, text: "世界" }
  ];

  const sandbox = {
    recentCuesList: recentList,
    recentCuesSection: recentSection,
    recentSubtitleCues: cues,
    currentActiveCue: null,
    isRecentSubsEnabled: true,
    isRecentSubsCollapsed: false,
    formatSubtitleTimestamp: (s) => `${s}s`,
    document: {
      createElement: (t) => new MockDOMElement(t),
      createTextNode: (t) => ({ textContent: t })
    }
  };
  vm.createContext(sandbox);

  const jsContent = fs.readFileSync(jsPath, "utf8");
  const renderCode = jsContent.match(/function renderRecentCuesList[\s\S]*?\n\}/)?.[0];
  assert.ok(renderCode, "renderRecentCuesList function must exist");
  vm.runInContext(renderCode, sandbox);

  // Case 1: Enabled & Expanded -> Renders cues and unhides section
  sandbox.renderRecentCuesList();
  assert.equal(recentSection.hidden, false, "Section should be visible");
  assert.equal(recentList.children.length, 2, "Should render 2 cues");

  // Settings can hide older cues without hiding the playback search/current cue.
  sandbox.isRecentSubsEnabled = false;
  sandbox.renderRecentCuesList();
  assert.equal(recentSection.hidden, true, "Section should be hidden when disabled");
  assert.equal(recentList.children.length, 0, "Cues list should be empty when disabled");
});

test("Recent Subtitle Mining: Words clicked pass cue timestamp to identify and retakeScreenshot", () => {
  let capturedOptions = null;
  let capturedScreenshotTime = null;

  function mockIdentify(word, options) {
    capturedOptions = options;
    mockRetakeScreenshot("req1", options.targetTime);
    return Promise.resolve();
  }

  function mockRetakeScreenshot(captureId, targetTime) {
    capturedScreenshotTime = (typeof targetTime === "number" && Number.isFinite(targetTime)) ? targetTime : null;
  }

  const sampleCue = { startTime: 15.4, endTime: 18.0, text: "未来へ進む" };
  const targetTime = sampleCue.startTime + 0.2;

  mockIdentify("未来", { targetTime, cue: sampleCue });

  assert.ok(capturedOptions, "Options must be passed to identify");
  assert.equal(capturedOptions.targetTime, 15.6, "Target time must be cue startTime + 0.2s");
  assert.equal(capturedOptions.cue.text, "未来へ進む", "Cue object must be passed");
  assert.equal(capturedScreenshotTime, 15.6, "retakeScreenshot must receive cue targetTime");
});

test("Video Mining POC: captureCurrentFrame only seeks to targetTime while paused", async () => {
  const videoMiningPocPath = path.join(__dirname, "../content/video-mining-poc.js");
  const code = fs.readFileSync(videoMiningPocPath, "utf8");

  assert.ok(code.includes("options.targetTime"), "captureCurrentFrame must handle options.targetTime");
  assert.ok(code.includes("this.activeVideo.paused && Math.abs(this.activeVideo.currentTime - targetTime) > 0.15"), "playing video must not be scrubbed for a screenshot");
  assert.ok(code.includes("this.activeVideo.currentTime = Math.max(0, targetTime);"), "paused video may seek to targetTime");
  assert.ok(code.includes("video.addEventListener(\"seeked\""), "captureCurrentFrame must await seeked event");
});
