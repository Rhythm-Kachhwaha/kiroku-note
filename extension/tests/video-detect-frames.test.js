const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.resolve(__dirname, "../..");
const videoMiningCode = fs.readFileSync(path.join(ROOT_DIR, "extension", "content", "video-mining.js"), "utf8");

test("VideoDetector pierces open shadow roots and selects video with double-injection guard", () => {
  class MockNode {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.shadowRoot = null;
      this.isConnected = true;
      this.paused = false;
      this.ended = false;
      this.readyState = 4;
      this.currentTime = 5.0;
      this.duration = 100.0;
      this.attributes = {};
      this.style = {};
      this.classList = { add: () => {}, remove: () => {}, contains: () => false };
    }
    attachShadow(opts) {
      this.shadowRoot = new MockNode("shadow-root");
      return this.shadowRoot;
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    querySelectorAll(selector) {
      const found = [];
      function recurse(n) {
        for (const c of n.children) {
          if (selector === "video" && c.tagName === "VIDEO") found.push(c);
          if (selector === "*") found.push(c);
          recurse(c);
        }
      }
      recurse(this);
      return found;
    }
    getBoundingClientRect() {
      return { width: 640, height: 360 };
    }
  }

  const doc = new MockNode("document");
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.createElement = (t) => new MockNode(t);
  doc.head = new MockNode("head");
  doc.body = new MockNode("body");
  doc.appendChild(doc.head);
  doc.appendChild(doc.body);

  const sandbox = {
    window: {},
    document: doc,
    MutationObserver: class { observe() {} disconnect() {} },
    getFullscreenElement: () => null,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document.defaultView = sandbox;

  vm.createContext(sandbox);

  // First run
  vm.runInContext(videoMiningCode, sandbox);
  assert.equal(sandbox.window.__kirokuVideoMiningLoaded, true, "Double injection guard must be set");

  // Second run: must be no-op
  vm.runInContext(videoMiningCode, sandbox);
  assert.equal(sandbox.window.__kirokuVideoMiningLoaded, true);

  const host = new MockNode("div");
  doc.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const video = new MockNode("video");
  shadow.appendChild(video);

  const instance = sandbox.window.__kirokuVideo?.getInstance?.();
  assert.ok(instance, "Instance must exist");

  const detector = instance.detector;
  const all = detector.findAllVideos();
  assert.equal(all.length, 1, "Should find video inside open shadow root");
  assert.equal(all[0], video);
});
