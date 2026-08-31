// Timber Grid — pure deterministic rules engine.
// No DOM, no rendering. Usable from browser, Node tests, and the server.

export const N = 9;
export const RULES_VERSION = 1;
export const OFFER_SIZE = 3;

// Piece shapes as [dr, dc] cell offsets. Original set for Timber Grid.
export const SHAPES = {
  I1: [[0, 0]],
  I2h: [[0, 0], [0, 1]],
  I2v: [[0, 0], [1, 0]],
  I3h: [[0, 0], [0, 1], [0, 2]],
  I3v: [[0, 0], [1, 0], [2, 0]],
  I4h: [[0, 0], [0, 1], [0, 2], [0, 3]],
  I4v: [[0, 0], [1, 0], [2, 0], [3, 0]],
  I5h: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  I5v: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  O2: [[0, 0], [0, 1], [1, 0], [1, 1]],
  O3: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]],
  L3: [[0, 0], [1, 0], [1, 1]],
  L4: [[0, 0], [1, 0], [2, 0], [2, 1]],
  T4: [[0, 0], [0, 1], [0, 2], [1, 1]],
  S4: [[0, 0], [0, 1], [1, 1], [1, 2]],
  P5: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
  U5: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
  X5: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
};

export const SHAPE_IDS = Object.keys(SHAPES);

// Seeded PRNG (mulberry32). Separate streams per purpose.
export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shapeCells(shapeId, row, col) {
  const shape = SHAPES[shapeId];
  if (!shape) return null;
  return shape.map(([dr, dc]) => [row + dr, col + dc]);
}

// --- legality ------------------------------------------------------------

export function canPlace(board, shapeId, row, col) {
  const cells = shapeCells(shapeId, row, col);
  if (!cells) return false;
  for (const [r, c] of cells) {
    if (r < 0 || r >= N || c < 0 || c >= N) return false;
    if (board[r * N + c] !== 0) return false;
  }
  return true;
}

export function anyFit(board, shapeId) {
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (canPlace(board, shapeId, r, c)) return true;
  return false;
}

export function firstFit(board, shapeId) {
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (canPlace(board, shapeId, r, c)) return [r, c];
  return null;
}

// Legal actions for a state: for each offered piece index, the anchor cells
// where it can be placed. Tutorials/hints use this same API.
export function legalActions(state) {
  const out = [];
  for (let i = 0; i < state.offer.length; i++) {
    const shapeId = state.offer[i];
    if (!shapeId) continue;
    const anchors = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (canPlace(state.board, shapeId, r, c)) anchors.push([r, c]);
    out.push({ pieceIndex: i, shapeId, anchors });
  }
  return out;
}

// --- clears ---------------------------------------------------------------

// Returns { rows: [r...], cols: [c...], regions: [regionIndex...] } of full lines.
export function detectFullLines(board) {
  const rows = [];
  const cols = [];
  const regions = [];
  for (let r = 0; r < N; r++) {
    let ok = true;
    for (let c = 0; c < N; c++) if (board[r * N + c] === 0) { ok = false; break; }
    if (ok) rows.push(r);
  }
  for (let c = 0; c < N; c++) {
    let ok = true;
    for (let r = 0; r < N; r++) if (board[r * N + c] === 0) { ok = false; break; }
    if (ok) cols.push(c);
  }
  for (let ri = 0; ri < 9; ri++) {
    const br = Math.floor(ri / 3) * 3;
    const bc = (ri % 3) * 3;
    let ok = true;
    for (let dr = 0; dr < 3 && ok; dr++)
      for (let dc = 0; dc < 3 && ok; dc++)
        if (board[(br + dr) * N + (bc + dc)] === 0) ok = false;
    if (ok) regions.push(ri);
  }
  return { rows, cols, regions };
}

