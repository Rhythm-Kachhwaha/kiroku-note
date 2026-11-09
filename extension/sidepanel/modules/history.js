// ==========================================================================
// Module: history.js
// Mining history, stats dashboard, card list, bulk operations, undo toast
// ==========================================================================

// Mining Stats Dashboard (T3-F)
let cachedStats = null;
let cachedStatsTime = 0;
const STATS_CACHE_TTL_MS = 30000;

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadHistoryStats(force = false) {
  if (!historyStatsContent) return;
  const now = Date.now();
  if (!force && cachedStats && (now - cachedStatsTime < STATS_CACHE_TTL_MS)) {
    renderHistoryStats(cachedStats);
    return;
  }
  historyStatsContent.innerHTML = '<div class="stats-loading" style="padding:8px; color:var(--text-muted); font-size:12px;">Loading stats…</div>';
  try {
    const res = await fetch(API_CARDS_STATS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedStats = data;
    cachedStatsTime = Date.now();
    renderHistoryStats(data);
  } catch (err) {
    console.warn("Failed to load history stats:", err);
    historyStatsContent.innerHTML = `<div class="stats-error" style="color:var(--text-muted); font-size:11.5px; padding:6px;">Unable to load stats (${escapeHtml(err.message)}).</div>`;
  }
}

function renderHistoryStats(stats) {
  if (!historyStatsContent || !stats) return;

  const total = Number(stats.total) || 0;
  const today = Number(stats.today) || 0;
  const thisWeek = Number(stats.this_week) || 0;

  const sync = stats.sync_ratio || {};
  const synced = Number(sync.synced) || 0;
  const pending = Number(sync.pending) || 0;
  const failed = Number(sync.failed) || 0;
  const syncTotal = synced + pending + failed || total || 1;

  const syncedPct = Math.round((synced / syncTotal) * 100);
  const pendingPct = Math.round((pending / syncTotal) * 100);
  const failedPct = Math.max(0, 100 - syncedPct - pendingPct);

  // JLPT levels
  const jlptMap = stats.jlpt_breakdown || {};
  const jlptLevels = [
    { key: "N5", color: "#61afef" },
    { key: "N4", color: "#98c379" },
    { key: "N3", color: "#e5c07b" },
    { key: "N2", color: "#d19a66" },
    { key: "N1", color: "#e06c75" },
    { key: "Unknown", color: "#7f848e" },
  ];
  const maxJlptCount = Math.max(...jlptLevels.map(l => Number(jlptMap[l.key]) || 0), 1);

  // Top decks
  const topDecks = Array.isArray(stats.top_decks) ? stats.top_decks : [];

  // Generate SVG for horizontal bar chart
  const svgRows = jlptLevels.map((lvl, idx) => {
    const count = Number(jlptMap[lvl.key]) || 0;
    const barWidth = count > 0 ? Math.max(Math.round((count / maxJlptCount) * 180), 3) : 0;
    const y = idx * 22;
    return `
      <text x="2" y="${y + 13}" font-size="11" fill="var(--text-secondary, #b5b0a8)" font-family="monospace, sans-serif">${lvl.key}</text>
      <rect x="58" y="${y + 3}" width="180" height="11" rx="3" fill="var(--bg-surface-3, #252320)" opacity="0.6"/>
      ${barWidth > 0 ? `<rect x="58" y="${y + 3}" width="${barWidth}" height="11" rx="3" fill="${lvl.color}"/>` : ""}
      <text x="246" y="${y + 13}" font-size="11" fill="var(--text-muted, #7a746e)" font-family="monospace, sans-serif">${count}</text>
    `;
  }).join("");

  const decksHtml = topDecks.length > 0
    ? topDecks.map((d, i) => `
        <div class="stat-deck-row">
          <span class="stat-deck-name">${i + 1}. ${escapeHtml(d.deck_name || "Default")}</span>
          <span class="stat-deck-count">${d.count} card${d.count === 1 ? "" : "s"}</span>
        </div>
      `).join("")
    : '<div style="font-size:11px; color:var(--text-muted); padding:4px 0;">No cards mined yet.</div>';

  historyStatsContent.innerHTML = `
    <div class="stat-metrics-row">
      <div class="stat-metric-card">
        <span class="stat-metric-val">${today}</span>
        <span class="stat-metric-label">Today</span>
      </div>
      <div class="stat-metric-card">
        <span class="stat-metric-val">${thisWeek}</span>
        <span class="stat-metric-label">This Week</span>
      </div>
      <div class="stat-metric-card">
        <span class="stat-metric-val">${total}</span>
        <span class="stat-metric-label">All-Time</span>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">
        <span>Sync Status</span>
        <span style="font-size:10px; color:var(--text-muted);">${synced}/${total} synced</span>
      </div>
      <div class="stat-sync-track">
        <div class="stat-sync-bar synced" style="width: ${syncedPct}%;" title="${synced} synced"></div>
        <div class="stat-sync-bar pending" style="width: ${pendingPct}%;" title="${pending} pending"></div>
        <div class="stat-sync-bar failed" style="width: ${failedPct}%;" title="${failed} failed"></div>
      </div>
      <div class="stat-sync-legend">
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-green, #22c55e);"><polyline points="20 6 9 17 4 12"/></svg>${synced} Synced</span>
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-orange, #f97316);"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${pending} Pending</span>
        <span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px; color:var(--accent-red, #ef4444);"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${failed} Failed</span>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">JLPT Breakdown</div>
      <div class="stat-jlpt-chart">
        <svg class="stat-jlpt-svg" viewBox="0 0 280 134" aria-label="JLPT distribution chart">
          ${svgRows}
        </svg>
      </div>
    </div>

    <div class="stat-block">
      <div class="stat-block-title">Top Decks</div>
      <div class="stat-top-decks-list">
        ${decksHtml}
      </div>
    </div>
  `;
}

if (historyStatsDetails) {
  historyStatsDetails.addEventListener("toggle", () => {
    if (historyStatsDetails.open) {
      if (historyStatsSummary) historyStatsSummary.textContent = "Stats ▾";
      loadHistoryStats();
    } else {
      if (historyStatsSummary) historyStatsSummary.textContent = "Stats ▸";
    }
  });
}

// Mining History & Card Library logic
async function loadHistory() {
  if (!historyCardsList) return;
  try {
    const search = historySearchInput ? historySearchInput.value.trim() : "";
    const deck = historyDeckFilter ? historyDeckFilter.value : "all";
    const syncStatus = historySyncFilter ? historySyncFilter.value : "all";

    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (search) params.set("search", search);
    if (deck && deck !== "all") params.set("deck", deck);
    if (syncStatus && syncStatus !== "all") params.set("sync_status", syncStatus);

    const res = await fetch(`${API_CARDS_URL}?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load history");
    const data = await res.json();
    const cards = Array.isArray(data.cards) ? data.cards : [];
    const total = typeof data.total === "number" ? data.total : cards.length;

    // Track cloud cards and pending count for badge
    const cloudCards = cards.filter(c => {
      const s = String(c.source_type || "").toLowerCase();
      return s === "cloud" || s === "iphone_cloud_queue";
    });
    const cloudUnsyncedCount = cloudCards.filter(c => c.sync_status === "pending" || c.sync_status === "failed").length;
    if (historyCloudCountBadge) {
      if (cloudCards.length > 0) {
        historyCloudCountBadge.style.display = "inline-block";
        historyCloudCountBadge.textContent = cloudUnsyncedCount > 0 ? String(cloudUnsyncedCount) : String(cloudCards.length);
        historyCloudCountBadge.title = `${cloudUnsyncedCount} unsynced, ${cloudCards.length} total cloud cards`;
      } else {
        historyCloudCountBadge.style.display = "none";
      }
    }
    if (typeof settingsCloudCountBadge !== "undefined" && settingsCloudCountBadge) {
      if (cloudCards.length > 0) {
        settingsCloudCountBadge.style.display = "inline-block";
        settingsCloudCountBadge.textContent = cloudUnsyncedCount > 0 ? String(cloudUnsyncedCount) : String(cloudCards.length);
        settingsCloudCountBadge.title = `${cloudUnsyncedCount} unsynced, ${cloudCards.length} total cloud cards`;
      } else {
        settingsCloudCountBadge.style.display = "none";
      }
    }

    // Filter cards according to active source subtab
    let displayCards = cards;
    if (currentHistorySource === "cloud") {
      displayCards = cloudCards;
    } else if (currentHistorySource === "local") {
      displayCards = cards.filter(c => {
        const s = String(c.source_type || "").toLowerCase();
        return s !== "cloud" && s !== "iphone_cloud_queue";
      });
    }

    checkFirstRunStatus(total);

    const synced = typeof data.synced_total === "number"
      ? data.synced_total
      : (syncStatus === "synced" ? total : (syncStatus !== "all" && syncStatus ? 0 : cards.filter(c => c.sync_status === "synced").length));

    if (typeof settingsCardsCount !== "undefined" && settingsCardsCount) {
      settingsCardsCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
    }
    if (typeof settingsCardsSynced !== "undefined" && settingsCardsSynced) {
      settingsCardsSynced.textContent = `(${synced} synced)`;
    }

    if (historyCount) {
      if (currentHistorySource === "cloud") {
        historyCount.textContent = `${displayCards.length} cloud card${displayCards.length === 1 ? "" : "s"}`;
      } else if (currentHistorySource === "local") {
        historyCount.textContent = `${displayCards.length} local card${displayCards.length === 1 ? "" : "s"}`;
      } else {
        historyCount.textContent = `${total} card${total === 1 ? "" : "s"}`;
      }
    }
    if (historySyncLabel) {
      if (currentHistorySource === "cloud") {
        const cloudSynced = cloudCards.filter(c => c.sync_status === "synced").length;
        historySyncLabel.textContent = `${cloudSynced} / ${cloudCards.length} synced`;
      } else {
        historySyncLabel.textContent = `${synced} / ${total} synced`;
      }
    }
    if (historyProgressBar) {
      const denom = currentHistorySource === "cloud" ? cloudCards.length : total;
      const num = currentHistorySource === "cloud" ? cloudCards.filter(c => c.sync_status === "synced").length : synced;
      const pct = denom > 0 ? Math.min(100, Math.round((num / denom) * 100)) : 0;
      historyProgressBar.style.width = `${pct}%`;
    }

    // Toggle Sync All vs Sync Cloud Cards button & Cloud Refresh button
    if (btnSyncAll && btnSyncCloudAll) {
      if (currentHistorySource === "cloud") {
        btnSyncAll.style.display = "none";
        btnSyncCloudAll.style.display = "inline-flex";
      } else {
        btnSyncAll.style.display = "";
        btnSyncCloudAll.style.display = "none";
      }
    }
    if (btnRefreshCloudQueue) {
      btnRefreshCloudQueue.style.display = currentHistorySource === "cloud" ? "inline-flex" : "none";
    }

    if (displayCards.length === 0) {
      historyCardsList.replaceChildren();
      if (historyEmpty) {
        historyEmpty.hidden = false;
        if (typeof historyEmpty.replaceChildren === "function") {
          historyEmpty.replaceChildren();
        } else {
          historyEmpty.textContent = "";
        }
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "empty-state history-empty-state";
        const isFiltered = Boolean(search || deck !== "all" || syncStatus !== "all");
        let emptyMsg = isFiltered ? "No matching cards found." : "No cards mined yet.";
        let emptyHint = isFiltered ? "Try adjusting your search query or filters." : "Start mining to see your history here.";
        if (currentHistorySource === "cloud" && !isFiltered) {
          emptyMsg = "No cloud cards in local history.";
          emptyHint = "Cards queued from iPhone Shortcut or cloud worker appear here once fetched.";
        } else if (currentHistorySource === "local" && !isFiltered) {
          emptyMsg = "No locally mined cards found.";
          emptyHint = "Start mining from webpages or subtitles to see your history here.";
        }
        emptyDiv.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon" aria-hidden="true"><rect x="2" y="7" width="16" height="14" rx="2"/><path d="M6 3h14a2 2 0 0 1 2 2v12"/></svg>` +
          `<p class="empty-state-text">${emptyMsg}</p>` +
          `<p class="empty-state-hint">${emptyHint}</p>`;
        historyEmpty.append(emptyDiv);
      }
    } else {
      if (historyEmpty) {
        historyEmpty.hidden = true;
        if (typeof historyEmpty.replaceChildren === "function") historyEmpty.replaceChildren();
      }
      renderHistoryCards(sortHistoryCards(displayCards, currentHistorySort));
    }

    updateDeckFilterOptions(cards);
  } catch (err) {
    if (historyEmpty) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = "Failed to load history.";
    }
  }
}

