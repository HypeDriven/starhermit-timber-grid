// Graphics quality model (src/gfx.js): GPU detection, preset resolution, overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, withPreset, presetTier, describe, fromLegacyQuality, PRESETS, CATEGORIES } from '../src/gfx.js';

test('detectPreset: software renderers get low', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('Microsoft Basic Render Driver'), 'low');
});

test('detectPreset: discrete GPUs and Apple M get high, others balanced', () => {
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('AMD Radeon RX 6800 XT'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset('AMD Radeon Graphics'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset: mobile caps auto at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
