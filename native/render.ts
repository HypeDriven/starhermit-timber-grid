// The 3D bench on starhermit:scene, ported from the browser build's three.js
// render layer (src/render.js before the port): a wooden puzzle board on a
// workshop bench, lit by a warm key light with a cool fill and a hemisphere
// bounce, the look per graphics level from quality.ts. It consumes rules
// snapshots and never mutates rules state.
//
// What changed from three.js, and why:
// - RoundedBoxGeometry (an addon) is rounded.ts.
// - The EffectComposer chain (GTAO, UnrealBloom, the grade ShaderPass, SMAA /
//   FXAA / MSAA) is renderer.ao / bloom / grade / antialias; the grade's GLSL
//   is the built-in display-space grade with the same curve, tints and vignette.
// - onBeforeCompile's per-instance grain offset is a WGSL vertex hook; the
//   bump map is a normal map made from the same grain.
// - Lights, shadows and the environment are the page's own values (minor 28).
// - The canvas-texture grain is a DataTexture with the page's linear values
//   (NoColorSpace, used as stored like three's CanvasTexture).
// - Camera view offsets are not used (the aspect is set to the window's): the camera
//   is moved and pulled back until the board fits the free part of the window.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color,
  DataTexture, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PMREMGenerator, PerspectiveCamera, RoomEnvironment, PlaneGeometry, Points, PointsMaterial,
  Raycaster, RepeatWrapping, Vector2, Vector3, pointerToNdc, renderer, scene,
} from "starhermit:scene";
import type { Material, MaterialHooks, Texture } from "starhermit:scene";
import { N } from "../src/rules.js";
import { MOTE_MAX, chipCap, type Look } from "./quality.ts";
import { roundedBox } from "./rounded.ts";

export interface Theme {
  id: string; bench: string; board: string; boardAlt: string; grid: string; piece: string; pieceAlt: string;
  ghost: string; clearFlash: string; bg: string; accent: string;
}
export interface Snapshot { board: number[] }
export interface PlaceEvents { cells?: [number, number][]; clearedCells?: number[]; lineCount?: number; undone?: boolean }
/** The part of the window the board may use, in normalized device coordinates (y up). */
export interface Frame { x0: number; y0: number; x1: number; y1: number }

export const FRAMING = {
  cellSize: 1, cellGap: 0.06, cellHeight: 0.28, pieceHeight: 0.42,
  cameraFov: 32, cameraPitchDeg: 52, cameraDistance: 13.5, cameraTargetY: 0,
};
const LOOK = {
  cellRadius: 0.05, pieceRadius: 0.07, rimWidth: 0.34, rimHeight: 0.34, floorY: -0.72,
  envIntensity: 0.3,
  flashBoost: 1.6, // HDR multiplier so clear effects (and only they) cross the bloom threshold
};
const COLOR_PALETTES: Record<string, { clearFlash?: string; piece?: string } | null> = {
  standard: null,
  deuteranopia: { clearFlash: "#ffe08a", piece: "#3a6ea8" },
  protanopia: { clearFlash: "#ffe08a", piece: "#3a6ea8" },
  tritanopia: { clearFlash: "#ffd0a0", piece: "#a8563a" },
};
const PI = Math.PI;

const camera = new PerspectiveCamera(FRAMING.cameraFov, 16 / 9, 0.1, 100);
let theme: Theme | null = null;
let palette = "standard";
let reducedMotion = false;
let look: Look | null = null;
let camShake = 0;
let clock = 0;
let camDist = FRAMING.cameraDistance;
let fit: Frame = { x0: -1, y0: -1, x1: 1, y1: 1 };
let fitKey = "";
let camBase = { pos: new Vector3(), target: new Vector3() };

const _m = new Matrix4();
const _rot = new Matrix4();
const _col = new Color();
const _v = new Vector3();
const _ray = new Raycaster();
const hex = (c: string): Color => new Color(c);

function cellCenter(row: number, col: number): { x: number; z: number } {
  const s = FRAMING.cellSize;
  return { x: (col - (N - 1) / 2) * s, z: (row - (N - 1) / 2) * s };
}
function jitter(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}
function motionOff(): boolean { return reducedMotion; }

