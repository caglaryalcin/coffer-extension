# AMO Listing Notes

## Summary

Fill Coffer TOTP codes from Firefox using your self-hosted encrypted vault.

## Description

Coffer for Firefox is a small companion extension for Coffer, a self-hosted authenticator vault. Sign in to your Coffer server from the extension popup, click a displayed TOTP code to copy it, use **Fill**, or choose a matching account from the inline menu shown on likely one-time-code fields.

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
- Persistent extension storage contains the configured Coffer URL, popup preferences, cached public service-icon metadata, and only sign-in fields the user explicitly chooses to remember.
- The Coffer password is used for one unlock attempt by default. It is persisted only when the user explicitly enables **Remember password on this device**, independently from **Remember email**, and is removed when that option is turned off. If **Keep unlocked** is also enabled, the saved password may automatically recover an unexpired session when normal resume fails after a browser restart.
- Decrypted vault data, TOTP secrets, and WebCrypto key handles stay in extension background memory only.
- If the user selects Keep unlocked, extension-only local storage holds only the minimum resume key material and bounded metadata for up to 12 hours so the session can survive a browser restart. It is cleared on Lock, expiry, or Coffer URL change and should be used only on a trusted device.
- Generated TOTP codes are never written to extension storage and reach the clipboard or a page field only after the user explicitly selects that action.
- HTTP and HTTPS page URLs and focused form-field metadata are inspected locally to match accounts and detect likely one-time-code fields. The inline helper stays dormant until such a field is focused.
- Matching account summaries are sent to the page only while Coffer is unlocked; a current code is written to the field only after the user chooses a suggestion. The **Fill** button remains available as a manual alternative.
- Coffer allows browser-extension origins only for `identify` and `login`; vault mutations remain same-origin on the Coffer web app.

Third-party library:
- `vendor/argon2.umd.min.js` is `hash-wasm` version `4.12.0`, MIT licensed.
- npm package: https://www.npmjs.com/package/hash-wasm/v/4.12.0
- source repository: https://github.com/Daninet/hash-wasm
- The bundled file is used only for local Argon2id password-based key derivation.

Build/review:
- Runtime package: `npm run package:firefox`
- Validation: `npm run lint`
- The upload zip is generated as `dist/coffer-<version>-firefox.zip`.
- Optional source package (PowerShell): `$version = node -p "require('./package.json').version"; git archive --format=zip --output "dist/coffer-extension-$version-source.zip" HEAD`
