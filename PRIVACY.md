# Privacy Policy

Coffer for Firefox does not collect analytics, telemetry, or advertising data.

The extension stores only the configured Coffer server URL in Firefox extension storage. It does not store the Coffer password, decrypted vault data, TOTP secrets, or generated one-time codes.

When you sign in, the extension sends your account identifier and a password-derived authentication proof to the Coffer server URL you configured. The server returns the encrypted vault payload, which is decrypted locally inside the extension. TOTP codes are generated locally and are not written to extension storage or the clipboard.

When the popup is open, the extension reads the active tab URL only to show matching Coffer codes first. When you click **Fill**, the extension injects a short one-time script into the active tab to write the selected TOTP code into a likely one-time-code field.

The extension loads public service icon metadata and icon files from the configured Coffer server. This metadata does not include vault contents, account secrets, passwords, or generated TOTP codes.

The extension communicates only with the Coffer server URL you configure and the active tab you explicitly choose to fill.

