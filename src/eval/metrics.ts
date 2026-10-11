// Every PRD eval metric, the go/no-go rule, and the scorecard (prd.md > Eval Command and Scorecard).
import type { Arm, EvalAd, Review, Run, Verdict } from '../contracts.ts'
import { CSS, esc } from '../report/render.ts'
import type { Grade } from './grader.ts'

export type EvalCase = { ad: EvalAd; runs: Run[]; reportPaths: string[] } // runs[i] = repetition i+1
export type Blind = { judged: number; ties: number; wins: Partial<Record<Arm, number>>; arms: Arm[] } | null
export type Metric = {
  id: string
  label: string
  target: string
  values: Partial<Record<Arm, string>>
  pass: boolean | null // null = not measurable yet
  note?: string
}

const BASELINES: Arm[] = ['b1_named', 'b2_invented']
const VERDICTS: Verdict[] = ['love', 'like', 'meh', 'skip']
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const reviewsOf = (run: Run, arm: Arm) => run.reviews.filter((r) => r.arm === arm)
const reviewOf = (run: Run, arm: Arm, seg: string | null) => run.reviews.find((r) => r.arm === arm && r.segmentId === seg)

// 1 if the segment ranks strictly first for this arm, 1/n if tied with n-1 others at the top, else 0.
export function firstCredit(reviews: Review[], seg: string | null): number {
  if (!reviews.length || !seg) return 0
  const top = Math.max(...reviews.map((r) => r.rankingScore))
  const tied = reviews.filter((r) => r.rankingScore === top)
  return tied.some((r) => r.segmentId === seg) ? 1 / tied.length : 0
}

export function spreadOk(reviews: Review[]): boolean {
  if (reviews.length < 2) return false
  const sorted = [...reviews].sort((a, b) => b.rankingScore - a.rankingScore)
  const [top, bottom] = [sorted[0], sorted.at(-1)!]
  return top.rankingScore - bottom.rankingScore >= 25 && top.verdict !== bottom.verdict
}

// Does any span land for one segment and lose for another (overlapping text)?
export function highlightFlip(reviews: Review[]): boolean {
  const all = reviews.flatMap((r) => r.highlights.map((h) => ({ ...h, seg: r.segmentId })))
  return all.some((x) => all.some((y) => x.seg !== y.seg && x.effect !== y.effect && x.start < y.end && y.start < x.end))
}

export function mismatchCaught(reviews: Review[], intended: string | null, actual: string | null): boolean {
  const i = reviews.find((r) => r.segmentId === intended)
  const a = reviews.find((r) => r.segmentId === actual)
  return !!i && !!a && (i.verdict === 'meh' || i.verdict === 'skip') && a.rankingScore > i.rankingScore
}

