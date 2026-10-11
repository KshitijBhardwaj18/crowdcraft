import { describe, expect, it } from 'vitest'
import type { Reference, Review, Segment } from '../src/contracts.ts'
import { finalize, locateQuote, normFit, rankingScore, segmentRefFit, verdictLine } from '../src/engine/judge.ts'

const ad = 'Remember when you found a band before everyone else did?\nOne cold  Topo Chico in your hand.'
const aliases = new Map([
  ['F1', 'id-khruangbin'],
  ['R1', 'ref:id-topo'],
])

describe('locateQuote', () => {
  it('finds exact quotes', () => {
    expect(locateQuote(ad, 'found a band')).toEqual({ start: 18, end: 30 })
  })
  it('tolerates case, whitespace runs and curly quotes, mapping back to original positions', () => {
    const span = locateQuote(ad, 'one cold topo chico')!
    expect(ad.slice(span.start, span.end)).toBe('One cold  Topo Chico')
    expect(locateQuote("it’s here", "it's here")).toEqual({ start: 0, end: 9 })
  })
  it('returns null when the quote is not in the ad', () => {
    expect(locateQuote(ad, 'Lone Star beer')).toBeNull()
    expect(locateQuote(ad, '   ')).toBeNull()
  })
})

describe('finalize (citation checks)', () => {
  const out = {
    verdict: 'like' as const,
    wouldAct: 'Would stop scrolling',
    reaction: [
      { sentence: 'Sounds like our Khruangbin nights.', sourceIds: ['F1'] },
      { sentence: 'We value authenticity.', sourceIds: [] },
      { sentence: 'Made-up source.', sourceIds: ['F99'] },
      { sentence: 'Bracketed alias still counts.', sourceIds: ['[R1]'] },
    ],
    highlights: [
      { quote: 'Topo Chico', effect: 'lands' as const, reason: 'our drink', sourceIds: ['R1'] },
      { quote: 'not in the ad', effect: 'loses' as const, reason: 'x', sourceIds: ['F1'] },
      { quote: 'found a band', effect: 'lands' as const, reason: 'no source', sourceIds: [] },
    ],
    judgement: 112,
  }

  it('grounded arms keep only claims with valid sources and map aliases to Qloo IDs', () => {
    const r = finalize(out, ad, aliases, 'crowdcraft')
    expect(r.reaction.map((s) => s.sourceIds)).toEqual([['id-khruangbin'], ['ref:id-topo']])
    expect(r.highlights).toHaveLength(1)
    expect(r.highlights[0]).toMatchObject({ quote: 'Topo Chico', sourceIds: ['ref:id-topo'] })
    expect(r.dropped.map((d) => d.reason)).toEqual([
      'no valid taste source',
      'no valid taste source',
      'quote not found in the ad',
      'no valid taste source',
    ])
    expect(r.judgement).toBe(100)
  })

  it('baseline arms keep unsourced claims but still drop quotes that are not in the ad', () => {
    const r = finalize(out, ad, new Map(), 'b1_named')
    expect(r.reaction).toHaveLength(4)
    expect(r.reaction.every((s) => s.sourceIds.length === 0)).toBe(true)
    expect(r.highlights.map((h) => h.quote)).toEqual(['Topo Chico', 'found a band'])
    expect(r.dropped).toEqual([{ kind: 'highlight', text: 'not in the ad', reason: 'quote not found in the ad' }])
  })
})

describe('scoring', () => {
  const ref = (fit: Record<string, number | null>, qlooId: string | null = 'x'): Reference => ({
    text: 't', kind: 'entity', qlooId, qlooType: null, resolvedName: null, fitBySegment: fit, skew: null,
  })

  it('normalises fit across segments, treating below-cutoff as 0', () => {
    const r = ref({ a: 0.9, b: 0.8, c: null })
    expect(normFit(r, 'a')).toBe(100)
    expect(normFit(r, 'b')).toBe(89)
    expect(normFit(r, 'c')).toBe(0)
    expect(normFit(ref({ a: 0.5, b: 0.5 }), 'a')).toBe(50)
    expect(normFit(ref({ a: null, b: null }), 'a')).toBe(0)
  })

  it('averages resolved references only, and is null without any', () => {
    const refs = [ref({ a: 1, b: 0 }), ref({ a: 0, b: 1 }), ref({}, null)]
    expect(segmentRefFit(refs, 'a')).toBe(50)
    expect(segmentRefFit([ref({}, null)], 'a')).toBeNull()
  })

  it('blends 0.4 × fit + 0.6 × judgement, or uses judgement alone', () => {
    expect(rankingScore(50, 100)).toBe(70)
    expect(rankingScore(73, null)).toBe(73)
    expect(rankingScore(-20, null)).toBe(0)
  })
})

describe('verdictLine', () => {
  const seg = (id: string, name: string) => ({ id, name }) as Segment
  const rev = (segmentId: string, verdict: Review['verdict'], rankingScore: number) => ({ segmentId, verdict, rankingScore }) as Review
  it('groups segments by verdict, best first', () => {
    const line = verdictLine(
      [rev('a', 'skip', 10), rev('b', 'love', 90), rev('c', 'love', 80), rev('d', 'meh', 40)],
      [seg('a', 'A'), seg('b', 'B'), seg('c', 'C'), seg('d', 'D')],
    )
    expect(line).toBe('Love from B and C; Meh from D; Skip from A')
  })
})

describe('grade', () => {
  it('maps ranking scores to letters', async () => {
    const { grade } = await import('../src/report/render.ts')
    expect([95, 85, 84, 70, 55, 40, 39].map(grade)).toEqual(['A', 'A', 'B', 'B', 'C', 'D', 'F'])
  })
})

describe('lineTally', () => {
  it('counts each audience once per line and effect', async () => {
    const { lineTally } = await import('../src/engine/summary.ts')
    const ad = 'Great hook here. Weak middle.\nStrong close!'
    const h = (start: number, end: number, effect: 'lands' | 'loses') => ({ quote: '', start, end, effect, reason: '', sourceIds: [] })
    const reviews = [
      { segmentId: 'a', highlights: [h(0, 10, 'lands'), h(6, 15, 'lands'), h(17, 28, 'loses')] },
      { segmentId: 'b', highlights: [h(30, 43, 'lands')] },
    ] as unknown as Review[]
    const t = lineTally(ad, reviews)
    expect(t.map((l) => l.text)).toEqual(['Great hook here.', 'Weak middle.', 'Strong close!'])
    expect(t.map((l) => [l.lands, l.loses])).toEqual([[['a'], []], [[], ['a']], [['b'], []]])
  })
})
