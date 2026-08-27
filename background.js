/* global browser */

import "./vendor/argon2.umd.min.js";

const STORAGE_KEY = "cofferAutofillSettings";
const DEFAULT_SETTINGS = {
  cofferOrigin: "http://localhost:3000",
};

const VAULT_API_TIMEOUT_MS = 10_000;
const SERVICE_BRANDS_TIMEOUT_MS = 5_000;
const DEFAULT_UNLOCK_MS = 20 * 60 * 1_000;
const EXTENDED_UNLOCK_MS = 12 * 60 * 60 * 1_000;
const MAX_PASSWORD_BYTES = 1_024;
const MIN_PASSWORD_CHARACTERS = 12;
const MAX_VAULT_PAYLOAD_BYTES = 16 * 1024 * 1024;
const VAULT_ID_BYTES = 16;
const SALT_BYTES = 16;
const AES_KEY_BYTES = 32;
const AUTH_KEY_BYTES = 32;
const DERIVED_KEY_BYTES = AES_KEY_BYTES + AUTH_KEY_BYTES;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HMAC_BYTES = 32;
const WRAP_AAD_CONTEXT = "coffer:vault-key-wrap:v1";
const PAYLOAD_AAD_CONTEXT = "coffer:vault-payload:v1";
const PASSWORD_VERIFIER_CONTEXT = "coffer:password-verifier:v1";
const API_AUTH_PROOF_CONTEXT = "coffer:api-auth-proof:v1";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const LOCAL_ICON_BRAND = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SVG_BRAND_ASSET = /^[a-z0-9][a-z0-9_.-]{0,128}\.svg$/u;
const MAX_ACCOUNT_ICON_BYTES = 96 * 1024;
const ACCOUNT_ICON_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/u;
const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const SUPPORTED_ALGORITHMS = new Set(["SHA-1", "SHA-256", "SHA-512"]);
const COFFER_INITIALS_BRAND_ID = "coffer-initials";
const GENERIC_HOST_LABELS = new Set([
  "account",
  "accounts",
  "app",
  "auth",
  "id",
  "login",
  "m",
  "mail",
  "secure",
  "signin",
  "sso",
  "www",
  "www2",
]);
const GENERIC_DOMAIN_LABELS = new Set([
  "app",
  "co",
  "com",
  "dev",
  "io",
  "local",
  "me",
  "net",
  "org",
]);

let activeSession = null;
let brandCatalogCache = null;
let brandCatalogOrigin = "";
let brandCatalogPromise = null;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalHost(hostname) {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost");
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

function normalizeMatchValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
}

function foldedMatchValue(value) {
  return normalizeMatchValue(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function usefulHostToken(token) {
  return token === "localhost" ||
    token === "x" ||
    (token.length >= 2 && !GENERIC_HOST_LABELS.has(token) && !GENERIC_DOMAIN_LABELS.has(token));
}

function hostTokens(hostname) {
  const normalizedHost = normalizeMatchValue(hostname).replace(/\.$/u, "");
  if (!normalizedHost) return [];
  if (isLocalHost(normalizedHost)) return ["localhost"];

  const labels = normalizedHost
    .replace(/^www\./u, "")
    .split(".")
    .map((label) => foldedMatchValue(label))
    .filter(usefulHostToken);
  const tokens = [...labels];
  const compactHost = foldedMatchValue(normalizedHost);
  if (compactHost.length >= 3) tokens.push(compactHost);
  return [...new Set(tokens)];
}

function textTokens(value) {
  const normalized = normalizeMatchValue(value);
  if (!normalized) return [];
  const tokens = [foldedMatchValue(normalized)];
  for (const word of normalized.split(/[^a-z0-9]+/u)) {
    const folded = foldedMatchValue(word);
    if (usefulHostToken(folded)) tokens.push(folded);
  }
  return [...new Set(tokens.filter(Boolean))];
}

function domainTokensFromText(value) {
  const text = String(value ?? "");
  const tokens = [];
  const emailPattern = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,}|localhost)\b/gu;
  const domainPattern = /\b(?:https?:\/\/)?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|localhost)(?::\d+)?(?:\/|$)/gu;
  let match;

  while ((match = emailPattern.exec(text)) !== null) {
    tokens.push(...hostTokens(match[1]));
  }
  while ((match = domainPattern.exec(text)) !== null) {
    tokens.push(...hostTokens(match[1]));
  }
  return [...new Set(tokens)];
}

function accountPageTokens(account) {
  return new Set([
    ...textTokens(account.service),
    ...domainTokensFromText(account.service),
    ...domainTokensFromText(account.identity),
  ]);
}

