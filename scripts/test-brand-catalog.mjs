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

const loadRuntime = new Function("browser", `
  ${source.slice(runtimeStart, runtimeEnd)}
  return { emptyBrandCatalog, parseServiceBrandCatalog, resolveServiceBrand };
`);
const {
  emptyBrandCatalog,
  parseServiceBrandCatalog,
  resolveServiceBrand,
} = loadRuntime({});

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

console.log("Verified compact catalog parsing and deterministic icon matching.");
