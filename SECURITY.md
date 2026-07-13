# Security Policy

## Supported version

Security fixes are made on the latest `main` branch and the most recent desktop release. Older builds are not guaranteed to receive fixes.

## Reporting a vulnerability

Use the repository’s private GitHub Security Advisory form. Do not open a public issue with exploit details, user files, logs, API keys, database contents, or crash dumps.

Include the affected version/commit, platform, reproduction steps, expected impact, and a minimal redacted proof. You should receive an acknowledgement within seven days. Please allow a reasonable remediation window before disclosure.

## Secrets and user data

Never attach a real `settings.json`, `credentials.vault`, database, upload directory, backend log, PFX certificate, provisioning profile, or signing/notarization credential. Run `node scripts/security-check.mjs` before proposing a change.

Demo and automated tests must run without real Provider credentials and must not make paid-model requests.
