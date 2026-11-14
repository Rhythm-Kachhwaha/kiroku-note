/**
 * Tests for In-Page Hover & Selection Immersion (Phase 1)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function createMockElement(tagName = "div") {
  const listeners = new Map();
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      contains(c) { return this._classes.has(c); },
      remove(c) { this._classes.delete(c); }
    },
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
        let found = this.children.find(c => c.className?.includes(cls));
        if (!found && typeof this.innerHTML === "string" && this.innerHTML.includes(cls)) {
          found = createMockElement("div");
          found.className = cls;
          this.children.push(found);
        }
        return found || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return this.children.filter(c => c.className?.includes(cls));
      }
      return [];
    },
    getBoundingClientRect() {
      return { top: 180, left: 140, width: 60, height: 24, bottom: 204 };
    }
  };
}

global.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {}
};
global.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: () => {},
  removeEventListener: () => {}
};

let lastSentMessage = null;
global.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      lastSentMessage = msg;
      if (msg.type === "HUD_LOOKUP") {
        return {
          ok: true,
          data: {
            glossary: ["place, situation, position, location"],
            context_meaning: "The term indicates a precise marker in physical space."
          }
        };
      }
      if (msg.type === "HUD_MINE") {
        return { ok: true, card_id: "card_123" };
      }
      return { ok: true };
    }
  }
};

const { HudPopup } = require("../content/hud/hud-popup.js");

test("HudPopup renders compact header with reading, headword, JLPT badge, Save button, and tactile Known/Unknown buttons", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);

  const token = {
    surface: "位置",
    lemma: "位置",
    reading: "いち",
    jlpt_level: "N3",
    status: "unstyled"
  };
  const span = createMockElement("span");

  await popup.showForToken(token, span, null, "そこにあるマークの位置に立て");
  assert.equal(popup.isOpen, true);

  const html = popup.popupEl.innerHTML;
  assert.ok(html.includes("位置"), "Must contain headword kanji");
  assert.ok(html.includes("いち"), "Must contain reading furigana");
  assert.ok(html.includes("N3"), "Must contain JLPT N3 badge");
  assert.ok(html.includes("hud-btn-mine"), "Must render save button");
  assert.ok(html.includes("Save"), "Button text must be Save");
  assert.ok(html.includes("hud-btn-known"), "Must render Known status button");
  assert.ok(html.includes("hud-btn-unknown"), "Must render Unknown status button");

  // Verify removed bloat rows are NOT present (per user instructions)
  assert.equal(html.includes("hud-btn-audio"), false, "Audio pronounce button must be removed");
  assert.equal(html.includes("hud-btn-snapshot"), false, "Snapshot button must be removed");
  assert.equal(html.includes("hud-btn-copy"), false, "Copy button must be removed");
  assert.equal(html.includes("hud-context-card"), false, "Context card must be removed");

  popup.close();
});

test("HudPopup renders compact glossary meaning without redundant context card", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);

  const token = {
    surface: "位置",
    lemma: "位置",
    reading: "いち",
    jlpt_level: "N3"
  };
  const span = createMockElement("span");

  await popup.showForToken(token, span, null, "そこにあるマークの位置に立て");
  // Meaning elements
  const meaningEl = popup.popupEl.querySelector(".hud-popup-meaning");
  assert.ok(meaningEl.innerHTML.includes("place, situation, position, location"));

  const contextEl = popup.popupEl.querySelector(".hud-context-card");
  assert.equal(contextEl, null, "Context explanation card must be removed from UI");

  popup.close();
});

test("Interactive sandbox file exists with full sections and zero emojis", () => {
  const sandboxPath = path.join(__dirname, "../sandbox/sample_text_page.html");
  assert.ok(fs.existsSync(sandboxPath), "sample_text_page.html must exist");

  const content = fs.readFileSync(sandboxPath, "utf8");
  assert.ok(content.includes("そこにあるマークの位置に立て"), "Must include Netflix subtitle quote");
  assert.ok(content.includes("人工知能"), "Must include N1/N2 tech news article");
  assert.ok(content.includes("top-comprehension-bar"), "Must include Migaku-style top comprehension bar");
  assert.ok(content.includes("mock-hud-menu-panel"), "Must include redesigned Subtitle Menu Panel");
  assert.ok(content.includes("mock-hud-sentence-bar"), "Must include redesigned Subtitle Action Bar");
  assert.ok(content.includes("SANDBOX_MOCK_DICTIONARY"), "Must include mock dictionary for instant sandbox testing");

  // Zero emojis verification
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(content), false, "Must contain zero emojis");
});
