/**
 * Kiroku Note - Generic Yomitan Structured-Content Renderer
 *
 * Transforms Yomitan term-bank structured-content AST into safe DOM nodes.
 * Strictly adheres to security rules:
 * - Zero innerHTML injection (DOM API only: createElement, createTextNode)
 * - Strict tag whitelist
 * - Safe style property and value sanitization
 * - Safe URL scheme enforcement (blocks javascript:, data:, etc.)
 * - Internal dictionary link support with cross-reference navigation
 * - Graceful fallback on unsupported or malformed nodes
 *
 * Runs in both browser extension environment and Node.js test environments.
 */

(() => {
  "use strict";

  const MAX_RECURSION_DEPTH = 32;

  // Whitelist of allowed HTML tags in Yomitan structured content
  const ALLOWED_TAGS = new Set([
    "span",
    "div",
    "p",
    "br",
    "hr",
    "ruby",
    "rt",
    "rp",
    "ol",
    "ul",
    "li",
    "details",
    "summary",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "a",
    "img",
    "em",
    "strong",
    "b",
    "i",
    "u",
    "s",
    "small",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "q",
  ]);

  // Whitelist of allowed CSS style properties in structured content
  const ALLOWED_STYLE_PROPERTIES = new Set([
    "color",
    "backgroundColor",
    "background-color",
    "fontSize",
    "font-size",
    "fontWeight",
    "font-weight",
    "fontStyle",
    "font-style",
    "textDecoration",
    "text-decoration",
    "textDecorationLine",
    "text-decoration-line",
    "textAlign",
    "text-align",
    "verticalAlign",
    "vertical-align",
    "lineHeight",
    "line-height",
    "whiteSpace",
    "white-space",
    "wordBreak",
    "word-break",
    "margin",
    "marginTop",
    "margin-top",
    "marginBottom",
    "margin-bottom",
    "marginLeft",
    "margin-left",
    "marginRight",
    "margin-right",
    "padding",
    "paddingTop",
    "padding-top",
    "paddingBottom",
    "padding-bottom",
    "paddingLeft",
    "padding-left",
    "paddingRight",
    "padding-right",
    "border",
    "borderColor",
    "border-color",
    "borderWidth",
    "border-width",
    "borderStyle",
    "border-style",
    "borderRadius",
    "border-radius",
    "display",
    "opacity",
    "listStyleType",
    "list-style-type",
  ]);

  // Regex to detect dangerous tokens in style values
  const DANGEROUS_STYLE_VALUE_REGEX = /(url\s*\(|javascript\s*:|expression\s*\(|@import|-webkit-image-set)/i;

  /**
   * Check if a CSS style property is permitted.
   * @param {string} prop
   * @returns {boolean}
   */
  function isAllowedStyleProperty(prop) {
    if (!prop || typeof prop !== "string") return false;
    return ALLOWED_STYLE_PROPERTIES.has(prop) || ALLOWED_STYLE_PROPERTIES.has(prop.toLowerCase());
  }

  /**
   * Sanitize a style value. Returns empty string if dangerous.
   * @param {string|number} value
   * @returns {string}
   */
  function sanitizeStyleValue(value) {
    if (typeof value === "number") return String(value);
    if (!value || typeof value !== "string") return "";
    const str = value.trim();
    if (DANGEROUS_STYLE_VALUE_REGEX.test(str)) return "";
    // Block semicolons or braces that could attempt rule breakout
    if (/[;{}]/.test(str)) return "";
    return str;
  }

  /**
   * Safely apply allowed style properties to an HTMLElement.
   * @param {HTMLElement} el
   * @param {Object|string} styleObj
   */
  function applyStyles(el, styleObj) {
    if (!el || !styleObj) return;
    if (typeof styleObj === "object" && styleObj !== null) {
      for (const [prop, val] of Object.entries(styleObj)) {
        if (isAllowedStyleProperty(prop)) {
          const safeVal = sanitizeStyleValue(val);
          if (safeVal) {
            try {
              el.style[prop] = safeVal;
            } catch {
              // Ignore invalid property assignment in mock/strict environments
            }
          }
        }
      }
    }
  }

  /**
   * Determine if a URL is safe for an <a> link.
   * @param {string} url
   * @returns {boolean}
   */
  function isSafeLinkUrl(url) {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("?") || trimmed.startsWith("/")) {
      return true;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
      return false;
    }
    return (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("yomitan:")
    );
  }

  /**
   * Parse internal dictionary query params from a Yomitan internal link href.
   * e.g. "?query=食べる&primary_reading=たべる" or "yomitan://search?query=食べる"
   * @param {string} href
   * @returns {{ targetTerm: string, targetReading: string } | null}
   */
  function parseDictionaryLinkQuery(href) {
    if (!href || typeof href !== "string") return null;
    const queryIdx = href.indexOf("?");
    if (queryIdx === -1) return null;
    const queryString = href.slice(queryIdx + 1);
    const params = new URLSearchParams(queryString);
    const query = params.get("query") || params.get("term") || "";
    const reading = params.get("primary_reading") || params.get("reading") || "";
    if (!query && !reading) return null;
    return { targetTerm: query.trim(), targetReading: reading.trim() };
  }

  /**
   * Safely resolve the active document instance.
   * @param {Object} [options]
   * @returns {Document|Object|null}
   */
  function getDoc(options) {
    if (options && options.document) return options.document;
    if (typeof document !== "undefined") return document;
    if (typeof globalThis !== "undefined" && globalThis.document) return globalThis.document;
    return null;
  }

  /**
   * Main recursive node rendering function.
   *
   * @param {any} node - String, array, or structured-content object
   * @param {Object} options - Configuration and callbacks
   * @param {Function} [options.onDictionaryLinkClick] - Callback for internal dictionary links: (term, reading, e)
   * @param {Function} [options.onInsertSense] - Callback for quick-inserting sense meaning
   * @param {number} [depth=0] - Recursion depth guard
   * @returns {Node}
   */
  function renderNode(node, options = {}, depth = 0) {
    const doc = getDoc(options);
    if (!doc) return null;

    if (depth > MAX_RECURSION_DEPTH) {
      return doc.createTextNode("");
    }

    // 1. Primitive string / number / boolean handling
    if (typeof node === "string") {
      return doc.createTextNode(node);
    }
    if (typeof node === "number" || typeof node === "boolean") {
      return doc.createTextNode(String(node));
    }
    if (node === null || node === undefined) {
      return doc.createTextNode("");
    }

    // 2. Array / fragment handling
    if (Array.isArray(node)) {
      const fragment = doc.createDocumentFragment();
      for (const item of node) {
        const childNode = renderNode(item, options, depth + 1);
        if (childNode) {
          fragment.append(childNode);
        }
      }
      return fragment;
    }

    // 3. Structured content wrapper: { type: "structured-content", content: ... }
    if (typeof node === "object" && node.type === "structured-content" && "content" in node) {
      return renderNode(node.content, options, depth + 1);
    }

    // 4. Structured tag node: { tag: "...", content: ... }
    if (typeof node === "object") {
      const rawTag = typeof node.tag === "string" ? node.tag.toLowerCase().trim() : "";
      const isAllowed = ALLOWED_TAGS.has(rawTag);
      const tag = isAllowed ? rawTag : (node.content ? "span" : null);

      if (!tag) {
        // Unknown or empty node: try extracting text if any
        if (node.content) {
          return renderNode(node.content, options, depth + 1);
        }
        return doc.createTextNode("");
      }

      // Safe DOM element creation
      const el = doc.createElement(tag);

      // Add scoping class for CSS rules
      if (rawTag && rawTag !== tag) {
        el.className = `yomitan-fallback-tag yomitan-tag-${rawTag}`;
      } else if (rawTag) {
        el.classList.add(`yomitan-${rawTag}`);
      }

      // Apply data-* attributes for semantic styling hooks (e.g. data-content="part-of-speech-info")
      if (typeof node.data === "object" && node.data !== null) {
        for (const [key, val] of Object.entries(node.data)) {
          if (key && typeof key === "string" && val !== undefined && val !== null) {
            const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
            if (cleanKey) {
              try {
                el.setAttribute(`data-${cleanKey}`, String(val));
              } catch {
                // Ignore attribute error in restricted environments
              }
            }
          }
        }
      }

      // Apply title / tooltip if present
      if (typeof node.title === "string" && node.title.trim()) {
        el.title = node.title.trim();
      }

      // Apply language code if present
      if (typeof node.lang === "string" && node.lang.trim()) {
        el.lang = node.lang.trim();
      }

      // Apply safe styles
      if (node.style) {
        applyStyles(el, node.style);
      }

      // Table cell attributes
      if (tag === "td" || tag === "th") {
        if (typeof node.colSpan === "number" && node.colSpan > 1) {
          el.colSpan = Math.min(node.colSpan, 50);
        }
        if (typeof node.rowSpan === "number" && node.rowSpan > 1) {
          el.rowSpan = Math.min(node.rowSpan, 50);
        }
        if (tag === "th" && typeof node.scope === "string") {
          const scope = node.scope.toLowerCase().trim();
          if (["row", "col", "rowgroup", "colgroup"].includes(scope)) {
            el.scope = scope;
          }
        }
      }

      // Details open state
      if (tag === "details") {
        if (node.open || node.collapsed === false) {
          el.open = true;
        }
      }

      // Image tag handling
      if (tag === "img") {
        const rawSrc = node.src || node.path || "";
        const altText = node.alt || node.title || "Dictionary Image";
        el.alt = altText;
        if (rawSrc && (rawSrc.startsWith("http://") || rawSrc.startsWith("https://") || rawSrc.startsWith("data:image/"))) {
          el.src = rawSrc;
        } else {
          // Local/unresolvable dictionary package image: render a subtle indicator rather than a broken image icon
          el.classList.add("yomitan-img-placeholder");
          el.title = altText;
        }
        if (node.width) el.width = node.width;
        if (node.height) el.height = node.height;
        return el;
      }

      // Link <a> tag handling with security & cross-reference interception
      if (tag === "a") {
        const href = typeof node.href === "string" ? node.href : "";
        if (isSafeLinkUrl(href)) {
          const dictQuery = parseDictionaryLinkQuery(href);
          if (dictQuery) {
            // Internal dictionary link (cross-reference)
            el.classList.add("yomitan-xref-link");
            el.href = href;
            el.title = `Look up: ${dictQuery.targetTerm}`;
            el.addEventListener("click", (e) => {
              if (e && e.preventDefault) e.preventDefault();
              if (typeof options.onDictionaryLinkClick === "function") {
                options.onDictionaryLinkClick(dictQuery.targetTerm, dictQuery.targetReading, e);
              }
            });
          } else {
            // Safe external link
            el.href = href;
            el.target = "_blank";
            el.rel = "noopener noreferrer";
          }
        } else {
          // Unsafe link: convert to inert span representation
          el.removeAttribute("href");
          el.classList.add("yomitan-inert-link");
        }
      }

      // Recursively render child content
      if (node.content !== undefined && node.content !== null) {
        const childDom = renderNode(node.content, options, depth + 1);
        if (childDom) {
          el.append(childDom);
        }
      }

      return el;
    }

    return doc ? doc.createTextNode("") : null;
  }

  /**
   * Render Yomitan structured content items into a container element.
   *
   * @param {HTMLElement} container - Destination DOM node
   * @param {any|any[]} content - Structured content or array of structured content items
   * @param {Object} [options={}] - Rendering options (e.g. onDictionaryLinkClick)
   * @returns {HTMLElement} The populated container
   */
  function renderStructuredContent(container, content, options = {}) {
    if (!container) return null;
    const doc = getDoc(options);
    if (!doc) return null;
    const wrapper = doc.createElement("div");
    wrapper.className = "yomitan-reference-content";

    if (content !== undefined && content !== null) {
      const items = Array.isArray(content) ? content : [content];
      for (const item of items) {
        const rendered = renderNode(item, options, 0);
        if (rendered) {
          wrapper.append(rendered);
        }
      }
    }

    container.append(wrapper);
    return wrapper;
  }

  const exportObj = {
    renderNode,
    renderStructuredContent,
    isSafeLinkUrl,
    parseDictionaryLinkQuery,
    isAllowedStyleProperty,
    sanitizeStyleValue,
    ALLOWED_TAGS,
    ALLOWED_STYLE_PROPERTIES,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportObj;
  }
  if (typeof window !== "undefined") {
    window.YomitanReferenceRenderer = exportObj;
  }
})();
