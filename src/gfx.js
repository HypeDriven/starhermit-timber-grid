// Timber Grid — graphics quality model: presets, per-category overrides, GPU
// detection and a cost summary. Pure (no three.js) so the settings panel, the
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
export const PARTICLE_COUNT = { off: 0, low: 24, high: 64 };

/**
 * Best preset for this GPU, from the unmasked renderer string when exposed.
 * Software renderers get Low; discrete GPUs / Apple M get High; else Balanced.
 * Touch/mobile devices are capped at Balanced.
 */
export function detectPreset(gpu, mobile = false) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  if (mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
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
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, cap: row.cap, userScale, scale: row.scale * userScale };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
    r.particles === 'off' ? null : w('particlesN', { n: PARTICLE_COUNT[r.particles] }),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
