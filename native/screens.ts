// The browser build's DOM shell as starhermit:ui, built every frame: the
// status bar (brand, objective, score, combo, Pause, the player), the game
// region with its rails (objective, journey, the lesson card; Hint, Undo, Fit
// board), the piece tray, the toast, and the cards (title, play modes,
// setups, Score Chase, pause, results, settings, help) as modal dialogs over
// the bench. The browser's media queries are the three layouts below, picked
// by the window's logical size: wide (rails as side columns), compact (the
// lesson across the top, the actions at the bottom) and short landscape
// (side columns, no brand or player chip, a slim tray).
import { frame, openMenu, clipboard } from "starhermit:engine";
import { bindingLabel } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import * as rules from "../src/rules.js";
import * as content from "../src/content.js";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import { t, ts } from "./i18n.ts";
import {
  activeTheme, app, doUndo, endToTitle, fitBoard, loadDailySnapshot, objectiveText, pauseGame, playAgain,
  reasonText, restartRound, resumeDaily, resumeGame, selectPiece, setSetting, setupDaily, setupJourney,
  show, showHint, showModeSelect, showScores, showTitle, startChallenge, startDaily, startJourney, startLearn,
  startPractice, toast, trayPress, tutText, tutTitle,
} from "./main.ts";

export type LbLine = { key: string; vars?: Record<string, string | number> } | null;
export type Overlay =
  | { kind: "title" }
  | { kind: "modes" }
  | { kind: "setup"; setup: "journey" | "daily"; stage?: number }
  | { kind: "practice" }
  | { kind: "challenge" }
  | { kind: "scores"; back: Overlay | null }
  | { kind: "pause" }
  | { kind: "results"; won: boolean; lb: LbLine }
  | { kind: "settings"; back: Overlay | null }
  | { kind: "help"; back: Overlay | null };

// Display names for content (the data stays English).
const cap = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);
const camel = (id: string): string => id.split("-").map(cap).join("");
const themeName = (th: { id: string }): string => t("theme" + cap(th.id));
const challengeName = (c: { id: string }): string => t("ch" + camel(c.id));
const challengeDesc = (c: { id: string }): string => t("ch" + camel(c.id) + "Desc");
const practiceName = (d: { id: string }): string => t("pr" + cap(d.id));
const practiceDesc = (d: { id: string }): string => t("pr" + cap(d.id) + "Desc");
const ACH_KEYS: Record<string, string> = { first_clear: "achFirstClear", combo_master: "achComboMaster", streak_week: "achStreakWeek", journey_20: "achJourney20", marathon: "achMarathon" };
const achName = (a: { key: string; name: string }): string => (ACH_KEYS[a.key] ? t(ACH_KEYS[a.key]!) : a.name);
const achDesc = (a: { key: string; description: string }): string => (ACH_KEYS[a.key] ? t(ACH_KEYS[a.key]! + "Desc") : a.description);
/** Built-in fallback names ('Guest', 'Player <id>') follow the game language. */
function displayName(name: string): string {
  const m = /^Player (\S+)$/.exec(String(name || ""));
  if (m) return t("playerN", { id: m[1]! });
  return name === "Guest" ? t("guest") : name;
}
const PALETTES = ["standard", "deuteranopia", "protanopia", "tritanopia"] as const;
const PAL_KEYS: Record<string, string> = { standard: "palStandard", deuteranopia: "palDeuteranopia", protanopia: "palProtanopia", tritanopia: "palTritanopia" };

// ------------------------------------------------------------------ widgets
function menuButton(label: string, primary = false, id?: string): boolean {
  const u = ui.style("menu-btn", primary && "menu-btn.primary");
  return (id ? u.id(id) : u).button(label);
}
function chipButton(label: string, id: string, extra?: string): boolean {
  return ui.style("chip-btn", extra).id(id).button(label);
}
const lastHeight = new Map<string, number>();
let openedAt = new Map<string, number>();

