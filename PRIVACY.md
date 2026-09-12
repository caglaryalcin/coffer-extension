# Privacy Policy

Coffer browser extension does not collect analytics, telemetry, or advertising data.

Persistent extension storage contains the configured Coffer server URL, popup preferences, and cached public service-icon metadata. If you explicitly select **Remember email** or **Remember password on this device**, the selected fields are also stored independently in the browser profile's extension-only local storage until you turn the corresponding option off. A remembered password is therefore intended only for a trusted device. Persistent storage never contains decrypted vault data, TOTP secrets, or generated one-time codes.

If you select **Keep unlocked**, Coffer keeps the minimum resume key material plus the account identifier, Coffer origin, vault identifier, and fixed expiry time in extension-only `storage.session`. This session area stays in memory rather than being persisted to disk. It allows a restarted Manifest V3 background context to authenticate to your configured Coffer server and decrypt the current vault again without storing your password. The extension deletes this remembered session when you click **Lock**, its maximum 12-hour lifetime expires, or you change the Coffer URL; the browser also clears it when the browser session ends.

When you sign in, the extension sends your account identifier and a password-derived authentication proof to the Coffer server URL you configured. The server returns the encrypted vault payload, which is decrypted locally inside the extension. TOTP codes are generated locally and are never written to extension storage. A selected code is written to the system clipboard only when you explicitly click the displayed code.

The extension runs an inline helper on HTTP and HTTPS pages. It reads the page URL and focused form-field metadata locally to identify likely one-time-code fields and request only matching account summaries while Coffer is unlocked. Choosing an inline suggestion writes the selected current code into that field. Clicking a displayed popup code writes only that current code to the system clipboard; clicking **Fill** injects a short one-time script into the active tab to perform the same field-filling action.

The extension loads public service icon metadata and icon files from the configured Coffer server and may cache that public metadata locally. This metadata does not include vault contents, account secrets, passwords, or generated TOTP codes.

The extension communicates over the network only with the Coffer server URL you configure. Website matching and form-field inspection happen locally in the browser.
