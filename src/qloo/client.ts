// Qloo client (spec.md > Qloo client): typed calls, a local cache (never committed), limits, retries, trimming, trace.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgeBucket, EvidenceItem, QlooSignals, TraceEvent } from '../contracts.ts'
import { limiter, type Trace } from '../trace.ts'

const BASE = 'https://hackathon.api.qloo.com'
const CACHE = '.cache/qloo'
// Hackathon key limits (from response headers): 5 requests/second, 10,000/month.
const gate = limiter(4, 220)
export const quota = { monthRemaining: null as number | null, monthLimit: null as number | null }
export const DOMAINS = ['artist', 'brand', 'movie', 'tv_show', 'place', 'podcast'] as const
export type Domain = (typeof DOMAINS)[number]

export type Ctx = { trace?: Trace; stage?: TraceEvent['stage']; noCache?: boolean }
type Params = Record<string, string | number | boolean | null | undefined>

const inflight = new Map<string, Promise<any>>()

export async function qlooGet(p: string, params: Params, ctx: Ctx, what: string): Promise<any> {
  const clean = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, String(v)])
  const qs = new URLSearchParams(clean).toString()
  const key = createHash('sha256').update(`${p}?${qs}`).digest('hex')
  const file = path.join(CACHE, `${key}.json`)
  const t = ctx.trace
  const stage = ctx.stage ?? 'fingerprints'
  if (!ctx.noCache) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'))
      t?.add(stage, 'qloo_call', `${what} (cached)`, { path: p, params: Object.fromEntries(clean) })
      return cached
    } catch {}
  }
  // Identical calls running at the same time share one request (saves quota).
  if (!inflight.has(key)) inflight.set(key, fetchWithRetry(p, qs).finally(() => inflight.delete(key)))
  let body: any
  try {
    body = await inflight.get(key)!
  } catch (e) {
    t?.add(stage, 'error', `${what} failed: ${(e as Error).message.slice(0, 200)}`, { path: p })
    throw e
  }
  if (t) t.usage.qlooCalls++
  t?.add(stage, 'qloo_call', what, { path: p, params: Object.fromEntries(clean), quotaLeft: quota.monthRemaining })
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify(body))
  return body
}

