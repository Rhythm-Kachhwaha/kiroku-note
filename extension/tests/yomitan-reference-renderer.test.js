const assert = require("node:assert/strict");
const path = require("node:path");

// Mock browser DOM environment
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    tag: tag.toLowerCase(),
    _className: "",
    _textContent: "",
    title: "",
    lang: "",
    open: false,
    colSpan: 1,
    rowSpan: 1,
    scope: "",
    src: "",
    alt: "",
    href: "",
    target: "",
    rel: "",
    style: {},
    children: [],
    attributes: {},
    _listeners: {},
    classList: {
      _classes: new Set(),
      add(...classes) { classes.forEach(c => this._classes.add(c)); },
      remove(...classes) { classes.forEach(c => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node && node.nodeType === 11) { // DocumentFragment
          this.children.push(...node.children);
        } else if (node) {
          this.children.push(node);
        }
      }
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    },
    setAttribute(name, val) {
      this.attributes[name] = String(val);
      if (name === "href") this.href = String(val);
      if (name === "src") this.src = String(val);
      if (name === "title") this.title = String(val);
      if (name.startsWith("data-")) {
        const prop = name.slice(5);
        this.dataset[prop] = String(val);
      }
    },
    getAttribute(name) {
      return this.attributes[name] !== undefined ? this.attributes[name] : (this[name] || null);
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "href") this.href = "";
    },
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event?.type;
      if (this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(event));
      }
      return true;
    },
    dataset: {},
  };

  Object.defineProperty(el, "className", {
    get() {
      if (this.classList._classes.size > 0) {
        return Array.from(this.classList._classes).join(" ");
      }
      return this._className;
    },
    set(val) {
      this._className = String(val);
      this.classList._classes.clear();
      this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList._classes.add(c));
    },
  });

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

function createDocumentFragment() {
  return {
    nodeType: 11,
    children: [],
    append(...nodes) {
      for (const node of nodes) {
        if (node && node.nodeType === 11) {
          this.children.push(...node.children);
        } else if (node) {
          this.children.push(node);
        }
      }
    },
  };
}

global.document = {
  createElement: createMockElement,
  createTextNode: createTextNode,
  createDocumentFragment: createDocumentFragment,
};

const renderer = require("../lib/yomitan-reference-renderer.js");
const { renderNode, renderStructuredContent, isSafeLinkUrl, parseDictionaryLinkQuery, isAllowedStyleProperty, sanitizeStyleValue } = renderer;

// 1. Primitive nodes
{
  const textNode = renderNode("Hello World");
  assert.equal(textNode.nodeType, 3);
  assert.equal(textNode.textContent, "Hello World");

  const numNode = renderNode(42);
  assert.equal(numNode.textContent, "42");

  const nullNode = renderNode(null);
  assert.equal(nullNode.textContent, "");
  console.log("PASS: 1. Primitive string/number/null nodes");
}

// 2. Arrays and DocumentFragments
{
  const fragment = renderNode(["Item 1", " ", "Item 2"]);
  assert.equal(fragment.nodeType, 11);
  assert.equal(fragment.children.length, 3);
  assert.equal(fragment.children[0].textContent, "Item 1");
  console.log("PASS: 2. Array fragments");
}

// 3. Structured Content wrapper
{
  const wrapped = {
    type: "structured-content",
    content: [
      { tag: "span", content: "Inside wrapper" }
    ]
  };
  const rendered = renderNode(wrapped);
  assert.equal(rendered.nodeType, 11);
  assert.equal(rendered.children[0].tag, "span");
  assert.equal(rendered.children[0].textContent, "Inside wrapper");
  console.log("PASS: 3. Structured content wrapper");
}

// 4. Ruby furigana
{
  const rubyNode = {
    tag: "ruby",
    content: [
      "食",
      { tag: "rt", content: "た" },
      { tag: "rp", content: "(" },
      "べ",
      { tag: "rp", content: ")" }
    ]
  };
  const el = renderNode(rubyNode);
  assert.equal(el.tag, "ruby");
  assert.ok(el.classList.contains("yomitan-ruby"));
  assert.equal(el.children.length, 5);
  assert.equal(el.children[1].tag, "rt");
  assert.equal(el.children[1].textContent, "た");
  console.log("PASS: 4. Ruby furigana structure");
}

