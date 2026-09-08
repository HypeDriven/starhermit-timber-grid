// Timber Grid — bootstrap + controller: state machine, screens, input wiring.
import * as THREE from 'three';
import * as rules from './rules.js';
import * as content from './content.js';
import * as sessionMod from './session.js';
import * as render from './render.js';
import * as audio from './audio.js';
import * as platform from './platform.js';
import { t, setLang, el, announce, initLiveRegion, trapFocus, piecePreview } from './ui.js';

// App screens follow the state model: boot → title → mode-select → preparing
// → tutorial/countdown → active ↔ paused → resolving → results → progression.
let app = {
  screen: 'boot',
  session: null,
  settings: platform.loadSettings(),
  progression: platform.loadProgression(),
  selectedPiece: 0,
  cursor: [4, 4],
  dragging: null, // { pieceIndex } while pointer-dragging from tray
  tutorialStep: 0,
  pausedAccum: 0,
  pauseStart: 0,
  elapsedBase: 0, // play time carried over from a restored snapshot
  webgl: false,
  releaseTrap: null,
  setupConfig: null, // pending mode setup
};

let canvas, trayEl, mirrorEl, hudEls = {}, overlayRoot, leftRail, rightRail;

// ---------------------------------------------------------------- utilities
function themeById(id) {
  return content.THEMES.find(x => x.id === id) || content.THEMES[0];
}
function activeTheme() { return themeById(app.session && app.session.meta.theme || app.settings.theme); }

function haptic() {
  if (app.settings.haptics && navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
}

// ---------------------------------------------------------------- boot
async function boot() {
  buildShell();
  applySettingsToAudio();
  setLang(app.settings.lang);
  await platform.syncTime(); // daily boundaries sync with host time when hosted

  const errors = content.validateContent();
  if (errors.length) console.error('content validation failed', errors);

  app.webgl = render.init(canvas, themeById(app.settings.theme), {
    quality: app.settings.quality,
    reducedMotion: app.settings.reducedMotion,
    palette: app.settings.colorPalette,
  });
  if (!app.webgl) showCompatNotice();

  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 50));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.screen === 'active') pauseGame('backgrounded');
  });

  wireInput();
  requestAnimationFrame(loop);
  platform.funnelEvent('start');
  showTitle();
  // The shell is built; assistive tech should stop treating it as loading.
  document.getElementById('app').setAttribute('aria-busy', 'false');
}

function showCompatNotice() {
  announce(t('noWebGL'));
  mirrorEl.classList.remove('sr-only');
  mirrorEl.classList.add('board-visible');
}

function onResize() {
  const region = document.getElementById('game-region');
  const r = region.getBoundingClientRect();
  render.resize(Math.max(1, r.width), Math.max(1, r.height));
}

