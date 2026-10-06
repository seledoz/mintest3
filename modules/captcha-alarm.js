window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaptchaAlarmModule = function installCaptchaAlarmModule(bot) {
  if (!bot || bot.captchaAlarm) return bot?.captchaAlarm || null;

  const state = { active: false, visible: false, observer: null, beepTimerId: null, stopTimerId: null, lastTriggerAt: 0 };
  const alarmDurationMs = 3000;
  const cooldownMs = 52000;
  const beepIntervalMs = 1000;
  const ignoredSelector = "#minibia-bot-panel, #k9x-panel, #minibia-bot-style, script, style";

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim();
  }

  function alarmEnabled() { return !!bot.redTextAlert?.config?.enabled; }
  function containsTitle(text) {
    const value = normalizeText(text);
    return value.includes("anti-bot verification") || value.includes("anti bot verification") || value.includes("anti-bot check") || value.includes("anti bot check") || value.includes("anti-bot rune check") || value.includes("anti bot rune check");
  }

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected || element.closest?.(ignoredSelector)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node && node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0.02) return false;
      if (node === document.body || node === document.documentElement) break;
    }
    return true;
  }

  function strictPopup(element) {
    if (!(element instanceof Element) || !visible(element)) return false;
    if (element.matches("dialog, [role='dialog'], [aria-modal='true']")) return true;

    const rect = element.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 120 || rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.9) return false;
    const style = getComputedStyle(element);
    if (style.position !== "fixed" && style.position !== "absolute") return false;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nearCenter = Math.abs(centerX - window.innerWidth / 2) <= window.innerWidth * 0.25 && Math.abs(centerY - window.innerHeight / 2) <= window.innerHeight * 0.25;
    if (!nearCenter) return false;

    const zIndex = Number.parseInt(style.zIndex, 10);
    return Number.isFinite(zIndex) && zIndex > 0;
  }

  function popupForTextNode(textNode) {
    const titleElement = textNode?.nodeType === Node.TEXT_NODE ? textNode.parentElement : textNode;
    if (!(titleElement instanceof Element) || !visible(titleElement)) return null;
    for (let current = titleElement, depth = 0; current && current instanceof Element && depth < 8; current = current.parentElement, depth += 1) {
      if (strictPopup(current) && containsTitle(current.textContent || "")) return current;
      if (current === document.body || current === document.documentElement) break;
    }
    return null;
  }

  function findPopup(root) {
    if (!root) return null;
    if (root.nodeType === Node.TEXT_NODE) return containsTitle(root.textContent || "") ? popupForTextNode(root) : null;
    if (!(root instanceof Element) && root !== document) return null;
    if (root instanceof Element && root.closest?.(ignoredSelector)) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!containsTitle(node.textContent || "")) continue;
      const popup = popupForTextNode(node);
      if (popup) return popup;
    }
    return null;
  }

  function clearAlarmTimers() {
    if (state.beepTimerId != null) clearInterval(state.beepTimerId);
    if (state.stopTimerId != null) clearTimeout(state.stopTimerId);
    state.beepTimerId = null;
    state.stopTimerId = null;
  }

  function beep() { return typeof bot.redTextAlert?.beep === "function" ? bot.redTextAlert.beep() : false; }
  function playAlarm() {
    clearAlarmTimers();
    beep();
    state.beepTimerId = setInterval(beep, beepIntervalMs);
    state.stopTimerId = setTimeout(() => { clearAlarmTimers(); bot.log?.("captcha alarm finished", { durationMs: alarmDurationMs }); }, alarmDurationMs);
  }

  function setVisible(isVisible) {
    if (!alarmEnabled()) { state.active = false; state.visible = false; clearAlarmTimers(); return false; }
    state.visible = !!isVisible;
    if (state.visible && !state.active) {
      state.active = true;
      const now = Date.now();
      if (now - state.lastTriggerAt < cooldownMs) return false;
      state.lastTriggerAt = now;
      playAlarm();
      bot.log?.("captcha alarm triggered", { type: "anti-bot-popup", durationMs: alarmDurationMs, cooldownMs });
      return true;
    }
    if (!state.visible) state.active = false;
    return false;
  }

  function check() { return setVisible(!!findPopup(document.body || document.documentElement)); }

  function start() {
    if (state.observer) return false;
    state.observer = new MutationObserver((mutations) => {
      if (!alarmEnabled()) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && findPopup(mutation.target)) { setVisible(true); return; }
        for (const node of mutation.addedNodes || []) {
          if (findPopup(node)) { setVisible(true); return; }
        }
      }
      if (state.active) queueMicrotask(check);
    });
    state.observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(check, 0);
    return true;
  }

  function stop() {
    state.observer?.disconnect(); state.observer = null; clearAlarmTimers(); state.active = false; state.visible = false;
  }

  bot.captchaAlarm = {
    start, stop, check,
    status: () => ({ active: state.active, enabled: alarmEnabled(), visible: state.visible, lastTriggerAt: state.lastTriggerAt, alarmDurationMs, cooldownMs, beepIntervalMs, polling: false }),
  };
  start();
  bot.addCleanup?.(stop);
  return bot.captchaAlarm;
};
