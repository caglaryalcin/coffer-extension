/* global browser */

const originInput = document.querySelector("#coffer-origin");
const connectionCard = document.querySelector("#connection-card");
const connectionForm = document.querySelector("#connection-form");
const unlockButton = connectionForm.querySelector(".unlock-button");
const openCofferButton = document.querySelector("#open-coffer");
const lockButton = document.querySelector("#lock-coffer");
const privacyButton = document.querySelector("#toggle-privacy");
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

const PRIVACY_STORAGE_KEY = "cofferPopupPrivacyMasked";
const SESSION_KEEPALIVE_MS = 20_000;

let latestCodes = [];
let latestPageCodes = [];
let usernamesMasked = true;
let refreshPromise = null;
let refreshQueued = false;
let uiEpoch = 0;
let iconRefreshTimer = null;
let iconRefreshDelay = 350;
let lastVaultTickSeconds = 0;
let vaultExpiresAt = 0;
let unlockPending = false;
let totpRefreshPending = false;
const iconRetryCounts = new Map();
const rowAccountIds = new WeakMap();

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
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.src = src;
  logo.classList.add("has-icon");
  if (account.iconColor) logo.style.backgroundColor = account.iconColor;
  if (account.iconTitle) logo.title = account.iconTitle;
  image.addEventListener("load", () => {
    iconRetryCounts.delete(src);
  }, { once: true });
  image.addEventListener("error", () => {
    logo.className = "code-logo";
    logo.style.backgroundColor = "";
    logo.title = "";
    logo.replaceChildren(document.createTextNode(initials(account.service)));
    const retries = iconRetryCounts.get(src) ?? 0;
    if (retries < 1) {
      iconRetryCounts.set(src, retries + 1);
      const failedKey = accountIconKey(account);
      window.setTimeout(() => {
        const row = logo.closest(".code-row");
        if (row?.dataset.iconKey === failedKey) delete row.dataset.iconKey;
        renderCodes();
      }, 750);
    }
  }, { once: true });
  logo.append(image);
}

function accountIconKey(account) {
  return [
    account.iconDataUrl || "",
    account.iconUrl || "",
    account.iconColor || "",
    account.iconTitle || "",
    account.service || "",
  ].join("\u0000");
}

function errorMessage(response, fallback) {
  return response?.error?.message ?? fallback;
}

function caughtErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
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

async function requestCofferPermission(origin) {
  const normalizedOrigin = normalizeCofferOrigin(origin);
  if (!normalizedOrigin) {
    setStatus("Enter a valid Coffer URL.", "warning");
    return false;
  }
  const origins = [originPermissionPattern(normalizedOrigin)];
  try {
    const granted = await browser.permissions.request({ origins });
    setStatus(granted ? "Coffer URL access granted." : "Permission was not granted.", granted ? "success" : "warning");
    return granted;
  } catch (error) {
    if (await browser.permissions.contains({ origins }).catch(() => false)) return true;
    setStatus(`The browser could not grant access to this Coffer URL: ${caughtErrorMessage(error, "Permission request failed.")}`, "warning");
    return false;
  }
}

function codeMatchesSearch(account, query) {
  if (!query) return true;
  const haystack = (usernamesMasked
    ? [account.service, account.group, account.rawCode, account.code]
    : [account.service, account.identity, account.group, account.rawCode, account.code]
  ).join(" ").toLocaleLowerCase("en");
  return haystack.includes(query);
}

function searchRevealsUsername(value) {
  const query = String(value).trim().toLocaleLowerCase("en");
  if (!query) return false;
  const matchesVisibleField = latestCodes.some((account) => [
    account.service,
    account.group,
    account.rawCode,
    account.code,
  ].join(" ").toLocaleLowerCase("en").includes(query));
  if (matchesVisibleField) return false;
  return latestCodes.some((account) => String(account.identity || "")
    .toLocaleLowerCase("en").includes(query));
}

function categoryLabel(account) {
  return String(account.group || "").trim() || "Uncategorized";
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
    setStatus("The browser did not allow filling this page.", "warning");
    button.disabled = false;
  }
}

