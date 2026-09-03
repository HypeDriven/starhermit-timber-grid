// Timber Grid — platform adapter: host time sync, local profile, settings,
// progression, achievements, leaderboards. Offline-local after initial load.
// Guest practice works fully locally; no tokens are ever persisted.

const API_BASE = '/api/v1';
const LS_PREFIX = 'timbergrid.';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (_) {}
}

// --- server time sync (round-trip adjusted) ---------------------------------
// /api/v1/time is the only host route guaranteed to exist; it doubles as the
// hosting probe. Every other hosted feature degrades to a local no-op.
let timeOffset = 0; // serverNow - clientNow, ms
let hosted = false;

export function isHosted() { return hosted; }

export async function syncTime() {
  try {
    const t0 = Date.now();
    const res = await fetch(`${API_BASE}/time`, { cache: 'no-store' });
    const t1 = Date.now();
    if (!res.ok) return false;
    const data = await res.json();
    if (typeof data.time !== 'number') return false;
    const rtt = t1 - t0;
    timeOffset = data.time - (t0 + rtt / 2);
    hosted = true;
    return true;
  } catch (_) { hosted = false; return false; }
}

export function now() { return Date.now() + timeOffset; }
export function syncedDate() { return new Date(now()); }

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
  holdToDrag: false, // hold vs toggle pick-up
  timingAssist: false,
  haptics: true,
  muted: false,
  volMusic: 0.5, volEffects: 0.8, volAmbience: 0.4, volVoice: 0,
  tutorialsDone: [],
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...lsGet('settings', {}) };
}
export function saveSettings(s) { lsSet('settings', s); }

// --- profile (guest-local) ------------------------------------------------------
export function loadProfile() {
  return lsGet('profile', { name: 'Guest', guest: true, createdAt: Date.now() });
}
export function saveProfile(p) { lsSet('profile', p); }

// --- progression: versioned, checksummed cloud-save-shaped document --------------
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
  lsSet('progression', { version: SAVE_VERSION, data, checksum: checksum(data), savedAt: Date.now() });
}

// --- achievements: stable lowercase keys, idempotent unlocks ----------------------
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

// --- leaderboards: local global + friends-filtered views ---------------------------
// Every submission carries ruleset, content version, seed, assists, duration.
export function submitScore(entry) {
  // entry: { mode, score, seed, contentVersion, rulesVersion, assists, durationMs, dayKey?, stage? }
  const boards = lsGet('leaderboards', []);
  boards.push({ ...entry, at: Date.now(), player: loadProfile().name });
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

// Anonymous funnel events (aggregated, no personal data). Stored locally,
// sent only when a host endpoint exists and consent was given.
export function funnelEvent(name, data = {}) {
  const ALLOWED = ['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error'];
  if (!ALLOWED.includes(name)) return;
  const events = lsGet('funnel', []);
  events.push({ name, at: Date.now(), ...data });
  lsSet('funnel', events.slice(-500));
}

// Presence heartbeat (throttled, only while actively playing).
// The host offers no presence route, so this is a local no-op; it never
// issues a request.
let lastBeat = 0;
export async function presenceHeartbeat() {
  const t = Date.now();
  if (t - lastBeat < 30000) return;
  lastBeat = t;
}