function loop(nowMs) {
  render.frame(nowMs);
  pollGamepad();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- shell
function buildShell() {
  const root = document.getElementById('app');
  root.innerHTML = '';

  const header = el('header', { id: 'statusbar' }, [
    el('h1', { class: 'brand', text: t('title') }),
    hudEls.objective = el('div', { id: 'hud-objective', class: 'hud-chip', role: 'status' }),
    hudEls.score = el('div', { id: 'hud-score', class: 'hud-chip', role: 'status' }),
    hudEls.combo = el('div', { id: 'hud-combo', class: 'hud-chip', role: 'status' }),
    hudEls.pauseBtn = el('button', { id: 'btn-pause', class: 'chip-btn', text: t('pause'), onclick: () => pauseGame('user') }),
  ]);

  canvas = el('canvas', { id: 'gl', 'aria-hidden': 'true' });
  mirrorEl = el('div', { id: 'board-mirror', class: 'sr-only', role: 'grid', 'aria-label': t('boardLabel') });

  leftRail = el('aside', { id: 'rail-left', class: 'rail' });
  rightRail = el('aside', { id: 'rail-right', class: 'rail' });

  const region = el('main', { id: 'game-region' }, [canvas, mirrorEl, leftRail, rightRail]);
  trayEl = el('div', { id: 'tray', role: 'group', 'aria-label': t('trayLabel') });
  overlayRoot = el('div', { id: 'overlay-root' });

  root.append(header, region, trayEl, overlayRoot);
  initLiveRegion(root);
}

// ---------------------------------------------------------------- overlays
function openOverlay(node, { modal = true } = {}) {
  closeOverlay();
  const veil = el('div', { class: 'overlay-veil' }, [node]);
  overlayRoot.appendChild(veil);
  if (modal) app.releaseTrap = trapFocus(veil);
  return veil;
}
function closeOverlay() {
  if (app.releaseTrap) { app.releaseTrap(); app.releaseTrap = null; }
  overlayRoot.innerHTML = '';
}

function menuButton(label, onClick, opts = {}) {
  return el('button', { class: 'menu-btn' + (opts.primary ? ' primary' : ''), text: label, onclick: onClick });
}

// ---------------------------------------------------------------- title
function showTitle() {
  app.screen = 'title';
  closeOverlay();
  updateHud();

  const prog = app.progression;
  const daily = content.dailySeed(platform.syncedDate());
  // Daily bests are keyed `daily:<dayKey>` (see finishRound).
  const dailyDone = !!platform.loadProgression().bests[`daily:${daily.dayKey}`];
  const resumeSnap = loadDailySnapshot();

  const panel = el('section', { class: 'panel title-panel', 'aria-labelledby': 'title-h' }, [
    el('h2', { id: 'title-h', text: t('title') }),
    el('p', { class: 'tagline', text: t('tagline') }),
    menuButton(t('play'), () => showModeSelect(), { primary: true }),
    resumeSnap ? menuButton(`${t('daily')} — ${t('resume')}`, () => resumeDaily(resumeSnap)) : null,
    menuButton(t('daily') + (dailyDone ? ` ✓` : ''), () => setupDaily()),
    menuButton(`${t('journey')} — ${t('stage')} ${prog.journeyStage}`, () => setupJourney(prog.journeyStage)),
    menuButton(t('settings'), () => showSettings()),
    menuButton(t('help'), () => showHelp()),
  ]);
  openOverlay(panel, { modal: false });
  document.getElementById('btn-pause').style.display = 'none';
  renderRails(null);
}

// ---------------------------------------------------------------- mode select
function showModeSelect() {
  app.screen = 'mode-select';
  const panel = el('section', { class: 'panel', 'aria-labelledby': 'mode-h' }, [
    el('h2', { id: 'mode-h', text: t('play') }),
    menuButton(t('learn'), () => startLearn()),
    menuButton(t('journey'), () => setupJourney(app.progression.journeyStage)),
    menuButton(t('daily'), () => setupDaily()),
    menuButton(t('practice'), () => showPracticeSetup()),
    menuButton(t('challenge'), () => showChallengeSetup()),
    menuButton(t('scores'), () => showScores()),
    menuButton(t('back'), () => showTitle()),
  ]);
  openOverlay(panel, { modal: false });
}

// Learn mode: guided tutorial session with a fixed seed so lessons are reproducible.
function startLearn() {
  startSession({
    mode: 'learn',
    seed: 424242,
    opts: { allowUndo: true },
  });
}

// Setup confirmation card: rules, duration, ranked, assists before commitment.
function setupCard({ title, lines, ranked, onStart }) {
  app.screen = 'preparing';
  const panel = el('section', { class: 'panel', 'aria-labelledby': 'setup-h' }, [
    el('h2', { id: 'setup-h', text: title }),
    el('p', { text: t('rulesSummary') }),
    el('ul', {}, lines.map(l => el('li', { text: l }))),
    el('p', { class: 'ranked-line', text: ranked ? t('ranked') : t('unranked') }),
    menuButton(t('start'), onStart, { primary: true }),
    menuButton(t('back'), () => showModeSelect()),
  ]);
  openOverlay(panel, { modal: false });
}

function setupJourney(stageIdx) {
  const stage = content.STAGES[Math.min(stageIdx, content.STAGES.length) - 1];
  setupCard({
    title: `${t('journey')} — ${t('stage')} ${stage.index} (${t(stage.difficulty)})`,
    lines: [
      `${t('goal')}: ${stage.goalScore}`,
      `${t('moves')}: ${stage.moveLimit}`,
      `${t('par')}: ${stage.par}`,
      `${t('expectedDuration')}: ~3 ${t('minutes')}`,
    ],
    ranked: true,
    onStart: () => startSession({
      mode: 'journey',
      seed: stage.seed,
      opts: { goalScore: stage.goalScore, moveLimit: stage.moveLimit, allowUndo: false },
      meta: { stage: stage.index, theme: stage.theme },
    }),
  });
}

function setupDaily() {
  const daily = content.dailySeed(platform.syncedDate());
  setupCard({
    title: `${t('daily')} — ${daily.dayKey}`,
    lines: [`${t('goal')}: ${t('score')}`, `${t('expectedDuration')}: ~5 ${t('minutes')}`],
    ranked: true,
    onStart: () => startSession({
      mode: 'daily', seed: daily.seed, opts: { allowUndo: false },
      meta: { dayKey: daily.dayKey },
    }),
  });
}

function showPracticeSetup() {
  app.screen = 'preparing';
  const panel = el('section', { class: 'panel', 'aria-labelledby': 'prac-h' }, [
    el('h2', { id: 'prac-h', text: t('practice') }),
    ...content.PRACTICE_DIFFICULTIES.map(d =>
      menuButton(`${d.name} — ${d.description}`, () => startSession({
        mode: 'practice',
        seed: Math.floor(Math.random() * 0x7fffffff),
        opts: { allowUndo: d.id === 'relaxed' },
        meta: { difficulty: d.id },
      }))),
    menuButton(t('back'), () => showModeSelect()),
  ]);
  openOverlay(panel, { modal: false });
}

function showChallengeSetup() {
  app.screen = 'preparing';
  const panel = el('section', { class: 'panel', 'aria-labelledby': 'chal-h' }, [
    el('h2', { id: 'chal-h', text: t('challenge') }),
    ...content.CHALLENGES.map(c =>
      menuButton(`${c.name} — ${c.description}`, () => startSession({
        mode: 'challenge', seed: c.seed,
        opts: { goalScore: c.goalScore, moveLimit: c.moveLimit, allowUndo: false },
        meta: { challenge: c.id },
      }))),
    menuButton(t('back'), () => showModeSelect()),
  ]);
  openOverlay(panel, { modal: false });
}

function showScores() {
  app.screen = 'scores';
  const board = platform.getLeaderboard();
  const prog = platform.loadProgression();
  const panel = el('section', { class: 'panel', 'aria-labelledby': 'scores-h' }, [
    el('h2', { id: 'scores-h', text: t('scores') }),
    el('h3', { text: t('leaderboard') }),
    board.length
      ? el('table', { class: 'score-table' }, [
          el('tr', {}, [el('th', { text: '#' }), el('th', { text: t('score') }), el('th', { text: 'Mode' }), el('th', { text: 'Seed' })]),
          ...board.slice(0, 10).map((e, i) => el('tr', {}, [
            el('td', { text: String(i + 1) }), el('td', { text: String(e.score) }),
            el('td', { text: e.mode }), el('td', { text: String(e.seed) }),
          ])),
        ])
      : el('p', { text: '—' }),
    el('h3', { text: t('achievements') }),
    el('ul', {}, platform.ACHIEVEMENTS.map(a =>
      el('li', { text: `${prog.achievements[a.key] ? '✓' : '○'} ${a.name} — ${a.description}` }))),
    menuButton(t('back'), () => showModeSelect()),
  ]);
  openOverlay(panel, { modal: false });
}

// ---------------------------------------------------------------- session control
function startSession(cfg) {
  app.session = sessionMod.createSession(cfg);
  app.selectedPiece = 0;
  app.cursor = [4, 4];
  app.dragging = null;
  app.tutorialStep = 0;
  app.pausedAccum = 0;
  app.elapsedBase = 0;
  render.setTheme(activeTheme());
  closeOverlay();
  document.getElementById('btn-pause').style.display = '';
  app.screen = 'active';
  audio.resume();
  audio.startAmbience();
  renderAll();
  renderRails(cfg.mode);
  if (cfg.mode === 'learn') showTutorialCard();
  else announce(t('objective') + ': ' + objectiveText());
  platform.presenceHeartbeat();
}

function resumeDaily(snap) {
  app.session = sessionMod.restore(snap);
  app.selectedPiece = app.session.state.offer.findIndex(p => p);
  if (app.selectedPiece < 0) app.selectedPiece = 0;
  app.cursor = [4, 4];
  app.dragging = null;
  app.pausedAccum = 0;
  // Keep the persisted play time; the restored session restarts its own clock.
  app.elapsedBase = app.session.state.elapsedMs || 0;
  closeOverlay();
  document.getElementById('btn-pause').style.display = '';
  app.screen = 'active';
  render.setTheme(activeTheme());
  audio.resume();
  audio.startAmbience();
  renderAll();
  updateGhost();
  renderRails('daily');
  announce(t('resume'));
}

// Restart the round that is currently loaded, with its original configuration.
function restartRound() {
  const s = app.session;
  if (!s) return;
  startSession({
    mode: s.mode,
    seed: s.state.seed,
    opts: { moveLimit: s.state.moveLimit, goalScore: s.state.goalScore, allowUndo: s.allowUndo },
    meta: s.meta,
  });
  platform.funnelEvent('retry');
}

function objectiveText() {
  const s = app.session && app.session.state;
  if (!s) return '';
  const parts = [];
  if (s.goalScore !== null) parts.push(`${t('goal')}: ${s.goalScore}`);
  if (s.moveLimit !== null) parts.push(`${t('moves')}: ${Math.max(0, s.moveLimit - s.placedCount)}`);
  if (!parts.length) parts.push(t('rulesSummary'));
  return parts.join(' · ');
}

function pauseGame(reason) {
  if (app.screen !== 'active' || !app.session) return;
  app.screen = 'paused';
  app.pauseStart = Date.now();
  app.dragging = null;
  audio.play.pause();
  audio.stopAmbience(); // the bed should not keep running behind the pause card
  showPause();
}

function resumeGame() {
  if (app.screen !== 'paused') return;
  app.pausedAccum += Date.now() - app.pauseStart;
  app.screen = 'active';
  closeOverlay();
  audio.resume();
  audio.startAmbience();
  updateGhost();
}

function showPause() {
  const panel = el('section', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-h' }, [
    el('h2', { id: 'pause-h', text: t('pause') }),
    menuButton(t('resume'), () => resumeGame(), { primary: true }),
    menuButton(t('restart'), () => restartRound()),
    menuButton(t('settings'), () => showSettings(() => showPause())),
    menuButton(t('help'), () => showHelp(() => showPause())),
    menuButton(t('backToTitle'), () => endToTitle()),
  ]);
  openOverlay(panel);
}

