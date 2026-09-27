window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installGithubWaypointAuthFix() {
  const TOKEN_KEY = "minibiaBot.github.token";
  const REPO_URL = "https://api.github.com/repos/seledoz/mintest3";

  function readToken() {
    try { return String(window.localStorage.getItem(TOKEN_KEY) || "").replace(/^"|"$/g, "").trim(); }
    catch (_) { return ""; }
  }

  function writeToken(value) {
    const token = String(value || "").trim();
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    try { window.minibiaBot?.githubWaypointLibrary?.setToken?.(token); } catch (_) {}
  }

  function setStatus(message) {
    const status = document.getElementById("minibia-bot-github-waypoints-status");
    if (status) status.textContent = message;
  }

  function showSetup(message = "GitHub: setup needed for saving") {
    const setup = document.getElementById("minibia-bot-github-waypoints-setup");
    const connection = document.getElementById("minibia-bot-github-waypoints-connection");
    if (setup) setup.hidden = false;
    if (connection) connection.textContent = message;
  }

  function hideSetup() {
    const setup = document.getElementById("minibia-bot-github-waypoints-setup");
    const connection = document.getElementById("minibia-bot-github-waypoints-connection");
    if (setup) setup.hidden = true;
    if (connection) connection.textContent = "GitHub: connected for saving";
  }

  async function validateToken(token) {
    const value = String(token || "").trim();
    if (!value) return { ok: false, status: 0, message: "Enter a GitHub token" };
    let response;
    try {
      response = await fetch(REPO_URL, {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${value}`,
        },
      });
    } catch (error) {
      return { ok: false, status: 0, message: error?.message || "GitHub connection failed" };
    }
    if (response.ok) return { ok: true, status: response.status, message: "GitHub token verified" };
    let detail = "";
    try { detail = String((await response.json())?.message || "").trim(); } catch (_) {}
    if (response.status === 401) return { ok: false, status: 401, message: "GitHub token is invalid or expired" };
    if (response.status === 403) return { ok: false, status: 403, message: detail ? `GitHub denied access: ${detail}` : "GitHub token does not have access" };
    return { ok: false, status: response.status, message: `GitHub token check failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}` };
  }

  function install() {
    const section = document.getElementById("minibia-bot-github-waypoints-section");
    const tokenInput = document.getElementById("minibia-bot-github-waypoints-token");
    const saveTokenButton = document.getElementById("minibia-bot-github-waypoints-save-token");
    const saveScriptButton = document.getElementById("minibia-bot-github-waypoints-save");
    if (!section || !tokenInput || !saveTokenButton || !saveScriptButton) return false;
    if (section.dataset.githubAuthFixInstalled === "true") return true;
    section.dataset.githubAuthFixInstalled = "true";

    saveTokenButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const token = String(tokenInput.value || "").trim();
      saveTokenButton.disabled = true;
      setStatus("GitHub: verifying token...");
      const result = await validateToken(token);
      if (result.ok) {
        writeToken(token);
        tokenInput.value = "";
        hideSetup();
        setStatus("GitHub: token verified — saving enabled");
      } else {
        writeToken("");
        showSetup(result.message);
        setStatus(`GitHub: ${result.message}`);
      }
      saveTokenButton.disabled = false;
    }, true);

    saveScriptButton.addEventListener("click", async (event) => {
      const token = readToken();
      const result = await validateToken(token);
      if (result.ok) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (result.status === 401 || !token) writeToken("");
      showSetup(result.message);
      setStatus(`GitHub: ${result.message}`);
    }, true);

    const savedToken = readToken();
    if (savedToken) {
      validateToken(savedToken).then((result) => {
        if (result.ok) hideSetup();
        else {
          if (result.status === 401) writeToken("");
          showSetup(result.message);
          setStatus(`GitHub: ${result.message}`);
        }
      });
    } else {
      showSetup();
    }
    return true;
  }

  let attempts = 0;
  const timerId = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) window.clearInterval(timerId);
  }, 100);
  install();
})();
