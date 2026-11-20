// ==========================================================================
// Module: layout.js
// Customizable card section layout reordering
// ==========================================================================

/* ==========================================================================
   Layout Settings & Customizable Card Section Reordering
   ========================================================================== */

function resolveValidSectionOrder(savedOrder) {
  if (!Array.isArray(savedOrder) && Array.isArray(savedOrder?.order)) {
    savedOrder = savedOrder.order;
  }
  if (!Array.isArray(savedOrder)) {
    return [...DEFAULT_CARD_SECTION_ORDER];
  }
  const validIds = new Set(DEFAULT_CARD_SECTION_ORDER);
  const seen = new Set();
  const result = [];

  for (const id of savedOrder) {
    if (typeof id === "string" && validIds.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  // Append any missing known sections in default canonical order
  for (const defId of DEFAULT_CARD_SECTION_ORDER) {
    if (!seen.has(defId)) {
      seen.add(defId);
      result.push(defId);
    }
  }

  return result;
}

function resolveValidSectionVisibility(savedVisibility) {
  const resolved = { ...DEFAULT_CARD_SECTION_VISIBILITY };
  for (const sectionId of DEFAULT_CARD_SECTION_ORDER) {
    if (sectionId !== "fields" && typeof savedVisibility?.[sectionId] === "boolean") {
      resolved[sectionId] = savedVisibility[sectionId];
    }
  }
  return resolved;
}

function getCurrentSectionOrder() {
  return [...currentCardSectionOrder];
}


async function loadStoredSectionOrder() {
  try {
    let stored = null;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER);
      stored = res?.[STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER];
    } else if (typeof localStorage !== "undefined") {
      const item = localStorage.getItem(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER);
      if (item) {
        try {
          stored = JSON.parse(item);
        } catch (_) {}
      }
    }
    const resolved = resolveValidSectionOrder(stored);
    currentCardSectionOrder = resolved;
    currentCardSectionVisibility = resolveValidSectionVisibility(
      Array.isArray(stored) ? null : stored?.visibility
    );
    return resolved;
  } catch (_) {
    currentCardSectionOrder = [...DEFAULT_CARD_SECTION_ORDER];
    currentCardSectionVisibility = { ...DEFAULT_CARD_SECTION_VISIBILITY };
    return currentCardSectionOrder;
  }
}

async function persistStoredSectionLayout() {
  const storedLayout = {
    order: resolveValidSectionOrder(currentCardSectionOrder),
    visibility: resolveValidSectionVisibility(currentCardSectionVisibility)
  };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER]: storedLayout });
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_LAYOUT_CARD_SECTION_ORDER, JSON.stringify(storedLayout));
    }
  } catch (_) {}
  return storedLayout;
}

async function saveStoredSectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  await persistStoredSectionLayout();
  return validated;
}

async function saveStoredSectionVisibility(visibility) {
  currentCardSectionVisibility = resolveValidSectionVisibility(visibility);
  applySectionVisibility(currentCardSectionVisibility);
  await persistStoredSectionLayout();
  renderLayoutSettingsList(currentCardSectionOrder);
  return currentCardSectionVisibility;
}

function applySectionVisibility(visibility = currentCardSectionVisibility) {
  const validated = resolveValidSectionVisibility(visibility);
  currentCardSectionVisibility = validated;
  if (!cardLayoutContainer) return validated;

  for (const sectionId of DEFAULT_CARD_SECTION_ORDER) {
    const sectionEl = cardLayoutContainer.querySelector(`[data-layout-section="${sectionId}"]`);
    if (sectionEl) {
      sectionEl.setAttribute("data-layout-visible", String(validated[sectionId]));
    }
  }
  return validated;
}

function applySectionOrder(order) {
  const validated = resolveValidSectionOrder(order);
  currentCardSectionOrder = validated;
  if (!cardLayoutContainer) {
    applySectionVisibility();
    return validated;
  }

  for (const sectionId of validated) {
    const sectionEl = cardLayoutContainer.querySelector(`[data-layout-section="${sectionId}"]`);
    if (sectionEl) {
      cardLayoutContainer.appendChild(sectionEl);
    }
  }
  applySectionVisibility();
  return validated;
}

function moveSectionByDelta(fromIndex, delta) {
  const toIndex = fromIndex + delta;
  if (toIndex < 0 || toIndex >= currentCardSectionOrder.length) return;

  const newOrder = [...currentCardSectionOrder];
  const [moved] = newOrder.splice(fromIndex, 1);
  newOrder.splice(toIndex, 0, moved);

  applySectionOrder(newOrder);
  saveStoredSectionOrder(newOrder);
  renderLayoutSettingsList(newOrder);
}

