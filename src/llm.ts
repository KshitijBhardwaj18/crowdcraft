// The single entry for model calls (spec.md > D3). Muse via the AI SDK's openai-compatible provider.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, hasToolCall, Output, stepCountIs, tool, type ToolSet } from 'ai'
import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { limiter, type Trace } from './trace.ts'

export const MODEL = process.env.MUSE_MODEL ?? 'muse-spark-1.3-contributor'
// Contributor-tier prices per million tokens (spec.md > Meta Model API).
const PRICE_IN = 0.1
const PRICE_OUT = 0.2

const muse = createOpenAICompatible({
  name: 'meta',
  baseURL: 'https://api.meta.ai/v1',
  apiKey: process.env.META_API_KEY,
  supportsStructuredOutputs: true,
})

// ponytail: one global gate (8 in flight, ≥750ms between starts ≈ 80/min); an agent loop counts as one start.
const gate = limiter(8, 750)

type Effort = 'minimal' | 'low' | 'medium' | 'high'
type CallOpts = { system: string; prompt: string; temperature?: number; effort?: Effort; trace?: Trace; label?: string }

function meter(trace: Trace | undefined, label: string, u: { inputTokens?: number; outputTokens?: number }, steps = 1) {
  if (!trace) return
  const tin = u.inputTokens ?? 0
  const tout = u.outputTokens ?? 0
  trace.usage.llmCalls += steps
  trace.usage.tokensIn += tin
  trace.usage.tokensOut += tout
  trace.usage.costUsd += (tin * PRICE_IN + tout * PRICE_OUT) / 1e6
  trace.add('judge', 'llm_call', label, { model: MODEL, tokensIn: tin, tokensOut: tout, steps })
}

const providerOptions = (effort: Effort) => ({ meta: { reasoningEffort: effort, strictJsonSchema: true } })

export async function generateJson<T>(schema: z.ZodType<T>, o: CallOpts): Promise<T> {
  const r = await gate(() =>
    generateText({
      model: muse(MODEL),
      system: o.system,
      prompt: o.prompt,
      temperature: o.temperature ?? 0.2,
      output: Output.object({ schema }),
      providerOptions: providerOptions(o.effort ?? 'low'),
      maxRetries: 3,
    }),
  )
  meter(o.trace, o.label ?? 'LLM call', r.usage)
  return r.output as T
}

// Tool loop that ends when the model calls `finish` (whose input is the stage's output contract).
// Muse only supports tool_choice "auto", so if it stops without finishing, one structured call converts its last text.
export async function runAgent<T>(
  o: CallOpts & { tools: ToolSet; output: z.ZodType<T>; maxSteps?: number },
): Promise<{ result: T; steps: number; finished: boolean }> {
  const finish = tool({ description: 'Call exactly once, with your final answer, when you are done.', inputSchema: o.output, strict: true })
  const r = await gate(() =>
    generateText({
      model: muse(MODEL),
      system: o.system,
      prompt: o.prompt,
      temperature: o.temperature ?? 0.3,
      tools: { ...o.tools, finish },
      stopWhen: [hasToolCall('finish'), stepCountIs(o.maxSteps ?? 12)],
      providerOptions: providerOptions(o.effort ?? 'low'),
      maxRetries: 3,
    }),
  )
  meter(o.trace, o.label ?? 'Agent run', r.totalUsage, r.steps.length)
  const call = r.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === 'finish')
  const parsed = call ? o.output.safeParse(call.input) : null
  if (parsed?.success) return { result: parsed.data, steps: r.steps.length, finished: true }
  // No finish, or an answer that doesn't fit the contract: one schema-locked call repairs it from the tool results.
  const transcript = r.steps
    .flatMap((s) => s.toolResults.filter((t) => t.toolName !== 'finish').map((t) => `${t.toolName}(${JSON.stringify(t.input)}) → ${JSON.stringify(t.output)}`))
    .join('\n')
    .slice(-12000)
  const problem = parsed ? `Your finish answer did not fit the required format: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}\nYour answer was: ${JSON.stringify(call!.input)}` : `You stopped without calling finish. Your last message: ${r.text}`
  o.trace?.add('judge', 'warning', `${o.label ?? 'Agent run'}: repairing the final answer`, { problem: problem.slice(0, 500) })
  const result = await generateJson(o.output, {
    ...o,
    prompt: `${o.prompt}\n\nTool results so far:\n${transcript}\n\n${problem}\n\nReturn your final answer now, using only IDs from the tool results.`,
    label: `${o.label ?? 'Agent run'} (final answer)`,
  })
  return { result, steps: r.steps.length, finished: false }
}

// The eval grader (spec.md > D3): Claude via `claude -p`, run from an empty directory with project-only settings,
// so no global CLAUDE.md, hooks or plugins reach it (verified in slice 2).

const GRADER_MODEL = process.env.GRADER_MODEL ?? 'sonnet'
const graderGate = limiter(3)
let graderDir: Promise<string> | null = null

export async function gradeWithClaude<T>(schema: z.ZodType<T>, system: string, prompt: string): Promise<T> {
  graderDir ??= mkdtemp(path.join(tmpdir(), 'crowdcraft-grader-'))
  const cwd = await graderDir
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) // claude -p rejects zod's draft-2020-12 $schema stamp
  const args = [
    '-p', prompt,
    '--model', GRADER_MODEL,
    '--system-prompt', system,
    '--setting-sources', 'project',
    '--tools', '',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(jsonSchema),
  ]
  const stdout = await graderGate(
    () =>
      new Promise<string>((resolve, reject) =>
        execFile('claude', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 300_000 }, (err, out, errOut) =>
          err ? reject(new Error(`claude -p failed: ${errOut || err.message}`)) : resolve(out),
        ).stdin?.end(), // no stdin, or claude waits 3s for it
      ),
  )
  const res = JSON.parse(stdout)
  if (res.is_error || !res.structured_output) throw new Error(`claude -p returned no structured output: ${String(res.result).slice(0, 200)}`)
  return schema.parse(res.structured_output)
}