/** A modal card (the browser's .overlay-veil + .panel), scrolling when taller
 * than the window; `back` runs on Escape / East (not on the frame it opened). */
function card(key: string, title: string, layout: Layout, build: () => void, back?: () => void, footer?: () => void): void {
  const f = frame();
  if (!openedAt.has(key)) openedAt = new Map([[key, f.frame]]);
  const inner = layout.panelW - 51.2;
  // the window less the title, the card's padding and the footer (its buttons stay in view)
  const maxH = layout.lh * 0.92 - 90 - (footer ? (lastHeight.get(`${key}-foot`) ?? 0) + 10 : 0);
  const open = ui.dialog(key, title, true, () => {
    const body = (): void => {
      const r = ui.column(`${key}-body`, build, { width: inner, spacing: 9.9, align: "stretch" });
      lastHeight.set(key, r.height / layout.sc);
    };
    const h = lastHeight.get(key) ?? 0;
    if (h > maxH) ui.scrollArea(`${key}-scroll`, { width: inner + 12, height: Math.max(80, maxH) }, body);
    else body();
    if (footer) {
      const r = ui.column(`${key}-foot`, footer, { width: inner, spacing: 9.9, align: "stretch" });
      lastHeight.set(`${key}-foot`, r.height / layout.sc);
    }
  });
  if (!open && back && openedAt.get(key) !== f.frame) back();
}
function para(text: string, width: number, cls?: string): void {
  (cls ? ui.style(cls) : ui).paragraph(text, width);
}

/** A tray piece's shape: the browser's grid of 16 px cells, 3 px apart. */
function piecePreviewSize(shape: [number, number][], cell: number): { w: number; h: number } {
  const rows = Math.max(...shape.map((c) => c[0])) + 1, cols = Math.max(...shape.map((c) => c[1])) + 1;
  return { w: cols * cell + (cols - 1) * 3, h: rows * cell + (rows - 1) * 3 };
}

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; shortLand: boolean; narrow: boolean; panelW: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = (f.width - sa.left - sa.right) / sc, lh = (f.height - sa.top - sa.bottom) / sc;
  const shortLand = lw > lh && lh <= 500;
  return { lw, lh, sc, wide: lw >= 1024, shortLand, narrow: lw < 720 && !shortLand, panelW: Math.min(480, lw * 0.94) };
}

const pressed = new Map<number, boolean>();

