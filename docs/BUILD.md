# Intent-Based Self-Healing E2E Testing — HackWave Build Doc

Oct 11, 2026 · @kartik bhargava

## Project at a glance

Build an E2E testing engine where a test is a goal, not a script: the engine plans the clicks, heals its own path when the UI changes, and cannot fake success because pass/fail is decided by code the LLM never touches.

- One-liner: tests that describe intent, heal their own path, and cannot lie about the outcome.
- Hook: a self-healing test that heals past a real bug is worse than a brittle test. Ours can't, because the verifier has no LLM in it.
- What judges see, in four acts: v1 GREEN; v2 redesign AMBER with a readable diff and a suggested fix; v2-broken RED although the page says "Order confirmed"; v2 re-run GREEN with 0 LLM calls.
- Stack: Playwright + TypeScript engine, React + Vite + Express demo shop, any supported LLM provider behind one adapter, chosen by env, with record/replay, JSON on disk, no test framework around the engine.
- Done means: the eval fixtures pass (v1 GREEN, v2 AMBER with at least one rung-3 heal and one re-plan, v2-broken RED, v2 re-run GREEN with 0 LLM calls); the full demo runs offline in replay mode in under 4 minutes; a fresh clone works with one command.

## Problem statement and what winning means

The hackathon asks for a testing system that understands test intent instead of fixed selectors: it interprets the current UI, rebuilds workflow steps when buttons are renamed or moved or flows are redesigned, and tells harmless UI change apart from genuine application failure.

- Today: click("#checkout-button") memorises where the button is. Rename it to "Proceed to payment" and the test fails while checkout still works. Engineers fix selectors instead of finding bugs.
- The ask: the test says what the user wants ("Complete checkout with a valid credit card"); the system reads the screen and finds the clicks.
- When the UI changes the system must: detect that the old steps no longer fit, explain what broke, rebuild steps from intent, run the updated test, verify the intended outcome.
- The hard part, and what judges will probe: harmless change (rename, move, redesign) must adapt and pass; genuine failure (checkout broken, no order) must not heal and must fail loudly. A system that heals past a real bug is worse than a brittle test.
- Mandatory demo: run on Version A and pass; change the UI to Version B; the system detects, explains, rebuilds, passes. Bonus: inject a real bug and show it stays red.

Winning means doing the mandatory demo without drama and making the bonus the centrepiece: the engine adapts through a redesign, reaches a confirmation page, and still refuses to pass.

## Non-negotiable principles

Every module obeys these ten rules; a change that breaks one is rejected regardless of what it adds.

1. The oracle is frozen. Success conditions are written once in the intent, checked by code, never healed, never shown to any LLM-facing module.
2. The verifier has no LLM dependency. It is its own package, a lint rule bans importing the LLM adapter, and the oracle anchors on the system of record (the orders store), not on page copy.
3. Healing changes the path, never the goal. Planner and resolver receive the goal and input keys only. Plan steps reference input keys, never literal values, so the model cannot "fix" a failing form by inventing a different card.
4. Terminal actions run once. "Place order" is attempted at most once per run; anything after it goes straight to verification.
5. Everything is bounded. Step, run, action, re-plan and LLM-call budgets live in one config file and are printed at the top of every report. Exhaustion is a verdict, never a hang.
6. Every LLM call is recorded. One provider-agnostic adapter, provider and key chosen by env, with modes live, record and replay; cache keyed by provider, model, prompt hash and input hash; replay throws on a miss; the demo runs with no API key.
7. Confidence is computed, not asked. An LLM pick must pass objective validation (unique match, visible, enabled, role matches, inside the expected landmark) or it escalates.
8. The system emits the fix. Locator and plan caches are committed files; healing produces a reviewable diff plus a PR-style block; the re-run after merge is GREEN with 0 LLM calls.
9. The LLM narrates the verdict, never decides it. The reporter may write a hypothesis for a RED from the evidence bundle, strictly downstream of the verdict.
10. Locators are semantic. Every generated and cached locator is role, label or text based (getByRole, getByLabel, getByText); never CSS, never XPath.

## Architecture overview

Five stages run in a straight line; only the executor branches, into the resolution ladder and into milestone re-plans.

1. Intent (intent.json): the goal in plain English, named inputs (product, card, shipping) and the oracle. Author-written, frozen.
2. Planner (LLM, once, cached): turns the goal plus a pruned accessibility snapshot of the landing page into a milestone plan: milestones with dependencies and completion conditions. Steps are expanded per milestone on the live screen the first time, then cached.
3. Executor (Playwright): picks the next milestone whose dependencies are met, skips milestones already satisfied, resolves each step's target through the ladder (cached locator, attribute similarity, a11y tree + LLM, screenshot + LLM flagged off, milestone re-plan), acts, settles, checks progress, records every heal event.
4. Verifier (pure code): snapshots the orders store before step 1 and, after the run, checks state delta, UI-to-state binding and absence of error alerts. Produces the evidence bundle.
5. Reporter: verdict colour, rung histogram, timings, heal diff, suggested fix, PR block, explain-only hypothesis for RED. Console stream while running, run folder on disk.

Two notions of "done" are tracked and both are printed:

- Healer's "I think I'm done": milestone completion conditions read from the aria tree; soft, LLM-influenced.
- Verifier's "you are done": the oracle; hard, code only. On v2-broken the report reads "healer believed done at step 9 — verifier: RED".

Flow of truth: inputs go intent → planner → executor as keys; the oracle goes intent → verifier only; the executor hands the verifier a page handle and the run record; the verifier hands the reporter a verdict; the reporter never writes to any cache.

| Module | May call the model | Model tier |
| --- | --- | --- |
| Planner | yes | strong |
| Resolver rung 3 | yes | fast |
| Re-planner (rung 5) | yes | strong |
| Executor | no | — |
| Verifier | never (lint-enforced) | — |
| Reporter | explain-only, after the verdict | fast |