function sortHistoryCards(cards, sortKey) {
  if (!Array.isArray(cards)) return [];
  const copy = [...cards];
  switch (sortKey) {
    case "date-asc":
      return copy.sort((a, b) => (a.id || 0) - (b.id || 0));
    case "date-desc":
      return copy.sort((a, b) => (b.id || 0) - (a.id || 0));
    case "jlpt": {
      const jlptRank = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
      return copy.sort((a, b) => {
        const rA = a.jlpt_level ? (jlptRank[String(a.jlpt_level).toUpperCase()] || 99) : 999;
        const rB = b.jlpt_level ? (jlptRank[String(b.jlpt_level).toUpperCase()] || 99) : 999;
        if (rA !== rB) return rA - rB;
        return (b.id || 0) - (a.id || 0);
      });
    }
    case "deck":
      return copy.sort((a, b) => (a.deck_name || "").localeCompare(b.deck_name || ""));
    case "status":
      return copy.sort((a, b) => (a.sync_status || "").localeCompare(b.sync_status || ""));
    default:
      return copy;
  }
}

async function loadStoredHistorySort() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(STORAGE_KEY_HISTORY_SORT);
      if (stored?.[STORAGE_KEY_HISTORY_SORT]) {
        currentHistorySort = stored[STORAGE_KEY_HISTORY_SORT];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY_HISTORY_SORT);
      if (stored) currentHistorySort = stored;
    }
  } catch (_) {}
  if (historySortSelect) historySortSelect.value = currentHistorySort;
}

