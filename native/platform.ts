// The game's data and the StarHermit platform, on the runtime's modules:
// - progression (journey stage, bests, achievements, totals) is the game's
//   save (starhermit:storage `saves`): on the device and in the player's cloud
//   slot, two devices' progress merged on a conflict (src/progress.js). A slot
//   the browser build wrote (the JS SDK's ZIP with save.json, key
//   game:<slug>) shows as foreign and is converted and replaced once;
// - the game's own settings (theme, palette, left-handed, hold-to-drag,
//   haptics, finished tutorials) are `settings` (game.<key>, synced with the
//   account); the browser build's settings keys are migrated and removed;
// - device-only records (ranked rounds, play days, the daily round in
//   progress, funnel events) are `storage`;
// - ranked scores go to the high-score board through score-script.js: a
//   practice session whose socket carries {type:'result', scores}, as the
//   JS SDK's submitScores did.
import { connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, profile, sessions } from "starhermit:platform";
import { saves, settings, storage } from "starhermit:storage";
import type { JsonValue } from "starhermit:engine";
import {
  BROWSER_SETTING_KEYS, DEFAULT_SETTINGS, defaultProgression, mergeProgression, migrateBrowserSetting,
  normalizeProgression, progressionFromBrowserSave,
} from "../src/progress.js";

export type Progression = ReturnType<typeof defaultProgression>;
export type Settings = typeof DEFAULT_SETTINGS;

// --- progression ----------------------------------------------------------------------
let progression: Progression = normalizeProgression(null);
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function adopted(): void { for (const fn of mergedListeners) fn(); }

export function loadProgression(): Progression { return JSON.parse(JSON.stringify(progression)) as Progression; }
export function saveProgression(p: Progression): void {
  progression = normalizeProgression(p);
  saves.save(progression as unknown as JsonValue, { schema: 1 });
}

saves.onConflict((local, remote) => ({ merged: mergeProgression(local?.data, remote.data) as unknown as JsonValue }));
let lastSavedAt = 0;
/** Reads the device's save and the player's invite link (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  progression = normalizeProgression(cur?.data);
  lastSavedAt = cur?.savedAt ?? 0;
  refreshInvite();
  if (saves.state() === "foreign") migrateForeign();
}
saves.onStatus((_status, state) => {
  if (state === "foreign") migrateForeign();
  // The account's save replaced the device's (another device saved last): adopt it.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    const next = normalizeProgression(cur.data);
    if (JSON.stringify(next) !== JSON.stringify(progression)) { progression = next; adopted(); }
  }
  for (const fn of syncListeners) fn();
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const fromBrowser = progressionFromBrowserSave(old.text);
  const merged = fromBrowser ? mergeProgression(progression, fromBrowser) : progression;
  progression = normalizeProgression(merged);
  saves.save(progression as unknown as JsonValue, { schema: 1, replaceForeign: true });
  if (fromBrowser) adopted();
}

// --- sync state for the player chip -------------------------------------------------------
const syncListeners = new Set<() => void>();
export function onSyncChange(fn: () => void): void { syncListeners.add(fn); }
/** offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}

// --- settings -------------------------------------------------------------------------------
export function loadSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS, tutorialsDone: [...DEFAULT_SETTINGS.tutorialsDone] } as Settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = settings.get(key);
    if (v === undefined) continue;
    const m = migrateBrowserSetting(key, v);
    if (m !== undefined) (out as Record<string, unknown>)[key] = m;
  }
  return out;
}
export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.set(key, value as unknown as JsonValue);
}
const settingsListeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }
settings.onChange(() => { for (const fn of settingsListeners) fn(); });
// The browser build's per-player settings: kept where the game still has the
// setting (unless this game set it since), then removed from the account.
settings.onLegacy(() => {
  const keys = settings.legacyKeys() ?? [];
  let changed = false;
  for (const key of keys) {
    if (!BROWSER_SETTING_KEYS.includes(key)) continue;
    const v = migrateBrowserSetting(key, settings.legacy(key));
    if (v !== undefined && settings.get(key) === undefined) { settings.set(key, v as JsonValue); changed = true; }
    settings.removeLegacy(key);
  }
  if (changed) for (const fn of settingsListeners) fn();
});

// --- device-only records ---------------------------------------------------------------------
function getJson<T>(key: string, fallback: T): T {
  try { const v = storage.getJson(key); return v === null ? fallback : (v as unknown as T); } catch { return fallback; }
}
function setJson(key: string, v: unknown): void {
  try { storage.setJson(key, v as JsonValue); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
}
export function storeGet<T>(key: string, fallback: T): T { return getJson(key, fallback); }
export function storeSet(key: string, v: unknown): void { setJson(key, v); }
export function storeRemove(key: string): void { try { storage.remove(key); } catch { /* gone */ } }

