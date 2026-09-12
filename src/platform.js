// Timber Grid — platform adapter: launch-token auth, host time sync, profile
// nickname, cloud-saved progression, local settings/leaderboards/achievements.
// Guest practice works fully locally; launch tokens are never persisted.

const API_BASE = '/api/v1';
const LS_PREFIX = 'timbergrid.';
const REFRESH_MS = 45 * 60 * 1000; // re-mint scoped launch tokens before the 60-min lifetime
const REFRESH_RETRY_MS = 60000;
const CLOUD_DEBOUNCE_MS = 2000;

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (_) {}
}

// --- stored-zip helper (no compression, CRC32; cloud saves are small JSON) ------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// --- launch token (fragment, read once + stripped; query fallbacks = local dev) --
let token = null; // scoped launch token, memory only — never persisted
let sub = null; // JWT sub = user id
let slug = null; // JWT game_scope = this game's slug (never hard-coded)

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1];
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(base64ToBytes(part.replace(/-/g, '+').replace(/_/g, '/') + pad)));
  } catch (_) { return null; }
}

function readLaunchToken() {
  const hash = window.location.hash || '';
  if (hash.length > 1) {
    const params = hash.slice(1).split('&').filter(Boolean);
    const hit = params.find(p => p.startsWith('game_token='));
    if (hit) {
      // Strip the token from the URL, keeping any other fragment params.
      const rest = params.filter(p => !p.startsWith('game_token=')).join('&');
      const cleaned = window.location.pathname + window.location.search + (rest ? '#' + rest : '');
      try { window.history.replaceState(null, '', cleaned); } catch (_) {}
      return decodeURIComponent(hit.slice('game_token='.length));
    }
  }
  // Local dev fallbacks only; the platform always delivers via the fragment.
  try {
    const q = new URLSearchParams(window.location.search);
    for (const key of ['game_token', 'token', 'launch', 'launch_token']) {
      const v = q.get(key);
      if (v) return v;
    }
  } catch (_) {}
  return null;
}

export function isHosted() { return !!(token && sub && slug); }

// --- authenticated REST (Bearer on every call; never a hard-coded API host) ------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = new Error(`api ${path} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/zip')) return res.arrayBuffer();
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let refreshTimer = null;
function scheduleRefresh(delay = REFRESH_MS) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void refreshToken(); }, delay);
}
async function refreshToken() {
  try {
    const res = await api(`/games/${slug}/launch-token`, { method: 'POST' });
    if (res && typeof res.token === 'string' && res.token) token = res.token; // swap in {token}
    scheduleRefresh();
  } catch (_) {
    scheduleRefresh(REFRESH_RETRY_MS); // retry failures ~60 s
  }
}

// --- profile nickname (never /api/v1/me, never usernames) ------------------------
let profileName = null;

export function playerName() { return profileName || loadProfile().name; }

async function fetchNickname(userId) {
  try {
    const p = await api(`/users/${userId}/profile`);
    if (p && typeof p.nickname === 'string' && p.nickname) return p.nickname;
    if (p && p.id) return 'Player ' + String(p.id).slice(0, 8);
  } catch (_) {}
  return 'Player ' + String(userId).slice(0, 8);
}

const nicknameCache = new Map();
function nicknameFor(userId) {
  if (!nicknameCache.has(userId)) nicknameCache.set(userId, fetchNickname(userId));
  return nicknameCache.get(userId);
}

// --- server time sync (round-trip adjusted, unauthenticated probe) ---------------
let timeOffset = 0; // serverNow - clientNow, ms
let timeSynced = false;

export async function syncTime() {
  try {
    const t0 = Date.now();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const res = await fetch(`${API_BASE}/time`, { cache: 'no-store', headers });
    const t1 = Date.now();
    if (!res.ok) { timeSynced = false; return false; }
    const data = await res.json();
    if (typeof data.time !== 'number') { timeSynced = false; return false; }
    const rtt = t1 - t0;
    timeOffset = data.time - (t0 + rtt / 2);
    timeSynced = true;
    return true;
  } catch (_) { timeSynced = false; return false; }
}

export function now() { return Date.now() + timeOffset; }
export function syncedDate() { return new Date(now()); }