function saveStoredHistorySort(val) {
  currentHistorySort = val;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY_HISTORY_SORT]: val });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_HISTORY_SORT, val);
    }
  } catch (_) {}
}

function updateDeckFilterOptions(cards) {
  if (!historyDeckFilter) return;
  const currentVal = historyDeckFilter.value;
  const existingOptions = new Set(Array.from(historyDeckFilter.options).map(o => o.value));

  cards.forEach(c => {
    if (c.deck_name && !existingOptions.has(c.deck_name)) {
      const opt = document.createElement("option");
      opt.value = c.deck_name;
      opt.textContent = c.deck_name;
      historyDeckFilter.append(opt);
      existingOptions.add(c.deck_name);
    }
  });

  if (fieldDeckSelect) {
    Array.from(fieldDeckSelect.options).forEach(opt => {
      if (opt.value && !existingOptions.has(opt.value)) {
        const newOpt = document.createElement("option");
        newOpt.value = opt.value;
        newOpt.textContent = opt.value;
        historyDeckFilter.append(newOpt);
        existingOptions.add(opt.value);
      }
    });
  }

  if (existingOptions.has(currentVal)) {
    historyDeckFilter.value = currentVal;
  }

  if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect) {
    const bulkExisting = new Set(Array.from(bulkDeckSelect.options).map(o => o.value));
    existingOptions.forEach(deckName => {
      if (deckName && deckName !== "all" && !bulkExisting.has(deckName)) {
        const opt = document.createElement("option");
        opt.value = deckName;
        opt.textContent = deckName;
        bulkDeckSelect.append(opt);
        bulkExisting.add(deckName);
      }
    });
  }
}

