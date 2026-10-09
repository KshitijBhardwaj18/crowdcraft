// References stage (spec.md > References stage): find the ad's cultural references, resolve each to the right Qloo
// entity, then measure how much each audience engages with it (hard Qloo numbers) and how it skews by age and gender.
// Resolution is extract (LLM) → typed Qloo search (code) → pick the right candidate or none (LLM, one call): an
// open-ended agent picked look-alikes (a dish tag for a brand, a saloon for a park), and wrong IDs become confident
// wrong verdicts (checklist Revisions, slice 5).
import { z } from 'zod'
import type { Brief, EvidenceItem, Reference, Segment } from '../contracts.ts'
import { generateJson } from '../llm.ts'
import { demographics, fit, searchEntities, searchTags, topTags, type Ctx } from '../qloo/client.ts'

// Entity types /v2/insights can score.
export const SCORABLE = new Set(['artist', 'brand', 'place', 'movie', 'tv_show', 'podcast', 'book', 'destination', 'person', 'video_game'])
const THEME_TAG = /^urn:tag:(genre|keyword|style|subgenre)/

const Extracted = z.object({
  references: z.array(
    z.object({
      text: z.string().describe('The words exactly as they appear in the ad'),
      kind: z.enum(['entity', 'theme']),
      type: z.enum(['artist', 'brand', 'place', 'movie', 'tv_show', 'podcast', 'book', 'person', 'video_game']).nullable().describe('For entities'),
      searchName: z.string().describe('The full proper name to search for, e.g. "Barton Springs Pool" for "Barton Springs"'),
    }),
  ),
})

const Picks = z.object({ picks: z.array(z.object({ ref: z.number(), choice: z.number().nullable().describe('Candidate number, or null if none is the same thing') })) })

export async function resolveReferences(brief: Brief, ctx: Ctx): Promise<Reference[]> {
  const c = { ...ctx, stage: 'references' as const }
  const ex = await generateJson(Extracted, {
    system: 'You list the cultural references in an ad, precisely. You return only the requested JSON.',
    prompt: `Advertiser: ${brief.brandLine ?? 'not given'}. Market: ${JSON.stringify(brief.market)}.
The ad:
"""
${brief.adText}
"""
List every named reference (brands, artists, bands, songs' artists, venues and places, shows, films, people, games, podcasts, drinks or foods that are brands), skipping the advertiser itself and plain city or country names.
Add up to 3 implied themes as music or style genres or keywords (e.g. "psychedelic rock", "vinyl", "tailgating").`,
    trace: ctx.trace,
    label: "Extract the ad's references",
  })
  const items = ex.references.filter((r, i, all) => all.findIndex((x) => x.text.toLowerCase() === r.text.toLowerCase()) === i).slice(0, 12)

  const candidates: EvidenceItem[][] = await Promise.all(
    items.map(async (r) => {
      // Search both the full name and the ad's own words; merge, keeping order and dropping duplicates.
      const names = [...new Set([r.searchName, r.text])]
      const lists = await Promise.all(
        names.map((n) =>
          r.kind === 'entity' && r.type
            ? searchEntities(n, c, [`urn:entity:${r.type}`]).catch(() => [])
            : searchTags(n, c).then((ts) => ts.filter((t) => THEME_TAG.test(t.qlooId))).catch(() => []),
        ),
      )
      return lists.flat().filter((x, k, all) => all.findIndex((y) => y.qlooId === x.qlooId) === k).slice(0, 8)
    }),
  )
  const listed = items.map((r, i) => `${i + 1}. "${r.text}" (${r.type ?? r.kind}, searched "${r.searchName}"):\n${candidates[i].map((x, j) => `   ${j + 1}) ${x.name}${x.type ? ` [${x.type.replace(/^urn:(entity|tag):/, '')}]` : ''}`).join('\n') || '   (no results)'}`).join('\n')
  const { picks } = await generateJson(Picks, {
    system: 'You match references in an ad to database entries. Pick the entry that is the same real-world thing, or null. The same place under a slightly longer name (e.g. "X South Gate" for "X") counts, and so does a product line of the same brand (e.g. "Brand Hard Seltzer" for "Brand"). A different business that only shares words with it (a saloon or nursery named after a park, a store named after a town) is not a match.',
    prompt: `The ad:\n"""\n${brief.adText}\n"""\n\nFor each reference, pick the candidate number that is the same thing, or null:\n${listed}`,
    trace: ctx.trace,
    label: 'Match references to Qloo entries',
  })
  const refs: Reference[] = items.map((r, i) => {
    const choice = picks.find((p) => p.ref === i + 1)?.choice
    const hit = choice ? candidates[i][choice - 1] : undefined
    return {
      text: r.text,
      kind: r.kind,
      qlooId: hit?.qlooId ?? null,
      qlooType: hit?.type ?? null,
      resolvedName: hit?.name ?? null,
      fitBySegment: {},
      skew: null,
    }
  })
  const found = refs.filter((r) => r.qlooId)
  ctx.trace?.add('references', 'decision', `Found ${refs.length} references in the ad; ${found.length} matched in Qloo: ${found.map((r) => `${r.text} → ${r.resolvedName}`).join(', ') || 'none'}`)
  const missing = refs.filter((r) => !r.qlooId).map((r) => r.text)
  if (missing.length) ctx.trace?.add('references', 'warning', `No exact match in Qloo (won't count): ${missing.join(', ')}`)
  return refs
}

