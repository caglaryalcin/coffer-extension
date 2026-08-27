import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const distDir = join(rootDir, "dist");
const sourceDir = join(distDir, "chrome-source");

const manifest = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));
manifest.background = {
  service_worker: "background.js",
  type: "module",
};
delete manifest.browser_specific_settings;

const zipPath = join(distDir, `coffer-${manifest.version}-chrome.zip`);
const entries = [
  "background.js",
  "browser-compat.js",
  "icons",
  "popup",
  "vendor",
];

await mkdir(distDir, { recursive: true });
await rm(sourceDir, { force: true, recursive: true });
await mkdir(sourceDir, { recursive: true });

for (const entry of entries) {
  await cp(join(rootDir, entry), join(sourceDir, entry), { recursive: true });
}

await writeFile(
  join(sourceDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

await rm(zipPath, { force: true });
const result = spawnSync("zip", ["-qr", zipPath, "."], {
  cwd: sourceDir,
  env: { ...process.env, COPYFILE_DISABLE: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`zip exited with status ${result.status}`);
}

console.log(`Chrome source ready: ${sourceDir}`);
console.log(`Chrome extension package ready: ${zipPath}`);