function renderHistoryCards(cards) {
  if (!historyCardsList) return;
  historyCardsList.replaceChildren();

  if (typeof currentRenderedCardIds !== "undefined") {
    currentRenderedCardIds = cards.map(c => c.id);
  }

  cards.forEach(card => {
    const isSelected = typeof selectedHistoryCardIds !== "undefined" && selectedHistoryCardIds.has(card.id);
    const item = document.createElement("article");
    item.className = "history-item" + (selectedHistoryCardId === card.id ? " selected" : "") + (isSelected ? " bulk-selected" : "");
    item.dataset.cardId = String(card.id);

    const selectCb = document.createElement("input");
    selectCb.type = "checkbox";
    selectCb.className = "history-select-cb";
    selectCb.checked = Boolean(isSelected);
    selectCb.title = `Select ${card.expression}`;
    selectCb.setAttribute("aria-label", `Select card ${card.expression}`);
    selectCb.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    selectCb.addEventListener("change", (e) => {
      e.stopPropagation();
      if (typeof selectedHistoryCardIds !== "undefined") {
        if (selectCb.checked) {
          selectedHistoryCardIds.add(card.id);
          item.classList.add("bulk-selected");
        } else {
          selectedHistoryCardIds.delete(card.id);
          item.classList.remove("bulk-selected");
        }
      }
      if (typeof updateBulkActionBarState === "function") {
        updateBulkActionBarState();
      }
    });
    item.append(selectCb);

    const cardBtn = document.createElement("button");
    cardBtn.type = "button";
    cardBtn.className = "history-item-card-btn";
    cardBtn.setAttribute("aria-label", `Open card ${card.expression}${card.reading ? `: ${card.reading}` : ""}`);
    cardBtn.addEventListener("click", () => openSavedCard(card.id));

    const main = document.createElement("div");
    main.className = "history-item-main";

    const head = document.createElement("div");
    head.className = "history-item-head";

    const expr = document.createElement("span");
    expr.className = "history-item-expression";
    expr.textContent = card.expression;
    head.append(expr);

    if (card.reading) {
      const read = document.createElement("span");
      read.className = "history-item-reading";
      read.textContent = card.reading;
      head.append(read);
    }
    main.append(head);

    if (card.meaning) {
      const mean = document.createElement("p");
      mean.className = "history-item-meaning";
      mean.textContent = card.meaning;
      main.append(mean);
    }

    const meta = document.createElement("div");
    meta.className = "history-item-meta";

    const deckBadge = document.createElement("span");
    deckBadge.className = "history-item-deck";
    deckBadge.textContent = card.deck_name || "Default";
    deckBadge.title = `Deck: ${card.deck_name || "Default"}`;
    meta.append(deckBadge);

    if (card.jlpt_level) {
      const jlptPill = document.createElement("span");
      jlptPill.className = "history-item-jlpt pill-jlpt";
      jlptPill.textContent = card.jlpt_level;
      jlptPill.title = `JLPT: ${card.jlpt_level}`;
      meta.append(jlptPill);
    }

    const syncBadge = document.createElement("span");
    const statusKey = card.sync_status || "pending";
    syncBadge.className = `history-badge sync-${statusKey}`;
    syncBadge.textContent = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
    meta.append(syncBadge);

    if (card.source_type || card.source_url) {
      const srcType = card.source_type || "text";
      const sourceBadge = document.createElement("span");
      sourceBadge.className = "history-item-source";
      let iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      let label = "Text";
      if (srcType === "video") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
        label = "Video";
      } else if (srcType === "ocr") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>';
        label = "OCR";
      } else if (srcType === "quick_add" || srcType === "quickadd") {
        iconSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        label = "Quick Add";
      } else if (srcType === "cloud" || srcType === "iphone_cloud_queue") {
        iconSvg = '<svg class="icon-cloud" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:3px;" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
        label = "Cloud";
      }

      let host = "";
      if (card.source_url) {
        try {
          const u = new URL(card.source_url);
          host = u.hostname.replace(/^www\./, "");
        } catch (_) {
          host = card.source_url.slice(0, 20);
        }
      }

      const displayText = host || label;
      const iconSpan = document.createElement("span");
      iconSpan.className = `icon-source icon-source-${srcType}`;
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.innerHTML = iconSvg;

      const labelSpan = document.createElement("span");
      labelSpan.textContent = displayText;

      sourceBadge.append(iconSpan, labelSpan);
      sourceBadge.title = card.source_url ? `Mined from ${label}: ${card.source_url}` : `Mined from: ${label}`;
      meta.append(sourceBadge);
    }

    main.append(meta);
    cardBtn.append(main);
    item.append(cardBtn);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    if (card.sync_status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn-history-retry";
      retryBtn.textContent = "Retry";
      retryBtn.title = `Retry Anki sync: ${card.sync_error || "Error"}`;
      retryBtn.setAttribute("aria-label", `Retry syncing ${card.expression} to Anki`);
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id, false);
      });
      actions.append(retryBtn);
    } else if (card.sync_status === "synced") {
      const resyncBtn = document.createElement("button");
      resyncBtn.type = "button";
      resyncBtn.className = "btn-history-retry btn-history-resync";
      resyncBtn.textContent = "Resync";
      resyncBtn.title = "Resync card to Anki (re-send fields and media)";
      resyncBtn.setAttribute("aria-label", `Resync ${card.expression} to Anki`);
      resyncBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id, true);
      });
      actions.append(resyncBtn);
    } else if (card.sync_status === "pending") {
      const syncBtn = document.createElement("button");
      syncBtn.type = "button";
      syncBtn.className = "btn-history-retry btn-history-sync";
      syncBtn.textContent = "Sync";
      syncBtn.title = "Sync card to Anki";
      syncBtn.setAttribute("aria-label", `Sync ${card.expression} to Anki`);
      syncBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        retrySyncFromHistory(card.id, false);
      });
      actions.append(syncBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-history-delete";
    delBtn.innerHTML = "&times;";
    delBtn.title = "Delete local card";
    delBtn.setAttribute("aria-label", `Delete ${card.expression} from local database`);
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLocalCard(card.id, card.expression, delBtn);
    });
    actions.append(delBtn);

    item.append(actions);
    historyCardsList.append(item);
  });

  if (typeof updateBulkActionBarState === "function") {
    updateBulkActionBarState();
  }
}

async function openSavedCard(cardId) {
  try {
    selectedHistoryCardId = cardId;
    if (historyCardsList) {
      historyCardsList.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("selected", el.dataset.cardId === String(cardId));
      });
    }

    const res = await fetch(API_CARD_DETAIL_URL(cardId));
    if (!res.ok) throw new Error("Could not retrieve card details.");
    const body = await res.json();
    currentCardKind = body.card_kind || "vocab";
    currentGrammarCard = currentCardKind === "grammar" && body.card_settings
      ? {...body.card_settings}
      : null;

    if (cardEditor) {
      cardEditor.hidden = false;
      if (fieldCardId) fieldCardId.value = body.id || "";
      if (fieldExpression) fieldExpression.value = body.expression || "";
      restorePreviewPresentation(body.card_settings?.preview_presentation);
      if (fieldReading) fieldReading.value = body.reading || "";
      if (fieldMeaning) fieldMeaning.value = body.meaning || "";
      if (fieldHint) fieldHint.value = body.hint || "";
      if (fieldExampleSentence) fieldExampleSentence.value = body.example_sentence || "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = body.example_translation || "";
      if (fieldImage) fieldImage.value = body.image || "";
      if (fieldAudio) fieldAudio.value = body.audio || "";

      clearAllMedia();
      if (body.image) {
        const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:") || body.image.startsWith("https:")
          ? body.image
          : `${BACKEND_BASE_URL}/api/media/${body.image}`;
        currentDraftMedia.imageBase64 = imgSrc;
      }
      if (body.audio) {
        const audioSrc = body.audio.startsWith("data:") || body.audio.startsWith("http:") || body.audio.startsWith("https:")
          ? body.audio
          : `${BACKEND_BASE_URL}/api/media/${body.audio}`;
        currentDraftMedia.audioBase64 = audioSrc;
        currentDraftMedia.audioStatus = "available";
        currentDraftMedia.audioError = null;
      } else {
        currentDraftMedia.audioBase64 = null;
        currentDraftMedia.audioStatus = "idle";
      }
      updateMediaPreviews();
      if (fieldTags) fieldTags.value = body.tags || "";
      if (fieldNotes) fieldNotes.value = body.notes || "";
      if (fieldSourceText) fieldSourceText.value = body.source_text || "";
      if (fieldDeinflectedText) fieldDeinflectedText.value = body.deinflected_text || "";

      if (fieldDeckSelect && body.deck_name) {
        let hasDeck = Array.from(fieldDeckSelect.options).some(o => o.value === body.deck_name);
        if (!hasDeck) {
          const opt = document.createElement("option");
          opt.value = body.deck_name;
          opt.textContent = body.deck_name;
          fieldDeckSelect.append(opt);
        }
        fieldDeckSelect.value = body.deck_name;
      }
      if (fieldDeckName) fieldDeckName.value = (fieldDeckSelect && fieldDeckSelect.value) || body.deck_name || "Default";

      if (fieldModelSelect && body.model_name) {
        let hasModel = Array.from(fieldModelSelect.options).some(o => o.value === body.model_name);
        if (!hasModel) {
          const opt = document.createElement("option");
          opt.value = body.model_name;
          opt.textContent = body.model_name;
          fieldModelSelect.append(opt);
        }
        fieldModelSelect.value = body.model_name;
      }
      if (fieldModelName) fieldModelName.value = (fieldModelSelect && fieldModelSelect.value) || body.model_name || "";
      updateDestinationIndicator();

      if (body.source_type || body.source_url) {
        lastCaptureSource = {
          tabId: null,
          frameId: null,
          type: body.source_type || "text",
          url: body.source_url || "",
          title: "",
        };
      }

      if (expression) expression.textContent = body.expression || "—";
      updateHeroReading(body.reading, body.expression);
      updateHeroMeanings(body);
      updateHeroBadges(body);

      const savedIsKana = isKanaOnly(body.expression);
      const entryKanji = (Array.isArray(body.entries) && body.entries[0] && hasKanji(body.entries[0].expression || body.entries[0].headword))
        ? (body.entries[0].expression || body.entries[0].headword)
        : "";
      const savedKanji = !savedIsKana ? body.expression : (hasKanji(body.reading) ? body.reading : entryKanji);
      const savedKana = savedIsKana ? body.expression : body.reading;
      updateFrontToggleUI(savedKanji, savedKana, savedIsKana ? "kana" : "kanji");

      if (body.sync_status === "synced") {
        updateSyncUI("synced");
      } else if (body.sync_status === "failed") {
        updateSyncUI("failed", body.sync_error);
      } else {
        updateSyncUI("pending");
      }

      if ((Array.isArray(body.entries) && body.entries.length) || (Array.isArray(body.kanji_entries) && body.kanji_entries.length)) {
        renderDetails({
          entries: body.entries || [],
          kanji_entries: body.kanji_entries || [],
          expression: body.expression,
          jlpt_level: body.jlpt_level,
        });
      } else {
        clearDictionaryView();
        currentJlptLevel = body.jlpt_level || null;
        currentVerbMetadata = body.verb_metadata || null;
      }

      setSaveBadge("SAVED", "badge saved", true);
      setStatus("Opened saved card from library.");
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }
  } catch (err) {
    setStatus(`Failed to open card: ${err.message}`, true);
  }
}

