# CrowdCraft

Test your ad on real taste, then craft the one your crowd will love.

CrowdCraft tests an ad or script on the audiences you'd actually buy (region × age), built from [Qloo](https://www.qloo.com)'s taste data: the artists, brands, places and shows each audience loves more than the others. It is not personas an AI made up. Every claim in a review cites the Qloo data behind it, and the ad's own references are scored with hard Qloo affinity numbers.

Every run ends in three deliverables:

1. **Who to target**: the audiences to show the ad to, ready for Meta or TikTok Ads Manager (location, age, interests from Qloo, budget split), plus who not to target and why.
2. **What to fix**: concrete changes to the ad, each with its evidence.
3. **Better versions**: the ad rewritten for each recommended audience using their real taste, then re-tested on that audience.

How it works: an agent maps the brief to Qloo signals and finds the ad's references; Qloo's heatmap of those references picks where the ad's taste is strongest (plus a contrast market); each region × age audience gets a Qloo taste fingerprint (an affinity matrix finds what each loves more than the others); the judge reviews the ad as each audience, citing only that data; generic-AI baselines (no Qloo data) run alongside for comparison.

This is milestone 1: the taste engine, its evaluation harness and an HTML dashboard per run. The plan and decisions live in [`inter/`](inter/).

## Setup

Requires Node 22+. The eval's specificity grader uses the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) (`claude -p`).

```bash
npm install
cp .env.example .env   # add QLOO_API_KEY (Qloo hackathon key) and META_API_KEY (Meta Model API, Muse Spark)
```

## Commands

```bash
npm run cc -- run eval/ads/demo-concert.yaml                      # test an ad from a brief file
npm run cc -- run --text "Instagram reel for … aimed at … Ad: …"  # or from a free-text brief
npm run cc -- run <brief.yaml> --same-segments runs/<id>/run.json # re-test an edited ad on the same audiences
npm run cc -- report runs/<id>/run.json                           # re-render a dashboard (no API calls)
npm run cc -- eval --arms b1_named,b2_invented                    # run the eval set; writes a scorecard
npm run cc -- eval score eval-results/<timestamp>                 # fold in blind ratings
npm run cc -- probe                                               # Qloo coverage per market (US, CA, UK, ES, IN)
npm run cc -- selfcheck [--qloo]                                  # check Muse, the agent loop, the grader, Qloo
npm test && npm run typecheck
```

Each run writes `runs/<id>/run.json` and a self-contained dashboard, `runs/<id>/report.html`.

## Notes

- Qloo responses are cached locally in `.cache/` and never committed (Qloo terms). The hackathon key allows 10,000 calls a month; a fresh run uses about 70–100, and cached re-runs use none.
- CrowdCraft never targets or splits audiences by ethnicity, race, religion, sexuality or politics; culture comes through taste.
- Results are directional, not guaranteed.

## License

MIT
