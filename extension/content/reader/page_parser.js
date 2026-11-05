/**
 * Kiroku Note - Webpage Reader & In-Situ DOM Hover Parser
 * Wraps Japanese webpage text in interactive chips with dictionary gloss cards.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.KirokuPageParser = exports;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

  function injectReaderStyles() {
    if (typeof document === "undefined" || document.getElementById("kiroku-web-reader-styles")) return;
    const style = document.createElement("style");
    style.id = "kiroku-web-reader-styles";
    style.textContent = `
      .kiroku-web-chip {
        display: inline-block;
        padding: 0 0.15em;
        margin: 0 0.05em;
        border-radius: 3px;
        cursor: pointer;
        transition: background-color 150ms ease, box-shadow 150ms ease;
        border-bottom: 1.5px dotted rgba(0, 0, 0, 0.3);
      }
      .kiroku-web-chip:hover {
        background-color: rgba(0, 209, 178, 0.2);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
      }
    `;
    if (document.head) {
      document.head.appendChild(style);
    }
  }

  class PageParser {
    constructor(options = {}) {
      this.apiBase = options.apiBase || "http://127.0.0.1:21828";
      this.activeChip = null;
      this.glossCard = null;
      injectReaderStyles();
    }

    isJapaneseText(str) {
      return JAPANESE_CHAR_REGEX.test(str || "");
    }

    createChip(surface, reading = "", status = "unstyled") {
      const chip = document.createElement("span");
      chip.className = `kiroku-web-chip is-${status}`;
      chip.dataset.surface = surface;
      if (reading) chip.dataset.reading = reading;
      chip.textContent = surface;
      return chip;
    }

    parseTextNode(textNode) {
      if (!textNode || !textNode.nodeValue) return [];
      const text = textNode.nodeValue.trim();
      if (!this.isJapaneseText(text)) return [];

      // Split into word segments (kanji compounds, kana chunks, or punctuation)
      const tokens = text.match(/[\u4e00-\u9faf]+|[\u3040-\u309f]+|[\u30a0-\u30ff]+|[^\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\s]+|\s+/g) || [];
      const fragment = document.createDocumentFragment();

      for (const tok of tokens) {
        if (this.isJapaneseText(tok)) {
          const chip = this.createChip(tok);
          fragment.appendChild(chip);
        } else {
          fragment.appendChild(document.createTextNode(tok));
        }
      }

      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
      }
      return tokens;
    }

    parseContainer(container) {
      if (!container || !container.childNodes) return;
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (["script", "style", "noscript", "textarea", "input"].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest(".kiroku-web-chip, .kiroku-gloss-card")) {
              return NodeFilter.FILTER_REJECT;
            }
            return JAPANESE_CHAR_REGEX.test(node.nodeValue || "")
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
        }
      );

      const nodes = [];
      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }

      for (const node of nodes) {
        this.parseTextNode(node);
      }
    }
  }

  return {
    PageParser,
    JAPANESE_CHAR_REGEX
  };
});