export function computeMetrics(cases: EvalCase[], arms: Arm[], grades: Map<string, Grade>, blind: Blind) {
  const scored = cases.filter((c) => c.ad.tier !== 'demo')
  const atoc = scored.filter((c) => ['A', 'B', 'C'].includes(c.ad.tier))
  const bc = scored.filter((c) => ['B', 'C'].includes(c.ad.tier))
  const d = scored.filter((c) => c.ad.tier === 'D')
  const cTier = scored.filter((c) => c.ad.tier === 'C')
  const has = (arm: Arm) => arms.includes(arm)
  const per = (fn: (arm: Arm) => number | null) => Object.fromEntries(arms.map((a) => [a, fn(a)])) as Record<Arm, number | null>
  const r1 = (c: EvalCase, arm: Arm) => reviewsOf(c.runs[0], arm)

  const accuracy = per((arm) => mean(atoc.map((c) => firstCredit(r1(c, arm), c.ad.intendedSegmentId))))
  const accuracyBC = per((arm) => mean(bc.map((c) => firstCredit(r1(c, arm), c.ad.intendedSegmentId))))
  const verdictFit = per((arm) =>
    mean(atoc.map((c) => (['love', 'like'].includes(reviewOf(c.runs[0], arm, c.ad.intendedSegmentId)?.verdict ?? '') ? 1 : 0))),
  )
  const mismatch = per((arm) => mean(d.map((c) => (mismatchCaught(r1(c, arm), c.ad.intendedSegmentId, c.ad.actualFitSegmentId) ? 1 : 0))))
  const spread = per((arm) => mean(scored.map((c) => (spreadOk(r1(c, arm)) ? 1 : 0))))
  const flips = per((arm) => mean(cTier.map((c) => (highlightFlip(r1(c, arm)) ? 1 : 0))))

  // Stability: the same ad and segments, repetition 1 vs 2.
  const pairs = (arm: Arm) =>
    scored.flatMap((c) =>
      c.runs.length < 2
        ? []
        : r1(c, arm).flatMap((a) => {
            const b = reviewOf(c.runs[1], arm, a.segmentId)
            return b ? [{ d: Math.abs(a.rankingScore - b.rankingScore), v: Math.abs(VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict)) }] : []
          }),
    )
  const stable = per((arm) => mean(pairs(arm).map((p) => (p.d <= 5 && p.v <= 1 ? 1 : 0))))
  const drift = per((arm) => mean(pairs(arm).map((p) => p.d)))

  // Specificity from the grader (repetition 1 only).
  const specificity = per((arm) =>
    mean(scored.flatMap((c) => r1(c, arm).map((r) => grades.get(gradeKey(c.ad.id, r.segmentId, arm))?.specific ?? NaN)).filter((x) => !isNaN(x))),
  )
  const genericity = per((arm) =>
    mean(scored.flatMap((c) => r1(c, arm).map((r) => grades.get(gradeKey(c.ad.id, r.segmentId, arm))?.generic ?? NaN)).filter((x) => !isNaN(x))),
  )

  // Sourcing (grounded arms): every shown claim has a source; report how much was dropped.
  const shown = (arm: Arm) => scored.flatMap((c) => r1(c, arm)).flatMap((r) => [...r.reaction, ...r.highlights])
  const droppedCount = (arm: Arm) => scored.flatMap((c) => r1(c, arm)).reduce((s, r) => s + r.dropped.length, 0)
  const sourced = per((arm) => (['crowdcraft', 'ablation'].includes(arm) ? mean(shown(arm).map((x) => (x.sourceIds.length ? 1 : 0))) : null))

  const bestBaseline = (m: Record<Arm, number | null>) => Math.max(...BASELINES.filter(has).map((a) => m[a] ?? 0), 0)
  const cc = has('crowdcraft')
  const specRatio = cc && specificity.crowdcraft != null ? specificity.crowdcraft / Math.max(bestBaseline(specificity), 0.01) : null
  const blindRate =
    blind && blind.judged && blind.arms.includes('crowdcraft') ? ((blind.wins.crowdcraft ?? 0) + blind.ties / 2) / blind.judged : null

  const fmt = (m: Record<Arm, number | null>, f: (x: number | null) => string = pct) =>
    Object.fromEntries(arms.map((a) => [a, f(m[a])])) as Partial<Record<Arm, string>>
  const num = (x: number | null) => (x == null ? '—' : x.toFixed(1))
  const ccPass = (ok: (x: number) => boolean, m: Record<Arm, number | null>) => (cc && m.crowdcraft != null ? ok(m.crowdcraft) : null)

  const metrics: Metric[] = [
    { id: 'accuracy', label: 'Accuracy: intended segment ranks first (Tiers A–C)', target: 'CrowdCraft ≥ 75%', values: fmt(accuracy), pass: ccPass((x) => x >= 0.75, accuracy) },
    { id: 'accuracy_bc', label: 'Accuracy on the hard tiers (B and C)', target: 'CrowdCraft beats the best baseline', values: fmt(accuracyBC), pass: ccPass((x) => x > bestBaseline(accuracyBC), accuracyBC) },
    { id: 'verdict_fit', label: 'Verdict fit: intended segment gets Love or Like (Tiers A–C)', target: 'CrowdCraft ≥ 75%', values: fmt(verdictFit), pass: ccPass((x) => x >= 0.75, verdictFit) },
    { id: 'mismatch', label: "Mismatch caught: brief's target gets Meh/Skip and the real fit ranks higher (Tier D)", target: 'CrowdCraft ≥ 2 of 3 and beats the best baseline', values: fmt(mismatch), pass: ccPass((x) => x >= 2 / 3 - 1e-9 && x > bestBaseline(mismatch), mismatch) },
    { id: 'spread', label: 'Spread: top vs bottom segment ≥ 25 points, different verdicts', target: 'CrowdCraft on most ads (> 50%)', values: fmt(spread), pass: ccPass((x) => x > 0.5, spread) },
    { id: 'stability', label: 'Stability: same ad twice, score within ±5 and verdict ≤ 1 step', target: 'CrowdCraft ≥ 90% of pairs; baselines reported', values: Object.fromEntries(arms.map((a) => [a, `${pct(stable[a])} (avg drift ${num(drift[a])})`])), pass: ccPass((x) => x >= 0.9, stable) },
    { id: 'sourcing', label: 'Sourcing: shown claims and highlights with a valid source', target: 'CrowdCraft 100%', values: Object.fromEntries(arms.map((a) => [a, sourced[a] == null ? 'unsourced' : `${pct(sourced[a])} (${droppedCount(a)} dropped)`])), pass: ccPass((x) => x === 1, sourced) },
    { id: 'specificity', label: 'Specificity: specific taste claims per reaction (Claude-graded)', target: 'CrowdCraft ≥ 2× the best baseline', values: Object.fromEntries(arms.map((a) => [a, `${num(specificity[a])} specific / ${num(genericity[a])} generic`])), pass: specRatio == null ? null : specRatio >= 2, note: specRatio == null ? undefined : `ratio ${specRatio.toFixed(2)}×` },
    { id: 'blind', label: 'Blind preference: CrowdCraft vs the best baseline', target: 'CrowdCraft wins ≥ 70% (ties count half)', values: blind ? Object.fromEntries(blind.arms.map((a) => [a, `${blind.wins[a] ?? 0} wins`])) : {}, pass: blindRate == null ? null : blindRate >= 0.7, note: blind ? `${blind.judged} judged, ${blind.ties} ties${blindRate == null ? '' : `, ${pct(blindRate)}`}` : 'not rated yet' },
    { id: 'flip', label: 'Highlight flip: a line lands for one segment and loses for another (Tier C)', target: 'CrowdCraft on every Tier C ad', values: fmt(flips), pass: ccPass((x) => x === 1, flips) },
  ]
  return { metrics, verdict: goNoGo(metrics, cc) }
}