function createCodeRow() {
  const row = document.createElement("div");
  row.className = "code-row";

  const logo = document.createElement("span");
  logo.className = "code-logo";

  const copy = document.createElement("div");
  copy.className = "code-copy";
  const service = document.createElement("strong");
  const identity = document.createElement("span");
  identity.className = "code-identity";
  copy.append(service, identity);

  const meta = document.createElement("div");
  meta.className = "code-meta";
  const code = document.createElement("span");
  code.className = "code-value";
  const remaining = document.createElement("span");
  remaining.className = "code-remaining";
  const fillButton = document.createElement("button");
  fillButton.type = "button";
  fillButton.className = "fill-button";
  fillButton.textContent = "Fill";
  meta.append(code, remaining, fillButton);

  row.append(logo, copy, meta);
  return row;
}

function createCategoryHeader() {
  const header = document.createElement("div");
  header.className = "code-category";
  const title = document.createElement("span");
  const count = document.createElement("small");
  header.append(title, count);
  return header;
}

function setText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function setUsernameText(element, value) {
  if (!element) return;
  if (!usernamesMasked) {
    delete element.dataset.usernameMasked;
    setText(element, value);
    return;
  }
  if (element.dataset.usernameMasked === "true") return;

  const visualMask = document.createElement("span");
  visualMask.className = "privacy-mask";
  visualMask.setAttribute("aria-hidden", "true");
  visualMask.textContent = "••••••••";
  const accessibleLabel = document.createElement("span");
  accessibleLabel.className = "visually-hidden";
  accessibleLabel.textContent = "Username hidden";
  element.replaceChildren(visualMask, accessibleLabel);
  element.dataset.usernameMasked = "true";
}

function updatePrivacyButton() {
  const action = usernamesMasked ? "Show usernames" : "Hide usernames";
  privacyButton.setAttribute("aria-pressed", String(usernamesMasked));
  privacyButton.title = action;
}

async function loadPrivacyPreference() {
  try {
    const stored = await browser.storage.local.get(PRIVACY_STORAGE_KEY);
    usernamesMasked = stored?.[PRIVACY_STORAGE_KEY] !== false;
  } catch {
    usernamesMasked = true;
  }
  updatePrivacyButton();
}

function updateCategoryHeader(header, label, count) {
  const title = header.querySelector("span");
  const counter = header.querySelector("small");
  if (title) setText(title, label);
  if (counter) setText(counter, `${count}`);
}

function updateCodeRow(row, account) {
  const logo = row.querySelector(".code-logo");
  const service = row.querySelector(".code-copy strong");
  const identity = row.querySelector(".code-identity");
  const code = row.querySelector(".code-value");
  const remaining = row.querySelector(".code-remaining");
  const fillButton = row.querySelector(".fill-button");

  const iconKey = accountIconKey(account);
  if (logo && row.dataset.iconKey !== iconKey) {
    applyAccountIcon(logo, account);
    row.dataset.iconKey = iconKey;
  }
  if (service) setText(service, account.service);
  setUsernameText(identity, account.identity || account.group || "Coffer account");
  if (code) setText(code, account.code);
  if (remaining) {
    remaining.className = account.remaining <= 5 ? "code-remaining expiring" : "code-remaining";
    setText(remaining, `${account.remaining}s`);
  }
  if (fillButton) {
    fillButton.onclick = () => fillCode(account, fillButton);
    if (!fillButton.disabled && fillButton.textContent !== "Fill") fillButton.textContent = "Fill";
  }
}