// 5. Lists (ul, ol, li)
{
  const listNode = {
    tag: "ol",
    content: [
      { tag: "li", content: "First sense" },
      { tag: "li", content: "Second sense" },
    ]
  };
  const el = renderNode(listNode);
  assert.equal(el.tag, "ol");
  assert.equal(el.children.length, 2);
  assert.equal(el.children[0].tag, "li");
  assert.equal(el.children[0].textContent, "First sense");
  console.log("PASS: 5. Lists (ol, ul, li)");
}

// 6. Tables (table, tr, th, td, colSpan, rowSpan, scope)
{
  const tableNode = {
    tag: "table",
    content: [
      {
        tag: "thead",
        content: [
          {
            tag: "tr",
            content: [
              { tag: "th", content: "Form", scope: "col" },
              { tag: "th", content: "Reading", colSpan: 2 }
            ]
          }
        ]
      },
      {
        tag: "tbody",
        content: [
          {
            tag: "tr",
            content: [
              { tag: "td", content: "丁寧語" },
              { tag: "td", content: "たべます", colSpan: 2 }
            ]
          }
        ]
      }
    ]
  };
  const el = renderNode(tableNode);
  assert.equal(el.tag, "table");
  assert.equal(el.children[0].tag, "thead");
  const th1 = el.children[0].children[0].children[0];
  assert.equal(th1.tag, "th");
  assert.equal(th1.scope, "col");
  const th2 = el.children[0].children[0].children[1];
  assert.equal(th2.colSpan, 2);

  const td2 = el.children[1].children[0].children[1];
  assert.equal(td2.colSpan, 2);
  assert.equal(td2.textContent, "たべます");
  console.log("PASS: 6. Tables with colSpan and scope");
}

// 7. Details / Summary with open state
{
  const detailsNode = {
    tag: "details",
    open: true,
    content: [
      { tag: "summary", content: "More details" },
      { tag: "p", content: "Extended conjugation table" }
    ]
  };
  const el = renderNode(detailsNode);
  assert.equal(el.tag, "details");
  assert.equal(el.open, true);
  assert.equal(el.children[0].tag, "summary");
  assert.equal(el.children[0].textContent, "More details");
  console.log("PASS: 7. Collapsible details / summary");
}

// 8. Security: Link Sanitization
{
  assert.equal(isSafeLinkUrl("https://example.com"), true);
  assert.equal(isSafeLinkUrl("http://example.com"), true);
  assert.equal(isSafeLinkUrl("?query=食べる"), true);
  assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
  assert.equal(isSafeLinkUrl("JAVASCRIPT:alert(1)"), false);
  assert.equal(isSafeLinkUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeLinkUrl("vbscript:msgbox"), false);

  const safeLink = renderNode({ tag: "a", href: "https://example.com", content: "Example" });
  assert.equal(safeLink.tag, "a");
  assert.equal(safeLink.href, "https://example.com");
  assert.equal(safeLink.target, "_blank");
  assert.equal(safeLink.rel, "noopener noreferrer");

  const unsafeLink = renderNode({ tag: "a", href: "javascript:alert(1)", content: "Exploit" });
  assert.equal(unsafeLink.tag, "a");
  assert.equal(unsafeLink.href, "");
  assert.ok(unsafeLink.classList.contains("yomitan-inert-link"));
  console.log("PASS: 8. Safe vs unsafe link sanitization");
}