// T3-C: 5-Second Undo Toast on History Deletion
let pendingDeletion = null;

function showUndoToast(message, onUndo) {
  if (!undoToast) return;
  if (undoToastMessage) undoToastMessage.textContent = message;
  undoToast.hidden = false;
  if (btnUndoDelete) {
    btnUndoDelete.onclick = (e) => {
      e.preventDefault();
      if (typeof onUndo === "function") onUndo();
    };
  }
}

function hideUndoToast() {
  if (undoToast) {
    undoToast.hidden = true;
  }
}

async function commitPendingDelete() {
  if (!pendingDeletion) return;
  const toDelete = pendingDeletion;
  clearTimeout(toDelete.timerId);
  pendingDeletion = null;
  hideUndoToast();

  try {
    const res = await fetch(API_CARD_DETAIL_URL(toDelete.cardId), { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete card.");

    if (fieldCardId && fieldCardId.value === String(toDelete.cardId)) {
      fieldCardId.value = "";
      if (fieldExpression) fieldExpression.value = "";
      if (fieldReading) fieldReading.value = "";
      if (fieldMeaning) fieldMeaning.value = "";
      if (fieldHint) fieldHint.value = "";
      if (fieldExampleSentence) fieldExampleSentence.value = "";
      if (fieldExampleTranslation) fieldExampleTranslation.value = "";
      if (fieldImage) fieldImage.value = "";
      if (fieldAudio) fieldAudio.value = "";
      if (fieldTags) fieldTags.value = "";
      if (fieldNotes) fieldNotes.value = "";
      if (expression) expression.textContent = "—";
      updateHeroReading("", "");
      if (wordMeaningsSummary) {
        wordMeaningsSummary.textContent = "";
        wordMeaningsSummary.hidden = true;
      }
      if (showcaseJlptBadge) {
        showcaseJlptBadge.hidden = true;
        showcaseJlptBadge.textContent = "";
      }
      if (showcasePosBadge) {
        showcasePosBadge.hidden = true;
        showcasePosBadge.textContent = "";
      }
      if (showcasePitchBadge) {
        showcasePitchBadge.hidden = true;
        showcasePitchBadge.textContent = "";
      }
      clearDictionaryView();
      setSaveBadge("", "badge", false);
      if (cardEditor) cardEditor.hidden = true;
      updateSyncUI(ankiConnected ? "ready" : "not_connected");
      selectedHistoryCardId = null;
      if (typeof scheduleCardPreviewUpdate === "function") scheduleCardPreviewUpdate();
    }

    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Deleted "${toDelete.cardExpr}" from local database.`);
    await loadHistory();
  } catch (err) {
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Delete failed: ${err.message}`, true);
    await loadHistory();
  }
}

function cancelPendingDelete() {
  if (!pendingDeletion) return;
  const restored = pendingDeletion;
  clearTimeout(restored.timerId);
  pendingDeletion = null;
  hideUndoToast();

  if (restored.cardEl) {
    restored.cardEl.style.display = "";
  }
  setStatus(`Restored "${restored.cardExpr}".`);
  loadHistory().catch(() => {});
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    if (pendingDeletion) {
      commitPendingDelete();
    }
  });
}

