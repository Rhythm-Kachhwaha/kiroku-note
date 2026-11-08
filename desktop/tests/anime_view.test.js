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
      // Parse child nodes with IDs and classes
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
        const dataTabMatch = attrs.match(/data-tab="([^"]+)"/);
        if (dataTabMatch) child.setAttribute('data-tab', dataTabMatch[1]);
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

test('AnimeView: Renders two-pane layout with Live Cue Hero and Tabbed Deck', () => {
  const container = createMockContainer();
  const view = new AnimeView(null);
  view.container = container;
  view.render();

  const heroPane = container.querySelector('.anime-hero-pane');
  const deckContainer = container.querySelector('.anime-deck-container');
  const historyDisclosure = container.querySelector('#anime-history-disclosure');

  assert.ok(heroPane, 'Should render .anime-hero-pane');
  assert.ok(deckContainer, 'Should render .anime-deck-container');
  assert.ok(historyDisclosure, 'Should render #anime-history-disclosure at bottom');

  // Live Cue box, Controls Bar, and progress bar exist
  const cueBox = container.querySelector('#anime-cue-box');
  const controlsBar = container.querySelector('.anime-controls-bar');
  const progressBar = container.querySelector('#anime-progress-container');

  assert.ok(cueBox, 'Should contain #anime-cue-box');
  assert.ok(controlsBar, 'Should contain .anime-controls-bar');
  assert.ok(progressBar, 'Should contain #anime-progress-container');
});

test('AnimeView: Tabbed Deck switches between Transcript, Inspector, and Queue', () => {
  const container = createMockContainer();
  const view = new AnimeView(null);
  view.container = container;
  view.render();
  view.setupEvents();

  // Initially transcript pane is active
  const transcriptPane = container.querySelector('#pane-transcript');
  assert.ok(transcriptPane, 'Transcript pane exists');

  // Switch to inspector
  view.switchDeckTab('inspector');
  assert.equal(view.inspectorOpen, true);
  const inspectorTabBtn = container.querySelector('#tab-btn-inspector');
  assert.equal(inspectorTabBtn?.getAttribute('aria-selected'), 'true');

  // Switch to queue
  view.switchDeckTab('queue');
  const queueTabBtn = container.querySelector('#tab-btn-queue');
  assert.equal(queueTabBtn?.getAttribute('aria-selected'), 'true');
});

test('AnimeView CSS: Adheres to design tokens, font contracts, and zero raw hex', () => {
  const cssPath = path.join(ROOT_DIR, 'src', 'ui', 'styles', 'views', 'anime.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // No raw hex colors outside allowed tokens/contracts
  const rawHexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  // Ensure any hex matches are absent or strictly comments
  const linesWithHex = css.split('\n').filter(l => /#[0-9a-fA-F]{3,8}\b/.test(l) && !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
  assert.equal(linesWithHex.length, 0, `anime.css should have zero raw hex colors, found in: ${linesWithHex.join('; ')}`);

  // Uses --font-japanese token
  assert.ok(css.includes('var(--font-japanese)'), 'Must use var(--font-japanese)');
  assert.ok(css.includes('var(--tactile-stroke)'), 'Must use var(--tactile-stroke)');
  assert.ok(css.includes('.anime-deck-container'), 'Must style .anime-deck-container');
  assert.ok(css.includes('.anime-progress-track'), 'Must style .anime-progress-track');
});
