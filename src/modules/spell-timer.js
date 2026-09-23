window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installSpellTimerModule = function installSpellTimerModule(bot) {
  if (!bot || bot.spellTimer) return bot?.spellTimer || null;

  const STORAGE_KEY = "minibiaBot.spellTimer.config";
  const SECTION_ID = "minibia-bot-spell-timer-section";
  const state = { timerId: null, running: false, due: false, nextCastAt: 0, lastCastAt: 0, lastBlockedAt: 0 };

  const config = Object.assign({
    enabled: false, intervalSeconds: 60, hotbarSlot: 1, scanMs: 100, monsterGuardRange: 4,
  }, bot.storage.get(STORAGE_KEY, {}) || {});

  function normalizeSlot(value) {
    const slot = Math.trunc(Number(value));
    return Number.isFinite(slot) && slot >= 1 && slot <= 12 ? slot : null;
  }
  function normalizeInterval(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.max(0.1, seconds) : 60;
  }
  config.intervalSeconds = normalizeInterval(config.intervalSeconds);
  config.hotbarSlot = normalizeSlot(config.hotbarSlot) || 1;
  config.scanMs = Math.max(75, Math.trunc(Number(config.scanMs) || 100));
  config.monsterGuardRange = 4;
  config.enabled = !!config.enabled;

  function persistConfig() { bot.storage.set(STORAGE_KEY, { ...config }); }
  function normalizePosition(value) {
    if (!value) return null;
    const x = Number(value.x), y = Number(value.y), z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
  }
  function getPlayerPosition() {
    return normalizePosition(bot.getPlayerPosition?.() || window.gameClient?.player?.getPosition?.());
  }
  function getCreaturePosition(creature) {
    return normalizePosition(creature?.getPosition?.() || creature?.__position || creature?.position);
  }
  function getTileDistance(from, to) {
    if (!from || !to || from.z !== to.z) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  }
  function getMonstersWithinRange() {
    const playerPosition = getPlayerPosition();
    if (!playerPosition) return [];
    const monsters = bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [];
    return monsters.filter(monster => getTileDistance(playerPosition, getCreaturePosition(monster)) <= config.monsterGuardRange);
  }
  function isMonsterBlocked() { return getMonstersWithinRange().length > 0; }
  function resetTimer(now = Date.now()) { state.due = false; state.nextCastAt = now + config.intervalSeconds * 1000; }
  function tryCast(now = Date.now()) {
    if (!config.enabled || !state.due) return false;
    if (isMonsterBlocked()) { state.lastBlockedAt = now; return false; }
    const slot = normalizeSlot(config.hotbarSlot);
    if (!slot || typeof bot.clickHotbar !== "function") return false;
    const clicked = bot.clickHotbar(slot - 1);
    if (!clicked) return false;
    state.lastCastAt = now;
    resetTimer(now);
    bot.log?.("spell timer cast hotkey", { slot, intervalSeconds: config.intervalSeconds });
    return true;
  }
  function tick() {
    if (!config.enabled) return;
    const now = Date.now();
    if (!state.due && now >= state.nextCastAt) state.due = true;
    if (state.due) tryCast(now);
  }
  function start() {
    if (state.running) return true;
    state.running = true;
    resetTimer(Date.now());
    state.timerId = window.setInterval(tick, config.scanMs);
    return true;
  }
  function stop(options = {}) {
    if (state.timerId != null) window.clearInterval(state.timerId);
    state.timerId = null; state.running = false; state.due = false;
    if (options.persistEnabled !== false) { config.enabled = false; persistConfig(); }
    return true;
  }
  function updateConfig(next = {}) {
    if (Object.prototype.hasOwnProperty.call(next, "intervalSeconds")) {
      config.intervalSeconds = normalizeInterval(next.intervalSeconds);
      if (state.running) resetTimer(Date.now());
    }
    if (Object.prototype.hasOwnProperty.call(next, "hotbarSlot")) config.hotbarSlot = normalizeSlot(next.hotbarSlot) || config.hotbarSlot;
    if (Object.prototype.hasOwnProperty.call(next, "enabled")) {
      config.enabled = !!next.enabled;
      if (config.enabled) start(); else stop({ persistEnabled: true });
    }
    persistConfig(); syncUi();
  }
  function syncUi() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    const enabled = section.querySelector("#minibia-bot-spell-timer-enabled");
    const interval = section.querySelector("#minibia-bot-spell-timer-interval");
    const hotkey = section.querySelector("#minibia-bot-spell-timer-hotkey");
    if (enabled) enabled.checked = !!config.enabled;
    if (interval && document.activeElement !== interval) interval.value = String(config.intervalSeconds);
    if (hotkey && document.activeElement !== hotkey) hotkey.value = String(config.hotbarSlot);
  }
  function installUi() {
    if (document.getElementById(SECTION_ID)) { syncUi(); return true; }
    const panel = document.getElementById("minibia-bot-panel");
    if (!panel) return false;
    const section = document.createElement("section");
    section.className = "mb-section"; section.id = SECTION_ID;
    section.innerHTML = `
      <div class="mb-section-title">Spell Timer</div>
      <div class="mb-stack">
        <label class="mb-toggle"><input type="checkbox" id="minibia-bot-spell-timer-enabled" /><span>Enable Spell Timer</span></label>
        <label class="mb-field"><span class="mb-field-label">Timer (seconds)</span><input type="number" id="minibia-bot-spell-timer-interval" min="0.1" step="0.1" /></label>
        <label class="mb-field"><span class="mb-field-label">Hotkey</span><input type="number" id="minibia-bot-spell-timer-hotkey" min="1" max="12" step="1" /></label>
        <div class="mb-small-note">When the timer is due, nearby monsters block the hotkey until the area is clear. Monster guard: 4 tiles, same floor.</div>
      </div>`;
    const anchor = document.getElementById("minibia-bot-anti-paralyze-section");
    if (anchor?.parentNode) anchor.insertAdjacentElement("afterend", section); else panel.appendChild(section);
    section.querySelector("#minibia-bot-spell-timer-enabled")?.addEventListener("change", e => updateConfig({ enabled: e.target.checked }));
    section.querySelector("#minibia-bot-spell-timer-interval")?.addEventListener("change", e => updateConfig({ intervalSeconds: e.target.value }));
    section.querySelector("#minibia-bot-spell-timer-hotkey")?.addEventListener("change", e => updateConfig({ hotbarSlot: e.target.value }));
    syncUi(); return true;
  }
  let uiObserver = null;
  function ensureUi() {
    if (installUi()) { uiObserver?.disconnect(); uiObserver = null; return true; }
    if (!uiObserver) {
      uiObserver = new MutationObserver(() => {
        if (installUi()) { uiObserver.disconnect(); uiObserver = null; }
      });
      (document.documentElement || document.body)?.appendChild ? uiObserver.observe(document.documentElement || document.body, { childList: true, subtree: true }) : null;
    }
    return false;
  }

  bot.addCleanup?.(() => {
    if (state.timerId != null) window.clearInterval(state.timerId);
    uiObserver?.disconnect();
  });
  bot.spellTimer = {
    config, start, stop, updateConfig, ensureUi,
    status: () => ({ running: state.running, due: state.due, nextCastAt: state.nextCastAt, lastCastAt: state.lastCastAt, lastBlockedAt: state.lastBlockedAt, config: { ...config } }),
    getMonstersWithinRange, isBlocked: isMonsterBlocked,
  };
  ensureUi();
  if (config.enabled) start();
  return bot.spellTimer;
};
