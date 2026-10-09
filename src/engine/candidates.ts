// Segments as buyable cells (spec.md > D4b): the agent proposes taste-diverse regions inside the market; code keeps the
// most different ones and crosses them with age bands from the brief. Qloo taste then explains each cell.
import { z } from 'zod'
import { AGE_BUCKETS, type AgeBucket, type Brief, type QlooSignals } from '../contracts.ts'
import { runAgent } from '../llm.ts'
import { locality, topEntities, type Ctx } from '../qloo/client.ts'
import { qlooTools, type ToolRegistry } from '../qloo/tools.ts'
import { POLICY } from './brief.ts'
import { greedySelect, jaccard } from './select.ts'

export type Candidate = { name: string; signals: QlooSignals; broadened: string | null; region: string | null; ageBand: string | null }
export type Region = { query: string; label: string }

const MAX_CELLS = 6

const RANGE: Record<AgeBucket, [number, number]> = {
  '24_and_younger': [18, 24], '25_to_29': [25, 29], '30_to_34': [30, 34], '35_to_44': [35, 44], '45_to_54': [45, 54], '55_and_older': [55, 99],
}
export const ageLabel = (b: AgeBucket[]) => {
  const lo = Math.min(...b.map((x) => RANGE[x][0]))
  const hi = Math.max(...b.map((x) => RANGE[x][1]))
  return hi === 99 ? `${lo}+` : lo === 18 ? `under ${hi + 1}` : `${lo}-${hi}`
}

// Split the target's age buckets into `n` contiguous bands (no target ages: 18-34 and 35-54).
export function ageBands(buckets: AgeBucket[] | null, n: number): AgeBucket[][] {
  const all = buckets?.length ? AGE_BUCKETS.filter((b) => buckets.includes(b)) : null
  if (!all) return ([['24_and_younger', '25_to_29', '30_to_34'], ['35_to_44', '45_to_54']] as AgeBucket[][]).slice(0, Math.max(n, 1))
  const k = Math.min(n, all.length)
  const size = Math.ceil(all.length / k)
  return Array.from({ length: k }, (_, i) => all.slice(i * size, (i + 1) * size)).filter((b) => b.length)
}

const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}
// "Austin, Travis County, Texas, United States" → "Austin, TX"; "Toronto, Ontario, Canada" → "Toronto, Canada".
export function regionLabel(disambiguation: string): string {
  const parts = disambiguation.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? disambiguation
  const country = parts.at(-1)!
  if (/united states/i.test(country)) {
    const state = parts.slice(1, -1).find((p) => STATES[p])
    return state ? `${parts[0]}, ${STATES[state]}` : parts[0]
  }
  return `${parts[0]}, ${country}`
}

const Out = z.object({
  regions: z.array(z.object({ locationQuery: z.string(), why: z.string().describe("How this place's taste likely differs from the others") })),
})

// The agent proposes 6–8 verified regions inside the market whose taste likely differs for this target.
export async function proposeRegions(brief: Brief, understanding: string, ctx: Ctx, reg: ToolRegistry): Promise<Region[]> {
  const { result, steps } = await runAgent({
    system: `You choose places to test an ad in: regions inside the advertiser's market where this audience's taste likely differs. ${POLICY}`,
    prompt: `The target: ${understanding}
Market: ${JSON.stringify(brief.market)}

Propose 6 to 8 cities or metro areas inside this market where people in the target probably like different things (different scenes, sizes and parts of the country). Verify every one with check_locality and use only places that resolve. Then call finish.`,
    tools: { check_locality: qlooTools({ ...ctx, stage: 'candidates' }, reg, { allowedCommunities: [] }).check_locality },
    output: Out,
    maxSteps: 14,
    trace: ctx.trace,
    label: 'Agent proposes regions to test in',
  })
  // Resolve every proposal in code too (the agent's checked spelling may differ from what it returns; cached calls).
  const resolved = await Promise.all(
    result.regions.map(async (r) => {
      const display = reg.localities.get(r.locationQuery.toLowerCase()) ?? (await locality(r.locationQuery, { ...ctx, stage: 'candidates' }))?.name
      return display ? { query: r.locationQuery, label: regionLabel(display) } : null
    }),
  )
  const dropped = result.regions.filter((_, i) => !resolved[i]).map((r) => r.locationQuery)
  if (dropped.length) ctx.trace?.add('candidates', 'warning', `Not found in Qloo, skipped: ${dropped.join(', ')}`)
  const regions = resolved.filter((r): r is Region => !!r).filter((r, i, all) => all.findIndex((x) => x.label === r.label) === i)
  ctx.trace?.add('candidates', 'decision', `Proposed ${regions.length} regions: ${regions.map((r) => r.label).join(', ')}`, { steps })
  return regions
}

// Keep the regions whose taste differs most (top artists and brands for the whole target), then cross with age bands.
export async function buildCells(brief: Brief, base: QlooSignals, regions: Region[], ctx: Ctx, select = true): Promise<Candidate[]> {
  const bands = ageBands(brief.target.ageBuckets, regions.length <= 1 ? 4 : 2)
  let kept = regions
  if (select && regions.length > 1) {
    const maxRegions = Math.max(2, Math.floor(MAX_CELLS / bands.length))
    const c = { ...ctx, stage: 'candidates' as const }
    const lists = await Promise.all(
      regions.map(async (r) => {
        const s: QlooSignals = { ...base, locationQuery: r.query, locationId: null, ageBuckets: brief.target.ageBuckets }
        const [a, b] = await Promise.all([topEntities('artist', s, 15, c), topEntities('brand', s, 15, c)])
        return [...a, ...b].map((x) => x.qlooId)
      }),
    )
    const dist = lists.map((a) => lists.map((b) => (a === b ? 0 : 1 - jaccard(a, b))))
    const idx = greedySelect(dist, lists.map((l) => l.length), { max: maxRegions, min: 2, stopAt: 0.15 })
    kept = idx.map((i) => regions[i])
    ctx.trace?.add('candidates', 'decision', `Kept the ${kept.length} regions whose taste differs most: ${kept.map((r) => r.label).join(', ')}`)
  }
  ctx.trace?.add('candidates', 'decision', `Age bands: ${bands.map(ageLabel).join(', ')}`)
  return kept.flatMap((r) =>
    bands.map((band) => ({
      name: `${r.label} · ${ageLabel(band)}`,
      signals: { ...base, locationQuery: r.query, locationId: null, ageBuckets: band, gender: brief.target.gender },
      broadened: null,
      region: r.label,
      ageBand: ageLabel(band),
    })),
  )
}
