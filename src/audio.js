// Timber Grid — procedural WebAudio: buses, event mapping, volume sliders.
// All sounds are original short synthesized transients; nothing is audio-only.
let ctx = null;
let buses = null;
const volumes = { music: 0.5, effects: 0.8, ambience: 0.4, voice: 0.0 };
let muted = false;
let ambienceNode = null;

// Authored sample one-shots (sfx/<name>.opus, see sfx/manifest.json).
// Fetched lazily after the user-gesture unlock; synthesis below stays the fallback.
let unlocked = false;
const sampleCache = new Map(); // name -> { promise } | { buffer } | { failed: true }
let placeFlip = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  buses = { master };
  for (const name of ['music', 'effects', 'ambience', 'voice']) {
    const g = ctx.createGain();
    g.gain.value = volumes[name];
    g.connect(master);
    buses[name] = g;
  }
  return ctx;
}

export function resume() {
  const c = ensureCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === 'suspended') c.resume().catch(() => {});
}

function fetchSample(name) {
  const entry = sampleCache.get(name);
  if (entry) return;
  const promise = fetch(`sfx/${name}.opus`)
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .then(buf => ctx.decodeAudioData(buf))
    .then(buffer => { sampleCache.set(name, { buffer }); })
    .catch(() => { sampleCache.set(name, { failed: true }); });
  sampleCache.set(name, { promise });
}

// Play an authored sample through the effects bus if decoded; otherwise false.
function playSample(name) {
  if (!unlocked || !ctx || !buses) return false;
  const entry = sampleCache.get(name);
  if (!entry) { fetchSample(name); return false; } // synth covers it while loading
  if (!entry.buffer) return false; // still loading or failed -> synth fallback
  try {
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.connect(buses.effects);
    src.start();
    return true;
  } catch (_) { return false; }
}

export function setVolume(bus, v) {
  volumes[bus] = Math.max(0, Math.min(1, v));
  if (buses && buses[bus]) buses[bus].gain.value = muted ? 0 : volumes[bus];
}

export function getVolume(bus) { return volumes[bus]; }

export function setMuted(m) {
  muted = !!m;
  if (buses) for (const name of ['music', 'effects', 'ambience', 'voice']) {
    buses[name].gain.value = muted ? 0 : volumes[name];
  }
}
export function isMuted() { return muted; }

function blip(freq, dur, gainVal, type = 'sine', bus = 'effects') {
  const c = ensureCtx();
  if (!c || !buses) return;
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(buses[bus]);
    o.start();
    o.stop(c.currentTime + dur);
  } catch (_) { /* audio unavailable */ }
}

function thud() {
  // Layered material impact: low knock + short noise-like decay.
  blip(110, 0.09, 0.5, 'triangle');
  blip(220, 0.05, 0.2, 'square');
}

// Event map: input ack < legal move < combo/goal < round completion.
// Each event prefers its authored sample (sfx/manifest.json); the synthesized
// transients run only while the sample is still loading or failed to load.
export const play = {
  select() { if (playSample('piece-select')) return; blip(520, 0.05, 0.15); },
  place() {
    const name = (placeFlip = !placeFlip) ? 'place-thunk' : 'place-heavy';
    if (playSample(name)) return;
    thud();
  },
  invalid() { if (playSample('invalid-buzz')) return; blip(150, 0.15, 0.3, 'sawtooth'); },
  clear(lines = 1) {
    const name = lines > 2 ? 'clear-triple' : lines > 1 ? 'clear-double' : 'line-clear';
    if (playSample(name)) return;
    blip(660, 0.15, 0.35);
    if (lines > 1) setTimeout(() => blip(880, 0.15, 0.3), 70);
    if (lines > 2) setTimeout(() => blip(1100, 0.18, 0.3), 140);
  },
  combo(streak = 2) {
    if (playSample(streak >= 4 ? 'combo-high' : 'combo-rise')) return;
    blip(440 + streak * 90, 0.2, 0.35, 'triangle');
  },
  undo() { if (playSample('undo-swipe')) return; blip(330, 0.1, 0.25); },
  pause() { if (playSample('pause-tick')) return; blip(260, 0.08, 0.2); },
  gameOver() {
    if (playSample('game-over')) return;
    blip(392, 0.3, 0.3); setTimeout(() => blip(262, 0.4, 0.3), 200);
  },
  win() {
    if (playSample('win-fanfare')) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, 0.3), i * 110));
  },
};

export function startAmbience() {
  const c = ensureCtx();
  if (!c || !buses || ambienceNode) return;
  try {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 55;
    const g = c.createGain();
    g.gain.value = 0.06;
    o.connect(g).connect(buses.ambience);
    o.start();
    ambienceNode = { o, g };
  } catch (_) { /* no ambience */ }
}

export function stopAmbience() {
  if (ambienceNode) {
    try { ambienceNode.o.stop(); } catch (_) {}
    ambienceNode = null;
  }
}
