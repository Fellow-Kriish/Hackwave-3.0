/**
 * The web app's one page: plain HTML, CSS and a small script, no build step and no dependencies. Every value from the
 * server is put on the page with textContent, never as HTML. Three screens: New test, Live run, Reports.
 */
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HackWave</title>
<style>
:root {
  --ink: #1F2B4D; --ink-2: #2B3A63; --ink-deep: #141C33;
  --label: #F5F6F8; --paper: #FFFFFF; --rule: #CDD2DC; --rule-strong: #9AA3B5;
  --ad: #F4C7C3; --ad-edge: #D99A95; --ad-ink: #6E2F2B;
  --stamp: #6B3FA0;
  --text: #1A2033; --muted: #555E72; --faint: #8A91A2;
  --green: #1E7B45; --amber: #A35F00; --red: #C8102E; --grey: #5F6675; --unverified: #6B3FA0;
  --log-text: #DCE3F2; --log-dim: #8C98B3; --log-info: #9CC4FF; --log-warn: #F2B65A; --log-bad: #FF8C8C; --log-good: #7FD69B;
  --sans: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "Cascadia Mono", Consolas, "SFMono-Regular", ui-monospace, monospace;
}
* { box-sizing: border-box; margin: 0; }
html { scrollbar-color: var(--ink) #E4E7EE; }
body { min-height: 100vh; background: var(--label); color: var(--text); font: 15px/1.5 var(--sans); caret-color: var(--ink); }
::selection { background: var(--ad); color: var(--ink); }
:focus-visible { outline: 3px solid var(--stamp); outline-offset: 2px; }
button, input, textarea, select { font: inherit; color: inherit; }
a { color: var(--ink); text-underline-offset: 3px; }
[hidden] { display: none !important; }

/* top navigation */
.top { position: sticky; top: 0; z-index: 5; height: 64px; background: var(--ink); color: #fff; display: flex; align-items: stretch; gap: 32px; padding: 0 32px; }
.mark { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 21px; letter-spacing: -0.01em; }
.mark i { width: 26px; height: 26px; border: 2.5px solid var(--ad); border-radius: 50%; position: relative; flex: none; }
.mark i::after { content: ""; position: absolute; inset: 6px 3px; border-top: 2.5px solid var(--ad); border-bottom: 2.5px solid var(--ad); }
.tabs { display: flex; }
.tabs button { white-space: nowrap; background: none; border: 0; border-bottom: 4px solid transparent; color: #C3CBE0; font-weight: 600; padding: 4px 20px 0; cursor: pointer; }
.tabs button:hover { color: #fff; }
.tabs button[aria-current="page"] { color: #fff; border-bottom-color: var(--ad); }
.tabs .count { display: inline-block; min-width: 20px; margin-left: 6px; padding: 0 6px; border-radius: 10px; background: var(--ad); color: var(--ink); font-size: 12px; font-weight: 700; text-align: center; }
.status { margin-left: auto; display: flex; gap: 28px; align-items: center; font-size: 12px; color: #B9C2DA; }
.status b { display: block; color: #fff; font-size: 14px; font-weight: 600; }
.status .busy b { color: var(--ad); }

/* modules: hairline-ruled, packed edge to edge, never floating cards */
.screen { min-height: calc(100vh - 64px); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 540px; min-height: calc(100vh - 64px); }
.col { border-right: 1px solid var(--rule); }
.mod { border-bottom: 1px solid var(--rule); padding: 24px 32px; }
.mod:last-child { border-bottom: 0; }
h1 { font-size: 26px; line-height: 1.2; color: var(--ink); font-weight: 800; letter-spacing: -0.01em; }
h2 { display: flex; align-items: center; gap: 12px; font-size: 19px; line-height: 1.25; color: var(--ink); font-weight: 800; margin-bottom: 14px; }
h2 .num { width: 28px; height: 28px; border: 2px solid var(--ink); border-radius: 50%; display: grid; place-items: center; font-size: 14px; font-weight: 800; flex: none; }
h3 { font-size: 15px; color: var(--ink); font-weight: 700; }
.hint { color: var(--muted); font-size: 13px; }

/* project cells */
.cells { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--rule); background: var(--paper); }
.cell { position: relative; display: block; padding: 14px 16px; border-right: 1px solid var(--rule); cursor: pointer; }
.cell:last-child { border-right: 0; }
.cell input { position: absolute; opacity: 0; pointer-events: none; }
.cell b { display: block; font-size: 15px; }
.cell small { display: block; color: var(--muted); font-size: 13px; }
.cell:hover { background: #F9FAFC; }
.cell:has(input:checked) { outline: 2px solid var(--ink); outline-offset: -2px; background: #F9FAFC; }
.cell:has(input:focus-visible) { outline: 3px solid var(--stamp); outline-offset: -3px; }
.cell:has(input:disabled) { background: #ECEEF2; color: var(--faint); cursor: not-allowed; }
.cell:has(input:disabled) small { color: var(--faint); }
.tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 0 6px; border: 1.5px solid currentColor; border-radius: 3px; margin-left: 6px; vertical-align: 2px; color: var(--unverified); }

/* version registration rows */
.vers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--rule); border-left: 1px solid var(--rule); }
.v { position: relative; display: grid; grid-template-columns: 64px minmax(0, 1fr) 40px; align-items: center; min-height: 92px; background: var(--paper); border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); cursor: pointer; }
.v::before { content: ""; position: absolute; left: 64px; top: 10px; bottom: 10px; border-left: 2px dashed var(--rule); }
.v input { position: absolute; opacity: 0; pointer-events: none; }
.v .code { font-size: 28px; font-weight: 800; color: var(--ink); text-align: center; }
.v .d { padding: 12px 16px; }
.v .d b { display: block; }
.v .d small { color: var(--muted); font-size: 13px; }
.box { width: 20px; height: 20px; border: 2px solid var(--ink); border-radius: 3px; justify-self: center; }
.v:hover { background: #F9FAFC; }
.v:has(input:checked) .box { background: var(--ink); box-shadow: inset 0 0 0 3px var(--paper); }
.v:has(input:focus-visible) { outline: 3px solid var(--stamp); outline-offset: -3px; }
.v:has(input:disabled) { opacity: 0.45; cursor: not-allowed; }
.preset { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
.order { margin-top: 14px; font-size: 14px; color: var(--muted); }
.order b { color: var(--ink); }

/* inputs and buttons */
.field { display: block; margin-top: 12px; }
.field span { display: block; font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 6px; }
input[type="text"], input[type="url"], textarea, select { width: 100%; background: var(--paper); border: 1.5px solid var(--rule-strong); border-radius: 2px; padding: 10px 12px; }
input[type="text"]:focus, input[type="url"]:focus, textarea:focus, select:focus { border-color: var(--ink); outline: none; box-shadow: 0 0 0 3px rgba(107, 63, 160, 0.25); }
textarea { min-height: 116px; resize: vertical; font-size: 17px; line-height: 1.45; }
.goal-label { display: block; font-size: 19px; font-weight: 800; color: var(--ink); margin-bottom: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.chip { background: var(--paper); border: 1px solid var(--rule-strong); border-radius: 2px; padding: 4px 10px; font-size: 13px; cursor: pointer; }
.chip:hover { border-color: var(--ink); }
.checks { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; font-size: 14px; color: var(--muted); }
.checks label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
.checks input { margin-top: 4px; accent-color: var(--ink); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 2px; font-weight: 700; padding: 12px 22px; cursor: pointer; text-decoration: none; border: 2px solid var(--ink); }
.btn.primary { background: var(--ink); color: #fff; font-size: 17px; padding: 14px 28px; }
.btn.primary:hover { background: var(--ink-2); border-color: var(--ink-2); }
.btn.quiet { background: transparent; color: var(--ink); }
.btn.quiet:hover { background: #E9ECF3; }
.btn.quiet[aria-pressed="true"] { background: var(--ink); color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.go { display: flex; align-items: center; gap: 16px; margin-top: 18px; flex-wrap: wrap; }
.notice { margin-top: 14px; padding: 10px 12px; border: 1px solid var(--red); background: #FDF1F2; color: #8C0B20; font-size: 14px; }
.unverified-note { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--unverified); background: #F4F0FA; color: #4A2A73; font-size: 14px; }

/* the acknowledgement card and its postmark */
.ad { position: relative; background: var(--ad); border: 1px solid var(--ad-edge); padding: 22px 22px 24px; }
.ad::before, .ad::after { content: ""; position: absolute; left: 0; right: 0; height: 8px; background: radial-gradient(circle at 6px 4px, var(--label) 3px, transparent 3.5px) 0 0 / 12px 8px repeat-x; }
.ad::before { top: -4px; } .ad::after { bottom: -4px; }
.ad-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px; min-height: 96px; }
.ad-head .who { flex: 1; min-width: 0; padding-top: 8px; }
.ad-head .code { display: block; font-size: 30px; font-weight: 800; color: var(--ink); line-height: 1; margin-bottom: 4px; }
.ad-head h3 { color: var(--ad-ink); font-size: 14px; }
.ad .line { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 10px; padding: 7px 0; border-bottom: 1.5px dotted #A9625D; font-size: 14px; }
.ad .line span { color: var(--ad-ink); }
.ad .sum { margin-top: 12px; font-size: 14px; }
.ad ul { margin: 8px 0 0; padding-left: 18px; font-size: 14px; }
.ad .why { margin-top: 10px; font-size: 13px; color: var(--ad-ink); }
.pm { position: relative; flex: none; width: 96px; height: 96px; border: 3px solid currentColor; border-radius: 50%; display: grid; place-items: center; text-align: center; transform: rotate(-12deg); font-weight: 800; opacity: 0.92; }
.pm::before { content: ""; position: absolute; inset: 7px; border: 1.5px solid currentColor; border-radius: 50%; }
.pm b { display: block; font-size: 22px; line-height: 1; }
.pm small { display: block; font-size: 9px; font-weight: 700; line-height: 1.3; margin-top: 3px; }
.pm.pending { color: var(--faint); border-style: dashed; }
.pm.stamping { animation: stamp 90ms steps(2, jump-end) both; }
@keyframes stamp { from { transform: rotate(-12deg) scale(1.6); opacity: 0.3; } to { transform: rotate(-12deg) scale(1); opacity: 0.92; } }
@media (prefers-reduced-motion: reduce) { .pm.stamping { animation: none; } }
.c-GREEN { color: var(--green); } .c-AMBER { color: var(--amber); } .c-RED { color: var(--red); } .c-GREY { color: var(--grey); } .c-UNVERIFIED { color: var(--unverified); }
.sample-note { margin-top: 10px; font-size: 12px; color: var(--muted); }
.cells-num { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--ad-edge); margin-top: 14px; }
.cells-num div { padding: 8px 10px 0 0; }
.cells-num span { display: block; font-size: 12px; color: var(--ad-ink); }
.cells-num b { font-size: 18px; font-variant-numeric: tabular-nums; color: var(--ink); }

/* live run */
.run-grid { display: grid; grid-template-columns: 340px minmax(0, 1fr); min-height: calc(100vh - 64px); }
.rail { border-right: 1px solid var(--rule); background: var(--paper); }
.rail .mod { padding: 20px 24px; }
.goal-quote { font-size: 16px; color: var(--ink); font-weight: 600; margin-top: 4px; }
.plan-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) 60px; align-items: center; min-height: 72px; border-bottom: 1px solid var(--rule); }
.plan-row .code { font-size: 22px; font-weight: 800; color: var(--ink); text-align: center; }
.plan-row small { display: block; color: var(--muted); font-size: 12px; }
.plan-row.now { background: #F3F5FA; }
.plan-row.now .code { color: var(--stamp); }
.mini { width: 48px; height: 48px; border: 2px solid currentColor; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 800; transform: rotate(-12deg); }
.mini.wait { color: var(--faint); border-style: dashed; }
.recent-row { display: flex; width: 100%; align-items: center; gap: 12px; padding: 10px 0; background: none; border: 0; border-bottom: 1px solid var(--rule); text-align: left; cursor: pointer; }
.recent-row:hover .recent-goal { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.recent-goal { flex: 1; min-width: 0; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-marks { display: flex; gap: 6px; }
.mini.small { width: 34px; height: 34px; font-size: 11px; transform: rotate(-8deg); }
.mini.stamping { animation: stamp 90ms steps(2, jump-end) both; }
@media (prefers-reduced-motion: reduce) { .mini.stamping { animation: none; } }
.log-wrap { display: flex; flex-direction: column; min-width: 0; }
.log-head { display: flex; align-items: center; gap: 16px; padding: 16px 28px; border-bottom: 1px solid var(--rule); flex-wrap: wrap; }
.log-head .now { font-size: 17px; font-weight: 700; color: var(--ink); }
.log-head .btn { margin-left: auto; }
#log { flex: 1; min-height: 420px; max-height: calc(100vh - 160px); overflow: auto; background: var(--ink-deep); color: var(--log-text); padding: 16px 20px; font: 13px/1.5 var(--mono); white-space: pre-wrap; word-break: break-word; scrollbar-color: #4A587F var(--ink-deep); }
#log .dim { color: var(--log-dim); } #log .info { color: var(--log-info); } #log .heading { color: #fff; font-weight: 700; }
#log .warn { color: var(--log-warn); } #log .bad { color: var(--log-bad); } #log .good { color: var(--log-good); }
#log .sep { color: var(--ad); font-weight: 700; margin-top: 10px; }
.empty { padding: 48px 32px; max-width: 640px; }
.empty p { color: var(--muted); margin: 8px 0 18px; }

/* reports */
.rep-head { display: flex; align-items: flex-end; gap: 24px; padding: 24px 32px; border-bottom: 1px solid var(--rule); flex-wrap: wrap; }
.rep-head .grow { flex: 1; min-width: 280px; }
.rep-head select { width: auto; min-width: 280px; }
.compare { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(340px, 1fr); overflow-x: auto; border-bottom: 1px solid var(--rule); scroll-snap-type: x mandatory; }
.compare > section { scroll-snap-align: start; border-right: 1px solid var(--rule); padding: 24px 24px 28px; min-width: 0; }
.compare > section:last-child { border-right: 0; }
.shots { margin-top: 18px; }
.shots h4 { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
.shot { display: block; border: 1px solid var(--rule); background: var(--paper); margin-bottom: 10px; text-decoration: none; color: var(--text); }
.shot img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-bottom: 1px solid var(--rule); background: #E9ECF3; }
.shot span { display: block; padding: 6px 10px; font-size: 12px; }
.shot.fail { border-color: var(--red); }
.links { margin-top: 12px; font-size: 14px; }
.steps-mod, .all-mod { padding: 24px 32px; border-bottom: 1px solid var(--rule); }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; background: var(--paper); border: 1px solid var(--rule); }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; background: #F0F2F6; }
tr.ms-row { cursor: pointer; }
tr.ms-row:hover { background: #F7F8FB; }
table.focused tr.ms-row { opacity: 0.35; }
table.focused tr.ms-row.on { opacity: 1; background: #F3F5FA; }
.ms-name { font-weight: 700; color: var(--ink); white-space: nowrap; }
.stepline { display: flex; align-items: center; gap: 8px; margin: 2px 0; }
.dot { flex: none; border-radius: 50%; background: var(--ink); }
.dot.r1 { width: 6px; height: 6px; } .dot.r2 { width: 9px; height: 9px; background: var(--stamp); } .dot.r3 { width: 12px; height: 12px; background: var(--amber); } .dot.r5 { width: 16px; height: 16px; background: var(--red); }
.legend { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0 14px; font-size: 13px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.verdict-cell { font-weight: 800; }
.muted { color: var(--muted); }

@media (max-width: 1100px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
  .col { border-right: 0; border-bottom: 1px solid var(--rule); }
  .run-grid { grid-template-columns: minmax(0, 1fr); }
  .rail { border-right: 0; border-bottom: 1px solid var(--rule); }
}
@media (max-width: 720px) {
  .top { gap: 8px; padding: 0 12px; }
  .mark { font-size: 0; gap: 0; }
  .tabs { flex: 1; justify-content: space-between; }
  .tabs button { padding: 4px 6px 0; font-size: 14px; }
  .status { display: none; }
  .tabs button { padding: 4px 10px 0; }
  .mod, .rep-head, .steps-mod, .all-mod { padding-left: 16px; padding-right: 16px; }
  .cells { grid-template-columns: minmax(0, 1fr); }
  .cell { border-right: 0; border-bottom: 1px solid var(--rule); }
  .vers { grid-template-columns: minmax(0, 1fr); }
  .compare { grid-auto-columns: minmax(300px, 88vw); }
  .ad .line { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .log-head { padding: 14px 16px; }
}
</style>
</head>
<body>
<header class="top">
  <span class="mark"><i aria-hidden="true"></i>HackWave</span>
  <nav class="tabs" aria-label="Screens">
    <button type="button" data-screen="new" aria-current="page">New test</button>
    <button type="button" data-screen="run">Live run</button>
    <button type="button" data-screen="reports">Reports<span class="count" id="reportCount" hidden></span></button>
  </nav>
  <div class="status" aria-live="polite">
    <span>Shop address<b id="sAddress">starting</b></span>
    <span>Model<b id="sModel">checking</b></span>
    <span id="sBusyWrap">Now<b id="sBusy">Idle</b></span>
  </div>
</header>

<main>
<!-- New test -->
<section class="screen" id="screen-new">
  <div class="grid">
    <div class="col">
      <div class="mod">
        <h2><span class="num">1</span>Project</h2>
        <div class="cells" role="radiogroup" aria-label="Project">
          <label class="cell"><input type="radio" name="project" value="shop" checked><b>HackWave demo shop</b><small>Checked against its order store</small></label>
          <label class="cell"><input type="radio" name="project" value="website"><b>Any website<span class="tag">UNVERIFIED</span></b><small>By address, in explore mode</small></label>
          <label class="cell"><input type="radio" name="project" value="upload" disabled><b>Upload a project</b><small>Coming later</small></label>
        </div>
      </div>
      <div class="mod" id="versionsMod">
        <h2><span class="num">2</span>Versions to test, in order</h2>
        <div class="vers" id="versions"></div>
        <div class="preset">
          <button type="button" class="btn quiet" id="guided" aria-pressed="false">Guided demo preset</button>
          <span class="hint">A from scratch, then B, then B with the backend bug, then B again</span>
        </div>
        <p class="order" id="order"></p>
      </div>
      <div class="mod" id="websiteMod" hidden>
        <h2><span class="num">2</span>Website</h2>
        <label class="field"><span>Address</span><input type="url" id="siteUrl" value="https://www.amazon.in/" autocomplete="url"></label>
        <label class="field"><span>Words it may type, if the goal needs any</span><input type="text" id="siteQuery" value="water bottle"></label>
        <p class="unverified-note">Explore mode carries out the goal on any site, but nothing checks the result against the site's data. Its result is UNVERIFIED, never a pass. It needs the live model.</p>
      </div>
      <div class="mod">
        <h2 id="adTitle">What comes back</h2>
        <p class="hint" style="margin:-6px 0 16px">Every run ends with an acknowledgement: what the page claimed, what the store holds, stamped by the verifier.</p>
        <div id="adSlot"></div>
      </div>
    </div>
    <div>
      <div class="mod">
        <h2><span class="num">3</span><label for="goal">Goal, in plain words</label></h2>
        <textarea id="goal" spellcheck="true"></textarea>
        <div class="chips" id="chips"></div>
        <div class="checks">
          <label><input type="checkbox" id="fresh"><span>Start from scratch: forget what it learned for this goal</span></label>
          <label><input type="checkbox" id="live"><span>Use the live model even for the recorded goal</span></label>
        </div>
        <div class="go">
          <button type="button" class="btn primary" id="runBtn">Run test</button>
          <span class="hint" id="estimate"></span>
        </div>
        <p class="notice" id="newNotice" hidden></p>
      </div>
      <div class="mod">
        <h2 id="recentTitle">Recent tests</h2>
        <div id="recent"></div>
      </div>
    </div>
  </div>
</section>

<!-- Live run -->
<section class="screen" id="screen-run" hidden>
  <div class="empty" id="runEmpty">
    <h1>No test running</h1>
    <p>Start one from New test. Its steps stream here while the browser window shows every click.</p>
    <button type="button" class="btn primary" data-screen="new">Go to New test</button>
  </div>
  <div class="run-grid" id="runBody" hidden>
    <aside class="rail">
      <div class="mod">
        <h3>This test</h3>
        <p class="goal-quote" id="runGoal"></p>
        <p class="hint" id="runTarget"></p>
      </div>
      <div id="planRows"></div>
    </aside>
    <div class="log-wrap">
      <div class="log-head">
        <span class="now" id="runNow" aria-live="polite"></span>
        <button type="button" class="btn primary" id="viewReport" data-screen="reports" hidden>View report</button>
      </div>
      <div id="log" role="log" aria-label="Run log"></div>
    </div>
  </div>
</section>

<!-- Reports -->
<section class="screen" id="screen-reports" hidden>
  <div class="empty" id="repEmpty">
    <h1>No reports yet</h1>
    <p>Run a test, and each version's acknowledgement lands here, side by side, with the screens where it changed or failed.</p>
    <button type="button" class="btn primary" data-screen="new">Go to New test</button>
  </div>
  <div id="repBody" hidden>
    <div class="rep-head">
      <div class="grow">
        <h1 id="repGoal"></h1>
        <p class="hint" id="repTarget"></p>
      </div>
      <label class="field" style="margin:0"><span>Test</span><select id="repPick"></select></label>
    </div>
    <div class="compare" id="compare"></div>
    <div class="steps-mod">
      <h2>Step by step</h2>
      <p class="hint">How each step's button or field was found in each version. Pick a row to bring it forward.</p>
      <div class="legend">
        <span><i class="dot r1"></i>Saved spot</span><span><i class="dot r2"></i>Matched by name</span><span><i class="dot r3"></i>Picked by the fast model</span><span><i class="dot r5"></i>Re-planned by the strong model</span>
      </div>
      <div class="scroll"><table id="stepsTable"></table></div>
    </div>
    <div class="all-mod">
      <h2>All runs</h2>
      <div class="scroll"><table id="allTable"></table></div>
    </div>
  </div>
</section>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const KIND = { passed: 'PASSED', ui_drift: 'HEALED', real_bug: 'REAL BUG', unresolvable: 'NO SAFE PATH', environment: 'NO VERDICT', incomplete: 'INCOMPLETE', explore: 'NOT CHECKED' };
  const WORD = { GREEN: 'GREEN', AMBER: 'AMBER', RED: 'RED', GREY: 'GREY', UNVERIFIED: 'UNVERIFIED' };
  const app = { server: null, batches: [], picked: null, focus: null, screen: 'new', guided: false, liveBatch: null, nowIndex: -1, nowMilestone: '', started: false };

  /* ---------- screens ---------- */
  const show = (name) => {
    app.screen = name;
    for (const id of ['new', 'run', 'reports']) $('screen-' + id).hidden = id !== name;
    for (const button of document.querySelectorAll('.tabs button')) {
      if (button.dataset.screen === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    if (name === 'reports') renderReports();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-screen]') : null;
    if (target) show(target.dataset.screen);
  });

  /* ---------- postmark and acknowledgement ---------- */
  const dateLine = (iso) => {
    const date = iso ? new Date(iso) : new Date();
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  };
  const postmark = (entry, stamping) => {
    const mark = el('div', 'pm c-' + entry.color + (stamping ? ' stamping' : ''));
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', 'Verdict ' + WORD[entry.color] + ', ' + (KIND[entry.kind] || entry.kind).toLowerCase());
    const inner = el('div');
    const word = el('b', null, entry.color === 'UNVERIFIED' ? '?' : WORD[entry.color]);
    const small = el('small');
    small.append(KIND[entry.kind] || entry.kind, el('br'), dateLine(entry.at));
    inner.append(word, small);
    mark.append(inner);
    return mark;
  };
  const line = (label, value) => {
    const row = el('div', 'line');
    row.append(el('span', null, label), el('div', null, value));
    return row;
  };
  const storeLine = (entry) => {
    const check = (entry.checks || []).find((c) => c.name === 'state');
    return check ? check.summary : 'not read';
  };
  const ackCard = (entry, stamping) => {
    const card = el('article', 'ad');
    const head = el('div', 'ad-head');
    const who = el('div', 'who');
    who.append(el('span', 'code', entry.code), el('h3', null, entry.name));
    head.append(who, postmark(entry, stamping));
    card.append(head);
    card.append(line('The page claimed', entry.claimed || 'No heading on the final page'));
    card.append(line('The store holds', entry.color === 'UNVERIFIED' ? 'Not checked: explore mode reads no data' : storeLine(entry)));
    card.append(line('Signed by', entry.color === 'UNVERIFIED' ? 'Nobody: no source of truth' : 'The verifier, plain code'));
    card.append(el('p', 'sum', entry.summary));
    if (entry.whatChanged && entry.whatChanged.length) {
      card.append(el('p', 'why', 'What changed in the app'));
      const list = el('ul');
      for (const item of entry.whatChanged) list.append(el('li', null, item));
      card.append(list);
    }
    if (entry.hypothesis) card.append(el('p', 'why', 'Likely cause: ' + entry.hypothesis));
    if (entry.healer) card.append(el('p', 'why', entry.healer));
    const nums = el('div', 'cells-num');
    const cell = (label, value) => { const c = el('div'); c.append(el('span', null, label), el('b', null, value)); return c; };
    nums.append(cell('Time', entry.seconds == null ? 'n/a' : entry.seconds + ' s'), cell('Heals', String(entry.heals)), cell('Re-plans', String(entry.replans)), cell(entry.llmCalls && entry.llmCached === entry.llmCalls ? 'Model calls, recorded' : 'Model calls', String(entry.llmCalls)));
    card.append(nums);
    return card;
  };
  const sampleCard = () => {
    const wrap = el('div');
    wrap.append(ackCard({ code: 'B1', name: 'Redesign with a backend bug', color: 'RED', kind: 'real_bug', at: null, claimed: 'Thanks! Order ORD-4821 is on its way', checks: [{ name: 'state', summary: 'expected 1 new record in orders, found 0' }], summary: 'The page said the order was confirmed, but the system of record has no new order.', whatChanged: [], hypothesis: null, healer: '', seconds: 13.6, heals: 0, replans: 0, llmCalls: 0, llmCached: 0 }, false));
    wrap.append(el('p', 'sample-note', 'Sample from a real run on version B1. Your results replace it.'));
    return wrap;
  };

  /* ---------- new test ---------- */
  const selected = () => Array.from(document.querySelectorAll('#versions input:checked')).map((input) => input.value);
  const project = () => document.querySelector('input[name="project"]:checked').value;
  const renderVersions = () => {
    const box = $('versions');
    box.replaceChildren();
    for (const [version, info] of Object.entries(app.server.versions)) {
      const row = el('label', 'v');
      const input = el('input');
      input.type = 'checkbox';
      input.value = version;
      input.checked = version !== 'v2-wrong-total';
      input.addEventListener('change', updatePlan);
      const d = el('span', 'd');
      d.append(el('b', null, info.name), el('small', null, info.detail));
      row.append(input, el('span', 'code', info.code), d, el('span', 'box'));
      box.append(row);
    }
  };
  const planCodes = () => {
    if (project() === 'website') return ['W'];
    if (app.guided) return app.server.guided.map((step) => step.code);
    return selected().map((version) => app.server.versions[version].code);
  };
  const updatePlan = () => {
    const site = project() === 'website';
    $('versionsMod').hidden = site;
    $('websiteMod').hidden = !site;
    for (const input of document.querySelectorAll('#versions input')) input.disabled = app.guided;
    $('guided').setAttribute('aria-pressed', String(app.guided));
    const codes = planCodes();
    $('order').replaceChildren();
    if (!site) {
      $('order').append('Runs, in order: ');
      $('order').append(el('b', null, codes.length ? codes.join(', then ') : 'none picked'));
    }
    const runs = codes.length;
    $('runBtn').textContent = site ? 'Explore the website' : runs === 1 ? 'Run test on 1 version' : 'Run test on ' + runs + ' versions';
    $('runBtn').disabled = runs === 0 || (app.server && app.server.busy);
    $('estimate').textContent = site ? 'About a minute, live model' : runs ? 'About ' + runs * 15 + ' seconds' : 'Pick at least one version';
  };
  for (const radio of document.querySelectorAll('input[name="project"]')) radio.addEventListener('change', updatePlan);
  $('guided').addEventListener('click', () => { app.guided = !app.guided; updatePlan(); });
  const notice = (text) => { $('newNotice').textContent = text || ''; $('newNotice').hidden = !text; };
  $('runBtn').addEventListener('click', async () => {
    notice('');
    const site = project() === 'website';
    const body = site
      ? { project: 'website', goal: $('goal').value, url: $('siteUrl').value, query: $('siteQuery').value, fresh: $('fresh').checked }
      : { project: 'shop', goal: $('goal').value, versions: selected(), guided: app.guided, fresh: $('fresh').checked || app.guided, live: $('live').checked };
    $('runBtn').disabled = true;
    $('runBtn').textContent = 'Starting';
    try {
      const response = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) notice((await response.json()).error || 'The server refused the test (HTTP ' + response.status + ').');
    } catch {
      notice('The HackWave server did not answer. Is pnpm ui still running?');
    }
    updatePlan();
  });

  /* ---------- live run ---------- */
  const log = $('log');
  const addLine = (text, tone) => {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(el('div', tone || 'plain', text || ' '));
    while (log.childElementCount > 4000) log.firstElementChild.remove();
    if (near) log.scrollTop = log.scrollHeight;
  };
  const renderPlan = () => {
    const batch = app.liveBatch;
    const rows = $('planRows');
    rows.replaceChildren();
    if (!batch) return;
    batch.plan.forEach((planned, index) => {
      const entry = batch.runs[index];
      const row = el('div', 'plan-row' + (index === app.nowIndex && !entry ? ' now' : ''));
      const text = el('div');
      text.append(el('b', null, planned.name));
      text.append(el('small', null, entry ? entry.summary.split('.')[0] : index === app.nowIndex ? (app.nowMilestone ? 'Now: ' + app.nowMilestone : 'Starting') : 'Waiting'));
      const mark = entry ? el('span', 'mini c-' + entry.color, entry.color === 'UNVERIFIED' ? '?' : WORD[entry.color]) : el('span', 'mini wait', index === app.nowIndex ? 'NOW' : '');
      row.append(el('span', 'code', planned.code), text, mark);
      rows.append(row);
    });
  };
  const setNow = () => {
    const batch = app.liveBatch;
    if (!batch) return;
    if (batch.done) {
      const colors = batch.runs.map((entry) => entry.code + ' ' + WORD[entry.color]);
      $('runNow').textContent = batch.error ? 'Stopped: ' + batch.error : 'Done. ' + colors.join(', ');
      $('viewReport').hidden = batch.runs.length === 0;
    } else {
      const planned = batch.plan[app.nowIndex];
      $('runNow').textContent = planned ? 'Running ' + planned.code + ': ' + planned.name + (app.nowMilestone ? ', ' + app.nowMilestone : '') : 'Starting';
      $('viewReport').hidden = true;
    }
  };

  /* ---------- reports ---------- */
  const shotLink = (url, caption, fail) => {
    const link = el('a', 'shot' + (fail ? ' fail' : ''));
    link.href = url; link.target = '_blank'; link.rel = 'noopener';
    const img = el('img');
    img.src = url; img.alt = caption; img.loading = 'lazy';
    link.append(img, el('span', null, caption));
    return link;
  };
  const renderReports = () => {
    const runsTotal = app.batches.reduce((sum, batch) => sum + batch.runs.length, 0);
    $('reportCount').hidden = runsTotal === 0;
    $('reportCount').textContent = String(runsTotal);
    if (app.screen !== 'reports') return;
    const withRuns = app.batches.filter((batch) => batch.runs.length > 0);
    $('repEmpty').hidden = withRuns.length > 0;
    $('repBody').hidden = withRuns.length === 0;
    if (!withRuns.length) return;
    if (!withRuns.some((batch) => batch.id === app.picked)) app.picked = withRuns[0].id;
    const pick = $('repPick');
    pick.replaceChildren();
    withRuns.forEach((batch, index) => {
      const option = el('option', null, 'Test ' + (withRuns.length - index) + ': ' + batch.runs.map((entry) => entry.code).join(', ') + ' (' + new Date(batch.startedAt).toLocaleTimeString() + ')');
      option.value = batch.id;
      option.selected = batch.id === app.picked;
      pick.append(option);
    });
    const batch = withRuns.find((item) => item.id === app.picked);
    $('repGoal').textContent = batch.goal;
    $('repTarget').textContent = batch.project === 'website' ? 'Explored at ' + batch.target + ', unverified' : 'Demo shop at ' + batch.target + ', one address, redeployed for each version';
    const compare = $('compare');
    compare.replaceChildren();
    for (const entry of batch.runs) {
      const column = el('section');
      column.append(ackCard(entry, false));
      const shots = el('div', 'shots');
      shots.append(el('h4', null, entry.shots.length ? 'Screens at each change or failure' : 'No changes or failures: one screen'));
      for (const shot of entry.shots) shots.append(shotLink(shot.url, shot.caption, shot.kind === 'unresolved' || shot.kind === 'stopped'));
      if (entry.finalShot) shots.append(shotLink(entry.finalShot, 'Final screen' + (entry.color === 'RED' ? ': where the page claimed success' : ''), entry.color === 'RED'));
      column.append(shots);
      const links = el('p', 'links');
      const report = el('a', null, 'Full report');
      report.href = entry.reportUrl; report.target = '_blank'; report.rel = 'noopener';
      links.append(report);
      column.append(links);
      compare.append(column);
    }
    renderSteps(batch);
    renderAll();
  };
  const renderSteps = (batch) => {
    const table = $('stepsTable');
    table.replaceChildren();
    const order = [];
    for (const entry of batch.runs) for (const key of entry.steps.map((step) => step.milestone).concat(entry.skipped)) if (!order.includes(key)) order.push(key);
    const head = el('tr');
    head.append(el('th', null, 'Stage'));
    for (const entry of batch.runs) head.append(el('th', null, entry.code + ': ' + entry.name));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    for (const key of order) {
      const row = el('tr', 'ms-row' + (app.focus === key ? ' on' : ''));
      row.tabIndex = 0;
      row.setAttribute('aria-selected', String(app.focus === key));
      const toggle = () => { app.focus = app.focus === key ? null : key; renderSteps(batch); };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
      row.append(el('td', 'ms-name', key));
      for (const entry of batch.runs) {
        const cell = el('td');
        const steps = entry.steps.filter((step) => step.milestone === key);
        if (entry.skipped.includes(key) && !steps.length) cell.append(el('span', 'muted', 'Already done, skipped'));
        else if (!steps.length) cell.append(el('span', 'muted', 'Not reached'));
        for (const step of steps) {
          const stepLine = el('div', 'stepline');
          stepLine.append(el('i', 'dot r' + (step.rung >= 5 ? 5 : step.rung)), el('span', null, step.action + ' ' + step.target + (step.planned ? ' (planned ' + step.planned + ')' : '')));
          cell.append(stepLine);
        }
        row.append(cell);
      }
      tbody.append(row);
    }
    table.className = app.focus ? 'focused' : '';
    table.append(thead, tbody);
  };
  const renderAll = () => {
    const table = $('allTable');
    table.replaceChildren();
    const head = el('tr');
    for (const name of ['Test', 'Version', 'Verdict', 'Summary', 'Time', 'Heals', 'Re-plans', 'Model calls', 'Report']) head.append(el('th', null, name));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    const withRuns = app.batches.filter((batch) => batch.runs.length > 0);
    withRuns.forEach((batch, index) => {
      for (const entry of batch.runs) {
        const row = el('tr');
        const verdict = el('td', 'verdict-cell c-' + entry.color, WORD[entry.color]);
        const report = el('td');
        const link = el('a', null, 'Open');
        link.href = entry.reportUrl; link.target = '_blank'; link.rel = 'noopener';
        report.append(link);
        row.append(el('td', null, 'Test ' + (withRuns.length - index)), el('td', null, entry.code + ': ' + entry.name), verdict, el('td', null, entry.summary), el('td', null, entry.seconds == null ? 'n/a' : entry.seconds + ' s'), el('td', null, String(entry.heals)), el('td', null, String(entry.replans)), el('td', null, String(entry.llmCalls)), report);
        tbody.append(row);
      }
    });
    table.append(thead, tbody);
  };
  $('repPick').addEventListener('change', (event) => { app.picked = event.target.value; app.focus = null; renderReports(); });

  /* ---------- server state and stream ---------- */
  const applyStatus = () => {
    const server = app.server;
    $('sAddress').textContent = server.address.replace('http://', '');
    $('sModel').textContent = server.liveAvailable ? 'Live, or recordings' : 'Recordings only';
    $('sBusy').textContent = server.busy ? 'Test running' : 'Idle';
    $('sBusyWrap').className = server.busy ? 'busy' : '';
    updatePlan();
  };
  const renderAdSlot = () => {
    const latest = app.batches.find((batch) => batch.runs.length > 0);
    $('adSlot').replaceChildren(latest ? ackCard(latest.runs[latest.runs.length - 1], false) : sampleCard());
    $('adTitle').textContent = latest ? 'The latest acknowledgement' : 'What comes back';
    const recent = $('recent');
    recent.replaceChildren();
    const done = app.batches.filter((batch) => batch.runs.length > 0);
    if (!done.length) { recent.append(el('p', 'hint', 'No tests yet. Each test you run is listed here with its verdicts.')); return; }
    done.slice(0, 6).forEach((batch, index) => {
      const row = el('button', 'recent-row');
      row.type = 'button';
      const text = el('span', 'recent-goal', 'Test ' + (done.length - index) + ': ' + batch.goal);
      const marks = el('span', 'recent-marks');
      for (const entry of batch.runs) marks.append(el('span', 'mini small c-' + entry.color, entry.code));
      row.append(text, marks);
      row.addEventListener('click', () => { app.picked = batch.id; app.focus = null; show('reports'); });
      recent.append(row);
    });
  };
  const firstState = (server) => {
    $('goal').value = server.defaultGoal;
    const chips = $('chips');
    [server.defaultGoal].concat(server.examples).forEach((text, index) => {
      const chip = el('button', 'chip', index === 0 ? 'Recorded goal, runs offline' : text);
      chip.type = 'button';
      chip.title = text;
      chip.addEventListener('click', () => { $('goal').value = text; $('goal').focus(); });
      chips.append(chip);
    });
    renderVersions();
    app.batches = server.batches;
    const live = app.batches.find((batch) => !batch.done);
    if (live) { app.liveBatch = live; app.nowIndex = live.runs.length; }
    const hash = location.hash.replace('#', '');
    if (['new', 'run', 'reports'].includes(hash)) show(hash);
  };
  const handle = (message) => {
    if (message.type === 'state') {
      const first = !app.server;
      app.server = message;
      if (first) firstState(message); else app.batches = message.batches;
      // The server's copy is the truth: keep the live screen pointing at the same test inside it.
      if (app.liveBatch) app.liveBatch = app.batches.find((batch) => batch.id === app.liveBatch.id) || app.liveBatch;
      applyStatus();
      renderAdSlot();
      renderReports();
      return;
    }
    if (!app.server) return;
    if (message.type === 'busy') { app.server.busy = message.busy; applyStatus(); return; }
    if (message.type === 'batch') {
      if (!app.batches.some((batch) => batch.id === message.batch.id)) app.batches.unshift(message.batch);
      app.liveBatch = app.batches.find((batch) => batch.id === message.batch.id);
      app.nowIndex = 0; app.nowMilestone = '';
      log.replaceChildren();
      $('runEmpty').hidden = true; $('runBody').hidden = false;
      $('runGoal').textContent = message.batch.goal;
      $('runTarget').textContent = message.batch.project === 'website' ? 'Website: ' + message.batch.target + ' (unverified)' : 'Demo shop at ' + message.batch.target;
      renderPlan(); setNow();
      show('run');
      return;
    }
    if (message.type === 'run') {
      app.nowIndex = message.index; app.nowMilestone = '';
      addLine('', 'plain');
      addLine('Version ' + message.code + ': ' + message.name + '  (model ' + (message.mode === 'replay' ? 'from recordings' : 'live') + (message.fresh ? ', from scratch' : '') + ')', 'sep');
      for (const note of message.notes || []) addLine(note, 'dim');
      renderPlan(); setNow();
      return;
    }
    if (message.type === 'milestone') { app.nowMilestone = message.key; renderPlan(); setNow(); return; }
    if (message.type === 'line') { addLine(message.text, message.tone); return; }
    if (message.type === 'result') {
      const batch = app.batches.find((item) => item.id === message.batchId);
      if (batch && !batch.runs.some((entry) => entry.index === message.entry.index && entry.at === message.entry.at)) batch.runs.push(message.entry);
      renderPlan(); setNow(); renderAdSlot(); renderReports();
      const fresh = document.querySelectorAll('#planRows .mini')[message.entry.index];
      if (fresh) fresh.classList.add('stamping');
      const slotMark = document.querySelector('#adSlot .pm');
      if (slotMark) { slotMark.classList.remove('stamping'); void slotMark.offsetWidth; slotMark.classList.add('stamping'); }
      return;
    }
    if (message.type === 'batch_done') {
      const batch = app.batches.find((item) => item.id === message.batchId);
      if (batch) { batch.done = true; batch.error = message.error; app.picked = batch.id; }
      setNow(); renderReports();
      return;
    }
    if (message.type === 'error') {
      addLine('Stopped: ' + message.message, 'bad');
      if (message.hint) addLine(message.hint, 'warn');
      notice(message.hint || message.message);
    }
  };
  const connect = () => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => handle(JSON.parse(event.data));
    events.onerror = () => { $('sBusy').textContent = 'Server lost'; };
  };
  window.addEventListener('hashchange', () => { const hash = location.hash.replace('#', ''); if (['new', 'run', 'reports'].includes(hash) && hash !== app.screen) show(hash); });
  connect();
})();
</script>
</body>
</html>`;
}