async function deleteLocalCard(cardId, cardExpr, delBtn) {
  if (delBtn) {
    if (!delBtn.classList.contains("confirm-delete")) {
      delBtn.classList.add("confirm-delete");
      delBtn.textContent = "✕";
      delBtn.title = `Click again to confirm deleting "${cardExpr}"`;
      setTimeout(() => {
        if (delBtn && delBtn.classList.contains("confirm-delete")) {
          delBtn.classList.remove("confirm-delete");
          delBtn.innerHTML = "&times;";
          delBtn.title = "Delete local card";
        }
      }, 3000);
      return;
    }
    delBtn.classList.remove("confirm-delete");
  }

  // If another deletion was pending, commit it immediately before starting new one
  if (pendingDeletion) {
    await commitPendingDelete();
  }

  // Find DOM element in history list to give instant feedback
  const cardEl = historyCardsList ? historyCardsList.querySelector(`.history-item[data-card-id="${cardId}"]`) : null;
  if (cardEl) {
    cardEl.style.display = "none";
  }

  pendingDeletion = {
    cardId,
    cardExpr,
    cardEl,
    timerId: setTimeout(() => {
      commitPendingDelete();
    }, 5000),
  };

  showUndoToast(`Deleted "${cardExpr}"`, () => {
    cancelPendingDelete();
  });
  setStatus(`"${cardExpr}" deleted (Undo available for 5s)`);
}

async function retrySyncFromHistory(cardId, force = false) {
  try {
    setStatus(force ? "Resyncing card to Anki…" : "Retrying Anki sync…");
    const syncUrl = force ? `${API_CARD_SYNC_URL(cardId)}?force=true` : API_CARD_SYNC_URL(cardId);
    const res = await fetch(syncUrl, { method: "POST", headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.sync_status === "failed") {
      const errMsg = data.error || data.detail || "Sync failed";
      setStatus(`Anki sync ${force ? "resync" : "retry"} failed: ${errMsg}`, true);
    } else {
      setStatus(force ? "Card resynchronized to Anki." : "Card synchronized to Anki.");
    }
    await loadHistory();
    if (fieldCardId && fieldCardId.value === String(cardId)) {
      if (data.sync_status === "synced") {
        updateSyncUI("synced");
      } else {
        updateSyncUI("failed", data.error || data.detail);
      }
    }
  } catch (err) {
    setStatus(`Sync failed: ${formatErrorMessage(err)}`, true);
  }
}

if (historySearchInput) {
  historySearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      loadHistory();
    }, 250);
  });
}

if (historyDeckFilter) {
  historyDeckFilter.addEventListener("change", () => {
    loadHistory();
  });
}

if (historySyncFilter) {
  historySyncFilter.addEventListener("change", () => {
    loadHistory();
  });
}

if (historySortSelect) {
  historySortSelect.addEventListener("change", () => {
    saveStoredHistorySort(historySortSelect.value);
    loadHistory();
  });
}

function setHistorySourceFilter(source) {
  currentHistorySource = source;
  const items = [
    { el: historySourceAll, key: "all" },
    { el: historySourceLocal, key: "local" },
    { el: historySourceCloud, key: "cloud" },
  ];
  items.forEach(({ el, key }) => {
    if (!el) return;
    const isActive = key === source;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-selected", String(isActive));
    el.style.background = isActive ? "var(--bg-surface-2, #2a2a2a)" : "transparent";
    el.style.color = isActive ? "var(--text-primary, #fff)" : "var(--text-secondary, #aaa)";
    el.style.fontWeight = isActive ? "600" : "500";
  });
  loadHistory();
}

if (historySourceAll) historySourceAll.addEventListener("click", () => setHistorySourceFilter("all"));
if (historySourceLocal) historySourceLocal.addEventListener("click", () => setHistorySourceFilter("local"));
if (historySourceCloud) historySourceCloud.addEventListener("click", () => setHistorySourceFilter("cloud"));

async function triggerSyncCloudCards() {
  if (isSyncAllRunning) return;
  try {
    if (btnSyncCloudAll) {
      btnSyncCloudAll.disabled = true;
      btnSyncCloudAll.textContent = "Syncing…";
    }
    setStatus("Scanning for unsynced cloud cards…");

    const res = await fetch(`${API_CARDS_URL}?limit=500`);
    if (!res.ok) throw new Error("Could not retrieve cards list.");
    const data = await res.json().catch(() => ({}));
    const all = Array.isArray(data.cards) ? data.cards : [];

    // Strictly select ONLY cloud cards with pending or failed status
    const eligibleCloud = all.filter(c => {
      const src = String(c.source_type || "").toLowerCase();
      const st = String(c.sync_status || "").toLowerCase();
      return (src === "cloud" || src === "iphone_cloud_queue") && (st === "pending" || st === "failed");
    });

    if (eligibleCloud.length === 0) {
      setStatus("No pending or retryable cloud cards to sync.");
      return;
    }

    const cloudCardIds = eligibleCloud.map(c => c.id);
    setStatus(`Syncing ${cloudCardIds.length} cloud card(s) to Anki…`);

    const syncRes = await fetch(API_CARDS_BULK_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: cloudCardIds }),
    });
    const syncData = await syncRes.json().catch(() => ({}));

    if (!syncRes.ok || syncData.error) {
      const errMsg = syncData.error || syncData.detail || "Bulk sync failed";
      setStatus(`Cloud sync failed: ${errMsg}`, true);
    } else {
      const syncedCount = typeof syncData.synced_count === "number" ? syncData.synced_count : cloudCardIds.length;
      const failedCount = typeof syncData.failed_count === "number" ? syncData.failed_count : 0;
      if (failedCount > 0) {
        setStatus(`Cloud sync: ${syncedCount} synced, ${failedCount} failed.`, true);
      } else {
        setStatus(`Successfully synced ${syncedCount} cloud card(s) to Anki.`);
      }
    }
    await loadHistory();
  } catch (err) {
    setStatus(`Cloud sync failed: ${formatErrorMessage(err)}`, true);
  } finally {
    if (btnSyncCloudAll) {
      btnSyncCloudAll.disabled = false;
      btnSyncCloudAll.textContent = "Sync Cloud Cards";
    }
  }
}

if (btnSyncCloudAll) {
  btnSyncCloudAll.addEventListener("click", () => triggerSyncCloudCards());
}

