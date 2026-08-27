/* global browser */

const originInput = document.querySelector("#coffer-origin");
const connectionCard = document.querySelector("#connection-card");
const connectionForm = document.querySelector("#connection-form");
const openCofferButton = document.querySelector("#open-coffer");
const statusBox = document.querySelector("#status");
const authCard = document.querySelector("#auth-card");
const emailInput = document.querySelector("#coffer-email");
const passwordInput = document.querySelector("#coffer-password");
const rememberInput = document.querySelector("#coffer-remember");
const vaultTools = document.querySelector("#vault-tools");
const searchInput = document.querySelector("#code-search");
const pageCodesSection = document.querySelector("#page-codes");
const pageCodesList = document.querySelector("#page-codes-list");
const allCodesSection = document.querySelector("#all-codes");
const codesList = document.querySelector("#codes-list");

let latestCodes = [];
let latestPageCodes = [];

function setStatus(message, tone = "") {
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.className = `status-card ${tone}`.trim();
}

function clearStatus() {
  statusBox.textContent = "";
  statusBox.className = "status-card";
  statusBox.hidden = true;
}

function initials(value) {
  const words = String(value).trim().split(/\s+/u).filter(Boolean);
  return (words.length > 1
    ? words.map((word) => word[0]).join("")
    : String(value).slice(0, 2)).slice(0, 3).toUpperCase();
}

function applyAccountIcon(logo, account) {
  logo.replaceChildren();
  logo.className = "code-logo";
  logo.style.backgroundColor = "";
  logo.title = "";

  const src = account.iconDataUrl || account.iconUrl;
  if (!src) {
    logo.textContent = initials(account.service);
    return;
  }

  const image = document.createElement("img");
  image.alt = "";
  image.decoding = "async";
  image.src = src;
  logo.classList.add("has-icon");
  if (account.iconColor) logo.style.backgroundColor = account.iconColor;
  if (account.iconTitle) logo.title = account.iconTitle;
  image.addEventListener("error", () => {
    logo.className = "code-logo";
    logo.style.backgroundColor = "";
    logo.title = "";
    logo.replaceChildren(document.createTextNode(initials(account.service)));
  }, { once: true });
  logo.append(image);
}

function errorMessage(response, fallback) {
  return response?.error?.message ?? fallback;
}

