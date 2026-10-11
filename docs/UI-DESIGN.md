# HackWave web app: interface design spec

This spec covers the redesign of the web app that `pnpm ui` serves (`packages/engine/src/ui/`). It is written to be built
from: every element below maps to data the engine already produces, or to a small, named server change in section 8.

It does not touch the code. Nothing here has been implemented yet.

## 0. Scope and what must not change

In scope:

- `packages/engine/src/ui/page.ts`: the whole page (HTML, CSS, script).
- `packages/engine/src/ui/server.ts`: the extra fields and events listed in section 8, and nothing else.
- Optional, last: the same tokens applied to `report.html` (`packages/engine/src/html.ts`) and the demo index page.

Out of scope, and why:

| Leave alone | Reason |
| --- | --- |
| `apps/shop` (v1, v2 and the bug variants) | It is the app under test. Its labels, landmarks and layout are what the cached locators, recorded model answers and eval fixtures depend on. Restyling it breaks replay and turns act 1 into a heal. |
| `packages/verifier` | The verdict logic. The UI only displays what it decides. |
| `describeEvent` in `console.ts` | The CLI prints the same lines. The run log in the web app shows these lines as they are, and the new parts of the UI read structured events instead (section 8). |
| `prompts/`, `runs/llm-cache` | A UI change must not change a single cache key. |

Hard constraints from the repo (`CLAUDE.md` and the current page):

1. No framework, no build step, no runtime dependency, no CDN. The demo runs offline, so every font, icon and script
   ships with the page or with the OS. Ask the lead before vendoring any file, including a font.
2. Every server value goes on the page through `textContent` (or `createElementNS` plus `textContent` for SVG), never
   `innerHTML`. Keep this rule exactly as it is today.
3. Keep the visible label text `Goal, in plain words`: `ui/server.test.ts` asserts it.
4. The server stays on 127.0.0.1, one run at a time, POSTs only from its own origin, files only from `runs/`.
5. The oracle never leaves the verifier. The UI shows the verdict and the check results the verdict already carries, and
   nothing from the intent's oracle block.

## 1. What the product is, in one paragraph

A tester types a goal in plain words ("Complete checkout with a valid credit card"), picks a version of the shop, and
presses Run test. The engine plans milestones (cart, checkout, shipping, payment, place order), finds each control
through a cheapest-first ladder (saved locator, closest name match, a fast-model pick, a milestone re-plan), clicks
through the shop in a real browser, and then a model-free verifier decides the result from the order store, not from
the page. The four outcomes: Green (passed), Amber (passed after healing, with the fix to commit), Red (a real bug, or
no safe way forward), Grey (no verdict: the environment failed). The scene that matters most is act 3: the page says
"Thanks! Order ORD-4821 is on its way", the store has nothing, and the run stays red.

Audience: QA and dev engineers at a desk, and hackathon judges watching a projector. Primary job: let a person watch a
test find its way and then trust, at a glance, why it passed or failed.

## 2. Design direction: the signal box

The engine already speaks railway. Its verdicts are signal aspects: green, amber (caution), red (danger), and grey (a
dark signal: no aspect shown). The verifier works like an interlocking: logic that the driver cannot overrule, however
sure the driver is. The model is the driver who finds the way. The verifier is the interlocking that decides whether
the route is clear. The milestones are block sections a train passes through in order.

The UI borrows the look of a signal-box mimic panel: a painted steel panel, a dark recessed track diagram whose sections
light up as the train occupies and clears them, and round signal lamps. The panel stays in the background as a
working instrument, not a costume. No trains, no clip art, no railway puns in the copy.

Why this direction and not a default:

- It comes from the product's own vocabulary (aspects, routes, sections, interlocking), so nothing about it is
  borrowed from another product category.
- It makes the core claim visible: the lamp at the end of the line is lit by the verifier, never by the run itself.
- It gives the dashboard one memorable element (the Line, section 6.4) and lets everything around it stay quiet.

### One place for boldness

The Line is the only expressive element. The composer, the witnesses, the tables and the log are calm, typographic and
dense. If a new element starts competing with the Line for attention, cut it back.

## 3. The no-generic rules

"AI-free" here means two things: the page must not look like a generated template, and it must not dress the product up
as AI. The engine's whole point is that the model does not decide the verdict, so the UI should talk about the work
(finding controls, checking the store), with the model shown as a cost line, not as a personality.

### Visual bans

- No sparkle, star, wand, robot or brain icons. No "thinking" dots, shimmer, typewriter text or glowing orbs.
- No purple or blue-violet gradients, no gradient washes as decoration, no glassmorphism or backdrop blur.
- No grid of identical rounded cards with the same soft grey shadow. Hierarchy comes from type size, rules and position.
- No one border radius on everything (radius scale in section 4.4).
- No eyebrow labels in tracked-out capitals above headings. No all-caps labels anywhere.
- No metadata strings joined with middle dots (`12 s · 4 heals · 6 calls`). Show numbers in labelled cells instead. The
  raw run log keeps the engine's own lines, dots included, because the CLI prints them the same way.
- No arrows appended to button or link text.
- No monospace for small labels or numbers. Monospace is only for locators, diffs, file paths and the run log, which
  really are code.
