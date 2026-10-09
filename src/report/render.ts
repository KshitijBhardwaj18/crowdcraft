// Run → one self-contained HTML file (prd.md > Run Report (HTML)). Verdict first, Qloo detail below.
import type { Arm, Highlight, Reference, Review, Run, Segment } from '../contracts.ts'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const ARM_LABEL: Record<Arm, string> = {
  crowdcraft: 'CrowdCraft (Qloo-grounded)',
  ablation: 'Ablation (Qloo taste, no reference fit)',
  b1_named: 'B1: Named persona (no data)',
  b2_invented: 'B2: AI-invented persona',
}
const ARM_ORDER: Arm[] = ['crowdcraft', 'ablation', 'b1_named', 'b2_invented']

function sourceNames(run: Run, seg: Segment) {
  const m = new Map<string, string>()
  for (const f of [...seg.fingerprint, ...seg.themes, ...seg.setsApart]) m.set(f.qlooId, f.name)
  for (const r of run.references) if (r.qlooId) m.set(`ref:${r.qlooId}`, `"${r.text}" fit`)
  return m
}

const chips = (ids: string[], names: Map<string, string>) =>
  ids.map((id) => `<span class="chip" title="${esc(id)}">${esc(names.get(id) ?? id)}</span>`).join('')

function highlightedAd(ad: string, hs: Highlight[], names: Map<string, string>) {
  let out = ''
  let pos = 0
  for (const h of [...hs].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue // ponytail: overlapping highlights keep the first one
    const why = `${h.reason}${h.sourceIds.length ? ` — ${h.sourceIds.map((i) => names.get(i) ?? i).join(', ')}` : ''}`
    out += esc(ad.slice(pos, h.start)) + `<mark class="${h.effect}" title="${esc(why)}">${esc(ad.slice(h.start, h.end))}</mark>`
    pos = h.end
  }
  return `<pre class="ad">${out + esc(ad.slice(pos))}</pre>`
}

function reviewCard(run: Run, seg: Segment, r: Review) {
  const names = sourceNames(run, seg)
  const unsourced = r.arm === 'b1_named' || r.arm === 'b2_invented'
  const specific = r.reaction.length
  return `<div class="review ${r.arm}">
  <div class="arm">${esc(ARM_LABEL[r.arm])}</div>
  <div class="verdict-row"><span class="verdict v-${r.verdict}">${esc(r.verdict)}</span><span class="act">${esc(r.wouldAct)}</span></div>
  <div class="reaction">${r.reaction
    .map((s) => `<p>${esc(s.sentence)} ${unsourced ? '<span class="chip muted">unsourced</span>' : chips(s.sourceIds, names)}</p>`)
    .join('')}</div>
  ${highlightedAd(run.brief.adText, r.highlights, names)}
  <details class="small"><summary>Score ${r.rankingScore} · ${specific} claims shown${r.dropped.length ? ` · ${r.dropped.length} dropped` : ''}</summary>
    <p>Judgement ${r.judgement}${r.refFit == null ? '' : ` · reference fit ${r.refFit} · ranking = 0.4 × fit + 0.6 × judgement`}</p>
    ${r.dropped.map((d) => `<p class="dropped">Dropped ${esc(d.kind)}: “${esc(d.text)}” (${esc(d.reason)})</p>`).join('')}
    ${r.inventedPersona ? `<p><b>Invented persona:</b> ${esc(r.inventedPersona.bio)}<br>${esc(r.inventedPersona.favourites.map((f) => f.name).join(', '))}</p>` : ''}
  </details>
</div>`
}

