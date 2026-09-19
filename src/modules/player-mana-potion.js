window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPlayerManaPotionModule = function installPlayerManaPotionModule(bot) {
  if (!bot || bot.playerManaPotion) return bot?.playerManaPotion || null;

  const configStorageKey = "minibiaBot.playerManaPotion.config";
  const sectionId = "minibia-bot-player-mana-potion-section";
  const state = { running: false, timerId: null, targetTimerId: null, uiObserver: null, lastAttemptAt: 0, lastUseAt: 0 };
  const config = Object.assign({
    enabled: false,
    playerName: "",
    hotbarSlot: 1,
    scanMs: 100,
    retryMs: 250,
    cooldownMs: 1025,
    targetDelayMs: 100
  }, bot.storage.get(configStorageKey, {}) || {});

  function persistConfig() { bot.storage.set(configStorageKey, { ...config }); }
  function normalizeName(value) { return String(value || "").trim().toLowerCase(); }
  function normalizeSlot(value) {
    const slot = Math.trunc(Number(value));
    return Number.isFinite(slot) && slot >= 1 && slot <= 12 ? slot : null;
  }
  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) } : null;
  }
  function distance(a, b) {
    if (!a || !b || a.z !== b.z) return Infinity;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  config.playerName = String(config.playerName || "").trim();
  config.hotbarSlot = normalizeSlot(config.hotbarSlot) || 1;
  config.scanMs = Math.max(75, Math.trunc(Number(config.scanMs) || 100));
  config.retryMs = Math.max(100, Math.trunc(Number(config.retryMs) || 250));
  config.cooldownMs = 1025;
  config.targetDelayMs = 100;
  config.enabled = !!config.enabled;

  function findTarget() {
    const wanted = normalizeName(config.playerName);
    if (!wanted) return null;
    return (bot.xray?.getVisiblePlayers?.({ sameFloorOnly: true }) || [])
      .find(p => normalizeName(p?.name) === wanted) || null;
  }
  function isInRange(player) {
    return distance(getPosition(bot.getPlayerPosition?.()), getPosition(player)) <= 1;
  }
  function getGameCanvas() {
    return Array.from(document.querySelectorAll("canvas"))
      .map(canvas => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(x => x.rect.width >= 200 && x.rect.height >= 150)
      .sort((a,b) => b.rect.width*b.rect.height - a.rect.width*a.rect.height)[0] || null;
  }
  function dispatchScreenClick(canvas, clientX, clientY) {
    const common = { bubbles:true, cancelable:true, composed:true, clientX, clientY,
      screenX:clientX, screenY:clientY, button:0, buttons:1, detail:1, view:window };
    try {
      if (typeof PointerEvent === "function") {
        canvas.dispatchEvent(new PointerEvent("pointermove",{...common,pointerId:1,pointerType:"mouse",isPrimary:true}));
        canvas.dispatchEvent(new PointerEvent("pointerdown",{...common,pointerId:1,pointerType:"mouse",isPrimary:true}));
        canvas.dispatchEvent(new PointerEvent("pointerup",{...common,buttons:0,pointerId:1,pointerType:"mouse",isPrimary:true}));
      }
      canvas.dispatchEvent(new MouseEvent("mousemove",common));
      canvas.dispatchEvent(new MouseEvent("mousedown",common));
      canvas.dispatchEvent(new MouseEvent("mouseup",{...common,buttons:0}));
      canvas.dispatchEvent(new MouseEvent("click",{...common,buttons:0}));
      return true;
    } catch (_) { return false; }
  }
  function clickPlayer(player) {
    const me = getPosition(bot.getPlayerPosition?.());
    const target = getPosition(player);
    const info = getGameCanvas();
    if (!me || !target || !info || target.z !== me.z || distance(me,target) > 1) return false;
    const {canvas,rect} = info;
    const tw = rect.width/17, th = rect.height/13;
    const x = rect.left + ((target.x-me.x+8.5)*tw);
    const y = rect.top + ((target.y-me.y+6.5)*th);
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
    return dispatchScreenClick(canvas,x,y);
  }
  function finishTarget() {
    state.targetTimerId = null;
    if (!state.running || !config.enabled) return false;
    const target = findTarget();
    if (!target || !isInRange(target)) return false;
    const used = clickPlayer(target);
    if (used) state.lastUseAt = Date.now();
    return used;
  }
  function tryUse(now=Date.now()) {
    if (!state.running || !config.enabled || state.targetTimerId != null) return false;
    const slot = normalizeSlot(config.hotbarSlot);
    if (!slot || now-state.lastUseAt < config.cooldownMs || now-state.lastAttemptAt < config.retryMs) return false;
    const target = findTarget();
    if (!target || !isInRange(target)) return false;
    state.lastAttemptAt = now;
    if (!bot.clickHotbar?.(slot-1)) return false;
    state.targetTimerId = window.setTimeout(finishTarget, config.targetDelayMs);
    return true;
  }
  function tick() {
    if (!state.running || !config.enabled) return;
    try { tryUse(); } catch (e) { bot.log?.("Mana potion player tick failed", e?.message || e); }
    finally { if (state.running && config.enabled) state.timerId = window.setTimeout(tick, config.scanMs); }
  }
  function syncUi() {
    const toggle=document.getElementById("minibia-bot-player-mana-potion-enabled");
    const name=document.getElementById("minibia-bot-player-mana-potion-name");
    const hotkey=document.getElementById("minibia-bot-player-mana-potion-hotkey");
    if(toggle) toggle.checked=state.running;
    if(name && document.activeElement!==name) name.value=config.playerName;
    if(hotkey && document.activeElement!==hotkey) hotkey.value=String(config.hotbarSlot);
  }
  function installUi() {
    if(document.getElementById(sectionId)){syncUi();return true;}
    const anchor=document.getElementById("minibia-bot-player-uh-section");
    if(!anchor?.parentElement) return false;
    const section=document.createElement("div");
    section.id=sectionId; section.className="mb-section";
    section.innerHTML=`<div class="mb-label">Mana Potion Player</div><div class="mb-stack">
      <label class="mb-field"><span class="mb-field-label">Player Name</span><input type="text" id="minibia-bot-player-mana-potion-name" placeholder="Exact player name"></label>
      <label class="mb-field"><span class="mb-field-label">Mana Potion Crosshair Hotkey</span><input type="number" id="minibia-bot-player-mana-potion-hotkey" min="1" max="12"></label>
      <label class="mb-toggle"><input type="checkbox" id="minibia-bot-player-mana-potion-enabled"><span>Enable Mana Potion Player</span></label>
      <div class="mb-small-note">Uses the mana-potion crosshair hotkey when the named player is within 1 square on the same floor. Cooldown: 1025 ms.</div>
    </div>`;
    anchor.insertAdjacentElement("afterend",section);
    section.querySelector("#minibia-bot-player-mana-potion-name")?.addEventListener("change",e=>updateConfig({playerName:e.target.value}));
    section.querySelector("#minibia-bot-player-mana-potion-hotkey")?.addEventListener("change",e=>updateConfig({hotbarSlot:e.target.value}));
    section.querySelector("#minibia-bot-player-mana-potion-enabled")?.addEventListener("change",e=>e.target.checked?start():stop());
    syncUi(); return true;
  }
  function stopObserver(){state.uiObserver?.disconnect();state.uiObserver=null;}
  function ensureUi() {
    if(installUi()){stopObserver();return true;}
    if(state.uiObserver)return false;
    state.uiObserver=new MutationObserver(()=>{if(installUi())stopObserver();});
    state.uiObserver.observe(document.documentElement||document.body,{childList:true,subtree:true});
    return false;
  }
  function updateConfig(next={}) {
    if("playerName" in next) next.playerName=String(next.playerName||"").trim();
    if("hotbarSlot" in next) next.hotbarSlot=normalizeSlot(next.hotbarSlot)||config.hotbarSlot;
    if("enabled" in next) next.enabled=!!next.enabled;
    Object.assign(config,next,{cooldownMs:1025,targetDelayMs:100});
    persistConfig(); syncUi(); return {...config};
  }
  function start(overrides={}) {
    updateConfig({...overrides,enabled:true});
    if(state.running)return false;
    state.running=true; ensureUi(); tick(); syncUi(); return true;
  }
  function stop(options={}) {
    state.running=false;
    if(state.timerId!=null){window.clearTimeout(state.timerId);state.timerId=null;}
    if(state.targetTimerId!=null){window.clearTimeout(state.targetTimerId);state.targetTimerId=null;}
    stopObserver();
    if(options.persistEnabled!==false){config.enabled=false;persistConfig();}
    syncUi(); return true;
  }
  function status(){const t=findTarget();return {running:state.running,config:{...config},target:t?{name:t.name,position:getPosition(t),distance:distance(getPosition(bot.getPlayerPosition?.()),getPosition(t))}:null,lastAttemptAt:state.lastAttemptAt,lastUseAt:state.lastUseAt,targetPending:state.targetTimerId!=null};}
  bot.playerManaPotion={start,stop,status,updateConfig,tryUse,findTarget,isInRange,config};
  ensureUi();
  if(config.enabled)start();
  bot.addCleanup?.(()=>stop({persistEnabled:false}));
  return bot.playerManaPotion;
};
if(window.minibiaBot) window.__minibiaBotBundle.installPlayerManaPotionModule(window.minibiaBot);
