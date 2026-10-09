// The judge (spec.md > Judge): one structured call per segment per arm, then citation checks, quote location and scoring.
import { z } from 'zod'
import {
  InventedPersona,
  Verdict,
  type Arm,
  type Brief,
  type Channel,
  type Highlight,
  type Reference,
  type Review,
  type Segment,
} from '../contracts.ts'
import { generateJson } from '../llm.ts'
import { isScoredEntity } from './references.ts'
import type { Trace } from '../trace.ts'

export const REF_WEIGHT = 0.4 // spec.md > D6 #5; tuned from the ablation in slice 6

// What the model returns. Code adds positions, scores and the dropped list.
const JudgeOutput = z.object({
  verdict: Verdict,
  wouldAct: z.string(),
  reaction: z.array(z.object({ sentence: z.string(), sourceIds: z.array(z.string()) })),
  highlights: z.array(
    z.object({ quote: z.string(), effect: z.enum(['lands', 'loses']), reason: z.string(), sourceIds: z.array(z.string()) }),
  ),
  judgement: z.number(),
})
type JudgeOutput = z.infer<typeof JudgeOutput>

const CHANNEL_NOTES: Record<Channel, string> = {
  reel: 'a short vertical video (Instagram or TikTok reel): the first 2 seconds decide whether they keep watching',
  preroll: 'a skippable YouTube pre-roll: it has 5 seconds before the skip button',
  tv: 'a TV or streaming spot: watched lean-back, sound on',
  audio: 'a radio spot or podcast read: heard, not seen',
  billboard: 'a billboard or outdoor ad: read in about 3 seconds while moving',
  social: 'a social feed post: competes with everything else in the scroll',
  email: 'a marketing email: the subject line and first line decide whether it is read',
  general: 'no specific channel',
}

const SYSTEM = `You simulate how one specific audience segment reacts to an ad. You speak as that crowd, casually, in the first person.

Rules:
- Ground every claim about the crowd's taste in the data given. Put the bracketed ID of each data item you rely on in sourceIds (e.g. ["F3","R1"]). Prefer specific artists, brands, places and shows (F and R items) over themes (T and S items), and name them in the sentence. Never invent an ID. If the data has no bracketed IDs, use [] for every sourceIds.
- Be honest, not polite. Most ads are "meh" to most crowds. Only say "love" when the ad clearly speaks this crowd's language.
- Judge the ad for its channel.
- verdict: love | like | meh | skip.
- wouldAct: a short phrase for what they'd actually do on this channel (e.g. "Would stop scrolling", "Would skip at 5 seconds").
- reaction: 2 to 4 sentences in the crowd's voice. One claim per sentence.
- highlights: 2 to 6 phrases copied exactly, character for character, from the ad, each marked "lands" or "loses" for this crowd, with a short reason.
- judgement: 0 to 100 for how strongly this crowd responds (0 = actively put off, 50 = indifferent, 100 = they'd act immediately).`

// Short aliases (F1, T1, S1, R1) are easier for the model to copy than Qloo UUIDs; code maps them back.
export type Evidence = { prompt: string; aliases: Map<string, string> }

