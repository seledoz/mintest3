window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaveWaypointActionsModule = function installCaveWaypointActionsModule(bot) {
  const actionStorageKey = "minibiaBot.cave.waypointActions";
  const hasteSpellStorageKey = "minibiaBot.cave.waypointHasteSpells";
  const ropeNamePattern = /\brope\b/i;
  const shovelNamePattern = /\bshovel\b/i;
  const shovelTargetNamePatterns = [
    /\bhole\b/i,
    /\bstone pile\b/i,
    /\bloose stone pile\b/i,
    /\bgravel pile\b/i,
    /\bdirt pile\b/i,
  ];
  const noopAction = "walk";
  const ropeAction = "rope";
  const ropeSpellAction = "ropeSpell";
  const hasteAction = "haste";
  const shovelAction = "shovel";
  const ropeSpellText = "Exani Tera";
  const waitAction = "wait";
  const waitDurationMs = 60 * 1000;
  let lastToolUseAt = 0;
  let lastHandledKey = null;
  const ropeSpellState = {
    active: false,
    index: -1,
    startZ: null,
    sentAt: 0,
  };
  const hasteState = {
    lastCastKey: null,
  };
  const waitState = {
    active: false,
    presetName: null,
    index: -1,
    startedAt: 0,
    resumeAt: 0,
    timerId: null,
    completedKey: null,
  };

  function normalizePresetName(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized || "Default";
  }

  function normalizeAction(action) {
    if (action === ropeAction || action === ropeSpellAction || action === hasteAction || action === shovelAction || action === waitAction) return action;
    return noopAction;
  }

  function getActivePresetName() {
    return normalizePresetName(bot.cave?.getActivePresetName?.());
  }

  function readAllActions() {
    const raw = bot.storage.get(actionStorageKey, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function writeAllActions(next) {
    bot.storage.set(actionStorageKey, next);
    return next;
  }

  function getPresetActions(name = getActivePresetName()) {
    const allActions = readAllActions();
    const actions = allActions[normalizePresetName(name)];
    return Array.isArray(actions) ? actions.slice() : [];
  }

  function savePresetActions(actions, name = getActivePresetName()) {
    const allActions = readAllActions();
    const routeLength = bot.cave?.getRoute?.().length || 0;
    allActions[normalizePresetName(name)] = Array.from({ length: routeLength }, (_, index) => normalizeAction(actions[index]));
    writeAllActions(allActions);
    return allActions[normalizePresetName(name)].slice();
  }

  function getWaypointActions() {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    const actions = getPresetActions();
    return Array.from({ length: routeLength }, (_, index) => normalizeAction(actions[index]));
  }

  function readAllHasteSpells() {
    const raw = bot.storage.get(hasteSpellStorageKey, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function getPresetHasteSpells(name = getActivePresetName()) {
    const allSpells = readAllHasteSpells();
    const spells = allSpells[normalizePresetName(name)];
    return Array.isArray(spells) ? spells.slice() : [];
  }

  function savePresetHasteSpells(spells, name = getActivePresetName()) {
    const allSpells = readAllHasteSpells();
    const routeLength = bot.cave?.getRoute?.().length || 0;
    allSpells[normalizePresetName(name)] = Array.from(
      { length: routeLength },
      (_, index) => String(spells[index] || "").trim()
    );
    bot.storage.set(hasteSpellStorageKey, allSpells);
    return allSpells[normalizePresetName(name)].slice();
  }

  function getWaypointHasteSpells() {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    const spells = getPresetHasteSpells();
    return Array.from({ length: routeLength }, (_, index) => String(spells[index] || "").trim());
  }

  function setWaypointHasteSpell(index, spell) {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    const normalizedIndex = Math.trunc(Number(index));
    if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= routeLength) return null;

    const spells = getWaypointHasteSpells();
    spells[normalizedIndex] = String(spell || "").trim();
    savePresetHasteSpells(spells);
    bot.log("cave haste waypoint spell updated", { index: normalizedIndex + 1, spell: spells[normalizedIndex] });
    return spells[normalizedIndex];
  }

  function setLastWaypointHasteSpell(spell) {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    return routeLength ? setWaypointHasteSpell(routeLength - 1, spell) : null;
  }

  function setWaypointAction(index, action) {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    const normalizedIndex = Math.trunc(Number(index));
    if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= routeLength) return null;

    const actions = getWaypointActions();
    actions[normalizedIndex] = normalizeAction(action);
    savePresetActions(actions);
    bot.log("cave waypoint action updated", { index: normalizedIndex + 1, action: actions[normalizedIndex] });
    return actions[normalizedIndex];
  }

  function setLastWaypointAction(action) {
    const routeLength = bot.cave?.getRoute?.().length || 0;
    return routeLength ? setWaypointAction(routeLength - 1, action) : null;
  }

  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function getTilePosition(tile) {
    return normalizePosition(tile?.__position);
  }

  function getThingDefinition(itemId) {
    if (!itemId) return null;
    return (
      window.gameClient?.itemDefinitionsByCid?.[itemId] ||
      window.gameClient?.itemDefinitionsBySid?.[itemId] ||
      window.gameClient?.itemDefinitions?.[itemId] ||
      null
    );
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing?.id);
    return String(definition?.properties?.name || thing?.name || "").trim().toLowerCase();
  }

  function getTileThings(tile) {
    if (!tile) return [];
    const things = [];
    if (tile.id) things.push(tile);
    if (Array.isArray(tile.items)) {
      tile.items.forEach((item) => {
        if (item) things.push(item);
      });
    }
    return things;
  }

  function tileHasNamedThing(tile, needle) {
    const value = String(needle || "").trim().toLowerCase();
    return !!value && getTileThings(tile).some((thing) => getThingName(thing).includes(value));
  }

  function isRopeTargetTile(tile) {
    return tileHasNamedThing(tile, "hole") || tileHasNamedThing(tile, "rope spot");
  }

  function isShovelTargetThing(thing) {
    const name = getThingName(thing);
    return !!name && shovelTargetNamePatterns.some((pattern) => pattern.test(name));
  }

  function isShovelTargetTile(tile) {
    return getTileThings(tile).some((thing) => isShovelTargetThing(thing));
  }

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];
    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;
      for (const tile of chunk.tiles) {
        if (tile?.__position) tiles.push(tile);
      }
    }
    return tiles;
  }

  function isRopeItem(item) {
    const name = getThingName(item);
    return !!name && ropeNamePattern.test(name);
  }

  function isShovelItem(item) {
    const name = getThingName(item);
    return !!name && shovelNamePattern.test(name);
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function findToolSource(predicate) {
    const equipment = getEquipment();
    if (equipment?.slots) {
      for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
        const item = equipment.getSlotItem?.(slotIndex);
        if (predicate(item)) return { which: equipment, index: slotIndex, item, location: "equipment" };
      }
    }

    for (const container of getOpenContainers()) {
      const slots = container?.slots || [];
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const item = container.getSlotItem?.(slotIndex);
        if (predicate(item)) return { which: container, index: slotIndex, item, location: "container" };
      }
    }

    return null;
  }

  function findRopeSource() {
    return findToolSource(isRopeItem);
  }

  function findShovelSource() {
    return findToolSource(isShovelItem);
  }

  function distanceOnSameFloor(a, b) {
    if (!a || !b || a.z !== b.z) return Number.POSITIVE_INFINITY;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function isAtWaypoint(position, waypoint) {
    if (!position || !waypoint || position.z !== waypoint.z) return false;
    const actionIndex = Math.trunc(Number(bot.cave?.status?.()?.currentIndex) || 0);
    const action = getWaypointActions()[actionIndex];
    if (action === ropeSpellAction) {
      return position.x === waypoint.x && position.y === waypoint.y && position.z === waypoint.z;
    }
    const tolerance = Math.max(1, Math.trunc(Number(bot.cave?.status?.()?.config?.waypointTolerance) || 1));
    return Math.abs(position.x - waypoint.x) <= tolerance && Math.abs(position.y - waypoint.y) <= tolerance;
  }

  function isBesideOrSameTile(a, b) {
    return !!a && !!b && a.z === b.z && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  }

  function findNearestTargetTile(origin, preferredPosition = null, radius = 2, predicate = () => false) {
    if (!origin) return null;
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    getLoadedTiles().forEach((tile) => {
      const position = getTilePosition(tile);
      if (!position || position.z !== origin.z || !predicate(tile)) return;
      if (Math.abs(position.x - origin.x) > radius || Math.abs(position.y - origin.y) > radius) return;

      const score = distanceOnSameFloor(origin, position) * 10 +
        (preferredPosition ? distanceOnSameFloor(preferredPosition, position) : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { tile, position };
      }
    });

    return best;
  }

  function useToolOnNearestTarget({ action, tool, target, preferredPosition = null, missingToolLog, usedLog }) {
    const now = Date.now();
    if (now - lastToolUseAt < 250) return true;

    const playerPosition = normalizePosition(bot.getPlayerPosition?.());
    if (!playerPosition) return false;

    const targetEntry = findNearestTargetTile(playerPosition, preferredPosition, 2, target);
    if (!targetEntry || !isBesideOrSameTile(playerPosition, targetEntry.position)) return false;

    const toolEntry = tool();
    if (!toolEntry) {
      bot.log(missingToolLog);
      return false;
    }

    window.gameClient?.mouse?.__handleItemUseWith?.(
      { which: toolEntry.which, index: toolEntry.index },
      { which: targetEntry.tile, index: 0xFF }
    );
    lastToolUseAt = now;
    bot.log(usedLog, {
      action,
      source: targetEntry.position,
      toolLocation: toolEntry.location,
      toolSlot: toolEntry.index,
      toolName: getThingName(toolEntry.item),
    });
    return true;
  }

  function runRopeSpellWaypoint(index, waypoint, playerPosition) {
    if (!playerPosition || !waypoint) return false;

    if (ropeSpellState.active && ropeSpellState.index === index) {
      if (playerPosition.z !== ropeSpellState.startZ) {
        const fromZ = ropeSpellState.startZ;
        const toZ = playerPosition.z;
        ropeSpellState.active = false;
        ropeSpellState.index = -1;
        ropeSpellState.startZ = null;
        const status = bot.cave?.status?.();
        if (status?.running && Math.trunc(Number(status.currentIndex) || 0) === index) {
          const nextIndex = getNextRouteIndex(status);
          bot.cave?.setCurrentIndex?.(nextIndex);
        }
        bot.log("cave rope spell floor change detected", { index: index + 1, fromZ, toZ });
        return true;
      }
      return true;
    }

    if (playerPosition.x !== waypoint.x || playerPosition.y !== waypoint.y || playerPosition.z !== waypoint.z) return false;

    const sent = bot.sendChat?.(ropeSpellText);
    if (!sent) {
      bot.log("cave rope spell waypoint failed to send spell", { index: index + 1, spell: ropeSpellText });
      return false;
    }

    ropeSpellState.active = true;
    ropeSpellState.index = index;
    ropeSpellState.startZ = playerPosition.z;
    ropeSpellState.sentAt = Date.now();
    stopCurrentMovement();
    bot.log("cave rope spell cast", { index: index + 1, spell: ropeSpellText, position: playerPosition });
    return true;
  }


  function runHasteWaypoint(index, waypoint, playerPosition) {
    if (!playerPosition || !waypoint) return false;
    if (!isAtWaypoint(playerPosition, waypoint)) return false;

    const castKey = `${getActivePresetName()}:${index}`;
    if (hasteState.lastCastKey === castKey) return true;

    const spell = getWaypointHasteSpells()[index];
    if (!spell) {
      bot.log("cave haste waypoint skipped: no spell entered", { index: index + 1 });
      hasteState.lastCastKey = castKey;
      return true;
    }

    const sent = bot.sendChat?.(spell);
    if (!sent) {
      bot.log("cave haste waypoint failed to send spell", { index: index + 1, spell });
      return false;
    }

    hasteState.lastCastKey = castKey;
    bot.log("cave haste waypoint cast", { index: index + 1, spell, position: playerPosition });

    const status = bot.cave?.status?.();
    if (status?.running && Math.trunc(Number(status.currentIndex) || 0) === index) {
      bot.cave?.setCurrentIndex?.(getNextRouteIndex(status));
    }
    return true;
  }

  function useRopeOnNearestHole(preferredPosition = null) {
    return useToolOnNearestTarget({
      action: ropeAction,
      tool: findRopeSource,
      target: isRopeTargetTile,
      preferredPosition,
      missingToolLog: "cave rope waypoint skipped: no rope found",
      usedLog: "cave waypoint used rope",
    });
  }

  function useShovelOnNearestHole(preferredPosition = null) {
    return useToolOnNearestTarget({
      action: shovelAction,
      tool: findShovelSource,
      target: isShovelTargetTile,
      preferredPosition,
      missingToolLog: "cave shovel waypoint skipped: no shovel found",
      usedLog: "cave waypoint used shovel",
    });
  }

  function stopCurrentMovement() {
    const pathfinder = window.gameClient?.world?.pathfinder;
    try { pathfinder?.setPathfindCache?.(null); } catch (_) {}
    const targets = [pathfinder, window.gameClient?.player, window.gameClient?.world].filter(Boolean);
    ["stop", "cancel", "clear", "clearPath", "stopWalking", "cancelWalking", "stopAutoWalk", "reset"].forEach((name) => {
      targets.forEach((target) => {
        if (typeof target?.[name] !== "function") return;
        try { target[name](); } catch (_) {}
      });
    });
  }

  function clearWaitTimer() {
    if (waitState.timerId != null) {
      window.clearTimeout(waitState.timerId);
      waitState.timerId = null;
    }
  }

  function finishWaypointWait() {
    if (!waitState.active) return false;
    const presetName = waitState.presetName;
    const index = waitState.index;
    const waitKey = `${presetName}:${index}`;
    clearWaitTimer();
    waitState.active = false;
    waitState.startedAt = 0;
    waitState.resumeAt = 0;
    waitState.completedKey = waitKey;

    const actions = getWaypointActions();
    const samePreset = getActivePresetName() === presetName;
    const sameWaitWaypoint = actions[index] === waitAction;
    const manuallyPaused = !!bot.pauseBreak?.status?.()?.paused;
    const stillEnabled = bot.cave?.config?.enabled !== false;

    if (!samePreset || !sameWaitWaypoint || manuallyPaused || !stillEnabled) {
      bot.log("waypoint wait finished without auto-resume", { index: index + 1, samePreset, sameWaitWaypoint, manuallyPaused, stillEnabled });
      return false;
    }

    bot.log("waypoint wait finished", { index: index + 1, waitMs: waitDurationMs });
    return !!bot.cave?.start?.();
  }

  function startWaypointWait(status, index, waypoint) {
    if (waitState.active) return true;
    const presetName = getActivePresetName();
    const waitKey = `${presetName}:${index}`;
    if (waitState.completedKey === waitKey) return false;

    waitState.active = true;
    waitState.presetName = presetName;
    waitState.index = index;
    waitState.startedAt = Date.now();
    waitState.resumeAt = waitState.startedAt + waitDurationMs;

    stopCurrentMovement();
    bot.cave?.stop?.({ persistEnabled: false });
    stopCurrentMovement();
    bot.log("waypoint wait started", { index: index + 1, waitMs: waitDurationMs, waypoint });

    waitState.timerId = window.setTimeout(finishWaypointWait, waitDurationMs);
    return true;
  }

  function getNextRouteIndex(status) {
    const route = bot.cave?.getRoute?.() || [];
    if (route.length <= 1) return 0;

    const currentIndex = Math.max(0, Math.min(route.length - 1, Math.trunc(Number(status?.currentIndex) || 0)));
    let direction = Number(status?.direction) || 1;
    let nextIndex = currentIndex + direction;

    if (nextIndex >= route.length) {
      nextIndex = route.length - 2;
    } else if (nextIndex < 0) {
      nextIndex = 1;
    }

    return Math.max(0, Math.min(route.length - 1, nextIndex));
  }

  function runWaypointActionCheck() {
    const status = bot.cave?.status?.();

    if (waitState.completedKey && status?.running) {
      const currentKey = `${getActivePresetName()}:${Math.trunc(Number(status.currentIndex) || 0)}`;
      if (currentKey !== waitState.completedKey) waitState.completedKey = null;
    }

    if (!status?.running) return;

    const route = bot.cave?.getRoute?.() || [];
    const index = Math.trunc(Number(status.currentIndex) || 0);
    const waypoint = route[index];
    const actions = getWaypointActions();
    const action = actions[index];

    if (!waypoint || action === noopAction) return;

    if (hasteState.lastCastKey) {
      const currentHasteKey = `${getActivePresetName()}:${index}`;
      if (currentHasteKey !== hasteState.lastCastKey) hasteState.lastCastKey = null;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition?.());
    if (action !== ropeSpellAction && ropeSpellState.active && ropeSpellState.index === index) {
      ropeSpellState.active = false;
      ropeSpellState.index = -1;
      ropeSpellState.startZ = null;
    }
    if (action === ropeSpellAction) {
      runRopeSpellWaypoint(index, waypoint, playerPosition);
      return;
    }
    if (action === hasteAction) {
      runHasteWaypoint(index, waypoint, playerPosition);
      return;
    }
    if (action === waitAction) {
      if (isAtWaypoint(playerPosition, waypoint)) startWaypointWait(status, index, waypoint);
      return;
    }

    const distance = distanceOnSameFloor(playerPosition, waypoint);
    if (!Number.isFinite(distance) || distance > 2) return;

    const actionKey = `${action}:${index}:${getPositionKey(playerPosition)}`;
    if (actionKey === lastHandledKey && Date.now() - lastToolUseAt < 2000) return;

    const used = action === ropeAction
      ? useRopeOnNearestHole(waypoint)
      : action === shovelAction
        ? useShovelOnNearestHole(waypoint)
        : false;

    if (used) {
      lastHandledKey = actionKey;
      window.setTimeout(() => {
        const nextStatus = bot.cave?.status?.();
        if (!nextStatus?.running) return;
        const nextIndex = getNextRouteIndex(status);
        bot.cave?.setCurrentIndex?.(nextIndex);
      }, 700);
    }
  }

  const originalAddWaypoint = bot.cave?.addWaypoint?.bind(bot.cave);
  const originalAddWaypointCurrentSpot = bot.cave?.addWaypointCurrentSpot?.bind(bot.cave);
  const originalRemoveLastWaypoint = bot.cave?.removeLastWaypoint?.bind(bot.cave);
  const originalClearWaypoints = bot.cave?.clearWaypoints?.bind(bot.cave);
  const originalCreatePreset = bot.cave?.createPreset?.bind(bot.cave);
  const originalLoadPreset = bot.cave?.loadPreset?.bind(bot.cave);
  const originalSavePreset = bot.cave?.savePreset?.bind(bot.cave);

  if (originalAddWaypoint) {
    bot.cave.addWaypoint = (waypoint, options = {}) => {
      const added = originalAddWaypoint(waypoint);
      if (added) setLastWaypointAction(options.action);
      return added;
    };
  }

  if (originalAddWaypointCurrentSpot) {
    bot.cave.addWaypointCurrentSpot = (options = {}) => {
      const added = originalAddWaypointCurrentSpot();
      if (added) setLastWaypointAction(options.action);
      return added;
    };
  }

  if (originalRemoveLastWaypoint) {
    bot.cave.removeLastWaypoint = () => {
      const removed = originalRemoveLastWaypoint();
      if (removed) savePresetActions(getWaypointActions().slice(0, -1));
      return removed;
    };
  }

  if (originalClearWaypoints) {
    bot.cave.clearWaypoints = () => {
      const result = originalClearWaypoints();
      savePresetActions([]);
      return result;
    };
  }

  if (originalCreatePreset) {
    bot.cave.createPreset = (name) => {
      const result = originalCreatePreset(name);
      if (result) savePresetActions([], result.name);
      return result;
    };
  }

  if (originalLoadPreset) {
    bot.cave.loadPreset = (name) => {
      const result = originalLoadPreset(name);
      if (result) savePresetActions(getPresetActions(result.name), result.name);
      return result;
    };
  }

  if (originalSavePreset) {
    bot.cave.savePreset = (name, options = {}) => {
      const result = originalSavePreset(name, options);
      if (result) savePresetActions(getWaypointActions(), result.name);
      return result;
    };
  }

  const actionTimerId = window.setInterval(() => {
    try {
      runWaypointActionCheck();
    } catch (error) {
      bot.log("cave waypoint action failed", error?.message || error);
    }
  }, 100);

  bot.addCleanup(() => {
    window.clearInterval(actionTimerId);
    clearWaitTimer();
    ropeSpellState.active = false;
    ropeSpellState.index = -1;
    ropeSpellState.startZ = null;
  });

  function installPanelControls() {
    const recordButton = document.getElementById("minibia-bot-cave-add");
    if (!recordButton) return;

    let select = document.getElementById("minibia-bot-cave-waypoint-action");
    if (!select) {
      const wrapper = document.createElement("label");
      wrapper.className = "mb-field";
      wrapper.setAttribute("for", "minibia-bot-cave-waypoint-action");

      const label = document.createElement("span");
      label.className = "mb-field-label";
      label.textContent = "Waypoint Action";

      select = document.createElement("select");
      select.id = "minibia-bot-cave-waypoint-action";

      const walkOption = document.createElement("option");
      walkOption.value = noopAction;
      walkOption.textContent = "Walk";

      const ropeOption = document.createElement("option");
      ropeOption.value = ropeAction;
      ropeOption.textContent = "Use Rope";

      const ropeSpellOption = document.createElement("option");
      ropeSpellOption.value = ropeSpellAction;
      ropeSpellOption.textContent = "Rope Spell (Exani Tera)";

      const hasteOption = document.createElement("option");
      hasteOption.value = hasteAction;
      hasteOption.textContent = "Haste Waypoint";

      const shovelOption = document.createElement("option");
      shovelOption.value = shovelAction;
      shovelOption.textContent = "Use Shovel";

      const waitOption = document.createElement("option");
      waitOption.value = waitAction;
      waitOption.textContent = "Waypoint Wait (1 Minute)";

      select.appendChild(walkOption);
      select.appendChild(ropeOption);
      select.appendChild(ropeSpellOption);
      select.appendChild(hasteOption);
      select.appendChild(shovelOption);
      select.appendChild(waitOption);
      wrapper.appendChild(label);
      wrapper.appendChild(select);

      recordButton.closest(".mb-row")?.insertAdjacentElement("afterend", wrapper);

      const hasteSpellLabel = document.createElement("label");
      hasteSpellLabel.className = "mb-field";
      hasteSpellLabel.setAttribute("for", "minibia-bot-cave-haste-spell");

      const hasteSpellText = document.createElement("span");
      hasteSpellText.className = "mb-field-label";
      hasteSpellText.textContent = "Haste Spell";

      const hasteSpellInput = document.createElement("input");
      hasteSpellInput.type = "text";
      hasteSpellInput.id = "minibia-bot-cave-haste-spell";
      hasteSpellInput.placeholder = "Enter spell, e.g. utani hur";
      hasteSpellInput.autocomplete = "off";
      hasteSpellLabel.appendChild(hasteSpellText);
      hasteSpellLabel.appendChild(hasteSpellInput);
      wrapper.insertAdjacentElement("afterend", hasteSpellLabel);

      const syncHasteSpellVisibility = () => {
        const isHaste = select.value === hasteAction;
        hasteSpellLabel.style.display = isHaste ? "" : "none";
        if (isHaste) {
          const actions = getWaypointActions();
          const index = Math.max(0, (bot.cave?.getRoute?.().length || 1) - 1);
          hasteSpellInput.value = getWaypointHasteSpells()[index] || "";
        }
      };

      select.addEventListener("change", syncHasteSpellVisibility);

      recordButton.addEventListener("click", () => {
        window.setTimeout(() => {
          const action = select.value;
          setLastWaypointAction(action);
          if (action === hasteAction) setLastWaypointHasteSpell(hasteSpellInput.value);
          syncHasteSpellVisibility();
        }, 0);
      });

      hasteSpellInput.addEventListener("change", () => {
        if (select.value === hasteAction) setLastWaypointHasteSpell(hasteSpellInput.value);
      });

      syncHasteSpellVisibility();
    }

    if (!document.getElementById("minibia-bot-cave-record-wait")) {
      const waitButton = document.createElement("button");
      waitButton.type = "button";
      waitButton.id = "minibia-bot-cave-record-wait";
      waitButton.className = recordButton.className;
      waitButton.textContent = "Add Waypoint Wait";
      waitButton.title = "Add a waypoint at your current position that pauses Cavebot movement for 1 minute";
      waitButton.addEventListener("click", () => {
        const added = bot.cave?.addWaypointCurrentSpot?.({ action: waitAction });
        if (added) bot.log("waypoint wait added", { waypoint: added, waitMs: waitDurationMs });
      });
      recordButton.insertAdjacentElement("afterend", waitButton);
    }
  }

  function patchUiInject() {
    if (!bot.ui?.inject || bot.ui.__caveWaypointActionsPatched) return;
    const originalInject = bot.ui.inject.bind(bot.ui);
    bot.ui.inject = (...args) => {
      const result = originalInject(...args);
      installPanelControls();
      return result;
    };
    bot.ui.__caveWaypointActionsPatched = true;
  }

  patchUiInject();
  window.setTimeout(patchUiInject, 0);

  bot.cave.getWaypointActions = getWaypointActions;
  bot.cave.setWaypointAction = setWaypointAction;
  bot.cave.setLastWaypointAction = setLastWaypointAction;
  bot.cave.getWaypointHasteSpells = getWaypointHasteSpells;
  bot.cave.setWaypointHasteSpell = setWaypointHasteSpell;
  bot.cave.setLastWaypointHasteSpell = setLastWaypointHasteSpell;
  bot.cave.useRopeOnNearestHole = useRopeOnNearestHole;
  bot.cave.isWaypointActionBlocking = (index) => getWaypointActions()[Math.trunc(Number(index) || 0)] === ropeSpellAction;
  bot.cave.useShovelOnNearestHole = useShovelOnNearestHole;
  bot.cave.waypointWaitStatus = () => ({
    active: waitState.active,
    index: waitState.index,
    startedAt: waitState.startedAt,
    resumeAt: waitState.resumeAt,
    remainingMs: waitState.active ? Math.max(0, waitState.resumeAt - Date.now()) : 0,
    durationMs: waitDurationMs,
  });
};
