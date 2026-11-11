import assert from 'node:assert/strict';
import test from 'node:test';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this.className = '';
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.textParts = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {};
    this.disabled = false;
    this.hidden = false;
    this.playCount = 0;
    this.pauseCount = 0;
    this.loadCount = 0;
    this.src = '';
    this.currentTime = 0;
    this._innerHTML = '';
    this.classList = {
      contains: (cls) => this.className.split(/\s+/).filter(Boolean).includes(cls),
      add: (...cls) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        cls.forEach((c) => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...cls) => {
        const drop = new Set(cls);
        this.className = this.className.split(/\s+/).filter((c) => c && !drop.has(c)).join(' ');
      },
      toggle: (cls, force) => {
        const has = this.classList.contains(cls);
        const shouldAdd = force === undefined ? !has : Boolean(force);
        if (shouldAdd) this.classList.add(cls);
        else this.classList.remove(cls);
      }
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = String(html || '');
    this.children = [];
    this.textParts = [];
    parseHtmlInto(this, this._innerHTML);
  }

  get textContent() {
    return this.textParts.join('');
  }

  set textContent(value) {
    this._innerHTML = '';
    this.children = [];
    this.textParts = [String(value ?? '')];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
    if (name === 'src') this.src = String(value);
    if (name.startsWith('data-')) {
      this.dataset[toCamelCase(name.slice(5))] = String(value);
    }
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'disabled') this.disabled = false;
    if (name === 'hidden') this.hidden = false;
    if (name === 'src') this.src = '';
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(type, list.filter((item) => item !== fn));
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    let cursor = this;
    while (cursor) {
      event.currentTarget = cursor;
      const list = cursor.listeners.get(event.type) || [];
      for (const fn of list) {
        fn(event);
      }
      if (event.cancelBubble) break;
      cursor = cursor.parentNode;
    }
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault() {},
      stopPropagation() { this.cancelBubble = true; }
    });
  }

  play() {
    this.playCount += 1;
    return Promise.resolve();
  }

  pause() {
    this.pauseCount += 1;
  }

  load() {
    this.loadCount += 1;
  }

  focus() {}

  closest(selector) {
    let cursor = this;
    while (cursor) {
      if (matchesSimpleSelector(cursor, selector)) return cursor;
      cursor = cursor.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (parts.some((part) => matchesSimpleSelector(child, part))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matchesSimpleSelector(el, selector) {
  let rest = selector.trim();
  if (!rest) return false;
  if (rest.includes(' ')) {
    const segments = rest.split(/\s+/).filter(Boolean);
    const last = segments[segments.length - 1];
    if (!matchesSimpleSelector(el, last)) return false;
    let cursor = el.parentNode;
    for (let i = segments.length - 2; i >= 0; i -= 1) {
      while (cursor && !matchesSimpleSelector(cursor, segments[i])) {
        cursor = cursor.parentNode;
      }
      if (!cursor) return false;
      cursor = cursor.parentNode;
    }
    return true;
  }

  const attrMatches = [...rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
  rest = rest.replace(/\[[^\]]+\]/g, '');
  const idMatch = rest.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) rest = rest.replace(`#${idMatch[1]}`, '');
  const classMatches = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const tagMatch = rest.replace(/\.[a-zA-Z0-9_-]+/g, '').trim();

  if (tagMatch && el.tagName.toLowerCase() !== tagMatch.toLowerCase()) return false;
  if (idMatch && el.id !== idMatch[1]) return false;
  for (const cls of classMatches) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const [, attrName, attrVal] of attrMatches) {
    const actual = el.getAttribute(attrName);
    if (actual === null) return false;
    if (attrVal !== undefined && actual !== attrVal) return false;
  }
  return true;
}

function parseHtmlInto(root, html) {
  const stack = [root];
  const tokenRegex = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    if (match[1]) {
      const closing = match[1].toLowerCase();
      while (stack.length > 1) {
        const top = stack.pop();
        if (top.tagName.toLowerCase() === closing) break;
      }
    } else if (match[2]) {
      const tag = match[2].toLowerCase();
      const rawAttrs = match[3] || '';
      const selfClosing = rawAttrs.trim().endsWith('/') || VOID_TAGS.has(tag);
      const el = new FakeElement(tag);
      const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g;
      let am;
      while ((am = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = am[1];
        if (attrName === '/') continue;
        const val = am[2] ?? am[3] ?? am[4] ?? '';
        el.setAttribute(attrName, val);
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClosing) {
        stack.push(el);
      }
    } else if (match[4]) {
      const text = match[4];
      for (const node of stack) {
        node.textParts.push(text);
      }
    }
  }
}

function installDomEnv() {
  const docListeners = new Map();
  const winListeners = new Map();
  const rootContainer = new FakeElement('div');
  const addTo = (map, type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const removeFrom = (map, type, fn) => {
    const list = map.get(type);
    if (!list) return;
    map.set(type, list.filter((item) => item !== fn));
  };

  const documentMock = {
    body: rootContainer,
    activeElement: null,
    createElement(tag) {
      return new FakeElement(tag);
    },
    getElementById(id) {
      return rootContainer.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return rootContainer.querySelector(sel);
    },
    querySelectorAll(sel) {
      return rootContainer.querySelectorAll(sel);
    },
    addEventListener(type, fn) {
      addTo(docListeners, type, fn);
    },
    removeEventListener(type, fn) {
      removeFrom(docListeners, type, fn);
    },
    dispatchKeyDown(key, extra = {}) {
      const event = {
        type: 'keydown',
        key,
        code: key === ' ' ? 'Space' : undefined,
        target: extra.target || rootContainer,
        preventDefaultCalled: false,
        preventDefault() { this.preventDefaultCalled = true; },
        ...extra
      };
      for (const fn of [...(winListeners.get('keydown') || [])]) {
        fn(event);
      }
      for (const fn of [...(docListeners.get('keydown') || [])]) {
        fn(event);
      }
      return event;
    }
  };

  globalThis.document = documentMock;
  globalThis.window = {
    addEventListener(type, fn) {
      addTo(winListeners, type, fn);
    },
    removeEventListener(type, fn) {
      removeFrom(winListeners, type, fn);
    }
  };
  return { documentMock, rootContainer, winListeners };
}

function buildConsistency(activeDays = 2, totalBursts = 3) {
  return {
    window_days: 7,
    active_days: activeDays,
    total_bursts_7d: totalBursts,
    total_items_7d: totalBursts * 5,
    days: [
      { date: '2026-11-05', sessions_completed: 0, items_reviewed: 0 },
      { date: '2026-11-06', sessions_completed: 0, items_reviewed: 0 },
      { date: '2026-11-07', sessions_completed: 1, items_reviewed: 5 },
      { date: '2026-11-08', sessions_completed: 0, items_reviewed: 0 },
      { date: '2026-11-09', sessions_completed: 0, items_reviewed: 0 },
      { date: '2026-11-10', sessions_completed: 0, items_reviewed: 0 },
      { date: '2026-11-11', sessions_completed: 2, items_reviewed: 10 }
    ]
  };
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('Practice Hub renders 3 study mode cards and Rolling Weekly Consistency bar', async () => {
  const { rootContainer } = installDomEnv();
  const requests = [];

  globalThis.fetch = async (url) => {
    const u = String(url);
    requests.push(u);
    if (u.includes('/api/study/v1/bank/summary')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ total_questions: 120, levels: { N4: { total: 40 } } })
      };
    }
    if (u.includes('/api/study-modes/consistency')) {
      return {
        ok: true,
        status: 200,
        json: async () => buildConsistency(2, 3)
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { StudyView } = await import(`../src/ui/views/study.js?t=${Date.now()}`);
  const view = new StudyView();
  view.mount(rootContainer);
  view.onShow();
  await flushAsync();
  await flushAsync();

  assert.ok(rootContainer.querySelector('[data-study-mode="sentence_scramble"]'));
  assert.ok(rootContainer.querySelector('[data-study-mode="audio_shadowing"]'));
  assert.ok(rootContainer.querySelector('[data-study-mode="jlpt_bank"]'));
  assert.equal(rootContainer.querySelectorAll('.study-mode-card').length, 3);

  const summary = rootContainer.querySelector('#study-consistency-summary');
  assert.ok(summary);
  assert.match(summary.textContent, /2 of 7 days active/);
  assert.ok(requests.some((u) => u.includes('/api/study-modes/consistency')));

  // JLPT Practice Bank card toggles collapsible setup panel cleanly
  const jlptBtn = rootContainer.querySelector('#btn-open-jlpt-bank-mode');
  assert.equal(rootContainer.querySelector('#jlpt-drill-setup-panel')?.hidden, true);
  jlptBtn.click();
  assert.equal(rootContainer.querySelector('#jlpt-drill-setup-panel')?.hidden, false);
  assert.ok(rootContainer.querySelector('#drill-filter-chips'));

  // Toggling burst size pill updates button label to 10 Items
  const size10Pill = rootContainer.querySelector('.burst-size-pill[data-burst-mode="sentence_scramble"][data-burst-size="10"]');
  assert.ok(size10Pill);
  size10Pill.click();
  assert.match(rootContainer.querySelector('#btn-start-scramble-burst').textContent, /Start 10-Item Burst/);
  view.onHide();
});

test('Empty captured items shows clean empty state with Back to Study', async () => {
  const { rootContainer } = installDomEnv();

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/study-modes/consistency')) {
      return { ok: true, status: 200, json: async () => buildConsistency(0, 0) };
    }
    if (u.includes('/api/study-modes/sessions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: null,
          mode: 'sentence_scramble',
          target_count: 5,
          total_count: 0,
          status: 'empty',
          items: []
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { StudyView } = await import(`../src/ui/views/study.js?t=${Date.now() + 1}`);
  const view = new StudyView();
  view.mount(rootContainer);
  await flushAsync();

  rootContainer.querySelector('#btn-start-scramble-burst').click();
  await flushAsync();

  const emptyEl = rootContainer.querySelector('#study-burst-empty');
  assert.ok(emptyEl);
  assert.match(emptyEl.textContent, /No Captured Sentences Ready to Scramble/);
  rootContainer.querySelector('#btn-empty-back-to-study').click();
  await flushAsync();

  assert.ok(rootContainer.querySelector('#study-mode-cards'));
});

test('Sentence Scramble supports tile clicks, number hotkeys 1-3, Backspace undo, Enter submit, and Exit', async () => {
  const { documentMock, rootContainer } = installDomEnv();
  const submittedPayloads = [];

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/study-modes/consistency')) {
      return { ok: true, status: 200, json: async () => buildConsistency(2, 3) };
    }
    if (u.endsWith('/api/study-modes/sessions') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 101,
          mode: 'sentence_scramble',
          target_count: 5,
          total_count: 2,
          status: 'in_progress',
          items: [
            {
              item_index: 0,
              english_gloss: 'I study Japanese.',
              tile_count: 3,
              tiles: [
                { tile_id: 'tile_1', surface: 'は', role: 'particle', hint: 'particle', reading: '' },
                { tile_id: 'tile_2', surface: '日本語を', role: 'phrase', hint: 'object', reading: 'にほんごを' },
                { tile_id: 'tile_0', surface: '私', role: 'phrase', hint: 'phrase', reading: 'わたし' }
              ]
            },
            {
              item_index: 1,
              english_gloss: 'I read a book.',
              tile_count: 2,
              tiles: [
                { tile_id: 'tile_1', surface: '本を読みます', role: 'phrase', hint: '', reading: '' },
                { tile_id: 'tile_0', surface: '私は', role: 'phrase', hint: '', reading: '' }
              ]
            }
          ]
        })
      };
    }
    if (u.includes('/api/study-modes/sessions/101/answer')) {
      const payload = JSON.parse(opts.body);
      submittedPayloads.push(payload);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          item_index: payload.item_index,
          is_correct: true,
          expected_sentence: '私は日本語を',
          english_gloss: 'I study Japanese.',
          tile_feedback: [
            { position: 0, expected_surface: '私', submitted_surface: '私', is_match: true },
            { position: 1, expected_surface: 'は', submitted_surface: 'は', is_match: true },
            { position: 2, expected_surface: '日本語を', submitted_surface: '日本語を', is_match: true }
          ]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { StudyView } = await import(`../src/ui/views/study.js?t=${Date.now() + 2}`);
  const view = new StudyView();
  view.mount(rootContainer);
  view.onShow();
  await flushAsync();

  rootContainer.querySelector('#btn-start-scramble-burst').click();
  await flushAsync();

  assert.equal(rootContainer.querySelector('#burst-progress-indicator').textContent.trim(), 'Card 1 of 2');
  assert.ok(rootContainer.querySelector('#btn-exit-burst'));

  // Press number keys: 3 ("私"), 1 ("は"), 2 ("日本語を"), then undo and re-add 2
  documentMock.dispatchKeyDown('3');
  documentMock.dispatchKeyDown('1');
  documentMock.dispatchKeyDown('2');
  assert.equal(rootContainer.querySelectorAll('.scramble-placed-chip').length, 3);

  documentMock.dispatchKeyDown('Backspace');
  assert.equal(rootContainer.querySelectorAll('.scramble-placed-chip').length, 2);

  // Click slot tile_2 directly
  rootContainer.querySelector('.scramble-tile-btn[data-tile-id="tile_2"]').click();
  assert.equal(rootContainer.querySelectorAll('.scramble-placed-chip').length, 3);

  // Press Enter to submit
  documentMock.dispatchKeyDown('Enter');
  await flushAsync();

  assert.equal(submittedPayloads.length, 1);
  assert.deepEqual(submittedPayloads[0].user_answer, ['tile_0', 'tile_1', 'tile_2']);
  assert.ok(rootContainer.querySelector('#burst-feedback-banner'));

  // Press Enter to advance to Card 2 of 2
  documentMock.dispatchKeyDown('Enter');
  await flushAsync();
  assert.equal(rootContainer.querySelector('#burst-progress-indicator').textContent.trim(), 'Card 2 of 2');

  // Exit / Back to Study button returns cleanly to Practice Hub
  rootContainer.querySelector('#btn-exit-burst').click();
  await flushAsync();
  assert.ok(rootContainer.querySelector('#study-mode-cards'));
  view.onHide();
});

test('Audio Shadowing conceals transcript until Space reveal, grades via 2, and renders Burst Complete summary', async () => {
  const { documentMock, rootContainer } = installDomEnv();
  const requests = [];

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    requests.push({ method: opts.method || 'GET', url: u, body: opts.body ? JSON.parse(opts.body) : null });

    if (u.includes('/api/study-modes/consistency')) {
      return { ok: true, status: 200, json: async () => buildConsistency(2, 3) };
    }
    if (u.endsWith('/api/study-modes/sessions') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 202,
          mode: 'audio_shadowing',
          target_count: 5,
          total_count: 1,
          status: 'in_progress',
          items: [
            {
              item_index: 0,
              audio_url: '/api/media/ankiminer_audio_demo.webm',
              jlpt_level: 'N4',
              concealed: true
            }
          ]
        })
      };
    }
    if (u.includes('/api/study-modes/sessions/202/reveal')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          item_index: 0,
          concealed: false,
          transcript: '毎日図書館で本を読みます。',
          reading: 'まいにちとしょかんでほんをよみます。',
          english_gloss: 'I read books at the library every day.',
          kanji_breakdown: [
            { character: '図', level: 'N4', meanings: ['diagram', 'map'], onyomi: ['ズ', 'ト'], kunyomi: [] }
          ]
        })
      };
    }
    if (u.includes('/api/study-modes/sessions/202/answer')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ item_index: 0, is_correct: true, grade: 'got_it' })
      };
    }
    if (u.includes('/api/study-modes/sessions/202/complete')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 202,
          mode: 'audio_shadowing',
          status: 'completed',
          correct_count: 1,
          total_count: 1,
          attempted_count: 1,
          accuracy_percent: 100,
          consistency: buildConsistency(3, 4)
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { StudyView } = await import(`../src/ui/views/study.js?t=${Date.now() + 3}`);
  const view = new StudyView();
  view.mount(rootContainer);
  view.onShow();
  await flushAsync();

  rootContainer.querySelector('#btn-start-shadowing-burst').click();
  await flushAsync();

  // Concealed before Space reveal; R replays audio
  assert.ok(rootContainer.querySelector('#shadowing-concealed-veil'));
  assert.equal(rootContainer.querySelector('#shadowing-revealed-card'), null);
  const audioEl = rootContainer.querySelector('#shadowing-audio-el');
  assert.ok(audioEl);
  const playsBeforeR = audioEl.playCount;
  documentMock.dispatchKeyDown('r');
  assert.equal(audioEl.playCount, playsBeforeR + 1);

  // Space reveals transcript, gloss, and kanji breakdown
  documentMock.dispatchKeyDown(' ');
  await flushAsync();
  await flushAsync();

  assert.equal(rootContainer.querySelector('#shadowing-concealed-veil'), null);
  assert.ok(rootContainer.querySelector('#shadowing-revealed-card'));
  assert.match(rootContainer.querySelector('#shadowing-transcript-text').textContent, /毎日図書館で本を読みます。/);
  assert.ok(rootContainer.querySelector('#shadowing-kanji-grid'));

  // Press 2 -> Got It, single-item burst completes immediately
  documentMock.dispatchKeyDown('2');
  await flushAsync();
  await flushAsync();

  assert.ok(requests.some((r) => r.url.includes('/answer') && r.body?.user_answer === 'got_it'));
  assert.ok(requests.some((r) => r.url.includes('/complete')));

  const completeCard = rootContainer.querySelector('#study-burst-complete');
  assert.ok(completeCard);
  assert.match(completeCard.textContent, /Burst Complete/);
  assert.match(completeCard.textContent, /3 of 7 days active/);
  assert.ok(rootContainer.querySelector('#btn-burst-back-to-study'));
  assert.ok(rootContainer.querySelector('#btn-burst-start-another'));
  view.onHide();
});

