// Selection (spec.md > D4): an affinity matrix over every candidate's pooled top items picks the 4–6 most distinct
// segments; distinctive items are what a segment scores higher on than the other kept segments.
import type { EvidenceItem, Segment } from '../contracts.ts'
import { fit, setsApart, type Ctx, type Domain } from '../qloo/client.ts'
import { isSensitiveTag, type ToolRegistry } from '../qloo/tools.ts'
import { FP_DOMAINS, type Fingerprint } from './fingerprints.ts'

export const STOP_DISTANCE = 0.15 // spec.md > D6 #6, tuned on the eval set

export type Column = { id: string; domain: Domain; item: EvidenceItem }

// Each candidate contributes its top N per domain, capped at 50 IDs per domain (one Qloo call per candidate per domain).
export function buildPool(fps: Fingerprint[]): Column[] {
  const perCand = Math.max(1, Math.floor(50 / Math.max(fps.length, 1)))
  return FP_DOMAINS.flatMap((domain) => {
    const seen = new Map<string, EvidenceItem>()
    for (const fp of fps) for (const it of fp.top[domain].slice(0, perCand)) if (!seen.has(it.qlooId)) seen.set(it.qlooId, it)
    return [...seen.values()].slice(0, 50).map((item) => ({ id: item.qlooId, domain, item }))
  })
}

// rows[c][k] = candidate c's affinity for column k; items Qloo omits (below the cutoff) are 0.
export async function affinityMatrix(fps: Fingerprint[], cols: Column[], ctx: Ctx): Promise<number[][]> {
  return Promise.all(
    fps.map(async (fp) => {
      const byDomain = await Promise.all(
        FP_DOMAINS.map((d) => fit(d, fp.cand.signals, cols.filter((c) => c.domain === d).map((c) => c.id), { ...ctx, stage: 'select' })),
      )
      const all = new Map(byDomain.flatMap((m) => [...m]))
      return cols.map((c) => all.get(c.id) ?? 0)
    }),
  )
}

export function pearson(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

// Distance in [0, 1]: 0 = identical taste pattern, 1 = opposite. (1 − r) / 2.
export const distanceMatrix = (rows: number[][]) => rows.map((a) => rows.map((b) => (a === b ? 0 : (1 - pearson(a, b)) / 2)))

// Greedy max-min: start with the richest candidate, add the one farthest from everything kept,
// stop at `max`, or when the next is closer than `stopAt` (but keep at least `min` when possible, never fewer than 2).
export function greedySelect(dist: number[][], richness: number[], o = { max: 6, min: 4, stopAt: STOP_DISTANCE }): number[] {
  const n = dist.length
  if (n <= 2) return [...Array(n).keys()]
  const kept = [richness.indexOf(Math.max(...richness))]
  while (kept.length < Math.min(o.max, n)) {
    let best = -1
    let bestD = -1
    for (let i = 0; i < n; i++) {
      if (kept.includes(i)) continue
      const d = Math.min(...kept.map((k) => dist[i][k]))
      if (d > bestD) (best = i), (bestD = d)
    }
    if (best < 0 || (bestD < o.stopAt && kept.length >= Math.min(o.min, n)) || (bestD <= 0 && kept.length >= 2)) break
    kept.push(best)
  }
  return kept
}

// A segment's distinctive items: things in its OWN top lists that the other kept segments love less
// (omitted = 0), ranked by the gap, top `perDomain` per domain. Own lists keep places local to the segment.
export function distinctiveItems(kept: number[], rows: number[][], cols: Column[], own: Set<string>[], perDomain = 3) {
  return kept.map((c, ci) =>
    FP_DOMAINS.flatMap((domain) =>
      cols
        .map((col, k) => ({ col, k }))
        .filter(({ col, k }) => col.domain === domain && own[ci].has(col.id) && rows[c][k] > 0)
        .map(({ col, k }) => {
          const others = kept.filter((o) => o !== c).map((o) => rows[o][k])
          const mean = others.length ? others.reduce((s, x) => s + x, 0) / others.length : 0
          return { ...col.item, affinity: rows[c][k], distinctiveness: Number((rows[c][k] - mean).toFixed(3)) }
        })
        .filter((x) => x.distinctiveness > 0.05)
        .sort((a, b) => b.distinctiveness - a.distinctiveness)
        .slice(0, perDomain),
    ),
  )
}

export const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a)
  const B = new Set(b)
  const union = new Set([...A, ...B]).size
  return union ? [...A].filter((x) => B.has(x)).length / union : 0
}