## Repository layout and package boundaries

A pnpm monorepo with one app and three packages; the package boundaries are what enforce the principles.

| Path | Purpose | May import the LLM adapter |
| --- | --- | --- |
| apps/shop | React + Vite + TypeScript storefront, Express API, orders store, variants v1 / v2 / v2-broken, test-only reset endpoint | no |
| packages/contracts | Zod schemas and TypeScript types for Intent, Oracle, Plan, Milestone, Step, Resolved, HealEvent, Verdict, RunRecord; the redactForHealer helper | no |
| packages/verifier | Oracle evaluation: baseline, state delta, binding, alerts, polling, evidence bundle; the verdict function | no (eslint no-restricted-imports fails the build) |
| packages/engine | planner, resolver (the ladder), executor, replanner, reporter, llm adapter, cli | yes: planner, resolver, replanner, reporter-explain only |
| intents/ | checkout.json and any further intents | — |
| prompts/ | planner.md, resolve.md, replan.md, explain.md, each with a version line at the top | — |
| runs/ | plans/, locators/, llm-cache/, snapshots/post-act-1/, plus one folder per run | — |
| evals/ | fixtures with expected verdicts and the eval runner | — |
| docs/ | README, the architecture diagram (the Excalidraw board), demo script, positioning table | — |
| engine.config.json | budgets, thresholds, models, ladder flags, settle parameters, ports | — |
| CLAUDE.md | rules for Claude Code (see the section below) | — |
| .env.example | committed placeholders: LLM\_PROVIDER, LLM\_API\_KEY, LLM\_BASE\_URL, LLM\_MODEL\_STRONG, LLM\_MODEL\_FAST, LLM\_PROVIDER\_FAST, LLM\_API\_KEY\_FAST, LLM\_MODE; .env itself is git-ignored | — |
| packages/engine/llm/providers | the two drivers, anthropic and openai-compatible, plus the provider registry that maps LLM\_PROVIDER to a driver and a default base URL | is the adapter |

Tooling: TypeScript strict, ESLint, Vitest for unit tests, Playwright with Chromium only, tsx for the CLI, Zod for schemas. No test runner wraps the engine; the engine is the runner.

CLI commands exposed by packages/engine:

| Command | What it does |
| --- | --- |
| doctor | preflight: ports, reset endpoint, baseline, browser, replay cache |
| run --intent \<file> --target \<url> \[--plan \<file>\] \[--llm-mode live/record/replay\] | one execution; prints the stream and writes the run folder |
| eval \[fixture\] | runs one or all fixtures and compares verdicts |
| init \<goal> | scaffolds an intent file from a goal sentence |
| lint \<intent> | validates an intent against the schema with readable errors |
| snapshot save/restore \<name> | saves or restores the plan and locator caches, e.g. post-act-1 |
| demo | resets stores, restores post-act-1, runs the four acts headed with slowMo |

## Data contracts

Contracts come first in P1 and every module codes against them; the fields below are the minimum and all are validated with Zod.

Intent

| Field | Type | Notes |
| --- | --- | --- |
| id | string | e.g. checkout-valid-card |
| goal | string | plain English; the only thing the planner reads besides input keys |
| inputs | map | product name; card (number, expiry, cvv, name); shipping (name, street, city, pincode, phone). Include fields v1 does not use, so v2 can ask for them |
| oracle | Oracle | frozen; stripped by redactForHealer before any LLM-facing module |
| budgets | partial Budgets | optional overrides of engine.config.json |

Oracle

| Field | Notes |
| --- | --- |
| state.store | name of the system-of-record collection, e.g. orders |
| state.expectedNewCount | 1 |
| state.match | fields the new record must carry: items (product names), total, cardLast4 |
| state.pollMs | how long to wait for the record to appear, default 5000 |
| ui.newRecordIdVisible | true: the backend's new id, normalised, appears in the final page text |
| ui.noAlerts | true: no role=alert with error text on the final page |

Plan

| Field | Notes |
| --- | --- |
| intentId, goalHash, promptHash, createdAt | cache identity |
| milestones\[\] | listed by dependency, executed adaptively |

Milestone

| Field | Notes |
| --- | --- |
| key | stable semantic key, e.g. shipping |
| description | one sentence, used by the re-planner |
| dependsOn\[\] | milestone keys |
| completion | aria-level predicate: heading text, element role + name visible, or URL path prefix |
| terminal | true only for place-order |
| steps\[\] | expanded on first run, then cached |

Step

| Field | Notes |
| --- | --- |
| key | stable semantic key, e.g. shipping.phone |
| action | navigate, click, fill, select, press |
| target | role; name; synonyms\[\]; within (role + name of the scope, e.g. the product card named Trail Runner); hint (purpose in words) |
| inputRef | key into intent inputs, fill and select only; never a literal value |
| progress | expected effect: value readback, URL or tree delta, or next target visible |

Resolved

| Field | Notes |
| --- | --- |
| locator | role, name, within, nth |
| rung | 1 to 5 |
| validation | unique, visible, enabled, roleMatch, inLandmark, all booleans |
| evidence | the aria node line and the similarity score |
| ms | time spent resolving |

HealEvent: runId, milestoneKey, stepKey, from (cached locator), to (new locator), rung, reason, validation, ms. ReplanEvent: milestoneKey, reason, oldSteps, newSteps, attempt.

Verdict

| Field | Notes |
| --- | --- |
| color | GREEN, AMBER, RED, GREY |
| reasons\[\] | machine codes plus one human line each |
| oracle | state, binding and alerts results with the values compared |
| heals\[\], replans\[\] | the events |
| healerBelievedDone | boolean plus the step key where the healer stopped |
| llmCalls, tokens | totals by model |
| timings | browserMs, llmMs, totalMs, per-step list |
| rungHistogram | counts per rung |