// --- lights and the bench ------------------------------------------------------
const keyLight = new DirectionalLight(0xfff2e0, 2.4);
keyLight.position.set(-6, 10, 4);
Object.assign(keyLight.shadow.camera, { left: -7.6, right: 7.6, top: 7.6, bottom: -7.6, near: 2, far: 26 });
keyLight.shadow.camera.updateProjectionMatrix();
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
const fill = new DirectionalLight(0xcfd8ff, 0.55);
fill.position.set(5, 6, -6);
const hemi = new HemisphereLight(0xfff4e6, 0x3a2a1c, 0.55);

const cs = FRAMING.cellSize - FRAMING.cellGap;
const plainBox = new BoxGeometry(cs, FRAMING.cellHeight, cs);
const slabGeos = { plain: new BoxGeometry(N + 5, 0.6, N + 5), detailed: roundedBox(N + 5, 0.6, N + 5, 2, 0.12) };
const benchGroup = new Group();
let slab: Mesh;
let cellMesh: InstancedMesh;
let fillMesh: InstancedMesh;
let ghostMesh: InstancedMesh;
let ghostMat: MeshBasicMaterial;
let bars: InstancedMesh;
let rims: InstancedMesh;
let floor: Mesh;
const detailGroup = new Group();
let plates: InstancedMesh; // clear-flash plates, additive: an instance's color fades it
let motes: Points;
let moteBase: Float32Array;
let moteSeed: Float32Array;
let motePos: Float32Array;

interface Pair { plain: Material; detailed: Material }
const mats: { slab?: Pair; cell?: Pair; piece?: Pair } = {};
const geos: { cell?: BufferGeometry; piece?: BufferGeometry } = {};
let barMat: Material | null = null;
let rimMat: Material | null = null;
let floorMat: Material | null = null;
let woodTex: DataTexture | null = null;
let floorTex: DataTexture | null = null;
let grainNormal: DataTexture | null = null;
let assetKey = "";
let envTex: Texture | null = null;

// --- procedural wood -------------------------------------------------------------

/** Grey-scale wood grain (linear values ~0.8–1.0): long wavy growth rings plus
 * fine pores, deterministic, authored at 256 px and sampled at `size`. */