async function currentPageContext(settings) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (settings?.cofferOrigin && url.origin === settings.cofferOrigin) return null;
    const tokens = hostTokens(url.hostname);
    if (tokens.length === 0) return null;
    return {
      host: url.host,
      hostname: url.hostname,
      origin: url.origin,
      tokens,
    };
  } catch {
    return null;
  }
}

function accountMatchesPage(account, page) {
  if (!page) return false;
  const accountTokens = accountPageTokens(account);
  return page.tokens.some((token) => accountTokens.has(token));
}

async function readSettings() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = isRecord(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : {};
  return {
    cofferOrigin: normalizeCofferOrigin(settings.cofferOrigin) ?? DEFAULT_SETTINGS.cofferOrigin,
  };
}

async function saveSettings(input) {
  const cofferOrigin = normalizeCofferOrigin(input?.cofferOrigin);
  if (!cofferOrigin) {
    return {
      ok: false,
      error: {
        code: "invalid_origin",
        message: "Enter a valid Coffer URL.",
      },
    };
  }
  const previous = await readSettings();
  const settings = { cofferOrigin };
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
  if (previous.cofferOrigin !== cofferOrigin) {
    clearSession();
    await browser.permissions.remove({
      origins: [originPermissionPattern(previous.cofferOrigin)],
    }).catch(() => false);
  }
  return { ok: true, settings };
}

async function hasCofferPermission(origin) {
  return browser.permissions.contains({ origins: [originPermissionPattern(origin)] });
}

async function requestCofferPermission(origin) {
  return browser.permissions.request({ origins: [originPermissionPattern(origin)] });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64ToBytes(value, field, maximumBytes) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a base64 string.`);
  }
  const maximumCharacters = Math.ceil(maximumBytes / 3) * 4;
  if (value.length > maximumCharacters || !CANONICAL_BASE64.test(value)) {
    throw new Error(`${field} is not canonical base64.`);
  }

  const binary = atob(value);
  if (binary.length > maximumBytes) {
    throw new Error(`${field} exceeds its size limit.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytesToBase64(bytes) !== value) {
    bytes.fill(0);
    throw new Error(`${field} is not canonical base64.`);
  }
  return bytes;
}

function decodeExactBase64(value, field, expectedBytes) {
  const bytes = base64ToBytes(value, field, expectedBytes);
  if (bytes.length !== expectedBytes) {
    bytes.fill(0);
    throw new Error(`${field} must decode to exactly ${expectedBytes} bytes.`);
  }
  return bytes;
}

function webCryptoBytes(bytes) {
  return bytes.buffer instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
}

function validatePassword(password) {
  if (typeof password !== "string") throw new Error("Password must be a string.");
  const passwordLength = UTF8.encode(password).byteLength;
  const characterCount = Array.from(password).length;
  if (characterCount < MIN_PASSWORD_CHARACTERS || passwordLength > MAX_PASSWORD_BYTES) {
    throw new Error("Password does not match Coffer password requirements.");
  }
}

function validateKdf(kdf) {
  if (
    !isRecord(kdf) ||
    kdf.algorithm !== "argon2id" ||
    kdf.hashLength !== DERIVED_KEY_BYTES ||
    !Number.isInteger(kdf.memoryKiB) ||
    kdf.memoryKiB < 19 * 1024 ||
    kdf.memoryKiB > 256 * 1024 ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < 2 ||
    kdf.iterations > 10 ||
    !Number.isInteger(kdf.parallelism) ||
    kdf.parallelism < 1 ||
    kdf.parallelism > 4
  ) {
    throw new Error("Unsupported vault KDF.");
  }
  decodeExactBase64(kdf.salt, "header.kdf.salt", SALT_BYTES).fill(0);
}

function validateHeader(header) {
  if (!isRecord(header) || header.format !== "coffer-vault" || header.version !== 1) {
    throw new Error("Unsupported vault format.");
  }
  if (typeof header.createdAt !== "string" || !Number.isFinite(Date.parse(header.createdAt))) {
    throw new Error("Vault header timestamp is invalid.");
  }
  decodeExactBase64(header.vaultId, "header.vaultId", VAULT_ID_BYTES).fill(0);
  validateKdf(header.kdf);
  if (
    !isRecord(header.passwordVerifier) ||
    header.passwordVerifier.algorithm !== "HMAC-SHA-256"
  ) {
    throw new Error("Unsupported password verifier.");
  }
  decodeExactBase64(header.passwordVerifier.value, "header.passwordVerifier.value", HMAC_BYTES).fill(0);
  if (
    !isRecord(header.wrappedKey) ||
    header.wrappedKey.algorithm !== "AES-256-GCM" ||
    header.wrappedKey.tagLength !== 128
  ) {
    throw new Error("Unsupported wrapped-key cipher.");
  }
  decodeExactBase64(header.wrappedKey.iv, "header.wrappedKey.iv", GCM_IV_BYTES).fill(0);
  decodeExactBase64(
    header.wrappedKey.ciphertext,
    "header.wrappedKey.ciphertext",
    AES_KEY_BYTES + GCM_TAG_BYTES,
  ).fill(0);
}

