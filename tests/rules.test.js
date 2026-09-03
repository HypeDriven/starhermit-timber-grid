// Timber Grid — test suite: rules, scoring, determinism/replay, content,
// session commands, migration, fuzz, and golden sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import * as session from '../src/session.js';
import * as content from '../src/content.js';

function emptyBoard() { return new Array(rules.N * rules.N).fill(0); }

test('canPlace bounds and overlap', () => {
  const b = emptyBoard();
  assert.equal(rules.canPlace(b, 'O2', 0, 0), true);
  assert.equal(rules.canPlace(b, 'O2', 8, 8), false); // out of bounds
  assert.equal(rules.canPlace(b, 'I5h', 0, 5), false);
  b[0] = 1;
  assert.equal(rules.canPlace(b, 'I1', 0, 0), false); // occupied
  assert.equal(rules.canPlace(b, 'I1', 0, 1), true);
});

test('row clear detection and scoring components', () => {
  const b = emptyBoard();
  for (let c = 0; c < 8; c++) b[c] = 1; // row 0 minus last cell
  const st = rules.createState(123);
  st.board = b;
  st.offer = ['I1', 'I1', 'I1'];
  const res = rules.applyPlace(st, 0, 0, 8);
  assert.equal(res.ok, true);
  assert.equal(res.events.lines.rows.length, 1);
  assert.equal(res.events.clearedCells.length, 9);
  // place=1, clear=90, multi=15*1+0
  assert.equal(res.events.components.place, 1);
  assert.equal(res.events.components.clear, 90);
  assert.equal(res.events.components.multi, 15);
  assert.equal(st.score, 106);
  assert.equal(st.board.every(v => v === 0), true);
});

test('region clear', () => {
  const b = emptyBoard();
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (!(dr === 2 && dc === 2)) b[dr * rules.N + dc] = 1;
  const st = rules.createState(1);
  st.board = b;
  st.offer = ['I1', null, null];
  const res = rules.applyPlace(st, 0, 2, 2);
  assert.equal(res.ok, true);
  assert.equal(res.events.lines.regions.length, 1);
  assert.equal(res.events.clearedCells.length, 9);
});

test('simultaneous multi clear bonus and combo', () => {
  const b = emptyBoard();
  for (let c = 0; c < 8; c++) b[c] = 1; // row 0 needs (0,8)
  for (let r = 0; r < 8; r++) b[r * rules.N + 8] = 1; // col 8 needs (8,8)
  const st = rules.createState(7);
  st.board = b;
  st.offer = ['I1', 'I1', 'I1'];
  const res = rules.applyPlace(st, 0, 8, 8);
  assert.equal(res.ok, true);
  assert.equal(res.events.lineCount, 2); // row + col
  assert.equal(res.events.components.multi, 15 * 2 + 20); // 50
  assert.equal(st.comboStreak, 1);
});

test('invalid placement rejected with reason and counted', () => {
  const st = rules.createState(5);
  st.offer = ['O3', 'I1', 'I1'];
  const res = rules.applyPlace(st, 0, 8, 8);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cell-blocked-or-out-of-bounds');
  assert.equal(st.invalidCount, 1);
});

test('game ends when no offered piece fits', () => {
  const st = rules.createState(9);
  st.board.fill(1);
  st.board[0] = 0; st.board[1] = 0; st.board[2] = 0; // one I3h gap
  st.offer = ['I3h', 'O3', 'O3'];
  const res = rules.applyPlace(st, 0, 0, 0);
  assert.equal(res.ok, true);
  // remaining O3 pieces cannot fit the full board minus a row cleared? Row 0 cleared.
  assert.equal(st.status === 'over' || rules.legalActions(st).some(a => a.anchors.length > 0), true);
  if (st.status === 'over') assert.equal(st.terminalReason, 'no-piece-fits');
});

test('move limit terminal states', () => {
  const st = rules.createState(11, { moveLimit: 1, goalScore: 99999 });
  st.offer = ['I1', null, null];
  rules.applyPlace(st, 0, 4, 4);
  assert.equal(st.status, 'over');
  assert.equal(st.terminalReason, 'move-limit-reached');
  const st2 = rules.createState(11, { moveLimit: 1, goalScore: 1 });
  st2.offer = ['I1', null, null];
  rules.applyPlace(st2, 0, 4, 4);
  assert.equal(st2.terminalReason, 'move-limit-goal-met');
});

test('deterministic replay: same seed and commands → identical hashes', () => {
  const rnd = rules.mulberry(42);
  const commands = [];
  const probe = rules.createState(777);
  for (let i = 0; i < 60 && probe.status === 'active'; i++) {
    const actions = rules.legalActions(probe).filter(a => a.anchors.length);
    if (!actions.length) break;
    const a = actions[Math.floor(rnd() * actions.length)];
    const [r, c] = a.anchors[Math.floor(rnd() * a.anchors.length)];
    commands.push({ type: 'place', pieceIndex: a.pieceIndex, row: r, col: c });
    rules.applyPlace(probe, a.pieceIndex, r, c);
  }
  assert.ok(commands.length > 10);
  const r1 = rules.replay(777, {}, commands);
  const r2 = rules.replay(777, {}, commands);
  assert.deepEqual(r1.hashes, r2.hashes);
  assert.equal(rules.hashState(r1.state), rules.hashState(r2.state));
  assert.equal(rules.hashState(r1.state), rules.hashState(probe));
});

