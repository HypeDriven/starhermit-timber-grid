// Timber Grid on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The controller and its state machine are the
// browser build's (src/main.js before the port): title → mode select →
// setup → active ↔ paused → results; the rules, content and session layer
// are the shared src/rules.js, src/content.js and src/session.js. Screens
// are starhermit:ui (screens.ts), the bench starhermit:scene (render.ts).
import { frame, onRender, onResume, onStart, onSuspend, onUpdate, preferences, onPreferencesChange } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded } from "starhermit:platform";
import { saves } from "starhermit:storage";
import * as rules from "../src/rules.js";
import * as content from "../src/content.js";
import * as sessionMod from "../src/session.js";
import * as render from "./render.ts";
import { lookFor } from "./quality.ts";
import { loadSfx, sfx, startAmbience, stopAmbience } from "./audio.ts";
import * as platform from "./platform.ts";
import { t, ts } from "./i18n.ts";
import { setStyle } from "./style.ts";
import { drawScreens, type Overlay } from "./screens.ts";

type Session = ReturnType<typeof sessionMod.createSession>;
type StartCfg = Parameters<typeof sessionMod.createSession>[0];
export type Theme = (typeof content.THEMES)[number];
type Events = { lineCount: number; clearedCells: number[]; cells: [number, number][]; shapeId: string; row: number; col: number };

export const app = {
  screen: "title" as "title" | "menu" | "active" | "paused" | "results",
  overlay: { kind: "title" } as Overlay | null,
  session: null as Session | null,
  settings: null as unknown as ReturnType<typeof platform.loadSettings>,
  progression: null as unknown as ReturnType<typeof platform.loadProgression>,
  selectedPiece: 0,
  cursor: [4, 4] as [number, number],
  dragging: null as { pieceIndex: number } | null,
  tutorialStep: 0,
  tutorialCollapsed: false,
  pausedAccum: 0,
  pauseStart: 0,
  pausedFrame: 0,
  elapsedBase: 0,
  toast: null as { text: string; until: number } | null,
  hostedBoard: null as { rank: number; score: number; name: string }[] | null,
};

// ------------------------------------------------------------------ utilities
export function themeById(id: string): Theme { return content.THEMES.find((x) => x.id === id) ?? content.THEMES[0]!; }
export function activeTheme(): Theme {
  const meta = app.session?.meta as { theme?: string } | undefined;
  return themeById(meta?.theme || app.settings.theme);
}
function haptic(): void { if (app.settings.haptics) vibrate(12); }
export function announce(msg: string): void { ui.announce(msg); }
export function toast(text: string): void {
  app.toast = { text, until: performance.now() + 2800 };
  announce(text);
}
export function show(overlay: Overlay | null, screen?: typeof app.screen): void {
  app.overlay = overlay;
  if (screen) app.screen = screen;
}

