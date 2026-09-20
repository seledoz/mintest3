window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function cleanStaleCaveArrowPathfinder() {
  const pathfinder = window.gameClient?.world?.pathfinder;
  if (!pathfinder || typeof pathfinder.findPath !== "function") return;
  let findPath = pathfinder.findPath;
  for (let depth = 0; depth < 16; depth += 1) {
    if (findPath?.__caveArrowKeysPatched && typeof findPath.__caveArrowKeysOriginal === "function") {
      findPath = findPath.__caveArrowKeysOriginal;
      continue;
    }
    if (findPath?.__caveWaypointTolerancePatched && typeof findPath.__originalFindPath === "function") {
      findPath = findPath.__originalFindPath;
      continue;
    }
    break;
  }
  if (findPath !== pathfinder.findPath) pathfinder.findPath = findPath;
})();

window.__minibiaBotBundle.installCaveArrowKeysModule = function installCaveArrowKeysModule(bot) {
  if (!bot) return null;

  if (bot.caveArrowKeys?.destroy) {
    try { bot.caveArrowKeys.destroy(); } catch (_) {}
    bot.caveArrowKeys = null;
  }

  const state = {
    installed: false,
    originalFindPath: null,
    lastStepAt: 0,
    lastKey: null,
    stepCount: 0,
    fieldStepCount: 0,
    uiTimerId: null,
    lastPathLength: 0,
    lastNextTile: null,
    lastError: null,
    lastWalkMethod: null,
    lastFieldName: null,
    pendingStep: null,
    stepRetries: 0,
    dpadButtons: null,
  };

  const config = { matrixCacheMs: 250, stepRetryMs: 250, maxStepRetries: 3 };
  const matrixCache = new Map();
  const damagingFieldIds = new Set([
    // Fire-field IDs supported by Walk Over Fields across all pathing modes.
    1487, 1488, 1489,
    1492, 1493, 1494,
    1500, 1501, 1502,
    2118, 2119, 2120,
    2123, 2124, 2125,
    2131, 2132, 2133,
  ]);
  const damagingFieldPattern = /(?:fire|flame|poison|energy)\s*(?:field|wall|damage|ground|tile)/i;

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function sameTile(a, b) {
    a = normalizePosition(a); b = normalizePosition(b);
    return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
  }

  function isArrowModeActive() {
    const caveStatus = bot.cave?.status?.() || null;
    return !!(caveStatus?.running && caveStatus?.config?.pathfinderMode === "arrow");
  }

  function isWalkOverFieldsEnabled() {
    return !!bot.cave?.status?.()?.config?.walkOverFields;
  }

  function getThingDefinition(id) {
    if (!id) return null;
    const client = window.gameClient;
    return client?.itemDefinitionsByCid?.[id] || client?.itemDefinitionsBySid?.[id] || client?.itemDefinitions?.[id] || null;
  }

  function getThingName(thing) {
    if (!thing) return "";
    const definition = getThingDefinition(thing.id);
    return [definition?.properties?.name, definition?.name, thing.name, thing.type, thing.category, thing.properties?.name, thing.properties?.type, thing.properties?.category]
      .filter((v) => v != null).map(String).join(" ").trim().toLowerCase();
  }

  function getTileThings(tile) {
    if (!tile) return [];
    const things = [];
    const add = (v) => { if (!v) return; if (Array.isArray(v)) v.forEach(add); else if (!things.includes(v)) things.push(v); };
    if (tile.id) add(tile);
    add(tile.items); add(tile.things); add(tile.objects); add(tile.topThing);
    try { add(tile.getItems?.()); } catch (_) {}
    try { add(tile.getThings?.()); } catch (_) {}
    try { add(tile.getObjects?.()); } catch (_) {}
    try { add(tile.getTopThing?.()); } catch (_) {}
    return things;
  }

  function getDamagingFieldName(tile) {
    if (!tile) return null;
    for (const thing of getTileThings(tile)) {
      const id = Number(thing?.id);
      if (damagingFieldIds.has(id)) return getThingName(thing) || `field ${id}`;
      const name = getThingName(thing);
      if (damagingFieldPattern.test(name)) return name;
    }
    const text = [tile.name, tile.type, tile.category, tile.properties?.name, tile.properties?.type, tile.properties?.category, tile.topThing?.name, tile.topThing?.type]
      .filter((v) => v != null).map(String).join(" ").trim().toLowerCase();
    return damagingFieldPattern.test(text) ? text : null;
  }

  function isDWalkPassable(tile) {
    if (!tile) return false;
    const fieldName = getDamagingFieldName(tile);
    if (fieldName && isWalkOverFieldsEnabled()) return true;
    try { return typeof tile.isWalkable === "function" && tile.isWalkable(); } catch (_) { return false; }
  }

  function getTileAt(position) {
    const p = normalizePosition(position);
    if (!p) return null;
    try { return window.gameClient?.world?.getTileFromWorldPosition?.(new Position(p.x, p.y, p.z)) || null; } catch (_) { return null; }
  }

  function getMatrix(z, start, goal) {
    const cacheKey = `${z}:${isWalkOverFieldsEnabled() ? 1 : 0}`;
    const cached = matrixCache.get(cacheKey);
    if (cached && Date.now() - cached.at <= config.matrixCacheMs) {
      for (const p of [start, goal]) {
        if (!p || p.z !== z) continue;
        const tile = getTileAt(p);
        if (tile) cached.matrix.set(`${p.x},${p.y}`, { passable: isDWalkPassable(tile), field: !!getDamagingFieldName(tile) });
      }
      return cached.matrix;
    }
    const matrix = new Map();
    const chunks = window.gameClient?.world?.chunks || [];
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.tiles)) continue;
      for (const tile of chunk.tiles) {
        const p = normalizePosition(tile?.__position);
        if (p && p.z === z) matrix.set(`${p.x},${p.y}`, { passable: isDWalkPassable(tile), field: !!getDamagingFieldName(tile) });
      }
    }
    for (const p of [start, goal]) {
      if (!p || p.z !== z) continue;
      const tile = getTileAt(p);
      if (tile) matrix.set(`${p.x},${p.y}`, { passable: isDWalkPassable(tile), field: !!getDamagingFieldName(tile) });
    }
    if (start) matrix.set(`${start.x},${start.y}`, { passable: true, field: !!getDamagingFieldName(getTileAt(start)) });
    matrixCache.set(cacheKey, { matrix, at: Date.now() });
    return matrix;
  }

  function getNeighbors(node, matrix) {
    return [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]
      .map((d) => ({ x: node.x + d.x, y: node.y + d.y, z: node.z }))
      .filter((p) => {
        const key = `${p.x},${p.y}`;
        if (matrix.has(key)) return !!matrix.get(key).passable;
        const tile = getTileAt(p);
        if (!tile) return false;
        const passable = isDWalkPassable(tile);
        matrix.set(key, { passable, field: !!getDamagingFieldName(tile) });
        return passable;
      });
  }

  function heuristic(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

  function findPathAStar(start, goal) {
    const from = normalizePosition(start), to = normalizePosition(goal);
    if (!from || !to || from.z !== to.z) return null;
    if (sameTile(from, to)) return [from];
    const matrix = getMatrix(from.z, from, to);
    matrix.set(`${from.x},${from.y}`, { passable: true, field: !!getDamagingFieldName(getTileAt(from)) });
    const destinationTile = getTileAt(to);
    const destinationField = !!getDamagingFieldName(destinationTile);
    matrix.set(`${to.x},${to.y}`, { passable: destinationField && isWalkOverFieldsEnabled() ? true : !!matrix.get(`${to.x},${to.y}`)?.passable, field: destinationField });

    const tolerance = destinationField && isWalkOverFieldsEnabled() ? 0 : Math.max(1, Number(bot.cave?.status?.()?.config?.waypointTolerance) || 0);
    const open = [{ ...from, g: 0, f: heuristic(from, to), parent: null }];
    const closed = new Set();
    const key = (p) => `${p.x},${p.y}`;
    while (open.length) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
      const current = open.splice(bestIndex, 1)[0];
      if (heuristic(current, to) <= tolerance) {
        const path = [];
        for (let node = current; node; node = node.parent) path.unshift({ x: node.x, y: node.y, z: node.z });
        return path;
      }
      closed.add(key(current));
      for (const neighbor of getNeighbors(current, matrix)) {
        const neighborKey = key(neighbor);
        if (closed.has(neighborKey)) continue;
        const g = current.g + 1;
        const existing = open.find((entry) => entry.x === neighbor.x && entry.y === neighbor.y);
        if (existing) {
          if (g < existing.g) { existing.g = g; existing.f = g + heuristic(neighbor, to); existing.parent = current; }
        } else open.push({ ...neighbor, g, f: g + heuristic(neighbor, to), parent: current });
      }
    }
    return null;
  }

  function pickArrowKey(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (dx === 1 && dy === 0) return "ArrowRight";
    if (dx === -1 && dy === 0) return "ArrowLeft";
    if (dx === 0 && dy === 1) return "ArrowDown";
    if (dx === 0 && dy === -1) return "ArrowUp";
    return null;
  }

  function getButtonDirection(button) {
    const text = String(button?.textContent || "").replace(/\uFE0E|\uFE0F/g, "").replace(/\s+/g, "").toLowerCase();
    const label = String(button?.getAttribute?.("aria-label") || button?.getAttribute?.("title") || button?.dataset?.direction || button?.dataset?.key || "").replace(/\s+/g, "").toLowerCase();
    const values = new Set([text, label]);
    if (values.has("▲") || values.has("up") || values.has("north") || values.has("arrowup")) return "ArrowUp";
    if (values.has("▶") || values.has("right") || values.has("east") || values.has("arrowright")) return "ArrowRight";
    if (values.has("▼") || values.has("down") || values.has("south") || values.has("arrowdown")) return "ArrowDown";
    if (values.has("◀") || values.has("left") || values.has("west") || values.has("arrowleft")) return "ArrowLeft";
    return null;
  }

  function findDpadButtons() {
    if (state.dpadButtons && Object.values(state.dpadButtons).every((b) => b?.isConnected)) return state.dpadButtons;
    const candidates = Array.from(document.querySelectorAll("button")).map((button) => ({ button, key: getButtonDirection(button) })).filter((entry) => entry.key);
    for (const entry of candidates) {
      let container = entry.button.parentElement;
      for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
        const buttons = {};
        for (const button of container.querySelectorAll("button")) {
          const key = getButtonDirection(button);
          if (key && !buttons[key]) buttons[key] = button;
        }
        if (Object.keys(buttons).length === 4) { state.dpadButtons = buttons; return buttons; }
      }
    }
    const fallback = {};
    for (const entry of candidates) if (!fallback[entry.key]) fallback[entry.key] = entry.button;
    state.dpadButtons = Object.keys(fallback).length === 4 ? fallback : null;
    return state.dpadButtons;
  }

  function clickDpadDirection(key, from, next, fieldName) {
    const button = findDpadButtons()?.[key];
    if (!button) { state.lastError = `Minibia D-pad control not found for ${key}`; return false; }
    try {
      button.click();
      state.lastFieldName = fieldName || null;
      state.lastWalkMethod = fieldName ? `Minibia direct D-pad field step (${key})` : `Minibia direct D-pad step (${key})`;
      state.lastError = null;
      state.pendingStep = { from: { ...from }, to: { ...next }, key, fieldName: fieldName || null, sentAt: Date.now() };
      state.stepRetries = 0;
      state.lastKey = key;
      state.lastStepAt = Date.now();
      return true;
    } catch (error) { state.lastError = `D-pad movement failed: ${error?.message || error}`; return false; }
  }

  function handlePendingStep(from, to) {
    const pending = state.pendingStep;
    if (!pending || !sameTile(to, pending.to)) return null;
    if (!sameTile(from, pending.from)) {
      state.pendingStep = null; state.stepRetries = 0; state.stepCount += 1; state.lastStepAt = Date.now();
      if (pending.fieldName) state.fieldStepCount += 1;
      return true;
    }
    if (Date.now() - pending.sentAt < config.stepRetryMs) return true;
    if (state.stepRetries >= config.maxStepRetries) {
      state.lastError = `D-pad step did not move after ${state.stepRetries + 1} attempts`;
      state.pendingStep = null; state.stepRetries = 0; return false;
    }
    state.stepRetries += 1;
    const button = findDpadButtons()?.[pending.key];
    if (!button) { state.lastError = `Minibia D-pad control not found for retry ${pending.key}`; state.pendingStep = null; state.stepRetries = 0; return false; }
    try { button.click(); pending.sentAt = Date.now(); return true; }
    catch (error) { state.lastError = `D-pad retry failed: ${error?.message || error}`; state.pendingStep = null; state.stepRetries = 0; return false; }
  }

  function installPathfinderPatch() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (pathfinder.findPath.__caveArrowKeysPatched && pathfinder.findPath.__caveArrowKeysModuleToken === state) {
      state.installed = true; return true;
    }
    const originalFindPath = pathfinder.findPath.__caveArrowKeysOriginal || pathfinder.findPath;
    state.originalFindPath = originalFindPath;

    function patchedFindPath(fromValue, toValue, ...args) {
      if (!isArrowModeActive()) return originalFindPath.call(this, fromValue, toValue, ...args);
      const from = normalizePosition(fromValue), to = normalizePosition(toValue);
      if (!from || !to || from.z !== to.z) return originalFindPath.call(this, fromValue, toValue, ...args);
      const pending = handlePendingStep(from, to);
      if (pending !== null) return pending;
      const path = findPathAStar(from, to);
      state.lastPathLength = path ? path.length : 0;
      state.lastNextTile = path?.length > 1 ? { ...path[1] } : null;
      if (!path || path.length < 2) { state.lastError = "D-walk A* path not found"; return null; }
      const key = pickArrowKey(from, path[1]);
      if (!key) { state.lastError = "D-walk A* next step is not cardinal"; return null; }
      return clickDpadDirection(key, from, path[1], getDamagingFieldName(getTileAt(path[1])));
    }

    patchedFindPath.__caveArrowKeysPatched = true;
    patchedFindPath.__caveArrowKeysModuleToken = state;
    patchedFindPath.__caveArrowKeysOriginal = originalFindPath;
    pathfinder.findPath = patchedFindPath;
    state.installed = true;
    return true;
  }

  function ensurePathfinderPatch() {
    if (installPathfinderPatch()) return;
    let attempts = 0;
    const timerId = window.setInterval(() => {
      attempts += 1;
      if (installPathfinderPatch() || attempts >= 80) window.clearInterval(timerId);
    }, 250);
    bot.addCleanup?.(() => window.clearInterval(timerId));
    state.uiTimerId = timerId;
  }

  function status() { return { ...state, config: { ...config } }; }

  function destroy() {
    if (state.uiTimerId != null) window.clearInterval(state.uiTimerId);
    state.uiTimerId = null;
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (pathfinder?.findPath?.__caveArrowKeysModuleToken === state && state.originalFindPath) {
      pathfinder.findPath = state.originalFindPath;
    }
    matrixCache.clear();
    state.pendingStep = null;
    state.dpadButtons = null;
    state.installed = false;
  }

  function stepToPosition(position) {
    const from = normalizePosition(bot.getPlayerPosition?.());
    const to = normalizePosition(position);
    if (!from || !to || from.z !== to.z) return false;
    if (sameTile(from, to)) return true;
    if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) !== 1) return false;
    const key = pickArrowKey(from, to);
    if (!key) return false;
    return clickDpadDirection(key, from, to, null);
  }

  bot.caveArrowKeys = { status, destroy, ensureDropdownOption: () => {}, stepToPosition };
  ensurePathfinderPatch();
  return bot.caveArrowKeys;
};