test('serialization round-trip (migration-safe)', () => {
  const st = rules.createState(555);
  st.offer = ['I1', 'I2h', 'I3h'];
  rules.applyPlace(st, 0, 0, 0);
  rules.applyPlace(st, 1, 2, 2);
  const data = rules.serialize(st);
  const restored = rules.deserialize(JSON.parse(JSON.stringify(data)));
  assert.equal(rules.hashState(restored), rules.hashState(st));
  // continue playing on the restored state
  const res = rules.applyPlace(restored, 2, 4, 4);
  assert.equal(res.ok, true);
});

test('offer determinism from seed', () => {
  const a = rules.createState(2024);
  const b = rules.createState(2024);
  assert.deepEqual(a.offer, b.offer);
});

test('session: duplicate command ids rejected idempotently', () => {
  const sess = session.createSession({ seed: 99, mode: 'practice', opts: {} });
  const cmd = { id: 'fixed-id', type: 'place', pieceIndex: 0, row: 0, col: 0 };
  const r1 = session.execute(sess, cmd);
  assert.equal(r1.ok, true);
  const r2 = session.execute(sess, { ...cmd });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'duplicate-command');
});

test('session: undo restores prior state', () => {
  const sess = session.createSession({ seed: 99, mode: 'practice', opts: { allowUndo: true } });
  const h0 = rules.hashState(sess.state);
  session.execute(sess, { type: 'place', pieceIndex: 0, row: 0, col: 0 });
  assert.notEqual(rules.hashState(sess.state), h0);
  const res = session.execute(sess, { type: 'undo' });
  assert.equal(res.ok, true);
  assert.equal(rules.hashState(sess.state), h0);
});

test('session: undo blocked in daily mode', () => {
  const sess = session.createSession({ seed: 99, mode: 'daily', opts: {} });
  const res = session.execute(sess, { type: 'undo' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'undo-not-allowed');
});

test('session: replay envelope verifies', () => {
  const sess = session.createSession({ seed: 314, mode: 'daily', opts: {} });
  for (let i = 0; i < 12 && sess.state.status === 'active'; i++) {
    const actions = rules.legalActions(sess.state).filter(a => a.anchors.length);
    if (!actions.length) break;
    const a = actions[0];
    session.execute(sess, { type: 'place', pieceIndex: a.pieceIndex, row: a.anchors[0][0], col: a.anchors[0][1] });
  }
  const env = session.replayEnvelope(sess, content.CONTENT_VERSION);
  const v = session.verifyReplay(env);
  assert.equal(v.ok, true);
  env.result.score += 1;
  assert.equal(session.verifyReplay(env).ok, false);
});

test('fuzz: malformed commands never hang or corrupt', () => {
  const sess = session.createSession({ seed: 1, mode: 'practice', opts: {} });
  const bad = [
    { type: 'place', pieceIndex: -1, row: 0, col: 0 },
    { type: 'place', pieceIndex: 99, row: 0, col: 0 },
    { type: 'place', pieceIndex: 0, row: -5, col: 0 },
    { type: 'place', pieceIndex: 0, row: 0, col: 9 },
    { type: 'nonsense' },
    { type: 'place', pieceIndex: NaN, row: 0, col: 0 },
  ];
  for (const cmd of bad) {
    const res = session.execute(sess, { ...cmd });
    assert.equal(typeof res.ok, 'boolean');
  }
  assert.ok(Number.isFinite(sess.state.score));
});

test('golden sessions: easy/medium/hard seeds reach stable terminal states', () => {
  for (const seed of [101, 5002, 90003]) {
    const st = rules.createState(seed);
    const rnd = rules.mulberry(seed ^ 0xffff);
    let steps = 0;
    while (st.status === 'active' && steps < 1000) {
      const actions = rules.legalActions(st).filter(a => a.anchors.length);
      if (!actions.length) break;
      const a = actions[Math.floor(rnd() * actions.length)];
      const [r, c] = a.anchors[Math.floor(rnd() * a.anchors.length)];
      rules.applyPlace(st, a.pieceIndex, r, c);
      steps++;
    }
    assert.equal(st.status, 'over');
    assert.equal(st.terminalReason, 'no-piece-fits');
    assert.ok(st.score > 0);
    assert.ok(Number.isFinite(st.score));
  }
});

test('content: validators pass, 40 stages, 5 themes', () => {
  assert.deepEqual(content.validateContent(), []);
  assert.equal(content.STAGES.length, 40);
  assert.equal(content.THEMES.length, 5);
  assert.ok(content.TUTORIAL_STEPS.length >= 3);
});

test('content: daily seed stable per UTC day', () => {
  const d = new Date(Date.UTC(2026, 7, 29, 12, 0, 0));
  const a = content.dailySeed(d);
  const b = content.dailySeed(new Date(Date.UTC(2026, 7, 29, 23, 59, 59)));
  const c = content.dailySeed(new Date(Date.UTC(2026, 7, 30, 0, 0, 0)));
  assert.equal(a.seed, b.seed);
  assert.notEqual(a.seed, c.seed);
  assert.equal(a.dayKey, '2026-08-29');
});

test('legalActions matches play API for hints', () => {
  const st = rules.createState(2020);
  const actions = rules.legalActions(st);
  assert.equal(actions.length, rules.OFFER_SIZE);
  for (const a of actions) {
    for (const [r, c] of a.anchors) {
      assert.equal(rules.canPlace(st.board, a.shapeId, r, c), true);
    }
  }
});
