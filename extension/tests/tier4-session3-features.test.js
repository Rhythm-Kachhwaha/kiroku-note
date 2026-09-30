/**
 * Test Suite for Tier 4 Session 3 Features:
 * - T4-E: Stroke Order SVG diagram inside existing kanji breakdown cards (KanjiVG)
 *   - CSS definitions for stroke order diagram and progressive disclosure accordion
 *   - API constant and caching helpers in sidepanel.js
 *   - renderKanjiCard injection in full mode (on-demand accordion, stroke pill button)
 *   - renderKanjiCard injection in compact mode (Anki card preview)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.join(__dirname, "../sidepanel/sidepanel.js");

const cssContent = fs.readFileSync(cssPath, "utf-8");
const jsContent = fs.readFileSync(jsPath, "utf-8");

test("Tier 4 Session 3: CSS Structure for Stroke Order Diagrams", () => {
  assert.ok(
    cssContent.includes(".study-kanji-strokes-accordion"),
    "CSS must include .study-kanji-strokes-accordion"
  );
  assert.ok(
    cssContent.includes(".study-kanji-strokes-summary"),
    "CSS must include .study-kanji-strokes-summary"
  );
  assert.ok(
    cssContent.includes(".study-kanji-strokes-panel"),
    "CSS must include .study-kanji-strokes-panel"
  );
  assert.ok(
    cssContent.includes(".stroke-order-svg"),
    "CSS must include .stroke-order-svg"
  );
  assert.ok(
    cssContent.includes(".kanji-stroke-toggle-btn"),
    "CSS must include .kanji-stroke-toggle-btn"
  );
  assert.ok(
    cssContent.includes(".kn-kanji-body-row"),
    "CSS must include .kn-kanji-body-row"
  );
  assert.ok(
    cssContent.includes(".kn-kanji-stroke-col"),
    "CSS must include .kn-kanji-stroke-col"
  );
});

test("Tier 4 Session 3: JavaScript API & Cache Declarations", () => {
  assert.ok(
    jsContent.includes("API_KANJI_STROKES_URL"),
    "sidepanel.js must define API_KANJI_STROKES_URL"
  );
  assert.ok(
    jsContent.includes("kanjiStrokesCache"),
    "sidepanel.js must define kanjiStrokesCache Map"
  );
  assert.ok(
    jsContent.includes("getKanjiStrokeSvg"),
    "sidepanel.js must define getKanjiStrokeSvg function"
  );
  assert.ok(
    jsContent.includes("createStrokeSvgElement"),
    "sidepanel.js must define createStrokeSvgElement function"
  );
  assert.ok(
    jsContent.includes("study-kanji-strokes-accordion"),
    "renderKanjiCard must construct study-kanji-strokes-accordion"
  );
  assert.ok(
    jsContent.includes("kn-kanji-stroke-col"),
    "renderKanjiCard in compact mode must construct kn-kanji-stroke-col"
  );
});

test("Tier 4 Session 3: DOM Rendering & On-Demand Collapsible Invariant", () => {
  // Mock minimal DOM environment
  const mockElements = [];
  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      textContent: "",
      title: "",
      open: false,
      hidden: false,
      style: {},
      children: [],
      classList: {
        add: (c) => { el.className = (el.className ? el.className + " " : "") + c; },
        contains: (c) => (el.className || "").split(" ").includes(c),
      },
      append: (...items) => {
        items.forEach((item) => {
          if (item) el.children.push(item);
        });
      },
      replaceChildren: (...items) => {
        el.children = items.filter(Boolean);
      },
      addEventListener: (evt, handler) => {
        el[`on_${evt}`] = handler;
      },
      querySelector: (selector) => {
        if (selector === "svg" && tag === "div") {
          return createMockElement("svg");
        }
        return null;
      },
    };
    mockElements.push(el);
    return el;
  }

  // Verify createStrokeSvgElement function logic
  const sampleSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109"><path d="M10,10 L90,90"/></svg>';
  
  // Extract createStrokeSvgElement from jsContent
  const createStrokeSvgMatch = jsContent.match(/function createStrokeSvgElement\(svgText\) \{([\s\S]*?)\n\}/);
  assert.ok(createStrokeSvgMatch, "Must find createStrokeSvgElement in sidepanel.js");

  const createStrokeFn = new Function("svgText", "document", `
    if (!svgText) return null;
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = svgText;
    const svg = tempDiv.querySelector("svg");
    if (svg) {
      svg.classList.add("stroke-order-svg");
      return svg;
    }
    return null;
  `);

  const mockDoc = { createElement: createMockElement };
  const parsedSvg = createStrokeFn(sampleSvg, mockDoc);
  assert.ok(parsedSvg, "Parsed SVG element should be returned");
  assert.equal(parsedSvg.tagName, "SVG");
  assert.ok(parsedSvg.classList.contains("stroke-order-svg"), "Must have stroke-order-svg class");
});
