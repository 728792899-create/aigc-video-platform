# Third-Party Notices

This file is an engineering inventory, not legal advice.

| Component | Use | License / boundary |
| --- | --- | --- |
| Vue, Pinia, Vue Router | renderer framework and state | MIT |
| Vue Flow | domain graph rendering | MIT |
| Reka UI | accessible dialog primitives | MIT |
| Express, Socket.IO, Zod | local API, realtime events, validation | MIT |
| better-sqlite3, Knex | local persistence stack | MIT |
| yauzl 3.4.0 | validate and extract the optional Deno runtime ZIP | MIT |
| sharp | upload image decoding and metadata validation | Apache-2.0 |
| prebuilt libvips distributed with sharp | image codec runtime used by sharp | LGPL-3.0-or-later; corresponding package license/notices must remain in the packaged dependency tree |
| Electron | desktop runtime | MIT; bundled Chromium/Node notices also apply |
| FFmpeg / FFprobe | local export and verification | provided by the user/system; not bundled |
| lucide-vue-next | interface icons | ISC |
| Remaining production transitive packages | framework/runtime support | MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, or compatible multi-license choices; verified from `pnpm-lock.yaml` with `pnpm licenses list --prod` on 2026-07-18 |
| `@local/ai-video-director-prompt-pack` | user-provided clean-room Prompt/Skill/Workflow runtime | private / UNLICENSED; source provenance is recorded, but public redistribution remains a release gate until the owner assigns an explicit license |

The application icon in `resources/icon.svg` is original project artwork; PNG, ICNS, and ICO files are mechanical derivatives of that SVG.

`yazl@3.3.1` is an MIT-licensed development/test-only dependency used to create hostile and valid ZIP fixtures; it is not a production runtime dependency. `ini@1.3.0` omits an SPDX field in its package metadata, but its installed `LICENSE` contains the MIT license text. `expand-template` is `(MIT OR WTFPL)` and `rc` is `(BSD-2-Clause OR MIT OR Apache-2.0)`; this project uses the permissive option stated by each package.

No model weights, ONNX model, Deno runtime, Provider SDK credential, third-party Prompt, external screenshot, music, font, or demo video is committed or bundled in the current 2.0 tree. The optional Deno installer is locked to Deno 2.9.2 official release assets; platform, size, SHA-256 and source URL are recorded in `packages/providers/src/denoRuntime.ts`. Tests use generated fixtures and do not download or execute Deno. Any other optional download must record its exact version, checksum, source, size, and license before release. The desktop build copies this file and the project `LICENSE` into the application resources directory.
