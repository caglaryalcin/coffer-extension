# Coffer Browser Extension

This repository contains the Firefox and Chrome extension for Coffer. It works as a small Coffer client for TOTP codes.

![](https://raw.githubusercontent.com/caglaryalcin/coffer-extension/refs/heads/main/screenshots/chrome.gif)

![🌐 Chrome Extension](https://chromewebstore.google.com/detail/coffer/ajekhlpjkcohkdedhkdjkadilecboimd)

🌐 Firefox Extension (***Waiting review***...)

## Connection model

- The extension connects directly to the configured Coffer API at `/api/vault`.
- The Coffer tab does not need to be open.
- The active browser tab URL is used to prioritize matching codes and enforce saved Website URLs when filling.
- The popup fills the active page only when the user clicks a code's **Fill** button.
- On matching websites, focusing a likely one-time-code field opens an inline Coffer menu with account logos and a live period countdown; choosing an account fills its current code, including segmented digit fields.
- After sign-in, the popup shows every active TOTP code in the encrypted vault.
- Public service icon metadata is loaded from `/api/service-brands`; custom account icons come from the decrypted vault payload.
- Inline brand logos are fetched by the extension from the configured Coffer server and rendered as sanitized SVG geometry. Custom PNG logos are drawn locally on a canvas, so the menu does not rely on the target page allowing external images.
- Codes can be copied by clicking the displayed code itself or filled directly into the active page with **Fill**.
- **Keep unlocked** can retain an unlocked session for up to 12 hours, including across browser and Manifest V3 background-worker restarts.
- The popup starts with usernames visible and can hide or reveal them with its eye button; TOTP codes remain visible.

## Security model

- The server returns the vault header and encrypted payload only.
- TOTP secrets are decrypted inside the extension with the Coffer password.
- The password is used for one unlock attempt unless the user explicitly selects **Remember password on this device**. Email and password persistence are independent and can be disabled separately. When both **Remember password** and **Keep unlocked** are selected, the saved password can automatically recover an unexpired session if its resume key is rejected after a browser restart.
- Decrypted vault data and WebCrypto key handles stay in extension background memory only.
- When **Keep unlocked** is selected, only the minimum resume key material and session metadata are kept for up to 12 hours in extension-only `storage.local`; the decrypted vault is fetched and decrypted again after a background or browser restart.
- The remembered session is capped at 12 hours and is cleared by **Lock**, expiry, or a Coffer URL change. Because its resume key material is written to the browser profile, use this option only on a trusted device.
- Persistent `storage.local` contains the configured Coffer URL, popup preferences, cached public service-icon metadata, and only the sign-in fields the user explicitly chooses to remember. A remembered password is stored in the browser profile's extension-only local storage, so this option should be used only on a trusted device.
- OTP codes are generated locally and are never written to extension storage. A code reaches the clipboard only after the displayed code is explicitly clicked, or a matching page field after the user explicitly chooses an inline suggestion or clicks **Fill**.
- The extension reads website URLs to match vault accounts and inspects focused form-field metadata locally to identify likely one-time-code fields.
- The inline helper runs on HTTP and HTTPS pages, stays dormant unless a likely one-time-code field is focused, and receives matching account summaries only while Coffer is unlocked.
- Accounts with saved Website URLs are matched only against those URLs. Accounts without URLs retain the existing service-name, email-domain, brand-catalog, and provider-family matching.
- A short page script is injected only after **Fill** is clicked; it receives the current TOTP code and writes it to a likely one-time-code field.
- Coffer accepts browser-extension origins for the unlock/read API flow, while vault mutations stay restricted to the same-origin Coffer web app.
- Coffer exposes `/api/service-brands` as public catalog metadata; it does not include vault data or secrets.
- Use HTTPS for self-hosted Coffer URLs except local development on `localhost`.

## Website matching

- Add one or more **Website URLs** to a card in Coffer. The extension supports the current multiple-URL format and the older single-URL format.
- A saved address matches its hostname and subdomains with the same protocol and port. For example, `https://example.com` also matches `https://login.example.com`, but not `http://example.com`, `https://example.com:8443`, or `https://example.com.other.test`. IP addresses, localhost, and single-label hosts match exactly.
- Paths, query strings, and fragments do not restrict matching. Add every separate sign-in domain you use; a saved `hotmail.com` address does not authorize a redirect to `login.live.com` unless that address is also listed.
- When URLs are present, a service name, email address, or logo cannot add more matching sites. Both inline suggestions and popup **Fill** respect these addresses. Copying a code manually remains available.
- Inline suggestions use the URL of the frame containing the code field. Unrelated or opaque frames cannot inherit matching accounts from the parent page. Popup **Fill** targets the main page; use the inline menu for fields inside an iframe.

After changing a card in Coffer, click **Refresh vault** in the extension header to load its latest URLs and codes without signing in again.

## Temporary Install

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `firefox/manifest.json`.
4. Open the extension popup and enter the Coffer URL.
5. Click **Unlock** to save the URL, grant access if needed, and view, copy, or fill codes.

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `chrome/`.
5. Open the extension popup and enter the Coffer URL.
6. Click **Unlock** to save the URL, grant access if needed, and view, copy, or fill codes.

## Source Layout

- `firefox/` is a complete Firefox extension source tree.
- `chrome/` is a complete Chrome extension source tree.
- Runtime files are duplicated intentionally so either directory can be loaded or packaged independently.
- `npm run verify:sources` checks that shared runtime files remain identical and that each manifest keeps the correct browser-specific background configuration.

## Build Package

```sh
npm ci
npm run package:all
```

The build clears old artifacts, validates both source trees, and writes
`dist/coffer-<version>-firefox.zip` and `dist/coffer-<version>-chrome.zip`.

AMO listing text, reviewer notes, and permission rationale are in `docs/`.

## Server notes

Local development, production, and self-hosted Coffer accept Firefox and Chrome
extension origins directly. Use HTTPS for non-localhost Coffer URLs.

The vault API route grants browser extensions access only to `identify` and
`login`; all vault mutations stay same-origin only.
