// Coverage probe (prd.md > Coverage Probe): how well Qloo covers each market, with a verdict per market.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import type { AgeBucket, QlooSignals } from '../contracts.ts'
import { searchTags, topEntities, type Domain } from '../qloo/client.ts'
import { CSS, esc } from '../report/render.ts'
import { Trace } from '../trace.ts'

type Config = { markets: { id: string; name: string; city: string }[]; tastes: { id: string; tagQuery: string }[]; ages: AgeBucket[]; domains: Domain[] }
type Cell = { taste: string; age: AgeBucket; domain: Domain; ids: string[]; names: string[] }
export type MarketResult = {
  id: string
  name: string
  city: string
  fillRate: number // share of queries returning ≥ 5 results
  avgResults: number
  localSpecificity: number | null // 1 − overlap with the US list for the same taste, age and domain (null for the US)
  distinctness: number // 1 − mean overlap between this market's segments, per domain
  verdict: 'Good' | 'Thin' | 'Unusable'
  sample: { segment: string; artists: string[]; brands: string[] }
}

export const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a)
  const B = new Set(b)
  const inter = [...A].filter((x) => B.has(x)).length
  const union = new Set([...A, ...B]).size
  return union ? inter / union : 0
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function verdictFor(m: Pick<MarketResult, 'fillRate' | 'distinctness' | 'localSpecificity'>): MarketResult['verdict'] {
  const local = m.localSpecificity ?? 1
  if (m.fillRate >= 0.8 && m.distinctness >= 0.5 && local >= 0.3) return 'Good'
  if (m.fillRate >= 0.5) return 'Thin'
  return 'Unusable'
}

export async function runProbe(log: (s: string) => void, configPath = 'probe/segments.yaml') {
  const cfg: Config = YAML.parse(await readFile(configPath, 'utf8'))
  const trace = new Trace()
  const ctx = { trace, stage: 'fingerprints' as const }
  const tagIds = new Map<string, string>()
  for (const t of cfg.tastes) tagIds.set(t.id, (await searchTags(t.tagQuery, ctx))[0]?.qlooId ?? '')

  const cells = new Map<string, Cell[]>()
  await Promise.all(
    cfg.markets.map(async (m) => {
      const list: Cell[] = []
      await Promise.all(
        cfg.tastes.flatMap((t) =>
          cfg.ages.flatMap((age) =>
            cfg.domains.map(async (domain) => {
              const s: QlooSignals = {
                locationQuery: m.city, locationId: null, ageBuckets: [age], gender: null,
                audienceIds: [], tagIds: [tagIds.get(t.id)!].filter(Boolean), entityIds: [],
              }
              const items = await topEntities(domain, s, 20, ctx).catch(() => [])
              list.push({ taste: t.id, age, domain, ids: items.map((i) => i.qlooId), names: items.map((i) => i.name) })
            }),
          ),
        ),
      )
      cells.set(m.id, list)
      log(`✓ ${m.name}: ${list.filter((c) => c.ids.length >= 5).length}/${list.length} queries filled`)
    }),
  )

  const us = cells.get('us') ?? []
  const find = (list: Cell[], c: Pick<Cell, 'taste' | 'age' | 'domain'>) =>
    list.find((x) => x.taste === c.taste && x.age === c.age && x.domain === c.domain)
  const results: MarketResult[] = cfg.markets.map((m) => {
    const list = cells.get(m.id)!
    const local = m.id === 'us' ? null : avg(list.filter((c) => c.ids.length).map((c) => 1 - jaccard(c.ids, find(us, c)?.ids ?? [])))
    const distinct = avg(
      cfg.domains.flatMap((d) => {
        const segs = list.filter((c) => c.domain === d && c.ids.length)
        return segs.flatMap((a, i) => segs.slice(i + 1).map((b) => 1 - jaccard(a.ids, b.ids)))
      }),
    )
    const r = {
      id: m.id, name: m.name, city: m.city,
      fillRate: list.filter((c) => c.ids.length >= 5).length / list.length,
      avgResults: avg(list.map((c) => c.ids.length)),
      localSpecificity: local,
      distinctness: distinct,
    }
    const pick = (domain: Domain) => find(list, { taste: cfg.tastes[0].id, age: cfg.ages[0], domain })?.names.slice(0, 6) ?? []
    return {
      ...r,
      verdict: verdictFor(r),
      sample: { segment: `${cfg.tastes[0].tagQuery}, ${cfg.ages[0].replace(/_/g, ' ')}, ${m.city}`, artists: pick('artist'), brands: pick('brand') },
    }
  })

  const dir = `probe-results/${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'coverage.json'), JSON.stringify({ results, qlooCalls: trace.usage.qlooCalls }, null, 2))
  await writeFile(path.join(dir, 'coverage.html'), renderCoverage(results, cfg))
  return { dir, results }
}

const pct = (x: number | null) => (x == null ? '— (reference)' : `${Math.round(x * 100)}%`)

function renderCoverage(results: MarketResult[], cfg: Config) {
  const tone = { Good: 'love', Thin: 'meh', Unusable: 'skip' } as const
  const rows = results
    .map(
      (r) =>
        `<tr><td><b>${esc(r.name)}</b><br><span class="small">${esc(r.city)}</span></td><td><span class="v-${tone[r.verdict]}"><b>${r.verdict}</b></span></td><td>${pct(r.fillRate)}<br><span class="small">${r.avgResults.toFixed(1)} results per query</span></td><td>${pct(r.localSpecificity)}</td><td>${pct(r.distinctness)}</td><td class="small"><b>${esc(r.sample.segment)}</b><br>Artists: ${esc(r.sample.artists.join(', ') || '—')}<br>Brands: ${esc(r.sample.brands.join(', ') || '—')}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qloo Coverage Probe</title><style>${CSS}</style></head><body><main>
<p class="eyebrow">CrowdCraft · Qloo coverage probe · ${cfg.tastes.length} tastes × ${cfg.ages.length} ages × ${cfg.domains.length} domains per market</p>
<h1>Which markets can CrowdCraft honestly offer?</h1>
<p class="note"><b>Fill rate</b>: queries returning at least 5 results. <b>Local specificity</b>: how different the market's taste lists are from the US lists for the same taste and age (higher means the location really changes the answer). <b>Distinctness</b>: how different the market's segments are from each other. Good = fill ≥ 80%, distinctness ≥ 50%, local specificity ≥ 30%; Thin = fill ≥ 50%.</p>
<table><thead><tr><th>Market</th><th>Verdict</th><th>Fill rate</th><th>Local specificity</th><th>Distinctness</th><th>Sample fingerprint</th></tr></thead><tbody>${rows}</tbody></table>
</main></body></html>`
}
