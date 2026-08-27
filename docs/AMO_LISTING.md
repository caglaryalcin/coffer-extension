# AMO Listing Notes

## Summary

Fill Coffer TOTP codes from Firefox using your self-hosted encrypted vault.

## Description

Coffer for Firefox is a small companion extension for Coffer, a self-hosted authenticator vault. Sign in to your Coffer server from the extension popup, view your active TOTP codes, and fill one-time-code fields on the active page with one click.

The Coffer tab does not need to be open. Your vault remains encrypted on the server and is decrypted locally in the extension after you enter your Coffer password.

## Categories

- Privacy & Security
- Other

## License

GPL-3.0-only

## Privacy Policy URL

https://github.com/caglaryalcin/coffer-extension/blob/main/PRIVACY.md

## Support Website

https://github.com/caglaryalcin/coffer-extension/issues

## Reviewer Notes

This extension is a companion client for a user-configured self-hosted Coffer server.

Data handling:
- No telemetry, analytics, advertising, or third-party tracking.
- The configured Coffer URL is the only value stored in Firefox extension storage.
- The Coffer password is used for one unlock attempt and is not stored.
- Decrypted vault data, TOTP secrets, and WebCrypto key handles stay in extension background memory only.
- Generated TOTP codes are not written to extension storage or the clipboard.
- Active tab URL is read only while the popup is open to prioritize matching codes.
- A page script is injected only after the user clicks Fill; it receives the selected TOTP code and writes it to a likely one-time-code field.
- Coffer allows browser-extension origins only for `identify` and `login`; vault mutations remain same-origin on the Coffer web app.

Third-party library:
- `vendor/argon2.umd.min.js` is `hash-wasm` version `4.12.0`, MIT licensed.
- npm package: https://www.npmjs.com/package/hash-wasm/v/4.12.0
- source repository: https://github.com/Daninet/hash-wasm
- The bundled file is used only for local Argon2id password-based key derivation.

Build/review:
- Runtime package: `npm run package:firefox`
- Validation: `npm run lint`
- The upload zip is generated under `dist/`.
- Optional source package: `VERSION=$(node -p "require('./package.json').version") && git archive --format=zip --output "dist/coffer-extension-${VERSION}-source.zip" HEAD`