// --- cloud save: localStorage is the offline cache, the cloud slot is a mirror ---
let syncState = 'synced'; // synced | saving | error (offline when !isHosted())
let pendingCloud = null; // serialized progression doc awaiting push
let lastCloudDoc = null; // serialized doc known to match the server slot
let saveTimer = null;
const syncListeners = new Set();

export function getSyncState() { return isHosted() ? syncState : 'offline'; }
export function onSyncChange(cb) { syncListeners.add(cb); }
function setSyncState(s) {
  if (syncState === s) return;
  syncState = s;
  for (const cb of syncListeners) cb(s);
}

function queueCloudSave(doc) {
  if (!isHosted()) return;
  const s = JSON.stringify(doc);
  if (s === lastCloudDoc) return; // nothing new since the last push/pull
  pendingCloud = s;
  setSyncState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushCloudSave(); }, CLOUD_DEBOUNCE_MS);
}

export async function flushCloudSave({ keepalive = false } = {}) {
  clearTimeout(saveTimer);
  if (!isHosted() || !pendingCloud) return;
  const payload = pendingCloud;
  try {
    const bytes = new TextEncoder().encode(payload);
    const body = JSON.stringify({ dataBase64: bytesToBase64(zipStore('timbergrid-progression.json', bytes)) });
    await api(`/me/cloud-saves/${slug}`, { method: 'PUT', body, keepalive });
    if (pendingCloud === payload) pendingCloud = null;
    lastCloudDoc = payload;
    setSyncState('synced');
  } catch (_) {
    setSyncState('error'); // local cache intact; the next save retries the push
  }
}

async function pullCloudSave() {
  try {
    const buf = await api(`/me/cloud-saves/${slug}`);
    const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(new Uint8Array(buf))));
    if (!doc || doc.version !== SAVE_VERSION || doc.checksum !== checksum(doc.data)) return false;
    // On conflict prefer the remote doc; localStorage stays the offline cache.
    lsSet('progression', doc);
    lastCloudDoc = JSON.stringify(doc);
    if (!pendingCloud) setSyncState('synced');
    return true;
  } catch (_) { return false; } // 404 = no save yet; the next local save uploads
}

// --- hosted init: token -> refresh schedule, nickname, cloud pull -----------------
let initDone = false;

