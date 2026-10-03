/**
 * Test Suite: Markdown Table & AI Response Renderer
 * Verifies table parsing, horizontally scrollable container, XSS safety, code blocks, lists, and formatting.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

// Setup minimal mock environment to execute sidepanel.js
function createMockSidepanel() {
  const fakeElement = () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    appendChild: () => {},
    append: () => {},
    prepend: () => {},
    remove: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    hidden: false,
    value: "",
    textContent: "",
    innerHTML: "",
  });

  const sandbox = {
    document: {
      querySelector: () => fakeElement(),
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
      body: fakeElement(),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    console,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
  };

  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return sandbox.module.exports;
}

const sidepanel = createMockSidepanel();
const { formatAIResponse } = sidepanel;

test("Markdown Renderer: Table Rendering with Header and Data Rows", () => {
  const input = [
    "| Grammar Pattern | Meaning | Example |",
    "| --- | --- | --- |",
    "| ～ために | In order to / For the benefit of | 日本へ行くために貯金している |",
    "| ～ように | So that / In such a way that | 聞こえるように話してください |",
  ].join("\n");

  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes('<div class="ai-table-wrap">'), "Must wrap table in .ai-table-wrap container");
  assert.ok(rendered.includes('<table class="ai-table">'), "Must render table with .ai-table class");
  assert.ok(rendered.includes("<thead><tr><th>Grammar Pattern</th><th>Meaning</th><th>Example</th></tr></thead>"), "Must render thead correctly");
  assert.ok(rendered.includes("<tbody>"), "Must render tbody");
  assert.ok(rendered.includes("<td>～ために</td>"), "Must render first row first column");
  assert.ok(rendered.includes("<td>聞こえるように話してください</td>"), "Must render second row third column");
  // Must NOT contain unparsed raw pipe syntax
  assert.equal(rendered.includes("--- | ---"), false, "Must not display raw markdown separator");
});

test("Markdown Renderer: Table with Inline Formatting (Bold & Code)", () => {
  const input = [
    "| Option | Status | Note |",
    "|:---|:---:|---:|",
    "| **A** | `Incorrect` | Means *water* |",
    "| **B** | `Correct` | Correct context |",
  ].join("\n");

  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes("<strong>A</strong>"), "Must parse bold inside table cell");
  assert.ok(rendered.includes('<code class="ai-inline-code">Incorrect</code>'), "Must parse inline code inside table cell");
  assert.ok(rendered.includes("<em>water</em>"), "Must parse italics inside table cell");
});

test("Markdown Renderer: Bold-first paragraphs, emphasis markers, and bullets", () => {
  const input = [
    "**Important:** Keep *these words* readable.",
    "***Combined emphasis*** and **bold with *nested emphasis***.",
    "* A real bullet item",
  ].join("\n");

  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes("<p><strong>Important:</strong> Keep <em>these words</em> readable.</p>"));
  assert.ok(rendered.includes("<strong><em>Combined emphasis</em></strong>"));
  assert.ok(rendered.includes("<strong>bold with <em>nested emphasis</em></strong>"));
  assert.ok(rendered.includes('<ul class="ai-distractor-list"><li>A real bullet item</li></ul>'));
});

test("Markdown Renderer: Recovers mismatched asterisk emphasis", () => {
  const input = "*寝る** – 主に「横になる」意味。 **眠る* is also used. ***大切***。";
  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes("<strong>寝る</strong> – 主に「横になる」意味。"));
  assert.ok(rendered.includes("<strong>眠る</strong> is also used."));
  assert.ok(rendered.includes("<strong><em>大切</em></strong>。"));
  assert.equal(rendered.includes("*寝る**"), false);
  assert.equal(rendered.includes("**眠る*"), false);
});

test("Markdown Renderer: Does not treat malformed star emphasis as a bullet", () => {
  const input = "* 寝る** – meaning one.\n* 眠る** – meaning two.\n* Key difference**: action versus state.";
  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes("<p><strong>寝る</strong> – meaning one.</p>"));
  assert.ok(rendered.includes("<p><strong>眠る</strong> – meaning two.</p>"));
  assert.ok(rendered.includes("<p><strong>Key difference</strong>: action versus state.</p>"));
  assert.equal(rendered.includes('<ul class="ai-distractor-list">'), false);
});

test("Markdown Renderer: XSS Sanitization & HTML Escaping", () => {
  const maliciousInput = [
    '<script>alert("xss")</script>',
    '<img src="x" onerror="alert(1)">',
    "| Malicious | Script |",
    "| --- | --- |",
    '| <script>evil()</script> | <b onclick="evil()">Click</b> |',
  ].join("\n");

  const rendered = formatAIResponse(maliciousInput);

  assert.equal(rendered.includes("<script>"), false, "Must not allow unescaped <script> tag");
  assert.equal(rendered.includes("<img src="), false, "Must not allow unescaped <img> tag");
  assert.ok(rendered.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"), "Must escape malicious script into HTML entities");
  assert.ok(rendered.includes("&lt;script&gt;evil()&lt;/script&gt;"), "Must escape malicious table cells");
});

test("Markdown Renderer: Direct Answer Badge", () => {
  const input = "Correct: b. 両替\n\nExplanation follows.";
  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes('<div class="ai-direct-answer">'), "Must format direct answer card");
  assert.ok(rendered.includes('<span class="answer-badge">ANSWER</span>'), "Must include ANSWER badge");
  assert.ok(rendered.includes("<strong>b. 両替</strong>"), "Must bold answer value");
});

test("Markdown Renderer: Code Blocks", () => {
  const input = "```japanese\n食べた -> 食べない\n```";
  const rendered = formatAIResponse(input);
  const inlineCode = formatAIResponse("Keep `*literal**` unchanged.");

  assert.ok(rendered.includes('<pre class="ai-code-block"><code>'), "Must format code blocks");
  assert.ok(rendered.includes("食べた -&gt; 食べない"), "Must escape content inside code block");
  assert.ok(inlineCode.includes('<code class="ai-inline-code">*literal**</code>'));
});

test("Markdown Renderer: Distractor List and Section Titles", () => {
  const input = [
    "Distractors:",
    "- a. 両側: means both sides",
    "- c. 両方: means both parties",
  ].join("\n");

  const rendered = formatAIResponse(input);

  assert.ok(rendered.includes('<div class="ai-section-title">Distractors</div>'), "Must format section title");
  assert.ok(rendered.includes('<ul class="ai-distractor-list">'), "Must format distractor list");
  assert.ok(rendered.includes("<li>a. 両側: means both sides</li>"), "Must format list item");
});

test("CSS Verification: Table Container is Horizontally Scrollable", () => {
  assert.ok(css.includes(".ai-table-wrap"), "CSS must style .ai-table-wrap");
  assert.ok(css.includes("overflow-x: auto"), ".ai-table-wrap must have overflow-x: auto");
  assert.ok(css.includes(".ai-table"), "CSS must style .ai-table");
});

test("CSS Verification: AI replies and tables use readable neutral typography", () => {
  const replyStyles = css.match(/\.chat-message\.ai-msg \.chat-msg-body\s*\{([^}]*)\}/)?.[1] || "";
  const tableStyles = css.match(/\.ai-table\s*\{([^}]*)\}/)?.[1] || "";
  const headerStyles = css.match(/\.ai-table th\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(replyStyles, /font-size:\s*16px/);
  assert.match(replyStyles, /width:\s*100%/);
  assert.match(tableStyles, /font-size:\s*14px/);
  assert.match(headerStyles, /font-weight:\s*700/);
  assert.match(headerStyles, /background:\s*transparent/);
});
