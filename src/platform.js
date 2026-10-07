// Timber Grid — platform adapter over window.StarHermit (starhermit-sdk.js):
// launch token + renewal, sign-in, profile nickname, the game:<slug> cloud
// slot for progression, settings KV, controls, invite link and the read-only
// platform board — plus local settings/leaderboards/achievements. Guest
// practice works fully locally with no network calls; launch tokens are never
// persisted. The client never calls the game's own server.js routes, on any
// host (loopback included); daily boundaries use the local clock.

const LS_PREFIX = 'timbergrid.';
const CLOUD_DEBOUNCE_MS = 2000;
const SETTINGS_PUSH_MS = 800;

/** Keyboard actions (KeyboardEvent.code) — mirrors control.* in starhermit.txt. */
export const DEFAULT_BINDINGS = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  piece1: ['Digit1'], piece2: ['Digit2'], piece3: ['Digit3'],
  place: ['Enter', 'Space'], undo: ['KeyU'], hint: ['KeyH'], pause: ['KeyP', 'Escape'], camera: ['KeyC'],
};

const SH = (typeof globalThis !== 'undefined' && globalThis.StarHermit) || null;

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
export function isHosted() { return !!(SH && SH.signedIn); }
export function canSignIn() { return !!(SH && SH.canSignIn()); }
export function signIn() { return !!(SH && SH.signIn()); }
/** Share link that friends the recipient and invites them back; null offline. */
export function inviteLink() { return isHosted() ? SH.inviteLink() : null; }
const authListeners = new Set();
/** cb({signedIn}) when the SDK signs out (renewal refused). */
export function onAuthChange(cb) { authListeners.add(cb); }

// --- profile nickname (never /api/v1/me, never usernames) ------------------------
let profileName = null;

export function playerName() { return profileName || loadProfile().name; }

async function nicknameFor(userId) {
  const p = SH ? await SH.profile(String(userId)) : null;
  return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
}

// --- time: local clock ---------------------------------------------------------
export function syncedDate() { return new Date(); }

// --- cloud save: localStorage is the offline cache, the cloud slot is a mirror ---
let syncState = 'synced'; // synced | saving | error (offline when !isHosted())
let lastCloudDoc = null; // serialized doc known to match the server slot
// Pushes wait for the start-up pull: one that lands after the 10 s boot bound must
// not find a stale local doc already queued, which would overwrite the newer remote.
let cloudPulled = false;
let deferredDoc = null;
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
  if (!cloudPulled) { deferredDoc = doc; return; }
  const s = JSON.stringify(doc);
  if (s === lastCloudDoc) return; // nothing new since the last push/pull
  lastCloudDoc = s;
  setSyncState('saving');
  SH.saveJSON(doc, CLOUD_DEBOUNCE_MS);
}

export function flushCloudSave({ keepalive = false } = {}) {
  return isHosted() ? SH.flushSave(keepalive) : Promise.resolve(false);
}

async function pullCloudSave() {
  const doc = await SH.loadJSON();
  if (!doc || doc.version !== SAVE_VERSION || doc.checksum !== checksum(doc.data)) return false;
  // On conflict prefer the remote doc; localStorage stays the offline cache.
  lsSet('progression', doc);
  lastCloudDoc = JSON.stringify(doc);
  setSyncState('synced');
  return true;
}

// --- settings KV + controls -------------------------------------------------------
let pushedPrefs = {};
let prefTimer = null;
const prefKeys = () => [...Object.keys(DEFAULT_SETTINGS), 'graphics'];
function pickPrefs(s) {
  const out = {};
  for (const k of prefKeys()) if (s && s[k] !== undefined) out[k] = s[k];
  return out;
}

/** Adopt platform-stored preferences into the local settings (platform wins). */
async function loadPlatformSettings() {
  const remote = await SH.getSettings();
  const local = loadSettings();
  const patch = {};
  for (const k of prefKeys()) if (remote && remote[k] != null) patch[k] = remote[k];
  pushedPrefs = { ...pickPrefs(local), ...patch };
  if (Object.keys(patch).length) lsSet('settings', { ...local, ...patch });
}

function pushSettings(s) {
  if (!isHosted()) return;
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    const prefs = pickPrefs(s), diff = {};
    for (const k of prefKeys()) {
      if (JSON.stringify(prefs[k]) !== JSON.stringify(pushedPrefs[k])) diff[k] = prefs[k] ?? null;
    }
    if (!Object.keys(diff).length) return;
    Object.assign(pushedPrefs, diff);
    SH.patchSettings(diff);
  }, SETTINGS_PUSH_MS);
}

let bindings = Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, v.slice()]));
/** Effective keyboard bindings (platform overrides applied at init). */
export function getBindings() { return bindings; }

// --- init: SDK token, nickname, cloud pull, platform settings + controls ----------
let initDone = false;

export async function init() {
  if (initDone) return;
  initDone = true;
  if (!SH) return;
  SH.init();
  SH.on('saved', (ok) => setSyncState(ok ? 'synced' : 'error'));
  SH.on('auth', (a) => {
    if (!a.signedIn) profileName = null;
    for (const cb of syncListeners) cb(getSyncState());
    for (const cb of authListeners) cb(a);
  });
  if (!isHosted()) { cloudPulled = true; return; }
  window.addEventListener('pagehide', () => { void flushCloudSave({ keepalive: true }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushCloudSave({ keepalive: true });
  });
  // Bound the boot-time wait: a stalled host must not black-screen the game.
  // Late results still land (nickname, remote doc into the local cache).
  await Promise.race([
    Promise.all([
      nicknameFor(SH.userId).then(n => { profileName = n; }),
      // The remote doc wins; a save deferred meanwhile is pushed only if none was adopted.
      pullCloudSave().catch(() => false).then((adopted) => {
        cloudPulled = true;
        if (!adopted && deferredDoc) queueCloudSave(deferredDoc);
        deferredDoc = null;
      }),
      loadPlatformSettings(),
      SH.loadBindings(DEFAULT_BINDINGS).then(b => { bindings = b; }),
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
export function saveSettings(s) { lsSet('settings', s); pushSettings(s); }

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
  const r = await SH.leaderboard(null, { pageSize: 20 });
  if (!r || !r.board) return null; // local records only
  const entries = [];
  for (const [i, e] of (r.items || []).slice(0, 20).entries()) {
    entries.push({
      rank: e.rank ?? i + 1,
      score: e.score,
      name: e.userId != null ? await nicknameFor(String(e.userId)) : 'Player',
    });
  }
  return { entries, me: null };
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