function renderLayoutSettingsList(order = currentCardSectionOrder) {
  if (!layoutSectionsList) return;
  layoutSectionsList.replaceChildren();

  order.forEach((sectionId, index) => {
    const meta = SECTION_METADATA[sectionId] || { id: sectionId, name: sectionId };
    const item = document.createElement("div");
    item.className = "layout-section-item";
    item.draggable = true;
    item.setAttribute("data-section-id", sectionId);
    item.setAttribute("data-index", String(index));
    item.setAttribute("role", "listitem");

    // Handle and section label
    const handleWrap = document.createElement("div");
    handleWrap.className = "layout-section-handle-wrap";

    const handleIcon = document.createElement("span");
    handleIcon.className = "layout-drag-handle";
    handleIcon.setAttribute("aria-hidden", "true");
    handleIcon.textContent = "☰";

    const nameSpan = document.createElement("span");
    nameSpan.className = "layout-section-name";
    nameSpan.textContent = meta.name;

    handleWrap.appendChild(handleIcon);
    handleWrap.appendChild(nameSpan);

    // Actions (Move Up / Move Down)
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "layout-section-actions";

    const visibilityToggle = document.createElement("input");
    visibilityToggle.type = "checkbox";
    visibilityToggle.className = "layout-section-visibility";
    visibilityToggle.checked = currentCardSectionVisibility[sectionId] !== false;
    visibilityToggle.disabled = sectionId === "fields";
    visibilityToggle.title = sectionId === "fields" ? "Card Fields are always visible" : `Show ${meta.name} in the Text tab`;
    visibilityToggle.setAttribute("aria-label", visibilityToggle.title);
    visibilityToggle.addEventListener("change", () => {
      const nextVisibility = { ...currentCardSectionVisibility, [sectionId]: visibilityToggle.checked };
      saveStoredSectionVisibility(nextVisibility);
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-move-section btn-move-up";
    upBtn.textContent = "↑";
    upBtn.title = `Move ${meta.name} up`;
    upBtn.setAttribute("aria-label", `Move ${meta.name} up`);
    if (index === 0) upBtn.disabled = true;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSectionByDelta(index, -1);
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-move-section btn-move-down";
    downBtn.textContent = "↓";
    downBtn.title = `Move ${meta.name} down`;
    downBtn.setAttribute("aria-label", `Move ${meta.name} down`);
    if (index === order.length - 1) downBtn.disabled = true;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveSectionByDelta(index, 1);
    });

    actionsWrap.appendChild(visibilityToggle);
    actionsWrap.appendChild(upBtn);
    actionsWrap.appendChild(downBtn);

    item.appendChild(handleWrap);
    item.appendChild(actionsWrap);

    // Drag-and-drop event handlers
    item.addEventListener("dragstart", (e) => {
      draggedSectionIndex = index;
      item.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", sectionId);
      }
    });

    item.addEventListener("dragend", () => {
      draggedSectionIndex = null;
      if (layoutSectionsList) {
        layoutSectionsList.querySelectorAll(".layout-section-item").forEach(el => {
          el.classList.remove("dragging", "drag-over");
        });
      }
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      if (draggedSectionIndex === null || draggedSectionIndex === index) return;

      const newOrder = [...currentCardSectionOrder];
      const [moved] = newOrder.splice(draggedSectionIndex, 1);
      newOrder.splice(index, 0, moved);
      draggedSectionIndex = null;

      applySectionOrder(newOrder);
      saveStoredSectionOrder(newOrder);
      renderLayoutSettingsList(newOrder);
    });

    layoutSectionsList.appendChild(item);
  });
}

function openLayoutSettings() {
  const popover = layoutSettingsPopover || cardSettingsPopover;
  if (popover) {
    popover.hidden = false;
    if (popover.style) popover.style.display = "";
  }
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "true");
    btnLayoutSettings.classList.add("active");
  }
  if (typeof currentMiningTab !== "undefined" && currentMiningTab !== "settings") {
    if (btnLayoutSettings) btnLayoutSettings._prevTab = currentMiningTab;
    if (typeof switchMiningTab === "function") switchMiningTab("settings");
  }
}

function closeLayoutSettings() {
  const popover = layoutSettingsPopover || cardSettingsPopover;
  if (popover) {
    popover.hidden = true;
    if (popover.style) popover.style.display = "none";
  }
  if (btnLayoutSettings) {
    btnLayoutSettings.setAttribute("aria-expanded", "false");
    btnLayoutSettings.classList.remove("active");
  }
  if (typeof currentMiningTab !== "undefined" && currentMiningTab === "settings") {
    if (typeof switchMiningTab === "function") switchMiningTab(btnLayoutSettings?._prevTab || "text");
  }
}

async function resetLayoutSettings() {
  const defaultOrder = [...DEFAULT_CARD_SECTION_ORDER];
  currentCardSectionVisibility = { ...DEFAULT_CARD_SECTION_VISIBILITY };
  applySectionOrder(defaultOrder);
  await saveStoredSectionOrder(defaultOrder);
  renderLayoutSettingsList(defaultOrder);
}

if (btnLayoutSettings) {
  btnLayoutSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentMiningTab === "settings") {
      switchMiningTab(btnLayoutSettings._prevTab || "text");
    } else {
      btnLayoutSettings._prevTab = currentMiningTab;
      switchMiningTab("settings");
    }
  });
}

