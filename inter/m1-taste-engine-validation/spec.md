---
doc: spec
status: approved
---
# M1: Taste Engine Validation — Spec

## Current State
The repo is empty apart from `inter/`, so there's no code to reuse and no conventions to follow yet. Conventions set here carry into M2 (the product UI is built on this engine).

Qloo (verified against docs.qloo.com on 2026-10-07):
- Base URL `https://hackathon.api.qloo.com`; header `X-Api-Key`; `/v2/insights` is a GET with query parameters. Invalid parameters are silently ignored and return empty results.
- Segment signals: `signal.location.query` (fuzzy locality names), `signal.location` (WKT or locality ID), `signal.demographics.age` (`24_and_younger|25_to_29|30_to_34|35_to_44|45_to_54|55_and_older`), `signal.demographics.gender` (`male|female`), `signal.demographics.audiences`, `signal.interests.tags`, `signal.interests.entities` (weights supported).
- `filter.type` values: `urn:entity:{artist,book,brand,destination,movie,person,place,podcast,tv_show,video_game}`, `urn:demographics`, `urn:tag`, `urn:heatmap`. `take` up to 50.
- `filter.results.entities` scores the affinity of specific entities against the input signals; this is the reference-fit call.
- `urn:demographics` returns +/− affinity per age bucket and gender for entities or tags.
- `feature.explainability=true` returns which input signals drove each result.
- `/v2/analysis/compare` compares **two entity groups** (`a.signal.interests.entities`, `b.signal.interests.entities`) and returns separating tags. It can't compare location- or demographic-defined segments directly.
- `/v2/audiences` and `/v2/audiences/types` are marked **deprecated** in the docs. Audience types: communities, global_issues, hobbies_and_interests, investing_interests, leisure, life_stage, lifestyle_preferences_beliefs, political_preferences, professional_area, spending_habits.
- `/search` (entities by name, with legacy search-only types), `/entities` (by ID), `/v2/tags` (tag search), `/v2/trending` (time series per entity).

Unverified (day-1 probe): the affinity field name in signal-based responses, rate limits, whether audiences still work, and how dense non-US data is.

## Gap
Everything is new: the engine, the LLM layer, the Qloo client and cache, the report, the eval harness and set, and the coverage probe.

## Decisions
### D1: Language and repo shape — decided
- Door: one-way
- Context: M2's web app is built on this engine, so the language choice carries forward.
- Options: TypeScript, one package; Python engine plus a separate web layer later.
- Chosen: **TypeScript, one package** (user constraint). Engine in `src/engine`, CLI on top; M2's web app imports the engine directly (convert to workspaces only if needed).
- Why: no rewrite at M2; one language across the engine, evals and UI.
- Tradeoff accepted: Python's data and eval tooling isn't available.
- Revisit if: never for M1.

### D2: How agentic the engine is — decided
- Door: one-way
- Context: the hackathon requires something agentic; evals need repeatable judging on identical segments across arms; Muse can't force tool calls (`tool_choice` is `"auto"` only), and its reasoning is always on.
- Options: (A) a fully agent-driven loop with every Qloo tool — the most agentic, but segments differ per run, steps can be skipped, bad parameters are silently ignored, cost can run away and context bloats; (B) a fixed pipeline with the LLM only writing text — repeatable but arguably not agentic; (C) a hybrid with agents at the edges and a pipeline in the core.
- Chosen: **C, the hybrid** (user accepted the recommendation).
  - **Agent stages** (Qloo tools, step limit, typed output): brief → verified Qloo signals; propose 8–10 candidate segments within the brief, probe their data density and broaden thin ones; extract the ad's references and resolve them (retrying as tags).
  - **Deterministic code**: fingerprints, the affinity matrix, segment selection, reference fit, demographic skew, citation validation, scoring.
  - **Judge**: one structured call per segment per arm, no tools, identical across arms.
  - **Evals**: judging uses the fixed segments in eval files; segmentation is evaluated separately.
- Why: agentic where judgement is needed and visible in the trace; repeatable where numbers and fair comparison matter. M2's chat view reuses the same tools.
- Tradeoff accepted: more moving parts than B; agent-stage outputs vary between runs, so they're cached per brief.
- Revisit if: Muse's tool calling is unreliable on day 1. Then any agent stage drops to a single structured call with the same output contract.

