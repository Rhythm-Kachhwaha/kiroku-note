const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const statsViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'stats.js');
const statsCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views', 'stats.css');
const topChromeJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'top_chrome.js');
const shellCssPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'shell', 'shell.css');
const routerJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'router.js');

test('Stats View: Top Chrome renders stats action button with animated SVG and navigation', () => {
  const chromeContent = fs.readFileSync(topChromeJsPath, 'utf8');
  const shellCss = fs.readFileSync(shellCssPath, 'utf8');

  assert.ok(
    chromeContent.includes('btn-chrome-stats'),
    'top_chrome.js must render btn-chrome-stats button'
  );
  assert.ok(
    chromeContent.includes('chrome-action-btn-stats'),
    'top_chrome.js must apply chrome-action-btn-stats class'
  );
  assert.ok(
    chromeContent.includes('stats-icon-svg') && chromeContent.includes('stats-bar-1'),
    'top_chrome.js must render animated multi-bar SVG in stats action button'
  );
  assert.ok(
    chromeContent.includes("this.onNavigate('stats')"),
    'top_chrome.js must wire navigation to stats tab'
  );
  assert.ok(
    chromeContent.includes("'stats': { en: 'Stats', ja: '統計' }"),
    'top_chrome.js must register stats tab in section labels'
  );
  assert.ok(
    shellCss.includes('.chrome-action-btn-stats') && shellCss.includes('statsPulseBar'),
    'shell.css must define tactile hover pulse animation for stats button'
  );
});

test('Stats View: Router registers StatsView in client-side routing table', () => {
  const routerContent = fs.readFileSync(routerJsPath, 'utf8');

  assert.ok(
    routerContent.includes("import { StatsView } from './views/stats.js'"),
    'router.js must import StatsView'
  );
  assert.ok(
    routerContent.includes("'stats': StatsView"),
    'router.js must map stats route to StatsView'
  );
});

test('Stats View: High-performance keepAlive lifecycle and non-blocking mount', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');

  assert.ok(
    content.includes('this.keepAlive = true'),
    'StatsView must set keepAlive = true for instant 0ms tab switching'
  );
  const mountMatch = content.match(/async mount\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(
    mountMatch && !mountMatch[1].includes('await this.loadData()'),
    'StatsView.mount must not await loadData to prevent blocking router view transitions'
  );
  assert.ok(
    content.includes('onShow()'),
    'StatsView must implement onShow lifecycle hook'
  );
  assert.ok(
    !content.includes('Ready') && !content.includes('MINING RHYTHM'),
    'StatsView must not contain confusing Ready mining rhythm'
  );
  assert.ok(
    content.includes('val.cards') || content.includes('cardsRes.value?.cards'),
    'StatsView must extract cards array from CardListResponse object'
  );
});

test('Stats View: Zero silent catch blocks in production controller', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');

  assert.ok(
    !content.includes('catch (_) {}'),
    'StatsView must not contain empty silent catch blocks'
  );
});

test('Stats View: Zero forbidden mock data strings in production template', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');
  const forbiddenMockStrings = [
    'LV.28',
    'LV. 28',
    '7 DAY STREAK',
    '7-DAY STREAK',
    '64% MASTERY',
    '64%',
    '〜わけにはいかない',
    '昨夜の雨で庭の土が柔らかくなっている',
    '142/180',
    '142/180 (Pass)'
  ];

  for (const forbidden of forbiddenMockStrings) {
    assert.ok(
      !content.includes(forbidden),
      `StatsView must not contain forbidden mock data string: "${forbidden}"`
    );
  }
});

test('Stats View: Renders brand header, stats bar pill strip, and hero metrics bento', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');

  assert.ok(
    content.includes('grammar-brand-header') && content.includes('STATS') && content.includes('統計'),
    'StatsView must render unified brand header with STATS and 統計'
  );
  assert.ok(
    content.includes('hero-letter'),
    'StatsView must wrap header title letters in hero-letter spans for interactive hover bounce'
  );
  assert.ok(
    content.includes('stats-bar-strip'),
    'StatsView must render tactile stats bar pill strip'
  );
  assert.ok(
    content.includes('stat-total-cards') && content.includes('stat-synced-cards') && content.includes('stat-pending-cards'),
    'StatsView must include total, synced, and pending quick metric pills'
  );
  assert.ok(
    content.includes('stats-hero-grid'),
    'StatsView must render hero metrics bento grid'
  );
});

test('Stats View: Wires data loading from apiClient (getCardStats, getCards, getGrammarStats)', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');

  assert.ok(
    content.includes('apiClient.getCardStats('),
    'StatsView must call apiClient.getCardStats'
  );
  assert.ok(
    content.includes('apiClient.getCards('),
    'StatsView must call apiClient.getCards'
  );
  assert.ok(
    content.includes('apiClient.getGrammarStats('),
    'StatsView must call apiClient.getGrammarStats'
  );
});

test('Stats View: Implements charts, collection health stages, heatmap and collection explorer', () => {
  const content = fs.readFileSync(statsViewPath, 'utf8');

  assert.ok(
    content.includes('chart-retention-wrap'),
    'StatsView must render long-term recall curve chart'
  );
  assert.ok(
    content.includes('chart-forecast-wrap'),
    'StatsView must render workload forecast chart'
  );
  assert.ok(
    content.includes('stages-progress-bar'),
    'StatsView must render collection health stages progress bar'
  );
  assert.ok(
    content.includes('stats-heatmap-grid'),
    'StatsView must render study rhythm heatmap grid'
  );
  assert.ok(
    content.includes('stats-weak-words-list'),
    'StatsView must render weak words leech rescue list'
  );
  assert.ok(
    content.includes('stats-explorer-table') && content.includes('stats-explorer-search'),
    'StatsView must render searchable collection metrics explorer table'
  );
});

test('Stats View: CSS adheres to full width and design token rules', () => {
  const css = fs.readFileSync(statsCssPath, 'utf8');

  assert.ok(
    css.includes('width: 100%') && css.includes('max-width: 100%'),
    'stats.css must utilize full available screen width'
  );
  assert.ok(
    css.includes('--tactile-stroke') && css.includes('--warm-paper'),
    'stats.css must use canonical Kiroku design tokens'
  );
});

