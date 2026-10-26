// Sound: the authored sfx/*.opus one-shots (sfx/manifest.json) through the
// engine's mixer, with the browser build's synthesized transients as the
// fallback while a clip loads or if it fails, and the low ambience bed. The
// runtime's Options › Audio owns the volumes and mute (the browser build's
// Music / Effects / Ambience sliders): interface sounds play on the
// "interface" bus, events on "effects", the bed on "music".
import { context, loadClip, play as playClip, type AudioClip, type Bus, type OscillatorNode, type GainNode } from "starhermit:audio";

const NAMES = [
  "piece-select", "place-thunk", "place-heavy", "invalid-buzz", "line-clear", "clear-double", "clear-triple",
  "combo-rise", "combo-high", "undo-swipe", "pause-tick", "game-over", "win-fanfare",
] as const;
type Name = (typeof NAMES)[number];
const clips = new Map<Name, AudioClip>();

/** Loads every clip; one that fails to decode leaves its synth fallback. */
export function loadSfx(): void {
  for (const name of NAMES) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
}

function sample(name: Name, bus: Bus = "effects"): boolean {
  const clip = clips.get(name);
  if (!clip) return false;
  try { playClip(clip, { bus }); return true; } catch { clips.delete(name); return false; }
}

function blip(freq: number, dur: number, gainVal: number, type: "sine" | "square" | "sawtooth" | "triangle" = "sine", bus: Bus = "effects"): void {
  try {
    const o = context.createOscillator();
    const g = context.createGain();
    const now = context.currentTime;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(context.bus(bus));
    o.start();
    o.stop(now + dur);
    o.onended = () => { g.release(); };
  } catch { /* the graph is full: stay silent */ }
}
const later = (ms: number, fn: () => void): void => { setTimeout(fn, ms); };

let placeFlip = false;
// Event map: input ack < legal move < combo/goal < round completion.
export const sfx = {
  select(): void { if (!sample("piece-select", "interface")) blip(520, 0.05, 0.15, "sine", "interface"); },
  place(): void {
    if (sample((placeFlip = !placeFlip) ? "place-thunk" : "place-heavy")) return;
    blip(110, 0.09, 0.5, "triangle");
    blip(220, 0.05, 0.2, "square");
  },
  invalid(): void { if (!sample("invalid-buzz", "interface")) blip(150, 0.15, 0.3, "sawtooth", "interface"); },
  clear(lines = 1): void {
    if (sample(lines > 2 ? "clear-triple" : lines > 1 ? "clear-double" : "line-clear")) return;
    blip(660, 0.15, 0.35);
    if (lines > 1) later(70, () => blip(880, 0.15, 0.3));
    if (lines > 2) later(140, () => blip(1100, 0.18, 0.3));
  },
  combo(streak = 2): void { if (!sample(streak >= 4 ? "combo-high" : "combo-rise")) blip(440 + streak * 90, 0.2, 0.35, "triangle"); },
  undo(): void { if (!sample("undo-swipe", "interface")) blip(330, 0.1, 0.25, "sine", "interface"); },
  pause(): void { if (!sample("pause-tick", "interface")) blip(260, 0.08, 0.2, "sine", "interface"); },
  gameOver(): void {
    if (sample("game-over")) return;
    blip(392, 0.3, 0.3); later(200, () => blip(262, 0.4, 0.3));
  },
  win(): void {
    if (sample("win-fanfare")) return;
    [523, 659, 784, 1047].forEach((f, i) => later(i * 110, () => blip(f, 0.2, 0.3)));
  },
};

// The ambience bed: a 55 Hz sine at the browser build's level (0.06 on its
// Ambience bus at 0.4), on the music bus.
let bed: { o: OscillatorNode; g: GainNode } | null = null;
export function startAmbience(): void {
  if (bed) return;
  try {
    const o = context.createOscillator();
    const g = context.createGain();
    o.type = "sine";
    o.frequency.value = 55;
    g.gain.value = 0.024;
    o.connect(g).connect(context.bus("music"));
    o.start();
    bed = { o, g };
  } catch { /* no ambience */ }
}
export function stopAmbience(): void {
  if (!bed) return;
  try { bed.o.stop(); bed.g.release(); } catch { /* already gone */ }
  bed = null;
}