### D3: LLM layer and judge model — decided
- Door: one-way
- Context: one LLM layer for the agent stages, the judge, the baselines and the grader; Muse supports only `tool_choice: "auto"`; strict JSON Schema needs every field required.
- Options: Vercel AI SDK; OpenAI Agents SDK (heavier, centred on the Responses API); LangGraph.js (far more than needed); the plain `openai` SDK with a hand-written loop.
- Chosen: **Vercel AI SDK** (`ai` + `@ai-sdk/openai-compatible`) (user accepted the recommendation).
  - Muse via `createOpenAICompatible({ name: 'meta', baseURL: 'https://api.meta.ai/v1', apiKey, supportsStructuredOutputs: true })`.
  - **Judge**: `muse-spark-1.3-contributor` at low temperature.
  - **Grader** (eval only, specificity metric only): Claude via `claude -p --json-schema`, with a stripped system prompt and no tools. It never sees which arm wrote a reaction; you hand-check about 10% of its labels.
  - Schemas are written in zod; optional fields are `nullable`, never `optional` (strict mode).
  - Structured output uses JSON Schema mode, never the SDK's forced-tool mode.
- Why: TypeScript-native, built-in tool loop (`tool()`, `isStepCount`), provider-agnostic (a one-line swap to Claude or others), covers M2's streaming trace and chat view, and is a recognised agent framework for the judging criteria. A different grader model avoids self-preference bias.
- Tradeoff accepted: a dependency on the SDK's openai-compatible provider behaving well with Muse.
- Revisit if: on day 1 the SDK's structured output or tool loop fails with Muse. Then fall back to the plain `openai` SDK behind the same `llm` interface.

### D4: Segment building and distinctness — decided
- Door: one-way
- Chosen: **affinity matrix** (user accepted the recommendation). Option A (top-item overlap only) can't express "loves this more than the others"; option C (pairwise Compare) is expensive and returns tags, not a distance.
- Detail: an affinity matrix (each candidate scored via `filter.results.entities` against the pooled top items of all candidates) for selection and distinctive items; Jaccard overlap of top items reported as the distinctness metric; Analysis Compare on the kept segments, each against the rest, for "what sets them apart" themes. Greedy selection: start with the richest candidate, add the most different, stop at 6 or when too similar (at least 4 where possible, never fewer than 2). Falls back to overlap-based selection if Qloo doesn't score low-ranked items.

