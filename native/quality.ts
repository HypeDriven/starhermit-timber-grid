// The look per graphics level: the engine's level settings (levelSettings():
// shadows and their map size, AO, bloom resolution, grade, anti-aliasing) plus
// the browser build's art (src/gfx.js) keyed by the runtime's quality tier
// (frame().quality), with the chip and mote budgets scaled within the tier by
// the level's particle budget (at most 2×). The runtime owns the rest of what
// the old Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution and the frame-rate limit.
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Look {
  preset: Preset;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  /** "low" chips are 40 % of the budget's. */
  particles: "off" | "low" | "high";
  ambient: boolean;
  reflections: boolean;
  detailed: boolean;
  budget: Budget;
}
export interface Budget {
  /** Wood shading: Lambert (Low), standard (Balanced), physical lacquered pieces (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Procedural wood-grain texture size in pixels (Detail on). */
  texture: number;
  /** Wood-grain relief (the browser's bump map, here a normal map). */
  bump: boolean;
  cellSeg: number;
  pieceSeg: number;
  chips: number;
  motes: number;
}

type Art = Pick<Look, "particles" | "ambient" | "reflections" | "detailed">;
const ART: Record<Preset, Art> = {
  low: { particles: "off", ambient: false, reflections: false, detailed: false },
  balanced: { particles: "low", ambient: true, reflections: true, detailed: true },
  high: { particles: "high", ambient: true, reflections: true, detailed: true },
  ultra: { particles: "high", ambient: true, reflections: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 128, bump: false, cellSeg: 1, pieceSeg: 1, chips: 16, motes: 30 },
  balanced: { material: "standard", texture: 256, bump: false, cellSeg: 2, pieceSeg: 2, chips: 32, motes: 50 },
  high: { material: "physical", texture: 512, bump: true, cellSeg: 2, pieceSeg: 3, chips: 64, motes: 90 },
  ultra: { material: "physical", texture: 1024, bump: true, cellSeg: 3, pieceSeg: 4, chips: 96, motes: 150 },
};
export const CHIP_MAX = 192;
export const MOTE_MAX = 300;
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.chips = Math.min(CHIP_MAX, Math.round(b.chips * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return {
    preset, ...ART[preset], budget: b,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
  };
}

/** Wood chips per clear. */
export function chipCap(look: Look): number {
  return Math.round(look.budget.chips * (look.particles === "high" ? 1 : look.particles === "low" ? 0.4 : 0));
}
