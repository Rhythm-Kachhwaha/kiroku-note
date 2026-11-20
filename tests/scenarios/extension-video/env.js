const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "../../..");
const helpersSource = require(path.join(ROOT_DIR, "extension", "tests", "helpers", "source.js"));
const videoMiningSrc = helpersSource.getVideoMiningSource();

function createMockEnvironment({
  isIframe = false,
  isHiAnime = true,
  initialPosition = null,
  subtitlesDisplayEnabled = true,
  customStorage = {}
} = {}) {
  const sentMessages = [];
  const runtimeMessageListeners = [];
  const eventListeners = {};
  const docEventListeners = {};
  const winEventListeners = {};

  const storageState = {
    subtitle_overlay_position: initialPosition || null,
    subtitles_display_enabled: subtitlesDisplayEnabled,
    ...customStorage
  };

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        if (msg.type === "GET_MINING_MODE") return Promise.resolve({ enabled: true });
        if (msg.type === "CAPTURE_VIDEO_FRAME") {
          return Promise.resolve({ ok: true, dataUrl: "data:image/jpeg;base64,mockTabCapture123" });
        }
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener: (handler) => runtimeMessageListeners.push(handler)
      }
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { res[k] = storageState[k]; });
          } else if (typeof keys === "string") {
            res[keys] = storageState[keys];
          } else if (keys && typeof keys === "object") {
            for (const k of Object.keys(keys)) {
              res[k] = storageState[k] !== undefined ? storageState[k] : keys[k];
            }
          } else {
            Object.assign(res, storageState);
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items, cb) => {
          Object.assign(storageState, items);
          if (eventListeners.storageChanged) {
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { newValue: v };
            }
            eventListeners.storageChanged.forEach(fn => fn(changes, "local"));
          }
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          arr.forEach(k => delete storageState[k]);
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: (handler) => {
          if (!eventListeners.storageChanged) eventListeners.storageChanged = [];
          eventListeners.storageChanged.push(handler);
        }
      }
    }
  };

  let currentSelection = "";

  class MockElement {
    constructor(tagName, id = "") {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = "";
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this._textContent = "";
      this._attrs = {};
      this._listeners = {};
      this.isConnected = true;
      this.rect = { top: 100, left: 50, width: 800, height: 450 };
      this.isContentEditable = false;
    }

    get textContent() {
      if (this.children.length > 0) return this.children.map(c => c.textContent).join("");
      return this._textContent || "";
    }

    set textContent(val) {
      this._textContent = val;
    }

    appendChild(child) {
      if (!child) return child;
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    }

    replaceChildren(...newChildren) {
      for (const child of this.children) {
        child.parentElement = null;
      }
      this.children = [];
      this._textContent = "";
      for (const c of newChildren) {
        if (typeof c === "string") {
          this._textContent += c;
        } else if (c) {
          this.appendChild(c);
        }
      }
    }

    append(...items) {
      for (const it of items) {
        if (typeof it === "string") {
          this.appendChild(new MockElement("#text", it));
        } else if (it) {
          this.appendChild(it);
        }
      }
    }

    contains(el) {
      let cur = el;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    closest(selector) {
      let cur = this;
      const match = (el) => {
        if (!el) return false;
        const selLower = selector.toLowerCase();
        if (selLower.startsWith("#") && el.id && `#${el.id.toLowerCase()}` === selLower) return true;
        if (selLower.startsWith(".") && el.className && el.className.toLowerCase().split(/\s+/).includes(selLower.slice(1))) return true;
        const parts = selLower.split(/,\s*/);
        for (const p of parts) {
          if (p.startsWith("#") && el.id && `#${el.id.toLowerCase()}` === p) return true;
          if (p.startsWith(".") && el.className && el.className.toLowerCase().split(/\s+/).includes(p.slice(1))) return true;
          if (p.startsWith("[role=") || p.startsWith("[role='") || p.startsWith("[role=\"")) {
            const roleMatch = p.match(/role=['"]?([^'"\]]+)/);
            if (roleMatch && el.getAttribute && el.getAttribute("role") === roleMatch[1]) return true;
          }
          if (p.startsWith("[contenteditable") && el.getAttribute && el.getAttribute("contenteditable")) return true;
          if (el.tagName && el.tagName.toLowerCase() === p) return true;
        }
        return false;
      };
      while (cur) {
        if (match(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    }

    querySelectorAll(selector) {
      const results = [];
      const match = (el) => {
        if (!el) return false;
        const selLower = selector.toLowerCase();
        if (selLower.startsWith("#") && el.id && `#${el.id.toLowerCase()}` === selLower) return true;
        if (selLower.startsWith(".") && el.className && el.className.toLowerCase().split(/\s+/).includes(selLower.slice(1))) return true;
        if (el.tagName && el.tagName.toLowerCase() === selLower) return true;
        return false;
      };
      for (const child of this.children) {
        if (match(child)) results.push(child);
        if (child && typeof child.querySelectorAll === "function") {
          results.push(...child.querySelectorAll(selector));
        }
      }
      return results;
    }

    getBoundingClientRect() { return this.rect; }

    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(l => l !== fn);
    }

    dispatchEvent(event) {
      if (this._listeners[event.type]) {
        for (const fn of this._listeners[event.type]) fn(event);
      }
    }

    setAttribute(key, val) { this._attrs[key] = String(val); }
    getAttribute(key) { return this._attrs[key] || null; }
    removeAttribute(key) { delete this._attrs[key]; }
  }

  class MockVideoElement extends MockElement {
    constructor(id = "test-video") {
      super("VIDEO", id);
      this.currentTime = 0;
      this.duration = 120;
      this.paused = true;
      this.ended = false;
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.playbackRate = 1;
    }

    seek(time) {
      this.currentTime = time;
      this.dispatchEvent({ type: "seeked" });
      this.dispatchEvent({ type: "timeupdate" });
    }

    play() {
      this.paused = false;
      this.dispatchEvent({ type: "play" });
      this.dispatchEvent({ type: "playing" });
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.dispatchEvent({ type: "pause" });
    }
  }

  const rootBody = new MockElement("BODY", "document-body");
  const rootHead = new MockElement("HEAD", "document-head");

  const mockDoc = {
    body: rootBody,
    head: rootHead,
    documentElement: rootBody,
    activeElement: rootBody,
    fullscreenElement: null,
    createElement: (tag) => new MockElement(tag),
    createTextNode: (txt) => ({ nodeType: 3, textContent: txt }),
    getElementById: (id) => {
      if (id === "document-body") return rootBody;
      return rootBody.querySelector(`#${id}`);
    },
    getElementsByTagName: (tag) => {
      if (tag.toLowerCase() === "video") return rootBody.querySelectorAll("video");
      return [];
    },
    querySelector: (sel) => rootBody.querySelector(sel),
    querySelectorAll: (sel) => rootBody.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      if (!docEventListeners[type]) docEventListeners[type] = [];
      docEventListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!docEventListeners[type]) return;
      docEventListeners[type] = docEventListeners[type].filter(l => l !== fn);
    }
  };

  const mockWindow = {
    location: {
      href: isHiAnime ? "https://hianime.to/watch/one-piece-100?ep=1" : "https://example.com/video",
      hostname: isHiAnime ? "hianime.to" : "example.com"
    },
    document: mockDoc,
    addEventListener: (type, fn) => {
      if (!winEventListeners[type]) winEventListeners[type] = [];
      winEventListeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!winEventListeners[type]) return;
      winEventListeners[type] = winEventListeners[type].filter(l => l !== fn);
    },
    getComputedStyle: () => ({ position: "relative" }),
    getSelection: () => ({
      rangeCount: currentSelection ? 1 : 0,
      toString: () => currentSelection
    }),
    requestAnimationFrame: (cb) => {
      return setTimeout(cb, 16);
    },
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  const mockContext = {
    console,
    window: mockWindow,
    document: mockDoc,
    location: mockWindow.location,
    chrome: mockChrome,
    ImageCropper: {
      cropVideoFrame: async (dataUrl, rect) => ({
        ok: true,
        dataUrl,
        width: rect.width,
        height: rect.height
      }),
      calculateTargetDimensions: (w, h) => ({ width: w, height: h }),
      checkBlackFrame: () => false
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    }
  };

  mockContext.globalThis = mockContext;
  const vmContext = vm.createContext(mockContext);
  vm.runInContext(videoMiningSrc, vmContext);

  function dispatchKeyEvent({ key, code, target = rootBody, ctrlKey = false, metaKey = false, altKey = false, shiftKey = false }) {
    let defaultPrevented = false;
    let propagationStopped = false;
    const evt = {
      type: "keydown",
      key,
      code: code || key,
      target,
      ctrlKey,
      metaKey,
      altKey,
      shiftKey,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => { propagationStopped = true; }
    };
    if (winEventListeners["keydown"]) {
      for (const fn of winEventListeners["keydown"]) {
        fn(evt);
        if (propagationStopped) break;
      }
    }
    return { defaultPrevented, propagationStopped };
  }

  return {
    vmContext,
    rootBody,
    mockDoc,
    mockWindow,
    mockChrome,
    sentMessages,
    runtimeMessageListeners,
    winEventListeners,
    docEventListeners,
    MockElement,
    MockVideoElement,
    setSelection: (txt) => { currentSelection = txt; },
    dispatchKeyEvent,
    sendRuntimeMessage: async (msg) => {
      let res;
      for (const listener of runtimeMessageListeners) {
        await new Promise((resolve) => {
          const syncRet = listener(msg, {}, (r) => {
            res = r;
            resolve();
          });
          if (syncRet !== true) resolve();
        });
      }
      return res;
    }
  };
}

module.exports = { createMockEnvironment };
