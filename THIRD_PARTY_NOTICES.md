# Third-Party Notices

## hash-wasm

- Package: `hash-wasm`
- Version: `4.12.0`
- License: MIT
- Source: <https://github.com/Daninet/hash-wasm>
- Bundled file: `vendor/argon2.umd.min.js`

The bundled Argon2 runtime is used to derive Coffer vault key material locally inside the extension.

## sax-js

- Package: `sax`
- Version: `1.6.1`
- License: Blue Oak Model License 1.0.0
- Source: <https://github.com/isaacs/sax-js>
- Bundled files: `vendor/sax.js`, `vendor/sax-LICENSE.txt`

The bundled XML parser reads public Coffer SVG brand assets in the extension background. The upstream CommonJS wrapper is adapted to an ES module; the parser itself is unchanged. Only allowlisted, sanitized geometry is sent to the inline menu, never executable markup.