export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const s = app.session?.state;
  const playing = !!app.session && (app.screen === "active" || app.screen === "paused" || app.screen === "results");
  let statusRect: ui.Rect = { x: 0, y: 0, width: 0, height: 0 };
  let regionRect: ui.Rect;
  let trayRect: ui.Rect = { x: 0, y: 0, width: 0, height: 0 };

  {
    // ---- status bar: the browser's wrapping flex row (brand first, the rest
    // after it), packed into lines by the items' measured widths.
    const items: { w: number; build: () => void; brand?: boolean }[] = [];
    const chip = (text: string): void => {
      items.push({ w: ui.measureText(text, { style: "hud-chip" }).width / L.sc + 19.2 /* the chip's padding */, build: () => { ui.style("hud-chip").label(text); } });
    };
    if (!L.shortLand) {
      const brand = t("title");
      items.push({ w: ui.measureText(brand, { style: "brand" }).width / L.sc, build: () => { ui.style("brand").label(brand); }, brand: true });
    }
    if (s) {
      chip(objectiveText());
      chip(`${t("score")}: ${s.score}`);
      if (s.comboStreak > 1) chip(`${t("comboStreak")} ×${s.comboStreak}`);
    }
    if (app.session && app.screen === "active") {
      const label = t("pause");
      items.push({ w: Math.max(44, ui.measureText(label, { kind: "button", style: "chip-btn" }).width / L.sc), build: () => { if (chipButton(label, "btn-pause")) pauseGame(); } });
    }
    if (!L.shortLand) {
      const name = displayName(platform.playerName());
      const st = platform.syncState();
      chip(st === "offline" ? name : `${name} · ${t("sync" + cap(st))}`);
    }
    const lines: (typeof items)[] = [[]];
    let used = 0;
    const avail = L.lw - 19.2;
    for (const it of items) {
      if (used > 0 && used + 8 + it.w > avail) { lines.push([]); used = 0; }
      lines[lines.length - 1]!.push(it);
      used += (used > 0 ? 8 : 0) + it.w;
    }
    statusRect = ui.column("statusbar", () => {
      lines.forEach((line, n) => {
        // The brand at the start, the rest of its line at the end (its margin-right: auto).
        const brand = line[0]?.brand ? line[0] : null;
        const rest = brand ? line.slice(1) : line;
        ui.row(`status-${n}`, () => {
          brand?.build();
          if (rest.length) ui.row(`status-${n}-rest`, () => { for (const it of rest) it.build(); }, { align: "center", spacing: 8 });
        }, { width: avail, align: "center", spacing: 8, justify: brand ? "space-between" : n === 0 ? "end" : "start" });
      });
    }, { style: "statusbar", width: L.lw, spacing: 8 });
    // ---- the game region (the bench shows through it)
    // (between the status bar and the tray, worked out below)
    // ---- tray
    trayRect = ui.place("tray", "bottom", () => ui.row("tray-row", () => {
      if (!app.session || !s) return;
      const order = s.offer.map((_: unknown, i: number) => i);
      if (app.settings.leftHanded) order.reverse();
      for (const i of order) {
        const shapeId = s.offer[i] as string | null;
        if (!shapeId) continue;
        const shape = rules.SHAPES[shapeId as keyof typeof rules.SHAPES] as [number, number][];
        const cellPx = L.shortLand ? 12 : f.height > f.width ? 18 : 16;
        const pv = piecePreviewSize(shape, cellPx);
        const min = L.shortLand ? 48 : 64;
        const pad = L.shortLand ? 4.8 : 8;
        const selected = i === app.selectedPiece;
        const color = activeTheme().piece;
        const res = ui.id(`piece-${i}`).widget(`${t("selectPiece")} ${i + 1}: ${shapeId}`, {
          role: "button",
          size: { width: Math.max(min, pv.w + pad * 2 + 4), height: Math.max(min, pv.h + pad * 2 + 4) },
          style: ["tray-piece", ...(L.shortLand ? ["tray-piece-compact"] : []), ...(selected ? ["tray-piece.selected"] : [])],
          disabled: app.screen !== "active",
          draw: (r, state) => {
            const k = state.scale;
            const ox = r.x + (r.width - pv.w * k) / 2, oy = r.y + (r.height - pv.h * k) / 2;
            const fillC = state.highContrast ? state.colors.text : color;
            for (const [cr, cc] of shape) {
              const x = ox + cc * (cellPx + 3) * k, y = oy + cr * (cellPx + 3) * k;
              draw.roundRect(x, y, cellPx * k, cellPx * k, 3 * k, fillC);
              draw.rect(x, y + (cellPx - 3) * k, cellPx * k, 3 * k, [0, 0, 0, 0.3]);
            }
          },
        });
        const was = pressed.get(i) ?? false;
        if (res.pressed && !was) trayPress(i);
        else if (res.activated && !was && !res.pressed) selectPiece(i); // keyboard / gamepad
        pressed.set(i, res.pressed);
      }
    }, { style: L.shortLand ? ["tray", "tray-compact"] : "tray", width: L.lw, justify: "center", align: "center", spacing: 19.2 }));
  }

  // ---- rails
  const statusH = statusRect.height / L.sc, trayH = trayRect.height / L.sc;
  let leftRect: ui.Rect | null = null, rightRect: ui.Rect | null = null;
  if (playing && app.session) {
    const side = L.wide || L.shortLand;
    const railW = side ? Math.min(208, L.lw * (L.shortLand ? 0.38 : 0.34)) : L.lw - 19.2;
    const mode = app.session.mode;
    const showObjective = L.wide;
    const showJourney = app.progression.journeyStage > 1 || mode === "journey";
    const lesson = mode === "learn" ? content.TUTORIAL_STEPS[app.tutorialStep] : undefined;
    if (showObjective || showJourney || lesson) {
      leftRect = ui.place("rail-left", { anchor: "top-start", x: 0, y: statusH }, () => {
        const inner = railW - 19.2 - 22.4;
        if (showObjective) ui.column("rail-objective", () => { ui.style("rail-title").heading(t("objective")); ui.style("rail-text").paragraph(objectiveText(), inner); }, { style: "rail-block", width: railW - 19.2 });
        if (showJourney) ui.column("rail-journey", () => { ui.style("rail-title").heading(t("journey")); ui.style("rail-text").label(`${t("stage")} ${app.progression.journeyStage} / ${content.STAGES.length}`); }, { style: "rail-block", width: railW - 19.2 });
        if (lesson) {
          ui.column("tutorial-card", () => {
            const title = `${app.tutorialStep + 1}/${content.TUTORIAL_STEPS.length} — ${tutTitle(lesson)}`;
            ui.label(title, { weight: "700" });
            if (!app.tutorialCollapsed) ui.style("tutorial-text").paragraph(tutText(lesson), inner);
            // the card can be tucked away so it never blocks board cells
            if (ui.style("chip-btn", "tutorial-toggle").id("lesson-toggle").button(app.tutorialCollapsed ? t("showLesson") : t("hideLesson"))) app.tutorialCollapsed = !app.tutorialCollapsed;
          }, { style: "tutorial-card", width: railW - 19.2 });
        }
      }, { style: "rail", spacing: 9.6, width: railW });
    }
    const actions = (): void => {
      if (chipButton(t("hint"), "btn-hint")) { showHint(); ui.setFocus(null); }
      if (app.session?.allowUndo && chipButton(t("undo"), "btn-undo")) { doUndo(); ui.setFocus(null); }
      if (chipButton(t("fitBoard"), "btn-fit")) { fitBoard(); ui.setFocus(null); }
    };
    if (app.screen === "active") {
      rightRect = ui.place("rail-right", side ? { anchor: "top-end", x: 0, y: statusH } : { anchor: "bottom-end", x: 0, y: trayH }, () => {
        (L.shortLand ? ui.column : ui.row)("rail-actions", actions, { style: "rail-block", spacing: 9 });
      }, { style: "rail", spacing: 9.6 });
    }
  }

  // ---- frame the board in the free part of the region (the browser's safe insets);
  // the region spans the window between the status bar and the tray.
  const top = statusRect.y + statusRect.height, bottom = trayRect.height ? trayRect.y : f.height;
  regionRect = { x: 0, y: top, width: f.width, height: Math.max(0, bottom - top) };
  fitBoardTo(regionRect, [leftRect, rightRect].filter((r): r is ui.Rect => !!r), L);

  // ---- toast
  if (app.toast) {
    ui.place("toast", { anchor: "bottom", x: 0, y: trayH + 16 }, () => {
      ui.style("toast").paragraph(app.toast!.text, Math.min(34 * 16, L.lw * 0.92) - 35.2);
    });
  }

  // ---- cards
  drawOverlay(L);
}