### D4b: Segments are region × age cells — decided (2026-10-09, user)
- Door: one-way (changes what a segment is)
- Context: the user found taste-tribe segments ("Austin indie-folk fans") unclear for campaign managers, who buy region and age.
- **Revised 2026-10-09 (slice 5, user): regions come from data.** For a US market, Qloo's heatmap of the ad's resolved references (geohash tiles, popularity-weighted, rolled up to ~50 US metros in `src/engine/heat.ts`) picks the 2 hottest metros plus the coolest big metro as the contrast; the ranking is stored as `Run.heat` and shown on the dashboard. A brief that names a city uses that city (split into up to 4 age bands). The regions agent below is the fallback (no resolvable references, non-US market, or a heatmap error).
- Original: the candidates agent proposes 6–8 taste-diverse regions in the market (verified localities). Code fingerprints each region (artist and brand, at the target's full age range) and keeps the 2–3 most different by top-list overlap (greedy max-min on 1 − Jaccard). Cells = kept regions × 2 age bands split from the target's buckets (a single-city market splits into up to 4 bands). The brief's named interest applies to every cell. The affinity matrix (D4) still runs across the cells, for distinctive items.
- Why: results map straight into ad-platform targeting; Qloo taste stays the evidence for every insight.
- Tradeoff accepted: cells in the same region share more taste than taste tribes did; age differences within a region are smaller.
- Revisit if: cells come back too similar to discriminate (the eval's distinctness metric).

### D5: Data contracts — decided
- Door: one-way
- Context: the report renders these shapes, the evals compare them, and M2's UI will consume them. Renaming fields later touches everything.
- Options: JSON files on disk vs SQLite; highlight positions from the model vs exact quotes located by code; free-text citations vs Qloo IDs.
- Chosen (user accepted the recommendation):
  - **JSON files, no database.** Each run writes `runs/<id>/run.json` (the single source of truth) and `report.html` (rendered from it). `run.json` carries `schemaVersion: 1`.
  - **Highlights are exact quotes, located by code.** The judge returns the phrase; code finds it in the ad (exact match first, then whitespace- and case-insensitive). A quote that isn't found is dropped.
  - **Citations are Qloo IDs.** Every reaction sentence and highlight carries `sourceIds`, validated against that segment's evidence; failures go to `dropped` with a reason and are never shown.
  - **The trace is an append-only event list.**
  - The shapes are in **Data Model**.
- Why: nobody queries this data yet, so a database is premature; models miscount character positions; IDs make citations checkable in code; an event list streams naturally into M2.
- Tradeoff accepted: no querying across runs (the eval reads files directly).
- Revisit if: M2 needs history or sharing across users. Then move the same shapes into a database.

### D6: Two-way batch — decided
- Door: two-way
- Chosen (user accepted all recommendations):
  1. **Cache**: `.cache/qloo/<sha256 of path+sorted params>.json`, gitignored, never expires, `--no-cache` to bypass. Agent-stage outputs are cached by brief hash in `.cache/stages/`.
  2. **Report**: one self-contained HTML file from a TypeScript template function with inline CSS; Qloo images linked by URL.
  3. **CLI**: `npm run cc -- run <brief.yaml | --text "…">`, `eval`, `eval score`, `probe`, run through `tsx` (no build step).
  4. **Eval set**: YAML files in `eval/ads/`.
  5. **Ranking score**: `0.4 × refFit + 0.6 × judgement`; with no references, `judgement` alone. The weight is tuned from the ablation.
  6. **Thresholds**: segment overlap ≤ 0.30 (Jaccard of the top 20 items per domain); selection stops when the next candidate's minimum distance is under 0.15 (tuned on days 2–3); the PRD's eval targets as written.
  7. **Concurrency**: Qloo 5 in parallel; Muse ≤ 80 requests/min; 3 retries with exponential backoff on 429 and 5xx.
  8. **Model settings**: judge at temperature 0.2 with `reasoning_effort: "low"`; agent stages at 0.3.
  9. **Blind preference**: `blind-pairs.csv` plus a hidden `blind-key.json`; the user fills a `choice` column, then runs `eval score`.
  10. **Validation**: zod at every boundary; Qloo responses trimmed to the fields used.
  11. **Tests**: vitest on the deterministic code with hand-made fixtures; `tsc --noEmit` in strict mode. LLM and Qloo stages are proven by the eval.
  12. **Secrets**: `.env` with `QLOO_API_KEY` and `META_API_KEY`; `.env.example` committed.
  13. **Tooling**: Node 22+, npm, ES modules, MIT license from day 1.

## Design Overview
A TypeScript CLI over an engine of stages. Agent stages use Qloo through AI SDK tools; deterministic stages call the Qloo client directly; the judge runs once per segment per arm. Everything is recorded in a `Run` and rendered to HTML.

PRD core journey, traced:
1. User writes a brief and ad (YAML or `--text`) → `src/cli.ts run` → `engine/brief.ts` structures free text into a `Brief` (asks for or lists missing market/target) and records `unused` phrases.
2. `engine/brief.ts` (agent) turns the brief into verified `QlooSignals` using the lookup tools → trace events.
3. `engine/candidates.ts` (agent) proposes 8–10 candidate signal sets inside the brief's constraints, probes density, broadens thin ones → trace decisions.
4. `engine/fingerprints.ts` pulls each candidate's top items per domain plus themes → `engine/select.ts` builds the affinity matrix, picks 4–6 distinct segments, computes distinctive items, and asks Analysis Compare what sets each apart → `Segment[]`.
5. `engine/references.ts` (agent) extracts and resolves the ad's references; deterministic code computes fit per segment and demographic skew → `Reference[]`.
6. `engine/judge.ts` writes a `Review` per segment for each arm (CrowdCraft, B1, B2, ablation), validates citations, locates quotes, and scores.
7. `engine/run.ts` assembles the `Run`, writes `runs/<id>/run.json`; `report/render.ts` writes `report.html`.
8. `cli eval` runs every eval ad (fixed segments) through all arms twice, runs segmentation on each brief, grades specificity, exports blind pairs, and writes the scorecard. `cli eval score` folds in the blind choices. `cli probe` writes the coverage report.

## Components
### Qloo client (new) — `src/qloo/client.ts`
Typed wrappers for every Qloo call in **External Services**, with caching, concurrency limits, retries, trimming of verbose fields, chunking of long ID lists (≤ 50 IDs per call), and a trace event per call. Serves PRD **Agent Flow (how Qloo is used)**.

### Qloo agent tools (new) — `src/qloo/tools.ts`
AI SDK `tool()` definitions over the client for agent stages: `find_tags`, `find_audiences` (sensitive types filtered by policy), `find_entities`, `check_locality`, `probe_density`, plus a `finish` tool per stage whose input schema is the stage's output contract. Returns compact results only.

### LLM layer (new) — `src/llm.ts`
The single entry for all model calls (D3): `generateJson` (structured output), `runAgent` (tool loop ending with `finish`), and `gradeWithClaude` (the `claude -p` grader). Tracks tokens and cost.

### Brief stage (new) — `src/engine/brief.ts`
Free text → `Brief` (structured call), required-field check, and the agent that turns the brief into verified `QlooSignals`. Applies the sensitive-attribute policy. Serves PRD **Brief**.

### Candidates stage (new) — `src/engine/candidates.ts`
The agent that proposes 8–10 candidate signal sets along the open axes (taste, then place, then age; gender only if the brief asks), probes density, and broadens thin ones. Serves PRD **Segment**.

### Fingerprints and selection (new) — `src/engine/fingerprints.ts`, `src/engine/select.ts`
Fingerprint pulls, the affinity matrix, distance, greedy selection, distinctive items (z-score of a segment's affinity against the others' mean), Jaccard overlap, and Compare themes (D4). Serves PRD **Segment** and the segmentation metrics.

### References stage (new) — `src/engine/references.ts`
The agent that extracts and resolves references, then deterministic fit per segment (`filter.results.entities` grouped by entity type) and demographic skew. Serves PRD **Agent Flow** steps 6–7.

### Judge (new) — `src/engine/judge.ts`
Prompts per arm, the `Review` call, B2's two-step invented persona, citation validation, quote location, and the ranking score. Serves PRD **Review (per segment)** and **Baselines**.

### References resolution and fit (revised 2026-10-09, slice 5) — `src/engine/references.ts`
Extract (one structured call: text, kind, entity type, full search name) → typed Qloo search on both the full name and the ad's words (code) → one structured call picks the matching candidate or none (same place under a longer name and same-brand product lines count; look-alike businesses don't). This replaced the open-ended references agent, which matched look-alikes (a dish tag for Topo Chico, a saloon for Barton Springs). Fit: entities via `filter.results.entities` (omitted = no engagement); themes only when among the audience's top 50 themes. A reference scored for no audience at all is a coverage gap ("no Qloo signal") and never counts. Reference fit uses an absolute scale (affinity 0.75 → 0, 1.0 → 100, omitted → 0) instead of min-max, so near-identical affinities stay near-identical.

### Deliverables (new, 2026-10-09) — `src/engine/deliverables.ts`
Serves PRD **Deliverables**.
- **Targeting (code):** recommended = CrowdCraft reviews with Love/Like and ranking score ≥ 55 (top 3; if none qualify, the top 1 flagged "weak fit"); don't target = Meh/Skip or score < 45. Interests = up to 6 names from the audience's distinctive artists, brands and shows plus its genre themes (no places, no sensitive tags), labelled "check availability in your ad manager". Budget split ∝ max(score − 40, 5), rounded to 5% steps summing to 100.
- **What to fix (one structured call, replaces the action list in Summary):** bottom line, 3–5 fixes (line quote or null, the change, why with evidence, audiences), up to 3 keeps, and a one-line reason per don't-target audience.
- **Better versions (agentic):** for up to 2 recommended audiences, one rewrite call (keep brand, offer, channel format and length within ±20%; use the audience's taste; list the taste items used), then resolve the new version's references (extract → typed search → pick) and score their fit for that audience only, then judge it with the CrowdCraft arm. Before/after is that audience's ranking score.
- **Risk:** the judge may favour rewrites built from its own evidence. Slice 6 checks with a generic rewrite (no Qloo data) judged the same way, and with the B1 judge on both rewrites.

### Summary (new) — `src/engine/summary.ts`
One structured call after judging: the bottom line and Keep / Fix / Try / Spend / Skip actions from the CrowdCraft reviews, the line-by-line tally and each cell's Qloo taste. Segment IDs are validated and quotes must be found in the ad. Serves PRD **Run Report (HTML)** item 4.

### Run orchestrator and trace (new) — `src/engine/run.ts`
Runs the stages, records trace events and usage, keeps partial results on failure, and writes `run.json`. Serves PRD **Core Journey** and **States and Edge Cases**.

### Report (new) — `src/report/render.ts`
`Run` → self-contained HTML in the PRD's order. Serves PRD **Run Report (HTML)**.

### Eval harness (new) — `src/eval/harness.ts`, `src/eval/metrics.ts`, `src/eval/grader.ts`, `src/eval/blind.ts`
Runs the eval set through all arms (twice, for stability), runs segmentation separately, grades specificity, exports and scores blind pairs, computes every metric and the go/no-go, and writes the scorecard. Serves PRD **Eval Set** and **Eval Command and Scorecard**.

### Coverage probe (new) — `src/probe/probe.ts`
Runs the probe segments in each market and computes fill rate, local specificity (overlap with the US fingerprint for the same taste and age), distinctness and a verdict. Serves PRD **Coverage Probe**.

## Data Model
zod schemas in `src/contracts.ts`. Field names are the contract. `null` means "not applicable or unknown" (strict JSON Schema has no optional fields).

```ts
type AgeBucket = '24_and_younger'|'25_to_29'|'30_to_34'|'35_to_44'|'45_to_54'|'55_and_older'
type Channel = 'reel'|'preroll'|'tv'|'audio'|'billboard'|'social'|'email'|'general'

Brief {
  adText: string; adType: 'copy'|'script'; channel: Channel; brandLine: string|null
  market: { country: string; region: string|null; city: string|null }
  target: { text: string; ageBuckets: AgeBucket[]|null; gender: 'male'|'female'|null;
            interests: string[]; communities: string[] }   // communities only if named explicitly
  unused: { phrase: string; reason: string }[]
}

QlooSignals {
  locationQuery: string|null; locationId: string|null; ageBuckets: AgeBucket[]|null
  gender: 'male'|'female'|null; audienceIds: string[]; tagIds: string[]; entityIds: string[]
}

EvidenceItem { qlooId: string; name: string; type: string; affinity: number|null; imageUrl: string|null }

Segment {
  id: string                      // slug, stable within a run
  name: string; definedBy: string[]; signals: QlooSignals
  region: string|null; ageBand: string|null      // added 2026-10-09: "Austin, TX", "25-29"
  confidence: 'normal'|'broadened'|'thin'; confidenceNote: string|null
  fingerprint: (EvidenceItem & { distinctiveness: number })[]   // distinctive items, all domains
  themes: EvidenceItem[]          // urn:tag results
  setsApart: EvidenceItem[]       // Analysis Compare tags
}

Reference {
  text: string; kind: 'entity'|'theme'
  qlooId: string|null; qlooType: string|null; resolvedName: string|null
  fitBySegment: Record<string, number|null>            // segmentId -> affinity
  skew: { age: Record<AgeBucket, number>; gender: { male: number; female: number } } | null
}

Review {
  segmentId: string; arm: 'crowdcraft'|'b1_named'|'b2_invented'|'ablation'
  verdict: 'love'|'like'|'meh'|'skip'; wouldAct: string
  reaction: { sentence: string; sourceIds: string[] }[]
  highlights: { quote: string; start: number; end: number; effect: 'lands'|'loses'; reason: string; sourceIds: string[] }[]
  judgement: number; refFit: number|null; rankingScore: number          // 0-100
  dropped: { kind: 'claim'|'highlight'; text: string; reason: string }[]
  inventedPersona: { bio: string; favourites: { name: string; type: string }[] } | null   // B2 only
}

Summary {
  bottomLine: string
  actions: { kind: 'keep'|'fix'|'try'|'spend'|'skip'; text: string; segmentIds: string[]; quote: string|null }[]
}

Targeting {
  audiences: { segmentId: string; location: string; age: string; gender: string|null; interests: string[]; budgetPct: number; score: number; verdict: Verdict }[]
  skip: { segmentId: string; reason: string }[]
  weakFit: boolean
}
Summary (revised) { bottomLine: string; fixes: { line: string|null; change: string; why: string; segmentIds: string[] }[]; keeps: { line: string|null; why: string; segmentIds: string[] }[]; skipReasons: { segmentId: string; reason: string }[] }
Version { segmentId: string; adText: string; usedTaste: string[]; before: number; review: Review }   // review.rankingScore = after

TraceEvent {
  t: number                       // ms since run start
  stage: 'brief'|'signals'|'candidates'|'fingerprints'|'select'|'references'|'fit'|'judge'|'report'
  kind: 'qloo_call'|'llm_call'|'decision'|'warning'|'error'
  message: string                 // plain English, for non-engineers
  detail: Record<string, unknown>|null   // request summary, counts; never full Qloo payloads
}

Run {
  schemaVersion: 1; id: string; createdAt: string
  brief: Brief; segments: Segment[]; references: Reference[]; reviews: Review[]
  verdictLine: string
  summary: Summary|null           // added 2026-10-09: the "What to do" step
  heat: { label: string; heat: number; role: 'hot'|'cool'|'other' }[]|null   // added 2026-10-09: heatmap ranking
  targeting: Targeting|null; versions: Version[]   // added 2026-10-09: the deliverables
  trace: TraceEvent[]
  usage: { qlooCalls: number; llmCalls: number; tokensIn: number; tokensOut: number; costUsd: number; ms: number }
  errors: { stage: string; message: string }[]
}

EvalAd (YAML) {
  id: string; tier: 'A'|'B'|'C'|'D'|'demo'
  briefText: string               // free-text version, for the brief-extraction metric
  brief: Brief                    // structured version (adText included)
  segments: { id: string; name: string; locationQuery: string|null; ageBuckets: AgeBucket[]|null;
              gender: 'male'|'female'|null; tagQueries: string[]; entityQueries: string[] }[]
  intendedSegmentId: string|null  // Tiers A–C
  actualFitSegmentId: string|null // Tier D: the crowd the references really fit
}
```

Evidence for citation validation (CrowdCraft and ablation arms): the segment's `fingerprint` and `themes` IDs, plus `ref:<qlooId>` for each reference's fit (CrowdCraft only). B1 and B2 claims carry no `sourceIds` and are marked unsourced.

## Interfaces
### CLI
| Command | Input | Output |
|---|---|---|
| `npm run cc -- run <brief.yaml>` / `--text "<brief and ad>"` | A brief file or free text; asks for missing fields when interactive, otherwise exits 1 listing them | `runs/<id>/run.json`, `runs/<id>/report.html`; prints the report path |
| `npm run cc -- eval [--ads <glob>] [--arms <list>] [--no-cache]` | `eval/ads/*.yaml` | `eval-results/<timestamp>/scorecard.json`, `scorecard.html`, `blind-pairs.csv`, `blind-key.json`, a run per ad and arm |
| `npm run cc -- eval score <dir>` | That directory with `choice` filled in `blind-pairs.csv` | An updated scorecard |
| `npm run cc -- probe` | `probe/segments.yaml` | `probe-results/<timestamp>/coverage.json`, `coverage.html` |
| `npm run cc -- run --fixture <file.json>` (dev) | A hand-made `{ brief, segments, references }` file; skips every Qloo stage | Same as `run` |
| `npm run cc -- report <runs/<id>/run.json>` (dev) | A finished run | Re-renders `report.html` from `run.json` (no model or Qloo calls) |
| `npm run cc -- selfcheck [--qloo]` (dev) | Nothing | Checks Muse structured output, the agent tool loop, judge drift and the `claude -p` grader; with `--qloo`, the open Qloo assumptions. Prints ✓/✗ with evidence |

### LLM layer (`src/llm.ts`)
- `generateJson<T>(schema, { system, prompt, temperature }) → Promise<T>`
- `runAgent<T>({ system, prompt, tools, maxSteps, output: schema }) → Promise<{ result: T; steps: number }>`. The loop stops when the model calls `finish` (whose input schema is `output`). If it ends without calling `finish`, one `generateJson` call converts its last message into `output`.
- `gradeWithClaude<T>(schema, prompt) → Promise<T>`: spawns `claude -p` with `--json-schema`, `--system-prompt`, `--tools ""`, `--output-format json` and restricted `--setting-sources`; build slice 1 confirms no global CLAUDE.md or hook text reaches it.

### Arms (judge input)
| Arm | The judge gets |
|---|---|
| `crowdcraft` | The ad, type, channel, brand line, the segment's name, fingerprint, themes and setsApart, and the references with this segment's fit and skew |
| `ablation` | The same, without references |
| `b1_named` | The ad, type, channel, brand line and the segment's name and definedBy only |
| `b2_invented` | Step 1: the model invents a persona (bio, about 15 favourites) from the segment's name. Step 2: it judges with that persona |

All arms use the same system prompt and output schema; only the segment data differs.

## Policy additions
- `political_preferences` audiences are never used as a split, and `lifestyle_preferences_beliefs` audiences are filtered against the sensitive-attribute rule (they may contain religion). Both are allowed only when the brief names them explicitly.

## External Services
### Qloo (hackathon)
Base `https://hackathon.api.qloo.com`, header `X-Api-Key: $QLOO_API_KEY`, GET with query parameters. Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
| Use | Call |
|---|---|
| Locality check | `GET /v2/insights?filter.type=urn:entity:place&signal.location.query=<q>&take=1` (resolves `query.locality.signal`) |
| Tag lookup | `GET /v2/tags?filter.query=<q>` |
| Audience lookup | `GET /v2/audiences?filter.query=<q>` (deprecated; skip if it fails) |
| Entity lookup | `GET /search?query=<q>&types=<types>` |
| Fingerprint | `GET /v2/insights?filter.type=urn:entity:<domain>&<signals>&take=20` for artist, brand, movie, tv_show, place, podcast |
| Themes | `GET /v2/insights?filter.type=urn:tag&<signals>&take=20` |
| Affinity matrix and reference fit | `GET /v2/insights?filter.type=urn:entity:<type>&<signals>&filter.results.entities=<≤50 ids>` |
| Demographic skew | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<id>` |
| What sets apart | `GET /v2/analysis/compare?a.signal.interests.entities=<ids>&b.signal.interests.entities=<ids>` |
| Card details | `GET /entities?entity_ids=<ids>` |
| Explainability | `feature.explainability=true` on fit calls |
Signals map: `locationQuery`→`signal.location.query`, `locationId`→`signal.location`, `ageBuckets`→`signal.demographics.age`, `gender`→`signal.demographics.gender`, `audienceIds`→`signal.demographics.audiences`, `tagIds`→`signal.interests.tags`, `entityIds`→`signal.interests.entities`.
Limits: `take` ≤ 50; **5 requests/second and 10,000 requests/month** (verified from `x-second-ratelimit-*` and `x-month-ratelimit-*` headers on 2026-10-09). Terms: never commit Qloo responses; server-side caching is allowed. Keys are deactivated after judging.
**Verified 2026-10-09:** the affinity field is `query.affinity`; `filter.results.entities` omits items below a segment's cutoff (treated as 0). **Still unverified:** how theme (tag) fit is best measured, whether audiences work, and rate limits.

### Meta Model API (Muse Spark)
Researched 2026-10-07 from dev.meta.ai docs (read through a summarising fetch, not raw HTML).
- Base URL `https://api.meta.ai/v1`, OpenAI-compatible (Chat Completions and Responses); use the `openai` SDK with `baseURL` and the key passed explicitly. Header `Authorization: Bearer <key>`.
- Models: `muse-spark-1.3` (latest, recommended), 1.2, 1.1, plus `-contributor` variants. Context window 1M tokens.
- Structured output: `response_format: {type: "json_schema", json_schema}` with constrained decoding. Strict mode needs `additionalProperties: false`, every property required, no `oneOf`/`allOf`, no recursion, nesting depth ≤ 10.
- Tool calling: OpenAI format, parallel calls on by default; `tool_choice` accepts **only `"auto"`**.
- Sampling: `temperature` 0–2, `seed` best-effort only; reasoning can't be turned off (lowest `reasoning_effort` is `minimal`). `stop`, `n>1` and `logprobs` return 400.
- Pricing (Standard tier): $1.25 / $4.25 per million input/output tokens. Rate limit 3,000 requests/min, 4M tokens/min. Contributor tier: $0.10 / $0.20, 100 requests/min, and Meta may train on the content. **The user chose Contributor for M1** (see Constraints and Debt Taken).
- Region: global preview since 2026-08-05; India isn't blocked for Muse Spark. Billing support in India is still to be confirmed at sign-up.
- Docs: https://dev.meta.ai/docs/structured-output, https://dev.meta.ai/docs/tool-calling, https://dev.meta.ai/docs/pricing-rate-limits

### Claude Code CLI (`claude -p`)
Verified with `claude --help`: `--json-schema`, `--model`, `--system-prompt`, `--tools`, `--setting-sources`, `--output-format json`. `--bare` skips hooks and CLAUDE.md but requires `ANTHROPIC_API_KEY` (no subscription login). For local use only; not as the deployed app's backend.

## Constraints
- TypeScript. Budget about $20–50 for LLM spend is fine.
- Qloo key requested but **not yet received**: build the non-Qloo slices first, using hand-made sample data (never real Qloo responses in the repo).
- Muse **Contributor tier** (`muse-spark-1.3-contributor`), chosen by the user: Meta may train on the content sent; 100 requests/min.
- No required or banned frameworks.

## Files
```
CrowdCraft/
├── package.json            # scripts: cc, test, typecheck; deps: ai, @ai-sdk/openai-compatible, zod, yaml, p-limit, dotenv; dev: tsx, typescript, vitest
├── tsconfig.json           # strict, ESM, NodeNext
├── .env.example            # QLOO_API_KEY, META_API_KEY
├── .gitignore              # .env, .cache/, runs/, eval-results/, probe-results/, node_modules/
├── LICENSE                 # MIT
├── README.md               # what it is, setup, commands
├── src/
│   ├── cli.ts              # run | eval | eval score | probe
│   ├── contracts.ts        # zod schemas (Data Model)
│   ├── llm.ts              # Muse via AI SDK, runAgent, generateJson, gradeWithClaude
│   ├── qloo/
│   │   ├── client.ts       # calls, cache, limits, retries, trimming, trace
│   │   └── tools.ts        # AI SDK tools for agent stages
│   ├── engine/
│   │   ├── brief.ts        # text -> Brief; Brief -> QlooSignals (agent); policy
│   │   ├── candidates.ts   # candidate proposal + density + broadening (agent)
│   │   ├── fingerprints.ts # per-candidate top items and themes
│   │   ├── select.ts       # affinity matrix, selection, distinctiveness, Compare
│   │   ├── references.ts   # extraction + resolution (agent); fit; skew
│   │   ├── judge.ts        # arms, Review, citation check, quote location, score
│   │   └── run.ts          # orchestration, trace, usage, run.json
│   ├── report/render.ts    # Run -> HTML
│   ├── eval/
│   │   ├── harness.ts      # runs arms over the eval set; segmentation runs
│   │   ├── metrics.ts      # metrics, go/no-go, scorecard
│   │   ├── grader.ts       # specificity via Claude
│   │   └── blind.ts        # export pairs, score choices
│   └── probe/probe.ts      # coverage probe
├── eval/ads/*.yaml         # 15 eval ads + 3 demo examples (authored without Qloo)
├── probe/segments.yaml     # 3 tastes x 2 ages, markets US/CA/UK/ES/IN
└── test/                   # vitest: select, judge (citations, quotes, score), metrics; hand-made fixtures
```

## Risks and Caveats
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Qloo monthly quota (10,000 calls, one budget for M1, M2 and judging) | High | Fresh runs cost ~200 calls; the live app could run dry | Permanent local cache; fewer candidates and domains per run; quota tracked in selfcheck and traces; ask Qloo for more on Discord |
| Qloo key arrives late | Medium | Blocks every Qloo stage and the evals | Build the LLM layer, contracts, judge, report and harness first on hand-made fixtures; Qloo slices start the day the key lands |
| `filter.results.entities` doesn't score low-affinity items, or the affinity field differs | Medium | D4's matrix and reference fit | First Qloo probe checks it; fall back to overlap-based selection and rank-based fit (contracts unchanged) |
| Muse tool calling or structured output misbehaves through the AI SDK | Medium | Agent stages and the judge | Slice 1 probes it; fall back per stage to `generateJson`, or to the plain `openai` SDK behind `llm.ts` |
| Judge drift (reasoning always on, `seed` best-effort) | Medium | The stability metric | Low temperature, `reasoning_effort: low`; measured in slice 1; if drift is high, average two judge calls |
| Frontier LLMs already know the culture | Medium | Accuracy may tie | Tier B uses long-tail references; Tier D tests sycophancy; the "GO, reframed" outcome |
| Qloo data thin or noisy | Low–medium | Weaker CrowdCraft arm | Broadening, data confidence; the eval reports it honestly |
| Global `CLAUDE.md`/hooks leak into the grader | Medium | Biased specificity grades | Restricted setting sources and a probe call in slice 1; hand-check 10% of labels |
| Contributor tier trains on content; 100 req/min | Certain | Data use; slower evals | Accepted for M1 (see Debt); throttle at 80/min |
| Prompt injection via ad text | Low | Odd reviews | The judge has no tools; agents have read-only Qloo tools; outputs are schema-validated |
| Qloo data committed by accident | Low | Breaches Qloo terms | `.gitignore` covers every output and cache folder; the secrets check before each push greps for them |

## Rollout
Nothing is deployed in M1. The repo can be public from day 1 with the MIT license; outputs and caches never leave the machine.

## Testing Strategy
- **Unit (vitest, hand-made fixtures):** selection and distinctiveness on a fake matrix; Jaccard; citation validation (valid, invalid, wrong segment); quote location (exact, whitespace or case variants, not found); ranking score with and without references; every metric and the go/no-go rules.
- **Contract:** zod parse of every LLM output and Qloo response; a failed parse is a trace error, never a crash.
- **End to end:** `run` on the 3 demo ads; the eval itself is the quality test.
- **Critical paths:** citation validation (nothing unsourced is ever shown) and the metrics (the go/no-go must be computed correctly).

## Debt Taken
- Contributor tier: prompts (including Qloo data, and later customers' ad copy) may be used by Meta for training. Fine for hackathon testing; switch the deployed app to Standard before real customers use it.
- JSON files instead of a database: fine until M2 needs history across users.
- Qloo images are linked by URL, not stored: fine locally; revisit for M2.
- No UI: deliberately M2.

## Run and Verify
```bash
npm install
cp .env.example .env    # add QLOO_API_KEY and META_API_KEY
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run cc -- run eval/ads/demo-concert.yaml
npm run cc -- eval
npm run cc -- eval score eval-results/<timestamp>
npm run cc -- probe
```

## Open Issues
In the order the build should check them:
1. **Muse through the AI SDK** (no Qloo key needed): structured output in JSON Schema mode, the tool loop with `finish`, latency, cost per call, and score drift on the same input. Also confirm sign-up and billing work from India.
2. **`claude -p` grader**: the exact flags that keep global CLAUDE.md and hooks out, and a JSON-schema response.
3. **Qloo, the day the key arrives**: the affinity field name; whether `filter.results.entities` scores low-affinity items; ID-list length per GET; theme (tag) fit; audiences endpoints; observed rate limits; non-US density (the probe).
