window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installFireballModule = function installFireballModule(bot) {
  if (!bot || bot.fireball?.destroy) return bot?.fireball;

  const configStorageKey = "minibiaBot.fireball.config";
  const sectionId = "minibia-bot-fireball-section";
  const state = { running: false, timerId: null, uiTimerId: null, lastCastAt: 0, lastMonsterCount: 0, lastTargetName: "", lastTargetPosition: null, currentBest: null };
  const config = Object.assign({ enabled: false, highestPriority: false, hotbarSlot: null, minMonsters: 4, cooldownMs: 2000, scanMs: 250, maxRange: 7, respectTargetFilters: true }, bot.storage.get(configStorageKey, {}) || {});

  function normalizeHotbarSlot(value) { const slot = Math.trunc(Number(value)); return Number.isFinite(slot) && slot >= 1 && slot <= 12 ? slot : null; }
  function positiveInt(value, fallback) { const number = Math.trunc(Number(value)); return Number.isFinite(number) && number > 0 ? number : fallback; }
  function nonNegativeInt(value, fallback) { const number = Math.trunc(Number(value)); return Number.isFinite(number) && number >= 0 ? number : fallback; }
  function normalizeName(value) { return String(value || "").trim().toLowerCase(); }
  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) } : null;
  }
  function tileDistance(left, right) {
    if (!left || !right || Number(left.z) !== Number(right.z)) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(Number(left.x) - Number(right.x)), Math.abs(Number(left.y) - Number(right.y)));
  }
  function positionKey(position) { return position ? `${position.x},${position.y},${position.z}` : ""; }
  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }

  config.enabled = !!config.enabled;
  config.highestPriority = !!config.highestPriority;
  config.hotbarSlot = normalizeHotbarSlot(config.hotbarSlot);
  config.minMonsters = positiveInt(config.minMonsters, 4);
  config.cooldownMs = nonNegativeInt(config.cooldownMs, 2000);
  config.scanMs = Math.max(250, positiveInt(config.scanMs, 250));
  config.maxRange = Math.min(7, positiveInt(config.maxRange, 7));
  config.respectTargetFilters = config.respectTargetFilters !== false;

  function passesTargetFilters(monster) {
    if (!config.respectTargetFilters) return true;
    const attackConfig = bot.attack?.config || {};
    const mode = ["include", "exclude"].includes(attackConfig.targetFilterMode) ? attackConfig.targetFilterMode : "all";
    const name = normalizeName(monster?.name || "Mob");
    const included = new Set((attackConfig.includedCreatureNames || []).map(normalizeName));
    const excluded = new Set((attackConfig.excludedCreatureNames || []).map(normalizeName));
    if (excluded.has(name)) return false;
    if (mode === "include" && included.size) return included.has(name);
    return true;
  }

  function getVisibleMonsters() {
    return (bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || []).filter(passesTargetFilters);
  }

  function getFireballTiles(centerPosition) {
    if (!centerPosition) return [];
    const rowWidths = [1, 3, 5, 3, 1];
    const tiles = [];
    rowWidths.forEach((width, row) => {
      const half = Math.floor(width / 2);
      const yOffset = row - 2;
      for (let xOffset = -half; xOffset <= half; xOffset += 1) {
        tiles.push({ x: centerPosition.x + xOffset, y: centerPosition.y + yOffset, z: centerPosition.z });
      }
    });
    return tiles;
  }

  function evaluateAtPosition(centerPosition, monsters) {
    const tileKeys = new Set(getFireballTiles(centerPosition).map(positionKey));
    const hitMonsters = monsters.filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === centerPosition.z && tileKeys.has(positionKey(position));
    });
    return { position: centerPosition, count: hitMonsters.length, monsters: hitMonsters, target: hitMonsters[0] || null };
  }

  function calculateBestCandidate() {
    const playerPosition = getPosition(bot.getPlayerPosition?.());
    if (!playerPosition) return null;
    const monsters = getVisibleMonsters().filter((monster) => {
      const position = getPosition(monster);
      return position && position.z === playerPosition.z && tileDistance(playerPosition, position) <= config.maxRange;
    });
    if (!monsters.length) return null;

    const monsterPositions = new Map();
    monsters.forEach((monster) => {
      const position = getPosition(monster);
      if (position) monsterPositions.set(positionKey(position), position);
    });

    const candidates = new Map();
    monsterPositions.forEach((monsterPosition) => {
      getFireballTiles({ x: 0, y: 0, z: monsterPosition.z }).forEach((offsetTile) => {
        const center = { x: monsterPosition.x - offsetTile.x, y: monsterPosition.y - offsetTile.y, z: monsterPosition.z };
        if (tileDistance(playerPosition, center) > config.maxRange) return;
        if (!getTile(center)) return;
        candidates.set(positionKey(center), center);
      });
    });

    const evaluations = Array.from(candidates.values()).map((position) => ({ ...evaluateAtPosition(position, monsters), occupiedByMonster: monsterPositions.has(positionKey(position)) }));
    evaluations.sort((left, right) => right.count - left.count || Number(right.occupiedByMonster) - Number(left.occupiedByMonster) || tileDistance(playerPosition, left.position) - tileDistance(playerPosition, right.position));
    return evaluations[0] || null;
  }

  function getBestCandidate() { return state.running && config.enabled ? (state.currentBest || calculateBestCandidate()) : null; }
  function shouldReservePriority() {
    if (!state.running || !config.enabled || !config.highestPriority || !normalizeHotbarSlot(config.hotbarSlot)) return false;
    const best = state.currentBest || calculateBestCandidate();
    return !!best && best.count >= config.minMonsters;
  }
  function getSquare2Slot() {
    try { const saved = JSON.parse(window.localStorage.getItem("minibiaBot.attackAoe.square2.config") || "{}"); return normalizeHotbarSlot(saved.hotbarSlot); } catch (_) { return null; }
  }
  function getBlockedSlots() {
    const slots = new Set();
    [bot.attack?.config?.runeHotbarSlot, bot.attackAoe?.config?.spellHotbarSlot, getSquare2Slot(), bot.greatFireballV2?.config?.hotbarSlot].forEach((slot) => { const normalized = normalizeHotbarSlot(slot); if (normalized) slots.add(normalized); });
    return slots;
  }
  function patchClickHotbar() {
    if (!bot.clickHotbar || bot.__fireballPriorityPatched) return;
    const originalClickHotbar = bot.clickHotbar.bind(bot);
    bot.clickHotbar = function clickHotbarWithFireballPriority(index, ...args) {
      const attemptedSlot = Math.trunc(Number(index)) + 1;
      const fireballSlot = normalizeHotbarSlot(config.hotbarSlot);
      if (shouldReservePriority() && attemptedSlot !== fireballSlot && getBlockedSlots().has(attemptedSlot)) {
        bot.logDebug?.("blocked lower-priority cast for Fireball", { slot: attemptedSlot, fireballSlot });
        return false;
      }
      return originalClickHotbar(index, ...args);
    };
    bot.__fireballPriorityPatched = true;
  }

  function getTile(position) {
    if (!position) return null;
    try {
      const worldPosition = typeof Position === "function" ? new Position(position.x, position.y, position.z) : position;
      return window.gameClient?.world?.getTileFromWorldPosition?.(worldPosition) || null;
    } catch (_) { return null; }
  }

  function fireCrosshairAt(best, hotbarSlotOverride = null) {
    const slot = normalizeHotbarSlot(hotbarSlotOverride ?? config.hotbarSlot);
    if (!slot || !best?.position || !bot.clickHotbar?.(slot - 1)) return false;
    const tile = getTile(best.position);
    const target = best.target || best.monsters?.[0] || null;
    const mouse = window.gameClient?.mouse;
    const targetRef = tile ? { which: tile, index: 0xFF } : target ? { which: target, index: 0xFF } : null;
    try { if (targetRef && typeof mouse?.__handleItemUseWith === "function") { mouse.__handleItemUseWith(null, targetRef); return true; } } catch (_) {}
    try { if (targetRef && typeof mouse?.__handleThingUse === "function") { mouse.__handleThingUse(targetRef); return true; } } catch (_) {}
    try { if (tile && typeof mouse?.__handleTileClick === "function") { mouse.__handleTileClick(tile); return true; } } catch (_) {}
    try { if (target && typeof mouse?.__handleCreatureClick === "function") { mouse.__handleCreatureClick(target); return true; } } catch (_) {}
    bot.log("fireball could not click crosshair target", { position: best.position, target: target?.name || "Mob" });
    return false;
  }

  function canCast(now = Date.now(), best = state.currentBest) {
    if (!state.running || !config.enabled || !normalizeHotbarSlot(config.hotbarSlot)) return false;
    if (now - state.lastCastAt < config.cooldownMs) return false;
    return !!best && best.count >= config.minMonsters;
  }

  function trigger(now = Date.now()) {
    if (!state.running || !config.enabled) return false;
    const best = state.currentBest || calculateBestCandidate();
    state.currentBest = best;
    if (!canCast(now, best)) return false;
    const gfbPriority = bot.greatFireballV2;
    if (gfbPriority?.shouldReservePriority?.()) {
      bot.logDebug?.("blocked Fireball cast by GFB Highest Priority", { fireballSlot: config.hotbarSlot, gfbSlot: gfbPriority.config?.hotbarSlot, monsterCount: best?.count || 0 });
      refreshUi();
      return false;
    }
    const fired = fireCrosshairAt(best);
    if (fired) {
      state.lastCastAt = now;
      state.lastMonsterCount = best.count;
      state.lastTargetName = best.target?.name || best.monsters?.[0]?.name || "Mob";
      state.lastTargetPosition = best.position;
      bot.log("used fireball at biggest diamond-pattern group", { slot: config.hotbarSlot, monsterCount: best.count, target: state.lastTargetName, position: best.position, minimum: config.minMonsters });
    }
    refreshUi();
    return fired;
  }

  function tick() {
    if (!state.running || !config.enabled) return;
    try { state.currentBest = calculateBestCandidate(); trigger(); } catch (error) { bot.log("fireball tick failed", error?.message || error); }
    if (state.running && config.enabled) state.timerId = window.setTimeout(tick, config.scanMs);
  }

  function stopUiTimer() { if (state.uiTimerId != null) window.clearInterval(state.uiTimerId); state.uiTimerId = null; }
  function startUiTimer() {
    if (!state.running || !config.enabled || state.uiTimerId != null) return;
    state.uiTimerId = window.setInterval(refreshUi, 1000);
  }
  function start(overrides = {}) {
    updateConfig({ ...overrides, enabled: true }, { silent: true });
    if (state.running) { startUiTimer(); return false; }
    state.running = true;
    state.currentBest = null;
    tick();
    startUiTimer();
    refreshUi();
    return true;
  }
  function stop(options = {}) {
    state.running = false;
    state.currentBest = null;
    if (state.timerId != null) window.clearTimeout(state.timerId);
    state.timerId = null;
    stopUiTimer();
    if (options.persistEnabled !== false) { config.enabled = false; persistConfig(); }
    refreshUi();
    return true;
  }
  function updateConfig(nextConfig = {}, options = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "enabled")) nextConfig.enabled = !!nextConfig.enabled;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "highestPriority")) nextConfig.highestPriority = !!nextConfig.highestPriority;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hotbarSlot")) nextConfig.hotbarSlot = normalizeHotbarSlot(nextConfig.hotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMonsters")) nextConfig.minMonsters = positiveInt(nextConfig.minMonsters, config.minMonsters || 4);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "cooldownMs")) nextConfig.cooldownMs = nonNegativeInt(nextConfig.cooldownMs, config.cooldownMs || 2000);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "scanMs")) nextConfig.scanMs = Math.max(250, positiveInt(nextConfig.scanMs, config.scanMs || 250));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxRange")) nextConfig.maxRange = Math.min(7, positiveInt(nextConfig.maxRange, config.maxRange || 7));
    if (Object.prototype.hasOwnProperty.call(nextConfig, "respectTargetFilters")) nextConfig.respectTargetFilters = nextConfig.respectTargetFilters !== false;
    Object.assign(config, nextConfig);
    persistConfig();
    if (!config.enabled) { state.currentBest = null; stopUiTimer(); } else if (state.running) { startUiTimer(); }
    if (!options.silent) refreshUi();
    return { ...config };
  }
  function status() {
    const best = state.running && config.enabled ? (state.currentBest || calculateBestCandidate()) : null;
    return { running: state.running, config: { ...config }, bestMonsterCount: best?.count || 0, bestTargetName: best?.target?.name || "", bestTargetPosition: best?.position || null, lastMonsterCount: state.lastMonsterCount, lastTargetName: state.lastTargetName, lastTargetPosition: state.lastTargetPosition, priorityReserved: shouldReservePriority(), ready: canCast(Date.now(), best) };
  }

  function ensureUi() {
    const aoeSection = document.getElementById("minibia-bot-auto-attack-aoe-section");
    if (!aoeSection) return false;
    if (document.getElementById(sectionId)) return true;
    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section";
    section.innerHTML = `<div class="mb-label">Fireball — Crosshairs</div><label class="mb-toggle"><input type="checkbox" id="minibia-bot-fireball-enabled" /><span>Enable Fireball</span></label><label class="mb-toggle"><input type="checkbox" id="minibia-bot-fireball-highest-priority" /><span>Fireball Highest Priority</span></label><div class="mb-field-grid"><label class="mb-field"><span class="mb-field-label">Fireball Hotkey</span><input type="number" id="minibia-bot-fireball-hotkey" min="1" max="12" placeholder="8" /></label><label class="mb-field"><span class="mb-field-label">Minimum Creatures</span><input type="number" id="minibia-bot-fireball-monsters" min="1" placeholder="4" /></label><label class="mb-field"><span class="mb-field-label">Cooldown MS</span><input type="number" id="minibia-bot-fireball-cooldown" min="0" placeholder="2000" /></label></div><div class="mb-small-note">Uses the 13-tile Fireball diamond pattern: 1 / 3 / 5 / 3 / 1. Highest Priority blocks other configured AOE/rune hotkeys while enough creatures are inside that pattern, including while Fireball is cooling down.</div><div class="mb-small-note">Set the Fireball hotkey to Use with Crosshairs. The bot checks monster and empty ground centers, then shoots whichever tile hits the biggest group.</div><div class="mb-small-note" id="minibia-bot-fireball-status">Fireball: off</div>`;

    const gfbV2Section = document.getElementById("minibia-bot-gfb-v2-section");
    if (gfbV2Section?.parentElement) gfbV2Section.insertAdjacentElement("afterend", section);
    else aoeSection.querySelector(".mb-stack")?.appendChild(section);
    const enabled = section.querySelector("#minibia-bot-fireball-enabled");
    const priority = section.querySelector("#minibia-bot-fireball-highest-priority");
    const hotkey = section.querySelector("#minibia-bot-fireball-hotkey");
    const monsters = section.querySelector("#minibia-bot-fireball-monsters");
    const cooldown = section.querySelector("#minibia-bot-fireball-cooldown");
    enabled?.addEventListener("change", () => enabled.checked ? start() : stop());
    priority?.addEventListener("change", () => updateConfig({ highestPriority: priority.checked }));
    hotkey?.addEventListener("change", () => updateConfig({ hotbarSlot: hotkey.value }));
    monsters?.addEventListener("change", () => updateConfig({ minMonsters: monsters.value }));
    cooldown?.addEventListener("change", () => updateConfig({ cooldownMs: cooldown.value }));
    refreshUi();
    return true;
  }

  function refreshUi() {
    const enabled = document.getElementById("minibia-bot-fireball-enabled");
    const priority = document.getElementById("minibia-bot-fireball-highest-priority");
    const hotkey = document.getElementById("minibia-bot-fireball-hotkey");
    const monsters = document.getElementById("minibia-bot-fireball-monsters");
    const cooldown = document.getElementById("minibia-bot-fireball-cooldown");
    const statusLabel = document.getElementById("minibia-bot-fireball-status");
    const best = state.running && config.enabled ? (state.currentBest || calculateBestCandidate()) : null;
    if (enabled) enabled.checked = !!state.running;
    if (priority) priority.checked = !!config.highestPriority;
    if (hotkey && document.activeElement !== hotkey) hotkey.value = config.hotbarSlot || "";
    if (monsters && document.activeElement !== monsters) monsters.value = config.minMonsters;
    if (cooldown && document.activeElement !== cooldown) cooldown.value = config.cooldownMs;
    if (statusLabel) statusLabel.textContent = state.running ? `Fireball: biggest group ${best?.count || 0}/${config.minMonsters}${shouldReservePriority() ? " PRIORITY" : ""}` : "Fireball: off";
  }

  function destroy() {
    stop({ persistEnabled: false });
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    document.getElementById(sectionId)?.remove();
  }

  patchClickHotbar();
  bot.fireball = { start, stop, trigger, status, updateConfig, shouldReservePriority, getBestCandidate, evaluateAtPosition, getFireballTiles, fireCrosshairAt, destroy, config };
  bot.addCleanup(destroy);
  if (!ensureUi()) {
    let attempts = 0;
    state.uiTimerId = window.setInterval(() => {
      attempts += 1;
      if (ensureUi() || attempts >= 40) {
        window.clearInterval(state.uiTimerId);
        state.uiTimerId = null;
        if (state.running && config.enabled) startUiTimer();
      }
    }, 250);
  }
  if (config.enabled) start();
  return bot.fireball;
};