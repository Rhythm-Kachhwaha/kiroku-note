import assert from 'node:assert/strict';
import test from 'node:test';

class FakeHost {
  constructor() {
    this.hidden = false;
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
  }

  remove() {
    this.removed = true;
  }
}

class KeepAliveView {
  static mounts = 0;
  static shows = 0;
  static hides = 0;

  constructor() {
    this.keepAlive = true;
  }

  mount() {
    KeepAliveView.mounts += 1;
  }

  onShow() {
    KeepAliveView.shows += 1;
  }

  onHide() {
    KeepAliveView.hides += 1;
  }

  unmount() {
    throw new Error('keep-alive view should not unmount during navigation');
  }
}

class RemountView {
  static mounts = 0;
  static unmounts = 0;

  mount() {
    RemountView.mounts += 1;
  }

  unmount() {
    RemountView.unmounts += 1;
  }
}

test('router keeps opted-in views alive and remounts other views', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const viewContainer = new FakeHost();

  globalThis.document = {
    createElement: () => new FakeHost(),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    location: { hash: '' },
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {}
  };

  try {
    const { AppRouter } = await import('../src/ui/router.js');
    const router = new AppRouter({ viewContainer });
    router.routes = {
      home: KeepAliveView,
      vocab: KeepAliveView,
      grammar: RemountView
    };

    await router.navigateToTab('home', false);
    await router.navigateToTab('vocab', false);
    await router.navigateToTab('home', false);
    await router.navigateToTab('grammar', false);
    await router.navigateToTab('home', false);

    assert.equal(KeepAliveView.mounts, 2);
    assert.equal(KeepAliveView.shows, 4);
    assert.equal(KeepAliveView.hides, 3);
    assert.equal(RemountView.mounts, 1);
    assert.equal(RemountView.unmounts, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
