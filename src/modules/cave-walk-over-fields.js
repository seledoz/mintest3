window.__minibiaBotBundle = window.__minibiaBotBundle || {};

(function installCaveWalkOverFieldsPatch(bundle) {
  const originalInstallCaveModule = bundle.installCaveModule;
  if (typeof originalInstallCaveModule !== "function" || originalInstallCaveModule.__walkOverFieldsPatched) return;

  const configStorageKey = "minibiaBot.cave.config";
  const FIELD_IDS = new Set([1487, 1488, 1490, 1491, 1492, 1493, 1494, 1495, 1496, 1500, 1501]);

  function getThingDefinition(thing) {
    const id = Number(thing?.id);
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

  function tileThings(tile) {
    if (!tile) return [];
    const result = [tile];
    for (const key of ["items", "things", "objects"]) if (Array.isArray(tile[key])) result.push(...tile[key]);
    return result.filter(Boolean);
  }

  function isFieldTile(tile) {
    return tileThings(tile).some(isFieldThing);
  }

  function patchLoadedFieldTiles(bot, enabled) {
    const chunks = window.gameClient?.world?.chunks || [];
    const patched = [];
    if (!enabled) {
      const previous = bot.__caveWalkOverFieldsPatchedTiles || [];
      previous.forEach(({ tile, original }) => {
        try { if (tile && tile.isWalkable?.__caveWalkOverFieldsWrapper) tile.isWalkable = original; } catch (_) {}
      });
      bot.__caveWalkOverFieldsPatchedTiles = [];
      return 0;
    }
    for (const chunk of chunks) {
      if (!Array.isArray(chunk?.tiles)) continue;
      for (const tile of chunk.tiles) {
        if (!tile || typeof tile.isWalkable !== "function" || !isFieldTile(tile)) continue;
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
    if (patched.length) bot.__caveWalkOverFieldsPatchedTiles = [...(bot.__caveWalkOverFieldsPatchedTiles || []), ...patched];
    return patched.length;
  }

  function syncPanelToggle(bot) {
    const toggle = document.getElementById("minibia-bot-cave-walk-over-fields");
    if (toggle) toggle.checked = !!bot.cave?.config?.walkOverFields;
  }

  function patchCaveInstance(bot) {
    const originalUpdateConfig = bot.cave.updateConfig.bind(bot.cave);
    const originalStatus = bot.cave.status.bind(bot.cave);
    const originalSavePreset = bot.cave.savePreset?.bind(bot.cave);
    const originalLoadPreset = bot.cave.loadPreset?.bind(bot.cave);
    const originalDeletePreset = bot.cave.deletePreset?.bind(bot.cave);
    const state = { scanTimerId: null };

    bot.cave.config.walkOverFields = !!bot.cave.config.walkOverFields;

    bot.cave.updateConfig = function patchedUpdateConfig(nextConfig = {}) {
      const next = { ...nextConfig };
      if (Object.prototype.hasOwnProperty.call(next, "walkOverFields")) next.walkOverFields = !!next.walkOverFields;
      const result = originalUpdateConfig(next);
      patchLoadedFieldTiles(bot, !!result.walkOverFields);
      syncPanelToggle(bot);
      return result;
    };

    bot.cave.status = function patchedStatus() {
      const result = originalStatus();
      if (result?.config) result.config.walkOverFields = !!bot.cave.config.walkOverFields;
      return result;
    };

    const presetFieldKey = "minibiaBot.cave.walkOverFieldsPresets";
    const readPresetFieldSettings = () => bot.storage.get(presetFieldKey, {}) || {};
    const writePresetFieldSettings = (value) => bot.storage.set(presetFieldKey, value || {});

    if (originalSavePreset) {
      bot.cave.savePreset = function patchedSavePreset(name, options = {}) {
        const result = originalSavePreset(name, options);
        if (result?.name) {
          const settings = readPresetFieldSettings();
          settings[result.name] = !!bot.cave.config.walkOverFields;
          writePresetFieldSettings(settings);
        }
        return result;
      };
    }

    if (originalLoadPreset) {
      bot.cave.loadPreset = function patchedLoadPreset(name) {
        const result = originalLoadPreset(name);
        if (result?.name) {
          const settings = readPresetFieldSettings();
          if (Object.prototype.hasOwnProperty.call(settings, result.name)) {
            originalUpdateConfig({ walkOverFields: !!settings[result.name] });
          }
        }
        patchLoadedFieldTiles(bot, !!bot.cave.config.walkOverFields);
        syncPanelToggle(bot);
        return result;
      };
    }

    if (originalDeletePreset) {
      bot.cave.deletePreset = function patchedDeletePreset(name) {
        const result = originalDeletePreset(name);
        if (result) {
          const settings = readPresetFieldSettings();
          delete settings[String(name || "").trim()];
          writePresetFieldSettings(settings);
        }
        return result;
      };
    }

    const originalCreatePreset = bot.cave.createPreset?.bind(bot.cave);
    if (originalCreatePreset) {
      bot.cave.createPreset = function patchedCreatePreset(name) {
        const result = originalCreatePreset(name);
        if (result?.name) {
          const settings = readPresetFieldSettings();
          settings[result.name] = !!bot.cave.config.walkOverFields;
          writePresetFieldSettings(settings);
        }
        return result;
      };
    }

    const activePresetName = bot.cave.getActivePresetName?.();
    const savedPresetSettings = readPresetFieldSettings();
    if (activePresetName && Object.prototype.hasOwnProperty.call(savedPresetSettings, activePresetName)) {
      originalUpdateConfig({ walkOverFields: !!savedPresetSettings[activePresetName] });
    }

    state.scanTimerId = window.setInterval(() => {
      try { patchLoadedFieldTiles(bot, !!bot.cave?.config?.walkOverFields); } catch (_) {}
    }, 500);
    bot.addCleanup?.(() => {
      if (state.scanTimerId != null) window.clearInterval(state.scanTimerId);
      state.scanTimerId = null;
      patchLoadedFieldTiles(bot, false);
      bot.__caveWalkOverFieldsPatchedTiles = [];
    });
    bot.caveWalkOverFields = { status: () => ({ enabled: !!bot.cave?.config?.walkOverFields, patchedTiles: bot.__caveWalkOverFieldsPatchedTiles?.length || 0 }) };
    patchLoadedFieldTiles(bot, !!bot.cave.config.walkOverFields);
  }

  function patchedInstallCaveModule(bot) {
    const savedConfig = bot.storage.get(configStorageKey, {}) || {};
    bot.storage.set(configStorageKey, { ...savedConfig, walkOverFields: !!savedConfig.walkOverFields });
    const result = originalInstallCaveModule(bot);
    if (bot.cave) patchCaveInstance(bot);
    return result;
  }
  patchedInstallCaveModule.__walkOverFieldsPatched = true;
  patchedInstallCaveModule.__originalInstallCaveModule = originalInstallCaveModule;
  bundle.installCaveModule = patchedInstallCaveModule;

  const originalInstallPanel = bundle.installPanel;
  if (typeof originalInstallPanel === "function" && !originalInstallPanel.__walkOverFieldsPanelPatched) {
    function patchedInstallPanel(bot) {
      const result = originalInstallPanel(bot);
      const inject = bot.ui?.inject;
      if (typeof inject === "function" && !inject.__walkOverFieldsPanelPatched) {
        const originalInject = inject.bind(bot.ui);
        bot.ui.inject = function patchedPanelInject(...args) {
          const value = originalInject(...args);
          const caveSection = document.querySelector("#minibia-bot-cave-pathfinder-mode")?.closest(".mb-section");
          if (caveSection && !document.getElementById("minibia-bot-cave-walk-over-fields")) {
            const label = document.createElement("label");
            label.className = "mb-toggle";
            label.innerHTML = '<input type="checkbox" id="minibia-bot-cave-walk-over-fields"><span>Walk Over Fields</span>';
            const mode = document.getElementById("minibia-bot-cave-pathfinder-mode");
            mode?.parentElement?.insertAdjacentElement("afterend", label);
            const toggle = label.querySelector("input");
            if (toggle) {
              toggle.checked = !!bot.cave?.config?.walkOverFields;
              toggle.addEventListener("change", () => bot.cave?.updateConfig?.({ walkOverFields: toggle.checked }));
            }
          }
          return value;
        };
        bot.ui.inject.__walkOverFieldsPanelPatched = true;
      }
      return result;
    }
    patchedInstallPanel.__walkOverFieldsPanelPatched = true;
    bundle.installPanel = patchedInstallPanel;
  }
})(window.__minibiaBotBundle);
