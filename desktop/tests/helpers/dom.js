/**
 * Minimal lightweight fake DOM helper for testing desktop components without jsdom.
 */

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.style = {};
    this.classList = new Set();
    this.classList.add = (c) => Set.prototype.add.call(this.classList, c);
    this.classList.remove = (c) => Set.prototype.delete.call(this.classList, c);
    this.classList.contains = (c) => Set.prototype.has.call(this.classList, c);
    this.classList.toggle = (c) => this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c);
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.innerHTML = '';
    this.textContent = '';
    this.listeners = new Map();
  }

  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event?.type);
    if (list) list.forEach((fn) => fn(event));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  querySelector(selector) {
    return this.children.find((c) => (c.tagName && selector.toUpperCase().includes(c.tagName))) || null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
  }
}

function setupFakeDOM() {
  const documentListeners = new Map();
  const doc = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => new FakeElement('div'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    removeEventListener: (type, listener) => {
      const list = documentListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    },
    hidden: false
  };

  const win = {
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const originalDoc = globalThis.document;
  const originalWin = globalThis.window;

  globalThis.document = doc;
  globalThis.window = win;

  return {
    document: doc,
    window: win,
    restore() {
      if (originalDoc !== undefined) globalThis.document = originalDoc;
      else delete globalThis.document;
      if (originalWin !== undefined) globalThis.window = originalWin;
      else delete globalThis.window;
    }
  };
}

module.exports = {
  FakeElement,
  setupFakeDOM
};
