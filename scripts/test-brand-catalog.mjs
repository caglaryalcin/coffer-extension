import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backgroundPath = resolve(scriptDir, "..", "chrome", "background.js");
const source = await readFile(backgroundPath, "utf8");
const runtimeStart = source.indexOf("const STORAGE_KEY");
const runtimeEnd = source.indexOf("browser.runtime.onMessage.addListener");
assert.notEqual(runtimeStart, -1, "Could not find the extension runtime start.");
assert.notEqual(runtimeEnd, -1, "Could not find the extension message listener.");
assert.match(source, /cache: "reload"/u, "Catalog refreshes must bypass stale HTTP cache entries.");

const storageState = {};
const browser = {
  storage: {
    local: {
      async get(key) {
        return Object.hasOwn(storageState, key) ? { [key]: storageState[key] } : {};
      },
      async set(values) {
        Object.assign(storageState, values);
      },
    },
  },
};

const loadRuntime = new Function("browser", `
  ${source.slice(runtimeStart, runtimeEnd)}
  return {
    emptyBrandCatalog,
    parseServiceBrandCatalog,
    readStoredServiceBrandCatalog,
    resolveServiceBrand,
    storeServiceBrandCatalog,
  };
`);
const {
  emptyBrandCatalog,
  parseServiceBrandCatalog,
  readStoredServiceBrandCatalog,
  resolveServiceBrand,
  storeServiceBrandCatalog,
} = loadRuntime(browser);

const cofferOrigin = "https://coffer.example";
const compactPayload = {
  format: "coffer-extension-service-brands",
  version: 1,
  core: [
    ["x", "X", "#000000", true, ["x", "twitter"], ["x"], ["x.com"], false],
    ["twitter", "Twitter", "#1d79a8", true, ["twitter", "x"], ["twitter"], ["twitter.com"], true],
    ["bat", "Bat", "#111111", true, ["bat"], [], [], false],
    ["basicattentiontoken", "Basic Attention Token", "#222222", true, ["bat"], [], [], false],
  ],
  selfhst: [["vaultwarden", "Vaultwarden", 7]],
};
const catalog = parseServiceBrandCatalog(compactPayload, cofferOrigin);

const legacyPayload = {
  brands: [
    {
      id: "x",
      title: "X",
      color: "#000000",
      asset: "x.svg",
      automatic: true,
      searchKeys: ["x", "twitter"],
    },
    {
      id: "twitter",
      title: "Twitter",
      color: "#1d79a8",
      asset: "twitter.svg",
      automatic: true,
      searchKeys: ["twitter", "x"],
    },
  ],
};
const legacyCatalog = parseServiceBrandCatalog(legacyPayload, cofferOrigin);
assert.equal(resolveServiceBrand("X", null, legacyCatalog, cofferOrigin), null);

assert.equal(resolveServiceBrand("X", null, catalog, cofferOrigin)?.id, "x");
assert.equal(resolveServiceBrand("Twitter", null, catalog, cofferOrigin)?.id, "twitter");
assert.equal(resolveServiceBrand("X!", null, catalog, cofferOrigin)?.id, "x");
assert.equal(resolveServiceBrand("BAT", null, catalog, cofferOrigin), null);
assert.equal(
  resolveServiceBrand("https://login.twitter.com", null, catalog, cofferOrigin)?.id,
  "twitter",
);
assert.equal(resolveServiceBrand("not twitter", null, catalog, cofferOrigin), null);
assert.equal(
  resolveServiceBrand("Vaultwarden", "selfhst-vaultwarden-light", catalog, cofferOrigin)?.iconUrl,
  "https://coffer.example/brands/vaultwarden-alt-light.svg",
);

const catalogStillLoading = emptyBrandCatalog();
assert.equal(
  resolveServiceBrand("GitHub", "github", catalogStillLoading, cofferOrigin)?.iconUrl,
  "https://coffer.example/brands/github.svg",
);
assert.equal(
  resolveServiceBrand(
    "Vaultwarden",
    "selfhst-vaultwarden-light",
    catalogStillLoading,
    cofferOrigin,
  )?.iconUrl,
  "https://coffer.example/brands/vaultwarden-alt-light.svg",
);
assert.equal(resolveServiceBrand("X", "coffer-initials", catalog, cofferOrigin), null);

storageState.cofferServiceBrandCatalogV1 = {
  cofferOrigin,
  fetchedAt: Date.now(),
  payload: legacyPayload,
};
assert.equal(
  await readStoredServiceBrandCatalog(cofferOrigin),
  null,
  "An unversioned legacy cache must be refreshed after upgrading the extension.",
);

delete storageState.cofferServiceBrandCatalogV1;
await storeServiceBrandCatalog(cofferOrigin, legacyPayload);
assert.equal(
  storageState.cofferServiceBrandCatalogV1,
  undefined,
  "A legacy response must not be persisted as a current cache entry.",
);

storageState.cofferServiceBrandCatalogV1 = {
  cacheVersion: 2,
  cofferOrigin,
  fetchedAt: Date.now(),
  payload: legacyPayload,
};
assert.equal(
  await readStoredServiceBrandCatalog(cofferOrigin),
  null,
  "A legacy payload must be rejected even if its cache version is current.",
);

await storeServiceBrandCatalog(cofferOrigin, compactPayload);
assert.equal(storageState.cofferServiceBrandCatalogV1.cacheVersion, 2);
assert.equal(
  (await readStoredServiceBrandCatalog(cofferOrigin))?.catalog.byId.get("x")?.id,
  "x",
);

console.log("Verified compact catalog parsing, deterministic icon matching, and cache migration.");