function endToTitle() {
  if (app.session && app.session.state.status === 'active' && app.session.mode === 'daily') {
    saveDailySnapshot();
  }
  app.session = null;
  app.screen = 'title';
  audio.stopAmbience();
  showTitle();
}

// ---------------------------------------------------------------- tutorial
function showTutorialCard() {
  const step = content.TUTORIAL_STEPS[app.tutorialStep];
  if (!step) return;
  const card = el('aside', { class: 'tutorial-card', role: 'note' }, [
    el('strong', { text: `${app.tutorialStep + 1}/${content.TUTORIAL_STEPS.length} — ${step.title}` }),
    el('p', { text: step.text }),
  ]);
  const old = document.querySelector('.tutorial-card');
  if (old) old.remove();
  leftRail.appendChild(card);
  announce(step.title + '. ' + step.text);
  platform.funnelEvent('tutorial_step', { step: step.id });
}

function tutorialAdvance(events) {
  if (app.session.mode !== 'learn') return;
  const step = content.TUTORIAL_STEPS[app.tutorialStep];
  if (!step) return;
  const satisfied = step.require === 'place' || (step.require === 'clear' && events.lineCount > 0);
  if (!satisfied) return;
  app.tutorialStep++;
  if (app.tutorialStep < content.TUTORIAL_STEPS.length) {
    showTutorialCard();
  } else {
    const old = document.querySelector('.tutorial-card');
    if (old) old.remove();
    const done = platform.loadSettings().tutorialsDone;
    if (!done.includes('learn')) {
      done.push('learn');
      app.settings.tutorialsDone = done;
      platform.saveSettings(app.settings);
    }
    announce(t('tutorialDone'));
  }
}

