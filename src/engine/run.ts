// Run orchestration (spec.md > Run orchestrator and trace): stages → Run → runs/<id>/run.json + report.html.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Run, type Arm, type Brief, type Reference, type Review, type Segment } from '../contracts.ts'
import { renderReport } from '../report/render.ts'
import type { Trace } from '../trace.ts'
import { judge, verdictLine } from './judge.ts'

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
