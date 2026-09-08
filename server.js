// Timber Grid — authoritative Game Script + static host (ESM).
// Serves the distribution, host time, and validated daily score submissions.
// No secrets, no external dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from './src/rules.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
  '.woff2': 'font/woff2',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body === undefined ? '' : body);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8'); }

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// --- authoritative stores (in-memory; durable per process) -------------------
const leaderboards = []; // validated submissions
const achievements = new Map(); // playerId -> Set of keys
const rateLimits = new Map(); // ip -> { count, resetAt }

const ACHIEVEMENT_KEYS = new Set(['first_clear', 'combo_master', 'streak_week', 'journey_20', 'marathon']);

function rateLimitOk(ip) {
  const now = Date.now();
  let e = rateLimits.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60000 }; rateLimits.set(ip, e); }
  e.count++;
  return e.count <= 120; // 120 req/min per client
}

// Daily seed matches the client's content.js dailySeed() exactly.
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dailySeed(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const key = y * 10000 + m * 100 + d;
  const rnd = mulberry(key ^ 0x5f3759df);
  return { dayKey: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, seed: Math.floor(rnd() * 0x7fffffff) };
}

// Validate a score claim by replaying the ordered input log deterministically.
async function validateSubmission(body) {
  if (!body || typeof body.seed !== 'number' || !Array.isArray(body.commands)) return { ok: false, reason: 'bad-shape' };
  if (body.commands.length > 10000) return { ok: false, reason: 'too-many-commands' };
  const opts = { moveLimit: body.moveLimit ?? null, goalScore: body.goalScore ?? null };
  const state = rules.createState(body.seed, opts);
  for (const cmd of body.commands) {
    if (cmd.type !== 'place' || !Number.isInteger(cmd.pieceIndex) || !Number.isInteger(cmd.row) || !Number.isInteger(cmd.col)) {
      return { ok: false, reason: 'bad-command' };
    }
    const res = rules.applyPlace(state, cmd.pieceIndex, cmd.row, cmd.col);
    if (!res.ok && res.reason !== 'cell-blocked-or-out-of-bounds') return { ok: false, reason: 'illegal-command' };
  }
  if (state.score !== body.score) return { ok: false, reason: 'score-mismatch', actual: state.score };
  return { ok: true, score: state.score, status: state.status, terminalReason: state.terminalReason };
}

async function handleApi(req, res, p) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimitOk(ip)) { sendJson(res, 429, { error: 'rate-limited' }); return true; }

  if (p === '/api/v1/time' && req.method === 'GET') {
    sendJson(res, 200, { time: Date.now() });
    return true;
  }
  if (p === '/api/v1/daily' && req.method === 'GET') {
    sendJson(res, 200, dailySeed(new Date()));
    return true;
  }
  if (p === '/api/v1/scores' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (_) { sendJson(res, 400, { error: 'bad-json' }); return true; }
    const verdict = await validateSubmission(body);
    if (!verdict.ok) { sendJson(res, 422, { error: verdict.reason }); return true; }
    const entry = {
      player: typeof body.player === 'string' ? body.player.slice(0, 24) : 'Guest',
      mode: String(body.mode || 'daily').slice(0, 16),
      dayKey: typeof body.dayKey === 'string' ? body.dayKey.slice(0, 10) : null,
      score: verdict.score,
      seed: body.seed,
      rulesVersion: body.rulesVersion, contentVersion: body.contentVersion,
      assists: !!body.assists, durationMs: Math.max(0, Math.min(86400000, body.durationMs | 0)),
      at: Date.now(),
    };
    leaderboards.push(entry);
    leaderboards.sort((a, b) => b.score - a.score);
    if (leaderboards.length > 500) leaderboards.length = 500;
    sendJson(res, 200, { ok: true, entry });
    return true;
  }
  if (p === '/api/v1/scores' && req.method === 'GET') {
    sendJson(res, 200, { scores: leaderboards.slice(0, 50) });
    return true;
  }
  if (p === '/api/v1/achievements' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (_) { sendJson(res, 400, { error: 'bad-json' }); return true; }
    const player = String(body.player || 'guest').slice(0, 64);
    const key = String(body.key || '');
    if (!ACHIEVEMENT_KEYS.has(key)) { sendJson(res, 422, { error: 'unknown-achievement' }); return true; }
    if (!achievements.has(player)) achievements.set(player, new Set());
    const set = achievements.get(player);
    const already = set.has(key); // idempotent unlock
    set.add(key);
    sendJson(res, 200, { ok: true, unlocked: !already });
    return true;
  }
  if (p === '/api/v1/presence' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (p.startsWith('/api/')) { sendJson(res, 404, { error: 'not-found' }); return true; }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    let p = (req.url || '/').split('?')[0];
    if (!p.startsWith('/')) p = '/' + p;
    if (await handleApi(req, res, p)) return;

    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    // Containment must compare on a path boundary; a bare prefix check would
    // also accept sibling directories such as <ROOT>-backup.
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { send(res, 403, 'forbidden'); return; }
    // node_modules IS served (offline-local three.js); dotfiles/secrets are not.
    const rel = path.relative(ROOT, file);
    if (rel.split(path.sep).some(seg => seg.startsWith('.'))) { send(res, 404, 'not found'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { send(res, 404, 'not found'); return; }
      send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  } catch (_) {
    send(res, 500, 'error');
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server.js')) {
  server.listen(PORT, () => { console.log(`Timber Grid listening on :${PORT}`); });
}

export { server, dailySeed, validateSubmission };
