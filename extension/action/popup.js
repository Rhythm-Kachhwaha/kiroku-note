/**
 * Kiroku Note - Action Popup Controller
 */

(() => {
  "use strict";

  const API_BASE = "http://127.0.0.1:21828";
  const PREFS_KEY = "kiroku.extension.prefs";

  const backendDot = document.getElementById("backend-dot");
  const backendStatus = document.getElementById("backend-status");
  const toggleMining = document.getElementById("toggle-mining");
  const toggleSite = document.getElementById("toggle-site");
  const statKnown = document.getElementById("stat-known");
  const statMined = document.getElementById("stat-mined");
  const btnSidepanel = document.getElementById("btn-sidepanel");
  const btnApp = document.getElementById("btn-app");
  const accountBadge = document.getElementById("account-badge");
  const accountActionsLoggedOut = document.getElementById("account-actions-logged-out");
  const accountActionsLoggedIn = document.getElementById("account-actions-logged-in");
  const btnPopupGoogleLogin = document.getElementById("btn-popup-google-login");
  const btnPopupGuestLogin = document.getElementById("btn-popup-guest-login");
  const btnPopupLogout = document.getElementById("btn-popup-logout");

  let currentHost = "";

  async function init() {
    // 1. Get Active Tab Host
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const u = new URL(tab.url);
        currentHost = u.hostname;
      }
    } catch (_) {}

    // 2. Load Preferences
    chrome.storage.local.get([PREFS_KEY, "kiroku.mining.enabled"], (res) => {
      const prefs = res?.[PREFS_KEY] || {};
      const enabled = prefs.enabled ?? res?.["kiroku.mining.enabled"] ?? true;
      if (toggleMining) toggleMining.checked = Boolean(enabled);

      if (toggleSite && currentHost) {
        const overrides = prefs.siteOverrides || {};
        toggleSite.checked = overrides[currentHost] !== false;
      }
    });

    // 3. Check Backend Status & Stats
    checkBackendHealth();

    // 4. Attach Event Listeners
    toggleMining?.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      chrome.runtime.sendMessage({ type: "SET_MINING_MODE", enabled }).catch(() => {});
      chrome.storage.local.get(PREFS_KEY, (res) => {
        const prefs = res?.[PREFS_KEY] || {};
        prefs.enabled = enabled;
        chrome.storage.local.set({ [PREFS_KEY]: prefs });
      });
    });

    toggleSite?.addEventListener("change", (e) => {
      if (!currentHost) return;
      const enabled = e.target.checked;
      chrome.storage.local.get(PREFS_KEY, (res) => {
        const prefs = res?.[PREFS_KEY] || {};
        prefs.siteOverrides = prefs.siteOverrides || {};
        prefs.siteOverrides[currentHost] = enabled;
        chrome.storage.local.set({ [PREFS_KEY]: prefs });
      });
    });

    btnSidepanel?.addEventListener("click", async () => {
      try {
        const win = await chrome.windows.getCurrent();
        if (win?.id && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId: win.id });
          window.close();
        }
      } catch (_) {}
    });

    btnApp?.addEventListener("click", () => {
      chrome.tabs.create({ url: "http://127.0.0.1:21828" });
      window.close();
    });

    // 5. Account & Cloud Auth Wiring
    btnPopupGoogleLogin?.addEventListener("click", async () => {
      if (accountBadge) accountBadge.textContent = "Opening…";
      const resp = await chrome.runtime.sendMessage({ type: "CLOUD_LOGIN_GOOGLE" }).catch(() => null);
      if (resp && resp.status) updateAuthUI(resp.status);
      else refreshAuthStatus();
    });

    btnPopupGuestLogin?.addEventListener("click", async () => {
      if (accountBadge) accountBadge.textContent = "Connecting…";
      const resp = await chrome.runtime.sendMessage({ type: "CLOUD_LOGIN_GUEST" }).catch(() => null);
      if (resp && resp.status) updateAuthUI(resp.status);
      else refreshAuthStatus();
    });

    btnPopupLogout?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLOUD_LOGOUT" }).catch(() => {});
      updateAuthUI({ logged_in: false });
    });

    refreshAuthStatus();
  }

  function updateAuthUI(status) {
    if (!accountBadge) return;
    if (status && status.logged_in) {
      const user = status.user || {};
      const label = user.email ? user.email.split("@")[0] : (user.id ? `Guest (${user.id.slice(0, 6)})` : "Logged In");
      accountBadge.textContent = label;
      accountBadge.style.background = "#4EBB7B";
      accountBadge.style.color = "#0B0A09";
      if (accountActionsLoggedOut) accountActionsLoggedOut.style.display = "none";
      if (accountActionsLoggedIn) accountActionsLoggedIn.style.display = "block";
    } else {
      accountBadge.textContent = "Guest Mode";
      accountBadge.style.background = "#32302C";
      accountBadge.style.color = "#F0ECE3";
      if (accountActionsLoggedOut) accountActionsLoggedOut.style.display = "flex";
      if (accountActionsLoggedIn) accountActionsLoggedIn.style.display = "none";
    }
  }

  async function refreshAuthStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_CLOUD_AUTH_STATUS" });
      if (resp && resp.ok) {
        updateAuthUI(resp.status);
      }
    } catch (_) {}
  }

  async function checkBackendHealth() {
    try {
      const resp = await fetch(`${API_BASE}/api/health`, { method: "GET" });
      if (resp.ok) {
        backendDot?.classList.add("online");
        if (backendStatus) backendStatus.textContent = "Connected";
        loadStats();
      } else {
        await checkCloudHealthFallback();
      }
    } catch (_) {
      await checkCloudHealthFallback();
    }
  }

  async function checkCloudHealthFallback() {
    try {
      const cloudResp = await fetch("https://kiroku-note.rhythmkach.workers.dev/api/health", { method: "GET" });
      if (cloudResp.ok) {
        backendDot?.classList.add("online");
        if (backendStatus) backendStatus.textContent = "Cloud Ready";
        loadStoredStats();
        return;
      }
    } catch (_) {}
    setOffline();
  }

  function setOffline() {
    backendDot?.classList.remove("online");
    if (backendStatus) backendStatus.textContent = "Offline";
    if (statKnown) statKnown.textContent = "-";
    if (statMined) statMined.textContent = "-";
  }

  async function loadStoredStats() {
    try {
      const res = await chrome.storage.local.get(["kiroku.episode_mined_total", "kiroku.cloud.known_count"]);
      if (statKnown && res?.["kiroku.cloud.known_count"] !== undefined) {
        statKnown.textContent = String(res["kiroku.cloud.known_count"]);
      }
      if (statMined && res?.["kiroku.episode_mined_total"] !== undefined) {
        statMined.textContent = String(res["kiroku.episode_mined_total"]);
      }
    } catch (_) {}
  }

  async function loadStats() {
    try {
      const statsResp = await fetch(`${API_BASE}/api/word-states/stats`);
      if (statsResp.ok) {
        const data = await statsResp.json();
        if (statKnown) statKnown.textContent = String(data.known_count ?? data.known ?? 0);
        if (statMined) statMined.textContent = String(data.total_words ?? data.mined ?? 0);
      }
    } catch (_) {}
  }

  init();
})();