function fitBoardTo(region: ui.Rect, rails: ui.Rect[], L: Layout): void {
  const f = frame();
  const ins = { top: 0, bottom: 0, left: 0, right: 0 };
  const rw = region.width, rh = region.height;
  for (const b of rails) {
    if (!b.width || !b.height) continue;
    const x = b.x - region.x, y = b.y - region.y;
    if (L.wide || L.shortLand || (b.width <= rw * 0.5 && b.height > rh * 0.55)) {
      if (x + b.width / 2 < rw / 2) ins.left = Math.max(ins.left, x + b.width); else ins.right = Math.max(ins.right, rw - x);
    } else if (y + b.height / 2 < rh / 2) ins.top = Math.max(ins.top, y + b.height);
    else ins.bottom = Math.max(ins.bottom, rh - y);
  }
  let x = region.x + ins.left, y = region.y + ins.top;
  let w = rw - ins.left - ins.right, h = rh - ins.top - ins.bottom;
  // Fall back to the whole region when the rails cover too much.
  if (w < rw * 0.45 || h < rh * 0.45) { x = region.x; y = region.y; w = rw; h = rh; }
  if (w < 2 || h < 2 || !f.width || !f.height) return;
  render.frameBoard({
    x0: (x / f.width) * 2 - 1, x1: ((x + w) / f.width) * 2 - 1,
    y1: 1 - (y / f.height) * 2, y0: 1 - ((y + h) / f.height) * 2,
  }, f.width / f.height);
}

