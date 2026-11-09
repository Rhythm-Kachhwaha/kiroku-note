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