export function clearCellSet(lines) {
  const set = new Set();
  for (const r of lines.rows) for (let c = 0; c < N; c++) set.add(r * N + c);
  for (const c of lines.cols) for (let r = 0; r < N; r++) set.add(r * N + c);
  for (const ri of lines.regions) {
    const br = Math.floor(ri / 3) * 3;
    const bc = (ri % 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) set.add((br + dr) * N + (bc + dc));
  }
  return set;
}

// --- offer generation ------------------------------------------------------

// Weighted offer draw from a seeded stream. Deterministic given (seed, counter).
export function drawOffer(rnd) {
  const offer = [];
  for (let i = 0; i < OFFER_SIZE; i++) {
    const idx = Math.floor(rnd() * SHAPE_IDS.length);
    offer.push(SHAPE_IDS[idx]);
  }
  return offer;
}

// --- scoring ----------------------------------------------------------------
// Components (all integers):
//   place:    1 point per cell placed
//   clear:    10 points per cleared cell (unique cells)
//   multi:    15 * k + 20 * (k - 1) when k >= 1 lines clear simultaneously
//   combo:    25 * comboStreak (streak of consecutive placements that clear)
export function scorePlacement(placedCells, clearedCellCount, lineCount, comboStreak) {
  const place = placedCells;
  const clear = clearedCellCount * 10;
  const multi = lineCount > 0 ? 15 * lineCount + 20 * (lineCount - 1) : 0;
  const combo = lineCount > 0 && comboStreak > 1 ? 25 * (comboStreak - 1) : 0;
  return { place, clear, multi, combo, total: place + clear + multi + combo };
}

// --- state ------------------------------------------------------------------

export function createState(seed, opts = {}) {
  const rnd = mulberry(seed >>> 0);
  const state = {
    version: RULES_VERSION,
    seed: seed >>> 0,
    tick: 0, // monotonically increasing turn number
    board: new Array(N * N).fill(0),
    offer: drawOffer(rnd),
    offerCounter: 1,
    score: 0,
    breakdown: { place: 0, clear: 0, multi: 0, combo: 0 },
    comboStreak: 0,
    bestCombo: 0,
    placedCount: 0,
    clearedTotal: 0,
    invalidCount: 0,
    startedAt: 0, // authoritative elapsed tracking (ms, set by session)
    elapsedMs: 0,
    status: 'active', // 'active' | 'over'
    terminalReason: null,
    moveLimit: typeof opts.moveLimit === 'number' ? opts.moveLimit : null,
    goalScore: typeof opts.goalScore === 'number' ? opts.goalScore : null,
    _rnd: rnd,
  };
  return state;
}

export function drawCounter(state) {
  // Rebuild deterministic stream position: we persist the counter and reseed.
  return state.offerCounter;
}