function wrapAdditionalData(header) {
  return UTF8.encode(JSON.stringify({
    context: WRAP_AAD_CONTEXT,
    format: header.format,
    version: header.version,
    vaultId: header.vaultId,
    createdAt: header.createdAt,
    kdf: header.kdf,
    passwordVerifier: header.passwordVerifier,
  }));
}

function getArgon2Id() {
  const argon2id = globalThis.hashwasm?.argon2id;
  if (typeof argon2id !== "function") {
    throw new Error("Argon2 is not available in the extension runtime.");
  }
  return argon2id;
}

async function deriveKeyMaterial(password, salt, kdf) {
  validatePassword(password);
  validateKdf(kdf);
  const passwordBytes = UTF8.encode(password);
  try {
    const result = await getArgon2Id()({
      password: passwordBytes,
      salt,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      memorySize: kdf.memoryKiB,
      hashLength: DERIVED_KEY_BYTES,
      outputType: "binary",
    });
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  } finally {
    passwordBytes.fill(0);
  }
}

async function importAesKey(bytes, usages) {
  return crypto.subtle.importKey(
    "raw",
    webCryptoBytes(bytes),
    { name: "AES-GCM", length: AES_KEY_BYTES * 8 },
    false,
    [...usages],
  );
}

async function importAuthKey(bytes) {
  return crypto.subtle.importKey(
    "raw",
    webCryptoBytes(bytes),
    { name: "HMAC", hash: "SHA-256", length: AUTH_KEY_BYTES * 8 },
    false,
    ["sign"],
  );
}

function constantTimeEqual(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function hmacContext(key, context) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    webCryptoBytes(UTF8.encode(context)),
  );
  return new Uint8Array(signature);
}

async function passwordVerifier(authKey) {
  const signature = await hmacContext(authKey, PASSWORD_VERIFIER_CONTEXT);
  try {
    return bytesToBase64(signature);
  } finally {
    signature.fill(0);
  }
}

async function createAuthProof(authKey) {
  const signature = await hmacContext(authKey, API_AUTH_PROOF_CONTEXT);
  try {
    return bytesToBase64Url(signature);
  } finally {
    signature.fill(0);
  }
}

async function unlockVaultHeader(password, header) {
  validateHeader(header);
  const salt = decodeExactBase64(header.kdf.salt, "header.kdf.salt", SALT_BYTES);
  let derived;
  let kekBytes;
  let rawAuthKey;
  let rawVaultKey;

  try {
    derived = await deriveKeyMaterial(password, salt, header.kdf);
    kekBytes = derived.slice(0, AES_KEY_BYTES);
    rawAuthKey = derived.slice(AES_KEY_BYTES);

    const authKey = await importAuthKey(rawAuthKey);
    const actualVerifier = decodeExactBase64(
      await passwordVerifier(authKey),
      "derived password verifier",
      HMAC_BYTES,
    );
    const expectedVerifier = decodeExactBase64(
      header.passwordVerifier.value,
      "header.passwordVerifier.value",
      HMAC_BYTES,
    );
    try {
      if (!constantTimeEqual(actualVerifier, expectedVerifier)) {
        throw new Error("The Coffer email or password is incorrect.");
      }
    } finally {
      actualVerifier.fill(0);
      expectedVerifier.fill(0);
    }

    const kek = await importAesKey(kekBytes, ["decrypt"]);
    const wrapIv = decodeExactBase64(header.wrappedKey.iv, "header.wrappedKey.iv", GCM_IV_BYTES);
    const wrappedKey = decodeExactBase64(
      header.wrappedKey.ciphertext,
      "header.wrappedKey.ciphertext",
      AES_KEY_BYTES + GCM_TAG_BYTES,
    );
    try {
      rawVaultKey = new Uint8Array(await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: webCryptoBytes(wrapIv),
          additionalData: webCryptoBytes(wrapAdditionalData(header)),
          tagLength: 128,
        },
        kek,
        webCryptoBytes(wrappedKey),
      ));
    } finally {
      wrapIv.fill(0);
      wrappedKey.fill(0);
    }
    if (rawVaultKey.byteLength !== AES_KEY_BYTES) {
      throw new Error("Wrapped vault key has an invalid length.");
    }
    const vaultKey = await importAesKey(rawVaultKey, ["encrypt", "decrypt"]);
    return { vaultKey, authKey };
  } finally {
    salt.fill(0);
    derived?.fill(0);
    kekBytes?.fill(0);
    rawAuthKey?.fill(0);
    rawVaultKey?.fill(0);
  }
}

