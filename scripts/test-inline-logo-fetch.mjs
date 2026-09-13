import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cofferOrigin = "https://coffer.example";
const logoUrl = `${cofferOrigin}/brands/microsoft.svg`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f25022" d="M0 0h10v10H0z"/></svg>';
const sender = { tab: { id: 7, url: "https://login.example/code" }, frameId: 0 };

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function createRuntime(source, parseSvgLogo, options = {}) {
  const start = source.indexOf("const STORAGE_KEY");
  const end = source.indexOf("browser.alarms?.onAlarm?.addListener");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const fetches = [];
  const timers = new Map();
  const runtime = new Function("browser", "parseSvgLogo", "fetch", "setTimeout", "clearTimeout", `
    ${source.slice(start, end)}
    let testAccounts = [];
    let testVaultReads = 0;
    const testSettings = { cofferOrigin: ${JSON.stringify(cofferOrigin)} };
    activeSession = { expiresAt: Date.now() + 60_000, revision: 1 };
    readSettings = async () => testSettings;
    sessionIsAvailable = async () => activeSession !== null;
    serviceBrandCatalog = async () => emptyBrandCatalog();
    publicVaultState = async () => {
      testVaultReads += 1;
      return {
        ok: true,
        expiresAt: activeSession?.expiresAt ?? null,
        pageMatches: testAccounts.map((account) => ({
          ...account,
          code: testVaultReads === 1 ? "123 456" : "654 321",
          rawCode: testVaultReads === 1 ? "123456" : "654321",
          remaining: testVaultReads === 1 ? 1 : 30,
        })),
      };
    };
    return {
      inlineLogo,
      inlineSuggestions,
      setAccounts(accounts) { testAccounts = accounts; },
      getVaultReads() { return testVaultReads; },
      invalidateSession(reason) {
        if (reason === "lock") activeSession = null;
        if (reason === "replace") activeSession = { ...activeSession };
        if (reason === "expire") activeSession.expiresAt = Date.now() - 1;
        if (reason === "revision") activeSession.revision += 1;
      },
    };
  `)(
    {},
    parseSvgLogo,
    async (url, request) => {
      fetches.push({ url, request });
      return options.fetch ? options.fetch(url, request) : new Response(svg);
    },
    (callback, delay) => {
      const token = {};
      timers.set(token, { callback, delay });
      return token;
    },
    (token) => timers.delete(token),
  );
  return { ...runtime, fetches, timers };
}

function account(iconUrl = logoUrl, identity = "owner@example.com") {
  return {
    service: "Microsoft",
    identity,
    group: "Work",
    iconUrl,
    iconDataUrl: null,
    iconColor: "#f25022",
    iconTitle: "Microsoft",
    period: 30,
  };
}