Caches on disk: runs/plans/\<intentId>.json; runs/locators/\<intentId>.json keyed by step key, holding the locator spec plus a fingerprint (role, name, landmark, sibling text, href or type); runs/llm-cache/\<hash>.json keyed by hash(model, promptHash, inputHash).

Run folder, one per execution: plan-used.json, events.jsonl, evidence/ (final screenshot, final aria snapshot, backend responses, baseline), verdict.json, report.md, config-used.json.

Worked example, intents/checkout.json, the only intent the demo needs:

| Field | Value |
| --- | --- |
| id | checkout-valid-card |
| goal | As a shopper, buy the Trail Runner shoes with a valid credit card and reach order confirmation. |
| inputs.product | Trail Runner |
| inputs.card | number 4242 4242 4242 4242, expiry 12/29, cvv 123, name Kartik Test |
| inputs.shipping | name Kartik Test, street 12 MG Road, city Indore, pincode 452001, phone 9876543210 |
| oracle.state | store orders, expectedNewCount 1, match items \[Trail Runner\], total 1299, cardLast4 4242, pollMs 5000 |
| oracle.ui | newRecordIdVisible true, noAlerts true |

The planner sees only id, goal and the input keys; the executor fills values by key; the verifier alone reads the oracle.

## Resolution ladder

Each step target is resolved by the cheapest rung that passes validation; every rung records what it tried, and escalation is the only path on failure.

| Rung | Input | Method | Accept when | Cost |
| --- | --- | --- | --- | --- |
| 1 cached locator | locator cache entry for the step key | build the getByRole or getByLabel locator, validate | validation passes | 0 LLM calls, about 10 ms |
| 2 attribute similarity | pruned aria snapshot within scope, step name plus synonyms, cached fingerprint | score interactive nodes of the expected role: name similarity (normalised tokens, trigram or Jaro-Winkler) plus fingerprint boosts (same landmark, sibling text) | top score at least 0.85, margin over the runner-up at least 0.15, validation passes | 0 LLM calls, about 40 ms |
| 3 a11y tree + LLM | top-8 candidates per unresolved step with local context, plus step hints; the full pruned tree only when every candidate scores below 0.5 | one call per screen for all unresolved steps of the milestone (fast model); the model returns a candidate id or none per step | validation passes | 1 call per screen, 1 to 2 s |
| 4 screenshot + LLM | screenshot with candidate boxes | vision pick | feature flag ladder.visionEnabled, default off; kept in the design for canvas and icon-only UIs | not built |
| 5 milestone re-plan | goal, milestone description, current pruned tree, steps done and failed, available input keys | strong model writes new steps for this milestone only | budget 2 per milestone; never includes a terminal action already attempted | 1 call, 2 to 4 s |

Rules that apply to every rung:

- Validation is objective: exactly one match, role matches expectation, visible, enabled, inside the expected landmark or scope. The report prints these flags, never a model-reported confidence.
- Scope first: a target with within is searched inside that ancestor (the product card named X, the checkout form) before anywhere else; this removes the "which Add to cart" ambiguity.
- Resolve per screen, not per step: on a form, every field plus the continue button resolves from one snapshot in one rung-3 call.
- Tree budget: prune to interactive, landmark and heading nodes; truncate text to 80 characters; hard cap 400 nodes; enforced before any call.
- Write-back: any success at rung 2 or above updates the locator cache for that step key and emits a HealEvent; the next run hits rung 1.
- One rung-3 attempt per step per screen; a none answer or a failed validation goes to rung 5 for the whole milestone.
- Playwright: use locator.ariaSnapshot() on the main region (page.accessibility.snapshot() is deprecated) and build locators with getByRole from role plus name.

First run with an empty cache: rung 1 builds the locator from the step's own role and name, which the planner wrote from the live aria tree during step expansion. That is why P2 reaches GREEN on v1 before rungs 2 and 3 exist; the cache entry is written on first success.

Design v2 so that every rung fires visibly, otherwise the demo looks like Healenium with a model attached:

| v2 change | Rung it exercises |
| --- | --- |
| Product cards keep role and names under a new theme | 1 |
| "Add to cart" keeps its accessible name, loses its id and classes | 2 |
| Cart becomes a slide-over dialog opened by an icon button labelled "Your bag" | 3 |
| Final button labelled "Pay ₹1,299" (a dynamic amount synonyms cannot cover) | 3 |
| Shipping moved before payment, with a new required Phone field | 5, plus adaptive milestone order |

## Executor rules

The executor is a loop over milestones with hard gates around every action; these gates remove most flakes before the ladder is ever needed.

- Milestone loop: pick the next milestone whose dependencies are done. If its completion condition already holds, mark it done and skip it; this makes recovery after an error safe and handles reordered flows without a re-plan. Otherwise resolve its steps per screen and execute them.
- Settle gate before every snapshot and action: wait until the aria hash is stable across two samples 150 ms apart, ignoring live regions (role status, alert, timer); give up after 3 s and proceed.
- Progress check after every action, by action type: fill reads the value back and compares; click expects a URL or aria-hash change or the next step's target to become visible; select expects the selected option to match. A failed progress check on a healed action navigates back when possible and escalates one rung.
- Terminal rule: the milestone flagged terminal (place order) executes once; any failure after its action ends execution and hands over to the verifier.
- Loop detection: a re-plan that proposes the same target as the failed step, or an unchanged page hash after three consecutive actions, stops the run with RED unresolvable.
- Budgets from engine.config.json: step 10 s, run 90 s, 25 actions, 2 re-plans per milestone, 8 LLM calls per run, 1 rung-3 attempt per step per screen. Timeout or crash gives GREY; an exhausted healing budget gives RED unresolvable.
- Action allowlist: navigate within the app origin, click, fill, select, press Enter or Tab. No external navigation, no file uploads, no HTTP outside the app; anything else is refused with a RED reason.
- Browser context: one Chromium context per run with reducedMotion set to reduce and a fixed viewport; the shop gates its transitions on prefers-reduced-motion.
- Events: every resolution, action, heal, re-plan and budget tick appends a line to events.jsonl and streams to the console as it happens.
- Preflight (the doctor command): app reachable on the target port, reset endpoint responds, baseline readable, browser installed, replay cache present when LLM\_MODE is replay. Failures here are setup errors, reported before the run, never GREY.

