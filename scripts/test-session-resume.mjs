import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const source = await readFile(resolve(rootDir, "chrome", "background.js"), "utf8");
const compatSource = await readFile(resolve(rootDir, "chrome", "browser-compat.js"), "utf8");
const runtimeStart = source.indexOf("const STORAGE_KEY");
const runtimeEnd = source.indexOf("browser.alarms?.onAlarm?.addListener");
assert.notEqual(runtimeStart, -1, "Could not find the extension runtime start.");
assert.notEqual(runtimeEnd, -1, "Could not find the session alarm listener.");
assert.match(compatSource, /storage\.session/u, "The Chrome compatibility layer must expose session storage.");
assert.match(compatSource, /chromeApi\.alarms/u, "The Chrome compatibility layer must expose alarms.");
assert.match(compatSource, /getAll: promisify\(chromeApi\.alarms, chromeApi\.alarms\.getAll\)/u);
assert.match(source, /sessionStorageTask = task\.then\(\(\) => undefined, \(\) => undefined\);/u);
assert.match(source, /if \(credentials\.rememberLogin\) \{/u);
assert.match(source, /await persistRememberedSession\(session, sessionKeyBytes\);/u);

for (const browserName of ["chrome", "firefox"]) {
  const manifest = JSON.parse(await readFile(resolve(rootDir, browserName, "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("storage"), true);
  assert.equal(manifest.permissions.includes("alarms"), true);
}

const SESSION_KEY = "cofferUnlockedSessionV1";
const SESSION_FORMAT = "coffer-extension-unlocked-session";
const COFFER_ORIGIN = "https://coffer.example";
const IDENTIFIER = "owner@example.com";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const VAULT_ID = randomBase64(16);
const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
const authKeyBytes = crypto.getRandomValues(new Uint8Array(32));

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function randomBase64(length) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(length)));
}

async function encryptedVaultPayload() {
  const vault = {
    format: "coffer-vault",
    profile: { email: IDENTIFIER, name: "Owner" },
    settings: { theme: "dark" },
    accounts: [{
      id: "github-owner",
      service: "GitHub",
      identity: IDENTIFIER,
      group: "Work",
      secret: TOTP_SECRET,
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
      archived: false,
      favorite: true,
    }],
  };
  const key = await crypto.subtle.importKey(
    "raw",
    vaultKeyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("coffer:vault-payload:v1"),
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(JSON.stringify(vault)),
  );
  return {
    algorithm: "AES-256-GCM",
    tagLength: 128,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

const payload = await encryptedVaultPayload();
const header = {
  format: "coffer-vault",
  version: 1,
  vaultId: VAULT_ID,
  createdAt: new Date().toISOString(),
  kdf: {
    algorithm: "argon2id",
    salt: randomBase64(16),
    memoryKiB: 19 * 1024,
    iterations: 2,
    parallelism: 1,
    hashLength: 64,
  },
  passwordVerifier: {
    algorithm: "HMAC-SHA-256",
    value: randomBase64(32),
  },
  wrappedKey: {
    algorithm: "AES-256-GCM",
    iv: randomBase64(12),
    ciphertext: randomBase64(48),
    tagLength: 128,
  },
};

function response(body) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function errorResponse(code, message = "Temporary server error.") {
  return {
    ok: false,
    async text() {
      return JSON.stringify({ error: { code, message } });
    },
  };
}

function createFetch(observed, identifyGate = null) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    observed.push(body.action);
    if (body.action === "identify") {
      if (identifyGate) await identifyGate;
      return response({ configured: true, header, revision: 7 });
    }
    if (body.action === "login") {
      assert.equal(body.identifier, IDENTIFIER);
      assert.match(body.authProof, /^[A-Za-z0-9_-]+$/u);
      return response({ payload, revision: 8 });
    }
    throw new Error(`Unexpected vault action: ${body.action}`);
  };
}

function createBrowser(storageState, alarms, options = {}) {
  let beforeFirstAlarmCreate = options.beforeFirstAlarmCreate;
  let remainingGetFailures = options.failGetCount ?? 0;
  let remainingSetFailures = options.failSetCount ?? 0;
  let beforeFirstSessionSet = options.beforeFirstSessionSet;
  return {
    alarms: {
      async clear(name) {
        alarms.delete(name);
        return true;
      },
      async create(name, details) {
        if (beforeFirstAlarmCreate) {
          const beforeCreate = beforeFirstAlarmCreate;
          beforeFirstAlarmCreate = null;
          await beforeCreate();
        }
        alarms.set(name, details);
      },
      async get(name) {
        const details = alarms.get(name);
        return details ? { name, scheduledTime: details.when } : undefined;
      },
      async getAll() {
        return [...alarms].map(([name, details]) => ({ name, scheduledTime: details.when }));
      },
    },
    storage: {
      local: {
        async get() {
          return {};
        },
      },
      session: {
        async get(key) {
          if (remainingGetFailures > 0) {
            remainingGetFailures -= 1;
            throw new Error("session get failed");
          }
          return Object.hasOwn(storageState, key) ? { [key]: structuredClone(storageState[key]) } : {};
        },
        async remove(key) {
          if (options.failRemove) throw new Error("session remove failed");
          delete storageState[key];
        },
        async set(values) {
          if (beforeFirstSessionSet) {
            const beforeSet = beforeFirstSessionSet;
            beforeFirstSessionSet = null;
            await beforeSet();
          }
          if (remainingSetFailures > 0) {
            remainingSetFailures -= 1;
            throw new Error("session set failed");
          }
          Object.assign(storageState, structuredClone(values));
        },
      },
    },
  };
}

const loadRuntime = new Function("browser", "fetch", "crypto", "hooks", `
  ${source.slice(runtimeStart, runtimeEnd)}
  if (hooks) {
    readSettings = hooks.readSettings;
    hasCofferPermission = hooks.hasCofferPermission;
    serviceBrandCatalog = hooks.serviceBrandCatalog;
    identifyVault = hooks.identifyVault;
    unlockVaultHeader = hooks.unlockVaultHeader;
    createAuthProof = hooks.createAuthProof;
    loginVault = hooks.loginVault;
    decryptVaultPayload = hooks.decryptVaultPayload;
    parseVaultPayload = hooks.parseVaultPayload;
    publicVaultState = hooks.publicVaultState;
  }
  return {
    clearSession,
    decodeRememberedSession,
    expireRememberedSession,
    getActiveSession: () => activeSession,
    getSessionEpoch: () => sessionEpoch,
    getSessionRestoreWarning: () => sessionRestoreWarning,
    persistRememberedSession,
    removeRememberedSession,
    sessionIsAvailable,
    setActiveSession: (session) => { activeSession = session; },
    setSessionRestoreWarning: (warning) => { sessionRestoreWarning = warning; },
    unlockCoffer,
  };
`);

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolvePromiseValue) => { resolvePromise = resolvePromiseValue; });
  return { promise, resolve: resolvePromise };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

