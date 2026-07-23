import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'resources/demo/xingque')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
if (manifest.assets?.length !== 16) throw new Error(`Demo asset manifest must contain 16 entries; received ${manifest.assets?.length ?? 0}`)

const listed = new Set()
for (const asset of manifest.assets) {
  if (!/^[a-z0-9-]+\.png$/u.test(asset.file) || listed.has(asset.file)) throw new Error(`Invalid or duplicate demo asset name: ${asset.file}`)
  const bytes = await readFile(resolve(root, asset.file))
  if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error(`Demo asset is not PNG: ${asset.file}`)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (width !== asset.width || height !== asset.height) throw new Error(`Demo asset dimensions changed: ${asset.file}`)
  if (hash !== asset.sha256) throw new Error(`Demo asset hash changed: ${asset.file}`)
  if (!['Figma export', 'GPT built-in ImageGen'].includes(asset.source)) throw new Error(`Demo asset source is not approved: ${asset.file}`)
  listed.add(asset.file)
}

const actual = (await readdir(root)).filter((name) => name.endsWith('.png')).sort()
const expected = [...listed].sort()
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Demo asset directory and manifest differ')
process.stdout.write(`Demo asset validation passed: ${expected.length} original PNG files\n`)
