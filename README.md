# Coffer Browser Extension

This repository contains the Firefox and Chrome extension for Coffer. It works as a small Coffer client for TOTP codes.

![🌐 Chrome Extension](https://chromewebstore.google.com/detail/coffer/ajekhlpjkcohkdedhkdjkadilecboimd)

🌐 Firefox Extension (***Waiting review***...)

## Connection model

- The extension connects directly to the configured Coffer API at `/api/vault`.
- The Coffer tab does not need to be open.
- The active browser tab URL is used only to prioritize matching codes in the popup.
- The active page is filled only when the user clicks a code's **Fill** button.
- After sign-in, the popup shows every active TOTP code in the encrypted vault.
- Public service icon metadata is loaded from `/api/service-brands`; custom account icons come from the decrypted vault payload.
- Codes can be filled from the popup without writing them to the clipboard.
- The popup starts with usernames masked and can reveal or mask them with its eye button; TOTP codes remain visible.

## Security model

- The server returns the vault header and encrypted payload only.
- TOTP secrets are decrypted inside the extension with the Coffer password.
- The password is used for one unlock attempt and is not stored.
- Decrypted vault data and WebCrypto key handles stay in extension background memory only.
- Chrome may unload the Manifest V3 service worker and clear the in-memory unlock state sooner than Firefox.
- Extension storage keeps only the configured Coffer URL and the popup privacy preference.
- OTP codes are generated locally and are not written to extension storage.
- The extension reads only the active tab URL while the popup is open, so page-specific codes can be shown first.
- A short page script is injected only after **Fill** is clicked; it receives the current TOTP code and writes it to a likely one-time-code field.
- Coffer accepts browser-extension origins for the unlock/read API flow, while vault mutations stay restricted to the same-origin Coffer web app.
- Coffer exposes `/api/service-brands` as public catalog metadata; it does not include vault data or secrets.
- Use HTTPS for self-hosted Coffer URLs except local development on `localhost`.

## Temporary Install

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `firefox/manifest.json`.
4. Open the extension popup and enter the Coffer URL.
5. Click **Unlock** to save the URL, grant access if needed, and view/fill codes.

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `chrome/`.
5. Open the extension popup and enter the Coffer URL.
6. Click **Unlock** to save the URL, grant access if needed, and view/fill codes.

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