- No entrance animations on sections, no hover lift on panels. Motion only where section 9 allows it.
- No emoji in the interface.

### Copy bans and replacements

- Never "The AI is doing…", "AI-powered", "magic", "smart", "intelligent", "Let AI handle it".
- Say what happened, in the active voice: "Found 'Proceed to payment' by picking from 8 candidates", not "AI healed a
  selector".
- Where a model really was involved, name it as a model and give the count: "Model calls: 6, all from recordings".
- Errors say what broke and what to do next. They do not apologise.
- Sentence case everywhere. Buttons say exactly what happens.

The full copy deck is in section 7.

## 4. Tokens

### 4.1 Colour

Day panel (default, light):

| Token | Hex | Role |
| --- | --- | --- |
| `--panel` | `#DCE1DA` | Page background: the painted steel of a mimic panel, a cool grey-green |
| `--board` | `#F2F4EF` | Reading surfaces: composer, witnesses, tables |
| `--ink` | `#1D2622` | Text and primary buttons |
| `--ink-2` | `#4D5953` | Secondary text, labels |
| `--rule` | `#B7C0B8` | Rules and field borders |
| `--bed` | `#27312C` | The recessed track bed behind the Line |
| `--rail` | `#6F7C74` | Track not yet reached |
| `--rail-lit` | `#F4F6F0` | Track the run has cleared |
| `--wire` | `#4E6E8E` | Data hue for anything model-related (model time, model calls) |

Signal aspects. Each aspect has a lamp colour, used only for fills, lamps and track marks, and a text colour that
passes 4.5:1 on `--board`:

| Aspect | Lamp | Text on board | Used for |
| --- | --- | --- | --- |
| Green | `#1F9E58` | `#13673A` | Passed |
| Amber | `#F0A81C` | `#875800` | Passed after healing; heal marks on the Line |
| Red | `#D8352B` | `#A3231B` | Real bug, unresolvable, rejected heal |
| Grey (dark signal) | `#7E8882` | `#4D5953` | No verdict |

Night panel (`prefers-color-scheme: dark`, plus a manual toggle stored in `localStorage` with try/catch):

| Token | Hex |
| --- | --- |
| `--panel` | `#1A221E` |
| `--board` | `#222B26` |
| `--ink` | `#E6EBE5` |
| `--ink-2` | `#A3AFA7` |
| `--rule` | `#37423C` |
| `--bed` | `#121916` |
| `--rail` | `#56625B` |
| `--rail-lit` | `#E9EEE7` |
| `--wire` | `#86A6C6` |
| Lamps | Green `#3DC27B`, Amber `#F5B83D`, Red `#F0655B`, Grey `#6C7670` |
| Text on board | Green `#5FD394`, Amber `#F5C060`, Red `#F58A82`, Grey `#A3AFA7` |

Rules for colour:

- An aspect colour always means a verdict or a heal. Never use green for a "success" toast or red for a delete
  button that has nothing to do with a verdict.
- Colour is never the only signal. Every lamp carries its word ("Passed", "Real bug") and a shape (section 6.4).
- Primary buttons are `--ink` on `--board`. There is no separate brand accent: the lamps are the only colour.

### 4.2 Type

Two families with clearly separate jobs, plus monospace for code. All of them ship with the OS, so nothing is
downloaded.

| Role | Stack | Why |
| --- | --- | --- |
| Signal face: headings, the goal line, verdict words, numbers, labels, buttons | `"Bahnschrift", "DIN Alternate", "DIN Condensed", "Barlow", system-ui, sans-serif` | Bahnschrift is Microsoft's cut of DIN 1451, the German railway signage face, and ships with Windows 10 and 11, which is the demo laptop. DIN Alternate and DIN Condensed ship with macOS. It looks like panel lettering and has tabular figures. |
| Prose face: summaries, What changed, likely cause, the guided demo's spoken lines | `"Sitka Text", "Iowan Old Style", "Charter", Georgia, serif` | Sentences a person reads get a book face, so the human explanation reads differently from the machine status. Sitka (Matthew Carter) ships with Windows. Body line height is 1.6, slightly more than the sans. |
| Code: locators, diffs, file paths, the run log | `"Cascadia Mono", ui-monospace, "SF Mono", Consolas, monospace` | Cascadia ships with Windows 11. |

Use Bahnschrift's widths for hierarchy: `"Bahnschrift SemiCondensed"` for table headers and the Line's section labels,
`"Bahnschrift Condensed"` at a heavy weight for the verdict word. Check in Chrome on the demo laptop that the width
families resolve; if they don't, use `font-stretch` with the base family, or stay at normal width.

Turn on tabular figures (`font-variant-numeric: tabular-nums`) for every number that changes during a run (budgets,
seconds, counts), so digits don't jitter.

Type scale, from the traditional scale in *The Elements of Typographic Style*:

| Step | Size / line height | Face | Use |
| --- | --- | --- | --- |
| 60 | 60 / 60 | Signal, Condensed, 700 | Verdict word on the verdict plate (36 under 760 px) |
| 36 | 36 / 40 | Signal, 600 | The goal line in the composer (24 under 760 px) |
| 24 | 24 / 30 | Signal, 600 | Panel headings |
| 18 | 18 / 29 | Prose, 400 | Verdict summary, witness statements |
| 16 | 16 / 26 | Prose, 400 | What changed, likely cause, guided demo lines |
| 15 | 15 / 22 | Signal, 400 | Default UI text, buttons, table cells |
| 13 | 13 / 18 | Signal, 400 | Secondary labels, hints, the Line's labels |
| 12.5 | 12.5 / 18 | Mono, 400 | Locators, diffs, log |

Keep prose blocks at 68 characters or fewer (`max-width: 68ch`). Headings are sentence case, weight 600, never all
caps, never letter-spaced.

### 4.3 Space

4 px base. Scale: 4, 8, 12, 16, 24, 32, 48, 64. Panels pad 24 on desktop and 16 on mobile. The page gutter is 32 on
desktop and 16 on mobile. There is no horizontal page scroll at any width.

### 4.4 Shape and depth

Radius goes with what a thing is, not one value for everything:

| Element | Radius |
| --- | --- |
| Lamps, train marker | 50% |
| Track bed (the Line) | 8 px, with an inset shadow `inset 0 2px 6px rgb(0 0 0 / .35)` so it reads as recessed |
| Buttons, fields, segmented control | 4 px |
| Board surfaces | 2 px |
| Tables, rules | 0 |

The only other shadow is under the detail sheet (`0 8px 32px rgb(20 30 25 / .25)`) while it is open. Panels don't float.

## 5. Layout