// ---------------------------------------------------------------- rendering sync
function renderAll(events) {
  if (!app.session) return;
  const snap = rules.serialize(app.session.state);
  render.setBoard(snap, events);
  updateTray();
  updateMirror();
  updateHud();
}

function updateHud() {
  const s = app.session && app.session.state;
  hudEls.objective.textContent = s ? objectiveText() : '';
  hudEls.score.textContent = s ? `${t('score')}: ${s.score}` : '';
  hudEls.combo.textContent = s && s.comboStreak > 1 ? `${t('comboStreak')} ×${s.comboStreak}` : '';
}

function updateTray() {
  trayEl.innerHTML = '';
  if (!app.session) return;
  const s = app.session.state;
  s.offer.forEach((shapeId, i) => {
    if (!shapeId) return;
    const selected = i === app.selectedPiece;
    const btn = el('button', {
      class: 'tray-piece' + (selected ? ' selected' : ''),
      'aria-label': `${t('selectPiece')} ${i + 1}: ${shapeId}`,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => selectPiece(i),
    }, [piecePreview(rules.SHAPES[shapeId], activeTheme().piece)]);
    btn.dataset.pieceIndex = String(i);
    // Pointer drag starts here; cell targeting happens over the canvas.
    btn.addEventListener('pointerdown', e => {
      selectPiece(i);
      app.dragging = { pieceIndex: i, pointerId: e.pointerId };
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    });
    trayEl.appendChild(btn);
  });
}

let mirrorCells = [];
let mirrorMarked = []; // cells currently carrying cursor/ghost marks
function updateMirror() {
  const s = app.session.state;
  mirrorEl.innerHTML = '';
  mirrorCells = [];
  mirrorMarked = []; // the previous cells are detached now
  for (let r = 0; r < rules.N; r++) {
    const rowEl = el('div', { role: 'row' });
    for (let c = 0; c < rules.N; c++) {
      const filled = s.board[r * rules.N + c] !== 0;
      const cell = el('button', {
        role: 'gridcell',
        class: 'mirror-cell' + (filled ? ' filled' : ''),
        'aria-label': `${r + 1},${c + 1} ${filled ? 'filled' : 'empty'}`,
        tabindex: '-1',
        onclick: () => { app.cursor = [r, c]; tryPlace(); },
      });
      mirrorCells[r * rules.N + c] = cell;
      rowEl.appendChild(cell);
    }
    mirrorEl.appendChild(rowEl);
  }
  updateMirrorCursor();
}

