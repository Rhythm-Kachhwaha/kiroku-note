"""
dashboard_template.py -- Self-contained, responsive HTML/CSS/JS template for the Kiroku Cloud Dashboard.

Aesthetics:
  - Deep obsidian base (#121110) + warm charcoal surfaces (#181715, #211e1b)
  - Signature Kiroku terracotta brand accent (#b84632)
  - Warm amber reading badge (#d4884f)
  - Pure white unified brand heading ("kiroku cloud")
  - Zero OS emojis -- pure vector SVG icons everywhere
  - Interactive Card Hero Inspection Modal matching the Kiroku Extension Side Panel
  - Typography powered by Google Fonts 'Noto Sans JP'
  - Separated views: [Cards] and [Anki Stats]
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
      align-items: center;
    }
    .brand-title {
      font-size: 1.28rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
      font-family: var(--font-ja);
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
      padding: 0.5rem 0.8rem;
      min-height: 40px;
      font-size: 0.85rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-family: var(--font-ja);
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    button.icon-btn:hover, button.icon-btn:active {
      color: var(--text);
      background: var(--surface-hover);
      border-color: var(--border-focus);
    }
    .svg-icon {
      width: 15px;
      height: 15px;
      stroke-width: 2;
      stroke: currentColor;
      fill: none;
      flex-shrink: 0;
      display: inline-block;
      vertical-align: middle;
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
      padding: 0.6rem 0.75rem;
      min-height: 44px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.9rem;
      font-weight: 600;
      border-radius: 9px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      font-family: var(--font-ja);
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    .nav-tab .svg-icon {
      width: 17px;
      height: 17px;
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
      padding: 0.6rem 0.75rem;
      min-height: 42px;
      border-radius: var(--radius-sm);
      font-size: 16px; /* 16px prevents iOS Safari auto-zoom */
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
      padding: 0.6rem 1.15rem;
      min-height: 42px;
      border-radius: var(--radius-sm);
      font-weight: 600;
      font-size: 0.88rem;
      cursor: pointer;
      font-family: var(--font-ja);
      touch-action: manipulation;
    }
    .token-input-row button:hover {
      background: var(--accent-hover);
    }

    /* Cards View Styles */
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
      padding: 0.55rem 0.4rem;
      text-align: center;
      min-width: 0;
      overflow: hidden;
    }
    .stat-num {
      font-size: 1.15rem;
      font-weight: 700;
      line-height: 1.2;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stat-lbl {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 0.2rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      min-width: 0;
      cursor: pointer;
      position: relative;
      transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .vocab-card:hover {
      background: var(--surface-hover);
      border-color: var(--border-default);
      transform: translateY(-1px);
    }
    .vocab-card:active {
      transform: translateY(0);
    }
    .vocab-card:focus-visible {
      outline: 2px solid var(--border-focus);
      outline-offset: 2px;
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
      min-width: 0;
    }
    .expression {
      font-family: var(--font-ja);
      font-size: 1.28rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .reading {
      font-family: var(--font-ja);
      font-size: 0.95rem;
      color: var(--accent-reading);
      font-weight: 500;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.22rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    .badge-icon {
      width: 11px;
      height: 11px;
      stroke-width: 2.2;
      stroke: currentColor;
      fill: none;
      flex-shrink: 0;
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
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.74rem;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    .deck-tag {
      background: var(--surface-elevated);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      font-size: 0.7rem;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-click-hint {
      margin-left: auto;
      font-size: 0.7rem;
      color: var(--text-muted);
      opacity: 0.8;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }
    .error-toggle {
      font-size: 0.74rem;
      color: var(--red);
      cursor: pointer;
      text-decoration: underline;
      margin-top: 0.35rem;
      display: inline-block;
      min-height: 32px;
      line-height: 32px;
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
      min-width: 0;
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
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .metric-val.streak {
      color: #f97316;
    }
    .streak-icon {
      width: 22px;
      height: 22px;
      fill: #f97316;
      flex-shrink: 0;
    }
    .metric-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metric-sub {
      font-size: 0.72rem;
      color: var(--text-secondary);
      margin-top: 0.3rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Section & Heatmap */
    .section-card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      padding: 1.15rem;
      margin-bottom: 1.25rem;
      min-width: 0;
    }
    .section-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 0.85rem;
      gap: 0.5rem;
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
      overscroll-behavior-x: contain;
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
      touch-action: manipulation;
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
      flex-wrap: wrap;
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
      font-size: 0.74rem;
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 4px 14px rgba(0,0,0,0.6);
      border: 1px solid var(--border-default);
      white-space: nowrap;
    }

    /* Decks List */
    .deck-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border-subtle);
      min-width: 0;
    }
    .deck-item:last-child { border-bottom: none; }
    .deck-name {
      font-size: 0.88rem;
      font-weight: 500;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .deck-counts {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.75rem;
      flex-shrink: 0;
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
      margin-bottom: 0.5rem;
      display: flex;
      justify-content: center;
      color: var(--text-muted);
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

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 3rem 1.5rem;
      color: var(--text-muted);
    }
    .empty-state .icon {
      margin-bottom: 0.85rem;
      display: flex;
      justify-content: center;
      color: var(--text-muted);
      opacity: 0.85;
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

    /* Card Hero Modal (Extension Showcase Replica) */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.76);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      z-index: 1200;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
    }
    .modal-backdrop.open {
      opacity: 1;
      visibility: visible;
    }
    .hero-modal-card {
      background: var(--surface);
      border: 1px solid var(--border-default);
      border-radius: 16px;
      width: 100%;
      max-width: 520px;
      max-height: 88vh;
      overflow-y: auto;
      padding: 1.6rem 1.4rem;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);
      position: relative;
      transform: translateY(12px) scale(0.98);
      transition: transform 0.2s ease;
    }
    .modal-backdrop.open .hero-modal-card {
      transform: translateY(0) scale(1);
    }
    .hero-modal-close {
      position: absolute;
      top: 0.85rem;
      right: 0.85rem;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    .hero-modal-close:hover, .hero-modal-close:active {
      background: var(--surface-hover);
      color: #ffffff;
      border-color: var(--border-default);
    }

    /* Hero Showcase Elements */
    .hero-showcase {
      text-align: center;
      padding: 0.5rem 0 1.25rem;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 1.25rem;
    }
    .hero-reading-lead {
      font-family: var(--font-ja);
      font-size: 1.05rem;
      font-weight: 500;
      color: var(--accent-reading);
      letter-spacing: 0.03em;
      min-height: 1.4rem;
      margin-bottom: 0.35rem;
      word-break: break-word;
    }
    .hero-expression-lead {
      font-family: var(--font-ja);
      font-size: 2.6rem;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
      letter-spacing: 0.02em;
      margin: 0 0 0.85rem;
      word-break: break-word;
    }
    .hero-badges-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .jlpt-badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.18rem 0.55rem;
      border-radius: 4px;
      background: var(--accent-dim);
      color: var(--accent);
      border: 1px solid rgba(184, 70, 50, 0.35);
      letter-spacing: 0.05em;
    }

    /* Modal Content Sections */
    .modal-section {
      margin-bottom: 1.15rem;
    }
    .modal-section-title {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      margin-bottom: 0.45rem;
    }
    .modal-meaning-box {
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 0.85rem 1rem;
    }
    .meaning-item {
      font-size: 0.94rem;
      color: var(--text);
      line-height: 1.55;
      margin-bottom: 0.35rem;
    }
    .meaning-item:last-child { margin-bottom: 0; }
    
    .modal-sentence-box {
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 0.85rem 1rem;
    }
    .sentence-jp {
      font-family: var(--font-ja);
      font-size: 1rem;
      line-height: 1.6;
      color: var(--text);
      margin-bottom: 0.45rem;
      word-break: break-word;
    }
    .sentence-jp mark.highlight {
      background: transparent;
      color: #ffffff;
      font-weight: 700;
      border-bottom: 2px solid var(--accent);
      padding-bottom: 1px;
    }
    .sentence-en {
      font-size: 0.84rem;
      color: var(--text-secondary);
      line-height: 1.45;
    }

    .modal-hint-box {
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 0.9rem;
      color: var(--text);
      line-height: 1.5;
      word-break: break-word;
    }
    .modal-notes-box {
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      color: var(--text);
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .modal-context-box {
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      font-size: 0.88rem;
      color: var(--text-secondary);
      line-height: 1.5;
      word-break: break-word;
    }
    .modal-tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: center;
    }
    .modal-tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      font-weight: 500;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      background: var(--surface-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
      letter-spacing: 0.02em;
    }

    .modal-meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.65rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--border-subtle);
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .modal-meta-item strong {
      display: block;
      color: var(--text-secondary);
      font-weight: 600;
      margin-bottom: 0.15rem;
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

    /* Responsive Mobile Overrides */
    @media (max-width: 480px) {
      body {
        padding: max(0.9rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right)) max(2.5rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
      }
      .brand-title { font-size: 1.15rem; }
      .metrics-grid { gap: 0.5rem; }
      .metric-card { padding: 0.85rem 0.75rem; }
      .metric-val { font-size: 1.4rem; }
      .stats-bar { gap: 0.35rem; }
      .stat-pill { padding: 0.5rem 0.25rem; }
      .stat-num { font-size: 1.05rem; }
      .stat-lbl { font-size: 0.62rem; }
      .section-card { padding: 1rem 0.85rem; }

      .modal-backdrop {
        align-items: flex-end;
        padding: 0;
      }
      .hero-modal-card {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
        max-height: 85vh;
        padding: 1.5rem 1.15rem max(1.5rem, env(safe-area-inset-bottom));
        transform: translateY(100%);
      }
      .modal-backdrop.open .hero-modal-card {
        transform: translateY(0);
      }
      .hero-expression-lead { font-size: 2.2rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1 class="brand-title">kiroku cloud</h1>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="refresh-btn" onclick="refreshActive(true)" title="Refresh data">
          <span id="refresh-icon">
            <svg class="svg-icon" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
          </span>
          Refresh
        </button>
        <button class="icon-btn" onclick="toggleTokenBox()" title="Configure Access Token">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="m15.5 8.5 5 5-2 2-2-2-2 2-1.5-1.5M7 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>
          Key
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <div class="nav-tabs" role="tablist">
      <button class="nav-tab active" id="tab-btn-queue" onclick="switchTab('queue')">
        <svg class="svg-icon" viewBox="0 0 24 24"><rect x="2" y="7" width="16" height="14" rx="2"/><path d="M6 3h14a2 2 0 0 1 2 2v12"/></svg>
        Cards
      </button>
      <button class="nav-tab" id="tab-btn-stats" onclick="switchTab('stats')">
        <svg class="svg-icon" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
        Anki Stats
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

    <!-- VIEW 1: Cards -->
    <div id="view-queue" class="view-panel active">
      <div class="stats-bar" id="stats-bar">
        <div class="stat-pill"><div class="stat-num total" id="stat-total">-</div><div class="stat-lbl">Recent</div></div>
        <div class="stat-pill"><div class="stat-num done" id="stat-done">-</div><div class="stat-lbl">Synced</div></div>
        <div class="stat-pill"><div class="stat-num pending" id="stat-pending">-</div><div class="stat-lbl">Queued</div></div>
        <div class="stat-pill"><div class="stat-num failed" id="stat-failed">-</div><div class="stat-lbl">Failed</div></div>
      </div>

      <div class="card-list" id="card-list">
        <div class="empty-state">
          <div class="icon">
            <svg class="svg-icon spin" style="width:32px;height:32px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/></svg>
          </div>
          <p>Loading recent cards...</p>
        </div>
      </div>
    </div>

    <!-- VIEW 2: Anki Learning Stats -->
    <div id="view-stats" class="view-panel">
      <!-- Offline / Not Yet Synced Guidance Card -->
      <div class="anki-guide-card" id="anki-guide" style="display: none;">
        <div class="guide-icon">
          <svg class="svg-icon" style="width:30px;height:30px;" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </div>
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

  <!-- Card Hero Inspection Modal (Extension Showcase Replica) -->
  <div id="hero-modal" class="modal-backdrop" onclick="onModalBackdropClick(event)">
    <div class="hero-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-expression">
      <button class="hero-modal-close" onclick="closeHeroModal()" title="Close (Esc)" aria-label="Close modal">
        <svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <div class="hero-showcase">
        <div id="modal-reading" class="hero-reading-lead"></div>
        <h2 id="modal-expression" class="hero-expression-lead">-</h2>
        <div id="modal-badges" class="hero-badges-row"></div>
      </div>

      <div class="modal-section" id="modal-section-meaning">
        <div class="modal-section-title">Definition</div>
        <div class="modal-meaning-box" id="modal-meaning-content"></div>
      </div>

      <div class="modal-section" id="modal-section-sentence" style="display: none;">
        <div class="modal-section-title">Context Sentence</div>
        <div class="modal-sentence-box">
          <div class="sentence-jp" id="modal-sentence-jp"></div>
          <div class="sentence-en" id="modal-sentence-en"></div>
        </div>
      </div>

      <div class="modal-section" id="modal-section-hint" style="display: none;">
        <div class="modal-section-title">Hint</div>
        <div class="modal-hint-box" id="modal-hint-content"></div>
      </div>

      <div class="modal-section" id="modal-section-notes" style="display: none;">
        <div class="modal-section-title">Notes</div>
        <div class="modal-notes-box" id="modal-notes-content"></div>
      </div>

      <div class="modal-section" id="modal-section-context" style="display: none;">
        <div class="modal-section-title">Source Context</div>
        <div class="modal-context-box" id="modal-context-content"></div>
      </div>

      <div class="modal-section" id="modal-section-tags" style="display: none;">
        <div class="modal-section-title">Tags</div>
        <div class="modal-tags-row" id="modal-tags-content"></div>
      </div>

      <div class="modal-meta-grid">
        <div class="modal-meta-item">
          <strong>Deck</strong>
          <span id="modal-meta-deck">-</span>
        </div>
        <div class="modal-meta-item">
          <strong>Captured</strong>
          <span id="modal-meta-time">-</span>
        </div>
      </div>

      <div id="modal-error-wrap" style="display: none; margin-top: 1rem;">
        <div class="error-box" id="modal-error-content"></div>
      </div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = 'kiroku_token';
    const LEGACY_STORAGE_KEY = 'kiroku_submit_token';
    const TAB_KEY = 'kiroku_active_tab';

    // SVG icon constants for zero-emoji rendering
    const SVG_CHECK = '<svg class="badge-icon" viewBox="0 0 16 16"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>';
    const SVG_CLOCK = '<svg class="badge-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><polyline points="8 4.5 8 8 10.5 9.5"/></svg>';
    const SVG_CROSS = '<svg class="badge-icon" viewBox="0 0 16 16"><line x1="4.5" y1="4.5" x2="11.5" y2="11.5"/><line x1="11.5" y1="4.5" x2="4.5" y2="11.5"/></svg>';
    const SVG_FLAME = '<svg class="streak-icon" viewBox="0 0 24 24"><path d="M12 23c-4.97 0-9-3.8-9-8.5 0-3.35 2.1-6.73 4.56-9.17a1 1 0 0 1 1.63.48c.32 1.5.89 3.03 1.81 4.19.2.25.56.29.81.08.3-.26.39-.7.21-1.05C11.13 7.22 11 5.3 11 3.5a1 1 0 0 1 1.54-.84C15.93 4.8 21 9.57 21 14.5c0 4.7-4.03 8.5-9 8.5z"/></svg>';

    // In-memory cache of loaded cards for modal inspection
    window.__cardsCache = [];

    // Auto-detect token in URL query parameter (?token=... or ?key=...)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryToken = (urlParams.get('token') || urlParams.get('key') || '').trim();
      if (queryToken) {
        localStorage.setItem(STORAGE_KEY, queryToken);
        const cleanUrl = window.location.pathname + (window.location.hash || '');
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (e) {
      console.debug('Query param extraction skipped:', e);
    }

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

    function toggleError(id, event) {
      if (event) event.stopPropagation();
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
            <div class="icon">
              <svg class="svg-icon" style="width:36px;height:36px;" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
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
              <div class="icon">
                <svg class="svg-icon" style="width:36px;height:36px;" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <h3>Invalid Authentication Token</h3>
              <p>The token you entered was rejected. Click <strong>Key</strong> in the header to update it.</p>
            </div>
          `;
          return;
        }

        if (!resp.ok) {
          throw new Error(`Server returned HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const items = data.items || [];
        window.__cardsCache = items;

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
              <div class="icon">
                <svg class="svg-icon" style="width:36px;height:36px;" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              </div>
              <h3>No Cards in Queue</h3>
              <p>Cards you capture and send from your iPhone or ChatGPT will appear here automatically.</p>
            </div>
          `;
        } else {
          listEl.innerHTML = items.map((it, idx) => {
            const isSynced = it.status === 'completed' || it.status === 'synced';
            const isPending = it.status === 'pending' || it.status === 'claimed';
            const badgeClass = isSynced ? 'synced' : (isPending ? 'pending' : 'failed');
            const badgeIcon = isSynced ? SVG_CHECK : (isPending ? SVG_CLOCK : SVG_CROSS);
            const badgeLabel = isSynced ? 'Synced' : (isPending ? 'Queued' : 'Failed');
            const timeText = timeAgo(it.created_at);
            const hasError = it.error && it.error.trim().length > 0;
            const errId = String(it.id).replace(/[^a-zA-Z0-9_-]/g, '_');

            return `
              <div class="vocab-card" tabindex="0" role="button" aria-label="Open card details for ${escapeHtml(it.expression)}" onclick="openHeroModal(${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openHeroModal(${idx});}">
                <div class="card-top">
                  <div class="word-group">
                    <span class="expression">${escapeHtml(it.expression)}</span>
                    ${it.reading ? `<span class="reading">${escapeHtml(it.reading)}</span>` : ''}
                  </div>
                  <span class="badge ${badgeClass}">${badgeIcon}<span>${badgeLabel}</span></span>
                </div>
                ${it.meaning ? `<div class="meaning">${escapeHtml(it.meaning)}</div>` : ''}
                <div class="card-meta">
                  <span class="deck-tag">${escapeHtml(it.deck_name || 'N3 vocabs')}</span>
                  <span>${escapeHtml(timeText)}</span>
                  ${hasError ? `<span class="error-toggle" onclick="toggleError('${errId}', event)">view error</span>` : ''}
                  <span class="card-click-hint">view details &rsaquo;</span>
                </div>
                ${hasError ? `<div class="error-box" id="err-${errId}" style="display:none;" onclick="event.stopPropagation()">${escapeHtml(it.error)}</div>` : ''}
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
              <div class="icon">
                <svg class="svg-icon" style="width:36px;height:36px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h3>Could not connect to server</h3>
              <p>${escapeHtml(err.message)}<br><small style="color:var(--text-muted)">If hosted on Render free tier, server may be waking up.</small></p>
            </div>
          `;
        }
      }
    }

    /* Hero Modal Handlers (Extension Showcase Replica) */
    function openHeroModal(index) {
      const card = window.__cardsCache[index];
      if (!card) return;

      const modal = document.getElementById('hero-modal');
      const readingEl = document.getElementById('modal-reading');
      const exprEl = document.getElementById('modal-expression');
      const badgesEl = document.getElementById('modal-badges');
      const meaningContent = document.getElementById('modal-meaning-content');
      const sentenceSection = document.getElementById('modal-section-sentence');
      const sentenceJp = document.getElementById('modal-sentence-jp');
      const sentenceEn = document.getElementById('modal-sentence-en');
      const metaDeck = document.getElementById('modal-meta-deck');
      const metaTime = document.getElementById('modal-meta-time');
      const errorWrap = document.getElementById('modal-error-wrap');
      const errorContent = document.getElementById('modal-error-content');

      // Resolve card payload if available
      let payload = {};
      if (card.payload_json) {
        try {
          payload = typeof card.payload_json === 'string' ? JSON.parse(card.payload_json) : (card.payload_json || {});
        } catch (e) {}
      }

      // 1. Reading
      readingEl.textContent = (card.reading || payload.reading || '').trim();

      // 2. Expression
      exprEl.textContent = card.expression || payload.expression || '—';

      // 3. Badges
      let jlptLevel = card.jlpt_level || payload.jlpt_level || '';
      if (!jlptLevel && Array.isArray(payload.tags)) {
        for (const t of payload.tags) {
          const m = String(t).match(/^jlpt[-_]?n([1-5])$/i) || String(t).match(/^n([1-5])$/i);
          if (m) { jlptLevel = 'N' + m[1]; break; }
        }
      }

      const isSynced = card.status === 'completed' || card.status === 'synced';
      const isPending = card.status === 'pending' || card.status === 'claimed';
      const badgeClass = isSynced ? 'synced' : (isPending ? 'pending' : 'failed');
      const badgeIcon = isSynced ? SVG_CHECK : (isPending ? SVG_CLOCK : SVG_CROSS);
      const badgeLabel = isSynced ? 'Synced' : (isPending ? 'Queued' : 'Failed');

      let badgesHtml = '';
      if (jlptLevel) {
        badgesHtml += `<span class="jlpt-badge">${escapeHtml(jlptLevel.toUpperCase())}</span>`;
      }
      badgesHtml += `<span class="badge ${badgeClass}">${badgeIcon}<span>${badgeLabel}</span></span>`;
      badgesHtml += `<span class="deck-tag">${escapeHtml(card.deck_name || payload.deck_name || 'N3 vocabs')}</span>`;
      badgesEl.innerHTML = badgesHtml;

      // 4. Meanings (clean split into bulleted/numbered lines matching extension)
      const rawMeaning = (card.meaning || payload.meaning || '').trim();
      if (!rawMeaning) {
        meaningContent.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No definitions recorded for this card.</div>';
      } else {
        let parts = [];
        if (rawMeaning.includes('\\n')) {
          parts = rawMeaning.split(/\\r?\\n/).map(s => s.trim().replace(/^\\d+[\\.\\)]\\s*/, '').trim()).filter(Boolean);
        } else if (/^\\s*\\d+[\\.\\)]/.test(rawMeaning)) {
          parts = rawMeaning.split(/(?:^|\\s+)\\d+[\\.\\)]\\s*/).map(s => s.trim()).filter(Boolean);
        } else if (rawMeaning.includes(';')) {
          parts = rawMeaning.split(/;/).map(s => s.trim().replace(/^\\d+[\\.\\)]\\s*/, '').trim()).filter(Boolean);
        } else {
          parts = [rawMeaning];
        }

        if (parts.length <= 1) {
          meaningContent.innerHTML = `<div class="meaning-item">${escapeHtml(rawMeaning)}</div>`;
        } else {
          meaningContent.innerHTML = parts.map((p, i) => `<div class="meaning-item"><strong>${i + 1}.</strong> ${escapeHtml(p)}</div>`).join('');
        }
      }

      // 5. Context Sentence
      const sentence = (card.sentence || payload.sentence || payload.example_sentence || '').trim();
      const sentenceMeaning = (card.sentence_meaning || payload.sentence_meaning || payload.example_translation || '').trim();
      if (sentence) {
        sentenceSection.style.display = 'block';
        const expr = card.expression || payload.expression || '';
        let highlightedSentence = escapeHtml(sentence);
        if (expr && highlightedSentence.includes(escapeHtml(expr))) {
          highlightedSentence = highlightedSentence.split(escapeHtml(expr)).join(`<mark class="highlight">${escapeHtml(expr)}</mark>`);
        }
        sentenceJp.innerHTML = highlightedSentence;
        sentenceEn.textContent = sentenceMeaning;
        sentenceEn.style.display = sentenceMeaning ? 'block' : 'none';
      } else {
        sentenceSection.style.display = 'none';
      }

      // 6. Hint (conditional - shown only if filled)
      const hintSection = document.getElementById('modal-section-hint');
      const hintContent = document.getElementById('modal-hint-content');
      const rawHint = (card.hint || payload.hint || '').trim();
      if (rawHint && hintSection && hintContent) {
        hintContent.textContent = rawHint;
        hintSection.style.display = 'block';
      } else if (hintSection) {
        hintSection.style.display = 'none';
      }

      // 7. Notes (conditional - shown only if filled)
      const notesSection = document.getElementById('modal-section-notes');
      const notesContent = document.getElementById('modal-notes-content');
      const rawNotes = (card.notes || payload.notes || '').trim();
      if (rawNotes && notesSection && notesContent) {
        notesContent.textContent = rawNotes;
        notesSection.style.display = 'block';
      } else if (notesSection) {
        notesSection.style.display = 'none';
      }

      // 8. Source Context (conditional - shown if distinct from sentence & meaning)
      const contextSection = document.getElementById('modal-section-context');
      const contextContent = document.getElementById('modal-context-content');
      const rawContext = (card.context || payload.context || payload.source_text || '').trim();
      if (rawContext && rawContext !== sentence && rawContext !== rawMeaning && contextSection && contextContent) {
        contextContent.textContent = rawContext;
        contextSection.style.display = 'block';
      } else if (contextSection) {
        contextSection.style.display = 'none';
      }

      // 9. Tags (conditional - shown only if filled)
      const tagsSection = document.getElementById('modal-section-tags');
      const tagsContent = document.getElementById('modal-tags-content');
      const rawTags = card.tags || payload.tags || '';
      let tagsList = [];
      if (Array.isArray(rawTags)) {
        tagsList = rawTags.map(t => String(t).trim()).filter(Boolean);
      } else if (typeof rawTags === 'string' && rawTags.trim()) {
        tagsList = rawTags.split(/[,;\\s]+/).map(t => t.trim().replace(/^#/, '')).filter(Boolean);
      }
      if (tagsList.length > 0 && tagsSection && tagsContent) {
        tagsContent.innerHTML = tagsList.map(tag => `<span class="modal-tag-chip">#${escapeHtml(tag)}</span>`).join('');
        tagsSection.style.display = 'block';
      } else if (tagsSection) {
        tagsSection.style.display = 'none';
      }

      // 10. Meta info
      metaDeck.textContent = card.deck_name || payload.deck_name || 'N3 vocabs';
      metaTime.textContent = card.created_at ? `${timeAgo(card.created_at)} (${new Date(card.created_at).toLocaleString()})` : '-';

      // 11. Error info
      if (card.error && card.error.trim().length > 0) {
        errorWrap.style.display = 'block';
        errorContent.textContent = card.error;
      } else {
        errorWrap.style.display = 'none';
      }

      // Open Modal
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeHeroModal() {
      const modal = document.getElementById('hero-modal');
      if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
      }
    }

    function onModalBackdropClick(event) {
      if (event.target && event.target.id === 'hero-modal') {
        closeHeroModal();
      }
    }

    // Keyboard support: Escape closes modal
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeHeroModal();
      }
    });

    async function fetchAnkiStats(manual = false) {
      const token = getToken();
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
          if (guideCard) guideCard.style.display = 'block';

          // Set clean default metrics with SVG flame icon
          document.getElementById('metric-streak').innerHTML = `${SVG_FLAME}<span>0d</span>`;
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
        const stats = data.stats;

        // Top Metrics with vector SVG flame
        document.getElementById('metric-streak').innerHTML = `${SVG_FLAME}<span>${stats.current_streak || 0}d</span>`;
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

      // Auto-scroll to the right so current date is immediately visible on mobile
      const wrap = document.querySelector('.heatmap-wrap');
      if (wrap) {
        requestAnimationFrame(() => {
          wrap.scrollLeft = wrap.scrollWidth;
        });
      }

      function showTooltip(clientX, clientY, text) {
        if (!tooltip) return;
        tooltip.textContent = text;
        tooltip.style.display = 'block';

        const pad = 12;
        const approxWidth = 150;
        let x = clientX - 45;
        let y = clientY - 38;

        if (x < pad) x = pad;
        if (x + approxWidth > window.innerWidth - pad) {
          x = window.innerWidth - pad - approxWidth;
        }
        if (y < pad) {
          y = clientY + 22;
        }

        tooltip.style.left = `${Math.round(x)}px`;
        tooltip.style.top = `${Math.round(y)}px`;
      }

      // Add tooltip interactions
      grid.querySelectorAll('.heatmap-cell').forEach(cell => {
        const dateStr = cell.getAttribute('data-date');
        const count = cell.getAttribute('data-count');
        const text = `${dateStr}: ${count} review${count === '1' ? '' : 's'}`;

        cell.addEventListener('mouseenter', e => showTooltip(e.clientX, e.clientY, text));
        cell.addEventListener('mousemove', e => showTooltip(e.clientX, e.clientY, text));
        cell.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });

        // Mobile tap support
        cell.addEventListener('click', e => {
          e.stopPropagation();
          showTooltip(e.clientX, e.clientY, text);
          setTimeout(() => { if (tooltip) tooltip.style.display = 'none'; }, 2800);
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
