// Brief stage (spec.md > Brief stage): the brief's target → verified Qloo signals, via an agent with lookup tools.
import { z } from 'zod'
import { AgeBucket, Channel, type Brief, type QlooSignals } from '../contracts.ts'
import { generateJson, runAgent } from '../llm.ts'
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

// Free text → Brief (prd.md > Brief): the LLM structures it; code checks required fields, language and length.
const Parsed = z.object({
  language: z.string().describe('ISO 639-1 code of the ad text, e.g. "en"'),
  adText: z.string().nullable().describe('The ad itself, copied verbatim (not the brief around it), or null if there is no ad'),
  adType: z.enum(['copy', 'script']),
  channel: Channel,
  brandLine: z.string().nullable().describe('One line: who is advertising what'),
  market: z.object({ country: z.string().nullable(), region: z.string().nullable(), city: z.string().nullable() }),
  target: z.object({
    text: z.string().nullable().describe('Who the ad is for, in plain words'),
    ageBuckets: z.array(AgeBucket).nullable(),
    gender: z.enum(['male', 'female']).nullable(),
    interests: z.array(z.string()),
    communities: z.array(z.string()).describe('Only communities the brief names explicitly as communities'),
  }),
  unused: z.array(z.object({ phrase: z.string(), reason: z.string() })),
})

export type ParsedBrief = { brief: Brief | null; missing: string[]; warnings: string[]; error: string | null }

export async function parseBrief(text: string, trace?: Ctx['trace']): Promise<ParsedBrief> {
  const p = await generateJson(Parsed, {
    system: `You turn a marketer's free-text brief into structured fields. Copy the ad verbatim. ${POLICY}
Ethnicity, race, religion, sexuality or political targeting goes in "unused" with the reason "CrowdCraft never targets or splits by this; describe tastes instead". Anything else you can't map to the fields (e.g. income) also goes in "unused" with a short reason.
Map ages to these buckets: 24_and_younger, 25_to_29, 30_to_34, 35_to_44, 45_to_54, 55_and_older. Channel: reel (Instagram or TikTok), preroll (YouTube), tv, audio (radio or podcast), billboard, social, email, or general.
Market: use the place the brief sets for the campaign or the event (e.g. "runs in Chicago" → country US, city Chicago); if it names no place at all, leave it null. Target: who the brief says it's for; null if it doesn't say. Never invent either.`,
    prompt: text,
    trace,
    label: 'Structure the free-text brief',
  })
  const missing = [!p.adText && 'the ad itself', !p.market.country && 'where it runs (market)', !p.target.text && 'who it is for (target audience)'].filter(
    (x): x is string => !!x,
  )
  if (p.adText && !/^en\b/i.test(p.language)) return { brief: null, missing, warnings: [], error: `M1 judges English ads only (this one looks like "${p.language}").` }
  if (p.adText && p.adText.length > 5000) return { brief: null, missing, warnings: [], error: `The ad is ${p.adText.length} characters; the limit is 5,000.` }
  const warnings = p.adText && p.adText.trim().split(/\s+/).length < 10 ? ['The ad is under 10 words, so reactions will be thin.'] : []
  if (missing.length) return { brief: null, missing, warnings, error: null }
  const brief: Brief = {
    adText: p.adText!,
    adType: p.adType,
    channel: p.channel,
    brandLine: p.brandLine,
    market: { country: p.market.country!, region: p.market.region, city: p.market.city },
    target: { ...p.target, text: p.target.text! },
    unused: p.unused,
  }
  return { brief, missing, warnings, error: null }
}
