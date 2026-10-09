// Run → one self-contained HTML page (prd.md > Run Report (HTML), Look and Feel): built for analysis, pleasant to show.
// The verdict is set as a festival lineup (best-fitting crowd = headliner), then a segment grid with taste collages and
// letter grades, then per-segment detail (reaction with sources, highlighted ad, baselines side by side), references, trace.
import type { Arm, Highlight, Reference, Review, Run, Segment } from '../contracts.ts'

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const grade = (score: number) => (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F')

const ARM_LABEL: Record<Arm, string> = {
  crowdcraft: 'CrowdCraft · Qloo-grounded',
  ablation: 'Ablation · Qloo taste, no reference fit',
  b1_named: 'B1 · Segment name only',
  b2_invented: 'B2 · AI-invented persona',
}
const DOMAIN_LABEL: Record<string, string> = { artist: 'Artists', brand: 'Brands', tv_show: 'Shows', place: 'Places', movie: 'Films', podcast: 'Podcasts' }
const domainOf = (type: string) => type.split(':').pop() ?? type

function sourceNames(run: Run, seg: Segment) {
  const m = new Map<string, string>()
  for (const f of [...seg.fingerprint, ...seg.themes, ...seg.setsApart]) m.set(f.qlooId, f.name)
  for (const r of run.references) if (r.qlooId) m.set(`ref:${r.qlooId}`, `“${r.text}”`)
  return m
}

const chips = (ids: string[], names: Map<string, string>) =>
  ids.map((id) => `<span class="src" title="Qloo source: ${esc(id)}">${esc(names.get(id) ?? id)}</span>`).join('')

function highlightedAd(ad: string, hs: Highlight[], names: Map<string, string>) {
  let out = ''
  let pos = 0
  for (const h of [...hs].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue // ponytail: overlapping highlights keep the first one
    const why = `${h.effect === 'lands' ? 'Lands' : 'Loses them'}: ${h.reason}${h.sourceIds.length ? ` (${h.sourceIds.map((i) => names.get(i) ?? i).join(', ')})` : ''}`
    out += esc(ad.slice(pos, h.start)) + `<mark class="${h.effect}" title="${esc(why)}" tabindex="0">${esc(ad.slice(h.start, h.end))}</mark>`
    pos = h.end
  }
  return `<pre class="ad">${out + esc(ad.slice(pos))}</pre>`
}

function collage(seg: Segment) {
  const items = seg.fingerprint.slice().sort((a, b) => Number(!!b.imageUrl) - Number(!!a.imageUrl)).slice(0, 5)
  if (!items.length) return `<div class="collage empty"><span>No taste data</span></div>`
  return `<div class="collage n${items.length}">${items
    .map(
      (f, i) =>
        `<figure class="tile t${i}" title="${esc(f.name)} · ${esc(DOMAIN_LABEL[domainOf(f.type)] ?? domainOf(f.type))}">${
          f.imageUrl ? `<img src="${esc(f.imageUrl)}" alt="${esc(f.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''
        }<figcaption>${esc(f.name)}</figcaption></figure>`,
    )
    .join('')}</div>`
}

function lineup(run: Run, ranked: Review[]) {
  const name = (id: string) => run.segments.find((s) => s.id === id)?.name ?? id
  const tiers = [ranked.slice(0, 1), ranked.slice(1, 3), ranked.slice(3)]
  return `<section class="lineup" aria-label="Segments ranked by fit">
  <p class="kicker">The lineup · ranked by how hard each crowd shows up</p>
  ${tiers
    .filter((t) => t.length)
    .map(
      (t, i) =>
        `<p class="row r${i}">${t
          .map((r) => `<a href="#seg-${esc(r.segmentId)}" class="act v-${r.verdict}"><span class="g">${grade(r.rankingScore)}</span>${esc(name(r.segmentId))}</a>`)
          .join('<span class="dot" aria-hidden="true">✦</span>')}</p>`,
    )
    .join('')}
  <p class="verdict-line">${esc(run.verdictLine)}</p>
</section>`
}

function card(run: Run, seg: Segment, r: Review | undefined, i: number) {
  const quote = r?.reaction[0]?.sentence
  return `<a class="card" href="#seg-${esc(seg.id)}" style="--i:${i}">
  ${collage(seg)}
  <div class="card-body">
    <div class="card-top">
      <span class="grade v-${r?.verdict ?? 'meh'}">${r ? grade(r.rankingScore) : '–'}</span>
      <div><h3>${esc(seg.name)}</h3><p class="meta">${r ? `<b class="v-${r.verdict}">${esc(r.verdict)}</b> · ${esc(r.wouldAct)}` : 'not judged'}</p></div>
    </div>
    ${r ? `<div class="meter" role="img" aria-label="Ranking score ${r.rankingScore} of 100"><span style="width:${r.rankingScore}%"></span><b>${r.rankingScore}</b></div>` : ''}
    ${quote ? `<blockquote>“${esc(quote)}”</blockquote>` : ''}
    ${seg.confidence === 'normal' ? '' : `<p class="flag">${esc(seg.confidence)}: ${esc(seg.confidenceNote ?? '')}</p>`}
  </div>
</a>`
}

function reviewBlock(run: Run, seg: Segment, r: Review, main: boolean) {
  const names = sourceNames(run, seg)
  const unsourced = r.arm === 'b1_named' || r.arm === 'b2_invented'
  return `<div class="review ${main ? 'main' : ''}">
  <p class="arm">${esc(ARM_LABEL[r.arm])}</p>
  <p class="rv"><span class="grade sm v-${r.verdict}">${grade(r.rankingScore)}</span><b class="v-${r.verdict}">${esc(r.verdict)}</b> <span class="muted">· ${esc(r.wouldAct)} · ${r.rankingScore}</span></p>
  <ul class="reaction">${r.reaction.map((s) => `<li>${esc(s.sentence)} ${unsourced ? '<span class="src none">unsourced</span>' : chips(s.sourceIds, names)}</li>`).join('')}</ul>
  ${main ? '' : highlightedAd(run.brief.adText, r.highlights, names)}
  <details class="small"><summary>How this was scored${r.dropped.length ? ` · ${r.dropped.length} dropped` : ''}</summary>
    <p>Judgement ${r.judgement}/100${r.refFit == null ? '' : ` · reference fit ${r.refFit}/100 · ranking = 0.4 × fit + 0.6 × judgement`}</p>
    ${r.dropped.map((d) => `<p class="dropped">Dropped ${esc(d.kind)} “${esc(d.text)}”: ${esc(d.reason)}</p>`).join('')}
    ${r.inventedPersona ? `<p><b>The persona B2 invented:</b> ${esc(r.inventedPersona.bio)} <i>Favourites:</i> ${esc(r.inventedPersona.favourites.map((f) => f.name).join(', '))}</p>` : ''}
  </details>
</div>`
}

function detail(run: Run, seg: Segment) {
  const by = (a: Arm) => run.reviews.find((r) => r.segmentId === seg.id && r.arm === a)
  const main = by('crowdcraft') ?? by('ablation') ?? by('b1_named') ?? by('b2_invented')
  const others = (['ablation', 'b1_named', 'b2_invented'] as Arm[]).map(by).filter((r): r is Review => !!r && r !== main)
  const names = sourceNames(run, seg)
  const groups = new Map<string, Segment['fingerprint']>()
  for (const f of seg.fingerprint) groups.set(domainOf(f.type), [...(groups.get(domainOf(f.type)) ?? []), f])
  return `<section class="detail" id="seg-${esc(seg.id)}">
  <header><p class="kicker"><a href="#grid">↑ All segments</a></p><h2>${esc(seg.name)}</h2><p class="muted">${esc(seg.definedBy.join(' · '))}</p></header>
  <div class="detail-grid">
    <div>
      <h4>What this crowd loves more than the others <span class="muted">(Qloo)</span></h4>
      ${[...groups]
        .map(
          ([d, fs]) =>
            `<p class="fp"><span class="fp-k">${esc(DOMAIN_LABEL[d] ?? d)}</span>${fs
              .map((f) => `<span class="fp-i" title="affinity ${f.affinity?.toFixed(3) ?? 'n/a'} · +${f.distinctiveness.toFixed(2)} vs the other segments">${esc(f.name)}</span>`)
              .join('')}</p>`,
        )
        .join('')}
      ${seg.themes.length ? `<p class="fp"><span class="fp-k">Themes</span>${seg.themes.map((t) => `<span class="fp-i">${esc(t.name)}</span>`).join('')}</p>` : ''}
      ${seg.setsApart.length ? `<p class="fp"><span class="fp-k">Sets apart</span>${seg.setsApart.map((t) => `<span class="fp-i">${esc(t.name)}</span>`).join('')}</p>` : ''}
      ${main ? `<h4>Their read of the ad</h4>${highlightedAd(run.brief.adText, main.highlights, names)}<p class="legend"><mark class="lands">lands</mark> <mark class="loses">loses them</mark> · hover for why</p>` : ''}
    </div>
    <div>${main ? reviewBlock(run, seg, main, true) : '<p class="muted">Not judged.</p>'}</div>
  </div>
  ${others.length ? `<h4 class="vs">Same ad, same crowd, without Qloo</h4><div class="others">${others.map((r) => reviewBlock(run, seg, r, false)).join('')}</div>` : ''}
</section>`
}

function referencesTable(run: Run) {
  if (!run.references.length) return '<p class="muted">No named references found in the ad.</p>'
  const head = run.segments.map((s) => `<th>${esc(s.name)}</th>`).join('')
  const rows = run.references.map((r: Reference) => {
    const cells = run.segments
      .map((s) => {
        const v = r.fitBySegment[s.id]
        return `<td>${r.qlooId ? (v == null ? '<span class="muted">no engagement</span>' : `<span class="bar" style="--w:${Math.round(v * 100)}%"></span>${v.toFixed(3)}`) : ''}</td>`
      })
      .join('')
    const skew = r.skew
      ? Object.entries(r.skew.age)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${v.toFixed(2)}`)
          .join(', ')
      : ''
    return `<tr><td>“${esc(r.text)}”<br><span class="muted">${r.qlooId ? `${esc(r.resolvedName)} · ${esc(domainOf(r.qlooType ?? ''))}` : 'not in Qloo'}</span></td>${cells}<td class="muted">${esc(skew)}</td></tr>`
  })
  return `<div class="scroll"><table><thead><tr><th>Reference</th>${head}<th>Skews to</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

export function renderReport(run: Run): string {
  const main = run.reviews.filter((r) => r.arm === 'crowdcraft')
  const lead = (main.length ? main : run.reviews.filter((r) => r.arm === run.reviews[0]?.arm)).slice().sort((a, b) => b.rankingScore - a.rankingScore)
  const leadFor = (id: string) => lead.find((r) => r.segmentId === id)
  const ordered = run.segments.slice().sort((a, b) => (leadFor(b.id)?.rankingScore ?? -1) - (leadFor(a.id)?.rankingScore ?? -1))
  const understood = run.trace.find((e) => e.stage === 'signals' && e.kind === 'decision')?.message.replace(/^Understood the audience as: /, '')
  const b = run.brief
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrowdCraft Run Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}${REPORT_CSS}</style></head><body><main>
<header class="mast">
  <p class="eyebrow">CrowdCraft · run report · ${esc(run.createdAt.slice(0, 16).replace('T', ' '))}</p>
  <p class="brand">${esc(b.brandLine ?? 'Untitled ad')}</p>
  <p class="muted">${esc(b.adType === 'script' ? 'Script' : 'Ad copy')} · ${esc(b.channel)} · ${esc([b.market.city, b.market.region, b.market.country].filter(Boolean).join(', '))} · for ${esc(b.target.text)}</p>
</header>
${lead.length ? lineup(run, lead) : ''}
<p class="note">Directional, not guaranteed. Every Qloo-grounded claim cites the taste data it came from.${understood ? ` The agent read the audience as: <i>${esc(understood)}</i>` : ''}</p>
${run.errors.length ? `<div class="errors">${run.errors.map((e) => `<p>⚠ ${esc(e.stage)}: ${esc(e.message)}</p>`).join('')}</div>` : ''}
${b.unused.length ? `<p class="note">Not used: ${b.unused.map((u) => `<b>${esc(u.phrase)}</b> (${esc(u.reason)})`).join('; ')}</p>` : ''}

<h2 class="sec" id="grid">The crowds</h2>
<div class="grid">${ordered.map((s, i) => card(run, s, leadFor(s.id), i)).join('')}</div>

<h2 class="sec">Up close</h2>
${ordered.map((s) => detail(run, s)).join('')}

<h2 class="sec">The ad's references in Qloo</h2>
${referencesTable(run)}

<h2 class="sec">How the agent worked</h2>
<details class="trace-box"><summary>${run.trace.length} steps · ${run.usage.qlooCalls} Qloo calls · ${run.usage.llmCalls} LLM calls · $${run.usage.costUsd.toFixed(4)} · ${(run.usage.ms / 1000).toFixed(0)}s</summary>
<ol class="trace">${run.trace
    .map(
      (e) =>
        `<li class="k-${e.kind}"><span class="t">${(e.t / 1000).toFixed(1)}s</span><span class="stage">${esc(e.stage)}</span>${esc(e.message)}${
          e.detail ? `<details><summary>detail</summary><pre>${esc(JSON.stringify(e.detail, null, 2))}</pre></details>` : ''
        }</li>`,
    )
    .join('')}</ol></details>
<footer><p class="muted">CrowdCraft · taste data from Qloo · reviews by ${esc('Muse Spark')} · results are directional, not guaranteed.</p></footer>
</main></body></html>`
}

