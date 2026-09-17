window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installCaveWaypointTolerancePathingPatch(bundle) {
  const originalInstallCaveModule = bundle.installCaveModule;
  if (typeof originalInstallCaveModule !== "function") return;
  if (originalInstallCaveModule.__waypointTolerancePathingPatched) return;

  const configStorageKey = "minibiaBot.cave.config";
  const presetFieldKey = "minibiaBot.cave.walkOverFieldsPresets";
  const FIELD_IDS = new Set([1487, 1488, 1490, 1491, 1492, 1493, 1494, 1495, 1496, 1500, 1501]);

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getThingDefinition(item) {
    const id = Number(item?.id);
    if (!Number.isFinite(id)) return null;
    return window.gameClient?.itemDefinitionsByCid?.[id]
      || window.gameClient?.itemDefinitionsBySid?.[id]
      || window.gameClient?.itemDefinitions?.[id]
      || null;
  }

  function isFieldThing(thing) {
    if (!thing) return false;
    const id = Number(thing.id);
    if (FIELD_IDS.has(id)) return true;
    const definition = getThingDefinition(thing);
    const name = String(thing.name || definition?.properties?.name || "").trim().toLowerCase();
    if (/\b(?:fire|poison|energy)\s+field\b/i.test(name)) return true;
    const field = String(thing.field || definition?.properties?.field || "").trim().toLowerCase();
    const type = String(thing.type || definition?.properties?.type || "").trim().toLowerCase();
    return ["fire", "poison", "energy"].includes(field) && (!type || type === "magicfield");
  }

  function tileHasField(tile) {
    if (!tile) return false;
    const things = [tile, ...(Array.isArray(tile.items) ? tile.items : []), ...(Array.isArray(tile.things) ? tile.things : [])];
    return things.some(isFieldThing);
  }

  function patchFieldTiles(bot, enabled) {
    const previous = bot.__caveWalkOverFieldsPatchedTiles || [];
    if (!enabled) {
      previous.forEach(({ tile, original }) => {
        try { if (tile?.isWalkable?.__caveWalkOverFieldsWrapper) tile.isWalkable = original; } catch (_) {}
      });
      bot.__caveWalkOverFieldsPatchedTiles = [];
      return;
    }

    const patched = [];
    const chunks = window.gameClient?.world?.chunks || [];
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.tiles)) continue;
      for (const tile of chunk.tiles) {
        if (!tile || typeof tile.isWalkable !== "function" || !tileHasField(tile)) continue;
        if (tile.isWalkable.__caveWalkOverFieldsWrapper) continue;
        const original = tile.isWalkable;
        const wrapper = function caveWalkOverFieldsIsWalkable(...args) {
          const status = bot.cave?.status?.();
          if (status?.running && status?.config?.walkOverFields) return true;
          return original.apply(this, args);
        };
        wrapper.__caveWalkOverFieldsWrapper = true;
        tile.isWalkable = wrapper;
        patched.push({ tile, original });
      }
    }
    if (patched.length) bot.__caveWalkOverFieldsPatchedTiles = [...previous, ...patched];
  }

  function syncWalkOverFieldsControl(bot) {
    const toggle = document.getElementById("minibia-bot-cave-walk-over-fields");
    if (toggle) toggle.checked = !!bot.cave?.config?.walkOverFields;
  }

  function patchCaveInstance(bot) {
    const originalUpdateConfig = bot.cave.updateConfig.bind(bot.cave);
    const originalStatus = bot.cave.status.bind(bot.cave);
    const originalSavePreset = bot.cave.savePreset?.bind(bot.cave);
    const originalLoadPreset = bot.cave.loadPreset?.bind(bot.cave);
    const originalDeletePreset = bot.cave.deletePreset?.bind(bot.cave);
    const originalCreatePreset = bot.cave.createPreset?.bind(bot.cave);
    const readPresetSettings = () => bot.storage.get(presetFieldKey, {}) || {};
    const writePresetSettings = (settings) => bot.storage.set(presetFieldKey, settings || {});

    bot.cave.config.walkOverFields = !!bot.cave.config.walkOverFields;

    bot.cave.updateConfig = function patchedUpdateConfig(nextConfig = {}) {
      const next = { ...nextConfig };
      if (Object.prototype.hasOwnProperty.call(next, "walkOverFields")) next.walkOverFields = !!next.walkOverFields;
      const result = originalUpdateConfig(next);
      patchFieldTiles(bot, !!result.walkOverFields);
      syncWalkOverFieldsControl(bot);
      return result;
    };

    bot.cave.status = function patchedStatus() {
      const result = originalStatus();
      if (result?.config) result.config.walkOverFields = !!bot.cave.config.walkOverFields;
      return result;
    };

    if (originalSavePreset) {
      bot.cave.savePreset = function patchedSavePreset(name, options = {}) {
        const result = originalSavePreset(name, options);
        if (result?.name) {
          const settings = readPresetSettings();
          settings[result.name] = !!bot.cave.config.walkOverFields;
          writePresetSettings(settings);
        }
        return result;
      };
    }

    if (originalLoadPreset) {
      bot.cave.loadPreset = function patchedLoadPreset(name) {
        const result = originalLoadPreset(name);
        if (result?.name) {
          const settings = readPresetSettings();
          if (Object.prototype.hasOwnProperty.call(settings, result.name)) {
            originalUpdateConfig({ walkOverFields: !!settings[result.name] });
          }
        }
        patchFieldTiles(bot, !!bot.cave.config.walkOverFields);
        syncWalkOverFieldsControl(bot);
        return result;
      };
    }

    if (originalDeletePreset) {
      bot.cave.deletePreset = function patchedDeletePreset(name) {
        const result = originalDeletePreset(name);
        if (result) {
          const settings = readPresetSettings();
          delete settings[String(name || "").trim()];
          writePresetSettings(settings);
        }
        return result;
      };
    }

    if (originalCreatePreset) {
      bot.cave.createPreset = function patchedCreatePreset(name) {
        const result = originalCreatePreset(name);
        if (result?.name) {
          const settings = readPresetSettings();
          settings[result.name] = !!bot.cave.config.walkOverFields;
          writePresetSettings(settings);
        }
        return result;
      };
    }

    const activePresetName = bot.cave.getActivePresetName?.();
    const settings = readPresetSettings();
    if (activePresetName && Object.prototype.hasOwnProperty.call(settings, activePresetName)) {
      originalUpdateConfig({ walkOverFields: !!settings[activePresetName] });
    }

    const scanTimerId = window.setInterval(() => {
      patchFieldTiles(bot, !!bot.cave?.config?.walkOverFields);
    }, 500);

    bot.caveWalkOverFields = { status: () => ({ enabled: !!bot.cave?.config?.walkOverFields, patchedTiles: bot.__caveWalkOverFieldsPatchedTiles?.length || 0 }) };
    bot.addCleanup?.(() => {
      window.clearInterval(scanTimerId);
      patchFieldTiles(bot, false);
      bot.__caveWalkOverFieldsPatchedTiles = [];
    });
    patchFieldTiles(bot, !!bot.cave.config.walkOverFields);
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing);
    return String(definition?.properties?.name || thing?.name || "").trim().toLowerCase();
  }

  function isExactActionTile(position) {
    const tile = position ? window.gameClient?.world?.getTileFromWorldPosition?.(new Position(position.x, position.y, position.z)) : null;
    if (!tile) return false;
    const things = [tile, ...(Array.isArray(tile.items) ? tile.items : [])];
    return things.some((thing) => {
      const definition = getThingDefinition(thing);
      const name = getThingName(thing);
      return !!definition?.properties?.floorchange || /\b(ladder|stairs|hole|rope spot|door|teleport)\b/i.test(name);
    });
  }

  function findClosestWalkableToleranceTile(from, waypoint, tolerance, walkOverFields) {
    const candidates = [];
    for (let dx = -tolerance; dx <= tolerance; dx += 1) {
      for (let dy = -tolerance; dy <= tolerance; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const position = { x: waypoint.x + dx, y: waypoint.y + dy, z: waypoint.z };
        const tile = window.gameClient?.world?.getTileFromWorldPosition?.(new Position(position.x, position.y, position.z));
        if (!tile) continue;
        const walkable = walkOverFields && tileHasField(tile) ? true : !!tile.isWalkable?.();
        if (!walkable) continue;
        candidates.push({
          position,
          distanceFromPlayer: Math.abs(position.x - from.x) + Math.abs(position.y - from.y),
          distanceFromWaypoint: Math.max(Math.abs(dx), Math.abs(dy)),
        });
      }
    }
    candidates.sort((a, b) => a.distanceFromPlayer - b.distanceFromPlayer || a.distanceFromWaypoint - b.distanceFromWaypoint);
    return candidates[0]?.position || null;
  }

  function patchGamePathfinder(bot) {
    const pathfinder = window.gameClient?.world?.pathfinder;
    if (!pathfinder || typeof pathfinder.findPath !== "function") return false;
    if (pathfinder.findPath.__caveWaypointTolerancePatched) return true;

    const originalFindPath = pathfinder.findPath;

    function findPathWithWaypointTolerance(fromValue, toValue, ...args) {
      const from = normalizePosition(fromValue);
      const to = normalizePosition(toValue);
      const caveStatus = bot.cave?.status?.() || null;
      const waypoint = normalizePosition(caveStatus?.currentWaypoint);
      const configuredTolerance = Number(caveStatus?.config?.waypointTolerance);
      const tolerance = Math.max(1, Number.isFinite(configuredTolerance) ? configuredTolerance : 1);

      const isCurrentSameFloorWaypoint =
        from && to && waypoint &&
        from.z === waypoint.z &&
        to.x === waypoint.x && to.y === waypoint.y && to.z === waypoint.z;

      if (isCurrentSameFloorWaypoint && !isExactActionTile(waypoint)) {
        const toleranceTarget = findClosestWalkableToleranceTile(from, waypoint, tolerance, !!caveStatus?.config?.walkOverFields);
        if (toleranceTarget) {
          const adjustedTarget = new Position(toleranceTarget.x, toleranceTarget.y, toleranceTarget.z);
          return originalFindPath.call(this, fromValue, adjustedTarget, ...args);
        }
      }

      return originalFindPath.call(this, fromValue, toValue, ...args);
    }

    findPathWithWaypointTolerance.__caveWaypointTolerancePatched = true;
    findPathWithWaypointTolerance.__originalFindPath = originalFindPath;
    pathfinder.findPath = findPathWithWaypointTolerance;
    return true;
  }

  function patchedInstallCaveModule(bot) {
    const savedConfig = bot.storage.get(configStorageKey, {}) || {};
    bot.storage.set(configStorageKey, {
      ...savedConfig,
      waypointTolerance: Math.max(1, Number(savedConfig.waypointTolerance) || 1),
      walkOverFields: !!savedConfig.walkOverFields,
    });

    const result = originalInstallCaveModule(bot);
    if (bot.cave) patchCaveInstance(bot);

    if (!patchGamePathfinder(bot)) {
      let attempts = 0;
      const timerId = window.setInterval(() => {
        attempts += 1;
        if (patchGamePathfinder(bot) || attempts >= 40) window.clearInterval(timerId);
      }, 250);
      bot.addCleanup?.(() => window.clearInterval(timerId));
    }
    return result;
  }

  patchedInstallCaveModule.__waypointTolerancePathingPatched = true;
  patchedInstallCaveModule.__originalInstallCaveModule = originalInstallCaveModule;
  bundle.installCaveModule = patchedInstallCaveModule;

  // The panel is installed later by main.js. Inject the toggle once the CaveBot UI exists.
  const panelTimerId = window.setInterval(() => {
    const bot = window.minibiaBot;
    const mode = document.getElementById("minibia-bot-cave-pathfinder-mode");
    if (!bot?.cave || !mode) return;
    if (document.getElementById("minibia-bot-cave-walk-over-fields")) {
      window.clearInterval(panelTimerId);
      return;
    }
    const label = document.createElement("label");
    label.className = "mb-toggle";
    label.innerHTML = '<input type="checkbox" id="minibia-bot-cave-walk-over-fields"><span>Walk Over Fields</span>';
    mode.parentElement?.insertAdjacentElement("afterend", label);
    const toggle = label.querySelector("input");
    if (toggle) {
      toggle.checked = !!bot.cave.config.walkOverFields;
      toggle.addEventListener("change", () => bot.cave.updateConfig({ walkOverFields: toggle.checked }));
    }
    window.clearInterval(panelTimerId);
  }, 250);

  window.setTimeout(() => {
    const bot = window.minibiaBot;
    if (bot) syncWalkOverFieldsControl(bot);
  }, 1000);
})(window.__minibiaBotBundle);
