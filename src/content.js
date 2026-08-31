// Timber Grid — versioned content: themes, journey stages, tutorials, daily seed.
import { mulberry } from './rules.js';

export const CONTENT_VERSION = 1;

// Five original visual themes.
export const THEMES = [
  {
    id: 'workshop', name: 'Workshop',
    bench: '#5b4531', board: '#c9a26b', boardAlt: '#bb9460', grid: '#8a6a44',
    piece: '#7a4a22', pieceAlt: '#96622f', ghost: '#fff3d6', clearFlash: '#ffd27a',
    bg: '#2b2119', accent: '#e0a458',
  },
  {
    id: 'ember', name: 'Ember',
    bench: '#4a2c22', board: '#caa070', boardAlt: '#bd9163', grid: '#8a5a3a',
    piece: '#a04a28', pieceAlt: '#c05e33', ghost: '#ffe0c2', clearFlash: '#ff9a5a',
    bg: '#241512', accent: '#e07b39',
  },
  {
    id: 'forest', name: 'Forest',
    bench: '#2e3d2a', board: '#b3a06a', boardAlt: '#a6945e', grid: '#6f7040',
    piece: '#3e6b3a', pieceAlt: '#528a4b', ghost: '#e8f2d8', clearFlash: '#a8d46a',
    bg: '#17211a', accent: '#4f8a5c',
  },
  {
    id: 'ocean', name: 'Ocean',
    bench: '#26384a', board: '#b7a884', boardAlt: '#aa9b78', grid: '#5f7080',
    piece: '#2e5f8a', pieceAlt: '#3d76a8', ghost: '#dceeff', clearFlash: '#7ab8e0',
    bg: '#121c26', accent: '#3d6fa5',
  },
  {
    id: 'plum', name: 'Plum',
    bench: '#3a2c44', board: '#c2a878', boardAlt: '#b59b6c', grid: '#6a5478',
    piece: '#6b3f8a', pieceAlt: '#8452a8', ghost: '#f0e2ff', clearFlash: '#c08ae0',
    bg: '#1d1524', accent: '#7b4fa0',
  },
];

// Tutorial (Learn mode) lessons: one rule at a time; the player must act.
export const TUTORIAL_STEPS = [
  {
    id: 'place-piece',
    title: 'Placing a piece',
    text: 'Drag a piece from the tray onto the board, or select it and choose a highlighted cell. Place any piece to continue.',
    require: 'place', // any legal placement
  },
  {
    id: 'clear-row',
    title: 'Clearing a row',
    text: 'Fill every cell of a row to clear it. Complete a row, column, or 3×3 region to continue.',
    require: 'clear',
    seed: 424242, // fixed practice seed so the lesson is reproducible
  },
  {
    id: 'combo',
    title: 'Combos',
    text: 'Clear lines on consecutive placements to build a combo bonus. Make any placement to finish learning.',
    require: 'place',
  },
];

// Journey: 40 authored stages with gradually raised goals and difficulty tiers.
// Each: index, seed, goalScore, moveLimit, par (placements), difficulty, theme.
export const STAGES = [];
for (let i = 1; i <= 40; i++) {
  const difficulty = i <= 10 ? 'easy' : i <= 25 ? 'medium' : 'hard';
  const tier = difficulty === 'easy' ? 0 : difficulty === 'medium' ? 1 : 2;
  const moveLimit = 8 + ((i * 3) % 7) + tier * 2;
  const goalScore = 40 + i * 12 + tier * 60;
  STAGES.push({
    index: i,
    seed: i * 7919 + 31,
    goalScore,
    moveLimit,
    par: Math.max(4, Math.floor(moveLimit * 0.7)),
    difficulty,
    theme: THEMES[(i - 1) % THEMES.length].id,
    mastery: i % 10 === 0, // periodic mastery stage
  });
}

// Challenge mode presets: constrained goals.
export const CHALLENGES = [
  { id: 'tight-bench', name: 'Tight Bench', seed: 90001, goalScore: 150, moveLimit: 10, description: 'Reach 150 points in only 10 placements.' },
  { id: 'long-game', name: 'Long Game', seed: 90002, goalScore: 800, moveLimit: null, description: 'Survive to 800 points with no move limit.' },
  { id: 'combo-forge', name: 'Combo Forge', seed: 90003, goalScore: 300, moveLimit: 14, description: 'Reach 300 points in 14 placements — combos are the key.' },
];

export const PRACTICE_DIFFICULTIES = [
  { id: 'relaxed', name: 'Relaxed', description: 'Free play, undo allowed. Unranked.' },
  { id: 'standard', name: 'Standard', description: 'Free play, no undo. Unranked.' },
  { id: 'hard', name: 'Hard', description: 'Bigger pieces appear more often. Unranked.' },
];

// Daily challenge: one shared seed per UTC day. Immutable after publication.
export function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const key = y * 10000 + m * 100 + d; // e.g. 20260829
  const rnd = mulberry(key ^ 0x5f3759df);
  return { dayKey: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, seed: Math.floor(rnd() * 0x7fffffff) };
}

// Offline content validators: prove basic legality of generated content.
export function validateContent() {
  const errors = [];
  for (const s of STAGES) {
    if (!Number.isInteger(s.seed) || s.seed <= 0) errors.push(`stage ${s.index}: bad seed`);
    if (!(s.goalScore > 0)) errors.push(`stage ${s.index}: bad goal`);
    if (s.moveLimit !== null && s.moveLimit < 1) errors.push(`stage ${s.index}: bad move limit`);
    if (!THEMES.some(t => t.id === s.theme)) errors.push(`stage ${s.index}: unknown theme`);
  }
  for (const t of THEMES) {
    for (const k of ['bench', 'board', 'piece', 'bg', 'accent']) {
      if (!/^#[0-9a-f]{6}$/i.test(t[k])) errors.push(`theme ${t.id}: bad color ${k}`);
    }
  }
  if (STAGES.length < 40) errors.push('fewer than 40 stages');
  if (THEMES.length < 5) errors.push('fewer than 5 themes');
  return errors;
}