function decodePayloadCipher(payloadCipher) {
  if (
    !isRecord(payloadCipher) ||
    payloadCipher.algorithm !== "AES-256-GCM" ||
    payloadCipher.tagLength !== 128
  ) {
    throw new Error("Unsupported encrypted payload.");
  }
  const iv = decodeExactBase64(payloadCipher.iv, "payloadCipher.iv", GCM_IV_BYTES);
  const ciphertext = base64ToBytes(
    payloadCipher.ciphertext,
    "payloadCipher.ciphertext",
    MAX_VAULT_PAYLOAD_BYTES + GCM_TAG_BYTES,
  );
  if (ciphertext.byteLength < GCM_TAG_BYTES) {
    iv.fill(0);
    ciphertext.fill(0);
    throw new Error("Encrypted payload is shorter than its GCM tag.");
  }
  return { iv, ciphertext };
}

async function decryptVaultPayload(payloadCipher, vaultKey) {
  const { iv, ciphertext } = decodePayloadCipher(payloadCipher);
  let plaintext;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: webCryptoBytes(iv),
        additionalData: webCryptoBytes(UTF8.encode(PAYLOAD_AAD_CONTEXT)),
        tagLength: 128,
      },
      vaultKey,
      webCryptoBytes(ciphertext),
    ));
    if (plaintext.byteLength > MAX_VAULT_PAYLOAD_BYTES) {
      throw new Error("Decrypted vault payload exceeds its size limit.");
    }
    return JSON.parse(UTF8_FATAL.decode(plaintext));
  } finally {
    plaintext?.fill(0);
    ciphertext.fill(0);
    iv.fill(0);
  }
}

function normalizeSecret(secret) {
  return secret.replace(/[a-z]/g, (character) => character.toUpperCase()).replace(/[\s=-]/g, "");
}

function parseBase32Secret(secret) {
  const canonical = normalizeSecret(secret);
  if (!/^[A-Z2-7]{16,1024}$/u.test(canonical)) {
    throw new Error("The vault contains an invalid TOTP secret.");
  }
  const remainder = canonical.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder)) {
    throw new Error("The vault contains an invalid TOTP secret.");
  }
  return canonical;
}

function base32ToBytes(secret) {
  const normalized = parseBase32Secret(secret);
  let bits = "";
  for (const char of normalized) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

async function generateTotp(secret, timestamp = Date.now(), digits = 6, period = 30, algorithm = "SHA-1") {
  const counter = Math.floor(timestamp / 1000 / period);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const secretBytes = base32ToBytes(secret);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      webCryptoBytes(secretBytes),
      { name: "HMAC", hash: { name: algorithm } },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    return String(binary % 10 ** digits).padStart(digits, "0");
  } finally {
    secretBytes.fill(0);
  }
}

function formatCode(code) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function readText(value, fallback = "") {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") : fallback;
}

function readLocalIconBrand(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && LOCAL_ICON_BRAND.test(value) ? value : null;
}

function readAccountIconDataUrl(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ACCOUNT_ICON_DATA_URL.test(value)) return null;
  const maximumEncodedCharacters = Math.ceil(MAX_ACCOUNT_ICON_BYTES / 3) * 4;
  return value.length <= "data:image/png;base64,".length + maximumEncodedCharacters ? value : null;
}

function parseVaultAccount(value) {
  if (!isRecord(value)) throw new Error("Vault account is invalid.");
  const service = readText(value.service);
  const identity = readText(value.identity);
  const group = readText(value.group);
  const secret = typeof value.secret === "string" ? parseBase32Secret(value.secret) : null;
  const algorithm = SUPPORTED_ALGORITHMS.has(value.algorithm) ? value.algorithm : null;
  const digits = value.digits === 6 || value.digits === 8 ? value.digits : null;
  const period = Number.isInteger(value.period) && value.period >= 1 && value.period <= 300
    ? value.period
    : null;
  if (!service || !secret || !algorithm || !digits || !period) {
    throw new Error("Vault account is invalid.");
  }
  return {
    id: typeof value.id === "string" ? value.id : `${service}:${identity}`,
    service,
    identity,
    group,
    secret,
    algorithm,
    digits,
    period,
    archived: value.archived === true,
    favorite: value.favorite === true,
    iconBrand: readLocalIconBrand(value.iconBrand),
    iconDataUrl: readAccountIconDataUrl(value.iconDataUrl),
  };
}