function groupedAccounts(accounts) {
  const groups = [];
  const byLabel = new Map();
  for (const account of accounts) {
    const label = categoryLabel(account);
    let group = byLabel.get(label);
    if (!group) {
      group = { accounts: [], label };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.accounts.push(account);
  }
  return groups;
}

function renderCodeRows(container, accounts, emptyMessage, { grouped = false } = {}) {
  if (accounts.length === 0) {
    const existingEmpty = container.firstElementChild;
    if (
      container.childElementCount === 1 &&
      existingEmpty?.classList.contains("empty")
    ) {
      setText(existingEmpty, emptyMessage);
    } else {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = emptyMessage;
      container.replaceChildren(empty);
    }
    return;
  }

  const existingRows = new Map();
  const existingHeaders = new Map();
  for (const child of container.children) {
    const accountId = rowAccountIds.get(child);
    if (child.classList.contains("code-row") && accountId) {
      existingRows.set(accountId, child);
    } else if (child.classList.contains("code-category") && child.dataset.category) {
      existingHeaders.set(child.dataset.category, child);
    }
  }

  const activeElements = new Set();
  const renderAccount = (account) => {
    const accountId = String(account.id);
    const row = existingRows.get(accountId) ?? createCodeRow();
    rowAccountIds.set(row, accountId);
    activeElements.add(row);
    updateCodeRow(row, account);
    container.append(row);
  };

  if (grouped) {
    for (const group of groupedAccounts(accounts)) {
      const header = existingHeaders.get(group.label) ?? createCategoryHeader();
      header.dataset.category = group.label;
      activeElements.add(header);
      updateCategoryHeader(header, group.label, group.accounts.length);
      container.append(header);
      for (const account of group.accounts) renderAccount(account);
    }
  } else {
    for (const account of accounts) renderAccount(account);
  }

  for (const child of [...container.children]) {
    if (!activeElements.has(child)) child.remove();
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
    { grouped: true },
  );
}

function setAuthVisible(visible) {
  connectionCard.hidden = !visible;
  authCard.hidden = !visible;
}

function setVaultVisible(visible) {
  lockButton.hidden = !visible;
  lockButton.disabled = false;
  privacyButton.hidden = !visible;
  privacyButton.disabled = false;
  vaultTools.hidden = !visible;
  allCodesSection.hidden = !visible;
  if (!visible) {
    if (iconRefreshTimer !== null) window.clearTimeout(iconRefreshTimer);
    iconRefreshTimer = null;
    iconRefreshDelay = 350;
    lastVaultTickSeconds = 0;
    vaultExpiresAt = 0;
    totpRefreshPending = false;
    pageCodesSection.hidden = true;
    pageCodesList.replaceChildren();
    codesList.replaceChildren();
  }
}

function scheduleIconRefresh(pending, retryAt = null) {
  if (iconRefreshTimer !== null) window.clearTimeout(iconRefreshTimer);
  iconRefreshTimer = null;
  if (!pending) {
    iconRefreshDelay = 350;
    return;
  }
  const retryDelay = Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
  const delay = Math.max(iconRefreshDelay, retryDelay);
  iconRefreshTimer = window.setTimeout(() => {
    iconRefreshTimer = null;
    iconRefreshDelay = Math.min(iconRefreshDelay * 2, 2_000);
    void refresh();
  }, delay);
}

function applyVaultState(vault, warning = "") {
  latestCodes = vault?.accounts ?? [];
  latestPageCodes = vault?.pageMatches ?? [];
  lastVaultTickSeconds = Math.floor(Date.now() / 1_000);
  vaultExpiresAt = Number.isFinite(vault?.expiresAt) ? vault.expiresAt : 0;
  totpRefreshPending = false;
  setAuthVisible(false);
  setVaultVisible(true);
  if (warning) {
    setStatus(warning, "warning");
  } else {
    clearStatus();
  }
  renderCodes(latestCodes, latestPageCodes);
  scheduleIconRefresh(vault?.iconsPending === true, vault?.iconsRetryAt);
}

async function performRefresh(epoch) {
  try {
    const state = await browser.runtime.sendMessage({ type: "popup-state" });
    if (epoch !== uiEpoch) return;
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
    if (epoch !== uiEpoch) return;
    setAuthVisible(true);
    setVaultVisible(false);
    latestCodes = [];
    latestPageCodes = [];
    setStatus("Coffer could not load.", "warning");
    renderCodes([]);
  }
}

function refresh({ force = false } = {}) {
  if (refreshPromise) {
    if (force) refreshQueued = true;
    return refreshPromise;
  }
  const epoch = uiEpoch;
  refreshPromise = performRefresh(epoch).finally(() => {
    refreshPromise = null;
    if (refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  });
  return refreshPromise;
}

function setUnlockPending(pending) {
  unlockPending = pending;
  unlockButton.disabled = pending;
}

connectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (unlockPending) return;
  setUnlockPending(true);
  const password = passwordInput.value;
  try {
    const normalizedOrigin = normalizeCofferOrigin(originInput.value);
    if (!normalizedOrigin) {
      setStatus("Enter a valid Coffer URL.", "warning");
      passwordInput.value = "";
      return;
    }
    originInput.value = normalizedOrigin;
    const hasPermission = await requestCofferPermission(normalizedOrigin);
    if (!hasPermission) {
      passwordInput.value = "";
      setAuthVisible(true);
      setVaultVisible(false);
      renderCodes([]);
      return;
    }
    const savedOrigin = await saveCurrentOrigin("Preparing Coffer...");
    if (!savedOrigin) {
      passwordInput.value = "";
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
  } catch (error) {
    passwordInput.value = "";
    setStatus(caughtErrorMessage(error, "Coffer could not be unlocked."), "warning");
    setAuthVisible(true);
  } finally {
    setUnlockPending(false);
  }
});

async function lockCoffer() {
  uiEpoch += 1;
  refreshQueued = false;
  lockButton.disabled = true;
  latestCodes = [];
  latestPageCodes = [];
  searchInput.value = "";
  passwordInput.value = "";
  clearStatus();
  setVaultVisible(false);
  setAuthVisible(true);
  renderCodes([]);
  try {
    await browser.runtime.sendMessage({ type: "lock-coffer" });
  } catch {
    // The UI should still return to the locked state if the background wakes slowly.
  }
}

searchInput.addEventListener("input", () => renderCodes());

openCofferButton.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "open-coffer" });
});