### 5.1 Desktop, 1200 px and wider

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ HackWave        Shop  localhost:54592   Serving  Version B        Model  recordings only  ◐│  status strip
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Goal, in plain words                                                                      │
│ Complete checkout with a valid credit card and see the order confirmation.                │  36 px goal line
│ [Recorded goal, runs offline]  [Buy the City Sneaker and pay by credit card]              │
│                                                                                           │
│ Version  ( A  the original )( B  the redesign )( B  backend bug )( B  pricing bug )        │
│ [ Run test ]   [ Run the guided demo ]        □ Start from scratch   □ Use the live model  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ╭──────────────────────────────────────────────────────────────────────────────────────╮ │
│ │  ●━━━━━━━━━●━━━━━━━━━━━●━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━◆━━━━━━━━━━━━━  ( lamp )       │ │  The Line
│ │   cart       checkout    shipping  ╭───╮  payment          place order                 │ │
│ │   ' '        '           ' ' ' ' ' ╯re-╰ ' ' ' '           runs once                   │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────╯ │
│  Actions  9 of 25 ▕██████░░░░░░▏  Time  21 s of 90 s ▕███░░░░░▏  Model calls  3 of 8 ▕███░░▏│  budget gauges
├──────────────────────────────────────────────┬───────────────────────────────────────────┤
│ What the page showed                    ≠    │ What the order store holds                │  the two witnesses
│ "Thanks! Order ORD-4821 is on its way"       │ No new order.                             │
│ /orders/ORD-4821                             │ 0 before the run, 0 after waiting 5 s.    │
│ The run believed it was done at step 14.     │                                           │
├──────────────────────────────────────────────┴───────────────────────────────────────────┤
│ ( lamp )  Real bug                                                                         │  verdict plate
│           The page said the order was confirmed, but the store has no new order.            │
│           Likely cause  (written by the model after the verdict; it can't change it)       │
│           The order POST handler or its database write…            [ Open the details ]   │
├──────────────────────────────────────────────┬───────────────────────────────────────────┤
│ Runs                                         │ Run log                         [ Hide ]  │
│ ● Real bug     Version B, backend bug  17.6 s│ ▸ payment  Enter credit card information. │
│ ● Healed       Version B               22.2 s│   [rung 1] resolved payment.card-number…  │
│ ● Passed       Version A               12.0 s│   …                                       │
└──────────────────────────────────────────────┴───────────────────────────────────────────┘
```

Alignment: everything is left-aligned to one 12-column grid with a 32 px gutter. Nothing is centred except the lamp
inside its housing. The goal line and verdict word share the same left edge, so the eye goes from what you asked for
straight down to what the verifier decided.

Order on the page follows the run: ask, watch the route, compare the witnesses, read the verdict, then history and raw
log. The witnesses and verdict plate appear empty with their labels from the start ("Waiting for the run to finish"),
so the layout doesn't jump when the result arrives.

### 5.2 Tablet, 760 to 1199 px

Single column. Runs and Run log stack. The Line keeps its horizontal form and gets narrower: section labels shorten
to the milestone key and the description moves into the tooltip.

### 5.3 Phone, under 760 px

The Line turns vertical: the track runs top to bottom down the left edge, labels on the right, the lamp at the bottom.
This removes any need for horizontal scrolling. The witnesses stack, page first, with the ≠ or = mark between them.
The run log is collapsed by default. Buttons go full width and are at least 44 px tall.

### 5.4 Guided demo mode

When the guided demo runs, a strip of four stations appears directly above the Line:

```
  1 ───────────── 2 ───────────── 3 ───────────── 4
  Version A        Version B        Version B,       Version B
  from scratch     same address     backend bug      again
  ( green )        ( amber )        ( lit, running )  ( dark )
```

The numbers are real: the four runs happen in that order. Each finished station shows its verdict lamp. Under the
strip, in the prose face at 16 px, goes the current step's `say` line from `GUIDED_STEPS`, which the presenter can
read aloud.

### 5.5 Presenter view

Add `?present` to the URL to scale the root size by 1.25, hide the run log and the Runs table, and keep the guided demo
strip, the Line, the witnesses and the verdict plate on one 1920 × 1080 screen. This is for the projector. It needs no
server change.

## 6. Components

### 6.1 Status strip

One row across the top, signal face at 13 px, with label and value pairs set as separate cells:

| Label | Value | Source |
| --- | --- | --- |
| Shop | `localhost:54592` | `state.address` |
| Serving | `Version B` or `Nothing yet` | `state.deployedLabel` |
| Model | `Recordings only` or `Live, key found` | `state.liveAvailable` |
| (right edge) | theme toggle, a half-filled circle drawn in SVG | local only |

While a run is going, a cell appears: `Running  0:21`, where the clock ticks from the run's `elapsedMs`. Use ink, not
amber, because amber means a verdict.

If the event stream drops: the strip turns `--board` with a red rule on the left and reads "Lost the connection to
the HackWave server. Is `pnpm ui` still running?" Reconnect with the browser's EventSource retry and clear the message
when the `state` message comes back.

### 6.2 Goal composer

- Label: `Goal, in plain words` (signal face, 13 px, `--ink-2`). Keep this exact text (test).
- The textarea is unboxed: no border, a 2 px `--rule` underline that turns `--ink` on focus, 36 px signal-face text,
  like a destination board. It auto-grows to three lines and then scrolls.
- Under it, a counter appears only near the limits: "12 more characters needed" under 10, "40 characters left" over
  260 (the server accepts 10 to 300).
- Example chips: plain text buttons with a 1 px `--rule` outline and a 4 px radius. The recorded goal's chip reads
  "Recorded goal, runs offline". The others show their own sentence.
- If the typed sentence has no recording and the model status is `Recordings only`, show this under the field before
  the person presses anything: "This sentence has no recording. It needs the live model: add LLM_API_KEY to .env, or
  pick the recorded goal." This needs one server field (section 8.2).
- `Ctrl+Enter` (and `⌘+Enter`) runs the test from inside the field.

### 6.3 Version selector and actions

A segmented control (radio group, `role="radiogroup"`) of four options. Each shows a name on the first line and what
makes it different on the second:

| Value | Name | Second line |
| --- | --- | --- |
| v1 | Version A | the original |
| v2 | Version B | the redesign |
| v2-broken | Version B, backend bug | confirms orders, saves nothing |
| v2-wrong-total | Version B, pricing bug | saves the wrong total |

The two bug variants get a 3 px red rule along their top edge, which is the only hint that they are rigged. The
selected option is filled `--ink` with `--board` text.

Actions:

- `Run test`: primary, ink fill.
- `Run the guided demo`: secondary, 1 px ink outline. Under it in 13 px: "Four runs at one address, about a minute and
  a half." (The demo index shows four acts in 1 m 09 s; leave room.)
- Two checkboxes with a hint line each:
  - "Start from scratch". Hint: "Forget the saved plan and locators for this goal."
  - "Use the live model". Hint: "Even when recorded answers exist. Needs LLM_API_KEY." Disabled, with the hint "No
    API key found in .env", when `liveAvailable` is false.
- While busy, both buttons are disabled and `Run test` reads `Running…`. When the result arrives it says `Run test`
  again.

### 6.4 The Line (the signature element)

An inline SVG inside the recessed `--bed`, built with `createElementNS`. All labels are set with `textContent`.

Structure, left to right:

1. A buffer stop at the start (a short perpendicular bar).
2. One track section per milestone, in the order the run actually takes them. Each section shows:
   - its key under the track (`shipping`), Bahnschrift SemiCondensed 13 px, and on hover or focus the milestone
     description from `milestone_started.description`;
   - a tick on the track for each step resolved in it.
3. Section joints: a small circle between sections.
4. The terminal milestone ends in a diamond with the note "runs once" under it. That is the commit point; the engine
   never retries across it.
5. The signal at the end: a lamp in a dark housing, 28 px. It stays dark until the `verdict` event arrives. Only the
   verdict lights it, never the run's own sense that it is done.

Section states:

| State | Drawing | Triggered by |
| --- | --- | --- |
| Not reached | 3 px `--rail` | default |
| Occupied | 5 px `--rail-lit` plus the train marker (a 10 px lit circle) at the last step's tick | `milestone_started` |
| Cleared | 3 px `--rail-lit` | `milestone_done` with `holds: true` |
| Ran, not confirmed | 3 px `--rail-lit`, dashed | `milestone_done` with `holds: false` |
| Skipped | 3 px `--rail-lit`, dotted, with the note "already done" | `milestone_skipped` |
| Moved earlier | drawn where it actually ran, with a hairline arc from its planned slot and the note "moved before payment" | `milestone_reordered` |

Step ticks, by how the control was found:

| How it was found | Tick | Word on hover |
| --- | --- | --- |
| Rung 1 | thin `--rail-lit` tick | Saved locator |
| Rung 2 | amber outline tick | Closest name match (score shown) |
| Rung 3 | solid amber tick | Model picked from 8 candidates |
| Rung 5 | a bypass loop drawn above the section: track leaves, curves over and rejoins, amber, labelled "re-planned" | Milestone re-planned |
| Heal undone | red cross on the tick | Acted without effect, undone |
| Not found | red stop block across the track | Could not find this control |
| Terminal step | the diamond | Runs once |

Hover or focus a tick to get a small board-coloured tooltip:

```
cart-review.checkout                     click
Was   button "Checkout"
Now   button "Proceed to payment"
Found by  Model picked from 8 candidates
412 ms
```

Locators are in the code face, everything else in the signal face. Data comes from `resolved` and `healed`
(section 8.3).

Shapes carry meaning as well as colour, so the Line still reads in greyscale and for colour-blind viewers: an outline
tick versus a solid tick versus a loop versus a cross versus a block.

The lamp, once lit:

| Verdict | Lamp | Housing mark |
| --- | --- | --- |
| Green | Green lamp | none |
| Amber | Amber lamp | none |
| Red | Red lamp | a horizontal bar across the lamp |
| Grey | Lamp stays dark | a ring with a gap ("no aspect") |

Next to the lamp, in the signal face at 15 px: "Passed", "Passed after healing", "Real bug", "No safe way forward",
"No verdict".

If a run uses a cached plan, no `planned` event arrives (`executor.ts` only sends it when the planner writes a plan).
Section 8.2 has the server lay out the sections from the plan file. Until they arrive, sections are drawn one by one
as `milestone_started` events come in, and the lamp sits at the right edge.

### 6.5 Budget gauges

Three thin horizontal gauges under the bed. These are the run's hard limits, from `run_started.budgets`, filled from
`action.budget` and `llm_call`:

- Actions: `9 of 25`
- Time: `21 s of 90 s`
- Model calls: `3 of 8`, using `--wire`. When calls come from recordings, add "all from recordings" after the count.

Each gauge is a 4 px bar inside a 1 px `--rule` outline. At 80% the fill turns amber. When it's used up, it turns red
and the run's `stopped` message appears under it. Budgets ending a run is a verdict in this product, so it gets shown.

### 6.6 The two witnesses

Two columns on one board, with a 1 px rule between them and a mark centred on the rule: `=` when they agree and `≠`
when they don't. This is the panel that makes act 3 land.

Left column, "What the page showed":

- The final page's heading in quotes, prose face 18 px: `"Thanks! Order ORD-4821 is on its way"`.
- The final URL path in the code face: `/orders/ORD-4821`.
- The run's own belief, 15 px: "The run believed it was done at step 14 (place-order.submit)." or "The run did not
  believe it was done."

Right column, "What the order store holds":

- Green or Amber: "Order 4821 saved." Then one line per compared field from the state check: "Trail Runner", "₹1,299",
  "Card ending 4242". Format rupees with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR',
  maximumFractionDigits: 0 })`.
- Red, nothing saved: "No new order." then "0 before the run, 0 after waiting 5 s."
- Red, wrong total: "Order 4821 saved, with the wrong total." then the compared line with expected and actual, the
  wrong value in red text: "Total: expected ₹1,299, saved ₹999".
- Grey: "Couldn't read the store." plus the reason.

Agreement: the two sides agree when the binding check passed and the state check passed. Anything else is `≠`. Before
the result arrives, both columns say "Waiting for the run to finish".

### 6.7 Verdict plate

Shown under the witnesses, full width, `--board`, with a 6 px left rule in the aspect lamp colour.

- A lamp (20 px) and the verdict word in Bahnschrift Condensed at 60 px, sentence case, in the aspect's text colour.
  Under it in 13 px, the colour name ("Green") for anyone who can't tell the lamps apart.
- The summary sentence (`result.summary`) in the prose face at 18 px, up to 68 characters a line.
- For Amber: "What changed" in the prose face, as a list, from `result.whatChanged`. This is the most human part of the
  output; give it room.
- For Red with a hypothesis: a block headed "Likely cause", with the subheading in 13 px: "Written by the model after
  the verdict, from the evidence. It can't change the verdict." The text goes in the prose face.
- A row of figures in labelled cells (no dot-joined strings): Time `22.2 s`, Heals `4`, Re-plans `1`, Model calls `6`,
  From recordings `6`.
- Two actions: `Open the details` (opens the detail sheet) and `Open the full report` (a link to `reportUrl`, opens in
  a new tab).

### 6.8 Detail sheet

A sheet that slides in from the right (from the bottom on phones) over 60% of the width. Esc or the close button shuts
it, and focus returns to `Open the details`. Its tabs only appear when there's content for them:

| Tab | Content | Source |
| --- | --- | --- |
| What changed | the plain-words list | `whatChanged` |
| Heals | table: Step, Was, Now, Found by, Checks passed. Locators in code face. Under the table, for each heal, why the cheaper ways failed. | `heals[]` (section 8.2) |
| Re-plans | per re-plan: the milestone, why it went to re-plan, the re-planner's one sentence, and the step diff with `+` lines on a green tint and `-` lines on a red tint | `replans[]` |
| Fix to commit | the locator-cache diff, then the pull request text in a code block with a `Copy pull request text` button that changes to `Copied` for 2 s | `prText`, `cacheDiff` |
| Checks | three rows: Order saved, Order number shown on the page, No error messages. Status words: Passed, Failed, Couldn't run, Not run, Off. Expand a row to see expected against actual. | `checks[]` with `compared` |
| Timing | one horizontal strip split into browser time (`--ink-2`) and model time (`--wire`), then a step table with a bar per step | `timings` |

Checks use the same words as the plate: "Passed" and "Failed", never "pass" and "fail" in the UI.

### 6.9 Runs

A table, newest first, from `state.history` plus each new `result` message:

| Column | Content |
| --- | --- |
| (lamp) | 10 px lamp with its shape mark |
| Result | Passed, Passed after healing, Real bug, No safe way forward, No verdict |
| Goal | the sentence, cut to one line with an ellipsis; full text on hover |
| Version | Version A, Version B, … |
| Heals | number |
| Model calls | number, and "recorded" when all came from recordings |
| Time | `12.0 s` |
| | a `Details` button that opens the detail sheet for that run |

Rows are 40 px, separated by 1 px rules, with no zebra striping. History lives in server memory and is gone after a
restart. Say so in the empty state rather than hiding it.

### 6.10 Run log

The engine's own lines from `line` messages, as they are: code face, 12.5 px, on `--bed` with `--rail-lit` text, with
the existing tones (`dim`, `info`, `warn`, `bad`, `good`, `heading`) mapped to the night palette. It's the raw view
for engineers.

- Heading "Run log" and a `Hide` / `Show` toggle. Hidden by default on phones and in presenter view.
- A filter row: All, Heals and re-plans, Problems. This filters by tone (`warn`, `bad`) on the client side.
- Auto-scroll only while the reader is already at the bottom (the current behaviour, kept). When they've scrolled up,
  a `Jump to latest` button appears.
- The `run` divider line becomes a full-width rule with the label and goal set in the signal face, instead of
  `━━ label ━━`.

### 6.11 Empty, loading and error states

| Situation | What it says |
| --- | --- |
| No runs yet | "No runs yet. Start with the recorded goal: it runs offline and takes about 15 seconds." |
| Log before any run | "The log fills in as the run goes. A browser window opens too, so you can watch every click." |
| Deploying a version | in the status strip: "Starting Version B at localhost:54592" |
| Goal too short or long | under the field: "Write the goal as one sentence, 10 to 300 characters." |
| A run is already going (409) | "A test is already running. This one starts when you press Run test again after it ends." |
| Live model needed, no key | "This sentence has no recording, so it needs the live model. Add LLM_API_KEY to .env, or pick the recorded goal." |
| Server error | the error message as the server sent it, in red text on `--board`, with no extra wording |

## 7. Copy deck

| Where | Now | New |
| --- | --- | --- |
| Header line | "Type what a user wants to do. The AI reads the site, works out the steps, does them, and checks the real result." | "Describe what a shopper should be able to do. HackWave finds its way through the shop, then checks the order store, not the page, to decide whether it worked." |
| Composer heading | "What should the test do?" | remove; the goal label is enough |
| Run button | "Run test" | "Run test" (keep) |
| Demo button | "Guided demo (4 steps)" | "Run the guided demo" plus the hint line |
| Fresh checkbox | "Start from scratch: forget what it learned for this goal" | "Start from scratch", hint "Forget the saved plan and locators for this goal." |
| Live checkbox | "Use the live AI even for a goal with recorded answers" | "Use the live model", hint "Even when recorded answers exist. Needs LLM_API_KEY." |
| Status | "AI: live model ready" / "no API key, recorded goals only" | "Model: Live, key found" / "Model: Recordings only" |
| Log panel | "What the AI is doing" | "Run log" |
| Results panel | "Results" | "Runs" |
| Check rows | "checked state: pass (…)" | "Order saved: Passed", with the summary under it |
| Hypothesis | "Likely cause: …" | "Likely cause" heading plus the model note (section 6.7) |
| Meta row | "12 s · 0 heal(s) · 0 re-plan(s) · AI calls 0" | labelled cells: Time, Heals, Re-plans, Model calls |
| Report link | "full report" | "Open the full report" |
| Disconnect | "lost the connection to the HackWave server; is it still running?" | "Lost the connection to the HackWave server. Is `pnpm ui` still running?" |

Verdict words, used the same everywhere (plate, Runs table, Line, tab title):

| Verdict kind | Word |
| --- | --- |
| passed | Passed |
| ui_drift | Passed after healing |
| real_bug | Real bug |
| unresolvable | No safe way forward |
| environment | No verdict: the environment failed |
| incomplete | No verdict: the run didn't finish |

Ways the ladder found a control, used the same everywhere:

| Rung | Words |
| --- | --- |
| 1 | Saved locator |
| 2 | Closest name match |
| 3 | Model picked from candidates |
| 4 | Screenshot (switched off) |
| 5 | Milestone re-planned |

The guided demo's `say` lines in `GUIDED_STEPS` already read well. Keep them.

## 8. Data: what the page gets, and what to add

### 8.1 What the page gets today

The SSE stream at `/api/events` sends: `state`, `busy`, `line` (text and tone), `run` (label, goal, version, address,
mode, fresh, notes), `step` (guided demo index, title, say), `result` (the history entry) and `error` (message, hint).
The `result` entry carries `color`, `kind`, `summary`, `whatChanged`, `healer`, `checks` (name, status, summary),
counts, `seconds`, `hypothesis` and `reportUrl`.

That's enough for the composer, status strip, Runs table, log and a basic verdict plate. It is not enough for the Line,
the gauges, the witnesses or the detail sheet.

### 8.2 Server changes (all in `ui/server.ts` unless noted)

1. **Forward structured events.** In `runOne`'s `onEvent`, send `{ type: 'event', event: project(event) }` as well as
   the `line` messages. `project` copies an explicit list of fields per event type and drops everything else, so a
   future field never reaches the browser by accident:

   | Event | Fields to forward |
   | --- | --- |
   | `run_started` | `runId`, `intentId`, `planSource`, `budgets` |
   | `planned` | `milestones[].key`, `milestones[].terminal` |
   | `milestone_started` | `milestoneKey`, `description`, `terminal` |
   | `milestone_done` | `milestoneKey`, `holds`, `detail` |
   | `milestone_skipped` | `milestoneKey`, `detail` |
   | `milestone_reordered` | `milestoneKey`, `instead`, `detail` |
   | `resolved` | `milestoneKey`, `stepKey`, `rung`, `action`, `target`, `planned`, `ms` |
   | `healed` | `stepKey`, `rung`, `fromText`, `toText`, `moved`, `validation` |
   | `heal_rejected` | `stepKey`, `rung`, `target`, `detail` |
   | `unresolved` | `milestoneKey`, `stepKey`, `target` |
   | `replan_started`, `replanned` | `milestoneKey`, `attempt`, `maxAttempts`, `added`, `why` |
   | `action` | `stepKey`, `action`, `budget` (not `inputRef` value; the key name alone is fine) |
   | `llm_call` | `stage`, `cacheHit`, `ms`, `tokensIn`, `tokensOut` |
   | `terminal_attempted` | `stepKey` |
   | `healer_done` | `believed`, `atStep`, `stepKey` |
   | `stopped` | `outcome`, `message` |
   | `verdict` | `color`, `kind` |

   Input values never appear in events (the executor keeps them out), and the projection keeps it that way.

2. **Milestones for cached plans.** On `run_started`, if no `planned` event follows (`planSource` is `cache` or
   `hand-written`), read the plan file the event names (it lives under `runs/plans/` or `evals/plans/`), validate it
   with the plan schema from `@hackwave/contracts`, and send a synthetic `{ type: 'event', event: { type: 'planned',
   milestones } }` with keys and terminal flags only. This avoids touching the executor.

3. **Richer result entry.** Add to the `entry` object:
   - `witness`: `{ finalHeading, finalUrl, newRecordId, baselineCount, healerBelieved, healerAtStep, healerStepKey }`
     from `verdict.oracle` and `verdict.healerBelievedDone`;
   - `checks[].compared` from `verdict.oracle[name].compared` (already in `verdict.json` and the report);
   - `heals`: the array from `verdict.heals` (step, from, to, rung, reason, validation), not only its length. Keep
     `healCount` as a separate number for the table;
   - `replans`: `milestoneKey`, `reason`, `rationale`, and old and new steps as the same one-line descriptions the
     report uses;
   - `rungHistogram` and `timings` from the verdict;
   - `prText` and `cacheDiff`: expose them from `runIntent`'s result in `run.ts` (the reporter already builds both
     for `report.md`) rather than parsing the markdown back.

   Renaming `heals` from a number to an array changes the shape `state.history` replays. The page is the only reader,
   so change both together.