function woodGrain(size: number): Float32Array {
  const A = 256, k = A / size;
  let seed = 1234567;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pores = new Float32Array(size * size);
  for (let i = 0; i < pores.length; i++) pores[i] = rnd();
  const waves = [0, 1, 2].map(() => ({ a: 2 + rnd() * 5, f: ((1 + Math.floor(rnd() * 3)) * Math.PI * 2) / A, p: rnd() * 6.28 }));
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let yy = y * k;
      for (const w of waves) yy += w.a * Math.sin(x * k * w.f + w.p);
      const ring = 0.5 + 0.5 * Math.sin(yy * 0.32 + Math.sin(yy * 0.05) * 3);
      const streak = ring * ring * ring;
      const i = y * size + x;
      const pore = (pores[i]! + pores[y * size + ((x + 1) % size)]! + pores[y * size + ((x + 2) % size)]!) / 3;
      out[i] = Math.max(0, Math.min(1, 0.97 - streak * 0.13 - (pore > 0.8 ? 0.05 : 0) + (pore - 0.5) * 0.03));
    }
  }
  return out;
}
function grainTexture(g: Float32Array, size: number): DataTexture {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < g.length; i++) {
    const b = Math.round(g[i]! * 255);
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(px, size, size);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return tex;
}
/** The grain's relief as a tangent-space normal map (the browser's bump map). */
function grainNormals(g: Float32Array, size: number, strength: number): DataTexture {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = (xx: number, yy: number): number => g[((yy + size) % size) * size + ((xx + size) % size)]!;
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      px[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      px[o + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
      px[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      px[o + 3] = 255;
    }
  }
  const tex = new DataTexture(px, size, size);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  return tex;
}

// Offsets the grain per instance so neighbouring blocks never share a pattern
// (the browser build's onBeforeCompile on instanceMatrix[3]).
const GRAIN_HOOK: MaterialHooks = {
  vertex: `
fn vertex(v: Vertex) -> Vertex {
  var o = v;
  let t = model_matrix()[3].xyz;
  let off = fract(vec2f(t.x * 0.618 + t.z * 0.231, t.z * 0.414 + t.x * 0.137));
  o.uv = v.uv * 0.55 + off;
  return o;
}`,
};

interface WoodOpts { roughness: number; metalness?: number; map?: Texture | null; bump?: number; envMapIntensity?: number; clearcoat?: number; clearcoatRoughness?: number; grain?: boolean }
function woodMat(opts: WoodOpts): Material {
  const b = look!.budget;
  const map = opts.map ?? null;
  let m: Material;
  if (b.material === "lambert") m = new MeshLambertMaterial({ map });
  else {
    const normalMap = map && b.bump && opts.bump ? grainNormal : null;
    const base = {
      roughness: opts.roughness, metalness: opts.metalness ?? 0, map, envMapIntensity: opts.envMapIntensity ?? 1,
      ...(normalMap ? { normalMap, normalScale: new Vector2(opts.bump!, opts.bump!) } : {}),
    };
    m = b.material === "physical" && opts.clearcoat
      ? new MeshPhysicalMaterial({ ...base, clearcoat: opts.clearcoat, clearcoatRoughness: opts.clearcoatRoughness ?? 0 })
      : new MeshStandardMaterial(base);
  }
  if (opts.grain && map) m.hooks = GRAIN_HOOK;
  return m;
}

/** Per-preset assets: grain size, relief, rounded segments, shading model.
 * Rebuilt only when the budget's asset key changes; true when it did. */
function buildAssets(): boolean {
  const b = look!.budget;
  const key = [b.material, b.texture, b.bump, b.cellSeg, b.pieceSeg].join("|");
  if (key === assetKey) return false;
  assetKey = key;
  geos.cell?.dispose(); geos.piece?.dispose();
  for (const pair of [mats.slab, mats.cell, mats.piece]) { pair?.plain.dispose(); pair?.detailed.dispose(); }
  barMat?.dispose(); rimMat?.dispose(); floorMat?.dispose();
  woodTex?.dispose(); floorTex?.dispose(); grainNormal?.dispose();
  const g = woodGrain(b.texture);
  woodTex = grainTexture(g, b.texture);
  floorTex = grainTexture(g, b.texture);
  floorTex.repeat.set(5, 14);
  grainNormal = b.bump ? grainNormals(g, b.texture, b.texture / 64) : null;

  geos.cell = roundedBox(cs, FRAMING.cellHeight, cs, b.cellSeg, LOOK.cellRadius);
  geos.piece = roundedBox(cs, FRAMING.cellHeight, cs, b.pieceSeg, LOOK.pieceRadius);
  mats.slab = {
    plain: woodMat({ roughness: 0.8, metalness: 0.05 }),
    detailed: woodMat({ roughness: 0.78, map: woodTex, bump: 0.6, envMapIntensity: 0.5 }),
  };
  mats.cell = {
    plain: woodMat({ roughness: 0.65, metalness: 0.02 }),
    detailed: woodMat({ roughness: 0.62, map: woodTex, bump: 0.5, envMapIntensity: 0.6, grain: true }),
  };
  // Placed pieces are lacquered: clearcoat (High/Ultra) gives a crisp highlight
  // that separates them from the matte board.
  mats.piece = {
    plain: woodMat({ roughness: 0.5, metalness: 0.05 }),
    detailed: woodMat({ roughness: 0.5, map: woodTex, bump: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.28, envMapIntensity: 0.9, grain: true }),
  };
  barMat = woodMat({ roughness: 0.7 });
  rimMat = woodMat({ roughness: 0.6, map: woodTex, bump: 0.6, envMapIntensity: 0.6, grain: true });
  floorMat = woodMat({ roughness: 0.9, map: floorTex, envMapIntensity: 0.2 });
  bars.material = barMat;
  rims.material = rimMat;
  floor.material = floorMat;
  return true;
}

/** The page's neutral studio: three.js RoomEnvironment prefiltered at 0.04
 * (r170: the room's light is 900, so the renderer is passed). */
function buildEnvironment(): void {
  if (envTex) return;
  try {
    envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
  } catch (e) {
    console.warn("environment:", e instanceof Error ? e.message : String(e));
  }
}

function build(): void {
  scene.add(keyLight, keyLight.target, fill, hemi, benchGroup);
  ghostMat = new MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
  cellMesh = new InstancedMesh(plainBox, new MeshBasicMaterial(), N * N);
  cellMesh.receiveShadow = true;
  fillMesh = new InstancedMesh(plainBox, new MeshBasicMaterial(), N * N);
  fillMesh.castShadow = true;
  fillMesh.receiveShadow = true;
  ghostMesh = new InstancedMesh(plainBox, ghostMat, N * N);
  slab = new Mesh(slabGeos.plain, new MeshBasicMaterial());
  slab.position.y = -0.42;
  slab.receiveShadow = true;
  const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2;
  for (let i = 0; i < N * N; i++) {
    const { x, z } = cellCenter(Math.floor(i / N), i % N);
    _m.makeTranslation(x, 0, z);
    cellMesh.setMatrixAt(i, _m);
    _m.makeScale(0, 0, 0); _m.setPosition(x, y, z);
    fillMesh.setMatrixAt(i, _m);
    ghostMesh.setMatrixAt(i, _m);
    cellMesh.setColorAt(i, _col.setRGB(1, 1, 1));
    fillMesh.setColorAt(i, _col.setRGB(1, 1, 1));
  }
  benchGroup.add(slab, cellMesh, fillMesh, ghostMesh);

  // 3×3 region dividers: raised bars in the gaps between regions, one draw.
  bars = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 8);
  const barY = FRAMING.cellHeight / 2 + 0.02;
  for (let i = 0; i <= 3; i++) {
    const p = (i - 1.5) * 3 * FRAMING.cellSize;
    _m.makeScale(N + 0.08, 0.08, 0.08); _m.setPosition(0, barY, p);
    bars.setMatrixAt(i * 2, _m);
    _m.makeScale(0.08, 0.08, N + 0.08); _m.setPosition(p, barY, 0);
    bars.setMatrixAt(i * 2 + 1, _m);
  }
  bars.castShadow = true;
  benchGroup.add(bars);

  // Detailed tier: a raised frame around the board and a workshop floor.
  const rimLen = N + LOOK.rimWidth * 2 + 0.1;
  rims = new InstancedMesh(roundedBox(rimLen, LOOK.rimHeight, LOOK.rimWidth, 2, 0.06), new MeshBasicMaterial(), 4);
  const edge = N / 2 + 0.05 + LOOK.rimWidth / 2;
  const rimY = -0.12 + LOOK.rimHeight / 2;
  ([[0, edge, 0], [0, -edge, 0], [edge, 0, PI / 2], [-edge, 0, PI / 2]] as const).forEach(([x, z, r], i) => {
    _rot.makeRotationY(r); _rot.setPosition(x, rimY, z);
    rims.setMatrixAt(i, _rot);
  });
  rims.castShadow = rims.receiveShadow = true;
  floor = new Mesh(new PlaneGeometry(80, 80), new MeshBasicMaterial());
  floor.rotation.x = -PI / 2;
  floor.position.y = LOOK.floorY;
  floor.receiveShadow = true;
  detailGroup.add(rims, floor);
  benchGroup.add(detailGroup);

  // Glowing plates over cleared cells (additive: the instance color fades them).
  plates = new InstancedMesh(new PlaneGeometry(0.9, 0.9).rotateX(-PI / 2), new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }), N * N);
  plates.count = 0;
  plates.noAO = true;
  scene.add(plates);

  // Ambient sawdust motes drifting in the lamp light (cosmetic), allocated at
  // the largest budget; the look draws budget.motes of them.
  moteBase = new Float32Array(MOTE_MAX * 3);
  moteSeed = new Float32Array(MOTE_MAX);
  let s = 99;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < MOTE_MAX; i++) {
    moteBase[i * 3] = (rnd() - 0.5) * 13;
    moteBase[i * 3 + 1] = 0.6 + rnd() * 3.4;
    moteBase[i * 3 + 2] = (rnd() - 0.5) * 13;
    moteSeed[i] = rnd() * 6.28;
  }
  motePos = moteBase.slice();
  const mg = new BufferGeometry();
  mg.setAttribute("position", new BufferAttribute(motePos, 3));
  motes = new Points(mg, new PointsMaterial({ size: 0.04, color: 0xffe2b0, transparent: true, opacity: 0.4, depthWrite: false, blending: AdditiveBlending }));
  motes.visible = false;
  scene.add(motes);

  renderer.camera = camera;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

