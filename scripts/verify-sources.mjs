import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const browsers = ["chrome", "firefox"];
const expectedFiles = [
  "background.js",
  "browser-compat.js",
  "icons/coffer-favicon-16.png",
  "icons/coffer-favicon-32.png",
  "icons/coffer-mark-128.png",
  "icons/coffer-mark-192.png",
  "icons/coffer-mark-48.png",
  "icons/coffer-mark-512.png",
  "manifest.json",
  "popup/popup.css",
  "popup/popup.html",
  "popup/popup.js",
  "vendor/argon2.umd.min.js",
];

async function inventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await inventory(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizedRelative(root, file) {
  return relative(root, file).split(sep).join("/");
}

function withoutBrowserFields(manifest) {
  const common = structuredClone(manifest);
  delete common.background;
  delete common.browser_specific_settings;
  return common;
}

const packageMetadata = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const manifests = new Map();

for (const browser of browsers) {
  const sourceDir = join(rootDir, browser);
  const files = (await inventory(sourceDir))
    .map((file) => normalizedRelative(sourceDir, file))
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${browser} runtime inventory differs from the expected self-contained package.\n${files.join("\n")}`);
  }

  const manifest = JSON.parse(await readFile(join(sourceDir, "manifest.json"), "utf8"));
  if (manifest.version !== packageMetadata.version) {
    throw new Error(`${browser} manifest version ${manifest.version} does not match package version ${packageMetadata.version}.`);
  }
  manifests.set(browser, manifest);
}

const chromeManifest = manifests.get("chrome");
const firefoxManifest = manifests.get("firefox");
if (
  chromeManifest.background?.service_worker !== "background.js" ||
  chromeManifest.background?.type !== "module" ||
  "scripts" in chromeManifest.background ||
  "browser_specific_settings" in chromeManifest
) {
  throw new Error("Chrome manifest must use only a module service worker and must not contain Firefox settings.");
}
if (
  JSON.stringify(firefoxManifest.background?.scripts) !== JSON.stringify(["background.js"]) ||
  firefoxManifest.background?.type !== "module" ||
  "service_worker" in firefoxManifest.background ||
  firefoxManifest.browser_specific_settings?.gecko?.id !== "coffer-autofill@coffer.local"
) {
  throw new Error("Firefox manifest must use a module background script and preserve the Gecko extension ID.");
}
if (JSON.stringify(withoutBrowserFields(chromeManifest)) !== JSON.stringify(withoutBrowserFields(firefoxManifest))) {
  throw new Error("Chrome and Firefox manifests differ outside their browser-specific fields.");
}

for (const file of expectedFiles.filter((entry) => entry !== "manifest.json")) {
  const [chromeBytes, firefoxBytes] = await Promise.all([
    readFile(join(rootDir, "chrome", file)),
    readFile(join(rootDir, "firefox", file)),
  ]);
  if (!chromeBytes.equals(firefoxBytes)) {
    throw new Error(`Shared runtime file differs between Chrome and Firefox: ${file}`);
  }
}

console.log("Verified independent Chrome and Firefox extension sources.");
