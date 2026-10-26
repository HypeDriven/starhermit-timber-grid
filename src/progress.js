// Timber Grid — progression and settings data, pure (no host API): the
// default documents, the two-device merge, and the migration of what the
// browser build (starhermit-sdk.js) left in the player's account: its cloud
// save (a ZIP with one save.json: { version, data, checksum, savedAt }) and its
// per-player settings keys. The native client (native/platform.ts) and the
// Node tests share it.

export const SAVE_VERSION = 1;

/**
 * @typedef {{ journeyStage: number, journeyBest: Record<string, any>, bests: Record<string, any>,
 *   achievements: Record<string, number>, totalScore: number, gamesPlayed: number }} Progression
 */

/** @returns {Progression} */
export function defaultProgression() {
  return { journeyStage: 1, journeyBest: {}, bests: {}, achievements: {}, totalScore: 0, gamesPlayed: 0 };
}

/** FNV-1a over the JSON, as the browser build checksummed its save. */
export function checksum(obj) {
  const str = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A progression object with every field present and of its type.
 * @param {any} p
 * @returns {Progression}
 */
export function normalizeProgression(p) {
  const base = defaultProgression();
  if (!p || typeof p !== 'object') return base;
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    ...base,
    ...p,
    journeyStage: Math.max(1, Math.floor(Number(p.journeyStage) || 1)),
    journeyBest: obj(p.journeyBest),
    bests: obj(p.bests),
    achievements: obj(p.achievements),
    totalScore: Math.max(0, Number(p.totalScore) || 0),
    gamesPlayed: Math.max(0, Number(p.gamesPlayed) || 0),
  };
}

/**
 * Progress from two devices: the furthest journey stage, the better best per
 * journey stage / mode key, achievements united (earliest unlock), and the
 * larger totals (the sides may share history, so they are not summed).
 */
/**
 * @param {any} a
 * @param {any} b
 * @returns {Progression}
 */
export function mergeProgression(a, b) {
  a = normalizeProgression(a); b = normalizeProgression(b);
  const bestOf = (x, y) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y || {})) {
      const p = out[k];
      const pv = p && typeof p === 'object' ? p.score : p;
      const vv = v && typeof v === 'object' ? v.score : v;
      if (p == null || (Number(vv) || 0) > (Number(pv) || 0)) out[k] = v;
    }
    return out;
  };
  const achievements = { ...a.achievements };
  for (const [k, at] of Object.entries(b.achievements || {})) achievements[k] = achievements[k] ? Math.min(achievements[k], at) : at;
  return {
    ...a, ...b,
    journeyStage: Math.max(a.journeyStage || 1, b.journeyStage || 1),
    journeyBest: bestOf(a.journeyBest, b.journeyBest),
    bests: bestOf(a.bests, b.bests),
    achievements,
    totalScore: Math.max(a.totalScore || 0, b.totalScore || 0),
    gamesPlayed: Math.max(a.gamesPlayed || 0, b.gamesPlayed || 0),
  };
}

/**
 * The progression in a browser-build cloud save (the text of its save.json),
 * or null when it is not one (wrong version, bad checksum, not JSON).
 */
/**
 * @param {string | null} text
 * @returns {Progression | null}
 */
export function progressionFromBrowserSave(text) {
  if (typeof text !== 'string') return null;
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || doc.version !== SAVE_VERSION || doc.checksum !== checksum(doc.data)) return null;
  return normalizeProgression(doc.data);
}

/** The game's own settings (starhermit:storage `settings`, kept as game.<key>). */
/** @type {{ theme: string, colorPalette: string, leftHanded: boolean, holdToDrag: boolean, haptics: boolean, tutorialsDone: string[] }} */
export const DEFAULT_SETTINGS = {
  theme: 'workshop',
  colorPalette: 'standard', // standard | deuteranopia | protanopia | tritanopia
  leftHanded: false,
  holdToDrag: true, // hold vs toggle pick-up; hold keeps the drag-release placement
  haptics: true,
  tutorialsDone: [],
};

/** Keys the browser build kept in the account's per-player settings. */
export const BROWSER_SETTING_KEYS = [
  'theme', 'quality', 'reducedMotion', 'highContrast', 'colorPalette', 'largeText', 'leftHanded',
  'holdToDrag', 'timingAssist', 'haptics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice',
  'tutorialsDone', 'graphics',
];

/** A browser-build setting's value as the native client keeps it, or undefined (dropped). */
/**
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
export function migrateBrowserSetting(key, value) {
  const d = DEFAULT_SETTINGS;
  if (!(key in d)) return undefined; // sound, graphics and accessibility are the runtime's now
  if (key === 'tutorialsDone') return Array.isArray(value) ? value.filter((x) => typeof x === 'string') : undefined;
  if (typeof d[key] === 'boolean') return typeof value === 'boolean' ? value : undefined;
  return typeof value === 'string' ? value : undefined;
}
