# HackWave web app: what exists today (design handoff)

This is an inventory of the web app as built, for a redesign: every screen, every element and its copy, every state,
and every piece of data the page can show. Design freely on top of it. Anything listed under "Must stay" is a hard
constraint; everything else (layout, colour, type, wording) is yours to change.

Start it with `pnpm ui` (opens http://localhost:4321). Code: `packages/engine/src/ui/page.ts` (the page) and
`packages/engine/src/ui/server.ts` (the data it gets).

## Must stay

- **One self-contained page.** No framework, build step, CDN or web font downloaded at runtime: the demo runs offline
  on the presenter's laptop. A font file shipped beside the page is possible, but the team lead approves it first.
- **The label `Goal, in plain words`** on the goal box, word for word (a test checks it).
- **Verdict names and meanings** (never rename or recolour one into another):
  - **GREEN** = passed.
  - **AMBER** = passed, but the app had changed and the test healed itself.
  - **RED** = a real bug (the page said success, the data says no) or no safe way forward.
  - **GREY** = no verdict, the environment failed.
  - **UNVERIFIED** = explore mode on another website, never a pass.
- **Red means RED only.** Don't use red as a brand or decoration colour.
- **No AI hype.** The product's point is that AI does *not* decide pass or fail. No sparkles, robots, "AI-powered",
  "magic". Where the model was used, say "model calls" and give the number.
- **The demo shop is not part of the redesign.** It is the app being tested, opened in a separate browser window
  (`apps/shop`); restyling it breaks the recorded demo.

## Global

### Top bar (on every screen)
- **Logo:** a drawn ring mark plus the word **HackWave**.
- **Tabs:** `New test` · `Live run` · `Reports` (Reports shows a count badge with the number of runs so far).
  - The current tab is underlined.
  - The address bar follows the tab: `#new`, `#run`, `#reports`.
- **Status, right side** (hidden on phones):
  - `Shop address`: e.g. `localhost:57958`.
  - `Model`: `Live, or recordings` when an API key exists, otherwise `Recordings only`.
  - `Now`: `Idle`, `Test running`, or `Server lost` if the connection drops.

### Behaviour
- **One test at a time.** The Run button is disabled while one runs.
- **Live run opens by itself** when a test starts.
- **A real browser window opens too,** showing every click. Design for a presenter who looks at both.

## Screen 1: New test

Three numbered steps. In the current build, steps 1 and 2 and the sample card sit in a left column; step 3 and
Recent tests sit in a right column.

### Step 1: Project
Three options, one selected at a time:

| Option | Subtext | Notes |
|---|---|---|
| HackWave demo shop | Checked against its order store | Default |
| Any website (badge `UNVERIFIED`) | By address, in explore mode | Swaps step 2 for the Website step |
| Upload a project | Coming later | Disabled, not built |

### Step 2: Versions to test, in order (demo shop only)
Four tickable versions, each with a short code, a name and a one-line description:

| Code | Name | Description | Ticked by default |
|---|---|---|---|
| A | The original | Cart, checkout, shipping, payment, place order | yes |
| B | The redesign | Buttons renamed, a phone field added, payment on its own screen | yes |
| B1 | Redesign with a backend bug | Says the order is confirmed, saves nothing | yes |
| B2 | Redesign with a pricing bug | Saves the order at the wrong total | no |

- **Guided demo preset button,** with the hint "A from scratch, then B, then B with the backend bug, then B again".
  - It toggles: when on, the checkboxes are disabled and the run order becomes A, B, B1, B.
- **Run order line:** "Runs, in order: **A, then B, then B1**", or "none picked".

### Step 2 (alternative): Website (when "Any website" is chosen)
- **Address field:** default `https://www.amazon.in/`.
- **"Words it may type, if the goal needs any" field:** default `water bottle`.
- **Note:** "Explore mode carries out the goal on any site, but nothing checks the result against the site's data. Its
  result is UNVERIFIED, never a pass. It needs the live model."

### Step 3: Goal, in plain words
- **Text box:** prefilled with the recorded goal "As a shopper, buy the Trail Runner shoes with a valid credit card and
  reach order confirmation."
- **Quick-fill chips:**
  - `Recorded goal, runs offline`: fills the recorded goal. It replays saved model answers, so it needs no internet.
  - `Complete checkout with a valid credit card`: a new sentence, so it uses the live model.
  - `Buy the City Sneaker and pay by credit card`: a new sentence, so it uses the live model.
- **Two checkboxes:**
  - "Start from scratch: forget what it learned for this goal".
  - "Use the live model even for the recorded goal".
- **Primary button.** Its label follows the choice:
  - `Run test on 1 version` or `Run test on N versions`.
  - `Explore the website` for a website.
  - `Starting` while the request is sent.
- **Estimate next to it:**
  - "About N seconds" (15 s per run).
  - "About a minute, live model" for a website.
  - "Pick at least one version" when none is ticked.
- **Error box** (hidden until needed). It shows refusals in plain words, e.g. "write the goal as one sentence (10 to
  300 characters)", "pick at least one version", "give the website address, e.g. https://www.example.com", or "a test
  is already running".