## Verifier and oracle

The verifier decides pass or fail from the system of record: the page can lie, the orders store cannot.

Three checks, all code, all required for a pass:

1. State delta. Baseline before step 1: orders count and max id. After the run, poll the orders API for up to 5 s until exactly one new order exists, then match its items, total and card last-4 against the intent inputs. Zero new orders, two orders, or a mismatched total all fail.
2. UI-to-state binding. Take the new order's id from the backend, normalise both sides (strip non-alphanumerics, lower-case) and assert it appears in the final page text. No dependency on copy or URL: a redesigned confirmation page cannot cause a false RED, a fake confirmation cannot cause a false GREEN, and an order saved but never confirmed to the user is RED as well.
3. No error state. No element with role alert containing error text on the final page.

The freeze is enforced three ways: the oracle exists only in the intent file and packages/verifier; redactForHealer strips it from the intent object before the planner, resolver or re-planner see anything; packages/verifier cannot import the LLM adapter, and the lint rule fails the build if it tries.

Store access goes through a small store adapter (HTTP list and get on /api/\<store> of the target origin) so a database adapter can replace it later without touching the checks.

Evidence bundle written for every run: baseline, backend responses, final screenshot, final aria snapshot, final URL, and per-check results with the values compared. The reporter uses it for the heal diff and for the RED hypothesis.

Demo wiring: v2-broken persists nothing while rendering "Order confirmed", so check 1 fails. Keep a second variant, v2-wrong-total (order saved with the wrong total), in reserve for the "what else does it catch" question.

## Verdict decision table

The verdict is a pure function of the oracle results and the run events, unit-tested one case per row; rows are evaluated top to bottom and the first match wins.

| Condition | Verdict | What the report prints |
| --- | --- | --- |
| Any oracle check fails, regardless of healing | RED, real bug | the failed check with the values compared; the healer's own "believed done" status |
| Re-plan or heal budget exhausted, loop detected, or an action refused by the allowlist | RED, unresolvable | last step key, rung attempts, "refused to guess" |
| Timeout, browser crash, navigation or network error, setup failure mid-run | GREY, environment | the error; CI policy is retry once, then fail |
| Oracle passes and at least one HealEvent or ReplanEvent | AMBER, UI drift | heal diff, suggested fix, rung histogram |
| Oracle passes and no heal events | GREEN | timings; 0 LLM calls when fully cached |

GREY is never a pass. AMBER never silently becomes GREEN: the re-run after the cache update is GREEN and its report names the run that updated the locators.

## LLM adapter

One adapter is the only door to the model; it makes every call deterministic, cached and replayable.

- Modes via LLM\_MODE: live (call, do not cache), record (call and write runs/llm-cache/\<hash>.json), replay (serve from cache; a miss throws with the prompt hash so gaps surface in rehearsal, not on stage). Replay needs no API key.
- Cache key: hash of provider id, model id, prompt file hash and input payload hash. Editing a prompt invalidates only its own entries.
- Model tiering in engine.config.json: planner and re-planner use the strong model; rung-3 resolution and the reporter's hypothesis use the fastest model. Picking one of eight candidates is classification; planning is reasoning. Provider and model ids come from engine.config.json and env, never from code; the two tiers may point at different providers.
- Every call: temperature 0, JSON output validated against the Zod schema for that call, one retry with the validation error appended, then the call fails and the caller escalates (resolver to rung 5, planner to RED with a reason).
- Prompt files in prompts/ with a version line at the top. The static system prompt goes first in every call so provider-side prompt caching applies; dynamic content (tree, candidates) goes last.
- Token budget: pruned trees and candidate lists are capped before the call; the adapter refuses oversize inputs rather than truncating silently.
- Telemetry per call: model, tokens in and out, milliseconds, cache hit, which stage asked. Totals land in the verdict and the report.
- Callers allowed: planner, resolver rung 3, re-planner, reporter-explain. Nothing else imports it.

Providers and the env contract: the adapter is provider-agnostic, with two thin fetch-based drivers that cover every major API; which one runs is decided by env, never by code.

| LLM\_PROVIDER | Driver | Default base URL (LLM\_BASE\_URL overrides) | Key |
| --- | --- | --- | --- |
| anthropic | anthropic (Messages API, sets the required version header) | https://api.anthropic.com | LLM\_API\_KEY |
| openai | openai-compatible | https://api.openai.com/v1 | LLM\_API\_KEY |
| gemini | openai-compatible, through Gemini's OpenAI-compatible endpoint | https://generativelanguage.googleapis.com/v1beta/openai | LLM\_API\_KEY |
| groq | openai-compatible | https://api.groq.com/openai/v1 | LLM\_API\_KEY |
| openrouter | openai-compatible | https://openrouter.ai/api/v1 | LLM\_API\_KEY |
| ollama | openai-compatible | http://localhost:11434/v1 | none |
| custom | openai-compatible (LM Studio, vLLM, any compatible server) | LLM\_BASE\_URL, required | LLM\_API\_KEY if the endpoint wants one |

Base URLs are driver defaults; confirm each against the provider's docs in P2.

.env.example is committed with placeholders only and .env is git-ignored:

- LLM\_PROVIDER=anthropic
- LLM\_API\_KEY=replace-me
- LLM\_BASE\_URL= (optional; required for custom)
- LLM\_MODEL\_STRONG=replace-me
- LLM\_MODEL\_FAST=replace-me
- LLM\_PROVIDER\_FAST= and LLM\_API\_KEY\_FAST= (optional: run the fast tier on another provider, e.g. Groq or a local model)
- LLM\_MODE=replay

