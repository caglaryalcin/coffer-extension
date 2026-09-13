// Local-only visual regression fixture. All accounts and codes below are synthetic.
// Run: node scripts/preview-inline-logos.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseSvgLogo } from "../chrome/svg-logo.js";

const port = Number(process.argv[2] ?? 8766);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port.");
const inlinePath = fileURLToPath(new URL("../chrome/inline-autofill.js", import.meta.url));
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'none'",
  "connect-src 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join("; ");

const microsoftSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M1 1h10v10H1zM13 1h10v10H13zM1 13h10v10H1zM13 13h10v10H13z"/></svg>`;
const gradientSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="paint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00cfff"/><stop offset="1" stop-color="#f64bba"/></linearGradient><path id="shape" d="M2 2h20v20H2z"/></defs><style>.gradient { fill: url(#paint); } .detail { fill: #ffffff; }</style><use href="#shape" class="gradient"/><circle class="detail" cx="12" cy="12" r="4"/></svg>`;
const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="globalThis.fixtureScriptRan = true"><script>globalThis.fixtureScriptRan = true</script><image href="https://never-fetch.example.test/private.svg"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Forbidden HTML</div></foreignObject><path fill="url(https://never-fetch.example.test/paint)" d="M0 0h24v24H0z"/></svg>`;
const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGN4ZhT1H4QZYAwAVxAJxT+t8f4AAAAASUVORK5CYII=";

function parseFixture(svg) {
  try {
    return parseSvgLogo(svg);
  } catch {
    return null;
  }
}

const baseAccount = {
  code: "123 456",
  rawCode: "123456",
  group: "Synthetic test fixture",
  identity: "demo@example.test",
  period: 30,
  remaining: 30,
};
const accounts = [
  { ...baseAccount, service: "Microsoft", iconSvg: parseFixture(microsoftSvg), iconColor: "#5e5e5e", iconTitle: "Microsoft" },
  { ...baseAccount, service: "Gradient and reuse", iconSvg: parseFixture(gradientSvg), iconColor: "#202530", iconTitle: "Gradient fixture" },
  { ...baseAccount, service: "Custom PNG", iconDataUrl: pngDataUrl, iconColor: "#fff", iconTitle: "Custom logo" },
  { ...baseAccount, service: "Initials fallback" },
];
const hostileResult = parseFixture(hostileSvg);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coffer inline logo regression</title><link rel="stylesheet" href="/fixture.css"></head>
<body><main><h1>Coffer inline logo regression</h1><p>Local synthetic accounts. The page blocks all image and fetch requests and requires Trusted Types.</p><div class="field"><label for="otp-code">One-time code</label><input id="otp-code" name="otp-code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" autofocus></div><pre id="report" role="status">TEST RUNNING — waiting for the real inline menu.</pre><p class="help">The menu should display four white Microsoft squares, a blue/pink gradient, a pink PNG square, and IF initials. All codes are synthetic.</p></main><script src="/mock.js"></script><script src="/inline-autofill.js"></script></body></html>`;
const css = `:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif;background:#1c2027;color:#e8ebf2}body{margin:0}main{max-width:900px;margin:38px auto;padding:0 24px}h1{font-size:24px;margin:0 0 12px}p{color:#adb8ca}.field{width:400px;max-width:90vw;margin-top:28px}label{display:block;font-size:12px;margin-bottom:5px}input{width:100%;box-sizing:border-box;font:20px system-ui;padding:12px;background:#252930;border:1px solid #6c7a8b;border-radius:5px;color:#fff}pre{white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace;margin-top:300px;border:1px solid #596273;border-radius:7px;padding:18px;background:#232932}pre[data-status=pass]{border-color:#57ad87}pre[data-status=fail]{border-color:#db7474}.help{font-size:12px}`;

const mock = `"use strict";
const fixtureAccounts = ${JSON.stringify(accounts)};
const fixtureHostileResult = ${JSON.stringify(hostileResult)};
const fixtureChecks = [];
const fixtureCspViolations = [];
let fixtureShadow = null;
const fixtureAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  const root = fixtureAttachShadow.call(this, options);
  if (this.id === "coffer-inline-autofill-host") fixtureShadow = root;
  return root;
};
globalThis.browser = {
  runtime: {
    async sendMessage(message) {
      if (message.type === "inline-suggestions") {
        return { ok: true, accounts: fixtureAccounts, expiresAt: Date.now() + 60000 };
      }
      return { ok: true };
    },
  },
};
document.addEventListener("securitypolicyviolation", (event) => {
  fixtureCspViolations.push(event.effectiveDirective + ": " + event.blockedURI);
});
function fixtureSafeTree(node) {
  if (node === null || node === undefined) return true;
  if (typeof node !== "object") return false;
  if (["script", "image", "foreignobject", "style", "iframe"].includes(String(node.tag).toLowerCase())) return false;
  const entries = Array.isArray(node.attrs) ? node.attrs : Object.entries(node.attrs ?? {});
  if (entries.some(([name, value]) => /^on/i.test(name) || /https?:|javascript:|data:/i.test(String(value)))) return false;
  return (node.children ?? []).every(fixtureSafeTree);
}
function fixtureCheck(name, condition, detail = "") {
  fixtureChecks.push({ name, passed: Boolean(condition), detail });
}
function fixtureReport() {
  const failed = fixtureChecks.filter((check) => !check.passed);
  const report = document.getElementById("report");
  report.dataset.status = failed.length ? "fail" : "pass";
  report.textContent = (failed.length ? "TEST FAIL" : "TEST PASS") + " — " + (fixtureChecks.length - failed.length) + "/" + fixtureChecks.length + " checks\\n\\n" + fixtureChecks.map((check) => (check.passed ? "PASS  " : "FAIL  ") + check.name + (check.detail ? " — " + check.detail : "")).join("\\n");
  globalThis.fixtureResult = { passed: failed.length === 0, checks: fixtureChecks, violations: fixtureCspViolations };
}
async function fixtureValidate() {
  const deadline = Date.now() + 8000;
  let options = [];
  while (Date.now() < deadline) {
    options = Array.from(fixtureShadow?.querySelectorAll(".option") ?? []);
    if (options.length === 4 && options[2].querySelector(".logo canvas")) break;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  fixtureCheck("Four real inline suggestions rendered", options.length === 4, String(options.length));
  fixtureCheck("Microsoft source parsed", fixtureAccounts[0].iconSvg?.tag === "svg");
  const microsoft = options[0]?.querySelector(".logo svg");
  fixtureCheck("Microsoft SVG geometry rendered", Boolean(microsoft?.querySelector("path")));
  fixtureCheck("Microsoft inherited white fill retained", microsoft?.getAttribute("fill") === "#fff" || microsoft?.querySelector("path")?.getAttribute("fill") === "#fff");
  const gradient = options[1]?.querySelector(".logo svg");
  fixtureCheck("Gradient and reuse source parsed", fixtureAccounts[1].iconSvg?.tag === "svg");
  fixtureCheck("Gradient definitions rendered", Boolean(gradient?.querySelector("linearGradient")));
  fixtureCheck("Reusable geometry rendered", Boolean(gradient?.querySelector("use, path")));
  fixtureCheck("Safe styles retained", Boolean(gradient && Array.from(gradient.querySelectorAll("*")).some((node) => /url\\(#/.test(node.getAttribute("fill") ?? "") || /url\\(#/.test(node.getAttribute("style") ?? ""))));
  const canvas = options[2]?.querySelector(".logo canvas");
  let pixel = null;
  try {
    pixel = canvas?.getContext("2d")?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
  } catch {}
  fixtureCheck("Custom PNG decoded to colored canvas", Boolean(pixel && pixel[0] > 180 && pixel[1] < 100 && pixel[2] > 40 && pixel[3] > 240), pixel ? Array.from(pixel).join(",") : "no pixels");
  fixtureCheck("Missing logo retains initials", options[3]?.querySelector(".logo")?.textContent.trim() === "IF");
  fixtureCheck("Dangerous SVG rejected or sanitized", fixtureSafeTree(fixtureHostileResult));
  fixtureCheck("No scripts or remote elements in logo DOM", !fixtureShadow?.querySelector(".logo script, .logo img, .logo image, .logo foreignObject, .logo iframe"));
  fixtureCheck("No hostile script executed", globalThis.fixtureScriptRan !== true);
  const resources = performance.getEntriesByType("resource");
  fixtureCheck("No image requests", !resources.some((entry) => entry.initiatorType === "img"));
  fixtureCheck("No external network requests", !resources.some((entry) => new URL(entry.name, location.href).origin !== location.origin));
  fixtureCheck("Strict CSP and Trusted Types respected", fixtureCspViolations.length === 0, fixtureCspViolations.join("; "));
  fixtureReport();
}
document.addEventListener("DOMContentLoaded", () => {
  const field = document.getElementById("otp-code");
  field.focus();
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  void fixtureValidate();
}, { once: true });
`;

const server = createServer(async (request, response) => {
  response.setHeader("Content-Security-Policy", contentSecurityPolicy);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  const routes = {
    "/": ["text/html; charset=utf-8", html],
    "/fixture.css": ["text/css; charset=utf-8", css],
    "/mock.js": ["text/javascript; charset=utf-8", mock],
  };
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  try {
    const route = pathname === "/inline-autofill.js"
      ? ["text/javascript; charset=utf-8", await readFile(inlinePath, "utf8")]
      : routes[pathname];
    if (!route) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", route[0]);
    response.end(route[1]);
  } catch {
    response.writeHead(500).end("Fixture source unavailable");
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Inline logo fixture: http://127.0.0.1:${port}/`);
  console.log("Synthetic data only; local loopback only. Press Ctrl+C to stop.");
});
