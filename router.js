// claude-p router: one Anthropic-compatible endpoint that routes by model name.
//   local    -> your own Anthropic-compatible server (e.g. llama-server) at config.json's localUrl
//   <name>   -> more self-hosted servers from config.json "servers" (e.g. a rented GPU)
//   other    -> https://openrouter.ai/api (Anthropic-compatible) with your OpenRouter key
//   current  -> whatever model the main loop used last (used for Claude Code's background "haiku" calls)
// GET /v1/models lists local + all OpenRouter models so Claude Code's /model picker can show them.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

// Machine-specific settings live in config.json (gitignored; see config.example.json).
// Environment variables override it.
let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}

const PORT = Number(process.env.CLAUDE_P_ROUTER_PORT || CONFIG.routerPort || 8099);
// Self-hosted model servers (claude-p never starts or stops them). "local" comes from localUrl + local.key;
// more come from config.json:  "servers": { "vast": { "url": "https://llm.example.com", "keyFile": "vast.key" } }
// Each one appears in /model as via-claude/<name>. Key files are secrets (gitignored *.key).
function makeServer(name, url, keyFile, keyEnv, ctx) {
  const u = new URL(url);
  return {
    name, url: u, lib: u.protocol === 'https:' ? https : http, base: u.pathname.replace(/\/+$/, ''),
    ctx: Number(ctx) || null,  // configured fallback context (tokens) used when the live /props probe fails
    key() {
      if (keyEnv && process.env[keyEnv]) return process.env[keyEnv].trim();
      try { return fs.readFileSync(path.resolve(DIR, keyFile), 'utf8').trim() || null; } catch { return null; }
    },
    where() { return this.url.origin + this.base; },
  };
}
const SERVERS = { local: makeServer('local', process.env.CLAUDE_P_LOCAL_URL || CONFIG.localUrl || 'http://127.0.0.1:8080', 'local.key', 'CLAUDE_P_LOCAL_API_KEY', CONFIG.localCtx) };
for (const [name, c] of Object.entries(CONFIG.servers || {})) {
  if (!/^[a-z0-9_-]+$/i.test(name) || !c || !c.url) continue; // names must not look like OpenRouter ids (no '/')
  try { SERVERS[name] = makeServer(name, c.url, c.keyFile || `${name}.key`, null, c.ctx); } catch {}
}
const serverFor = (m) => (Object.prototype.hasOwnProperty.call(SERVERS, m) ? SERVERS[m] : m.startsWith('local/') ? SERVERS.local : null); // local/* = ids from older claude-p versions
const srvOpts = (srv, p, timeout) => {
  const key = srv.key();
  return {
    protocol: srv.url.protocol, hostname: srv.url.hostname,
    port: srv.url.port || (srv.url.protocol === 'https:' ? 443 : 80), path: srv.base + p, timeout,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  };
};
const CACHE = path.join(DIR, 'models.json');
const KEY_FILE = path.join(DIR, 'openrouter.key');
const LOG = path.join(DIR, 'router.log');
const PREFIX = 'via-claude/';

function log(...a) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {}
}

function orKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return null; }
}

// ---------- OpenRouter model list ----------
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

