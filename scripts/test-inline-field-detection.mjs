import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

class FakeTextAreaElement {}

class FakeInputElement {
  constructor({ autocomplete = "", maxLength = -1, parentElement = null, type = "text" } = {}) {
    this.autocomplete = autocomplete;
    this.disabled = false;
    this.id = "";
    this.inputMode = "";
    this.maxLength = maxLength;
    this.parentElement = parentElement;
    this.pattern = "";
    this.readOnly = false;
    this.type = type;
  }

  closest() {
    return this.parentElement;
  }

  getAttribute() {
    return "";
  }

  getBoundingClientRect() {
    return { width: 44, height: 60 };
  }
}

class FakeContainer {
  constructor(inputs = [], parentElement = null, isForm = false) {
    this.inputs = inputs;
    this.parentElement = parentElement;
    this.isForm = isForm;
    this.textContent = "";
  }

  matches(selector) {
    return selector === "form" && this.isForm;
  }

  querySelectorAll(selector) {
    return selector === "input" ? this.inputs : [];
  }
}

function loadDetector(source) {
  const start = source.indexOf("function descriptor");
  const end = source.indexOf("function initials", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return new Function(
    "document",
    "window",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "POSITIVE_FIELD_PATTERN",
    "NEGATIVE_FIELD_PATTERN",
    "cssEscape",
    `${source.slice(start, end)}\nreturn { isTotpField, segmentedFields };`,
  )(
    { querySelectorAll: () => [] },
    { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
    FakeInputElement,
    FakeTextAreaElement,
    /(one.?time|otp|totp|mfa|2fa|verification|verify|authenticator|security.?code|pass.?code|code)/iu,
    /(email|e-mail|username|user.?name|password|passwort|search|phone|postal|zip)/iu,
    (value) => value,
  );
}

for (const browserName of ["chrome", "firefox"]) {
  const source = await readFile(resolve(rootDir, browserName, "inline-autofill.js"), "utf8");
  const { isTotpField, segmentedFields } = loadDetector(source);

  const form = new FakeContainer([], null, true);
  const group = new FakeContainer([], form);
  const segments = Array.from({ length: 6 }, () => new FakeInputElement({
    maxLength: 1,
    parentElement: group,
  }));
  group.inputs = segments;
  form.inputs = segments;

  assert.equal(segmentedFields(segments[0])?.length, 6);
  assert.equal(
    isTotpField(segments[0]),
    true,
    `${browserName}: an unlabeled six-box OTP control must open inline suggestions.`,
  );

  const loneCharacter = new FakeInputElement({ maxLength: 1 });
  const loneForm = new FakeContainer([loneCharacter], null, true);
  loneCharacter.parentElement = loneForm;
  assert.equal(isTotpField(loneCharacter), false, `${browserName}: a lone character field is not an OTP control.`);

  const semanticOtp = new FakeInputElement({ autocomplete: "one-time-code", maxLength: 6 });
  const semanticForm = new FakeContainer([semanticOtp], null, true);
  semanticOtp.parentElement = semanticForm;
  assert.equal(isTotpField(semanticOtp), true);

  const unlabeledOtp = new FakeInputElement({ maxLength: 6 });
  const unlabeledForm = new FakeContainer([unlabeledOtp], null, true);
  unlabeledOtp.parentElement = unlabeledForm;
  assert.equal(
    isTotpField(unlabeledOtp),
    true,
    `${browserName}: an unlabeled single-input six-digit control must open inline suggestions.`,
  );

  const numericForm = new FakeContainer([], null, true);
  const numericGroup = new FakeContainer([], numericForm);
  const numericSegments = Array.from({ length: 6 }, () => new FakeInputElement({
    parentElement: numericGroup,
    type: "number",
  }));
  numericGroup.inputs = numericSegments;
  numericForm.inputs = numericSegments;
  assert.equal(
    isTotpField(numericSegments[0]),
    true,
    `${browserName}: six numeric boxes without maxlength must open inline suggestions.`,
  );
}

console.log("Verified inline suggestions detect segmented OTP controls in Chrome and Firefox.");