### Acknowledgement panel
- **Title:** "What comes back" before any run; "The latest acknowledgement" after one.
- **Sub-line:** "Every run ends with an acknowledgement: what the page claimed, what the store holds, stamped by the
  verifier."
- **Before any run:** a **sample card** (a real B1 RED result), labelled "Sample from a real run on version B1. Your
  results replace it."
- **After a run:** the newest run's acknowledgement card (see the card anatomy below).

### Recent tests
- Up to 6 past tests, each as one row: "Test N: <goal>" plus a small verdict mark per version (code inside, coloured by
  verdict).
- Clicking a row opens that test in Reports.
- **Empty state:** "No tests yet. Each test you run is listed here with its verdicts."

## Screen 2: Live run

- **Empty state:** "No test running" / "Start one from New test. Its steps stream here while the browser window shows
  every click." with a button `Go to New test`.

### Left rail: This test
- **The goal,** quoted.
- **The target:** "Demo shop at http://localhost:NNNN", or "Website: <url> (unverified)".
- **One row per planned run, in order:** the code (A, B, B1…) plus the run's name, a status line and a round mark.
  - **Waiting:** dashed empty circle.
  - **Running:** the row is highlighted, the circle reads `NOW`, and the status reads "Now: payment" (the current
    stage).
  - **Done:** the circle is stamped with the verdict word in its colour, and the status shows the first sentence of
    the summary.

### Main area
- **Header line:**
  - while running: "Running B1: Version B with the backend bug, payment";
  - at the end: "Done. A GREEN, B AMBER, B1 RED, B GREEN", or "Stopped: <reason>".
- **`View report` button:** appears when the test ends.
- **The log:** a dark terminal-style panel streaming the engine's own lines.
  - Lines keep their engine wording; they are code-like text and can stay monospace.
  - Each line has a tone: plain, dim, info, heading, warn, bad, good.
  - A separator line marks each version: "Version B: Version B at the same address (model from recordings)".
  - It follows the newest line unless you scroll up.
- **Example lines:**
  ```
  ▸ cart  Add Trail Runner shoes to the cart and open the cart.
    [rung 1] resolved cart.add via rung 1: click button "Add to cart" in article "Trail Runner" (127 ms)
    [rung 3] resolved place-order.submit via rung 3: click button "Pay ₹1,299" (planned button "Place order")
    healed place-order.submit: button "Place order" became button "Pay ₹1,299", rung 3, validated unique, visible
  verifier: state fail: expected 1 new record(s) in orders, found 0 after waiting 5000 ms (baseline 0)
  ```
- **When something fails:** "Stopped: <message>", plus a hint line, e.g. "A new sentence or a website is planned by the
  live model: put LLM_API_KEY in .env, or use the recorded goal…".

## Screen 3: Reports

- **Empty state:** "No reports yet" / "Run a test, and each version's acknowledgement lands here, side by side, with the
  screens where it changed or failed." plus `Go to New test`.

### Header
- **The goal** as the page heading.
- **A context line:** "Demo shop at http://localhost:NNNN, one address, redeployed for each version", or "Explored at
  <url>, unverified".
- **A `Test` picker:** one entry per past test, e.g. "Test 2: A, B, B1, B (22:41:29)".

### Comparison: one column per run, side by side
Columns are horizontally scrollable when there are many; each column snaps into place.

**Acknowledgement card anatomy (used here and on New test):**
- **Header:**
  - the version code, big (A, B, B1, B2, or W for a website);
  - the run name (e.g. "Version B at the same address");
  - a **round postmark** in the verdict colour, containing the verdict word, a kind line and the date, e.g.
    `RED / REAL BUG / 11 OCT 2026`.
  - Kind lines: PASSED, HEALED, REAL BUG, NO SAFE PATH, NO VERDICT, INCOMPLETE, NOT CHECKED.
  - The postmark "stamps" in when a result arrives (a 90 ms two-step snap, no easing; off when reduced motion is set).
- **Three label/value rows:**
  - **The page claimed:** the final page's heading, e.g. "Thanks! Order ORD-4821 is on its way", or "No heading on
    the final page".
  - **The store holds:** the data check, e.g. "1 new record 4821 in orders; items [Trail Runner], total 1299,
    cardLast4 4242 match" or "expected 1 new record(s) in orders, found 0…". For a website: "Not checked: explore
    mode reads no data".
  - **Signed by:** "The verifier, plain code", or for a website "Nobody: no source of truth".
- **Summary sentence,** e.g. "Passed on the system of record after the UI changed: 4 heal(s) and 1 re-plan(s)…".
- **AMBER only, "What changed in the app":** a bulleted list. Real example from version B:
  - The button "Add to cart" moved to another part of the page (from main to region "New arrivals").
  - The button "Cart (…)" is now called "Your bag".
  - The button "Checkout" is now called "Proceed to payment".
  - The button "Place order" is now called "Pay ₹1,299".
  - The page now asks for a new field, textbox "Phone" (filled from shipping.phone).
  - The payment part of the flow had to be rebuilt from the goal: …
