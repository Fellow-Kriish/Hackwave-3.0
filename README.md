# Hackwave-3.0

Intent-based, self-healing E2E testing: tests that describe intent, heal their own path, and cannot lie about the outcome.
The build plan is [docs/BUILD.md](docs/BUILD.md). Status: **P2 (LLM plumbing and planner) complete**, except the second-provider check (needs a second key).

## Quick start

Needs Node 20.19+ and pnpm 10 (`npm install -g pnpm@10`).

```sh
pnpm bootstrap          # install dependencies and Playwright's Chromium
pnpm shop               # build the shop once, start v1, v2 and v2-broken side by side
pnpm engine doctor      # preflight: ports, reset endpoint, baseline, browser
```

| Shop | URL | Behaviour |
| --- | --- | --- |
| v1 | http://localhost:5171 | baseline shop |
| v2 | http://localhost:5172 | redesign and reflow; orders persist |
| v2-broken | http://localhost:5173 | identical UI to v2; confirms orders but never saves them |

The reserve bug variant (order saved at ₹999 instead of ₹1,299) runs on its own:

```sh
# bash
SHOP_VERSION=v2-wrong-total PORT=5174 SHOP_TEST_MODE=1 pnpm --filter @hackwave/shop serve
# PowerShell
$env:SHOP_VERSION='v2-wrong-total'; $env:PORT='5174'; $env:SHOP_TEST_MODE='1'; pnpm --filter @hackwave/shop serve
```

## Run a test

With the shops running:

```sh
pnpm engine run --intent intents/checkout.json --target http://localhost:5171                                     # planner plan (cached), GREEN
pnpm engine run --intent intents/checkout.json --target http://localhost:5171 --plan evals/plans/checkout.v1.json   # hand-written plan, GREEN
pnpm engine run --intent intents/checkout.json --target http://localhost:5173 --plan evals/plans/checkout.v2.json   # RED: page confirms, store has nothing
pnpm engine eval                                                                                                  # every fixture, verdicts compared
```

Add `--headed --slow-mo 300` to watch the browser. Each run streams events to the console and writes
`runs/<timestamp>-<intent>-<target>/` with `plan-used.json`, `events.jsonl`, `evidence/`, `verdict.json`, `report.md` and `config-used.json`.
Exit codes: 0 GREEN or AMBER, 1 RED, 2 GREY, 3 setup error.

Without `--plan`, the engine uses `runs/plans/<intent>.json`; when there is none, the planner writes one from the goal and
the landing screen, then expands each milestone into steps on the live screen (about four model calls for the checkout).

## Models: live, record, replay

Copy `.env.example` to `.env` and set `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL_STRONG` and `LLM_MODEL_FAST`
(providers: anthropic, openai, gemini, groq, openrouter, ollama, custom; see `llm.providers` in `engine.config.json`).
`LLM_MODE` (or `--llm-mode`) picks how model calls happen:

| Mode | What happens |
| --- | --- |
| `replay` (default) | calls are served from `runs/llm-cache`, pinned to the provider and models in its `manifest.json`; no API key or `.env` needed; a miss fails loudly |
| `record` | calls go to the model and are written to `runs/llm-cache` |
| `live` | calls go to the model and nothing is cached |

```sh
pnpm engine eval v1-baseline --llm-mode record   # record the planner's calls for the checkout
pnpm engine eval v1-baseline                     # replay them: no key needed
```

Commit `runs/llm-cache` and `runs/plans`; never commit `.env`.

## Checks

```sh
pnpm check                            # lint, typecheck, unit tests
pnpm engine eval                      # eval fixtures (shops must be running); a red fixture blocks the phase
pnpm --filter @hackwave/shop smoke    # shopper-style checkout on all three shops (shops must be running)
pnpm --filter @hackwave/shop a11y     # axe scan of every page state (shops must be running)
pnpm engine doctor --reset            # also clears every store; the next order id is 4821
```

## Layout

| Path | What |
| --- | --- |
| apps/shop | React + Vite storefront and Express API; one codebase, variants selected by `SHOP_VERSION` |
| packages/contracts | Zod schemas for intents, plans, events, run records and verdicts; `redactForHealer` |
| packages/verifier | the oracle: state delta, UI-to-state binding, no-alerts, evidence bundle, the verdict decision table. No LLM (lint-enforced) |
| packages/engine | CLI (`doctor`, `run`, `eval`), planner, rung-1 executor, settle gate, console stream, report, `events.jsonl`, timing hooks |
| packages/engine/src/llm | the only door to a model: provider drivers, record/replay cache, schema validation with one retry, telemetry |
| prompts/ | the planner prompts, each with a version line; their hashes are part of every cache key |
| runs/plans, runs/llm-cache | committed caches: the planned plan and the recorded model calls |
| intents/ | test intents: the goal, inputs and the frozen oracle |
| evals/ | fixtures with expected verdicts, and the hand-written plans for v1 and v2 |
| engine.config.json | every budget, threshold, model tier and port |
| docs/BUILD.md | the build doc |