export const gradeKey = (ad: string, seg: string, arm: Arm) => `${ad}|${seg}|${arm}`

// prd.md > Go / no-go. Segmentation joins the gates when slice 4 lands.
export function goNoGo(metrics: Metric[], hasCrowdcraft: boolean): { verdict: string; why: string } {
  if (!hasCrowdcraft) return { verdict: 'PENDING', why: 'The Qloo-grounded arm has not run yet (needs Qloo segments).' }
  const m = (id: string) => metrics.find((x) => x.id === id)?.pass ?? null
  const gates = ['stability', 'sourcing'].filter((g) => m(g) === false)
  if (gates.length) return { verdict: 'NOT YET', why: `Gate failing: ${gates.join(', ')}. Fix before judging the result.` }
  const unmeasured = ['stability', 'sourcing'].filter((g) => m(g) === null)
  if (unmeasured.length) return { verdict: 'PENDING', why: `Gate not measured: ${unmeasured.join(', ')} (e.g. run with --reps 2).` }
  const wins = ['accuracy_bc', 'mismatch', 'specificity', 'blind'].filter((w) => m(w) === true)
  const open = ['accuracy_bc', 'mismatch', 'specificity', 'blind'].filter((w) => m(w) === null)
  const reframed = m('specificity') === true && m('blind') === true && m('accuracy_bc') !== true && m('mismatch') !== true
  if (reframed && !open.length) return { verdict: 'GO, reframed', why: 'Accuracy and mismatch don\'t beat the baselines, but specificity and preference win: pitch "explains why, with real taste", not "predicts better".' }
  if (wins.length >= 2) return { verdict: 'GO', why: `CrowdCraft wins on ${wins.join(', ')}.` }
  if (open.length) return { verdict: 'PENDING', why: `Waiting on ${open.join(', ')}. Wins so far: ${wins.join(', ') || 'none'}.` }
  if (m('specificity') === false && m('blind') === false) return { verdict: 'NO-GO', why: 'CrowdCraft does not beat the baselines on specificity or preference. Rethink how Qloo is used.' }
  return { verdict: 'NO-GO', why: `Only ${wins.length} win(s): ${wins.join(', ') || 'none'}.` }
}

