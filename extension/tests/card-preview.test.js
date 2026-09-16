const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

console.log("Starting Stage 5.4 Side Panel Live Anki Card Preview Tests...");

// 1. Verify HTML DOM elements
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.ok(html.includes('id="card-preview-section"'), "card-preview-section must exist in sidepanel.html");
assert.ok(html.includes('id="card-preview-container"'), "card-preview-container must exist in sidepanel.html");
assert.ok(html.includes('id="card-preview-card"'), "card-preview-card must exist in sidepanel.html");
assert.ok(html.includes('id="preview-tab-front"'), "preview-tab-front button must exist in sidepanel.html");
assert.ok(html.includes('id="preview-tab-back"'), "preview-tab-back button must exist in sidepanel.html");

// Verify ordering: card-editor-section before card-preview-section before dictionary-section
const cardEditorIdx = html.indexOf('id="card-editor-section"');
const previewIdx = html.indexOf('id="card-preview-section"');
const dictIdx = html.indexOf('id="dictionary-section"');
assert.ok(cardEditorIdx !== -1 && previewIdx !== -1 && dictIdx !== -1, "All 3 sections must exist");
assert.ok(cardEditorIdx < previewIdx, "Card editor must be positioned above card preview");
assert.ok(previewIdx < dictIdx, "Card preview must be positioned above dictionary section");

console.log("PASS 1: HTML DOM structure and section ordering verified.");

// 2. Verify CSS rules
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

assert.ok(css.includes(".card-preview-section"), "CSS must define .card-preview-section");
assert.ok(css.includes(".preview-tabs"), "CSS must define .preview-tabs");
assert.ok(css.includes(".preview-tab-btn"), "CSS must define .preview-tab-btn");
assert.ok(css.includes(".card-preview-card.kn-card") || css.includes(".kn-card"), "CSS must define .kn-card");
assert.ok(css.includes(".kn-kana"), "CSS must define .kn-kana");
assert.ok(css.includes(".kn-pitch"), "CSS must define .kn-pitch");
assert.ok(css.includes(".kn-divider"), "CSS must define .kn-divider");
assert.ok(css.includes(".kn-meaning"), "CSS must define .kn-meaning");
assert.ok(css.includes(".kn-pos"), "CSS must define .kn-pos");
assert.ok(css.includes(".kn-tag"), "CSS must define .kn-tag");
assert.ok(css.includes(".kn-example-block"), "CSS must define .kn-example-block");
assert.ok(css.includes(".kn-example-ja"), "CSS must define .kn-example-ja");
assert.ok(css.includes(".kn-example-en"), "CSS must define .kn-example-en");
assert.ok(css.includes(".kn-image"), "CSS must define .kn-image");
assert.ok(css.includes("max-height: 180px") || css.includes("max-height: 240px"), "CSS must contain image max-height");

console.log("PASS 2: CSS tokens and .kn-card rules verified.");

// 3. DOM Mocking Infrastructure for testing preview logic
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    tag,
    className: "",
    _textContent: "",
    title: "",
    value: "",
    open: false,
    hidden: false,
    style: {},
    children: [],
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
      },
      contains(c) { return this._classes.has(c); },
    },
    append(...els) {
      this.children.push(...els);
    },
    appendChild(el) {
      this.children.push(el);
      return el;
    },
    replaceChildren(...els) {
      this.children = [...els];
    },
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      this["on" + event] = fn;
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      if (this["on" + type]) {
        this["on" + type](event);
      }
      return true;
    },
    setAttribute(name, val) {
      this[name] = val;
    },
    getAttribute(name) {
      return this[name] || null;
    },
  };

  Object.defineProperty(el, "textContent", {
    get() {
      if (this.children.length > 0) {
        return this.children.map(c => (c.textContent !== undefined ? c.textContent : (c.text || ""))).join("");
      }
      return this._textContent;
    },
    set(val) {
      this._textContent = String(val);
      this.children = [];
    },
  });

  return el;
}

function createTextNode(text) {
  return {
    nodeType: 3,
    textContent: String(text),
    text: String(text),
  };
}

function findAll(el, predicate) {
  const results = [];
  if (!el || !Array.isArray(el.children)) return results;
  for (const child of el.children) {
    if (predicate(child)) {
      results.push(child);
    }
    results.push(...findAll(child, predicate));
  }
  return results;
}