// --- theme, palette, look ----------------------------------------------------------
function applyColors(): void {
  if (!theme || !look) return;
  const pal = COLOR_PALETTES[palette] ?? {};
  const detailed = look.detailed;
  const board = hex(theme.board), boardAlt = hex(theme.boardAlt || theme.board);
  const piece = hex(pal.piece || theme.piece), pieceAlt = hex(pal.piece || theme.pieceAlt || theme.piece);
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    if (detailed) {
      // alternate 3×3 regions for readability, with a faint per-board variation
      const alt = (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 1;
      _col.copy(alt ? boardAlt : board).multiplyScalar(1 + jitter(i) * 0.03);
    } else _col.copy(board);
    cellMesh.setColorAt(i, _col);
    if (detailed) _col.copy(piece).lerp(pieceAlt, 0.12 + 0.12 * jitter(i + 101));
    else _col.copy(piece);
    fillMesh.setColorAt(i, _col);
  }
  cellMesh.instanceColor!.needsUpdate = true;
  fillMesh.instanceColor!.needsUpdate = true;
}

export function setTheme(t: Theme): void {
  theme = t;
  if (!look) return;
  scene.background = hex(t.bg);
  scene.fog = new Fog(hex(t.bg), camDist * 1.35, camDist * 2.5);
  for (const m of [mats.slab!.plain, mats.slab!.detailed]) m.color.set(t.bench);
  for (const m of [mats.cell!.plain, mats.cell!.detailed, mats.piece!.plain, mats.piece!.detailed]) m.color.setRGB(1, 1, 1);
  ghostMat.color.set(t.ghost);
  barMat!.color.set(t.grid);
  rimMat!.color.copy(hex(t.bench).lerp(hex(t.grid), 0.35).multiplyScalar(1.15));
  floorMat!.color.copy(hex(t.bg).lerp(hex(t.bench), 0.55));
  hemi.groundColor.copy(hex(t.bench).multiplyScalar(0.6));
  applyColors();
}
export function setPalette(p: string): void { palette = p; if (theme) setTheme(theme); }
export function setReducedMotion(v: boolean): void { reducedMotion = v; applyMotion(); }

