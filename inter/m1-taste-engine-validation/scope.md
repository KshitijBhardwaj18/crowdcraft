---
doc: scope
milestone: 1
status: approved
---
# M1: Taste Engine Validation

The engine behind CrowdCraft (Qloo-grounded segments and reviews), proven against generic-AI baselines with a repeatable eval, before any product UI is built.

## Goal
The biggest risk in the project is not the UI. It's whether Qloo-grounded judging actually beats a generic LLM. Proving it first (about 5 days, with about 23 to the deadline) either produces hard numbers for the pitch ("if it would work the same without Qloo, you're building the wrong thing") or forces a change of approach in week 1, not week 3.

## Done Looks Like
One command runs the eval set through the Qloo-grounded engine and the generic baselines, and produces a **scorecard** with a clear go/no-go against the PRD's criteria. One command runs a single ad and produces an **HTML run report** (segments, taste fingerprints, verdicts, voiced reactions, highlighted ad, references, trace) that you'd be happy to show someone.

## In
- **The engine as an agent with Qloo tools**: input (ad, type, channel, brand line, audience) → audience understanding → 4–6 distinct segments → reference resolution → per-segment review (gut verdict, voiced reaction, line highlights, every claim sourced) → ranking score. Agentic decisions are logged in a trace (broaden sparse segments, retry unresolved references).
- **Qloo coverage**: Audiences and Audience Types, Tag Search and Tag Types, Entity Search and Entities by ID, Insights (recommendations across entity types, location-based, demographic), Taste Analysis, and Analysis Compare.
- **Baselines**: the same LLM and the same segments without Qloo data (named-only persona and LLM-invented persona).
- **Eval set and harness**: authored known-answer ads, the metrics, and the scorecard with go/no-go.
- **Run report**: a static HTML file per run, written by the engine. No app.
- Qloo response data is cached locally or server-side and never committed to the public repo.

## Out
- The product UI (composer, results screens, adding and editing segments in a UI, examples, landing page, look and feel) and deploying live. Likely M2 (Ideas).
- Tailored rewrites and the craft loop (Ideas)
- Map view using Qloo Heatmap (Ideas)
- Persona chat and avatar (Ideas)
- Several ads per run (Ideas)
- Image and video input (Ideas)
- Non-US segments (Ideas)
