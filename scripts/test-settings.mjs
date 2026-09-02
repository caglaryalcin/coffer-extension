import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const source = await readFile(resolve(rootDir, "chrome", "background.js"), "utf8");
const runtimeStart = source.indexOf("const STORAGE_KEY");
const runtimeEnd = source.indexOf("browser.alarms?.onAlarm?.addListener");
assert.notEqual(runtimeStart, -1, "Could not find the extension runtime start.");
assert.notEqual(runtimeEnd, -1, "Could not find the session alarm listener.");

const SETTINGS_KEY = "cofferAutofillSettings";

function createBrowser(initialLocalState = {}) {
  const localState = structuredClone(initialLocalState);
  const sessionState = {};
  const observed = {
    permissionChecks: [],
    permissionRemovals: [],
    tabsCreated: [],
  };

  const removeKeys = (state, keys) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
  };

  return {
    browser: {
      alarms: {
        async clear() {
          return true;
        },
        async get() {
          return undefined;
        },
        async getAll() {
          return [];
        },
      },
      permissions: {
        async contains(details) {
          observed.permissionChecks.push(structuredClone(details));
          return false;
        },
        async remove(details) {
          observed.permissionRemovals.push(structuredClone(details));
          return true;
        },
        async request() {
          return false;
        },
      },
      storage: {
        local: {
          async get(key) {
            return Object.hasOwn(localState, key) ? { [key]: structuredClone(localState[key]) } : {};
          },
          async remove(keys) {
            removeKeys(localState, keys);
          },
          async set(values) {
            Object.assign(localState, structuredClone(values));
          },
        },
        session: {
          async get(key) {
            return Object.hasOwn(sessionState, key) ? { [key]: structuredClone(sessionState[key]) } : {};
          },
          async remove(keys) {
            removeKeys(sessionState, keys);
          },
          async set(values) {
            Object.assign(sessionState, structuredClone(values));
          },
        },
      },
      tabs: {
        async create(details) {
          observed.tabsCreated.push(structuredClone(details));
          return details;
        },
        async query() {
          return [];
        },
      },
    },
    localState,
    observed,
  };
}

const loadRuntime = new Function("browser", "fetch", "crypto", `
  ${source.slice(runtimeStart, runtimeEnd)}
  return { openCoffer, popupState, readSettings, saveSettings };
`);

const harness = createBrowser();
const runtime = loadRuntime(
  harness.browser,
  async () => { throw new Error("Settings tests must not access the network."); },
  crypto,
);

assert.deepEqual(
  await runtime.readSettings(),
  { cofferOrigin: "" },
  "An extension without saved settings must not prefill a Coffer URL.",
);

const initialPopupState = await runtime.popupState();
assert.equal(initialPopupState.ok, true);
assert.deepEqual(initialPopupState.settings, { cofferOrigin: "" });
assert.equal(initialPopupState.hasPermission, false);
assert.equal(initialPopupState.insecureOrigin, false);
assert.equal(initialPopupState.coffer, null);
assert.deepEqual(
  harness.observed.permissionChecks,
  [],
  "An empty Coffer URL must not be converted into a host-permission pattern.",
);

const emptyOpenResult = await runtime.openCoffer();
assert.equal(emptyOpenResult.ok, false);
assert.equal(emptyOpenResult.error?.code, "invalid_origin");
assert.deepEqual(harness.observed.tabsCreated, [], "An empty Coffer URL must not open a browser tab.");

const saved = await runtime.saveSettings({ cofferOrigin: "coffer.yourhost.com/path?q=ignored" });
assert.deepEqual(saved, {
  ok: true,
  settings: { cofferOrigin: "https://coffer.yourhost.com" },
});
assert.deepEqual(harness.localState[SETTINGS_KEY], { cofferOrigin: "https://coffer.yourhost.com" });
assert.deepEqual(
  harness.observed.permissionRemovals,
  [],
  "Saving the first Coffer URL must not try to remove permission for an empty origin.",
);
assert.deepEqual(await runtime.readSettings(), { cofferOrigin: "https://coffer.yourhost.com" });

console.log("Verified empty initial Coffer settings, first save, and guarded URL opening.");
