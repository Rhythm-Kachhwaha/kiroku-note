/**
 * Tests for HudHost (Shadow host, WeakMap tracking, reposition, teardown)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function createMockElement(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    children: [],
    parentElement: null,
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    contains(child) {
      if (!child) return false;
      if (child === this) return true;
      let p = child.parentElement;
      while (p) {
        if (p === this) return true;
        p = p.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { top: 100, left: 50, width: 800, height: 450 };
    },
    attachShadow() {
      const shadow = createMockElement("shadow-root");
      this.shadowRoot = shadow;
      return shadow;
    }
  };
}

// Set up mock DOM globals
global.document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  fullscreenElement: null
};
global.window = {
  scrollY: 0,
  scrollX: 0,
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ position: "relative" })
};

const { HudHost, getHudHostForVideo } = require("../content/hud/hud-host.js");

test("HudHost attaches one shadow host per video via WeakMap", () => {
  const video1 = createMockElement("video");
  const parent1 = createMockElement("div");
  parent1.appendChild(video1);
  global.document.body.appendChild(parent1);

  const host1 = getHudHostForVideo(video1);
  assert.ok(host1);
  const host1Again = getHudHostForVideo(video1);
  assert.equal(host1, host1Again, "Must return the same HudHost for the same video");

  const video2 = createMockElement("video");
  const host2 = getHudHostForVideo(video2);
  assert.notEqual(host1, host2, "Must create separate hosts for different videos");

  assert.equal(global.window.__kirokuHud, host2);

  // Teardown
  host1.destroy();
  host2.destroy();
  assert.equal(global.window.__kirokuHud, null);
});

test("HudHost registers cleanups and runs them on destroy", () => {
  const video = createMockElement("video");
  const host = new HudHost(video);

  let cleanupRan = false;
  host.registerCleanup(() => {
    cleanupRan = true;
  });

  host.destroy();
  assert.equal(cleanupRan, true, "Registered cleanups must execute on destroy");
  assert.equal(host.video, null);
  assert.equal(host.hostEl, null);
});
