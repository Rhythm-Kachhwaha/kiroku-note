/**
 * Tests for HudHost (Shadow host, WeakMap tracking, reposition, teardown)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    contains(child) {
      if (!child) return false;
      if (child === this) return true;
      let p = child.parentElement;
      while (p) {
        if (p === this) return true;
        p = p.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { top: 100, left: 50, width: 800, height: 450 };
    },
    attachShadow() {
      const shadow = createMockElement("shadow-root");
      this.shadowRoot = shadow;
      return shadow;
    }
  };
}

// Set up mock DOM globals
global.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  fullscreenElement: null
};
global.window = {
  scrollY: 0,
  scrollX: 0,
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ position: "relative" })
};

const { HudHost, getHudHostForVideo } = require("../content/hud/hud-host.js");

test("HudHost attaches one shadow host per video via WeakMap", () => {
  const video1 = createMockElement("video");
  const parent1 = createMockElement("div");
  parent1.appendChild(video1);
  global.document.body.appendChild(parent1);

  const host1 = getHudHostForVideo(video1);
  assert.ok(host1);
  const host1Again = getHudHostForVideo(video1);
  assert.equal(host1, host1Again, "Must return the same HudHost for the same video");

  const video2 = createMockElement("video");
  const host2 = getHudHostForVideo(video2);
  assert.notEqual(host1, host2, "Must create separate hosts for different videos");

  assert.equal(global.window.__kirokuHud, host2);

  // Teardown
  host1.destroy();
  host2.destroy();
  assert.equal(global.window.__kirokuHud, null);
});

test("HudHost registers cleanups and runs them on destroy", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  let cleanupRan = false;
  host.registerCleanup(() => {
    cleanupRan = true;
  });

  host.destroy();
  assert.equal(cleanupRan, true, "Registered cleanups must execute on destroy");
  assert.equal(host.video, null);
  assert.equal(host.hostEl, null);
});

test("HudHost handleSpaNavigation destroys host when video is disconnected", () => {
  const video = createMockElement("video");
  video.isConnected = false;
  const host = new HudHost(video);

  assert.ok(host.hostEl);
  host.handleSpaNavigation();
  assert.equal(host.video, null, "Disconnected video must destroy host on SPA navigation");
  assert.equal(host.hostEl, null);
});

test("HudHost handleFullscreenChange does not append inside video element", () => {
  const parent = createMockElement("div");
  const video = createMockElement("video");
  parent.appendChild(video);
  global.document.body.appendChild(parent);

  const host = new HudHost(video);
  global.document.fullscreenElement = video; // Video element itself is fullscreen
  host.handleFullscreenChange();

  assert.equal(video.children.includes(host.hostEl), false, "Must not append hostEl directly inside video element");
  assert.ok(parent.children.includes(host.hostEl) || global.document.body.children.includes(host.hostEl));
  host.destroy();
});

test("HudHost adjusts timing offset and shows floating badge on hotkey", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  assert.equal(host.offsetMs, 0);

  // Press ']' or 'x' -> +100ms
  host._handleKeyDown({ key: "]", preventDefault: () => {} });
  assert.equal(host.offsetMs, 100);
  assert.equal(host.syncBadgeEl.textContent, "Sync: +100ms");

  // Press '[' or 'z' -> -100ms
  host._handleKeyDown({ key: "[", preventDefault: () => {} });
  assert.equal(host.offsetMs, 0);
  assert.equal(host.syncBadgeEl.textContent, "Sync: -100ms");

  host.destroy();
});

test("HudHost ignores hotkeys in input fields, textareas, and editable targets", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  const inputEl = { tagName: "INPUT" };
  host._handleKeyDown({ key: "]", target: inputEl, preventDefault: () => {} });
  assert.equal(host.offsetMs, 0, "Must not adjust offset when input is focused");

  const textareaEl = { tagName: "TEXTAREA" };
  host._handleKeyDown({ key: "a", target: textareaEl, preventDefault: () => {} });

  const editableEl = { tagName: "DIV", isContentEditable: true };
  host._handleKeyDown({ key: "d", target: editableEl, preventDefault: () => {} });

  host.destroy();
});

test("HudHost seeks relative cues with A and D keys", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  let seekTarget = null;
  const mockAdapter = {
    getCapabilities: () => ({ seek: true }),
    getCurrentTime: () => 5.0,
    seek: (t) => { seekTarget = t; }
  };

  host.setAdapter(mockAdapter);
  host.setCues([
    { i: 0, startTime: 1.0, text: "Cue 1" },
    { i: 1, startTime: 4.0, text: "Cue 2" },
    { i: 2, startTime: 8.0, text: "Cue 3" }
  ]);

  // Press 'A': should seek to previous cue (Cue 2 at 4.0)
  host._handleKeyDown({ key: "a", preventDefault: () => {} });
  assert.equal(seekTarget, 4.0);

  // Now at 4.0, pressing 'A' seeks to Cue 1 at 1.0
  mockAdapter.getCurrentTime = () => 4.0;
  host._handleKeyDown({ key: "a", preventDefault: () => {} });
  assert.equal(seekTarget, 1.0);

  // Press 'D': should seek to next cue (Cue 3 at 8.0)
  host._handleKeyDown({ key: "d", preventDefault: () => {} });
  assert.equal(seekTarget, 8.0);

  host.destroy();
});

test("HudHost switches furigana mode classes", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  host.setFuriganaMode("always");
  assert.equal(host.furiganaMode, "always");
  assert.ok(host.contentContainer.className.includes("hud-furigana-always"));

  host.setFuriganaMode("hidden");
  assert.equal(host.furiganaMode, "hidden");
  assert.ok(host.contentContainer.className.includes("hud-furigana-hidden"));

  host.setFuriganaMode("hover");
  assert.equal(host.furiganaMode, "hover");
  assert.ok(host.contentContainer.className.includes("hud-furigana-hover"));

  host.destroy();
});

test("HudHost supports secondary subtitles and blur mode", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  // Disabled by default
  assert.equal(host.dualSubsEnabled, false);
  host.renderSecondaryCue({ text: "English subtitle" });
  assert.equal(host.secondaryCueEl.style.display, "none");

  // Enable dual subs
  host.setDualSubsConfig({ enabled: true, blur: true });
  assert.equal(host.dualSubsEnabled, true);
  assert.equal(host.dualSubsBlur, true);

  host.renderSecondaryCue({ text: "English subtitle" });
  assert.equal(host.secondaryCueEl.style.display, "block");
  assert.equal(host.secondaryCueEl.textContent, "English subtitle");

  host.destroy();
});


