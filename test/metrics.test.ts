import { describe, expect, it } from 'vitest'
import type { Review } from '../src/contracts.ts'
import { parseCsv } from '../src/eval/blind.ts'
import { firstCredit, goNoGo, highlightFlip, mismatchCaught, spreadOk, type Metric } from '../src/eval/metrics.ts'

const rev = (segmentId: string, rankingScore: number, verdict: Review['verdict'] = 'meh', highlights: Partial<Review['highlights'][number]>[] = []) =>
  ({ segmentId, rankingScore, verdict, highlights }) as Review

describe('ranking metrics', () => {
  it('gives full credit for a strict first, split credit for a tie, none otherwise', () => {
    expect(firstCredit([rev('a', 80), rev('b', 60)], 'a')).toBe(1)
    expect(firstCredit([rev('a', 80), rev('b', 80), rev('c', 10)], 'a')).toBe(0.5)
    expect(firstCredit([rev('a', 50), rev('b', 60)], 'a')).toBe(0)
    expect(firstCredit([], 'a')).toBe(0)
  })

  it('needs a 25-point gap and different verdicts for spread', () => {
    expect(spreadOk([rev('a', 80, 'love'), rev('b', 50, 'meh')])).toBe(true)
    expect(spreadOk([rev('a', 80, 'like'), rev('b', 60, 'meh')])).toBe(false)
    expect(spreadOk([rev('a', 80, 'like'), rev('b', 40, 'like')])).toBe(false)
  })

  it("catches a mismatch only when the target says meh/skip and the real fit ranks higher", () => {
    expect(mismatchCaught([rev('target', 30, 'skip'), rev('real', 70, 'like')], 'target', 'real')).toBe(true)
    expect(mismatchCaught([rev('target', 60, 'like'), rev('real', 70, 'like')], 'target', 'real')).toBe(false)
    expect(mismatchCaught([rev('target', 30, 'meh'), rev('real', 20, 'skip')], 'target', 'real')).toBe(false)
  })

  it('finds a flip when overlapping spans land for one segment and lose for another', () => {
    const flip = [rev('a', 0, 'meh', [{ start: 0, end: 10, effect: 'lands' }]), rev('b', 0, 'meh', [{ start: 5, end: 12, effect: 'loses' }])]
    const noOverlap = [rev('a', 0, 'meh', [{ start: 0, end: 4, effect: 'lands' }]), rev('b', 0, 'meh', [{ start: 4, end: 9, effect: 'loses' }])]
    expect(highlightFlip(flip)).toBe(true)
    expect(highlightFlip(noOverlap)).toBe(false)
  })
})

describe('goNoGo', () => {
  const m = (pass: Record<string, boolean | null>): Metric[] =>
    Object.entries(pass).map(([id, p]) => ({ id, label: id, target: '', values: {}, pass: p }))

  it('is pending without the Qloo arm', () => {
    expect(goNoGo(m({}), false).verdict).toBe('PENDING')
  })
  it('blocks on a failing gate', () => {
    expect(goNoGo(m({ stability: false, sourcing: true, specificity: true, blind: true }), true).verdict).toBe('NOT YET')
  })
  it('is GO with two wins', () => {
    expect(goNoGo(m({ stability: true, sourcing: true, accuracy_bc: true, mismatch: false, specificity: true, blind: null }), true).verdict).toBe('GO')
  })
  it('is GO, reframed when only specificity and preference win', () => {
    expect(goNoGo(m({ stability: true, sourcing: true, accuracy_bc: false, mismatch: false, specificity: true, blind: true }), true).verdict).toBe('GO, reframed')
  })
  it('is NO-GO when specificity and preference both lose', () => {
    expect(goNoGo(m({ stability: true, sourcing: true, accuracy_bc: true, mismatch: false, specificity: false, blind: false }), true).verdict).toBe('NO-GO')
  })
  it('stays pending while wins are still possible', () => {
    expect(goNoGo(m({ stability: true, sourcing: true, accuracy_bc: true, mismatch: false, specificity: false, blind: null }), true).verdict).toBe('PENDING')
  })
})

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside fields', () => {
    const csv = 'pair,text,choice\n"p01","She said ""hi"", then left\nlater","A"\r\np02,plain,\n'
    expect(parseCsv(csv)).toEqual([
      ['pair', 'text', 'choice'],
      ['p01', 'She said "hi", then left\nlater', 'A'],
      ['p02', 'plain', ''],
    ])
  })
})
