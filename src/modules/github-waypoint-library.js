window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installGithubWaypointLibraryModule = function installGithubWaypointLibraryModule(bot) {
  const repoOwner = "seledoz";
  const repoName = "mintest3";
  const branch = "bot-waypoints";
  const waypointDirectory = "waypoints";
  const tokenStorageKey = "minibiaBot.github.token";
  const statusStorageKey = "minibiaBot.githubWaypointLibrary.lastStatus";
  const apiBaseUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents`;
  const rawBaseUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}`;

  function getToken() {
    return String(bot.storage.get(tokenStorageKey, "") || "").trim();
  }

  function hasToken() {
    return !!getToken();
  }

  async function setToken(value) {
    const nextValue = String(value || "").trim();
    if (!nextValue) {
      bot.storage.remove(tokenStorageKey);
      updateConnectionUi();
      return "";
    }

    // Validate that the token can access this repository before reporting
    // "connected". A stored token alone does not prove it has write access.
    const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
      headers: getHeaders(nextValue),
      cache: "no-store",
    });
    if (!response.ok) {
      let details = "";
      try {
        const data = await response.json();
        details = data?.message ? ` - ${data.message}` : "";
      } catch (error) {}
      throw new Error(`GitHub token check failed: HTTP ${response.status}${details}`);
    }

    bot.storage.set(tokenStorageKey, nextValue);
    updateConnectionUi();
    return nextValue;
  }

  function setStatus(message) {
    const text = String(message || "").trim();
    bot.storage.set(statusStorageKey, text);
    const label = document.getElementById("minibia-bot-github-waypoints-status");
    if (label) label.textContent = text || "GitHub: idle";
  }

  function updateConnectionUi() {
    const connected = hasToken();
    const label = document.getElementById("minibia-bot-github-waypoints-connection");
    const setup = document.getElementById("minibia-bot-github-waypoints-setup");
    const input = document.getElementById("minibia-bot-github-waypoints-token");

    if (label) label.textContent = connected ? "GitHub: connected for saving" : "GitHub: setup needed for saving";
    if (setup) setup.hidden = connected;
    if (input && connected) input.value = "";
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function normalizeWaypoint(value) {
    const position = normalizePosition(value);
    if (!position) return null;
    const waypoint = { ...position };
    if (typeof value?.action === "string" && value.action.trim()) {
      waypoint.action = value.action.trim();
    }
    if (typeof value?.useDirection === "string" && value.useDirection.trim()) {
      waypoint.useDirection = value.useDirection.trim().toUpperCase();
    }
    return waypoint;
  }

  function normalizeRoute(value) {
    return Array.isArray(value) ? value.map(normalizeWaypoint).filter(Boolean) : [];
  }

  function normalizeTransition(value) {
    if (!value) return null;
    const from = normalizePosition(value.from || value);
    const to = normalizePosition(value.to || { x: value.targetX, y: value.targetY, z: value.targetZ });
    if (!from || !to || from.z === to.z) return null;
    return {
      from,
      to,
      count: Math.max(1, Math.trunc(Number(value.count) || 1)),
      lastSeenAt: Math.max(0, Math.trunc(Number(value.lastSeenAt) || Date.now())),
    };
  }

  function normalizeTransitions(value) {
    return Array.isArray(value) ? value.map(normalizeTransition).filter(Boolean) : [];
  }

  function normalizeScript(value, fallbackName = "") {
    const name = String(value?.name || fallbackName || "").trim().replace(/\s+/g, " ");
    if (!name) return null;
    return {
      version: 1,
      name,
      updatedAt: value?.updatedAt || null,
      route: normalizeRoute(value?.route),
      transitions: normalizeTransitions(value?.transitions),
    };
  }

  function getScriptFileBaseName(name) {
    const cleaned = String(name || "")
      .trim()
      .replace(/\.json$/i, "")
      .replace(/[^a-z0-9 _.-]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "waypoints";
  }

  function getScriptPath(name) {
    return `${waypointDirectory}/${getScriptFileBaseName(name)}.json`;
  }

  function getNameFromPath(path) {
    const fileName = String(path || "").split("/").pop() || "";
    return fileName.replace(/\.json$/i, "").replace(/[-_]+/g, " ").trim();
  }

  function encodePath(path) {
    return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/");
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function decodeBase64Utf8(text) {
    return new TextDecoder().decode(Uint8Array.from(atob(String(text || "").replace(/\s/g, "")), (char) => char.charCodeAt(0)));
  }

  function getHeaders(value = "") {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (value) headers.Authorization = `Bearer ${value}`;
    return headers;
  }

  async function ensureWaypointBranch() {
    const value = getToken();
    if (!value) throw new Error("Save GitHub Setup first");

    const refUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${encodeURIComponent(branch)}`;
    const existing = await fetch(refUrl, { headers: getHeaders(value), cache: "no-store" });
    if (existing.ok) return true;
    if (existing.status !== 404) {
      let details = "";
      try { const data = await existing.json(); details = data?.message ? ` - ${data.message}` : ""; } catch (error) {}
      throw new Error(`GitHub branch check failed: HTTP ${existing.status}${details}`);
    }

    const baseResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/main`, {
      headers: getHeaders(value), cache: "no-store"
    });
    if (!baseResponse.ok) {
      let details = "";
      try { const data = await baseResponse.json(); details = data?.message ? ` - ${data.message}` : ""; } catch (error) {}
      throw new Error(`GitHub main branch lookup failed: HTTP ${baseResponse.status}${details}`);
    }
    const baseData = await baseResponse.json();

    const createResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`, {
      method: "POST",
      headers: { ...getHeaders(value), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseData.object?.sha }),
    });
    if (!createResponse.ok) {
      let details = "";
      try { const data = await createResponse.json(); details = data?.message ? ` - ${data.message}` : ""; } catch (error) {}
      throw new Error(`GitHub waypoint branch creation failed: HTTP ${createResponse.status}${details}`);
    }
    return true;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    if (!response.ok) {
      let details = "";
      try {
        const data = await response.json();
        details = data?.message ? ` - ${data.message}` : "";
      } catch (error) {}
      throw new Error(`GitHub request failed: HTTP ${response.status}${details}`);
    }
    return response.json();
  }

  async function listScriptFiles() {
    const url = `${apiBaseUrl}/${encodePath(waypointDirectory)}?ref=${encodeURIComponent(branch)}`;
    const entries = await fetchJson(url, { headers: getHeaders() });
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.type === "file" && /\.json$/i.test(entry.name) && entry.name !== "library.json")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function fetchScriptByFile(file) {
    const path = file?.path || getScriptPath(file?.name || "");
    const fallbackName = getNameFromPath(path);
    const response = await fetch(`${rawBaseUrl}/${encodePath(path)}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`GitHub load failed: HTTP ${response.status}`);
    const script = normalizeScript(await response.json(), fallbackName);
    return script ? { ...script, path } : null;
  }

  async function listScripts() {
    const files = await listScriptFiles();
    const scripts = await Promise.all(files.map((file) => fetchScriptByFile(file).catch(() => ({
      name: getNameFromPath(file.path || file.name),
      path: file.path,
      route: [],
      transitions: [],
      updatedAt: null,
      loadError: true,
    }))));
    return scripts.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function fetchFileForWrite(path) {
    const value = getToken();
    if (!value) throw new Error("Save GitHub Setup first");

    const response = await fetch(`${apiBaseUrl}/${encodePath(path)}?ref=${encodeURIComponent(branch)}`, {
      headers: getHeaders(value),
      cache: "no-store",
    });

    if (response.status === 404) return { sha: null, content: null };
    if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`);
    const file = await response.json();
    return { sha: file.sha || null, content: file.content ? decodeBase64Utf8(file.content) : null };
  }

  async function writeScriptFile(path, script, sha) {
    const value = getToken();
    if (!value) throw new Error("Save GitHub Setup first");

    const content = JSON.stringify(normalizeScript(script, script.name), null, 2) + "\n";
    const body = {
      message: `Save waypoint script: ${script.name}`,
      content: encodeBase64Utf8(content),
      branch,
    };
    if (sha) body.sha = sha;

    const response = await fetch(`${apiBaseUrl}/${encodePath(path)}`, {
      method: "PUT",
      headers: { ...getHeaders(value), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let details = "";
      let documentation = "";
      try {
        const data = await response.json();
        details = data?.message ? ` - ${data.message}` : "";
        documentation = data?.documentation_url ? ` (${data.documentation_url})` : "";
      } catch (error) {}
      throw new Error(`GitHub save failed: HTTP ${response.status}${details}${documentation}`);
    }
    return response.json();
  }

  async function saveCurrentScript(name) {
    const scriptName = String(name || bot.cave?.getActivePresetName?.() || "").trim().replace(/\s+/g, " ");
    if (!scriptName) throw new Error("Script name missing");

    const route = normalizeRoute(bot.cave?.getRoute?.() || []);
    const transitions = normalizeTransitions(bot.cave?.getTransitions?.() || []);
    if (!route.length) throw new Error("No waypoints to save");

    const path = getScriptPath(scriptName);
    await ensureWaypointBranch();
    const { sha } = await fetchFileForWrite(path);
    const script = { version: 1, name: scriptName, updatedAt: new Date().toISOString(), route, transitions };
    await writeScriptFile(path, script, sha);
    bot.cave?.savePreset?.(scriptName);
    bot.log("GitHub waypoint script saved", { name: scriptName, waypoints: route.length, transitions: transitions.length, path });
    return { ...script, path };
  }

  async function loadScript(nameOrPath) {
    const value = String(nameOrPath || "").trim();
    if (!value) throw new Error("Choose a script to load");

    const scripts = await listScripts();
    const summary = scripts.find((entry) =>
      entry.path === value ||
      entry.name.toLowerCase() === value.toLowerCase() ||
      getScriptFileBaseName(entry.name).toLowerCase() === getScriptFileBaseName(value).toLowerCase()
    );
    if (!summary) throw new Error(`Script not found: ${value}`);

    const script = await fetchScriptByFile(summary);
    const route = normalizeRoute(script?.route);
    if (!script || !route.length) throw new Error(`Script has no waypoints: ${summary.name || value}`);

    bot.cave?.stop?.();
    bot.cave?.clearWaypoints?.();
    bot.cave?.clearTransitions?.();
    route.forEach((waypoint) => {
      bot.cave?.addWaypoint?.(waypoint, {
        action: waypoint.action || "walk",
        useDirection: waypoint.useDirection || "N",
      });
    });
    bot.cave?.savePreset?.(script.name);
    bot.cave?.loadPreset?.(script.name);
    bot.log("GitHub waypoint script loaded", {
      name: script.name,
      waypoints: route.length,
      transitionsSavedInFile: normalizeTransitions(script.transitions).length,
      path: script.path,
    });
    return script;
  }

  async function refreshUi() {
    const select = document.getElementById("minibia-bot-github-waypoints-select");
    const nameInput = document.getElementById("minibia-bot-github-waypoints-name");
    if (!select) return;

    updateConnectionUi();
    setStatus("GitHub: loading scripts...");
    const scripts = await listScripts();
    const activeName = bot.cave?.getActivePresetName?.() || "";
    select.innerHTML = "";

    if (!scripts.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No GitHub scripts";
      select.appendChild(option);
      select.disabled = true;
    } else {
      scripts.forEach((script) => {
        const option = document.createElement("option");
        option.value = script.path || getScriptPath(script.name);
        option.textContent = `${script.name} (${script.route.length})`;
        select.appendChild(option);
      });
      select.disabled = false;
      const match = scripts.find((script) => script.name.toLowerCase() === activeName.toLowerCase());
      select.value = match?.path || scripts[0].path || "";
    }

    if (nameInput && !nameInput.value.trim()) {
      const selectedScript = scripts.find((script) => script.path === select.value);
      nameInput.value = activeName || selectedScript?.name || "";
    }
    setStatus(`GitHub: ${scripts.length} script${scripts.length === 1 ? "" : "s"} found`);
  }

  function injectUi() {
    const panel = document.getElementById("minibia-bot-panel");
    if (!panel || document.getElementById("minibia-bot-github-waypoints-section")) return false;

    const column = panel.querySelector(".mb-cave-column") || panel.querySelector(".mb-main-column") || panel;
    const section = document.createElement("div");
    section.className = "mb-section mb-column-section";
    section.id = "minibia-bot-github-waypoints-section";
    section.innerHTML = `
      <div class="mb-label">GitHub Waypoints</div>
      <div class="mb-stack">
        <div class="mb-small-note" id="minibia-bot-github-waypoints-connection">GitHub: setup needed for saving</div>
        <div id="minibia-bot-github-waypoints-setup" class="mb-stack">
          <input type="password" id="minibia-bot-github-waypoints-token" placeholder="GitHub token" />
          <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-save-token">Save GitHub Setup</button>
        </div>
        <input type="text" id="minibia-bot-github-waypoints-name" placeholder="Script name" />
        <select id="minibia-bot-github-waypoints-select"></select>
        <div class="mb-actions mb-actions-inline-two">
          <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-save">Save Current</button>
          <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-load">Load Selected</button>
        </div>
        <button type="button" class="mb-small-button" id="minibia-bot-github-waypoints-refresh">Refresh List</button>
        <div class="mb-small-note" id="minibia-bot-github-waypoints-status">GitHub: idle</div>
        <div class="mb-small-note">Each script saves as its own file in ${waypointDirectory}/. Setup is stored only in this browser.</div>
      </div>
    `;
    column.appendChild(section);

    const setup = section.querySelector("#minibia-bot-github-waypoints-setup");
    const tokenInput = section.querySelector("#minibia-bot-github-waypoints-token");
    const saveTokenButton = section.querySelector("#minibia-bot-github-waypoints-save-token");
    const nameInput = section.querySelector("#minibia-bot-github-waypoints-name");
    const select = section.querySelector("#minibia-bot-github-waypoints-select");
    const saveButton = section.querySelector("#minibia-bot-github-waypoints-save");
    const loadButton = section.querySelector("#minibia-bot-github-waypoints-load");
    const refreshButton = section.querySelector("#minibia-bot-github-waypoints-refresh");

    if (saveTokenButton) {
      saveTokenButton.addEventListener("click", async () => {
        try {
          saveTokenButton.disabled = true;
          setStatus("GitHub: checking token access...");
          await setToken(tokenInput?.value || "");
          setStatus("GitHub: token can access mintest3");
        } catch (error) {
          setStatus(`GitHub: ${error?.message || error}`);
          bot.log("GitHub token check failed", error?.message || error);
        } finally {
          saveTokenButton.disabled = false;
        }
      });
    }

    if (select && nameInput) {
      select.addEventListener("change", () => {
        const label = select.options[select.selectedIndex]?.textContent || "";
        const selectedName = label.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (selectedName) nameInput.value = selectedName;
      });
    }

    if (saveButton) {
      saveButton.addEventListener("click", async () => {
        try {
          if (!hasToken()) {
            if (setup) setup.hidden = false;
            throw new Error("Save GitHub Setup first");
          }
          saveButton.disabled = true;
          setStatus("GitHub: saving current script...");
          const saved = await saveCurrentScript(nameInput?.value || "");
          if (nameInput) nameInput.value = saved.name;
          await refreshUi();
          setStatus(`GitHub: saved ${saved.name} (${saved.route.length})`);
        } catch (error) {
          setStatus(`GitHub: ${error?.message || error}`);
          bot.log("GitHub waypoint save failed", error?.message || error);
        } finally {
          saveButton.disabled = false;
        }
      });
    }

    if (loadButton) {
      loadButton.addEventListener("click", async () => {
        try {
          loadButton.disabled = true;
          setStatus("GitHub: loading selected script...");
          const loaded = await loadScript(select?.value || nameInput?.value || "");
          if (nameInput) nameInput.value = loaded.name;
          setStatus(`GitHub: loaded ${loaded.name} (${loaded.route.length})`);
        } catch (error) {
          setStatus(`GitHub: ${error?.message || error}`);
          bot.log("GitHub waypoint load failed", error?.message || error);
        } finally {
          loadButton.disabled = false;
        }
      });
    }

    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        refreshUi().catch((error) => setStatus(`GitHub: ${error?.message || error}`));
      });
    }

    updateConnectionUi();
    refreshUi().catch((error) => setStatus(`GitHub: ${error?.message || error}`));
    return true;
  }

  function waitForPanelAndInject() {
    if (injectUi()) return;
    let attempts = 0;
    const timerId = window.setInterval(() => {
      attempts += 1;
      if (injectUi() || attempts >= 20) window.clearInterval(timerId);
    }, 250);
    bot.addCleanup?.(() => window.clearInterval(timerId));
  }

  bot.githubWaypointLibrary = {
    getToken,
    hasToken,
    setToken,
    listScripts,
    saveCurrentScript,
    loadScript,
    refreshUi,
    directory: waypointDirectory,
    getScriptPath,
  };

  waitForPanelAndInject();
};