export function segmentEvidence(seg: Segment, refs: Reference[] | null): Evidence {
  const aliases = new Map<string, string>()
  const lines: string[] = []
  const add = (prefix: string, i: number, id: string, text: string) => {
    const a = `${prefix}${i + 1}`
    aliases.set(a, id)
    lines.push(`[${a}] ${text}`)
  }
  lines.push('What this crowd loves more than the other segments do (Qloo taste data):')
  seg.fingerprint.forEach((f, i) =>
    add('F', i, f.qlooId, `${f.name} (${shortType(f.type)}, distinctiveness ${f.distinctiveness.toFixed(1)})`),
  )
  if (seg.themes.length) {
    lines.push('Themes and vibes this crowd leans into:')
    seg.themes.forEach((t, i) => add('T', i, t.qlooId, t.name))
  }
  if (seg.setsApart.length) {
    lines.push('What sets this crowd apart from the others:')
    seg.setsApart.forEach((t, i) => add('S', i, t.qlooId, t.name))
  }
  if (refs?.length) {
    // Only resolved entities are scored (Qloo omits what an audience doesn't engage with); themes count only when Qloo
    // places them among this audience's top themes. Unresolved references don't count (prd.md > States and Edge Cases).
    const ents = refs.filter(isScoredEntity)
    if (ents.length) {
      lines.push("How this crowd relates to the brands, places and artists the ad mentions (Qloo; 0 = no engagement, 100 = the strongest fit among the segments):")
      ents.forEach((r, i) => {
        const none = r.fitBySegment[seg.id] == null ? " (this crowd doesn't engage with it)" : ''
        add('R', i, `ref:${r.qlooId}`, `"${r.text}" = ${r.resolvedName}: ${normFit(r, seg.id)}/100${none}`)
      })
    }
    const themes = refs.filter((r) => r.kind === 'theme' && r.qlooId && r.fitBySegment[seg.id] != null)
    if (themes.length) {
      lines.push('Themes in the ad that are among this crowd\'s top themes (Qloo):')
      themes.forEach((r, i) => add('R', ents.length + i, `ref:${r.qlooId}`, `"${r.text}" = ${r.resolvedName}`))
    }
    const unresolved = refs.filter((r) => !r.qlooId).map((r) => `"${r.text}"`)
    if (unresolved.length) lines.push(`Not matched in Qloo (no data, don't cite): ${unresolved.join(', ')}`)
  }
  return { prompt: lines.join('\n'), aliases }
}

const shortType = (t: string) => t.replace(/^urn:(entity|tag):/, '')

function adBlock(brief: Brief) {
  return [
    `Channel: ${CHANNEL_NOTES[brief.channel]}.`,
    `Format: ${brief.adType === 'script' ? 'a script (judge beats, pacing and delivery too)' : 'ad copy (judge the hook and the message)'}.`,
    brief.brandLine ? `Advertiser: ${brief.brandLine}.` : null,
    `\nThe ad:\n"""\n${brief.adText}\n"""`,
  ]
    .filter(Boolean)
    .join('\n')
}

const segmentHeader = (seg: Segment) => `You are this crowd: ${seg.name} (${seg.definedBy.join(', ')}).`

export async function judge(arm: Arm, brief: Brief, seg: Segment, refs: Reference[], trace?: Trace): Promise<Review> {
  let evidence: Evidence = { prompt: '', aliases: new Map() }
  let persona: InventedPersona | null = null
  if (arm === 'crowdcraft') evidence = segmentEvidence(seg, refs)
  if (arm === 'ablation') evidence = segmentEvidence(seg, null)
  if (arm === 'b2_invented') {
    persona = await generateJson(InventedPersona, {
      system: 'You write vivid, specific audience personas for marketers.',
      prompt: `Invent a detailed persona for this audience segment: ${seg.name} (${seg.definedBy.join(', ')}).\nGive a short bio and 15 specific favourites across artists, brands, films or TV shows, places and podcasts. Use real names. Each favourite has a type.`,
      trace,
      label: `B2 invents a persona for ${seg.name}`,
    })
    evidence.prompt = `Persona:\n${persona.bio}\nFavourites: ${persona.favourites.map((f) => `${f.name} (${f.type})`).join(', ')}`
  }
  const out = await generateJson(JudgeOutput, {
    system: SYSTEM,
    prompt: [segmentHeader(seg), evidence.prompt, adBlock(brief)].filter(Boolean).join('\n\n'),
    trace,
    label: `${arm} judges for ${seg.name}`,
  })
  const refFit = arm === 'crowdcraft' ? segmentRefFit(refs, seg.id) : null
  return { ...finalize(out, brief.adText, evidence.aliases, arm), segmentId: seg.id, arm, refFit, rankingScore: rankingScore(out.judgement, refFit), inventedPersona: persona }
}

