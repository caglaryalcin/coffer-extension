(() => {
  "use strict";

  const HOST_ID = "coffer-inline-autofill-host";
  const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * 9;
  const POSITIVE_FIELD_PATTERN = /(one.?time|otp|totp|mfa|2fa|verification|verify|authenticator|security.?code|pass.?code|code)/iu;
  const NEGATIVE_FIELD_PATTERN = /(email|e-mail|username|user.?name|password|passwort|search|phone|postal|zip)/iu;
  if (document.getElementById(HOST_ID)) return;

  let activeField = null;
  let accounts = [];
  let selectedIndex = 0;
  let requestEpoch = 0;
  let refreshTimer = null;
  let countdownTimer = null;
  let positionFrame = null;
  let suggestionsReceivedAt = 0;
  let logoSequence = 0;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all:initial;position:fixed;inset:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; color-scheme: dark; }
    .menu {
      position: fixed;
      display: none;
      max-height: min(360px, calc(100vh - 16px));
      overflow-x: hidden;
      overflow-y: auto;
      border: 1px solid #4a4e55;
      border-radius: 7px;
      background: #252930;
      color: #f3f4f6;
      box-shadow: 0 12px 30px rgba(0, 0, 0, .38);
      font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
    }
    .menu.open { display: block; }
    .title {
      padding: 6px 10px;
      border-bottom: 1px solid #484c54;
      color: #d9dde5;
      font-size: 11px;
      font-weight: 700;
    }
    .option {
      width: 100%;
      min-height: 55px;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) max-content 30px;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 0;
      border-bottom: 1px solid #484c54;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .option:last-child { border-bottom: 0; }
    .option:hover, .option.selected { background: #323741; outline: none; }
    .logo {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 6px;
      background: rgba(202, 115, 115, .18);
      color: #efb1b1;
      font-size: 10px;
      font-weight: 800;
    }
    .logo.has-icon { overflow: hidden; padding: 3px; background: #fff; }
    .logo svg, .logo canvas { width: 22px; height: 22px; display: block; }
    .copy { min-width: 0; }
    .service, .identity { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .service { font-size: 13px; font-weight: 650; }
    .identity { margin-top: 2px; color: #adb3bf; font-size: 12px; }
    .code { color: #d8dce4; font: 700 14px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .countdown { width: 30px; height: 30px; display: grid; place-items: center; position: relative; color: #adb3bf; }
    .countdown svg { width: 30px; height: 30px; position: absolute; inset: 0; transform: rotate(-90deg); }
    .countdown circle { fill: none; stroke-width: 2.2; }
    .countdown .ring-track { stroke: #4a4f58; }
    .countdown .ring-progress { stroke: #ca7373; stroke-linecap: round; transition: stroke-dashoffset .25s linear; }
    .countdown small { position: relative; font-size: 9px; font-variant-numeric: tabular-nums; font-weight: 700; }
    .countdown.expiring { color: #efb1b1; }
    .countdown.expiring .ring-progress { stroke: #ed7777; }
    @media (prefers-color-scheme: light) {
      .menu { border-color: #c8ccd3; background: #fff; color: #22262d; box-shadow: 0 12px 30px rgba(0, 0, 0, .2); }
      .title, .option { border-color: #d9dce2; }
      .title, .code { color: #353a43; }
      .option:hover, .option.selected { background: #eef0f4; }
      .identity { color: #626975; }
    }
    @media (prefers-reduced-motion: reduce) {
      .countdown .ring-progress { transition: none; }
    }
  `;
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Coffer codes");
  shadow.append(style, menu);

  function appendHost() {
    if (!host.isConnected) document.documentElement?.append(host);
  }

  function runtimeMessage(message) {
    if (globalThis.browser?.runtime?.sendMessage) return globalThis.browser.runtime.sendMessage(message);
    return new Promise((resolve, reject) => {
      globalThis.chrome.runtime.sendMessage(message, (response) => {
        const error = globalThis.chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
    return String(value).replace(/["\\]/gu, "\\$&");
  }

  function descriptor(field) {
    const labels = field.id
      ? Array.from(document.querySelectorAll(`label[for="${cssEscape(field.id)}"]`))
        .map((label) => label.textContent ?? "")
      : [];
    const parentText = field.closest("label, fieldset, form, [role='group'], section, div")?.textContent ?? "";
    return [
      field.autocomplete,
      field.getAttribute("aria-label"),
      field.getAttribute("aria-labelledby"),
      field.id,
      field.getAttribute("name"),
      field.getAttribute("placeholder"),
      ...labels,
      parentText.slice(0, 240),
    ].filter(Boolean).join(" ");
  }

  function isVisible(field) {
    const styleValue = window.getComputedStyle(field);
    if (styleValue.visibility === "hidden" || styleValue.display === "none") return false;
    const rect = field.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isTotpField(field) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
    if (field.disabled || field.readOnly || !isVisible(field)) return false;
    if (field instanceof HTMLInputElement) {
      const allowedTypes = new Set(["", "number", "password", "search", "tel", "text"]);
      if (!allowedTypes.has(field.type.toLowerCase())) return false;
    }
    const text = descriptor(field);
    let score = 0;
    if (/\bone-time-code\b/iu.test(field.autocomplete)) score += 100;
    if (POSITIVE_FIELD_PATTERN.test(text)) score += 50;
    if (field.inputMode === "numeric" || field.inputMode === "decimal") score += 12;
    if (field instanceof HTMLInputElement && [1, 6, 7, 8].includes(field.maxLength)) score += 8;
    if (field instanceof HTMLInputElement && field.pattern && /\d|0-9/iu.test(field.pattern)) score += 6;
    if (NEGATIVE_FIELD_PATTERN.test(text) && !POSITIVE_FIELD_PATTERN.test(text)) score -= 100;
    return score >= 45;
  }

  function initials(value) {
    const words = String(value).trim().split(/\s+/u).filter(Boolean);
    return (words.length > 1 ? words.map((word) => word[0]).join("") : String(value).slice(0, 2))
      .slice(0, 3)
      .toUpperCase();
  }

  function clearRefreshTimer() {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function clearCountdownTimer() {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function closeMenu() {
    requestEpoch += 1;
    clearRefreshTimer();
    clearCountdownTimer();
    accounts = [];
    activeField = null;
    menu.classList.remove("open");
    menu.replaceChildren();
  }

  function setNativeValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    try {
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    } catch {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function segmentedFields(field, codeLength) {
    if (!(field instanceof HTMLInputElement) || field.maxLength !== 1) return null;
    const root = field.closest("form, fieldset, [role='group']") ?? field.parentElement;
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll("input"))
      .filter((candidate) => !candidate.disabled && !candidate.readOnly && candidate.maxLength === 1)
      .filter((candidate) => ["decimal", "numeric", "tel"].includes(candidate.inputMode) || /\d|0-9/u.test(candidate.pattern))
      .filter(isVisible);
    return candidates.includes(field) && candidates.length >= codeLength && candidates.length <= 8
      ? candidates.slice(0, codeLength)
      : null;
  }

  function fillCode(field, rawCode) {
    const code = String(rawCode ?? "").replace(/\D/gu, "");
    if (!/^\d{6,8}$/u.test(code) || !field?.isConnected) return;
    const segments = segmentedFields(field, code.length);
    if (segments) {
      segments.forEach((segment, index) => setNativeValue(segment, code[index]));
      segments.at(-1)?.focus({ preventScroll: true });
      segments.at(-1)?.select?.();
    } else {
      field.focus({ preventScroll: true });
      setNativeValue(field, code);
      field.select?.();
    }
    closeMenu();
  }

  function positionMenu() {
    if (!activeField || !menu.classList.contains("open")) return;
    if (!activeField.isConnected || !isVisible(activeField)) {
      closeMenu();
      return;
    }
    const rect = activeField.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(Math.max(280, rect.width), window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.min(window.innerHeight - viewportPadding, rect.bottom + 4)}px`;
    const menuHeight = menu.getBoundingClientRect().height;
    if (rect.bottom + 4 + menuHeight > window.innerHeight - viewportPadding && rect.top > menuHeight + 4) {
      menu.style.top = `${Math.max(viewportPadding, rect.top - menuHeight - 4)}px`;
    }
  }

  function schedulePosition() {
    if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = null;
      positionMenu();
    });
  }

  function selectIndex(index) {
    if (accounts.length === 0) return;
    selectedIndex = (index + accounts.length) % accounts.length;
    for (const [optionIndex, option] of [...menu.querySelectorAll(".option")].entries()) {
      option.classList.toggle("selected", optionIndex === selectedIndex);
      option.setAttribute("aria-selected", String(optionIndex === selectedIndex));
    }
  }

  function createSvgLogo(tree) {
    const prefix = `coffer-logo-${++logoSequence}-`;
    const tags = new Set([
      "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
      "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use", "pattern",
    ]);
    let nodes = 0;
    function createNode(node, depth = 0) {
      if (!node || !tags.has(node.tag) || depth > 64 || ++nodes > 4096) {
        throw new Error("Invalid logo geometry.");
      }
      const element = document.createElementNS("http://www.w3.org/2000/svg", node.tag);
      for (const [name, rawValue] of Object.entries(node.attrs ?? {})) {
        if (typeof rawValue !== "string" || /^on/iu.test(name) || ["style", "class"].includes(name)) continue;
        let value = rawValue;
        if (name === "id") value = prefix + value;
        if (name === "href") {
          if (!/^#logo-ref-\d+$/u.test(value)) continue;
          value = "#" + prefix + value.slice(1);
        } else if (/url\s*\(/iu.test(value)) {
          if (!/^url\(#logo-ref-\d+\)$/u.test(value)) continue;
          value = value.replace("url(#", `url(#${prefix}`);
        }
        element.setAttribute(name, value);
      }
      for (const child of node.children ?? []) element.append(createNode(child, depth + 1));
      return element;
    }
    if (tree?.tag !== "svg") return null;
    const svg = createNode(tree);
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }

  async function createPngLogo(dataUrl) {
    if (typeof dataUrl !== "string" || dataUrl.length > 131_100 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(dataUrl)) return null;
    const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
    if (bytes.length < 24) return null;
    const header = new DataView(bytes.buffer);
    if (header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a ||
        header.getUint32(12) !== 0x49484452) return null;
    const width = header.getUint32(16);
    const height = header.getUint32(20);
    if (width < 1 || height < 1 || width > 512 || height > 512) return null;
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.setAttribute("aria-hidden", "true");
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }

  function applyLogo(logo, account) {
    logo.textContent = initials(account.service);
    const display = (graphic) => {
      if (!graphic) return;
      logo.classList.add("has-icon");
      if (account.iconColor) logo.style.backgroundColor = account.iconColor;
      if (account.iconTitle) logo.title = account.iconTitle;
      logo.replaceChildren(graphic);
    };
    if (account.iconDataUrl) {
      void createPngLogo(account.iconDataUrl).then((graphic) => {
        if (logo.isConnected) display(graphic);
      }).catch(() => {});
    } else if (account.iconSvg) {
      try { display(createSvgLogo(account.iconSvg)); } catch { /* Keep initials for invalid logos. */ }
    }
  }

  function createCountdown(account) {
    const countdown = document.createElement("span");
    countdown.className = "countdown";
    countdown.dataset.period = String(account.period);
    countdown.dataset.startRemaining = String(account.remaining);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("aria-hidden", "true");
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "ring-track");
    track.setAttribute("cx", "11");
    track.setAttribute("cy", "11");
    track.setAttribute("r", "9");
    const progress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progress.setAttribute("class", "ring-progress");
    progress.setAttribute("cx", "11");
    progress.setAttribute("cy", "11");
    progress.setAttribute("r", "9");
    progress.style.strokeDasharray = String(COUNTDOWN_CIRCUMFERENCE);
    const label = document.createElement("small");
    svg.append(track, progress);
    countdown.append(svg, label);
    return countdown;
  }

  function updateCountdowns() {
    const elapsed = Math.max(0, (Date.now() - suggestionsReceivedAt) / 1_000);
    for (const countdown of menu.querySelectorAll(".countdown")) {
      const period = Math.max(1, Number(countdown.dataset.period) || 30);
      const startRemaining = Math.max(0, Number(countdown.dataset.startRemaining) || 0);
      const remaining = Math.max(0, startRemaining - elapsed);
      const displayRemaining = Math.ceil(remaining);
      const progress = countdown.querySelector(".ring-progress");
      const label = countdown.querySelector("small");
      if (progress) {
        progress.style.strokeDashoffset = String(COUNTDOWN_CIRCUMFERENCE * (1 - Math.min(1, remaining / period)));
      }
      if (label) label.textContent = String(displayRemaining);
      countdown.classList.toggle("expiring", displayRemaining <= 5);
      countdown.title = `${displayRemaining} seconds remaining`;
      countdown.setAttribute("aria-label", `${displayRemaining} seconds remaining`);
    }
  }

  function startCountdowns() {
    clearCountdownTimer();
    suggestionsReceivedAt = Date.now();
    updateCountdowns();
    countdownTimer = window.setInterval(updateCountdowns, 250);
  }

  function renderMenu(field) {
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Coffer codes";
    const fragment = document.createDocumentFragment();
    fragment.append(title);
    accounts.forEach((account, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "option";
      option.setAttribute("role", "option");
      const logo = document.createElement("span");
      logo.className = "logo";
      applyLogo(logo, account);
      const copy = document.createElement("span");
      copy.className = "copy";
      const service = document.createElement("span");
      service.className = "service";
      service.textContent = account.service;
      const identity = document.createElement("span");
      identity.className = "identity";
      identity.textContent = account.identity || account.group || "Coffer account";
      copy.append(service, identity);
      const code = document.createElement("span");
      code.className = "code";
      code.textContent = account.code;
      const countdown = createCountdown(account);
      option.append(logo, copy, code, countdown);
      option.addEventListener("pointerenter", () => selectIndex(index));
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        fillCode(field, account.rawCode);
      });
      fragment.append(option);
    });
    menu.replaceChildren(fragment);
    selectedIndex = 0;
    selectIndex(0);
    menu.classList.add("open");
    startCountdowns();
    schedulePosition();
  }

  function scheduleCodeRefresh() {
    clearRefreshTimer();
    const remaining = accounts
      .map((account) => Number(account.remaining))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (remaining.length === 0) return;
    const delay = Math.max(1_000, (Math.min(...remaining) + 0.2) * 1_000);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      if (activeField) void showSuggestions(activeField);
    }, delay);
  }

  async function showSuggestions(field) {
    if (!isTotpField(field)) {
      if (field === activeField) closeMenu();
      return;
    }
    appendHost();
    activeField = field;
    const epoch = ++requestEpoch;
    try {
      const response = await runtimeMessage({ type: "inline-suggestions" });
      if (epoch !== requestEpoch || activeField !== field || !field.isConnected) return;
      accounts = Array.isArray(response?.accounts)
        ? response.accounts.filter((account) => (
            account &&
            typeof account.service === "string" &&
            /^\d{6,8}$/u.test(String(account.rawCode ?? ""))
          ))
        : [];
      if (accounts.length === 0) {
        closeMenu();
        return;
      }
      renderMenu(field);
      scheduleCodeRefresh();
    } catch {
      if (epoch === requestEpoch) closeMenu();
    }
  }

  document.addEventListener("focusin", (event) => {
    if (isTotpField(event.target)) void showSuggestions(event.target);
  }, true);

  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (activeField && document.activeElement !== activeField) closeMenu();
    }, 0);
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target === activeField) void showSuggestions(activeField);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!activeField || !menu.classList.contains("open")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectIndex(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectIndex(selectedIndex - 1);
    } else if (event.key === "Enter" && accounts[selectedIndex]) {
      event.preventDefault();
      fillCode(activeField, accounts[selectedIndex].rawCode);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }, true);

  document.addEventListener("pointerdown", (event) => {
    if (activeField && event.target !== activeField && !event.composedPath().includes(host)) closeMenu();
  }, true);
  document.addEventListener("scroll", schedulePosition, true);
  window.addEventListener("resize", schedulePosition);
  window.addEventListener("pagehide", closeMenu, { once: true });
  appendHost();
  if (isTotpField(document.activeElement)) void showSuggestions(document.activeElement);
})();
