// Candidates stage (spec.md > Candidates stage): the agent proposes 6–8 candidate segments inside the brief,
// varying taste first, then place, then age; it probes density and broadens thin ones.
import { z } from 'zod'
import { AgeBucket, type Brief, type QlooSignals } from '../contracts.ts'
import { runAgent } from '../llm.ts'
import type { Ctx } from '../qloo/client.ts'
import { keepKnownIds, qlooTools, type ToolRegistry } from '../qloo/tools.ts'
import { POLICY } from './brief.ts'

export type Candidate = { name: string; signals: QlooSignals; broadened: string | null }

const Out = z.object({
  candidates: z.array(
    z.object({
      name: z.string().describe('Specific: place, taste and age, e.g. "Austin indie-music fans, 25-34". No stereotype labels.'),
      locationQuery: z.string().nullable(),
      ageBuckets: z.array(AgeBucket).nullable(),
      gender: z.enum(['male', 'female']).nullable(),
      audienceIds: z.array(z.string()),
      tagIds: z.array(z.string()),
      entityIds: z.array(z.string()),
      broadened: z.string().nullable().describe('If you broadened this candidate because data was thin, say how; otherwise null.'),
    }),
  ),
})

export async function proposeCandidates(brief: Brief, base: QlooSignals, understanding: string, ctx: Ctx, reg: ToolRegistry): Promise<Candidate[]> {
  const name = (ids: string[]) => ids.map((id) => `${reg.names.get(id) ?? id} [${id}]`).join(', ') || 'none'
  const { result, steps } = await runAgent({
    system: `You design audience segments for testing an ad: sub-crowds inside the advertiser's target that differ in taste. ${POLICY}`,
    prompt: `The target: ${understanding}
Market: ${JSON.stringify(brief.market)}. Target ages: ${base.ageBuckets?.join(', ') ?? 'any'}. Gender: ${base.gender ?? 'everyone'}.
Base signals: location ${base.locationQuery ?? 'none (whole market)'}; tags ${name(base.tagIds)}; audiences ${name(base.audienceIds)}; fans of ${name(base.entityIds)}.

Propose 6 to 8 candidate segments that stay inside the target and the market, and differ as much as possible in taste:
1. Vary taste first: give each candidate its OWN taste anchor (a genre, scene, interest or "fans of" artist/brand) within or right next to the target's interests (find_tags, find_audiences, find_entities). Do not add the same generic tags (e.g. "Live Music") to every candidate: shared tags make the crowds look alike.
2. Then vary place: different cities within the market (verify with check_locality).
3. Then vary age, only within the target's age range.
4. Gender only if the brief asks for it.
Use probe_density on candidates you are unsure about (at most 6 probes). If one is thin, broaden it (drop the age band or use a bigger place) and say so in "broadened".
Use only IDs returned by your tools. Then call finish.`,
    tools: qlooTools({ ...ctx, stage: 'candidates' }, reg, { allowedCommunities: brief.target.communities }),
    output: Out,
    maxSteps: 24,
    trace: ctx.trace,
    label: 'Agent proposes candidate segments',
  })
  const out: Candidate[] = []
  for (const raw of result.candidates) {
    const c = clampToBrief(raw, brief, ctx)
    if (!c) continue
    const { signals, dropped } = keepKnownIds({ ...c, locationId: null }, reg)
    if (dropped.length) ctx.trace?.add('candidates', 'warning', `${c.name}: dropped ${dropped.length} invented IDs`, { dropped })
    const hasTaste = signals.tagIds.length + signals.audienceIds.length + signals.entityIds.length > 0
    if (!hasTaste && !signals.locationQuery) {
      ctx.trace?.add('candidates', 'warning', `${c.name}: dropped, no valid signals left`)
      continue
    }
    if (c.broadened) ctx.trace?.add('candidates', 'decision', `${c.name}: broadened (${c.broadened})`)
    out.push({ name: c.name, signals, broadened: c.broadened })
  }
  ctx.trace?.add('candidates', 'decision', `Proposed ${out.length} candidate segments`, { steps, names: out.map((c) => c.name) })
  return out
}

// Hard limits from the brief (prd.md > Segment: "never outside the brief's constraints"), whatever the agent proposed.
// Returns null when the candidate falls entirely outside the brief's ages.
const RANGE: Record<AgeBucket, [number, number]> = {
  '24_and_younger': [18, 24], '25_to_29': [25, 29], '30_to_34': [30, 34], '35_to_44': [35, 44], '45_to_54': [45, 54], '55_and_older': [55, 99],
}
export const ageLabel = (b: AgeBucket[]) => {
  const lo = Math.min(...b.map((x) => RANGE[x][0]))
  const hi = Math.max(...b.map((x) => RANGE[x][1]))
  return hi === 99 ? `${lo}+` : lo === 18 ? `under ${hi + 1}` : `${lo}-${hi}`
}

export function clampToBrief<T extends { name: string; ageBuckets: AgeBucket[] | null; gender: 'male' | 'female' | null }>(c: T, brief: Brief, ctx: Ctx): T | null {
  const allowed = brief.target.ageBuckets
  const gender = brief.target.gender ?? null
  if (!allowed?.length || !c.ageBuckets) return { ...c, ageBuckets: c.ageBuckets ?? allowed ?? null, gender }
  const inside = c.ageBuckets.filter((a) => allowed.includes(a))
  if (!inside.length) {
    ctx.trace?.add('candidates', 'decision', `${c.name}: dropped, outside the brief's ages`)
    return null
  }
  if (inside.length === c.ageBuckets.length) return { ...c, gender }
  const label = ageLabel(inside)
  const name = /(\d+\s*[-–]\s*\d+|under \d+|\d+\+)/i.test(c.name) ? c.name.replace(/(\d+\s*[-–]\s*\d+|under \d+|\d+\+)/i, label) : `${c.name}, ${label}`
  ctx.trace?.add('candidates', 'decision', `${c.name}: ages clamped to the brief's range → ${name}`)
  return { ...c, name, ageBuckets: inside, gender }
}