- **RED real bug only, "Likely cause":** a paragraph written by the model *after* the verdict. It is narration, not
  part of the verdict.
- **The healer's own belief,** e.g. "healer believed done at step 14 (place-order.submit)". Showing this next to the
  verifier's verdict is the core story: the healer thought it was done, the verifier disagreed.
- **Numbers row:**
  - Time (e.g. 11.6 s);
  - Heals;
  - Re-plans;
  - Model calls (the label becomes "Model calls, recorded" when all came from recordings).

**Under each card:**
- **Screens at each change or failure:** one screenshot per event, each with a caption, opening full size on click.
  Example captions:
  - "Found button "Your bag" instead of button "Cart ({n})" (rung 3)"
  - "Re-planned payment: Payment fields are on the next screen…"
  - "Could not find …"
  - "Stopped: …"
- **With no events:** the title reads "No changes or failures: one screen".
- **Final screen:** always shown. On RED it is labelled "Final screen: where the page claimed success" and drawn as a
  failure.
- **A `Full report` link:** opens the run's report.html.

### Step by step table
- **Intro line:** "How each step's button or field was found in each version. Pick a row to bring it forward."
- **Layout:** one row per stage (cart, checkout, shipping, payment, place-order) and one column per run.
- **Each cell lists the steps:** a dot plus "click button "Proceed to payment" (planned button "Checkout")".
  - A stage that was already done reads "Already done, skipped"; a stage the run never got to reads "Not reached".
- **Dot size and colour encode how the control was found** (the cost ramp, with a legend):

  | Dot | Meaning |
  |---|---|
  | Small, navy | Rung 1: saved spot |
  | Medium, violet | Rung 2: matched by name |
  | Larger, amber | Rung 3: picked by the fast model |
  | Largest, red | Rung 5: re-planned by the strong model |

- **Clicking a row** (or pressing Enter) focuses it and dims the others; clicking again clears it.

### All runs table
Every run across every test.

| Column | Contents |
|---|---|
| Test | Test number |
| Version | Code and name |
| Verdict | Coloured word |
| Summary | The summary sentence |
| Time | Seconds |
| Heals | Count |
| Re-plans | Count |
| Model calls | Count |
| Report | An `Open` link |

## Data the page receives (what a design can use)

Live stream at `GET /api/events` (Server-Sent Events) and a snapshot at `GET /api/state`.

- **`state`:**
  - `address`, `deployed` / `deployedCode` (which shop version is up), `busy`, `liveAvailable`;
  - `defaultGoal`, `examples`, `versions` (code, name, detail), `guided` (the four preset steps, each with a title and
    a sentence to say);
  - `batches` (every test so far).
- **`batch`:** a test started: `id`, `goal`, `project` (shop or website), `target`, `guided`, `plan` (code, name,
  version per run).
- **`run`:** one run starting: index, code, name, mode (`replay` = recordings, `live`), `fresh`, notes.
- **`milestone`:** the stage now running (cart, checkout, shipping, payment, place-order).
- **`line`:** one log line plus its tone.
- **`result`:** one run finished, with:
  - verdict: `color`, `kind`, `summary`, `whatChanged[]`, `healer`, `claimed`, `checks[]` (state, binding, alerts,
    each with status and summary);
  - numbers: `heals`, `replans`, `llmCalls`, `llmCached`, `seconds`;
  - narration: `hypothesis`;
  - steps: `steps[]` (stage, step, rung, action, target, planned), `skipped[]`;
  - screens and links: `shots[]` (url, caption, kind: healed, replanned, unresolved or stopped), `finalShot`,
    `reportUrl`, `at`.
- **`batch_done`:** the test ended (with an error, if any).
- **`busy`, `error`:** an error carries a message and an optional hint.

Not available today, so don't design around it without asking: per-run video, a live picture of the browser inside
the page, user accounts, uploading a project, history after the server restarts (tests live in memory only).

## Current look (for reference only, yours to replace)

- **Direction "Registered Post, Acknowledgement Due":** the page claims "delivered", and only the signed acknowledgement
  card proves it.
- **Colours:** postal-ink navy `#1F2B4D` (top bar, primary button), cool label white `#F5F6F8` ground, AD-card pink
  `#F4C7C3` (acknowledgement cards), violet stamp ink `#6B3FA0` (focus rings, UNVERIFIED).
- **Verdict colours:** GREEN `#1E7B45`, AMBER `#A35F00`, RED `#C8102E`, GREY `#5F6675`.
- **Type:** system sans (Segoe UI on Windows); monospace only in the log.
- **Layout and motion:**
  - hairline-ruled modules packed edge to edge, no floating cards;
  - perforated edges on cards;
  - one motion: the stamp.
- **Breakpoints:** two columns become one below 1100 px; phone layout below 720 px (status hidden, steps stacked,
  comparison cards about 88% of the screen width each).