async function triggerRefreshCloudQueue() {
  if (!btnRefreshCloudQueue && !btnSettingsPullCloud) return;
  const icon = btnRefreshCloudQueue ? btnRefreshCloudQueue.querySelector(".icon-refresh") : null;
  const label = btnRefreshCloudQueue ? btnRefreshCloudQueue.querySelector("#btn-refresh-cloud-label") : null;

  if (btnRefreshCloudQueue) btnRefreshCloudQueue.disabled = true;
  if (typeof btnSettingsPullCloud !== "undefined" && btnSettingsPullCloud) btnSettingsPullCloud.disabled = true;
  if (icon) icon.classList.add("spinning");
  if (label) label.textContent = "Syncing…";
  setStatus("Syncing cloud queue, Anki stats, and Anki cards…");

  try {
    const res = await fetch(API_CLOUD_PULL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.status === "ok" || data.status === "success")) {
      const processed = Number(data.processed || 0);
      if (processed > 0) {
        setStatus(`Imported ${processed} new card(s) from cloud.`);
      } else {
        setStatus(data.message || "Cloud queue is up to date.");
      }
    } else {
      const msg = data.message || data.detail || "Cloud check failed";
      setStatus(`Cloud queue: ${msg}`);
    }
  } catch (err) {
    setStatus(`Cannot connect to Kiroku backend: ${formatErrorMessage(err)}`);
  } finally {
    if (btnRefreshCloudQueue) btnRefreshCloudQueue.disabled = false;
    if (typeof btnSettingsPullCloud !== "undefined" && btnSettingsPullCloud) btnSettingsPullCloud.disabled = false;
    if (icon) icon.classList.remove("spinning");
    if (label) label.textContent = "Sync";
    await loadHistory();
  }
}

if (btnRefreshCloudQueue) {
  btnRefreshCloudQueue.addEventListener("click", () => triggerRefreshCloudQueue());
}
if (typeof btnSettingsSyncAll !== "undefined" && btnSettingsSyncAll) {
  btnSettingsSyncAll.addEventListener("click", () => triggerSyncAll({ silent: false }));
}
if (typeof btnSettingsPullCloud !== "undefined" && btnSettingsPullCloud) {
  btnSettingsPullCloud.addEventListener("click", () => triggerRefreshCloudQueue());
}

async function exportCardsCsv() {
  try {
    const params = new URLSearchParams();
    const deckVal = historyDeckFilter ? historyDeckFilter.value : "";
    if (deckVal && deckVal !== "all") {
      params.set("deck", deckVal);
    }
    const syncVal = historySyncFilter ? historySyncFilter.value : "";
    if (syncVal && syncVal !== "all") {
      params.set("status", syncVal);
    }
    const searchVal = historySearchInput ? historySearchInput.value.trim() : "";
    if (searchVal) {
      params.set("search", searchVal);
    }

    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${API_CARDS_URL}/export${query}`);
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    const csvText = await res.text();
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `kiroku_cards_${timestamp}.csv`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
    setStatus("Cards exported to CSV.");
  } catch (err) {
    setStatus(`Export failed: ${err.message || err}`, true);
  }
}

if (typeof btnExportCards !== "undefined" && btnExportCards) {
  btnExportCards.addEventListener("click", exportCardsCsv);
}

// Bulk Operations State & Handlers (T4-A)
var selectedHistoryCardIds = (typeof globalThis !== "undefined" && globalThis.selectedHistoryCardIds) || new Set();
var currentRenderedCardIds = (typeof globalThis !== "undefined" && globalThis.currentRenderedCardIds) || [];

function updateBulkActionBarState() {
  const count = typeof selectedHistoryCardIds !== "undefined" ? selectedHistoryCardIds.size : 0;
  if (typeof bulkSelectedCount !== "undefined" && bulkSelectedCount) {
    bulkSelectedCount.textContent = `${count} selected`;
  }
  if (typeof bulkActionBar !== "undefined" && bulkActionBar) {
    bulkActionBar.hidden = count === 0;
  }
  if (typeof bulkSelectAllCb !== "undefined" && bulkSelectAllCb) {
    if (!currentRenderedCardIds || currentRenderedCardIds.length === 0) {
      bulkSelectAllCb.checked = false;
      bulkSelectAllCb.indeterminate = false;
    } else {
      const allSelected = currentRenderedCardIds.length > 0 && currentRenderedCardIds.every(id => selectedHistoryCardIds.has(id));
      const someSelected = currentRenderedCardIds.some(id => selectedHistoryCardIds.has(id));
      bulkSelectAllCb.checked = allSelected;
      bulkSelectAllCb.indeterminate = !allSelected && someSelected;
    }
  }
}

function clearBulkSelection() {
  if (typeof selectedHistoryCardIds !== "undefined") {
    selectedHistoryCardIds.clear();
  }
  if (typeof historyCardsList !== "undefined" && historyCardsList) {
    historyCardsList.querySelectorAll(".history-select-cb").forEach(cb => {
      cb.checked = false;
    });
    historyCardsList.querySelectorAll(".history-item").forEach(item => {
      item.classList.remove("bulk-selected");
    });
  }
  updateBulkActionBarState();
}

function selectAllVisibleCards() {
  if (typeof currentRenderedCardIds !== "undefined" && currentRenderedCardIds && typeof selectedHistoryCardIds !== "undefined") {
    currentRenderedCardIds.forEach(id => selectedHistoryCardIds.add(id));
  }
  if (typeof historyCardsList !== "undefined" && historyCardsList) {
    historyCardsList.querySelectorAll(".history-select-cb").forEach(cb => {
      cb.checked = true;
    });
    historyCardsList.querySelectorAll(".history-item").forEach(item => {
      item.classList.add("bulk-selected");
    });
  }
  updateBulkActionBarState();
}

async function performBulkDelete() {
  if (typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToDelete = Array.from(selectedHistoryCardIds);
  try {
    const res = await fetch(API_CARDS_BULK_DELETE_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToDelete }),
    });
    if (!res.ok) throw new Error("Bulk delete failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Deleted ${data.deleted_count || idsToDelete.length} cards from local database.`);
    await loadHistory();
  } catch (err) {
    setStatus(`Bulk delete failed: ${err.message}`, true);
  }
}

async function performBulkSync() {
  if (typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToSync = Array.from(selectedHistoryCardIds);
  try {
    setStatus(`Syncing ${idsToSync.length} cards to Anki…`);
    const res = await fetch(API_CARDS_BULK_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToSync }),
    });
    if (!res.ok) throw new Error("Bulk sync failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    if (data.error) {
      setStatus(`Bulk sync error: ${data.error}`, true);
    } else {
      setStatus(`Bulk sync complete: ${data.synced_count} synced, ${data.failed_count} failed.`);
    }
    await loadHistory();
  } catch (err) {
    setStatus(`Bulk sync failed: ${err.message}`, true);
  }
}