// The reported distinctness metric: the worst pair's mean top-list overlap across domains.
export function maxOverlap(fps: Fingerprint[], pair: (a: Fingerprint, b: Fingerprint) => boolean = () => true): number {
  let worst = 0
  for (let i = 0; i < fps.length; i++)
    for (let j = i + 1; j < fps.length; j++) {
      if (!pair(fps[i], fps[j])) continue
      const o = FP_DOMAINS.reduce((s, d) => s + jaccard(fps[i].top[d].map((x) => x.qlooId), fps[j].top[d].map((x) => x.qlooId)), 0) / FP_DOMAINS.length
      worst = Math.max(worst, o)
    }
  return worst
}

const AGE: Record<string, string> = { '24_and_younger': '24 and under', '25_to_29': '25-29', '30_to_34': '30-34', '35_to_44': '35-44', '45_to_54': '45-54', '55_and_older': '55+' }

// Describe the cells (spec.md > D4b, D4): one affinity matrix across all cells gives each its distinctive items;
// themes and Analysis Compare say what sets it apart. Cells are kept as built: they are what the marketer buys.
export async function describeSegments(fps: Fingerprint[], ctx: Ctx, reg: ToolRegistry): Promise<{ segments: Segment[]; overlap: number }> {
  const cols = buildPool(fps)
  const rows = await affinityMatrix(fps, cols, ctx)
  const kept = fps.map((_, i) => i)
  ctx.trace?.add('select', 'decision', `Scored ${fps.length} audiences on ${cols.length} shared taste items to find what each loves more than the others`)
  const items = distinctiveItems(kept, rows, cols, fps.map((f) => new Set(FP_DOMAINS.flatMap((d) => f.top[d].map((x) => x.qlooId)))))
  // Cells in the same region share taste by design (D4b); the distinctness target applies across regions.
  const regionsOf = [...new Set(fps.map((f) => f.cand.region))]
  const cross = regionsOf.length > 1 ? Math.max(...regionsOf.flatMap((a, i) => regionsOf.slice(i + 1).map((b) => maxOverlap(fps.filter((f) => f.cand.region === a || f.cand.region === b), (x, y) => x.cand.region !== y.cand.region)))) : maxOverlap(fps)
  const same = maxOverlap(fps, (x, y) => x.cand.region === y.cand.region)
  const overlap = cross
  ctx.trace?.add('select', 'decision', `Worst overlap of top items across regions: ${(cross * 100).toFixed(0)}% (target ≤ 30%); within a region (age bands): ${(same * 100).toFixed(0)}%`)

  const themeSets = fps.map((f) => new Set(f.themes.map((t) => t.qlooId)))
  const ids = new Set<string>()
  const segments = await Promise.all(
    fps.map(async (fp, i) => {
      const others = items.filter((_, j) => j !== i).flat()
      const apart = (await setsApart(items[i].map((x) => x.qlooId), others.map((x) => x.qlooId), ctx).catch(() => [])).filter(
        (t, k, all) => !isSensitiveTag(t.name) && all.findIndex((u) => u.name.toLowerCase() === t.name.toLowerCase()) === k,
      )
      // The brief's own interest tags are shared by every cell, so they explain nothing about this one.
      const themes = fp.themes.filter((t) => !isSensitiveTag(t.name) && !fp.cand.signals.tagIds.includes(t.qlooId)).filter((t) => themeSets.filter((s, j) => j !== i && s.has(t.qlooId)).length < (fps.length - 1) / 2).slice(0, 5)
      let id = fp.cand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      while (ids.has(id)) id += '-2'
      ids.add(id)
      const s = fp.cand.signals
      const definedBy = [
        fp.cand.region ?? s.locationQuery,
        fp.cand.ageBand ?? s.ageBuckets?.map((a) => AGE[a]).join(', '),
        s.gender,
        ...[...s.tagIds, ...s.audienceIds].map((t) => reg.names.get(t) ?? t),
        ...s.entityIds.map((e) => `fans of ${reg.names.get(e) ?? e}`),
      ].filter((x): x is string => !!x)
      const segment: Segment = {
        id,
        name: fp.cand.name,
        definedBy,
        signals: s,
        region: fp.cand.region,
        ageBand: fp.cand.ageBand,
        confidence: fp.thin ? 'thin' : fp.cand.broadened ? 'broadened' : 'normal',
        confidenceNote: fp.thin ? 'Qloo returned little taste data for this audience' : fp.cand.broadened,
        fingerprint: items[i],
        themes,
        setsApart: apart,
      }
      return segment
    }),
  )
  return { segments, overlap }
}
