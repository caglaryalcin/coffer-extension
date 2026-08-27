# Firefox Add-ons Submission

Build the review/upload package:

```sh
npm ci
npm run lint
npm run package:firefox
```

Upload the generated zip from `dist/`.

If AMO asks for a source archive, generate it from the exact release commit:

```sh
git archive --format=zip --output dist/coffer-extension-0.1.0-source.zip HEAD
```

Use `docs/AMO_LISTING.md` for the listing fields and reviewer notes.

## Permission Rationale

- `storage`: stores only the configured Coffer URL.
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

## Automated Listed Submission

After creating AMO API credentials, run:

```sh
export AMO_JWT_ISSUER=<issuer>
export AMO_JWT_SECRET=<secret>

npx web-ext sign --channel=listed \
  --amo-metadata=docs/amo-metadata.json \
  --upload-source-code=dist/coffer-extension-0.1.0-source.zip \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"
```
