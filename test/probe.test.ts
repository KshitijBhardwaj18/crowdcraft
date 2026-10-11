import { describe, expect, it } from 'vitest'
import { jaccard, verdictFor } from '../src/probe/probe.ts'

describe('probe', () => {
  it('measures overlap between lists', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
    expect(jaccard([], [])).toBe(0)
  })
  it('rates coverage', () => {
    expect(verdictFor({ fillRate: 1, distinctness: 0.9, localSpecificity: null })).toBe('Good')
    expect(verdictFor({ fillRate: 1, distinctness: 0.9, localSpecificity: 0.1 })).toBe('Thin')
    expect(verdictFor({ fillRate: 0.6, distinctness: 0.2, localSpecificity: 0.5 })).toBe('Thin')
    expect(verdictFor({ fillRate: 0.3, distinctness: 0.9, localSpecificity: 0.9 })).toBe('Unusable')
  })
})