/** The look for the frame's graphics level; cheap when nothing changed. */
export function applyLook(next: Look, force = false): void {
  const same = look && JSON.stringify(look) === JSON.stringify(next);
  if (same && !force) return;
  look = next;
  if (!cellMesh) build();
  if (buildAssets() && theme) setTheme(theme);
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  const tier = next.detailed ? "detailed" : "plain";
  cellMesh.geometry = next.detailed ? geos.cell! : plainBox;
  cellMesh.material = mats.cell![tier];
  fillMesh.geometry = next.detailed ? geos.piece! : plainBox;
  fillMesh.material = mats.piece![tier];
  ghostMesh.geometry = next.detailed ? geos.piece! : plainBox;
  slab.geometry = slabGeos[tier];
  slab.material = mats.slab![tier];
  detailGroup.visible = next.detailed;
  slab.castShadow = next.detailed;
  if (next.reflections) {
    buildEnvironment();
    scene.environment = envTex;
    scene.environmentIntensity = LOOK.envIntensity;
    hemi.intensity = 0.4;
  } else {
    scene.environment = null;
    hemi.intensity = 0.55;
  }
  // Post effects, as the browser's composer chain per preset.
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.55, distanceExponent: 1.2, thickness: 1.0, scale: 1.0,
    samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the HDR clear effects and hot highlights bloom.
  renderer.bloom = next.bloom ? { strength: 0.6, radius: 0.45, threshold: 0.95, resolution: next.budget.bloomRes } : null;
  // The browser's grade ShaderPass after OutputPass: a gentle S-curve, a touch
  // more saturation, warm highlights and cool shadows, a soft vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.16, saturation: 1.08,
    shadows: [0.97, 0.98, 1.03], highlights: [1.04, 1.0, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.24, inner: 0.38, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
  applyColors();
  applyMotion();
}

function applyMotion(): void {
  if (!motes || !look) return;
  motes.geometry.setDrawRange(0, Math.min(MOTE_MAX, look.budget.motes));
  motes.visible = look.ambient && !motionOff();
  if (!motes.visible) ghostMesh.position.y = 0;
}

// --- camera ------------------------------------------------------------------------
/** Fits the board (piece height included) into `frame` (NDC, y up): pulls the
 * camera back from 0.75 of the authored distance until every corner is inside,
 * and slides it across its view until the board is centred there. */
export function frameBoard(frame: Frame, aspect: number): void {
  const key = [frame.x0, frame.y0, frame.x1, frame.y1, aspect].map((n) => n.toFixed(4)).join(",");
  if (key === fitKey) return;
  fitKey = key;
  fit = frame;
  // Minor 20+: the camera keeps its own aspect, as three's does.
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const pitch = (FRAMING.cameraPitchDeg * PI) / 180;
  const half = (N * FRAMING.cellSize) / 2 + FRAMING.cellSize * 0.35;
  const pts: Vector3[] = [];
  for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [0, FRAMING.pieceHeight + FRAMING.cellHeight]) pts.push(new Vector3(x, y, z));
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, Math.cos(pitch), -Math.sin(pitch)); // the view's up, perpendicular to its axis
  const rw = (frame.x1 - frame.x0) / 2, rh = (frame.y1 - frame.y0) / 2;
  const cx = (frame.x0 + frame.x1) / 2, cy = (frame.y0 + frame.y1) / 2;
  const tanHalf = Math.tan(((FRAMING.cameraFov * PI) / 180) / 2);
  let d = FRAMING.cameraDistance * 0.75;
  let ox = 0, oy = 0;
  const pos = new Vector3(), target = new Vector3();
  for (let i = 0; i < 40; i++) {
    target.set(0, FRAMING.cameraTargetY, 0.4).addScaledVector(right, ox).addScaledVector(up, oy);
    pos.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d * 0.9).addScaledVector(right, ox).addScaledVector(up, oy);
    camera.position.copy(pos);
    camera.lookAt(target);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      _v.copy(p).project(camera);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    }
    const over = Math.max((maxX - minX) / 2 / (rw * 0.94), (maxY - minY) / 2 / (rh * 0.92));
    const ex = cx - (minX + maxX) / 2, ey = cy - (minY + maxY) / 2;
    if (over > 1.001) { d *= Math.min(1.6, over + 0.02); continue; }
    if (Math.abs(ex) < 0.002 && Math.abs(ey) < 0.002) break;
    // Sliding camera and target by Δ moves the image by -Δ / half the view's extent there.
    const dist = pos.distanceTo(target);
    ox -= ex * tanHalf * dist * aspect;
    oy -= ey * tanHalf * dist;
  }
  camera.far = Math.max(100, d * 4);
  camera.updateProjectionMatrix();
  camBase = { pos: camera.position.clone(), target: target.clone() };
  if (d !== camDist) {
    camDist = d;
    if (scene.fog && "near" in scene.fog) { scene.fog.near = camDist * 1.35; scene.fog.far = camDist * 2.5; }
  }
}
/** Forget the fit (the C key / Fit board): the next frameBoard refits. */
export function resetCamera(): void { fitKey = ""; camShake = 0; }
export function currentFit(): Frame { return fit; }