for (const browserName of ["chrome", "firefox"]) {
  const source = await readFile(resolve(rootDir, browserName, "background.js"), "utf8");
  const { parseSvgLogo } = await import(pathToFileURL(resolve(rootDir, browserName, "svg-logo.js")));
  const expectedLogo = parseSvgLogo(svg);
  assert.ok(expectedLogo, `${browserName}: the valid SVG fixture must parse.`);

  {
    const runtime = createRuntime(source, parseSvgLogo);
    const first = runtime.inlineLogo(logoUrl, cofferOrigin);
    const second = runtime.inlineLogo(logoUrl, cofferOrigin);
    assert.equal(first, second, `${browserName}: concurrent logo requests must share their promise.`);
    assert.deepEqual(await first, expectedLogo);
    assert.deepEqual(await runtime.inlineLogo(logoUrl, cofferOrigin), expectedLogo);
    assert.equal(runtime.fetches.length, 1, `${browserName}: completed logos must be reused.`);
    assert.equal(runtime.fetches[0].url, logoUrl);
    assert.equal(runtime.fetches[0].request.credentials, "omit");
    assert.equal(runtime.fetches[0].request.redirect, "error");
    assert.equal(runtime.fetches[0].request.referrerPolicy, "no-referrer");
    assert.ok(runtime.fetches[0].request.signal instanceof AbortSignal);
    assert.equal(runtime.timers.size, 0, `${browserName}: completed fetches must clear their timeout.`);
  }

  {
    const runtime = createRuntime(source, parseSvgLogo);
    for (const url of [
      null,
      "not-a-url",
      "https://attacker.example/brands/microsoft.svg",
      "http://coffer.example/brands/microsoft.svg",
      "https://coffer.example:8443/brands/microsoft.svg",
      "https://coffer.example.attacker.test/brands/microsoft.svg",
      `${cofferOrigin}/other/microsoft.svg`,
      `${cofferOrigin}/brands/private/microsoft.svg`,
      `${cofferOrigin}/brands/../private.svg`,
      `${cofferOrigin}/brands/%2e%2e/private.svg`,
      `${cofferOrigin}/brands/%2fprivate.svg`,
      `${cofferOrigin}/brands/microsoft.png`,
      `${logoUrl}?tracking=1`,
      `${logoUrl}#private`,
      "https://owner@coffer.example/brands/microsoft.svg",
      "https://owner:password@coffer.example/brands/microsoft.svg",
      "data:image/svg+xml,<svg/>",
      "file:///brands/microsoft.svg",
    ]) {
      assert.equal(await runtime.inlineLogo(url, cofferOrigin), null, `${browserName}: reject ${url}`);
    }
    assert.equal(runtime.fetches.length, 0, `${browserName}: rejected logo addresses must never be fetched.`);
  }

  for (const [name, fetchResponse] of [
    ["network error", () => { throw new Error("Unavailable"); }],
    ["HTTP failure", () => new Response(svg, { status: 404 })],
    ["empty response", () => new Response(null)],
    ["malformed SVG", () => new Response("<svg><path")],
    ["unexpected HTML", () => new Response("<html><body>Login</body></html>")],
    ["invalid UTF-8", () => new Response(new Uint8Array([0xc3, 0x28]))],
    ["oversized content length", () => new Response(svg, { headers: { "content-length": String(512 * 1024 + 1) } })],
    ["redirected response", () => ({ ok: true, redirected: true, body: new ReadableStream(), headers: new Headers() })],
  ]) {
    const runtime = createRuntime(source, parseSvgLogo, { fetch: fetchResponse });
    assert.equal(await runtime.inlineLogo(logoUrl, cofferOrigin), null, `${browserName}: ${name} falls back safely.`);
    assert.equal(await runtime.inlineLogo(logoUrl, cofferOrigin), null);
    assert.equal(runtime.fetches.length, 1, `${browserName}: failed logos must not be retried for each account.`);
    assert.equal(runtime.timers.size, 0);
    assert.equal(runtime.fetches[0].request.signal.aborted, true, `${browserName}: rejected responses must abort any remaining download.`);
  }

  {
    let cancelled = false;
    const runtime = createRuntime(source, parseSvgLogo, {
      fetch: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024));
          controller.enqueue(new Uint8Array(256 * 1024 + 1));
        },
        cancel() { cancelled = true; },
      })),
    });
    assert.equal(await runtime.inlineLogo(logoUrl, cofferOrigin), null);
    assert.equal(cancelled, true, `${browserName}: oversized streamed responses must be cancelled.`);
    assert.equal(runtime.timers.size, 0);
  }

  {
    const runtime = createRuntime(source, parseSvgLogo, {
      fetch: (_url, request) => new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      }),
    });
    const pending = runtime.inlineLogo(logoUrl, cofferOrigin);
    assert.equal(runtime.timers.size, 1);
    const timeout = [...runtime.timers.values()][0];
    assert.equal(timeout.delay, 3_000);
    timeout.callback();
    assert.equal(await pending, null, `${browserName}: timed-out logos must return a fallback.`);
    assert.equal(runtime.fetches[0].request.signal.aborted, true);
    assert.equal(runtime.timers.size, 0);
  }

  {
    const runtime = createRuntime(source, parseSvgLogo);
    runtime.setAccounts([account(), account(logoUrl, "second@example.com"), account(null, "third@example.com")]);
    const result = await runtime.inlineSuggestions(sender);
    assert.equal(result.accounts.length, 3);
    assert.equal(runtime.fetches.length, 1, `${browserName}: suggestions sharing a logo must fetch once.`);
    assert.equal(runtime.getVaultReads(), 2, `${browserName}: regenerate TOTP codes after loading logos.`);
    for (const item of result.accounts) {
      assert.equal(item.rawCode, "654321");
      assert.equal(item.code, "654 321");
      assert.equal(item.remaining, 30);
      assert.equal(Object.hasOwn(item, "iconUrl"), false, `${browserName}: do not expose remote logo URLs to the page.`);
    }
    assert.deepEqual(result.accounts[0].iconSvg, expectedLogo);
    assert.deepEqual(result.accounts[1].iconSvg, expectedLogo);
    assert.equal(result.accounts[2].iconSvg, null);
    await runtime.inlineSuggestions(sender);
    assert.equal(runtime.fetches.length, 1);
  }

  for (const reason of ["lock", "replace", "expire", "revision"]) {
    const started = deferred();
    const finish = deferred();
    const runtime = createRuntime(source, parseSvgLogo, {
      fetch: async () => {
        started.resolve();
        await finish.promise;
        return new Response(svg);
      },
    });
    runtime.setAccounts([account()]);
    const pending = runtime.inlineSuggestions(sender);
    await started.promise;
    runtime.invalidateSession(reason);
    finish.resolve();
    assert.deepEqual(await pending, { ok: true, accounts: [], expiresAt: null },
      `${browserName}: ${reason} during logo loading must not expose stale accounts or codes.`);
    assert.equal(runtime.timers.size, 0);
  }
}

console.log("Verified inline logo fetch isolation, caching, size/time limits, fresh codes, and session race handling in both browsers.");
