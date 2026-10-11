// Run orchestration (spec.md > Run orchestrator and trace): stages → Run → runs/<id>/run.json + report.html.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Run, type Arm, type Brief, type Reference, type Review, type Segment, type TraceEvent } from '../contracts.ts'
import { renderReport } from '../report/render.ts'
import type { Trace } from '../trace.ts'
import { newRegistry } from '../qloo/tools.ts'
import { briefToSignals } from './brief.ts'
import { stageCache } from './cache.ts'
import { buildCells, proposeRegions, regionLabel } from './candidates.ts'
import { fingerprint } from './fingerprints.ts'
import { judge, verdictLine } from './judge.ts'
import { describeSegments } from './select.ts'
import { summarize } from './summary.ts'
import { locality } from '../qloo/client.ts'

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

// Brief → segments (prd.md > Agent Flow steps 1–5). Cached by the brief's market and target, so the same target keeps
// the same segments across runs (and ad edits) and spends no Qloo calls; the original trace is replayed.
export async function buildSegments(brief: Brief, trace: Trace, noCache = false): Promise<{ segments: Segment[]; overlap: number }> {
  const key = { v: 3, market: brief.market, target: brief.target, brandLine: brief.brandLine }
  const start = trace.events.length
  const { value, cached } = await stageCache(
    'segments',
    key,
    async () => {
      const ctx = { trace }
      const reg = newRegistry()
      const { signals, understanding } = await briefToSignals(brief, ctx, reg)
      const city = brief.market.city
      const regions = city
        ? [{ query: city, label: regionLabel((await locality(city, { ...ctx, stage: 'candidates' }))?.name ?? city) }]
        : await proposeRegions(brief, understanding, ctx, reg)
      if (!regions.length) throw new Error('No regions in this market resolved in Qloo; try naming cities in the brief.')
      const cells = await buildCells(brief, signals, regions, ctx)
      const fps = await Promise.all(cells.map((c) => fingerprint(c, ctx)))
      const { segments, overlap } = await describeSegments(fps, ctx, reg)
      return { segments, overlap, events: trace.events.slice(start) as TraceEvent[] }
    },
    noCache,
  )
  if (cached) {
    for (const e of value.events) trace.add(e.stage, e.kind, e.message, e.detail)
    trace.add('select', 'decision', 'Reused the segments built earlier for this exact target (cached; no Qloo calls)')
  }
  return { segments: value.segments, overlap: value.overlap }
}

// The "What to do" step, only when the Qloo-grounded arm ran. A failure is recorded, never fatal.
export async function summaryFor(brief: Brief, segments: Segment[], reviews: Review[], trace: Trace, errors: Run['errors']) {
  if (!reviews.some((r) => r.arm === 'crowdcraft')) return null
  try {
    return await summarize(brief, segments, reviews, trace)
  } catch (e) {
    errors.push({ stage: 'report', message: `Summary failed: ${(e as Error).message}` })
    return null
  }
}