// ------------------------------------------------------------------ cards
function keysText(): string {
  const k = (...actions: string[]): string => actions.map((a) => bindingLabel(a)).join(" ");
  return t("helpKeys", {
    nav: k("up", "down", "left", "right"), pieces: k("piece1", "piece2", "piece3"), place: k("place"),
    undo: k("undo"), hint: k("hint"), pause: k("pause"), camera: k("camera"),
  });
}

function drawOverlay(L: Layout): void {
  const o = app.overlay;
  if (!o) { openedAt.clear(); return; }
  const inner = L.panelW - 51.2;
  switch (o.kind) {
    case "title": {
      const prog = app.progression;
      const daily = content.dailySeed(new Date());
      const dailyDone = !!prog.bests[`daily:${daily.dayKey}`];
      const resumeSnap = loadDailySnapshot();
      card("title", t("title"), L, () => {
        para(t("tagline"), inner, "tagline");
        if (menuButton(t("play"), true, "play")) showModeSelect();
        if (resumeSnap && menuButton(`${t("daily")} — ${t("resume")}`, false, "resume-daily")) resumeDaily(resumeSnap);
        if (menuButton(t("daily") + (dailyDone ? " ✓" : ""), false, "daily")) setupDaily();
        if (menuButton(`${t("journey")} — ${t("stage")} ${prog.journeyStage}`, false, "journey")) setupJourney(prog.journeyStage);
        if (menuButton(t("settings"), false, "settings")) show({ kind: "settings", back: { kind: "title" } });
        if (menuButton(t("help"), false, "help")) show({ kind: "help", back: { kind: "title" } });
        if (!platform.signedIn() && menuButton(ts("signIn"), false, "signin")) void requestSignIn().catch(() => undefined);
        const link = platform.inviteLink();
        if (link && menuButton(ts("invite"), false, "invite")) {
          try { clipboard.writeText(link); toast(ts("copied")); } catch { toast(ts("copyFail", { url: link })); }
        }
      });
      break;
    }
    case "modes":
      card("modes", t("play"), L, () => {
        if (menuButton(t("learn"), false, "learn")) startLearn();
        if (menuButton(t("journey"), false, "journey")) setupJourney(app.progression.journeyStage);
        if (menuButton(t("daily"), false, "daily")) setupDaily();
        if (menuButton(t("practice"), false, "practice")) show({ kind: "practice" });
        if (menuButton(t("challenge"), false, "challenge")) show({ kind: "challenge" });
        if (menuButton(t("scores"), false, "scores")) showScores({ kind: "modes" });
        if (menuButton(t("back"), false, "back")) showTitle();
      }, showTitle);
      break;
    case "setup": {
      let title: string, lines: (string | null)[], start: () => void;
      if (o.setup === "journey") {
        const stage = content.STAGES[(o.stage ?? 1) - 1]!;
        title = `${t("journey")} — ${t("stage")} ${stage.index} (${t(stage.difficulty)})` + (stage.mastery ? ` — ${t("mastery")}` : "");
        lines = [stage.mastery ? t("masteryStage") : null, `${t("goal")}: ${stage.goalScore}`, `${t("moves")}: ${stage.moveLimit}`, `${t("par")}: ${stage.par}`, `${t("expectedDuration")}: ~3 ${t("minutes")}`];
        start = () => startJourney(stage.index);
      } else {
        const daily = content.dailySeed(new Date());
        title = `${t("daily")} — ${daily.dayKey}`;
        lines = [`${t("goal")}: ${t("score")}`, `${t("expectedDuration")}: ~5 ${t("minutes")}`];
        start = startDaily;
      }
      card("setup", title, L, () => {
        para(t("rulesSummary"), inner);
        for (const l of lines) if (l) ui.style("list-item").paragraph(`• ${l}`, inner - 19.2);
        ui.style("ranked-line").label(t("ranked"));
        if (menuButton(t("start"), true, "start")) start();
        if (menuButton(t("back"), false, "back")) showModeSelect();
      }, showModeSelect);
      break;
    }
    case "practice":
      card("practice", t("practice"), L, () => {
        for (const d of content.PRACTICE_DIFFICULTIES) {
          if (menuButton(`${practiceName(d)} — ${practiceDesc(d)}`, false, `practice-${d.id}`)) startPractice(d);
        }
        if (menuButton(t("back"), false, "back")) showModeSelect();
      }, showModeSelect);
      break;
    case "challenge":
      card("challenge", t("challenge"), L, () => {
        for (const c of content.CHALLENGES) {
          if (menuButton(`${challengeName(c)} — ${challengeDesc(c)}`, false, `challenge-${c.id}`)) startChallenge(c);
        }
        if (menuButton(t("back"), false, "back")) showModeSelect();
      }, showModeSelect);
      break;
    case "scores": {
      const back = (): void => show(o.back, o.back?.kind === "results" ? "results" : "menu");
      const board = platform.getLeaderboard();
      const prog = app.progression;
      card("scores", t("scores"), L, () => {
        ui.style("section-title").heading(t("leaderboard"));
        if (board.length) {
          ui.grid("local-board", () => {
            for (const h of ["#", t("score"), t("colMode"), t("colSeed"), t("player")]) ui.style("cell-strong").label(h);
            board.slice(0, 10).forEach((e, i) => {
              for (const v of [String(i + 1), String(e.score), t(e.mode), String(e.seed), e.player ? displayName(e.player) : "—"]) ui.style("cell").label(v);
            });
          }, { columns: ["auto", "auto", { fr: 1 }, "auto", { fr: 1 }], gap: 0, width: inner, rowStyle: "score-row" });
        } else ui.label("—");
        const hosted = app.hostedBoard;
        if (hosted && hosted.length) {
          ui.style("section-title").heading(t("globalBoard"));
          ui.grid("global-board", () => {
            for (const h of ["#", t("player"), t("score")]) ui.style("cell-strong").label(h);
            for (const e of hosted) for (const v of [String(e.rank), displayName(e.name), String(e.score)]) ui.style("cell").label(v);
          }, { columns: ["auto", { fr: 1 }, "auto"], gap: 0, width: inner, rowStyle: "score-row" });
        }
        ui.style("section-title").heading(t("achievements"));
        for (const a of platform.ACHIEVEMENTS) ui.style("list-item").paragraph(`${prog.achievements[a.key] ? "✓" : "○"} ${achName(a)} — ${achDesc(a)}`, inner - 19.2);
      }, back, () => { if (menuButton(t("back"), false, "back")) back(); });
      break;
    }
    case "pause":
      card("pause", t("pause"), L, () => {
        if (menuButton(t("resume"), true, "resume")) resumeGame();
        if (menuButton(t("restart"), false, "restart")) restartRound();
        if (menuButton(t("settings"), false, "settings")) show({ kind: "settings", back: { kind: "pause" } });
        if (menuButton(t("help"), false, "help")) show({ kind: "help", back: { kind: "pause" } });
        if (menuButton(t("backToTitle"), false, "title")) endToTitle();
      }, resumeGame);
      break;
    case "results": {
      const sess = app.session!;
      const s = sess.state;
      const b = s.breakdown;
      card("results", o.won ? t("stageClear") : t("gameOver"), L, () => {
        ui.style("reason").paragraph(`${t("reason")}: ${reasonText(s.terminalReason)}`, inner);
        ui.style("reason").label(`${t("journey")}: ${t("stage")} ${app.progression.journeyStage} / ${content.STAGES.length}`);
        ui.style("big-score").label(`${t("score")}: ${s.score}`);
        if (o.lb) ui.style("reason").paragraph(ts(o.lb.key, o.lb.vars), inner);
        ui.style("section-title").heading(t("breakdown"));
        ui.grid("breakdown", () => {
          for (const [k, v] of [["placed", b.place], ["cleared", b.clear], ["multi", b.multi], ["combo", b.combo]] as const) {
            ui.style("cell").label(t(k));
            ui.style("cell").label(String(v));
          }
          ui.style("cell-strong").label(t("total"));
          ui.style("cell-strong").label(String(s.score));
        }, { columns: [{ fr: 1 }, "auto"], gap: 0, width: inner, rowStyle: "score-row" });
      }, undefined, () => {
        if (menuButton(t("playAgain"), true, "again")) playAgain();
        const meta = sess.meta as { stage?: number };
        if (sess.mode === "journey" && o.won && (meta.stage ?? 0) < content.STAGES.length && menuButton(t("nextStage"), false, "next")) setupJourney(app.progression.journeyStage);
        if (menuButton(t("scores"), false, "scores")) showScores(o);
        if (menuButton(t("backToTitle"), false, "title")) endToTitle();
      });
      break;
    }
    case "settings": {
      const back = (): void => show(o.back, o.back?.kind === "pause" ? "paused" : app.screen);
      const st = app.settings;
      card("settings", t("settings"), L, () => {
        const row = (label: string, control: () => void): void => {
          ui.row(`row-${label}`, () => { ui.label(label); ui.spacer(); control(); }, { style: "setting-row", width: inner, align: "center", spacing: 18 });
        };
        const themes = content.THEMES;
        row(t("theme"), () => {
          const i = Math.max(0, themes.findIndex((th) => th.id === st.theme));
          const n = ui.id("set-theme").select(t("theme"), i, themes.map(themeName));
          if (n !== i) setSetting("theme", themes[n]!.id);
        });
        row(t("colorPalette"), () => {
          const i = Math.max(0, PALETTES.indexOf(st.colorPalette as (typeof PALETTES)[number]));
          const n = ui.id("set-palette").select(t("colorPalette"), i, PALETTES.map((p) => t(PAL_KEYS[p]!)));
          if (n !== i) setSetting("colorPalette", PALETTES[n]!);
        });
        for (const key of ["leftHanded", "holdToDrag", "haptics"] as const) {
          const v = ui.id(`set-${key}`).checkbox(t(key), st[key]);
          if (v !== st[key]) setSetting(key, v);
        }
        // Language, sound, graphics, controls and accessibility are the runtime's Options.
        if (menuButton(`${t("runtimeOptions")} …`, false, "options")) openMenu();
      }, back, () => { if (menuButton(t("back"), true, "back")) back(); });
      break;
    }
    case "help": {
      const back = (): void => show(o.back, o.back?.kind === "pause" ? "paused" : app.screen);
      card("help", t("howToPlay"), L, () => {
        const help = (title: string, text: string): void => {
          ui.column(`help-${title}`, () => { ui.style("section-title").heading(title); ui.style("help-text").paragraph(text, inner - 25.6); }, { style: "help-card", width: inner });
        };
        help(t("play"), t("helpPlace"));
        help(t("cleared"), t("helpClear"));
        help(t("comboStreak"), t("helpCombo"));
        help("⌨", keysText());
      }, back, () => { if (menuButton(t("back"), true, "back")) back(); });
      break;
    }
  }
}
