import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cofferOrigin = "https://coffer.example";
const syntheticCode = "123456";
const accountInput = {
  id: "test-account",
  service: "GitHub",
  identity: "test@example.test",
  secret: "JBSWY3DPEHPK3PXP",
  algorithm: "SHA-1",
  digits: 6,
  period: 30,
};

for (const browserName of ["chrome", "firefox"]) {
  const source = await readFile(resolve(rootDir, browserName, "background.js"), "utf8");
  const runtimeStart = source.indexOf("const STORAGE_KEY");
  const runtimeEnd = source.indexOf("browser.alarms?.onAlarm?.addListener");
  assert.notEqual(runtimeStart, -1);
  assert.notEqual(runtimeEnd, -1);

  const loadRuntime = new Function("browser", "hooks", "window", "document", `
    ${source.slice(runtimeStart, runtimeEnd)}
    readSettings = async () => ({ cofferOrigin: hooks.cofferOrigin });
    sessionIsAvailable = async () => hooks.available;
    const productionEncryptVaultPayload = encryptVaultPayload;
    generateTotp = async () => {
      hooks.generated += 1;
      hooks.onGenerate?.();
      return hooks.code;
    };
    encryptVaultPayload = async (payload) => ({ encryptedPayload: structuredClone(payload) });
    createAuthProof = async () => "test-auth-proof";
    requestVault = async (origin, body) => {
      hooks.requests.push({ origin, body });
      return hooks.saveResponse ?? { ok: true, body: { revision: 6, updatedAt: new Date().toISOString() } };
    };
    publicVaultState = async () => ({ ok: true, accounts: [], pageMatches: [] });
    clearSessionIfCurrent = async (session) => {
      if (activeSession === session) {
        hooks.cleared += 1;
        activeSession = null;
      }
    };
    activeSession = {
      cofferOrigin: hooks.cofferOrigin,
      expiresAt: Date.now() + 60_000,
      identifier: "test@example.test",
      payload: { format: "coffer-vault", version: 11, accounts: [structuredClone(hooks.account)], updatedAt: new Date(0).toISOString() },
      revision: 5,
      runtime: { authKey: {}, vaultKey: {} },
      vault: { accounts: [parseVaultAccount(hooks.account)] },
      vaultId: "test-vault-id",
    };
    return {
      addAccountUrl,
      decryptVaultPayload,
      encryptVaultPayload: productionEncryptVaultPayload,
      fillCode,
      pageFillTotpCode,
      expire: () => { activeSession.expiresAt = Date.now() - 1; },
    };
  `);

  function harness({ urls = ["https://github.com/"], tabUrl = "https://github.com/login", omitUrls = false } = {}) {
    const observed = {
      account: { ...accountInput, ...(omitUrls ? {} : { urls }) },
      available: true,
      cofferOrigin,
      code: syntheticCode,
      generated: 0,
      cleared: 0,
      injections: [],
      requests: [],
      tabUrl,
      onQuery: null,
      onGenerate: null,
      execute: null,
    };
    const pageWindow = { location: { origin: new URL(tabUrl).origin } };
    const inaccessibleDocument = new Proxy({}, {
      get() { throw new Error("A rejected page must not access the DOM."); },
    });
    const browser = {
      tabs: {
        async query() {
          observed.onQuery?.();
          return [{ id: 17, url: observed.tabUrl }];
        },
      },
      scripting: {
        async executeScript(details) {
          observed.injections.push(details);
          const result = observed.execute
            ? await observed.execute(details)
            : { filled: true };
          return [{ frameId: 0, result }];
        },
      },
    };
    const runtime = loadRuntime(browser, observed, pageWindow, inaccessibleDocument);
    return { runtime, observed, pageWindow };
  }

  const cryptoHarness = harness();
  const vaultKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const samplePayload = {
    format: "coffer-vault",
    accounts: [{ id: "round-trip", urls: ["https://example.test/"] }],
  };
  const encryptedPayload = await cryptoHarness.runtime.encryptVaultPayload(samplePayload, vaultKey);
  assert.equal(encryptedPayload.algorithm, "AES-256-GCM");
  assert.deepEqual(
    await cryptoHarness.runtime.decryptVaultPayload(encryptedPayload, vaultKey),
    samplePayload,
    `${browserName}: extension-written payloads must use Coffer's existing vault cipher format.`,
  );

  for (const tabUrl of [
    "https://github.unrelated.test/login",
    "https://github.com.unrelated.test/login",
    "https://notgithub.com/login",
    "http://github.com/login",
    "https://github.com:8443/login",
  ]) {
    const { runtime, observed } = harness({ tabUrl });
    const result = await runtime.fillCode(accountInput.id);
    assert.deepEqual(result, {
      ok: true,
      urlSuggestion: { accountId: accountInput.id, url: new URL(tabUrl).origin },
    }, `${browserName}: a mismatched site must fill and offer to save its URL.`);
    assert.equal(observed.generated, 1, "A mismatched site must generate a code after an explicit Fill click.");
    assert.equal(observed.injections.length, 1, "A mismatched site must receive the explicitly requested fill script.");
  }

  for (const tabUrl of ["https://github.com/login", "https://login.github.com/verify"]) {
    const { runtime, observed } = harness({ tabUrl });
    assert.deepEqual(await runtime.fillCode(accountInput.id), { ok: true });
    assert.equal(observed.generated, 1);
    assert.equal(observed.injections.length, 1);
    const injection = observed.injections[0];
    assert.deepEqual(injection.target, { tabId: 17 });
    assert.deepEqual(injection.args, [syntheticCode, new URL(tabUrl).origin]);
    assert.equal(injection.func, runtime.pageFillTotpCode);
  }

  const manual = harness({ urls: [], tabUrl: "https://unrelated.test/verify" });
  assert.equal((await manual.runtime.fillCode(accountInput.id)).ok, true);
  assert.equal(manual.observed.injections.length, 1, "URL-less accounts retain manual fill.");

  const legacyManual = harness({ omitUrls: true, tabUrl: "https://unrelated.test/verify" });
  assert.equal((await legacyManual.runtime.fillCode(accountInput.id)).ok, true);
  assert.equal(legacyManual.observed.injections.length, 1, "Older accounts without URL fields retain manual fill.");

  const connectedSave = harness({ tabUrl: "https://accounts.unrelated.test/verify" });
  const filled = await connectedSave.runtime.fillCode(accountInput.id);
  assert.equal(filled.ok, true);
  const saved = await connectedSave.runtime.addAccountUrl(
    accountInput.id,
    filled.urlSuggestion.url,
  );
  assert.equal(saved.ok, true, `${browserName}: the suggested URL must save through Coffer.`);
  assert.equal(connectedSave.observed.requests.length, 1);
  const saveRequest = connectedSave.observed.requests[0];
  assert.equal(saveRequest.origin, cofferOrigin);
  assert.equal(saveRequest.body.action, "save_from_extension");
  assert.equal(saveRequest.body.identifier, "test@example.test");
  assert.equal(saveRequest.body.vaultId, "test-vault-id");
  assert.equal(saveRequest.body.expectedRevision, 5);
  assert.equal(saveRequest.body.authProof, "test-auth-proof");
  assert.deepEqual(
    saveRequest.body.payload.encryptedPayload.accounts[0].urls,
    ["https://github.com/", "https://accounts.unrelated.test/"],
  );

  for (const origin of ["https://unrelated.test", "http://github.com", "null"]) {
    const changed = harness();
    changed.pageWindow.location.origin = origin;
    assert.deepEqual(
      changed.runtime.pageFillTotpCode(syntheticCode, "https://github.com"),
      { filled: false, reason: "page_changed" },
      `${browserName}: navigation or an opaque document must stop before DOM access.`,
    );
    changed.observed.execute = ({ func, args }) => func(...args);
    const result = await changed.runtime.fillCode(accountInput.id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "page_changed", "Navigation must have a specific, actionable error.");
  }

  const locked = harness();
  locked.observed.available = false;
  assert.equal((await locked.runtime.fillCode(accountInput.id)).error.code, "vault_locked");
  assert.equal(locked.observed.generated, 0);
  assert.equal(locked.observed.injections.length, 0);

  const expired = harness();
  expired.observed.onQuery = () => expired.runtime.expire();
  assert.equal((await expired.runtime.fillCode(accountInput.id)).error.code, "vault_locked");
  assert.equal(expired.observed.generated, 0);
  assert.equal(expired.observed.injections.length, 0);
  assert.equal(expired.observed.cleared, 1);

  const expiredDuringGeneration = harness();
  expiredDuringGeneration.observed.onGenerate = () => expiredDuringGeneration.runtime.expire();
  assert.equal((await expiredDuringGeneration.runtime.fillCode(accountInput.id)).error.code, "vault_locked");
  assert.equal(expiredDuringGeneration.observed.generated, 1);
  assert.equal(expiredDuringGeneration.observed.injections.length, 0);
  assert.equal(expiredDuringGeneration.observed.cleared, 1);
}

console.log("Verified manual fill URL suggestions, encrypted URL saves, navigation guards, and session expiry in Chrome and Firefox.");