// --- state → scene -----------------------------------------------------------------
const anims: { kind: "pop" | "flash" | "plate"; idx: number; t: number; mesh?: Mesh; vy?: number; vx?: number; vz?: number; spin?: number; slot?: number }[] = [];
const chipPool: Mesh[] = [];
let chipGeo: BoxGeometry | null = null;
const plateLive: { idx: number; t: number }[] = [];

export function setBoard(snap: Snapshot, events?: PlaceEvents | null): void {
  if (!fillMesh) return;
  const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2;
  const placed = new Set((events?.cells ?? []).map(([r, c]) => r * N + c));
  for (let i = 0; i < N * N; i++) {
    const { x, z } = cellCenter(Math.floor(i / N), i % N);
    if (snap.board[i] !== 0) {
      const pop = placed.has(i) && !motionOff();
      _m.makeScale(1, pop ? 0.6 : 1, 1);
      if (pop) anims.push({ kind: "pop", idx: i, t: 0 });
    } else _m.makeScale(0, 0, 0);
    _m.setPosition(x, y, z);
    fillMesh.setMatrixAt(i, _m);
  }
  fillMesh.instanceMatrix.needsUpdate = true;
  if (events?.clearedCells?.length) {
    spawnFlash(events.clearedCells);
    if (!motionOff()) camShake = Math.min(0.12, 0.04 + (events.lineCount ?? 0) * 0.02);
  }
}

