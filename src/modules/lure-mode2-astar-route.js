(() => {
  const STORAGE_KEY = "minibiaBot.lure.config";
  const TICK_MS = 120;
  const LOST_GRACE_MS = 10000;
  const MATRIX_CACHE_MS = 500;
  const STUCK_RETRY_LIMIT = 2;
  const BLOCKED_TILE_MS = 2500;

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

  function samePos(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
  }

  function tileKey(p) {
    return p ? `${p.x},${p.y}` : "";
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

  function stopPathOnly() {
    const pf = window.gameClient?.world?.pathfinder;
    if (!pf) return;
    ["stop", "cancel", "clear", "clearPath", "stopWalking"].forEach((name) => {
      if (typeof pf[name] === "function") {
        try { pf[name](); } catch (_) {}
      }
    });
  }

  const matrixCache = new Map();
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

  function getWalkMatrix(z) {
    const key = String(z);
    const cached = matrixCache.get(key);
    if (cached && Date.now() - cached.at <= MATRIX_CACHE_MS) return cached.matrix;

    const matrix = new Map();
    const chunks = window.gameClient?.world?.chunks || [];
    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;
      for (const tile of chunk.tiles) {
        const p = pos(tile?.__position);
        if (!p || p.z !== z) continue;
        let walkable = false;
        try { walkable = isAlwaysWalkableFireField(tile) || !!tile.isWalkable?.(); } catch (_) {}
        matrix.set(`${p.x},${p.y}`, walkable);
      }
    }
    matrixCache.set(key, { at: Date.now(), matrix });
    return matrix;
  }

  function neighbors(node, matrix, temporarilyBlocked) {
    const dirs = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    return dirs
      .map((d) => ({ x: node.x + d.x, y: node.y + d.y, z: node.z, dx: d.x, dy: d.y }))
      .filter((p) => {
        if (matrix.get(`${p.x},${p.y}`) !== true) return false;
        if (temporarilyBlocked?.has(`${p.x},${p.y}`)) return false;

        // Never squeeze diagonally through the corner of a wall. Both cardinal
        // side tiles must be walkable before a diagonal step is considered safe.
        if (p.dx !== 0 && p.dy !== 0) {
          const sideA = `${node.x + p.dx},${node.y}`;
          const sideB = `${node.x},${node.y + p.dy}`;
          if (matrix.get(sideA) !== true || matrix.get(sideB) !== true) return false;
          if (temporarilyBlocked?.has(sideA) || temporarilyBlocked?.has(sideB)) return false;
        }
        return true;
      })
      .map(({ x, y, z }) => ({ x, y, z }));
  }

  function reconstruct(node) {
    const path = [];
    let current = node;
    while (current) {
      path.unshift({ x: current.x, y: current.y, z: current.z });
      current = current.parent;
    }
    return path;
  }

  function findPathAStar(start, goal, tolerance = 0, options = {}) {
    const from = pos(start);
    const to = pos(goal);
    if (!from || !to || from.z !== to.z) return null;
    if (cheb(from, to) <= tolerance) return [from];

    const matrix = getWalkMatrix(from.z);
    const temporarilyBlocked = options.temporarilyBlocked || null;
    const avoidFirstStep = pos(options.avoidFirstStep);
    const open = [{ ...from, g: 0, f: cheb(from, to), parent: null }];
    const closed = new Set();
    const key = (p) => `${p.x},${p.y}`;
    let iterations = 0;

    while (open.length && iterations < 5000) {
      iterations += 1;
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].f < open[bestIndex].f) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      if (cheb(current, to) <= tolerance) return reconstruct(current);
      closed.add(key(current));

      for (const next of neighbors(current, matrix, temporarilyBlocked)) {
        const nextKey = key(next);
        if (closed.has(nextKey)) continue;
        const diagonal = next.x !== current.x && next.y !== current.y;
        let stepCost = diagonal ? 1.4 : 1;

        // A fresh A* calculation happens every paced step. Penalize an immediate
        // return to the tile we just came from so equal-cost routes do not make
        // the character bounce back and forth. It is only a penalty, not a ban,
        // so a dead end can still backtrack when that is the only valid route.
        if (current.parent == null && avoidFirstStep && samePos(next, avoidFirstStep)) {
          stepCost += 3;
        }

        const g = current.g + stepCost;
        const f = g + cheb(next, to);
        const existing = open.find((entry) => entry.x === next.x && entry.y === next.y);
        if (existing) {
          if (g < existing.g) {
            existing.g = g;
            existing.f = f;
            existing.parent = current;
          }
        } else {
          open.push({ ...next, g, f, parent: current });
        }
      }
    }
    return null;
  }

  function install() {
    const bot = window.minibiaBot;
    if (!bot?.cave || !bot?.lureMode) return false;
    if (bot.lureMode2AstarRoute?.installed) return true;

    try { bot.lureMode2Replacement?.stop?.(); } catch (_) {}
    try { bot.lureMode2RouteProgress?.stop?.(); } catch (_) {}

    const legacy = bot.lureMode;
    const state = {
      timerId: null,
      active: false,
      caveWasRunning: false,
      route: [],
      routeIndex: 0,
      direction: 1,
      tolerance: 1,
      nextStepAt: 0,
      lastMonsterSeenAt: 0,
      clearing: false,
      lastStep: null,
      anchorInitialized: false,
      stuckRetries: 0,
      blockedTiles: new Map(),
    };

    function setStatus(text) {
      const label = document.getElementById("minibia-bot-lure-status");
      if (label) label.textContent = text;
    }

    function pruneBlockedTiles() {
      const now = Date.now();
      for (const [key, until] of state.blockedTiles.entries()) {
        if (until <= now) state.blockedTiles.delete(key);
      }
    }

    function activeBlockedKeys() {
      pruneBlockedTiles();
      return new Set(state.blockedTiles.keys());
    }

    function markBlocked(p) {
      if (!p) return;
      state.blockedTiles.set(tileKey(p), Date.now() + BLOCKED_TILE_MS);
      matrixCache.delete(String(p.z));
    }

    function advanceIndex() {
      if (state.route.length <= 1) return;
      let nextIndex = state.routeIndex + state.direction;
      if (nextIndex >= state.route.length) {
        state.direction = -1;
        nextIndex = state.route.length - 2;
      } else if (nextIndex < 0) {
        state.direction = 1;
        nextIndex = 1;
      }
      state.routeIndex = Math.max(0, Math.min(state.route.length - 1, nextIndex));
    }

    function syncRouteOnceFromCave() {
      const cave = bot.cave.status?.();
      state.route = Array.isArray(cave?.route) ? cave.route.map(pos).filter(Boolean) : [];
      state.routeIndex = Math.max(0, Math.min(state.route.length - 1, Math.trunc(Number(cave?.currentIndex) || 0)));
      state.direction = Number(cave?.direction) < 0 ? -1 : 1;
      state.tolerance = Math.max(1, Math.trunc(Number(cave?.config?.waypointTolerance) || 1));
      state.anchorInitialized = true;
    }

    function currentWaypoint(me) {
      if (!state.route.length) return null;
      let target = state.route[state.routeIndex] || null;
      let guard = 0;
      while (target && cheb(me, target) <= state.tolerance && state.route.length > 1 && guard < state.route.length) {
        advanceIndex();
        target = state.route[state.routeIndex] || null;
        guard += 1;
      }
      return target;
    }

    function pauseCave() {
      if (state.active) return;
      const cave = bot.cave.status?.();
      state.caveWasRunning = !!cave?.running;
      if (!state.anchorInitialized) syncRouteOnceFromCave();
      state.active = true;
      state.stuckRetries = 0;
      state.blockedTiles.clear();
      stopPathOnly();
      if (cave?.running) bot.cave.stop?.({ persistEnabled: false });
    }

    function resumeCave() {
      const shouldResume = state.caveWasRunning;
      const resumeIndex = state.routeIndex;
      state.active = false;
      state.caveWasRunning = false;
      state.nextStepAt = 0;
      state.lastMonsterSeenAt = 0;
      state.clearing = false;
      state.lastStep = null;
      state.anchorInitialized = false;
      state.stuckRetries = 0;
      state.blockedTiles.clear();
      stopPathOnly();

      if (shouldResume) {
        try { bot.cave.start?.(); } catch (_) {}
        try { bot.cave.setCurrentIndex?.(resumeIndex); } catch (_) {}
      }
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

      try { bot.lureMode2Replacement?.stop?.(); } catch (_) {}
      try { bot.lureMode2RouteProgress?.stop?.(); } catch (_) {}
      if (legacy.status?.().running) legacy.stop?.({ persistEnabled: false });
      legacy.config.enabled = true;
      legacy.config.mode = 2;
      legacy.config.minMonsters = cfg.minMonsters;
      legacy.config.maxDistance = cfg.maxDistance;
      legacy.config.stepDelayMs = cfg.stepDelayMs;

      const monsters = getMonsters(bot);
      const me = pos(bot.getPlayerPosition?.() || window.gameClient?.player?.__position);
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
          setStatus(`Lure 2: route ${state.routeIndex + 1}/${state.route.length}`);
          return;
        }

        // If the previous movement command should already have completed but the
        // player is still on the exact same tile, count it as a failed step. On
        // repeated failure temporarily blacklist that destination and replan.
        if (state.lastStep) {
          if (samePos(me, state.lastStep.from)) {
            state.stuckRetries += 1;
            if (state.stuckRetries >= STUCK_RETRY_LIMIT) {
              markBlocked(state.lastStep.to);
              bot.log?.("lure mode 2 temporarily blocked stuck tile", state.lastStep.to);
              state.stuckRetries = 0;
              state.lastStep = null;
              stopPathOnly();
            }
          } else {
            state.stuckRetries = 0;
          }
        }

        const waypoint = currentWaypoint(me);
        if (!waypoint) {
          setStatus("Lure 2: no route waypoint");
          return;
        }

        const avoidFirstStep = state.lastStep && samePos(me, state.lastStep.to)
          ? state.lastStep.from
          : null;
        let path = findPathAStar(me, waypoint, state.tolerance, {
          avoidFirstStep,
          temporarilyBlocked: activeBlockedKeys(),
        });

        // A no-path result can be transient: the 500 ms walkability cache may be
        // stale, or a recently failed step may have blacklisted the only valid
        // tile for 2.5 seconds. Rebuild the matrix immediately, then retry once
        // with normal blocked-tile avoidance and once more without temporary
        // blacklists before declaring the waypoint unreachable.
        if (!path || path.length < 2) {
          matrixCache.delete(String(me.z));
          path = findPathAStar(me, waypoint, state.tolerance, {
            avoidFirstStep,
            temporarilyBlocked: activeBlockedKeys(),
          });
        }
        if ((!path || path.length < 2) && cheb(me, waypoint) > state.tolerance && state.blockedTiles.size) {
          state.blockedTiles.clear();
          matrixCache.delete(String(me.z));
          path = findPathAStar(me, waypoint, state.tolerance, {
            avoidFirstStep,
            temporarilyBlocked: null,
          });
          if (path && path.length >= 2) {
            bot.log?.("lure mode 2 A* recovered after clearing temporary blocked tiles", {
              routeIndex: state.routeIndex,
              waypoint,
            });
          }
        }

        if (!path || path.length < 2) {
          if (cheb(me, waypoint) <= state.tolerance) {
            advanceIndex();
            setStatus(`Lure 2: advanced to wp ${state.routeIndex + 1}/${state.route.length}`);
          } else {
            setStatus(`Lure 2: no A* path to wp ${state.routeIndex + 1}`);
          }
          return;
        }

        const nextTile = path[1];
        const moved = bot.cave.goToPosition?.(nextTile);
        if (moved !== false) {
          state.nextStepAt = Date.now() + cfg.stepDelayMs;
          state.lastStep = {
            from: me,
            to: nextTile,
            waypoint: { ...waypoint },
            routeIndex: state.routeIndex,
            direction: state.direction,
            pathLength: path.length,
          };
          setStatus(`Lure 2: wp ${state.routeIndex + 1}/${state.route.length} A* -> ${nextTile.x},${nextTile.y}`);
          bot.log?.("lure mode 2 A* paced step", state.lastStep);
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

    function start() {
      if (state.timerId != null) return;
      try { bot.lureMode2Replacement?.stop?.(); } catch (_) {}
      try { bot.lureMode2RouteProgress?.stop?.(); } catch (_) {}
      state.timerId = window.setInterval(() => {
        try { tick(); } catch (error) { bot.log?.("lure mode 2 A* tick failed", error?.message || error); }
      }, TICK_MS);
      tick();
    }

    function stop() {
      if (state.timerId != null) window.clearInterval(state.timerId);
      state.timerId = null;
      if (state.active) resumeCave();
    }

    bot.lureMode2AstarRoute = {
      installed: true,
      start,
      stop,
      status: () => ({ ...state, config: readConfig(bot) }),
    };

    const cfg = readConfig(bot);
    if (cfg.enabled && cfg.mode === 2) start();

    window.addEventListener("change", () => {
      window.setTimeout(() => {
        const next = readConfig(bot);
        if (next.enabled && next.mode === 2) start();
        else stop();
      }, 0);
    }, true);

    bot.addCleanup?.(stop);
    return true;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 100) window.clearInterval(timer);
  }, 100);
  install();
})();