const domainOf = (r: Reference) => r.qlooType?.replace(/^urn:entity:/, '') ?? ''
export const isScoredEntity = (r: Reference) => r.kind === 'entity' && !!r.qlooId && SCORABLE.has(domainOf(r)) && !noSignal(r)
// Scored for no audience at all: a Qloo coverage gap, not "everyone dislikes it", so it never counts.
export const noSignal = (r: Reference) => Object.keys(r.fitBySegment).length > 0 && Object.values(r.fitBySegment).every((v) => v == null)

// Fit per audience. Entities: filter.results.entities (Qloo omits what an audience doesn't engage with → null).
// Themes: the tag's affinity if it is among the audience's top 50 themes, else null meaning "unknown" (not counted).
export async function scoreReferences(refs: Reference[], segments: Segment[], ctx: Ctx): Promise<Reference[]> {
  const c = { ...ctx, stage: 'fit' as const }
  const entities = refs.filter((r) => r.kind === 'entity' && !!r.qlooId && SCORABLE.has(domainOf(r)))
  const themes = refs.filter((r) => r.kind === 'theme' && r.qlooId)
  const byDomain = new Map<string, Reference[]>()
  for (const r of entities) byDomain.set(domainOf(r), [...(byDomain.get(domainOf(r)) ?? []), r])

  const perSegment = await Promise.all(
    segments.map(async (seg) => {
      const scores = new Map<string, number | null>()
      for (const [domain, rs] of byDomain) {
        const f = await fit(domain, seg.signals, rs.map((r) => r.qlooId!), c)
        for (const [id, v] of f) scores.set(id, v)
      }
      if (themes.length) {
        const tags = await topTags(seg.signals, 50, c)
        for (const t of themes) scores.set(t.qlooId!, tags.find((x) => x.qlooId === t.qlooId)?.affinity ?? null)
      }
      return { seg, scores }
    }),
  )
  const skews = new Map(await Promise.all(entities.slice(0, 8).map(async (r) => [r.qlooId!, await demographics(r.qlooId!, c).catch(() => null)] as const)))
  const out = refs.map((r) => ({
    ...r,
    fitBySegment: entities.includes(r) || themes.includes(r) ? Object.fromEntries(perSegment.map(({ seg, scores }) => [seg.id, scores.get(r.qlooId!) ?? null])) : {},
    skew: (r.qlooId && skews.get(r.qlooId)) || null,
  }))
  const gaps = out.filter(noSignal).map((r) => r.text)
  ctx.trace?.add('fit', 'decision', `Scored ${entities.length} referenced entities (and ${themes.length} themes) for ${segments.length} audiences with Qloo affinity`)
  if (gaps.length) ctx.trace?.add('fit', 'warning', `No Qloo signal for any audience, so not counted: ${gaps.join(', ')}`)
  return out
}
