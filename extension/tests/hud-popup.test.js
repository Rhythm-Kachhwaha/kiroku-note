/**
 * Tests for HudPopup (Token popup, meaning, status, mine dispatch)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName = "div") {
  const listeners = new Map();
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      contains(c) { return this._classes.has(c); }
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
        return this.children.find(c => c.className?.includes(cls)) || null;
      }
      return null;
    },
    getBoundingClientRect() {
      return { top: 200, left: 150, width: 40, height: 20, bottom: 220 };
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
        return { ok: true, data: { glossary: "test definition" } };
      }
      if (msg.type === "HUD_MINE") {
        return { ok: true, data: { id: 123 } };
      }
      return { ok: true };
    }
  }
};

const { HudPopup, lookupCache } = require("../content/hud/hud-popup.js");

test("HudPopup renders token details and queries lookup", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);

  const token = {
    surface: "日本語",
    lemma: "日本語",
    reading: "にほんご",
    status: "unstyled",
    jlpt_level: "N5"
  };
  const span = createMockElement("span");

  await popup.showForToken(token, span, { text: "日本語を勉強する" });
  assert.equal(popup.isOpen, true);
  assert.ok(popup.popupEl.innerHTML.includes("日本語"));
  assert.ok(popup.popupEl.innerHTML.includes("にほんご"));
  assert.ok(lookupCache.get("日本語"), "Lookup term must be cached in LRU");

  popup.close();
  assert.equal(popup.isOpen, false);
});

test("HudPopup mineCurrentWord sends HUD_MINE and turns token orange", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);

  const token = {
    surface: "食べる",
    lemma: "食べる",
    reading: "たべる",
    status: "unstyled"
  };
  const span = createMockElement("span");

  await popup.showForToken(token, span, { text: "ご飯を食べる" });
  await popup.mineCurrentWord();

  assert.ok(lastSentMessage);
  assert.equal(lastSentMessage.type, "HUD_MINE");
  assert.equal(lastSentMessage.card.expression, "食べる");
  assert.equal(token.status, "mined");
  assert.ok(span.classList.contains("mined"));
  assert.equal(span.style.color, "#d4884f");
});

test("HudPopup closes on cue change and preserves native keybindings", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);

  const token = { surface: "見る", lemma: "見る" };
  const span = createMockElement("span");
  await popup.showForToken(token, span, { text: "テレビを見る" });
  assert.equal(popup.isOpen, true);

  // Cue advances -> popup closes
  popup.setCue({ text: "本を読む" });
  assert.equal(popup.isOpen, false, "Popup must close when active cue advances");

  // Re-open
  await popup.showForToken(token, span, { text: "テレビを見る" });
  assert.equal(popup.isOpen, true);

  // Native keys (Space, ArrowLeft, f, m) must NOT have stopPropagation called
  let stopped = false;
  popup._onDocKeyDown({ key: " ", stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false, "Space must not be stopped");
  popup._onDocKeyDown({ key: "ArrowLeft", stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false, "ArrowLeft must not be stopped");
  popup._onDocKeyDown({ key: "f", stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false, "f must not be stopped");

  // Escape closes popup
  popup._onDocKeyDown({ key: "Escape", stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, "Escape must stop propagation");
  assert.equal(popup.isOpen, false, "Escape must close popup");
});

