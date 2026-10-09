// The three deliverables (prd.md > Deliverables): who to target (code), what to fix (summary.ts) and better versions
// (rewrite for a recommended audience with its real taste, resolve the new references, re-judge on that audience).
import { z } from 'zod'
import type { Brief, Reference, Review, Run, Segment, Targeting } from '../contracts.ts'
import { generateJson } from '../llm.ts'
import type { Trace } from '../trace.ts'
import { judge } from './judge.ts'
import { resolveReferences, scoreReferences } from './references.ts'

const RECOMMEND_MIN = 55
const SKIP_BELOW = 45

// Budget ∝ max(score − 40, 5), in 5% steps summing to 100.
export function budgetSplit(scores: number[]): number[] {
  if (!scores.length) return []
  const w = scores.map((s) => Math.max(s - 40, 5))
  const total = w.reduce((a, b) => a + b, 0)
  const pct = w.map((x) => Math.max(5, Math.round(((x / total) * 100) / 5) * 5))
  const diff = 100 - pct.reduce((a, b) => a + b, 0)
  pct[pct.indexOf(Math.max(...pct))] += diff
  return pct
}

// Interest ideas: the audience's most distinctive artists, brands and shows, then its genre themes (no places).
export function interestsFor(seg: Segment, max = 6): string[] {
  const items = seg.fingerprint.filter((f) => /artist|brand|tv_show|movie|podcast/.test(f.type)).sort((a, b) => b.distinctiveness - a.distinctiveness)
  const genres = seg.themes.filter((t) => /^urn:tag:(genre|keyword)/.test(t.qlooId))
  return [...new Set([...items.map((i) => i.name), ...genres.map((g) => g.name)])].slice(0, max)
}

export function targetingFor(segments: Segment[], reviews: Review[], gender: string | null): Targeting {
  const main = reviews.filter((r) => r.arm === 'crowdcraft').sort((a, b) => b.rankingScore - a.rankingScore)
  let picked = main.filter((r) => (r.verdict === 'love' || r.verdict === 'like') && r.rankingScore >= RECOMMEND_MIN).slice(0, 3)
  const weakFit = !picked.length && main.length > 0
  if (weakFit) picked = main.slice(0, 1)
  const split = budgetSplit(picked.map((r) => r.rankingScore))
  const seg = (id: string) => segments.find((s) => s.id === id)!
  return {
    audiences: picked.map((r, i) => ({
      segmentId: r.segmentId,
      location: seg(r.segmentId).region ?? seg(r.segmentId).name,
      age: seg(r.segmentId).ageBand ?? 'any',
      gender,
      interests: interestsFor(seg(r.segmentId)),
      budgetPct: split[i],
      score: r.rankingScore,
      verdict: r.verdict,
    })),
    skip: main.filter((r) => !picked.includes(r) && (r.verdict === 'meh' || r.verdict === 'skip' || r.rankingScore < SKIP_BELOW)).map((r) => ({ segmentId: r.segmentId, reason: '' })),
    weakFit,
  }
}

const Rewrite = z.object({
  adText: z.string().describe('The full new ad'),
  usedTaste: z.array(z.string()).describe("The audience's taste items you used, by name"),
})

// One better version per recommended audience (up to 2): rewrite → resolve its references → score them across all
// audiences (same "no signal" semantics as the original) → judge on that audience. Failures are recorded, never fatal.
export async function betterVersions(
  brief: Brief,
  segments: Segment[],
  reviews: Review[],
  targeting: Targeting,
  fixes: string[],
  trace: Trace,
  errors: Run['errors'],
): Promise<Run['versions']> {
  const out: Run['versions'] = []
  for (const a of targeting.audiences.slice(0, 2)) {
    const seg = segments.find((s) => s.id === a.segmentId)!
    const orig = reviews.find((r) => r.arm === 'crowdcraft' && r.segmentId === seg.id)!
    try {
      const taste = Object.entries(
        seg.fingerprint.reduce<Record<string, string[]>>((m, f) => ((m[f.type.split(':').pop()!] ??= []).push(f.name), m), {}),
      )
        .map(([d, ns]) => `${d}: ${ns.join(', ')}`)
        .join('\n')
      const rw = await generateJson(Rewrite, {
        system: `You rewrite an ad for one specific audience using their real taste (Qloo data). Keep the advertiser, the offer, prices, dates, the call to action, the channel format and roughly the same length (within 20%). Keep what already works for them. Replace what loses them with references this audience genuinely loves, from the list. Don't invent facts about the product.`,
        temperature: 0.4,
        prompt: `Audience: ${seg.name}
Their taste (what they love more than other audiences):
${taste}
${seg.themes.length ? `Themes: ${seg.themes.map((t) => t.name).join(', ')}` : ''}
Their reaction to the original: ${orig.verdict}, "${orig.wouldAct}". ${orig.reaction.map((s) => s.sentence).join(' ')}
Lines that land: ${orig.highlights.filter((h) => h.effect === 'lands').map((h) => `"${h.quote}"`).join(', ') || 'none'}
Lines that lose them: ${orig.highlights.filter((h) => h.effect === 'loses').map((h) => `"${h.quote}" (${h.reason})`).join(', ') || 'none'}
Fixes already suggested: ${fixes.join(' | ') || 'none'}

The original ad (${brief.adType}, ${brief.channel}) for ${brief.brandLine ?? 'the advertiser'}:
"""
${brief.adText}
"""`,
        trace,
        label: `Rewrite the ad for ${seg.name}`,
      })
      const nb: Brief = { ...brief, adText: rw.adText }
      const refs: Reference[] = await scoreReferences(await resolveReferences(nb, { trace }), segments, { trace })
      const review = await judge('crowdcraft', nb, seg, refs, trace)
      trace.add('judge', 'decision', `Better version for ${seg.name}: ${orig.rankingScore} → ${review.rankingScore}`)
      out.push({ segmentId: seg.id, adText: rw.adText, usedTaste: rw.usedTaste, before: orig.rankingScore, review })
    } catch (e) {
      errors.push({ stage: 'judge', message: `Better version for ${seg.name} failed: ${(e as Error).message}` })
    }
  }
  return out
}
