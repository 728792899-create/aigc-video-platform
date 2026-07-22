import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  clean: true,
  sourcemap: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  external: ['better-sqlite3', 'sharp', '@napi-rs/keyring'],
  // Bundle the portable server graph, but keep native modules as runtime
  // dependencies. A blanket noExternal rule makes esbuild inspect every
  // platform-specific keyring binary and breaks otherwise valid builds.
  noExternal: [/^(?!better-sqlite3$|sharp$|@napi-rs\/keyring$).+/u],
})
