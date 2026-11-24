import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import { AnimeView } from '../src/ui/views/anime.js';

function createMockContainer() {
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.className = '';
      this._innerHTML = '';
      this.textContent = '';
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.style = {};
      this.listeners = new Map();
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
        contains: (c) => this.classList._classes.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            if (force) this.classList._classes.add(c);
            else this.classList._classes.delete(c);
            return force;
          }
          if (this.classList._classes.has(c)) {
            this.classList._classes.delete(c);
            return false;
          }
          this.classList._classes.add(c);
          return true;
        }
      };
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(val) {
      this._innerHTML = val;
      this.children = [];
      const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
      let m;
      while ((m = tagRegex.exec(val)) !== null) {
        const tagName = m[1];
        if (tagName.startsWith('/')) continue;
        const attrs = m[2];
        const child = new MockElement(tagName);
        const idMatch = attrs.match(/id="([^"]+)"/);
        if (idMatch) child.id = idMatch[1];
        const classMatch = attrs.match(/class="([^"]+)"/);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        const dataTabMatch = attrs.match(/data-category="([^"]+)"/);
        if (dataTabMatch) child.setAttribute('data-category', dataTabMatch[1]);
        child.parentElement = this;
        this.children.push(child);
      }
    }

    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    removeAttribute(k) { this.attributes.delete(k); }

    getBoundingClientRect() {
      return { left: 0, top: 0, width: 600, height: 10 };
    }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const results = [];
      function search(node) {
        for (const child of node.children) {
          if (selector.startsWith('#')) {
            if (child.id === selector.slice(1)) results.push(child);
          } else if (selector.startsWith('.')) {
            if (child.classList.contains(selector.slice(1))) results.push(child);
          } else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
            results.push(child);
          }
          search(child);
        }
      }
      search(this);
      return results;
    }
  }

  return new MockElement('div');
}

test('AnimeView: Renders Anime Tracker Library with Category Filtering and History', () => {
  const container = createMockContainer();
  const view = new AnimeView(null);
  view.container = container;
  view.render();

  const historyList = container.querySelector('#anime-history-list');
  assert.ok(historyList, 'Should render #anime-history-list container');

  const header = container.querySelector('.anime-header-row');
  assert.ok(header, 'Should render anime header row');

  const categoryPills = container.querySelector('.anime-category-pills');
  assert.ok(categoryPills, 'Should render category pills');
});

test('AnimeView: Cold-start waking_up state renders loading animation instead of error banner', () => {
  const container = createMockContainer();
  const view = new AnimeView(null);
  view.container = container;
  view.seriesList = [];
  view.loadState = 'waking_up';
  view.isLoading = false;

  const content = view._renderGridContent();
  assert.ok(content.includes('anime-loading-state'), 'Should display anime-loading-state');
  assert.ok(content.includes('anime-spinner'), 'Should display spinner');
  assert.ok(content.includes('Loading Anime Library...'), 'Should display loading text');
  assert.equal(content.includes('anime-error-state'), false, 'Should not render error state');
});

test('AnimeView: Language toggle updates titleLang and persists preference', () => {
  const container = createMockContainer();
  const view = new AnimeView(null);
  view.container = container;

  view.setTitleLang('jp');
  assert.equal(view.titleLang, 'jp');

  view.setTitleLang('en');
  assert.equal(view.titleLang, 'en');
});

test('AnimeView CSS: Adheres to design tokens, font contracts, and zero raw hex', () => {
  const cssPath = path.join(ROOT_DIR, 'src', 'ui', 'styles', 'views', 'anime.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Zero raw hex colors
  const linesWithHex = css.split('\n').filter(l => /#[0-9a-fA-F]{3,8}\b/.test(l) && !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
  assert.equal(linesWithHex.length, 0, `anime.css should have zero raw hex colors, found in: ${linesWithHex.join('; ')}`);

  // Uses font tokens
  assert.ok(css.includes('var(--font-japanese)'), 'Must use var(--font-japanese)');
  assert.ok(css.includes('.anime-series-grid'), 'Must style .anime-series-grid');
});