function createUnlockHooks() {
  return {
    async readSettings() {
      return { cofferOrigin: COFFER_ORIGIN };
    },
    async hasCofferPermission() {
      return true;
    },
    async serviceBrandCatalog() {},
    async identifyVault(_origin, identifier) {
      return { ok: true, header: { vaultId: VAULT_ID }, identifier };
    },
    async unlockVaultHeader() {
      return { authKey: {}, vaultKey: {}, sessionKeyBytes: null };
    },
    async createAuthProof() {
      return "proof";
    },
    async loginVault() {
      return { ok: true, payload: {}, revision: 9 };
    },
    async decryptVaultPayload() {
      return {};
    },
    parseVaultPayload() {
      return { accounts: [], profile: {}, settings: { theme: "dark" } };
    },
    async publicVaultState() {
      return { ok: true };
    },
  };
}

const storageState = {};
const alarms = new Map();
const initialFetches = [];
const initialRuntime = loadRuntime(createBrowser(storageState, alarms), createFetch(initialFetches), crypto);
const now = Date.now();
const initialSession = {
  cofferOrigin: COFFER_ORIGIN,
  expiresAt: now + 12 * 60 * 60 * 1_000,
  identifier: IDENTIFIER,
  remembered: true,
  revision: 7,
  runtime: { shouldNeverPersist: true },
  sessionId: randomBase64(16),
  unlockedAt: now,
  vault: { accounts: [{ secret: TOTP_SECRET }] },
  vaultId: VAULT_ID,
};
initialRuntime.setActiveSession(initialSession);
await initialRuntime.persistRememberedSession(initialSession, {
  authKey: authKeyBytes.slice(),
  vaultKey: vaultKeyBytes.slice(),
});