function parseVaultPayload(value) {
  if (!isRecord(value) || value.format !== "coffer-vault" || !Array.isArray(value.accounts)) {
    throw new Error("Vault payload format is not supported.");
  }
  const profile = isRecord(value.profile)
    ? {
        email: readText(value.profile.email),
        name: readText(value.profile.name),
      }
    : { email: "", name: "" };
  const settings = isRecord(value.settings)
    ? { theme: value.settings.theme === "light" ? "light" : "dark" }
    : { theme: "dark" };
  return {
    profile,
    settings,
    accounts: value.accounts.map(parseVaultAccount),
  };
}

async function requestVault(cofferOrigin, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VAULT_API_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/vault", cofferOrigin).toString(), {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        error: {
          code: "invalid_response",
          message: response.status === 403
            ? "Coffer blocked this extension origin. Restart local Coffer with the current Firefox extension UUID."
            : "The Coffer API returned a non-JSON response.",
        },
      };
    }
    if (!response.ok) {
      const error = isRecord(data?.error) ? data.error : null;
      return {
        ok: false,
        error: {
          code: typeof error?.code === "string" ? error.code : "request_failed",
          message: typeof error?.message === "string" ? error.message : "The Coffer API request failed.",
        },
      };
    }
    return { ok: true, body: data };
  } catch {
    return {
      ok: false,
      error: {
        code: controller.signal.aborted ? "request_timeout" : "network_error",
        message: controller.signal.aborted
          ? "The Coffer API did not respond in time."
          : "Coffer could not reach the Coffer API.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function emptyBrandCatalog() {
  return {
    byId: new Map(),
    exactNameMatches: new Map(),
    foldedNameMatches: new Map(),
  };
}

function addBrandMatch(matches, key, id) {
  if (!key) return;
  if (!matches.has(key)) {
    matches.set(key, id);
  } else if (matches.get(key) !== id) {
    matches.set(key, null);
  }
}

function parseServiceBrandCatalog(payload, cofferOrigin) {
  if (!isRecord(payload) || !Array.isArray(payload.brands)) return emptyBrandCatalog();

  const catalog = emptyBrandCatalog();
  for (const item of payload.brands) {
    if (!isRecord(item)) continue;
    const id = readLocalIconBrand(item.id);
    const title = readText(item.title);
    const color = typeof item.color === "string" && /^#[0-9a-f]{6}$/iu.test(item.color)
      ? item.color
      : "#202326";
    const asset = typeof item.asset === "string" && SVG_BRAND_ASSET.test(item.asset)
      ? item.asset
      : null;
    if (!id || !title || !asset || id === COFFER_INITIALS_BRAND_ID) continue;

    const brand = {
      asset,
      color,
      iconUrl: new URL(`/brands/${asset}`, cofferOrigin).toString(),
      id,
      title,
    };
    catalog.byId.set(id, brand);

    if (item.automatic !== true) continue;
    const searchKeys = Array.isArray(item.searchKeys)
      ? item.searchKeys.filter((value) => typeof value === "string")
      : [];
    for (const searchKey of [id, title, ...searchKeys]) {
      const normalized = normalizeMatchValue(searchKey);
      addBrandMatch(catalog.exactNameMatches, normalized, id);
      const folded = foldedMatchValue(normalized);
      if (folded.length >= 2) addBrandMatch(catalog.foldedNameMatches, folded, id);
    }
  }
  return catalog;
}

async function serviceBrandCatalog(cofferOrigin) {
  if (brandCatalogOrigin === cofferOrigin && brandCatalogCache) return brandCatalogCache;
  if (brandCatalogOrigin === cofferOrigin && brandCatalogPromise) return brandCatalogPromise;

  if (brandCatalogOrigin !== cofferOrigin) {
    brandCatalogCache = null;
    brandCatalogPromise = null;
  }
  brandCatalogOrigin = cofferOrigin;
  brandCatalogPromise = fetchServiceBrandCatalog(cofferOrigin)
    .then((catalog) => {
      if (catalog.byId.size > 0) brandCatalogCache = catalog;
      return catalog;
    })
    .finally(() => {
      brandCatalogPromise = null;
    });
  return brandCatalogPromise;
}

async function fetchServiceBrandCatalog(cofferOrigin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVICE_BRANDS_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/service-brands", cofferOrigin).toString(), {
      cache: "force-cache",
      credentials: "omit",
      method: "GET",
      signal: controller.signal,
    });
    return response.ok
      ? parseServiceBrandCatalog(await response.json(), cofferOrigin)
      : emptyBrandCatalog();
  } catch {
    return emptyBrandCatalog();
  } finally {
    clearTimeout(timeout);
  }
}

