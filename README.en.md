# AIGC Director Studio

A local-first, recoverable AIGC video production workspace. It runs without an account or cloud database and provides 16 deep-linkable workspaces for brief, script, assets, shots, continuity, generation, review, timeline, export, tasks, Prompt/Skill operations, Provider connections, and local recovery.

The current product uses the dark **Obsidian Atelier** design system, a single collapsible sidebar, and one horizontal eight-stage project journey. Story, Production, and Delivery graphs remain local views of the same schema v12 canonical snapshot rather than separate navigation layers.

The single current source of truth for runtime scope, validation, and remaining release gates is the [2026-07-22 project status](docs/current-status.md).

## One-command local service

Requirements: Node.js 22.20+ (24 recommended), pnpm 11, `ffmpeg`, and `ffprobe`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` is the user-facing entrypoint (`pnpm local` remains an alias). It builds the embedded Studio and Server, starts one production service on `127.0.0.1:33100`, creates an ephemeral local session, and opens the project hub in the default browser. Stop it with `Ctrl+C`. Data stays in the operating system application-data directory. Demo Mode is the default and never submits a paid request.

For development, use `pnpm dev`. The deterministic acceptance flow is:

```bash
pnpm test:smoke
```

It creates a temporary project, imports source text, approves an Agent plan, produces candidates, injects one partial failure, retries only that failed item with idempotent replay, exports a valid MP4, restarts the service, and verifies complete recovery. Provider networking remains disabled.

## One-command Docker deployment

```bash
pnpm start:docker
pnpm docker:logs
pnpm stop:docker
```

Compose binds only to `127.0.0.1:33100`, runs as a non-root user with a read-only root filesystem and dropped capabilities, persists data in a named volume, and mounts Provider credentials through a read-only Docker Secret.

Both deployment modes serve the built frontend and API from one origin and open the browser automatically; Electron is not required. See the [local Web deployment guide](docs/local-web-deployment.md) for ports, lifecycle, and data locations.

## Provider boundary

- Built-in zero-key Demo Provider.
- OpenAI-compatible HTTPS connections.
- Declarative HTTP submit/poll/cancel manifests.
- Per-modality primary and fallback routing, timeouts, budgets, and an immutable local cost ledger.
- Credentials stored in the system Keychain/Credential Manager for native local service, or Docker Secrets in containers.
- No arbitrary JavaScript, Python, or Deno Provider adapter execution. Legacy executable-plugin endpoints are tombstoned with HTTP 410.
- Unknown remote outcomes must be reconciled before retry, preventing duplicate paid submissions.

Users pay providers directly. The Studio never sells credits; it enforces user-defined local limits and records only redacted cost evidence.

## Stack and status

- Vue 3, Pinia, Vue Router, Vue Flow, and Reka UI.
- Express 5, Socket.IO, Zod, better-sqlite3 schema v12.
- Fixed-version clean-room Prompt Pack, deterministic Model Catalog, durable tasks, checkpoint recovery, and real FFmpeg MP4 export.
- Electron 40 remains an optional development shell; signed installers, notarization, Authenticode, and automatic updates are external release gates.
- All automated tests run with `DEMO_MODE=1` and `PROVIDER_NETWORK_DISABLED=1`; paid requests must remain zero.

See the [Chinese README](README.md), [documentation center](docs/README.md), [architecture](docs/architecture-v2.md), [API reference](docs/api-v2.md), and [security design](docs/security-v2.md).
