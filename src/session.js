// Timber Grid — session layer: commands, undo, snapshots, replay envelope.
// The only path that mutates rules state; every mutation is a validated command.
import * as rules from './rules.js';

let cmdCounter = 0;

export function createSession({ seed, mode, opts = {}, meta = {} }) {
  const state = rules.createState(seed, opts);
  return {
    id: `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    mode, // 'learn' | 'journey' | 'daily' | 'practice' | 'challenge'
    meta, // stage index, challenge id, difficulty, day key...
    ranked: mode === 'daily' || mode === 'journey' || mode === 'challenge',
    state,
    undoStack: [], // serialized states (practice relaxed only)
    allowUndo: opts.allowUndo !== false && !((mode === 'daily') || (mode === 'challenge')),
    log: [], // ordered commands for the replay envelope
    startedAt: Date.now(),
    lastEvents: null,
  };
}

// Execute a validated command. Idempotent by command id.
export function execute(session, cmd) {
  if (!cmd.id) cmd.id = `c${++cmdCounter}`;
  if (session.log.some(c => c.id === cmd.id)) return { ok: false, reason: 'duplicate-command' };

  if (cmd.type === 'place') {
    if (session.allowUndo) session.undoStack.push(rules.serialize(session.state));
    const res = rules.applyPlace(session.state, cmd.pieceIndex, cmd.row, cmd.col);
    if (!res.ok) {
      if (session.allowUndo) session.undoStack.pop();
      return res;
    }
    cmd.tick = session.state.tick;
    session.log.push(cmd);
    session.lastEvents = res.events;
    return res;
  }
  if (cmd.type === 'undo') {
    if (!session.allowUndo) return { ok: false, reason: 'undo-not-allowed' };
    const prev = session.undoStack.pop();
    if (!prev) return { ok: false, reason: 'nothing-to-undo' };
    session.state = rules.deserialize(prev);
    session.log.push(cmd);
    session.lastEvents = { undone: true, status: session.state.status };
    return { ok: true, events: session.lastEvents };
  }
  return { ok: false, reason: 'unknown-command' };
}

export function snapshot(session) {
  return {
    id: session.id,
    mode: session.mode,
    meta: session.meta,
    state: rules.serialize(session.state),
    log: session.log.slice(),
    hash: rules.hashState(session.state),
  };
}

export function restore(snap) {
  const session = createSession({ seed: snap.state.seed, mode: snap.mode, opts: {
    moveLimit: snap.state.moveLimit, goalScore: snap.state.goalScore,
  }, meta: snap.meta });
  session.id = snap.id;
  session.state = rules.deserialize(snap.state);
  session.log = snap.log.slice();
  return session;
}

// Replay envelope per spec: schema version, build/content version, seed,
// initial hash, ordered commands, periodic state hashes, terminal result.
export function replayEnvelope(session, contentVersion) {
  return {
    schema: 1,
    rulesVersion: rules.RULES_VERSION,
    contentVersion,
    sessionId: session.id,
    mode: session.mode,
    meta: session.meta,
    seed: session.state.seed,
    opts: { moveLimit: session.state.moveLimit, goalScore: session.state.goalScore },
    startedAt: session.startedAt,
    commands: session.log.filter(c => c.type === 'place'),
    initialHash: null, // filled below
    finalHash: rules.hashState(session.state),
    result: {
      score: session.state.score,
      breakdown: { ...session.state.breakdown },
      placedCount: session.state.placedCount,
      invalidCount: session.state.invalidCount,
      bestCombo: session.state.bestCombo,
      elapsedMs: session.state.elapsedMs,
      status: session.state.status,
      terminalReason: session.state.terminalReason,
    },
  };
}

// Verify an envelope by replaying it deterministically.
export function verifyReplay(envelope) {
  if (!envelope || envelope.schema !== 1) return { ok: false, reason: 'bad-schema' };
  const { state } = rules.replay(envelope.seed, envelope.opts || {}, envelope.commands || []);
  const finalHash = rules.hashState(state);
  const ok = finalHash === envelope.finalHash &&
    state.score === envelope.result.score &&
    state.status === envelope.result.status;
  return { ok, finalHash, expectedHash: envelope.finalHash, score: state.score };
}
