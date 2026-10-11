// CrowdCraft CLI (spec.md > Interfaces). `npm run cc -- <command>`.
import { readFile } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { ARMS, Arm, Fixture, Verdict, type Run, type TraceEvent } from './contracts.ts'
import { judge } from './engine/judge.ts'
import { assembleRun, judgeAll, writeRun } from './engine/run.ts'
import { loadEvalAds, runEval, scoreEval } from './eval/harness.ts'
import { gradeWithClaude, generateJson, MODEL, runAgent } from './llm.ts'
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
  const fixturePath = flag('fixture')
  if (!fixturePath) throw new Error('Usage: npm run cc -- run --fixture <file.json>  (brief and Qloo runs arrive in later slices)')
  const arms = (flag('arms')?.split(',') ?? ARMS).map((a) => Arm.parse(a))
  const fx = Fixture.parse(JSON.parse(await readFile(fixturePath, 'utf8')))
  const trace = new Trace()
  trace.log = progress
  const errors: Run['errors'] = []
  console.log(`Judging ${fx.segments.length} segments × ${arms.length} arms with ${MODEL}…`)
  const reviews = await judgeAll(fx.brief, fx.segments, fx.references, arms, trace, errors)
  const run = assembleRun(fx.brief, fx.segments, fx.references, reviews, trace, errors)
  const report = await writeRun(run)
  console.log(`\n${run.verdictLine}\n$${run.usage.costUsd.toFixed(4)} · ${(run.usage.ms / 1000).toFixed(1)}s\nReport: ${report}`)
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

const commands: Record<string, () => Promise<void>> = { run: cmdRun, eval: cmdEval, selfcheck: cmdSelfcheck }
const cmd = commands[args[0]]
if (!cmd) {
  console.log('Commands: run --fixture <file> [--arms a,b] | eval [--ads ids] [--arms a,b] [--reps n] | eval score <dir> | selfcheck')
  process.exitCode = 1
} else {
  cmd().catch((e) => {
    console.error(`✗ ${(e as Error).message}`)
    process.exitCode = 1
  })
}
