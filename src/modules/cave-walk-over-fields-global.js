window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installGlobalCaveFieldPathing() {
  const FIRE_FIELD_IDS = new Set([
    1487, 1488, 1489, 1490, 1491, 1492, 1493, 1494, 1495,
    1496, 1500, 1501, 1502,
  ]);
  const FIRE_FIELD_PATTERN = /(?:fire|flame)\s*(?:field|wall|damage|ground|tile)/i;
  const state = { timerId: null, installed: false, patchedTiles: new Set() };

  function getDefinition(thing) {
    const id = Number(thing?.id ?? thing?.itemId ?? thing?.serverId ?? thing?.clientId);
    if (!Number.isFinite(id)) return null;
    const client = window.gameClient;
    return client?.itemDefinitionsByCid?.[id]
      || client?.itemDefinitionsBySid?.[id]
      || client?.itemDefinitions?.[id]
      || null;
  }

  function getThings(tile) {
    if (!tile) return [];
    const result = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(add);
      else if (!result.includes(value)) result.push(value);
    };
    add(tile);
    add(tile.items);
    add(tile.things);
    add(tile.objects);
    add(tile.topThing);
    try { add(tile.getItems?.()); } catch (_) {}
    try { add(tile.getThings?.()); } catch (_) {}
    try { add(tile.getObjects?.()); } catch (_) {}
    try { add(tile.getTopThing?.()); } catch (_) {}
    return result;
  }

  function isFireFieldTile(tile) {
    for (const thing of getThings(tile)) {
      const id = Number(thing?.id ?? thing?.itemId ?? thing?.serverId ?? thing?.clientId);
      if (FIRE_FIELD_IDS.has(id)) return true;
      const definition = getDefinition(thing);
      const text = [
        thing?.name, thing?.itemName, thing?.field, thing?.fieldType,
        thing?.type, thing?.thingType, thing?.category,
        definition?.name, definition?.properties?.name,
        definition?.properties?.field, definition?.properties?.type,
        definition?.properties?.category,
      ].filter(Boolean).map(String).join(" ");
      if (FIRE_FIELD_PATTERN.test(text) || /\bfire\s*field\b/i.test(text)) return true;
    }
    return false;
  }

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.tiles)) continue;
      for (const tile of chunk.tiles) if (tile) tiles.push(tile);
    }
    return tiles;
  }

  function patchTile(tile, bot) {
    if (!tile || typeof tile.isWalkable !== "function") return false;
    if (tile.isWalkable.__globalCaveFieldWalkable) return true;
    const original = tile.isWalkable;
    const wrapper = function globalCaveFieldWalkable(...args) {
      const status = bot.cave?.status?.();
      if (status?.config?.walkOverFields && isFireFieldTile(this)) return true;
      return original.apply(this, args);
    };
    wrapper.__globalCaveFieldWalkable = true;
    wrapper.__globalCaveFieldOriginal = original;
    tile.isWalkable = wrapper;
    state.patchedTiles.add(tile);
    return true;
  }

  function patchPrototype(bot) {
    const position = bot.getPlayerPosition?.();
    if (!position) return false;
    let tile = null;
    try {
      tile = window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(Number(position.x), Number(position.y), Number(position.z))
      );
    } catch (_) {}
    const prototype = tile && Object.getPrototypeOf(tile);
    if (!prototype) return false;

    // The game's native pathfinder may use a passability predicate other than
    // isWalkable(). Patch the tile collision predicates themselves, but never
    // replace the movement command. Fire fields are therefore just ordinary
    // passable tiles to every native pathing implementation.
    const predicates = ["isWalkable", "isPassable", "isPathable", "isBlocking", "blocksMovement", "canWalk"];
    let patched = false;
    for (const name of predicates) {
      if (typeof prototype[name] !== "function" || prototype[name].__globalCaveFieldWalkable) continue;
      const original = prototype[name];
      const wrapper = function globalCaveFieldPassability(...args) {
        const status = bot.cave?.status?.();
        if (status?.config?.walkOverFields && isFireFieldTile(this)) {
          if (name === "isBlocking" || name === "blocksMovement") return false;
          return true;
        }
        return original.apply(this, args);
      };
      wrapper.__globalCaveFieldWalkable = true;
      wrapper.__globalCaveFieldOriginal = original;
      prototype[name] = wrapper;
      patched = true;
    }
    return patched;
  }

  function patchAllLoadedTiles(bot) {
    patchPrototype(bot);
    for (const tile of getLoadedTiles()) {
      if (isFireFieldTile(tile)) patchTile(tile, bot);
    }
  }

  function installPathfinderGuard(bot) {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (pathfinder.findPath.__globalCaveFieldGuard) return true;

    // Do not replace the game's movement/pathfinding algorithm. The only global
    // change is making fire fields report as walkable while the toggle is ON.
    // This keeps Game, Direct, Smart A, Smart A + Field Crossing and Arrow/D-pad
    // on their native movement implementations.
    const originalFindPath = pathfinder.findPath;
    function guardedFindPath(...args) {
      const status = bot.cave?.status?.();
      if (status?.config?.walkOverFields) patchAllLoadedTiles(bot);
      return originalFindPath.apply(this, args);
    }
    guardedFindPath.__globalCaveFieldGuard = true;
    guardedFindPath.__globalCaveFieldOriginal = originalFindPath;
    pathfinder.findPath = guardedFindPath;
    return true;
  }

  function install() {
    const bot = window.minibiaBot;
    if (!bot?.cave) return false;
    patchAllLoadedTiles(bot);
    installPathfinderGuard(bot);
    state.installed = true;
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