Driver contract: complete(system, user, schema, model, temperature 0, maxTokens) returns text, token usage and milliseconds. JSON is requested in the prompt, parsed and validated with the call's Zod schema on every provider, with native JSON mode switched on where the provider offers it. No vendor SDK is required; add one only if a driver needs it, and ask first.

Recording writes runs/llm-cache/manifest.json (provider, model ids, prompt hashes). Replay and the demo command pin themselves to that manifest, so the demo runs with no .env at all and a provider switch never silently invalidates the committed cache. Record and replay with the same provider and model ids, or re-record.

## Reporter and run artifacts

The console stream is the demo UI and the run folder is the audit trail; no dashboard is built.

Console, live, one line per event with a colour and a rung tag:

- resolved cart.open via rung 1: click button "Cart" (12 ms)
- healed checkout.start: "Checkout" became "Proceed to payment", rung 3, validated unique, visible, enabled (1.4 s)
- re-planned milestone shipping: added fill shipping.phone, attempt 1 of 2
- verifier: baseline max id 4820, new order ORD-4821, total ₹1,299 matches, id visible on page

Final block: verdict banner, reasons, rung histogram, LLM calls and tokens by model, browser time versus LLM time, the config in force, and for AMBER the heal diff (before and after locator per step), the plan diff (reordered or added steps) and a PR-style markdown block the engineer can paste.

Files per run under runs/\<timestamp>-\<intentId>-\<target>/: plan-used.json, events.jsonl, evidence/, verdict.json, report.md, config-used.json. An optional report.html is rendered from report.md in P5.

RED explanation: the reporter may ask the fast model for a one-paragraph hypothesis from the evidence bundle ("confirmation rendered with id 4821; zero new orders persisted; likely the order POST handler"). It runs after the verdict is final and cannot change it; in replay mode it is served from cache or skipped.

The fix the system emits: the locator cache file is updated in place and the diff is shown; the engineer reviews the diff and commits it. The re-run is GREEN with 0 LLM calls and the report names the run that made the change.

## Demo shop specification

One codebase, three behaviours selected by SHOP\_VERSION; v2-broken is v2 plus one flag in the order handler, never a fork.

Run model: the React + Vite + TypeScript front end is built once; an Express server serves the built app and the API on one port; the version is read from the environment at request time and injected into the HTML as a global. Three processes run side by side.

| Version | Port | Store file | Behaviour |
| --- | --- | --- | --- |
| v1 | 5171 | data/orders.v1.json | baseline shop |
| v2 | 5172 | data/orders.v2.json | redesign and reflow; order persistence works |
| v2-broken | 5173 | data/orders.v2-broken.json | identical UI to v2; POST /api/orders returns 200 with a client-generated id and persists nothing, so GET /api/orders/:id returns 404 |

Catalogue: four products with fixed INR prices (Trail Runner at ₹1,299 is the demo product), shipping ₹0, no discounts, no randomness.

API: GET /api/products; POST /api/orders with items, shipping, card last-4 and total, returning the id; GET /api/orders/:id; GET /api/orders (list, used for the baseline); POST /api/\_test/reset, enabled only when SHOP\_TEST\_MODE=1, which clears the store and resets the counter so the first order is 4821.

v1 flow: Home (product grid, header button "Cart (0)"), "Add to cart", "Cart", cart page, "Checkout", checkout page with Payment first (card number, expiry, CVV, name on card) then Shipping (name, street, city, pincode), "Place order", then /order/4821 with the heading "Order confirmed #4821".

v2 flow: new theme and layout; "Add to cart" keeps its name but loses its id and classes; the cart is a slide-over dialog opened by an icon button labelled "Your bag"; checkout starts with "Proceed to payment"; Shipping comes first with a new required Phone field, then Payment; the final button reads "Pay ₹1,299"; confirmation lands on /orders/ORD-4821 with the text "Thanks! Order ORD-4821 is on its way". The URL pattern, the copy and the id format all change on purpose, to prove the oracle depends on none of them.

Accessibility by construction: every input has a visible label bound with for and id; every button has an accessible name (icon buttons through aria-label); landmarks banner, main and navigation; the cart drawer is role dialog with an aria-label; the confirmation page has an h1; validation errors use role alert; transitions are disabled under prefers-reduced-motion.

Determinism: counter-based order ids, fixed product data, no artificial latency, no toasts with timers on the checkout path, cart state in memory on the client.

Double-submit guard: the place-order button disables itself on click; the engine does not rely on this (terminal rule), but it keeps manual demos clean.

Reserve variant for Q&A: v2-wrong-total persists the order with the wrong total (item priced at ₹999), one env flag away.

## Configuration and budgets

All knobs live in engine.config.json and are printed at the top of every report; an intent may override budgets only.

| Key | Default | Why |
| --- | --- | --- |
| budgets.stepMs | 10000 | one slow element must not burn the run |
| budgets.runMs | 90000 | each demo act stays under two minutes |
| budgets.maxActions | 25 | the checkout needs about 12 |
| budgets.maxReplansPerMilestone | 2 | two honest tries, then refuse to guess |
| budgets.maxLlmCallsPerRun | 8 | plan, about three screens, one re-plan, one explanation |
| budgets.maxRung3AttemptsPerStepPerScreen | 1 | no retry loops on the model |
| ladder.similarityAccept | 0.85 | rung-2 acceptance score |
| ladder.similarityMargin | 0.15 | required gap over the runner-up |
| ladder.candidatesPerStep | 8 | rung-3 pre-filter size |
| ladder.fullTreeBelowScore | 0.5 | send the whole pruned tree only when every candidate is weak |
| ladder.visionEnabled | false | rung-4 flag |
| tree.maxNodes | 400 | token budget |
| tree.maxTextChars | 80 | token budget |
| settle.sampleGapMs | 150 | settle gate sampling |
| settle.maxWaitMs | 3000 | settle gate ceiling |
| verifier.pollMs | 5000 | asynchronous persistence |
| models.planner | strong tier, LLM\_MODEL\_STRONG | reasoning; concrete id set in P2 |
| models.resolver | fast tier, LLM\_MODEL\_FAST | classification over at most eight candidates |
| models.explain | fast tier, LLM\_MODEL\_FAST | narration only |
| llm.mode | replay | demo default; LLM\_MODE overrides |
| shop.ports | 5171, 5172, 5173 | v1, v2, v2-broken |
| llm.provider | anthropic | driver for both tiers; env LLM\_PROVIDER overrides |
| llm.providerFast | same as llm.provider | optional second provider for the fast tier; env LLM\_PROVIDER\_FAST overrides |
| llm.baseUrl | driver default | env LLM\_BASE\_URL overrides; required for custom |
| llm.apiKey | never in the file | env LLM\_API\_KEY only; absent in replay mode |

