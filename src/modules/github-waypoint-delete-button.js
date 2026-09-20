(() => {
  const BUTTON_ID = "minibia-bot-github-waypoints-delete";
  const SECTION_ID = "minibia-bot-github-waypoints-section";
  const SELECT_ID = "minibia-bot-github-waypoints-select";
  const STATUS_ID = "minibia-bot-github-waypoints-status";
  const REPO_OWNER = "seledoz";
  const REPO_NAME = "mintest2";
  const BRANCH = "main";
  const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

  function setStatus(message) {
    const label = document.getElementById(STATUS_ID);
    if (label) label.textContent = `GitHub: ${message}`;
  }

  function getLibrary() { return window.minibiaBot?.githubWaypointLibrary || null; }
  function getToken() { return String(getLibrary()?.getToken?.() || "").trim(); }

  function requireFreshSetup(message) {
    const library = getLibrary();
    library?.setToken?.("");
    const setup = document.getElementById("minibia-bot-github-waypoints-setup");
    if (setup) setup.hidden = false;
    const input = document.getElementById("minibia-bot-github-waypoints-token");
    if (input) { input.value = ""; input.focus(); }
    setStatus(message);
  }

  function encodePath(path) { return String(path || "").split("/").map((part) => encodeURIComponent(part)).join("/"); }
  function headers(token) {
    return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  }
  async function responseDetail(response) { try { return String((await response.json())?.message || "").trim(); } catch (error) { return ""; } }
  async function readFile(path, token) {
    const response = await fetch(`${API_BASE}/${encodePath(path)}?ref=${encodeURIComponent(BRANCH)}`, { headers: headers(token), cache: "no-store" });
    if (!response.ok) { const detail = await responseDetail(response); const error = new Error(`read failed (${response.status})${detail ? ` - ${detail}` : ""}`); error.status = response.status; throw error; }
    return response.json();
  }
  async function deleteFile(path, name, sha, token) {
    const response = await fetch(`${API_BASE}/${encodePath(path)}`, { method: "DELETE", headers: headers(token), body: JSON.stringify({ message: `Delete waypoint script: ${name}`, sha, branch: BRANCH }) });
    if (!response.ok) { const detail = await responseDetail(response); const error = new Error(`delete failed (${response.status})${detail ? ` - ${detail}` : ""}`); error.status = response.status; throw error; }
  }
  function selectedName(select) { const label = select?.options?.[select.selectedIndex]?.textContent || "selected script"; return label.replace(/\s*\(\d+\)\s*$/, "").trim() || "selected script"; }

  function injectDeleteButton() {
    const section = document.getElementById(SECTION_ID);
    const select = document.getElementById(SELECT_ID);
    if (!section || !select) return false;
    if (document.getElementById(BUTTON_ID)) return true;
    const button = document.createElement("button");
    button.type = "button"; button.id = BUTTON_ID; button.className = "mb-small-button"; button.textContent = "Delete Selected";
    const refreshButton = document.getElementById("minibia-bot-github-waypoints-refresh");
    if (refreshButton) refreshButton.insertAdjacentElement("beforebegin", button); else section.querySelector(".mb-stack")?.appendChild(button);
    const syncDisabled = () => { button.disabled = !select.value || select.disabled; };
    select.addEventListener("change", syncDisabled); syncDisabled();
    button.addEventListener("click", async () => {
      const path = String(select.value || "").trim(); const name = selectedName(select); if (!path) return;
      const token = getToken(); if (!token) { requireFreshSetup("Save GitHub Setup first"); return; }
      if (!window.confirm(`Delete GitHub waypoint script “${name}”?\n\nThis cannot be undone.`)) return;
      button.disabled = true; setStatus(`deleting ${name}...`);
      try { const file = await readFile(path, token); if (!file?.sha) throw new Error("file SHA missing"); await deleteFile(path, name, file.sha, token); setStatus(`deleted ${name}`); await getLibrary()?.refreshUi?.(); }
      catch (error) { if (error?.status === 401) requireFreshSetup("token rejected (401) — enter a new GitHub token"); else if (error?.status === 403) setStatus("token needs Contents read/write permission (403)"); else setStatus(error?.message || String(error)); console.error("[minibia-bot] GitHub waypoint delete failed", error); }
      finally { syncDisabled(); }
    });
    return true;
  }

  function normalizePathfinderModeUi() {
    const selects = Array.from(document.querySelectorAll('select[id="minibia-bot-cave-pathfinder-mode"]'));
    if (!selects.length) return false;
    const desired = [["game", "Game"], ["direct", "Direct"], ["smartA", "Smart A"], ["smartAField", "Smart A + Field Crossing"], ["arrow", "Arrow / D-pad"]];
    const desiredSignature = desired.map(([value, label]) => `${value}\u0000${label}`).join("\u0001");
    const primary = selects.find((select) => select.closest("#minibia-bot-panel")) || selects[0];
    selects.forEach((select) => {
      const current = select.value;
      const signature = Array.from(select.options).map((option) => `${option.value}\u0000${option.textContent}`).join("\u0001");
      if (signature !== desiredSignature) {
        select.replaceChildren();
        desired.forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        });
      }
      select.value = desired.some(([value]) => value === current) ? current : "game";
    });
    selects.filter((select) => select !== primary).forEach((select) => {
      const wrapper = select.closest("label.mb-field") || select.parentElement;
      if (wrapper && wrapper !== primary.closest("label.mb-field")) wrapper.remove();
      else select.remove();
    });
    return true;
  }

  function removeWaypointActions() {
    const select = document.getElementById("minibia-bot-cave-waypoint-action");
    if (!select) return false;
    const wrapper = select.closest("label.mb-field") || select.parentElement;
    if (wrapper) wrapper.remove();
    else select.remove();
    return true;
  }

  function injectWaypointWaitButton() {
    const addButton = document.getElementById("minibia-bot-cave-add");
    if (!addButton) return false;
    if (document.getElementById("minibia-bot-cave-record-wait")) return true;
    const button = document.createElement("button");
    button.type = "button"; button.id = "minibia-bot-cave-record-wait"; button.className = addButton.className; button.textContent = "Add Waypoint Wait";
    button.title = "Add a waypoint at your current position that pauses Cavebot movement for 1 minute";
    button.addEventListener("click", () => { const added = window.minibiaBot?.cave?.addWaypointCurrentSpot?.({ action: "wait" }); if (added) window.minibiaBot?.log?.("waypoint wait added", { waypoint: added, waitMs: 60000 }); });
    addButton.insertAdjacentElement("afterend", button);
    return true;
  }

  function enforceCaveControls() {
    normalizePathfinderModeUi();
    // Keep the Cavebot Waypoint Action control. It is part of the current
    // Cavebot UI and is installed by the waypoint-actions module.
    injectWaypointWaitButton();
  }

  injectDeleteButton();
  enforceCaveControls();

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const deleteReady = injectDeleteButton();
    enforceCaveControls();
    if (deleteReady && document.getElementById("minibia-bot-cave-record-wait") && attempts >= 8) window.clearInterval(timer);
    if (attempts >= 80) window.clearInterval(timer);
  }, 250);

  const observer = new MutationObserver(() => {
    enforceCaveControls();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const previousBot = window.minibiaBot;
  previousBot?.addCleanup?.(() => {
    window.clearInterval(timer);
    observer.disconnect();
  });
})();