function resolveServiceBrand(service, iconBrand, catalog) {
  if (iconBrand === COFFER_INITIALS_BRAND_ID) return null;
  if (iconBrand && catalog.byId.has(iconBrand)) return catalog.byId.get(iconBrand);

  const normalized = normalizeMatchValue(service);
  if (!normalized) return null;
  const directMatch = catalog.exactNameMatches.get(normalized);
  if (directMatch) return catalog.byId.get(directMatch) ?? null;

  const folded = foldedMatchValue(normalized);
  const foldedMatch = catalog.foldedNameMatches.get(folded);
  if (foldedMatch) return catalog.byId.get(foldedMatch) ?? null;

  for (const token of [...textTokens(service), ...domainTokensFromText(service)]) {
    const tokenMatch = catalog.foldedNameMatches.get(token) ?? catalog.exactNameMatches.get(token);
    if (tokenMatch) return catalog.byId.get(tokenMatch) ?? null;
  }
  return null;
}

function accountIcon(account, catalog) {
  if (account.iconDataUrl) {
    return {
      iconColor: null,
      iconDataUrl: account.iconDataUrl,
      iconTitle: "Custom logo",
      iconUrl: null,
    };
  }
  const brand = resolveServiceBrand(account.service, account.iconBrand, catalog);
  if (!brand) {
    return {
      iconColor: null,
      iconDataUrl: null,
      iconTitle: null,
      iconUrl: null,
    };
  }
  return {
    iconColor: brand.color,
    iconDataUrl: null,
    iconTitle: brand.title,
    iconUrl: brand.iconUrl,
  };
}

async function identifyVault(cofferOrigin, identifier) {
  const response = await requestVault(cofferOrigin, { action: "identify", identifier });
  if (!response.ok) return response;
  if (!isRecord(response.body) || typeof response.body.configured !== "boolean") {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: "The Coffer API returned invalid account data.",
      },
    };
  }
  if (!response.body.configured) {
    return {
      ok: false,
      error: {
        code: "not_configured",
        message: "No Coffer vault exists for this email.",
      },
    };
  }
  try {
    validateHeader(response.body.header);
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: "The Coffer API returned an unsupported vault header.",
      },
    };
  }
  return {
    ok: true,
    header: response.body.header,
    revision: response.body.revision,
    legacy: response.body.legacy === true,
  };
}

async function loginVault(cofferOrigin, identifier, authProof) {
  const response = await requestVault(cofferOrigin, {
    action: "login",
    identifier,
    authProof,
  });
  if (!response.ok) return response;
  if (!isRecord(response.body) || !isRecord(response.body.payload) || !Number.isSafeInteger(response.body.revision)) {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: "The Coffer API returned invalid vault data.",
      },
    };
  }
  return {
    ok: true,
    revision: response.body.revision,
    payload: response.body.payload,
    legacy: response.body.legacy === true,
  };
}

function clearSession() {
  activeSession = null;
}

function sessionIsAvailable(settings) {
  if (!activeSession) return false;
  if (activeSession.cofferOrigin !== settings.cofferOrigin) {
    clearSession();
    return false;
  }
  if (activeSession.expiresAt <= Date.now()) {
    clearSession();
    return false;
  }
  return true;
}

async function publicVaultState(settings = null) {
  if (!activeSession) {
    return {
      ok: false,
      error: {
        code: "vault_locked",
        message: "Sign in to Coffer from the extension to view codes.",
      },
    };
  }
  const now = Date.now();
  const [catalog, page] = await Promise.all([
    serviceBrandCatalog(activeSession.cofferOrigin),
    currentPageContext(settings ?? { cofferOrigin: activeSession.cofferOrigin }),
  ]);
  const accounts = await Promise.all(activeSession.vault.accounts
    .filter((account) => !account.archived)
    .map(async (account) => {
      const rawCode = await generateTotp(
        account.secret,
        now,
        account.digits,
        account.period,
        account.algorithm,
      );
      const icon = accountIcon(account, catalog);
      return {
        id: account.id,
        code: formatCode(rawCode),
        rawCode,
        favorite: account.favorite,
        group: account.group,
        identity: account.identity,
        period: account.period,
        remaining: account.period - (Math.floor(now / 1000) % account.period),
        service: account.service,
        ...icon,
      };
    }));
  const pageMatches = page ? accounts.filter((account) => accountMatchesPage(account, page)) : [];
  return {
    ok: true,
    accounts,
    expiresAt: activeSession.expiresAt,
    page,
    pageMatches,
    profile: activeSession.vault.profile,
    revision: activeSession.revision,
    theme: activeSession.vault.settings.theme,
    unlockedAt: activeSession.unlockedAt,
  };
}

