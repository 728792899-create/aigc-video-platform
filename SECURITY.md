# Security Policy

## Reporting

Please use GitHub private vulnerability reporting for credential exposure, path traversal, SSRF, arbitrary file access, unsafe IPC, authentication bypass, task double submission, or destructive data handling. Do not publish working secrets or private user media in an issue.

## Security model

- The Server listens on `127.0.0.1` and requires a random per-launch bearer token.
- Electron uses `contextIsolation`, sandboxing, disabled Node integration, a static preload whitelist, strict navigation rules, and CSP.
- Desktop secrets are encrypted with Electron `safeStorage`; the renderer never receives raw Provider keys.
- Provider networking is disabled in Demo and test environments.
- Uploads are bounded and validated by MIME, magic bytes, image decoding, safe names, and managed storage paths.
- Export paths remain server-side. API and Socket task payloads replace them with a protected marker.
- Durable tasks persist intent before execution and use idempotency keys to prevent duplicate work.
- Unknown remote task state becomes orphaned instead of being automatically resubmitted.

## Legacy data deletion

The one-time 2.0 purge is opt-in, uses an exact confirmation phrase, rejects symbolic links and paths outside the application-data root, and writes an idempotent tombstone. It performs ordinary deletion, not secure erasure. Automated tests use temporary directories only.

## Supported releases

Security fixes target the current 2.x branch. Unsigned development packages are not production releases. Formal distribution requires macOS notarization or Windows Authenticode verification.