export function setGhost(cells: [number, number][] | null, valid = true): void {
  if (!ghostMesh || !theme) return;
  const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2 + 0.03;
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N * N; i++) ghostMesh.setMatrixAt(i, _m);
  if (cells) {
    ghostMat.color.set(valid ? theme.ghost : "#c03030");
    ghostMat.opacity = valid ? 0.45 : 0.3;
    for (const [r, c] of cells) {
      if (r < 0 || r >= N || c < 0 || c >= N) continue;
      const { x, z } = cellCenter(r, c);
      _m.makeScale(1, 0.6, 1);
      _m.setPosition(x, y, z);
      ghostMesh.setMatrixAt(r * N + c, _m);
    }
  }
  ghostMesh.instanceMatrix.needsUpdate = true;
}

function spawnFlash(cellIdxs: number[]): void {
  if (!look || look.particles === "off" || !theme) return;
  const pal = COLOR_PALETTES[palette] ?? {};
  const glow = hex(pal.clearFlash || theme.clearFlash).multiplyScalar(LOOK.flashBoost);
  // A glowing plate over every cleared cell: a fade, so it stays under reduced motion.
  for (const idx of cellIdxs) {
    const live = plateLive.find((p) => p.idx === idx);
    if (live) live.t = 0; else plateLive.push({ idx, t: 0 });
  }
  if (motionOff()) return;
  // Wood chips burst up and fall back under gravity (count by particle tier).
  chipGeo ??= new BoxGeometry(0.16, 0.08, 0.22);
  const max = Math.min(cellIdxs.length * 2, chipCap(look));
  for (let i = 0; i < max; i++) {
    let m = chipPool.find((f) => !f.visible);
    if (!m) {
      m = new Mesh(chipGeo, new MeshBasicMaterial({ transparent: true, opacity: 0.95 }));
      m.noAO = true;
      scene.add(m);
      chipPool.push(m);
    }
    const idx = cellIdxs[i % cellIdxs.length]!;
    const { x, z } = cellCenter(Math.floor(idx / N), idx % N);
    m.material.color.copy(glow).multiplyScalar(i % 2 ? 1 : 0.6);
    m.position.set(x, 0.6, z);
    m.rotation.set(i * 0.7, i * 1.3, 0);
    m.visible = true;
    const a = i * 2.399; // golden-angle spread, deterministic
    anims.push({ kind: "flash", idx, mesh: m, t: 0, vy: 2.2 + (i % 3) * 0.4, vx: Math.cos(a) * 0.9, vz: Math.sin(a) * 0.9, spin: 4 + (i % 5) });
  }
}

// --- picking -------------------------------------------------------------------------
/** The board cell [row, col] under a window pixel, or null. */
export function pickCell(x: number, y: number): [number, number] | null {
  _ray.setFromCamera(pointerToNdc(x, y), camera);
  const o = _ray.ray.origin, dir = _ray.ray.direction;
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = -o.y / dir.y;
  if (t <= 0) return null;
  const px = o.x + dir.x * t, pz = o.z + dir.z * t;
  const col = Math.round(px / FRAMING.cellSize + (N - 1) / 2);
  const row = Math.round(pz / FRAMING.cellSize + (N - 1) / 2);
  if (row < 0 || row >= N || col < 0 || col >= N) return null;
  return [row, col];
}

