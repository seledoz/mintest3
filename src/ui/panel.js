window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanel = function installPanel(bot) {
  const panelPositionKey = "minibiaBot.ui.panelPosition";
  const panelCollapsedKey = "minibiaBot.ui.panelCollapsed";

  function destroy() {
    document.getElementById("minibia-bot-panel")?.remove();
    document.getElementById("minibia-bot-style")?.remove();
  }

  function savePanelPosition(position, key = panelPositionKey) {
    bot.storage.set(key, position);
  }

  function getSavedPanelPosition(key = panelPositionKey) {
    return bot.storage.get(key, null);
  }

  function savePanelCollapsed(collapsed) {
    bot.storage.set(panelCollapsedKey, !!collapsed);
  }

  function getSavedPanelCollapsed() {
    return !!bot.storage.get(panelCollapsedKey, false);
  }

  function isPanelCollapsed() {
    return document.getElementById("minibia-bot-panel")?.dataset?.collapsed === "true";
  }

  function refreshHomeLabel() {
    const homeLabel = document.getElementById("minibia-bot-home");
    if (!homeLabel) return;
    const home = bot.pz?.getHomePz?.();
    homeLabel.textContent = home ? `Panic Runner Home: ${home.x}, ${home.y}, ${home.z}` : "Panic Runner Home: not set";
  }

  function refreshPanicStatus() {
    const unknownToggle = document.getElementById("minibia-bot-panic-unknown");
    const healthToggle = document.getElementById("minibia-bot-panic-health");
    const returnToggle = document.getElementById("minibia-bot-panic-return");
    const status = bot.panic?.status?.();
    if (unknownToggle) unknownToggle.checked = !!status?.config?.unknownPlayerEnabled;
    if (healthToggle) healthToggle.checked = !!status?.config?.healthLossEnabled;
    if (returnToggle) returnToggle.checked = !!status?.config?.returnToOriginEnabled;
  }

  function refreshXrayStatus() {
    const status = bot.xray?.status?.();
    const me = bot.getPlayerPosition?.();
    const overlayButton = document.getElementById("minibia-bot-xray-overlay-toggle");
    const overlayLabel = document.getElementById("minibia-bot-xray-overlay-status");
    const floorSelect = document.getElementById("minibia-bot-xray-floor-select");
    const formatFloorOffset = (floor) => {
      if (!me || floor == null) return null;
      const offset = me.z - floor;
      return offset === 0 ? "0" : offset > 0 ? `+${offset}` : `${offset}`;
    };
    if (overlayButton) overlayButton.textContent = status?.config?.overlayEnabled ? "Disable Overlay" : "Enable Overlay";
    if (overlayLabel) {
      const floorLabel = status?.config?.selectedFloor == null ? "all floors" : `${formatFloorOffset(status.config.selectedFloor) ?? "?"}`;
      overlayLabel.textContent = `${status?.config?.overlayEnabled ? "Overlay: on" : "Overlay: off"} • ${floorLabel}`;
    }
    if (floorSelect) {
      const floors = Array.from(new Set((status?.visibleCreatures || []).map((creature) => creature?.position?.z).filter((floor) => floor != null))).sort((a, b) => a - b);
      const selectedFloor = status?.config?.selectedFloor;
      if (selectedFloor != null && !floors.includes(selectedFloor)) { floors.push(selectedFloor); floors.sort((a, b) => a - b); }
      floorSelect.innerHTML = "";
      const allOption = document.createElement("option"); allOption.value = "all"; allOption.textContent = "All floors"; floorSelect.appendChild(allOption);
      floors.forEach((floor) => { const option = document.createElement("option"); option.value = String(floor); const offsetLabel = formatFloorOffset(floor); option.textContent = offsetLabel == null ? String(floor) : offsetLabel; floorSelect.appendChild(option); });
      floorSelect.value = selectedFloor == null ? "all" : String(selectedFloor);
    }
  }

  function renderTrustedNames() {
    const list = document.getElementById("minibia-bot-panic-trusted-list"); if (!list) return;
    const trustedNames = bot.panic?.config?.trustedNames || []; list.innerHTML = "";
    if (!trustedNames.length) { const empty = document.createElement("div"); empty.className = "mb-small-note"; empty.textContent = "No trusted names saved."; list.appendChild(empty); return; }
    trustedNames.forEach((name, index) => { const row = document.createElement("div"); row.className = "mb-list-row"; const label = document.createElement("span"); label.textContent = name; const removeButton = document.createElement("button"); removeButton.type = "button"; removeButton.className = "mb-small-button"; removeButton.textContent = "Remove"; removeButton.addEventListener("click", () => { const nextNames = trustedNames.filter((_, currentIndex) => currentIndex !== index); bot.panic.updateConfig({ trustedNames: nextNames }); renderTrustedNames(); }); row.appendChild(label); row.appendChild(removeButton); list.appendChild(row); });
  }

  function renderGameMasterNames() {
    const list = document.getElementById("minibia-bot-panic-gm-list"); if (!list) return;
    const gameMasterNames = bot.panic?.config?.gameMasterNames || []; list.innerHTML = "";
    if (!gameMasterNames.length) { const empty = document.createElement("div"); empty.className = "mb-small-note"; empty.textContent = "No game master names saved."; list.appendChild(empty); return; }
    gameMasterNames.forEach((name, index) => { const row = document.createElement("div"); row.className = "mb-list-row"; const label = document.createElement("span"); label.textContent = name; const removeButton = document.createElement("button"); removeButton.type = "button"; removeButton.className = "mb-small-button"; removeButton.textContent = "Remove"; removeButton.addEventListener("click", () => { const nextNames = gameMasterNames.filter((_, currentIndex) => currentIndex !== index); bot.panic.updateConfig({ gameMasterNames: nextNames }); renderGameMasterNames(); }); row.appendChild(label); row.appendChild(removeButton); list.appendChild(row); });
  }

  function refreshRuneStatus() { const runeToggle = document.getElementById("minibia-bot-rune-enabled"); const running = !!bot.rune?.status?.().running; if (runeToggle) runeToggle.checked = running; }
  function refreshAutoEatStatus() { const autoEatToggle = document.getElementById("minibia-bot-auto-eat-enabled"); if (autoEatToggle) autoEatToggle.checked = !!bot.eat?.status?.().running; }
  function refreshAutoHealStatus() { const autoHealToggle = document.getElementById("minibia-bot-auto-heal-enabled"); if (autoHealToggle) autoHealToggle.checked = !!bot.heal?.status?.().running; }
  function refreshAutoInvisibleStatus() { const toggle = document.getElementById("minibia-bot-auto-invisible-enabled"); if (toggle) toggle.checked = !!bot.invisible?.status?.().running; }
  function refreshAutoMagicShieldStatus() { const toggle = document.getElementById("minibia-bot-auto-magic-shield-enabled"); if (toggle) toggle.checked = !!bot.magicShield?.status?.().running; }
  function refreshAutoAttackStatus() { const toggle = document.getElementById("minibia-bot-auto-attack-enabled"); if (toggle) toggle.checked = !!bot.attack?.status?.().running; }

  function refreshCaveStatus() {
    const statusLabel = document.getElementById("minibia-bot-cave-status"); const startButton = document.getElementById("minibia-bot-cave-start"); const stopButton = document.getElementById("minibia-bot-cave-stop"); const route = bot.cave?.getRoute?.() || []; const status = bot.cave?.status?.();
    if (statusLabel) { if (!route.length) statusLabel.textContent = "Status: no waypoints"; else if (status?.running) { const waypointNumber = (status.currentIndex ?? 0) + 1; const distanceLabel = Number.isFinite(status?.distanceToWaypoint) && status.distanceToWaypoint >= 0 ? `, dist ${status.distanceToWaypoint}` : ""; statusLabel.textContent = `Status: running (${waypointNumber}/${route.length}${distanceLabel})`; } else statusLabel.textContent = `Status: idle (${route.length} waypoint${route.length === 1 ? "" : "s"})`; }
    if (startButton) startButton.disabled = !route.length || !!status?.running; if (stopButton) stopButton.disabled = !status?.running;
  }

  function refreshCavePresetControls() {
    const select = document.getElementById("minibia-bot-cave-preset-select"); const label = document.getElementById("minibia-bot-cave-preset-status"); const deleteButton = document.getElementById("minibia-bot-cave-preset-delete"); const status = bot.cave?.status?.(); const presetNames = status?.presetNames || bot.cave?.getPresetNames?.() || []; const activePresetName = status?.activePresetName || bot.cave?.getActivePresetName?.() || "Default";
    if (select) { const previousValue = select.value; select.innerHTML = ""; if (!presetNames.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "No saved presets"; select.appendChild(option); select.disabled = true; } else { presetNames.forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; select.appendChild(option); }); select.disabled = false; const nextValue = presetNames.includes(activePresetName) ? activePresetName : previousValue; if (nextValue) select.value = nextValue; } }
    if (label) label.textContent = presetNames.length ? `Preset: ${activePresetName} (${presetNames.length} saved)` : `Preset: ${activePresetName}`; if (deleteButton) deleteButton.disabled = !presetNames.length || !select?.value;
  }

  function refreshCaveClosestStatus() { const label = document.getElementById("minibia-bot-cave-closest"); if (!label) return; const position = bot.getPlayerPosition?.(); const route = bot.cave?.getRoute?.() || []; if (!position) { label.textContent = "Closest start: current position unavailable"; return; } if (!route.length) { label.textContent = "Closest start: no waypoints"; return; } const closestIndex = bot.cave?.findClosestWaypointIndex?.(position) ?? 0; const waypoint = route[closestIndex]; if (!waypoint) { label.textContent = "Closest start: unavailable"; return; } label.textContent = `Closest start: ${closestIndex + 1}. ${waypoint.x}, ${waypoint.y}, ${waypoint.z}`; }
  function refreshCaveTransitionStatus() { const label = document.getElementById("minibia-bot-cave-transition-status"); if (!label) return; const transitions = bot.cave?.getTransitions?.() || []; if (!transitions.length) { label.textContent = "Transitions learned: none"; return; } const latest = transitions.slice().sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0))[0]; if (!latest?.from || !latest?.to) { label.textContent = `Transitions learned: ${transitions.length}`; return; } const extra = transitions.length > 1 ? ` (+${transitions.length - 1} more)` : ""; label.textContent = `Transitions learned: ${latest.from.x}, ${latest.from.y}, ${latest.from.z} -> ${latest.to.x}, ${latest.to.y}, ${latest.to.z}${extra}`; }
  function refreshCavePathfinderMode() { const select = document.getElementById("minibia-bot-cave-pathfinder-mode"); if (!select) return; const status = bot.cave?.status?.(); select.value = status?.config?.pathfinderMode || 'game'; }
  function refreshEquipRingStatus() { const toggle = document.getElementById("minibia-bot-equip-ring-enabled"); if (toggle) toggle.checked = !!bot.ring?.status?.().running; }
  function refreshDebugStatus() { const enabledToggle = document.getElementById("minibia-bot-debug-enabled"); const countLabel = document.getElementById("minibia-bot-debug-count"); const downloadButton = document.getElementById("minibia-bot-debug-download"); const clearButton = document.getElementById("minibia-bot-debug-clear"); if (enabledToggle) enabledToggle.checked = !!bot.logger?.debugEnabled; const count = bot.logger?.getLogs?.()?.length || 0; if (countLabel) countLabel.textContent = `${count} log entr${count === 1 ? "y" : "ies"}`; if (downloadButton) downloadButton.disabled = !count; if (clearButton) clearButton.disabled = !count; }
  function refreshTalkStatus() { const toggle = document.getElementById("minibia-bot-talk-enabled"); const label = document.getElementById("minibia-bot-talk-status"); const status = bot.talk?.status?.(); if (toggle) toggle.checked = !!status?.running; if (label) { if (!status?.config?.apiKey) label.textContent = "Status: API key missing"; else if (status?.pending) label.textContent = "Status: generating"; else if (status?.running) label.textContent = "Status: listening to Default"; else label.textContent = "Status: idle"; } }

  function refreshVisibleCreatures() {
    const list = document.getElementById("minibia-bot-visible-creatures-list"); if (!list || isPanelCollapsed()) return;
    const me = bot.getPlayerPosition?.(); const status = bot.xray?.status?.(); const creatures = status?.visibleCreatures || []; const selectedFloor = status?.config?.selectedFloor; list.innerHTML = "";
    if (!me) { const empty = document.createElement("div"); empty.className = "mb-small-note"; empty.textContent = "Current position unavailable."; list.appendChild(empty); return; }
    const getFloorOffset = (creature) => (creature.position?.z || 0) - me.z; const getFloorDistance = (creature) => Math.abs(getFloorOffset(creature));
    const visibleCreatures = creatures.filter((creature) => { const floor = creature?.position?.z; if (floor == null) return false; if (selectedFloor != null) return floor === selectedFloor; return floor !== me.z; }).sort((a, b) => { const floorDistanceDiff = getFloorDistance(a) - getFloorDistance(b); if (floorDistanceDiff !== 0) return floorDistanceDiff; const floorOffsetDiff = getFloorOffset(a) - getFloorOffset(b); if (floorOffsetDiff !== 0) return floorOffsetDiff; const aDist = Math.abs((a.position?.x || 0) - me.x) + Math.abs((a.position?.y || 0) - me.y); const bDist = Math.abs((b.position?.x || 0) - me.x) + Math.abs((b.position?.y || 0) - me.y); return aDist - bDist; });
    if (!visibleCreatures.length) { const empty = document.createElement("div"); empty.className = "mb-small-note"; empty.textContent = selectedFloor == null ? "No off-floor creatures." : `No creatures on floor ${selectedFloor}.`; list.appendChild(empty); return; }
    let currentFloor = null;
    visibleCreatures.forEach((creature) => { const floor = creature.position?.z; if (floor !== currentFloor) { currentFloor = floor; const floorOffset = me.z - floor; const floorOffsetLabel = floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`; const floorLabel = document.createElement("div"); floorLabel.className = "mb-floor-label"; floorLabel.textContent = floorOffsetLabel; list.appendChild(floorLabel); } const row = document.createElement("div"); row.className = "mb-creature-row"; const name = document.createElement("div"); name.className = "mb-creature-name"; name.textContent = creature.name || (creature.type === 0 ? "Player" : "Mob"); const meta = document.createElement("div"); meta.className = "mb-small-note"; meta.textContent = `${creature.type === 0 ? "Player" : "Mob"} at ${creature.position.x}, ${creature.position.y}, ${creature.position.z}`; row.appendChild(name); row.appendChild(meta); list.appendChild(row); });
  }

  const moduleCollapsedStorageKey = "minibiaBot.ui.moduleCollapsed";

  function getModuleCollapsedState() {
    return bot.storage.get(moduleCollapsedStorageKey, {}) || {};
  }

  function setModuleCollapsed(section, collapsed) {
    if (!section) return;
    const body = section.querySelector(":scope > .mb-module-body");
    if (body) {
      body.hidden = !!collapsed;
      body.style.setProperty("display", collapsed ? "none" : "", "important");
    }
    const bodyChildren = body
      ? []
      : Array.from(section.children).filter((child) => !child.classList.contains("mb-module-title"));
    const title = section.querySelector(".mb-module-title");
    const button = section.querySelector(".mb-module-collapse");
    const key = section.dataset.moduleCollapseKey || section.id || title?.textContent?.replace(/[+−]$/, "").trim();
    if (!key) return;
    const nextCollapsed = !!collapsed;
    section.dataset.moduleCollapsed = nextCollapsed ? "true" : "false";
    section.classList.toggle("mb-module-collapsed", nextCollapsed);
    bodyChildren.forEach((child) => {
      child.hidden = nextCollapsed;
      child.style.setProperty("display", nextCollapsed ? "none" : "", "important");
    });
    if (button) {
      button.textContent = nextCollapsed ? "+" : "−";
      button.setAttribute("aria-label", nextCollapsed ? "Expand module" : "Collapse module");
      button.setAttribute("title", nextCollapsed ? "Expand module" : "Collapse module");
    }
    const state = getModuleCollapsedState();
    state[key] = nextCollapsed;
    bot.storage.set(moduleCollapsedStorageKey, state);
  }

  function ensureModuleCollapseControl(section) {
    if (!section || section.id === "minibia-bot-panel" || section.dataset.moduleCollapseReady === "1") return;
    if (!section.classList.contains("mb-section")) return;
    const title = section.querySelector(":scope > .mb-label, :scope > .mb-section-title");
    if (!title) return;
    section.dataset.moduleCollapseReady = "1";
    section.dataset.moduleCollapseKey = section.id || title.textContent.trim();
    title.classList.add("mb-module-title");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mb-icon-button mb-module-collapse";
    button.textContent = "−";
    button.setAttribute("aria-label", "Collapse module");
    button.setAttribute("title", "Collapse module");
    title.style.display = "";
    title.style.alignItems = "";
    title.style.justifyContent = "";
    title.style.gap = "";
    const titleBar = document.createElement("div");
    titleBar.className = "mb-module-titlebar";
    title.parentNode.insertBefore(titleBar, title);
    titleBar.appendChild(title);
    titleBar.appendChild(button);

    const existingBody = section.querySelector(":scope > .mb-module-body");
    if (!existingBody) {
      const moduleBody = document.createElement("div");
      moduleBody.className = "mb-module-body";
      const children = Array.from(section.children).filter((child) => child !== title);
      children.forEach((child) => moduleBody.appendChild(child));
      section.appendChild(moduleBody);
    }

    const toggleModule = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const nextCollapsed = section.dataset.moduleCollapsed !== "true";
      const body = section.querySelector(":scope > .mb-module-body");
      section.dataset.moduleCollapsed = nextCollapsed ? "true" : "false";
      section.classList.toggle("mb-module-collapsed", nextCollapsed);
      if (body) {
        body.hidden = nextCollapsed;
        body.style.display = nextCollapsed ? "none" : "block";
      }
      button.textContent = nextCollapsed ? "+" : "−";
      button.setAttribute("aria-label", nextCollapsed ? "Expand module" : "Collapse module");
      button.setAttribute("title", nextCollapsed ? "Expand module" : "Collapse module");
      const state = getModuleCollapsedState();
      state[section.dataset.moduleCollapseKey] = nextCollapsed;
      bot.storage.set(moduleCollapsedStorageKey, state);
      return false;
    };
    button.onclick = toggleModule;
    button.ontouchend = toggleModule;
    button.onmouseup = toggleModule;
    button.onpointerdown = (event) => {
      event.stopPropagation();
    };
    button.onmousedown = (event) => {
      event.stopPropagation();
    };
    const saved = !!getModuleCollapsedState()[section.dataset.moduleCollapseKey];
    setModuleCollapsed(section, saved);
  }

  function ensureAllModuleCollapseControls(panel) {
    if (!panel) return;
    panel.querySelectorAll(".mb-section").forEach((section) => {
      ensureModuleCollapseControl(section);
      if (section.dataset.moduleCollapsed === "true") {
        const body = section.querySelector(":scope > .mb-module-body");
        if (body) {
          body.hidden = true;
          body.style.setProperty("display", "none", "important");
        }
      }
    });
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return; const body = panel.querySelector(".mb-body"); const toggle = panel.querySelector("#minibia-bot-collapse"); const nextCollapsed = !!collapsed; panel.dataset.collapsed = nextCollapsed ? "true" : "false"; if (body) body.hidden = nextCollapsed; if (toggle) { toggle.textContent = nextCollapsed ? "+" : "−"; toggle.setAttribute("aria-label", nextCollapsed ? "Maximize panel" : "Minimize panel"); toggle.setAttribute("title", nextCollapsed ? "Maximize" : "Minimize"); } savePanelCollapsed(nextCollapsed); if (!nextCollapsed) { refreshXrayStatus(); refreshVisibleCreatures(); refreshTalkStatus(); refreshCaveStatus(); refreshCavePresetControls(); refreshCaveClosestStatus(); refreshCaveTransitionStatus(); refreshCavePathfinderMode(); refreshDebugStatus(); }
  }

  function applySavedPanelPosition(panel, key = panelPositionKey) { const position = getSavedPanelPosition(key); if (!position) return; if (typeof position.top === "number") panel.style.top = `${position.top}px`; if (typeof position.left === "number") { panel.style.left = `${position.left}px`; panel.style.right = "auto"; } }
  function clampPanelPosition(panel, left, top) { const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth); const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight); return { left: Math.min(Math.max(0, left), maxLeft), top: Math.min(Math.max(0, top), maxTop) }; }
  function enableDrag(panel, key = panelPositionKey) { const handle = panel.querySelector(".mb-title"); if (!handle) return; let dragState = null; const onMouseMove = (event) => { if (!dragState) return; const next = clampPanelPosition(panel, event.clientX - dragState.offsetX, event.clientY - dragState.offsetY); panel.style.left = `${next.left}px`; panel.style.top = `${next.top}px`; panel.style.right = "auto"; }; const onMouseUp = () => { if (!dragState) return; dragState = null; const rect = panel.getBoundingClientRect(); savePanelPosition({ left: rect.left, top: rect.top }, key); }; handle.addEventListener("mousedown", (event) => { if (event.button !== 0) return; const rect = panel.getBoundingClientRect(); dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }; event.preventDefault(); }); window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp); bot.addCleanup(() => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); }); }

  function inject() {
    destroy();
    const style = document.createElement("style"); style.id = "minibia-bot-style"; style.textContent = `#minibia-bot-panel{position:fixed;z-index:999999;max-width:calc(100vw - 32px);padding:12px;border:1px solid rgba(224,200,148,.45);border-radius:10px;background:linear-gradient(180deg,rgba(30,23,15,.95),rgba(15,11,8,.97));box-shadow:0 8px 24px rgba(0,0,0,.35);color:#f1e2b8;font:12px/1.35 Verdana,sans-serif;user-select:none;top:16px;right:16px;width:960px}#minibia-bot-panel[data-collapsed="true"]{width:220px}#minibia-bot-panel .mb-title{margin:0;font-weight:700;letter-spacing:.04em;text-transform:uppercase;cursor:move}#minibia-bot-panel .mb-version{font-size:.7em;font-weight:400;opacity:.55;margin-left:6px;text-transform:none;letter-spacing:0;cursor:default;user-select:text}#minibia-bot-panel .mb-titlebar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}#minibia-bot-panel .mb-icon-button{width:24px;min-width:24px;padding:2px 0;border-radius:6px;font-weight:700;line-height:1}#minibia-bot-panel[data-collapsed="true"] .mb-titlebar{margin-bottom:0}#minibia-bot-panel .mb-body{display:grid;grid-template-columns:minmax(0,1fr) 280px 240px;gap:12px;align-items:start}#minibia-bot-panel .mb-body[hidden]{display:none!important}#minibia-bot-panel .mb-side-column,#minibia-bot-panel .mb-main-column,#minibia-bot-panel .mb-cave-column{display:grid;gap:10px}#minibia-bot-panel .mb-section{padding:10px;border:1px solid rgba(224,200,148,.18);border-radius:8px;background:rgba(255,255,255,.025)}#minibia-bot-panel .mb-module-title{display:block}#minibia-bot-panel .mb-module-titlebar{display:flex;align-items:center;justify-content:space-between;gap:6px}#minibia-bot-panel .mb-module-titlebar .mb-label{margin-bottom:0}
.mb-section.mb-module-collapsed > :not(.mb-module-titlebar):not(.mb-module-body){display:none !important;visibility:hidden !important;height:0 !important;min-height:0 !important;max-height:0 !important;overflow:hidden !important;margin:0 !important;padding:0 !important;}#minibia-bot-panel .mb-module-collapse{margin-left:auto;cursor:pointer}#minibia-bot-panel .mb-label{margin-bottom:7px;font-weight:700;color:#f8dc96}#minibia-bot-panel .mb-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}#minibia-bot-panel .mb-stack{display:grid;gap:7px}#minibia-bot-panel .mb-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}#minibia-bot-panel .mb-field{display:grid;gap:3px}#minibia-bot-panel .mb-field-label,#minibia-bot-panel .mb-small-note{font-size:11px;color:rgba(241,226,184,.74)}#minibia-bot-panel input,#minibia-bot-panel select,#minibia-bot-panel textarea,#minibia-bot-panel button{box-sizing:border-box;border:1px solid rgba(224,200,148,.35);border-radius:6px;background:rgba(20,15,10,.92);color:#f1e2b8;font:inherit}#minibia-bot-panel input,#minibia-bot-panel select,#minibia-bot-panel textarea{width:100%;min-width:0;padding:5px 6px}#minibia-bot-panel button{cursor:pointer;padding:5px 8px}#minibia-bot-panel button:disabled{cursor:not-allowed;opacity:.45}#minibia-bot-panel textarea{min-height:64px;resize:vertical}#minibia-bot-panel .mb-toggle{display:flex;align-items:center;gap:7px}#minibia-bot-panel .mb-toggle input{width:auto}#minibia-bot-panel .mb-list{display:grid;gap:5px}#minibia-bot-panel .mb-list-row,#minibia-bot-panel .mb-creature-row{display:flex;align-items:center;justify-content:space-between;gap:8px}#minibia-bot-panel .mb-creature-row{align-items:flex-start}#minibia-bot-panel .mb-creature-name{font-weight:700}#minibia-bot-panel .mb-floor-label{margin-top:5px;padding-top:5px;border-top:1px solid rgba(224,200,148,.2);font-weight:700;color:#f8dc96}#minibia-bot-panel .mb-small-button{padding:2px 6px}@media(max-width:980px){#minibia-bot-panel{width:calc(100vw - 32px)}#minibia-bot-panel .mb-body{grid-template-columns:1fr;max-height:calc(100vh - 100px);overflow-y:auto}}`; document.head.appendChild(style);

    const panel = document.createElement("div"); panel.id = "minibia-bot-panel"; panel.innerHTML = `<div class="mb-titlebar"><div class="mb-title">Minibia Bot <span class="mb-version">${bot.version || "dev"}</span></div><button type="button" class="mb-icon-button" id="minibia-bot-collapse" aria-label="Minimize panel" title="Minimize">−</button></div><div class="mb-body"><div class="mb-main-column"><div class="mb-section"><div class="mb-label">Auto Heal</div><div class="mb-stack"><label class="mb-field"><span class="mb-field-label">Minimum HP</span><input type="number" id="minibia-bot-auto-heal-min-hp" min="0" /></label><label class="mb-field"><span class="mb-field-label">HP Hotkey</span><input type="number" id="minibia-bot-auto-heal-hp-hotkey" min="1" max="12" /></label><label class="mb-field"><span class="mb-field-label">Minimum Mana</span><input type="number" id="minibia-bot-auto-heal-min-mana" min="0" /></label><label class="mb-field"><span class="mb-field-label">Mana Hotkey</span><input type="number" id="minibia-bot-auto-heal-mana-hotkey" min="1" max="12" /></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-heal-enabled" /><span>Enable Auto Heal</span></label></div></div><div class="mb-section"><div class="mb-label">Auto Attack</div><div class="mb-stack"><label class="mb-field"><span class="mb-field-label">Rune Hotkey</span><input type="number" id="minibia-bot-auto-attack-rune-hotkey" min="1" max="12" placeholder="Optional" /></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-attack-enabled" /><span>Enable Auto Attack</span></label></div></div><div class="mb-section"><div class="mb-label">Cavebot</div><div class="mb-stack"><div class="mb-row"><button type="button" id="minibia-bot-cave-add">Add Waypoint</button><button type="button" id="minibia-bot-cave-clear">Clear</button><button type="button" id="minibia-bot-cave-start">Start</button><button type="button" id="minibia-bot-cave-stop">Stop</button></div><div class="mb-small-note" id="minibia-bot-cave-status">Status: idle</div><div class="mb-small-note" id="minibia-bot-cave-closest">Closest start: unavailable</div><div class="mb-small-note" id="minibia-bot-cave-transition-status">Transitions learned: none</div><label class="mb-field"><span class="mb-field-label">Waypoint Action</span><select id="minibia-bot-cave-waypoint-action"><option value="walk">Walk</option><option value="rope">Use Rope</option><option value="ropeSpell">Rope Spell (Exani Tera)</option><option value="haste">Haste Waypoint</option><option value="shovel">Use Shovel</option><option value="wait">Waypoint Wait (1 Minute)</option></select></label><label class="mb-field" id="minibia-bot-cave-haste-spell-field" style="display:none"><span class="mb-field-label">Haste Spell</span><input type="text" id="minibia-bot-cave-haste-spell" placeholder="Enter spell, e.g. utani hur" autocomplete="off" /></label><label class="mb-field"><span class="mb-field-label">Pathfinder Mode</span><select id="minibia-bot-cave-pathfinder-mode"><option value="game">Game</option><option value="direct">Direct</option><option value="smartA">Smart A</option><option value="smartAField">Smart A + Field Crossing</option><option value="arrow">Arrow / D-pad</option></select></label><label class="mb-field"><span class="mb-field-label">Preset</span><select id="minibia-bot-cave-preset-select"></select></label><div class="mb-row"><button type="button" id="minibia-bot-cave-preset-save">Save Preset</button><button type="button" id="minibia-bot-cave-preset-load">Load Preset</button><button type="button" id="minibia-bot-cave-preset-delete">Delete Preset</button></div><div class="mb-small-note" id="minibia-bot-cave-preset-status">Preset: Default</div></div></div></div><div class="mb-cave-column"><div class="mb-section"><div class="mb-label">Safety</div><div class="mb-stack"><div class="mb-small-note" id="minibia-bot-home">Panic Runner Home: not set</div><button type="button" id="minibia-bot-set-home">Set Home Here</button><label class="mb-toggle"><input type="checkbox" id="minibia-bot-panic-unknown" /><span>Panic on unknown player</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-panic-health" /><span>Panic on health loss</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-panic-return" /><span>Return after panic</span></label><div class="mb-field"><span class="mb-field-label">Trusted Names</span><div class="mb-row"><input type="text" id="minibia-bot-panic-trusted-input" placeholder="Name" /><button type="button" id="minibia-bot-panic-trusted-add">Add</button></div><div class="mb-list" id="minibia-bot-panic-trusted-list"></div></div><div class="mb-field"><span class="mb-field-label">Game Master Names</span><div class="mb-row"><input type="text" id="minibia-bot-panic-gm-input" placeholder="Name" /><button type="button" id="minibia-bot-panic-gm-add">Add</button></div><div class="mb-list" id="minibia-bot-panic-gm-list"></div></div></div></div><div class="mb-section"><div class="mb-label">Quick Controls</div><div class="mb-stack"><label class="mb-toggle"><input type="checkbox" id="minibia-bot-rune-enabled" /><span>Enable Rune Maker</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-eat-enabled" /><span>Enable Auto Eat</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-invisible-enabled" /><span>Enable Auto Invisible</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-auto-magic-shield-enabled" /><span>Enable Auto Magic Shield</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-equip-ring-enabled" /><span>Enable Equip Ring</span></label></div></div><div class="mb-section"><div class="mb-label">Talk</div><div class="mb-stack"><label class="mb-field"><span class="mb-field-label">API Key</span><input type="password" id="minibia-bot-talk-api-key" autocomplete="off" /></label><label class="mb-field"><span class="mb-field-label">System Prompt</span><textarea id="minibia-bot-talk-prompt"></textarea></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-talk-enabled" /><span>Enable Talk Assistant</span></label><div class="mb-small-note" id="minibia-bot-talk-status">Status: idle</div></div></div><div class="mb-section"><div class="mb-label">Debug</div><div class="mb-stack"><label class="mb-toggle"><input type="checkbox" id="minibia-bot-debug-enabled" /><span>Enable Debug Logs</span></label><div class="mb-small-note" id="minibia-bot-debug-count">0 log entries</div><div class="mb-row"><button type="button" id="minibia-bot-debug-download">Download Logs</button><button type="button" id="minibia-bot-debug-clear">Clear Logs</button></div></div></div></div><div class="mb-side-column"><div class="mb-section"><div class="mb-label">X-Ray</div><div class="mb-stack"><div class="mb-row"><button type="button" id="minibia-bot-xray-overlay-toggle">Enable Overlay</button><span class="mb-small-note" id="minibia-bot-xray-overlay-status">Overlay: off</span></div><label class="mb-field"><span class="mb-field-label">Floor</span><select id="minibia-bot-xray-floor-select"><option value="all">All floors</option></select></label><div class="mb-list" id="minibia-bot-visible-creatures-list"></div></div></div></div></div>`;
    document.body.appendChild(panel);
    ensureAllModuleCollapseControls(panel);
    const moduleCollapseObserver = new MutationObserver(() => ensureAllModuleCollapseControls(panel));
    moduleCollapseObserver.observe(panel, { childList: true, subtree: true });
    panel.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest(".mb-module-collapse") : null;
      if (!target || !panel.contains(target)) return;
      const section = target.closest(".mb-section");
      if (!section) return;
      event.preventDefault();
      event.stopPropagation();
      setModuleCollapsed(section, section.dataset.moduleCollapsed !== "true");
    }, true);

    panel.querySelectorAll(".mb-module-collapse").forEach((button) => {
      if (button.dataset.moduleCollapseBound === "1") return;
      button.dataset.moduleCollapseBound = "1";
      button.style.pointerEvents = "auto";
      button.style.cursor = "pointer";
      button.style.position = "relative";
      button.style.zIndex = "10";
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      button.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const section = button.closest(".mb-section");
        if (!section) return;
        setModuleCollapsed(section, section.dataset.moduleCollapsed !== "true");
      });
    });
    bot.addCleanup(() => {
      moduleCollapseObserver.disconnect();
    });
    applySavedPanelPosition(panel); setPanelCollapsed(panel, getSavedPanelCollapsed()); enableDrag(panel);

    const q = (id) => panel.querySelector(id);
    q("#minibia-bot-collapse")?.addEventListener("click", () => setPanelCollapsed(panel, panel.dataset.collapsed !== "true"));
    const panicTrustedInput=q("#minibia-bot-panic-trusted-input"),panicTrustedAddButton=q("#minibia-bot-panic-trusted-add"),panicGmInput=q("#minibia-bot-panic-gm-input"),panicGmAddButton=q("#minibia-bot-panic-gm-add"),runeEnabledInput=q("#minibia-bot-rune-enabled"),autoEatEnabledInput=q("#minibia-bot-auto-eat-enabled"),autoInvisibleEnabledInput=q("#minibia-bot-auto-invisible-enabled"),autoMagicShieldEnabledInput=q("#minibia-bot-auto-magic-shield-enabled"),equipRingEnabledInput=q("#minibia-bot-equip-ring-enabled"),caveAddButton=q("#minibia-bot-cave-add"),caveClearButton=q("#minibia-bot-cave-clear"),caveStartButton=q("#minibia-bot-cave-start"),caveStopButton=q("#minibia-bot-cave-stop"),cavePresetSelect=q("#minibia-bot-cave-preset-select"),cavePresetSaveButton=q("#minibia-bot-cave-preset-save"),cavePresetLoadButton=q("#minibia-bot-cave-preset-load"),cavePresetDeleteButton=q("#minibia-bot-cave-preset-delete"),cavePathfinderModeSelect=q("#minibia-bot-cave-pathfinder-mode"),debugEnabledInput=q("#minibia-bot-debug-enabled"),debugLogsDownloadButton=q("#minibia-bot-debug-download"),debugLogsClearButton=q("#minibia-bot-debug-clear"),autoHealMinHpInput=q("#minibia-bot-auto-heal-min-hp"),autoHealHpHotkeyInput=q("#minibia-bot-auto-heal-hp-hotkey"),autoHealMinManaInput=q("#minibia-bot-auto-heal-min-mana"),autoHealManaHotkeyInput=q("#minibia-bot-auto-heal-mana-hotkey"),autoHealEnabledInput=q("#minibia-bot-auto-heal-enabled"),autoAttackHotkeyInput=q("#minibia-bot-auto-attack-hotkey"),autoAttackRuneHotkeyInput=q("#minibia-bot-auto-attack-rune-hotkey"),autoAttackEnabledInput=q("#minibia-bot-auto-attack-enabled"),talkApiKeyInput=q("#minibia-bot-talk-api-key"),talkPromptInput=q("#minibia-bot-talk-prompt"),talkEnabledInput=q("#minibia-bot-talk-enabled"),panicUnknownInput=q("#minibia-bot-panic-unknown"),panicHealthInput=q("#minibia-bot-panic-health"),panicReturnInput=q("#minibia-bot-panic-return"),xrayOverlayButton=q("#minibia-bot-xray-overlay-toggle"),xrayFloorSelect=q("#minibia-bot-xray-floor-select");
    panicTrustedAddButton?.addEventListener("click",()=>{const name=panicTrustedInput?.value?.trim();if(!name)return;const names=bot.panic?.config?.trustedNames||[];bot.panic.updateConfig({trustedNames:Array.from(new Set([...names,name]))});panicTrustedInput.value="";renderTrustedNames();});
    panicGmAddButton?.addEventListener("click",()=>{const name=panicGmInput?.value?.trim();if(!name)return;const names=bot.panic?.config?.gameMasterNames||[];bot.panic.updateConfig({gameMasterNames:Array.from(new Set([...names,name]))});panicGmInput.value="";renderGameMasterNames();});
    runeEnabledInput?.addEventListener("change",()=>{runeEnabledInput.checked?bot.rune.start():bot.rune.stop();refreshRuneStatus();}); autoEatEnabledInput?.addEventListener("change",()=>{autoEatEnabledInput.checked?bot.eat.start():bot.eat.stop();refreshAutoEatStatus();}); autoInvisibleEnabledInput?.addEventListener("change",()=>{autoInvisibleEnabledInput.checked?bot.invisible.start():bot.invisible.stop();refreshAutoInvisibleStatus();}); autoMagicShieldEnabledInput?.addEventListener("change",()=>{autoMagicShieldEnabledInput.checked?bot.magicShield.start():bot.magicShield.stop();refreshAutoMagicShieldStatus();}); equipRingEnabledInput?.addEventListener("change",()=>{equipRingEnabledInput.checked?bot.ring.start():bot.ring.stop();refreshEquipRingStatus();});
    caveAddButton?.addEventListener("click",()=>{bot.cave.addCurrentPosition();refreshCaveStatus();refreshCaveClosestStatus();}); caveClearButton?.addEventListener("click",()=>{bot.cave.clearRoute();refreshCaveStatus();refreshCaveClosestStatus();}); caveStartButton?.addEventListener("click",()=>{bot.cave.start();refreshCaveStatus();}); caveStopButton?.addEventListener("click",()=>{bot.cave.stop();refreshCaveStatus();}); cavePresetSaveButton?.addEventListener("click",()=>{const name=window.prompt("Preset name",bot.cave?.getActivePresetName?.()||"Default");if(!name)return;bot.cave.savePreset(name);refreshCavePresetControls();}); cavePresetLoadButton?.addEventListener("click",()=>{if(!cavePresetSelect?.value)return;bot.cave.loadPreset(cavePresetSelect.value);refreshCaveStatus();refreshCavePresetControls();refreshCaveClosestStatus();}); cavePresetDeleteButton?.addEventListener("click",()=>{if(!cavePresetSelect?.value)return;bot.cave.deletePreset(cavePresetSelect.value);refreshCaveStatus();refreshCavePresetControls();refreshCaveClosestStatus();}); cavePathfinderModeSelect?.addEventListener("change",()=>{bot.cave?.updateConfig?.({pathfinderMode:cavePathfinderModeSelect.value});refreshCavePathfinderMode();});
    debugEnabledInput?.addEventListener("change",()=>{bot.logger.setDebugEnabled(debugEnabledInput.checked);if(debugEnabledInput.checked)bot.log("debug mode enabled");refreshDebugStatus();}); debugLogsDownloadButton?.addEventListener("click",()=>bot.logger.downloadLogs()); debugLogsClearButton?.addEventListener("click",()=>{bot.logger.clear();refreshDebugStatus();});
    if(autoHealMinHpInput){autoHealMinHpInput.value=String(bot.heal?.config?.minHp??0);autoHealMinHpInput.addEventListener("change",()=>{const v=Math.max(0,Number(autoHealMinHpInput.value)||0);autoHealMinHpInput.value=String(v);bot.heal.updateConfig({minHp:v});});} if(autoHealHpHotkeyInput){autoHealHpHotkeyInput.value=String(bot.heal?.config?.hpHotbarSlot??1);autoHealHpHotkeyInput.addEventListener("change",()=>{const v=Math.min(12,Math.max(1,Number(autoHealHpHotkeyInput.value)||1));autoHealHpHotkeyInput.value=String(v);bot.heal.updateConfig({hpHotbarSlot:v});});} if(autoHealMinManaInput){autoHealMinManaInput.value=String(bot.heal?.config?.minMana??0);autoHealMinManaInput.addEventListener("change",()=>{const v=Math.max(0,Number(autoHealMinManaInput.value)||0);autoHealMinManaInput.value=String(v);bot.heal.updateConfig({minMana:v});});} if(autoHealManaHotkeyInput){autoHealManaHotkeyInput.value=String(bot.heal?.config?.manaHotbarSlot??1);autoHealManaHotkeyInput.addEventListener("change",()=>{const v=Math.min(12,Math.max(1,Number(autoHealManaHotkeyInput.value)||1));autoHealManaHotkeyInput.value=String(v);bot.heal.updateConfig({manaHotbarSlot:v});});}
    autoHealEnabledInput&&(autoHealEnabledInput.checked=!!bot.heal?.status?.().running,autoHealEnabledInput.addEventListener("change",()=>{const minHp=Math.max(0,Number(autoHealMinHpInput?.value)||bot.heal.config.minHp||0),hpHotbarSlot=Math.min(12,Math.max(1,Number(autoHealHpHotkeyInput?.value)||bot.heal.config.hpHotbarSlot||1)),minMana=Math.max(0,Number(autoHealMinManaInput?.value)||bot.heal.config.minMana||0),manaHotbarSlot=Math.min(12,Math.max(1,Number(autoHealManaHotkeyInput?.value)||bot.heal.config.manaHotbarSlot||1));autoHealEnabledInput.checked?bot.heal.start({minHp,hpHotbarSlot,minMana,manaHotbarSlot}):bot.heal.stop();refreshAutoHealStatus();}));
    if(autoAttackHotkeyInput){autoAttackHotkeyInput.value=String(bot.attack?.config?.targetHotbarSlot??3);autoAttackHotkeyInput.addEventListener("change",()=>{const v=Math.min(12,Math.max(1,Number(autoAttackHotkeyInput.value)||1));autoAttackHotkeyInput.value=String(v);bot.attack.updateConfig({targetHotbarSlot:v});});} if(autoAttackRuneHotkeyInput){autoAttackRuneHotkeyInput.value=bot.attack?.config?.runeHotbarSlot?String(bot.attack.config.runeHotbarSlot):"";autoAttackRuneHotkeyInput.addEventListener("change",()=>{const raw=Number(autoAttackRuneHotkeyInput.value),v=Number.isFinite(raw)&&raw>=1&&raw<=12?Math.trunc(raw):null;autoAttackRuneHotkeyInput.value=v?String(v):"";bot.attack.updateConfig({runeHotbarSlot:v});});} autoAttackEnabledInput&&(autoAttackEnabledInput.checked=!!bot.attack?.status?.().running,autoAttackEnabledInput.addEventListener("change",()=>{const raw=Number(autoAttackRuneHotkeyInput?.value),runeHotbarSlot=Number.isFinite(raw)&&raw>=1&&raw<=12?Math.trunc(raw):(bot.attack.config.runeHotbarSlot??null);autoAttackEnabledInput.checked?bot.attack.start({runeHotbarSlot}):bot.attack.stop();refreshAutoAttackStatus();}));
    if(talkApiKeyInput){talkApiKeyInput.value=bot.talk?.config?.apiKey||"";talkApiKeyInput.addEventListener("change",()=>{bot.talk.updateConfig({apiKey:talkApiKeyInput.value.trim()});refreshTalkStatus();});} if(talkPromptInput){talkPromptInput.value=bot.talk?.config?.systemPrompt||"";talkPromptInput.addEventListener("change",()=>bot.talk.updateConfig({systemPrompt:talkPromptInput.value.trim()||bot.talk.config.systemPrompt||""}));} if(talkEnabledInput){talkEnabledInput.checked=!!bot.talk?.status?.().running;talkEnabledInput.addEventListener("change",()=>{if(talkEnabledInput.checked){bot.talk.updateConfig({apiKey:talkApiKeyInput?.value?.trim()||"",systemPrompt:talkPromptInput?.value?.trim()||bot.talk.config.systemPrompt||""});if(!bot.talk.start())talkEnabledInput.checked=false;}else bot.talk.stop();refreshTalkStatus();});}
    panicUnknownInput&&(panicUnknownInput.checked=!!bot.panic?.status?.().config?.unknownPlayerEnabled,panicUnknownInput.addEventListener("change",()=>{bot.panic.updateConfig({unknownPlayerEnabled:panicUnknownInput.checked});refreshPanicStatus();})); panicHealthInput&&(panicHealthInput.checked=!!bot.panic?.status?.().config?.healthLossEnabled,panicHealthInput.addEventListener("change",()=>{bot.panic.updateConfig({healthLossEnabled:panicHealthInput.checked});refreshPanicStatus();})); panicReturnInput&&(panicReturnInput.checked=!!bot.panic?.status?.().config?.returnToOriginEnabled,panicReturnInput.addEventListener("change",()=>{bot.panic.updateConfig({returnToOriginEnabled:panicReturnInput.checked});refreshPanicStatus();}));
    xrayOverlayButton?.addEventListener("click",()=>{const enabled=!!bot.xray?.status?.().config?.overlayEnabled;bot.xray?.setOverlayEnabled?.(!enabled);refreshXrayStatus();refreshVisibleCreatures();}); xrayFloorSelect?.addEventListener("change",()=>{const raw=xrayFloorSelect.value;bot.xray?.setSelectedFloor?.(raw==="all"?null:Number(raw));refreshXrayStatus();refreshVisibleCreatures();}); panel.querySelector("#minibia-bot-set-home")?.addEventListener("click",()=>{bot.pz.setHomePzCurrentSpot();refreshHomeLabel();});

    refreshHomeLabel();refreshPanicStatus();refreshXrayStatus();renderGameMasterNames();renderTrustedNames();refreshRuneStatus();refreshAutoHealStatus();refreshAutoInvisibleStatus();refreshAutoMagicShieldStatus();refreshAutoAttackStatus();refreshAutoEatStatus();refreshCaveStatus();refreshEquipRingStatus();refreshTalkStatus();refreshVisibleCreatures();refreshCavePresetControls();refreshCaveClosestStatus();refreshCaveTransitionStatus();refreshCavePathfinderMode();refreshDebugStatus();

    const talkStatusTimerId = window.setInterval(() => { if (!isPanelCollapsed()) refreshTalkStatus(); }, 1000); bot.addCleanup(() => window.clearInterval(talkStatusTimerId));
    const caveStatusTimerId = window.setInterval(() => { if (isPanelCollapsed()) return; refreshCaveStatus(); refreshCavePresetControls(); refreshCaveClosestStatus(); refreshCaveTransitionStatus(); refreshCavePathfinderMode(); refreshDebugStatus(); }, 1000); bot.addCleanup(() => window.clearInterval(caveStatusTimerId));
  }

  bot.ui = { inject,destroy,ensureAllModuleCollapseControls,refreshHomeLabel,refreshPanicStatus,refreshXrayStatus,refreshRuneStatus,refreshAutoHealStatus,refreshAutoInvisibleStatus,refreshAutoMagicShieldStatus,refreshAutoAttackStatus,refreshAutoEatStatus,refreshCaveStatus,refreshCavePresetControls,refreshEquipRingStatus,refreshTalkStatus,refreshVisibleCreatures,refreshCaveClosestStatus,refreshCaveTransitionStatus,getSavedPanelPosition,getSavedPanelCollapsed,setPanelCollapsed:(collapsed)=>{const panel=document.getElementById("minibia-bot-panel");setPanelCollapsed(panel,collapsed);} };
};