async function openRouterModels() {
  let fresh = false;
  try { fresh = Date.now() - fs.statSync(CACHE).mtimeMs < 12 * 3600 * 1000; } catch {}
  if (!fresh) {
    try {
      const r = await fetchJson('https://openrouter.ai/api/v1/models');
      const list = r.data.map((m) => ({
        id: m.id, name: m.name, context_length: m.context_length,
        prompt: m.pricing && Number(m.pricing.prompt), completion: m.pricing && Number(m.pricing.completion),
      }));
      fs.writeFileSync(CACHE, JSON.stringify(list));
    } catch (e) { log('model list fetch failed:', e.message); }
  }
  try {
    let list = JSON.parse(fs.readFileSync(CACHE, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(list)) list = [list];
    return list.sort((a, b) => a.id.localeCompare(b.id));
  } catch { return []; }
}

// "$0.27/$1.10" (USD per 1M input/output tokens), "free", or '' when unknown.
function fmtPrice(m) {
  if (m.prompt == null || m.completion == null || isNaN(m.prompt) || isNaN(m.completion)) return '';
  if (m.prompt < 0 || m.completion < 0) return 'variable';
  if (m.prompt === 0 && m.completion === 0) return 'free';
  const f = (p) => { const v = p * 1e6; return '$' + (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, '') : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')); };
  return `${f(m.prompt)}/${f(m.completion)}`;
}

async function modelsResponse() {
  // Claude Code's discovery keeps only ids matching /(claude|anthropic)/i, so prefix the others.
  const pub = (id) => (/(claude|anthropic)/i.test(id) ? id : PREFIX + id);
  const data = [];
  const props = await Promise.all(Object.values(SERVERS).map((srv) => srvProps(srv)));
  Object.values(SERVERS).forEach((srv, i) => {
    const p = props[i], label = srv.name.toUpperCase();
    data.push({
      type: 'model', id: pub(srv.name), created_at: '2026-01-01T00:00:00Z',
      display_name: p ? `${label} ${p.model} · ${Math.round(p.n_ctx / 1024)}k ctx · self-hosted` : `${label} model · self-hosted`,
      description: p ? `${srv.where()}, ${p.n_ctx} tokens context` : `not reachable at ${srv.where()}; start that server`,
    });
  });
  for (const m of await openRouterModels()) {
    const price = fmtPrice(m);
    const ctx = m.context_length ? `${Math.round(m.context_length / 1000)}k ctx` : '';
    data.push({
      type: 'model', id: pub(m.id), display_name: `${m.name || m.id}${price ? ' · ' + price : ''}`,
      description: [ctx, price && (price.startsWith('$') ? `${price} per 1M in/out` : price), 'OpenRouter'].filter(Boolean).join(' · '),
      created_at: '2026-01-01T00:00:00Z',
    });
  }
  return { data, has_more: false, first_id: data[0] && data[0].id, last_id: data.length ? data[data.length - 1].id : null };
}

// ---------- self-hosted servers (run by the user; we only talk to them) ----------
function srvGet(srv, p, timeout, onRes, onFail) {
  const req = srv.lib.get(srvOpts(srv, p, timeout), onRes);
  req.on('error', onFail);
  req.on('timeout', () => { req.destroy(); onFail(); });
}

function srvHealthy(srv) {
  return new Promise((resolve) => srvGet(srv, '/health', 3000, (res) => { res.resume(); resolve(res.statusCode === 200); }, () => resolve(false)));
}

// { model, n_ctx } from llama-server's /props, or null when unavailable (not running, or not llama-server).
function srvProps(srv) {
  return new Promise((resolve) => srvGet(srv, '/props', 5000, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      try {
        const j = JSON.parse(d);
        const n_ctx = j.default_generation_settings && j.default_generation_settings.n_ctx;
        resolve(n_ctx ? { n_ctx, model: path.basename(String(j.model_path || 'model')).replace(/\.gguf$/i, '') } : null);
      } catch { resolve(null); }
    });
  }, () => resolve(null)));
}

// Claude Code sends role:"system" entries inside messages[]. Many chat templates (e.g. Qwen's)
// reject a system message that isn't first, so move them into the top-level system field.
function hoistSystemMessages(j) {
  if (!Array.isArray(j.messages) || !j.messages.some((m) => m.role === 'system')) return;
  let sys = j.system == null ? [] : typeof j.system === 'string' ? [{ type: 'text', text: j.system }] : [...j.system];
  const kept = [];
  for (const m of j.messages) {
    if (m.role !== 'system') { kept.push(m); continue; }
    if (typeof m.content === 'string') sys.push({ type: 'text', text: m.content });
    else for (const c of m.content || []) if (c.type === 'text') sys.push({ type: 'text', text: c.text });
  }
  // Merge consecutive same-role messages left behind by the removal.
  const merged = [];
  for (const m of kept) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      const toArr = (c) => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);
      prev.content = [...toArr(prev.content), ...toArr(m.content)];
    } else merged.push({ ...m });
  }
  j.system = sys;
  j.messages = merged;
}

