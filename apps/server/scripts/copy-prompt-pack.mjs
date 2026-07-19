import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(appRoot, '../../packages/ai-video-director-prompt-pack')
const targetRoot = resolve(appRoot, 'dist/prompt-pack')
const runtimeRegistryFiles = Object.freeze([
  'prompts.json',
  'skills.json',
  'workflows.json',
  'provider-profiles.json',
  'evals.json',
])

await rm(targetRoot, { recursive: true, force: true })
await mkdir(resolve(targetRoot, 'registry'), { recursive: true })
await Promise.all(runtimeRegistryFiles.map(async (name) => {
  await copyFile(resolve(sourceRoot, 'registry', name), resolve(targetRoot, 'registry', name))
}))
await copyFile(resolve(sourceRoot, 'PROVENANCE.md'), resolve(targetRoot, 'PROVENANCE.md'))
