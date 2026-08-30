import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const distDir = resolve(rootDir, "dist");

if (dirname(distDir) !== rootDir || basename(distDir) !== "dist") {
  throw new Error(`Refusing to clean unexpected path: ${distDir}`);
}

await rm(distDir, { force: true, recursive: true });
await mkdir(distDir, { recursive: true });
console.log(`Cleaned extension artifacts: ${distDir}`);
