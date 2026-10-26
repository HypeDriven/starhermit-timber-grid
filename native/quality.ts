// The look per graphics level: the browser build's four presets (src/gfx.js,
// each tuned to hold 60 FPS on the weakest GPU it was given) keyed by the
// runtime's quality tier (frame().quality), with the chip and mote budgets
// scaled within the tier by the level (frame().levelIndex), as the browser
// build scaled them by its hardware level. The runtime owns the rest of what
// the old Graphics panel did: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit, and the shadow
// map size and MSAA samples it holds to the level.
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Look {
  preset: Preset;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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
  bloomRes: number;
  aoRes: number;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", particles: "off", ambient: false, reflections: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", particles: "low", ambient: true, reflections: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", particles: "high", ambient: true, reflections: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", particles: "high", ambient: true, reflections: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", texture: 128, bump: false, cellSeg: 1, pieceSeg: 1, chips: 16, motes: 30, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", texture: 256, bump: false, cellSeg: 2, pieceSeg: 2, chips: 32, motes: 50, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", texture: 512, bump: true, cellSeg: 2, pieceSeg: 3, chips: 64, motes: 90, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", texture: 1024, bump: true, cellSeg: 3, pieceSeg: 4, chips: 96, motes: 150, bloomRes: 1, aoRes: 1 },
};
export const CHIP_MAX = 192;
export const MOTE_MAX = 300;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: chips and motes grow with
  // the level above the tier's first, at most twice the tier's budget.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.chips = Math.min(CHIP_MAX, Math.round(b.chips * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return { preset, ...TABLE[preset], budget: b };
}

/** Wood chips per clear. */
export function chipCap(look: Look): number {
  return Math.round(look.budget.chips * (look.particles === "high" ? 1 : look.particles === "low" ? 0.4 : 0));
}