// --- achievements: stable lowercase keys, idempotent unlocks, kept in the progression --------
export const ACHIEVEMENTS = [
  { key: "first_clear", name: "First Clear", description: "Clear your first line." },
  { key: "combo_master", name: "Combo Master", description: "Reach a 4-clear combo streak." },
  { key: "streak_week", name: "Steady Hand", description: "Play on 7 different days." },
  { key: "journey_20", name: "Halfway There", description: "Complete journey stage 20." },
  { key: "marathon", name: "Marathon Bench", description: "Score 1000 points in one round." },
];
export function unlockAchievement(key: string): boolean {
  const prog = loadProgression();
  if (prog.achievements[key]) return false;
  if (!ACHIEVEMENTS.some((a) => a.key === key)) return false;
  prog.achievements[key] = Date.now();
  saveProgression(prog);
  return true;
}
export function trackPlayDay(dayKey: string): void {
  const days = getJson<string[]>("playDays", []);
  if (days.includes(dayKey)) return;
  days.push(dayKey);
  setJson("playDays", days);
  if (days.length >= 7) unlockAchievement("streak_week");
}

// --- the player -----------------------------------------------------------------------------
export function playerName(): string { return player()?.displayName ?? "Guest"; }
let invite: string | null = null;
function refreshInvite(): void {
  invite = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
onPlayerChange(() => refreshInvite());
export function signedIn(): boolean { return !!player(); }

// --- leaderboards ----------------------------------------------------------------------------
export interface RankedEntry { mode: string; score: number; seed: number; dayKey?: string; stage?: number; at?: number; player?: string; [k: string]: unknown }
export function submitScore(entry: RankedEntry): void {
  const boards = getJson<RankedEntry[]>("leaderboards", []);
  boards.push({ ...entry, at: Date.now(), player: playerName() });
  boards.sort((a, b) => b.score - a.score);
  setJson("leaderboards", boards.slice(0, 200));
}
export function getLeaderboard(): RankedEntry[] { return getJson<RankedEntry[]>("leaderboards", []).slice(0, 20); }

async function highScoreBoard(): Promise<{ id: string } | null> {
  const list = await leaderboards.list();
  return list.find((b) => b.key === "high-score") ?? list[0] ?? null;
}

/** Signed in only: post a ranked round's score through score-script.js; { posted, rank }. */
export async function postLeaderboard(score: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    const socket = connectGame(sessionId);
    accepted = await new Promise<string[]>((resolve) => {
      const done = setTimeout(() => resolve([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") { clearTimeout(done); resolve(Array.isArray(d.accepted) ? d.accepted : []); }
      });
      socket.on("stopped", () => { clearTimeout(done); resolve([]); });
    }).finally(() => socket.close());
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const board = await highScoreBoard();
    if (!board) return { posted: true, rank: null };
    const r = await leaderboards.entries(board.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

/** The platform's high-score board (top 20, players by display name), or null. */
export async function getHostedBoard(): Promise<{ rank: number; score: number; name: string }[] | null> {
  if (!player()) return null;
  const board = await highScoreBoard().catch(() => null);
  if (!board) return null;
  const r = await leaderboards.entries(board.id, { pageSize: 20 });
  return Promise.all(r.items.slice(0, 20).map(async (e, i) => ({
    rank: e.rank ?? i + 1,
    score: e.score,
    name: await profile(e.userId).then((p) => p.displayName, () => e.username || "Player"),
  })));
}

// --- funnel: anonymous local events only (never leave the device) ------------------------------
export function funnelEvent(name: string, data: Record<string, unknown> = {}): void {
  const ALLOWED = ["start", "tutorial_step", "round_end", "retry", "settings_change", "error"];
  if (!ALLOWED.includes(name)) return;
  const events = getJson<unknown[]>("funnel", []);
  events.push({ name, at: Date.now(), ...data });
  setJson("funnel", events.slice(-500));
}
