import fs from 'node:fs'

type SignatureByte = number | null
type Signature = readonly SignatureByte[]

const SIGNATURES: Readonly<Record<string, readonly Signature[]>> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]],
  'audio/mpeg': [[0x49, 0x44, 0x33], [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2]],
  'audio/wav': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x41, 0x56, 0x45]],
  'audio/mp4': [[null, null, null, null, 0x66, 0x74, 0x79, 0x70]],
  'audio/aac': [[0xff, 0xf1], [0xff, 0xf9], [0x49, 0x44, 0x33]],
}

export const MIME_ALIAS: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
}

function matchSignature(head: Buffer, signature: Signature): boolean {
  if (head.length < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    const expected = signature[index]
    if (expected == null) continue
    if (head[index] !== expected) return false
  }
  return true
}

/** 读取文件头并确认真实魔数属于业务 MIME 白名单。 */
export function verifyFileSignature(filePath: string, allowedMimes: readonly string[]): boolean {
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(16)
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead)
    const canonicalMimes = new Set(allowedMimes.map((mime) => MIME_ALIAS[mime] || mime))
    for (const mime of canonicalMimes) {
      const signatures = SIGNATURES[mime]
      if (signatures?.some((signature) => matchSignature(head, signature))) return true
    }
    return false
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch { /* 忽略关闭阶段错误 */ }
    }
  }
}
