import assert from 'node:assert/strict';
import test from 'node:test';

class FakeClassList {
  toggle() {}
  contains() { return false; }
}

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.classList = new FakeClassList();
    this.attributes = {};
    this.style = {};
    this.offsetLeft = 0;
    this.offsetWidth = 84;
    this.listeners = new Map();
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name) { this.listeners.delete(name); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    if (selector === '#nav-spring-pill') return pill;
    if (selector.startsWith('.nav-tab-item[data-tab=')) {
      const id = selector.match(/data-tab="([^"]+)"/)?.[1];
      return tabs.find((tab) => tab.dataset.tab === id) || null;
    }
    return null;
  }
  querySelectorAll(selector) {
    return selector === '.nav-tab-item' ? tabs : [];
  }
  getBoundingClientRect() {
    return { left: this.offsetLeft, width: this.offsetWidth, right: this.offsetLeft + this.offsetWidth };
  }
}

const tabs = ['home', 'vocab', 'grammar', 'kanji', 'test', 'anime', 'study', 'manga']
  .map((id, index) => {
    const tab = new FakeElement({ tab: id });
    tab.offsetLeft = index * 90;
    return tab;
  });
const pill = new FakeElement();
const dock = new FakeElement();
dock.querySelector = (selector) => {
  if (selector === '#nav-spring-pill') return pill;
  if (selector.startsWith('.nav-tab-item[data-tab=')) {
    const id = selector.match(/data-tab="([^"]+)"/)?.[1];
    return tabs.find((tab) => tab.dataset.tab === id) || null;
  }
  return null;
};
dock.querySelectorAll = () => tabs;

let activeAnimations = [];
let resizeCallback = null;
globalThis.document = {
  getElementById(id) {
    if (id === 'bottom-dock') return dock;
    if (id === 'nav-spring-pill') return pill;
    return null;
  },
  querySelector() { return null; },
  fonts: { ready: Promise.resolve() },
  activeElement: null
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {}
};
globalThis.ResizeObserver = class {
  constructor(callback) { resizeCallback = callback; }
  observe() {}
  disconnect() {}
};
globalThis.getComputedStyle = (element) => ({
  transform: element.style.transform || 'matrix(1, 0, 0, 1, 0, 0)'
});
globalThis.DOMMatrixReadOnly = class {
  constructor() {
    this.a = 1;
    this.m41 = parseFloat((pill.style.transform.match(/translate3d\(([-\d.]+)px/) || [])[1] || '0');
  }
};
FakeElement.prototype.animate = function (frames, options) {
  let cancelled = false;
  const animation = {
    frames,
    options,
    onfinish: null,
    cancel() { cancelled = true; },
    finish() { if (!cancelled) this.onfinish?.(); },
    get cancelled() { return cancelled; }
  };
  activeAnimations.push(animation);
  return animation;
};

const { BottomDock } = await import('../src/ui/shell/bottom_dock.js');

test('pill uses one transform animation with a spring stretch and no width animation', () => {
  const instance = new BottomDock({ container: new FakeElement() });
  instance.activeTab = 'home';
  instance.movePillTo(tabs[0], false);
  instance.activeTab = 'study';
  instance.movePillTo(tabs[6], true);

  const animation = activeAnimations.at(-1);
  assert.ok(animation, 'a Web Animations API animation should be created');
  assert.equal(animation.options.duration, 280);
  assert.equal(animation.options.fill, 'both');
  assert.ok(animation.frames.some((frame) => frame.transform.includes('scaleX(')), 'spring stretch is transform-only');
  assert.ok(animation.frames.every((frame) => Object.keys(frame).every((key) => key === 'transform' || key === 'offset')));
  assert.equal(pill.style.width, '84px', 'width is set only as a static base dimension');
});

test('rapid retarget cancels the previous animation and starts from current visual transform', () => {
  const instance = new BottomDock({ container: new FakeElement() });
  instance.activeTab = 'home';
  instance.movePillTo(tabs[0], false);
  instance.activeTab = 'vocab';
  instance.movePillTo(tabs[1], true);
  const first = activeAnimations.at(-1);

  pill.style.transform = 'translate3d(35px, 0, 0) scaleX(1.2)';
  instance.activeTab = 'manga';
  instance.movePillTo(tabs[7], true);
  const second = activeAnimations.at(-1);

  assert.equal(first.cancelled, true);
  assert.notEqual(first, second);
  assert.ok(second.frames[0].transform.includes('translate3d(35px, 0, 0)'));
});

test('same-tab activation does not restart the pill animation and still triggers navigation', () => {
  let navigatedTo = null;
  const instance = new BottomDock({ container: new FakeElement(), onTabChange: (id) => { navigatedTo = id; } });
  instance.activeTab = 'home';
  instance.movePillTo(tabs[0], false);
  instance.setActiveTab('vocab', false);
  const running = instance._currentAnimation;
  instance.setActiveTab('vocab', true);

  assert.equal(instance._currentAnimation, running);
  assert.equal(navigatedTo, 'vocab');
});

test('non-animated alignment cancels active motion and positions exactly', () => {
  const instance = new BottomDock({ container: new FakeElement() });
  instance.activeTab = 'home';
  instance.movePillTo(tabs[0], false);
  instance.activeTab = 'study';
  instance.movePillTo(tabs[6], true);
  const running = instance._currentAnimation;

  instance.movePillTo(tabs[2], false);
  assert.equal(running.cancelled, true);
  assert.equal(instance._currentAnimation, null);
  assert.equal(instance._pillX, tabs[2].offsetLeft);
  assert.equal(instance._pillW, tabs[2].offsetWidth);
});
