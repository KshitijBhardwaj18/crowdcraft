// Run orchestration (spec.md > Run orchestrator and trace): stages → Run → runs/<id>/run.json + report.html.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Run, type Arm, type Brief, type Reference, type Review, type Segment, type TraceEvent } from '../contracts.ts'
import { renderReport } from '../report/render.ts'
import type { Trace } from '../trace.ts'
import { newRegistry } from '../qloo/tools.ts'
import { briefToSignals } from './brief.ts'
import { stageCache } from './cache.ts'
import { buildCells, proposeRegions, regionLabel, type Region } from './candidates.ts'
import { metroHeat, pickRegions } from './heat.ts'
import { isScoredEntity, resolveReferences, scoreReferences } from './references.ts'
import { fingerprint } from './fingerprints.ts'
import { judge, verdictLine } from './judge.ts'
import { describeSegments } from './select.ts'
import { summarize } from './summary.ts'
import { betterVersions, targetingFor } from './deliverables.ts'
import { heatmap, locality } from '../qloo/client.ts'

export async function judgeAll(
  brief: Brief,
  segments: Segment[],
  refs: Reference[],
  arms: Arm[],
  trace: Trace,
  errors: Run['errors'],
): Promise<Review[]> {
  const jobs = segments.flatMap((seg) =>
    arms.map(async (arm) => {
      try {
        return await judge(arm, brief, seg, refs, trace)
      } catch (e) {
        const message = `${arm} review for ${seg.name} failed: ${(e as Error).message}`
        errors.push({ stage: 'judge', message })
        trace.add('judge', 'error', message)
        return null
      }
    }),
  )
  return (await Promise.all(jobs)).filter((r): r is Review => !!r)
}

export function assembleRun(
  brief: Brief,
  segments: Segment[],
  references: Reference[],
  reviews: Review[],
  trace: Trace,
  errors: Run['errors'],
  summary: Run['summary'] = null,
  heat: Run['heat'] = null,
  targeting: Run['targeting'] = null,
  versions: Run['versions'] = [],
): Run {
  const main = reviews.filter((r) => r.arm === 'crowdcraft')
  const run: Run = {
    schemaVersion: 1,
    id: runId(brief),
    createdAt: new Date().toISOString(),
    brief,
    segments,
    references,
    reviews,
    verdictLine: verdictLine(main.length ? main : reviews.filter((r) => r.arm === reviews[0]?.arm), segments),
    summary,
    heat,
    targeting,
    versions,
    trace: trace.events,
    usage: trace.finish().usage,
    errors,
  }
  return Run.parse(run)
}

export async function writeRun(run: Run, dir = 'runs'): Promise<string> {
  const out = path.join(dir, run.id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'run.json'), JSON.stringify(run, null, 2))
  await writeFile(path.join(out, 'report.html'), renderReport(run))
  return path.join(out, 'report.html')
}

function runId(brief: Brief) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const slug = (brief.brandLine ?? brief.adText)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
  return `${stamp}-${slug}`
}

// Brief → references → regions → segments → reference fit (prd.md > Agent Flow). Regions come from data: the Qloo heatmap
// of the ad's references (2 hottest metros + the coolest big metro), or the brief's city; the regions agent is the fallback.
// Each stage is cached, so re-runs and unchanged references cost no Qloo calls; the original trace is replayed.
export type Built = { segments: Segment[]; references: Reference[]; heat: Run['heat']; overlap: number }

