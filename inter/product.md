---
doc: product
---
# CrowdCraft

Test your ad or script against real-taste audiences before you spend, see who it lands with and who it misses, then craft the version your crowd will love.

Tagline: "Test your ad on real taste, then craft the one your crowd will love."

## Kernel
Every persona is built from Qloo's real taste data (the artists, brands, films, places and themes that audience actually loves), not an AI-invented stereotype. It has to be *visible*: persona cards show their real taste, every critique cites a specific taste signal, and the references inside the ad itself are scored against Qloo, so part of the verdict is hard data rather than LLM opinion.

**Why not just an LLM?** The LLM reads the ad; Qloo knows the crowd. An LLM recalls what the internet *writes about* a crowd, which is the cliché version. Qloo measures what people *engage with*: what a crowd loves **more than everyone else**, in **comparable numbers**, across the **long tail and local** level (250M+ entities), with **cross-domain links** nobody has written down. Its numbers can't be flattered, and every claim is auditable. M1 tests this claim before anything else gets built.

## Who It's For
**First audience: the Qloo Agentic Hackathon judges** (Qloo is NYC-based, so its data is deepest in the US). They need to see Qloo used deeply and visibly, not as decoration on an LLM prompt. Judges: Mike Diolosa (Qloo CTO, Qloo depth), Jason Calacanis (would people pay?), Cedric the Entertainer (scripts, comedy), Michael Abrams (Live Nation, music and live events), Todd Boehly (Dodgers and Chelsea, sports and media), Nicole Seligman (OpenAI board, trust and honest claims). Five of six are non-technical, so the app must read in 30 seconds without explanation.

**The user in the story:** a brand marketer (D2C founder, performance marketer or CMO) about to put money behind an ad or campaign narrative. Today they guess, run A/B tests that burn budget, or pay for focus groups and agencies they often can't afford.

## Core Loop
Paste an ad, describe the audience in plain words, then see 4–6 contrasting taste segments with their real taste, a resonance score each, and what lands and what misses. Tweak the ad and run it again. They come back before every campaign because testing first is cheaper than finding out after the money is spent.

## Direction
Win the hackathon ([qloo.devpost.com](https://qloo.devpost.com/), deadline **Oct 31, 9:15am IST**; top 3 only; plus Jason Calacanis personally investing $25k in his favourite entry). Must submit a live, externally hosted app; a public repo with an open-source license visible in its About section; and a written description of what makes it Qloo-powered. There is no video, so the live app is the pitch. **It must be agentic** (an agentic tool, built with an agent framework, or Qloo wired into an agent). Qloo is the only partner API. Judging criteria: Technological Implementation (how thoroughly Qloo is used), Design (a complete product, not a proof of concept), Potential Impact (a real problem for a real audience), and Quality of Idea (a non-obvious use of Qloo). Their test: "if it would work the same without Qloo, you're building the wrong thing." Qloo rules: never commit Qloo response data to the public repo (server-side caching is fine), and hackathon keys are switched off after judging. Polish the core over adding features, preload examples for one-click results, and deploy early. After that, turn it into a paid product for small brands, startups, agencies and creators: a few free tests, then pay per test or a monthly plan. Messaging stays honest: results are directional, not guaranteed.

## Shipped
<!-- inter-build appends a line here when each milestone ships. -->

## Ideas
- **Leading M2 candidate (user, 2026-10-09): the live product built around two features.**
  - *Audience builder ("test on my audience")*: pick regions (country → state → city or neighbourhood, several allowed), age bands, optional gender, and "people who like…" (Qloo search for artists, brands, shows and genres). The ad is tested on exactly those cells, matching Meta and TikTok targeting; audiences can be saved. The engine already takes market, ages and interests, so this is mostly a brief-building UI.
  - *Discover ("find my best audience")*: from the ad alone, read its references and vibe, ask Qloo which tastes, ages and places over-index on them (demographics, insights seeded with the ad's references, Heatmap), propose the top 3–5 audiences, test them for real and rank them. Needs M1 slice 5 (references resolved in Qloo). Uses the last unused Qloo capability (Heatmap).
- Product UI (likely M2): the composer, results screens (verdict first, segment cards, line highlights, references, generic vs Qloo, trace), adding and editing segments, one-click examples, the landing page, and deploying live. Build it on M1's engine and run report.
- Interactive brief: show what was inferred from the user's text as editable fields, and suggest what to add (gender, age, channel and so on) so nothing important is missed.
- Agent chat view: talk to the agent and it runs everything on the platform (test, craft, discover) using the same Qloo tools.
- Craft loop: given a goal, the agent rewrites, re-tests and repeats until the target segment lands. Uses Qloo Trending.
- Audience discovery: work backwards from the ad's references to the Qloo audiences it actually speaks to.
- Map view: where the ad's taste resonates most, using Qloo **Heatmap** (the last uncovered Qloo capability).
- **Talk to your audience** (user: "the strongest product"): ask an audience questions and it answers in character from its Qloo taste and its reactions, with sources. Text chat first (about half a day, M2); a real-time talking avatar later (M3), checking Keyframe Labs and alternatives for API, cost and latency. Face risk: an AI-generated face for "Austin · 21–29" would infer race, gender and looks, so use voice-only, a stylised avatar, or a look the marketer picks, framed as "a voice for this audience".
- Reel generator (stretch): turn the winning script into a short Instagram reel, re-test it, and show the score improving.
- Image and video ad input (M1 is text only).
- Several ads per run: 2–3 variants side by side in a variant × segment grid ("which one should I run?"), then bulk testing.
- Ad goal as an input (awareness, sign-ups, sales), judged against "does it make you act?".
- International contrast segments (e.g. India, UK) to show Qloo's breadth.
- Accounts, saved test history, and shareable report links.
- Pricing: free tests, then pay per test or monthly; reels as a premium add-on.
- Post-hackathon: sort out Qloo's commercial API terms and pricing (the hackathon key is likely hackathon-only), and get real customer feedback.

## Cut
- Simulated crowd of 100–200 individuals with "% would click" stats: Qloo data is segment-level, so individuals would be LLM-invented variation (a stereotype risk) and false precision. Segments are the honest unit.
- India-first market: the judges and Qloo's deepest data are in the US, so default to US segments.
