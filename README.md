# Hackwave-3.0

Intent-based, self-healing E2E testing: tests that describe intent, heal their own path, and cannot lie about the outcome.
The build plan is [docs/BUILD.md](docs/BUILD.md). Status: **P3 (resolution ladder rungs 1–3, locator cache, heal events)
complete.** The provider-switch eval currently runs groq and the custom driver pointed at Groq; a second vendor is still to be added.

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

## Self-healing: the resolution ladder

Every step's target is found by the cheapest rung that works, and every match is validated objectively (unique,
visible, enabled, role match, still in its landmark) before anything is clicked or typed:

| Rung | How | Model |
| --- | --- | --- |
| 1 | the cached locator for the step (or the plan's own target the first time) | none |
| 2 | similarity: 0.8 × name (step name, synonyms, cached name) + 0.1 × same landmark + 0.1 × same nearby headings and labels; accepted at ≥ 0.85 and ≥ 0.15 ahead of the next candidate | none |
| 3 | one fast-model call per screen picks from the top 8 candidates for every step still unresolved there; "none" is a valid answer | fast tier |

A scope named after an input (the product card) is never left: if it is missing, the step is unresolvable and no model
is asked. A heal that acted without effect is rolled back and goes one rung up. When nothing resolves, the run stops
RED (unresolvable) instead of guessing; milestone re-planning (rung 5) arrives in P4.

Heals are written back after the step's progress check passes, and the report lists each one (before, after, rung,
validation, why the cheaper rungs failed). The next run resolves those steps on rung 1 with no model call.

| Locator cache | Used by | Committed |
| --- | --- | --- |
| `runs/locators/<intent>.json` | planner plans (cached or fresh) | yes: review heal diffs and commit them |
| `runs/locators/<intent>.hand.json` | runs with `--plan` | no: a scratch cache, so trying a hand plan never rewrites the committed one |

See a heal (replay mode, no key needed; `doctor --reset` first clears the stores):

```sh
pnpm engine run --intent intents/checkout.json --target http://localhost:5171 --plan evals/plans/checkout.v1.json        # GREEN; warms the hand cache
pnpm engine run --intent intents/checkout.json --target http://localhost:5172 --plan evals/plans/checkout.reflowed.json  # AMBER: 1 rung-2 and 3 rung-3 heals
pnpm engine run --intent intents/checkout.json --target http://localhost:5172 --plan evals/plans/checkout.reflowed.json  # GREEN: every step on rung 1, 0 model calls
```

`checkout.reflowed.json` keeps v1's labels but follows v2's screen order (phone field, payment on its own page), which is
what rung 5 will do on its own in P4. Running the v1 plan itself on v2 heals the renamed buttons and then stops RED at the
moved payment fields (eval `drift-needs-replan`).

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

Commit `runs/llm-cache`, `runs/plans` and `runs/locators`; never commit `.env`.

`pnpm engine eval provider-switch` runs v1 live once per provider that has `LLM_SWITCH_<PROVIDER>_MODEL` (and a key) in `.env`,
skipping the rest. A profile without its own key reuses `LLM_API_KEY` only when it points at the same host, and two
profiles on one host are run a minute apart so its per-minute token limit can refill.

## Checks

```sh
pnpm check                            # lint, typecheck, unit tests
pnpm engine eval                      # eval fixtures (shops must be running); a red fixture blocks the phase
pnpm engine eval heal-warm-v1 heal-v2 # named fixtures only, in file order; plan and locator caches are put back afterwards (--keep-caches to keep them)
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
| packages/engine | CLI (`doctor`, `run`, `eval`), planner, executor with the resolution ladder (rungs 1–3) and locator cache, settle gate, console stream, report, `events.jsonl`, timing hooks |
| packages/engine/src/llm | the only door to a model: provider drivers, record/replay cache, schema validation with one retry, telemetry |
| prompts/ | the planner and resolver prompts, each with a version line; their hashes are part of every cache key |
| runs/plans, runs/locators, runs/llm-cache | committed caches: the planned plan, the healed locators and the recorded model calls |
| intents/ | test intents: the goal, inputs and the frozen oracle |
| evals/ | fixtures with expected verdicts, and the hand-written plans (v1, v2, and v1's labels reflowed for v2) |
| engine.config.json | every budget, threshold, model tier and port |
| docs/BUILD.md | the build doc |
