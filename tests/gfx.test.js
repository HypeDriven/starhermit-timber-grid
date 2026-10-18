// Graphics quality model (src/gfx.js): hardware-level detection, per-preset budgets, preset resolution, overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// src/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../src/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { detectPreset, detectLevel, presetForLevel, budgetFor, chipCap, resolve, withPreset, presetTier, describe, fromLegacyQuality, PRESETS, CATEGORIES, LEVELS, BUDGETS, CHIP_MAX, MOTE_MAX } = await import('../src/gfx.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('Microsoft Basic Render Driver', DESK), 'low');
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M2', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budget table: costs never fall from Low to Ultra; counts scale with the level', () => {
  const order = ['lambert', 'standard', 'physical'];
  for (let i = 1; i < PRESETS.length; i++) {
    const a = BUDGETS[PRESETS[i - 1]], b = BUDGETS[PRESETS[i]];
    assert.ok(order.indexOf(b.material) >= order.indexOf(a.material), PRESETS[i]);
    for (const k of ['texture', 'cellSeg', 'pieceSeg', 'chips', 'motes', 'bloomRes', 'aoRes']) assert.ok(b[k] >= a[k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].texture), [128, 256, 512, 1024]);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1]);
  assert.equal(BUDGETS.low.bump, false);
  assert.equal(BUDGETS.ultra.bump, true);
  // tuned at the preset's floor level, up to 2× on faster GPUs, never past the pool sizes
  assert.equal(budgetFor('high', 10).chips, BUDGETS.high.chips);
  assert.equal(budgetFor('high', 0).chips, BUDGETS.high.chips, 'a forced preset never drops below its own budget');
  assert.ok(budgetFor('high', 13).chips > BUDGETS.high.chips);
  assert.equal(budgetFor('ultra', 20).chips, Math.min(CHIP_MAX, Math.round(BUDGETS.ultra.chips * 1.23 ** 3)));
  assert.equal(budgetFor('low', 9).motes, BUDGETS.low.motes * 2, 'at most 2× within a preset');
  assert.ok(budgetFor('ultra', 20).motes <= MOTE_MAX);
  const r = resolve({ preset: 'balanced' }, 'low', 4);
  assert.equal(r.level, 4);
  assert.deepEqual(r.budget, budgetFor('balanced', 4));
  assert.equal(chipCap(r), Math.round(BUDGETS.balanced.chips * 0.4), 'Balanced particles "low" = 40 % of the chip budget');
  assert.equal(chipCap(resolve({ preset: 'balanced', particles: 'off' }, 'low', 4)), 0);
  assert.equal(resolve({}, 'low').budget.material, 'lambert');
});

test('resolve: auto follows detected preset', () => {
  const r = resolve({}, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, false, 'low renders without a composer');
  const b = resolve({ preset: 'auto' }, 'high');
  assert.equal(b.preset, 'high');
  assert.equal(b.post, true);
});

test('resolve: explicit preset and overrides', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'high', detail: 'bogus' }, 'low');
  assert.equal(r.preset, 'high');
  assert.equal(r.auto, false);
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, 'high');
  assert.equal(r.detail, presetTier('high', 'detail'), 'unknown override falls back to preset');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) assert.ok(tiers.includes(r[cat]), cat);
});

test('resolve: render scale is clamped to 50–200%', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).userScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).userScale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).userScale, 1);
  assert.equal(resolve({ preset: 'ultra', render_scale: 2 }).scale, 2.5);
});

test('resolve: adaptive defaults on, fps readout off', () => {
  const r = resolve({ preset: 'low' });
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  assert.equal(resolve({ preset: 'low', adaptive: false, show_fps: true }).showFps, true);
});

test('withPreset: choosing a preset clears overrides but keeps scale/adaptive/fps', () => {
  const g = withPreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'low');
  assert.deepEqual(g, { preset: 'low', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(withPreset({}, 'nonsense').preset, 'auto');
});

test('presetTier and describe', () => {
  assert.ok(PRESETS.every(p => presetTier(p, 'shadows')));
  assert.equal(presetTier('nope', 'shadows'), undefined);
  const txt = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(txt, /2048² shadows/);
  assert.match(txt, /SMAA/);
  assert.match(txt, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows · no anti-aliasing/);
  assert.match(describe(resolve({ preset: 'low' }), null, k => (k === 'noShadows' ? 'sin sombras' : null)), /^sin sombras/);
});

test('fromLegacyQuality maps the old single setting', () => {
  assert.equal(fromLegacyQuality('medium').preset, 'balanced');
  assert.equal(fromLegacyQuality('high').preset, 'high');
  assert.equal(fromLegacyQuality('low').preset, 'low');
  assert.equal(fromLegacyQuality('auto').preset, 'auto');
});
