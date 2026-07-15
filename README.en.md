# AIGC Video Workbench

> A local-first, recoverable desktop workspace that turns a topic into a real MP4 without requiring a paid model for its Demo Mode.

[中文 README](README.md) · [Documentation](docs/README.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

![AIGC Video Workbench hero](docs/images/product-hero.jpg)

## What it does

The product organizes AI-assisted video creation into eight explicit stages:

~~~mermaid
flowchart LR
  T["Topic"] --> S["Script"]
  S --> B["Storyboard"]
  B --> I["Images"]
  I --> A["Voice"]
  A --> C["Subtitles"]
  C --> L["Timeline"]
  L --> E["Export"]
~~~

Each stage owns its status, checkpoint, attempts, progress, output, and diagnostics. Successful upstream assets survive partial failures. A restarted service scans persisted tasks and resumes supported jobs from the most recent checkpoint.

| Capability | User-visible result |
| --- | --- |
| Recoverable workflow | Retry one failed stage instead of restarting the project |
| Partial-success batches | Keep successful images or audio while repairing failed items |
| Provider contracts | Normalize missing keys, timeouts, rate limits, malformed results, and fallbacks |
| Local Demo Mode | Complete the full workflow without a paid-model request |
| Real media export | Produce a playable MP4 with FFmpeg |
| Desktop security | Store credentials through Electron safeStorage and restrict renderer privileges |
| Reproducible release | Run CI, package preflight, signing checks, migrations, and recovery validation |

## Five-minute Demo

Requirements: Node.js 22+, npm 10+, macOS, Windows, or a common Linux development environment.

~~~bash
git clone https://github.com/728792899-create/aigc-video-platform.git
cd aigc-video-platform

npm ci
npm --prefix server ci
npm --prefix client ci
npm run demo
~~~

Open the URL printed by the launcher, normally `http://127.0.0.1:5173`.

Demo Mode uses local script templates, original placeholder frames, local placeholder audio, local subtitles, and real FFmpeg composition. It does not call a paid Provider. To verify recovery, stage retry, and playable export in an isolated temporary directory:

~~~bash
npm run test:smoke
~~~

## Product tour

![Web workspace](docs/screenshots/dashboard-overview.jpg)

| Projects | Script and storyboard |
| --- | --- |
| ![Projects](docs/screenshots/projects-overview.jpg) | ![Script and storyboard](docs/screenshots/script-storyboard.jpg) |

| Visual assets | Voice and subtitles |
| --- | --- |
| ![Visual assets](docs/screenshots/image-workbench.jpg) | ![Voice and subtitles](docs/screenshots/audio-subtitle.jpg) |

| Timeline preview | Provider routing |
| --- | --- |
| ![Timeline preview](docs/screenshots/preview-timeline.jpg) | ![Provider routing](docs/screenshots/provider-settings.jpg) |

| Native folder picker | Successful desktop export |
| --- | --- |
| ![Native folder picker](docs/screenshots/electron-folder-picker.jpg) | ![Successful desktop export](docs/screenshots/electron-export-success.jpg) |

The screenshots contain Demo data only. Concept art is labeled separately and never presented as a real product screen.

## Architecture

~~~mermaid
flowchart LR
  E["Electron main"] --> P["Restricted preload"]
  P --> V["Vue workspace"]
  V -->|same-origin REST| A["Express API"]
  A --> Q["Task manager"]
  Q --> W["Workflow state machine"]
  W --> R["Provider contracts"]
  W --> M["Media and FFmpeg"]
  W --> D["SQLite checkpoints"]
  E --> K["OS credential storage"]
  K -->|runtime only| R
~~~

The application is currently a single-user desktop product, not a multi-tenant SaaS. Its REST API is an internal compatibility surface for the bundled clients; it is documented for contributors but is not yet versioned as a public SDK.

## Quality gates

~~~bash
npm run quality
npm run test:smoke
npm run security:audit:all
node scripts/security-check.mjs
node scripts/ffmpeg-smoke.mjs
npm run electron:preflight
~~~

Automated tests clear common Provider credential variables. Provider tests use controlled fakes for no-key, timeout, rate-limit, malformed-response, fallback, placeholder, and partial-success scenarios.

## Desktop release status

| Platform | Build target | Public release requirement |
| --- | --- | --- |
| Windows x64 | NSIS | Trusted code-signing certificate and timestamp |
| macOS arm64/x64 | DMG and ZIP | Developer ID, hardened runtime, notarization, and stapling |

Unsigned or ad-hoc packages are internal preflight artifacts, not public releases. See the [desktop release guide](docs/desktop-release.md) and [release checklist](docs/release-checklist.md).

## Documentation map

- [Product tour](docs/product-tour.md)
- [Creator guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [Workflow recovery](docs/workflow-recovery.md)
- [Internal API reference](docs/api-reference.md)
- [Data model](docs/data-model.md)
- [Provider and Demo guide](docs/provider-guide.md)
- [Backup and restore](docs/backup-restore.md)
- [Security and data boundaries](docs/security-and-data.md)
- [Testing and CI](docs/testing-ci.md)
- [Troubleshooting](docs/troubleshooting.md)

## Security and license

Never commit Provider keys, databases, upload directories, logs, signing credentials, or user media. Report vulnerabilities through a private GitHub Security Advisory as described in [SECURITY.md](SECURITY.md).

The source code is released under the [MIT License](LICENSE). Inter uses the SIL Open Font License 1.1. Asset provenance and distribution notes are documented in [assets and third-party licenses](docs/assets-and-licenses.md).
