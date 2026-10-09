// Blind preference (spec.md > D6 #9): export shuffled A/B pairs as CSV with a hidden key; read the person's choices back.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Arm, Review } from '../contracts.ts'

export type PairCandidate = { ad: string; segment: string; a: Review; b: Review }
type Key = Record<string, { A: Arm; B: Arm; ad: string; segment: string }>

const cell = (s: string) => `"${s.replace(/"/g, '""')}"`
const text = (r: Review) => r.reaction.map((s) => s.sentence).join(' ')

export async function exportBlindPairs(dir: string, candidates: PairCandidate[], count = 20) {
  const picked = [...candidates].sort(() => Math.random() - 0.5).slice(0, count)
  const key: Key = {}
  const rows = ['pair,ad,segment,reaction_A,reaction_B,choice']
  picked.forEach((c, i) => {
    const pair = `p${String(i + 1).padStart(2, '0')}`
    const [A, B] = Math.random() < 0.5 ? [c.a, c.b] : [c.b, c.a]
    key[pair] = { A: A.arm, B: B.arm, ad: c.ad, segment: c.segment }
    rows.push([pair, c.ad, c.segment, text(A), text(B), ''].map(cell).join(','))
  })
  await writeFile(path.join(dir, 'blind-pairs.csv'), rows.join('\n') + '\n')
  await writeFile(path.join(dir, 'blind-key.json'), JSON.stringify(key, null, 2))
  return picked.length
}

// Minimal RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(src: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim()))
}

// Wins per arm from the filled-in `choice` column (A, B or tie; anything else is skipped).
export async function readBlindChoices(dir: string) {
  const key: Key = JSON.parse(await readFile(path.join(dir, 'blind-key.json'), 'utf8'))
  const [head, ...rows] = parseCsv(await readFile(path.join(dir, 'blind-pairs.csv'), 'utf8'))
  const col = (name: string) => head.indexOf(name)
  const wins: Partial<Record<Arm, number>> = {}
  let judged = 0
  let ties = 0
  for (const r of rows) {
    const k = key[r[col('pair')]]
    const choice = r[col('choice')]?.trim().toUpperCase()
    if (!k || !['A', 'B', 'TIE'].includes(choice)) continue
    judged++
    if (choice === 'TIE') ties++
    else wins[k[choice as 'A' | 'B']] = (wins[k[choice as 'A' | 'B']] ?? 0) + 1
  }
  return { judged, ties, wins, arms: [...new Set(Object.values(key).flatMap((k) => [k.A, k.B]))] }
}