test('Burst lifecycle cleans up audio on advance/exit/unmount, prevents double-autoplay, and avoids leaked keydown listeners', async () => {
  const { documentMock, rootContainer, winListeners } = installDomEnv();
  let revealCount = 0;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/study-modes/consistency')) {
      return { ok: true, status: 200, json: async () => buildConsistency(1, 1) };
    }
    if (u.endsWith('/api/study-modes/sessions') && opts.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 303,
          mode: 'audio_shadowing',
          target_count: 5,
          total_count: 2,
          status: 'active',
          items: [
            { item_index: 0, audio_url: '/api/media/clip_1.webm', jlpt_level: 'N4', revealed: false },
            { item_index: 1, audio_url: '/api/media/clip_2.webm', jlpt_level: 'N4', revealed: false }
          ]
        })
      };
    }
    if (u.includes('/api/study-modes/sessions/303/reveal')) {
      revealCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          item_index: 0,
          revealed: true,
          transcript: '本を読む。',
          reading: 'ほんをよむ。',
          english_gloss: 'Read a book.',
          kanji_breakdown: []
        })
      };
    }
    if (u.includes('/api/study-modes/sessions/303/answer')) {
      return { ok: true, status: 200, json: async () => ({ item_index: 0, is_correct: true }) };
    }
    if (u.includes('/api/study/v1/bank/questions')) {
      return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { StudyView } = await import(`../src/ui/views/study.js?t=${Date.now() + 4}`);
  const view = new StudyView();
  view.mount(rootContainer);
  view.onShow();
  view.onShow(); // Repeated onShow must not register duplicate keydown listeners
  assert.equal((winListeners.get('keydown') || []).length, 1);
  await flushAsync();

  // Existing segments remain intact alongside mode cards
  assert.equal(rootContainer.querySelectorAll('.study-segment-tab').length, 4);

  rootContainer.querySelector('#btn-start-shadowing-burst').click();
  await flushAsync();

  const audioItem1 = rootContainer.querySelector('#shadowing-audio-el');
  assert.ok(audioItem1);
  assert.equal(audioItem1.playCount, 1);

  // Ctrl+R must not trigger replay shortcut
  const ctrlR = documentMock.dispatchKeyDown('r', { ctrlKey: true });
  assert.equal(ctrlR.preventDefaultCalled, false);
  assert.equal(audioItem1.playCount, 1);

  // Space reveals without triggering a second autoplay on #shadowing-audio-el
  documentMock.dispatchKeyDown(' ');
  await flushAsync();
  await flushAsync();
  assert.equal(revealCount, 1);
  assert.equal(audioItem1.playCount, 1);

  // Grading item 0 cleans up item 1 audio before advancing to item 2
  documentMock.dispatchKeyDown('2');
  await flushAsync();
  await flushAsync();
  assert.equal(audioItem1.pauseCount, 1);
  assert.equal(audioItem1.src, '');
  assert.equal(audioItem1.loadCount, 1);

  const audioItem2 = rootContainer.querySelector('#shadowing-audio-el');
  assert.ok(audioItem2);
  assert.equal(audioItem2.playCount, 1);

  // Switching to Bank segment stops active burst audio and ignores burst hotkeys
  view.switchSegment('bank');
  await flushAsync();
  assert.equal(audioItem2.pauseCount, 1);
  documentMock.dispatchKeyDown(' ');
  assert.equal(revealCount, 1);

  // Unmount removes keydown listener completely
  view.unmount();
  assert.equal((winListeners.get('keydown') || []).length, 0);
});
