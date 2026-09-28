# Coffer Browser Extension

This repository contains the Firefox and Chrome extension for Coffer. It works as a small Coffer client for TOTP codes.

![](https://raw.githubusercontent.com/caglaryalcin/coffer-extension/refs/heads/main/screenshots/chrome.gif)

🌐 [Chrome Extension](https://chromewebstore.google.com/detail/coffer/ajekhlpjkcohkdedhkdjkadilecboimd)

🌐 [Firefox Extension](https://addons.mozilla.org/tr/firefox/addon/coffer/)

## Connection model

The extension connects directly to the configured Coffer API without requiring an open Coffer tab, then displays, copies, or fills matching TOTP codes through the popup and inline suggestions while supporting group, privacy, and remembered-unlock preferences.

## Security model

Encrypted vault data is decrypted locally, secrets and OTP codes are not persisted, and only explicitly selected preferences or remembered-login data are stored in the extension profile, so remembered sessions should be used only on trusted devices and self-hosted servers should use HTTPS outside localhost.

## Website matching

Saved Website URLs restrict an account to matching hosts and subdomains with the same protocol and port (with exact matching for IP, localhost, and single-label hosts), while accounts without URLs use service metadata; inline suggestions match the containing frame, popup **Fill** matches the main page, and **Refresh vault** loads URL changes.

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