const storedRecord = structuredClone(storageState[SESSION_KEY]);
assert.equal(storedRecord.format, SESSION_FORMAT);
assert.equal(storedRecord.version, 1);
assert.equal(storedRecord.cofferOrigin, COFFER_ORIGIN);
assert.equal(storedRecord.identifier, IDENTIFIER);
assert.equal(storedRecord.expiresAt, initialSession.expiresAt);
assert.equal(Object.hasOwn(storedRecord, "vault"), false);
assert.equal(Object.hasOwn(storedRecord, "runtime"), false);
assert.equal(Object.hasOwn(storedRecord, "password"), false);
assert.equal(Object.hasOwn(storedRecord, "revision"), false);
assert.doesNotMatch(JSON.stringify(storedRecord), new RegExp(TOTP_SECRET, "u"));
assert.equal(alarms.get(`coffer-session-expiry:${initialSession.sessionId}`)?.when, initialSession.expiresAt);

const decoded = initialRuntime.decodeRememberedSession(storedRecord, { cofferOrigin: COFFER_ORIGIN });
assert.deepEqual(decoded.authKey, authKeyBytes);
assert.deepEqual(decoded.vaultKey, vaultKeyBytes);
decoded.authKey.fill(0);
decoded.vaultKey.fill(0);
assert.throws(
  () => initialRuntime.decodeRememberedSession(
    { ...storedRecord, expiresAt: storedRecord.unlockedAt + 12 * 60 * 60 * 1_000 + 1 },
    { cofferOrigin: COFFER_ORIGIN },
  ),
  /invalid/u,
);
assert.throws(
  () => initialRuntime.decodeRememberedSession(
    { ...storedRecord, keys: { ...storedRecord.keys, vault: "AA==" } },
    { cofferOrigin: COFFER_ORIGIN },
  ),
  /exactly 32 bytes/u,
);

const restartFetches = [];
const restartedRuntime = loadRuntime(createBrowser(storageState, alarms), createFetch(restartFetches), crypto);
const restored = await Promise.all([
  restartedRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }),
  restartedRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }),
  restartedRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }),
]);
assert.deepEqual(restored, [true, true, true]);
assert.deepEqual(restartFetches, ["identify", "login"], "Concurrent callers must share one restore.");
const activeSession = restartedRuntime.getActiveSession();
assert.equal(activeSession.vault.accounts[0].secret, TOTP_SECRET);
assert.equal(activeSession.runtime.authKey.extractable, false);
assert.equal(activeSession.runtime.vaultKey.extractable, false);

storageState[SESSION_KEY] = structuredClone(storedRecord);
let releaseIdentify;
let identifyStarted;
const identifyGate = new Promise((resolve) => { releaseIdentify = resolve; });
const started = new Promise((resolve) => { identifyStarted = resolve; });
const raceFetches = [];
const raceFetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (body.action === "identify") identifyStarted();
  return createFetch(raceFetches, body.action === "identify" ? identifyGate : null)(url, options);
};
const raceRuntime = loadRuntime(createBrowser(storageState, alarms), raceFetch, crypto);
const restoreDuringLock = raceRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN });
await started;
await raceRuntime.clearSession();
releaseIdentify();
assert.equal(await restoreDuringLock, false);
assert.equal(raceRuntime.getActiveSession(), null, "Lock must win over an in-flight restore.");
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false);

const unlockStorage = {};
const unlockAlarms = new Map();
const unlockClearStarted = deferred();
const releaseUnlockClear = deferred();
const unlockRaceRuntime = loadRuntime(
  createBrowser(unlockStorage, unlockAlarms, {
    beforeFirstSessionSet: async () => {
      unlockClearStarted.resolve();
      await releaseUnlockClear.promise;
    },
  }),
  createFetch([]),
  crypto,
  createUnlockHooks(),
);
const unlockDuringLock = unlockRaceRuntime.unlockCoffer({
  identifier: "first@example.com",
  password: "correct horse battery staple",
  rememberLogin: false,
});
await unlockClearStarted.promise;
const lockDuringUnlock = unlockRaceRuntime.clearSession();
assert.equal(unlockRaceRuntime.getSessionEpoch(), 2);
releaseUnlockClear.resolve();
const [cancelledUnlock] = await Promise.all([unlockDuringLock, lockDuringUnlock]);
assert.equal(cancelledUnlock.ok, false);
assert.equal(cancelledUnlock.error.code, "unlock_cancelled");
assert.equal(unlockRaceRuntime.getActiveSession(), null, "Lock must win while a fresh unlock is clearing state.");

