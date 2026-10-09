// Brief stage (spec.md > Brief stage): the brief's target → verified Qloo signals, via an agent with lookup tools.
import { z } from 'zod'
import { AgeBucket, type Brief, type QlooSignals } from '../contracts.ts'
import { runAgent } from '../llm.ts'
import type { Ctx } from '../qloo/client.ts'
import { keepKnownIds, qlooTools, type ToolRegistry } from '../qloo/tools.ts'

export const POLICY = `Never infer or use ethnicity, race, religion, sexuality or political views, and never split on them. Culture comes through taste (artists, brands, places, genres), not identity labels. A community is allowed only if the brief names it explicitly.`

const BaseOut = z.object({
  locationQuery: z.string().nullable(),
  ageBuckets: z.array(AgeBucket).nullable(),
  gender: z.enum(['male', 'female']).nullable(),
  audienceIds: z.array(z.string()),
  tagIds: z.array(z.string()),
  entityIds: z.array(z.string()),
  understanding: z.string().describe('One plain-English sentence: how you understood the audience.'),
})

export async function briefToSignals(brief: Brief, ctx: Ctx, reg: ToolRegistry): Promise<{ signals: QlooSignals; understanding: string }> {
  const { result, steps } = await runAgent({
    system: `You translate an ad brief's target audience into Qloo signals, using only IDs returned by your tools. ${POLICY}`,
    prompt: `Brief:
Market: ${JSON.stringify(brief.market)}
Target audience: ${JSON.stringify(brief.target)}
Advertiser: ${brief.brandLine ?? 'not given'}

Steps:
1. Location: if the market names a city or region, verify it with check_locality and use it as locationQuery; if it is only a country, use null.
2. Ages: use the target's age buckets (null if none).
3. Gender: only if the brief explicitly asks for one; otherwise null.
4. Interests: use find_tags, find_audiences and find_entities to find 1 to 3 IDs that best capture the target's tastes and interests.
Then call finish.`,
    tools: qlooTools({ ...ctx, stage: 'signals' }, reg, { allowedCommunities: brief.target.communities }),
    output: BaseOut,
    maxSteps: 10,
    trace: ctx.trace,
    label: 'Agent maps the brief to Qloo signals',
  })
  const { signals, dropped } = keepKnownIds({ ...result, locationId: null }, reg)
  if (dropped.length) ctx.trace?.add('signals', 'warning', `Dropped ${dropped.length} IDs the tools never returned`, { dropped })
  ctx.trace?.add('signals', 'decision', `Understood the audience as: ${result.understanding}`, { steps, signals })
  return { signals, understanding: result.understanding }
}