// Citation checks and quote location. Grounded arms (crowdcraft, ablation) drop anything without a valid source.
export function finalize(out: JudgeOutput, adText: string, aliases: Map<string, string>, arm: Arm) {
  const grounded = arm === 'crowdcraft' || arm === 'ablation'
  const dropped: Review['dropped'] = []
  const resolve = (ids: string[]) => [...new Set(ids.map((a) => aliases.get(a.replace(/[[\]\s]/g, ''))).filter((x): x is string => !!x))]

  const reaction: Review['reaction'] = []
  for (const r of out.reaction) {
    const sourceIds = grounded ? resolve(r.sourceIds) : []
    if (grounded && !sourceIds.length) dropped.push({ kind: 'claim', text: r.sentence, reason: 'no valid taste source' })
    else reaction.push({ sentence: r.sentence, sourceIds })
  }

  const highlights: Highlight[] = []
  for (const h of out.highlights) {
    const span = locateQuote(adText, h.quote)
    const sourceIds = grounded ? resolve(h.sourceIds) : []
    if (!span) dropped.push({ kind: 'highlight', text: h.quote, reason: 'quote not found in the ad' })
    else if (grounded && !sourceIds.length) dropped.push({ kind: 'highlight', text: h.quote, reason: 'no valid taste source' })
    else highlights.push({ quote: adText.slice(span.start, span.end), ...span, effect: h.effect, reason: h.reason, sourceIds })
  }
  return { verdict: out.verdict, wouldAct: out.wouldAct, reaction, highlights, judgement: clamp(out.judgement), dropped }
}

// Exact match first; then ignoring case, whitespace runs and curly quotes, mapped back to original positions.
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim()
  if (!q) return null
  const exact = text.indexOf(q)
  if (exact >= 0) return { start: exact, end: exact + q.length }
  const norm = (s: string) => {
    let out = ''
    const map: number[] = []
    for (let i = 0; i < s.length; i++) {
      let c = s[i].toLowerCase().replace(/[‘’]/, "'").replace(/[“”]/, '"')
      if (/\s/.test(c)) {
        if (out.endsWith(' ')) continue
        c = ' '
      }
      out += c
      map.push(i)
    }
    return { out, map }
  }
  const t = norm(text)
  const nq = norm(q).out.trim()
  const i = t.out.indexOf(nq)
  if (i < 0) return null
  return { start: t.map[i], end: t.map[i + nq.length - 1] + 1 }
}

// Reference fit on an absolute scale: Qloo affinities for scored items sit around 0.75–1.0, so map that range to 0–100;
// an item Qloo omits for this audience (no engagement) is 0. Absolute, not min-max: 0.84 vs 0.83 must stay "the same".
export const FIT_FLOOR = 0.75
export function normFit(ref: Reference, segId: string): number {
  const v = ref.fitBySegment[segId]
  return v == null ? 0 : Math.round(Math.max(0, Math.min(1, (v - FIT_FLOOR) / (1 - FIT_FLOOR))) * 100)
}

export function segmentRefFit(refs: Reference[], segId: string): number | null {
  const resolved = refs.filter((r) => isScoredEntity(r) && segId in r.fitBySegment)
  if (!resolved.length) return null
  return Math.round(resolved.reduce((s, r) => s + normFit(r, segId), 0) / resolved.length)
}

export const rankingScore = (judgement: number, refFit: number | null) =>
  Math.round(refFit == null ? clamp(judgement) : REF_WEIGHT * refFit + (1 - REF_WEIGHT) * clamp(judgement))

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

// "Love from X and Y; Skip from Z" from one arm's reviews, ranked.
export function verdictLine(reviews: Review[], segments: Segment[]): string {
  const name = (id: string) => segments.find((s) => s.id === id)?.name ?? id
  const groups = new Map<string, string[]>()
  for (const r of [...reviews].sort((a, b) => b.rankingScore - a.rankingScore)) {
    groups.set(r.verdict, [...(groups.get(r.verdict) ?? []), name(r.segmentId)])
  }
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0])
  const word = { love: 'Love', like: 'Like', meh: 'Meh', skip: 'Skip' } as const
  return (['love', 'like', 'meh', 'skip'] as const)
    .filter((v) => groups.has(v))
    .map((v) => `${word[v]} from ${join(groups.get(v)!)}`)
    .join('; ')
}
