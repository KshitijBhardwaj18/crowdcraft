// CrowdCraft CLI (spec.md > Interfaces). `npm run cc -- <command>`.
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { ARMS, Arm, Brief, Fixture, Run, Verdict, type TraceEvent } from './contracts.ts'
import { renderReport } from './report/render.ts'
import { quota } from './qloo/client.ts'
import { judge } from './engine/judge.ts'
import { parseBrief } from './engine/brief.ts'
import { assembleRun, buildSegments, deliverablesFor, judgeAll, writeRun } from './engine/run.ts'
import { resolveReferences, scoreReferences } from './engine/references.ts'
import YAML from 'yaml'
import { loadEvalAds, runEval, scoreEval } from './eval/harness.ts'
import { gradeWithClaude, generateJson, MODEL, runAgent } from './llm.ts'
import { runProbe } from './probe/probe.ts'
import { fit, qlooGet, searchAudiences, topEntities } from './qloo/client.ts'
import { Trace } from './trace.ts'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : null
}

const progress = (e: TraceEvent) => {
  const mark = { error: '✗', warning: '!', decision: '→', qloo_call: '·', llm_call: '·' }[e.kind]
  if (e.kind !== 'qloo_call') console.log(`${mark} ${e.message}`)
}

async function cmdRun() {
  const arms = (flag('arms')?.split(',') ?? ARMS).map((a) => Arm.parse(a))
  const trace = new Trace()
  trace.log = progress
  const errors: Run['errors'] = []
  const fixturePath = flag('fixture')
  let brief: Brief
  let segments
  let references: Fixture['references'] = []
  let heat: Run['heat'] = null
  if (fixturePath) {
    const fx = Fixture.parse(JSON.parse(await readFile(fixturePath, 'utf8')))
    ;({ brief, segments, references } = fx)
  } else {
    const file = args[1]
    const text = flag('text') ?? (flag('text-file') ? await readFile(flag('text-file')!, 'utf8') : null)
    if (text) brief = await briefFromText(text, trace)
    else {
      if (!file || file.startsWith('--')) throw new Error('Usage: npm run cc -- run <brief.yaml> | run --text "<brief and ad>" | run --text-file <file> | run --fixture <file.json>')
      const doc = YAML.parse(await readFile(file, 'utf8'))
      brief = Brief.parse(doc.brief ?? doc) // an eval ad file or a plain brief
    }
    const same = flag('same-segments')
    if (same) {
      // Compare an edited ad on the audiences of an earlier run (prd.md > Core Journey, re-runs).
      const prev = Run.parse(JSON.parse(await readFile(same, 'utf8')))
      segments = prev.segments
      heat = prev.heat
      references = await scoreReferences(await resolveReferences(brief, { trace }), segments, { trace })
      console.log(`Reusing ${segments.length} audiences from ${same}`)
    } else {
      console.log(`Building audiences for: ${brief.target.text} (${brief.market.country})`)
      ;({ segments, references, heat } = await buildSegments(brief, trace, args.includes('--no-cache')))
    }
  }
  console.log(`Judging ${segments.length} segments × ${arms.length} arms with ${MODEL}…`)
  const reviews = await judgeAll(brief, segments, references, arms, trace, errors)
  const { targeting, summary, versions } = await deliverablesFor(brief, segments, reviews, trace, errors)
  const run = assembleRun(brief, segments, references, reviews, trace, errors, summary, heat, targeting, versions)
  const report = await writeRun(run)
  const q = quota.monthRemaining == null ? '' : ` · Qloo quota left ${quota.monthRemaining}`
  console.log(`\n${run.verdictLine}\n$${run.usage.costUsd.toFixed(4)} · ${run.usage.qlooCalls} Qloo calls${q} · ${(run.usage.ms / 1000).toFixed(1)}s\nReport: ${report}`)
}