export async function init() {
  if (initDone) return;
  initDone = true;
  const jwt = readLaunchToken();
  if (!jwt) return;
  const payload = decodeJwtPayload(jwt);
  if (!payload || !payload.sub || !payload.game_scope) return;
  token = jwt;
  sub = String(payload.sub);
  slug = String(payload.game_scope);
  scheduleRefresh();
  window.addEventListener('pagehide', () => { void flushCloudSave({ keepalive: true }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushCloudSave({ keepalive: true });
  });
  // Bound the boot-time wait: a stalled host must not black-screen the game.
  // Late results still land (nickname, remote doc into the local cache).
  await Promise.race([
    Promise.all([
      fetchNickname(sub).then(n => { profileName = n; }),
      pullCloudSave(),
    ]),
    new Promise(r => setTimeout(r, 10000)),
  ]);
}

// --- settings (per-game, persisted) -------------------------------------------
const DEFAULT_SETTINGS = {
  lang: 'en',
  theme: 'workshop',
  quality: 'auto', // auto | high | medium | low
  reducedMotion: false,
  highContrast: false,
  colorPalette: 'standard', // standard | deuteranopia | protanopia | tritanopia
  largeText: false,
  leftHanded: false,
  holdToDrag: true, // hold vs toggle pick-up; hold preserves the default drag-release placement
  timingAssist: false, // no timed mechanics exist, kept as a declared player override
  haptics: true,
  muted: false,
  volMusic: 0.5, volEffects: 0.8, volAmbience: 0.4, volVoice: 0,
  tutorialsDone: [],
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
}
export function saveSettings(s) { lsSet('settings', s); }

// --- profile (guest-local display name; hosted name comes from the platform) -----
export function loadProfile() {
  return lsGet('profile', { name: 'Guest', guest: true, createdAt: Date.now() });
}
export function saveProfile(p) { lsSet('profile', p); }

// --- progression: versioned, checksummed document, cloud-mirrored ----------------
const SAVE_VERSION = 1;

function checksum(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function loadProgression() {
  const doc = lsGet('progression', null);
  if (doc && doc.version === SAVE_VERSION && doc.checksum === checksum(doc.data)) return doc.data;
  return { journeyStage: 1, journeyBest: {}, bests: {}, achievements: {}, totalScore: 0, gamesPlayed: 0 };
}

export function saveProgression(data) {
  const doc = { version: SAVE_VERSION, data, checksum: checksum(data), savedAt: Date.now() };
  lsSet('progression', doc); // offline cache first; the cloud push is debounced
  queueCloudSave(doc);
}

// --- achievements: stable lowercase keys, idempotent unlocks, local --------------
// A pure browser game has no server-authoritative unlock path, so achievements
// stay local flags inside the cloud-saved progression document.
export const ACHIEVEMENTS = [
  { key: 'first_clear', name: 'First Clear', description: 'Clear your first line.' },
  { key: 'combo_master', name: 'Combo Master', description: 'Reach a 4-clear combo streak.' },
  { key: 'streak_week', name: 'Steady Hand', description: 'Play on 7 different days.' },
  { key: 'journey_20', name: 'Halfway There', description: 'Complete journey stage 20.' },
  { key: 'marathon', name: 'Marathon Bench', description: 'Score 1000 points in one round.' },
];

export function unlockAchievement(key) {
  const prog = loadProgression();
  if (prog.achievements[key]) return false; // idempotent
  if (!ACHIEVEMENTS.some(a => a.key === key)) return false;
  prog.achievements[key] = Date.now();
  saveProgression(prog);
  return true;
}

export function trackPlayDay(dayKey) {
  const days = lsGet('playDays', []);
  if (!days.includes(dayKey)) {
    days.push(dayKey);
    lsSet('playDays', days);
    if (days.length >= 7) unlockAchievement('streak_week');
  }
}

// --- leaderboards: local personal records + hosted read-only board ----------------
// Clients can never submit to a game leaderboard; ranked rounds keep their
// replay-enveloped records locally (and in the cloud doc). When the platform
// exposes a leaderboardId, its entries are read only.
export function submitScore(entry) {
  // entry: { mode, score, seed, contentVersion, rulesVersion, assists, durationMs, dayKey?, stage? }
  const boards = lsGet('leaderboards', []);
  boards.push({ ...entry, at: Date.now(), player: playerName() });
  boards.sort((a, b) => b.score - a.score);
  lsSet('leaderboards', boards.slice(0, 200));
}

export function getLeaderboard(filter = {}) {
  const boards = lsGet('leaderboards', []);
  return boards.filter(e => {
    if (filter.mode && e.mode !== filter.mode) return false;
    if (filter.dayKey && e.dayKey !== filter.dayKey) return false;
    return true;
  }).slice(0, 20);
}

export async function getHostedBoard() {
  if (!isHosted()) return null;
  try {
    const game = await api(`/games/${slug}`);
    if (!game || !game.leaderboardId) return null; // local records only
    const res = await api(`/leaderboards/${game.leaderboardId}/entries?pageSize=20`);
    const list = Array.isArray(res) ? res : (res.entries || []);
    const entries = [];
    for (const [i, e] of list.slice(0, 20).entries()) {
      const userId = e.userId ?? e.user_id ?? e.playerId;
      entries.push({
        rank: e.rank ?? i + 1,
        score: e.score,
        name: userId != null ? await nicknameFor(String(userId)) : 'Player ????????',
      });
    }
    return { entries, me: game.me || null };
  } catch (_) { return null; }
}

// --- funnel: anonymous local events only ------------------------------------------
// The platform has no per-game telemetry route reachable by launch tokens, so
// these events never leave the device.
export function funnelEvent(name, data = {}) {
  const ALLOWED = ['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error'];
  if (!ALLOWED.includes(name)) return;
  const events = lsGet('funnel', []);
  events.push({ name, at: Date.now(), ...data });
  lsSet('funnel', events.slice(-500));
}
