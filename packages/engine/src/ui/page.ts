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
/* HackWave: restrained signal-box styling. System fonts; no runtime assets. */
:root {
  --ink: #20352b; --ink-2: #344d3e; --ink-deep: #17291f;
  --label: #e9ede6; --paper: #f7f9f4; --rule: #c1cbc0; --rule-strong: #99a998;
  --ad: #f7f9f4; --ad-edge: #c1cbc0; --ad-ink: #53634f;
  --stamp: #496780; --text: #203029; --muted: #586751; --faint: #687764;
  --green: #17663b; --amber: #895900; --red: #aa2924; --grey: #626d63; --unverified: #496780;
  --log-text: #e1eadb; --log-dim: #a7b8a1; --log-info: #b4cbd9;
  --log-warn: #f0c577; --log-bad: #ffaaa0; --log-good: #9ed8a7;
}
body { font-size: 14px; }
::selection { background: #ccd8c5; }
:focus-visible { outline: 2px solid var(--stamp); outline-offset: 4px; }
.top { background: var(--label); color: var(--ink); height: 80px; border-bottom: 1px solid var(--rule); padding: 0 max(28px, calc((100% - 1280px)/2)); gap: 48px; position: relative; }
.mark { font-size: 25px; font-weight: 700; letter-spacing: -1px; }
.mark i { border: 5px solid var(--ink); width: 28px; height: 28px; }
.mark i::after { border: 0; inset: auto; width: 8px; height: 8px; background: var(--label); border: 2px solid var(--ink); border-radius: 50%; right: -7px; bottom: 0; }
.tabs { gap: 28px; }
.tabs button { padding: 0; font-size: 13px; font-weight: 500; color: var(--muted); border-bottom-width: 2px; }
.tabs button:hover { color: var(--ink); }
.tabs button[aria-current="page"] { color: var(--ink); border-color: var(--ink); font-weight: 600; }
.tabs .count { background: #d5dfce; color: var(--ink); border-radius: 3px; font-size: 10px; min-width: 18px; padding: 1px 4px; }
.status { gap: 24px; color: var(--muted); font-size: 10px; }
.status b { color: var(--ink); font-size: 12px; font-weight: 500; margin-top: 4px; }
.status .busy b { color: var(--ink); }
main { max-width: 1280px; margin: auto; padding: 0 28px; }
.screen { min-height: calc(100vh - 80px); }
.workspace-intro { display: flex; justify-content: space-between; gap: 32px; align-items: flex-end; padding: 40px 0 32px; }
.workspace-intro h1 { font-size: 48px; line-height: 1.08; font-weight: 600; letter-spacing: -1.8px; }
.workspace-intro p { font-size: 14px; margin-top: 14px; color: var(--muted); }
.intro-note { max-width: 220px; padding-left: 20px; border-left: 1px solid var(--rule); font-size: 12px; color: var(--muted); line-height: 1.7; }
.preview-banner { border: 1px solid var(--rule); background: #e1e8db; padding: 10px 16px; color: var(--muted); font-size: 11px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px; }
.preview-banner b { color: var(--ink); font-weight: 600; }
.grid { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 36px; min-height: 0; }
.col { border: 0; }
.mod { padding: 0; margin-bottom: 28px; border: 0; }
h2 { font-size: 19px; font-weight: 600; letter-spacing: -.4px; margin-bottom: 16px; gap: 10px; }
h2 .num { width: 26px; height: 26px; border: 1px solid var(--rule-strong); font-size: 12px; font-weight: 500; }
h3 { font-weight: 600; }
.hint { font-size: 11px; line-height: 1.7; }
.cells { gap: 8px; border: 0; background: transparent; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cell { border: 1px solid var(--rule); border-radius: 2px; padding: 18px 12px 14px; min-height: 106px; }
.cell:last-child { border-right: 1px solid var(--rule); }
.cell::before { content: ""; display: block; width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--rule-strong); margin-bottom: 12px; }
.cell:has(input:checked) { outline: 1px solid var(--ink); outline-offset: -1px; background: var(--paper); }
.cell:has(input:checked)::before { background: var(--ink); box-shadow: inset 0 0 0 3px var(--paper); }
.cell b { font-size: 12px; font-weight: 600; }
.cell small { font-size: 10px; line-height: 1.5; margin-top: 4px; }
.cell:hover { background: var(--paper); }
.cell:has(input:disabled) { background: transparent; color: var(--faint); opacity: .65; }
.tag { font-size: 8px; margin: 4px 0 0; padding: 1px 4px; border-width: 1px; vertical-align: middle; }
.vers { grid-template-columns: 1fr; border: 0; border-top: 1px solid var(--rule); }
.v { grid-template-columns: 48px minmax(0,1fr) 28px; min-height: 76px; background: transparent; border-right: 0; }
.v::before { display: none; }
.v .code { font-size: 21px; font-weight: 600; text-align: left; padding-left: 4px; }
.v .d { padding: 14px 0; }
.v .d b { font-size: 13px; font-weight: 500; }
.v .d small { font-size: 11px; line-height: 1.5; display: block; margin-top: 5px; }
.box { width: 15px; height: 15px; border-width: 1px; border-radius: 3px; }
.v:hover { background: var(--paper); }
.v:has(input:checked) .box { box-shadow: inset 0 0 0 2px var(--label); }
.preset { gap: 12px; margin-top: 16px; flex-wrap: nowrap; }
.preset .hint { font-size: 10px; }
.preset .btn { font-size: 11px; white-space: nowrap; padding: 8px 12px; }
.order { font-size: 11px; margin-top: 12px; }
.order b { font-weight: 500; }
.goal-module { border: 1px solid var(--rule); background: var(--paper); border-radius: 2px; padding: 24px; }
.goal-module h2 { font-size: 15px; margin-bottom: 20px; }
input[type="text"], input[type="url"], textarea, select { border-width: 1px; border-radius: 4px; background: transparent; }
input[type="text"]:focus, input[type="url"]:focus, textarea:focus, select:focus { box-shadow: none; outline: 2px solid var(--stamp); outline-offset: 3px; }
textarea { font-size: 23px; font-weight: 400; line-height: 1.4; min-height: 160px; letter-spacing: -.5px; padding: 12px; }
.chips { gap: 6px; margin-top: 12px; }
.chip { font-size: 10px; padding: 5px 8px; border-radius: 2px; border-color: var(--rule); background: transparent; }
.chip:first-child { background: #e4ebdd; }
.checks { margin-top: 20px; gap: 12px; font-size: 11px; }
.checks input { width: 13px; height: 13px; margin-top: 2px; }
.btn { border-width: 1px; border-radius: 4px; font-size: 12px; padding: 10px 16px; font-weight: 600; }
.btn.primary { font-size: 13px; padding: 13px 16px; }
.btn.quiet:hover { background: #dde6d7; }
.go { border-top: 1px solid var(--rule); padding-top: 20px; margin-top: 20px; flex-wrap: nowrap; }
.go .primary { flex: 1; }
.go .hint { font-size: 10px; }
.notice { background: var(--paper); border-color: var(--rule); border-left: 3px solid var(--red); font-size: 12px; color: var(--red); }
.unverified-note { color: var(--muted); background: var(--paper); border: 0; border-left: 2px solid var(--unverified); font-size: 12px; }
.ad { padding: 22px; border: 1px solid var(--rule); border-top: 3px solid var(--grey); border-radius: 2px; }
.ad:has(.c-RED) { border-top-color: var(--red); }
.ad:has(.c-GREEN) { border-top-color: var(--green); }
.ad:has(.c-AMBER) { border-top-color: var(--amber); }
.ad:has(.c-UNVERIFIED) { border-top-color: var(--unverified); }
.ad::before, .ad::after { display: none; }
.ad-head { min-height: 76px; align-items: center; margin-bottom: 16px; }
.ad-head .who { padding: 0; }
.ad-head .code { font-size: 38px; font-weight: 600; letter-spacing: -1px; }
.ad-head h3 { font-size: 11px; font-weight: 400; margin-top: 6px; color: var(--muted); }
.pm { width: 76px; height: 76px; border-width: 2px; transform: rotate(-8deg); }
.pm::before { display: none; }
.pm b { font-size: 16px; font-weight: 700; }
.pm small { font-size: 8px; line-height: 1.5; }
.ad .line { grid-template-columns: 104px minmax(0,1fr); padding: 12px 0; border-bottom: 1px solid var(--rule); font-size: 12px; gap: 12px; }
.ad .line span { font-size: 10px; color: var(--muted); }
.ad .line div { font-size: 13px; font-weight: 500; line-height: 1.6; overflow-wrap: anywhere; }
.ad .sum { font-size: 14px; margin-top: 16px; line-height: 1.6; }
.details-block { border-top: 1px solid var(--rule); margin-top: 16px; padding-top: 12px; }
.details-block summary { cursor: pointer; font-size: 12px; font-weight: 600; }
.ad .why { font-size: 11px; color: var(--muted); line-height: 1.6; }
.ad ul { font-size: 11px; line-height: 1.7; color: var(--muted); }
.cells-num { border-color: var(--rule); margin-top: 16px; }
.cells-num div { padding-top: 12px; }
.cells-num span { font-size: 9px; color: var(--muted); }
.cells-num b { font-size: 18px; font-weight: 600; }
.sample-note { font-size: 10px; }
.recent-row { padding: 16px 0; }
.recent-goal { font-size: 12px; }
.mini.small { width: 24px; height: 24px; font-size: 9px; border-width: 1px; transform: none; }
.run-grid { grid-template-columns: 264px minmax(0,1fr); gap: 32px; min-height: 0; margin-top: 32px; }
.rail { background: transparent; padding-right: 24px; }
.rail .mod { padding: 0; }
.goal-quote { font-size: 18px; line-height: 1.5; font-weight: 400; margin: 16px 0 12px; }
.plan-row { grid-template-columns: 30px minmax(0,1fr) 40px; gap: 8px; padding: 16px 0; }
.plan-row .code { font-size: 16px; text-align: left; }
.plan-row b { font-size: 12px; font-weight: 500; }
.plan-row small { font-size: 10px; line-height: 1.5; margin-top: 6px; }
.plan-row.now { background: #dce5d5; padding: 16px 8px; margin: 0 -8px; }
.plan-row.now .code { color: var(--ink); }
.mini { width: 36px; height: 36px; border-width: 1px; font-size: 8px; transform: none; }
.log-head { padding: 0 0 16px; border: 0; }
.log-head .now { font-size: 16px; font-weight: 500; }
#log { border-radius: 2px; min-height: 340px; max-height: 540px; font-size: 11px; line-height: 1.85; padding: 20px; }
#log .sep { color: #d9e5ce; border-top: 1px solid #486044; padding-top: 12px; }
.signal-line { background: #263d2c; box-shadow: inset 0 2px 5px #142117; border-radius: 8px; padding: 20px 24px 24px; color: #f2f5e9; margin-bottom: 20px; }
.signal-caption { display: flex; justify-content: space-between; gap: 16px; font-size: 10px; color: #c6d4bc; }
.signal-track { display: flex; margin-top: 28px; }
.signal-section { flex: 1; padding-top: 24px; position: relative; font-size: 11px; }
.signal-section::before { content: ""; position: absolute; height: 3px; top: 8px; left: 0; right: 0; background: #81957c; }
.signal-section::after { content: ""; position: absolute; height: 15px; width: 2px; top: 2px; left: 40%; background: #81957c; }
.signal-section.lit::before, .signal-section.lit::after { background: #f2f5e9; }
.signal-section.current::after { width: 10px; height: 10px; border-radius: 50%; top: 5px; }
.signal-section small { font-size: 9px; display: block; color: #b5c5aa; margin-bottom: 4px; }
.signal-result { width: 54px; text-align: center; margin-left: 8px; font-size: 9px; }
.signal-lamp { width: 34px; height: 34px; background: #4e6447; border: 5px solid #17281b; border-radius: 50%; margin: -7px auto 8px; display: grid; place-items: center; font-size: 17px; font-weight: 700; color: #fff; }
.signal-lamp.c-GREEN { background: #23864c; }.signal-lamp.c-AMBER { background: #e7a82e; color: #263d2c; }.signal-lamp.c-RED { background: #d84339; }.signal-lamp.c-GREY { background: #798378; }
.rep-head { padding: 36px 0 28px; border: 0; }
.rep-head h1 { font-size: 30px; font-weight: 500; letter-spacing: -.9px; line-height: 1.3; }
.rep-head .hint { margin-top: 12px; }
.rep-head .field span { font-size: 11px; }
.rep-head select { min-width: 220px; font-size: 12px; }
.compare { gap: 20px; border: 0; grid-auto-columns: minmax(320px,1fr); padding-bottom: 16px; }
.compare>section { padding: 0; border: 0; }
.shots h4 { font-size: 11px; font-weight: 500; }
.shot { border-radius: 2px; }
.shot span { font-size: 10px; padding: 8px 12px; }
.links { font-size: 12px; }
.steps-mod, .all-mod { padding: 28px 0; border-color: var(--rule); }
.legend { font-size: 10px; gap: 20px; margin-top: 16px; }
.dot.r2 { background: #747e8e; }.dot.r3 { background: #88714a; }.dot.r5 { background: #3f5c45; }
table { font-size: 11px; border: 0; background: transparent; }
th { font-size: 10px; font-weight: 500; background: transparent; padding: 12px; }
td { padding: 14px 12px; }
th:first-child,td:first-child { padding-left: 0; }
tr.ms-row:hover,table.focused tr.ms-row.on { background: var(--paper); }
.empty { max-width: 520px; margin: auto; text-align: center; padding: 96px 16px; }
.empty h1 { font-size: 32px; font-weight: 500; letter-spacing: -1px; }
.empty p { font-size: 13px; margin: 16px 0 24px; }
.workspace-footer { padding: 20px 0 28px; border-top: 1px solid var(--rule); margin-top: 28px; display: flex; justify-content: space-between; gap: 20px; font-size: 10px; color: var(--muted); }
@media(max-width:1100px) {
  .top { gap: 28px; padding: 0 24px; }.status { gap: 16px; }.status>span:first-child { display: none; }
  .grid { grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: 24px; }.col { border: 0; }
  .cells { grid-template-columns: 1fr; }.cell { min-height: 0; padding: 12px; }.cell::before { float: left; margin: 4px 12px 0 0; }.cell small { margin-left: 24px; }.tag { margin: 0 0 0 6px; }
  .run-grid { grid-template-columns: 220px minmax(0,1fr); gap: 24px; }.rail { border-right: 1px solid var(--rule); border-bottom: 0; }
}
@media(max-width:720px) {
  .top { height: 68px; gap: 20px; padding: 0 16px; }.mark { font-size: 19px; letter-spacing: -.8px; gap: 8px; }.mark i { width: 22px; height: 22px; border-width: 4px; }
  .tabs { gap: 16px; margin-left: auto; justify-content: normal; flex: none; }.tabs button { font-size: 11px; padding: 0; }.tabs .count { font-size: 9px; min-width: 14px; margin-left: 3px; }
  main { padding: 0 16px; }.workspace-intro { padding: 28px 0 24px; }.workspace-intro h1 { font-size: 36px; letter-spacing: -1.2px; }.workspace-intro p { font-size: 12px; max-width: 300px; }.intro-note { display: none; }
  .preview-banner { display: block; font-size: 10px; padding: 10px 12px; }.preview-banner b { display: block; margin-bottom: 3px; }
  .grid { display: flex; flex-direction: column; gap: 0; }.grid>.col,.grid>div { display: contents; }
  .project-module { order: 1; }#versionsMod,#websiteMod { order: 2; }.goal-module { order: 3; }.ack-module { order: 4; }.recent-module { order: 5; }
  .mod { padding: 0; margin-bottom: 24px; }.goal-module { padding: 20px; }textarea { min-height: 152px; font-size: 21px; }.goal-module h2 { font-size: 14px; }
  .cell small { font-size: 10px; }.v { min-height: 76px; }.preset { gap: 10px; }.preset .hint { font-size: 10px; }.go .primary { min-height: 44px; font-size: 12px; padding: 12px 8px; }.go .hint { max-width: 88px; }
  .ad { padding: 20px; }.ad .line { grid-template-columns: 86px minmax(0,1fr); gap: 8px; }.ad .line div { font-size: 12px; }.pm { width: 72px; height: 72px; }
  .run-grid { grid-template-columns: 1fr; margin-top: 24px; }.rail { border: 0; padding: 0; }.rail .mod { padding: 0; }.goal-quote { font-size: 17px; }
  #planRows { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 8px; }.plan-row { flex: 0 0 180px; border: 1px solid var(--rule); padding: 12px; grid-template-columns: 24px 1fr 30px; gap: 4px; }.plan-row.now { padding: 12px; margin: 0; }.plan-row b { font-size: 10px; }.mini { width: 28px; height: 28px; font-size: 7px; }
  .log-head .now { font-size: 13px; }.log-head { padding: 0 0 12px; gap: 12px; }#log { min-height: 280px; font-size: 10px; padding: 16px; }
  .signal-line { padding: 16px; }.signal-caption { font-size: 9px; }.signal-section { font-size: 9px; }.signal-result { width: 34px; font-size: 8px; }.signal-lamp { width: 28px; height: 28px; border-width: 4px; }
  .rep-head { padding: 28px 0 24px; }.rep-head .grow { min-width: 0; width: 100%; }.rep-head h1 { font-size: 25px; }.rep-head .field { width: 100%; }.rep-head select { width: 100%; min-width: 0; }
  .compare { grid-auto-columns: 88%; gap: 12px; }.compare>section { padding: 0; }.steps-mod,.all-mod { padding: 24px 0; }.scroll { max-width: 100%; }.scroll table { min-width: 640px; }
  .workspace-footer { font-size: 9px; }.workspace-footer span:last-child { display: none; }
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
<p class="notice" id="connectionNotice" role="alert" hidden></p>
<!-- New test -->
<section class="screen" id="screen-new">
<div class="workspace-intro"><div><h1>A goal in. The truth out.</h1><p>Tests that adapt to your website. Verdicts that answer to your data.</p></div><div class="intro-note">The browser follows the goal.<br>The verifier checks what was saved.<br>Only the evidence decides the verdict.</div></div>
  <div class="grid">
    <div class="col">
      <div class="mod">
        <h2><span class="num">1</span>Project</h2>
        <div class="cells" role="radiogroup" aria-label="Project">
          <label class="cell"><input type="radio" name="project" value="shop" checked><b>HackWave demo shop</b><small>Checked against its order store</small></label>
          <label class="cell"><input type="radio" name="project" value="shopsphere"><b>ShopSphere store</b><small>Checked against its browser storage</small></label>
          <label class="cell"><input type="radio" name="project" value="harbor-pine"><b>Harbor &amp; Pine hotel</b><small>Checked against its browser storage</small></label>
          <label class="cell"><input type="radio" name="project" value="website"><b>Any website<span class="tag">UNVERIFIED</span></b><small>By address, in explore mode</small></label>
          <label class="cell"><input type="radio" name="project" value="upload" disabled><b>Upload a project</b><small>Coming later</small></label>
        </div>
      </div>
      <div class="mod" id="versionsMod">
        <h2><span class="num">2</span>Versions to test, in order</h2>
        <div class="vers" id="versions"></div>
        <div class="preset" id="presetRow">
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
        <p class="hint" style="margin:-6px 0 16px">The verifier uses plain code to check persisted data, order-ID binding and page alerts. The model cannot decide pass or fail.</p>
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
          <label id="liveRow"><input type="checkbox" id="live"><span>Use the live model even for the recorded goal</span></label>
        </div>
        <div class="go">
          <button type="button" class="btn primary" id="runBtn" disabled>Connecting to engine</button>
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
<footer class="workspace-footer"><span>HackWave / Intent-based testing. Evidence-based verdicts.</span><span>One address. Real browser. Independent verifier.</span></footer>
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
  const app = { server: null, batches: [], picked: null, focus: null, screen: 'new', guided: false, liveBatch: null, nowIndex: -1, nowMilestone: '', started: false, connected: false, progress: new Map(), events: null };

  document.querySelector('#screen-new .col > .mod').classList.add('project-module');
  $('adTitle').closest('.mod').classList.add('ack-module');
  $('goal').closest('.mod').classList.add('goal-module');
  $('recent').closest('.mod').classList.add('recent-module');
  const signal = el('div', 'signal-line');
  document.querySelector('.log-head').after(signal);
  const drawSignal = () => {
    const batch = app.liveBatch;
    if (!batch) return;
    signal.replaceChildren();
    const caption = el('div', 'signal-caption');
    caption.append(el('span', null, 'Browser milestones'), el('span', null, batch.error ? 'Test stopped; see the evidence' : batch.done ? 'Verifier result received' : 'Verdict waits for the verifier'));
    const track = el('div', 'signal-track');
    const entry = batch.runs[app.nowIndex];
    const observed = app.progress.get(batch.startedAt + ':' + app.nowIndex) || new Set();
    const recorded = (entry?.steps || []).map(step => step.milestone);
    const skipped = entry?.skipped || [];
    const stages = batch.project !== 'shop' ? [...new Set([...observed, ...recorded, ...skipped])] : ['cart', 'checkout', 'shipping', 'payment', 'place-order'];
    const now = stages.findIndex(stage => app.nowMilestone === stage || app.nowMilestone.startsWith(stage + '.'));
    if (!stages.length) track.append(el('span', 'signal-caption', batch.project === 'website' ? 'Waiting for the website’s milestones' : 'Waiting for the plan’s milestones'));
    stages.forEach((stage, index) => {
      const matches = key => key === stage || key.startsWith(stage + '.');
      const reached = recorded.some(matches) || [...observed].some(matches);
      const part = el('div', 'signal-section' + (reached ? ' lit' : '') + (index === now && !entry && !batch.done ? ' current' : ''));
      part.append(el('small', null, String(index + 1).padStart(2, '0')), el('span', null, batch.project !== 'shop' ? stage.replace(/-/g, ' ') : ['Cart','Checkout','Shipping','Payment','Place order'][index]));
      if (skipped.some(matches)) part.append(el('small', null, 'Skipped'));
      track.append(part);
    });
    const end = el('div', 'signal-result');
    const outcome = entry || (batch.done && !batch.error ? batch.runs[batch.runs.length - 1] : null);
    end.append(el('div', 'signal-lamp' + (outcome ? ' c-' + outcome.color : ''), outcome ? outcome.color === 'GREEN' ? '✓' : outcome.color === 'AMBER' ? '!' : outcome.color === 'RED' ? '−' : '–' : '–'), el('span', null, outcome ? outcome.color : batch.error ? 'No result' : 'Waiting'));
    track.append(end); signal.append(caption, track);
  };
  new MutationObserver(drawSignal).observe($('runNow'), { childList: true });
  /* ---------- screens ---------- */
  const show = (name) => {
    app.screen = name;
    for (const id of ['new', 'run', 'reports']) $('screen-' + id).hidden = id !== name;
    for (const button of document.querySelectorAll('.tabs button')) {
      if (button.dataset.screen === name) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    if (name === 'reports') renderReports();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    try { if (window.parent !== window) window.parent.history.replaceState(null, '', '#' + name); } catch {}
    drawSignal();
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
    return check ? check.summary : 'Not read';
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
    for (const check of entry.checks || []) {
      if (check.name === 'state') continue;
      card.append(line(check.name === 'binding' ? 'Page binding' : check.name === 'alerts' ? 'Page alerts' : check.name, check.status + ': ' + check.summary));
    }
    card.append(line('Signed by', entry.color === 'UNVERIFIED' ? 'Nobody: no source of truth' : 'The verifier, plain code'));
    card.append(el('p', 'sum', entry.summary));
    if (entry.whatChanged && entry.whatChanged.length) {
      card.append(el('p', 'why', 'What changed in the app'));
      const list = el('ul');
      for (const item of entry.whatChanged) list.append(el('li', null, item));
      card.append(list);
    }
    if (entry.hypothesis) { card.append(el('p', 'why', 'Likely cause: ' + entry.hypothesis)); card.append(el('p', 'why', 'Written by the model after the verdict. It cannot change the verdict.')); }
    if (entry.healer) card.append(el('p', 'why', entry.healer));
    const nums = el('div', 'cells-num');
    const cell = (label, value) => { const c = el('div'); c.append(el('span', null, label), el('b', null, value)); return c; };
    nums.append(cell('Time', entry.seconds == null ? 'n/a' : entry.seconds + ' s'), cell('Heals', String(entry.heals)), cell('Re-plans', String(entry.replans)), cell(entry.llmCalls && entry.llmCached === entry.llmCalls ? 'Model calls, recorded' : 'Model calls', String(entry.llmCalls)));
    card.append(nums);
    if (entry.phases || entry.providerAttempts !== undefined) {
      const details = el('details', 'details-block');
      details.append(el('summary', null, 'Timing and model accounting'));
      if (entry.phases) {
        for (const [label, key] of [['Execution', 'executionMs'], ['Verification', 'verificationMs'], ['Explanation', 'explanationMs'], ['End to end', 'totalMs']]) {
          const value = entry.phases[key];
          if (typeof value === 'number') details.append(line(label, (value / 1000).toFixed(1) + ' s'));
        }
      }
      if (typeof entry.providerAttempts === 'number') details.append(line('Provider attempts', entry.providerAttempts));
      details.append(el('p', 'why', 'Model calls count logical adapter requests, including recordings and narration. Provider attempts count actual network requests, including retries.'));
      card.append(details);
    }
    return card;
  };
  const stoppedCard = (batch) => {
    const card = el('article', 'ad');
    card.append(el('h3', null, batch.error ? batch.runs.length ? 'Stopped before the remaining runs finished' : 'Stopped before a verifier result' : 'Waiting for a verifier result'));
    card.append(el('p', 'sum', batch.error || 'The test is running. No verdict has arrived.'));
    card.append(line('Verdict', 'Not produced. This is not a pass.'));
    card.append(line('Signed by', 'Nobody: the verifier returned no result.'));
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
  // The server's description of a project (the demo shop or a demo site); websites have none.
  const projectInfo = (id) => (app.server?.projects || []).find((item) => item.id === id) || null;
  const renderVersions = () => {
    const box = $('versions');
    box.replaceChildren();
    const info0 = projectInfo(project()) || projectInfo('shop');
    const versions = info0 ? info0.versions : app.server.versions;
    for (const [version, info] of Object.entries(versions)) {
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
  const renderChips = () => {
    const info = projectInfo(project()) || projectInfo('shop');
    const chips = $('chips');
    chips.replaceChildren();
    const goals = info ? [info.defaultGoal].concat(info.examples || []) : [app.server.defaultGoal].concat(app.server.examples);
    goals.forEach((text, index) => {
      const chip = el('button', 'chip', index === 0 && project() === 'shop' ? 'Recorded goal, runs offline' : text);
      chip.type = 'button';
      chip.title = text;
      chip.addEventListener('click', () => { $('goal').value = text; $('goal').focus(); });
      chips.append(chip);
    });
  };
  const planCodes = () => {
    if (project() === 'website') return ['W'];
    if (app.guided && project() === 'shop') return app.server.guided.map((step) => step.code);
    const info = projectInfo(project());
    const versions = info ? info.versions : app.server.versions;
    return selected().map((version) => versions[version].code);
  };
  const updatePlan = () => {
    const site = project() === 'website';
    const demoSite = project() === 'shopsphere' || project() === 'harbor-pine';
    $('versionsMod').hidden = site;
    $('websiteMod').hidden = !site;
    // The guided preset and the recordings belong to the demo shop; the demo sites always use the live model.
    $('presetRow').hidden = project() !== 'shop';
    $('liveRow').hidden = project() !== 'shop';
    if (project() !== 'shop') app.guided = false;
    for (const input of document.querySelectorAll('#versions input')) input.disabled = app.guided;
    $('guided').setAttribute('aria-pressed', String(app.guided));
    const codes = planCodes();
    $('order').replaceChildren();
    if (!site) {
      $('order').append('Runs, in order: ');
      $('order').append(el('b', null, codes.length ? codes.join(', then ') : 'none picked'));
    }
    const runs = codes.length;
    $('runBtn').textContent = app.started ? 'Starting' : site ? 'Explore the website' : runs === 1 ? 'Run test on 1 version' : 'Run test on ' + runs + ' versions';
    $('runBtn').disabled = !app.connected || app.started || runs === 0 || (app.server && app.server.busy);
    $('estimate').textContent = site ? 'About a minute, live model' : !runs ? 'Pick at least one version' : demoSite ? 'About ' + runs * 25 + ' seconds, live model' : 'About ' + runs * 15 + ' seconds';
  };
  let lastProject = 'shop';
  for (const radio of document.querySelectorAll('input[name="project"]')) {
    radio.addEventListener('change', () => {
      // A goal still set to the previous project's default follows the switch; anything typed stays.
      const before = projectInfo(lastProject);
      const after = projectInfo(project());
      if (after && (!$('goal').value.trim() || (before && $('goal').value === before.defaultGoal))) $('goal').value = after.defaultGoal;
      lastProject = project();
      if (after) { renderVersions(); renderChips(); }
      updatePlan();
    });
  }
  $('guided').addEventListener('click', () => { app.guided = !app.guided; updatePlan(); });
  const notice = (text) => { $('newNotice').textContent = text || ''; $('newNotice').hidden = !text; };
  $('runBtn').addEventListener('click', async () => {
    if (!app.connected || app.started || app.server?.busy) return;
    app.started = true;
    notice('');
    const site = project() === 'website';
    const body = site
      ? { project: 'website', goal: $('goal').value, url: $('siteUrl').value, query: $('siteQuery').value, fresh: $('fresh').checked }
      : project() === 'shop'
        ? { project: 'shop', goal: $('goal').value, versions: selected(), guided: app.guided, fresh: $('fresh').checked || app.guided, live: $('live').checked }
        : { project: project(), goal: $('goal').value, versions: selected(), fresh: $('fresh').checked };
    $('runBtn').disabled = true;
    $('runBtn').textContent = 'Starting';
    try {
      const response = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        app.started = false;
        notice((await response.json()).error || 'The server refused the test (HTTP ' + response.status + ').');
      }
    } catch {
      app.started = false;
      app.connected = false;
      notice('The HackWave server did not answer. Is pnpm ui still running?');
      connect();
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
      const active = index === app.nowIndex && !entry && !batch.done;
      const row = el('div', 'plan-row' + (active ? ' now' : ''));
      const text = el('div');
      text.append(el('b', null, planned.name));
      text.append(el('small', null, entry ? entry.summary.split('.')[0] : batch.done ? 'Not completed: test stopped' : active ? (app.nowMilestone ? 'Now: ' + app.nowMilestone : 'Waiting for the next engine event') : 'Waiting'));
      const mark = entry ? el('span', 'mini c-' + entry.color, entry.color === 'UNVERIFIED' ? '?' : WORD[entry.color]) : el('span', 'mini wait', active ? 'NOW' : '');
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
      $('viewReport').hidden = false;
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
    const withRuns = app.batches;
    $('repEmpty').hidden = withRuns.length > 0;
    $('repBody').hidden = withRuns.length === 0;
    if (!withRuns.length) return;
    if (!withRuns.some((batch) => batch.id === app.picked)) app.picked = withRuns[0].id;
    const pick = $('repPick');
    pick.replaceChildren();
    withRuns.forEach((batch, index) => {
      const option = el('option', null, 'Test ' + (withRuns.length - index) + ': ' + batch.plan.map((entry) => entry.code).join(', ') + (batch.error ? ' — stopped' : '') + ' (' + new Date(batch.startedAt).toLocaleTimeString() + ')');
      option.value = batch.id;
      option.selected = batch.id === app.picked;
      pick.append(option);
    });
    const batch = withRuns.find((item) => item.id === app.picked);
    $('repGoal').textContent = batch.goal;
    $('repTarget').textContent = batch.targetLabel || (batch.project === 'website' ? 'Explored at ' + batch.target + ', unverified' : 'Demo shop at ' + batch.target + ', one address, redeployed for each version');
    const compare = $('compare');
    compare.replaceChildren();
    if (batch.error || !batch.runs.length) {
      const status = el('section');
      status.append(stoppedCard(batch));
      compare.append(status);
    }
    for (const entry of batch.runs) {
      const column = el('section');
      column.append(ackCard(entry, false));
      const shots = el('div', 'shots');
      shots.append(el('h4', null, entry.shots.length ? 'Screens at each change or failure' : 'No changes or failures: one screen'));
      if (!entry.finalShot && !entry.shots.length) shots.append(el('p', 'hint', 'No screenshot supplied for this run.'));
      for (const shot of entry.shots) shots.append(shotLink(shot.url, shot.caption, shot.kind === 'unresolved' || shot.kind === 'stopped'));
      if (entry.finalShot) shots.append(shotLink(entry.finalShot, 'Final screen' + (entry.color === 'RED' ? ': where the page claimed success' : ''), entry.color === 'RED'));
      column.append(shots);
      const links = el('p', 'links');
      const report = el('a', null, 'Full report');
      report.href = entry.reportUrl; report.target = '_blank'; report.rel = 'noopener';
      if (entry.reportUrl) links.append(report); else links.append(el('span', 'muted', 'No report file supplied for this run.'));
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
    const withRuns = app.batches;
    withRuns.forEach((batch, index) => {
      for (const entry of batch.runs) {
        const row = el('tr');
        const verdict = el('td', 'verdict-cell c-' + entry.color, WORD[entry.color]);
        const report = el('td');
        const link = el('a', null, 'Open');
        link.href = entry.reportUrl; link.target = '_blank'; link.rel = 'noopener';
        if (entry.reportUrl) report.append(link); else report.append(el('span', 'muted', 'Unavailable'));
        row.append(el('td', null, 'Test ' + (withRuns.length - index)), el('td', null, entry.code + ': ' + entry.name), verdict, el('td', null, entry.summary), el('td', null, entry.seconds == null ? 'n/a' : entry.seconds + ' s'), el('td', null, String(entry.heals)), el('td', null, String(entry.replans)), el('td', null, String(entry.llmCalls)), report);
        tbody.append(row);
      }
      if (batch.error) {
        const row = el('tr');
        row.append(el('td', null, 'Test ' + (withRuns.length - index)));
        const reason = el('td', null, 'Test stopped: ' + batch.error + '. No additional verifier result was produced.');
        reason.colSpan = 8;
        row.append(reason);
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
    $('sBusy').textContent = !app.connected ? 'Server lost' : server.busy ? 'Test running' : 'Idle';
    $('sBusyWrap').className = server.busy ? 'busy' : '';
    updatePlan();
  };
  const renderAdSlot = () => {
    const latest = app.batches[0];
    $('adSlot').replaceChildren(latest ? latest.error || !latest.runs.length ? stoppedCard(latest) : ackCard(latest.runs[latest.runs.length - 1], false) : sampleCard());
    $('adTitle').textContent = latest ? 'The latest acknowledgement' : 'What comes back';
    const recent = $('recent');
    recent.replaceChildren();
    const done = app.batches;
    if (!done.length) { recent.append(el('p', 'hint', 'No tests yet. Each test you run is listed here with its verdicts.')); return; }
    done.slice(0, 6).forEach((batch, index) => {
      const row = el('button', 'recent-row');
      row.type = 'button';
      const text = el('span', 'recent-goal', 'Test ' + (done.length - index) + ': ' + batch.goal);
      const marks = el('span', 'recent-marks');
      for (const entry of batch.runs) marks.append(el('span', 'mini small c-' + entry.color, entry.code));
      if (batch.error || !batch.done) marks.append(el('span', 'hint', batch.error ? 'Stopped' : 'Running'));
      row.append(text, marks);
      row.addEventListener('click', () => { app.picked = batch.id; app.focus = null; show('reports'); });
      recent.append(row);
    });
  };
  const firstState = (server) => {
    $('goal').value = server.defaultGoal;
    renderChips();
    renderVersions();
    app.batches = server.batches;
  };
  const restoreLive = () => {
    const previous = app.liveBatch;
    const batch = app.batches.find(item => !item.done) || app.batches.find(item => item.id === previous?.id) || app.batches[0] || null;
    const same = batch && previous && batch.id === previous.id && batch.startedAt === previous.startedAt;
    app.liveBatch = batch;
    $('runEmpty').hidden = !!batch;
    $('runBody').hidden = !batch;
    if (!batch) {
      log.replaceChildren();
      app.nowIndex = -1;
      app.nowMilestone = '';
      signal.replaceChildren();
      return;
    }
    const next = !batch.done && Number.isInteger(batch.currentIndex) ? batch.currentIndex : batch.done && batch.error ? Math.min(batch.runs.length, batch.plan.length - 1) : batch.done ? Math.max(0, batch.runs.length - 1) : batch.runs.length;
    if (!same || next !== app.nowIndex) app.nowMilestone = '';
    app.nowIndex = next;
    if (!batch.done && typeof batch.currentMilestone === 'string') app.nowMilestone = batch.currentMilestone;
    if (batch.seenMilestones?.[next]) app.progress.set(batch.startedAt + ':' + next, new Set(batch.seenMilestones[next]));
    if (!same) log.replaceChildren();
    if (Array.isArray(batch.logs)) {
      const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      const position = log.scrollTop;
      log.replaceChildren(...batch.logs.map(item => el('div', item.tone || 'plain', item.text)));
      log.scrollTop = follow ? log.scrollHeight : position;
    } else if (!same || !app.connected) addLine('State restored. This server snapshot does not include earlier logs or the active milestone; waiting for new engine events.', 'dim');
    $('runGoal').textContent = batch.goal;
    $('runTarget').textContent = batch.targetLabel || (batch.project === 'website' ? 'Website: ' + batch.target + ' (unverified)' : 'Demo shop at ' + batch.target);
    renderPlan(); setNow(); drawSignal();
  };
  const handle = (message) => {
    if (message.type === 'state') {
      $('connectionNotice').hidden = true;
      const first = !app.server;
      const recovering = !app.connected;
      app.connected = true;
      app.started = false;
      app.server = message;
      if (first) firstState(message); else app.batches = message.batches;
      restoreLive();
      if (recovering && !first && !Array.isArray(app.liveBatch?.logs)) addLine('Connection restored. This server did not provide earlier log events.', 'dim');
      if (first) {
        const hash = location.hash.replace('#', '');
        show(['new', 'run', 'reports'].includes(hash) ? hash : app.liveBatch && !app.liveBatch.done ? 'run' : 'new');
      }
      applyStatus();
      renderAdSlot();
      renderReports();
      return;
    }
    if (!app.server) return;
    if (message.type === 'busy') { app.started = false; app.server.busy = message.busy; applyStatus(); return; }
    if (message.type === 'batch') {
      app.started = false;
      if (!app.batches.some((batch) => batch.id === message.batch.id)) app.batches.unshift(message.batch);
      app.liveBatch = app.batches.find((batch) => batch.id === message.batch.id);
      app.nowIndex = 0; app.nowMilestone = '';
      log.replaceChildren();
      $('runEmpty').hidden = true; $('runBody').hidden = false;
      $('runGoal').textContent = message.batch.goal;
      $('runTarget').textContent = message.batch.targetLabel || (message.batch.project === 'website' ? 'Website: ' + message.batch.target + ' (unverified)' : 'Demo shop at ' + message.batch.target);
      renderPlan(); setNow(); renderAdSlot();
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
    if (message.type === 'milestone') {
      app.nowMilestone = message.key;
      if (app.liveBatch) {
        const key = app.liveBatch.startedAt + ':' + app.nowIndex;
        if (!app.progress.has(key)) app.progress.set(key, new Set());
        app.progress.get(key).add(message.key);
      }
      renderPlan(); setNow(); return;
    }
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
      setNow(); renderPlan(); renderAdSlot(); renderReports();
      return;
    }
    if (message.type === 'error') {
      addLine('Stopped: ' + message.message, 'bad');
      if (message.hint) addLine(message.hint, 'warn');
      notice(message.hint || message.message);
    }
  };
  const connect = () => {
    app.events?.close();
    const events = new EventSource('/api/events');
    app.events = events;
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('invalid message');
        handle(message);
      } catch {
        app.connected = false;
        updatePlan();
        $('connectionNotice').textContent = 'The server sent an unreadable event. Run is disabled until a valid state snapshot arrives.';
        $('connectionNotice').hidden = false;
      }
    };
    events.onerror = () => {
      app.connected = false;
      app.started = false;
      $('sBusy').textContent = 'Server lost';
      $('runBtn').disabled = true;
      $('connectionNotice').textContent = 'Lost the connection to the HackWave server. Start the backend on port 4321. This page reconnects automatically.';
      $('connectionNotice').hidden = false;
    };
  };
  window.addEventListener('hashchange', () => { const hash = location.hash.replace('#', ''); if (['new', 'run', 'reports'].includes(hash) && hash !== app.screen) show(hash); });
  connect();
})();
</script>
</body>
</html>`;
}
