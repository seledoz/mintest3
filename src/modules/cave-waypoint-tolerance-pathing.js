window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installCaveWaypointTolerancePathingPatch(bundle) {
  const originalInstallCaveModule = bundle.installCaveModule;
  if (typeof originalInstallCaveModule !== "function") return;
  if (originalInstallCaveModule.__waypointTolerancePathingPatched) return;

  const configStorageKey = "minibiaBot.cave.config";
  const presetFieldKey = "minibiaBot.cave.walkOverFieldsPresets";
  // Support both the classic Tibia field IDs and the older OTServer-style IDs.
  const FIRE_FIELD_IDS = new Set([
    1487, 1488, 1489,
    1492, 1493, 1494,
    1500, 1501, 1502,
    2118, 2119, 2120,
    2123, 2124, 2125,
    2131, 2132, 2133,
  ]);

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getThingDefinition(item) {
    const id = Number(item?.id ?? item?.itemId ?? item?.serverId ?? item?.clientId);
    if (!Number.isFinite(id)) return null;
    return window.gameClient?.itemDefinitionsByCid?.[id]
      || window.gameClient?.itemDefinitionsBySid?.[id]
      || window.gameClient?.itemDefinitions?.[id]
      || null;
  }

  function getTileThings(tile) {
    if (!tile) return [];
    const result = [tile];
    for (const accessor of ["getThings", "getItems", "getObjects"]) {
      try {
        const value = tile?.[accessor]?.();
        if (Array.isArray(value)) result.push(...value);
      } catch (_) {}
    }
    for (const key of ["items", "things", "objects"]) {
      if (Array.isArray(tile?.[key])) result.push(...tile[key]);
    }
    return result;
  }

  function isFireFieldThing(thing) {
    if (!thing) return false;
    const id = Number(thing.id ?? thing.itemId ?? thing.serverId ?? thing.clientId);
    if (FIRE_FIELD_IDS.has(id)) return true;
    const definition = getThingDefinition(thing);
    const name = String(
      thing.name || thing.itemName || definition?.name || definition?.properties?.name || ""
    ).trim();
    if (/\bfire\s*field\b/i.test(name)) return true;
    const field = String(thing.field ?? thing.fieldType ?? definition?.field ?? definition?.properties?.field ?? "").trim();
    const type = String(thing.type ?? thing.thingType ?? definition?.type ?? definition?.properties?.type ?? "").trim();
    return /fire/i.test(field) || (/fire/i.test(name) && /field/i.test(type));
  }

  function tileHasFireField(tile) {
    return getTileThings(tile).some(isFireFieldThing);
  }

  function getTile(position) {
    if (!position) return null;
    try {
      return window.gameClient?.world?.getTileFromWorldPosition?.(
        new Position(position.x, position.y, position.z)
      ) || null;
    } catch (_) {
      return null;
    }
  }

  function clearNativePathCache(bot) {
    try {
      window.gameClient?.world?.pathfinder?.setPathfindCache?.(null);
    } catch (_) {}
    try {
      window.gameClient?.world?.pathfinder?.clearCache?.();
    } catch (_) {}
    try {
      bot.cave?.clearPathCache?.();
    } catch (_) {}
  }

  function patchFieldPrototype(bot) {
    const player = normalizePosition(bot.getPlayerPosition?.());
    const tile = getTile(player);
    const prototype = tile && Object.getPrototypeOf(tile);
    if (!prototype || typeof prototype.isWalkable !== "function") return false;
    if (prototype.__caveWalkOverFieldsOriginalIsWalkable) return true;

    const original = prototype.isWalkable;
    const wrapper = function caveWalkOverFieldsPrototypeIsWalkable(...args) {
      if (bot.cave?.config?.walkOverFields && tileHasFireField(this)) return true;
      return original.apply(this, args);
    };
    wrapper.__caveWalkOverFieldsWrapper = true;
    prototype.__caveWalkOverFieldsOriginalIsWalkable = original;
    prototype.isWalkable = wrapper;
    bot.__caveWalkOverFieldsPrototype = prototype;
    return true;
  }

  function restoreFieldPrototype(bot) {
    const prototype = bot.__caveWalkOverFieldsPrototype;
    const original = prototype?.__caveWalkOverFieldsOriginalIsWalkable;
    if (prototype && original) {
      prototype.isWalkable = original;
      delete prototype.__caveWalkOverFieldsOriginalIsWalkable;
    }
    bot.__caveWalkOverFieldsPrototype = null;
  }

  function syncWalkOverFieldsControl(bot) {
    const toggle = document.getElementById("minibia-bot-cave-walk-over-fields");
    if (toggle) toggle.checked = !!bot.cave?.config?.walkOverFields;
  }

  function patchCaveInstance(bot) {
    if (!bot.cave || bot.cave.__walkOverFieldsPatched) return;
    bot.cave.__walkOverFieldsPatched = true;

    const originalUpdateConfig = bot.cave.updateConfig.bind(bot.cave);
    const originalStatus = bot.cave.status.bind(bot.cave);
    const originalSavePreset = bot.cave.savePreset?.bind(bot.cave);
    const originalLoadPreset = bot.cave.loadPreset?.bind(bot.cave);
    const originalDeletePreset = bot.cave.deletePreset?.bind(bot.cave);
    const originalCreatePreset = bot.cave.createPreset?.bind(bot.cave);
    const originalGoToWaypoint = bot.cave.goToWaypoint?.bind(bot.cave);
    const originalGoToPosition = bot.cave.goToPosition?.bind(bot.cave);

    bot.cave.config.walkOverFields = !!bot.cave.config.walkOverFields;

    bot.cave.updateConfig = function patchedUpdateConfig(nextConfig = {}) {
      const next = { ...nextConfig };
      if (Object.prototype.hasOwnProperty.call(next, "walkOverFields")) next.walkOverFields = !!next.walkOverFields;
      const result = originalUpdateConfig(next);
      clearNativePathCache(bot);
      if (result?.walkOverFields) patchFieldPrototype(bot);
      else restoreFieldPrototype(bot);
      syncWalkOverFieldsControl(bot);
      return result;
    };

    bot.cave.status = function patchedStatus() {
      const result = originalStatus();
      if (result?.config) result.config.walkOverFields = !!bot.cave.config.walkOverFields;
      return result;
    };

    if (originalGoToWaypoint) {
      bot.cave.goToWaypoint = function patchedGoToWaypoint(waypoint) {
        if (bot.cave.config.walkOverFields) {
          patchFieldPrototype(bot);
          clearNativePathCache(bot);
        }
        return originalGoToWaypoint(waypoint);
      };
    }

    if (originalGoToPosition) {
      bot.cave.goToPosition = function patchedGoToPosition(position) {
        if (bot.cave.config.walkOverFields) {
          patchFieldPrototype(bot);
          clearNativePathCache(bot);
        }
        return originalGoToPosition(position);
      };
    }

    function readPresetSettings() { return bot.storage.get(presetFieldKey, {}) || {}; }
    function writePresetSettings(settings) { bot.storage.set(presetFieldKey, settings || {}); }

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
        clearNativePathCache(bot);
        if (bot.cave.config.walkOverFields) patchFieldPrototype(bot);
        else restoreFieldPrototype(bot);
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

    if (bot.cave.config.walkOverFields) patchFieldPrototype(bot);

    bot.caveWalkOverFields = {
      status: () => ({ enabled: !!bot.cave?.config?.walkOverFields, prototypePatched: !!bot.__caveWalkOverFieldsPrototype }),
    };

    bot.addCleanup?.(() => restoreFieldPrototype(bot));
  }

  function findClosestWalkableToleranceTile(from, waypoint, tolerance, walkOverFields) {
    const candidates = [];
    for (let dx = -tolerance; dx <= tolerance; dx += 1) {
      for (let dy = -tolerance; dy <= tolerance; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const position = { x: waypoint.x + dx, y: waypoint.y + dy, z: waypoint.z };
        const tile = getTile(position);
        if (!tile) continue;
        const walkable = walkOverFields && tileHasFireField(tile) ? true : !!tile.isWalkable?.();
        if (!walkable) continue;
        candidates.push({ position, distanceFromPlayer: Math.abs(position.x - from.x) + Math.abs(position.y - from.y), distanceFromWaypoint: Math.max(Math.abs(dx), Math.abs(dy)) });
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
      if (bot.cave?.config?.walkOverFields) {
        patchFieldPrototype(bot);
        clearNativePathCache(bot);
      }
      const from = normalizePosition(fromValue);
      const to = normalizePosition(toValue);
      const caveStatus = bot.cave?.status?.() || null;
      const waypoint = normalizePosition(caveStatus?.currentWaypoint);
      const configuredTolerance = Number(caveStatus?.config?.waypointTolerance);
      const tolerance = Math.max(1, Number.isFinite(configuredTolerance) ? configuredTolerance : 1);
      const walkOverFields = !!caveStatus?.config?.walkOverFields;
      const isCurrentSameFloorWaypoint = from && to && waypoint && from.z === waypoint.z && to.x === waypoint.x && to.y === waypoint.y && to.z === waypoint.z;
      const currentIndex = Math.trunc(Number(caveStatus?.currentWaypointIndex ?? caveStatus?.currentIndex) || 0);
      const currentAction = bot.cave?.getWaypointActions?.()[currentIndex];
      // Rope Spell is always an exact-tile action. Do not apply waypoint
      // tolerance even if the hole's item definition does not expose a
      // floorchange/name property.
      const isCurrentRopeSpell = currentAction === "ropeSpell";
      if (isCurrentSameFloorWaypoint && !isCurrentRopeSpell && !isExactActionTile(waypoint)) {
        const toleranceTarget = findClosestWalkableToleranceTile(from, waypoint, tolerance, walkOverFields);
        if (toleranceTarget) return originalFindPath.call(this, fromValue, new Position(toleranceTarget.x, toleranceTarget.y, toleranceTarget.z), ...args);
      }
      return originalFindPath.call(this, fromValue, toValue, ...args);
    }

    function isExactActionTile(position) {
      const tile = getTile(position);
      if (!tile) return false;
      return getTileThings(tile).some((thing) => {
        const definition = getThingDefinition(thing);
        const name = String(thing?.name || definition?.properties?.name || "");
        return !!definition?.properties?.floorchange || /\b(ladder|stairs|hole|rope spot|door|teleport)\b/i.test(name);
      });
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