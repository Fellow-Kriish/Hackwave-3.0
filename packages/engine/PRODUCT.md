# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary, for now: the hackathon mentor and judges who score HackWave. They watch it on a projector or the presenter's
laptop, usually through the web app (`pnpm ui`) or the CLI demo, and they are judging two things: whether the product
works and can be trusted, and how it would scale and be presented as a product.

Secondary, later: QA and dev engineers who would write goals and run them against their own app, at a desk.

## Product Purpose

HackWave tests a web app from a goal written in plain words ("Complete checkout with a valid credit card") instead of a
scripted test. The engine plans the steps on the live page, finds each control through a cheapest-first ladder, heals
when the app's UI changes, and then a verifier with no AI in it decides the result from the app's system of record (the
order store), not from what the page says.

Success, for this phase: a judge watches a test find its way through a redesigned app, sees a page that says "Order
confirmed" while the store has nothing, and understands at a glance why the run is RED.

## Positioning

AI plans and finds; code decides. Self-healing tools judge success from the DOM, and browser agents judge their own
success; HackWave's pass or fail comes from a model-free check of the backend, so a heal can never pass a real bug.
Healing is a one-time cost: once a plan and locators are cached, a re-run makes no AI calls.

## Operating Context

- Entry points: the web app (`pnpm ui`: goal box, version picker, Run test, Guided demo, live log, result cards), the
  CLI (`pnpm engine run | try | explore | eval | demo`), and the double-click menu `demo-menu.bat`.
- The app under test in the demo is the local shop in `apps/shop`: Version A, Version B (redesign), Version B with a
  backend bug, Version B with a pricing bug, served at one address and redeployed between steps.
- Results: GREEN (passed), AMBER (passed after healing, with the fix to commit and a plain-English "What changed"), RED
  (a real bug, or no safe way forward), GREY (no verdict: the environment failed). Explore mode on any other website
  reports UNVERIFIED and is never a pass.
- Every run writes a folder under `runs/` with events, the verdict, `report.md` / `report.html` and `pr.md`.

## Capabilities and Constraints

- Platform constraint, binding until the hackathon demo (date not recorded): the web app runs offline on the presenter
  laptop with no framework, no build step, no CDN and no new runtime dependency; the page ships from the engine's own
  server. A hosted product could relax this later; that is undecided.
- Repository rules (from `CLAUDE.md` and `docs/UI-DESIGN.md`): server values go on the page through `textContent`, never
  `innerHTML`; the server stays on 127.0.0.1, one run at a time, POSTs only from its own page, files only from `runs/`;
  the verifier's success check (the oracle) never reaches the AI or the UI; the visible label `Goal, in plain words` is
  asserted by a test.
- `apps/shop` is the app under test, not the product: its labels, landmarks and layout are what cached locators,
  recorded AI answers and eval fixtures depend on, so product UI work must not restyle it.
- A UI change must not change any AI cache key (`prompts/`, `runs/llm-cache`): the recorded demo replays offline.
- Known limits: the verifier reads only `/api/<store>` on the same origin with the shop's record shape; typed goals get
  a success check built by code for one product; other websites need explore mode (UNVERIFIED).
- AI: Groq `openai/gpt-oss-120b` for both tiers, free tier with an 8k tokens/minute and 200k tokens/day limit.

## Brand Commitments

- The product name is **HackWave**, written exactly so.
- Existing copy that is not binding: the tagline "tests that describe intent, heal their own path, and cannot lie about
  the outcome" and the README line "Agents optimise for completing the goal; tests must optimise for telling the truth."

## Evidence on Hand

- A recorded, offline demo: four acts (`pnpm demo`), and the web app's Guided demo, both replaying `runs/llm-cache`.
- 20 eval fixtures (`pnpm engine eval`) and 211 unit tests across 21 files, all passing as of 2026-10-11.
- Measured in this session: a new goal planned from scratch takes 4 AI calls; Version B heals with 6; the repeat run
  takes 0. Runs take about 12 to 25 seconds.
- `docs/UI-DESIGN.md`: an unimplemented interface spec for the web app (a direction and tokens); not adopted visual
  authority yet.
- `docs/architecture.excalidraw`: the flow from a typed goal to the verdict.
- There are no customers, testimonials, benchmarks against competitors, pricing or deployments. Future work must not
  invent them.

## Product Principles

1. Never call it a pass unless code checked the outcome. Anything weaker is labelled (AMBER, UNVERIFIED), never GREEN.
2. Show why, not just what: every verdict carries its reason, what the healer believed versus what the verifier found,
   and for AMBER what changed in the app.
3. The judge must follow it live: each step, heal and check is visible as it happens, in the browser and the log.
4. The AI only where it is needed, and the cost visible: cached runs make no calls, and every call is counted.
5. Honest about limits: a test that cannot be verified is refused or labelled, not faked.