// Retries 429, 5xx and network errors with exponential backoff (honouring Retry-After); 30s timeout per attempt.
async function fetchWithRetry(p: string, qs: string): Promise<any> {
  return gate(async () => {
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetch(`${BASE}${p}?${qs}`, { headers: { 'X-Api-Key': process.env.QLOO_API_KEY ?? '' }, signal: AbortSignal.timeout(30_000) })
      } catch (e) {
        if (attempt < 3) {
          await sleep(1000 * 2 ** attempt)
          continue
        }
        throw new Error(`Qloo ${p} → network error: ${(e as Error).message}`)
      }
      const left = res.headers.get('x-month-ratelimit-remaining')
      const limit = res.headers.get('x-month-ratelimit-limit')
      if (left != null) quota.monthRemaining = Number(left)
      if (limit != null) quota.monthLimit = Number(limit)
      if (res.ok) return res.json()
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const after = Number(res.headers.get('retry-after'))
        await sleep(after > 0 ? after * 1000 : 1000 * 2 ** attempt)
        continue
      }
      if (res.status === 401) throw new Error('Qloo rejected the API key (401). Check QLOO_API_KEY in .env and that it is the hackathon key.')
      throw new Error(`Qloo ${p} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
  })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function signalParams(s: QlooSignals): Params {
  return {
    'signal.location.query': s.locationId ? null : s.locationQuery,
    'signal.location': s.locationId,
    'signal.demographics.age': s.ageBuckets?.slice().sort().join(','),
    'signal.demographics.gender': s.gender,
    'signal.demographics.audiences': s.audienceIds.slice().sort().join(','),
    'signal.interests.tags': s.tagIds.slice().sort().join(','),
    'signal.interests.entities': s.entityIds.slice().sort().join(','),
  }
}

const entityItem = (e: any): EvidenceItem => ({
  qlooId: e.entity_id,
  name: e.name,
  type: e.subtype ?? e.types?.[0] ?? 'urn:entity',
  affinity: e.query?.affinity ?? null,
  imageUrl: e.properties?.image?.url ?? null,
})
const tagItem = (t: any): EvidenceItem => ({
  qlooId: t.tag_id ?? t.id,
  name: t.name,
  type: t.subtype ?? t.type ?? 'urn:tag',
  affinity: t.query?.affinity ?? null,
  imageUrl: null,
})

export async function topEntities(domain: Domain, s: QlooSignals, take: number, ctx: Ctx): Promise<EvidenceItem[]> {
  // The location signal only influences ranking; places must also be filtered to the segment's locality.
  const within = domain === 'place' ? { 'filter.location.query': s.locationId ? null : s.locationQuery, 'filter.location': s.locationId } : {}
  const d = await qlooGet('/v2/insights', { 'filter.type': `urn:entity:${domain}`, ...signalParams(s), ...within, take }, ctx, `Top ${domain}s`)
  return (d.results?.entities ?? []).map(entityItem)
}

export async function topTags(s: QlooSignals, take: number, ctx: Ctx): Promise<EvidenceItem[]> {
  const d = await qlooGet('/v2/insights', { 'filter.type': 'urn:tag', ...signalParams(s), take }, ctx, 'Top themes')
  return (d.results?.tags ?? []).map(tagItem)
}

// Affinity of specific entities for these signals. Qloo omits entities below its cutoff: they come back as null.
export async function fit(domain: string, s: QlooSignals, ids: string[], ctx: Ctx): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(ids.map((id) => [id, null]))
  const sorted = [...new Set(ids)].sort()
  for (let i = 0; i < sorted.length; i += 50) {
    const chunk = sorted.slice(i, i + 50)
    const d = await qlooGet(
      '/v2/insights',
      { 'filter.type': domain.startsWith('urn:') ? domain : `urn:entity:${domain}`, ...signalParams(s), 'filter.results.entities': chunk.join(','), take: chunk.length },
      { ...ctx, stage: ctx.stage ?? 'fit' },
      `Fit of ${chunk.length} ${domain.replace('urn:entity:', '')}s`,
    )
    for (const e of d.results?.entities ?? []) if (out.has(e.entity_id)) out.set(e.entity_id, e.query?.affinity ?? null) // never count IDs we didn't ask about
  }
  return out
}

export type Skew = { age: Record<AgeBucket, number>; gender: { male: number; female: number } }
export async function demographics(entityId: string, ctx: Ctx): Promise<Skew | null> {
  const d = await qlooGet('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': entityId }, { ...ctx, stage: ctx.stage ?? 'fit' }, 'Demographic skew')
  const q = d.results?.demographics?.[0]?.query
  return q?.age && q?.gender ? { age: q.age, gender: q.gender } : null
}

export async function searchEntities(query: string, ctx: Ctx, types?: string[]): Promise<EvidenceItem[]> {
  const d = await qlooGet('/search', { query, types: types?.join(','), take: 5 }, { ...ctx, stage: ctx.stage ?? 'references' }, `Search "${query}"`)
  return (d.results ?? []).map(entityItem)
}

export async function searchTags(query: string, ctx: Ctx): Promise<EvidenceItem[]> {
  const d = await qlooGet('/v2/tags', { 'filter.query': query, take: 5 }, { ...ctx, stage: ctx.stage ?? 'signals' }, `Tag search "${query}"`)
  return (d.results?.tags ?? []).map(tagItem)
}

export async function searchAudiences(query: string, ctx: Ctx): Promise<EvidenceItem[]> {
  const d = await qlooGet('/v2/audiences', { 'filter.query': query, take: 5 }, { ...ctx, stage: ctx.stage ?? 'signals' }, `Audience search "${query}"`)
  return (d.results?.audiences ?? []).map((a: any) => ({ qlooId: a.id, name: a.name, type: a.type, affinity: null, imageUrl: null }))
}

export async function locality(query: string, ctx: Ctx): Promise<{ id: string; name: string } | null> {
  const d = await qlooGet('/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.location.query': query, take: 1 }, { ...ctx, stage: ctx.stage ?? 'signals' }, `Locate "${query}"`).catch(() => null)
  const l = d?.query?.localities?.signal ?? d?.query?.locality?.signal
  return l ? { id: l.entity_id, name: l.disambiguation ?? l.name } : null
}

// Tags that set group A apart from group B (Analysis Compare): A's tags that aren't shared, most frequent first.
export async function setsApart(aIds: string[], bIds: string[], ctx: Ctx, take = 5): Promise<EvidenceItem[]> {
  const d = await qlooGet(
    '/v2/analysis/compare',
    { 'a.signal.interests.entities': aIds.slice(0, 25).join(','), 'b.signal.interests.entities': bIds.slice(0, 25).join(','), take: 50 },
    { ...ctx, stage: ctx.stage ?? 'select' },
    'Compare what sets this crowd apart',
  )
  const shared = new Set((d.results?.tags ?? []).map((t: any) => t.tag_id))
  return (d.results?.a ?? [])
    .filter((t: any) => !shared.has(t.tag_id) && !/:region:|:usa$/.test(t.tag_id))
    .sort((x: any, y: any) => Number(y.query?.count ?? 0) - Number(x.query?.count ?? 0))
    .slice(0, take)
    .map(tagItem)
}

// Heatmap (prd.md > Agent Flow): affinity and popularity per geohash tile (~20–40 km) inside a location.
export type HeatPoint = { lat: number; lon: number; affinity: number; popularity: number }
export async function heatmap(seed: { entityIds: string[]; tagIds: string[] }, locationQuery: string, ctx: Ctx): Promise<HeatPoint[]> {
  const d = await qlooGet(
    '/v2/insights',
    {
      'filter.type': 'urn:heatmap',
      'signal.interests.entities': seed.entityIds.join(','),
      'signal.interests.tags': seed.tagIds.join(','),
      'filter.location.query': locationQuery,
      take: 50,
    },
    { ...ctx, stage: ctx.stage ?? 'candidates' },
    `Heatmap of where the ad's taste is strongest in ${locationQuery}`,
  )
  return (d.results?.heatmap ?? []).map((p: any) => ({
    lat: p.location.latitude,
    lon: p.location.longitude,
    affinity: p.query?.affinity ?? 0,
    popularity: p.query?.popularity ?? 0,
  }))
}
