import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cofferOrigin = "https://coffer.example";
const baseAccount = {
  id: "work-login",
  service: "Work account",
  identity: "owner@unrelated.example",
  secret: "JBSWY3DPEHPK3PXP",
  group: "Work",
  color: "ink",
  letter: "W",
  favorite: false,
  lastUsed: 0,
  algorithm: "SHA-1",
  digits: 6,
  period: 30,
  archived: false,
  iconBrand: null,
  iconDataUrl: null,
};

// These fixtures follow Coffer's v9, v10, and v11 persisted payload shapes.
function vaultFixture(version, account) {
  return {
    format: "coffer-vault",
    version,
    profile: { name: "Owner", email: "owner@unrelated.example", avatarDataUrl: null },
    settings: {
      autoLockMinutes: 20,
      lockWhenHidden: false,
      clearClipboard: true,
      theme: "dark",
      mainScreen: { kind: "all" },
    },
    accounts: [account],
    groupCustomizations: [{ name: "Work", icon: "briefcase", color: "blue" }],
    groupOrder: ["Work"],
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

function loadRuntime(source) {
  const start = source.indexOf("const STORAGE_KEY");
  const end = source.indexOf("browser.alarms?.onAlarm?.addListener");
  assert.notEqual(start, -1, "Could not find the extension runtime start.");
  assert.notEqual(end, -1, "Could not find the extension alarm listener.");
  return new Function("browser", `
    ${source.slice(start, end)}
    return {
      parseVaultAccount,
      parseVaultPayload,
      accountMatchesPage,
      pageContextFromUrl,
      parseServiceBrandCatalog,
      inlineSuggestions,
      refreshVault,
      publicVaultState,
      mockRefreshDependencies({ settings, session, login, page }) {
        activeSession = session;
        readSettings = async () => settings;
        loginVault = async () => login;
        serviceBrandCatalog = async () => emptyBrandCatalog();
        currentPageContext = async () => page;
      },
      mockInlineDependencies({ settings, accounts, observedPages }) {
        activeSession = { expiresAt: Date.now() + 60_000, revision: 1 };
        readSettings = async () => settings;
        sessionIsAvailable = async () => true;
        serviceBrandCatalog = async () => emptyBrandCatalog();
        publicVaultState = async (_settings, page) => {
          observedPages.push(page);
          return {
            ok: true,
            expiresAt: 123456789,
            pageMatches: accounts
              .filter((account) => accountMatchesPage(account, page))
              .map((account) => ({
                ...account,
                code: "123 456",
                rawCode: "123456",
                remaining: 20,
              })),
          };
        };
      },
    };
  `)({});
}

for (const browserName of ["chrome", "firefox"]) {
  const source = await readFile(resolve(rootDir, browserName, "background.js"), "utf8");
  const runtime = loadRuntime(source);
  const { parseVaultAccount, parseVaultPayload, accountMatchesPage, pageContextFromUrl } = runtime;
  const parse = (fields) => parseVaultAccount({ ...baseAccount, ...fields });
  const matches = (account, url, catalog = null) => accountMatchesPage(
    account,
    pageContextFromUrl(url, { cofferOrigin }),
    catalog,
    cofferOrigin,
  );

  assert.deepEqual(parse({}).urls, [], `${browserName}: old accounts must have no URL restriction.`);
  assert.deepEqual(parse({ url: null }).urls, []);
  assert.deepEqual(parse({ url: "example.com/login" }).urls, ["https://example.com/login"]);
  assert.deepEqual(parse({ urls: [] }).urls, []);
  assert.deepEqual(parse({ urls: [], url: "https://ignored.example" }).urls, []);
  assert.deepEqual(
    parse({ urls: [" HTTPS://EXAMPLE.COM:443/login ", "https://example.com/login", "second.example"] }).urls,
    ["https://example.com/login", "https://second.example/"],
    `${browserName}: normalize website URLs and remove duplicates.`,
  );
  assert.deepEqual(
    parse({ urls: ["https://current.example"], url: "https://legacy.example" }).urls,
    ["https://current.example/"],
  );

  for (const urls of [
    null,
    "https://example.com",
    {},
    [null],
    [123],
    [""],
    ["   "],
    ["ftp://example.com"],
    ["javascript:alert(1)"],
    ["data:text/plain,test"],
    ["https://owner:password@example.com"],
    ["https://owner@example.com"],
    ["https://exa\nmple.com"],
    ["https://example.com/a\u0000b"],
    ["https://example.com/a\u007fb"],
    ["https://example.com/" + "a".repeat(2048)],
    ["https://example.com/" + "é".repeat(1000)],
    Array.from({ length: 33 }, (_, index) => `https://website-${index}.example`),
    ["https://valid.example", "ftp://invalid.example"],
  ]) {
    assert.throws(
      () => parse({ urls, url: "https://legacy.example" }),
      `${browserName}: malformed explicit URLs must not become legacy heuristic matches: ${JSON.stringify(urls).slice(0, 100)}`,
    );
  }
  assert.equal(parse({ urls: Array.from({ length: 32 }, (_, i) => `https://site-${i}.example`) }).urls.length, 32);
  assert.throws(() => parse({ url: "ftp://example.com" }));
  assert.throws(() => parse({ url: 123 }));

  const urlAccount = parse({ urls: ["https://example.com/sign-in?client=coffer#login"] });
  for (const [url, expected] of [
    ["https://example.com/", true],
    ["https://login.example.com/two-factor", true],
    ["https://deep.login.example.com/", true],
    ["https://EXAMPLE.COM:443/different?query=1#other", true],
    ["https://notexample.com/", false],
    ["https://example.com.attacker.test/", false],
    ["https://example.other/", false],
    ["http://example.com/", false],
    ["https://example.com:8443/", false],
    ["http://example.com:443/", false],
    ["https://unrelated.example/", false],
    ["https://coffer.example/", false],
    ["file:///example.com", false],
    ["about:blank", false],
  ]) {
    assert.equal(matches(urlAccount, url), expected, `${browserName}: explicit match for ${url}`);
  }

  const exactLogin = parse({ urls: ["https://login.example.com"] });
  assert.equal(matches(exactLogin, "https://example.com/"), false);
  assert.equal(matches(exactLogin, "https://mail.example.com/"), false);
  assert.equal(matches(exactLogin, "https://m.login.example.com/"), true);
  const customPort = parse({ urls: ["https://example.com:8443"] });
  assert.equal(matches(customPort, "https://login.example.com:8443/"), true);
  assert.equal(matches(customPort, "https://example.com/"), false);
  assert.equal(matches(parse({ urls: ["http://example.com:80"] }), "http://example.com/"), true);
  for (const hostname of ["co", "io"]) {
    const account = parse({ urls: [`https://${hostname}/`] });
    assert.equal(matches(account, `https://${hostname}/login`), true);
    assert.equal(matches(account, `https://login.${hostname}/`), false);
  }
  assert.equal(matches(urlAccount, "https://example.com./login"), true);
  assert.equal(matches(parse({ urls: ["https://example.com./"] }), "https://login.example.com/"), true);

  const idn = parse({ urls: ["https://BÜCHER.example"] });
  assert.deepEqual(idn.urls, ["https://xn--bcher-kva.example/"]);
  assert.equal(matches(idn, "https://xn--bcher-kva.example/"), true);
  assert.equal(matches(idn, "https://login.bücher.example/"), true);
  for (const [configured, exact, deceptive] of [
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080/", "http://other.127.0.0.1:8080/"],
    ["http://[::1]:8080", "http://[::1]:8080/", "http://[::2]:8080/"],
    ["http://localhost:8080", "http://localhost:8080/", "http://other.localhost:8080/"],
  ]) {
    const account = parse({ urls: [configured] });
    assert.equal(matches(account, exact), true, `${browserName}: local exact host ${exact}`);
    assert.equal(matches(account, deceptive), false, `${browserName}: local host must not expand to ${deceptive}`);
  }

  const catalog = runtime.parseServiceBrandCatalog({
    format: "coffer-extension-service-brands",
    version: 1,
    core: [
      ["github", "GitHub", "#181717", true, ["github"], ["github"], ["github.com"], true],
      ["microsoft", "Microsoft", "#5e5e5e", true, ["microsoft"], ["microsoft"], ["live.com"], true],
    ],
    selfhst: [],
  }, cofferOrigin);
  const namedAccount = parse({
    service: "GitHub",
    identity: "owner@github.com",
    iconBrand: "github",
    urls: ["https://company.example"],
  });
  assert.equal(matches(namedAccount, "https://company.example/", catalog), true);
  assert.equal(matches(namedAccount, "https://github.com/", catalog), false);
  assert.equal(matches(namedAccount, "https://github.unrelated.test/", catalog), false);
  const microsoftAccount = parse({ service: "Microsoft", iconBrand: "microsoft", urls: ["https://login.live.com"] });
  assert.equal(matches(microsoftAccount, "https://login.live.com/", catalog), true);
  assert.equal(matches(microsoftAccount, "https://outlook.com/", catalog), false);
  assert.equal(matches(microsoftAccount, "https://live.com/", catalog), false);
  assert.equal(matches(parse({ service: "GitHub", urls: [] }), "https://github.com/", catalog), true);
  assert.equal(matches(parse({ service: "Microsoft" }), "https://login.live.com/", catalog), true);

  for (const [version, fields, expectedUrls, matchingUrl] of [
    [9, { service: "GitHub" }, [], "https://github.com/"],
    [10, { url: "https://legacy.example/login" }, ["https://legacy.example/login"], "https://legacy.example/otp"],
    [10, { url: null, service: "GitHub" }, [], "https://github.com/"],
    [11, { urls: ["https://first.example", "https://second.example/otp"] }, ["https://first.example/", "https://second.example/otp"], "https://second.example/login"],
  ]) {
    const vault = parseVaultPayload(vaultFixture(version, { ...baseAccount, ...fields }));
    assert.deepEqual(vault.accounts[0].urls, expectedUrls, `${browserName}: Coffer v${version} URL migration`);
    assert.equal(matches(vault.accounts[0], matchingUrl, catalog), true, `${browserName}: parsed v${version} account matches website`);
    assert.equal(vault.accounts[0].secret, baseAccount.secret);
  }
  const multiSiteVault = parseVaultPayload(vaultFixture(11, {
    ...baseAccount,
    urls: ["https://first.example", "https://second.example"],
  }));
  assert.equal(matches(multiSiteVault.accounts[0], "https://first.example/"), true);
  assert.equal(matches(multiSiteVault.accounts[0], "https://third.example/"), false);
  assert.throws(() => parseVaultPayload(vaultFixture(11, { ...baseAccount, urls: ["ftp://example.com"] })));

  // Exercise the real refresh -> AES decrypt -> parse -> public match pipeline.
  // Only the authenticated network response and browser tab lookup are replaced.
  const refreshRuntime = loadRuntime(source);
  const vaultKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const authKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const updatedPayload = vaultFixture(11, { ...baseAccount, urls: ["https://updated.example/login"] });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode("coffer:vault-payload:v1"),
    tagLength: 128,
  }, vaultKey, new TextEncoder().encode(JSON.stringify(updatedPayload)));
  refreshRuntime.mockRefreshDependencies({
    settings: { cofferOrigin },
    session: {
      cofferOrigin,
      identifier: "owner@unrelated.example",
      remembered: false,
      expiresAt: Date.now() + 60_000,
      unlockedAt: Date.now(),
      revision: 1,
      runtime: { vaultKey, authKey },
      vault: parseVaultPayload(vaultFixture(11, { ...baseAccount, urls: ["https://previous.example"] })),
    },
    login: {
      ok: true,
      revision: 2,
      payload: {
        algorithm: "AES-256-GCM",
        tagLength: 128,
        iv: Buffer.from(iv).toString("base64"),
        ciphertext: Buffer.from(encrypted).toString("base64"),
      },
    },
    page: pageContextFromUrl("https://updated.example/otp", { cofferOrigin }),
  });
  assert.equal((await refreshRuntime.publicVaultState({ cofferOrigin })).pageMatches.length, 0);
  const refreshed = await refreshRuntime.refreshVault();
  assert.equal(refreshed.ok, true, `${browserName}: refreshing a v11 encrypted vault succeeds.`);
  assert.equal(refreshed.vault.revision, 2);
  assert.equal(refreshed.vault.pageMatches.length, 1, `${browserName}: freshly saved URLs reach page suggestions after refresh.`);
  assert.equal(refreshed.vault.pageMatches[0].id, baseAccount.id);

  const observedPages = [];
  runtime.mockInlineDependencies({
    settings: { cofferOrigin },
    accounts: [parse({ urls: ["https://login.example.com"] })],
    observedPages,
  });
  const tab = { id: 42, url: "https://login.example.com/" };
  for (const [sender, expectedCount] of [
    [{ tab, frameId: 0, url: "https://login.example.com/otp" }, 1],
    [{ tab: { ...tab, url: "https://unrelated.example" }, frameId: 3, url: "https://login.example.com/otp" }, 1],
    [{ tab, frameId: 3, url: "https://unrelated.example/" }, 0],
    [{ tab, frameId: 3, url: "about:blank" }, 0],
    [{ tab, frameId: 3, url: "data:text/html,login" }, 0],
    [{ tab, frameId: 3, url: "" }, 0],
    [{ tab, frameId: 3 }, 0],
    [{ tab, frameId: 0, url: "" }, 0],
    [{ tab, frameId: 0, url: "about:blank" }, 0],
    [{ tab, frameId: 0 }, 1],
    [{ tab }, 0],
    [{ tab, url: "https://login.example.com/otp" }, 1],
    [{ tab, frameId: 3, url: "https://login.example.com/otp", origin: "null" }, 0],
    [{ tab, frameId: 3, url: "https://login.example.com/otp", origin: "https://unrelated.example" }, 0],
    [{ tab, frameId: 3, url: "https://login.example.com/otp", origin: "https://login.example.com" }, 1],
    [{ tab, frameId: 3, url: cofferOrigin }, 0],
  ]) {
    const response = await runtime.inlineSuggestions(sender);
    assert.equal(response.ok, true);
    assert.equal(response.accounts.length, expectedCount, `${browserName}: inline sender ${JSON.stringify(sender)}`);
  }
  assert.equal(observedPages.some((page) => page.hostname === "unrelated.example"), true);
  console.log(`Verified ${browserName} Coffer URL migration, explicit website restrictions, and inline frame matching.`);
}
