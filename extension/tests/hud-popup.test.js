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
      remove(c) { this._classes.delete(c); },
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
        const found = this.children.find(c => c.className?.includes(cls));
        if (found) return found;
        if (!this._childCache) this._childCache = new Map();
        if (this._childCache.has(cls)) return this._childCache.get(cls);
        if (typeof this.innerHTML === "string" && this.innerHTML.includes(cls)) {
          const mockChild = createMockElement("div");
          mockChild.className = cls;
          mockChild.parentElement = this;
          mockChild.innerHTML = "";
          this._childCache.set(cls, mockChild);
          return mockChild;
        }
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

test("HudPopup renders cloud dictionary entries with definitions array", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);
  const token = { surface: "まいにち", lemma: "まいにち" };
  const span = createMockElement("span");
  await popup.showForToken(token, span, { text: "まいにちしんぶん" });

  // Simulate Cloud Edge dictionary lookup response format
  popup._renderMeaning({
    query: "まいにち",
    entries: [
      {
        id: 324122,
        term: "毎日",
        reading: "まいにち",
        definitions: ["every day; daily"]
      }
    ],
    kanji: []
  });

  const meaningEl = popup.popupEl.querySelector(".hud-popup-meaning");
  assert.ok(meaningEl.innerHTML.includes("every day; daily"), "Must display definition from entry.definitions");
  assert.ok(!meaningEl.innerHTML.includes("No definition found"), "Must not show no definition found");
});

test("HudPopup enriches token and DOM with kanji headword and JLPT level", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);
  const token = { surface: "まいにち", lemma: "まいにち" };
  const span = createMockElement("span");
  await popup.showForToken(token, span, { text: "まいにちしんぶん" });

  popup._applyEnrichment({
    expression: "毎日",
    reading: "まいにち",
    jlpt_level: "N5"
  });

  assert.equal(popup.currentTargetToken.lemma, "毎日", "Lemma should be enriched to 毎日");
  assert.equal(popup.currentTargetToken.reading, "まいにち");
  assert.equal(popup.currentTargetToken.jlpt_level, "N5");

  const kanjiEl = popup.popupEl.querySelector(".hud-headword-kanji");
  assert.ok(kanjiEl.innerHTML.includes("毎日"), "DOM headword should include enriched kanji");
  assert.ok(kanjiEl.innerHTML.includes("まいにち"), "DOM headword should include surface in parens");

  const badgeEl = popup.popupEl.querySelector(".hud-badge-jlpt");
  assert.equal(badgeEl.textContent, "N5", "DOM JLPT badge should update to N5");
});

test("HudPopup filters out attribution and extra-info from complex structured content", async () => {
  const mockHudHost = {
    contentContainer: createMockElement("div"),
    hostEl: createMockElement("div"),
    registerCleanup: () => {}
  };
  const popup = new HudPopup(mockHudHost);
  const token = { surface: "意味", lemma: "意味" };
  const span = createMockElement("span");
  await popup.showForToken(token, span, { text: "言葉の意味" });

  popup._renderMeaning({
    query: "意味",
    entries: [
      {
        id: 68805,
        term: "意味",
        reading: "いみ",
        definitions: [
          {
            type: "structured-content",
            content: [
              {
                tag: "div",
                data: { content: "sense-group" },
                content: [
                  { tag: "span", data: { content: "part-of-speech-info" }, content: "noun" },
                  {
                    tag: "div",
                    data: { content: "sense" },
                    content: [
                      {
                        tag: "ul",
                        data: { content: "glossary" },
                        content: [{ tag: "li", content: "meaning" }, { tag: "li", content: "significance" }]
                      },
                      {
                        tag: "div",
                        data: { content: "extra-info" },
                        content: "その語にはいくつかの意味がある。"
                      }
                    ]
                  },
                  {
                    tag: "div",
                    data: { content: "attribution" },
                    content: ["JMdict", "|", "Tatoeba"]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  });

  const meaningEl = popup.popupEl.querySelector(".hud-popup-meaning");
  assert.ok(meaningEl.innerHTML.includes("meaning"), "Must include clean gloss meaning");
  assert.ok(!meaningEl.innerHTML.includes("JMdict"), "Must NOT include attribution in definition");
  assert.ok(!meaningEl.innerHTML.includes("その語にはいくつかの意味がある"), "Must NOT include example sentence in definition");
});

