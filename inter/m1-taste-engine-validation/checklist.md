---
doc: checklist
status: approved
---
# M1: Taste Engine Validation — Build Checklist

## Slices

- [x] **1. Muse judges a hand-made segment, for every arm, into a report**
  Delivers: the four arms (CrowdCraft, B1, B2, ablation) review an ad for a hand-made segment through Muse, with citation checks, quote-located highlights and ranking scores, written to `run.json` and a readable `report.html`. `selfcheck` proves Muse structured output, the agent tool loop with `finish`, and judge drift.
  Why now: Muse through the AI SDK is the top open issue and needs no Qloo key. It also bootstraps the project and fixes the contracts everything else uses.
  Refs: `prd.md > Review (per segment)`, `prd.md > Baselines`, `prd.md > Run Report (HTML)`, `spec.md > D3: LLM layer and judge model — decided`, `spec.md > D5: Data contracts — decided`, `spec.md > Data Model`, `spec.md > Interfaces`, `spec.md > Meta Model API (Muse Spark)`
  Build: scaffold (`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `LICENSE`, `README.md`); `src/contracts.ts`; `src/llm.ts` (`generateJson`, `runAgent` with `finish` and fallback, usage and cost); `src/engine/judge.ts` (four arms, B2 two-step, citation validation, quote location, ranking score); minimal `src/engine/run.ts` and `src/report/render.ts`; `src/cli.ts` with `run --fixture` and `selfcheck`; `test/fixtures/concert.fixture.json` (hand-made, fake IDs, labelled as fake); vitest for citations, quote location and scoring.
  Verify: `npm run typecheck && npm test` pass; `npm run cc -- selfcheck` prints ✓ structured output, ✓ tool loop ending in `finish`, and judge drift ≤ 5 on two identical calls; `npm run cc -- run --fixture test/fixtures/concert.fixture.json` writes a `run.json` that parses against the `Run` schema and a `report.html` with every arm's review.
  Try it: open `runs/<id>/report.html` and compare the four reviews of the same segment (the data is hand-made, so judge the format and tone, not the truth).
  Commit: `feat: Muse judge with four arms, citation checks and HTML report`

- [x] **2. Baselines run through the eval and get a scorecard**
  Delivers: the eval set exists; `eval` runs the two baselines on its fixed segments, grades specificity with Claude, measures stability and accuracy, exports blind pairs, and writes a scorecard. Metrics that need Qloo show as pending.
  Why now: the `claude -p` grader is the second open issue, and the harness and eval ads can be finished before the Qloo key arrives. Baseline numbers also show early how strong the bar is.
  Refs: `prd.md > Eval Set`, `prd.md > Eval Command and Scorecard`, `spec.md > Eval harness (new) — src/eval/harness.ts, src/eval/metrics.ts, src/eval/grader.ts, src/eval/blind.ts`, `spec.md > Interfaces`, `spec.md > Claude Code CLI (claude -p)`
  Build: `eval/ads/*.yaml` (15 eval ads across Tiers A–D plus 3 demos, drafted without Qloo, for your review); `src/eval/harness.ts`, `metrics.ts`, `grader.ts`, `blind.ts`; scorecard JSON and HTML; `eval score`; a grader leak check in `selfcheck`; vitest for metrics and go/no-go rules.
  Verify: `npm test` passes; `npm run cc -- selfcheck` shows the grader returns schema JSON with no global CLAUDE.md or hook text; `npm run cc -- eval --arms b1_named,b2_invented` writes a scorecard with baseline accuracy, stability drift and specificity, plus `blind-pairs.csv` and `blind-key.json`.
  Try it: read the eval ads in `eval/ads/` and edit any that feel off; open the baseline scorecard.
  Commit: `feat: eval harness, Claude grader, blind export and baseline scorecard`

- [x] **3. See how well Qloo covers each market, and prove the API assumptions**
  Delivers: the Qloo client (cache, limits, retries, trimming, chunking, trace) and the `probe` command with a Good / Thin / Unusable verdict for the US, Canada, UK, Spain and India. `selfcheck --qloo` reports the open Qloo assumptions.
  Why now: it's the first slice that needs the Qloo key, and it settles the assumption D4 rests on before any segment code is written.
  Refs: `prd.md > Coverage Probe`, `spec.md > Qloo (hackathon)`, `spec.md > Qloo client (new) — src/qloo/client.ts`, `spec.md > Coverage probe (new) — src/probe/probe.ts`, `spec.md > Risks and Caveats`, `spec.md > Open Issues`
  Build: `src/qloo/client.ts`; `selfcheck --qloo` (affinity field name, whether `filter.results.entities` scores low-affinity items, ID-list length, theme fit, audiences endpoints, observed rate limits); `probe/segments.yaml`; `src/probe/probe.ts`; coverage report.
  Verify: `npm run cc -- selfcheck --qloo` prints each assumption as confirmed or failed with evidence; `npm run cc -- probe` writes `coverage.html` with a verdict and sample fingerprint per market; `git status` shows nothing from `.cache/` or `probe-results/`.
  Try it: open `probe-results/<timestamp>/coverage.html`.
  Commit: `feat: Qloo client, API assumption checks and coverage probe`

- [ ] **4. A brief becomes real, distinct Qloo segments**
  Delivers: `run` takes a brief, turns it into verified Qloo signals (agent), proposes and broadens candidates (agent), builds fingerprints and the affinity matrix, and keeps the 4–6 most distinct segments with their distinctive items and "what sets them apart". The judge uses them, without references yet.
  Why now: segments are the kernel's foundation, and this is the first real look at it.
  Refs: `prd.md > Brief`, `prd.md > Agent Flow (how Qloo is used)`, `prd.md > Segment`, `spec.md > D2: How agentic the engine is — decided`, `spec.md > D4: Segment building and distinctness — decided`, `spec.md > Qloo agent tools (new) — src/qloo/tools.ts`, `spec.md > Brief stage (new) — src/engine/brief.ts`, `spec.md > Candidates stage (new) — src/engine/candidates.ts`, `spec.md > Fingerprints and selection (new) — src/engine/fingerprints.ts, src/engine/select.ts`, `spec.md > Policy additions`
  Build: (Qloo budget: 6–8 candidates, affinity matrix over 4 domains) `src/qloo/tools.ts`, `src/engine/brief.ts`, `candidates.ts`, `fingerprints.ts`, `select.ts` (plus unit tests on a fake matrix); wire into `run.ts`; **report redesign as one page built for analysis**: a segment grid (all segments side by side), a letter grade from the ranking score beside each verdict, click-through to reaction, highlights and sources, and a **taste collage** per segment built from its real Qloo images (user's choice; no AI portraits).
  Verify: `npm test` passes; `npm run cc -- run eval/ads/demo-concert.yaml` (and the other two demos) produce 4–6 segments each with overlap ≤ 0.30 printed, trace entries for agent decisions, and names without stereotype labels; a brief mentioning ethnicity lists it under unused, with no segment split on it.
  Try it: open the report. Do the segments feel like real, different crowds, and is the page pleasant and easy to analyse?
  Commit: `feat: brief to Qloo signals, candidate agent and affinity-matrix segments`

- [ ] **5. The full CrowdCraft review, with the ad's references scored by Qloo**
  Delivers: references are extracted and resolved (agent), fit is scored per segment with demographic skew, the ranking score uses it, and the report is complete. `run --text` works from free text and asks for missing fields.
  Why now: it completes the kernel. Every PRD report section and run-level acceptance criterion can now be checked.
  Refs: `prd.md > Core Journey`, `prd.md > Review (per segment)`, `prd.md > Run Report (HTML)`, `prd.md > States and Edge Cases`, `spec.md > References stage (new) — src/engine/references.ts`, `spec.md > Run orchestrator and trace (new) — src/engine/run.ts`, `spec.md > Report (new) — src/report/render.ts`
  Build: `src/engine/references.ts`; reference fit and skew in `run.ts` and `judge.ts`; full report sections; `--text` path with missing-field prompts; edge cases from the PRD (no references, unresolved references, length limits, non-English, failure mid-run keeps partial results).
  Verify: `npm run cc -- run` on the 3 demos and `npm run cc -- run --text "<brief and ad>"` produce complete reports; every shown claim and highlight has a valid source (dropped counts shown); a brief with no market stops and asks; every Qloo call appears in the trace.
  Try it: run your own ad with `npm run cc -- run --text "…"` and read the report.
  Commit: `feat: reference resolution and fit, complete run report, free-text briefs`

- [ ] **6. Get the go/no-go**
  Delivers: `eval` runs all four arms on Qloo-resolved fixed segments (twice, for stability), evaluates segmentation and brief extraction separately, measures invented-vs-real taste, and produces the full scorecard with a go/no-go. `eval score` folds in your blind ratings.
  Why now: it needs everything above. It answers the milestone's question.
  Refs: `prd.md > Eval Command and Scorecard`, `prd.md > Acceptance Criteria`, `scope.md > Done Looks Like`, `spec.md > Eval harness (new) — src/eval/harness.ts, src/eval/metrics.ts, src/eval/grader.ts, src/eval/blind.ts`
  Build: all-arm eval on resolved segments, segmentation and brief-extraction runs, invented-vs-real taste, ablation reporting, the full go/no-go; tune the ranking weight and thresholds from the results (recorded under Revisions).
  Verify: `npm run cc -- eval` completes without manual steps and the scorecard lists every PRD metric with a target, a result and pass/fail; after you fill `blind-pairs.csv`, `npm run cc -- eval score <dir>` shows the final verdict.
  Try it: rate the blind pairs, then read the scorecard.
  Commit: `feat: full eval across arms with go/no-go scorecard`

## Final Review

- [ ] Hands-on review done, agreed fixes made, user confirms it's ready

## Finish

- [ ] Full checks pass (tests, lint, build per `spec.md > Run and Verify`)
- [ ] Secrets and history check clean
- [ ] README and `.env.example` reflect how to run it
- [ ] Branch pushed and PR opened: <link>
- [ ] Code review done: findings triaged, fixes pushed
- [ ] `product.md` updated: milestone logged under Shipped, learnings moved into Ideas

## Revisions
- 2026-10-09 (slice 1): Qloo key arrived early, so two Qloo checks ran now. **Verified:** the affinity score is `query.affinity`. **Half-holds:** `filter.results.entities` *omits* items below a segment's cutoff rather than scoring them, and returned scores are compressed (≈0.85–0.99). Plan: a missing item counts as "no engagement" (0) and fit is normalised across segments per reference (already how `normFit` works). Slice 3 confirms this at scale.
- 2026-10-09 (slice 1): Muse 1.3 Contributor through AI SDK v7 works: structured output (`Output.object`), the tool loop ending in `finish`, and drift of 0 on identical input. Latency is about 10–20s per call (reasoning can't be off), so M2's UI must stream progress.
- 2026-10-09 (slice 1): internal changes. `Trace` and a small `limiter` live in `src/trace.ts` (no `p-limit`); `dotenv` dropped for Node's `--env-file-if-exists`; the judge cites short aliases (F1, T1, S1, R1) that code maps back to Qloo IDs, because models copy UUIDs badly.
- 2026-10-09 (after slice 1): user asked for a beautiful one-page report built for analysis (segment grid, grades, a visual per segment). Folded into slice 4, where real Qloo segments and images first exist. AI portraits of people were flagged as a stereotype risk (they'd infer race, gender and looks from the segment); the visual option is the user's call.
- 2026-10-09 (slice 2): the user chose taste collages from real Qloo images for the segment visuals.
- 2026-10-09 (slice 2): the eval set has 16 eval ads (Tier B has 7, not 6) plus 3 demos. Count targets in the PRD are applied as the same proportions (e.g. accuracy ≥ 75%, brief extraction ≥ 87%). For Tier D, `intendedSegmentId` holds the brief's target segment and `actualFitSegmentId` the crowd the references fit.
- 2026-10-09 (slice 2): grader verified: `claude -p --setting-sources project` from an empty temp directory receives no CLAUDE.md, hooks or plugins. zod's `$schema` stamp must be stripped for `--json-schema`, and stdin must be closed.
- 2026-10-09 (slice 2): the PRD's GO rule (two wins) already covers "specificity + preference", so "GO, reframed" is reported when exactly those two win and accuracy and mismatch don't. It's still a GO; the pitch changes.
- 2026-10-09 (slice 2): stability is reported as the share of segment pairs within ±5 and one verdict step, with a 90% target for CrowdCraft (the PRD gave no share).
- 2026-10-09 (slice 2 result): full baseline eval (19 ads × 2 arms × 2 runs, $0.16, 12 min). **Both baselines score 100% accuracy on every tier, including B and C, and catch 100% of mismatches.** Stability: B1 84% within ±5 (avg drift 2.8), B2 78% (3.0). Specificity: B1 0.9 / B2 1.8 specific claims per reaction. So accuracy and mismatch can only tie; the go/no-go rests on specificity (CrowdCraft needs ≥ 3.6) and blind preference. The eval set is too easy (famous references, far-apart segments). Proposed: a Tier E of "close crowds" inside one target (user to decide).
- 2026-10-09 (slice 3): **Qloo limits are 5 requests/second and 10,000/month** (response headers; ~9,930 left, resetting after the deadline). One budget covers M1, M2 and judges. Client throttled to ~4.5/s with 429 backoff and tracks the monthly remainder. Slice 4 trims calls per run (6–8 candidates, affinity matrix over 4 domains). User asked to request a higher quota on the hackathon Discord (#api-help).
- 2026-10-09 (slice 3): verified: `filter.results.entities` scored 37 of 58 other-crowd artists for Austin and omitted 21 (treated as no engagement); `filter.results.tags` is ignored, so theme fit uses the tag's rank in the segment's top themes; `/v2/audiences` works despite the deprecation label; locality resolves at `query.localities.signal`; Analysis Compare returns `results.a`, `results.b` and shared `results.tags`.
- 2026-10-09 (slice 3): coverage probe: US, Canada, UK, Spain and India are all **Good** (100% fill, 79–93% local specificity, ~94% distinctness), with genuinely local taste (e.g. Whitney in Chicago, Brickworks Cider in Toronto, Peter Cat Recording Co. in Mumbai).
- 2026-10-09 (slice 4): first real segment runs exposed four quality problems, all fixed: (1) "distinctive" items repeated across segments → distinctive items now come only from a segment's own top lists, ranked by how much less the other kept segments love them; (2) places from other cities → place fingerprints now use `filter.location.query` (the location signal alone doesn't filter); (3) every candidate carried the same generic tags → the candidates prompt gives each its own taste anchor; (4) identity tags (e.g. "queer", "trans") surfaced as themes → a sensitive-tag filter on themes, "sets apart" and the agent's tag search. Worst-pair overlap went 23% → 6%.
- 2026-10-09 (slice 4): the brief's age buckets are enforced in code: candidates entirely outside are dropped, partial overlaps are clamped and renamed; gender follows the brief. Eval briefs now carry `ageBuckets` from their target text.
- 2026-10-09 (slice 4): agent final answers use a strict `finish` tool; if the answer still doesn't fit the contract, one schema-locked call repairs it from the tool results.
- 2026-10-09 (slice 4): report redesigned as one page: "The Lineup" (the verdict as a festival poster), a segment grid with taste collages from real Qloo images and letter grades (A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F), per-segment detail with baselines side by side. Added `report <run.json>` to re-render without calls. Segments are cached per brief target, so ad edits reuse them for free.
- 2026-10-09 (slice 4): the "sensitive attribute listed under unused" check needs the free-text brief parser, which lands in slice 5; slice 4 verifies that the agent never splits on identity (prompt policy, audience-type filter, tag filter).
- 2026-10-09 (slice 4, user feedback): the poster report was unclear ("what was the ad? what do I do?") and taste-tribe names weren't actionable for campaign managers. Agreed: segments become **region × age cells** (spec D4b, PRD Key Decisions), a **"What to do" summary step** per run, and an **app-style dashboard** report (PRD Run Report). Slice 4 stays open until the user is happy with the dashboard.
- 2026-10-09 (slice 4): region × age cells, the "What to do" summary and the dashboard are built. Concert demo: the agent proposes 8 regions, code keeps the 3 most different (e.g. Austin, LA, Chicago) × under 30 / 30-34; ~76 Qloo calls. Citations: brief's own interest tags are excluded from themes and the judge prefers specific items (20 specific vs 9 theme citations).
- 2026-10-09 (slice 4): open quality issue for slice 6: with a shared interest tag (e.g. "live music"), cities' top lists overlap more (worst cross-region 53%) than age bands within a city (21%). Verdicts still differ sharply. The segmentation metric now reports cross-region and within-region overlap separately.