// 4. Set up VM context to test preview rendering
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const jsContent = fs.readFileSync(jsPath, "utf8");

const mockDoc = {
  createElement: createMockElement,
  createTextNode: createTextNode,
  querySelector: (sel) => createMockElement(sel.replace(/^[#\.]/, "")),
  documentElement: { style: { setProperty() {} } },
  addEventListener: () => {},
};

const mockCardPreviewCard = createMockElement("div");
const mockPreviewTabFront = createMockElement("button");
const mockPreviewTabBack = createMockElement("button");
const mockFieldExpression = createMockElement("input");
const mockFieldReading = createMockElement("input");
const mockFieldMeaning = createMockElement("textarea");
const mockFieldHint = createMockElement("input");
const mockFieldExampleSentence = createMockElement("textarea");
const mockFieldExampleTranslation = createMockElement("textarea");
const mockFieldImage = createMockElement("input");
const mockFieldAudio = createMockElement("input");
const mockFieldTags = createMockElement("input");
const mockFieldNotes = createMockElement("textarea");

const vmContext = {
  document: mockDoc,
  window: { confirm: () => true },
  cardPreviewCard: mockCardPreviewCard,
  previewTabFront: mockPreviewTabFront,
  previewTabBack: mockPreviewTabBack,
  fieldExpression: mockFieldExpression,
  fieldReading: mockFieldReading,
  fieldMeaning: mockFieldMeaning,
  fieldHint: mockFieldHint,
  fieldExampleSentence: mockFieldExampleSentence,
  fieldExampleTranslation: mockFieldExampleTranslation,
  fieldImage: mockFieldImage,
  fieldAudio: mockFieldAudio,
  fieldTags: mockFieldTags,
  fieldNotes: mockFieldNotes,
  currentDraftMedia: {
    imageBase64: null,
    audioBase64: null,
    audioStatus: "idle",
  },
  currentDictionaryEntries: [],
  encodeURIComponent: encodeURIComponent,
  setTimeout: (fn, ms) => { fn(); return 1; },
  clearTimeout: () => {},
};

// Execute sidepanel.js inside VM context
vm.createContext(vmContext);

// Extract preview functions and dependencies
const helpersSrc = jsContent.slice(
  jsContent.indexOf("function getPitchCircleNumber"),
  jsContent.indexOf("function insertSenseToMeaning")
);
const previewStartIdx = jsContent.indexOf("currentPreviewSide");
const previewSectionSrc = jsContent.slice(
  previewStartIdx >= 4 ? previewStartIdx - 4 : previewStartIdx,
  jsContent.indexOf("function updateSessionCounter")
);
vm.runInContext(helpersSrc, vmContext);
vm.runInContext(previewSectionSrc, vmContext);

const {
  formatPitchBadge,
  setPreviewSide,
  scheduleCardPreviewUpdate,
  getCardPreviewData,
  renderPreviewMeanings,
  renderCardPreviewDOM,
  updateCardPreview,
} = vmContext;

// Test 1: Empty state preview
renderCardPreviewDOM(mockCardPreviewCard, {}, "back");
assert.equal(mockCardPreviewCard.children.length, 1);
assert.equal(mockCardPreviewCard.children[0].className, "card-preview-empty");
console.log("PASS 3: Empty card displays placeholder message.");

// Test 2: Front side preview rendering
const frontData = {
  expression: "食べる",
  reading: "たべる",
  hint: "1-dan verb",
};
renderCardPreviewDOM(mockCardPreviewCard, frontData, "front");
const exprEl = mockCardPreviewCard.children.find(c => c.className === "kn-front-expression");
assert.ok(exprEl, "Front expression element must exist");
assert.equal(exprEl.textContent, "食べる [たべる]");
const hintEl = mockCardPreviewCard.children.find(c => c.className === "kn-hint");
assert.ok(hintEl, "Front hint element must exist");
assert.equal(hintEl.textContent, "Hint: 1-dan verb");
console.log("PASS 4: Front preview displays expression [reading] and hint.");

// Test 3: Front side without reading or identical reading
renderCardPreviewDOM(mockCardPreviewCard, { expression: "猫", reading: "猫" }, "front");
assert.equal(mockCardPreviewCard.children[0].textContent, "猫");
console.log("PASS 5: Front preview displays plain expression when reading matches.");

// Test 4: Back side preview with rich structured data
const richData = {
  expression: "掛ける",
  reading: "かける",
  meaning: "1. to hang\n2. to multiply",
  hint: "polysemous",
  example_sentence: "壁[かべ]に絵[え]を掛[か]ける。",
  example_translation: "Hang a picture on the wall.",
  notes: "polite: かけます",
  image: "http://127.0.0.1:8000/api/media/kakeru.jpg",
  audio: "http://127.0.0.1:8000/api/media/kakeru.mp3",
  pitch_badge: "[② Nakadaka]",
  entries: [
    {
      dictionary: "Jitendex",
      senses: [
        { index: 1, glosses: ["to hang", "to suspend"], parts_of_speech: ["ichidan", "vt"], tags: ["common"] },
        { index: 2, glosses: ["to multiply"], parts_of_speech: ["ichidan", "vt"], field_tags: ["math"] },
      ],
    },
  ],
};

renderCardPreviewDOM(mockCardPreviewCard, richData, "back");

// Verify reading & pitch header
const readingDiv = mockCardPreviewCard.children.find(c => c.className === "kn-reading");
assert.ok(readingDiv, ".kn-reading header must exist");
const kanaSpan = readingDiv.children.find(c => c.className === "kn-kana");
assert.equal(kanaSpan.textContent, "かける");
const pitchSpan = readingDiv.children.find(c => c.className === "kn-pitch");
assert.equal(pitchSpan.textContent, "[② Nakadaka]");

// Verify divider
const divider = mockCardPreviewCard.children.find(c => c.className === "kn-divider");
assert.ok(divider, ".kn-divider must exist");

// Verify meanings list with POS (and no noisy domain tags)
const meaningsOl = mockCardPreviewCard.children.find(c => c.className === "kn-meanings");
assert.ok(meaningsOl, ".kn-meanings list must exist");
assert.equal(meaningsOl.children.length, 2, "Must contain 2 sense list items");

const li1 = meaningsOl.children[0];
const pos1 = li1.children.find(c => c.className === "kn-pos");
assert.equal(pos1.textContent, "[ichidan, vt]");
assert.ok(li1.textContent.includes("to hang, to suspend"));

const li2 = meaningsOl.children[1];
const pos2 = li2.children.find(c => c.className === "kn-pos");
assert.equal(pos2.textContent, "[ichidan, vt]");
assert.ok(li2.textContent.includes("to multiply"));

// Verify example block with ruby
const exBlock = mockCardPreviewCard.children.find(c => c.className === "kn-example-block");
assert.ok(exBlock, ".kn-example-block must exist");
const jaP = exBlock.children.find(c => c.className === "kn-example-ja");
assert.ok(jaP, ".kn-example-ja must exist");
const rubyEls = findAll(jaP, c => c.tagName === "RUBY");
assert.equal(rubyEls.length, 3, "Must render 3 ruby elements for bracket furigana");

const enP = exBlock.children.find(c => c.className === "kn-example-en");
assert.equal(enP.textContent, "Hang a picture on the wall.");

// Verify hint & notes
const backHint = mockCardPreviewCard.children.find(c => c.className === "kn-hint");
assert.equal(backHint.textContent, "Hint: polysemous");
const backNotes = mockCardPreviewCard.children.find(c => c.className === "kn-notes");
assert.equal(backNotes.textContent, "Notes: polite: かけます");

// Verify media
const mediaDiv = mockCardPreviewCard.children.find(c => c.className === "kn-media");
assert.ok(mediaDiv, ".kn-media container must exist");
const imgEl = mediaDiv.children.find(c => c.className === "kn-image");
assert.ok(imgEl, ".kn-image element must exist");
assert.equal(imgEl.src, "http://127.0.0.1:8000/api/media/kakeru.jpg");
const audEl = mediaDiv.children.find(c => c.className === "kn-audio-preview");
assert.ok(audEl, ".kn-audio-preview element must exist");
assert.equal(audEl.src, "http://127.0.0.1:8000/api/media/kakeru.mp3");

console.log("PASS 6: Back preview renders complete semantic hierarchy with ruby, badges, and media.");

// Test 5: Tab switching (Front / Back toggle)
setPreviewSide("front");
assert.equal(vmContext.currentPreviewSide, "front");
assert.ok(mockPreviewTabFront.classList.contains("active"));
assert.ok(!mockPreviewTabBack.classList.contains("active"));

setPreviewSide("back");
assert.equal(vmContext.currentPreviewSide, "back");
assert.ok(mockPreviewTabBack.classList.contains("active"));
assert.ok(!mockPreviewTabFront.classList.contains("active"));
console.log("PASS 7: Tab toggle updates currentPreviewSide and tab active states.");

// Test 6: Single sense meaning formatting without <ol>
const singleSenseData = {
  expression: "映画",
  reading: "えいが",
  meaning: "movie, film",
  entries: [
    {
      dictionary: "Jitendex",
      senses: [{ index: 1, glosses: ["movie", "film"], parts_of_speech: ["noun"] }],
    },
  ],
};
renderCardPreviewDOM(mockCardPreviewCard, singleSenseData, "back");
const singleMeanDiv = mockCardPreviewCard.children.find(c => c.className === "kn-meaning");
assert.ok(singleMeanDiv, "Single sense must render in .kn-meaning div without <ol>");
assert.ok(singleMeanDiv.textContent.includes("movie, film"));
assert.ok(singleMeanDiv.textContent.includes("[noun]"));
console.log("PASS 8: Single sense rendered inside .kn-meaning div.");

// Test 7: Plain text multi-line meaning without entries
const plainMultiData = {
  expression: "走る",
  meaning: "1. to run\n2. to travel quickly",
};
renderCardPreviewDOM(mockCardPreviewCard, plainMultiData, "back");
const plainOl = mockCardPreviewCard.children.find(c => c.className === "kn-meanings");
assert.ok(plainOl, "Multi-line text must render in <ol class='kn-meanings'>");
assert.equal(plainOl.children.length, 2);
assert.equal(plainOl.children[0].textContent, "to run");
assert.equal(plainOl.children[1].textContent, "to travel quickly");
console.log("PASS 9: Multi-line plain text formatted into numbered <ol> list.");

// Test 8: XSS and injection safety (Malicious script strings)
const maliciousData = {
  expression: "<script>alert('xss')</script>",
  reading: "<img src=x onerror=alert(1)>",
  meaning: "<script>alert('meaning')</script>",
  hint: "\"><script>alert('hint')</script>",
  example_sentence: "<script>alert('sentence')</script>",
  example_translation: "<script>alert('translation')</script>",
  notes: "<script>alert('notes')</script>",
};
renderCardPreviewDOM(mockCardPreviewCard, maliciousData, "back");
const allScriptEls = findAll(mockCardPreviewCard, c => c.tagName === "SCRIPT");
assert.equal(allScriptEls.length, 0, "Zero <script> tags must be generated in DOM");
console.log("PASS 10: XSS payloads safely treated as plain text strings in preview DOM.");

// Test 9: Pitch badge formatting helper
const pitch0 = formatPitchBadge({ position: 0, pattern_name: "heiban" });
assert.equal(pitch0, "[⓪ Heiban]");
const pitch2 = formatPitchBadge({ position: 2, pattern_name: "nakadaka" });
assert.equal(pitch2, "[② Nakadaka]");
const pitchNull = formatPitchBadge(null);
assert.equal(pitchNull, "");
console.log("PASS 11: Pitch badge pill formatting verified.");

// Test 10: Reactive updates from form fields
mockFieldExpression.value = "食べる";
mockFieldReading.value = "たべる";
mockFieldMeaning.value = "to eat";
mockFieldHint.value = "common verb";
mockFieldExampleSentence.value = "朝ご飯を食べる。";
mockFieldExampleTranslation.value = "To eat breakfast.";

updateCardPreview();
assert.ok(mockCardPreviewCard.children.length > 0, "Preview must render when form fields are populated");
const renderedKana = findAll(mockCardPreviewCard, c => c.className === "kn-kana");
assert.equal(renderedKana.length, 1);
assert.equal(renderedKana[0].textContent, "たべる");

console.log("PASS 12: Form field updates reactively reflected in Card Preview.");

console.log("\n>>> ALL STAGE 5.4 CARD PREVIEW TESTS PASSED SUCCESSFULLY! <<<\n");