function segmentBlock(run: Run, seg: Segment) {
  const reviews = ARM_ORDER.map((a) => run.reviews.find((r) => r.segmentId === seg.id && r.arm === a)).filter(
    (r): r is Review => !!r,
  )
  const fp = seg.fingerprint
    .map(
      (f) =>
        `<span class="item" title="${esc(f.type)} · affinity ${f.affinity ?? 'n/a'} · distinctiveness ${f.distinctiveness.toFixed(2)}">${
          f.imageUrl ? `<img src="${esc(f.imageUrl)}" alt="" loading="lazy">` : ''
        }${esc(f.name)}</span>`,
    )
    .join('')
  return `<section class="segment" id="seg-${esc(seg.id)}">
  <h3>${esc(seg.name)} ${seg.confidence === 'normal' ? '' : `<span class="chip warn" title="${esc(seg.confidenceNote)}">${esc(seg.confidence)}</span>`}</h3>
  <p class="small">Defined by: ${esc(seg.definedBy.join(' · '))}</p>
  <div class="fingerprint">${fp}</div>
  ${seg.themes.length ? `<p class="small">Themes: ${esc(seg.themes.map((t) => t.name).join(', '))}</p>` : ''}
  ${seg.setsApart.length ? `<p class="small">Sets them apart: ${esc(seg.setsApart.map((t) => t.name).join(', '))}</p>` : ''}
  <div class="reviews">${reviews.map((r) => reviewCard(run, seg, r)).join('')}</div>
</section>`
}