const settingsPopoverTarget = layoutSettingsPopover || cardSettingsPopover;
if (settingsPopoverTarget) {
  settingsPopoverTarget.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

if (btnCloseLayoutSettings) {
  btnCloseLayoutSettings.addEventListener("click", () => {
    closeLayoutSettings();
  });
}

if (btnCloseCardSettings && btnCloseCardSettings !== btnCloseLayoutSettings) {
  btnCloseCardSettings.addEventListener("click", () => {
    closeLayoutSettings();
  });
}

if (btnResetLayout) {
  btnResetLayout.addEventListener("click", () => {
    resetLayoutSettings();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentMiningTab === "settings") {
    switchMiningTab(btnLayoutSettings?._prevTab || "text");
  }
});

document.addEventListener("click", (e) => {
  if (currentMiningTab === "settings") {
    const popover = layoutSettingsPopover || cardSettingsPopover;
    if (popover && !popover.contains(e.target) && btnLayoutSettings && !btnLayoutSettings.contains(e.target)) {
      switchMiningTab(btnLayoutSettings?._prevTab || "text");
    }
  }
});


if (btnDismissFirstRun) {
  btnDismissFirstRun.addEventListener("click", () => dismissFirstRunGuide());
}

// --- Account & Cloud Auth UI in Sidepanel Settings ---
const authStatusText = document.querySelector("#auth-status-text");
const authLoginActions = document.querySelector("#auth-login-actions");
const authLogoutActions = document.querySelector("#auth-logout-actions");
const btnCloudLoginGoogle = document.querySelector("#btn-cloud-login-google");
const btnCloudLogout = document.querySelector("#btn-cloud-logout");

function updateSidepanelAuthUI(status) {
  if (!authStatusText) return;
  const isAuth = Boolean(status && (status.authenticated || status.logged_in));
  if (isAuth) {
    const user = status.user || {};
    const label = user.email || user.name || "Logged In";
    authStatusText.textContent = label;
    authStatusText.style.color = "#4ebb7b";
    if (authLoginActions) authLoginActions.style.display = "none";
    if (authLogoutActions) authLogoutActions.style.display = "inline-flex";
  } else {
    authStatusText.textContent = "Not Signed In";
    authStatusText.style.color = "#8e8a81";
    if (authLoginActions) authLoginActions.style.display = "inline-flex";
    if (authLogoutActions) authLogoutActions.style.display = "none";
  }
}

async function refreshSidepanelAuthStatus() {
  try {
    const data = await chrome.storage?.local?.get(["kiroku.cloud.auth_token", "kiroku_auth_token", "kiroku_auth_session"]);
    const token = data?.["kiroku.cloud.auth_token"] || data?.kiroku_auth_token;
    if (token) {
      updateSidepanelAuthUI({ authenticated: true, user: data.kiroku_auth_session });
    } else {
      updateSidepanelAuthUI({ authenticated: false });
    }
  } catch (_) {
    updateSidepanelAuthUI({ authenticated: false });
  }
}

let isGoogleLoginPending = false;
btnCloudLoginGoogle?.addEventListener("click", () => {
  if (isGoogleLoginPending) return;
  isGoogleLoginPending = true;
  if (authStatusText) {
    authStatusText.textContent = "Connecting…";
    authStatusText.style.color = "#d97706";
  }
  setTimeout(() => { isGoogleLoginPending = false; }, 4000);

  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "CLOUD_LOGIN_GOOGLE" }).catch(() => {
      const redirectUrl = chrome.runtime.getURL("auth.html");
      const oauthState = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36));
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ "kiroku_oauth_state": oauthState });
      }
      const authUrl = `https://kiroku-note.rhythmkach.workers.dev/auth/google?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(oauthState)}`;
      chrome.tabs.create({ url: authUrl });
    });
  } else {
    const redirectUrl = chrome.runtime.getURL("auth.html");
    const oauthState = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36));
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ "kiroku_oauth_state": oauthState });
    }
    const authUrl = `https://kiroku-note.rhythmkach.workers.dev/auth/google?redirect=${encodeURIComponent(redirectUrl)}&state=${encodeURIComponent(oauthState)}`;
    chrome.tabs.create({ url: authUrl });
  }
});

btnCloudLogout?.addEventListener("click", async () => {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      await chrome.runtime.sendMessage({ type: "CLOUD_LOGOUT" });
      updateSidepanelAuthUI({ authenticated: false });
    } catch (_) {}
  }
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes["kiroku.cloud.auth_token"] || changes["kiroku_auth_token"] || changes["kiroku_auth_session"])) {
      refreshSidepanelAuthStatus();
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CLOUD_AUTH_CHANGED") {
      updateSidepanelAuthUI({ authenticated: Boolean(msg.authenticated), user: msg.user });
    }
  });
}

refreshSidepanelAuthStatus();