async function popupState() {
  const settings = await readSettings();
  const hasPermission = await hasCofferPermission(settings.cofferOrigin);
  const cofferUrl = new URL(settings.cofferOrigin);
  const insecureOrigin = cofferUrl.protocol === "http:" && !isLocalHost(cofferUrl.hostname);
  return {
    ok: true,
    settings,
    hasPermission,
    insecureOrigin,
    coffer: hasPermission && sessionIsAvailable(settings)
      ? await publicVaultState(settings)
      : null,
  };
}

async function unlockCoffer(credentials) {
  if (
    !isRecord(credentials) ||
    typeof credentials.identifier !== "string" ||
    typeof credentials.password !== "string" ||
    typeof credentials.rememberLogin !== "boolean" ||
    credentials.identifier.length > 254 ||
    credentials.password.length > 1024 ||
    !credentials.identifier.trim() ||
    !credentials.password
  ) {
    return {
      ok: false,
      error: {
        code: "missing_credentials",
        message: "Enter your Coffer email and password.",
      },
    };
  }

  const settings = await readSettings();
  if (!(await hasCofferPermission(settings.cofferOrigin))) {
    return {
      ok: false,
      error: {
        code: "permission_missing",
        message: "Grant access to your Coffer URL first.",
      },
    };
  }

  clearSession();
  const identifier = credentials.identifier.trim();
  const identified = await identifyVault(settings.cofferOrigin, identifier);
  if (!identified.ok) return identified;

  let runtime;
  try {
    runtime = await unlockVaultHeader(credentials.password, identified.header);
  } catch {
    return {
      ok: false,
      error: {
        code: "unlock_failed",
        message: "The Coffer email or password could not unlock this vault.",
      },
    };
  }

  const authProof = await createAuthProof(runtime.authKey);
  const login = await loginVault(settings.cofferOrigin, identifier, authProof);
  if (!login.ok) return login;

  try {
    const decrypted = await decryptVaultPayload(login.payload, runtime.vaultKey);
    const vault = parseVaultPayload(decrypted);
    const now = Date.now();
    activeSession = {
      cofferOrigin: settings.cofferOrigin,
      expiresAt: now + (credentials.rememberLogin ? EXTENDED_UNLOCK_MS : DEFAULT_UNLOCK_MS),
      identifier,
      revision: login.revision,
      runtime,
      unlockedAt: now,
      vault,
      vaultId: identified.header.vaultId,
    };
    return {
      ok: true,
      vault: await publicVaultState(settings),
    };
  } catch {
    clearSession();
    return {
      ok: false,
      error: {
        code: "decrypt_failed",
        message: "Coffer could not decrypt the vault payload.",
      },
    };
  }
}

async function refreshVault() {
  const settings = await readSettings();
  if (!sessionIsAvailable(settings)) {
    return await publicVaultState(settings);
  }
  const authProof = await createAuthProof(activeSession.runtime.authKey);
  const login = await loginVault(settings.cofferOrigin, activeSession.identifier, authProof);
  if (!login.ok) return login;
  try {
    const decrypted = await decryptVaultPayload(login.payload, activeSession.runtime.vaultKey);
    activeSession.vault = parseVaultPayload(decrypted);
    activeSession.revision = login.revision;
    return {
      ok: true,
      vault: await publicVaultState(settings),
    };
  } catch {
    clearSession();
    return {
      ok: false,
      error: {
        code: "decrypt_failed",
        message: "Coffer could not refresh the vault payload.",
      },
    };
  }
}

