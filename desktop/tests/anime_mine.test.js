/**
 * Slice 29 Unit Tests: Mine from Anime tab, Token Mining, Queue Gap Words, and Duplicate Check
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const animeViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'anime.js');
const animeCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'anime.css');
const linkMinePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'services', 'link_mine.js');

test('Slice 29 Mine: Static structure in anime.js & link_mine.js', () => {
  const animeJs = fs.readFileSync(animeViewPath, 'utf8');
  assert.ok(animeJs.includes('btn-anime-clip'), 'Must have mine line button');
  assert.ok(animeJs.includes('btn-anime-queue-gaps'), 'Must have queue gap words button');
  assert.ok(animeJs.includes('anime-queue-card'), 'Must have queue review card');
  assert.ok(animeJs.includes('btn-queue-mine-all'), 'Must have queue mine-all button');
  assert.ok(animeJs.includes('btn-queue-undo'), 'Must have queue undo button');
  assert.ok(animeJs.includes('anime-mined-counter'), 'Must have session mined counter');

  const linkMineCode = fs.readFileSync(linkMinePath, 'utf8');
  assert.ok(linkMineCode.includes('isDuplicate'), 'LinkMineService must support duplicate check');

  const css = fs.readFileSync(animeCssPath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'anime.css must not contain raw hex');
  assert.ok(css.includes('.anime-mined-counter'), 'Must style mined counter');
  assert.ok(css.includes('.anime-queue-card'), 'Must style queue card');
  assert.ok(css.includes('.anime-queue-chip'), 'Must style queue chip');
});

test('Slice 29 Mine: Functional mining, token clicks, gap words queue, and duplicate detection', async () => {
  const { AnimeView } = await import('../src/ui/views/anime.js');

  const fakeStore = {
    status: 'connected',
    activeSession: { site: 'youtube', title: 'Mining Test Anime', duration: 180 },
    videoState: { t: 25.0, paused: true, rate: 1.0 },
    cueHash: 'hash-mine-test',
    activeCueIndex: 0,
    activeCue: { i: 0, s: 20.0, e: 26.0, text: '勇者の剣を見つけた' },
    cues: [
      { i: 0, s: 20.0, e: 26.0, text: '勇者の剣を見つけた' }
    ],
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
        cueCount: this.cues.length,
        cueHash: this.cueHash
      };
    }
  };

  const minedCalls = [];
  const fakeMineService = {
    async mineWord(params) {
      minedCalls.push(params);
      const isDup = params.expression === '既存の言葉';
      return {
        ok: true,
        isDuplicate: isDup,
        cardId: `card-${minedCalls.length}`,
        expression: params.expression
      };
    },
    async isDuplicate(term) {
      return term === '既存の言葉';
    }
  };

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
      (this.listeners['click'] || []).forEach(fn => fn({ target: this, closest: (sel) => this.closest(sel) }));
    }

    closest(selector) {
      if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
      if (selector.startsWith('#') && this.attributes.id === selector.slice(1)) return this;
      return null;
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
        } else if (selector.startsWith('.') && el.classList?.contains(selector.slice(1))) {
          results.push(el);
        } else if (selector.toLowerCase() === el.tagName.toLowerCase()) {
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
        const dataSurface = rawAttrs.match(/data-surface="([^"]+)"/);
        if (dataSurface) child.dataset.surface = dataSurface[1];
        const dataCueIdx = rawAttrs.match(/data-cue-index="([^"]+)"/);
        if (dataCueIdx) child.dataset.cueIndex = dataCueIdx[1];

        if (/<[a-z0-9-]+/i.test(inner)) {
          child._parseSimpleHtml(inner);
        }
        this.children.push(child);
      }
    }
  }

  const container = new MockElement('div');
  const view = new AnimeView({}, {
    linkMineService: fakeMineService
  });
  view.container = container;
  view.linkStore = fakeStore;

  view.render();
  view.setupEvents();
  view.updateFromStore();

  // Populate mock annotated cue with gap words
  view.annotatedCuesMap.set('hash-mine-test:0', {
    i: 0,
    gap_words: ['勇者', '剣'],
    tokens: [
      { surface: '勇者', status: 'gap' },
      { surface: 'の', status: 'unstyled' },
      { surface: '剣', status: 'gap' },
      { surface: 'を', status: 'unstyled' },
      { surface: '見つけた', status: 'known' }
    ]
  });

  // 1. One-click mine active line
  assert.strictEqual(view.sessionMinedCount, 0);
  const btnClip = container.querySelector('#btn-anime-clip');
  assert.ok(btnClip, 'Mine line button must exist');
  await view.mineActiveLine();

  assert.strictEqual(minedCalls.length, 1);
  assert.strictEqual(minedCalls[0].expression, '勇者の剣を見つけた');
  assert.strictEqual(view.sessionMinedCount, 1, 'Mined counter must increment on new card');

  // 2. Token click mining
  const tokenEl = new MockElement('span');
  tokenEl.classList.add('anime-token-chip', 'is-gap');
  tokenEl.dataset.surface = '剣';
  await view.mineToken('剣', fakeStore.activeCue, tokenEl);

  assert.strictEqual(minedCalls.length, 2);
  assert.strictEqual(minedCalls[1].expression, '剣');
  assert.strictEqual(view.sessionMinedCount, 2);
  assert.ok(tokenEl.classList.contains('is-mined'), 'Token chip must get .is-mined class');

  // 3. Duplicate detection does not increment mined count
  await view.mineToken('既存の言葉', fakeStore.activeCue);
  assert.strictEqual(minedCalls.length, 3);
  assert.strictEqual(view.sessionMinedCount, 2, 'Duplicate must not increment mined count');

  // 4. Queue gap words
  view.queueGapWords();
  assert.strictEqual(view.gapWordsQueue.length, 2, 'Queue must contain 2 gap words from cue (勇者, 剣)');
  assert.strictEqual(view.gapWordsQueue[0].word, '勇者');
  assert.strictEqual(view.gapWordsQueue[1].word, '剣');

  // Test undo queue
  view.undoQueue();
  assert.strictEqual(view.gapWordsQueue.length, 0, 'Undo must clear last queued batch');

  // Re-queue and Mine All
  view.queueGapWords();
  assert.strictEqual(view.gapWordsQueue.length, 2);
  await view.mineAllQueued();
  assert.strictEqual(view.gapWordsQueue.length, 0, 'Mine all must clear queue after processing');
  assert.strictEqual(view.sessionMinedCount, 4, 'Session mined count must increment for queued items');

  view.unmount();
});