// Mirror the placement target into the accessible board so keyboard and
// no-WebGL players can see and hear where the piece would land.
function updateMirrorCursor(cells, valid) {
  if (!mirrorCells.length) return;
  // Clear only what was marked last time; this runs on every pointer move.
  for (const cell of mirrorMarked) {
    cell.classList.remove('cursor', 'ghost', 'ghost-invalid');
    cell.removeAttribute('aria-current');
  }
  mirrorMarked = [];
  for (const [r, c] of cells || []) {
    if (r < 0 || r >= rules.N || c < 0 || c >= rules.N) continue;
    const cell = mirrorCells[r * rules.N + c];
    if (cell) { cell.classList.add(valid ? 'ghost' : 'ghost-invalid'); mirrorMarked.push(cell); }
  }
  const target = mirrorCells[app.cursor[0] * rules.N + app.cursor[1]];
  if (target) {
    target.classList.add('cursor');
    target.setAttribute('aria-current', 'location');
    mirrorMarked.push(target);
  }
}

function renderRails(mode) {
  leftRail.innerHTML = '';
  rightRail.innerHTML = '';
  if (!mode) return;
  leftRail.appendChild(el('div', { class: 'rail-block' }, [
    el('h3', { text: t('objective') }),
    el('p', { text: objectiveText() }),
  ]));
  if (app.progression.journeyStage > 1 || mode === 'journey') {
    leftRail.appendChild(el('div', { class: 'rail-block' }, [
      el('h3', { text: t('journey') }),
      el('p', { text: `${t('stage')} ${app.progression.journeyStage} / ${content.STAGES.length}` }),
    ]));
  }
  // Pause lives in the status bar and offers Restart; the rail keeps in-play aids.
  const undoOk = app.session && app.session.allowUndo;
  rightRail.appendChild(el('div', { class: 'rail-block actions' }, [
    el('button', { class: 'chip-btn', text: t('hint'), onclick: () => showHint() }),
    undoOk ? el('button', { class: 'chip-btn', text: t('undo'), onclick: () => doUndo() }) : null,
  ]));
}

// ---------------------------------------------------------------- placement flow
function selectPiece(i) {
  if (!app.session) return;
  const s = app.session.state;
  if (!s.offer[i]) return;
  app.selectedPiece = i;
  audio.play.select();
  updateTray();
  updateGhost();
}

// Cycle to the next offered piece that has not been consumed yet.
function selectNextPiece() {
  if (!app.session) return;
  const offer = app.session.state.offer;
  for (let step = 1; step <= offer.length; step++) {
    const i = (app.selectedPiece + step) % offer.length;
    if (offer[i]) { selectPiece(i); return; }
  }
}

function updateGhost() {
  if (!app.session || app.screen !== 'active') { render.setGhost(null); updateMirrorCursor(null); return; }
  const s = app.session.state;
  const shapeId = s.offer[app.selectedPiece];
  if (!shapeId) { render.setGhost(null); updateMirrorCursor(null); return; }
  const cells = rules.shapeCells(shapeId, app.cursor[0], app.cursor[1]);
  const valid = rules.canPlace(s.board, shapeId, app.cursor[0], app.cursor[1]);
  render.setGhost(cells, valid);
  updateMirrorCursor(cells, valid);
}

function tryPlace() {
  if (!app.session || app.screen !== 'active') return;
  const s = app.session.state;
  if (!s.offer[app.selectedPiece]) {
    const first = s.offer.findIndex(p => p);
    if (first < 0) return;
    app.selectedPiece = first;
  }
  const res = sessionMod.execute(app.session, {
    type: 'place', pieceIndex: app.selectedPiece, row: app.cursor[0], col: app.cursor[1],
  });
  if (!res.ok) {
    audio.play.invalid();
    haptic();
    announce(t('invalidBlocked'));
    return;
  }
  handlePlacement(res.events);
}

function handlePlacement(events) {
  const s = app.session.state;
  s.elapsedMs = app.elapsedBase + (Date.now() - app.session.startedAt - app.pausedAccum);
  audio.play.place();
  haptic();
  if (events.lineCount > 0) {
    audio.play.clear(events.lineCount);
    if (s.comboStreak > 1) audio.play.combo(s.comboStreak);
    announce(t('announceClear', { n: events.lineCount, score: s.score }));
    if (platform.unlockAchievement('first_clear')) announce(t('achievements') + ': First Clear');
    if (s.comboStreak >= 4) platform.unlockAchievement('combo_master');
    if (s.score >= 1000) platform.unlockAchievement('marathon');
  } else {
    announce(t('announcePlaced', { shape: events.shapeId, row: events.row + 1, col: events.col + 1, score: s.score }));
  }
  tutorialAdvance(events);

  // Keep selection on a still-available piece.
  if (!s.offer[app.selectedPiece]) {
    const first = s.offer.findIndex(p => p);
    app.selectedPiece = first >= 0 ? first : 0;
  }
  renderAll(events);
  updateGhost();
  if (app.session.mode === 'daily') saveDailySnapshot();

  if (s.status === 'over') {
    finishRound();
  }
}