4. **Recording known.** In `state`, add `recordedGoals`: the goals under `intents/` (from `knownIntentFor`'s loop).
   The composer can then warn before a run that a sentence needs the live model (section 6.2).

No other server behaviour changes: same routes, same origin check, same 127.0.0.1 binding, same body limit.

### 8.3 Event to UI mapping

| Event | Line | Gauges | Witnesses and plate | Log |
| --- | --- | --- | --- | --- |
| `run` (server) | clear, show "Starting" | reset | reset to "Waiting for the run to finish" | divider |
| `run_started` | | set limits | | line |
| `planned` | lay out sections | | | line |
| `milestone_started` | section occupied | | | line |
| `resolved` | add tick, move train | | | line |
| `healed` | tick turns amber, tooltip gets Was and Now | | | line |
| `heal_rejected` | red cross | | | line |
| `replanned` | draw bypass loop | | | line |
| `unresolved` | stop block | | | line |
| `action` | | actions and time | | line |
| `llm_call` | | model calls | | line |
| `terminal_attempted` | train at the diamond | | | line |
| `milestone_done` | cleared or dashed | | | line |
| `verdict` | light the lamp (section 9) | freeze | | |
| `result` (server) | | | fill witnesses and plate, add to Runs | |
| `error` (server) | | | | red line plus notice |

## 9. Motion

The interface moves when something changes because of the run or the person, and at no other time.

The one orchestrated moment is the lamp lighting. When `verdict` arrives:

1. The cleared track brightens from left to right, 40 ms per section, 300 ms at most in total.
2. The lamp warms up like a filament: opacity from 0 to 1 and a glow (`drop-shadow` in the lamp colour, 0 to 12 px)
   over 180 ms, `cubic-bezier(.2, .7, .3, 1)`.
3. The witness mark (`=` or `≠`) and the verdict plate appear at the same time as the lamp, without sliding.

Other motion, all of it triggered by the run or the person:

- The train marker moves to each new tick over 150 ms.
- A gauge fill eases over 200 ms.
- The detail sheet slides in over 220 ms and out over 160 ms.
- The `Copied` confirmation swaps in place.

No section entrances, no hover lift, no looping animation, no spinner. While waiting, the ticking run clock in the
status strip is the progress signal.

Under `prefers-reduced-motion: reduce`, every transition above is instant and the glow stays static.

The favicon is an SVG lamp, drawn as a data URI, that takes the latest verdict's colour (dark between runs). The tab
title follows the run: "Running, HackWave", then "Real bug, HackWave". Both help when the page is in a background
tab during a long run.

## 10. Accessibility

- Contrast: all text 4.5:1 or better on its surface, in both themes. Lamps sit next to a word, so their own contrast
  isn't the only carrier.
- The Line is one tab stop (`role="group"`, `aria-label="Route of this run"`). Left and right arrows move between
  ticks (roving `tabindex`), and each tick has an `aria-label` such as "cart-review.checkout, healed: button
  Checkout is now button Proceed to payment, model picked from candidates". The tooltip shows on focus as well as
  hover.
- An `aria-live="polite"` region announces milestone starts and the verdict ("Run finished: Real bug. The page said
  the order was confirmed, but the store has no new order."). The raw log is not live, since it would be too noisy.
- The version selector is a real radio group with arrow-key support. The detail sheet is `role="dialog"` with
  `aria-modal`, traps focus, and closes on Esc.
- Focus ring: 2 px `--ink` outline with a 2 px offset in `--board`, on every interactive element. Never removed.
- Touch targets are 44 px or more on phones.
- The page must pass the same axe scan the shop uses (`apps/shop/scripts/a11y.ts` shows the pattern) with zero
  serious or critical issues.

## 11. Building it

### 11.1 File layout

The page stays a string that `renderPage()` returns, with no build step. To keep it readable, split it into string
modules in `packages/engine/src/ui/`:

| File | Holds |
| --- | --- |
| `page.ts` | the HTML skeleton and `renderPage()`, which joins the parts below |
| `page-style.ts` | the CSS: tokens first, then components in the order of section 6 |
| `page-script.ts` | the client script: SSE handling, state, rendering |
| `page-line.ts` | the client code that draws and updates the Line SVG |

All client code is plain ES2020 inside template strings, as today. Ask the lead before introducing any tool to
type-check it.

### 11.2 Order of work

1. Tokens, type and the static layout with today's data (status strip, composer, version selector, Runs, log). Check it
   on 1440, 1024 and 390 px wide screens, in both themes.
2. Server changes 8.2.1 and 8.2.2, then the Line and the gauges driven by live events.
3. Server change 8.2.3, then the witnesses, the verdict plate and the detail sheet.
4. Guided demo strip and presenter view.
5. The lamp-lighting moment, the favicon and the tab title.
6. Optional: apply the tokens and the verdict plate to `html.ts` (report.html) and the demo index. Same markdown, new
   CSS only.

### 11.3 Checks

- `pnpm check` (lint, typecheck, unit tests). `ui/server.test.ts` must still pass unchanged. Add tests for `project()`
  (it drops unknown fields) and for the synthetic `planned` event on a cached plan.
- Once, at the end, with the shops up: `pnpm engine eval`. The UI work shouldn't change a verdict, and this proves
  it.
- By hand: `pnpm ui`, then the recorded goal on Version A, the guided demo end to end, a typed sentence with no key
  (the warning appears before the run), and a pull of the network cable (the disconnect message appears and clears).

### 11.4 Branching

Do this on its own branch off `main`, outside the demo-critical path, and merge it after the demo. The current page
works and is what the demo was rehearsed on.

## 12. Acceptance list

- [ ] No word "AI" in the interface. "Model" appears only as a cost or as the author of the likely cause.
- [ ] None of the visual bans in section 3 appear (check each one).
- [ ] The Line draws every milestone for a planner run, a cached run and a hand-written plan run.
- [ ] Act 2 on the Line shows the moved Add to cart, three amber model-pick ticks and one bypass loop on payment.
- [ ] Act 3 shows `≠` between the witnesses: the page's "Thanks! Order ORD-4821 is on its way" against "No new order".
- [ ] Act 4 shows only rung-1 ticks and "Model calls 0".
- [ ] The lamp lights only on the `verdict` event, never earlier.
- [ ] A Grey run leaves the lamp dark with the ring mark.
- [ ] Every element is reachable and usable by keyboard. Focus is always visible.
- [ ] Reduced motion makes every transition instant.
- [ ] No horizontal page scroll at 390 px. The Line is vertical there.
- [ ] axe: zero serious or critical issues, in both themes.
- [ ] The page works with the network unplugged on the recorded goal (no external requests at all).
- [ ] `pnpm check` is green and `pnpm engine eval` matches every expected verdict.
