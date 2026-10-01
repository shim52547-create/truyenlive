import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

const BASE = path.join(process.cwd(), '.cache')

export function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export async function getJSON<T>(sub: string, key: string, maxAgeMs?: number): Promise<T | null> {
  try {
    const file = path.join(BASE, sub, `${key}.json`)
    if (maxAgeMs !== undefined) {
      const st = await fs.stat(file)
      if (Date.now() - st.mtimeMs > maxAgeMs) return null
    }
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function setJSON(sub: string, key: string, data: unknown): Promise<void> {
  try {
    const dir = path.join(BASE, sub)
    await ensureDir(dir)
    await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(data), 'utf8')
  } catch {
    /* ignore write errors */
  }
}

export async function getBin(sub: string, key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(BASE, sub, key))
  } catch {
    return null
  }
}

export async function setBin(sub: string, key: string, data: Buffer): Promise<void> {
  try {
    const dir = path.join(BASE, sub)
    await ensureDir(dir)
    await fs.writeFile(path.join(dir, key), data)
  } catch {
    /* ignore write errors */
  }
}

/** Delete every cache subdirectory. Returns approximate number of files removed. */
export async function clearAll(): Promise<number> {
  let count = 0
  try {
    const entries = await fs.readdir(BASE, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(BASE, e.name)
      if (e.isDirectory()) {
        const files = await fs.readdir(p)
        count += files.length
        await fs.rm(p, { recursive: true, force: true })
      }
    }
  } catch {
    /* ignore */
  }
  return count
}

export async function sizeInfo(): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  try {
    const entries = await fs.readdir(BASE, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const dir = path.join(BASE, e.name)
      const names = await fs.readdir(dir)
      files += names.length
      for (const n of names) {
        try {
          const st = await fs.stat(path.join(dir, n))
          bytes += st.size
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { files, bytes }
}
