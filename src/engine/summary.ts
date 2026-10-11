// "What to do" (spec.md > Summary): the line-by-line tally (code) and one grounded summary call per run.
import { Summary, type Brief, type Review, type Segment } from '../contracts.ts'
import { generateJson } from '../llm.ts'
import type { Trace } from '../trace.ts'
import { locateQuote } from './judge.ts'

export type LineTally = { text: string; start: number; end: number; lands: string[]; loses: string[] } // segment IDs

// Split the ad into lines, then sentences, keeping offsets; count which audiences each piece lands with or loses.
export function lineTally(adText: string, reviews: Review[]): LineTally[] {
  const pieces: LineTally[] = []
  for (const m of adText.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const text = m[0].trim()
    if (!text) continue
    const start = m.index! + m[0].indexOf(text)
    pieces.push({ text, start, end: start + text.length, lands: [], loses: [] })
  }
  for (const r of reviews)
    for (const h of r.highlights)
      for (const p of pieces) {
        if (h.start >= p.end || h.end <= p.start) continue
        const list = h.effect === 'lands' ? p.lands : p.loses
        if (!list.includes(r.segmentId)) list.push(r.segmentId)
      }
  return pieces
}

const SYSTEM = `You advise a campaign manager who is about to spend money on an ad. You turn simulated audience reactions into decisions.
Rules:
- Use only the data given: the audiences' reactions, the line-by-line tally and each audience's Qloo taste. Never invent tastes.
- bottomLine: one plain sentence a busy marketer can act on.
- actions: 4 to 7, each one specific and short. kind is one of:
  keep (an element that works, and with whom), fix (what loses whom, and why), try (a concrete change grounded in an audience's taste: name the artists, brands or places),
  spend (which audiences to put budget on first), skip (which to deprioritise for this cut).
- segmentIds: the IDs of the audiences each action is about (from the list). quote: the exact line from the ad the action is about, or null.
- No generic marketing advice ("A/B test it", "know your audience").`

export async function summarize(brief: Brief, segments: Segment[], reviews: Review[], trace?: Trace): Promise<Summary> {
  const main = reviews.filter((r) => r.arm === 'crowdcraft')
  const name = (id: string) => segments.find((s) => s.id === id)?.name ?? id
  const audiences = segments
    .map((s) => {
      const r = main.find((x) => x.segmentId === s.id)
      if (!r) return null
      const taste = s.fingerprint.map((f) => f.name).slice(0, 8).join(', ')
      return `[${s.id}] ${s.name}: ${r.verdict}, score ${r.rankingScore}, "${r.wouldAct}"
  Reaction: ${r.reaction.map((x) => x.sentence).join(' ')}
  Into (Qloo): ${taste}${s.themes.length ? `; themes: ${s.themes.map((t) => t.name).join(', ')}` : ''}`
    })
    .filter(Boolean)
    .join('\n')
  const lines = lineTally(brief.adText, main)
    .map((l) => `"${l.text}": lands with ${l.lands.map(name).join(', ') || 'none'}; loses ${l.loses.map(name).join(', ') || 'none'}`)
    .join('\n')
  const out = await generateJson(Summary, {
    system: SYSTEM,
    prompt: `The ad (${brief.adType === 'script' ? 'script' : 'copy'}, ${brief.channel}) for ${brief.brandLine ?? 'an advertiser'}, aimed at ${brief.target.text}:
"""
${brief.adText}
"""

Audiences:
${audiences}

Line by line:
${lines}`,
    trace,
    label: 'Summarise what to do',
  })
  const valid = new Set(segments.map((s) => s.id))
  return {
    bottomLine: out.bottomLine,
    actions: out.actions.map((a) => ({
      ...a,
      segmentIds: a.segmentIds.filter((id) => valid.has(id)),
      quote: a.quote && locateQuote(brief.adText, a.quote) ? a.quote : null,
    })),
  }
}
