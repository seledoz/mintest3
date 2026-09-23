window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installHealModule = function installHealModule(bot) {
  const configStorageKey = "minibiaBot.heal.config";
  const state = {
    running: false,
    timerId: null,
    hpRetryTimerId: null,
    lastHpHealAt: 0,
    lastManaHealAt: 0,
    lastHpAttemptAt: 0,
    lastManaAttemptAt: 0,
    pendingHpAttempt: null,
    pendingManaAttempt: null,
  };

  const config = Object.assign(
    {
      tickMs: 75,
      healCooldownMs: 2040,
      manaCooldownMs: 1050,
      healRetryMs: 100,
      healConfirmMs: 150,
      minHp: 250,
      hpHotbarSlot: 1,
      minMana: 150,
      manaHotbarSlot: 2,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 75;

  if (!Number.isFinite(Number(config.healCooldownMs)) || Number(config.healCooldownMs) < 2040) config.healCooldownMs = 2040;
  if (!Number.isFinite(Number(config.manaCooldownMs)) || Number(config.manaCooldownMs) < 1050) config.manaCooldownMs = 1050;

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function readStats() {
    const playerState = bot.getPlayerSnapshot?.();
    return playerState ? { hp: { current: Number(playerState.health ?? 0), max: Number(playerState.maxHealth ?? 0) }, mana: { current: Number(playerState.mana ?? 0), max: Number(playerState.maxMana ?? 0) } } : { hp: null, mana: null };
  }
  function normalizeHotbarSlot(slot) { const value = Number(slot); if (!Number.isFinite(value)) return null; const normalized = Math.trunc(value); return normalized < 1 || normalized > 12 ? null : normalized; }
  function didHpHealSucceed(stats, attempt) { return !!stats?.hp && !!attempt && stats.hp.current > attempt.hpBefore; }
  function didManaHealSucceed(stats, attempt) { return !!stats?.mana && !!attempt && stats.mana.current > attempt.manaBefore; }
  function stopHpRetry() {
    if (state.hpRetryTimerId != null) {
      window.clearTimeout(state.hpRetryTimerId);
      state.hpRetryTimerId = null;
    }
  }
  function scheduleHpRetry() {
    stopHpRetry();
    if (!state.running || !config.enabled) return;
    state.hpRetryTimerId = window.setTimeout(() => {
      state.hpRetryTimerId = null;
      runHpRetry();
    }, 100);
  }
  function runHpRetry() {
    if (!state.running || !config.enabled) return;
    const now = Date.now();
    const stats = readStats();
    const attempt = state.pendingHpAttempt;
    if (attempt && didHpHealSucceed(stats, attempt)) {
      state.lastHpHealAt = now;
      state.pendingHpAttempt = null;
      stopHpRetry();
      bot.log("confirmed hp heal", { slot: attempt.slot, retry: true });
      return;
    }
    const hp = stats.hp;
    const slot = normalizeHotbarSlot(config.hpHotbarSlot);
    const threshold = Math.max(0, Number(config.minHp) || 0);
    if (!hp || !slot || hp.current <= 0 || hp.current > threshold) {
      state.pendingHpAttempt = null;
      stopHpRetry();
      return;
    }
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastHpAttemptAt = now;
      state.pendingHpAttempt = {
        attemptedAt: now,
        slot,
        hpBefore: Number(hp.current),
        manaBefore: Number(stats.mana?.current ?? 0)
      };
      bot.log("retrying hp heal hotkey", { slot, minHp: config.minHp });
    }
    scheduleHpRetry();
  }
  function resolvePendingAttempts(stats, now = Date.now()) {
    const hpAttempt = state.pendingHpAttempt;
    if (hpAttempt) {
      if (didHpHealSucceed(stats, hpAttempt)) { state.lastHpHealAt = hpAttempt.attemptedAt; state.pendingHpAttempt = null; stopHpRetry(); bot.log("confirmed hp heal", { slot: hpAttempt.slot }); }
      else if (now - hpAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) { state.pendingHpAttempt = null; bot.log("hp heal did not register; 100ms retry loop active", { slot: hpAttempt.slot }); }
    }
    const manaAttempt = state.pendingManaAttempt;
    if (manaAttempt) {
      if (didManaHealSucceed(stats, manaAttempt)) { state.lastManaHealAt = manaAttempt.attemptedAt; state.pendingManaAttempt = null; bot.log("confirmed mana heal", { slot: manaAttempt.slot }); }
      else if (now - manaAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) { state.pendingManaAttempt = null; bot.log("mana heal did not register", { slot: manaAttempt.slot }); }
    }
  }
  function canUseHpHeal(now = Date.now(), stats = readStats()) {
    const { hp } = stats; const slot = normalizeHotbarSlot(config.hpHotbarSlot); if (!hp || !slot || state.pendingHpAttempt) return false;
    return hp.current > 0 && hp.current <= Math.max(0, Number(config.minHp) || 0) && now - state.lastHpHealAt >= config.healCooldownMs && now - state.lastHpAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0);
  }
  function canUseManaHeal(now = Date.now(), stats = readStats()) {
    const { mana } = stats; const slot = normalizeHotbarSlot(config.manaHotbarSlot); if (!mana || !slot || state.pendingManaAttempt) return false;
    return mana.current <= Math.max(0, Number(config.minMana) || 0) && now - state.lastManaHealAt >= config.manaCooldownMs && now - state.lastManaAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0);
  }
  function triggerHpHeal(now = Date.now(), stats = readStats()) {
    if (!canUseHpHeal(now, stats)) return false;
    const slot = normalizeHotbarSlot(config.hpHotbarSlot); const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastHpAttemptAt = now;
      state.pendingHpAttempt = { attemptedAt: now, slot, hpBefore: Number(stats.hp?.current ?? 0), manaBefore: Number(stats.mana?.current ?? 0) };
      scheduleHpRetry();
      bot.log("pressed hp heal hotkey", { slot, minHp: config.minHp });
    }
    return clicked;
  }
  function triggerManaHeal(now = Date.now(), stats = readStats()) {
    if (!canUseManaHeal(now, stats)) return false;
    const slot = normalizeHotbarSlot(config.manaHotbarSlot); const clicked = bot.clickHotbar(slot - 1);
    if (clicked) { state.lastManaAttemptAt = now; state.pendingManaAttempt = { attemptedAt: now, slot, hpBefore: Number(stats.hp?.current ?? 0), manaBefore: Number(stats.mana?.current ?? 0) }; bot.log("pressed mana heal hotkey", { slot, minMana: config.minMana }); }
    return clicked;
  }
  function tryHeal() {
    if (!config.enabled) return false;
    const now = Date.now(); const stats = readStats(); resolvePendingAttempts(stats, now);
    const hpTriggered = triggerHpHeal(now, stats);
    const manaTriggered = triggerManaHeal(now, stats);
    return hpTriggered || manaTriggered;
  }
  function scheduleNextTick() { if (!state.running) return; state.timerId = window.setTimeout(() => { tick(); }, config.tickMs); }
  function tick() { if (!state.running) return; try { tryHeal(); } catch (error) { bot.log("auto heal tick failed", error?.message || error); } finally { scheduleNextTick(); } }
  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true, tickMs: 75 });
    if (!Number.isFinite(Number(config.healCooldownMs)) || Number(config.healCooldownMs) < 2040) config.healCooldownMs = 2040;
    if (!Number.isFinite(Number(config.manaCooldownMs)) || Number(config.manaCooldownMs) < 1050) config.manaCooldownMs = 1050;
    persistConfig(); if (state.running) { bot.log("auto heal already running"); return false; }
    state.running = true; bot.log("auto heal started", { ...config }); tick(); return true;
  }
  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false; state.running = false;
    stopHpRetry();
    if (state.timerId != null) { window.clearTimeout(state.timerId); state.timerId = null; }
    if (shouldPersistEnabled) { config.enabled = false; persistConfig(); }
    bot.log("auto heal stopped"); return true;
  }
  function status() { return { running: state.running, config: { ...config }, stats: readStats(), lastHpHealAt: state.lastHpHealAt, lastManaHealAt: state.lastManaHealAt, lastHpAttemptAt: state.lastHpAttemptAt, lastManaAttemptAt: state.lastManaAttemptAt, pendingHpAttempt: state.pendingHpAttempt ? { ...state.pendingHpAttempt } : null, pendingManaAttempt: state.pendingManaAttempt ? { ...state.pendingManaAttempt } : null }; }
  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpHotbarSlot")) nextConfig.hpHotbarSlot = normalizeHotbarSlot(nextConfig.hpHotbarSlot) ?? config.hpHotbarSlot;
    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaHotbarSlot")) nextConfig.manaHotbarSlot = normalizeHotbarSlot(nextConfig.manaHotbarSlot);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHp")) nextConfig.minHp = Math.max(0, Number(nextConfig.minHp) || 0);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMana")) nextConfig.minMana = Math.max(0, Number(nextConfig.minMana) || 0);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "healCooldownMs")) nextConfig.healCooldownMs = Math.max(2040, Number(nextConfig.healCooldownMs) || 2040);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaCooldownMs")) nextConfig.manaCooldownMs = Math.max(1050, Number(nextConfig.manaCooldownMs) || 1050);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "healRetryMs")) nextConfig.healRetryMs = Math.max(50, Number(nextConfig.healRetryMs) || 50);
    if (Object.prototype.hasOwnProperty.call(nextConfig, "healConfirmMs")) nextConfig.healConfirmMs = Math.max(50, Number(nextConfig.healConfirmMs) || 50);
    Object.assign(config, nextConfig, { tickMs: 75 });
    if (!Number.isFinite(Number(config.healCooldownMs)) || Number(config.healCooldownMs) < 2040) config.healCooldownMs = 2040;
    if (!Number.isFinite(Number(config.manaCooldownMs)) || Number(config.manaCooldownMs) < 1050) config.manaCooldownMs = 1050;
    persistConfig(); bot.log("auto heal config updated", { ...config }); return { ...config };
  }
  if (config.enabled) start();
  bot.heal = { start, stop, status, updateConfig, readStats, tryHeal, canUseHpHeal, canUseManaHeal, triggerHpHeal, triggerManaHeal, normalizeHotbarSlot, config };
};