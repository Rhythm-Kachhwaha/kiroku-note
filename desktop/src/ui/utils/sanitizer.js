/**
 * Kiroku Note Desktop — HTML Sanitizer & Security Utilities
 * Zero-dependency escaping and strict allowlist markup sanitizer for JLPT prompts & cards.
 */

/**
 * Escapes characters with special meaning in HTML to prevent XSS.
 * @param {any} val Value to escape
 * @returns {string} Safe HTML string
 */
export function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_TAGS = new Set([
  'RUBY', 'RT', 'RP', 'U', 'B', 'STRONG', 'EM', 'I', 'BR', 'SPAN', 'P', 'DIV', 'SUB', 'SUP'
]);

const ALLOWED_CLASSES = new Set([
  'star', 'blank', 'prompt-text', 'ruby-text', 'blank-slot', 'question-anchor',
  'font-japanese', 'text-gold', 'text-muted'
]);

/**
 * Strict allowlist sanitizer for JLPT question prompts and pedagogical markup.
 * Retains safe furigana (<ruby>), underlines, asterisks, and blanks while stripping
 * scripts, iframes, inline event handlers, and unknown tags.
 *
 * @param {string} markup Raw prompt markup
 * @returns {string} Sanitized HTML safe for DOM insertion
 */
export function sanitizePromptMarkup(markup) {
  if (!markup) return '';
  if (typeof markup !== 'string') return escapeHtml(String(markup));

  // Fallback if running outside DOM environment (e.g. Node tests without DOMParser)
  if (typeof DOMParser === 'undefined') {
    return markup
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<(?!\/?(ruby|rt|rp|u|b|strong|em|i|br|span|p|div|sub|sup)\b)[^>]*>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${markup}</body>`, 'text/html');

  function sanitizeNode(node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          const textNode = doc.createTextNode(child.textContent || '');
          node.replaceChild(textNode, child);
          continue;
        }

        // Strip dangerous attributes, keeping only allowlisted classes
        const attrs = Array.from(child.attributes);
        for (const attr of attrs) {
          const attrName = attr.name.toLowerCase();
          if (attrName === 'class') {
            const safeClasses = attr.value
              .split(/\s+/)
              .filter(cls => ALLOWED_CLASSES.has(cls))
              .join(' ');
            if (safeClasses) {
              child.setAttribute('class', safeClasses);
            } else {
              child.removeAttribute('class');
            }
          } else {
            child.removeAttribute(attr.name);
          }
        }

        sanitizeNode(child);
      } else {
        node.removeChild(child);
      }
    }
  }

  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

