#!/usr/bin/env node
// claude-p status line: shows context usage below the prompt, e.g. "vast · 72k/131k (55%)".
// Claude Code pipes a JSON blob on stdin (see the statusLine docs); we read context_window from it.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  const cw = j.context_window || {};
  const used = Number(cw.total_input_tokens) || 0;
  const size = Number(cw.context_window_size) || 0;
  const model = (j.model && (j.model.display_name || j.model.id)) || '';
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
  const parts = [];
  if (model) parts.push(model);
  if (size > 0) {
    const pct = Math.round((used / size) * 100);
    parts.push(`${k(used)}/${k(size)} ctx (${pct}%)`);
  } else if (used > 0) {
    parts.push(`${k(used)} ctx`);
  }
  process.stdout.write(parts.join('  ·  '));
});