// Shared base styles (also used by the eval scorecard and the coverage probe pages).
export const CSS = `
:root{--paper:#f3ede2;--ink:#17140f;--muted:#6f675b;--card:#fbf8f2;--line:#d9cfbe;--accent:#e8442a;--love:#1d7a45;--like:#2f6f86;--meh:#8a8173;--skip:#c4321c;--lands:#bfe8c9;--loses:#f6c7bd;--chip:#e9e1d2;--shadow:0 1px 0 rgba(23,20,15,.06),0 12px 28px -18px rgba(23,20,15,.35)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--paper:#14120e;--ink:#f1eadc;--muted:#a59b8a;--card:#1d1a15;--line:#3a342b;--accent:#ff6a4d;--love:#5cc58a;--like:#6ab6cc;--meh:#a59b8a;--skip:#ff6a4d;--lands:#1f4a2f;--loses:#5c2219;--chip:#2a251e;--shadow:0 1px 0 rgba(0,0,0,.4),0 14px 30px -18px rgba(0,0,0,.8)}}
:root[data-theme=dark]{--paper:#14120e;--ink:#f1eadc;--muted:#a59b8a;--card:#1d1a15;--line:#3a342b;--accent:#ff6a4d;--love:#5cc58a;--like:#6ab6cc;--meh:#a59b8a;--skip:#ff6a4d;--lands:#1f4a2f;--loses:#5c2219;--chip:#2a251e}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 "Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.35;background-image:radial-gradient(rgba(23,20,15,.07) 1px,transparent 1px);background-size:3px 3px;z-index:0}
main{position:relative;z-index:1;max-width:1160px;margin:0 auto;padding:40px 16px 96px}
h1,h2,h3{font-family:Fraunces,ui-serif,Georgia,serif;letter-spacing:-.015em;line-height:1.1}
h1{font-size:clamp(28px,4vw,44px);margin:6px 0 16px}h2{font-size:26px;margin:56px 0 16px}h3{font-size:19px;margin:0}
a{color:inherit}.eyebrow{font:600 12px/1 "JetBrains Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0}
.note{color:var(--muted);font-size:14px}.small{font-size:13px}.muted{color:var(--muted)}
.v-love{color:var(--love)}.v-like{color:var(--like)}.v-meh{color:var(--meh)}.v-skip{color:var(--skip)}
b.v-love,b.v-like,b.v-meh,b.v-skip{text-transform:capitalize}
.errors{border:1.5px solid var(--skip);border-radius:10px;padding:8px 14px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{font:600 12px/1.3 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
code{font-family:"JetBrains Mono",monospace;font-size:.9em;background:var(--chip);padding:1px 5px;border-radius:4px}
pre{overflow-x:auto}
`

