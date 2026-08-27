# Coffer for Firefox

This repository contains the Firefox WebExtension for Coffer. It works as a small Coffer client for TOTP codes.

## Connection model

- The extension connects directly to the configured Coffer API at `/api/vault`.
- The Coffer tab does not need to be open.
- The active browser tab URL is used only to prioritize matching codes in the popup.
- The active page is filled only when the user clicks a code's **Fill** button.
- After sign-in, the popup shows every active TOTP code in the encrypted vault.
- Public service icon metadata is loaded from `/api/service-brands`; custom account icons come from the decrypted vault payload.
- Codes can be filled from the popup without writing them to the clipboard.

## Security model

- The server returns the vault header and encrypted payload only.
- TOTP secrets are decrypted inside the extension with the Coffer password.
- The password is used for one unlock attempt and is not stored.
- Decrypted vault data and WebCrypto key handles stay in extension background memory only.
- Extension storage keeps only the configured Coffer URL.
- OTP codes are generated locally and are not written to extension storage.
- The extension reads only the active tab URL while the popup is open, so page-specific codes can be shown first.
- A short page script is injected only after **Fill** is clicked; it receives the current TOTP code and writes it to a likely one-time-code field.
- Coffer accepts browser-extension origins for the unlock/read API flow, while vault mutations stay restricted to the same-origin Coffer web app.
- Coffer exposes `/api/service-brands` as public catalog metadata; it does not include vault data or secrets.
- Use HTTPS for self-hosted Coffer URLs except local development on `localhost`.

## Temporary install

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json`.
4. Open the extension popup and enter the Coffer URL.
5. Click **Unlock** to save the URL, grant access if needed, and view/fill codes.

## Build Package

```sh
npm ci
npm run lint
npm run package:firefox
```

The Firefox upload zip is written to `dist/`.

AMO listing text, reviewer notes, and permission rationale are in `docs/`.

## Server notes

Production/self-hosted Coffer does not need a per-browser extension UUID in
server configuration. Use HTTPS for non-localhost Coffer URLs.

Next.js development servers can reject unknown cross-origin requests. If local
development blocks the temporary Firefox extension, copy the popup/background
URL host from `about:debugging` and start Coffer with:

```sh
COFFER_ALLOWED_DEV_ORIGINS=<firefox-extension-uuid> npm run dev
```

The vault API route grants browser extensions access only to `identify` and
`login`; all vault mutations stay same-origin only.
