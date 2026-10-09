import { describe, expect, it } from 'vitest'
import type { Brief, EvidenceItem } from '../src/contracts.ts'
import { ageLabel, clampToBrief } from '../src/engine/candidates.ts'
import { distanceMatrix, distinctiveItems, greedySelect, pearson, type Column } from '../src/engine/select.ts'
import { isSensitiveTag } from '../src/qloo/tools.ts'

const item = (id: string): EvidenceItem => ({ qlooId: id, name: id, type: 'urn:entity:artist', affinity: null, imageUrl: null })
const col = (id: string, domain: Column['domain'] = 'artist'): Column => ({ id, domain, item: item(id) })

describe('distance and selection', () => {
  it('pearson is 1 for identical patterns, -1 for opposite, 0 for flat', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1)
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0)
  })

  it('keeps the most different candidates and drops near-duplicates', () => {
    // a and a2 are near-identical; b and c differ from them and from each other.
    const rows = [
      [0.9, 0.9, 0, 0, 0, 0],
      [0.9, 0.88, 0, 0, 0, 0.1],
      [0, 0, 0.9, 0.9, 0, 0],
      [0, 0, 0, 0, 0.9, 0.9],
    ]
    const kept = greedySelect(distanceMatrix(rows), [2, 3, 2, 2], { max: 6, min: 3, stopAt: 0.15 })
    expect(kept[0]).toBe(1) // richest first
    expect(kept).toHaveLength(3)
    expect(kept.includes(0)).toBe(false) // a is a near-duplicate of a2
  })

  it('never keeps fewer than two when candidates exist', () => {
    expect(greedySelect([[0, 0], [0, 0]], [1, 1])).toEqual([0, 1])
  })
})

describe('distinctiveItems', () => {
  it('only uses a segment\'s own items, ranked by how much less the others love them', () => {
    const cols = [col('x'), col('y'), col('z')]
    const rows = [
      [0.9, 0.9, 0.0], // segment 0
      [0.0, 0.9, 0.9], // segment 1
    ]
    const own = [new Set(['x', 'y']), new Set(['z'])]
    const [s0, s1] = distinctiveItems([0, 1], rows, cols, own)
    expect(s0.map((i) => i.qlooId)).toEqual(['x']) // y is loved equally by both, so not distinctive
    expect(s0[0].distinctiveness).toBeCloseTo(0.9)
    expect(s1.map((i) => i.qlooId)).toEqual(['z']) // y scores for segment 1 but isn't in its own list
  })
})

describe('clampToBrief', () => {
  const brief = { target: { ageBuckets: ['25_to_29', '30_to_34'], gender: null } } as unknown as Brief
  const c = (name: string, ageBuckets: Brief['target']['ageBuckets']) => ({ name, ageBuckets, gender: 'male' as const })

  it('drops candidates entirely outside the brief ages', () => {
    expect(clampToBrief(c('Jazz fans, 35-54', ['35_to_44', '45_to_54']), brief, {})).toBeNull()
  })
  it('clamps partial overlaps and fixes the name; gender follows the brief', () => {
    const r = clampToBrief(c('Country fans, 30-44', ['30_to_34', '35_to_44']), brief, {})!
    expect(r.ageBuckets).toEqual(['30_to_34'])
    expect(r.name).toBe('Country fans, 30-34')
    expect(r.gender).toBeNull()
  })
  it('labels age ranges', () => {
    expect(ageLabel(['24_and_younger', '25_to_29'])).toBe('under 30')
    expect(ageLabel(['45_to_54', '55_and_older'])).toBe('45+')
  })
})

describe('isSensitiveTag', () => {
  it('blocks identity tags but keeps genres', () => {
    for (const t of ['queer', 'Trans', 'drag queens', 'Christian', 'Latina', 'Republican']) expect(isSensitiveTag(t)).toBe(true)
    for (const t of ['Latin pop', 'Indie - Rock', 'Jazz club', 'Drag Race', 'Transit']) expect(isSensitiveTag(t)).toBe(false)
  })
})
