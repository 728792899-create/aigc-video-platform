import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import type sharpType from 'sharp'

const runtimeRequire = createRequire(import.meta.url)
const vendorDirectory = process.env.AIGC_DIRECTOR_VENDOR_DIR ? resolve(process.env.AIGC_DIRECTOR_VENDOR_DIR) : undefined
const load = (name: string): unknown => runtimeRequire(vendorDirectory ? runtimeRequire.resolve(name, { paths: [vendorDirectory] }) : name)

export const DatabaseRuntime = load('better-sqlite3') as typeof BetterSqlite3
export const sharpRuntime = load('sharp') as typeof sharpType
