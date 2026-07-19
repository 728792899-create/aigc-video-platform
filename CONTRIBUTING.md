# Contributing

## Environment

- Node.js 24 and pnpm 11
- system `ffmpeg` and `ffprobe`
- no real Provider key is required for development

Run before opening a PR:

```bash
pnpm install
pnpm quality
pnpm prepare:package
pnpm electron:preflight
git diff --check
```

## Engineering rules

- Use strict TypeScript and Zod at every external boundary.
- Add a failing test before changing domain, migration, task, media, security, or IPC behavior.
- Tests must set `DEMO_MODE=1` and `PROVIDER_NETWORK_DISABLED=1`; never submit paid work.
- Domain objects are canonical. Canvas JSON is layout state, not the project database.
- Preserve idempotency, task history, Candidate history, error correlation IDs, and approval checkpoints.
- Do not expose secrets, signed URLs, full Provider responses, user paths, databases, logs, or media.
- Do not add third-party Prompt text, screenshots, CSS, media, fonts, icons, or model files without provenance and license review.

## Clean-room contributions

Contributors may describe independently observed behavior but must not paste or translate external Prompt text, source code, styling, or resources. Record reference facts and independent design decisions in the legal provenance document. Runtime and public product text must not use a reference product as branding.

## Commit scope

Keep contracts, implementation, tests, and documentation buildable in the same commit. Generated databases, package stages, installers, logs, credentials, and user files are never committed.
