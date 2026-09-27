window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installFireFieldTileScannerModule = function installFireFieldTileScannerModule(bot) {
  if (!bot || bot.fireFieldTileScanner) return bot?.fireFieldTileScanner || null;

  const sectionId = "minibia-bot-fire-field-scan-section";
  const state = { armed: false, listener: null, uiObserver: null };

  function getPosition(value) {
    const raw = value?.getPosition?.() || value?.__position || value?.position || value;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) } : null;
  }

  function getDefinition(thing) {
    const id = Number(thing?.id ?? thing?.itemId ?? thing?.serverId ?? thing?.clientId);
    if (!Number.isFinite(id)) return null;
    const client = window.gameClient;
    return client?.itemDefinitionsByCid?.[id]
      || client?.itemDefinitionsBySid?.[id]
      || client?.itemDefinitions?.[id]
      || null;
  }

  function getThings(tile) {
    if (!tile) return [];
    const result = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(add);
      else if (!result.includes(value)) result.push(value);
    };
    add(tile.items); add(tile.things); add(tile.objects);
    add(tile.topThing);
    try { add(tile.getItems?.()); } catch (_) {}
    try { add(tile.getThings?.()); } catch (_) {}
    try { add(tile.getObjects?.()); } catch (_) {}
    try { add(tile.getTopThing?.()); } catch (_) {}
    return result;
  }

  function getTile(position) {
    const world = window.gameClient?.world;
    if (!world || !position) return null;
    try {
      if (typeof world.getTileFromWorldPosition === "function") {
        const P = window.Position;
        return world.getTileFromWorldPosition(P
          ? new P(position.x, position.y, position.z)
          : position);
      }
    } catch (_) {}
    try {
      return world.getTile?.(position.x, position.y, position.z)
        || world.getTileFromPosition?.(position.x, position.y, position.z)
        || null;
    } catch (_) { return null; }
  }

  function describeTile(position) {
    const tile = getTile(position);
    const things = getThings(tile);
    const items = things.map((thing) => {
      const id = Number(thing?.id ?? thing?.itemId ?? thing?.serverId ?? thing?.clientId);
      const definition = getDefinition(thing);
      const name = thing?.name || thing?.itemName || definition?.name || definition?.properties?.name || "";
      const type = thing?.type || thing?.thingType || definition?.properties?.type || "";
      return {
        id: Number.isFinite(id) ? id : null,
        name: String(name || ""),
        type: String(type || "")
      };
    }).filter(item => item.id !== null || item.name || item.type);

    const firePattern = /(?:fire|flame)\\s*(?:field|wall|damage|ground|tile)/i;
    const fireCandidates = items.filter(item =>
      /^(1487|1488|1489|1492|1493|1494|1500|1501|1502|2118|2119|2120|2123|2124|2125|2131|2132|2133)$/.test(String(item.id))
      || firePattern.test(`${item.name} ${item.type}`)
    );

    return { position, tileFound: !!tile, items, fireCandidates };
  }

  function formatResult(result) {
    if (!result.tileFound) return `Tile not found at ${result.position.x}, ${result.position.y}, ${result.position.z}`;
    if (!result.items.length) return `Tile ${result.position.x}, ${result.position.y}, ${result.position.z}: no item/thing entries exposed`;
    const lines = [
      `Tile: ${result.position.x}, ${result.position.y}, ${result.position.z}`,
      ...result.items.map((item, index) =>
        `${index + 1}. ID ${item.id ?? "?"}${item.name ? ` — ${item.name}` : ""}${item.type ? ` [${item.type}]` : ""}`
      )
    ];
    lines.push(result.fireCandidates.length
      ? `Possible fire-field item(s): ${result.fireCandidates.map(x => x.id ?? x.name).join(", ")}`
      : "No current fire-field match in the scanner's known list/name check.");
    return lines.join("\\n");
  }

  function showResult(result) {
    const output = document.getElementById("minibia-bot-fire-field-scan-result");
    const text = formatResult(result);
    if (output) output.textContent = text;
    bot.log?.("Fire Field Tile Scan", result);
    return result;
  }

  function getGameCanvas() {
    return Array.from(document.querySelectorAll("canvas"))
      .map(canvas => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(x => x.rect.width >= 200 && x.rect.height >= 150)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0] || null;
  }

  function arm() {
    if (state.armed) return false;
    const info = getGameCanvas();
    if (!info) {
      showResult({ position: getPosition(bot.getPlayerPosition?.()) || {x:0,y:0,z:0}, tileFound: false, items: [], fireCandidates: [] });
      return false;
    }
    state.armed = true;
    const button = document.getElementById("minibia-bot-fire-field-scan-button");
    if (button) button.textContent = "Click a game tile…";
    state.listener = (event) => {
      if (!state.armed) return;
      const me = getPosition(bot.getPlayerPosition?.());
      if (!me) return;
      const rect = info.rect;
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      const tileWidth = rect.width / 17;
      const tileHeight = rect.height / 13;
      const col = Math.floor((event.clientX - rect.left) / tileWidth);
      const row = Math.floor((event.clientY - rect.top) / tileHeight);
      const x = me.x + col - 8;
      const y = me.y + row - 6;
      state.armed = false;
      document.removeEventListener("click", state.listener, true);
      state.listener = null;
      if (button) button.textContent = "Scan Tile";
      showResult(describeTile({ x, y, z: me.z }));
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", state.listener, true);
    return true;
  }

  function installUi() {
    if (document.getElementById(sectionId)) return true;
    const anchor = document.getElementById("minibia-bot-cave-add")?.closest(".mb-section");
    if (!anchor?.parentElement) return false;
    const section = document.createElement("div");
    section.id = sectionId;
    section.className = "mb-section";
    section.innerHTML = `<div class="mb-label">Fire Field ID Scanner</div>
      <div class="mb-stack">
        <button type="button" id="minibia-bot-fire-field-scan-button" class="mb-button">Scan Tile</button>
        <div id="minibia-bot-fire-field-scan-result" class="mb-small-note">Click Scan Tile, then click the game tile you want to inspect.</div>
        <div class="mb-small-note">Reports tile X/Y/Z, every exposed item ID/name/type, and possible fire-field matches. This does not enable Walk Over Fields.</div>
      </div>`;
    anchor.insertAdjacentElement("afterend", section);
    section.querySelector("#minibia-bot-fire-field-scan-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      arm();
    });
    return true;
  }

  function ensureUi() {
    if (installUi()) {
      state.uiObserver?.disconnect();
      state.uiObserver = null;
      return true;
    }
    if (!state.uiObserver) {
      state.uiObserver = new MutationObserver(() => {
        if (installUi()) {
          state.uiObserver.disconnect();
          state.uiObserver = null;
        }
      });
      state.uiObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }
    return false;
  }

  function scanPosition(position) {
    return showResult(describeTile(getPosition(position) || position));
  }

  function stop() {
    state.armed = false;
    if (state.listener) document.removeEventListener("click", state.listener, true);
    state.listener = null;
    state.uiObserver?.disconnect();
    state.uiObserver = null;
  }

  bot.fireFieldTileScanner = { arm, scanPosition, ensureUi, stop, describeTile };
  ensureUi();
  bot.addCleanup?.(stop);
  return bot.fireFieldTileScanner;
};
