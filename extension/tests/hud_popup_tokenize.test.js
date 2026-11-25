const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName = "div") {
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
      if (idx !== -1) this.children.splice(idx, 1);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { top: 200, left: 150, width: 40, height: 20, bottom: 220 };
    }
  };
}

test("HudPopup auto-selects primary merged token when opened on raw text selection", async () => {
  const origDoc = global.document;
  const origWin = global.window;
  const origChrome = global.chrome;

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

  const lookups = [];
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === "TOKENIZE_SENTENCE") {
          return {
            ok: true,
            tokens: [
              { surface: "来ていません", lemma: "来る", reading: "くる", jlpt_level: "N5", pos: "動詞", status: "should_know" },
              { surface: "よ", lemma: "よ", reading: "よ", pos: "助詞", status: "unstyled" },
              { surface: "。", lemma: "。", reading: "。", pos: "補助記号", status: "unstyled" }
            ]
          };
        }
        if (msg.type === "HUD_LOOKUP") {
          lookups.push(msg.text);
          if (msg.text === "来る") {
            return { ok: true, data: { expression: "来る", reading: "くる", meaning: "to come", jlpt_level: "N5" } };
          }
          return { ok: true, data: { expression: "来", reading: "らい", meaning: "next" } };
        }
        return { ok: true };
      }
    }
  };

  try {
    const { HudPopup } = require("../content/hud/hud-popup.js");
    const popup = new HudPopup(null, null);

    await popup.showAtPoint(100, 100, {
      surface: "来ていませんよ",
      lemma: "来ていませんよ",
      text: "来ていませんよ"
    }, "来ていませんよ");

    // Allow microtasks from TOKENIZE_SENTENCE promise to settle
    await new Promise(r => setTimeout(r, 20));

    assert.equal(popup.currentTargetToken.surface, "来ていません");
    assert.equal(popup.currentTargetToken.lemma, "来る");
    assert.ok(lookups.includes("来る"), `Expected HUD_LOOKUP for '来る', got: ${JSON.stringify(lookups)}`);

    const css = popup._getStyleSheet();
    assert.ok(css.includes("color-scheme: dark;"), "Expected color-scheme: dark in HudPopup stylesheet");
    assert.ok(!popup.popupEl.style.cssText.includes("outline: 1px solid"), "Expected no inset outline on popup");
  } finally {
    global.document = origDoc;
    global.window = origWin;
    global.chrome = origChrome;
  }
});
