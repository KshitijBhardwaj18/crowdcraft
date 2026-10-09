// Agent-stage outputs cached by input hash (spec.md > D6 #1): re-runs keep the same segments and spend no Qloo calls.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DIR = '.cache/stages'

export async function stageCache<T>(stage: string, input: unknown, fn: () => Promise<T>, noCache = false): Promise<{ value: T; cached: boolean }> {
  const file = path.join(DIR, `${stage}-${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)}.json`)
  if (!noCache) {
    try {
      return { value: JSON.parse(await readFile(file, 'utf8')) as T, cached: true }
    } catch {}
  }
  const value = await fn()
  await mkdir(DIR, { recursive: true })
  await writeFile(file, JSON.stringify(value))
  return { value, cached: false }
}
