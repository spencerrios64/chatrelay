#!/usr/bin/env node
// chatrelay-mcp.mjs - chatrelay as an MCP server: one chat, several AIs, automatic failover.
// When the first AI hits a limit or goes down, the next one continues with the whole conversation.
//
//   stdio (Claude Desktop, Cursor, ...):  node chatrelay-mcp.mjs
//   HTTP  (chatbridge, browsers):         node chatrelay-mcp.mjs --http 3940    ->  http://localhost:3940/mcp
//
// Providers come from chatrelay.config.json (see chatrelay.config.example.json), or the file named
// in CHATRELAY_CONFIG. No dependencies; needs Node 18+.
import fs from 'node:fs';
import http from 'node:http';
import readline from 'node:readline';

const cfgPath = process.env.CHATRELAY_CONFIG || 'chatrelay.config.json';
let cfg = { providers: [] };
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
catch (e) { console.error('chatrelay-mcp: could not read ' + cfgPath + ' (' + e.message + ')'); }
const providers = (cfg.providers || []).map((p, i) => ({
  name: p.name || ('provider' + (i + 1)), type: p.type || 'openai', baseUrl: (p.baseUrl || '').replace(/\/+$/, ''),
  model: p.model, key: resolveKey(p.apiKey), cooldownUntil: 0, lastError: '', used: 0,
}));
function resolveKey(k) { return !k ? '' : k.startsWith('env:') ? (process.env[k.slice(4)] || '') : k; }

const convos = new Map(); // conversation id -> [{role, content}]
const COOLDOWN_MS = (cfg.cooldownSeconds || 60) * 1000;

async function callProvider(p, system, history) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), (cfg.timeoutSeconds || 120) * 1000);
  try {
    let r;
    if (p.type === 'anthropic') {
      r = await fetch((p.baseUrl || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: p.model, max_tokens: cfg.maxTokens || 2048, system: system || undefined, messages: history }),
      });
    } else {
      const msgs = (system ? [{ role: 'system', content: system }] : []).concat(history);
      r = await fetch((p.baseUrl || 'https://api.openai.com/v1') + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: Object.assign({ 'content-type': 'application/json' }, p.key ? { authorization: 'Bearer ' + p.key } : {}),
        body: JSON.stringify({ model: p.model, messages: msgs }),
      });
    }
    const body = await r.text();
    if (!r.ok) { const e = new Error('HTTP ' + r.status + ' ' + body.slice(0, 200)); e.status = r.status; throw e; }
    const j = JSON.parse(body);
    const text = p.type === 'anthropic' ? (j.content || []).map(b => b.text || '').join('') : (j.choices && j.choices[0].message.content) || '';
    if (!text) throw new Error('empty reply');
    return text;
  } finally { clearTimeout(t); }
}

let chain = Promise.resolve(); // one chat call at a time so history stays in order
function relayChat(message, id, system) { const run = chain.then(() => doRelay(message, id, system)); chain = run.catch(() => {}); return run; }
async function doRelay(message, id, system) {
  if (!providers.length) throw new Error('No providers configured. Create ' + cfgPath + ' (see chatrelay.config.example.json).');
  const history = convos.get(id) || []; history.push({ role: 'user', content: message });
  const tried = [];
  const now = Date.now();
  const order = providers.filter(p => p.cooldownUntil <= now).concat(providers.filter(p => p.cooldownUntil > now)); // cooled-down last
  for (const p of order) {
    try {
      const text = await callProvider(p, system, history);
      history.push({ role: 'assistant', content: text }); convos.set(id, history); p.used++; p.lastError = '';
      return { text, provider: p.name, model: p.model, switched: tried.length ? tried : undefined };
    } catch (e) {
      const msg = (e.name === 'AbortError' ? 'timeout' : e.message);
      p.lastError = msg; p.cooldownUntil = Date.now() + COOLDOWN_MS; tried.push(p.name + ': ' + msg.slice(0, 120));
    }
  }
  history.pop(); convos.set(id, history);
  throw new Error('All providers failed. ' + tried.join(' | '));
}

const TOOLS = [
  { name: 'relay_chat', description: 'Send a message in a persistent conversation. Tries the configured AIs in order and switches to the next if one hits a limit or fails, keeping the whole conversation.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, conversation_id: { type: 'string', description: 'Keep the same id to continue a conversation (default "default").' }, system: { type: 'string', description: 'Optional system prompt.' } }, required: ['message'] } },
  { name: 'relay_providers', description: 'List the configured AIs, which are available, and recent errors.', inputSchema: { type: 'object', properties: {} } },
  { name: 'relay_reset', description: 'Forget a conversation.', inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' } } } },
];

async function callTool(name, a) {
  if (name === 'relay_chat') {
    const r = await relayChat(String(a.message || ''), a.conversation_id || 'default', a.system);
    return r.text + '\n\n[answered by ' + r.provider + (r.model ? ' / ' + r.model : '') + (r.switched ? '; switched after: ' + r.switched.join(' | ') : '') + ']';
  }
  if (name === 'relay_providers') {
    const now = Date.now();
    return providers.map((p, i) => (i + 1) + '. ' + p.name + ' (' + p.type + ', ' + p.model + ') ' + (p.cooldownUntil > now ? 'cooling down ' + Math.ceil((p.cooldownUntil - now) / 1000) + 's' : 'available') + ', used ' + p.used + 'x' + (p.lastError ? ', last error: ' + p.lastError.slice(0, 100) : '')).join('\n') || 'No providers configured.';
  }
  if (name === 'relay_reset') { convos.delete(a.conversation_id || 'default'); return 'conversation cleared'; }
  throw new Error('Unknown tool ' + name);
}

async function handle(m) {
  if (m.id === undefined) return null; // notification
  const ok = result => ({ jsonrpc: '2.0', id: m.id, result }), bad = (code, message) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  try {
    if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'chatrelay', version: '1.0.0' } });
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: TOOLS });
    if (m.method === 'tools/call') {
      try { return ok({ content: [{ type: 'text', text: await callTool(m.params.name, m.params.arguments || {}) }] }); }
      catch (e) { return ok({ isError: true, content: [{ type: 'text', text: e.message }] }); }
    }
    return bad(-32601, 'Method not found: ' + m.method);
  } catch (e) { return bad(-32603, e.message); }
}

const hi = process.argv.indexOf('--http');
if (hi > 0) {
  const port = +process.argv[hi + 1] || 3940;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*', 'access-control-allow-private-network': 'true' };
  http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
    let b = ''; req.on('data', d => b += d);
    req.on('end', async () => {
      let m; try { m = JSON.parse(b); } catch { res.writeHead(400, cors); return res.end(); }
      const out = await handle(m);
      if (!out) { res.writeHead(202, cors); return res.end(); }
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors)); res.end(JSON.stringify(out));
    });
  }).listen(port, '127.0.0.1', () => console.error('chatrelay MCP on http://localhost:' + port + '/mcp (' + providers.length + ' providers)'));
} else {
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    const out = await handle(m);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
  console.error('chatrelay MCP (stdio) ready, ' + providers.length + ' providers');
}
