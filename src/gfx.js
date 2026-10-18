// Timber Grid — graphics quality model: presets, per-category overrides, StarHermit
// hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js) so the settings panel, the
// renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  particles: ['off', 'low', 'high'],
  ambient: ['static', 'animated'],
  reflections: ['off', 'on'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a device-pixel-ratio cap and a render scale.
// Low matches the game's original low tier (no shadows, no AA, DPR 1, no
// post-processing) so it is never more expensive than before.
const TABLE = {
  low: { cap: 1, scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'off', particles: 'off', ambient: 'static', reflections: 'off', detail: 'plain' },
  balanced: { cap: 1.5, scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', particles: 'low', ambient: 'animated', reflections: 'on', detail: 'detailed' },
  high: { cap: 2, scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', particles: 'high', ambient: 'animated', reflections: 'on', detail: 'detailed' },
  ultra: { cap: 2, scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', particles: 'high', ambient: 'animated', reflections: 'on', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 =
// RTX 5090; src/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from
// 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Board, pieces, hit
 * areas and rules are identical on every preset — only visuals change.
 *   material  wood shading: lambert (Low) / standard (Balanced) / physical lacquered pieces (High, Ultra)
 *   texture   procedural wood-grain texture size in px (Detail on)
 *   bump      wood-grain bump mapping (Detail on)
 *   cellSeg / pieceSeg  rounded-corner segments of the board cells and placed blocks (Detail on)
 *   chips     wood chips per clear at Particles "high" (low: 40 %), scaled with the level
 *   motes     sawdust motes in the lamp light (Ambient animated), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', texture: 128, bump: false, cellSeg: 1, pieceSeg: 1, chips: 16, motes: 30, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', texture: 256, bump: false, cellSeg: 2, pieceSeg: 2, chips: 32, motes: 50, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', texture: 512, bump: true, cellSeg: 2, pieceSeg: 3, chips: 64, motes: 90, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', texture: 1024, bump: true, cellSeg: 3, pieceSeg: 4, chips: 96, motes: 150, bloomRes: 1, aoRes: 1 },
};
export const CHIP_MAX = 192;
export const MOTE_MAX = 300;
const PARTICLE_SHARE = { off: 0, low: 0.4, high: 1 };

/** A preset's concrete budget for a hardware level (chip and mote counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.chips = Math.min(CHIP_MAX, Math.round(b.chips * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return b;
}

/** Wood chips per clear for a resolved setting (Particles tier share of the preset's chip budget). */
export function chipCap(r) {
  return Math.round(r.budget.chips * (PARTICLE_SHARE[r.particles] ?? 0));
}

/** Map the legacy single `quality` setting (auto|high|medium|low) to saved graphics. */
export function fromLegacyQuality(q) {
  const map = { high: 'high', medium: 'balanced', low: 'low' };
  return { preset: map[q] || 'auto' };
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * A category key missing or holding an unknown value follows the preset.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, cap: row.cap, userScale, scale: row.scale * userScale };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer runs only when an effect needs it; otherwise the canvas renders directly.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears per-category overrides; scale/adaptive/fps are kept. */
export function withPreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  if (s.render_scale != null) out.render_scale = s.render_scale;
  if (s.adaptive != null) out.adaptive = s.adaptive;
  if (s.show_fps != null) out.show_fps = s.show_fps;
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

// English defaults for the cost summary; the UI passes a localized lookup.
const WORDS = {
  noShadows: 'no shadows', shadowsN: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', noAA: 'no anti-aliasing', particlesN: '{n} particles',
};

/** One-line cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px". */
export function describe(r, pixels, word) {
  const w = (k, vars) => {
    let s = (word && word(k)) || WORDS[k];
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b));
    return s;
  };
  const parts = [
    r.shadows === 'off' ? w('noShadows') : w('shadowsN', { n: SHADOW_MAP[r.shadows] }),
    r.ao === 'off' ? null : r.ao === 'high' ? w('aoHigh') : w('ao'),
    r.bloom === 'on' ? w('bloom') : null,
    r.antialias === 'off' ? w('noAA') : r.antialias.toUpperCase(),
    r.particles === 'off' ? null : w('particlesN', { n: chipCap(r) }),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