function doUndo() {
  if (!app.session) return;
  const res = sessionMod.execute(app.session, { type: 'undo' });
  if (res.ok) {
    audio.play.undo();
    renderAll({ undone: true });
    updateGhost();
  } else {
    audio.play.invalid();
  }
}

function showHint() {
  if (!app.session || app.screen !== 'active') return;
  const actions = rules.legalActions(app.session.state); // same API as play
  const a = actions.find(x => x.pieceIndex === app.selectedPiece && x.anchors.length) ||
            actions.find(x => x.anchors.length);
  if (!a) { audio.play.invalid(); return; }
  app.selectedPiece = a.pieceIndex;
  app.cursor = a.anchors[0].slice();
  updateTray();
  updateGhost();
  announce(`${t('hint')}: ${a.shapeId} @ ${a.anchors[0][0] + 1},${a.anchors[0][1] + 1}`);
}

// ---------------------------------------------------------------- round end
function finishRound() {
  const s = app.session.state;
  const sess = app.session;
  app.screen = 'results';
  audio.stopAmbience();
  const won = s.terminalReason === 'goal-score-reached' || s.terminalReason === 'move-limit-goal-met';
  if (won) audio.play.win(); else audio.play.gameOver();
  announce(t('announceOver', { reason: reasonText(s.terminalReason), score: s.score }));

  // Progression + records.
  const prog = platform.loadProgression();
  prog.gamesPlayed++;
  prog.totalScore += s.score;
  const bestKey = sess.mode + (sess.meta.stage ? ':' + sess.meta.stage : '') + (sess.meta.dayKey ? ':' + sess.meta.dayKey : '') + (sess.meta.challenge ? ':' + sess.meta.challenge : '');
  if (!prog.bests[bestKey] || prog.bests[bestKey].score < s.score) {
    prog.bests[bestKey] = { score: s.score, at: Date.now(), dayKey: sess.meta.dayKey };
  }
  if (sess.mode === 'journey' && won && sess.meta.stage === prog.journeyStage && prog.journeyStage < content.STAGES.length) {
    prog.journeyStage++;
    if (sess.meta.stage >= 20) platform.unlockAchievement('journey_20');
  }
  app.progression = prog;
  platform.saveProgression(prog);

  if (sess.mode === 'daily') {
    clearDailySnapshot();
    platform.trackPlayDay(sess.meta.dayKey);
  }

  if (sess.ranked) {
    const envelope = sessionMod.replayEnvelope(sess, content.CONTENT_VERSION);
    platform.submitScore({
      mode: sess.mode, score: s.score, seed: s.seed,
      contentVersion: content.CONTENT_VERSION, rulesVersion: rules.RULES_VERSION,
      assists: { undo: sess.allowUndo && sess.log.some(c => c.type === 'undo') },
      durationMs: s.elapsedMs, dayKey: sess.meta.dayKey, stage: sess.meta.stage,
      verified: sessionMod.verifyReplay(envelope).ok,
    });
  }
  platform.funnelEvent('round_end', { mode: sess.mode, score: s.score, reason: s.terminalReason });

  const b = s.breakdown;
  const panel = el('section', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'res-h' }, [
    el('h2', { id: 'res-h', text: won ? t('stageClear') : t('gameOver') }),
    el('p', { class: 'reason', text: `${t('reason')}: ${reasonText(s.terminalReason)}` }),
    el('p', { class: 'big-score', text: `${t('score')}: ${s.score}` }),
    el('h3', { text: t('breakdown') }),
    el('table', { class: 'score-table' }, [
      el('tr', {}, [el('td', { text: t('placed') }), el('td', { text: String(b.place) })]),
      el('tr', {}, [el('td', { text: t('cleared') }), el('td', { text: String(b.clear) })]),
      el('tr', {}, [el('td', { text: t('multi') }), el('td', { text: String(b.multi) })]),
      el('tr', {}, [el('td', { text: t('combo') }), el('td', { text: String(b.combo) })]),
      el('tr', {}, [el('th', { text: t('total') }), el('th', { text: String(s.score) })]),
    ]),
    menuButton(t('playAgain'), () => {
      startSession({ mode: sess.mode, seed: sess.mode === 'practice' ? Math.floor(Math.random() * 0x7fffffff) : sess.state.seed,
        opts: { moveLimit: s.moveLimit, goalScore: s.goalScore, allowUndo: sess.allowUndo }, meta: sess.meta });
      platform.funnelEvent('retry');
    }, { primary: true }),
    sess.mode === 'journey' && won && sess.meta.stage < content.STAGES.length
      ? menuButton(t('nextStage'), () => setupJourney(app.progression.journeyStage)) : null,
    menuButton(t('scores'), () => showScores()),
    menuButton(t('backToTitle'), () => endToTitle()),
  ]);
  openOverlay(panel);
}