// ------------------------------------------------------------------ boot
onStart(() => {
  platform.initPlatform();
  app.settings = platform.loadSettings();
  app.progression = platform.loadProgression();
  setStyle();
  loadSfx();
  const errors = content.validateContent();
  if (errors.length) console.error("content validation failed", errors.join("; "));
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  render.setPalette(app.settings.colorPalette);
  render.setTheme(activeTheme());
  platform.funnelEvent("start");
  showTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onProgressMerged(() => {
  app.progression = platform.loadProgression();
  toast(t("progressMerged"));
});
platform.onSettingsChange(() => {
  app.settings = platform.loadSettings();
  render.setPalette(app.settings.colorPalette);
  render.setTheme(activeTheme());
});
onSessionEnded(() => toast(ts("signedOut")));
onSuspend(() => {
  if (app.screen === "active") pauseGame();
  void saves.flush();
});
onResume(() => { /* stays paused; the pause card resumes */ });

let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

// ------------------------------------------------------------------ screens
export function showTitle(): void {
  show({ kind: "title" }, "title");
  render.setGhost(null);
}
export function showModeSelect(): void { show({ kind: "modes" }, "menu"); }

export function startLearn(): void {
  startSession({ mode: "learn", seed: 424242, opts: { allowUndo: true } });
}

export function setupJourney(stageIdx: number): void {
  const stage = content.STAGES[Math.min(stageIdx, content.STAGES.length) - 1]!;
  show({ kind: "setup", setup: "journey", stage: stage.index }, "menu");
}
export function startJourney(stageIndex: number): void {
  const stage = content.STAGES[stageIndex - 1]!;
  startSession({
    mode: "journey", seed: stage.seed,
    opts: { goalScore: stage.goalScore, moveLimit: stage.moveLimit, allowUndo: false },
    meta: { stage: stage.index, theme: stage.theme },
  });
}
export function setupDaily(): void { show({ kind: "setup", setup: "daily" }, "menu"); }
export function startDaily(): void {
  const daily = content.dailySeed(new Date());
  startSession({ mode: "daily", seed: daily.seed, opts: { allowUndo: false }, meta: { dayKey: daily.dayKey } });
}
export function startPractice(d: { id: string }): void {
  startSession({
    mode: "practice", seed: Math.floor(Math.random() * 0x7fffffff),
    opts: { allowUndo: d.id === "relaxed" }, meta: { difficulty: d.id },
  });
}
export function startChallenge(c: (typeof content.CHALLENGES)[number]): void {
  startSession({
    mode: "challenge", seed: c.seed,
    opts: { goalScore: c.goalScore, moveLimit: c.moveLimit as number, allowUndo: false },
    meta: { challenge: c.id },
  });
}
export function showScores(back: Overlay | null): void {
  app.hostedBoard = null;
  show({ kind: "scores", back }, app.screen === "results" ? "results" : "menu");
  platform.getHostedBoard().then((b) => { app.hostedBoard = b; }, () => { app.hostedBoard = null; });
}

// ------------------------------------------------------------------ session control
function resetPlayState(): void {
  app.selectedPiece = 0;
  app.cursor = [4, 4];
  app.dragging = null;
  app.tutorialStep = 0;
  app.tutorialCollapsed = false;
  app.pausedAccum = 0;
  app.elapsedBase = 0;
}

export function startSession(cfg: StartCfg): void {
  app.session = sessionMod.createSession(cfg);
  resetPlayState();
  render.setTheme(activeTheme());
  render.resetCamera();
  show(null, "active");
  ui.setFocus(null);
  startAmbience();
  renderAll();
  updateGhost();
  if (cfg.mode === "learn") announceTutorial();
  else announce(t("objective") + ": " + objectiveText());
}

export function resumeDaily(snap: ReturnType<typeof sessionMod.snapshot>): void {
  app.session = sessionMod.restore(snap);
  resetPlayState();
  app.selectedPiece = Math.max(0, app.session.state.offer.findIndex((p: string | null) => p));
  // Keep the persisted play time; the restored session restarts its own clock.
  app.elapsedBase = app.session.state.elapsedMs || 0;
  render.setTheme(activeTheme());
  render.resetCamera();
  show(null, "active");
  ui.setFocus(null);
  startAmbience();
  renderAll();
  updateGhost();
  announce(t("resume"));
}

export function restartRound(): void {
  const s = app.session;
  if (!s) return;
  startSession({
    mode: s.mode, seed: s.state.seed,
    opts: { moveLimit: s.state.moveLimit, goalScore: s.state.goalScore, allowUndo: s.allowUndo },
    meta: s.meta,
  });
  platform.funnelEvent("retry");
}
export function playAgain(): void {
  const s = app.session;
  if (!s) return;
  startSession({
    mode: s.mode, seed: s.mode === "practice" ? Math.floor(Math.random() * 0x7fffffff) : s.state.seed,
    opts: { moveLimit: s.state.moveLimit, goalScore: s.state.goalScore, allowUndo: s.allowUndo },
    meta: s.meta,
  });
  platform.funnelEvent("retry");
}

export function objectiveText(): string {
  const s = app.session?.state;
  if (!s) return "";
  const parts: string[] = [];
  if (s.goalScore !== null) parts.push(`${t("goal")}: ${s.goalScore}`);
  if (s.moveLimit !== null) parts.push(`${t("moves")}: ${Math.max(0, s.moveLimit - s.placedCount)}`);
  if (!parts.length) parts.push(t("rulesSummary"));
  return parts.join(" · ");
}

export function pauseGame(): void {
  if (app.screen !== "active" || !app.session) return;
  app.pauseStart = Date.now();
  app.pausedFrame = frame().frame;
  app.dragging = null;
  sfx.pause();
  stopAmbience(); // the bed should not keep running behind the pause card
  show({ kind: "pause" }, "paused");
  render.setGhost(null);
}
export function resumeGame(): void {
  if (app.screen !== "paused") return;
  app.pausedAccum += Date.now() - app.pauseStart;
  show(null, "active");
  ui.setFocus(null);
  startAmbience();
  updateGhost();
}
export function endToTitle(): void {
  if (app.session && app.session.state.status === "active" && app.session.mode === "daily") saveDailySnapshot();
  app.session = null;
  stopAmbience();
  render.setTheme(activeTheme());
  showTitle();
}

// ------------------------------------------------------------------ tutorial
function announceTutorial(): void {
  const step = content.TUTORIAL_STEPS[app.tutorialStep];
  if (!step) return;
  announce(tutTitle(step) + ". " + tutText(step));
  platform.funnelEvent("tutorial_step", { step: step.id });
}
const TUT_KEYS: Record<string, string> = { "place-piece": "tutPlace", "clear-row": "tutClear" };
export const tutTitle = (st: { id: string }): string => t((TUT_KEYS[st.id] || "tutCombo") + "Title");
export const tutText = (st: { id: string }): string => t((TUT_KEYS[st.id] || "tutCombo") + "Text");

function tutorialAdvance(events: Events): void {
  if (app.session?.mode !== "learn") return;
  const step = content.TUTORIAL_STEPS[app.tutorialStep];
  if (!step) return;
  const satisfied = step.require === "place" || (step.require === "clear" && events.lineCount > 0);
  if (!satisfied) return;
  app.tutorialStep++;
  if (app.tutorialStep < content.TUTORIAL_STEPS.length) announceTutorial();
  else {
    const done = [...app.settings.tutorialsDone];
    if (!done.includes("learn")) {
      done.push("learn");
      app.settings.tutorialsDone = done;
      platform.saveSetting("tutorialsDone", done);
    }
    announce(t("tutorialDone"));
  }
}

// ------------------------------------------------------------------ rendering sync
function renderAll(events?: unknown): void {
  if (!app.session) return;
  render.setBoard(rules.serialize(app.session.state), events as render.PlaceEvents | undefined);
}

export function selectPiece(i: number): void {
  if (!app.session) return;
  if (!app.session.state.offer[i]) return;
  app.selectedPiece = i;
  sfx.select();
  updateGhost();
}
function selectNextPiece(): void {
  if (!app.session) return;
  const offer = app.session.state.offer;
  for (let step = 1; step <= offer.length; step++) {
    const i = (app.selectedPiece + step) % offer.length;
    if (offer[i]) { selectPiece(i); return; }
  }
}

function updateGhost(): void {
  if (!app.session || app.screen !== "active") { render.setGhost(null); return; }
  const s = app.session.state;
  const shapeId = s.offer[app.selectedPiece];
  if (!shapeId) { render.setGhost(null); return; }
  const cells = rules.shapeCells(shapeId, app.cursor[0], app.cursor[1]) as [number, number][];
  render.setGhost(cells, rules.canPlace(s.board, shapeId, app.cursor[0], app.cursor[1]));
}

export function tryPlace(): void {
  if (!app.session || app.screen !== "active") return;
  const s = app.session.state;
  if (!s.offer[app.selectedPiece]) {
    const first = s.offer.findIndex((p: string | null) => p);
    if (first < 0) return;
    app.selectedPiece = first;
  }
  const res = sessionMod.execute(app.session, { type: "place", pieceIndex: app.selectedPiece, row: app.cursor[0], col: app.cursor[1] });
  if (!res.ok) {
    sfx.invalid();
    haptic();
    announce(t("invalidBlocked"));
    return;
  }
  handlePlacement(res.events as unknown as Events);
}

function handlePlacement(events: Events): void {
  const sess = app.session!;
  const s = sess.state;
  s.elapsedMs = app.elapsedBase + (Date.now() - sess.startedAt - app.pausedAccum);
  sfx.place();
  haptic();
  if (events.lineCount > 0) {
    sfx.clear(events.lineCount);
    if (s.comboStreak > 1) sfx.combo(s.comboStreak);
    announce(t("announceClear", { n: events.lineCount, score: s.score }));
    if (platform.unlockAchievement("first_clear")) announce(t("achievements") + ": " + t("achFirstClear"));
    if (s.comboStreak >= 4) platform.unlockAchievement("combo_master");
    if (s.score >= 1000) platform.unlockAchievement("marathon");
  } else {
    announce(t("announcePlaced", { shape: events.shapeId, row: events.row + 1, col: events.col + 1, score: s.score }));
  }
  tutorialAdvance(events);
  if (!s.offer[app.selectedPiece]) {
    const first = s.offer.findIndex((p: string | null) => p);
    app.selectedPiece = first >= 0 ? first : 0;
  }
  renderAll(events);
  updateGhost();
  if (sess.mode === "daily") saveDailySnapshot();
  if (s.status === "over") finishRound();
}

export function doUndo(): void {
  if (!app.session) return;
  const res = sessionMod.execute(app.session, { type: "undo" });
  if (res.ok) {
    sfx.undo();
    renderAll({ undone: true });
    updateGhost();
  } else sfx.invalid();
}

export function showHint(): void {
  if (!app.session || app.screen !== "active") return;
  const actions = rules.legalActions(app.session.state);
  const a = actions.find((x: { pieceIndex: number; anchors: unknown[] }) => x.pieceIndex === app.selectedPiece && x.anchors.length)
    ?? actions.find((x: { anchors: unknown[] }) => x.anchors.length);
  if (!a) { sfx.invalid(); return; }
  app.selectedPiece = a.pieceIndex;
  app.cursor = [a.anchors[0]![0]!, a.anchors[0]![1]!];
  updateGhost();
  announce(`${t("hint")}: ${a.shapeId} @ ${a.anchors[0]![0]! + 1},${a.anchors[0]![1]! + 1}`);
}

export function fitBoard(): void { render.resetCamera(); }

// ------------------------------------------------------------------ round end
export function reasonText(reason: string | null): string {
  if (reason === "no-piece-fits") return t("noPieceFits");
  if (reason === "move-limit-reached") return t("moveLimitReached");
  if (reason === "move-limit-goal-met" || reason === "goal-score-reached") return t("goalMet");
  return reason || "";
}

function finishRound(): void {
  const sess = app.session!;
  const s = sess.state;
  stopAmbience();
  const won = s.terminalReason === "goal-score-reached" || s.terminalReason === "move-limit-goal-met";
  if (won) sfx.win(); else sfx.gameOver();
  announce(t("announceOver", { reason: reasonText(s.terminalReason), score: s.score }));

  const meta = sess.meta as { stage?: number; dayKey?: string; challenge?: string };
  const prog = platform.loadProgression();
  prog.gamesPlayed++;
  prog.totalScore += s.score;
  const bestKey = sess.mode + (meta.stage ? ":" + meta.stage : "") + (meta.dayKey ? ":" + meta.dayKey : "") + (meta.challenge ? ":" + meta.challenge : "");
  const prevBest = prog.bests[bestKey] as { score: number } | undefined;
  if (!prevBest || prevBest.score < s.score) prog.bests[bestKey] = { score: s.score, at: Date.now(), dayKey: meta.dayKey };
  let unlockJourney20 = false;
  if (sess.mode === "journey" && won && meta.stage === prog.journeyStage && prog.journeyStage < content.STAGES.length) {
    prog.journeyStage++;
    if (meta.stage! >= 20) unlockJourney20 = true;
  }
  platform.saveProgression(prog);
  if (unlockJourney20) platform.unlockAchievement("journey_20");
  app.progression = platform.loadProgression();

  if (sess.mode === "daily") {
    clearDailySnapshot();
    platform.trackPlayDay(meta.dayKey!);
  }
  if (sess.ranked) {
    const envelope = sessionMod.replayEnvelope(sess, content.CONTENT_VERSION);
    platform.submitScore({
      mode: sess.mode, score: s.score, seed: s.seed,
      contentVersion: content.CONTENT_VERSION, rulesVersion: rules.RULES_VERSION,
      assists: { undo: sess.allowUndo && sess.log.some((c: { type: string }) => c.type === "undo") },
      durationMs: s.elapsedMs, ...(meta.dayKey ? { dayKey: meta.dayKey } : {}), ...(meta.stage ? { stage: meta.stage } : {}),
      verified: sessionMod.verifyReplay(envelope).ok,
    });
  }
  platform.funnelEvent("round_end", { mode: sess.mode, score: s.score, reason: s.terminalReason });

  // Signed in, a ranked round also posts its score to the StarHermit
  // high-score board; the results line fills in with the player's rank there.
  const results: Overlay = { kind: "results", won, lb: sess.ranked && platform.signedIn() ? { key: "lbPosting" } : null };
  if (results.kind === "results" && results.lb) {
    platform.postLeaderboard(s.score).then((r) => {
      results.lb = !r.posted ? { key: "lbNotPosted" } : r.rank ? { key: "lbRank", vars: { rank: r.rank } } : { key: "lbPosted" };
    }, () => { results.lb = { key: "lbNotPosted" }; });
  }
  show(results, "results");
  render.setGhost(null);
}

// Daily snapshot persistence for a resume after leaving.
function saveDailySnapshot(): void { platform.storeSet("dailySnapshot", sessionMod.snapshot(app.session!)); }
export function loadDailySnapshot(): ReturnType<typeof sessionMod.snapshot> | null {
  const snap = platform.storeGet<ReturnType<typeof sessionMod.snapshot> | null>("dailySnapshot", null);
  const daily = content.dailySeed(new Date());
  const meta = snap?.meta as { dayKey?: string } | undefined;
  if (!snap || !meta || meta.dayKey !== daily.dayKey || snap.state.status !== "active") return null;
  return snap;
}
function clearDailySnapshot(): void { platform.storeRemove("dailySnapshot"); }

// ------------------------------------------------------------------ settings
export function setSetting<K extends keyof typeof app.settings>(key: K, value: (typeof app.settings)[K]): void {
  app.settings[key] = value;
  platform.saveSetting(key, value);
  render.setPalette(app.settings.colorPalette);
  render.setTheme(activeTheme());
  platform.funnelEvent("settings_change");
}

// ------------------------------------------------------------------ input
// The board takes keys and the pad when the UI has no focus: an arrow takes
// focus off a widget (a clicked button) and back to the board.
function moveCursor(dr: number, dc: number): void {
  app.cursor = [
    Math.max(0, Math.min(rules.N - 1, app.cursor[0] + dr)),
    Math.max(0, Math.min(rules.N - 1, app.cursor[1] + dc)),
  ];
  updateGhost();
  const s = app.session?.state;
  if (s) {
    const filled = s.board[app.cursor[0] * rules.N + app.cursor[1]] !== 0;
    announce(t("cellLabel", { row: app.cursor[0] + 1, col: app.cursor[1] + 1, state: t(filled ? "cellFilled" : "cellEmpty") }));
  }
}
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  if (app.screen === "active") {
    const dirs: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const d = dirs[e.action];
    if (d) { ui.setFocus(null); moveCursor(d[0], d[1]); return; }
    switch (e.action) {
      case "piece1": selectPiece(0); break;
      case "piece2": selectPiece(1); break;
      case "piece3": selectPiece(2); break;
      case "next_piece": selectNextPiece(); break;
      // Enter/Space on a focused widget is the widget's.
      case "place": if (!ui.focused() || e.source === "gamepad") tryPlace(); break;
      case "undo": doUndo(); break;
      case "hint": showHint(); break;
      case "pause": pauseGame(); break;
      case "camera": fitBoard(); break;
    }
  } else if (app.screen === "paused" && e.action === "pause" && app.overlay?.kind === "pause" && frame().frame !== app.pausedFrame) {
    // Only from the pause card itself: settings and help opened from it are nested.
    resumeGame();
  }
});