export async function buildSegments(brief: Brief, trace: Trace, noCache = false): Promise<Built> {
  const ctx = { trace }
  const reg = newRegistry()
  const replay = async <T extends object>(stage: string, key: unknown, fn: () => Promise<T>, keep?: (v: T) => boolean) => {
    const start = trace.events.length
    const { value, cached } = await stageCache(
      stage,
      key,
      async () => ({ ...(await fn()), events: trace.events.slice(start) as TraceEvent[] }),
      noCache,
      keep as ((v: T & { events: TraceEvent[] }) => boolean) | undefined,
    )
    if (cached) {
      // Replayed events are labelled, so the trace never claims calls this run didn't make.
      for (const e of value.events) trace.add(e.stage, e.kind, e.kind === 'qloo_call' || e.kind === 'llm_call' ? `${e.message} (replayed from cache)` : e.message, e.detail)
      trace.add(e0(stage), 'decision', `Reused cached ${stage} for this exact input (no Qloo calls)`)
    }
    return value
  }
  const e0 = (stage: string) => (stage === 'references' ? 'references' : 'select') as TraceEvent['stage']

  if (!/^(us|usa|united states)/i.test(brief.market.country)) {
    trace.add('candidates', 'warning', `Market ${brief.market.country}: M1 is tuned for the US; check the coverage probe for this market before trusting results`)
    console.log(`! Market ${brief.market.country}: M1 is tuned for the US; see the coverage probe (npm run cc -- probe).`)
  }
  // A failure finding references never stops the run: judging falls back to taste only (prd.md > States and Edge Cases).
  const refsStage = await replay(
    'references',
    { v: 3, ad: brief.adText, brand: brief.brandLine, city: brief.market.city },
    async () => {
      try {
        return { references: await resolveReferences(brief, ctx), failed: false }
      } catch (e) {
        trace.add('references', 'error', `Finding the ad's references failed (${(e as Error).message.slice(0, 160)}); judging on taste only`)
        return { references: [] as Reference[], failed: true }
      }
    },
    (v) => !v.failed,
  )
  const seeds = refsStage.references.filter((r) => r.qlooId)
  const built = await replay('segments', { v: 4, market: brief.market, target: brief.target, seeds: seeds.map((r) => r.qlooId).sort() }, async () => {
    const { signals, understanding } = await briefToSignals(brief, ctx, reg)
    let heat: Run['heat'] = null
    let regions: Region[] = []
    let chosen = false
    const city = brief.market.city
    const area = brief.market.region ?? (/^(us|usa|united states)$/i.test(brief.market.country) ? 'United States' : null)
    let note: string | null = null
    if (city) {
      const found = await locality(city, { ...ctx, stage: 'candidates' })
      if (!found) {
        note = `"${city}" wasn't found in Qloo, so this taste may be national, not local`
        trace.add('candidates', 'warning', note)
      }
      regions = [{ query: city, label: regionLabel(found?.name ?? city) }]
    } else if (area && /united states|^us/i.test(brief.market.country)) {
      const entityIds = seeds.filter(isScoredEntity).map((r) => r.qlooId!).slice(0, 5)
      const tagIds = entityIds.length ? [] : [...seeds.map((r) => r.qlooId!), ...signals.tagIds].filter((id) => id.startsWith('urn:tag')).slice(0, 5)
      if (entityIds.length || tagIds.length) {
        const points = await heatmap({ entityIds, tagIds }, area, { ...ctx, stage: 'candidates' }).catch((e: Error) => {
          trace.add('candidates', 'warning', `Heatmap unavailable (${e.message.slice(0, 120)}); falling back to the regions agent`)
          return []
        })
        const ranked = metroHeat(points)
        const { hot, cool } = pickRegions(ranked)
        if (hot.length) {
          regions = [...hot, ...(cool ? [cool] : [])].map((m) => ({ query: m.query, label: m.label }))
          chosen = true
          heat = ranked.slice(0, 10).concat(cool && !ranked.slice(0, 10).includes(cool) ? [cool] : []).map((m) => ({
            label: m.label,
            heat: Number(m.heat.toFixed(3)),
            role: hot.includes(m) ? 'hot' : m === cool ? 'cool' : 'other',
          }))
          trace.add('candidates', 'decision', `Heatmap of the ad's ${entityIds.length ? 'references' : 'themes'}: strongest in ${hot.map((m) => `${m.label} (${m.heat.toFixed(2)})`).join(', ')}; weakest big market ${cool ? `${cool.label} (${cool.heat.toFixed(2)})` : 'none'}`)
        }
      }
    }
    if (!regions.length) regions = await proposeRegions(brief, understanding, ctx, reg)
    if (!regions.length) throw new Error('No regions in this market resolved in Qloo; try naming cities in the brief.')
    const cells = await buildCells(brief, signals, regions, ctx, !chosen, note)
    const fps = await Promise.all(cells.map((c) => fingerprint(c, ctx)))
    const { segments, overlap, degraded } = await describeSegments(fps, ctx, reg)
    return { segments, overlap, heat, degraded }
  }, (v) => !v.degraded)
  const references = await scoreReferences(refsStage.references, built.segments, ctx).catch((e: Error) => {
    trace.add('fit', 'error', `Scoring the references failed (${e.message.slice(0, 160)}); judging on taste only`)
    return [] as Reference[]
  })
  return { segments: built.segments, overlap: built.overlap, heat: built.heat, references }
}

// The deliverables, only when the Qloo-grounded arm ran: who to target (code), what to fix (one call), better versions.
// A failure is recorded, never fatal.
export async function deliverablesFor(brief: Brief, segments: Segment[], reviews: Review[], trace: Trace, errors: Run['errors']) {
  const none = { targeting: null, summary: null, versions: [] as Run['versions'] }
  if (!reviews.some((r) => r.arm === 'crowdcraft')) return none
  const targeting = targetingFor(segments, reviews, brief.target.gender)
  let summary: Run['summary'] = null
  try {
    summary = await summarize(brief, segments, reviews, targeting, trace)
    for (const s of targeting.skip) s.reason = summary.skipReasons.find((r) => r.segmentId === s.segmentId)?.reason ?? ''
  } catch (e) {
    errors.push({ stage: 'report', message: `What-to-fix step failed: ${(e as Error).message}` })
  }
  const versions = await betterVersions(brief, segments, reviews, targeting, summary?.fixes.map((f) => f.change) ?? [], trace, errors)
  return { targeting, summary, versions }
}
