const test = require("node:test");
const assert = require("node:assert/strict");
const { AnimeTranscript } = require("../sidepanel/anime/transcript.js");

function createMockDom() {
  const container = {
    innerHTML: "",
    querySelector(sel) {
      if (sel === ".anime-transcript-wrap") return this._wrap;
      if (sel === ".anime-transcript-search-input") return this._input;
      if (sel === ".anime-search-clear-btn") return this._clearBtn;
      if (sel === ".anime-transcript-viewport") return this._viewport;
      if (sel === ".anime-transcript-spacer") return this._spacer;
      if (sel === ".anime-transcript-items") return this._itemsHost;
      if (sel === ".anime-transcript-count") return this._countBadge;
      return null;
    }
  };

  const wrap = { className: "anime-transcript-wrap" };
  const input = {
    value: "",
    listeners: {},
    addEventListener(evt, fn) { this.listeners[evt] = fn; },
    focus() {}
  };
  const clearBtn = {
    hidden: true,
    listeners: {},
    addEventListener(evt, fn) { this.listeners[evt] = fn; },
    click() { if (this.listeners["click"]) this.listeners["click"](); }
  };
  const itemsHost = {
    innerHTML: "",
    children: [],
    style: {},
    replaceChildren(fragment) {
      this.children = fragment.children || [];
    }
  };
  const spacer = { style: {} };
  const countBadge = { textContent: "" };
  const viewport = {
    scrollTop: 0,
    clientHeight: 300,
    listeners: {},
    addEventListener(evt, fn) { this.listeners[evt] = fn; },
    removeEventListener(evt, fn) { delete this.listeners[evt]; }
  };

  container._wrap = wrap;
  container._input = input;
  container._clearBtn = clearBtn;
  container._itemsHost = itemsHost;
  container._spacer = spacer;
  container._countBadge = countBadge;
  container._viewport = viewport;

  // Polyfill document.createDocumentFragment and createElement for node environment
  global.document = {
    createDocumentFragment() {
      return {
        children: [],
        appendChild(child) { this.children.push(child); }
      };
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: "",
        dataset: {},
        style: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          contains(c) { return this.classes.has(c); }
        },
        children: [],
        appendChild(child) { this.children.push(child); },
        setAttribute(k, v) { this[k] = v; },
        addEventListener(evt, fn) { this[evt] = fn; }
      };
    }
  };

  return container;
}

test("AnimeTranscript - mounts correctly and displays cue counts", () => {
  const container = createMockDom();
  const transcript = new AnimeTranscript({ container });

  const testCues = [
    { i: 0, text: "こんにちは", startTime: 1.0 },
    { i: 1, text: "世界", startTime: 3.5 }
  ];

  transcript.setCues(testCues);
  assert.equal(container._countBadge.textContent, "2 cues");
  assert.equal(container._spacer.style.height, "96px"); // 2 * 48px
});

test("AnimeTranscript - filters 1,500 cues in < 100 ms", () => {
  const container = createMockDom();
  const transcript = new AnimeTranscript({ container });

  // Generate 1500 realistic cues
  const bigCues = [];
  for (let i = 0; i < 1500; i++) {
    bigCues.push({
      i,
      text: i % 10 === 0 ? `魔法の言葉 #${i}` : `普通の会話シーン #${i}`,
      startTime: i * 2.0
    });
  }

  transcript.setCues(bigCues);
  assert.equal(container._countBadge.textContent, "1500 cues");

  const start = performance.now();
  transcript.filter("魔法");
  const duration = performance.now() - start;

  assert.ok(duration < 100, `Filtering took ${duration} ms, which is < 100 ms`);
  assert.equal(container._countBadge.textContent, "150 / 1500");
});

test("AnimeTranscript - respects seek capability (disabled on Netflix)", () => {
  const container = createMockDom();
  let seekCalls = 0;

  const transcript = new AnimeTranscript({
    container,
    capabilities: { seek: false },
    onSeek: () => { seekCalls++; }
  });

  transcript.setCues([
    { i: 0, text: "Netflix test cue", startTime: 10.0 }
  ]);

  // Click on time button or row
  const row = container._itemsHost.children[0];
  assert.ok(row, "Row should be rendered in virtual window");

  const timeBtn = row.children[0];
  assert.equal(timeBtn.ariaDisabled || timeBtn["aria-disabled"], "true");
  assert.ok(timeBtn.classList.contains("anime-seek-disabled"));

  // Attempting seek should be ignored
  transcript.handleSeekClick(transcript.cues[0], 10.0);
  assert.equal(seekCalls, 0, "Seek must not be triggered when seek capability is false");

  // Enable seek capability and verify
  transcript.setCapabilities({ seek: true });
  transcript.handleSeekClick(transcript.cues[0], 10.0);
  assert.equal(seekCalls, 1, "Seek must be triggered when seek capability is true");
});