// --- per frame ---------------------------------------------------------------------------
export function update(dtRaw: number): void {
  if (!look || !theme) return;
  const dt = Math.min(0.05, dtRaw || 0.016);
  const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2;
  let fillDirty = false;
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]!;
    a.t += dt;
    if (a.kind === "pop") {
      const k = Math.min(1, a.t / 0.18);
      const s = 0.6 + 0.4 * (motionOff() ? 1 : 1 - Math.pow(1 - k, 3));
      const { x, z } = cellCenter(Math.floor(a.idx / N), a.idx % N);
      _m.makeScale(1, s, 1);
      _m.setPosition(x, y, z);
      fillMesh.setMatrixAt(a.idx, _m);
      fillDirty = true;
      if (k >= 1) anims.splice(i, 1);
    } else if (a.kind === "flash" && a.mesh) {
      const k = a.t / 0.7;
      if (k >= 1) { a.mesh.visible = false; anims.splice(i, 1); continue; }
      a.vy! -= 6 * dt;
      a.mesh.position.y = Math.max(FRAMING.cellHeight / 2 + 0.05, a.mesh.position.y + a.vy! * dt);
      a.mesh.position.x += a.vx! * dt;
      a.mesh.position.z += a.vz! * dt;
      a.mesh.rotation.x += a.spin! * dt;
      a.mesh.material.opacity = 0.95 * (1 - k * k);
    }
  }
  if (fillDirty) fillMesh.instanceMatrix.needsUpdate = true;
  // Plates: one instance per lit cell, fading out over 0.45 s.
  if (plateLive.length || plates.count) {
    const pal = COLOR_PALETTES[palette] ?? {};
    const glow = hex(pal.clearFlash || theme.clearFlash).multiplyScalar(LOOK.flashBoost);
    for (let i = plateLive.length - 1; i >= 0; i--) {
      plateLive[i]!.t += dt;
      if (plateLive[i]!.t >= 0.45) plateLive.splice(i, 1);
    }
    const top = FRAMING.cellHeight / 2 + 0.012;
    plateLive.forEach((p, n) => {
      const { x, z } = cellCenter(Math.floor(p.idx / N), p.idx % N);
      _m.makeTranslation(x, top, z);
      plates.setMatrixAt(n, _m);
      plates.setColorAt(n, _col.copy(glow).multiplyScalar(0.5 * (1 - p.t / 0.45)));
    });
    plates.count = plateLive.length;
    plates.instanceMatrix.needsUpdate = true;
    if (plates.instanceColor) plates.instanceColor.needsUpdate = true;
  }

  // Decorative ambient motion: drifting motes and a gentle ghost bob.
  if (motes.visible) {
    clock += dt;
    const n = Math.min(MOTE_MAX, look.budget.motes);
    for (let i = 0; i < n; i++) {
      const ph = moteSeed[i]!;
      motePos[i * 3] = moteBase[i * 3]! + Math.sin(clock * 0.21 + ph) * 0.4;
      motePos[i * 3 + 1] = moteBase[i * 3 + 1]! + Math.sin(clock * 0.33 + ph * 1.7) * 0.25;
      motePos[i * 3 + 2] = moteBase[i * 3 + 2]! + Math.cos(clock * 0.17 + ph) * 0.4;
    }
    const attr = motes.geometry.getAttribute("position")!;
    attr.array = motePos;
    attr.needsUpdate = true;
    ghostMesh.position.y = (0.025 * (1 + Math.sin(clock * 3.2))) / 2;
  }

  // Event-tiered, low-amplitude camera shake; picking uses the shaken camera as before.
  camera.position.copy(camBase.pos);
  camera.lookAt(camBase.target);
  if (camShake > 0 && !motionOff()) {
    camShake = Math.max(0, camShake - dt * 0.5);
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
  } else camShake = 0;
}

export function cameraPosition(): Vector3 { return camera.position; }
