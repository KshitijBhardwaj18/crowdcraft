// Run → one self-contained dashboard page (prd.md > Run Report (HTML)): the ad, KPIs, what to do, results by region and
// age, and per-audience detail with sources and the no-Qloo comparison. Inline CSS and a few lines of JS; no framework.
import type { Arm, Highlight, Reference, Review, Run, Segment } from '../contracts.ts'
import { FIT_FLOOR } from '../engine/judge.ts'
import { lineTally } from '../engine/summary.ts'

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const grade = (score: number) => (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F')

const ARM_LABEL: Record<Arm, string> = {
  crowdcraft: 'CrowdCraft (Qloo taste)',
  ablation: 'Qloo taste, no reference fit',
  b1_named: 'Generic AI: audience name only',
  b2_invented: 'Generic AI: invented persona',
}
const CHANNEL: Record<string, string> = {
  reel: 'Instagram / TikTok reel', preroll: 'YouTube pre-roll', tv: 'TV / streaming spot', audio: 'Radio / podcast', billboard: 'Billboard',
  social: 'Social post', email: 'Email', general: 'General',
}
const VERDICT_RANK = { love: 4, like: 3, meh: 2, skip: 1 } as const
const DOMAIN_LABEL: Record<string, string> = { artist: 'Artists', brand: 'Brands', tv_show: 'Shows', place: 'Places', movie: 'Films', podcast: 'Podcasts' }
const domainOf = (type: string) => type.split(':').pop() ?? type

function sourceNames(run: Run, seg: Segment) {
  const m = new Map<string, string>()
  for (const f of [...seg.fingerprint, ...seg.themes, ...seg.setsApart]) m.set(f.qlooId, f.name)
  for (const r of run.references) if (r.qlooId) m.set(`ref:${r.qlooId}`, `“${r.text}”`)
  return m
}
const chips = (ids: string[], names: Map<string, string>) =>
  ids.map((id) => `<span class="src" title="Qloo source ${esc(id)}">${esc(names.get(id) ?? id)}</span>`).join('')

function highlightedAd(ad: string, hs: Highlight[], names: Map<string, string>, cls = '') {
  let out = ''
  let pos = 0
  for (const h of [...hs].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue // ponytail: overlapping highlights keep the first one
    const why = `${h.effect === 'lands' ? 'Lands' : 'Loses them'}: ${h.reason}${h.sourceIds.length ? ` (${h.sourceIds.map((i) => names.get(i) ?? i).join(', ')})` : ''}`
    out += esc(ad.slice(pos, h.start)) + `<mark class="${h.effect}" title="${esc(why)}" tabindex="0">${esc(ad.slice(h.start, h.end))}</mark>`
    pos = h.end
  }
  return `<pre class="script ${cls}">${out + esc(ad.slice(pos))}</pre>`
}

const pill = (r: Review) => `<span class="verdict v-${r.verdict}">${esc(r.verdict)}</span>`
const gradeBadge = (score: number) => `<span class="grade g-${grade(score)}">${grade(score)}</span>`

function kpis(run: Run, lead: Review[], name: (id: string) => string) {
  if (!lead.length) return ''
  const avg = Math.round(lead.reduce((s, r) => s + r.rankingScore, 0) / lead.length)
  const best = lead[0]
  const worst = lead.at(-1)!
  const positive = lead.filter((r) => r.verdict === 'love' || r.verdict === 'like').length
  const love = lead.filter((r) => r.verdict === 'love').length
  return `<section class="kpis">
  <div class="kpi"><p class="kpi-k">Overall fit</p><p class="kpi-v">${avg}${gradeBadge(avg)}</p><p class="kpi-s">average across ${lead.length} audiences</p></div>
  <div class="kpi"><p class="kpi-k">Best audience</p><p class="kpi-v sm">${esc(name(best.segmentId))}</p><p class="kpi-s">${pill(best)} ${best.rankingScore} · ${esc(best.wouldAct)}</p></div>
  <div class="kpi"><p class="kpi-k">Weakest audience</p><p class="kpi-v sm">${esc(name(worst.segmentId))}</p><p class="kpi-s">${pill(worst)} ${worst.rankingScore} · ${esc(worst.wouldAct)}</p></div>
  <div class="kpi"><p class="kpi-k">Positive response</p><p class="kpi-v">${positive}<span class="of">/${lead.length}</span></p><p class="kpi-s">${love} love it · ${positive - love} like it</p></div>
</section>`
}

function scriptPanel(run: Run, lead: Review[], name: (id: string) => string) {
  const n = new Set(lead.map((r) => r.segmentId)).size
  const lines = lineTally(run.brief.adText, lead)
  return `<section class="panel">
  <header class="ph"><h2>The ad, line by line</h2><p class="muted">${esc(run.brief.adType === 'script' ? 'Script' : 'Ad copy')} · how many of the ${n} audiences each line lands with or loses</p></header>
  <ol class="lines">${lines
    .map((l) => {
      const tip = `Lands: ${l.lands.map(name).join(', ') || 'none'}\nLoses: ${l.loses.map(name).join(', ') || 'none'}`
      const tone = l.loses.length > l.lands.length ? 'neg' : l.lands.length ? 'pos' : 'neu'
      return `<li class="line ${tone}" title="${esc(tip)}"><span class="lt">${esc(l.text)}</span><span class="lc">${
        n ? `<span class="bars"><span class="bl" style="width:${(l.lands.length / n) * 100}%"></span><span class="bx" style="width:${(l.loses.length / n) * 100}%"></span></span>` : ''
      }<span class="nums">${l.lands.length ? `<b class="up">+${l.lands.length}</b>` : ''}${l.loses.length ? `<b class="down">−${l.loses.length}</b>` : ''}${!l.lands.length && !l.loses.length ? '<span class="muted">—</span>' : ''}</span></span></li>`
    })
    .join('')}</ol>
</section>`
}

// The deliverables (prd.md > Deliverables): who to target, what to fix, better versions. First thing on the page.
function deliverables(run: Run, name: (id: string) => string) {
  const t = run.targeting
  const s = run.summary
  if (!t && !s) return ''
  const tags = (ids: string[]) => ids.map((id) => `<a href="#row-${esc(id)}" class="tag" data-open="${esc(id)}">${esc(name(id))}</a>`).join('')
  const target = t
    ? `<section class="panel deliv">
  <header class="ph"><p class="step">1</p><div><h2>Who to target</h2><p class="muted">Paste into Meta or TikTok Ads Manager. Interests come from what Qloo says each audience loves more than the others; check availability in your ad manager.</p></div></header>
  ${t.weakFit ? '<p class="warnbox">No audience is a strong fit yet. Fix the ad first; this is the least-bad option.</p>' : ''}
  ${t.audiences
    .map(
      (a) => `<div class="aud"><div class="aud-h"><b>${esc(a.location)}</b><span class="muted">· ${esc(a.age)}${a.gender ? ` · ${esc(a.gender)}` : ''}</span><span class="spacer"></span>${gradeBadge(a.score)}<span class="budget">${a.budgetPct}% of budget</span></div>
    <p class="ints">${a.interests.map((i) => `<span class="int">${esc(i)}</span>`).join('') || '<span class="muted">No distinctive interests found</span>'}</p></div>`,
    )
    .join('')}
  ${t.skip.length ? `<p class="dk">Don't target</p><ul class="skips">${t.skip.map((x) => `<li><b>${esc(name(x.segmentId))}</b>${x.reason ? `: ${esc(x.reason)}` : ''}</li>`).join('')}</ul>` : ''}
</section>`
    : ''
  const fix = s
    ? `<section class="panel deliv">
  <header class="ph"><p class="step">2</p><div><h2>What to fix</h2><p class="muted">Concrete changes, each with the evidence behind it.</p></div></header>
  <ol class="fixes">${s.fixes
    .map(
      (f) => `<li>${f.line ? `<p class="from">“${esc(f.line)}”</p>` : ''}<p class="to">${esc(f.change)}</p><p class="why">${esc(f.why)}</p>${f.segmentIds.length ? `<p class="tags">${tags(f.segmentIds)}</p>` : ''}</li>`,
    )
    .join('')}</ol>
  ${s.keeps.length ? `<p class="dk">Keep</p><ul class="keeps">${s.keeps.map((k) => `<li>${k.line ? `“${esc(k.line)}” · ` : ''}<span class="muted">${esc(k.why)}</span></li>`).join('')}</ul>` : ''}
</section>`
    : ''
  const versions = run.versions.length
    ? `<section class="panel deliv">
  <header class="ph"><p class="step">3</p><div><h2>Better versions</h2><p class="muted">The agent rewrote the ad for each recommended audience using their real taste, then re-tested it on that audience.</p></div></header>
  <div class="versions">${run.versions
    .map((v) => {
      const after = v.review.rankingScore
      const d = after - v.before
      const jd = v.judgementBefore == null ? null : v.review.judgement - v.judgementBefore
      const parts = [
        jd == null ? null : `judgement ${v.judgementBefore} → ${v.review.judgement} (${jd >= 0 ? '+' : ''}${jd})`,
        v.refFitBefore == null && v.review.refFit == null ? null : `reference fit ${v.refFitBefore ?? '–'} → ${v.review.refFit ?? '–'}`,
      ].filter(Boolean)
      return `<div class="ver"><div class="aud-h"><b>${esc(name(v.segmentId))}</b><span class="spacer"></span><span class="delta ${d >= 0 ? 'up' : 'down'}">${v.before} → ${after} (${d >= 0 ? '+' : ''}${d})</span></div>
      ${parts.length ? `<p class="small muted">${esc(parts.join(' · '))}. Reference fit tends to rise when a rewrite uses the audience's own taste, so the judgement change is the stronger signal.</p>` : ''}
      <pre class="script">${esc(v.adText)}</pre>
      ${v.usedTaste.length ? `<p class="ints"><span class="muted small">Uses their taste:</span> ${v.usedTaste.map((u) => `<span class="int">${esc(u)}</span>`).join('')}</p>` : ''}
      <details class="small"><summary>Their reaction to this version · ${esc(v.review.verdict)} · ${esc(v.review.wouldAct)}</summary><ul class="reaction">${v.review.reaction.map((x) => `<li>${esc(x.sentence)}</li>`).join('')}</ul></details></div>`
    })
    .join('')}</div>
</section>`
    : ''
  return `${s ? `<p class="bottom-line big">${esc(s.bottomLine)}</p>` : ''}<div class="two">${target}${fix}</div>${versions}`
}

function heatmap(run: Run, lead: Review[]) {
  const segs = run.segments.filter((s) => s.region && s.ageBand)
  const regions = [...new Set(segs.map((s) => s.region!))]
  const ages = [...new Set(segs.map((s) => s.ageBand!))]
  if (regions.length < 1 || ages.length < 1 || segs.length < 2) return ''
  const cell = (region: string, age: string) => {
    const seg = segs.find((s) => s.region === region && s.ageBand === age)
    const r = seg && lead.find((x) => x.segmentId === seg.id)
    if (!seg || !r) return '<td class="hm-empty">—</td>'
    return `<td><a href="#row-${esc(seg.id)}" data-open="${esc(seg.id)}" class="hm" style="--s:${r.rankingScore}"><b>${r.rankingScore}</b><span>${grade(r.rankingScore)} · ${esc(r.verdict)}</span></a></td>`
  }
  return `<div class="heat"><p class="kpi-k">Fit by region and age</p><table class="hmt"><thead><tr><th></th>${ages.map((a) => `<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>${regions
    .map((rg) => `<tr><th>${esc(rg)}</th>${ages.map((a) => cell(rg, a)).join('')}</tr>`)
    .join('')}</tbody></table></div>`
}

function detailRow(run: Run, seg: Segment, lead: Review | undefined) {
  const by = (a: Arm) => run.reviews.find((r) => r.segmentId === seg.id && r.arm === a)
  const names = sourceNames(run, seg)
  const others = (['b1_named', 'b2_invented', 'ablation'] as Arm[]).map(by).filter((r): r is Review => !!r && r !== lead)
  const groups = new Map<string, Segment['fingerprint']>()
  for (const f of seg.fingerprint) groups.set(domainOf(f.type), [...(groups.get(domainOf(f.type)) ?? []), f])
  return `<tr class="detail" id="detail-${esc(seg.id)}" hidden><td colspan="7"><div class="dgrid">
  <div>
    <p class="dk">What they said</p>
    ${lead ? `<p class="dv">${pill(lead)} <span class="muted">${esc(lead.wouldAct)}</span></p><ul class="reaction">${lead.reaction
      .map((s) => `<li>${esc(s.sentence)} ${lead.arm === 'b1_named' || lead.arm === 'b2_invented' ? '<span class="src none">unsourced</span>' : chips(s.sourceIds, names)}</li>`)
      .join('')}</ul>` : '<p class="muted">Not judged.</p>'}
    <p class="dk">Their taste (Qloo): what they love more than the other audiences</p>
    ${[...groups]
      .map(([d, fs]) => `<p class="fp"><span class="fpk">${esc(DOMAIN_LABEL[d] ?? d)}</span>${fs.map((f) => `<span class="fpi" title="+${f.distinctiveness.toFixed(2)} vs the other audiences">${f.imageUrl ? `<img src="${esc(f.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(f.name)}</span>`).join('')}</p>`)
      .join('')}
    ${seg.themes.length ? `<p class="fp"><span class="fpk">Themes</span>${seg.themes.map((t) => `<span class="fpi">${esc(t.name)}</span>`).join('')}</p>` : ''}
    ${seg.setsApart.length ? `<p class="fp"><span class="fpk">Stands out</span>${seg.setsApart.map((t) => `<span class="fpi">${esc(t.name)}</span>`).join('')}</p>` : ''}
    ${lead?.dropped.length ? `<details class="small"><summary>${lead.dropped.length} unsourced claims dropped</summary>${lead.dropped.map((d) => `<p class="dropped">${esc(d.text)} (${esc(d.reason)})</p>`).join('')}</details>` : ''}
  </div>
  <div>
    <p class="dk">Their read of the ad <span class="muted">· <mark class="lands">lands</mark> <mark class="loses">loses them</mark> · hover for why</span></p>
    ${lead ? highlightedAd(run.brief.adText, lead.highlights, names) : ''}
    ${others.length ? `<p class="dk">Same audience without Qloo</p>${others
      .map((o) => `<div class="cmp"><p><span class="muted">${esc(ARM_LABEL[o.arm])}</span> ${pill(o)} <span class="muted">${o.rankingScore}</span></p><p class="cmp-t">${esc(o.reaction.map((s) => s.sentence).join(' '))}</p></div>`)
      .join('')}` : ''}
    ${lead ? `<p class="small muted">Score ${lead.rankingScore} = ${lead.refFit == null ? `judgement ${lead.judgement}` : `0.4 × reference fit ${lead.refFit} + 0.6 × judgement ${lead.judgement}`}</p>` : ''}
  </div>
</div></td></tr>`
}

function resultsTable(run: Run, lead: Review[]) {
  const leadFor = (id: string) => lead.find((r) => r.segmentId === id)
  const segs = run.segments.slice().sort((a, b) => (leadFor(b.id)?.rankingScore ?? -1) - (leadFor(a.id)?.rankingScore ?? -1))
  const rows = segs
    .map((s) => {
      const r = leadFor(s.id)
      const into = s.fingerprint.slice(0, 3)
      return `<tr class="row" id="row-${esc(s.id)}" data-id="${esc(s.id)}" data-region="${esc(s.region ?? s.name)}" data-age="${esc(s.ageBand ?? '')}" data-score="${r?.rankingScore ?? -1}" data-verdict="${r ? VERDICT_RANK[r.verdict] : 0}" tabindex="0" aria-expanded="false">
  <td><b>${esc(s.region ?? s.name)}</b>${s.confidence === 'normal' ? '' : ` <span class="warn" title="${esc(s.confidenceNote)}">${esc(s.confidence)} data</span>`}</td>
  <td>${esc(s.ageBand ?? '—')}</td>
  <td>${r ? `<span class="fit">${gradeBadge(r.rankingScore)}<span class="meter"><span style="width:${r.rankingScore}%"></span></span><b>${r.rankingScore}</b></span>` : '—'}</td>
  <td>${r ? pill(r) : '—'}</td>
  <td class="act">${esc(r?.wouldAct ?? '')}</td>
  <td class="into">${into.map((f) => `<span class="mini">${f.imageUrl ? `<img src="${esc(f.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(f.name)}</span>`).join('')}</td>
  <td class="chev" aria-hidden="true">›</td>
</tr>${detailRow(run, s, r)}`
    })
    .join('')
  return `<section class="panel">
  <header class="ph row-h"><div><h2>Results by audience</h2><p class="muted">Click a row for what they said, their taste and the comparison without Qloo. Click a column to sort.</p></div>${heatmap(run, lead)}</header>
  <div class="scroll"><table class="results"><thead><tr>
    <th data-sort="region">Region</th><th data-sort="age">Age</th><th data-sort="score" class="sorted">Fit</th><th data-sort="verdict">Verdict</th><th>Would act</th><th>Into (Qloo)</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table></div>
</section>`
}

function heatPanel(run: Run) {
  if (!run.heat?.length) return ''
  const max = Math.max(...run.heat.map((h) => h.heat))
  const min = Math.min(...run.heat.map((h) => h.heat))
  const w = (x: number) => (max === min ? 100 : 15 + ((x - min) / (max - min)) * 85)
  const tag = { hot: '<span class="role r-hot">tested · strongest</span>', cool: '<span class="role r-cool">tested · contrast</span>', other: '' }
  return `<section class="panel"><header class="ph"><h2>Where the ad's taste is strongest</h2><p class="muted">Qloo heatmap of the ad's references, rolled up to US metros (each map tile weighted by Qloo's popularity score). The audiences tested were picked from here.</p></header>
<ol class="heatlist">${run.heat
    .map((h) => `<li><span class="hl">${esc(h.label)}</span><span class="hb"><span style="width:${w(h.heat)}%" class="${h.role}"></span></span><span class="hv">${h.heat.toFixed(3)}</span>${tag[h.role]}</li>`)
    .join('')}</ol></section>`
}

function referencesPanel(run: Run) {
  if (!run.references.length) return ''
  const head = run.segments.map((s) => `<th>${esc(s.name)}</th>`).join('')
  const rows = run.references.map((r: Reference) => {
    const cells = run.segments
      .map((s) => {
        const v = r.fitBySegment[s.id]
        const gap = Object.values(r.fitBySegment).every((x) => x == null)
        return `<td>${r.qlooId ? (v == null ? (gap ? '<span class="muted">no Qloo signal</span>' : '<span class="nofit">no engagement</span>') : `<span class="fitv" style="--a:${Math.max(0, (v - FIT_FLOOR) / (1 - FIT_FLOOR))}">${v.toFixed(2)}</span>`) : ''}</td>`
      })
      .join('')
    const skew = r.skew
      ? Object.entries(r.skew.age).sort((x, y) => y[1] - x[1]).slice(0, 1).map(([k, v]) => `skews ${k.replace(/_/g, ' ').replace('24 and younger', 'under 25')} (${v > 0 ? '+' : ''}${v.toFixed(2)})`)[0]
      : ''
    return `<tr><td>“${esc(r.text)}”<br><span class="muted small">${r.qlooId ? `${esc(r.resolvedName)} · ${esc(domainOf(r.qlooType ?? ''))}${skew ? ` · ${esc(skew)}` : ''}` : 'not in Qloo'}</span></td>${cells}</tr>`
  })
  return `<section class="panel"><header class="ph"><h2>References in the ad</h2><p class="muted">How much each audience engages with the brands, places and artists the ad mentions (Qloo affinity; “no engagement” means Qloo finds no meaningful affinity)</p></header>
<div class="scroll"><table><thead><tr><th>Reference</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`
}

export function renderReport(run: Run): string {
  const main = run.reviews.filter((r) => r.arm === 'crowdcraft')
  const arm = main.length ? 'crowdcraft' : run.reviews[0]?.arm
  const lead = run.reviews.filter((r) => r.arm === arm).sort((a, b) => b.rankingScore - a.rankingScore)
  const name = (id: string) => run.segments.find((s) => s.id === id)?.name ?? id
  const b = run.brief
  const understood = run.trace.find((e) => e.stage === 'signals' && e.kind === 'decision')?.message.replace(/^Understood the audience as: /, '')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrowdCraft · ${esc(b.brandLine ?? 'Run')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}${DASH_CSS}</style></head><body>
<nav class="appbar"><span class="logo"><span class="mark">◆</span> CrowdCraft</span><span class="crumb">Ad tests / <b>${esc(b.brandLine?.split(',')[0] ?? 'Run')}</b></span><span class="spacer"></span><span class="badge">Directional, not guaranteed</span><span class="muted small">${esc(run.createdAt.slice(0, 16).replace('T', ' '))}</span></nav>
<main>
<header class="page-h">
  <h1>${esc(b.brandLine ?? 'Untitled ad')}</h1>
  <p class="meta"><span class="m">${esc(CHANNEL[b.channel] ?? b.channel)}</span><span class="m">${esc(b.adType === 'script' ? 'Script' : 'Ad copy')}</span><span class="m">${esc([b.market.city, b.market.region, b.market.country].filter(Boolean).join(', '))}</span><span class="m">Target: ${esc(b.target.text)}</span></p>
  ${understood ? `<p class="muted small">Agent's read of the audience: ${esc(understood)}</p>` : ''}
  ${b.unused.length ? `<p class="muted small">Not used: ${b.unused.map((u) => `${esc(u.phrase)} (${esc(u.reason)})`).join('; ')}</p>` : ''}
</header>
${run.errors.length ? `<div class="errors">${run.errors.map((e) => `<p>⚠ ${esc(e.stage)}: ${esc(e.message)}</p>`).join('')}</div>` : ''}
${deliverables(run, name)}
<h2 class="section-h">The evidence</h2>
${kpis(run, lead, name)}
${scriptPanel(run, lead, name)}
${resultsTable(run, lead)}
<div class="two">${heatPanel(run) || '<div></div>'}${referencesPanel(run) || '<div></div>'}</div>
<section class="panel"><details><summary><b>How the agent worked</b> <span class="muted">· ${run.trace.length} steps · ${run.usage.qlooCalls} Qloo calls · ${run.usage.llmCalls} AI calls · $${run.usage.costUsd.toFixed(4)} · ${(run.usage.ms / 1000).toFixed(0)}s</span></summary>
<ol class="trace">${run.trace
    .map((e) => `<li class="k-${e.kind}"><span class="t">${(e.t / 1000).toFixed(1)}s</span><span class="stage">${esc(e.stage)}</span>${esc(e.message)}</li>`)
    .join('')}</ol></details></section>
<footer class="muted small">CrowdCraft · audience taste from Qloo · reviews simulated by AI from that taste data · directional, not guaranteed</footer>
</main>
<script>${JS}</script>
</body></html>`
}

const JS = `
const open = (id, scroll) => {
  const row = document.getElementById('row-' + id), d = document.getElementById('detail-' + id)
  if (!row || !d) return
  const show = d.hidden
  d.hidden = !show; row.setAttribute('aria-expanded', String(show)); row.classList.toggle('open', show)
  if (show && scroll) row.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
document.querySelectorAll('tr.row').forEach((r) => {
  r.addEventListener('click', () => open(r.dataset.id))
  r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.dataset.id) } })
})
document.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault(); const d = document.getElementById('detail-' + a.dataset.open); if (d && d.hidden) open(a.dataset.open, true); else document.getElementById('row-' + a.dataset.open)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}))
document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.sort, tbody = th.closest('table').tBodies[0]
  const desc = th.classList.contains('sorted') && !th.classList.contains('desc') ? false : key === 'score' || key === 'verdict'
  const asc = th.classList.contains('sorted') ? th.classList.contains('desc') : !desc
  const pairs = [...tbody.querySelectorAll('tr.row')].map((r) => [r, r.nextElementSibling])
  pairs.sort(([a], [b]) => { const x = a.dataset[key], y = b.dataset[key]; const c = isNaN(+x) || isNaN(+y) ? x.localeCompare(y) : +x - +y; return asc ? c : -c })
  pairs.forEach(([r, d]) => tbody.append(r, d))
  th.parentElement.querySelectorAll('th').forEach((h) => h.classList.remove('sorted', 'desc'))
  th.classList.add('sorted'); if (!asc) th.classList.add('desc')
}))
`

// Shared base styles (the eval scorecard and coverage probe pages use them too).
export const CSS = `
:root{--bg:#f5f6f8;--surface:#ffffff;--ink:#0d1321;--muted:#5f6b7a;--line:#e3e7ed;--soft:#f0f2f5;--accent:#0b7a75;--accent-soft:#e3f2f1;--love:#15803d;--like:#0e7490;--meh:#6b7280;--skip:#c2410c;--lands:#dcfce7;--loses:#ffe4d6;--shadow:0 1px 2px rgba(13,19,33,.05),0 4px 16px -8px rgba(13,19,33,.12)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0c0f14;--surface:#141922;--ink:#e8ecf2;--muted:#8d98a8;--line:#252c38;--soft:#1b212b;--accent:#2dd4bf;--accent-soft:#12302d;--love:#4ade80;--like:#22d3ee;--meh:#9ca3af;--skip:#fb923c;--lands:#14361f;--loses:#3d2213;--shadow:0 1px 2px rgba(0,0,0,.4)}}
:root[data-theme=dark]{--bg:#0c0f14;--surface:#141922;--ink:#e8ecf2;--muted:#8d98a8;--line:#252c38;--soft:#1b212b;--accent:#2dd4bf;--accent-soft:#12302d;--love:#4ade80;--like:#22d3ee;--meh:#9ca3af;--skip:#fb923c;--lands:#14361f;--loses:#3d2213}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:14.5px/1.5 Geist,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1240px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:15px;margin:0;letter-spacing:-.01em}
a{color:inherit}.eyebrow{font:500 12px/1 "Geist Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0}
.note{color:var(--muted);font-size:13.5px}.small{font-size:12.5px}.muted{color:var(--muted)}
.v-love{color:var(--love)}.v-like{color:var(--like)}.v-meh{color:var(--meh)}.v-skip{color:var(--skip)}
.errors{border:1px solid var(--skip);background:var(--loses);border-radius:10px;padding:8px 14px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}
th{font:500 11.5px/1.3 "Geist Mono",monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:var(--soft)}
code{font-family:"Geist Mono",monospace;font-size:.92em;background:var(--soft);padding:1px 5px;border-radius:4px}
pre{overflow-x:auto}
`

const DASH_CSS = `
.appbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--line)}
.logo{font-weight:700;letter-spacing:-.01em}.mark{color:var(--accent)}.crumb{color:var(--muted);font-size:13px}.crumb b{color:var(--ink);font-weight:600}.spacer{flex:1}
.badge{font-size:11.5px;font-weight:500;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:3px 10px}
.page-h{margin:8px 0 18px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}.m{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:2px 9px;font-size:12.5px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}
.kpi,.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
.kpi{padding:14px 16px}.kpi-k{margin:0 0 6px;font:500 11.5px "Geist Mono",monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.kpi-v{margin:0;font-size:30px;font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}.kpi-v.sm{font-size:18px;line-height:1.25}.of{font-size:18px;color:var(--muted);font-weight:500}
.kpi-s{margin:6px 0 0;font-size:12.5px;color:var(--muted)}
.grade{display:inline-grid;place-items:center;min-width:26px;height:26px;border-radius:7px;font:700 13px Geist,sans-serif;color:#fff}
.g-A{background:var(--love)}.g-B{background:var(--like)}.g-C{background:#a16207}.g-D{background:var(--skip)}.g-F{background:#991b1b}
.verdict{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;text-transform:capitalize;border:1px solid currentColor}
.verdict.v-love{color:var(--love)}.verdict.v-like{color:var(--like)}.verdict.v-meh{color:var(--meh)}.verdict.v-skip{color:var(--skip)}
.two{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:12px;margin-bottom:12px}
@media (max-width:900px){.two{grid-template-columns:1fr}}
.panel{padding:16px;margin-bottom:12px}.ph{margin-bottom:12px}.ph p{margin:3px 0 0;font-size:12.5px}
.row-h{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start}
.lines{list-style:none;margin:0;padding:0;counter-reset:l}
.line{display:grid;grid-template-columns:1fr 170px;gap:12px;align-items:center;padding:8px 10px;border-radius:8px;border-left:3px solid transparent;cursor:help}
.line+.line{margin-top:2px}.line:hover{background:var(--soft)}
.line.pos{border-left-color:var(--love)}.line.neg{border-left-color:var(--skip);background:color-mix(in srgb,var(--loses) 45%,transparent)}
.lt{font-size:14px}.lc{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.bars{flex:1;height:6px;background:var(--soft);border-radius:3px;display:flex;overflow:hidden}.bl{background:var(--love)}.bx{background:var(--skip)}
.nums{display:flex;gap:6px;min-width:52px;justify-content:flex-end;font:500 12px "Geist Mono",monospace}.up{color:var(--love)}.down{color:var(--skip)}
.bottom-line{margin:0 0 12px;font-size:15px;font-weight:600;line-height:1.45}
.actions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.actions li{display:grid;grid-template-columns:56px 1fr;gap:10px;align-items:start}.actions p{margin:0}
.kind{font:600 11px Geist,sans-serif;text-transform:uppercase;letter-spacing:.04em;text-align:center;border-radius:6px;padding:3px 0}
.k-keep{background:var(--lands);color:var(--love)}.k-fix{background:var(--loses);color:var(--skip)}.k-try{background:#fef3c7;color:#92400e}.k-spend{background:var(--accent-soft);color:var(--accent)}.k-skip{background:var(--soft);color:var(--muted)}
.q{font-size:12.5px;color:var(--muted);font-style:italic;margin-top:2px!important}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px!important}.tag{font-size:11.5px;background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:0 6px;text-decoration:none}
.tag:hover{border-color:var(--accent);color:var(--accent)}
.heat .hmt{width:auto;font-size:12px}.hmt th,.hmt td{border:none;padding:3px;background:none}.hmt tbody th{text-align:right;font-family:Geist,sans-serif;text-transform:none;letter-spacing:0;color:var(--ink);font-size:12.5px;padding-right:8px}
.hm{display:flex;flex-direction:column;align-items:center;justify-content:center;width:86px;height:46px;border-radius:8px;text-decoration:none;color:#fff;background:color-mix(in srgb,var(--love) calc(var(--s) * 1%),var(--skip))}
.hm b{font-size:16px;line-height:1}.hm span{font-size:10.5px;opacity:.9;text-transform:capitalize}.hm-empty{color:var(--muted);text-align:center}
.scroll{overflow-x:auto}
.results th[data-sort]{cursor:pointer;user-select:none}.results th.sorted::after{content:" ↑"}.results th.sorted.desc::after{content:" ↓"}
.results .row{cursor:pointer}.results .row:hover td{background:var(--soft)}.results .row.open td{background:var(--accent-soft);border-bottom-color:transparent}
.results .row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.fit{display:flex;align-items:center;gap:8px}.meter{width:70px;height:6px;background:var(--soft);border-radius:3px;overflow:hidden}.meter span{display:block;height:100%;background:var(--accent)}
.act{color:var(--muted);max-width:200px}.into{min-width:220px}
.mini{display:inline-flex;align-items:center;gap:5px;font-size:12px;background:var(--soft);border-radius:999px;padding:1px 8px 1px 2px;margin:1px 3px 1px 0}
.mini img,.fpi img{width:18px;height:18px;border-radius:50%;object-fit:cover}
.chev{color:var(--muted);font-size:18px;transition:transform .2s}.row.open .chev{transform:rotate(90deg)}
.warn{font-size:11px;color:var(--skip);border:1px solid currentColor;border-radius:4px;padding:0 4px}
.detail>td{background:var(--surface);padding:6px 10px 18px}
.dgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}@media (max-width:900px){.dgrid{grid-template-columns:1fr}}
.dk{margin:14px 0 6px;font:500 11.5px "Geist Mono",monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.dv{margin:0 0 4px}
.reaction{margin:0;padding-left:18px}.reaction li{margin:6px 0}
.src{display:inline-block;font:500 10.5px/1.7 "Geist Mono",monospace;background:var(--accent-soft);color:var(--accent);border-radius:4px;padding:0 5px;margin:1px 2px;white-space:nowrap}
.src.none{background:var(--soft);color:var(--muted)}
.fp{margin:4px 0;display:flex;flex-wrap:wrap;gap:5px;align-items:center}.fpk{font-size:12px;color:var(--muted);min-width:70px}
.fpi{display:inline-flex;align-items:center;gap:5px;background:var(--soft);border-radius:999px;padding:2px 9px 2px 3px;font-size:12.5px}.fpi:not(:has(img)){padding-left:9px}
.script{white-space:pre-wrap;font:13.5px/1.65 "Geist Mono",ui-monospace,monospace;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:0}
mark{color:inherit;border-radius:3px;padding:1px 2px;cursor:help}mark.lands{background:var(--lands);box-shadow:inset 0 -2px 0 var(--love)}mark.loses{background:var(--loses);box-shadow:inset 0 -2px 0 var(--skip)}
.cmp{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px}.cmp p{margin:0}.cmp-t{font-size:13px;margin-top:4px!important}
.dropped{color:var(--muted);text-decoration:line-through;margin:4px 0}
.trace{font-size:12.5px;padding-left:22px;margin:12px 0 0}.trace li{margin:3px 0}.trace .t{font:12px "Geist Mono",monospace;color:var(--muted);margin-right:8px}
.trace .stage{font:500 11px "Geist Mono",monospace;background:var(--soft);border-radius:4px;padding:1px 6px;margin-right:8px}.trace .k-error{color:var(--skip)}.trace .k-decision{font-weight:500}
details summary{cursor:pointer}
footer{margin-top:28px;text-align:center}
.bottom-line.big{font-size:19px;font-weight:600;line-height:1.4;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:14px 18px;margin:0 0 12px;box-shadow:var(--shadow)}
.deliv .ph{display:flex;gap:12px;align-items:flex-start}.step{margin:0;flex:none;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px}
.section-h{margin:28px 0 12px;font-size:13px;font-family:"Geist Mono",monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.aud,.ver{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}.aud-h{display:flex;gap:8px;align-items:center}.aud-h .spacer{flex:1}
.budget{font:600 12px "Geist Mono",monospace;background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:2px 8px}
.ints{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0}.int{font-size:12.5px;background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:1px 9px}
.skips,.keeps{margin:0;padding-left:18px;font-size:13.5px}.skips li,.keeps li{margin:4px 0}
.warnbox{background:var(--loses);border-radius:8px;padding:8px 12px;margin:0 0 10px;font-size:13.5px}
.fixes{margin:0;padding-left:20px}.fixes li{margin:0 0 12px}.fixes p{margin:0}.from{color:var(--skip);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--skip) 50%,transparent);font-size:13px}
.to{font-weight:600;margin-top:2px!important}.why{font-size:12.5px;color:var(--muted);margin-top:2px!important}
.versions{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}.ver .script{margin-top:8px}
.delta{font:600 13px "Geist Mono",monospace;border-radius:6px;padding:2px 8px}.delta.up{background:var(--lands);color:var(--love)}.delta.down{background:var(--loses);color:var(--skip)}
.heatlist{list-style:none;margin:0;padding:0}.heatlist li{display:grid;grid-template-columns:150px 1fr 48px auto;gap:10px;align-items:center;padding:5px 0;font-size:13.5px}
.hb{height:8px;background:var(--soft);border-radius:4px;overflow:hidden}.hb span{display:block;height:100%;background:color-mix(in srgb,var(--accent) 45%,transparent)}.hb .hot{background:var(--love)}.hb .cool{background:var(--skip)}
.hv{font:500 12px "Geist Mono",monospace;color:var(--muted);text-align:right}.role{font-size:11px;border-radius:5px;padding:1px 6px;white-space:nowrap}.r-hot{background:var(--lands);color:var(--love)}.r-cool{background:var(--loses);color:var(--skip)}
.fitv{display:inline-block;min-width:44px;text-align:center;border-radius:5px;padding:1px 6px;font:500 12px "Geist Mono",monospace;background:color-mix(in srgb,var(--love) calc(var(--a) * 70%),var(--soft))}.nofit{font-size:12px;color:var(--skip)}
`