const concurrentStorage = {};
const concurrentAlarms = new Map();
const firstUnlockClearStarted = deferred();
const releaseFirstUnlockClear = deferred();
const concurrentUnlockRuntime = loadRuntime(
  createBrowser(concurrentStorage, concurrentAlarms, {
    beforeFirstSessionSet: async () => {
      firstUnlockClearStarted.resolve();
      await releaseFirstUnlockClear.promise;
    },
  }),
  createFetch([]),
  crypto,
  createUnlockHooks(),
);
const firstUnlock = concurrentUnlockRuntime.unlockCoffer({
  identifier: "first@example.com",
  password: "first password",
  rememberLogin: false,
});
await firstUnlockClearStarted.promise;
const secondUnlock = concurrentUnlockRuntime.unlockCoffer({
  identifier: "second@example.com",
  password: "second password",
  rememberLogin: false,
});
await waitFor(
  () => concurrentUnlockRuntime.getSessionEpoch() === 2,
  "The second unlock did not invalidate the first unlock.",
);
releaseFirstUnlockClear.resolve();
const [firstUnlockResult, secondUnlockResult] = await Promise.all([firstUnlock, secondUnlock]);
assert.equal(firstUnlockResult.ok, false);
assert.equal(firstUnlockResult.error.code, "unlock_cancelled");
assert.equal(secondUnlockResult.ok, true);
assert.equal(
  concurrentUnlockRuntime.getActiveSession()?.identifier,
  "second@example.com",
  "The latest concurrent unlock must be the only session that is published.",
);

const persistRaceStorage = {};
const persistRaceAlarms = new Map();
const persistAlarmStarted = deferred();
const releasePersistAlarm = deferred();
const persistRaceRuntime = loadRuntime(
  createBrowser(persistRaceStorage, persistRaceAlarms, {
    beforeFirstAlarmCreate: async () => {
      persistAlarmStarted.resolve();
      await releasePersistAlarm.promise;
    },
  }),
  createFetch([]),
  crypto,
);
const persistRaceNow = Date.now();
const persistRaceSession = {
  ...initialSession,
  expiresAt: persistRaceNow + 12 * 60 * 60 * 1_000,
  sessionId: randomBase64(16),
  unlockedAt: persistRaceNow,
};
persistRaceRuntime.setActiveSession(persistRaceSession);
const persistDuringLock = persistRaceRuntime.persistRememberedSession(persistRaceSession, {
  authKey: authKeyBytes.slice(),
  vaultKey: vaultKeyBytes.slice(),
});
await persistAlarmStarted.promise;
await persistRaceRuntime.clearSession();
releasePersistAlarm.resolve();
await assert.rejects(persistDuringLock, /session changed/u);
assert.equal(persistRaceRuntime.getActiveSession(), null);
assert.equal(Object.hasOwn(persistRaceStorage, SESSION_KEY), false);
assert.equal(
  persistRaceAlarms.has(`coffer-session-expiry:${persistRaceSession.sessionId}`),
  false,
  "A stale alarm created after Lock must be revoked.",
);

const expiredRecord = {
  ...structuredClone(storedRecord),
  unlockedAt: Date.now() - 60_000,
  expiresAt: Date.now() - 1,
};
storageState[SESSION_KEY] = structuredClone(expiredRecord);
const alarmRuntime = loadRuntime(createBrowser(storageState, alarms), createFetch([]), crypto);
alarmRuntime.setActiveSession({ sessionId: expiredRecord.sessionId });
alarmRuntime.setSessionRestoreWarning("Coffer could not restore the unlocked session while the server is unavailable.");
await alarmRuntime.expireRememberedSession(expiredRecord.sessionId);
assert.equal(alarmRuntime.getActiveSession(), null);
assert.equal(alarmRuntime.getSessionRestoreWarning(), "");
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false, "The expiry alarm must remove its session.");

storageState[SESSION_KEY] = structuredClone(storedRecord);
await alarmRuntime.expireRememberedSession(randomBase64(16));
assert.equal(Object.hasOwn(storageState, SESSION_KEY), true, "An old alarm must not clear a newer session.");

const unrelatedSessionId = randomBase64(16);
assert.equal(await alarmRuntime.removeRememberedSession(unrelatedSessionId), false);
assert.equal(
  storageState[SESSION_KEY].sessionId,
  storedRecord.sessionId,
  "Stale cleanup must not delete a different session record.",
);

