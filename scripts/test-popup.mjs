import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const popupSource = await readFile(resolve(rootDir, "chrome", "popup", "popup.js"), "utf8");
const popupHtml = await readFile(resolve(rootDir, "chrome", "popup", "popup.html"), "utf8");
const popupCss = await readFile(resolve(rootDir, "chrome", "popup", "popup.css"), "utf8");

const originInputTag = popupHtml.match(/<input\b(?=[^>]*\bid="coffer-origin")[^>]*>/u)?.[0];
assert.ok(originInputTag, "Could not find the Coffer URL input.");
assert.match(originInputTag, /\bplaceholder="https:\/\/coffer\.yourhost\.com"/u);
assert.doesNotMatch(originInputTag, /\bvalue\s*=/u, "The Coffer URL input must start empty.");

assert.doesNotMatch(popupHtml, />\s*All Codes\s*</u);
assert.doesNotMatch(popupHtml, /id="codes-title"/u);
assert.match(popupHtml, /id="all-codes" aria-label="All codes"/u);
assert.match(popupHtml, /id="copy-status" role="status" aria-live="polite"/u);
assert.match(popupHtml, />Keep unlocked for up to 12 hours</u);

assert.match(popupSource, /const value = String\(account\.rawCode \|\| ""\);/u);
assert.match(popupSource, /const code = document\.createElement\("button"\);/u);
assert.match(popupSource, /code\.type = "button";/u);
assert.match(popupSource, /code\.addEventListener\("pointerenter",[\s\S]*?code\.classList\.add\("pointer-hover"\);/u);
assert.match(popupSource, /code\.addEventListener\("pointerleave",/u);
assert.match(popupSource, /pointerLeaveTimer = window\.setTimeout\(/u);
assert.match(popupSource, /if \(!code\.matches\(":hover"\)\) code\.classList\.remove\("pointer-hover"\);/u);
assert.match(popupSource, /\}, 80\);/u);
assert.match(popupSource, /code\.onclick = \(\) => void copyCode\(account, code\);/u);
assert.match(popupSource, /function updateCodeButton\(code, account\) \{\s*if \(!code \|\| code\.dataset\.copyState\) return;/u);
assert.match(popupSource, /code\.disabled = !canCopy;/u);
assert.match(popupSource, /if \(copyWritePending \|\| codeButton\.dataset\.copyState\) return;/u);
assert.match(popupSource, /meta\.append\(code, remaining, fillButton\);/u);
assert.doesNotMatch(popupSource, /copyButton/u);
assert.doesNotMatch(popupCss, /\.copy-button/u);
assert.match(popupCss, /\.code-value\[data-copy-state="copied"\]/u);
assert.match(popupCss, /\.code-value\.pointer-hover:not\(:disabled\)/u);
assert.doesNotMatch(popupCss, /\.code-value:hover:not\(:disabled\)/u);
assert.match(popupCss, /\.code-remaining \{[\s\S]*?contain: strict;/u);
assert.match(popupSource, /\? `Copy \$\{account\.service\} code \$\{accessibleCode\}`/u);
assert.match(popupCss, /grid-template-columns: 32px minmax\(0, 1fr\) 188px;/u);
assert.match(popupCss, /grid-template-columns: minmax\(0, 1fr\) 34px 52px;/u);
assert.match(popupCss, /\.page-codes h2 \{\s*padding: 15px 14px 9px;\s*font-size: 11px;/u);
assert.match(popupCss, /\.page-codes \.code-row \{\s*grid-template-columns: 38px minmax\(0, 1fr\) 216px;[\s\S]*?padding: 15px 14px;/u);
assert.match(popupCss, /\.page-codes \.code-copy strong \{\s*font-size: 17px;/u);
assert.match(popupCss, /\.page-codes \.code-identity \{\s*font-size: 15px;/u);
assert.match(popupCss, /\.page-codes \.code-value \{[\s\S]*?font-size: 20px;/u);
assert.match(popupCss, /\.page-codes \.code-remaining \{[\s\S]*?font-size: 17px;/u);
assert.match(popupCss, /\.page-codes \.fill-button \{[\s\S]*?font-size: 15px;/u);
assert.match(popupSource, /previousFocus\?\.focus\?\.\(\{ preventScroll: true \}\);/u);
assert.match(popupSource, /function invalidateCopyOperations\(\)/u);
assert.match(popupSource, /if \(!visible\) \{\s*invalidateCopyOperations\(\);/u);
assert.match(popupSource, /applyVaultState\(response\.vault, response\.warning \?\? ""\)/u);
assert.match(popupSource, /if \(state\.sessionWarning\)/u);
assert.match(popupSource, /const placeElement = \(element\) =>/u);
assert.match(popupSource, /container\.insertBefore\(element, nextElement\);/u);
assert.doesNotMatch(popupSource, /container\.append\((?:row|header)\);/u);
assert.match(popupSource, /element\.firstChild\.data = text;/u);
assert.match(popupSource, /function updateRenderedCountdowns\(accounts\)/u);
assert.match(popupSource, /updateRenderedCountdowns\(latestCodes\);/u);

const copyStart = popupSource.indexOf("async function copyCode");
const copyEnd = popupSource.indexOf("async function fillCode", copyStart);
assert.notEqual(copyStart, -1, "Could not find the popup copy handler.");
assert.notEqual(copyEnd, -1, "Could not find the end of the popup copy handler.");
const copySource = popupSource.slice(copyStart, copyEnd);
assert.doesNotMatch(copySource, /browser\.runtime\.sendMessage/u);
assert.doesNotMatch(
  copySource,
  /\brenderCodes\s*\(/u,
  "Copy feedback must not re-render every code row.",
);
const clipboardCall = copySource.indexOf("await writeClipboardText(value)");
assert.notEqual(clipboardCall, -1, "Copy must write the current raw TOTP value.");
assert.doesNotMatch(
  copySource.slice(0, clipboardCall),
  /\bawait\b/u,
  "Clipboard writing must begin before user activation can expire.",
);

const writerStart = popupSource.indexOf("async function writeClipboardText");
const writerEnd = popupSource.indexOf("async function copyCode", writerStart);
assert.notEqual(writerStart, -1, "Could not find the clipboard writer.");
assert.notEqual(writerEnd, -1, "Could not find the end of the clipboard writer.");
const loadWriter = new Function("navigator", "document", `
  ${popupSource.slice(writerStart, writerEnd)}
  return writeClipboardText;
`);

const modernWrites = [];
const modernWriter = loadWriter({
  clipboard: {
    async writeText(value) {
      modernWrites.push(value);
    },
  },
}, {});
await modernWriter("123456");
assert.deepEqual(modernWrites, ["123456"]);

function fallbackDocument(copyResult) {
  const observed = {
    appended: false,
    command: "",
    focusOptions: null,
    focusRestored: false,
    removed: false,
    selected: false,
    selection: null,
  };
  const previousFocus = {
    focus(options) {
      observed.focusOptions = options;
      observed.focusRestored = true;
    },
  };
  const buffer = {
    value: "",
    style: {},
    setAttribute() {},
    select() {
      observed.selected = true;
    },
    setSelectionRange(start, end) {
      observed.selection = [start, end];
    },
    remove() {
      observed.removed = true;
    },
  };
  const document = {
    activeElement: previousFocus,
    body: {
      append(node) {
        assert.equal(node, buffer);
        observed.appended = true;
      },
    },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return buffer;
    },
    execCommand(command) {
      observed.command = command;
      return copyResult;
    },
  };
  return { buffer, document, observed };
}

const fallback = fallbackDocument(true);
await loadWriter({}, fallback.document)("654321");
assert.equal(fallback.buffer.value, "654321");
assert.deepEqual(fallback.observed, {
  appended: true,
  command: "copy",
  focusOptions: { preventScroll: true },
  focusRestored: true,
  removed: true,
  selected: true,
  selection: [0, 6],
});

const denied = fallbackDocument(false);
await assert.rejects(
  loadWriter({ clipboard: { async writeText() { throw new Error("denied"); } } }, denied.document)("123456"),
  /Clipboard access was denied/u,
);
assert.equal(denied.observed.removed, true);
assert.equal(denied.observed.focusRestored, true);

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function codeButton(text = "123 456") {
  return {
    attributes: {},
    dataset: {},
    disabled: false,
    textContent: text,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function restoreTestCodeButton(button, account) {
  delete button.dataset.copyState;
  const rawCode = String(account.rawCode || "");
  button.textContent = account.code ?? rawCode.replace(/(\d{3})(?=\d)/u, "$1 ");
  button.disabled = !/^\d{6}(?:\d{2})?$/u.test(rawCode);
}

function timerWindow() {
  let nextId = 1;
  const timers = new Map();
  return {
    window: {
      clearTimeout(id) {
        timers.delete(id);
      },
      setTimeout(callback, delay) {
        const id = nextId;
        nextId += 1;
        timers.set(id, { callback, delay });
        return id;
      },
    },
    run(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

const coordinatorStart = popupSource.indexOf("function invalidateCopyOperations");
const coordinatorEnd = popupSource.indexOf("async function fillCode", coordinatorStart);
assert.notEqual(coordinatorStart, -1, "Could not find the copy coordinator.");
assert.notEqual(coordinatorEnd, -1, "Could not find the end of the copy coordinator.");
const loadCopyCoordinator = new Function(
  "navigator",
  "writeClipboardText",
  "copyStatus",
  "copyFeedbackTimers",
  "window",
  "renderCodes",
  "restoreCodeButton",
  "setStatus",
  `
    let copyWritePending = false;
    let copyWriteEpoch = 0;
    let activeCopyButton = null;
    let activeCopyEpoch = 0;
    let invalidatedCopyEpoch = 0;
    ${popupSource.slice(coordinatorStart, coordinatorEnd)}
    return {
      copyCode,
      invalidateCopyOperations,
      isPending: () => copyWritePending,
    };
  `,
);

const firstWriteGate = deferred();
const pendingWrites = [];
const pendingStatus = { textContent: "" };
const pendingTimers = timerWindow();
const pendingWarnings = [];
const pendingCoordinator = loadCopyCoordinator(
  { clipboard: {} },
  async (value) => {
    pendingWrites.push(value);
    await firstWriteGate.promise;
  },
  pendingStatus,
  new WeakMap(),
  pendingTimers.window,
  () => {},
  restoreTestCodeButton,
  (message) => pendingWarnings.push(message),
);
const firstButton = codeButton();
const secondButton = codeButton("654 321");
const firstCopy = pendingCoordinator.copyCode(
  { rawCode: "123456", service: "First" },
  firstButton,
);
assert.equal(pendingCoordinator.isPending(), true);
await pendingCoordinator.copyCode(
  { rawCode: "654321", service: "Second" },
  secondButton,
);
assert.deepEqual(pendingWrites, ["123456"], "Only one clipboard write may run at a time.");
assert.equal(secondButton.dataset.copyState, undefined);
firstWriteGate.resolve();
await firstCopy;
assert.equal(pendingCoordinator.isPending(), false);
assert.equal(firstButton.textContent, "Copied");
assert.deepEqual(pendingWarnings, []);
assert.equal(pendingStatus.textContent, "", "The live region must be cleared before announcing again.");
pendingTimers.run(0);
assert.equal(pendingStatus.textContent, "First code copied.");

const stableWriteGate = deferred();
const stableStatus = { textContent: "" };
const stableTimers = timerWindow();
const copiedButton = codeButton();
const untouchedButton = codeButton("654 321");
const copiedRow = { codeButton: copiedButton };
const untouchedRow = { codeButton: untouchedButton };
const visibleRows = { children: [copiedRow, untouchedRow] };
let copyRenderCount = 0;
const stableCoordinator = loadCopyCoordinator(
  { clipboard: {} },
  async () => stableWriteGate.promise,
  stableStatus,
  new WeakMap(),
  stableTimers.window,
  () => { copyRenderCount += 1; },
  restoreTestCodeButton,
  () => {},
);
const originalUntouchedRow = visibleRows.children[1];
const originalUntouchedButton = originalUntouchedRow.codeButton;
const assertUntouchedRow = (phase) => {
  assert.strictEqual(
    visibleRows.children[1],
    originalUntouchedRow,
    `Copy ${phase} must preserve the other code row DOM node.`,
  );
  assert.strictEqual(
    visibleRows.children[1].codeButton,
    originalUntouchedButton,
    `Copy ${phase} must preserve the other code button DOM node.`,
  );
  assert.equal(
    originalUntouchedButton.textContent,
    "654 321",
    `Copy ${phase} must keep the other code visible.`,
  );
  assert.equal(
    originalUntouchedButton.disabled,
    false,
    `Copy ${phase} must not dim the other code by disabling it.`,
  );
};

const stableCopy = stableCoordinator.copyCode(
  { rawCode: "123456", service: "Copied row" },
  copiedButton,
);
assert.equal(copyRenderCount, 0, "Starting a copy must not redraw the code list.");
assertUntouchedRow("while the clipboard write is pending");
stableWriteGate.resolve();
await stableCopy;
assert.equal(copyRenderCount, 0, "Finishing a copy must not redraw the code list.");
assertUntouchedRow("after the clipboard write succeeds");
stableTimers.run(900);
assert.equal(copyRenderCount, 0, "Clearing copy feedback must not redraw the code list.");
assertUntouchedRow("when the copied feedback clears");

const invalidatedWriteGate = deferred();
let clipboardValue = "";
const invalidatedRequestedWrites = [];
const invalidatedStatus = { textContent: "" };
const invalidatedTimers = timerWindow();
const invalidatedWarnings = [];
const invalidatedCoordinator = loadCopyCoordinator(
  {
    clipboard: {
      async readText() {
        return clipboardValue;
      },
      async writeText(value) {
        clipboardValue = value;
      },
    },
  },
  async (value) => {
    invalidatedRequestedWrites.push(value);
    await invalidatedWriteGate.promise;
    clipboardValue = value;
  },
  invalidatedStatus,
  new WeakMap(),
  invalidatedTimers.window,
  () => {},
  restoreTestCodeButton,
  (message) => invalidatedWarnings.push(message),
);
const invalidatedButton = codeButton();
const invalidatedCopy = invalidatedCoordinator.copyCode(
  { rawCode: "123456", service: "Locked" },
  invalidatedButton,
);
invalidatedCoordinator.invalidateCopyOperations();
assert.equal(invalidatedCoordinator.isPending(), true);
await invalidatedCoordinator.copyCode(
  { rawCode: "654321", service: "New session" },
  codeButton("654 321"),
);
assert.deepEqual(
  invalidatedRequestedWrites,
  ["123456"],
  "A new copy must wait until the invalidated clipboard write settles.",
);
invalidatedWriteGate.resolve();
await invalidatedCopy;
assert.equal(invalidatedCoordinator.isPending(), false);
assert.equal(invalidatedButton.dataset.copyState, undefined);
assert.notEqual(invalidatedButton.textContent, "Copied");
assert.equal(
  clipboardValue,
  "123456",
  "An already-started clipboard write may finish, but must not trigger destructive clipboard cleanup.",
);
assert.deepEqual(invalidatedWarnings, [], "An invalidated copy must not surface a stale warning.");
assert.equal(invalidatedStatus.textContent, "");
await invalidatedCoordinator.copyCode(
  { rawCode: "654321", service: "New session" },
  codeButton("654 321"),
);
assert.deepEqual(invalidatedRequestedWrites, ["123456", "654321"]);
assert.equal(clipboardValue, "654321");

for (const browser of ["chrome", "firefox"]) {
  const manifest = JSON.parse(await readFile(resolve(rootDir, browser, "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("clipboardWrite"), false);
}

console.log("Verified stable popup copy behavior, accessibility hooks, and heading removal.");
