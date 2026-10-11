/**
 * report.html from report.md: a fallback artifact, not a product. It covers exactly the markdown the reporter
 * writes (headings, quotes, lists, tables, fenced code with diffs, inline code, bold) and needs no dependency.
 */

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markup after escaping: `code`, then **bold** outside code. */
function inline(text: string): string {
  return escapeHtml(text)
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')))
    .join('');
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const COLORS: Record<string, string> = { GREEN: '#1a7f37', AMBER: '#9a6700', RED: '#cf222e', GREY: '#57606a' };

export function markdownToHtml(markdown: string, title: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^(`{3,})(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const [, marks = '```', lang = ''] = fence;
      const body: string[] = [];
      for (i++; i < lines.length && lines[i] !== marks; i++) body.push(lines[i] ?? '');
      const rendered = body.map((text) => {
        const escaped = escapeHtml(text);
        if (lang !== 'diff') return escaped;
        if (text.startsWith('+')) return `<span class="add">${escaped}</span>`;
        if (text.startsWith('-')) return `<span class="del">${escaped}</span>`;
        return escaped;
      });
      out.push(`<pre class="${lang || 'text'}"><code>${rendered.join('\n')}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      const color = level === 1 ? COLORS[text.split(' ')[0] ?? ''] : undefined;
      out.push(color ? `<h1 class="verdict" style="background:${color}">${inline(text)}</h1>` : `<h${level}>${inline(text)}</h${level}>`);
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows: string[] = [];
      for (; i < lines.length && (lines[i] ?? '').startsWith('|'); i++) rows.push(lines[i] ?? '');
      i--;
      const [head = '', , ...body] = rows;
      out.push(
        `<table><thead><tr>${cells(head).map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      const items: string[] = [];
      for (; i < lines.length && (lines[i] ?? '').startsWith('- '); i++) items.push((lines[i] ?? '').slice(2));
      i--;
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: #fff; max-width: 1000px; margin: 0 auto; padding: 24px 16px 64px; }
  h1.verdict { color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 24px; }
  h2 { border-bottom: 1px solid #d0d7de; padding-bottom: 4px; margin-top: 32px; }
  blockquote { margin: 16px 0; padding: 10px 16px; border-left: 4px solid #8c959f; background: #f6f8fa; font-size: 16px; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; }
  code { font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; background: #f6f8fa; padding: 1px 4px; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .add { color: #1a7f37; } .del { color: #cf222e; }
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}
