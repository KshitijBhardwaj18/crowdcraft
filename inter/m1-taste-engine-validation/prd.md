---
doc: prd
status: approved
---
# M1: Taste Engine Validation — PRD

M1 has no product UI. Its surfaces are a **brief**, three **commands** (run, eval, probe) and the **reports** they write. It answers three questions: does Qloo-grounded judging beat generic AI, is the output good enough to build a product on, and which markets does Qloo cover well?

## Key Decisions
| Question | Decision |
|---|---|
| What goes in? | The **ad** (copy or script) plus a **brief** in free text: where it runs, who it's for, the channel, and the brand and product. The LLM structures the brief and asks for anything required that's missing. |
| What decides the segments? | **The brief.** Segments are sub-crowds **inside the target and market**. "Misses" means parts of the user's own audience the ad isn't reaching. |
| What do segments differ by? | **Taste first** (Qloo audiences, tags, "fans of"), then **place** within the market, then **age** within the target range. **Gender** only if the brief asks for it. |
| Sensitive attributes? | Ethnicity, race, religion and sexuality are **never inferred and never used as a split**. A community is allowed only when the brief names it explicitly *and* Qloo has a matching community audience; it's labelled as such. Culture comes through taste ("San Antonio fans of Bad Bunny and Selena"), not identity labels. |
| How many segments? | The agent keeps the **4–6 most distinct** of 8–10 candidates (at least 2 when taste is uniform). |
| One ad or many? | One ad per run. |
| What does a segment say? | A **gut verdict** (Love / Like / Meh / Skip, plus whether they'd act), a **reaction in their own voice**, and **line highlights** on the ad. A 0–100 **ranking score** is used only for ordering. Every claim is sourced to Qloo data. |
| What is it compared against? | Two **baselines** run with the same LLM, the same segments and the same output format, but without Qloo data. |
| Markets? | US for the main evals; a **coverage probe** measures Canada, UK, Spain and India. |

## Core Journey
1. Write a **brief** and an **ad**, either free text or a structured brief file.
2. Run **`run`**. The engine structures the brief, prints what it inferred and what it couldn't use, and asks for any missing required field.
3. The agent works: brief → Qloo signals → 8–10 candidate segments → the 4–6 most distinct → ad references resolved → a review per segment. The baselines run on the same segments.
4. The engine writes an **HTML run report**.
5. Run **`eval`**. Every eval ad goes through CrowdCraft and both baselines, and the engine writes a **scorecard** with a go/no-go.
6. Run **`probe`**. The engine queries the probe segments in each market and writes a **coverage report** with a verdict per market.

## Surfaces

### Brief
| Field | Example | Required |
|---|---|---|
| Ad creative | The ad text | Yes |
| Ad type | Ad copy or Script (inferred if not given) | No (default: Ad copy) |
| Market | "US → Texas → Austin" | Yes |
| Target audience | "music fans 18–34 who go to live shows" | Yes |
| Channel or format | Instagram reel, YouTube pre-roll, TV or streaming spot, radio or podcast read, billboard, social post, email, General | No (default: General) |
| Brand and product | "Northline, an indie music festival" | No |

- The user can give **free text**, which the LLM turns into these fields, or a **structured brief file** (used by the eval set so runs can be repeated).
- The engine prints the structured brief back and lists anything it **couldn't use**, with the reason, e.g. "Not used: *ethnicity*, since Qloo has no data for it. Describe tastes instead." Words that map to Qloo audiences (e.g. "affluent" → spending-habit audiences) are mapped and shown.
- If a required field is missing, it **asks** (interactive) or **stops and lists what's missing** (non-interactive).

### Agent Flow (how Qloo is used)
Each step, the Qloo capability it uses, and what it produces. Exact endpoints and parameters belong to the spec.

| Step | Qloo capability | Produces |
|---|---|---|
| 1. Brief → signals | **Audiences** and **Audience Types**, **Tag Search** and **Tag Types**, **Entity Search**, locality lookup | The target as Qloo signals: location, age buckets, optional gender, audience IDs, interest tags, "fans of" entities |
| 2. Candidates | **Insights** (location-based, demographic signals, audiences, interests) | 8–10 candidate segments that vary along the open axes |
| 3. Fingerprints | **Insights** across artists, brands, films, TV, places, podcasts, books and games, plus **Taste Analysis** (tags) | Each candidate's top taste with affinity scores, and its themes and vibes |
| 4. Pick the distinct ones | **Analysis Compare** | A measured overlap between candidates; keep the 4–6 most distinct, and broaden or drop thin ones |
| 5. Distinctive taste | Fingerprints compared across the kept segments | Each segment's **distinctive** items (what it over-indexes on compared with the others) |
| 6. Ad references | **Entity Search**, **Tag Search** | Named references (brands, artists, songs, places, shows, people) and implied themes, resolved to Qloo IDs |
| 7. Reference fit | **Insights** with each segment's signals over the ad's references, **Demographic insights**, **explainability** | Affinity per reference per segment, each reference's age and gender skew, and what drove each result |
| 8. Card details | **Entities by ID** | Names, images and short descriptions for the report |
| 9. Review | No Qloo call; the LLM uses only the data from steps 5–7 | The verdict, reaction, highlights and ranking score |

The agent makes and logs decisions: broadening a thin segment (city → state, dropping an age band), retrying an unresolved reference as a tag, and treating an empty Qloo result as thin data (Qloo silently ignores invalid parameters).

### Segment
- **Name**: specific and built from its signals, e.g. "Austin indie-music fans, 25–34". Never a stereotype label.
- **Defined by**: the Qloo signals.
- **Fingerprint**: its top distinctive items across domains, plus themes. Every item is a real Qloo entity or tag; nothing is LLM-written.
- **Data confidence**: Normal, or Broadened / Thin with the reason.
- **Respects the brief**: never outside the brief's market, age range or other stated constraints.

### Review (per segment)
What the LLM is given: the ad, type, channel, brand line, the segment's distinctive fingerprint, and its reference fit. Nothing else about the segment.

What it returns:
- **Gut verdict**: Love / Like / Meh / Skip.
- **Would they act?**: worded for the channel, e.g. "Would stop scrolling" or "Would drive past".
- **Reaction**: 2–4 sentences in the segment's voice. Each claim cites a **taste source** (a fingerprint item or a reference fit value).
- **Line highlights**: spans of the ad marked **lands** or **loses them**, each with a reason and a taste source.
- **Ranking score** (0–100): a blend of **reference fit** (Qloo data) and **judgement** (tone, vibe, hook, channel fit), with the weighting stated.

Any claim or highlight whose source isn't in the data provided is **dropped**, never shown.

### Baselines
All arms use the same LLM, the same segments, the same ad and brief, and the same output format. **Only the data differs.**

| Arm | What the LLM gets | Represents |
|---|---|---|
| **CrowdCraft** | The Qloo fingerprint and reference fit | Our product |
| **B1: Named persona** | The segment's name and definition only | A typical "ask the AI" focus group |
| **B2: Invented persona** | The LLM first invents a detailed persona for the segment (bio, favourite artists, brands, shows), then judges | Synthetic-persona tools, i.e. "personas an AI made up" |
| **Ablation** (reported only) | The Qloo fingerprint without reference fit | Shows which part of Qloo matters; informs the score weighting |

Baseline claims can't be checked against a source, so they're shown as they are and marked "unsourced".

### Eval Set
About 15 ads with structured briefs, **written without consulting Qloo** (otherwise Qloo wins by construction). Each has an **intended segment** and a **fixed set of 4–5 segments** inside its market (the intended one plus contrasts), so the right answer is known.

| Tier | Count | What it tests |
|---|---|---|
| **A: Obvious** | 3 | The ad says who it's for. Every arm should pass; it's a sanity check. |
| **B: Taste-coded** | 6 | The fit comes only from cultural references, never labels (e.g. an Austin indie ad that never says "Austin" or "indie"). References are **long-tail, local or cross-domain**, not famous ones an LLM already knows. **This is the real test.** |
| **C: Split** | 3 | The ad has lines that land with one crowd and miss another. Tests spread and highlights. |
| **D: Mismatch** | 3 | The brief targets crowd X, but the ad's references actually fit crowd Y. Generic AI tends to flatter; grounded judging should give the brief's target **Meh** or **Skip**. Tests sycophancy. |

The 3 demo examples (a concert tour promo, a sports season-ticket ad, a comedy special script; all fictional brands) also run, for review in the reports. The agent's own segmentation is evaluated separately, on the same briefs.

### Eval Command and Scorecard
`eval` runs every eval ad through every arm and writes a scorecard: each metric per arm, its target, pass or fail, and the overall verdict.

**Judging metrics**
| Metric | Target |
|---|---|
| **Accuracy**: the intended segment ranks first (Tiers A–C) | CrowdCraft ≥ 9 of 12, **and** beats the best baseline on Tiers B and C |
| **Verdict fit**: the intended segment gets Love or Like (Tiers A–C) | CrowdCraft ≥ 9 of 12 |
| **Mismatch caught**: the brief's target gets Meh or Skip, and the crowd the references actually fit ranks higher (Tier D) | CrowdCraft catches ≥ 2 of 3, and catches more than the best baseline |
| **Spread**: the gap between the top and bottom segment | ≥ 25 points with different verdicts, on most ads |
| **Stability**: the same ad run twice, measured **for every arm** | CrowdCraft scores within ±5 and verdicts at most one step apart; report how much the baselines drift |
| **Sourcing**: shown claims with a valid source | 100% for CrowdCraft (also report how many were dropped) |
| **Specificity**: specific, taste-backed claims per reaction | CrowdCraft ≥ 2× the best baseline |
| **Blind preference**: paired reactions, CrowdCraft vs the best baseline, unlabelled; which is more useful and believable? | CrowdCraft wins ≥ 70% of about 20 pairs (judged by you, plus 1–2 others if possible) |
| **Highlight flip**: the same line lands for one segment and misses for another | At least one flip on every Tier C ad |

**Segmentation metrics** (CrowdCraft only)
| Metric | Target |
|---|---|
| **Distinctness**: overlap between kept segments | Below the threshold set in the spec |
| **Respects the brief**: segments inside the market and constraints | 100% |
| **Policy**: no split on inferred ethnicity, race, religion or sexuality | 100% |
| **Naming**: specific, no stereotype labels | 100% (spot-checked by you) |

**Reported, no target**
- **Invented vs real taste**: how much of B2's invented taste matches Qloo's fingerprint for the same segment. This becomes the pitch line "only X% of what AI imagines this crowd loves is real."
- **Ablation results**, which feed the score weighting.
- **Brief extraction**: free-text versions of the eval briefs compared with their structured versions.
- **Cost, time and Qloo call count** per run.

**Go / no-go**
- **GO**: stability, sourcing and segmentation pass, **and** CrowdCraft wins at least two of: Tier B/C accuracy vs the best baseline, mismatch caught, specificity ≥ 2×, blind preference ≥ 70%.
- **GO, reframed**: accuracy ties, but specificity and preference win. The pitch becomes "explains *why*, with real taste" rather than "predicts better".
- **NO-GO**: CrowdCraft doesn't beat the baselines on specificity or preference. Rethink how Qloo is used before M2.

### Run Report (HTML)
One static file per run, ordered verdict first so it can be shown to someone non-technical:
1. **Verdict line**, e.g. "Love from Austin indie fans and NYC streetwear; Skip from suburban sports families." Below it, the segment verdicts ranked, and "Directional, not guaranteed."
2. **Brief**: as structured, plus anything that wasn't used and why.
3. **Segments**: name, defined-by signals, fingerprint (with images), data confidence.
4. **Per segment**: the verdict, would-act, the reaction with source chips, and the **ad with this segment's highlights** (reason and source on hover).
5. **References**: each one's resolution, affinity per segment, and demographic skew.
6. **Baselines**: B1 and B2 reactions next to CrowdCraft's for each segment, with claim counts.
7. **Score breakdown**: reference fit vs judgement, with weights.
8. **Trace**: every agent step and Qloo call (expandable), decisions made, cost and time.

### Coverage Probe
`probe` runs the same probe segments (3 taste groups × 2 age bands) in the **US** (reference), **Canada**, **UK**, **Spain** and **India**, and writes a coverage report. For each market:
- **Fill rate**: the share of queries that return results, and results per domain.
- **Local specificity**: how different the fingerprint is from the US one for the same taste and age. If Spain's "indie fans" look identical to America's, the location isn't really working.
- **Distinctness**: whether segments within the market still differ.
- **Verdict**: **Good**, **Thin** or **Unusable**, with the evidence, plus a sample fingerprint so you can judge by eye.

## States and Edge Cases
- **Missing required brief field** (ad, market or target): ask interactively, or stop and list the missing fields.
- **Target too broad** ("everyone"): the agent picks diverse segments across the market and says so.
- **Target too narrow or data thin**: broaden (city → state, drop an age band), mark data confidence, and log it.
- **Unmappable or sensitive attribute in the brief**: not used, and the report says why. Named communities are used only if Qloo has a matching community audience.
- **Non-US market in `run`**: allowed, with a warning that points to the probe results for that market.
- **Fewer than 4 distinct segments**: keep at least 2, with a note that the target's taste is uniform.
- **No named references in the ad**: judging uses themes only, and reference fit shows as N/A.
- **Unresolved reference**: listed as "not in Qloo" and excluded.
- **Ad under ~10 words**: a warning, but the run continues. **Over ~5,000 characters**: rejected.
- **Ad not in English**: rejected with a message.
- **Qloo or the LLM fails mid-run**: the report and console show the failed step; completed work is kept; re-running resumes from cached Qloo data.
- **Caching**: Qloo responses are cached locally for speed and repeatability, and kept out of the repo (Qloo terms).

## Look and Feel
- **Run report**: one page, beautiful and built for analysis. Verdict first; then a **segment grid** (all segments side by side, each with its verdict, a letter grade from the ranking score, and a visual); click into a segment for its reaction, highlights and sources; Qloo detail below. Pleasant enough to show a judge.
- **Console**: short progress lines that mirror the trace, e.g. "✓ 9 candidates → keeping 5". Errors say what went wrong and what to do next.

## Acceptance Criteria
**Brief**
- Free text with a market and target is turned into a structured brief that matches the authored structured version for at least 13 of 15 eval briefs.
- A missing market or target is always caught and asked for (or listed); a run never starts without them.
- Sensitive attributes are never used as signals, and the report says so whenever one appears in a brief.

**Segments**
- Every segment is defined by real Qloo signals, every fingerprint item is a real Qloo entity or tag, and no segment falls outside the brief's constraints.
- The segmentation metrics in the scorecard pass.

**Reviews**
- Every review has a verdict, would-act, a reaction and highlights. Every shown claim and highlight has a valid taste source.
- All arms produce the same output format on the same segments.

**Eval**
- `eval` runs end to end without manual steps and produces a scorecard with every metric listed above and a go/no-go verdict.
- Blind preference pairs are exported in a form a person can judge without seeing which arm wrote what, and the results feed back into the scorecard.

**Probe**
- `probe` produces a coverage verdict for the US, Canada, UK, Spain and India, with evidence and a sample fingerprint for each.

**Report**
- `run` produces a self-contained HTML report with every section listed above, for any ad and brief, including the 3 demo examples.
- Every Qloo call made during a run appears in the trace.

## Out of Scope
- The product UI (composer, results screens, interactive brief, adding and editing segments in a UI, examples, landing page) and deploying live. Likely M2.
- Several ads per run, the ad goal as an input, and dimension ratings.
- Tailored rewrites and the craft loop.
- Map view (Heatmap), persona chat and avatar, reel generator.
- Image and video input.
- Accounts, history, payments and shareable reports.

## Open Questions
- **Should a reaction say what *would* land** (e.g. "now if you'd used Khruangbin…")? The default for M1 is **no**, to keep the arms comparable; revisit in M2. **Owner: you.**
- **Who writes the eval ads, and who else can do blind ratings?** The ads must be written without looking at Qloo, and Tier B references should be long-tail or local, not famous. **Owner: you.**
- Score weighting, the distinctness threshold and the specificity rubric. **Owner: spec**, tuned on the eval set.
- The full list of Qloo audience types, and whether community audiences exist and what they cover. **Owner: spec**, checked with the API key on day 1.
