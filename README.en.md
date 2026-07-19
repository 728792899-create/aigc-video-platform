# AIGC Director Studio

A local-first, recoverable AI video production workspace built around domain graphs, evidence-linked story events, reviewable agents, durable tasks, and real MP4 export.

> An independently implemented AI-director capability superset based on public behavior research and a clean-room process.

Version 2.0 replaces the previous dashboard, phase pages, API, and database. `/studio` is the only product surface. Schema v9 persists exact Prompt/Skill revisions, CandidateBatch lineage, redacted media receipts, durable task evidence, traceable Episode → Series → Global memory, immutable AgentRun memory checkpoints, signed Provider plugin lifecycle state, and revocable Ed25519 publisher trust fingerprints. Checkpoints contain only memory IDs, hashes, source revisions, and retrieval reasons—never copied memory content.

Published Prompt revisions can be pinned to one Event, Scene, or Shot. Event/Scene runs append scoped Artifacts; Shot runs append Candidates without changing the selected result or touching another scene. The task snapshot records both Prompt and target revisions, and conflicting idempotency-key reuse fails closed.

## Quick start

Requirements: Node.js 24, pnpm 11, and system `ffmpeg` / `ffprobe`.

```bash
corepack enable
pnpm install
pnpm quality
pnpm dev
```

Open `http://127.0.0.1:5173/studio`. Demo Mode disables provider networking and never submits a paid request.

```bash
pnpm test:smoke
```

The smoke test creates a project, imports a chapter, extracts an event graph, approves an agent plan, creates shots and candidates, exports a valid MP4, restarts the service, and verifies recovery in a temporary directory.

Current local acceptance: 148/148 workspace tests, strict type checking, lint, clean-room and security scans, valid FFmpeg output, production build, Electron preflight, package leakage scan, and packaged macOS arm64 launch smoke. Demo paid requests remain zero. Production signing/notarization, Windows clean-machine acceptance, live Provider verification, and online updater E2E remain external gates.

The project switcher can export a self-contained `.aigcproj` backup and import it as an isolated copy. The package validates its manifest, schema, paths, quotas, and every media SHA-256; credentials, logs, and absolute local paths are excluded.

Story Graph accepts pasted text plus `.txt`, `.md`, and `.markdown`. Files are validated as bounded UTF-8, shown as non-executable plaintext in a cancellable quarantine preview, and committed transactionally only after the user confirms the content hash and chapter list.

## Stack

- Vue 3, Pinia, Vue Router, Vue Flow, Reka UI
- Express 5, Socket.IO, Zod, better-sqlite3
- Electron 40 with isolated preload and encrypted credential vault
- TypeScript strict monorepo managed by pnpm
- Fixed-version clean-room Prompt Pack: 26 prompts, 31 skills, and 2 workflows
- Deterministic Model Catalog, validated media resolution, batch candidate review, and revision-pinned boundary-frame continuity
- Traceable scoped memory with source revisions, retrieval reasons, stale history, and a no-network keyword fallback
- A default-off three-channel Egress Broker with per-hop DNS/IP validation, pinned-address transport, bounded streaming, host/path-hash audit, and host-only credential injection
- An optional Deno 2.9.2 installer with pinned release assets, size/SHA-256/ZIP/version verification, atomic publication, and explicit confirmation; Deno is not bundled and custom plugins remain disabled
- Atomic extraction of the last decodable video frame through system FFmpeg
- System FFmpeg; no bundled nonfree binary

See the [Chinese README](README.md), [documentation center](docs/README.md), [architecture](docs/architecture-v2.md), and [security policy](SECURITY.md).
