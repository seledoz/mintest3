(() => {
  const STORAGE_KEY = "minibiaBot.lure.config";
  const TICK_MS = 120;
  const LOST_GRACE_MS = 10000;
  const ALWAYS_WALKABLE_FIRE_FIELD_IDS = new Set([2123, 2124, 2125]);

  function isAlwaysWalkableFireField(tile) {
    if (!tile) return false;
    const things = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(add);
      else if (!things.includes(value)) things.push(value);
    };
    add(tile); add(tile.items); add(tile.things); add(tile.objects); add(tile.topThing);
    try { add(tile.getItems?.()); } catch (_) {}
    try { add(tile.getThings?.()); } catch (_) {}
    try { add(tile.getObjects?.()); } catch (_) {}
    try { add(tile.getTopThing?.()); } catch (_) {}
    return things.some((thing) => ALWAYS_WALKABLE_FIRE_FIELD_IDS.has(
      Number(thing?.id ?? thing?.itemId ?? thing?.serverId ?? thing?.clientId)
    ));
  }

  function pos(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) }
      : null;
  }

  function cheb(a, b) {
    if (!a || !b || a.z !== b.z) return Infinity;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  function readConfig(bot) {
    const saved = bot.storage.get(STORAGE_KEY, {}) || {};
    return {
      enabled: !!saved.enabled,
      mode: Number(saved.mode) === 2 ? 2 : 1,
      minMonsters: Math.max(1, Math.min(20, Math.trunc(Number(saved.minMonsters) || 3))),
      maxDistance: Math.max(1, Math.min(7, Math.trunc(Number(saved.maxDistance) || 4))),
      stepDelayMs: Math.max(100, Math.min(2000, Math.trunc(Number(saved.stepDelayMs) || 450))),
    };
  }

  function writeConfig(bot, next) {
    bot.storage.set(STORAGE_KEY, { ...readConfig(bot), ...next });
  }

  function getMonsters(bot) {
    const me = pos(bot.getPlayerPosition?.() || window.gameClient?.player?.__position);
    if (!me) return [];
    const monsters = bot.attack?.getNearbyMonsters?.()
      || bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true })
      || [];
    return monsters
      .map((monster) => {
        const position = pos(monster?.getPosition?.() || monster?.__position || monster?.position);
        return { monster, position, distance: cheb(me, position) };
      })
      .filter((entry) => entry.position && entry.position.z === me.z)
      .filter((entry) => Math.abs(entry.position.x - me.x) <= 7 && Math.abs(entry.position.y - me.y) <= 5)
      .sort((a, b) => a.distance - b.distance);
  }

  function getTargetWaypoint(bot, me) {
    const cave = bot.cave?.status?.();
    const route = Array.isArray(cave?.route) ? cave.route.map(pos).filter(Boolean) : [];
    if (!route.length) return null;

    let index = Math.max(0, Math.min(route.length - 1, Math.trunc(Number(cave?.currentIndex) || 0)));
    let direction = Number(cave?.direction) < 0 ? -1 : 1;
    const tolerance = Math.max(1, Math.trunc(Number(cave?.config?.waypointTolerance) || 1));
    let target = route[index];

    // If Cavebot already considers this point reached, use the next route point.
    if (target && me && cheb(me, target) <= tolerance && route.length > 1) {
      let nextIndex = index + direction;
      if (nextIndex >= route.length) { direction = -1; nextIndex = route.length - 2; }
      else if (nextIndex < 0) { direction = 1; nextIndex = 1; }
      index = Math.max(0, Math.min(route.length - 1, nextIndex));
      target = route[index];
    }

    return target ? { ...target, index, direction } : null;
  }

  function getAdjacentStep(bot, me, target) {
    if (!me || !target || me.z !== target.z) return null;
    const candidates = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const p = { x: me.x + dx, y: me.y + dy, z: me.z };
        let walkable = true;
        try {
          const tile = window.gameClient?.world?.getTileFromWorldPosition?.(new Position(p.x, p.y, p.z));
          if (tile && typeof tile.isWalkable === "function") {
            walkable = isAlwaysWalkableFireField(tile) || !!tile.isWalkable();
          }
        } catch (_) {}
        if (!walkable) continue;
        candidates.push({ p, score: cheb(p, target) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.p || null;
  }

  function stopPathOnly() {
    const pf = window.gameClient?.world?.pathfinder;
    if (!pf) return;
    ["stop", "cancel", "clear", "clearPath", "stopWalking"].forEach((name) => {
      if (typeof pf[name] === "function") {
        try { pf[name](); } catch (_) {}
      }
    });
  }

  function install() {
    const bot = window.minibiaBot;
    if (!bot?.lureMode || !bot?.cave) return false;
    if (bot.lureMode2Replacement?.installed) return true;

    const legacy = bot.lureMode;
    const state = {
      timerId: null,
      active: false,
      caveWasRunning: false,
      nextStepAt: 0,
      lastMonsterSeenAt: 0,
      clearing: false,
      lastStep: null,
    };

    function setStatus(text) {
      const label = document.getElementById("minibia-bot-lure-status");
      if (label) label.textContent = text;
    }

    function pauseCave() {
      if (state.active) return;
      const caveStatus = bot.cave.status?.();
      state.caveWasRunning = !!caveStatus?.running;
      state.active = true;
      stopPathOnly();
      if (caveStatus?.running) bot.cave.stop?.({ persistEnabled: false });
    }

    function resumeCave() {
      const shouldResume = state.caveWasRunning;
      state.active = false;
      state.caveWasRunning = false;
      state.nextStepAt = 0;
      state.lastMonsterSeenAt = 0;
      state.clearing = false;
      state.lastStep = null;
      stopPathOnly();
      if (shouldResume) bot.cave.start?.();
    }

    function suppressAttack(suppress) {
      if (!bot.attack?.config) return;
      bot.attack.config.enabled = !suppress;
    }

    function tick() {
      const cfg = readConfig(bot);
      if (!cfg.enabled || cfg.mode !== 2) {
        if (state.active) resumeCave();
        return;
      }

      // Keep the legacy Mode 2 runtime stopped. Its timer is what was cancelling steps.
      if (legacy.status?.().running) legacy.stop?.({ persistEnabled: false });
      legacy.config.enabled = true;
      legacy.config.mode = 2;
      legacy.config.minMonsters = cfg.minMonsters;
      legacy.config.maxDistance = cfg.maxDistance;
      legacy.config.stepDelayMs = cfg.stepDelayMs;

      const monsters = getMonsters(bot);
      const me = pos(bot.getPlayerPosition?.());
      const target = bot.attack?.getCurrentTarget?.() || window.gameClient?.player?.__target || null;
      const combatActive = !!bot.attack?.status?.()?.combatActive;
      const farthest = monsters.length ? monsters[monsters.length - 1].distance : null;

      if (!state.active && monsters.length) pauseCave();

      if (monsters.length >= cfg.minMonsters || state.clearing) {
        pauseCave();
        state.clearing = true;
        suppressAttack(false);
        stopPathOnly();
        if (!target && monsters.length) bot.attack?.triggerAttack?.();
        if (!target && !combatActive && monsters.length === 0) {
          setStatus("Lure 2: pack cleared — resuming");
          resumeCave();
        } else {
          setStatus(`Lure 2: clearing ${monsters.length} left`);
        }
        return;
      }

      if (!state.active) {
        suppressAttack(false);
        setStatus(`Lure 2: looking 0/${cfg.minMonsters}`);
        return;
      }

      suppressAttack(true);

      if (monsters.length) {
        state.lastMonsterSeenAt = Date.now();

        if (farthest > cfg.maxDistance) {
          stopPathOnly();
          setStatus(`Lure 2: wait ${farthest}/${cfg.maxDistance}`);
          return;
        }

        if (Date.now() < state.nextStepAt) {
          setStatus("Lure 2: stepped — waiting for monster");
          return;
        }

        const waypoint = getTargetWaypoint(bot, me);
        if (!waypoint) {
          setStatus("Lure 2: no route waypoint");
          return;
        }

        const nextTile = getAdjacentStep(bot, me, waypoint);
        if (!nextTile) {
          setStatus("Lure 2: no walkable next tile");
          return;
        }

        // Important: ask Cavebot/game pathfinder to walk to ONE ADJACENT TILE only.
        // There is no longer a synthetic keyboard event and no long route to cancel.
        const moved = bot.cave.goToPosition?.(nextTile);
        if (moved !== false) {
          state.nextStepAt = Date.now() + cfg.stepDelayMs;
          state.lastStep = { from: me, to: nextTile, waypoint };
          setStatus(`Lure 2: one tile -> ${nextTile.x},${nextTile.y}`);
          bot.log?.("lure mode 2 replacement one-tile step", state.lastStep);
        }
        return;
      }

      const lostFor = state.lastMonsterSeenAt ? Date.now() - state.lastMonsterSeenAt : 0;
      if (state.lastMonsterSeenAt && lostFor >= LOST_GRACE_MS) {
        suppressAttack(false);
        setStatus("Lure 2: lure lost — resuming");
        resumeCave();
      } else {
        stopPathOnly();
        setStatus("Lure 2: holding lost monster");
      }
    }

    function startReplacement() {
      if (state.timerId != null) return;
      legacy.stop?.({ persistEnabled: false });
      state.timerId = window.setInterval(() => {
        try { tick(); } catch (error) { bot.log?.("lure mode 2 replacement tick failed", error?.message || error); }
      }, TICK_MS);
      tick();
    }

    function stopReplacement() {
      if (state.timerId != null) window.clearInterval(state.timerId);
      state.timerId = null;
      if (state.active) resumeCave();
    }

    // Capture panel changes before the legacy module sees them.
    document.addEventListener("change", (event) => {
      const id = event.target?.id;
      if (id !== "minibia-bot-lure-enabled" && id !== "minibia-bot-lure-mode") return;
      const modeEl = document.getElementById("minibia-bot-lure-mode");
      const enabledEl = document.getElementById("minibia-bot-lure-enabled");
      const mode = Number(modeEl?.value) === 2 ? 2 : 1;
      const enabled = !!enabledEl?.checked;
      writeConfig(bot, { mode, enabled });
      if (mode === 2 && enabled) startReplacement();
      else {
        stopReplacement();
        legacy.updateConfig?.({ mode, enabled });
      }
    }, true);

    document.addEventListener("input", (event) => {
      const map = {
        "minibia-bot-lure-min-monsters": "minMonsters",
        "minibia-bot-lure-max-distance": "maxDistance",
        "minibia-bot-lure-step-delay": "stepDelayMs",
      };
      const key = map[event.target?.id];
      if (!key) return;
      writeConfig(bot, { [key]: Number(event.target.value) });
    }, true);

    bot.lureMode2Replacement = {
      installed: true,
      start: startReplacement,
      stop: stopReplacement,
      status: () => ({ ...state, config: readConfig(bot) }),
    };

    const cfg = readConfig(bot);
    if (cfg.enabled && cfg.mode === 2) startReplacement();
    bot.addCleanup?.(stopReplacement);
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 100) window.clearInterval(timer);
  }, 100);
  install();
})();
