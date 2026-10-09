import { describe, expect, it } from 'vitest'
import { metroHeat, pickRegions, type Metro } from '../src/engine/heat.ts'

const metros: Metro[] = [
  { label: 'A', query: 'A', lat: 30, lon: -97 },
  { label: 'B', query: 'B', lat: 40, lon: -74 },
  { label: 'C', query: 'C', lat: 34, lon: -118 },
  { label: 'Empty', query: 'E', lat: 0, lon: 0 },
]
const p = (lat: number, lon: number, affinity: number, popularity: number) => ({ lat, lon, affinity, popularity })

describe('metroHeat', () => {
  it('weights tiles by popularity and skips metros with no tiles', () => {
    const points = [p(30.1, -97, 1, 0.1), p(30, -97.1, 0.5, 0.9), p(40, -74, 0.9, 1), p(34, -118, 0.4, 1), p(50, 50, 1, 1)]
    const ranked = metroHeat(points, metros)
    expect(ranked.map((m) => m.label)).toEqual(['B', 'A', 'C'])
    expect(ranked.find((m) => m.label === 'A')!.heat).toBeCloseTo(0.55) // the 1.0 tile is nearly empty, so it barely counts
  })
  it('picks the hottest metros plus the coolest big one', () => {
    const ranked = metroHeat([p(30, -97, 0.9, 1), p(40, -74, 0.8, 1), p(34, -118, 0.3, 1)], metros)
    const { hot, cool } = pickRegions(ranked)
    expect(hot.map((m) => m.label)).toEqual(['A', 'B'])
    expect(cool?.label).toBe('C')
  })
})
