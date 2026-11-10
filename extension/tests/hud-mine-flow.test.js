/**
 * Tests for HUD sentence actions (mine whole sentence, grammar, transcript jump)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName = "div") {
  const listeners = new Map();
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
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    trigger(evt, eventObj = {}) {
      const list = listeners.get(evt) || [];
      for (const fn of list) fn(eventObj);
    },
    querySelector(sel) {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return this.children.find(c => c.className?.includes(cls)) || null;
      }
      return null;
    }
  };
}

global.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag)
};

let lastSentMessage = null;
global.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      lastSentMessage = msg;
      return { ok: true };
    }
  }
};

const { HudSentence } = require("../content/hud/hud-sentence.js");

test("HudSentence shows when cue has text and handles actions", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    registerCleanup: () => {}
  };
  const hudSentence = new HudSentence(mockHudHost);

  assert.equal(hudSentence.toolbarEl.style.display, "none");

  hudSentence.setCue({ text: "今夜は月が綺麗ですね" });
  assert.equal(hudSentence.toolbarEl.style.display, "flex");

  // Mine sentence
  await hudSentence.mineSentence();
  assert.equal(lastSentMessage.type, "JAPANESE_TEXT_CAPTURED");
  assert.equal(lastSentMessage.text, "今夜は月が綺麗ですね");

  // Grammar
  await hudSentence.openGrammar();
  assert.equal(lastSentMessage.type, "SP_OPEN_GRAMMAR");
  assert.equal(lastSentMessage.text, "今夜は月が綺麗ですね");

  // Transcript
  await hudSentence.jumpToTranscript();
  assert.equal(lastSentMessage.type, "SP_SCROLL_TRANSCRIPT");
  assert.equal(lastSentMessage.cue.text, "今夜は月が綺麗ですね");

  hudSentence.destroy();
  assert.equal(hudSentence.toolbarEl, null);
});

test("HudSentence shows 1T badge for 1-target cues and neutral dot for 0 unknown", () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    registerCleanup: () => {}
  };
  const hudSentence = new HudSentence(mockHudHost);

  // 1 unknown token
  hudSentence.setCue({
    text: "吾輩は猫である",
    unknownCount: 1
  });
  const badge = hudSentence.toolbarEl.querySelector(".hud-1t-badge");
  assert.equal(badge.style.display, "inline-block");
  assert.ok(badge.className.includes("hud-1t-target"));

  // 0 unknown tokens (full comprehension)
  hudSentence.setCue({
    text: "こんにちは",
    unknownCount: 0
  });
  assert.equal(badge.style.display, "inline-block");
  assert.ok(badge.className.includes("hud-1t-comprehended"));

  // 2 unknown tokens (no 1T badge)
  hudSentence.setCue({
    text: "複雑な文章です",
    unknownCount: 2
  });
  assert.equal(badge.style.display, "none");

  hudSentence.destroy();
});

test("HudSentence merges and unmerges multi-line dialogue cues", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    registerCleanup: () => {}
  };
  const hudSentence = new HudSentence(mockHudHost);

  const cues = [
    { i: 0, text: "私はいつも", startTime: 1.0, endTime: 2.5 },
    { i: 1, text: "日本語を勉強しています", startTime: 2.6, endTime: 4.8 },
    { i: 2, text: "毎日楽しいです", startTime: 5.0, endTime: 7.0 }
  ];

  hudSentence.setCues(cues);
  hudSentence.setCue(cues[1]);
  assert.equal(hudSentence.currentCue.text, "日本語を勉強しています");

  // Merge with previous cue
  hudSentence.mergeWithPrevious();
  assert.equal(hudSentence.currentCue.text, "私はいつも 日本語を勉強しています");
  assert.equal(hudSentence.currentCue.startTime, 1.0);
  assert.equal(hudSentence.currentCue.endTime, 4.8);
  assert.equal(hudSentence.isMerged, true);

  // Mine merged sentence
  await hudSentence.mineSentence();
  assert.equal(lastSentMessage.type, "JAPANESE_TEXT_CAPTURED");
  assert.equal(lastSentMessage.text, "私はいつも 日本語を勉強しています");
  assert.equal(lastSentMessage.isMerged, true);

  // Unmerge
  hudSentence.unmerge();
  assert.equal(hudSentence.currentCue.text, "日本語を勉強しています");
  assert.equal(hudSentence.isMerged, false);

  hudSentence.destroy();
});