// ---------- proxy ----------
let currentModel = process.env.CLAUDE_P_START_MODEL || 'local';
let lastActivity = Date.now();
let sessions = 0;

// llama-server streams thinking with an empty signature and opens the text block before closing
// the thinking block. Rewrite the stream so it looks like Anthropic's: one block at a time, and
// thinking blocks closed with a non-empty signature (Claude Code drops unsigned thinking).
const { Transform } = require('stream');
const FAKE_SIG = 'claude-p-local';
class SseThinkingFixer extends Transform {
  constructor() { super(); this.buf = ''; this.open = new Map(); this.done = new Set(); }
  emit_(obj) { this.push(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`); }
  closeBlock(index) {
    const type = this.open.get(index);
    if (type === 'thinking') this.emit_({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: FAKE_SIG } });
    this.emit_({ type: 'content_block_stop', index });
    this.open.delete(index); this.done.add(index);
  }
  handle(raw) {
    const line = raw.split('\n').find((l) => l.startsWith('data:'));
    let ev;
    try { ev = line && JSON.parse(line.slice(5).trim()); } catch {}
    if (!ev || !ev.type) { this.push(raw + '\n\n'); return; }
    switch (ev.type) {
      case 'content_block_start':
        for (const i of [...this.open.keys()]) this.closeBlock(i);
        this.open.set(ev.index, ev.content_block && ev.content_block.type);
        this.emit_(ev); return;
      case 'content_block_delta':
        if (ev.delta && ev.delta.type === 'signature_delta') return; // we sign on close
        if (this.done.has(ev.index)) return; // late delta for a block we already closed
        this.emit_(ev); return;
      case 'content_block_stop':
        if (this.open.has(ev.index)) this.closeBlock(ev.index);
        return;
      case 'message_delta':
      case 'message_stop':
        for (const i of [...this.open.keys()]) this.closeBlock(i);
        this.emit_(ev); return;
      default:
        this.emit_(ev);
    }
  }
  _transform(chunk, _enc, cb) {
    this.buf += chunk.toString('utf8').replace(/\r\n/g, '\n');
    let k;
    while ((k = this.buf.indexOf('\n\n')) !== -1) {
      const raw = this.buf.slice(0, k); this.buf = this.buf.slice(k + 2);
      if (raw.trim()) this.handle(raw);
    }
    cb();
  }
  _flush(cb) { if (this.buf.trim()) this.handle(this.buf); cb(); }
}

function forward(req, res, body, target) {
  const headers = { ...req.headers };
  delete headers.host; delete headers['content-length']; delete headers.connection;
  headers['content-length'] = Buffer.byteLength(body);
  const lib = target.protocol === 'https:' ? https : http;
  if (target.key) { delete headers['x-api-key']; headers.authorization = `Bearer ${target.key}`; }
  const up = lib.request({ host: target.host, port: target.port, path: target.path, method: req.method, headers }, (ur) => {
    const isSse = /text\/event-stream/.test(ur.headers['content-type'] || '');
    if (target.fixThinking && isSse) {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(new SseThinkingFixer()).pipe(res);
    } else if (target.fixThinking && /json/.test(ur.headers['content-type'] || '')) {
      const h = { ...ur.headers }; delete h['content-length'];
      const parts = [];
      ur.on('data', (c) => parts.push(c));
      ur.on('end', () => {
        let out = Buffer.concat(parts).toString('utf8');
        try {
          const j = JSON.parse(out);
          for (const b of j.content || []) if (b.type === 'thinking' && !b.signature) b.signature = FAKE_SIG;
          out = JSON.stringify(j);
        } catch {}
        res.writeHead(ur.statusCode, h);
        res.end(out);
      });
    } else {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    }
  });
  up.on('error', (e) => sendErr(res, 502, `upstream error (${target.host}:${target.port}): ${e.message}${target.hint ? '. ' + target.hint : ''}`));
  res.on('close', () => up.destroy());
  up.end(body);
}

function sendErr(res, code, msg) {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: msg } }));
}

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/health') { res.end('ok'); return; }
    if (req.method === 'POST' && url === '/shutdown') { res.end('bye'); await shutdown(); return; }
    if (req.method === 'POST' && url === '/attach') { sessions++; log('attach ->', sessions); res.end(String(sessions)); return; }
    if (req.method === 'POST' && url === '/detach') {
      sessions = Math.max(0, sessions - 1); log('detach ->', sessions); res.end(String(sessions));
      if (sessions === 0) await shutdown();
      return;
    }
    // Used by claude-p.ps1 at launch: context size of a self-hosted server (llama-server /props).
    // 404 means the model isn't a self-hosted server (so it's an OpenRouter model).
    if (req.method === 'GET' && url === '/local/ctx') {
      const m = (new URLSearchParams(req.url.split('?')[1] || '').get('model') || 'local').replace(/\[1m\]$/i, '').replace(/^(via-claude|claude-p)\//, '');
      const srv = serverFor(m);
      if (!srv) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `${m} is not a self-hosted server` })); return; }
      const p = await srvProps(srv);
      if (p) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...p, live: true })); return; }
      // Server not reachable or not llama-server: use the configured fallback so Claude Code still gets a real limit
      // (never the 1M default). Mid-session /model switches can't re-read this, so the config value matters.
      if (srv.ctx) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ n_ctx: srv.ctx, model: srv.name, live: false })); return; }
      const up = await srvHealthy(srv);
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: up ? `${srv.where()} is up but did not report a context size; set "ctx" for this server in config.json` : `nothing reachable at ${srv.where()}; set "ctx" for this server in config.json so the context limit is still correct` }));
      return;
    }
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(await modelsResponse()));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/v1/models/')) {
      const id = decodeURIComponent(url.slice('/v1/models/'.length));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = Buffer.concat(chunks).toString('utf8');
    let model = null;
    if (body) {
      try {
        const j = JSON.parse(body);
        if (j.model) {
          model = String(j.model).replace(/\[1m\]$/i, '');
          if (model.startsWith(PREFIX)) model = model.slice(PREFIX.length);
          if (model === 'current') model = currentModel;
          else if (url === '/v1/messages') currentModel = model;
          j.model = model;
          if (!/^~?anthropic\//.test(model)) hoistSystemMessages(j);
          body = JSON.stringify(j);
        }
      } catch {}
    }
    if (!model) model = currentModel;
    log(req.method, url, '->', model);
    if (process.env.CLAUDE_P_DEBUG && url === '/v1/messages') { try { fs.writeFileSync(path.join(DIR, 'last-request.json'), body); } catch {} }

    const srv = serverFor(model);
    if (srv) {
      const o = srvOpts(srv, req.url);
      forward(req, res, body, { protocol: o.protocol, host: o.hostname, port: o.port, path: o.path, fixThinking: true, key: srv.key(),
        hint: `Is the "${srv.name}" server running at ${srv.where()}? (see config.json)` });
    } else {
      const key = orKey();
      if (!key) return sendErr(res, 401, `No OpenRouter key. Put it in ${KEY_FILE} or set OPENROUTER_API_KEY.`);
      forward(req, res, body, { protocol: 'https:', host: 'openrouter.ai', port: 443, path: '/api' + req.url, key });
    }
  } catch (e) {
    log('error', e.stack || e.message);
    sendErr(res, 500, e.message);
  }
});

async function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, '127.0.0.1', () => log('router listening on', PORT));
