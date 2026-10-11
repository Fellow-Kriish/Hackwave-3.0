/**
 * The web app's one page: plain HTML, CSS and a small script, no build step and no dependencies. Every value from the
 * server is put on the page with textContent, never as HTML.
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
  --bg: #f6f7f9; --panel: #ffffff; --ink: #1b1f24; --muted: #5d6570; --line: #dde1e6;
  --accent: #2f5bd3; --accent-ink: #ffffff; --good: #1f7a3d; --warn: #9a6500; --bad: #b3261e;
  --good-bg: #e6f4ea; --warn-bg: #fdf3dc; --bad-bg: #fbe9e7; --log-bg: #0f1419; --log-ink: #d7dde4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216; --panel: #171b21; --ink: #e6e9ee; --muted: #9aa3ad; --line: #2a3038;
    --accent: #6d8ff0; --accent-ink: #0f1216; --good: #6fcf8f; --warn: #e8b74a; --bad: #f08a80;
    --good-bg: #16281d; --warn-bg: #2b2414; --bad-bg: #2e1816; --log-bg: #0a0d10; --log-ink: #d7dde4;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 18px 24px 8px; }
header h1 { margin: 0; font-size: 22px; }
header p { margin: 4px 0 0; color: var(--muted); }
main { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 16px; padding: 12px 24px 32px; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; padding: 12px 16px 32px; } header { padding: 16px 16px 4px; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
.panel h2 { margin: 0 0 10px; font-size: 15px; }
label.block { display: block; font-weight: 600; margin: 12px 0 6px; }
textarea, select { width: 100%; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
textarea { min-height: 84px; resize: vertical; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip { font: inherit; font-size: 13px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.chip:hover { border-color: var(--accent); }
.check { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; color: var(--muted); font-size: 14px; }
.check input { margin-top: 4px; }
.buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
button.primary, button.secondary { font: inherit; font-weight: 600; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
.status { margin-top: 14px; font-size: 13px; color: var(--muted); }
.status b { color: var(--ink); font-weight: 600; }
.notice { margin-top: 10px; font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); color: var(--warn); display: none; }
.right { display: grid; gap: 16px; align-content: start; min-width: 0; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.steps li { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); color: var(--muted); }
.steps li.now { border-color: var(--accent); color: var(--ink); }
.steps li.done { color: var(--ink); }
.steps li .say { display: block; font-size: 13px; color: var(--muted); }
.steps li .tag { float: right; font-size: 12px; font-weight: 700; }
#log { background: var(--log-bg); color: var(--log-ink); border-radius: 8px; padding: 12px; height: 380px; overflow: auto; font: 12.5px/1.45 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
#log .dim { color: #7d8794; } #log .info { color: #6cc4e0; } #log .heading { color: #ffffff; font-weight: 700; }
#log .warn { color: #e8b74a; } #log .bad { color: #f08a80; } #log .good { color: #6fcf8f; }
#log .mark { color: #ffffff; background: #2a3341; display: block; padding: 2px 6px; border-radius: 4px; margin: 6px 0; }
.result { border: 1px solid var(--line); border-left-width: 6px; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.result.GREEN { border-left-color: var(--good); } .result.AMBER { border-left-color: var(--warn); } .result.RED { border-left-color: var(--bad); }
.result .top { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.badge { font-weight: 800; font-size: 13px; padding: 2px 8px; border-radius: 6px; }
.badge.GREEN { background: var(--good-bg); color: var(--good); } .badge.AMBER { background: var(--warn-bg); color: var(--warn); } .badge.RED { background: var(--bad-bg); color: var(--bad); }
.result .label { font-weight: 600; }
.result .meta { color: var(--muted); font-size: 13px; }
.result p { margin: 6px 0; }
.result ul { margin: 4px 0 6px; padding-left: 20px; }
.result .checks { font-size: 13px; color: var(--muted); }
.result .why { font-size: 14px; background: var(--bad-bg); padding: 8px 10px; border-radius: 6px; }
.result a { color: var(--accent); }
.empty { color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>HackWave</h1>
  <p>Type what a user wants to do. The AI reads the site, works out the steps, does them, and checks the real result.</p>
</header>
<main>
  <section class="panel">
    <h2>What should the test do?</h2>
    <label class="block" for="goal">Goal, in plain words</label>
    <textarea id="goal" spellcheck="true"></textarea>
    <div class="chips" id="chips"></div>
    <label class="block" for="version">Which version of the shop</label>
    <select id="version"></select>
    <label class="check"><input type="checkbox" id="fresh"> <span>Start from scratch: forget what it learned for this goal</span></label>
    <label class="check"><input type="checkbox" id="live"> <span>Use the live AI even for a goal with recorded answers</span></label>
    <div class="buttons">
      <button class="primary" id="run">Run test</button>
      <button class="secondary" id="demo">Guided demo (4 steps)</button>
    </div>
    <div class="status" id="status">connecting…</div>
    <div class="notice" id="notice"></div>
  </section>
  <section class="right">
    <div class="panel" id="stepsPanel" hidden>
      <h2>Guided demo</h2>
      <ol class="steps" id="steps"></ol>
    </div>
    <div class="panel">
      <h2>What the AI is doing</h2>
      <div id="log"><span class="dim">Nothing yet. Type a goal and press Run test. A browser window opens too, so you can watch it work.</span></div>
    </div>
    <div class="panel">
      <h2>Results</h2>
      <div id="results"><div class="empty">No runs yet.</div></div>
    </div>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const goal = $('goal'), version = $('version'), fresh = $('fresh'), live = $('live');
  const runButton = $('run'), demoButton = $('demo'), log = $('log'), results = $('results');
  let state = null, busy = false, first = true, logStarted = false;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const addLine = (text, tone) => {
    if (!logStarted) { log.textContent = ''; logStarted = true; }
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(el('div', tone || 'plain', text || ' '));
    if (near) log.scrollTop = log.scrollHeight;
  };
  const notice = (text) => { const n = $('notice'); n.textContent = text || ''; n.style.display = text ? 'block' : 'none'; };

  const showStatus = () => {
    if (!state) return;
    const s = $('status');
    s.textContent = '';
    s.append('Shop address: ', el('b', '', state.address), ' · now serving: ', el('b', '', state.deployedLabel || 'nothing yet'));
    s.append(el('br'), 'AI: ', el('b', '', state.liveAvailable ? 'live model ready' : 'no API key, recorded goals only'));
    if (busy) s.append(el('br'), el('b', '', 'A test is running…'));
    runButton.disabled = demoButton.disabled = busy;
  };

  const renderSteps = (current) => {
    const list = $('steps');
    list.textContent = '';
    state.steps.forEach((step, index) => {
      const item = el('li', index < current ? 'done' : index === current ? 'now' : '');
      const tag = el('span', 'tag', index < current ? '✓' : index === current ? 'running' : '');
      tag.dataset.index = String(index);
      item.append(tag, el('span', '', (index + 1) + '. ' + step.title), el('span', 'say', step.say));
      list.appendChild(item);
    });
  };

  const renderResult = (r) => {
    const card = el('div', 'result ' + r.color);
    const top = el('div', 'top');
    top.append(el('span', 'badge ' + r.color, r.color), el('span', 'label', r.label));
    card.append(top);
    card.append(el('p', '', r.summary));
    if (r.whatChanged && r.whatChanged.length) {
      card.append(el('div', 'meta', 'What changed in the app:'));
      const list = el('ul');
      r.whatChanged.forEach((line) => list.appendChild(el('li', '', line)));
      card.append(list);
    }
    if (r.healer) card.append(el('p', 'checks', r.healer));
    const checks = el('div', 'checks');
    r.checks.forEach((c) => checks.appendChild(el('div', '', 'checked ' + c.name + ': ' + c.status + ' (' + c.summary + ')')));
    card.append(checks);
    if (r.hypothesis) card.append(el('p', 'why', 'Likely cause: ' + r.hypothesis));
    const meta = el('div', 'meta');
    meta.append(r.seconds + ' s · ' + r.heals + ' heal(s) · ' + r.replans + ' re-plan(s) · AI calls ' + r.llmCalls + (r.llmCalls ? ' (' + r.llmCached + ' from recordings)' : '') + (r.hypothesis ? ' + 1 to explain the bug' : '') + ' · ');
    const link = el('a', '', 'full report');
    link.href = r.reportUrl; link.target = '_blank'; link.rel = 'noopener';
    meta.append(link);
    card.append(meta);
    return card;
  };
  const addResult = (r) => {
    const empty = results.querySelector('.empty');
    if (empty) empty.remove();
    results.prepend(renderResult(r));
  };

  const applyState = (s) => {
    state = s;
    busy = s.busy;
    if (first) {
      first = false;
      goal.value = s.defaultGoal;
      const chips = $('chips');
      const all = [s.defaultGoal].concat(s.examples);
      all.forEach((text, index) => {
        const chip = el('button', 'chip', index === 0 ? 'recorded goal (offline)' : text);
        chip.type = 'button';
        chip.title = text;
        chip.onclick = () => { goal.value = text; goal.focus(); };
        chips.appendChild(chip);
      });
      Object.entries(s.versions).forEach(([value, label]) => version.appendChild(Object.assign(el('option', '', label), { value })));
      results.textContent = '';
      if (!s.history.length) results.appendChild(el('div', 'empty', 'No runs yet.'));
      s.history.slice().reverse().forEach(addResult);
    }
    showStatus();
  };

  const events = new EventSource('/api/events');
  events.onmessage = (message) => {
    const m = JSON.parse(message.data);
    if (m.type === 'state') applyState(m);
    else if (m.type === 'busy') { busy = m.busy; showStatus(); }
    else if (m.type === 'line') addLine(m.text, m.tone);
    else if (m.type === 'run') {
      addLine('', 'plain');
      addLine('━━ ' + m.label + ' ━━  goal: "' + m.goal + '"', 'mark');
      addLine('address ' + m.address + ' · AI ' + (m.mode === 'replay' ? 'from recordings (offline)' : 'live') + (m.fresh ? ' · starting from scratch' : ' · reusing what it learned'), 'dim');
      (m.notes || []).forEach((note) => addLine(note, 'dim'));
    } else if (m.type === 'step') {
      $('stepsPanel').hidden = false;
      renderSteps(m.index);
      if (m.title !== 'Done') addLine('▶ ' + m.title, 'mark');
    } else if (m.type === 'result') addResult(m);
    else if (m.type === 'error') { addLine('✗ ' + m.message, 'bad'); notice(m.hint || m.message); }
  };
  events.onerror = () => { $('status').textContent = 'lost the connection to the HackWave server; is it still running?'; };

  const start = async (path) => {
    notice('');
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: goal.value, version: version.value, fresh: fresh.checked, live: live.checked }),
    });
    if (!response.ok) notice((await response.json()).error || ('HTTP ' + response.status));
    else if (path === '/api/run') $('stepsPanel').hidden = true;
  };
  runButton.onclick = () => start('/api/run');
  demoButton.onclick = () => start('/api/demo');
})();
</script>
</body>
</html>`;
}