function normalizeCofferOrigin(value) {
  const rawInput = String(value ?? "").trim();
  if (!rawInput) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawInput)
    ? rawInput
    : `${/^(\[?::1\]?|localhost|127\.0\.0\.1)(?::|\/|$)/i.test(rawInput) ? "http" : "https"}://${rawInput}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originPermissionPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

async function saveCurrentOrigin(statusMessage = "Saving Coffer URL...") {
  setStatus(statusMessage);
  const response = await browser.runtime.sendMessage({
    type: "save-settings",
    settings: { cofferOrigin: originInput.value },
  });
  if (!response?.ok) {
    setStatus(errorMessage(response, "The Coffer URL could not be saved."), "warning");
    return null;
  }
  originInput.value = response.settings.cofferOrigin;
  return response.settings.cofferOrigin;
}

async function ensureCofferPermission(origin) {
  const normalizedOrigin = normalizeCofferOrigin(origin);
  if (!normalizedOrigin) {
    setStatus("Enter a valid Coffer URL.", "warning");
    return false;
  }
  const origins = [originPermissionPattern(normalizedOrigin)];
  if (await browser.permissions.contains({ origins })) return true;
  const granted = await browser.permissions.request({ origins });
  setStatus(granted ? "Coffer URL access granted." : "Permission was not granted.", granted ? "success" : "warning");
  return granted;
}

function codeMatchesSearch(account, query) {
  if (!query) return true;
  const haystack = [
    account.service,
    account.identity,
    account.group,
    account.rawCode,
    account.code,
  ].join(" ").toLocaleLowerCase("en");
  return haystack.includes(query);
}

async function fillCode(account, button) {
  button.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({
      type: "fill-code",
      accountId: account.id,
    });
    if (!response?.ok) {
      setStatus(errorMessage(response, "Coffer could not fill this code."), "warning");
      button.disabled = false;
      return;
    }
    clearStatus();
    button.textContent = "Filled";
    window.setTimeout(() => {
      button.textContent = "Fill";
      button.disabled = false;
    }, 900);
  } catch {
    setStatus("Firefox did not allow filling this page.", "warning");
    button.disabled = false;
  }
}

function renderCodeRows(container, accounts, emptyMessage) {
  container.replaceChildren();
  if (accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }

  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = "code-row";

    const logo = document.createElement("span");
    applyAccountIcon(logo, account);

    const copy = document.createElement("div");
    copy.className = "code-copy";
    const service = document.createElement("strong");
    service.textContent = account.service;
    const identity = document.createElement("span");
    identity.textContent = account.identity || account.group || "Coffer account";
    copy.append(service, identity);

    const meta = document.createElement("div");
    meta.className = "code-meta";
    const code = document.createElement("span");
    code.className = "code-value";
    code.textContent = account.code;
    const remaining = document.createElement("span");
    remaining.className = account.remaining <= 5 ? "code-remaining expiring" : "code-remaining";
    remaining.textContent = `${account.remaining}s`;
    const fillButton = document.createElement("button");
    fillButton.type = "button";
    fillButton.className = "fill-button";
    fillButton.textContent = "Fill";
    fillButton.addEventListener("click", () => fillCode(account, fillButton));
    meta.append(code, remaining, fillButton);

    row.append(logo, copy, meta);
    container.append(row);
  }
}

function renderCodes(accounts = latestCodes, pageMatches = latestPageCodes) {
  latestCodes = Array.isArray(accounts) ? accounts : [];
  latestPageCodes = Array.isArray(pageMatches) ? pageMatches : [];

  const query = searchInput.value.trim().toLocaleLowerCase("en");
  const visiblePageCodes = latestPageCodes.filter((account) => codeMatchesSearch(account, query));
  pageCodesSection.hidden = visiblePageCodes.length === 0;
  if (visiblePageCodes.length > 0) {
    renderCodeRows(pageCodesList, visiblePageCodes, "No codes match this page.");
  } else {
    pageCodesList.replaceChildren();
  }

  const pageIds = new Set(latestPageCodes.map((account) => account.id));
  const otherCodes = latestCodes.filter((account) => !pageIds.has(account.id));
  const visibleCodes = otherCodes.filter((account) => codeMatchesSearch(account, query));
  renderCodeRows(
    codesList,
    visibleCodes,
    latestCodes.length === 0
      ? "No active Coffer codes in this vault."
      : otherCodes.length === 0 && !query
        ? "No other active Coffer codes."
        : "No codes match this search.",
  );
}

function setAuthVisible(visible) {
  connectionCard.hidden = !visible;
  authCard.hidden = !visible;
}

function setVaultVisible(visible) {
  vaultTools.hidden = !visible;
  allCodesSection.hidden = !visible;
  if (!visible) {
    pageCodesSection.hidden = true;
    pageCodesList.replaceChildren();
    codesList.replaceChildren();
  }
}

function applyVaultState(vault, warning = "") {
  latestCodes = vault?.accounts ?? [];
  latestPageCodes = vault?.pageMatches ?? [];
  setAuthVisible(false);
  setVaultVisible(true);
  if (warning) {
    setStatus(warning, "warning");
  } else {
    clearStatus();
  }
  renderCodes(latestCodes, latestPageCodes);
}

async function refresh() {
  try {
    const state = await browser.runtime.sendMessage({ type: "popup-state" });
    originInput.value = state?.settings?.cofferOrigin ?? "";
    const warning = state?.insecureOrigin
      ? "This Coffer URL uses plain HTTP. Use HTTPS outside localhost."
      : "";

    if (!state?.hasPermission) {
      setAuthVisible(true);
      setVaultVisible(false);
      latestCodes = [];
      latestPageCodes = [];
      clearStatus();
      renderCodes([]);
      return;
    }

    if (!state.coffer?.ok) {
      setAuthVisible(true);
      setVaultVisible(false);
      latestCodes = [];
      latestPageCodes = [];
      clearStatus();
      renderCodes([]);
      return;
    }

    applyVaultState(state.coffer, warning);
  } catch {
    setAuthVisible(true);
    setVaultVisible(false);
    latestCodes = [];
    latestPageCodes = [];
    setStatus("Coffer could not load.", "warning");
    renderCodes([]);
  }
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  try {
    const savedOrigin = await saveCurrentOrigin("Preparing Coffer...");
    if (!savedOrigin) {
      passwordInput.value = "";
      return;
    }
    const hasPermission = await ensureCofferPermission(savedOrigin);
    if (!hasPermission) {
      passwordInput.value = "";
      setAuthVisible(true);
      setVaultVisible(false);
      renderCodes([]);
      return;
    }
    setStatus("Unlocking Coffer...");
    const response = await browser.runtime.sendMessage({
      type: "unlock-coffer",
      credentials: {
        identifier: emailInput.value,
        password,
        rememberLogin: rememberInput.checked,
      },
    });
    passwordInput.value = "";
    if (!response?.ok) {
      setStatus(errorMessage(response, "Coffer could not be unlocked."), "warning");
      setAuthVisible(true);
      return;
    }
    applyVaultState(response.vault);
  } catch {
    passwordInput.value = "";
    setStatus("Coffer could not be unlocked.", "warning");
    setAuthVisible(true);
  }
});

searchInput.addEventListener("input", () => renderCodes());

openCofferButton.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "open-coffer" });
});

void refresh();
window.setInterval(() => {
  if (!vaultTools.hidden) void refresh();
}, 1_000);
