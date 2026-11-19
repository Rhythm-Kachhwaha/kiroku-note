/**
 * Kiroku Note - OAuth Exchange & Local Storage Sync Handler
 */

(async () => {
  "use strict";

  const CLOUD_WORKER_URL = "https://kiroku-note.rhythmkach.workers.dev";
  const spinner = document.getElementById("spinner");
  const statusTitle = document.getElementById("status-title");
  const statusDetail = document.getElementById("status-detail");

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const token = params.get("token");
  const error = params.get("error");

  if (error) {
    if (spinner) spinner.style.display = "none";
    if (statusTitle) {
      statusTitle.textContent = "Sign-In Failed";
      statusTitle.className = "status-message status-error";
    }
    if (statusDetail) {
      statusDetail.textContent = error;
    }
    return;
  }

  try {
    let resolvedToken = token;
    let resolvedUser = null;

    if (code) {
      const exchangeBody = { code };
      const st = params.get("state");
      if (st) exchangeBody.state = st;
      const resp = await fetch(`${CLOUD_WORKER_URL}/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exchangeBody)
      });

      if (!resp.ok) {
        throw new Error(`Exchange failed with status ${resp.status}`);
      }

      const data = await resp.json();
      if (!data?.token) {
        throw new Error(data?.error || "No authentication token returned");
      }
      resolvedToken = data.token;
      resolvedUser = data.user || null;
    }

    if (!resolvedToken) {
      throw new Error("Missing authorization code or token");
    }

    if (!resolvedUser) {
      const userRes = await fetch(`${CLOUD_WORKER_URL}/auth/me`, {
        headers: { "Authorization": `Bearer ${resolvedToken}` }
      }).catch(() => null);
      if (userRes && userRes.ok) {
        const uData = await userRes.json();
        resolvedUser = uData.user || null;
      }
    }

    // Persist token across all supported storage keys
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({
        "kiroku_auth_token": resolvedToken,
        "kiroku.cloud.auth_token": resolvedToken,
        "kiroku_cloud_token": resolvedToken,
        "kiroku.extension.session_token": resolvedToken,
        "kiroku.extension.auth_token": resolvedToken,
        "kiroku_auth_session": resolvedUser || { email: params.get("email") || "Learner" }
      });
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "CLOUD_AUTH_CHANGED",
        authenticated: true,
        user: resolvedUser || { email: params.get("email") || "Learner" }
      }).catch(() => {});
    }

    if (spinner) spinner.style.display = "none";
    if (statusTitle) {
      statusTitle.textContent = "Signed In Successfully!";
      statusTitle.className = "status-message status-success";
    }
    if (statusDetail) {
      const email = resolvedUser?.email || params.get("email") || "";
      statusDetail.textContent = email ? `Connected as ${email}. This tab will close…` : "Connected to Kiroku Cloud. This tab will close…";
    }

    setTimeout(() => {
      window.close();
    }, 1500);

  } catch (err) {
    if (spinner) spinner.style.display = "none";
    if (statusTitle) {
      statusTitle.textContent = "Sign-In Error";
      statusTitle.className = "status-message status-error";
    }
    if (statusDetail) {
      statusDetail.textContent = err.message || "Failed to complete authentication.";
    }
  }
})();