## Build order P0 to P6

Each phase ends with something demoable, and P0 plus P1 lock the decisions that are painful to retrofit; Claude Code works one phase at a time and stops at each acceptance list.

**P0 — Foundation and demo shop**

1. Scaffold the pnpm monorepo: TypeScript strict, ESLint, Vitest, Playwright with Chromium only, tsx, Zod.
2. Build apps/shop: catalogue, pages, API, orders store, the variants module, reset endpoint, three-port runner, reduced-motion gating, accessibility as specified.
3. Add the doctor command skeleton (ports, reset, browser).
4. Add timing hooks and the events.jsonl writer in packages/engine so numbers exist from day one.

Acceptance: all three servers start with one command; a human completes checkout on v1 and on v2; v2-broken shows a confirmation while GET /api/orders/:id returns 404; reset works on each port; an axe scan through Playwright reports zero critical issues on every page.

**P1 — Truth first: contracts, verifier, minimal executor**

1. packages/contracts with the Zod schemas, redactForHealer, and the verdict function with one unit test per decision-table row.
2. packages/verifier: baseline, state delta with polling, binding with normalisation, alerts, evidence bundle; the lint rule in place.
3. Hand-written plans for v1 and for v2: milestones, steps with role and name, semantic keys, terminal flag.
4. Executor with rung 1 only, settle gate, progress checks, terminal rule, budgets, allowlist, loop detection, console stream.
5. CLI: run with an intent, a target URL and an optional plan file.
6. Eval fixtures created with their expected verdicts.

Acceptance: v1 GREEN with plan-v1; v2 GREEN with plan-v2; v2-broken RED on the state-delta check with plan-v2, and the report shows "healer believed done"; v1 with the server killed mid-run gives GREY (a server that is down before the run is a doctor failure, not GREY).

**P2 — LLM plumbing and planner**

1. Provider-agnostic adapter (anthropic and openai-compatible drivers, selected by LLM\_PROVIDER; keys from env; .env.example committed with placeholders; cache manifest written on record) with live, record and replay, cache keys, model tiering, schema validation with one retry, telemetry; prompt files with version lines.
2. Planner: milestone plan from the goal plus the landing snapshot; per-milestone step expansion on the live screen; plan cache.
3. Replace the hand plan for v1 with planner output and compare the two.

Acceptance: from an empty cache, planner plus executor reach GREEN on v1; the same run in replay mode passes with no API key present; invalid JSON from the model is retried once and then fails cleanly; the v1-baseline fixture passes with LLM\_PROVIDER switched between at least two providers; the demo command runs from the cache manifest with no .env present.

**P3 — Ladder rungs 2 and 3**

1. Rung 2 similarity scoring with fingerprints and scope.
2. Rung 3 per-screen batch with candidate pre-filter and objective validation.
3. Locator cache write-back and HealEvents.

Acceptance: v2 run from the v1-warm cache gives AMBER with at least one rung-2 and one rung-3 event; v2 re-run gives GREEN with 0 LLM calls; v2-broken from the v2 cache gives RED with 0 heals.

**P4 — Milestone re-plan and adaptive ordering**

1. Adaptive milestone selection and skip-if-satisfied.
2. Rung-5 milestone-scoped re-plan with loop detection and terminal protection across re-plans.

Acceptance: v2 with the phone field and reflow gives AMBER with at least one ReplanEvent; all fixtures pass; a deliberately impossible intent gives RED unresolvable within budget, with no hang.

**P5 — Reporter and developer experience**

1. Console polish, report.md and verdict.json, heal diff, plan diff, PR block, rung histogram, timings, config header.
2. Explain-only RED hypothesis.
3. Intent lint, init command, doctor complete; optional report.html.

Acceptance: all four acts produce readable reports; the RED report shows both notions of done; an intent with a bad schema fails with a readable error.

**P6 — Demo hardening**

1. Record all four acts twice; commit runs/llm-cache and runs/snapshots/post-act-1.
2. Demo command: resets the stores, restores the snapshot, runs the acts headed with slowMo.
3. Fallback report.html per act and a screen recording of a full run.
4. README with the architecture diagram, the positioning table and the four-act script.
5. Optional: v2-wrong-total variant in the demo command; Stagehand comparison screenshot.

Acceptance: the full demo runs offline in replay in under 4 minutes on a fresh clone; eval fixtures green; feature freeze declared.

## Eval fixtures

Fixtures are the test for the test tool; they run after every prompt, ladder or shop change and before any rehearsal, and a red fixture blocks the phase.

