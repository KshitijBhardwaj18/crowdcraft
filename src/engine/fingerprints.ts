// Fingerprints (spec.md > Fingerprints and selection): each candidate's top items per domain, plus themes.
import type { EvidenceItem } from '../contracts.ts'
import { topEntities, topTags, type Ctx, type Domain } from '../qloo/client.ts'
import type { Candidate } from './candidates.ts'

// ponytail: 4 domains, not 6, to fit the 10k/month Qloo budget (checklist Revisions, slice 3).
export const FP_DOMAINS: Domain[] = ['artist', 'brand', 'tv_show', 'place']

export type Fingerprint = { cand: Candidate; top: Record<Domain, EvidenceItem[]>; themes: EvidenceItem[]; thin: boolean }

export async function fingerprint(cand: Candidate, ctx: Ctx): Promise<Fingerprint> {
  const c = { ...ctx, stage: 'fingerprints' as const }
  const [lists, themes] = await Promise.all([Promise.all(FP_DOMAINS.map((d) => topEntities(d, cand.signals, 15, c))), topTags(cand.signals, 20, c)])
  const top = Object.fromEntries(FP_DOMAINS.map((d, i) => [d, lists[i]])) as Record<Domain, EvidenceItem[]>
  const thin = top.artist.length + top.brand.length < 8
  if (thin) ctx.trace?.add('fingerprints', 'warning', `${cand.name}: thin data (${top.artist.length} artists, ${top.brand.length} brands)`)
  return { cand, top, themes, thin }
}
