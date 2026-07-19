import { cp, mkdir } from 'node:fs/promises'
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await cp(new URL('../static/purge.html', import.meta.url), new URL('../dist/purge.html', import.meta.url))