function boardPointer(x: number, y: number, press: boolean): void {
  if (app.screen !== "active") return;
  const cell = render.pickCell(x, y);
  if (!cell) return;
  if (cell[0] !== app.cursor[0] || cell[1] !== app.cursor[1]) { app.cursor = cell; updateGhost(); }
  if (press && !app.dragging) tryPlace(); // tap-to-place with the selected piece
}
function dragEnd(x: number, y: number): void {
  if (!app.dragging) return;
  app.dragging = null;
  if (app.screen !== "active") return;
  const cell = render.pickCell(x, y);
  if (cell && !ui.pointerOver()) { app.cursor = cell; tryPlace(); }
  updateGhost();
}
// Touch and the mouse can both report one tap: a pointer press right after a touch is skipped.
let lastTouch = -1;
onPointerMove((x, y) => {
  if (performance.now() - lastTouch < 600) return;
  if (app.dragging || !ui.pointerOver()) boardPointer(x, y, false);
});
onPointerButton((e) => {
  if (e.button !== 0 || performance.now() - lastTouch < 600) return;
  if (!e.pressed) { dragEnd(e.x, e.y); return; }
  if (ui.pointerOver()) return;
  boardPointer(e.x, e.y, true);
});
onTouch((e) => {
  if (!e.primary) return;
  lastTouch = performance.now();
  if (e.phase === "start") { if (!ui.pointerOver()) boardPointer(e.x, e.y, true); }
  else if (e.phase === "move") { if (app.dragging) boardPointer(e.x, e.y, false); }
  else if (e.phase === "end") dragEnd(e.x, e.y);
  else app.dragging = null;
});
/** A tray piece was pressed (pointer or finger): select it and, with hold-to-drag, pick it up. */
export function trayPress(i: number): void {
  selectPiece(i);
  if (app.settings.holdToDrag && app.screen === "active") app.dragging = { pieceIndex: i };
}

// ------------------------------------------------------------------ frame
onUpdate((dt) => {
  applyLook();
  render.update(dt);
  if (app.toast && performance.now() > app.toast.until) app.toast = null;
});
onRender(() => { drawScreens(); });
