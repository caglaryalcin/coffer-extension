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

- `storage`: stores the configured Coffer URL and a boolean popup privacy preference.
- `activeTab`: reads the active tab URL while the popup is open, so matching Coffer codes can be shown first.
- `scripting`: injects a short one-time script only after the user clicks **Fill**.
- `host_permissions` for `localhost` and `127.0.0.1`: supports local Coffer development.
- `optional_host_permissions` for `http://*/*` and `https://*/*`: requested only for the user-configured Coffer server.

## Data Handling

- The extension does not collect analytics or telemetry.
- The Coffer password is never stored.
- Decrypted vault data and key handles stay in extension background memory only.
- TOTP codes are generated locally and are not written to extension storage or clipboard.
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
