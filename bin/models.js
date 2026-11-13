// Lists claude-p models matching all given words (case-insensitive).
// Price column: USD per 1M input / output tokens (OpenRouter pricing).
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const words = process.argv.slice(2).join(' ').toLowerCase().split(/\s+/).filter(Boolean);

function fmtPrice(m) {
  if (m.prompt == null || m.completion == null || isNaN(m.prompt) || isNaN(m.completion)) return '';
  if (m.prompt < 0 || m.completion < 0) return 'variable';
  if (m.prompt === 0 && m.completion === 0) return 'free';
  const f = (p) => { const v = p * 1e6; return '$' + (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, '') : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')); };
  return `${f(m.prompt)}/${f(m.completion)}`;
}

const rows = [
  { id: 'local', context_length: null, name: 'LOCAL llama.cpp (context size read from llama-server)', prompt: 0, completion: 0 },
];
try {
  let l = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(l)) l = [l];
  rows.push(...l.sort((a, b) => a.id.localeCompare(b.id)));
} catch {}

const hits = rows.filter((r) => words.every((w) => (r.id + ' ' + r.name).toLowerCase().includes(w)));
console.log(`${'MODEL ID'.padEnd(60)} ${'CTX'.padStart(6)}  ${'$/1M IN/OUT'.padEnd(14)} NAME`);
for (const r of hits.slice(0, 60)) {
  const id = /(claude|anthropic)/i.test(r.id) ? r.id : 'via-claude/' + r.id;
  const ctx = r.context_length ? Math.round(r.context_length / 1000) + 'k' : '?';
  console.log(`${id.padEnd(60)} ${ctx.padStart(6)}  ${(fmtPrice(r) || '?').padEnd(14)} ${r.name}`);
}
console.log(hits.length > 60 ? `... ${hits.length} matches, showing 60. Add more words to narrow.` : `${hits.length} match(es).`);
