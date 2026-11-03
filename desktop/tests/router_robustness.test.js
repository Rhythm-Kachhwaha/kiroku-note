import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
  constructor() {
    this.hidden = false;
    this.children = [];
    this.listeners = {};
  }

  appendChild(child) {
    this.children.push(child);
  }

  remove() {
    this.removed = true;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute() {}
}

function installDOM() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const listeners = {};
  const viewContainer = new FakeElement();
  globalThis.document = {
    createElement: () => new FakeElement(),
    addEventListener: (type, listener) => { listeners[type] = listener; },
    removeEventListener: () => {}
  };
  globalThis.window = {
    location: { hash: '' },
    scrollTo() {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
    removeEventListener: () => {}
  };
  return {
    viewContainer,
    listeners,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  };
}

test('router shows retry UI after a failed mount and can recover', async () => {
  const dom = installDOM();
  try {
    const { AppRouter } = await import('../src/ui/router.js?robustness=error');
    let attempts = 0;
    class FlakyView {
      mount() {
        attempts += 1;
        if (attempts === 1) throw new Error('mount failed');
      }
    }
    const router = new AppRouter({ viewContainer: dom.viewContainer });
    router.routes = { flaky: FlakyView };

    await router.navigateToTab('flaky', false);
    assert.equal(router.currentViewInstance, null);
    assert.equal(dom.viewContainer.children.filter((child) => !child.removed).length, 1);
    const errorElement = dom.viewContainer.children.find((child) => !child.removed);
    assert.equal(errorElement.children[1].textContent, 'Retry');

    await router.navigateToTab('flaky', false);
    assert.equal(router.currentTab, 'flaky');
    assert.equal(router.currentViewInstance instanceof FlakyView, true);
    assert.equal(dom.viewContainer.children.filter((child) => !child.removed && !child.hidden).length, 1);
  } finally {
    dom.restore();
  }
});

test('router serializes rapid navigation and commits only the latest request', async () => {
  const dom = installDOM();
  try {
    const { AppRouter } = await import('../src/ui/router.js?robustness=latest');
    const mounts = [];
    class View {
      constructor(router) {
        this.router = router;
        this.keepAlive = false;
      }

      async mount() {
        mounts.push(this.router.currentTab);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    const router = new AppRouter({ viewContainer: dom.viewContainer });
    router.routes = { a: View, b: View, c: View };

    await Promise.all([
      router.navigateToTab('a', false),
      router.navigateToTab('b', false),
      router.navigateToTab('c', false)
    ]);

    assert.equal(router.currentTab, 'c');
    assert.equal(router.currentViewInstance instanceof View, true);
    assert.equal(dom.viewContainer.children.filter((child) => !child.removed && !child.hidden).length, 1);
  } finally {
    dom.restore();
  }
});

test('router ignores the hash event caused by its own history update', async () => {
  const dom = installDOM();
  try {
    const { AppRouter } = await import('../src/ui/router.js?robustness=hash');
    class View {
      mount() {}
    }
    const router = new AppRouter({ viewContainer: dom.viewContainer });
    router.routes = { home: View, vocab: View };
    router.init();
    await router.navigateToTab('vocab', true);
    dom.listeners.hashchange();
    await router.navigationQueue;

    assert.equal(router.currentTab, 'vocab');
  } finally {
    dom.restore();
  }
});