function referencesTable(run: Run) {
  if (!run.references.length) return '<p class="small">No named references found in the ad.</p>'
  const head = run.segments.map((s) => `<th>${esc(s.name)}</th>`).join('')
  const rows = run.references.map((r: Reference) => {
    const cells = run.segments
      .map((s) => {
        const v = r.fitBySegment[s.id]
        return `<td>${r.qlooId ? (v == null ? '<span class="muted">below cutoff</span>' : `<span class="bar" style="--w:${Math.round(v * 100)}%"></span>${v.toFixed(3)}`) : ''}</td>`
      })
      .join('')
    const skew = r.skew
      ? Object.entries(r.skew.age)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${v.toFixed(2)}`)
          .join(', ')
      : ''
    return `<tr><td>“${esc(r.text)}”<br><span class="small">${r.qlooId ? `${esc(r.resolvedName)} · ${esc(r.qlooType)}` : 'not in Qloo'}</span></td>${cells}<td class="small">${esc(skew)}</td></tr>`
  })
  return `<table><thead><tr><th>Reference</th>${head}<th>Skews to</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

export function renderReport(run: Run): string {
  const main = run.reviews.filter((r) => r.arm === 'crowdcraft')
  const ranked = (main.length ? main : run.reviews).slice().sort((a, b) => b.rankingScore - a.rankingScore)
  const segName = (id: string) => run.segments.find((s) => s.id === id)?.name ?? id
  const b = run.brief
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrowdCraft Run Report</title><style>${CSS}</style></head><body><main>
<p class="eyebrow">CrowdCraft run · ${esc(run.createdAt.slice(0, 16).replace('T', ' '))}</p>
<h1>${esc(run.verdictLine || 'No verdict')}</h1>
<div class="ranked">${ranked
    .map((r) => `<a href="#seg-${esc(r.segmentId)}" class="pill v-${r.verdict}"><b>${esc(r.verdict)}</b> ${esc(segName(r.segmentId))} <span>${r.rankingScore}</span></a>`)
    .join('')}</div>
<p class="note">Directional, not guaranteed. Every Qloo-grounded claim cites the taste data it came from.</p>
${run.errors.length ? `<div class="errors">${run.errors.map((e) => `<p>⚠ ${esc(e.stage)}: ${esc(e.message)}</p>`).join('')}</div>` : ''}

<h2>Brief</h2>
<dl class="brief">
<dt>Market</dt><dd>${esc([b.market.city, b.market.region, b.market.country].filter(Boolean).join(', '))}</dd>
<dt>Target</dt><dd>${esc(b.target.text)}</dd>
<dt>Channel</dt><dd>${esc(b.channel)} · ${esc(b.adType)}</dd>
${b.brandLine ? `<dt>Brand</dt><dd>${esc(b.brandLine)}</dd>` : ''}
</dl>
${b.unused.length ? `<p class="small">Not used: ${b.unused.map((u) => `<b>${esc(u.phrase)}</b> (${esc(u.reason)})`).join('; ')}</p>` : ''}

<h2>Segments and reviews</h2>
${run.segments.map((s) => segmentBlock(run, s)).join('')}

<h2>The ad's references</h2>
${referencesTable(run)}

<h2>Trace</h2>
<details><summary>${run.trace.length} steps · ${run.usage.qlooCalls} Qloo calls · ${run.usage.llmCalls} LLM calls · $${run.usage.costUsd.toFixed(4)} · ${(run.usage.ms / 1000).toFixed(1)}s</summary>
<ol class="trace">${run.trace
    .map(
      (e) =>
        `<li class="k-${e.kind}"><span class="t">${(e.t / 1000).toFixed(1)}s</span> <span class="stage">${esc(e.stage)}</span> ${esc(e.message)}${
          e.detail ? `<details><summary>detail</summary><pre>${esc(JSON.stringify(e.detail, null, 2))}</pre></details>` : ''
        }</li>`,
    )
    .join('')}</ol></details>
</main></body></html>`
}

const CSS = `
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e4e2dc;--love:#1f8a4c;--like:#3a7d8c;--meh:#8a8780;--skip:#c0392b;--lands:#c9f0d4;--loses:#f7d0cb;--chip:#efede7;--accent:#5b4bd6}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161615;--fg:#ecebe6;--muted:#9a9890;--card:#1f1f1d;--line:#33322f;--lands:#1f4d31;--loses:#5a2620;--chip:#2b2a27}}
:root[data-theme=dark]{--bg:#161615;--fg:#ecebe6;--muted:#9a9890;--card:#1f1f1d;--line:#33322f;--lands:#1f4d31;--loses:#5a2620;--chip:#2b2a27}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:28px;line-height:1.25;margin:4px 0 16px;letter-spacing:-.01em}h2{margin:48px 0 12px;font-size:20px}h3{margin:0 0 4px;font-size:18px}
.eyebrow{color:var(--muted);font-size:13px;margin:0;text-transform:uppercase;letter-spacing:.06em}
.ranked{display:flex;flex-wrap:wrap;gap:8px}.pill{text-decoration:none;color:var(--fg);border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:14px}
.pill b{text-transform:capitalize}.pill span{color:var(--muted);margin-left:4px}
.v-love b,.verdict.v-love{color:var(--love)}.v-like b,.verdict.v-like{color:var(--like)}.v-meh b,.verdict.v-meh{color:var(--meh)}.v-skip b,.verdict.v-skip{color:var(--skip)}
.note{color:var(--muted);font-size:13px}.small{color:var(--muted);font-size:13px;margin:4px 0}.muted{color:var(--muted)}
.errors{border:1px solid var(--skip);border-radius:8px;padding:8px 12px;margin:12px 0}
.brief{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}.brief dt{color:var(--muted)}.brief dd{margin:0}
.segment{border-top:1px solid var(--line);padding:24px 0}
.fingerprint{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.item{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:6px;padding:3px 8px 3px 3px;font-size:13px}.item img{width:22px;height:22px;border-radius:4px;object-fit:cover}
.reviews{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px}
.review{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.review.crowdcraft{border-color:var(--accent)}
.arm{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.verdict-row{display:flex;align-items:baseline;gap:10px;margin:6px 0}.verdict{font-weight:700;font-size:20px;text-transform:capitalize}.act{color:var(--muted);font-size:14px}
.reaction p{margin:6px 0}
.chip{display:inline-block;background:var(--chip);border-radius:4px;padding:0 6px;font-size:12px;margin:0 2px;white-space:nowrap}.chip.warn{color:var(--skip)}
.ad{white-space:pre-wrap;font:14px/1.6 ui-serif,Georgia,serif;background:var(--bg);border-radius:8px;padding:10px;margin:10px 0}
mark{border-radius:3px;padding:0 1px;color:inherit;cursor:help}mark.lands{background:var(--lands)}mark.loses{background:var(--loses)}
.dropped{color:var(--muted);text-decoration:line-through}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.bar{display:block;height:4px;width:var(--w);background:var(--accent);border-radius:2px;margin-bottom:2px}
.trace{font-size:13px;padding-left:20px}.trace .t{color:var(--muted);font-variant-numeric:tabular-nums}.trace .stage{background:var(--chip);border-radius:4px;padding:0 5px}.trace .k-error{color:var(--skip)}.trace .k-warning{color:#b7791f}
pre{overflow-x:auto}
`
