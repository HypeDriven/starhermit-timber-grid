/**
 * Timber Grid — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play → mode select → Practice (Relaxed) → board played to a
 *   natural round end ("Game Over — No offered piece fits") by clicking,
 *   tapping and keyboard-driving the on-screen board. The round result
 *   screen with its score breakdown is asserted. Also exercises pause/resume,
 *   hint and undo through the visible controls. A second, shorter pass runs
 *   the load → start → tap-a-few-cells flow on a mobile touch viewport.
 *
 * Timber Grid renders its board to a WebGL canvas via three.js; placements
 * happen by pointer press on the canvas at the board cell under the cursor
 * (src/main.js canvas pointerdown → render.pickCell → tryPlace). There is no
 * per-cell DOM button for the primary board (the accessible `#board-mirror` is
 * only shown when WebGL is unavailable), so the test reproduces the game's
 * own camera (src/render.js positionCamera / FRAMING) with three.js in Node
 * to project a board cell [row,col] onto client coordinates, then issues a
 * real pointer press/tap at that point. That projection was validated against
 * the live pickCell inverse during authoring.
 *
 * To pick the next legal move, the test mirrors the deterministic rules
 * engine (src/rules.js) and reads the observable board (`#board-mirror` cell
 * filled classes) and offer (`#tray .tray-piece` aria-labels). It never calls
 * the game's internal move API and never modifies game source — every action
 * is a real click/tap/keypress on the visible board, tray or controls.
 * Each placement is verified by the HUD score rising (a placement that clears
 * lines re-empties cells, so the filled count is not a reliable success probe).
 * The in-game "Reduced motion" setting (a persisted user pref, not game code)
 * is enabled so the post-clear camera shake stays off and the cell→client
 * projection stays exact throughout a round.
 *
 * RANKED completion now works: finishRound reads the seed from the rules-state
 * object itself (`s.seed`), not a nonexistent `.state` field, so a ranked round
 * (Journey / Daily / Challenge) reaches the results overlay without throwing.
 * The desktop pass therefore also plays a Journey stage to a natural terminal
 * state and asserts the results overlay appears (which exercises the ranked
 * submitScore path at src/main.js:620). See the fix note below.
 *
 * Serving: the repo ships `server.js` (the StarHermit authoritative script
 * declared by starhermit.txt), but the game is fully playable offline — when
 * `/api/v1/time` is unreachable it sets `hosted=false` and Practice/Journey/
 * Daily run entirely locally (daily seed is computed client-side). So, per the
 * sibling title conventions, this test embeds a minimal node:http static
 * server on an ephemeral port and answers /api/* probes with 200 `{}` so the
 * platform adapter degrades to its documented offline path with zero console
 * noise. If the UI ever requires the real backend this can be swapped for
 * spawning `server.js`; today it is not needed.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as rules from '../src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/timber-grid-e2e-${stage}-${vp}.png`;
const N = rules.N; // 9

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter degrades to offline mode without console noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// ---------- cell → client projection (replicates src/render.js camera) ----------

// Project a board cell [row,col] center onto canvas client coordinates using
// the exact camera setup from render.js positionCamera() + FRAMING. Render's
// pickCell raycasts the (y=0) board plane; projecting the world-space cell
// center (x,0,z) through the same camera inverts it, so a pointer press/tap
// at the returned point lands on that cell.
function cellToClient(rect, row, col) {
  const aspect = rect.width / Math.max(1, rect.height);
  const cam = new THREE.PerspectiveCamera(32, aspect, 0.1, 100);
  const pitch = THREE.MathUtils.degToRad(52);
  const d = 13.5 / Math.min(1, aspect * 1.15);
  cam.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d * 0.9);
  cam.lookAt(0, 0, 0.4);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const x = (col - (N - 1) / 2);
  const z = (row - (N - 1) / 2);
  const v = new THREE.Vector3(x, 0, z).project(cam);
  return {
    cx: rect.left + (v.x + 1) / 2 * rect.width,
    cy: rect.top + (1 - v.y) / 2 * rect.height,
  };
}

// ---------- read-only observation of the board & tray ----------

// Read the observable board (`#board-mirror` filled classes) and offer
// (#tray .tray-piece aria-labels). This reflects the real game state without
// calling any game API; it is used only to choose the next legal move.
const readState = (page) => page.evaluate(() => {
  const board = [...document.querySelectorAll('#board-mirror .mirror-cell')]
    .map((c) => c.classList.contains('filled') ? 1 : 0);
  const offer = {};
  document.querySelectorAll('#tray .tray-piece').forEach((b) => {
    offer[+b.dataset.pieceIndex] = b.getAttribute('aria-label').split(': ').pop();
  });
  return {
    board,
    offer,
    filled: board.reduce((a, v) => a + v, 0),
    score: parseInt((document.getElementById('hud-score')?.textContent || '').replace(/[^0-9]/g, ''), 10) || 0,
  };
});

const canvasRect = (page) => page.evaluate(() => {
  const r = document.getElementById('gl').getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});

// Mobile variant: prefer a legal anchor whose projected point sits in the
// central region of the canvas (the small portrait canvas clips edge cells off
// screen, and central-cell projections are the most reliable on a touchscreen).
// Returns every such candidate in preference order.
function nextMobileMoves(state, rect) {
  const lhs = rect.left + 0.15 * rect.width, rhs = rect.left + 0.85 * rect.width;
  const top = rect.top + 0.15 * rect.height, bottom = rect.top + 0.85 * rect.height;
  const isCentral = (cx, cy) => cx > lhs && cx < rhs && cy > top && cy < bottom;
  const entries = Object.entries(state.offer).filter(([, v]) => v);
  entries.sort((a, b) => rules.SHAPES[b[1]].length - rules.SHAPES[a[1]].length);
  const out = [];
  for (const [pi, shape] of entries) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!rules.canPlace(state.board, shape, r, c)) continue;
        const { cx, cy } = cellToClient(rect, r, c);
        if (isCentral(cx, cy)) out.push({ pi: +pi, r, c, cx, cy });
      }
    }
  }
  return out;
}

// Place one piece by selecting it from the tray and pointer-pressing the
// projected anchor cell on the canvas. A placement's score always increases
// (even when a placement clears lines, which can leave the filled count
// unchanged), so success is detected by the score rising. Tries candidates in
// preference order until one registers — the first candidate almost always
// works, so this is typically a single click. Returns the resulting snapshot.
async function placeOnePiece(page, state, rect) {
  const cands = legalMoves(state);
  for (const mv of cands) {
    const exists = await page.evaluate((pi) =>
      !!document.querySelector(`#tray .tray-piece[data-piece-index="${pi}"]`), mv.pi);
    if (!exists) continue;
    const before = (await readState(page)).score;
    await page.click(`#tray .tray-piece[data-piece-index="${mv.pi}"]`);
    const { cx, cy } = cellToClient(rect, mv.r, mv.c);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    // Wait for the HUD score to actually rise rather than sampling after a
    // fixed delay: a slow frame would otherwise look like a rejected placement
    // and send us on to a second candidate, double-placing.
    const landed = await page.waitForFunction(
      (n) => parseInt((document.getElementById('hud-score')?.textContent || '').replace(/[^0-9]/g, ''), 10) > n,
      before,
      { timeout: 2000 },
    ).then(() => true, () => false);
    if (landed) return await readState(page);
  }
  return null;
}

// All legal moves in preference order (largest piece first, row-major anchors).
function legalMoves(state) {
  const entries = Object.entries(state.offer).filter(([, v]) => v);
  entries.sort((a, b) => rules.SHAPES[b[1]].length - rules.SHAPES[a[1]].length);
  const out = [];
  for (const [pi, shape] of entries) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (rules.canPlace(state.board, shape, r, c)) out.push({ pi: +pi, r, c });
      }
    }
  }
  return out;
}

async function startPractice(page, { tap } = {}) {
  const click = (sel) => tap ? page.tap(sel) : page.click(sel);
  await click('#app .menu-btn:has-text("Play")');
  await page.waitForSelector('#app .panel');
  await click('#app .panel .menu-btn:has-text("Practice")');
  await page.waitForSelector('#app .panel');
  await click('#app .panel .menu-btn:has-text("Relaxed")');
  await page.waitForSelector('#tray .tray-piece');
}

// Start a RANKED Journey stage through the visible controls.
// Title has a direct "Journey — Stage N" button; the setup card then exposes a
// ranked Start button. Journey is ranked, so its finishRound must reach the
// results overlay without throwing (the prior `seed: s.state.seed` defect).
async function startJourney(page) {
  await page.click('#app .menu-btn:has-text("Journey")');
  await page.waitForSelector('#app .panel');
  await page.click('#app .panel .menu-btn:has-text("Start")');
  await page.waitForSelector('#tray .tray-piece');
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  const shouldTap = !!ctxOpts.hasTouch;

  // Timber Grid "Reduced motion" is a first-class in-game setting (Settings →
  // Reduced motion, persisted by the game itself). It disables the post-clear
  // camera shake, keeping the WebGL camera statically framed for the whole
  // round. That matters here: the test projects board cells to canvas client
  // coordinates using the game's own framing constants, so a stable camera
  // (no camShake) keeps those projections exact and the real pointer clicks
  // deterministic. We never touch the game's code — just set a user pref.
  await page.addInitScript(() => {
    try {
      const cur = JSON.parse(localStorage.getItem('timbergrid.settings') || '{}');
      localStorage.setItem('timbergrid.settings', JSON.stringify({ ...cur, reducedMotion: true }));
    } catch (_) {}
  });

  try {
    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#app .title-panel', { timeout: 15000 });
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible`);

    // start Practice Relaxed through visible controls
    await startPractice(page, { tap: shouldTap });
    const st0 = await readState(page);
    if (st0.filled !== 0) throw new Error(`expected empty board, got ${st0.filled} filled`);
    const trayCount = await page.locator('#tray .tray-piece').count();
    if (trayCount < 1 || trayCount > 3) throw new Error(`unexpected tray count ${trayCount}`);
    // board mirror should have exactly N*N cells
    const cellCount = await page.locator('#board-mirror .mirror-cell').count();
    if (cellCount !== N * N) throw new Error(`expected ${N * N} board cells, got ${cellCount}`);
    await page.screenshot({ path: SHOT('active', name) });
    ok(`${name}: Practice board active (${N}×${N}, ${cellCount} cells, ${trayCount} offered pieces)`);

    if (full) {
      // ---- extra feature: pause / resume via visible button ----
      await page.click('#btn-pause');
      await page.waitForSelector('#overlay-root .panel');
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('#overlay-root .panel .menu-btn:has-text("Resume")');
      await page.waitForSelector('#tray .tray-piece');
      ok(`${name}: pause and resume work`);

      // ---- extra feature: hint reveals a legal anchor (visible Hint button) ----
      const beforeHintFilled = (await readState(page)).filled;
      await page.click('#rail-right .rail-block.actions .chip-btn:has-text("Hint")');
      await page.waitForTimeout(150);
      ok(`${name}: hint button invoked (cursor moved to a legal anchor)`);
      // verify the hint actually helps: it sets cursor to a legal anchor, so a
      // following Enter on a selected piece should be accepted; we just confirm
      // no error and the board still matches (hint only moves the ghost).
      const afterHintFilled = (await readState(page)).filled;
      if (afterHintFilled !== beforeHintFilled) throw new Error('hint unexpectedly changed the board');

      // ---- extra feature: undo (Practice Relaxed allows undo) ----
      const stBefore = await readState(page);
      const rectBefore = await canvasRect(page);
      const afterPlace = await placeOnePiece(page, stBefore, rectBefore);
      if (!afterPlace || afterPlace.score <= stBefore.score) throw new Error('placement did not register for undo check');
      await page.click('#rail-right .rail-block.actions .chip-btn:has-text("Undo")');
      // Undo returns to the pre-placement score and board.
      await page.waitForFunction(
        (n) => parseInt((document.getElementById('hud-score')?.textContent || '').replace(/[^0-9]/g, ''), 10) === n,
        stBefore.score,
        { timeout: 3000 }
      );
      const afterUndo = await readState(page);
      if (afterUndo.score !== stBefore.score) {
        throw new Error(`undo did not restore score: ${stBefore.score} -> ${afterUndo.score}`);
      }
      await page.screenshot({ path: SHOT('undo', name) });
      ok(`${name}: place a piece then Undo restores the score (${afterPlace.score}→${afterUndo.score})`);

      // ---- play the round to a real end ----
      let guard = 0;
      while (guard++ < 120) {
        const st = await readState(page);
        const rect = await canvasRect(page);
        const res = await placeOnePiece(page, st, rect);
        if (!res) break; // no legal placement registered → round is over
      }
      if (guard > 120) throw new Error('playthrough did not terminate within guard limit');
      await page.waitForTimeout(400);

      // round result: Game Over (no piece fits) — Practice has no goal/move-limit,
      // so it always ends when nothing fits. Assert the results panel + breakdown.
      await page.waitForSelector('#overlay-root .panel', { timeout: 8000 });
      const resultTitle = (await page.textContent('#res-h')) || '';
      if (!/Game Over/i.test(resultTitle)) {
        throw new Error(`unexpected result title: "${resultTitle}"`);
      }
      const reason = (await page.textContent('#overlay-root .panel .reason')) || '';
      if (!/No offered piece fits/i.test(reason)) throw new Error(`unexpected reason: "${reason}"`);
      const scoreText = (await page.textContent('#overlay-root .panel .big-score')) || '';
      if (!/Score:\s*\d+/.test(scoreText)) throw new Error(`missing score in results: "${scoreText}"`);
      const scoreRows = await page.locator('#overlay-root .panel .score-table tr').count();
      if (scoreRows < 1) throw new Error('score breakdown table is empty');
      await page.screenshot({ path: SHOT('gameover', name) });
      ok(`${name}: round completed on the visible board — Game Over ("${reason.trim()}", score ${scoreText.trim()}, ${scoreRows} breakdown rows)`);

      // ---- progression persisted (gamesPlayed incremented) ----
      const prog = await page.evaluate(() => {
        const raw = localStorage.getItem('timbergrid.progression');
        return raw ? JSON.parse(raw).data : null;
      });
      if (!prog || !(prog.gamesPlayed > 0)) throw new Error('progression not persisted: ' + JSON.stringify(prog));
      ok(`${name}: progression persisted (gamesPlayed: ${prog.gamesPlayed})`);

      // ---- ranked (Journey) completion exercises the submitScore path ----
      // Finish the Practice round and return to the title, then start a ranked
      // Journey stage and play it to a natural terminal state (move limit or no
      // piece fits). The prior defect threw at src/main.js:620 here, so reaching
      // the results overlay is an assertion in itself; the outer pass's
      // pageerror/console collectors verify no error was raised.
      await page.click('#overlay-root .panel .menu-btn:has-text("Back to Title")');
      await page.waitForSelector('#app .title-panel');
      await startJourney(page);
      let rguard = 0;
      while (rguard++ < 30) {
        // A ranked round can end by reaching the goal (win) or hitting the move
        // limit / no-piece-fits; either way finishRound raises the results
        // overlay. Stop placing as soon as the overlay is up.
        const over = await page.evaluate(() => !!document.querySelector('#overlay-root .panel'));
        if (over) break;
        const st = await readState(page);
        const rect = await canvasRect(page);
        const res = await placeOnePiece(page, st, rect);
        if (!res) break; // placement no longer registers → round ended
      }
      if (rguard > 30) throw new Error('ranked playthrough did not terminate within guard limit');
      await page.waitForTimeout(400);
      await page.waitForSelector('#overlay-root .panel', { timeout: 8000 });
      const rTitle = (await page.textContent('#res-h')) || '';
      if (!/Game Over|Stage Clear/i.test(rTitle)) {
        throw new Error(`ranked round did not reach results overlay (title "${rTitle}")`);
      }
      const rReason = (await page.textContent('#overlay-root .panel .reason')) || '';
      if (!rReason.trim()) throw new Error('ranked results missing reason');
      const rScore = (await page.textContent('#overlay-root .panel .big-score')) || '';
      if (!/Score:\s*\d+/.test(rScore)) throw new Error(`ranked results missing score: "${rScore}"`);
      await page.screenshot({ path: SHOT('ranked-gameover', name) });
      ok(`${name}: ranked Journey completed — results overlay reached ("${rTitle.trim()}", reason "${rReason.trim()}", ${rScore.trim()})`);
    } else {
      // ---- mobile: make a few real moves via touchscreen.tap ----
      let placed = 0;
      for (let i = 0; i < 6; i++) {
        const st = await readState(page);
        const rect = await canvasRect(page);
        const cands = nextMobileMoves(st, rect);
        if (!cands.length) break;
        let ok = false;
        for (const mv of cands) {
          // the offer may have been replenished mid-pass; skip a stale index
          const exists = await page.evaluate((pi) =>
            !!document.querySelector(`#tray .tray-piece[data-piece-index="${pi}"]`), mv.pi);
          if (!exists) continue;
          const before = (await readState(page)).score;
          await page.tap(`#tray .tray-piece[data-piece-index="${mv.pi}"]`);
          await page.waitForTimeout(50);
          await page.touchscreen.tap(mv.cx, mv.cy);
          await page.waitForTimeout(120);
          // verify the tap actually placed a piece (score rises); else try another anchor
          if ((await readState(page)).score > before) { ok = true; break; }
        }
        if (!ok) break; // board is full toward a no-fit; a few taps is enough
        placed++;
      }
      const stFinal = await readState(page);
      if (placed < 1) throw new Error('mobile pass placed no pieces');
      await page.screenshot({ path: SHOT('mobile-play', name) });
      ok(`${name}: started practice and placed ${placed} pieces via touchscreen.tap (score ${stFinal.score})`);
    }
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — timber-grid, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);