lockButton.addEventListener("click", () => {
  void lockCoffer();
});

privacyButton.addEventListener("click", () => {
  usernamesMasked = !usernamesMasked;
  if (usernamesMasked && searchRevealsUsername(searchInput.value)) searchInput.value = "";
  updatePrivacyButton();
  renderCodes();
  void browser.storage.local.set({ [PRIVACY_STORAGE_KEY]: usernamesMasked }).catch(() => {});
});

async function initialize() {
  await loadPrivacyPreference();
  await refresh();
}

function tickCodes() {
  if (vaultTools.hidden) return;
  if (vaultExpiresAt > 0 && Date.now() >= vaultExpiresAt) {
    vaultExpiresAt = 0;
    void lockCoffer();
    return;
  }
  if (latestCodes.length === 0) return;
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (lastVaultTickSeconds === 0) {
    lastVaultTickSeconds = nowSeconds;
    return;
  }
  const elapsed = nowSeconds - lastVaultTickSeconds;
  if (elapsed <= 0) return;
  lastVaultTickSeconds = nowSeconds;

  if (latestCodes.some((account) => account.remaining <= elapsed)) {
    if (totpRefreshPending) return;
    totpRefreshPending = true;
    uiEpoch += 1;
    const expiredById = new Map();
    latestCodes = latestCodes.map((account) => {
      const expired = { ...account, code: "••• •••", rawCode: "", remaining: 0 };
      expiredById.set(expired.id, expired);
      return expired;
    });
    latestPageCodes = latestPageCodes.map((account) => expiredById.get(account.id) ?? account);
    renderCodes(latestCodes, latestPageCodes);
    void refresh({ force: true });
    return;
  }

  const updatedById = new Map();
  latestCodes = latestCodes.map((account) => {
    const updated = { ...account, remaining: account.remaining - elapsed };
    updatedById.set(updated.id, updated);
    return updated;
  });
  latestPageCodes = latestPageCodes.map((account) => updatedById.get(account.id) ?? account);
  renderCodes(latestCodes, latestPageCodes);
}

async function keepSessionAlive() {
  if (vaultTools.hidden) return;
  try {
    const state = await browser.runtime.sendMessage({ type: "session-keepalive" });
    if (!state?.unlocked) {
      vaultExpiresAt = 0;
      await lockCoffer();
      return;
    }
    if (Number.isFinite(state.expiresAt)) vaultExpiresAt = state.expiresAt;
  } catch {
    // A transient worker wake-up failure should not erase the visible vault.
  }
}

void initialize();
window.setInterval(tickCodes, 1_000);
window.setInterval(() => void keepSessionAlive(), SESSION_KEEPALIVE_MS);