const REPORT_CSS = `
.mast{border-bottom:2px solid var(--ink);padding-bottom:16px}
.brand{font:900 clamp(30px,5vw,56px)/1 Fraunces,serif;letter-spacing:-.03em;margin:12px 0 8px}
.lineup{margin:28px 0 8px;padding:28px 20px 22px;border:2px solid var(--ink);border-radius:4px;text-align:center;background:linear-gradient(180deg,transparent,rgba(232,68,42,.06));position:relative}
.lineup::before,.lineup::after{content:"✦";position:absolute;top:10px;color:var(--accent);font-size:14px}.lineup::before{left:14px}.lineup::after{right:14px}
.kicker{font:600 11px/1 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);margin:0 0 14px}
.kicker a{text-decoration:none}
.row{margin:6px 0;font-family:Fraunces,serif;line-height:1.05;text-wrap:balance}
.row .act{text-decoration:none;display:inline-flex;align-items:baseline;gap:.25em;transition:opacity .2s}
.row .act:hover{opacity:.7}.row .g{font-family:"JetBrains Mono",monospace;font-size:.42em;font-weight:600;border:1.5px solid currentColor;border-radius:4px;padding:.1em .35em;transform:translateY(-.35em)}
.r0{font-size:clamp(34px,6vw,64px);font-weight:900}.r1{font-size:clamp(22px,3.4vw,34px);font-weight:700}.r2{font-size:clamp(16px,2.2vw,22px);font-weight:400}
.dot{color:var(--accent);margin:0 .5em;font-size:.6em;vertical-align:middle}
.verdict-line{font-size:14px;color:var(--muted);margin:16px auto 0;max-width:70ch}
.sec{display:flex;align-items:center;gap:14px}.sec::after{content:"";flex:1;height:2px;background:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px}
.card{display:flex;flex-direction:column;text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);transition:transform .25s cubic-bezier(.2,.7,.2,1),box-shadow .25s;animation:rise .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i) * 70ms)}
.card:hover{transform:translateY(-4px) rotate(-.3deg)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none}html{scroll-behavior:auto}}
.collage{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,74px);gap:2px;background:var(--line)}
.collage.empty{display:flex;align-items:center;justify-content:center;height:150px;color:var(--muted)}
.tile{margin:0;position:relative;overflow:hidden;background:var(--chip)}
.tile.t0{grid-column:span 2;grid-row:span 2}
.collage.n1 .t0{grid-column:span 3}.collage.n2 .t1{grid-row:span 2}
.tile img{width:100%;height:100%;object-fit:cover;display:block;filter:saturate(.9) contrast(1.02);transition:transform .4s}
.card:hover .tile img{transform:scale(1.05)}
.tile figcaption{position:absolute;inset:auto 0 0 0;padding:14px 6px 4px;font:600 10.5px/1.15 "Bricolage Grotesque",sans-serif;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile:not(:has(img)) figcaption{inset:0;display:flex;align-items:center;justify-content:center;text-align:center;white-space:normal;background:none;color:var(--ink);font:700 13px/1.15 Fraunces,serif;padding:8px}
.card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px}
.card-top{display:flex;gap:12px;align-items:center}
.grade{flex:none;display:inline-grid;place-items:center;width:46px;height:46px;border:2px solid currentColor;border-radius:50%;font:900 24px/1 Fraunces,serif}
.grade.sm{width:30px;height:30px;font-size:15px;border-width:1.5px;margin-right:8px;vertical-align:middle}
.meta{margin:2px 0 0;font-size:13px;color:var(--muted)}
.meter{position:relative;height:6px;background:var(--chip);border-radius:3px}.meter span{display:block;height:100%;background:var(--accent);border-radius:3px}
.meter b{position:absolute;right:0;top:-18px;font:600 11px "JetBrains Mono",monospace;color:var(--muted)}
blockquote{margin:0;font:italic 400 15px/1.45 Fraunces,serif}
.flag{margin:0;font-size:12px;color:var(--skip)}
.detail{border-top:1px solid var(--line);padding:28px 0 8px;scroll-margin-top:12px}
.detail:target{animation:flash 1.4s}
@keyframes flash{0%{background:rgba(232,68,42,.12)}100%{background:transparent}}
.detail header h2{margin:6px 0 4px;font-size:30px}.detail header h2::after{display:none}
.detail h4{font:600 12px/1 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.08em;margin:22px 0 10px}
.detail h4.vs{margin-top:28px}
.detail-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px}
@media (max-width:820px){.detail-grid{grid-template-columns:1fr}}
.fp{margin:6px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.fp-k{font:600 11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);min-width:76px}
.fp-i{background:var(--chip);border-radius:999px;padding:2px 10px;font-size:13.5px}
.ad{white-space:pre-wrap;font:15px/1.65 Fraunces,serif;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0}
mark{color:inherit;border-radius:3px;padding:1px 2px;cursor:help;outline-offset:2px}
mark.lands{background:var(--lands);box-shadow:inset 0 -2px 0 var(--love)}mark.loses{background:var(--loses);box-shadow:inset 0 -2px 0 var(--skip)}
.legend{font-size:12px;color:var(--muted);margin:8px 0 0}
.review{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.review.main{border:2px solid var(--accent);box-shadow:var(--shadow)}
.arm{font:600 11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px}
.rv{margin:0 0 6px;font-size:18px}
.reaction{margin:0;padding-left:18px}.reaction li{margin:8px 0}
.src{display:inline-block;font:600 11px/1.6 "JetBrains Mono",monospace;background:var(--chip);border-radius:4px;padding:0 6px;margin:1px 2px;white-space:nowrap}
.src.none{color:var(--muted);font-weight:400}
.others{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.others .ad{font-size:13.5px;padding:10px 12px;margin-top:10px}
.dropped{color:var(--muted);text-decoration:line-through}
.scroll{overflow-x:auto}
.bar{display:block;height:4px;width:var(--w);background:var(--accent);border-radius:2px;margin-bottom:3px}
.trace-box summary{cursor:pointer;font-weight:600}
.trace{font-size:13px;padding-left:22px;margin-top:12px}.trace li{margin:4px 0}
.trace .t{font:12px "JetBrains Mono",monospace;color:var(--muted);margin-right:8px}
.trace .stage{font:600 11px "JetBrains Mono",monospace;background:var(--chip);border-radius:4px;padding:1px 6px;margin-right:8px}
.trace .k-error{color:var(--skip)}.trace .k-warning{color:#b7791f}.trace .k-decision{font-weight:600}
footer{margin-top:64px;border-top:2px solid var(--ink);padding-top:12px;font-size:13px}
`
