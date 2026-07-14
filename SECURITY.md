# Security Policy

## Supported versions

Security fixes target the latest `main` branch and the most recent desktop release. Older development builds and unsigned preflight packages are not guaranteed to receive fixes.

## Report a vulnerability

Use the repository's private GitHub Security Advisory form. Do not open a public issue containing exploit details, credentials, databases, media, logs, backups, crash dumps, or signing files.

Include:

- affected version or commit;
- platform and architecture;
- minimal reproduction steps;
- expected impact;
- a redacted proof;
- whether the issue is reachable in Web, Electron, or packaged builds.

An acknowledgement is targeted within seven days. Please allow a reasonable remediation and release window before disclosure.

## Security boundaries

The product is a local, single-user desktop application. It is not a hardened multi-tenant service.

~~~mermaid
flowchart LR
  Renderer["Vue renderer"] -->|same-origin REST| API["Local Express API"]
  Renderer -->|restricted bridge| Preload["Electron preload"]
  Preload --> Main["Electron main"]
  Main --> Safe["OS safeStorage"]
  API --> DB["SQLite + managed media"]
  API --> Provider["User-selected Provider"]

  Renderer -. no direct access .-> Safe
  Renderer -. no Node access .-> Main
~~~

Desktop defaults include:

- `contextIsolation=true`;
- `nodeIntegration=false`;
- renderer sandbox enabled;
- a minimal preload allowlist;
- IPC sender and argument validation;
- local CORS allowlist;
- HTTPS-only external links;
- request IDs and redacted error handling;
- MIME plus file-signature upload checks.

## Secrets and user data

Never commit or attach:

- real `.env` files;
- `settings.json` with legacy credentials;
- `credentials.vault`;
- SQLite databases or `.aigcbak` files;
- uploads, exports, screenshots containing private content;
- `backend.log` or crash dumps without review;
- PFX, p12, p8, provisioning profiles, passwords, or notarization credentials.

Electron stores Provider secrets through safeStorage. Renderer responses expose masks only. Configuration export and database backup intentionally exclude secrets.

## Demo and automated tests

Demo and automated tests must work with all real Provider credentials unset. They must not make paid-model requests.

Provider tests use fake credentials and controlled fake endpoints for:

- missing credentials;
- timeout;
- authentication failure;
- rate limiting;
- 5xx errors;
- malformed response;
- fallback Provider;
- explicit placeholder output;
- partial batch failure.

Run before proposing a change:

~~~bash
node scripts/security-check.mjs
npm run quality
~~~

## Logs and telemetry

Sentry is disabled unless `SENTRY_DSN` is explicitly configured. When enabled, `sendDefaultPii=false` and beforeSend redaction remove common credential fields and sensitive URL parameters.

Logs and telemetry must not contain full prompts, Provider payloads, credentials, databases, media, or unredacted user paths. Prefer request ID, task id, stage, Provider name, error class, release, and recovery count.

## Desktop release

Unsigned Windows and ad-hoc macOS packages are internal preflight artifacts. Public distribution requires:

- a trusted Windows code-signing certificate and timestamp; or
- Apple Developer ID signing, hardened runtime, notarization, and stapling.

Signing and notarization credentials belong in protected CI secrets, never in the repository or release assets.

## Response process

Maintainers should:

1. reproduce in an isolated environment;
2. preserve only redacted evidence;
3. assess affected versions and data boundaries;
4. write a regression test;
5. fix without weakening Electron or credential controls;
6. run quality, security, FFmpeg, and packaging checks;
7. prepare a signed release and coordinated advisory;
8. rotate any credential that might have been exposed.

See [security and data boundaries](docs/security-and-data.md), [observability](docs/observability.md), and the [desktop release guide](docs/desktop-release.md).
