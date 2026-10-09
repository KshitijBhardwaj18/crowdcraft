// AI SDK tools over the Qloo client for agent stages (spec.md > Qloo agent tools). Compact results only.
// Every ID a tool returns is recorded, so stage outputs can be checked for invented IDs.
import { tool } from 'ai'
import { z } from 'zod'
import { AgeBucket, type QlooSignals } from '../contracts.ts'
import { locality, searchAudiences, searchEntities, searchTags, topEntities, type Ctx } from './client.ts'

// prd.md > Key Decisions (sensitive attributes) + spec.md > Policy additions.
const SENSITIVE_AUDIENCE_TYPES = ['urn:audience:communities', 'urn:audience:political_preferences', 'urn:audience:lifestyle_preferences_beliefs']

// ponytail: keyword blocklist for identity tags (sexuality, gender identity, religion, ethnicity, politics); upgrade to a
// reviewed tag-type list if Qloo's taxonomy makes one possible. Genre names such as "latin pop" are taste and pass.
const SENSITIVE = /\b(queer|trans|transgender|lgbtq?\+?|gay|lesbian|bisexual|drag queens?|christian|catholic|muslim|islamic|jewish|hindu|buddhist|church|religio\w*|latin[ao]s?|latinx|hispanic|african[- ]american|black|asian[- ]american|ethnic\w*|conservative|liberal|republican|democrat\w*|politic\w*)\b/i
export const isSensitiveTag = (name: string) => SENSITIVE.test(name)

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
      execute: async ({ query }) => remember((await searchTags(query, ctx)).filter((t) => !isSensitiveTag(t.name))).map((t) => ({ id: t.qlooId, name: t.name, type: t.type })),
    }),
    find_audiences: tool({
      description: 'Search Qloo audiences (hobbies and interests, life stage, spending habits, professional area, leisure) by name. Returns audience IDs usable as audienceIds.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const all = await searchAudiences(query, ctx).catch(() => [])
        const allowed = all.filter(
          (a) => !SENSITIVE_AUDIENCE_TYPES.includes(a.type) || opts.allowedCommunities.some((c) => a.name.toLowerCase().includes(c.toLowerCase())),
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
