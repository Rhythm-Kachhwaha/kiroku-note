import test from 'node:test';
import assert from 'node:assert/strict';
import { MascotHost } from '../src/ui/shell/mascot_host.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.style = {};
  }

  appendChild(child) {
    child.parentNode?.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentNode = null;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute() {}
}

test('MascotHost creates one Rive file and preserves the state machine instance', async () => {
  let riveFileCount = 0;
  let riveCount = 0;
  let playCount = 0;
  let pauseCount = 0;
  let resizeCount = 0;

  class FakeRiveFile {
    constructor(params) {
      riveFileCount += 1;
      assert.equal(params.buffer.byteLength, 4);
    }

    async init() {}
  }

  class FakeRive {
    constructor(params) {
      riveCount += 1;
      this.params = params;
      queueMicrotask(() => params.onLoad());
    }

    play() {
      playCount += 1;
    }

    pause() {
      pauseCount += 1;
    }

    resizeDrawingSurfaceToCanvas() {
      resizeCount += 1;
    }
  }

  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName)
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    rive: {
      Rive: FakeRive,
      RiveFile: FakeRiveFile,
      Layout: class {},
      Fit: { Contain: 'contain' },
      Alignment: { Center: 'center' }
    }
  };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (callback) => callback();

  const host = new MascotHost({
    loadAssets: async () => [Promise.resolve(), new ArrayBuffer(4)]
  });
  const slot = new FakeElement('div');
  await host.ensureCreated();
  host.attach(slot);
  host.detach(new FakeElement('div'));
  host.attach(slot);

  assert.equal(riveFileCount, 1);
  assert.equal(riveCount, 1);
  assert.equal(host.instance.params.stateMachine, 'State Machine 1');
  assert.equal(host.canvas.style.opacity, '1');
  assert.equal(pauseCount, 1);
  assert.ok(playCount >= 2);
  assert.ok(resizeCount >= 2);
});