const ARM_SHORT: Record<Arm, string> = { crowdcraft: 'CrowdCraft', ablation: 'Ablation', b1_named: 'B1 named', b2_invented: 'B2 invented' }

export function renderScorecard(cases: EvalCase[], arms: Arm[], result: ReturnType<typeof computeMetrics>, meta: { createdAt: string; costUsd: number; minutes: number }) {
  const { metrics, verdict } = result
  const tone = verdict.verdict.startsWith('GO') ? 'love' : verdict.verdict === 'NO-GO' ? 'skip' : 'meh'
  const mark = (p: boolean | null) => (p == null ? '<span class="muted">pending</span>' : p ? '✓' : '<b class="v-skip">✗</b>')
  const metricRows = metrics
    .map((m) => `<tr><td>${esc(m.label)}${m.note ? `<br><span class="small">${esc(m.note)}</span>` : ''}</td><td class="small">${esc(m.target)}</td>${arms.map((a) => `<td>${esc(m.values[a] ?? '—')}</td>`).join('')}<td>${mark(m.pass)}</td></tr>`)
    .join('')
  const caseRows = cases
    .map((c) => {
      const cells = arms.map((a) => {
        const rs = reviewsOf(c.runs[0], a)
        if (!rs.length) return '<td class="muted">—</td>'
        const top = [...rs].sort((x, y) => y.rankingScore - x.rankingScore)[0]
        const hit = c.ad.intendedSegmentId && top.segmentId === c.ad.intendedSegmentId
        const i = rs.find((r) => r.segmentId === c.ad.intendedSegmentId)
        return `<td>${hit ? '✓ ' : ''}${esc(top.segmentId)}${i ? `<br><span class="small">target: <span class="v-${i.verdict}"><b>${i.verdict}</b></span> ${i.rankingScore}</span>` : ''}</td>`
      })
      const failed = c.runs.reduce((n, r) => n + r.errors.length, 0)
      return `<tr><td><a href="${esc(c.reportPaths[0])}">${esc(c.ad.id)}</a>${failed ? `<br><span class="v-skip small">${failed} failed reviews</span>` : ''}</td><td>${esc(c.ad.tier)}</td><td class="small">${esc(c.ad.intendedSegmentId ?? '—')}${c.ad.actualFitSegmentId ? `<br>real fit: ${esc(c.ad.actualFitSegmentId)}` : ''}</td>${cells.join('')}</tr>`
    })
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CrowdCraft Eval Scorecard</title><style>${CSS}</style></head><body><main>
<p class="eyebrow">CrowdCraft eval · ${esc(meta.createdAt.slice(0, 16).replace('T', ' '))} · ${cases.length} ads · $${meta.costUsd.toFixed(3)} · ${meta.minutes.toFixed(0)} min</p>
<h1><span class="v-${tone}"><b>${esc(verdict.verdict)}</b></span></h1>
<p>${esc(verdict.why)}</p>
<h2>Metrics</h2>
<table><thead><tr><th>Metric</th><th>Target</th>${arms.map((a) => `<th>${ARM_SHORT[a]}</th>`).join('')}<th>Pass</th></tr></thead><tbody>${metricRows}</tbody></table>
<h2>Per ad (repetition 1): top-ranked segment per arm</h2>
<table><thead><tr><th>Ad</th><th>Tier</th><th>Intended</th>${arms.map((a) => `<th>${ARM_SHORT[a]}</th>`).join('')}</tr></thead><tbody>${caseRows}</tbody></table>
<p class="note">Blind preference: fill the <code>choice</code> column (A, B or tie) in <code>blind-pairs.csv</code>, then run <code>npm run cc -- eval score &lt;this folder&gt;</code>.</p>
</main></body></html>`
}
