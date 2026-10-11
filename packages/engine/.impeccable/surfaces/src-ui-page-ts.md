---
version: 1
slug: "src-ui-page-ts"
primary_target: "src/ui/page.ts"
related_targets: ["src/ui/server.ts"]
---

# Surface brief: HackWave web app (`pnpm ui`)

Scope: the whole web app page served by `src/ui/server.ts` (`src/ui/page.ts`). Mode: Operate.

Audience and job: the hackathon mentor and judges, on a projector or laptop, driven by a presenter. Pick a project and one
or more versions, type a goal, run it, watch it live, then compare the versions and read every result.

Structure (user's wireframe, confirmed): three screens under a top nav, New test, Live run, Reports. Live run opens by
itself when a test starts and shows the engine's own log lines until the run ends, then "View report". Reports compares
the versions side by side with screenshots at each change or failure, and lists every run so far below.

Confirmed product answers: projects are the HackWave demo shop (verified) and any website by address (explore mode,
UNVERIFIED); upload shows as "coming later", disabled. Several versions can be picked; the goal runs on each in order at
one address. The guided demo becomes a preset (A, B, B with the backend bug, B again).

Constraints: no framework, build step, CDN or new dependency (until the demo); `textContent` only; keep the label
`Goal, in plain words`; never restyle `apps/shop`; never change an AI cache key.

## Direction contract

THESIS: The page says "delivered"; only the signed acknowledgement card proves it, and the verifier is the one who signs.
Refuses the dark neon dev dashboard and the soft card-grid SaaS form.

OWN-WORLD: India Post registered mail. Postal-ink navy rail (#1F2B4D) over cool registered-label white, AD-card pink for
acknowledgements, violet stamp ink for marks, India Post red reserved for the RED verdict only. Hairline-ruled modules
packed edge to edge, perforated edges on the acknowledgement card, dotted form lines, version codes set like
registration numbers, circular postmarks for verdicts. System sans; monospace only for the engine log and locators.

STORY: The judge sees what is being tested and on which versions, watches each step, then sees each version's
acknowledgement: what the page claimed against what the store holds, stamped by the verifier, with screenshots where it
changed or failed.

FIRST VIEWPORT: Navy top nav (mark, New test, Live run, Reports, shop address and model state at right). Left two thirds:
Step 1 project as three ruled cells; Step 2 versions as a 2 x 2 grid of registration rows with checkboxes. Right third:
Step 3 goal textarea, preset chips, primary "Run test on N versions"; below it a sample acknowledgement card with a RED
postmark.

FORM: Registered Post, Acknowledgement Due; candidate 5 of 7 on my ordered list; seed key a0ea0472. Raises: hairline
modules, no floating cards (high-density web); no easing, verdict lands as a two-frame 90 ms stamp (acetate manual);
only the next decision in full (airport wayfinding); one fixed cost ramp, rung 1 to rung 5 dot sizes (star atlas); a
focused step brought forward across all version columns, the rest quieted (streaming wall). Signature interaction: the
verdict postmark stamping onto each version's acknowledgement card when the verifier decides.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