| Fixture | Target | Cache state before | Expected verdict | Must also hold |
| --- | --- | --- | --- | --- |
| v1-baseline | v1 | empty | GREEN | plan produced; 0 heals; at most 4 LLM calls |
| v1-cached | v1 | after v1-baseline | GREEN | 0 LLM calls |
| v2-drift | v2 | snapshots/post-act-1 | AMBER | at least one rung-2, one rung-3 and one re-plan event; locator cache updated |
| v2-cached | v2 | after v2-drift | GREEN | 0 LLM calls; report names the healing run |
| v2-broken | v2-broken | after v2-drift | RED, real bug | 0 heals; state-delta failure; healerBelievedDone true |
| v2-wrong-total | v2-wrong-total | after v2-drift | RED, real bug | total mismatch named with both values |
| unresolvable | v2, intent asks for a product that does not exist | after v2-drift | RED, unresolvable | ends within budget; no hang |
| env-down | server killed mid-run | any | GREY | error named |
| replay-complete | all four acts | committed llm-cache | as above | no cache misses with no API key present |
| provider-switch | v1 | empty, LLM\_MODE=live | GREEN | passes with LLM\_PROVIDER set to each provider that has a key in the developer's .env; skipped, not failed, for providers without a key |

The eval runner resets the target store, restores the named cache state, runs the intent and compares the verdict plus the listed conditions; any mismatch fails the run.

## Demo script

Four acts in a fixed order, because each act's cache state is produced by the one before it; the whole run takes under 4 minutes from one command in replay mode.

Before going on stage: doctor passes; stores reset; cache restored to runs/snapshots/post-act-1 if a rehearsal already ran; LLM\_MODE=replay with provider and model ids pinned from runs/llm-cache/manifest.json, so no .env is needed; browser headed with slowMo 300 ms; three servers up.

| Act | Target | What the audience sees | Line to say |
| --- | --- | --- | --- |
| 1 | v1 | GREEN; the plan built from the goal; every step on rung 1 after warm-up | "This is a normal test. Boring on purpose." |
| 2 | v2 | AMBER; heal lines stream live: Add to cart on rung 2, the bag drawer on rung 3, Pay ₹1,299 on rung 3, shipping re-planned with the phone field; then the heal diff and the PR block | "Three broken selectors, a reordered flow, a new required field. Zero engineer-hours. And it wrote the fix." |
| 3 | v2-broken | the engine runs with 0 heals, reaches "Order confirmed", then RED: healer believed done at step 9; verifier: 0 new orders; page claims ORD-4821 | "Same UI. The page says confirmed. The store says nothing was saved. An agent would have passed this." |
| 4 | v2 | GREEN, 0 LLM calls, about 2 seconds | "Healing is a one-time cost. The cache learned." |

Why act 3 runs after act 2: v2-broken shares v2's UI, so the cache from act 2 fits it perfectly and the RED is isolated to the oracle with no healing noise.

If a judge asks to flip live: the three servers are already up, the engine accepts any target URL, and v2-wrong-total is one env flag away.

Fallbacks, in order: pre-rendered report.html for each act; the screen recording of a full run.

## Pitch, positioning and judge Q&A

One-liner: tests that describe intent, heal their own path, and cannot lie about the outcome.

Hook, fifteen seconds: a self-healing test that heals past a real bug is worse than a brittle test. Ours can't, because the LLM plans and finds elements while a pure-code verifier decides pass or fail against the system of record, and the verifier never moves.

Positioning on one axis, what decides success:

| Tool | What decides success | Rename | Reorder | Explains and emits a fix | Steady-state cost |
| --- | --- | --- | --- | --- | --- |
| Healenium | DOM similarity on selectors | partly | no | no; a heal onto the wrong button still passes | low |
| Stagehand and browser agents | the model's opinion that the goal is complete | yes | yes | no diff; every run pays the model | high |
| This engine | code oracle on the orders store | yes, rungs 2 and 3 | yes, milestones plus re-plan | heal diff, PR block, cache update | 0 LLM calls once cached |

Line to use: "Agents optimise for completing the goal. Tests must optimise for telling the truth."

Judge Q&A:

- How do you know it isn't hallucinating success? The verifier has no LLM dependency and checks the backend; the oracle is stripped before any model sees the intent; v2-broken is the live proof.
- What does it cost? The ladder is cheap-first; the model is called only on drift, about three calls for a full redesign; the re-run is zero calls.
- Is it flaky? Settle gate, objective validation, bounded budgets, GREY for environment, loop detection; fixtures run on every change.
- Why not just getByRole? That is our cache format. It still breaks on renames and reorders; the ladder fixes those.
- Why no screenshots? Designed and flagged off: the accessibility tree is cheaper and more precise; vision is for canvas and icon-only UIs.
- What about Stagehand's agent mode? It does whatever completes the goal; run it on v2-broken and it reports done. Do not claim it cannot reorder a flow.
- What else does the oracle catch? Wrong totals, duplicate submissions, confirmations never shown to the user.
- Blast radius? Action allowlist, same-origin only, no uploads, no HTTP outside the app.

## Rules for Claude Code (contents of CLAUDE.md)

Paste this list into CLAUDE.md at the repo root; Claude Code reads it at the start of every session.

- Read this build doc section by section before starting a phase; work one phase at a time and stop at each acceptance list.
- packages/verifier never imports the LLM adapter. The lint rule stays. If a change seems to need it, the change is wrong.
- The oracle is never read, logged or passed anywhere except packages/verifier; call redactForHealer at the engine boundary.
- Every model call goes through packages/engine/llm and is recorded. Prompts live in prompts/ with a version line; never inline a prompt.
- Plan steps reference input keys, never literal values; the resolver never invents values.
- All locators are role, label or text based. No CSS, no XPath, no nth without a scope.
- Every heal, re-plan, action and budget event is a JSON line in events.jsonl before it is printed.
- No action without a budget, no loop without a bound; exhaustion is a verdict.
- Terminal milestones run once; never retry across a terminal action.
- Use locator.ariaSnapshot(); never page.accessibility.snapshot().
- Keep the shop in one codebase with variant flags; never fork a version.
- Run the eval fixtures before claiming a phase is done; a red fixture blocks the phase.
- Ask before adding a dependency, a framework or a new package; prefer deleting code to adding it.
- After feature freeze, no code, config or prompt change except a fix for a red fixture.
- Commit runs/llm-cache (with its manifest), runs/snapshots/post-act-1 and .env.example with placeholders only; never commit .env or a real API key. Never hard-code a provider, base URL or model id; the adapter reads them from engine.config.json and env.
- When a decision is not covered here, choose the option that keeps the verifier dumber and the budgets smaller, and note it in the phase summary.

