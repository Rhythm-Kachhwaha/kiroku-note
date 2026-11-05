const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { getSidepanelSource } = require("./source.js");

const ROOT_DIR = path.resolve(__dirname, "../../..");
const HTML_PATH = path.join(ROOT_DIR, "extension", "sidepanel", "sidepanel.html");

class MockElement {
  constructor(tag = "div", id = "", className = "") {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.attributes = {};
    this._listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.value = "";
    this.innerHTML = "";
    this.style = {};
    this.classList = {
      add: (...cls) => {
        const set = new Set(this.className.split(" ").filter(Boolean));
        cls.forEach(c => set.add(c));
        this.className = Array.from(set).join(" ");
      },
      remove: (...cls) => {
        const set = new Set(this.className.split(" ").filter(Boolean));
        cls.forEach(c => set.delete(c));
        this.className = Array.from(set).join(" ");
      },
      contains: (c) => this.className.split(" ").filter(Boolean).includes(c),
      toggle: (c, force) => {
        if (force !== undefined) {
          if (force) this.classList.add(c);
          else this.classList.remove(c);
          return force;
        }
        if (this.classList.contains(c)) {
          this.classList.remove(c);
          return false;
        }
        this.classList.add(c);
        return true;
      }
    };
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child) {
    if (child.parentElement) {
      const idx = child.parentElement.children.indexOf(child);
      if (idx !== -1) child.parentElement.children.splice(idx, 1);
    }
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...items) {
    for (const item of items) {
      if (typeof item === "string") {
        const textNode = new MockElement("#text");
        textNode.textContent = item;
        this.appendChild(textNode);
      } else if (item) {
        this.appendChild(item);
      }
    }
  }

  prepend(...items) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (typeof item === "string") {
        const textNode = new MockElement("#text");
        textNode.textContent = item;
        this.children.unshift(textNode);
      } else if (item) {
        this.children.unshift(item);
      }
    }
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
      child.parentNode = null;
    }
    return child;
  }

  replaceChild(newChild, oldChild) {
    const idx = this.children.indexOf(oldChild);
    if (idx !== -1) {
      this.children.splice(idx, 1, newChild);
      oldChild.parentElement = null;
      oldChild.parentNode = null;
      newChild.parentElement = this;
      newChild.parentNode = this;
    }
    return oldChild;
  }

  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  }

  dispatchEvent(event) {
    const handlers = this._listeners[event.type || event] || [];
    const evt = typeof event === "string" ? { type: event, target: this, defaultPrevented: false } : event;
    evt.target = evt.target || this;
    for (const h of handlers) {
      h.call(this, evt);
    }
    return !evt.defaultPrevented;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this, defaultPrevented: false });
  }

  querySelector(sel) {
    const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
    if (idMatch) {
      const targetId = idMatch[1];
      const search = (node) => {
        if (node.id === targetId) return node;
        for (const c of node.children) {
          const found = search(c);
          if (found) return found;
        }
        return null;
      };
      return search(this);
    }
    return null;
  }

  querySelectorAll(sel) {
    return [];
  }

  closest(sel) {
    return null;
  }
}

function createBootEnvironment(options = {}) {
  const elementsById = new Map();

  // Pre-seed elements from sidepanel.html if available
  if (fs.existsSync(HTML_PATH)) {
    const html = fs.readFileSync(HTML_PATH, "utf8");
    const idRegex = /id="([a-zA-Z0-9_-]+)"/g;
    let m;
    while ((m = idRegex.exec(html)) !== null) {
      const id = m[1];
      if (!elementsById.has(id)) {
        elementsById.set(id, new MockElement("div", id));
      }
    }
  }

  function getOrCreateElement(id) {
    if (!elementsById.has(id)) {
      elementsById.set(id, new MockElement("div", id));
    }
    return elementsById.get(id);
  }

  const mockStorage = {
    _data: {},
    get: (keys, cb) => {
      const result = {};
      if (typeof keys === "string") {
        result[keys] = mockStorage._data[keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(k => { result[k] = mockStorage._data[k]; });
      } else if (keys && typeof keys === "object") {
        Object.keys(keys).forEach(k => {
          result[k] = mockStorage._data[k] !== undefined ? mockStorage._data[k] : keys[k];
        });
      }
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set: (items, cb) => {
      Object.assign(mockStorage._data, items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      arr.forEach(k => delete mockStorage._data[k]);
      if (cb) cb();
      return Promise.resolve();
    }
  };

  const mockChrome = {
    runtime: {
      id: "test-extension-id",
      sendMessage: () => Promise.resolve({ ok: true }),
      onMessage: {
        addListener: () => {},
        removeListener: () => {}
      },
      getURL: (p) => `chrome-extension://test/${p}`
    },
    storage: {
      local: mockStorage,
      session: mockStorage,
      onChanged: {
        addListener: () => {},
        removeListener: () => {}
      }
    },
    tabs: {
      query: (q, cb) => {
        const tabs = [{ id: 1, url: "https://example.com" }];
        if (cb) cb(tabs);
        return Promise.resolve(tabs);
      },
      sendMessage: () => Promise.resolve({ ok: true })
    },
    sidePanel: {
      setOptions: () => Promise.resolve()
    }
  };

  const sandbox = {
    chrome: mockChrome,
    document: {
      getElementById: (id) => getOrCreateElement(id),
      querySelector: (sel) => {
        if (!sel) return null;
        const idMatch = sel.match(/^#([a-zA-Z0-9_-]+)$/);
        if (idMatch) return getOrCreateElement(idMatch[1]);
        return new MockElement("div");
      },
      querySelectorAll: () => [],
      createElement: (tag) => new MockElement(tag),
      createTextNode: (text) => text,
      addEventListener: () => {},
      removeEventListener: () => {},
      body: new MockElement("body"),
      documentElement: new MockElement("html"),
      title: "Kiroku Note"
    },
    window: {
      location: { href: "chrome-extension://test/sidepanel.html" },
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      },
      requestAnimationFrame: (cb) => setTimeout(cb, 16),
      cancelAnimationFrame: (id) => clearTimeout(id)
    },
    navigator: {
      clipboard: {
        writeText: async () => true,
        readText: async () => ""
      },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({})
    }),
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    },
    setTimeout: (cb, ms) => {
      const t = setTimeout(cb, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout,
    setInterval: (cb, ms) => {
      const t = setInterval(cb, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearInterval,
    module: { exports: {} },
    elementsById
  };

  return sandbox;
}

function runSidepanelInVm(sandbox = createBootEnvironment()) {
  const code = getSidepanelSource();
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

module.exports = {
  MockElement,
  createBootEnvironment,
  runSidepanelInVm
};
