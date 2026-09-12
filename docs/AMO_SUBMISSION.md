# Firefox Add-ons Submission

Build the review/upload package:

```powershell
npm ci
npm run clean:dist
npm run lint
npm run package:firefox
```

Upload `dist/coffer-<version>-firefox.zip`.

If AMO asks for a source archive, generate it from the exact release commit:

```powershell
$version = node -p "require('./package.json').version"
git archive --format=zip --output "dist/coffer-extension-$version-source.zip" HEAD
```

Use `docs/AMO_LISTING.md` for the listing fields and reviewer notes.

## Permission Rationale

- `storage`: persistently stores the configured Coffer URL, popup preferences, cached public icon metadata, and only the email/password fields the user explicitly chooses to remember. When the user selects **Keep unlocked**, extension-only in-memory session storage temporarily holds the minimum resume key material and session metadata; it is not written to disk.
- `alarms`: expires and removes a remembered unlocked session at its fixed deadline even when the background page is idle.
- `activeTab`: reads the active tab URL while the popup is open, so matching Coffer codes can be shown first.
- `scripting`: injects a short one-time script only after the user clicks **Fill**.
- `host_permissions` for HTTP and HTTPS pages: connects to the user-configured Coffer server and runs the local inline helper that detects likely one-time-code fields and offers matching Coffer accounts.

## Data Handling

- The extension does not collect analytics or telemetry.
- The Coffer password is not stored by default. It is persisted in extension-only local storage only when the user explicitly selects **Remember password on this device**, independently of the email option, and is removed when that option is turned off.
- Decrypted vault data and WebCrypto key handles stay in extension background memory only.
- **Keep unlocked** stores only resume key material and bounded session metadata in extension-only, in-memory `storage.session` for up to 12 hours. It does not store the decrypted vault, password, TOTP secrets, or generated codes there.
- TOTP codes are generated locally and are never written to extension storage. A code is written to the clipboard or a page field only after the user explicitly selects that action.
- The Coffer API returns encrypted vault payloads; the extension decrypts them locally after password verification.
- Coffer accepts browser-extension origins only for read/unlock actions; vault mutations remain same-origin on the Coffer web app.

## Automated Listed Submission

After creating AMO API credentials, run:

```powershell
$env:AMO_JWT_ISSUER = "<issuer>"
$env:AMO_JWT_SECRET = "<secret>"
$version = node -p "require('./package.json').version"

npx web-ext sign `
  --source-dir=firefox `
  --artifacts-dir=dist `
  --channel=listed `
  --amo-metadata=docs/amo-metadata.json `
  --upload-source-code="dist/coffer-extension-$version-source.zip" `
  --api-key="$env:AMO_JWT_ISSUER" `
  --api-secret="$env:AMO_JWT_SECRET"
```
