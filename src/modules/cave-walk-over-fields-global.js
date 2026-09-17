window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installGlobalCaveFieldPathing() {
  const state = { timerId: null, patched: false, originalFindPath: null, pathfinder: null };

  // Keep this list aligned with CaveBot's existing D-pad field handling.
  const FIRE_FIELD_IDS = new Set([1487, 1488, 1490, 1491, 1492, 1493, 1494, 1495, 1496, 1500, 1501, 1502]);

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getDefinition(thing) {
    const id = Number(thing?.id);
    if (!Number.isFinite(id)) return null;
    const client = window.gameClient;
    return client?.itemDefinitionsByCid?.[id] || client?.itemDefinitionsBySid?.[id] || client?.itemDefinitions?.[id] || null;
  }

  function thingsForTile(tile) {
    if (!tile) return [];
    const result = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(add);
      else if (!result.includes(value)) result.push(value);
    };
    add(tile);
    add(tile.items); add(tile.things); add(tile.objects); add(tile.topThing);
    try { add(tile.getItems?.()); } catch (_) {}
    try { add(tile.getThings?.()); } catch (_) {}
    try { add(tile.getObjects?.()); } catch (_) {}
    try { add(tile.getTopThing?.()); } catch (_) {}
    return result;
  }

  function isFireFieldTile(tile) {
    for (const thing of thingsForTile(tile)) {
      const id = Number(thing?.id);
      if (FIRE_FIELD_IDS.has(id)) return true;
      const definition = getDefinition(thing);
      const text = [
        thing?.name, thing?.field, thing?.type,
        definition?.name, definition?.properties?.name,
        definition?.properties?.field, definition?.properties?.type,
      ].filter(Boolean).join(" ").toLowerCase();
      if (/\bfire\s*field\b/.test(text)) return true;
      if (/\bfield\s*fire\b/.test(text)) return true;
    }
    return false;
  }

  function getTile(position) {
    const p = normalizePosition(position);
    if (!p) return null;
    try {
      return window.gameClient?.world?.getTileFromWorldPosition?.(new Position(p.x, p.y, p.z)) || null;
    } catch (_) { return null; }
  }

  function isPassable(position, startKey) {
    const tile = getTile(position);
    if (!tile) return false;
    if (startKey === `${position.x},${position.y}`) return true;
    if (isFireFieldTile(tile)) return true;
    try { return !!tile.isWalkable?.(); } catch (_) { return false; }
  }

  function findPath(start, goal, tolerance) {
    const from = normalizePosition(start), to = normalizePosition(goal);
    if (!from || !to || from.z !== to.z) return null;
    const startKey = `${from.x},${from.y}`;
    const queue = [{ x: from.x, y: from.y, z: from.z, parent: null }];
    const visited = new Set([startKey]);
    const dirs = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
    ];

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (Math.max(Math.abs(current.x - to.x), Math.abs(current.y - to.y)) <= tolerance) {
        const path = [];
        for (let node = current; node; node = node.parent) path.unshift({ x: node.x, y: node.y, z: node.z });
        return path;
      }
      for (const dir of dirs) {
        const next = { x: current.x + dir.x, y: current.y + dir.y, z: current.z };
        const key = `${next.x},${next.y}`;
        if (visited.has(key) || !isPassable(next, startKey)) continue;
        visited.add(key);
        queue.push({ ...next, parent: current });
      }
    }
    return null;
  }

  function getButtonDirection(button) {
    const text = String(button?.textContent || "").replace(/\uFE0E|\uFE0F/g, "").replace(/\s+/g, "").toLowerCase();
    const label = String(button?.getAttribute?.("aria-label") || button?.getAttribute?.("title") || button?.dataset?.direction || button?.dataset?.key || "").replace(/\s+/g, "").toLowerCase();
    if (["▲", "up", "north", "arrowup"].includes(text) || ["▲", "up", "north", "arrowup"].includes(label)) return "ArrowUp";
    if (["▶", "right", "east", "arrowright"].includes(text) || ["▶", "right", "east", "arrowright"].includes(label)) return "ArrowRight";
    if (["▼", "down", "south", "arrowdown"].includes(text) || ["▼", "down", "south", "arrowdown"].includes(label)) return "ArrowDown";
    if (["◀", "left", "west", "arrowleft"].includes(text) || ["◀", "left", "west", "arrowleft"].includes(label)) return "ArrowLeft";
    return null;
  }

  function findDpadButtons() {
    const candidates = Array.from(document.querySelectorAll("button"))
      .map((button) => ({ button, key: getButtonDirection(button) }))
      .filter((entry) => entry.key);
    for (const entry of candidates) {
      let container = entry.button.parentElement;
      for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
        const buttons = {};
        for (const button of container.querySelectorAll("button")) {
          const key = getButtonDirection(button);
          if (key && !buttons[key]) buttons[key] = button;
        }
        if (Object.keys(buttons).length === 4) return buttons;
      }
    }
    const fallback = {};
    for (const entry of candidates) if (!fallback[entry.key]) fallback[entry.key] = entry.button;
    return Object.keys(fallback).length === 4 ? fallback : null;
  }

  function directionFor(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    if (dx === 1 && dy === 0) return "ArrowRight";
    if (dx === -1 && dy === 0) return "ArrowLeft";
    if (dx === 0 && dy === 1) return "ArrowDown";
    if (dx === 0 && dy === -1) return "ArrowUp";
    return null;
  }

  function pathUsesFire(path) {
    return Array.isArray(path) && path.some((position) => isFireFieldTile(getTile(position)));
  }

  function install() {
    const bot = window.minibiaBot;
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!bot?.cave || !pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (pathfinder.findPath.__globalCaveFieldPathingPatched) return true;

    const originalFindPath = pathfinder.findPath;
    function patchedFindPath(fromValue, toValue, ...args) {
      const caveStatus = bot.cave?.status?.();
      if (!caveStatus?.running || !caveStatus?.config?.walkOverFields) {
        return originalFindPath.call(this, fromValue, toValue, ...args);
      }

      const from = normalizePosition(fromValue || bot.getPlayerPosition?.());
      const to = normalizePosition(toValue);
      const waypoint = normalizePosition(caveStatus.currentWaypoint);
      if (!from || !to || !waypoint || to.x !== waypoint.x || to.y !== waypoint.y || to.z !== waypoint.z) {
        return originalFindPath.call(this, fromValue, toValue, ...args);
      }

      const tolerance = Math.max(1, Number(caveStatus.config.waypointTolerance) || 1);
      const customPath = findPath(from, to, tolerance);
      if (!customPath || customPath.length < 2 || !pathUsesFire(customPath)) {
        return originalFindPath.call(this, fromValue, toValue, ...args);
      }

      const next = customPath[1];
      const key = directionFor(from, next);
      const button = key ? findDpadButtons()?.[key] : null;
      if (!button) return originalFindPath.call(this, fromValue, toValue, ...args);
      try {
        button.click();
        return true;
      } catch (_) {
        return originalFindPath.call(this, fromValue, toValue, ...args);
      }
    }

    patchedFindPath.__globalCaveFieldPathingPatched = true;
    patchedFindPath.__globalCaveFieldPathingOriginal = originalFindPath;
    pathfinder.findPath = patchedFindPath;
    state.patched = true;
    state.originalFindPath = originalFindPath;
    state.pathfinder = pathfinder;
    return true;
  }

  function start() {
    if (install()) return;
    let attempts = 0;
    state.timerId = window.setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 80) {
        window.clearInterval(state.timerId);
        state.timerId = null;
      }
    }, 250);
  }

  start();
})();