// Apply a placement command. Mutates state (rules engine is the only mutator).
// Returns { ok: true, events } or { ok: false, reason }.
export function applyPlace(state, pieceIndex, row, col) {
  if (state.status !== 'active') return { ok: false, reason: 'game-over' };
  if (pieceIndex < 0 || pieceIndex >= state.offer.length || !state.offer[pieceIndex])
    return { ok: false, reason: 'no-such-piece' };
  const shapeId = state.offer[pieceIndex];
  if (!canPlace(state.board, shapeId, row, col)) {
    state.invalidCount++;
    return { ok: false, reason: 'cell-blocked-or-out-of-bounds' };
  }

  const cells = shapeCells(shapeId, row, col);
  for (const [r, c] of cells) state.board[r * N + c] = 1;

  const lines = detectFullLines(state.board);
  const lineCount = lines.rows.length + lines.cols.length + lines.regions.length;
  let clearedCells = [];
  if (lineCount > 0) {
    const set = clearCellSet(lines);
    clearedCells = [...set];
    for (const idx of set) state.board[idx] = 0;
    state.comboStreak++;
    if (state.comboStreak > state.bestCombo) state.bestCombo = state.comboStreak;
  } else {
    state.comboStreak = 0;
  }

  const comp = scorePlacement(cells.length, clearedCells.length, lineCount, state.comboStreak);
  state.score += comp.total;
  state.breakdown.place += comp.place;
  state.breakdown.clear += comp.clear;
  state.breakdown.multi += comp.multi;
  state.breakdown.combo += comp.combo;
  state.clearedTotal += clearedCells.length;
  state.placedCount++;
  state.tick++;

  state.offer[pieceIndex] = null;
  let replenished = false;
  if (state.offer.every(p => p === null)) {
    state.offer = drawOffer(state._rnd);
    state.offerCounter++;
    replenished = true;
  }

  // Terminal checks.
  if (state.moveLimit !== null && state.placedCount >= state.moveLimit) {
    const won = state.goalScore === null || state.score >= state.goalScore;
    state.status = 'over';
    state.terminalReason = won ? 'move-limit-goal-met' : 'move-limit-reached';
  } else if (state.goalScore !== null && state.score >= state.goalScore) {
    state.status = 'over';
    state.terminalReason = 'goal-score-reached';
  } else {
    const fits = state.offer.some(p => p && anyFit(state.board, p));
    if (!fits) {
      state.status = 'over';
      state.terminalReason = 'no-piece-fits';
    }
  }

  return {
    ok: true,
    events: {
      shapeId, row, col, cells,
      lines, lineCount, clearedCells,
      components: comp, replenished,
      status: state.status, terminalReason: state.terminalReason,
    },
  };
}

// --- serialization, hashing, replay ------------------------------------------

export function serialize(state) {
  return {
    version: state.version,
    seed: state.seed,
    tick: state.tick,
    board: state.board.slice(),
    offer: state.offer.slice(),
    offerCounter: state.offerCounter,
    score: state.score,
    breakdown: { ...state.breakdown },
    comboStreak: state.comboStreak,
    bestCombo: state.bestCombo,
    placedCount: state.placedCount,
    clearedTotal: state.clearedTotal,
    invalidCount: state.invalidCount,
    elapsedMs: state.elapsedMs,
    status: state.status,
    terminalReason: state.terminalReason,
    moveLimit: state.moveLimit,
    goalScore: state.goalScore,
  };
}

export function deserialize(data) {
  const state = createState(data.seed, { moveLimit: data.moveLimit, goalScore: data.goalScore });
  // Rebuild the PRNG stream to the persisted position.
  const rnd = mulberry(data.seed >>> 0);
  for (let i = 0; i < data.offerCounter; i++) drawOffer(rnd);
  Object.assign(state, {
    tick: data.tick,
    board: data.board.slice(),
    offer: data.offer.slice(),
    offerCounter: data.offerCounter,
    score: data.score,
    breakdown: { ...data.breakdown },
    comboStreak: data.comboStreak,
    bestCombo: data.bestCombo,
    placedCount: data.placedCount,
    clearedTotal: data.clearedTotal,
    invalidCount: data.invalidCount,
    elapsedMs: data.elapsedMs || 0,
    status: data.status,
    terminalReason: data.terminalReason,
    _rnd: rnd,
  });
  return state;
}

// Stable FNV-1a hash of the serializable state for replay verification.
export function hashState(state) {
  const s = serialize(state);
  const str = JSON.stringify([s.tick, s.score, s.board.join(''), s.offer.map(o => o || '.').join(','),
    s.breakdown.place, s.breakdown.clear, s.breakdown.multi, s.breakdown.combo,
    s.comboStreak, s.placedCount, s.status, s.terminalReason || '']);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Replay an ordered command log from a seed; returns final state + hashes.
export function replay(seed, opts, commands) {
  const state = createState(seed, opts);
  const hashes = [hashState(state)];
  for (const cmd of commands) {
    if (cmd.type === 'place') applyPlace(state, cmd.pieceIndex, cmd.row, cmd.col);
    hashes.push(hashState(state));
  }
  return { state, hashes };
}
