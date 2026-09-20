window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.createBot = function createBot() {
  const cleanups = [];
  const defaultAlarmAudioSrc = "https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3f/ACA_Allertor_125_video.ogv/ACA_Allertor_125_video.ogv.480p.vp9.webm";
  const alarmAudioSrcStorageKey = "minibiaBot.audio.alarmSrc";
  const recentSentChats = [];
  const reconnectButtonSelectors = [
    "button",
    "[role=\"button\"]",
    "input[type=\"button\"]",
    "input[type=\"submit\"]",
    "a",
    ".button",
    ".btn",
  ];
  let alarmAudio = null;
  let reconnectObserver = null;
  let reconnectPollTimerId = null;
  let lastReconnectClickAt = 0;

  const MAX_LOG_ENTRIES = 2000;
  const logBuffer = [];
  let debugEnabled = false;

  function addCleanup(fn) {
    if (typeof fn === "function") {
      cleanups.push(fn);
    }
  }

  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try {
        fn();
      } catch (error) {
        console.error("[minibia-bot] cleanup failed", error);
      }
    }
  }

  function getStoredAlarmAudioSrc() {
    try {
      const value = window.localStorage.getItem(alarmAudioSrcStorageKey);
      return value == null ? defaultAlarmAudioSrc : JSON.parse(value);
    } catch (error) {
      return defaultAlarmAudioSrc;
    }
  }

  function setStoredAlarmAudioSrc(src) {
    window.localStorage.setItem(alarmAudioSrcStorageKey, JSON.stringify(src));
    return src;
  }

  function destroyAlarmAudio() {
    if (!alarmAudio) {
      return;
    }

    try {
      alarmAudio.pause();
      alarmAudio.removeAttribute("src");
      alarmAudio.load();
    } catch (error) {
      console.error("[minibia-bot] audio cleanup failed", error);
    }

    alarmAudio = null;
  }

  function getAlarmAudio() {
    const src = getStoredAlarmAudioSrc();
    if (!src) {
      return null;
    }

    if (!alarmAudio) {
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    } else if (alarmAudio.src !== src) {
      alarmAudio.pause();
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    }

    return alarmAudio;
  }

  function normalizeChatText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function rememberSentChat(text) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return;
    }

    recentSentChats.push({
      text: normalized,
      at: Date.now(),
    });

    const maxEntries = 20;
    if (recentSentChats.length > maxEntries) {
      recentSentChats.splice(0, recentSentChats.length - maxEntries);
    }
  }

  function isRecentSentChat(text, withinMs = 45000) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return false;
    }

    const cutoff = Date.now() - withinMs;
    for (let index = recentSentChats.length - 1; index >= 0; index -= 1) {
      const entry = recentSentChats[index];
      if (entry.at < cutoff) {
        continue;
      }

      if (entry.text === normalized) {
        return true;
      }
    }

    return false;
  }

  function normalizeUiText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getSkillWindowValue(skillNames = []) {
    for (const skillName of skillNames) {
      const value =
        document.querySelector(`#skill-window div[skill="${skillName}"] .skill`)?.textContent?.trim() ||
        null;
      if (value) {
        return value;
      }
    }

    return null;
  }

  function parseNumberText(value) {
    if (value == null) {
      return null;
    }

    const normalized = String(value).replace(/[^\d.-]/g, "");
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getElementUiText(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    return normalizeUiText(
      element.textContent ||
      element.innerText ||
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    );
  }

  function findReconnectElement() {
    for (const selector of reconnectButtonSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (!isVisibleElement(candidate)) {
          continue;
        }

        if (getElementUiText(candidate) === "reconnect") {
          return candidate;
        }
      }
    }

    return null;
  }

  function tryClickReconnect() {
    const now = Date.now();
    if (now - lastReconnectClickAt < 3000) {
      return false;
    }

    const reconnectElement = findReconnectElement();
    if (!reconnectElement) {
      return false;
    }

    reconnectElement.click();
    lastReconnectClickAt = now;
    console.log("[minibia-bot] clicked reconnect");
    return true;
  }

  function startReconnectWatcher() {
    if (reconnectObserver || reconnectPollTimerId) {
      return;
    }

    const runCheck = () => {
      try {
        tryClickReconnect();
      } catch (error) {
        console.error("[minibia-bot] reconnect watcher failed", error);
      }
    };

    reconnectObserver = new MutationObserver(runCheck);
    reconnectObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "value"],
    });

    reconnectPollTimerId = window.setInterval(runCheck, 2000);
    runCheck();
  }

  function stopReconnectWatcher() {
    if (reconnectObserver) {
      reconnectObserver.disconnect();
      reconnectObserver = null;
    }

    if (reconnectPollTimerId) {
      window.clearInterval(reconnectPollTimerId);
      reconnectPollTimerId = null;
    }
  }

  startReconnectWatcher();

  const raw = window.__minibiaBotBundle.versionInfo || {};
  const version = Object.freeze({
    number: raw.number || "0.0.0",
    branch: raw.branch || "unknown",
    commit: raw.commit || "unknown",
    date: raw.date || "unknown",
  });

  return {
    version,
    addCleanup,
    destroy() {
      if (this.panic?.stop) {
        this.panic.stop();
      }

      if (this.rune?.stop) {
        this.rune.stop({ persistEnabled: false });
      }

      if (this.heal?.stop) {
        this.heal.stop({ persistEnabled: false });
      }

      if (this.invisible?.stop) {
        this.invisible.stop({ persistEnabled: false });
      }

      if (this.attack?.stop) {
        this.attack.stop({ persistEnabled: false });
      }

      if (this.cave?.stop) {
        this.cave.stop({ persistEnabled: false });
      }

      if (this.equipRing?.stop) {
        this.equipRing.stop({ persistEnabled: false });
      }

      if (this.eat?.stop) {
        this.eat.stop({ persistEnabled: false });
      }

      if (this.talk?.stop) {
        this.talk.stop({ persistEnabled: false });
      }

      if (this.ui?.destroy) {
        this.ui.destroy();
      }

      stopReconnectWatcher();
      destroyAlarmAudio();
      runCleanups();
    },
    getLoggerPosition() {
      try {
        const pos = window.gameClient?.player?.getPosition?.();
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
          return { x: Math.trunc(pos.x), y: Math.trunc(pos.y), z: Math.trunc(pos.z) };
        }
      } catch (e) {}
      return null;
    },
    pushLogEntry(level, args) {
      const now = Date.now();
      const d = new Date(now);
      const time = d.toLocaleTimeString("pt-BR", { hour12: false }) + "." +
        String(d.getMilliseconds()).padStart(3, "0");
      const pos = this.getLoggerPosition();
      const text = String(args[0] || "");
      const data = args.length > 1 ? args[1] : null;

      logBuffer.push({ at: now, time, position: pos, text, data, level });
      if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();

      const posStr = pos ? `[${pos.x},${pos.y},${pos.z}] ` : "";
      const label = level === "debug" ? "[DEBUG] " : "";
      const rest = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
      console.log(`[minibia-bot] ${label}${posStr}${rest}`);
    },
    log(...args) {
      this.pushLogEntry("info", args);
    },
    logDebug(...args) {
      if (!debugEnabled) return;
      this.pushLogEntry("debug", args);
    },
    logger: {
      getLogs() { return [...logBuffer]; },
      getDebugEnabled() { return debugEnabled; },
      setDebugEnabled(enabled) { debugEnabled = !!enabled; },
      clear() { logBuffer.length = 0; },
      downloadLogs() {
        const logs = [...logBuffer];
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `minibia-bot-logs-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
    },
    storage: {
      get(key, fallback = null) {
        try {
          const value = window.localStorage.getItem(key);
          return value == null ? fallback : JSON.parse(value);
        } catch (error) {
          return fallback;
        }
      },
      set(key, value) {
        window.localStorage.setItem(key, JSON.stringify(value));
        return value;
      },
      remove(key) {
        window.localStorage.removeItem(key);
      },
    },
    getPlayerPosition() {
      return window.gameClient?.player?.getPosition?.() || null;
    },
    getPlayerState() {
      return window.gameClient?.player?.state || null;
    },
    getPlayerName() {
      return (
        String(
          this.getPlayerState()?.name ||
          window.gameClient?.player?.name ||
          window.gameClient?.player?.state?.name ||
          ""
        ).trim() || null
      );
    },
    getPlayerSnapshot() {
      const playerState = this.getPlayerState() || {};
      const levelText = getSkillWindowValue(["level"]);
      const magicLevelText = getSkillWindowValue(["magic", "magic-level", "mlvl"]);
      const experienceText = getSkillWindowValue(["experience", "exp"]);
      const capacityText = getSkillWindowValue(["capacity", "cap"]);

      return {
        name: this.getPlayerName(),
        level: parseNumberText(playerState.level) ?? parseNumberText(levelText),
        magicLevel: parseNumberText(playerState.magicLevel ?? playerState.magic_level) ?? parseNumberText(magicLevelText),
        health: parseNumberText(playerState.health),
        maxHealth: parseNumberText(playerState.maxHealth),
        mana: parseNumberText(playerState.mana),
        maxMana: parseNumberText(playerState.maxMana),
        experience: parseNumberText(playerState.experience ?? playerState.exp) ?? parseNumberText(experienceText),
        capacity: parseNumberText(playerState.capacity ?? playerState.cap) ?? parseNumberText(capacityText),
        food: getSkillWindowValue(["food"]),
      };
    },
    sendChat(text) {
      const channelManager = window.gameClient?.interface?.channelManager;
      if (!channelManager || !text) {
        return false;
      }

      channelManager.sendMessageText(text);
      rememberSentChat(text);
      this.log("sent chat:", text);
      return true;
    },
    isRecentSentChat(text, withinMs) {
      return isRecentSentChat(text, withinMs);
    },
    clickReconnect() {
      return tryClickReconnect();
    },
    clickHotbar(index) {
      const slotIndex = Math.trunc(Number(index));
      if (!Number.isFinite(slotIndex) || slotIndex < 0) return false;
      const slot = window.gameClient?.interface?.hotbarManager?.slots?.[slotIndex];
      const button = slot?.canvas?.canvas || slot?.canvas;
      if (!slot && !button) return false;

      for (const method of ["activate", "use", "click", "trigger"]) {
        if (typeof slot?.[method] === "function") {
          try { slot[method](); return true; } catch (_) {}
        }
      }

      if (button && typeof button.dispatchEvent === "function") {
        try {
          const rect = button.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
          const clientX = rect.left + Math.max(1, rect.width / 2);
          const clientY = rect.top + Math.max(1, rect.height / 2);
          ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
            const EventClass = type.startsWith("pointer") ? PointerEvent : MouseEvent;
            button.dispatchEvent(new EventClass(type, { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: type.endsWith("down") ? 1 : 0 }));
          });
          return true;
        } catch (_) {}
      }
      return false;
    },
    getAlarmAudioSrc() {
      return getStoredAlarmAudioSrc();
    },
    setAlarmAudioSrc(src) {
      const nextSrc = String(src || "").trim();
      if (!nextSrc) {
        return false;
      }

      setStoredAlarmAudioSrc(nextSrc);
      destroyAlarmAudio();
      this.log("alarm audio updated", nextSrc);
      return true;
    },
    unlockAudio() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.muted = true;
        const playResult = audio.play();

        if (playResult && typeof playResult.then === "function") {
          playResult
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
            })
            .catch((error) => {
              audio.muted = false;
              this.log("audio unlock failed", error?.message || error);
            });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        }

        return true;
      } catch (error) {
        console.error("[minibia-bot] audio unlock failed", error);
        return false;
      }
    },
    playAlarm() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        const playResult = audio.play();

        if (playResult && typeof playResult.catch === "function") {
          playResult.catch((error) => {
            this.log("alarm playback failed", error?.message || error);
          });
        }

        return true;
      } catch (error) {
        console.error("[minibia-bot] alarm failed", error);
        return false;
      }
    },
  };
};