// 9. Internal Dictionary Cross-References
{
  const parsed = parseDictionaryLinkQuery("?query=食べる&primary_reading=たべる");
  assert.deepEqual(parsed, { targetTerm: "食べる", targetReading: "たべる" });

  let clickedTerm = null;
  let clickedReading = null;
  const dictLinkNode = {
    tag: "a",
    href: "?query=飲む&primary_reading=のむ",
    content: "飲む"
  };
  const el = renderNode(dictLinkNode, {
    onDictionaryLinkClick: (term, reading) => {
      clickedTerm = term;
      clickedReading = reading;
    }
  });
  assert.ok(el.classList.contains("yomitan-xref-link"));
  assert.equal(el.title, "Look up: 飲む");

  el.dispatchEvent({ type: "click", preventDefault() {} });
  assert.equal(clickedTerm, "飲む");
  assert.equal(clickedReading, "のむ");
  console.log("PASS: 9. Internal dictionary link callback");
}

// 10. Security: Style Property and Value Sanitization
{
  assert.equal(isAllowedStyleProperty("color"), true);
  assert.equal(isAllowedStyleProperty("fontSize"), true);
  assert.equal(isAllowedStyleProperty("font-size"), true);
  assert.equal(isAllowedStyleProperty("position"), false);
  assert.equal(isAllowedStyleProperty("zIndex"), false);
  assert.equal(isAllowedStyleProperty("z-index"), false);
  assert.equal(isAllowedStyleProperty("behavior"), false);

  assert.equal(sanitizeStyleValue("red"), "red");
  assert.equal(sanitizeStyleValue("14px"), "14px");
  assert.equal(sanitizeStyleValue("url('http://evil.com/leak')"), "");
  assert.equal(sanitizeStyleValue("expression(alert(1))"), "");
  assert.equal(sanitizeStyleValue("red; position: fixed"), "");

  const styledNode = {
    tag: "span",
    style: {
      color: "var(--accent-reading)",
      fontSize: "12px",
      position: "fixed",
      zIndex: "9999",
      backgroundImage: "url(evil.jpg)",
    },
    content: "Styled Text"
  };
  const el = renderNode(styledNode);
  assert.equal(el.style.color, "var(--accent-reading)");
  assert.equal(el.style.fontSize, "12px");
  assert.equal(el.style.position, undefined);
  assert.equal(el.style.zIndex, undefined);
  assert.equal(el.style.backgroundImage, undefined);
  console.log("PASS: 10. Style sanitization");
}

// 11. Data-* Attributes for Semantic Styling Hooks
{
  const nodeWithData = {
    tag: "span",
    data: {
      content: "part-of-speech-info"
    },
    content: "Ichidan verb"
  };
  const el = renderNode(nodeWithData);
  assert.equal(el.getAttribute("data-content"), "part-of-speech-info");
  console.log("PASS: 11. Data-* attributes preservation");
}

// 12. Graceful handling of unknown/unsupported tags without crashing
{
  const unknownNode = {
    tag: "custom-unsupported-tag",
    content: [
      { tag: "span", content: "Safe nested content" }
    ]
  };
  const el = renderNode(unknownNode);
  assert.equal(el.tag, "span");
  assert.ok(el.className.includes("yomitan-fallback-tag"));
  assert.equal(el.textContent, "Safe nested content");
  console.log("PASS: 12. Unsupported tag fallback");
}

// 13. Recursion depth protection
{
  let deepNode = "Deepest string";
  for (let i = 0; i < 40; i++) {
    deepNode = { tag: "div", content: deepNode };
  }
  const el = renderNode(deepNode);
  assert.ok(el !== null);
  console.log("PASS: 13. Recursion depth protection beyond 32 levels");
}

// 14. renderStructuredContent into container
{
  const container = createMockElement("div");
  const result = renderStructuredContent(container, [
    { tag: "p", content: "First paragraph" },
    { tag: "p", content: "Second paragraph" }
  ]);
  assert.equal(container.children.length, 1);
  assert.ok(container.children[0].classList.contains("yomitan-reference-content"));
  assert.equal(container.children[0].children.length, 2);
  console.log("PASS: 14. renderStructuredContent into container");
}

console.log("\nALL YOMITAN REFERENCE RENDERER TESTS PASSED SUCCESSFULLY!");
