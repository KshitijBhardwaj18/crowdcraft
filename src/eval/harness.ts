// Eval harness (spec.md > Eval harness): every eval ad through every arm, twice; grading; blind export; scorecard.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { EvalAd, Run, type Arm, type EvalSegmentSpec, type Segment } from '../contracts.ts'
import { assembleRun, judgeAll, writeRun } from '../engine/run.ts'
import { Trace } from '../trace.ts'
import { exportBlindPairs, readBlindChoices, type PairCandidate } from './blind.ts'
import { gradeSpecificity, type Grade } from './grader.ts'
import { computeMetrics, gradeKey, renderScorecard, type EvalCase } from './metrics.ts'

const AGE_LABEL: Record<string, string> = {
  '24_and_younger': '24 and under', '25_to_29': '25-29', '30_to_34': '30-34', '35_to_44': '35-44', '45_to_54': '45-54', '55_and_older': '55+',
}

// Baseline arms only need the segment's name and definition. Qloo resolution arrives in slice 4.
export function specToSegment(s: EvalSegmentSpec): Segment {
  const definedBy = [s.locationQuery, s.ageBuckets?.map((a) => AGE_LABEL[a]).join(', '), ...s.tagQueries, ...s.entityQueries.map((e) => `fans of ${e}`)]
  return {
    id: s.id, name: s.name, definedBy: definedBy.filter((x): x is string => !!x),
    signals: { locationQuery: s.locationQuery, locationId: null, ageBuckets: s.ageBuckets, gender: s.gender, audienceIds: [], tagIds: [], entityIds: [] },
    confidence: 'normal', confidenceNote: null, fingerprint: [], themes: [], setsApart: [],
  }
}

export async function loadEvalAds(filter: string[] | null, dir = 'eval/ads'): Promise<EvalAd[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort()
  const ads = await Promise.all(files.map(async (f) => EvalAd.parse(YAML.parse(await readFile(path.join(dir, f), 'utf8')))))
  return filter ? ads.filter((a) => filter.some((p) => a.id.startsWith(p))) : ads
}

type State = { createdAt: string; arms: Arm[]; cases: { adId: string; runs: string[] }[]; grades: Record<string, Grade>; costUsd: number; minutes: number }

export async function runEval(o: { ads: EvalAd[]; arms: Arm[]; reps: number; outDir: string; log: (s: string) => void }) {
  const t0 = Date.now()
  const qlooArms = o.arms.filter((a) => a === 'crowdcraft' || a === 'ablation')
  if (qlooArms.length) throw new Error(`Arms ${qlooArms.join(', ')} need Qloo-resolved segments, which arrive in slice 4. Use --arms b1_named,b2_invented for now.`)
  await mkdir(o.outDir, { recursive: true })
  let done = 0
  const total = o.ads.length * o.reps
  const cases: EvalCase[] = await Promise.all(
    o.ads.map(async (ad) => {
      const segments = ad.segments.map(specToSegment)
      const reps = await Promise.all(
        Array.from({ length: o.reps }, async (_, i) => {
          const trace = new Trace()
          const errors: Run['errors'] = []
          const reviews = await judgeAll(ad.brief, segments, [], o.arms, trace, errors)
          const run = { ...assembleRun(ad.brief, segments, [], reviews, trace, errors), id: `${ad.id}-r${i + 1}` }
          const report = await writeRun(run, path.join(o.outDir, 'runs'))
          o.log(`✓ ${ad.id} r${i + 1} (${++done}/${total})${errors.length ? ` with ${errors.length} errors` : ''}`)
          return { run, report }
        }),
      )
      return { ad, runs: reps.map((r) => r.run), reportPaths: reps.map((r) => path.relative(o.outDir, r.report)) }
    }),
  )

  o.log('Grading specificity with Claude…')
  const scored = cases.filter((c) => c.ad.tier !== 'demo')
  const grades = await gradeSpecificity(
    scored.flatMap((c) => c.runs[0].reviews.map((review) => ({ key: gradeKey(c.ad.id, review.segmentId, review.arm), adText: c.ad.brief.adText, review }))),
  )

  const pairArms: [Arm, Arm] = o.arms.includes('crowdcraft') ? ['crowdcraft', bestBaseline(cases, grades, o.arms)] : ['b1_named', 'b2_invented']
  const candidates: PairCandidate[] = scored.flatMap((c) =>
    c.ad.segments.flatMap((s) => {
      const [a, b] = pairArms.map((arm) => c.runs[0].reviews.find((r) => r.arm === arm && r.segmentId === s.id))
      return a && b ? [{ ad: c.ad.id, segment: s.name, a, b }] : []
    }),
  )
  const pairs = await exportBlindPairs(o.outDir, candidates)

  const state: State = {
    createdAt: new Date(t0).toISOString(),
    arms: o.arms,
    cases: cases.map((c) => ({ adId: c.ad.id, runs: c.runs.map((r) => path.join('runs', r.id, 'run.json')) })),
    grades: Object.fromEntries(grades),
    costUsd: cases.flatMap((c) => c.runs).reduce((s, r) => s + r.usage.costUsd, 0),
    minutes: (Date.now() - t0) / 60000,
  }
  await writeFile(path.join(o.outDir, 'eval-state.json'), JSON.stringify(state, null, 2))
  const scorecard = await writeScorecard(o.outDir, state, cases, null)
  o.log(`Exported ${pairs} blind pairs.`)
  return scorecard
}

// Re-score a finished eval, folding in the blind choices (`eval score <dir>`).
export async function scoreEval(dir: string) {
  const state: State = JSON.parse(await readFile(path.join(dir, 'eval-state.json'), 'utf8'))
  const ads = new Map((await loadEvalAds(null)).map((a) => [a.id, a]))
  const cases: EvalCase[] = await Promise.all(
    state.cases.map(async (c) => {
      const runs = await Promise.all(c.runs.map(async (p) => Run.parse(JSON.parse(await readFile(path.join(dir, p), 'utf8')))))
      return { ad: ads.get(c.adId)!, runs, reportPaths: c.runs.map((p) => p.replace(/run\.json$/, 'report.html')) }
    }),
  )
  return writeScorecard(dir, state, cases, await readBlindChoices(dir))
}

async function writeScorecard(dir: string, state: State, cases: EvalCase[], blind: Awaited<ReturnType<typeof readBlindChoices>> | null) {
  const result = computeMetrics(cases, state.arms, new Map(Object.entries(state.grades)), blind)
  await writeFile(path.join(dir, 'scorecard.json'), JSON.stringify({ ...result, createdAt: state.createdAt, arms: state.arms }, null, 2))
  await writeFile(path.join(dir, 'scorecard.html'), renderScorecard(cases, state.arms, result, state))
  return { path: path.join(dir, 'scorecard.html'), ...result }
}

function bestBaseline(cases: EvalCase[], grades: Map<string, Grade>, arms: Arm[]): Arm {
  const spec = (arm: Arm) => {
    const xs = cases.flatMap((c) => c.runs[0].reviews.filter((r) => r.arm === arm).map((r) => grades.get(gradeKey(c.ad.id, r.segmentId, arm))?.specific ?? 0))
    return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
  }
  return (['b1_named', 'b2_invented'] as Arm[]).filter((a) => arms.includes(a)).sort((a, b) => spec(b) - spec(a))[0] ?? 'b1_named'
}