async function performBulkDeckMove(targetDeck) {
  if (!targetDeck || typeof selectedHistoryCardIds === "undefined" || selectedHistoryCardIds.size === 0) return;
  const idsToMove = Array.from(selectedHistoryCardIds);
  try {
    setStatus(`Moving ${idsToMove.length} cards to "${targetDeck}"…`);
    const res = await fetch(API_CARDS_BULK_DECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_ids: idsToMove, deck_name: targetDeck }),
    });
    if (!res.ok) throw new Error("Bulk deck move failed");
    const data = await res.json();
    clearBulkSelection();
    if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect) {
      bulkDeckSelect.selectedIndex = 0;
    }
    if (typeof cachedStats !== "undefined") cachedStats = null;
    if (typeof historyStatsDetails !== "undefined" && historyStatsDetails && historyStatsDetails.open && typeof loadHistoryStats === "function") {
      loadHistoryStats(true).catch(() => {});
    }
    setStatus(`Moved ${data.updated_count || idsToMove.length} cards to "${targetDeck}".`);
    await loadHistory();
  } catch (err) {
    setStatus(`Move to deck failed: ${err.message}`, true);
  }
}

if (typeof bulkSelectAllCb !== "undefined" && bulkSelectAllCb && typeof bulkSelectAllCb.addEventListener === "function") {
  bulkSelectAllCb.addEventListener("change", () => {
    if (bulkSelectAllCb.checked) {
      selectAllVisibleCards();
    } else {
      clearBulkSelection();
    }
  });
}

if (typeof btnBulkCancel !== "undefined" && btnBulkCancel && typeof btnBulkCancel.addEventListener === "function") {
  btnBulkCancel.addEventListener("click", (e) => {
    e.preventDefault();
    clearBulkSelection();
  });
}

if (typeof btnBulkDelete !== "undefined" && btnBulkDelete && typeof btnBulkDelete.addEventListener === "function") {
  btnBulkDelete.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!btnBulkDelete.classList || typeof btnBulkDelete.classList.contains !== "function" || !btnBulkDelete.classList.contains("confirm-delete")) {
      if (btnBulkDelete.classList && typeof btnBulkDelete.classList.add === "function") {
        btnBulkDelete.classList.add("confirm-delete");
      }
      const count = typeof selectedHistoryCardIds !== "undefined" ? selectedHistoryCardIds.size : 0;
      btnBulkDelete.textContent = `Confirm (${count})`;
      setTimeout(() => {
        if (typeof btnBulkDelete !== "undefined" && btnBulkDelete && btnBulkDelete.classList && typeof btnBulkDelete.classList.contains === "function" && btnBulkDelete.classList.contains("confirm-delete")) {
          btnBulkDelete.classList.remove("confirm-delete");
          btnBulkDelete.textContent = "Delete";
        }
      }, 3000);
      return;
    }
    if (btnBulkDelete.classList && typeof btnBulkDelete.classList.remove === "function") {
      btnBulkDelete.classList.remove("confirm-delete");
    }
    btnBulkDelete.textContent = "Delete";
    await performBulkDelete();
  });
}

if (typeof btnBulkSync !== "undefined" && btnBulkSync && typeof btnBulkSync.addEventListener === "function") {
  btnBulkSync.addEventListener("click", async (e) => {
    e.preventDefault();
    await performBulkSync();
  });
}

if (typeof bulkDeckSelect !== "undefined" && bulkDeckSelect && typeof bulkDeckSelect.addEventListener === "function") {
  bulkDeckSelect.addEventListener("change", async () => {
    const val = bulkDeckSelect.value;
    if (val) {
      await performBulkDeckMove(val);
    }
  });
}

async function checkClipboardForJapanese() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return;
  try {
    const text = (await navigator.clipboard.readText() || "").trim();
    if (!text) return;
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return;
    if (text === lastDismissedClipboardText || text === lastSeenClipboardText) return;
    showClipboardSuggestion(text);
  } catch (_) {}
}

function showClipboardSuggestion(text) {
  if (!clipboardSuggestionBar || !clipboardSuggestionText) return;
  const maxLen = 30;
  const preview = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  clipboardSuggestionText.textContent = preview;
  clipboardSuggestionBar.dataset.clipboardText = text;
  clipboardSuggestionBar.hidden = false;
}

function hideClipboardSuggestion() {
  if (clipboardSuggestionBar) {
    clipboardSuggestionBar.hidden = true;
    delete clipboardSuggestionBar.dataset.clipboardText;
  }
}

if (btnClipboardCapture) {
  btnClipboardCapture.addEventListener("click", () => {
    const text = clipboardSuggestionBar?.dataset?.clipboardText;
    hideClipboardSuggestion();
    if (text) {
      lastSeenClipboardText = text;
      identify(text);
    }
  });
}

if (btnClipboardDismiss) {
  btnClipboardDismiss.addEventListener("click", () => {
    const text = clipboardSuggestionBar?.dataset?.clipboardText;
    hideClipboardSuggestion();
    if (text) {
      lastDismissedClipboardText = text;
    }
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkClipboardForJapanese().catch(() => {});
      checkAnkiStatus().catch(() => {});
    }
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("focus", () => {
    checkClipboardForJapanese().catch(() => {});
    checkAnkiStatus().catch(() => {});
  });
}

// Initialization
loadFontPreference().catch(() => {});
loadStoredHistorySort().catch(() => {});
loadDecks().catch(() => {});
startAnkiStatusPolling();
checkClipboardForJapanese().catch(() => {});
loadModels().catch(() => {});
loadHistory().catch(() => {});
loadTabPreference().catch(() => {});
loadNavCollapsePreference().catch(() => {});
loadAutoPausePreference().catch(() => {});
loadSubtitlesDisplayPreference().catch(() => {});
loadSubtitleOffsetPreference().catch(() => {});
loadJimakuApiKey().catch(() => {});
loadActiveSubtitleCuesFromStorage().catch(() => {});
loadActiveSubSizeFromStorage().catch(() => {});