## Risks and mitigations

Every risk below has an owner phase; a risk without a mitigation in the plan is not allowed to reach P6.

| Risk | Impact | Mitigation | Owner phase |
| --- | --- | --- | --- |
| Model network or quota fails on stage | demo dies | replay mode, committed cache, misses throw in rehearsal | P2, P6 |
| Oracle false RED on v2 because copy or URL changed | our tool looks buggy | oracle anchored on the store; normalised id binding; no URL or copy checks | P1 |
| Double submission after a re-plan | two orders, false RED | terminal rule; shop disables the button after click | P1, P4 |
| Persistence slower than the page render | false RED | verifier polls up to 5 s | P1 |
| Wrong element picked but plausible | silent wrong path | objective validation, scope, progress check, back-and-escalate; the oracle is the backstop | P3 |
| Synonyms resolve the rename at rung 2 so rung 3 never fires | demo looks like Healenium | v2 uses a dynamic "Pay ₹1,299" label and an icon-only bag button | P0 |
| Positional cache keys shift after a re-plan | act 4 re-heals; the cost story dies | semantic step keys | P1 |
| v2-broken drifts from v2 | act 3 shows heals and the RED is muddied | one codebase, one flag | P0 |
| Hang on an unresolvable step | demo stalls | budgets, loop detection, RED unresolvable | P1, P4 |
| Prompt edited after recording | replay misses | prompt hash in the cache key; re-record before freeze | P2, P6 |
| A judge knows Stagehand's agent mode | pitch claim challenged | position on what decides success, not on "cannot reorder" | P6 |
| Unlabelled inputs in the shop | resolver guesses | accessibility by construction; axe scan in P0 acceptance | P0 |
| Demo laptop differs from dev machines | browser or port surprises | one owner for the demo laptop; fresh-clone test in P6; nothing upgraded after freeze | P6 |
| Chosen provider has an outage, quota limit or key problem | development blocked, demo at risk | switch LLM\_PROVIDER in env with a second key ready; two drivers cover every major API and local models; the demo runs from the cache manifest with no provider at all | P2 |

## Team lanes and timeline

Three lanes run in parallel from P0 and converge at P3; the hackathon's length sets the clock, so the plan is written in thirds.

| Lane | Owns | First third | Second third | Last third |
| --- | --- | --- | --- | --- |
| Shop | apps/shop, variants, accessibility, reset, ports | P0 complete | v2 and v2-broken tuned to the rung map; wrong-total variant | screen recording, fallback reports |
| Engine | contracts, verifier, executor, ladder, re-plan | P1 | P2, P3, P4 | fixture triage, freeze |
| Reporter and pitch | LLM adapter, reporter, CLI, fixtures, demo command, slides | adapter and fixture skeleton | P5 | P6: record the acts, rehearse twice, Q&A sheet |

Gates on the clock: P0 and P1 done by the end of the first third; P4 and all fixtures green by the end of the second third; feature freeze at T minus 6 hours; full rehearsal in replay at T minus 3 hours; nothing but red-fixture fixes after that.

Rhythm: fixtures run before every merge; a ten-minute sync at each gate; one person owns the demo laptop and upgrades nothing on it after the freeze.

## Cuts, stretch goals, out of scope

The demo does not need any of the cuts below; they are off by default and come back only after P6 acceptance.

Cut:

- Rung 4 screenshot and vision (the flag exists and stays off).
- report.html as a product feature and any web dashboard; the console is the UI. The P5 report.html is a fallback artifact only.
- CI integration, a GitHub Action, multi-browser runs.
- Generic support for arbitrary third-party sites; iframes and Stripe-style embedded card fields.
- Parallel runs, sharding, retries beyond the GREY policy.

Stretch, strictly after P6 acceptance:

- v2-wrong-total wired into the demo command.
- A Stagehand agent run on v2-broken, screenshotted for the positioning slide.
- A second intent (cancel an order) to show the oracle pattern generalises.
- report.html with a timeline view of browser time versus model time.

Out of scope for the hackathon: authentication flows, mobile viewports, visual regression, performance testing, and any claim of production readiness.

## Definition of done

The project is done when every box below is ticked on the demo laptop, from a fresh clone, with no API key present.

- [ ] Three shop servers start with one command; the axe scan is clean; reset works on each port.
- [ ] packages/verifier has no import path to the LLM adapter (lint passes) and the oracle never leaves it.
- [ ] The verdict function has one unit test per decision-table row, all green.
- [ ] Fixtures v1-baseline, v1-cached, v2-drift, v2-cached, v2-broken, unresolvable, env-down and replay-complete all pass.
- [ ] The v2-drift report shows at least one rung-2, one rung-3 and one re-plan event, plus the heal diff and the PR block.
- [ ] The v2-broken report shows "healer believed done" and the state-delta failure with both values.
- [ ] The v2-cached run makes 0 LLM calls and names the run that updated the locators.
- [ ] The full demo runs offline in replay in under 4 minutes.
- [ ] engine.config.json values are printed at the top of every report.
- [ ] runs/llm-cache with its manifest and runs/snapshots/post-act-1 are committed; .env is ignored; .env.example holds placeholders only.
- [ ] The provider-switch fixture passes on at least two providers, and no provider, base URL or model id appears in code.
- [ ] README carries the architecture diagram, the positioning table and the four-act script.
- [ ] Rehearsed twice end to end on the demo laptop; feature freeze declared.