function pageFillTotpCode(code) {
  const normalizedCode = String(code ?? "").replace(/\D/g, "");
  if (!/^\d{6,8}$/u.test(normalizedCode)) {
    return { filled: false, reason: "invalid_code" };
  }

  const inputTypes = new Set(["", "number", "password", "search", "tel", "text"]);
  const ignoredTypes = new Set(["button", "checkbox", "color", "date", "datetime-local", "email", "file", "hidden", "image", "month", "radio", "range", "reset", "submit", "time", "url", "week"]);
  const positivePattern = /(one.?time|otp|totp|mfa|2fa|verification|verify|authenticator|security.?code|pass.?code|code)/iu;
  const negativePattern = /(email|e-mail|username|user.?name|password|passwort|search|phone|postal|zip)/iu;

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function descriptor(input) {
    function cssEscape(value) {
      if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
      return String(value).replace(/["\\]/gu, "\\$&");
    }

    const labels = input.id
      ? Array.from(document.querySelectorAll(`label[for="${cssEscape(input.id)}"]`)).map((label) => label.textContent ?? "")
      : [];
    const parentText = input.closest("label, fieldset, form, [role='group'], section, div")?.textContent ?? "";
    return [
      input.autocomplete,
      input.ariaLabel,
      input.getAttribute("aria-labelledby"),
      input.id,
      input.name,
      input.placeholder,
      ...labels,
      parentText.slice(0, 240),
    ].filter(Boolean).join(" ");
  }

  function setNativeValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, value);
    if (!setter) input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const fields = Array.from(document.querySelectorAll("input, textarea"))
    .filter((input) => !input.disabled && !input.readOnly && isVisible(input))
    .filter((input) => {
      if (input instanceof HTMLTextAreaElement) return true;
      const type = input.type.toLowerCase();
      return inputTypes.has(type) && !ignoredTypes.has(type);
    });

  const scored = fields
    .map((input) => {
      const text = descriptor(input);
      let score = 0;
      if (/\bone-time-code\b/iu.test(input.autocomplete)) score += 100;
      if (positivePattern.test(text)) score += 45;
      if (input.inputMode === "numeric" || input.inputMode === "decimal") score += 15;
      if (input instanceof HTMLInputElement && (input.maxLength === normalizedCode.length || input.maxLength === -1)) score += 8;
      if (input instanceof HTMLInputElement && input.pattern && /\d|0-9/iu.test(input.pattern)) score += 6;
      if (negativePattern.test(text) && !positivePattern.test(text)) score -= 80;
      return { input, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  const target = scored[0]?.input;
  if (!target) return { filled: false, reason: "no_field" };

  target.focus({ preventScroll: true });
  setNativeValue(target, normalizedCode);
  target.select?.();
  return { filled: true };
}

async function fillCode(accountId) {
  if (typeof accountId !== "string") {
    return {
      ok: false,
      error: {
        code: "invalid_account",
        message: "Choose a Coffer code to fill.",
      },
    };
  }

  const settings = await readSettings();
  if (!sessionIsAvailable(settings)) {
    return {
      ok: false,
      error: {
        code: "vault_locked",
        message: "Sign in before filling a code.",
      },
    };
  }

  const account = activeSession.vault.accounts.find((candidate) => (
    candidate.id === accountId && !candidate.archived
  ));
  if (!account) {
    return {
      ok: false,
      error: {
        code: "account_not_found",
        message: "This Coffer code is no longer available.",
      },
    };
  }

  let tab;
  try {
    [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  if (!tab?.id || !tab.url) {
    return {
      ok: false,
      error: {
        code: "active_tab_missing",
        message: "Open the page you want to fill first.",
      },
    };
  }

  let tabUrl;
  try {
    tabUrl = new URL(tab.url);
  } catch {
    tabUrl = null;
  }
  if (!tabUrl || (tabUrl.protocol !== "http:" && tabUrl.protocol !== "https:")) {
    return {
      ok: false,
      error: {
        code: "unsupported_tab",
        message: "Coffer can fill only regular web pages.",
      },
    };
  }
  if (tabUrl.origin === settings.cofferOrigin) {
    return {
      ok: false,
      error: {
        code: "coffer_tab",
        message: "Open the target page before filling a code.",
      },
    };
  }

  const rawCode = await generateTotp(
    account.secret,
    Date.now(),
    account.digits,
    account.period,
    account.algorithm,
  );
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFillTotpCode,
      args: [rawCode],
    });
    const filled = results.some((result) => result.result?.filled === true);
    if (!filled) {
      return {
        ok: false,
        error: {
          code: "field_not_found",
          message: "Coffer could not find a one-time-code field on this page.",
        },
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: {
        code: "fill_failed",
        message: "Firefox did not allow filling this page.",
      },
    };
  }
}

async function openCoffer() {
  const settings = await readSettings();
  await browser.tabs.create({ url: settings.cofferOrigin });
  return { ok: true };
}

browser.runtime.onMessage.addListener((message) => {
  if (!isRecord(message) || typeof message.type !== "string") return false;
  if (message.type === "popup-state") return popupState();
  if (message.type === "save-settings") return saveSettings(message.settings);
  if (message.type === "grant-permission") {
    const origin = normalizeCofferOrigin(message.origin);
    if (!origin) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "invalid_origin",
          message: "Enter a valid Coffer URL.",
        },
      });
    }
    return requestCofferPermission(origin).then((granted) => ({ ok: granted }));
  }
  if (message.type === "unlock-coffer") return unlockCoffer(message.credentials);
  if (message.type === "refresh-vault") return refreshVault();
  if (message.type === "fill-code") return fillCode(message.accountId);
  if (message.type === "lock-coffer") {
    clearSession();
    return Promise.resolve({ ok: true });
  }
  if (message.type === "open-coffer") return openCoffer();
  return false;
});
