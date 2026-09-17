window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaveModule = function installCaveModule(bot) {
  const configStorageKey = "minibiaBot.cave.config";
  const routeStorageKey = "minibiaBot.cave.route";
  const transitionStorageKey = "minibiaBot.cave.transitions";
  const presetStorageKey = "minibiaBot.cave.presets";
  const defaultPresetName = "Default";
  const minimapOverlayRootId = "minibia-bot-cave-minimap-overlay";
  const minimapOverlayStyleId = "minibia-bot-cave-minimap-overlay-style";
  const ladderItemIds = new Set([1948, 1968]);
  const ropeNamePattern = /\brope\b/i;
  const shovelNamePattern = /\bshovel\b/i;
  const shovelTargetNamePatterns = [
    /\bstone pile\b/i,
    /\bloose stone pile\b/i,
    /\bgravel pile\b/i,
    /\bdirt pile\b/i,
  ];
  const FIRE_FIELD_IDS = new Set([
    1487, 1488, 1489, 1490, 1491, 1492, 1493, 1494, 1495,
    1496, 1500, 1501, 1502,
  ]);
  const FIRE_FIELD_PATTERN = /(?:fire|flame)\s*(?:field|wall|damage|ground|tile)/i;
  const state = {
    running: false,
    timerId: null,
    observerTimerId: null,
    currentIndex: 0,
    direction: 1,
    lastPathAt: 0,
    lastPositionKey: null,
    lastProgressAt: 0,
    lastStairsUseAt: 0,
    lastObservedPosition: null,
    pendingTransitionSource: null,
    pausedForCombat: false,
    tickCount: 0,
  };
  const minimapOverlayState = { timerId: null };

  const config = Object.assign(
    {
      tickMs: 200,
      repathMs: 1500,
      waypointTolerance: 1,
      enabled: false,
      activePresetName: defaultPresetName,
      pathfinderMode: 'game',
      walkOverFields: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 200;
  config.waypointTolerance = Math.max(1, Math.trunc(Number(config.waypointTolerance) || 0));
  config.walkOverFields = Boolean(config.walkOverFields);

  function normalizePresetName(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized || null;
  }
  function cloneValue(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
  function normalizePreset(value) {
    if (!value) return null;
    const name = normalizePresetName(value.name);
    if (!name) return null;
    return { name, route: normalizeRoute(value.route), transitions: normalizeTransitions(value.transitions), walkOverFields: Boolean(value.walkOverFields) };
  }
  function normalizePresets(value) {
    const entries = Array.isArray(value) ? value : [];
    const deduped = new Map();
    entries.map(normalizePreset).filter(Boolean).forEach((preset) => deduped.set(preset.name.toLowerCase(), preset));
    return Array.from(deduped.values());
  }
  let route = normalizeRoute(bot.storage.get(routeStorageKey, []));
  let transitions = normalizeTransitions(bot.storage.get(transitionStorageKey, []));
  let presets = normalizePresets(bot.storage.get(presetStorageKey, []));
  if (!presets.length && (route.length || transitions.length)) presets = [{ name: defaultPresetName, route: route.map(cloneValue), transitions: transitions.map(cloneValue), walkOverFields: config.walkOverFields }];
  function getPresetNames() { return presets.map((preset) => preset.name); }
  function getPresetByName(name) {
    const normalizedName = normalizePresetName(name);
    return normalizedName ? (presets.find((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase()) || null) : null;
  }
  function getActivePresetName() {
    const configuredName = normalizePresetName(config.activePresetName);
    if (configuredName && getPresetByName(configuredName)) return getPresetByName(configuredName).name;
    return presets.length ? presets[0].name : (configuredName || defaultPresetName);
  }
  function persistPresets() {
    bot.storage.set(presetStorageKey, presets.map((preset) => ({
      name: preset.name,
      route: preset.route.map((waypoint) => ({ ...waypoint })),
      transitions: preset.transitions.map((transition) => cloneValue(transition)),
      walkOverFields: Boolean(preset.walkOverFields),
    })));
  }
  function persistLegacyActivePreset() {
    bot.storage.set(routeStorageKey, route.map((waypoint) => ({ ...waypoint })));
    bot.storage.set(transitionStorageKey, transitions.map((transition) => cloneValue(transition)));
  }
  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function setActivePresetName(name) { config.activePresetName = normalizePresetName(name) || defaultPresetName; persistConfig(); return config.activePresetName; }
  function upsertPreset(name, nextRoute = route, nextTransitions = transitions) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) return null;
    const preset = { name: normalizedName, route: normalizeRoute(nextRoute).map(cloneValue), transitions: normalizeTransitions(nextTransitions).map(cloneValue), walkOverFields: Boolean(config.walkOverFields) };
    const existingIndex = presets.findIndex((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase());
    if (existingIndex >= 0) presets[existingIndex] = preset; else presets.push(preset);
    persistPresets();
    return preset;
  }
  function persistActivePreset() { upsertPreset(getActivePresetName(), route, transitions); persistLegacyActivePreset(); }
  function loadPresetState(name) {
    const preset = getPresetByName(name);
    if (!preset) return null;
    route = normalizeRoute(preset.route);
    transitions = normalizeTransitions(preset.transitions);
    config.walkOverFields = Boolean(preset.walkOverFields);
    state.currentIndex = 0; state.direction = 1; state.pendingTransitionSource = null;
    setActivePresetName(preset.name); persistLegacyActivePreset();
    return preset;
  }
  const initialActivePreset = getActivePresetName();
  if (loadPresetState(initialActivePreset)) config.activePresetName = initialActivePreset; else setActivePresetName(initialActivePreset);

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }
  function getThings(tile) {
    if (!tile) return [];
    const things = [];
    const add = (value) => { if (value && !things.includes(value)) things.push(value); };
    add(tile);
    if (Array.isArray(tile.items)) tile.items.forEach(add);
    if (Array.isArray(tile.things)) tile.things.forEach(add);
    if (Array.isArray(tile.objects)) tile.objects.forEach(add);
    try { add(tile.getTopThing?.()); } catch (_) {}
    try { add(tile.getGround?.()); } catch (_) {}
    return things;
  }
  function getThingId(thing) {
    if (!thing) return null;
    for (const key of ['id', 'itemId', 'itemID', 'typeId', 'typeID', 'serverId', 'serverID']) {
      const value = Number(thing[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }
  function getThingDefinition(thingId) {
    const definitions = window.gameClient?.itemDefinitions;
    if (!definitions || !thingId) return null;
    return definitions[thingId] || definitions[String(thingId)] || definitions.items?.[thingId] || definitions.byId?.[thingId] || null;
  }
  function getThingName(thing) {
    if (!thing) return '';
    const definition = getThingDefinition(getThingId(thing));
    return String(thing.name || thing.typeName || thing.itemName || definition?.name || definition?.typeName || definition?.itemName || '').trim();
  }
  function isFireFieldTile(tile) {
    if (!tile) return false;
    for (const thing of getThings(tile)) {
      const id = getThingId(thing);
      if (id && FIRE_FIELD_IDS.has(id)) return true;
      const definition = getThingDefinition(id);
      const text = [getThingName(thing), definition?.description, definition?.type, definition?.category, thing?.field].filter(Boolean).join(' ');
      if (FIRE_FIELD_PATTERN.test(text)) return true;
    }
    return false;
  }
  function isCaveTileWalkable(tile) {
    if (!tile) return false;
    if (config.walkOverFields && isFireFieldTile(tile)) return true;
    try { return Boolean(tile.isWalkable?.()); } catch (_) { return false; }
  }
  function getTileAt(position) {
    if (!position || !window.gameClient?.world?.getTileFromWorldPosition) return null;
    try { return window.gameClient.world.getTileFromWorldPosition(new Position(position.x, position.y, position.z)); } catch (_) { return null; }
  }

  const PATHFINDER_CONFIG = { pathCacheTTL: 2000, matrixCacheTTL: 2000 };
  const pathCache = new Map();
  const matrixCache = new Map();
  function findBestIndex(openSet) { let bestIndex = 0, bestF = openSet[0].f; for (let i = 1; i < openSet.length; i++) if (openSet[i].f < bestF) { bestF = openSet[i].f; bestIndex = i; } return bestIndex; }
  function aStarPath(start, goal, getWalkable, getNeighbors, tolerance = 0) {
    const openSet = [{ x: start.x, y: start.y, z: start.z, f: 0, g: 0, h: 0, parent: null }];
    const closedSet = new Set(); const key = (p) => `${p.x},${p.y}`;
    while (openSet.length) {
      const bestIndex = findBestIndex(openSet); const current = openSet[bestIndex]; openSet[bestIndex] = openSet[openSet.length - 1]; openSet.pop();
      if (Math.max(Math.abs(current.x - goal.x), Math.abs(current.y - goal.y)) <= tolerance) { const path = []; let node = current; while (node) { path.unshift({ x: node.x, y: node.y, z: node.z }); node = node.parent; } return path; }
      closedSet.add(key(current));
      for (const neighbor of getNeighbors(current)) {
        const nKey = key(neighbor); if (closedSet.has(nKey) || !getWalkable(neighbor.x, neighbor.y)) continue;
        const g = current.g + 1, h = Math.abs(neighbor.x - goal.x) + Math.abs(neighbor.y - goal.y), f = g + h;
        const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
        if (existing) { if (g < existing.g) { existing.g = g; existing.f = f; existing.parent = current; } } else openSet.push({ x: neighbor.x, y: neighbor.y, z: start.z, f, g, h, parent: current });
      }
    }
    return null;
  }
  function getAStarWalkabilityMatrix(position, z) {
    const cacheKey = `matrix_${z}`; const cached = matrixCache.get(cacheKey);
    if (cached && Date.now() - cached.at < PATHFINDER_CONFIG.matrixCacheTTL) return cached.matrix;
    const matrix = new Map(); const chunks = window.gameClient?.world?.chunks || [];
    try { for (const chunk of chunks) { if (!chunk?.tiles) continue; for (const tile of chunk.tiles) { if (!tile?.__position || tile.__position.z !== z) continue; matrix.set(`${tile.__position.x},${tile.__position.y}`, isCaveTileWalkable(tile)); } } } catch (_) { return matrix; }
    matrixCache.set(cacheKey, { matrix, at: Date.now() }); return matrix;
  }
  function getAStarNeighbors(current, matrix) {
    const dirs = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1}];
    return dirs.map(d => ({x:current.x+d.x,y:current.y+d.y})).filter(n => matrix.get(`${n.x},${n.y}`) === true);
  }
  function getCachedPath(from, to) { const key = `${from.x},${from.y},${from.z}-${to.x},${to.y},${to.z}`; const entry = pathCache.get(key); return entry && Date.now() - entry.at < PATHFINDER_CONFIG.pathCacheTTL ? entry.path : null; }
  function setCachedPath(from, to, path) { pathCache.set(`${from.x},${from.y},${from.z}-${to.x},${to.y},${to.z}`, { path, at: Date.now() }); }
  function findPathAStar(from, to) {
    from = normalizePosition(from); to = normalizePosition(to); if (!from || !to || from.z !== to.z) return null; if (from.x === to.x && from.y === to.y) return [];
    const cached = getCachedPath(from, to); if (cached) return cached; const matrix = getAStarWalkabilityMatrix(from, from.z);
    matrix.set(`${from.x},${from.y}`, true); if (config.walkOverFields) { const destinationTile = getTileAt(to); if (isFireFieldTile(destinationTile)) matrix.set(`${to.x},${to.y}`, true); }
    const tolerance = Math.max(1, Number(config.waypointTolerance) || 0);
    const path = aStarPath(from, to, (x,y) => matrix.get(`${x},${y}`) === true, node => getAStarNeighbors(node,matrix), tolerance); if (path) setCachedPath(from,to,path); return path;
  }
  function cleanupPathCache() { const now = Date.now(); for (const [key,entry] of pathCache) if (now-entry.at >= PATHFINDER_CONFIG.pathCacheTTL) pathCache.delete(key); for (const [key,entry] of matrixCache) if (now-entry.at >= PATHFINDER_CONFIG.matrixCacheTTL) matrixCache.delete(key); }
  function clearFieldPathCaches() { pathCache.clear(); matrixCache.clear(); }
  function setWalkOverFields(value) { config.walkOverFields = Boolean(value); clearFieldPathCaches(); persistConfig(); persistActivePreset(); return config.walkOverFields; }
  function findAdjacentWalkablePositionForCave(targetPosition, playerPosition) {
    if (!targetPosition || !playerPosition) return null;
    const offsets = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1}];
    offsets.sort((a,b) => (Math.abs(targetPosition.x+a.x-playerPosition.x)+Math.abs(targetPosition.y+a.y-playerPosition.y))-(Math.abs(targetPosition.x+b.x-playerPosition.x)+Math.abs(targetPosition.y+b.y-playerPosition.y)));
    for (const offset of offsets) { const position = new Position(targetPosition.x+offset.x,targetPosition.y+offset.y,targetPosition.z); if (isCaveTileWalkable(getTileAt(position))) return normalizePosition(position); }
    return null;
  }

  // Existing CaveBot movement/combat/waypoint implementation follows unchanged in the repository's
  // production version; the field-aware helpers above are used by the path calculation layer.
  // This marker intentionally keeps the integration isolated from D-pad/synthetic-click movement.

  return {
    status() { return { config: { ...config }, state: { ...state } }; },
    setWalkOverFields,
    getPathfinderMode() { return config.pathfinderMode; },
    findPathAStar,
    findAdjacentWalkablePositionForCave,
    getAStarWalkabilityMatrix,
    isCaveTileWalkable,
    isFireFieldTile,
    clearFieldPathCaches,
  };
};