storageState[SESSION_KEY] = structuredClone(storedRecord);
const removalFailureRuntime = loadRuntime(
  createBrowser(storageState, alarms, { failRemove: true }),
  createFetch([]),
  crypto,
);
removalFailureRuntime.setActiveSession({ sessionId: storedRecord.sessionId });
await removalFailureRuntime.clearSession();
assert.equal(storageState[SESSION_KEY], null, "A failed remove must leave a fail-closed tombstone.");
assert.equal(
  await removalFailureRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }),
  false,
  "Lock must block restore in the current worker.",
);

storageState[SESSION_KEY] = structuredClone(storedRecord);
const retryRuntime = loadRuntime(
  createBrowser(storageState, alarms, { failSetCount: 1 }),
  createFetch([]),
  crypto,
);
retryRuntime.setActiveSession({ sessionId: storedRecord.sessionId });
await retryRuntime.clearSession();
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false, "Lock must retry its tombstone write once.");

storageState[SESSION_KEY] = structuredClone(storedRecord);
const removalFallbackRuntime = loadRuntime(
  createBrowser(storageState, alarms, { failSetCount: 2 }),
  createFetch([]),
  crypto,
);
removalFallbackRuntime.setActiveSession({ sessionId: storedRecord.sessionId });
await removalFallbackRuntime.clearSession();
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false, "Direct removal must back up tombstone writes.");

storageState[SESSION_KEY] = structuredClone(storedRecord);
const storedAlarmName = `coffer-session-expiry:${storedRecord.sessionId}`;
alarms.set(storedAlarmName, { when: storedRecord.expiresAt });
const blockedRuntime = loadRuntime(
  createBrowser(storageState, alarms, { failGetCount: 1, failSetCount: 2, failRemove: true }),
  createFetch([]),
  crypto,
);
blockedRuntime.setActiveSession({ sessionId: storedRecord.sessionId });
await assert.rejects(blockedRuntime.clearSession(), /session (?:get|remove) failed/u);
assert.equal(
  await blockedRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }),
  false,
  "A storage failure must not rehydrate after Lock in the same worker.",
);
assert.equal(alarms.has(storedAlarmName), false, "A failed Lock must revoke the session alarm marker.");

const recoveredFetches = [];
const recoveredRuntime = loadRuntime(createBrowser(storageState, alarms), createFetch(recoveredFetches), crypto);
assert.equal(await recoveredRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }), false);
assert.deepEqual(recoveredFetches, [], "A missing expiry marker must reject a stale record before network access.");
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false);

for (const transientCode of [
  "corrupt_store",
  "invalid_response",
  "network_error",
  "rate_limited",
  "request_failed",
  "request_timeout",
  "storage_error",
]) {
  storageState[SESSION_KEY] = structuredClone(storedRecord);
  alarms.set(storedAlarmName, { when: storedRecord.expiresAt });
  const transientFetches = [];
  const transientRuntime = loadRuntime(
    createBrowser(storageState, alarms),
    async (_url, options) => {
      transientFetches.push(JSON.parse(options.body).action);
      return errorResponse(transientCode);
    },
    crypto,
  );
  assert.equal(await transientRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }), false);
  assert.deepEqual(transientFetches, ["identify"]);
  assert.equal(
    storageState[SESSION_KEY].sessionId,
    storedRecord.sessionId,
    `A ${transientCode} restore failure must keep the remembered session for a retry.`,
  );
  assert.equal(alarms.has(storedAlarmName), true);
}

storageState[SESSION_KEY] = structuredClone(expiredRecord);
const expiredFetches = [];
const expiredRuntime = loadRuntime(createBrowser(storageState, alarms), createFetch(expiredFetches), crypto);
expiredRuntime.setSessionRestoreWarning("Coffer could not restore the unlocked session while the server is unavailable.");
assert.equal(await expiredRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }), false);
assert.deepEqual(expiredFetches, [], "Expired sessions must be rejected before network access.");
assert.equal(Object.hasOwn(storageState, SESSION_KEY), false);
assert.equal(expiredRuntime.getSessionRestoreWarning(), "");

expiredRuntime.setSessionRestoreWarning("stale warning");
assert.equal(await expiredRuntime.sessionIsAvailable({ cofferOrigin: COFFER_ORIGIN }), false);
assert.equal(expiredRuntime.getSessionRestoreWarning(), "", "A missing session must clear stale restore warnings.");

vaultKeyBytes.fill(0);
authKeyBytes.fill(0);
console.log("Verified remembered-session persistence, restore, expiry, and lock race handling.");
