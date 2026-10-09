---
doc: checklist
status: approved
---
# M1: Taste Engine Validation — Build Checklist

## Slices

- [ ] **1. Muse judges a hand-made segment, for every arm, into a report**
  Delivers: the four arms (CrowdCraft, B1, B2, ablation) review an ad for a hand-made segment through Muse, with citation checks, quote-located highlights and ranking scores, written to `run.json` and a readable `report.html`. `selfcheck` proves Muse structured output, the agent tool loop with `finish`, and judge drift.
  Why now: Muse through the AI SDK is the top open issue and needs no Qloo key. It also bootstraps the project and fixes the contracts everything else uses.
  Refs: `prd.md > Review (per segment)`, `prd.md > Baselines`, `prd.md > Run Report (HTML)`, `spec.md > D3: LLM layer and judge model — decided`, `spec.md > D5: Data contracts — decided`, `spec.md > Data Model`, `spec.md > Interfaces`, `spec.md > Meta Model API (Muse Spark)`
  Build: scaffold (`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `LICENSE`, `README.md`); `src/contracts.ts`; `src/llm.ts` (`generateJson`, `runAgent` with `finish` and fallback, usage and cost); `src/engine/judge.ts` (four arms, B2 two-step, citation validation, quote location, ranking score); minimal `src/engine/run.ts` and `src/report/render.ts`; `src/cli.ts` with `run --fixture` and `selfcheck`; `test/fixtures/concert.fixture.json` (hand-made, fake IDs, labelled as fake); vitest for citations, quote location and scoring.
  Verify: `npm run typecheck && npm test` pass; `npm run cc -- selfcheck` prints ✓ structured output, ✓ tool loop ending in `finish`, and judge drift ≤ 5 on two identical calls; `npm run cc -- run --fixture test/fixtures/concert.fixture.json` writes a `run.json` that parses against the `Run` schema and a `report.html` with every arm's review.
  Try it: open `runs/<id>/report.html` and compare the four reviews of the same segment (the data is hand-made, so judge the format and tone, not the truth).
  Commit: `feat: Muse judge with four arms, citation checks and HTML report`

- [ ] **2. Baselines run through the eval and get a scorecard**
  Delivers: the eval set exists; `eval` runs the two baselines on its fixed segments, grades specificity with Claude, measures stability and accuracy, exports blind pairs, and writes a scorecard. Metrics that need Qloo show as pending.
  Why now: the `claude -p` grader is the second open issue, and the harness and eval ads can be finished before the Qloo key arrives. Baseline numbers also show early how strong the bar is.
  Refs: `prd.md > Eval Set`, `prd.md > Eval Command and Scorecard`, `spec.md > Eval harness (new) — src/eval/harness.ts, src/eval/metrics.ts, src/eval/grader.ts, src/eval/blind.ts`, `spec.md > Interfaces`, `spec.md > Claude Code CLI (claude -p)`
  Build: `eval/ads/*.yaml` (15 eval ads across Tiers A–D plus 3 demos, drafted without Qloo, for your review); `src/eval/harness.ts`, `metrics.ts`, `grader.ts`, `blind.ts`; scorecard JSON and HTML; `eval score`; a grader leak check in `selfcheck`; vitest for metrics and go/no-go rules.
  Verify: `npm test` passes; `npm run cc -- selfcheck` shows the grader returns schema JSON with no global CLAUDE.md or hook text; `npm run cc -- eval --arms b1_named,b2_invented` writes a scorecard with baseline accuracy, stability drift and specificity, plus `blind-pairs.csv` and `blind-key.json`.
  Try it: read the eval ads in `eval/ads/` and edit any that feel off; open the baseline scorecard.
  Commit: `feat: eval harness, Claude grader, blind export and baseline scorecard`

- [ ] **3. See how well Qloo covers each market, and prove the API assumptions**
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
  Build: `src/qloo/tools.ts`, `src/engine/brief.ts`, `candidates.ts`, `fingerprints.ts`, `select.ts` (plus unit tests on a fake matrix); wire into `run.ts`; segment section of the report.
  Verify: `npm test` passes; `npm run cc -- run eval/ads/demo-concert.yaml` (and the other two demos) produce 4–6 segments each with overlap ≤ 0.30 printed, trace entries for agent decisions, and names without stereotype labels; a brief mentioning ethnicity lists it under unused, with no segment split on it.
  Try it: open the report. Do the segments feel like real, different crowds?
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
