// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Relaxed practice board and keeps placing pieces like a player — tray piece, then a press on
// the 3D board cell (located through the renderer's own camera projection) — preferring placements that
// clear lines, so piece pops, clear plates, wood chips, sawdust motes and the ghost run all the time.
// "Play again" from the results restarts the board.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  const press = (sel) => page.click(sel, { timeout: 10000 });
  await page.waitForSelector('#app .title-panel', { timeout: 20000 });
  await press('#app .title-panel .menu-btn[data-action="settings"]');
  await press('#settings-graphics');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('.graphics-panel .menu-btn[data-action="back"]').scrollIntoViewIfNeeded();
  await press('.graphics-panel .menu-btn[data-action="back"]');
  await page.waitForSelector('#settings-graphics');
  await page.locator('.settings-panel .menu-btn[data-action="back"]').scrollIntoViewIfNeeded();
  await press('.settings-panel .menu-btn[data-action="back"]');
  await page.waitForSelector('#app .title-panel');
}

// The best legal placement from what the player sees (#board-mirror cells, tray piece labels):
// the one that clears the most lines, else the largest piece at the first fit.
const nextMove = (page) => page.evaluate(async () => {
  const R = await import('./src/rules.js');
  const board = [...document.querySelectorAll('#board-mirror .mirror-cell')].map((c) => (c.classList.contains('filled') ? 1 : 0));
  const tray = [...document.querySelectorAll('#tray .tray-piece')];
  if (!tray.length || board.length !== R.N * R.N) return null;
  let best = null;
  for (const b of tray) {
    const pi = +b.dataset.pieceIndex, shape = b.getAttribute('aria-label').split(': ').pop();
    if (!R.SHAPES[shape]) continue;
    for (let r = 0; r < R.N; r++) for (let c = 0; c < R.N; c++) {
      if (!R.canPlace(board, shape, r, c)) continue;
      const nb = board.slice();
      for (const [rr, cc] of R.shapeCells(shape, r, c)) nb[rr * R.N + cc] = 1;
      const lines = R.detectFullLines(nb);
      const n = Array.isArray(lines) ? lines.length : Object.values(lines || {}).flat().length;
      const score = n * 100 + R.SHAPES[shape].length;
      if (!best || score > best.score) best = { pi, r, c, score };
    }
  }
  if (!best) return null;
  return { ...best, pos: window.__tgCellToClient(best.r, best.c) };
});

async function step(page) {
  const again = page.locator('.panel:has(#res-h) .menu-btn.primary');
  if (await again.count()) { await again.first().click({ timeout: 3000 }); await page.waitForSelector('#tray .tray-piece'); return; }
  const m = await nextMove(page);
  if (!m || !m.pos) return;
  await page.click(`#tray .tray-piece[data-piece-index="${m.pi}"]`, { timeout: 3000 });
  await page.mouse.move(m.pos.cx, m.pos.cy);
  await page.mouse.down();
  await page.mouse.up();
}

export async function start(page) {
  await page.click('#app .title-panel .menu-btn[data-action="play"]');
  await page.click('#app .panel .menu-btn[data-action="practice"]');
  await page.click('#app .panel .menu-btn[data-action="practice-relaxed"]');
  await page.waitForSelector('#tray .tray-piece');
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
