window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaveArrowFieldDetectionFix = function installCaveArrowFieldDetectionFix(bot) {
  if (!bot || bot.caveArrowFieldDetectionFix?.destroy) return bot?.caveArrowFieldDetectionFix;

  const state = { timerId: null, marked: 0, lastScanAt: 0 };
  const FIELD_IDS = new Map([
    // Fire-field IDs supported by Walk Over Fields across all pathing modes.
    [1487, "fire field"], [1488, "fire field"], [1489, "fire field"],
    [1492, "fire field"], [1493, "fire field"], [1494, "fire field"],
    [1500, "fire field"], [1501, "fire field"], [1502, "fire field"],
    [2118, "fire field"], [2119, "fire field"], [2120, "fire field"],
    [2123, "fire field"], [2124, "fire field"], [2125, "fire field"],
    [2131, "fire field"], [2132, "fire field"], [2133, "fire field"],
    [1490, "poison field"], [1496, "poison field"],
    [1491, "energy field"], [1495, "energy field"],
  ]);

  function idOf(thing) {
    for (const key of ["id", "itemId", "itemID", "clientId", "clientID", "serverId", "serverID"]) {
      const value = Number(thing?.[key]);
      if (Number.isFinite(value)) return Math.trunc(value);
    }
    return null;
  }

  function isFieldThing(thing) {
    if (!thing) return null;
    const id = idOf(thing);
    if (FIELD_IDS.has(id)) return FIELD_IDS.get(id);
    const definition = window.gameClient?.itemDefinitionsByCid?.[id]
      || window.gameClient?.itemDefinitionsBySid?.[id]
      || window.gameClient?.itemDefinitions?.[id]
      || null;
    const name = String(thing.name || definition?.properties?.name || "").trim().toLowerCase();
    if (/\b(?:fire|poison|energy)\s+field\b/i.test(name)) return name;
    const field = String(thing.field || definition?.properties?.field || "").trim().toLowerCase();
    const type = String(thing.type || definition?.properties?.type || "").trim().toLowerCase();
    if ((field === "fire" || field === "poison" || field === "energy") && (type === "magicfield" || !type)) {
      return `${field} field`;
    }
    return null;
  }

  function thingsOnTile(tile) {
    if (!tile) return [];
    const result = [tile];
    for (const key of ["items", "things", "objects"]) {
      if (Array.isArray(tile[key])) result.push(...tile[key]);
    }
    for (const key of ["getItems", "getThings", "getObjects"]) {
      if (typeof tile[key] !== "function") continue;
      try {
        const values = tile[key]();
        if (Array.isArray(values)) result.push(...values);
      } catch (_) {}
    }
    return result.filter(Boolean);
  }

  function scan() {
    const caveStatus = bot.cave?.status?.() || null;
    if (!caveStatus?.running || caveStatus?.config?.pathfinderMode !== "arrow") return;
    const now = Date.now();
    if (now - state.lastScanAt < 450) return;
    state.lastScanAt = now;

    const chunks = window.gameClient?.world?.chunks || [];
    let marked = 0;
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.tiles)) continue;
      for (const tile of chunk.tiles) {
        for (const thing of thingsOnTile(tile)) {
          const fieldName = isFieldThing(thing);
          if (!fieldName) continue;
          if (!thing.name) {
            try { thing.name = fieldName; } catch (_) {}
          }
          marked += 1;
        }
      }
    }
    state.marked = marked;
  }

  function destroy() {
    if (state.timerId != null) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  bot.caveArrowFieldDetectionFix = { scan, status: () => ({ ...state }), destroy };
  scan();
  state.timerId = window.setInterval(scan, 500);
  bot.addCleanup(destroy);
  return bot.caveArrowFieldDetectionFix;
};

if (!window.__minibiaBotArrowFieldFixBootstrap) {
  window.__minibiaBotArrowFieldFixBootstrap = window.setInterval(() => {
    const bot = window.minibiaBot;
    if (!bot || bot.caveArrowFieldDetectionFix) return;
    window.__minibiaBotBundle.installCaveArrowFieldDetectionFix(bot);
  }, 500);
}