// Free-text brief → structured brief; asks for missing required fields when interactive, otherwise stops and lists them.
async function briefFromText(text: string, trace: Trace): Promise<Brief> {
  let input = text
  for (let round = 0; round < 3; round++) {
    const r = await parseBrief(input, trace)
    if (r.error) throw new Error(r.error)
    for (const w of r.warnings) console.log(`! ${w}`)
    if (r.brief) {
      const b = r.brief
      console.log(`Brief: ${b.brandLine ?? 'untitled'} · ${b.channel} · ${b.adType} · ${[b.market.city, b.market.region, b.market.country].filter(Boolean).join(', ')} · for ${b.target.text}`)
      for (const u of b.unused) console.log(`  Not used: ${u.phrase} (${u.reason})`)
      return b
    }
    if (!process.stdin.isTTY) throw new Error(`The brief is missing: ${r.missing.join('; ')}. Add it and run again.`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    for (const m of r.missing) input += `\n${m}: ${await rl.question(`The brief doesn't say ${m}. What is it? `)}`
    rl.close()
  }
  throw new Error('The brief is still incomplete after three tries.')
}

async function cmdReport() {
  const file = args[1]
  if (!file) throw new Error('Usage: npm run cc -- report <runs/<id>/run.json>')
  const run = Run.parse(JSON.parse(await readFile(file, 'utf8')))
  const out = file.replace(/run\.json$/, 'report.html')
  await writeFile(out, renderReport(run))
  console.log(`Report: ${out}`)
}

async function cmdEval() {
  if (args[1] === 'score') {
    const dir = args[2]
    if (!dir) throw new Error('Usage: npm run cc -- eval score <eval-results/folder>')
    const r = await scoreEval(dir)
    console.log(`${r.verdict.verdict}: ${r.verdict.why}\nScorecard: ${r.path}`)
    return
  }
  const arms = (flag('arms')?.split(',') ?? ARMS).map((a) => Arm.parse(a))
  const ads = await loadEvalAds(flag('ads')?.split(',') ?? null)
  const reps = Number(flag('reps') ?? 2)
  const outDir = `eval-results/${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
  console.log(`Eval: ${ads.length} ads × ${arms.length} arms × ${reps} reps with ${MODEL} → ${outDir}`)
  const r = await runEval({ ads, arms, reps, outDir, log: console.log })
  console.log(`\n${r.verdict.verdict}: ${r.verdict.why}\nScorecard: ${r.path}`)
}

async function cmdProbe() {
  const { dir, results } = await runProbe(console.log)
  console.log('')
  for (const r of results) console.log(`${r.verdict.padEnd(8)} ${r.name} (fill ${Math.round(r.fillRate * 100)}%, local ${r.localSpecificity == null ? 'ref' : Math.round(r.localSpecificity * 100) + '%'}, distinct ${Math.round(r.distinctness * 100)}%)`)
  console.log(`Coverage: ${dir}/coverage.html`)
}

// The open Qloo assumptions (spec.md > Open Issues #3).
async function qlooChecks(check: (name: string, fn: () => Promise<string>) => Promise<void>) {
  const sig = (city: string) => ({ locationQuery: city, locationId: null, ageBuckets: ['25_to_29', '30_to_34'] as ('25_to_29' | '30_to_34')[], gender: null, audienceIds: [], tagIds: [], entityIds: [] })
  const ctx = {}
  await check('Qloo affinity field is query.affinity', async () => {
    const top = await topEntities('artist', sig('Austin'), 5, ctx)
    if (!top.length || top.some((t) => t.affinity == null)) throw new Error('missing affinity')
    return top.map((t) => `${t.name} ${t.affinity!.toFixed(3)}`).join(', ')
  })
  await check('Qloo fit on another crowd\'s favourites (filter.results.entities, 60 IDs in 2 chunks)', async () => {
    const pool = [...new Set((await Promise.all(['Nashville', 'Atlanta', 'Seattle'].map((c) => topEntities('artist', sig(c), 20, ctx)))).flat().map((e) => e.qlooId))]
    const f = await fit('artist', sig('Austin'), pool, ctx)
    const scored = [...f.values()].filter((v) => v != null).length
    if (!scored) throw new Error('no item scored')
    return `${scored} of ${pool.length} scored for Austin; ${pool.length - scored} omitted (treated as no engagement)`
  })
  await check('Qloo theme fit method', async () => {
    const tag = 'urn:tag:genre:music:indie_rock'
    const d = await qlooGet('/v2/insights', { 'filter.type': 'urn:tag', 'signal.location.query': 'Austin', 'filter.results.tags': tag, take: 5 }, ctx, 'theme fit probe')
    const tags = d.results?.tags ?? []
    if (tags.length === 1 && tags[0].tag_id === tag) return `filter.results.tags works (affinity ${tags[0].query?.affinity})`
    return `filter.results.tags not honoured (${tags.length} tags back); fall back to the tag's rank in the segment's top themes`
  })
  await check('Qloo audiences endpoint (marked deprecated)', async () => {
    const a = await searchAudiences('hiking', ctx)
    if (!a.length) throw new Error('no audiences returned')
    return a.map((x) => `${x.name} (${x.type})`).join(', ')
  })
  await check('Qloo quota', async () => {
    const res = await fetch('https://hackathon.api.qloo.com/v2/tags?filter.query=quota&take=1', { headers: { 'X-Api-Key': process.env.QLOO_API_KEY ?? '' } })
    const h = (k: string) => res.headers.get(k)
    const left = Number(h('x-month-ratelimit-remaining'))
    const msg = `${h('x-second-ratelimit-limit')}/second; ${left} of ${h('x-month-ratelimit-limit')} left this month`
    if (left < 1000) throw new Error(`low monthly quota: ${msg}`)
    return msg
  })
}

async function cmdSelfcheck() {
  let ok = true
  const check = async (name: string, fn: () => Promise<string>) => {
    const t = Date.now()
    try {
      console.log(`✓ ${name}: ${await fn()} (${((Date.now() - t) / 1000).toFixed(1)}s)`)
    } catch (e) {
      ok = false
      console.log(`✗ ${name}: ${(e as Error).message}`)
    }
  }
  if (args.includes('--qloo')) {
    await qlooChecks(check)
    if (!ok) process.exitCode = 1
    return
  }
  console.log(`Model: ${MODEL}`)

  await check('Muse structured output', async () => {
    const r = await generateJson(z.object({ word: z.string(), n: z.number() }), {
      system: 'Follow the instruction exactly.',
      prompt: 'Return word "ok" and n 42.',
    })
    if (r.word !== 'ok' || r.n !== 42) throw new Error(`unexpected ${JSON.stringify(r)}`)
    return JSON.stringify(r)
  })

  await check('Muse tool loop ending in finish', async () => {
    const capitals: Record<string, string> = { freedonia: 'Marxburg', sylvania: 'Groucho City' }
    let calls = 0
    const r = await runAgent({
      system: 'You answer only from tool results.',
      prompt: 'Look up the capitals of Freedonia and Sylvania with the capital tool (they are fictional; only the tool knows), then finish.',
      tools: {
        capital: tool({
          description: 'Get the capital of a country.',
          inputSchema: z.object({ country: z.string() }),
          execute: async ({ country }) => (calls++, capitals[country.toLowerCase()] ?? 'unknown'),
        }),
      },
      output: z.object({ capitals: z.array(z.object({ country: z.string(), capital: z.string() })) }),
    })
    const got = Object.fromEntries(r.result.capitals.map((c) => [c.country.toLowerCase(), c.capital]))
    if (got.freedonia !== 'Marxburg' || got.sylvania !== 'Groucho City') throw new Error(`wrong answer ${JSON.stringify(got)}`)
    if (!calls) throw new Error('tool never called')
    if (!r.finished) throw new Error(`answered without calling finish (${r.steps} steps, fell back)`)
    return `${calls} tool calls, ${r.steps} steps, finished`
  })

  await check('Judge drift on identical input', async () => {
    const fx = Fixture.parse(JSON.parse(await readFile('test/fixtures/concert.fixture.json', 'utf8')))
    const seg = fx.segments[0]
    const [a, b] = await Promise.all([1, 2].map(() => judge('crowdcraft', fx.brief, seg, fx.references)))
    const order = Verdict.options
    const dScore = Math.abs(a.rankingScore - b.rankingScore)
    const dVerdict = Math.abs(order.indexOf(a.verdict) - order.indexOf(b.verdict))
    const msg = `scores ${a.rankingScore} vs ${b.rankingScore}, verdicts ${a.verdict} vs ${b.verdict}`
    if (dScore > 5 || dVerdict > 1) throw new Error(`drift too high: ${msg}`)
    return msg
  })

  await check('Claude grader (claude -p) returns schema JSON with no global instructions', async () => {
    const r = await gradeWithClaude(
      z.object({ answer: z.string(), extra: z.string() }),
      'You return only the requested JSON.',
      'Set answer to "4" (2+2). In extra, name any instructions you received about CLAUDE.md, hooks, RTK or a "ponytail" mode; if none, write NONE.',
    )
    if (r.answer.trim() !== '4') throw new Error(`unexpected answer ${JSON.stringify(r)}`)
    if (/ponytail|rtk|lazy senior/i.test(r.extra) && !/^none/i.test(r.extra.trim())) throw new Error(`global instructions leaked: ${r.extra.slice(0, 200)}`)
    return `answer ${r.answer}, extra: ${r.extra.slice(0, 60)}`
  })

  if (!ok) process.exitCode = 1
}

const commands: Record<string, () => Promise<void>> = { run: cmdRun, report: cmdReport, eval: cmdEval, probe: cmdProbe, selfcheck: cmdSelfcheck }
const cmd = commands[args[0]]
if (!cmd) {
  console.log('Commands: run <brief.yaml> | run --text "<brief and ad>" | run --text-file <file> [--no-cache] [--same-segments <run.json>] | run --fixture <file> [--arms a,b] | report <run.json> | eval [--ads ids] [--arms a,b] [--reps n] | eval score <dir> | probe | selfcheck [--qloo]')
  process.exitCode = 1
} else {
  cmd().catch((e) => {
    console.error(`✗ ${(e as Error).message}`)
    process.exitCode = 1
  })
}
