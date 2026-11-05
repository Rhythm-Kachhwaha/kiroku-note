/**
 * Slice 26 Unit Tests: Anime companion controls parity & command emission
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');
const hotkeysPath = path.join(repoRoot, 'desktop', 'src', 'hotkeys.js');

test('Slice 26 Anime: Static inspection of controls in anime.js & hotkeys.js', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('btn-anime-toggle'), 'Must have play/pause toggle button');
  assert.ok(animeJs.includes('btn-anime-loop'), 'Must have loop button');
  assert.ok(animeJs.includes('anime-rate-btn'), 'Must have speed rate buttons');
  assert.ok(animeJs.includes('btn-anime-offset-minus'), 'Must have offset minus button');
  assert.ok(animeJs.includes('btn-anime-offset-plus'), 'Must have offset plus button');
  assert.ok(animeJs.includes('btn-anime-clip'), 'Must have clip button');
  assert.ok(animeJs.includes('Extension disconnected'), 'Must set disconnected tooltip');

  const hotkeysCode = fs.readFileSync(hotkeysPath, 'utf8');
  assert.ok(hotkeysCode.includes('cmd.loop'), 'Hotkeys must register cmd.loop');
  assert.ok(hotkeysCode.includes('cmd.replay_cue'), 'Hotkeys must register cmd.replay_cue');
  assert.ok(hotkeysCode.includes('cmd.pause_play'), 'Hotkeys must register cmd.pause_play');
});

test('Slice 26 Anime: CSS adherence to design tokens and no raw hex', () => {
  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must not contain raw hex');
  assert.ok(css.includes('.anime-controls-subrow'), 'Must style .anime-controls-subrow');
  assert.ok(css.includes('.anime-control-group'), 'Must style .anime-control-group');
  assert.ok(css.includes('.anime-offset-badge'), 'Must style .anime-offset-badge');
  assert.ok(css.includes('.anime-control-btn:disabled'), 'Must style disabled state');
});

test('Slice 26 Anime: Functional command emission with fake LinkStore and DOM mock', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const sentCommands = [];
  const fakeStore = {
    status: 'connected',
    activeSession: { site: 'youtube', title: 'Test Anime', duration: 120 },
    videoState: { t: 15.0, paused: true, rate: 1.0 },
    activeCue: { i: 2, s: 12.0, e: 16.5, text: 'テスト字幕です' },
    activeCueIndex: 2,
    cues: [{ i: 2, s: 12.0, e: 16.5, text: 'テスト字幕です' }],
    listeners: new Map(),
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    },
    off(event, fn) {
      const arr = this.listeners.get(event) || [];
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    emit(event, ...args) {
      (this.listeners.get(event) || []).forEach(fn => fn(...args));
    },
    getStatusSummary() {
      return {
        connected: this.status === 'connected',
        status: this.status,
        activeSession: this.activeSession,
        videoState: this.videoState,
        activeCue: this.activeCue,
        activeCueIndex: this.activeCueIndex,
        cueCount: this.cues.length
      };
    },
    toggle() {
      sentCommands.push({ type: 'cmd.toggle', payload: {} });
    },
    seek(t, delta) {
      sentCommands.push({ type: 'cmd.seek', payload: { t, delta } });
    },
    jumpCue(opts) {
      sentCommands.push({ type: 'cmd.cue', payload: opts });
    },
    loop(s, e, count) {
      sentCommands.push({ type: 'cmd.loop', payload: { s, e, count } });
    },
    setRate(v) {
      sentCommands.push({ type: 'cmd.rate', payload: { v } });
    },
    setOffset(ms) {
      sentCommands.push({ type: 'cmd.offset', payload: { ms } });
    },
    requestClip(reqId, s, e, want) {
      sentCommands.push({ type: 'cmd.clip', payload: { reqId, s, e, want } });
    }
  };

  // Build a minimal DOM container mock
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.attributes = {};
      const set = new Set();
      this.classList = {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        contains: (c) => set.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) set.add(c); else set.delete(c);
            return force;
          }
          if (set.has(c)) { set.delete(c); return false; }
          set.add(c); return true;
        },
        has: (c) => set.has(c)
      };
      this.dataset = {};
      this.style = {};
      this._textContent = '';
      this._innerHTML = '';
      this.listeners = {};
      this.disabled = false;
    }

    get textContent() { return this._textContent; }
    set textContent(val) { this._textContent = String(val); }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
      this._innerHTML = val;
      this._parseSimpleHtml(val);
    }

    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
    removeAttribute(k) { delete this.attributes[k]; }

    addEventListener(ev, fn) {
      if (!this.listeners[ev]) this.listeners[ev] = [];
      this.listeners[ev].push(fn);
    }

    click() {
      if (this.disabled) return;
      (this.listeners['click'] || []).forEach(fn => fn({ target: this }));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const results = [];
      const match = (el) => {
        if (!el || typeof el !== 'object') return;
        if (selector.startsWith('#') && el.attributes?.id === selector.slice(1)) {
          results.push(el);
        } else if (selector.startsWith('.') && el.classList?.has(selector.slice(1))) {
          results.push(el);
        } else if (selector === 'button' && el.tagName === 'BUTTON') {
          results.push(el);
        } else if (selector.includes('button') && el.tagName === 'BUTTON') {
          results.push(el);
        }
        for (const child of el.children || []) {
          match(child);
        }
      };
      for (const child of this.children) {
        match(child);
      }
      return results;
    }

    _parseSimpleHtml(html) {
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = tagRegex.exec(html)) !== null) {
        const tagName = m[1];
        const rawAttrs = m[2];
        const inner = m[3];
        const child = new MockElement(tagName);
        const idMatch = rawAttrs.match(/id="([^"]+)"/);
        if (idMatch) child.attributes.id = idMatch[1];
        const classMatch = rawAttrs.match(/class="([^"]+)"/);
        if (classMatch) {
          classMatch[1].split(/\s+/).forEach(c => child.classList.add(c));
        }
        const rateMatch = rawAttrs.match(/data-rate="([^"]+)"/);
        if (rateMatch) child.dataset.rate = rateMatch[1];
        
        // Also recurse for children if inner contains tags
        if (/<[a-z0-9-]+/i.test(inner)) {
          child._parseSimpleHtml(inner);
        }
        this.children.push(child);
      }
    }
  }

  const container = new MockElement('div');
  const view = new AnimeView({});
  view.container = container;
  view.linkStore = fakeStore;

  view.render();
  view.setupEvents();
  view.updateFromStore();

  // Test speed command
  const rate125 = container.querySelectorAll('.anime-rate-btn').find(b => b.dataset.rate === '1.25');
  assert.ok(rate125, 'Should have rate 1.25 button');
  rate125.click();
  const rateCmd = sentCommands.find(c => c.type === 'cmd.rate');
  assert.ok(rateCmd, 'cmd.rate should be sent');
  assert.strictEqual(rateCmd.payload.v, 1.25);

  // Test loop toggle command
  const loopBtn = container.querySelector('#btn-anime-loop');
  assert.ok(loopBtn, 'Should have loop button');
  loopBtn.click();
  const loopCmd = sentCommands.find(c => c.type === 'cmd.loop');
  assert.ok(loopCmd, 'cmd.loop should be sent');
  assert.strictEqual(loopCmd.payload.s, 12.0);
  assert.strictEqual(loopCmd.payload.e, 16.5);
  assert.strictEqual(loopCmd.payload.count, 99);

  // Test offset buttons
  const offsetMinus = container.querySelector('#btn-anime-offset-minus');
  assert.ok(offsetMinus, 'Should have offset minus button');
  offsetMinus.click();
  const offsetCmd = sentCommands.find(c => c.type === 'cmd.offset');
  assert.ok(offsetCmd, 'cmd.offset should be sent');
  assert.strictEqual(offsetCmd.payload.ms, -100);

  // Test clip button
  const clipBtn = container.querySelector('#btn-anime-clip');
  assert.ok(clipBtn, 'Should have clip button');
  clipBtn.click();
  const clipCmd = sentCommands.find(c => c.type === 'cmd.clip');
  assert.ok(clipCmd, 'cmd.clip should be sent');
  assert.strictEqual(clipCmd.payload.s, 12.0);
  assert.strictEqual(clipCmd.payload.e, 16.5);
  assert.deepStrictEqual(clipCmd.payload.want, ['image', 'audio']);

  // Test disabled state when disconnected
  fakeStore.status = 'disconnected';
  view.updateFromStore();
  const allBtns = container.querySelectorAll('button');
  assert.ok(allBtns.length > 0, 'Controls buttons should exist');
  for (const b of allBtns) {
    assert.strictEqual(b.disabled, true, 'Controls must be disabled when disconnected');
    assert.strictEqual(b.attributes.title, 'Extension disconnected', 'Tooltip must show Extension disconnected');
  }

  view.unmount();
});
