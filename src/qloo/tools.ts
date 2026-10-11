// AI SDK tools over the Qloo client for agent stages (spec.md > Qloo agent tools). Compact results only.
// Every ID a tool returns is recorded, so stage outputs can be checked for invented IDs.
import { tool } from 'ai'
import { z } from 'zod'
import { AgeBucket, type QlooSignals } from '../contracts.ts'
import { locality, searchAudiences, searchEntities, searchTags, topEntities, type Ctx } from './client.ts'

// prd.md > Key Decisions (sensitive attributes) + spec.md > Policy additions.
const SENSITIVE_AUDIENCE_TYPES = ['urn:audience:communities', 'urn:audience:political_preferences', 'urn:audience:lifestyle_preferences_beliefs']

// Identity tags never describe an audience (prd.md > Key Decisions: sensitive attributes). Two layers:
// 1. Qloo tag namespaces that are identity descriptors, not taste (inclusivity, audience-type tags).
// 2. A word list for identity terms elsewhere (sexuality, gender identity, religion, ethnicity, politics).
// ponytail: a word list can't be complete; review real tag names in .cache/qloo when adding markets.
const SENSITIVE_NAMESPACES = ['urn:tag:inclusivity:', 'urn:tag:audience:qloo:']
const SENSITIVE = /\b(queer|trans|transgender|lgbt\w*\+?|gay|lesbian|bisexual|sexual\w*|gender\w*|non-binary|drag queens?|feminis\w*|christian\w*|catholic\w*|muslim|islam\w*|jewish|juda\w*|hindu\w*|buddhis\w*|faith\w*|spiritual\w*|church|religio\w*|latin[aox]s?|hispanic|\w+-american|asian|black[- ]owned|black culture|ethnic\w*|conservative|liberal|progressive|republican|democrat\w*|politic\w*)\b/i
export const isSensitiveTag = (name: string, id = '') => SENSITIVE_NAMESPACES.some((n) => id.startsWith(n)) || SENSITIVE.test(name)

export type ToolRegistry = { ids: Set<string>; names: Map<string, string>; types: Map<string, string>; localities: Map<string, string> }
export const newRegistry = (): ToolRegistry => ({ ids: new Set(), names: new Map(), types: new Map(), localities: new Map() })

const SignalsInput = z.object({
  locationQuery: z.string().nullable().describe('A city, neighbourhood or region name, e.g. "Austin"'),
  ageBuckets: z.array(AgeBucket).nullable(),
  gender: z.enum(['male', 'female']).nullable(),
  audienceIds: z.array(z.string()).describe('IDs from find_audiences only'),
  tagIds: z.array(z.string()).describe('IDs from find_tags only'),
  entityIds: z.array(z.string()).describe('IDs from find_entities only'),
})

export function qlooTools(ctx: Ctx, reg: ToolRegistry, opts: { allowedCommunities: string[] }) {
  const remember = <T extends { qlooId: string; name: string; type: string }>(xs: T[]) => {
    for (const x of xs) reg.ids.add(x.qlooId), reg.names.set(x.qlooId, x.name), reg.types.set(x.qlooId, x.type)
    return xs
  }
  return {
    find_tags: tool({
      description: 'Search Qloo tags (genres, styles, themes, keywords) by name. Returns tag IDs usable as tagIds.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => remember((await searchTags(query, ctx)).filter((t) => !isSensitiveTag(t.name, t.qlooId))).map((t) => ({ id: t.qlooId, name: t.name, type: t.type })),
    }),
    find_audiences: tool({
      description: 'Search Qloo audiences (hobbies and interests, life stage, spending habits, professional area, leisure) by name. Returns audience IDs usable as audienceIds.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const all = await searchAudiences(query, ctx).catch(() => [])
        const allowed = all.filter(
          (a) =>
            // A sensitive audience only when the brief names that community explicitly (at least 3 letters, whole-name match).
            SENSITIVE_AUDIENCE_TYPES.includes(a.type) || isSensitiveTag(a.name)
              ? opts.allowedCommunities.some((c) => c.trim().length >= 3 && a.name.toLowerCase() === c.trim().toLowerCase())
              : true,
        )
        return remember(allowed).map((a) => ({ id: a.qlooId, name: a.name, type: a.type }))
      },
    }),
    find_entities: tool({
      description: 'Search Qloo entities (artists, brands, places, films, shows, podcasts, people) by name. Returns entity IDs usable as entityIds ("fans of").',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => remember(await searchEntities(query, ctx)).map((e) => ({ id: e.qlooId, name: e.name, type: e.type })),
    }),
    check_locality: tool({
      description: 'Check that a place name resolves to a Qloo locality. Use before using a locationQuery.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const l = await locality(query, ctx)
        if (l) reg.localities.set(query.toLowerCase(), l.name)
        return l ?? { error: 'not found' }
      },
    }),
    probe_density: tool({
      description: 'Check how much Qloo taste data a candidate segment has. Returns the top artists and brands. Thin results (< 5) mean the segment should be broadened.',
      inputSchema: SignalsInput,
      execute: async (s) => {
        const signals: QlooSignals = { ...s, locationId: null }
        const [artists, brands] = await Promise.all([topEntities('artist', signals, 8, ctx), topEntities('brand', signals, 8, ctx)])
        return { artists: artists.map((a) => a.name), brands: brands.map((b) => b.name), thin: artists.length < 5 || brands.length < 5 }
      },
    }),
  }
}

// Drop any ID the tools never returned (models must not invent Qloo IDs).
export function keepKnownIds(s: QlooSignals, reg: ToolRegistry): { signals: QlooSignals; dropped: string[] } {
  const dropped: string[] = []
  const keep = (ids: string[]) => ids.filter((id) => (reg.ids.has(id) ? true : (dropped.push(id), false)))
  return { signals: { ...s, audienceIds: keep(s.audienceIds), tagIds: keep(s.tagIds), entityIds: keep(s.entityIds) }, dropped }
}
