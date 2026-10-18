"""
dashboard_template.py -- Self-contained, responsive HTML/CSS/JS template for the Kiroku Cloud Dashboard.

Aesthetics:
  - Deep obsidian base (#121110) + warm charcoal surfaces (#181715, #211e1b)
  - Signature Kiroku terracotta brand accent (#b84632)
  - Warm amber reading badge (#d4884f)
  - Typography powered by Google Fonts 'Noto Sans JP'
  - Separated views: [Cards Queue] and [Anki Stats]
"""

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Kiroku">
  <title>Kiroku · Recent Cards</title>
  
  <!-- Noto Sans Japanese font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #121110;
      --surface: #181715;
      --surface-elevated: #211e1b;
      --surface-hover: #27231f;
      --border-subtle: #25211e;
      --border-default: #312b26;
      --border-focus: #b84632;
      --text: #ede8e1;
      --text-secondary: #9e948a;
      --text-muted: #8e8a81;
      --accent: #b84632;
      --accent-hover: #c8503a;
      --accent-dim: rgba(184, 70, 50, 0.15);
      --accent-reading: #d4884f;
      --green: #5ea36a;
      --green-dim: rgba(94, 163, 106, 0.15);
      --yellow: #d4954f;
      --yellow-dim: rgba(212, 149, 79, 0.15);
      --red: #cc4f4f;
      --red-dim: rgba(204, 79, 79, 0.15);
      --radius: 12px;
      --radius-sm: 8px;
      --font-ja: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-ja);
      min-height: 100vh;
      padding: max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(2.5rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 640px;
      margin: 0 auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      padding-bottom: 0.85rem;
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }
    .brand-title {
      font-size: 1.28rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--text);
      font-family: var(--font-ja);
    }
    .brand-badge {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      background: var(--accent-dim);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid rgba(184, 70, 50, 0.25);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    button.icon-btn {
      background: var(--surface);
      border: 1px solid var(--border-default);
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      padding: 0.45rem 0.65rem;
      font-size: 0.82rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-family: var(--font-ja);
      transition: all 0.15s ease;
    }
    button.icon-btn:hover, button.icon-btn:active {
      color: var(--text);
      background: var(--surface-hover);
      border-color: var(--border-focus);
    }
    .spin {
      animation: spin 0.7s linear infinite;
      display: inline-block;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    /* Navigation Tabs */
    .nav-tabs {
      display: flex;
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 0.25rem;
      margin-bottom: 1.25rem;
      gap: 0.25rem;
    }
    .nav-tab {
      flex: 1;
      padding: 0.55rem 0.75rem;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.88rem;
      font-weight: 600;
      border-radius: 9px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      font-family: var(--font-ja);
      transition: all 0.15s ease;
    }
    .nav-tab.active {
      background: var(--surface-elevated);
      color: var(--text);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1px solid var(--border-default);
    }
    .nav-tab:not(.active):hover {
      color: var(--text-secondary);
      background: var(--surface-hover);
    }

    /* Views */
    .view-panel { display: none; }
    .view-panel.active { display: block; }

    /* Token Config Box */
    #token-box {
      background: var(--surface);
      border: 1px solid var(--border-default);
      border-radius: var(--radius);
      padding: 1rem 1.15rem;
      margin-bottom: 1.25rem;
    }
    #token-box h2 {
      font-size: 0.95rem;
      margin-bottom: 0.3rem;
      font-weight: 600;
    }
    #token-box p {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.8rem;
      line-height: 1.4;
    }
    .token-input-row {
      display: flex;
      gap: 0.5rem;
    }
    .token-input-row input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border-default);
      color: var(--text);
      padding: 0.5rem 0.75rem;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      font-family: monospace;
      outline: none;
    }
    .token-input-row input:focus {
      border-color: var(--accent);
    }
    .token-input-row button {
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: var(--radius-sm);
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: var(--font-ja);
    }
    .token-input-row button:hover {
      background: var(--accent-hover);
    }

    /* Queue View Styles */
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }
    .stat-pill {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 0.55rem 0.6rem;
      text-align: center;
    }
    .stat-num {
      font-size: 1.15rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .stat-lbl {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.2rem;
    }
    .stat-num.done { color: var(--green); }
    .stat-num.pending { color: var(--yellow); }
    .stat-num.failed { color: var(--red); }

    .card-list {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .vocab-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 0.95rem 1.1rem;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .vocab-card:hover {
      background: var(--surface-hover);
      border-color: var(--border-default);
    }
    .card-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.6rem;
      margin-bottom: 0.35rem;
    }
    .word-group {
      display: flex;
      align-items: baseline;
      gap: 0.55rem;
      flex-wrap: wrap;
    }
    .expression {
      font-family: var(--font-ja);
      font-size: 1.28rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .reading {
      font-family: var(--font-ja);
      font-size: 0.95rem;
      color: var(--accent-reading);
      font-weight: 500;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.22rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .badge.synced {
      background: var(--green-dim);
      color: var(--green);
      border: 1px solid rgba(94, 163, 106, 0.25);
    }
    .badge.pending {
      background: var(--yellow-dim);
      color: var(--yellow);
      border: 1px solid rgba(212, 149, 79, 0.25);
    }
    .badge.failed {
      background: var(--red-dim);
      color: var(--red);
      border: 1px solid rgba(204, 79, 79, 0.25);
    }
    .meaning {
      font-size: 0.92rem;
      color: var(--text-secondary);
      line-height: 1.45;
      margin-bottom: 0.45rem;
    }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.74rem;
      color: var(--text-muted);
    }
    .deck-tag {
      background: var(--surface-elevated);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      font-size: 0.7rem;
    }
    .error-toggle {
      font-size: 0.74rem;
      color: var(--red);
      cursor: pointer;
      text-decoration: underline;
      margin-top: 0.35rem;
      display: inline-block;
    }
    .error-box {
      margin-top: 0.45rem;
      background: var(--red-dim);
      border: 1px solid rgba(204, 79, 79, 0.25);
      border-radius: var(--radius-sm);
      padding: 0.5rem 0.7rem;
      font-size: 0.75rem;
      font-family: monospace;
      color: #fca5a5;
      word-break: break-all;
    }

    /* Anki Stats View Styles */
    .sync-banner {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.8rem;
    }
    .sync-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-secondary);
    }
    .sync-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
    }
    .sync-dot.offline {
      background: var(--text-muted);
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.65rem;
      margin-bottom: 1.25rem;
    }
    .metric-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 1rem;
      position: relative;
      overflow: hidden;
    }
    .metric-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: transparent;
    }
    .metric-card.accent::before {
      background: var(--accent);
    }
    .metric-val {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin-bottom: 0.2rem;
    }
    .metric-val.streak {
      color: #f97316;
    }
    .metric-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .metric-sub {
      font-size: 0.72rem;
      color: var(--text-secondary);
      margin-top: 0.3rem;
    }

    /* Section & Heatmap */
    .section-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 1.15rem;
      margin-bottom: 1.25rem;
    }
    .section-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 0.85rem;
    }
    .section-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text);
    }
    .section-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .heatmap-wrap {
      overflow-x: auto;
      padding-bottom: 0.5rem;
      -webkit-overflow-scrolling: touch;
    }
    .heatmap-grid {
      display: inline-grid;
      grid-template-rows: repeat(7, 12px);
      grid-auto-flow: column;
      grid-auto-columns: 12px;
      gap: 3px;
    }
    .heatmap-cell {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      background: var(--surface-elevated);
      cursor: pointer;
      position: relative;
    }
    .heatmap-cell:hover {
      outline: 1px solid var(--text-secondary);
      z-index: 2;
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.35rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.75rem;
    }
    .legend-box {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }

    /* Tooltip */
    #heatmap-tooltip {
      position: fixed;
      display: none;
      background: #000;
      color: #fff;
      font-size: 0.72rem;
      padding: 0.3rem 0.55rem;
      border-radius: 5px;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      border: 1px solid var(--border-default);
      white-space: nowrap;
    }

    /* Decks List */
    .deck-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.7rem 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .deck-item:last-child { border-bottom: none; }
    .deck-name {
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--text);
    }
    .deck-counts {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.75rem;
    }
    .deck-count-pill {
      background: var(--surface-elevated);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      color: var(--text-secondary);
    }

    /* Offline Anki Guide */
    .anki-guide-card {
      background: var(--surface-elevated);
      border: 1px dashed var(--border-default);
      border-radius: var(--radius);
      padding: 1.15rem;
      margin-bottom: 1.25rem;
      text-align: center;
    }
    .anki-guide-card .guide-icon {
      font-size: 1.5rem;
      margin-bottom: 0.4rem;
    }
    .anki-guide-card h4 {
      font-size: 0.92rem;
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .anki-guide-card p {
      font-size: 0.78rem;
      color: var(--text-secondary);
      line-height: 1.45;
    }

    /* Empty State & Footer */
    .empty-state {
      text-align: center;
      padding: 3rem 1.5rem;
      color: var(--text-muted);
    }
    .empty-state .icon {
      font-size: 2.2rem;
      margin-bottom: 0.6rem;
      opacity: 0.7;
    }
    .empty-state h3 {
      font-size: 1rem;
      color: var(--text);
      margin-bottom: 0.3rem;
    }
    .empty-state p {
      font-size: 0.82rem;
      line-height: 1.5;
    }

    footer {
      text-align: center;
      margin-top: 2rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
    }
    .dot-live {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      display: inline-block;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1 class="brand-title">kiroku</h1>
        <span class="brand-badge">cloud</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="refresh-btn" onclick="refreshActive(true)" title="Refresh">
          <span id="refresh-icon">↻</span> Refresh
        </button>
        <button class="icon-btn" onclick="toggleTokenBox()" title="Configure Access Token">
          ⚙ Key
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <div class="nav-tabs" role="tablist">
      <button class="nav-tab active" id="tab-btn-queue" onclick="switchTab('queue')">
        📥 Cards Queue
      </button>
      <button class="nav-tab" id="tab-btn-stats" onclick="switchTab('stats')">
        📊 Anki Stats
      </button>
    </div>

    <!-- Token Configuration Box -->
    <div id="token-box" style="display: none;">
      <h2>Access Token Configuration</h2>
      <p>Enter your <code>WORKER_TOKEN</code> or <code>SUBMIT_TOKEN</code>. Stored locally in your browser.</p>
      <div class="token-input-row">
        <input type="password" id="token-input" placeholder="Paste Bearer token..." autocomplete="off">
        <button onclick="saveToken()">Save</button>
      </div>
    </div>

    <!-- VIEW 1: Cards Queue -->
    <div id="view-queue" class="view-panel active">
      <div class="stats-bar" id="stats-bar">
        <div class="stat-pill"><div class="stat-num total" id="stat-total">-</div><div class="stat-lbl">Recent</div></div>
        <div class="stat-pill"><div class="stat-num done" id="stat-done">-</div><div class="stat-lbl">Synced</div></div>
        <div class="stat-pill"><div class="stat-num pending" id="stat-pending">-</div><div class="stat-lbl">Pending</div></div>
        <div class="stat-pill"><div class="stat-num failed" id="stat-failed">-</div><div class="stat-lbl">Failed</div></div>
      </div>

      <div class="card-list" id="card-list">
        <div class="empty-state">
          <div class="icon">⏳</div>
          <p>Loading recent cards...</p>
        </div>
      </div>
    </div>

    <!-- VIEW 2: Anki Learning Stats -->
    <div id="view-stats" class="view-panel">
      <div class="sync-banner" id="sync-banner">
        <div class="sync-info">
          <span class="sync-dot offline" id="sync-dot"></span>
          <span id="sync-text">Checking Anki sync status...</span>
        </div>
        <span id="sync-sub" style="color:var(--text-muted);font-size:0.75rem;">Desktop AnkiConnect</span>
      </div>

      <!-- Offline / Not Yet Synced Guidance Card -->
      <div class="anki-guide-card" id="anki-guide" style="display: none;">
        <div class="guide-icon">🔌</div>
        <h4>Anki Desktop Not Synced Yet</h4>
        <p>No study statistics have been sent from AnkiConnect yet.<br>When you open Anki on your PC and run your local Kiroku worker, your real streak, review count, and contribution heatmap will sync here automatically.</p>
      </div>

      <div class="metrics-grid">
        <div class="metric-card accent">
          <div class="metric-val streak" id="metric-streak">-</div>
          <div class="metric-title">Current Streak</div>
          <div class="metric-sub" id="metric-streak-best">Best: - days</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-today">-</div>
          <div class="metric-title">Reviewed Today</div>
          <div class="metric-sub" id="metric-due-today">- cards due</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-total-cards">-</div>
          <div class="metric-title">Total Collection</div>
          <div class="metric-sub" id="metric-deck-count">- decks active</div>
        </div>
        <div class="metric-card">
          <div class="metric-val" id="metric-year-days">-</div>
          <div class="metric-title">Days Studied</div>
          <div class="metric-sub">Past 365 days</div>
        </div>
      </div>

      <!-- Review Heatmap Section -->
      <div class="section-card">
        <div class="section-header">
          <div>
            <div class="section-title">Review Activity Heatmap</div>
            <div class="section-subtitle">Real daily reviews completed in Anki</div>
          </div>
          <div id="heatmap-total-reviews" style="font-size:0.8rem;color:var(--text-secondary);font-weight:600;"></div>
        </div>
        <div class="heatmap-wrap">
          <div class="heatmap-grid" id="heatmap-grid"></div>
        </div>
        <div class="heatmap-legend">
          <span>0</span>
          <div class="legend-box" style="background:var(--surface-elevated)"></div>
          <div class="legend-box" style="background:rgba(184,70,50,0.35)"></div>
          <div class="legend-box" style="background:rgba(184,70,50,0.60)"></div>
          <div class="legend-box" style="background:rgba(184,70,50,0.85)"></div>
          <div class="legend-box" style="background:#b84632"></div>
          <span>50+ reviews</span>
        </div>
      </div>

      <!-- Decks Breakdown Section -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">Deck Breakdown</div>
          <div class="section-subtitle">Cards in Anki</div>
        </div>
        <div id="deck-list">
          <div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0;">No deck data available yet.</div>
        </div>
      </div>
    </div>

    <div id="heatmap-tooltip"></div>

    <footer>
      <span class="dot-live"></span>
      <span id="footer-status">Auto-refresh active (30s)</span>
    </footer>
  </div>

  <script>
    const STORAGE_KEY = 'kiroku_token';
    const LEGACY_STORAGE_KEY = 'kiroku_submit_token';
    const TAB_KEY = 'kiroku_active_tab';

    function getToken() {
      return localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function timeAgo(dateString) {
      if (!dateString) return '';
      try {
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return String(dateString);
        const diffMs = Date.now() - d.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return 'just now';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour}h ago`;
        const diffDay = Math.floor(diffHour / 24);
        if (diffDay < 30) return `${diffDay}d ago`;
        return d.toLocaleDateString();
      } catch (e) {
        return String(dateString);
      }
    }

    function toggleTokenBox() {
      const box = document.getElementById('token-box');
      const isHidden = box.style.display === 'none';
      box.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        document.getElementById('token-input').value = getToken();
        document.getElementById('token-input').focus();
      }
    }

    function saveToken() {
      const val = document.getElementById('token-input').value.trim();
      if (!val) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, val);
      }
      document.getElementById('token-box').style.display = 'none';
      refreshActive(true);
    }

    function switchTab(tabName) {
      localStorage.setItem(TAB_KEY, tabName);
      document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

      const activeBtn = document.getElementById(`tab-btn-${tabName}`);
      const activePanel = document.getElementById(`view-${tabName}`);
      if (activeBtn) activeBtn.classList.add('active');
      if (activePanel) activePanel.classList.add('active');

      if (tabName === 'stats') {
        fetchAnkiStats();
      } else {
        fetchRecent();
      }
    }

    function toggleError(id) {
      const el = document.getElementById(`err-${id}`);
      if (el) el.style.display = (el.style.display === 'none') ? 'block' : 'none';
    }

    async function fetchRecent(manual = false) {
      const token = getToken();
      const listEl = document.getElementById('card-list');
      const footerStatus = document.getElementById('footer-status');

      if (!token) {
        document.getElementById('token-box').style.display = 'block';
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="icon">🔑</div>
            <h3>Authentication Required</h3>
            <p>Please enter your <code>WORKER_TOKEN</code> or <code>SUBMIT_TOKEN</code> in the box above to view your recent cards.</p>
          </div>
        `;
        return;
      }

      if (manual) {
        const icon = document.getElementById('refresh-icon');
        icon.classList.add('spin');
        setTimeout(() => icon.classList.remove('spin'), 700);
      }

      try {
        const resp = await fetch('/recent?limit=25', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });

        if (resp.status === 401) {
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">⚠️</div>
              <h3>Invalid Authentication Token</h3>
              <p>The token you entered was rejected. Click <strong>⚙ Key</strong> to update it.</p>
            </div>
          `;
          return;
        }

        if (!resp.ok) {
          throw new Error(`Server returned HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const items = data.items || [];

        let total = items.length;
        let synced = 0;
        let pending = 0;
        let failed = 0;

        items.forEach(it => {
          if (it.status === 'completed' || it.status === 'synced') synced++;
          else if (it.status === 'pending' || it.status === 'claimed') pending++;
          else if (it.status === 'failed') failed++;
        });

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-done').textContent = synced;
        document.getElementById('stat-pending').textContent = pending;
        document.getElementById('stat-failed').textContent = failed;

        if (items.length === 0) {
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">📭</div>
              <h3>No Cards in Queue</h3>
              <p>Cards you capture and send from your iPhone or ChatGPT will appear here automatically.</p>
            </div>
          `;
        } else {
          listEl.innerHTML = items.map(it => {
            const isSynced = it.status === 'completed' || it.status === 'synced';
            const isPending = it.status === 'pending' || it.status === 'claimed';
            const badgeClass = isSynced ? 'synced' : (isPending ? 'pending' : 'failed');
            const badgeLabel = isSynced ? '✓ Synced' : (isPending ? '⏳ Queued' : '✕ Failed');
            const timeText = timeAgo(it.created_at);
            const hasError = it.error && it.error.trim().length > 0;
            const errId = String(it.id).replace(/[^a-zA-Z0-9_-]/g, '_');

            return `
              <div class="vocab-card">
                <div class="card-top">
                  <div class="word-group">
                    <span class="expression">${escapeHtml(it.expression)}</span>
                    ${it.reading ? `<span class="reading">${escapeHtml(it.reading)}</span>` : ''}
                  </div>
                  <span class="badge ${badgeClass}">${badgeLabel}</span>
                </div>
                ${it.meaning ? `<div class="meaning">${escapeHtml(it.meaning)}</div>` : ''}
                <div class="card-meta">
                  <span class="deck-tag">${escapeHtml(it.deck_name || 'N3 vocabs')}</span>
                  <span>${escapeHtml(timeText)}</span>
                  ${hasError ? `<span class="error-toggle" onclick="toggleError('${errId}')">view error</span>` : ''}
                </div>
                ${hasError ? `<div class="error-box" id="err-${errId}" style="display:none;">${escapeHtml(it.error)}</div>` : ''}
              </div>
            `;
          }).join('');
        }

        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        footerStatus.textContent = 'Updated at ' + nowStr + ' · auto-refreshes every 30s';
      } catch (err) {
        footerStatus.textContent = 'Connection error. Retrying in 30s...';
        if (manual) {
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">⚡</div>
              <h3>Could not connect to server</h3>
              <p>${escapeHtml(err.message)}<br><small style="color:var(--text-muted)">If hosted on Render free tier, server may be waking up.</small></p>
            </div>
          `;
        }
      }
    }

    async function fetchAnkiStats(manual = false) {
      const token = getToken();
      const syncText = document.getElementById('sync-text');
      const syncDot = document.getElementById('sync-dot');
      const guideCard = document.getElementById('anki-guide');

      if (!token) return;

      if (manual) {
        const icon = document.getElementById('refresh-icon');
        icon.classList.add('spin');
        setTimeout(() => icon.classList.remove('spin'), 700);
      }

      try {
        const resp = await fetch('/api/stats/anki', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        });

        if (!resp.ok) return;

        const data = await resp.json();

        if (data.status === 'empty' || !data.stats) {
          syncDot.classList.add('offline');
          syncText.textContent = 'Not synced with Anki yet';
          if (guideCard) guideCard.style.display = 'block';

          // Set clean default metrics
          document.getElementById('metric-streak').textContent = '0d';
          document.getElementById('metric-streak-best').textContent = 'Best: 0 days';
          document.getElementById('metric-today').textContent = '0';
          document.getElementById('metric-due-today').textContent = '0 cards due';
          document.getElementById('metric-total-cards').textContent = '0';
          document.getElementById('metric-deck-count').textContent = '0 decks active';
          document.getElementById('metric-year-days').textContent = '0d';
          renderHeatmap([]);
          return;
        }

        if (guideCard) guideCard.style.display = 'none';
        syncDot.classList.remove('offline');
        const stats = data.stats;
        const syncedAgo = timeAgo(stats.synced_at);
        syncText.textContent = `Synced from Desktop AnkiConnect ${syncedAgo}`;

        // Top Metrics
        document.getElementById('metric-streak').textContent = `🔥 ${stats.current_streak || 0}d`;
        document.getElementById('metric-streak-best').textContent = `Best: ${stats.best_streak || 0} days`;
        document.getElementById('metric-today').textContent = `${stats.today_reviewed || 0}`;
        const sum = stats.summary || {};
        document.getElementById('metric-due-today').textContent = `${sum.total_due_today || 0} cards due`;
        document.getElementById('metric-total-cards').textContent = (sum.total_cards || 0).toLocaleString();
        const decks = stats.decks || [];
        document.getElementById('metric-deck-count').textContent = `${decks.length} active deck${decks.length === 1 ? '' : 's'}`;
        document.getElementById('metric-year-days').textContent = `${stats.days_studied_past_year || 0}d`;

        if (stats.total_reviews) {
          document.getElementById('heatmap-total-reviews').textContent = `${Number(stats.total_reviews).toLocaleString()} total reviews`;
        }

        // Render Heatmap
        renderHeatmap(stats.cards_reviewed_by_day || []);

        // Render Decks Breakdown
        renderDecks(decks);
      } catch (err) {
        console.warn('Failed to fetch Anki stats:', err);
      }
    }

    function renderHeatmap(dailyList) {
      const grid = document.getElementById('heatmap-grid');
      const tooltip = document.getElementById('heatmap-tooltip');
      if (!grid) return;

      const reviewMap = {};
      dailyList.forEach(entry => {
        if (Array.isArray(entry) && entry.length >= 2) {
          reviewMap[entry[0]] = Number(entry[1]) || 0;
        }
      });

      // Build grid for past 52 weeks (364 days) up to today
      const cells = [];
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 is Sunday
      const totalDays = 52 * 7;
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - totalDays + (6 - dayOfWeek));

      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateKey = `${yyyy}-${mm}-${dd}`;
        const count = reviewMap[dateKey] || 0;

        let bg = 'var(--surface-elevated)';
        if (count > 0 && count < 10) bg = 'rgba(184, 70, 50, 0.35)';
        else if (count >= 10 && count < 25) bg = 'rgba(184, 70, 50, 0.60)';
        else if (count >= 25 && count < 50) bg = 'rgba(184, 70, 50, 0.85)';
        else if (count >= 50) bg = '#b84632';

        cells.push(`
          <div class="heatmap-cell" style="background:${bg}" data-date="${dateKey}" data-count="${count}"></div>
        `);
      }

      grid.innerHTML = cells.join('');

      // Add tooltip interactions
      grid.querySelectorAll('.heatmap-cell').forEach(cell => {
        cell.addEventListener('mouseenter', e => {
          const dateStr = cell.getAttribute('data-date');
          const count = cell.getAttribute('data-count');
          tooltip.textContent = `${dateStr}: ${count} review${count === '1' ? '' : 's'}`;
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX + 10}px`;
          tooltip.style.top = `${e.clientY + 10}px`;
        });
        cell.addEventListener('mousemove', e => {
          tooltip.style.left = `${e.clientX + 10}px`;
          tooltip.style.top = `${e.clientY + 10}px`;
        });
        cell.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
        // Mobile tap support
        cell.addEventListener('click', e => {
          const dateStr = cell.getAttribute('data-date');
          const count = cell.getAttribute('data-count');
          tooltip.textContent = `${dateStr}: ${count} review${count === '1' ? '' : 's'}`;
          tooltip.style.display = 'block';
          tooltip.style.left = `${e.clientX - 40}px`;
          tooltip.style.top = `${e.clientY - 35}px`;
          setTimeout(() => { tooltip.style.display = 'none'; }, 2500);
        });
      });
    }

    function renderDecks(decks) {
      const container = document.getElementById('deck-list');
      if (!container) return;

      if (!decks || decks.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:0.5rem 0;">No deck data found in Anki.</div>';
        return;
      }

      container.innerHTML = decks.map(d => `
        <div class="deck-item">
          <div class="deck-name">${escapeHtml(d.name || 'Deck')}</div>
          <div class="deck-counts">
            <span class="deck-count-pill" title="New due">${d.new || 0} new</span>
            <span class="deck-count-pill" title="Review due">${d.review || 0} due</span>
            <span style="color:var(--text);font-weight:600;min-width:45px;text-align:right;">${(d.total || 0).toLocaleString()}</span>
          </div>
        </div>
      `).join('');
    }

    function refreshActive(manual = false) {
      const activeTab = localStorage.getItem(TAB_KEY) || 'queue';
      if (activeTab === 'stats') {
        fetchAnkiStats(manual);
      } else {
        fetchRecent(manual);
      }
    }

    // Initialization
    const savedTab = localStorage.getItem(TAB_KEY) || 'queue';
    switchTab(savedTab);

    // Auto-refresh interval (30s)
    setInterval(() => {
      refreshActive(false);
    }, 30000);
  </script>
</body>
</html>"""