function reasonText(reason) {
  if (reason === 'no-piece-fits') return t('noPieceFits');
  if (reason === 'move-limit-reached') return t('moveLimitReached');
  if (reason === 'move-limit-goal-met' || reason === 'goal-score-reached') return t('goalMet');
  return reason || '';
}

// Daily snapshot persistence for reconnect-style resume.
function saveDailySnapshot() {
  try {
    localStorage.setItem('timbergrid.dailySnapshot', JSON.stringify(sessionMod.snapshot(app.session)));
  } catch (_) {}
}
function loadDailySnapshot() {
  try {
    const raw = localStorage.getItem('timbergrid.dailySnapshot');
    if (!raw) return null;
    const snap = JSON.parse(raw);
    const daily = content.dailySeed(platform.syncedDate());
    if (!snap.meta || snap.meta.dayKey !== daily.dayKey || snap.state.status !== 'active') return null;
    return snap;
  } catch (_) { return null; }
}
function clearDailySnapshot() {
  try { localStorage.removeItem('timbergrid.dailySnapshot'); } catch (_) {}
}

// ---------------------------------------------------------------- settings & help
function showSettings(onBack) {
  const s = app.settings;
  const back = onBack || (() => (app.session ? showPause() : showTitle()));
  function row(label, control) {
    return el('div', { class: 'setting-row' }, [el('label', { text: label }), control]);
  }
  function toggle(key) {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!s[key];
    inp.addEventListener('change', () => { s[key] = inp.checked; persistSettings(); });
    return inp;
  }
  function select(key, options) {
    const sel = el('select', {});
    for (const [v, label] of options) sel.appendChild(el('option', { value: v, text: label }));
    sel.value = s[key];
    sel.addEventListener('change', () => { s[key] = sel.value; persistSettings(); });
    return sel;
  }
  function slider(key, bus) {
    const inp = el('input', { type: 'range', min: '0', max: '1', step: '0.05' });
    inp.value = String(s[key]);
    inp.addEventListener('input', () => {
      s[key] = parseFloat(inp.value);
      audio.setVolume(bus, s[key]);
      persistSettings(false);
    });
    return inp;
  }
  const panel = el('section', { class: 'panel settings-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'set-h' }, [
    el('h2', { id: 'set-h', text: t('settings') }),
    row(t('language'), select('lang', [['en', 'English'], ['zh', '中文']])),
    row(t('theme'), select('theme', content.THEMES.map(th => [th.id, th.name]))),
    row(t('quality'), select('quality', [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])),
    row(t('colorPalette'), select('colorPalette', [['standard', 'Standard'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']])),
    row(t('reducedMotion'), toggle('reducedMotion')),
    row(t('highContrast'), toggle('highContrast')),
    row(t('largeText'), toggle('largeText')),
    row(t('leftHanded'), toggle('leftHanded')),
    row(t('music'), slider('volMusic', 'music')),
    row(t('effects'), slider('volEffects', 'effects')),
    row(t('ambience'), slider('volAmbience', 'ambience')),
    row(t('muted'), (() => { const i = toggle('muted'); return i; })()),
    menuButton(t('back'), back, { primary: true }),
  ]);
  openOverlay(panel);
}

function persistSettings(announceChange = true) {
  platform.saveSettings(app.settings);
  applySettings();
  if (announceChange) platform.funnelEvent('settings_change');
}

function applySettings() {
  const s = app.settings;
  setLang(s.lang);
  render.setReducedMotion(s.reducedMotion);
  render.setPalette(s.colorPalette);
  render.setQuality(s.quality);
  render.setTheme(activeTheme());
  document.body.classList.toggle('high-contrast', s.highContrast);
  document.body.classList.toggle('large-text', s.largeText);
  document.body.classList.toggle('left-handed', s.leftHanded);
  applySettingsToAudio();
}

function applySettingsToAudio() {
  const s = app.settings;
  audio.setVolume('music', s.volMusic);
  audio.setVolume('effects', s.volEffects);
  audio.setVolume('ambience', s.volAmbience);
  audio.setVolume('voice', s.volVoice);
  audio.setMuted(s.muted);
}

function showHelp(onBack) {
  const back = onBack || (() => (app.session ? showPause() : showTitle()));
  const card = (title, text) => el('div', { class: 'help-card' }, [el('h3', { text: title }), el('p', { text })]);
  const panel = el('section', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-h' }, [
    el('h2', { id: 'help-h', text: t('howToPlay') }),
    card(t('play'), t('helpPlace')),
    card(t('cleared'), t('helpClear')),
    card(t('comboStreak'), t('helpCombo')),
    card('⌨', t('helpKeys')),
    menuButton(t('back'), back, { primary: true }),
  ]);
  openOverlay(panel);
}

// ---------------------------------------------------------------- input
function wireInput() {
  // Canvas pointer: move ghost on hover/drag, commit on release.
  canvas.addEventListener('pointermove', e => {
    if (app.screen !== 'active') return;
    const cell = render.pickCell(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (cell) { app.cursor = cell; updateGhost(); }
  });
  canvas.addEventListener('pointerdown', e => {
    if (app.screen !== 'active') return;
    const cell = render.pickCell(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (cell) {
      app.cursor = cell;
      updateGhost();
      if (!app.dragging) tryPlace(); // tap-to-place with selected piece
    }
  });
  // A tray drag captures the pointer on the tray button, so the canvas never
  // sees pointermove; track the drag at the window so the ghost follows it.
  window.addEventListener('pointermove', e => {
    if (!app.dragging || app.screen !== 'active') return;
    const cell = render.pickCell(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (cell) { app.cursor = cell; updateGhost(); }
  });
  window.addEventListener('pointerup', e => {
    if (app.dragging) {
      const cell = render.pickCell(e.clientX, e.clientY, canvas.getBoundingClientRect());
      if (cell) { app.cursor = cell; tryPlace(); }
      app.dragging = null;
      updateGhost();
    }
  });
  window.addEventListener('pointercancel', () => { app.dragging = null; updateGhost(); });

  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  if (app.screen === 'active') {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const [r, c] = app.cursor;
      // Directional navigation: snap to the nearest legal anchor in that direction.
      if (k === 'ArrowUp') app.cursor = [Math.max(0, r - 1), c];
      if (k === 'ArrowDown') app.cursor = [Math.min(rules.N - 1, r + 1), c];
      if (k === 'ArrowLeft') app.cursor = [r, Math.max(0, c - 1)];
      if (k === 'ArrowRight') app.cursor = [r, Math.min(rules.N - 1, c + 1)];
      updateGhost();
    } else if (k === '1' || k === '2' || k === '3') {
      selectPiece(parseInt(k, 10) - 1);
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      tryPlace();
    } else if (k === 'u' || k === 'U') {
      doUndo();
    } else if (k === 'h' || k === 'H') {
      showHint();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      pauseGame('user');
    } else if (k === 'c' || k === 'C') {
      onResize(); // camera reset
    }
  } else if (app.screen === 'paused' && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) {
    // Only resume when the pause card itself is showing; settings/help opened
    // from it are nested overlays and must not be dismissed into play.
    if (document.getElementById('pause-h')) resumeGame();
  }
}

// Gamepad: focus navigation, confirm/cancel, pause. Polled per frame.
let gpPrev = {};
function pollGamepad() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const gp = navigator.getGamepads()[0];
  if (!gp || app.screen !== 'active') { gpPrev = {}; return; }
  const pressed = i => gp.buttons[i] && gp.buttons[i].pressed;
  const edge = i => pressed(i) && !gpPrev[i];
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const dz = 0.6;
  const now = { axu: ay < -dz, axd: ay > dz, axl: ax < -dz, axr: ax > dz };
  if (now.axu && !gpPrev.axu) moveCursor(-1, 0);
  if (now.axd && !gpPrev.axd) moveCursor(1, 0);
  if (now.axl && !gpPrev.axl) moveCursor(0, -1);
  if (now.axr && !gpPrev.axr) moveCursor(0, 1);
  if (edge(14)) moveCursor(0, -1);
  if (edge(15)) moveCursor(0, 1);
  if (edge(12)) moveCursor(-1, 0);
  if (edge(13)) moveCursor(1, 0);
  if (edge(0)) tryPlace();
  if (edge(1)) selectNextPiece();
  if (edge(9)) pauseGame('user');
  gpPrev = { ...now, 0: pressed(0), 1: pressed(1), 9: pressed(9), 12: pressed(12), 13: pressed(13), 14: pressed(14), 15: pressed(15) };
}
function moveCursor(dr, dc) {
  app.cursor = [
    Math.max(0, Math.min(rules.N - 1, app.cursor[0] + dr)),
    Math.max(0, Math.min(rules.N - 1, app.cursor[1] + dc)),
  ];
  updateGhost();
}

// ---------------------------------------------------------------- go
boot();
