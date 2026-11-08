const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "../..");
const animeHudCode = fs.readFileSync(path.join(ROOT_DIR, "extension", "content", "anime-hud.js"), "utf8");

function setupDomEnvironment() {
  class MockElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.id = "";
      this.className = "";
      this._innerHTML = "";
      this.textContent = "";
      this.children = [];
      this.parentElement = null;
      this.shadowRoot = null;
      this.style = {};
      this.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); }
      };
      this.listeners = new Map();
    }

    get innerHTML() {
      return this._innerHTML || "";
    }

    set innerHTML(html) {
      this._innerHTML = html;
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        const tagName = m[1];
        if (tagName.startsWith("/")) continue;
        const attrs = m[2];
        const child = new MockElement(tagName);
        const idMatch = attrs.match(/id="([^"]+)"/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        child.parentElement = this;
        this.children.push(child);
      }
    }

    attachShadow(opts) {
      this.shadowRoot = new MockElement("shadow-root");
      return this.shadowRoot;
    }

    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
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

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }

    removeEventListener(event, fn) {
      if (this.listeners.has(event)) {
        this.listeners.set(event, this.listeners.get(event).filter(f => f !== fn));
      }
    }

    dispatchEvent(evt) {
      const list = this.listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    }

    getElementById(id) {
      function find(node) {
        if (node.id === id) return node;
        for (const c of node.children) {
          const res = find(c);
          if (res) return res;
        }
        return null;
      }
      return find(this);
    }

    querySelector(selector) {
      return this.children[0] || null;
    }
  }

  const document = {
    fullscreenElement: null,
    body: new MockElement("body"),
    createElement(tag) {
      const el = new MockElement(tag);
      return el;
    },
    listeners: new Map(),
    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (this.listeners.has(event)) {
        this.listeners.set(event, this.listeners.get(event).filter(f => f !== fn));
      }
    },
    dispatchEvent(evt) {
      const list = this.listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    }
  };

  const sandbox = {
    document,
    window: { location: { href: "https://anime.example/watch" } },
    globalThis: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
  };
  sandbox.window.__proto__ = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(animeHudCode, sandbox);
  const AnimeHud = sandbox.AnimeHud || sandbox.globalThis.AnimeHud;

  return { sandbox, document, MockElement, AnimeHud };
}

test("AnimeHud builds closed shadow DOM host and attaches to container", () => {
  const { document, MockElement, AnimeHud } = setupDomEnvironment();
  const container = new MockElement("div");
  const video = new MockElement("video");
  container.appendChild(video);

  const hud = new AnimeHud(video);
  assert.ok(hud.host, "HUD host should be created");
  assert.equal(hud.host.id, "kiroku-anime-hud-host");
  assert.ok(hud.shadow, "Shadow root should be created");
  assert.equal(hud.host.parentElement, container, "HUD host should be appended to video parent container");
});

test("AnimeHud toggles menu panel and updates sub/link status", () => {
  const { document, MockElement, AnimeHud } = setupDomEnvironment();
  const container = new MockElement("div");
  const video = new MockElement("video");
  container.appendChild(video);

  const hud = new AnimeHud(video);
  const panel = hud.shadow.getElementById("hud-menu-panel");
  assert.ok(panel.classList.contains("hidden"), "Menu should initially be hidden");

  hud.openMenu();
  assert.equal(panel.classList.contains("hidden"), false, "Menu should be open");

  hud.closeMenu();
  assert.ok(panel.classList.contains("hidden"), "Menu should be closed");

  // Update link status
  hud.setLinkStatus("connected");
  const linkText = hud.shadow.getElementById("hud-link-text");
  const linkDot = hud.shadow.getElementById("hud-link-dot");
  assert.equal(linkText.textContent, "Connected");
  assert.ok(linkDot.classList.contains("connected"));

  // Update subtitle status
  hud.setSubStatus({ source: "jimaku", name: "Jujutsu Kaisen Ep 1", count: 420, offsetMs: 250 });
  const trackName = hud.shadow.getElementById("hud-track-name");
  const trackStats = hud.shadow.getElementById("hud-track-stats");
  const offsetVal = hud.shadow.getElementById("hud-offset-val");
  assert.equal(trackName.textContent, "Jujutsu Kaisen Ep 1");
  assert.equal(trackStats.textContent, "420 cues");
  assert.equal(offsetVal.textContent, "+250ms");
});

test("AnimeHud reparents into fullscreenElement on fullscreenchange", () => {
  const { document, MockElement, AnimeHud } = setupDomEnvironment();
  const container = new MockElement("div");
  const video = new MockElement("video");
  container.appendChild(video);

  const hud = new AnimeHud(video);
  assert.equal(hud.host.parentElement, container);

  // Enter fullscreen
  const fsContainer = new MockElement("div");
  document.fullscreenElement = fsContainer;
  document.dispatchEvent({ type: "fullscreenchange" });

  assert.equal(hud.host.parentElement, fsContainer, "Host should reparent into fullscreenElement");

  // Exit fullscreen
  document.fullscreenElement = null;
  document.dispatchEvent({ type: "fullscreenchange" });

  assert.equal(hud.host.parentElement, container, "Host should restore to original container");
});
