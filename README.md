# CrowdCraft

Test your ad on real taste, then craft the one your crowd will love.

CrowdCraft simulates how different audience segments react to an ad or script. Every segment is built from [Qloo](https://www.qloo.com)'s taste data (the artists, brands, places and themes that crowd actually engages with), not from personas an AI made up, and every claim in a review cites the taste data behind it.

This is milestone 1: the taste engine and its evaluation against generic-AI baselines. The plan lives in [`inter/`](inter/).

## Setup

Requires Node 22+.

```bash
npm install
cp .env.example .env   # add QLOO_API_KEY (Qloo hackathon) and META_API_KEY (Meta Model API)
```

## Commands

```bash
npm run cc -- selfcheck                                         # checks Muse structured output, the agent tool loop and judge drift
npm run cc -- run --fixture test/fixtures/concert.fixture.json  # judge a hand-made segment set, all four arms
npm test                                                        # unit tests
npm run typecheck
```

Each run writes `runs/<id>/run.json` and a self-contained `runs/<id>/report.html`.

Qloo responses are cached locally and never committed (Qloo terms). Results are directional, not guaranteed.

## License

MIT
