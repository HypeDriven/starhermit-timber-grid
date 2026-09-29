// Timber Grid — Three.js render layer. Consumes immutable snapshots; never
// mutates rules state. The board is the visual hero: a wooden puzzle bench.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { N } from './rules.js';
import { detectPreset, describe, resolve, SHADOW_MAP, PARTICLE_COUNT, CATEGORIES } from './gfx.js';

// Framing constants (no magic offsets in code below).
export const FRAMING = {
  cellSize: 1,
  cellGap: 0.06,
  cellHeight: 0.28,
  pieceHeight: 0.42,
  cameraFov: 32,
  cameraPitchDeg: 52, // angle above the board plane
  cameraDistance: 13.5,
  cameraTargetY: 0,
};

// Look constants for the detailed tier.
const LOOK = {
  cellRadius: 0.05,
  pieceRadius: 0.07,
  rimWidth: 0.34,
  rimHeight: 0.34,
  floorY: -0.72,
  shadowExtent: 7.6, // half-size of the key light's shadow box (covers the bench slab)
  envIntensity: 0.3,
  flashBoost: 1.6, // HDR multiplier so clear effects (and only they) cross the bloom threshold
};

const COLOR_PALETTES = {
  standard: null,
  deuteranopia: { clearFlash: '#ffe08a', piece: '#3a6ea8' },
  protanopia: { clearFlash: '#ffe08a', piece: '#3a6ea8' },
  tritanopia: { clearFlash: '#ffd0a0', piece: '#a8563a' },
};

// Colour grade + vignette (display-space colours in, display-space out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.24 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve contrast, a touch more saturation, warm highlights / cool shadows.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.08);
      s *= mix(vec3(0.97, 0.98, 1.03), vec3(1.04, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

let renderer = null;
let scene = null;
let camera = null;
let boardPlane = null; // invisible raycast target
let cellMesh = null; // InstancedMesh: board cells
let fillMesh = null; // InstancedMesh: placed blocks
let ghostMesh = null; // InstancedMesh: preview blocks
let flashPool = []; // pooled clear-effect chips
let platePool = []; // pooled clear-flash plates (one per cleared cell)
let benchGroup = null;
let slab = null;
let barMat = null;
let detailGroup = null; // rim + floor, detailed tier only
let rimMat = null;
let floorMat = null;
let motes = null; // ambient sawdust motes
let keyLight = null;
let hemi = null;
let theme = null;
let reducedMotion = false;
let palette = 'standard';
let anims = []; // active deterministic-phase animations
let hidden = false;
let disposed = false;
let camShake = 0;
let clock = 0; // seconds of decorative time (frozen under reduced motion)

// Graphics state.
let gpuName = '';
let detected = 'balanced';
let savedGfx = {};
let q = resolve({}, 'balanced');
let ctxAA = false;
let composer = null;
let postKey = null;
let postFailed = false;
let pixelRatio = 1;
let adaptiveScale = 1;
let frameTimes = [];
let fps = 0;
let envTex = null;
const mats = {}; // plain/detailed material pairs
const geos = {}; // plain/detailed geometry pairs
let woodTex = null;

const _mat4 = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _col = new THREE.Color();

function hex(c) { return new THREE.Color(c); }

let camDist = FRAMING.cameraDistance;
function applyFog() {
  if (!scene || !scene.fog) return;
  // Fog follows the fitted camera distance so a pulled-back (portrait) camera
  // never fogs out the board itself.
  scene.fog.near = camDist * 1.35;
  scene.fog.far = camDist * 2.5;
}

function cellCenter(row, col) {
  const s = FRAMING.cellSize;
  return { x: (col - (N - 1) / 2) * s, z: (row - (N - 1) / 2) * s };
}

function prefersReduced() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}
function motionOff() { return reducedMotion || prefersReduced(); }

function isMobile() {
  try {
    return window.matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  } catch (_) { return false; }
}

// Unmasked GPU name from a throwaway context (the real one's AA depends on it).
function probeGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return name;
  } catch (_) { return ''; }
}

export function init(canvas, initialTheme, opts = {}) {
  reducedMotion = !!opts.reducedMotion;
  palette = opts.palette || 'standard';
  gpuName = probeGpu();
  detected = detectPreset(gpuName, isMobile());
  savedGfx = opts.graphics || {};
  q = resolve(savedGfx, detected);
  // Canvas MSAA is fixed at context creation; later MSAA requests without it
  // are served by a multisampled composer target instead.
  ctxAA = q.antialias === 'msaa';
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: ctxAA, powerPreference: 'high-performance' });
  } catch (_) {
    return false;
  }
  pixelRatio = currentRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FRAMING.cameraFov, 1, 0.1, 100);
  positionCamera(1);

  // Lighting: one dominant key with fitted shadows, a cool fill, and a
  // hemisphere bounce (warm from above, bench-dark from below).
  keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4);
  keyLight.position.set(-6, 10, 4);
  const sc = keyLight.shadow.camera;
  Object.assign(sc, { left: -LOOK.shadowExtent, right: LOOK.shadowExtent, top: LOOK.shadowExtent, bottom: -LOOK.shadowExtent, near: 2, far: 26 });
  sc.updateProjectionMatrix();
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight, keyLight.target);
  const fill = new THREE.DirectionalLight(0xcfd8ff, 0.55);
  fill.position.set(5, 6, -6);
  scene.add(fill);
  hemi = new THREE.HemisphereLight(0xfff4e6, 0x3a2a1c, 0.55);
  scene.add(hemi);

  boardPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(N + 2, N + 2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  boardPlane.rotation.x = -Math.PI / 2;
  scene.add(boardPlane);

  buildBoard();
  setTheme(initialTheme);
  setGraphics(savedGfx, true);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; });
  }
  return true;
}

// --- procedural wood ----------------------------------------------------------

// Grey-scale wood grain (values ~0.8–1.0, linear) used as a colour multiplier
// and bump map: long wavy growth rings plus fine pores. Deterministic.
function makeWoodTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pores = new Float32Array(size * size);
  for (let i = 0; i < pores.length; i++) pores[i] = rnd();
  const waves = [0, 1, 2].map(() => ({ a: 2 + rnd() * 5, f: (1 + Math.floor(rnd() * 3)) * Math.PI * 2 / size, p: rnd() * 6.28 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let yy = y;
      for (const w of waves) yy += w.a * Math.sin(x * w.f + w.p);
      const ring = 0.5 + 0.5 * Math.sin(yy * 0.32 + Math.sin(yy * 0.05) * 3);
      const streak = Math.pow(ring, 3);
      // pores stretch along the grain: average a short horizontal run
      const i = y * size + x;
      const pore = (pores[i] + pores[y * size + ((x + 1) % size)] + pores[y * size + ((x + 2) % size)]) / 3;
      const v = 0.97 - streak * 0.13 - (pore > 0.8 ? 0.05 : 0) + (pore - 0.5) * 0.03;
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Offset the grain per instance so neighbouring blocks never share a pattern.
function grainPerInstance(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec2 tgOff = fract(vec2(instanceMatrix[3].x * 0.618 + instanceMatrix[3].z * 0.231, instanceMatrix[3].z * 0.414 + instanceMatrix[3].x * 0.137));
        #ifdef USE_MAP
          vMapUv = vMapUv * 0.55 + tgOff;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = vBumpMapUv * 0.55 + tgOff;
        #endif
      #endif`);
  };
  mat.customProgramCacheKey = () => 'tg-grain';
  return mat;
}

function buildBoard() {
  benchGroup = new THREE.Group();
  scene.add(benchGroup);
  woodTex = makeWoodTexture();

  const cs = FRAMING.cellSize - FRAMING.cellGap;
  geos.cell = {
    plain: new THREE.BoxGeometry(cs, FRAMING.cellHeight, cs),
    detailed: new RoundedBoxGeometry(cs, FRAMING.cellHeight, cs, 2, LOOK.cellRadius),
  };
  geos.piece = {
    plain: geos.cell.plain,
    detailed: new RoundedBoxGeometry(cs, FRAMING.cellHeight, cs, 3, LOOK.pieceRadius),
  };
  geos.slab = {
    plain: new THREE.BoxGeometry(N + 5, 0.6, N + 5),
    detailed: new RoundedBoxGeometry(N + 5, 0.6, N + 5, 2, 0.12),
  };

  mats.slab = {
    plain: new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }),
    detailed: new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.0, map: woodTex, bumpMap: woodTex, bumpScale: 0.6, envMapIntensity: 0.5 }),
  };
  mats.cell = {
    plain: new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.02 }),
    detailed: grainPerInstance(new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.0, map: woodTex, bumpMap: woodTex, bumpScale: 0.5, envMapIntensity: 0.6 })),
  };
  // Placed pieces are lacquered: clearcoat gives a crisp highlight that
  // separates them from the matte board.
  mats.piece = {
    plain: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }),
    detailed: grainPerInstance(new THREE.MeshPhysicalMaterial({
      roughness: 0.5, metalness: 0.0, map: woodTex, bumpMap: woodTex, bumpScale: 0.4,
      clearcoat: 0.7, clearcoatRoughness: 0.28, envMapIntensity: 0.9,
    })),
  };

  // Tabletop slab.
  slab = new THREE.Mesh(geos.slab.plain, mats.slab.plain);
  slab.position.y = -0.42;
  slab.receiveShadow = true;
  benchGroup.add(slab);

  // Board cells: one instanced mesh; placed blocks and previews likewise.
  cellMesh = new THREE.InstancedMesh(geos.cell.plain, mats.cell.plain, N * N);
  cellMesh.receiveShadow = true;
  fillMesh = new THREE.InstancedMesh(geos.piece.plain, mats.piece.plain, N * N);
  fillMesh.castShadow = true;
  fillMesh.receiveShadow = true;
  ghostMesh = new THREE.InstancedMesh(
    geos.cell.plain,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
    N * N
  );
  ghostMesh.raycast = () => {}; // cosmetic: never intercepts raycasts
  for (let i = 0; i < N * N; i++) {
    const row = Math.floor(i / N), col = i % N;
    const { x, z } = cellCenter(row, col);
    _mat4.makeTranslation(x, 0, z);
    cellMesh.setMatrixAt(i, _mat4);
    _mat4.makeScale(0.0001, 0.0001, 0.0001); _mat4.setPosition(x, FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2, z);
    fillMesh.setMatrixAt(i, _mat4);
    ghostMesh.setMatrixAt(i, _mat4);
    // allocate per-instance colours up front so the shader variant is stable
    cellMesh.setColorAt(i, _col.setRGB(1, 1, 1));
    fillMesh.setColorAt(i, _col.setRGB(1, 1, 1));
  }
  benchGroup.add(cellMesh, fillMesh, ghostMesh);

  // 3x3 region dividers: slightly raised bars in the gaps between regions.
  barMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const barY = FRAMING.cellHeight / 2 + 0.02;
  for (let i = 0; i <= 3; i++) {
    const p = (i - 1.5) * 3 * FRAMING.cellSize; // region boundary: ±1.5, ±4.5
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(N + 0.08, 0.08, 0.08), barMat);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, N + 0.08), barMat);
    hBar.position.set(0, barY, p);
    vBar.position.set(p, barY, 0);
    hBar.castShadow = vBar.castShadow = true;
    hBar.userData.bar = vBar.userData.bar = true;
    benchGroup.add(hBar, vBar);
  }

  // Detailed tier: a raised frame around the board and a workshop floor.
  detailGroup = new THREE.Group();
  rimMat = grainPerInstance(new THREE.MeshStandardMaterial({ roughness: 0.6, map: woodTex, bumpMap: woodTex, bumpScale: 0.6, envMapIntensity: 0.6 }));
  const rimLen = N + LOOK.rimWidth * 2 + 0.1;
  const rimGeo = new RoundedBoxGeometry(rimLen, LOOK.rimHeight, LOOK.rimWidth, 2, 0.06);
  const rims = new THREE.InstancedMesh(rimGeo, rimMat, 4);
  const edge = N / 2 + 0.05 + LOOK.rimWidth / 2;
  const rimY = -0.12 + LOOK.rimHeight / 2;
  const rot = new THREE.Matrix4();
  [[0, edge, 0], [0, -edge, 0], [edge, 0, Math.PI / 2], [-edge, 0, Math.PI / 2]].forEach(([x, z, r], i) => {
    rot.makeRotationY(r); rot.setPosition(x, rimY, z);
    rims.setMatrixAt(i, rot);
  });
  rims.castShadow = rims.receiveShadow = true;
  detailGroup.add(rims);
  floorMat = new THREE.MeshStandardMaterial({ roughness: 0.9, map: woodTex.clone(), envMapIntensity: 0.2 });
  floorMat.map.repeat.set(5, 14);
  floorMat.map.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = LOOK.floorY;
  floor.receiveShadow = true;
  floor.raycast = () => {};
  detailGroup.add(floor);
  benchGroup.add(detailGroup);

  // Ambient sawdust motes drifting in the lamp light (cosmetic).
  const count = 90;
  const pos = new Float32Array(count * 3);
  const seedArr = new Float32Array(count);
  let s = 99;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (rnd() - 0.5) * 13;
    pos[i * 3 + 1] = 0.6 + rnd() * 3.4;
    pos[i * 3 + 2] = (rnd() - 0.5) * 13;
    seedArr[i] = rnd() * 6.28;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  motes = new THREE.Points(mg, new THREE.PointsMaterial({
    size: 0.04, color: 0xffe2b0, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.userData.seed = seedArr;
  motes.userData.base = pos.slice();
  motes.raycast = () => {};
  motes.visible = false;
  scene.add(motes);

  flashPool = [];
  platePool = [];
}

// Small deterministic per-cell jitter in [-1, 1].
function jitter(i) {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

function applyColors() {
  if (!theme || !cellMesh) return;
  const pal = COLOR_PALETTES[palette] || {};
  const detailed = q.detail === 'detailed';
  const board = hex(theme.board), boardAlt = hex(theme.boardAlt || theme.board);
  const piece = hex(pal.piece || theme.piece), pieceAlt = hex(pal.piece || theme.pieceAlt || theme.piece);
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    if (detailed) {
      // alternate 3x3 regions for readability, with a faint per-board variation
      const alt = (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 1;
      _col.copy(alt ? boardAlt : board).multiplyScalar(1 + jitter(i) * 0.03);
    } else _col.copy(board);
    cellMesh.setColorAt(i, _col);
    if (detailed) _col.copy(piece).lerp(pieceAlt, 0.12 + 0.12 * jitter(i + 101));
    else _col.copy(piece);
    fillMesh.setColorAt(i, _col);
  }
  cellMesh.instanceColor.needsUpdate = true;
  fillMesh.instanceColor.needsUpdate = true;
}

export function setTheme(t) {
  theme = t;
  if (!scene) return;
  scene.background = hex(t.bg);
  scene.fog = new THREE.Fog(hex(t.bg), 18, 34);
  applyFog();
  for (const m of [mats.slab.plain, mats.slab.detailed]) m.color = hex(t.bench);
  for (const m of [mats.cell.plain, mats.cell.detailed, mats.piece.plain, mats.piece.detailed]) m.color = new THREE.Color(1, 1, 1);
  ghostMesh.material.color = hex(t.ghost);
  barMat.color = hex(t.grid);
  rimMat.color = hex(t.bench).lerp(hex(t.grid), 0.35).multiplyScalar(1.15);
  floorMat.color = hex(t.bg).lerp(hex(t.bench), 0.55);
  hemi.groundColor = hex(t.bench).multiplyScalar(0.6);
  applyColors();
}

export function setPalette(p) { palette = p; if (theme) setTheme(theme); }
/** Legacy single-setting entry point (auto|high|medium|low). */
export function setQuality(qual) {
  const map = { high: 'high', medium: 'balanced', low: 'low' };
  setGraphics({ ...savedGfx, preset: map[qual] || 'auto' });
}
export function setReducedMotion(v) { reducedMotion = !!v; applyMotion(); }

// --- graphics settings ----------------------------------------------------------

function currentRatio() {
  return Math.min(window.devicePixelRatio || 1, q.cap) * q.scale * adaptiveScale;
}

/** Apply saved graphics settings live: { preset, render_scale, adaptive, show_fps, <category> }. */
export function setGraphics(saved, force = false) {
  const json = JSON.stringify(saved || {});
  if (!force && json === JSON.stringify(savedGfx)) return;
  savedGfx = JSON.parse(json);
  q = resolve(savedGfx, detected);
  if (!renderer) return;
  const size = SHADOW_MAP[q.shadows];
  renderer.shadowMap.enabled = size > 0;
  keyLight.castShadow = size > 0;
  if (size > 0 && keyLight.shadow.mapSize.x !== size) {
    keyLight.shadow.mapSize.set(size, size);
    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
  }
  // Detail tier: rounded geometry, wood grain, board frame and floor.
  const tier = q.detail === 'detailed' ? 'detailed' : 'plain';
  cellMesh.geometry = geos.cell[tier];
  cellMesh.material = mats.cell[tier];
  fillMesh.geometry = geos.piece[tier];
  fillMesh.material = mats.piece[tier];
  ghostMesh.geometry = geos.piece[tier];
  slab.geometry = geos.slab[tier];
  slab.material = mats.slab[tier];
  detailGroup.visible = tier === 'detailed';
  slab.castShadow = tier === 'detailed';
  // Reflections: a neutral studio environment for the PBR surfaces.
  if (q.reflections === 'on') {
    if (!envTex) {
      const pm = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      envTex = pm.fromScene(room, 0.04).texture;
      room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pm.dispose();
    }
    scene.environment = envTex;
    scene.environmentIntensity = LOOK.envIntensity;
    hemi.intensity = 0.4;
  } else {
    scene.environment = null;
    hemi.intensity = 0.55;
  }
  applyColors();
  applyMotion();
  adaptiveScale = 1;
  frameTimes = [];
  postKey = null; // rebuild the post chain on the next frame
  postFailed = false;
  fpsVisible(q.showFps);
  markAttributes();
  // Materials pick up shadow/environment changes on recompile.
  scene.traverse(o => {
    if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true;
  });
  for (const pair of Object.values(mats)) { pair.plain.needsUpdate = true; pair.detailed.needsUpdate = true; }
  if (lastSize) resize(lastSize.w, lastSize.h);
}

function applyMotion() {
  if (!motes) return;
  motes.visible = q.ambient === 'animated' && !motionOff();
  if (!motes.visible && ghostMesh) ghostMesh.position.y = 0;
}

function markAttributes() {
  const targets = [document.body, renderer && renderer.domElement].filter(Boolean);
  for (const el of targets) {
    el.dataset.gfxPreset = q.preset;
    el.dataset.gfxAuto = q.auto ? 'true' : 'false';
    for (const cat of Object.keys(CATEGORIES)) el.dataset['gfx' + cat[0].toUpperCase() + cat.slice(1)] = q[cat];
  }
}

function fpsVisible(on) {
  let el = document.getElementById('fps-meter');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'fps-meter';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  if (el) { el.hidden = !on; if (on && !el.textContent) el.textContent = '… fps'; }
}

/** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
export function graphicsInfo(word) {
  const w = lastSize ? lastSize.w : 0, h = lastSize ? lastSize.h : 0;
  const px = [Math.round(w * pixelRatio), Math.round(h * pixelRatio)];
  return {
    gpu: gpuName || 'unknown GPU',
    detected,
    resolved: q,
    summary: describe(q, px, word),
    fps: Math.round(fps),
    adaptiveScale: Math.round(adaptiveScale * 100) / 100,
    postFailed,
  };
}

function needsPost() {
  return q.post || (q.antialias === 'msaa' && !ctxAA);
}

function buildPost(w, h) {
  if (composer) { composer.dispose(); composer = null; }
  if (!needsPost() || postFailed) return;
  try {
    const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
    const target = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0,
    });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(pixelRatio);
    c.setSize(w, h);
    c.addPass(new RenderPass(scene, camera));
    if (q.ao !== 'off') {
      const ao = new GTAOPass(scene, camera, pw, ph);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.75;
      const hi = q.ao === 'high';
      ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: hi ? 16 : 8 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
      c.addPass(ao);
    }
    if (q.bloom === 'on') {
      // High threshold: only the HDR clear effects and hot highlights bloom.
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.45, 0.95));
    }
    c.addPass(new OutputPass());
    if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
    if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
    if (q.antialias === 'fxaa') {
      const fxaa = new ShaderPass(FXAAShader);
      fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
      c.addPass(fxaa);
    }
    composer = c;
  } catch (_) {
    // Post-processing is an enhancement: render directly if the chain cannot be built.
    postFailed = true;
    composer = null;
  }
}

// Adaptive resolution: step the render scale down when frames are slow, back up when fast.
function adapt(dtMs) {
  frameTimes.push(dtMs);
  if (frameTimes.length < 90) return false;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes.length = 0;
  fps = 1000 / avg;
  const el = document.getElementById('fps-meter');
  if (el && !el.hidden) el.textContent = `${Math.round(fps)} fps · ${Math.round(pixelRatio * 100) / 100}×`;
  if (!q.adaptive) return false;
  const before = adaptiveScale;
  if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
  else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
  return before !== adaptiveScale;
}

// Camera distance found by projection: pull back from the authored distance
// until every board corner (including piece height) sits inside the framed
// rectangle, at any aspect ratio.
function positionCamera(aspect) {
  const pitch = THREE.MathUtils.degToRad(FRAMING.cameraPitchDeg);
  const half = (N * FRAMING.cellSize) / 2 + FRAMING.cellSize * 0.35;
  const pts = [];
  for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [0, FRAMING.pieceHeight + FRAMING.cellHeight])
    pts.push(new THREE.Vector3(x, y, z));
  const probe = new THREE.PerspectiveCamera(FRAMING.cameraFov, aspect, 0.1, 100);
  const v = new THREE.Vector3();
  let d = FRAMING.cameraDistance * 0.75;
  for (let i = 0; i < 14; i++) {
    probe.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d * 0.9);
    probe.lookAt(0, FRAMING.cameraTargetY, 0.4);
    probe.updateMatrixWorld();
    probe.updateProjectionMatrix();
    let over = 0;
    for (const p of pts) { v.copy(p).project(probe); over = Math.max(over, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.92); }
    if (over <= 1) break;
    d *= Math.min(1.6, over + 0.02);
  }
  camera.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d * 0.9);
  camera.lookAt(0, FRAMING.cameraTargetY, 0.4);
  camera.far = Math.max(100, d * 4);
  camera.updateProjectionMatrix();
  if (d !== camDist) { camDist = d; applyFog(); }
}

/** Client-space centre of a board cell under the live camera (tests/tools). */
export function cellToClient(row, col) {
  if (!camera || !renderer) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const { x, z } = cellCenter(row, col);
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(x, FRAMING.cellHeight / 2, z).project(camera);
  return { cx: rect.left + (v.x + 1) / 2 * rect.width, cy: rect.top + (1 - v.y) / 2 * rect.height };
}

/** Camera/frame diagnostics for tests and tools. */
export function cameraInfo() {
  return { pos: camera ? camera.position.toArray() : null, view: camera && camera.view ? { ...camera.view } : null, size: lastSize, insets: lastInsets };
}

let lastSize = null;
let lastInsets = { top: 0, bottom: 0, left: 0, right: 0 };
export function resize(w, h, insets) {
  if (!renderer) return;
  lastSize = { w, h };
  if (insets) lastInsets = insets;
  pixelRatio = currentRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  // Frame the board inside the part of the canvas not covered by rails/cards
  // (view offset); fall back to the whole canvas when they cover too much.
  const ins = lastInsets;
  const sw = Math.max(1, w - ins.left - ins.right), sh = Math.max(1, h - ins.top - ins.bottom);
  if (sw < w * 0.45 || sh < h * 0.45) {
    camera.aspect = w / Math.max(1, h);
    camera.clearViewOffset();
  } else {
    camera.aspect = sw / sh;
    camera.setViewOffset(sw, sh, -ins.left, -ins.top, w, h);
  }
  camera.updateProjectionMatrix();
  positionCamera(camera.aspect);
  postKey = null;
}

// --- state → scene -----------------------------------------------------------

// snap: serialized rules state. events: optional placement events for animation.
export function setBoard(snap, events) {
  if (!fillMesh) return;
  for (let i = 0; i < N * N; i++) {
    const filled = snap.board[i] !== 0;
    const row = Math.floor(i / N), col = i % N;
    const { x, z } = cellCenter(row, col);
    const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2;
    if (filled) {
      const scale = events && events.cells && events.cells.some(([r, c]) => r * N + c === i) && !motionOff() ? 0.6 : 1;
      _mat4.makeScale(1, scale === 1 ? 1 : scale, 1);
      _mat4.setPosition(x, y, z);
      if (scale !== 1) anims.push({ kind: 'pop', idx: i, t: 0 });
    } else {
      _mat4.makeScale(0.0001, 0.0001, 0.0001);
      _mat4.setPosition(x, y, z);
    }
    fillMesh.setMatrixAt(i, _mat4);
  }
  fillMesh.instanceMatrix.needsUpdate = true;

  if (events && events.clearedCells && events.clearedCells.length) {
    spawnFlash(events.clearedCells);
    if (!motionOff()) camShake = Math.min(0.12, 0.04 + events.lineCount * 0.02);
  }
}

export function setGhost(cells, valid) {
  if (!ghostMesh) return;
  const y = FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2 + 0.03;
  for (let i = 0; i < N * N; i++) {
    _mat4.makeScale(0.0001, 0.0001, 0.0001);
    ghostMesh.setMatrixAt(i, _mat4);
  }
  if (cells) {
    ghostMesh.material.color = valid ? hex(theme.ghost) : hex('#c03030');
    ghostMesh.material.opacity = valid ? 0.45 : 0.3;
    for (const [r, c] of cells) {
      if (r < 0 || r >= N || c < 0 || c >= N) continue;
      const { x, z } = cellCenter(r, c);
      _mat4.makeScale(1, 0.6, 1);
      _mat4.setPosition(x, y, z);
      ghostMesh.setMatrixAt(r * N + c, _mat4);
    }
  }
  ghostMesh.instanceMatrix.needsUpdate = true;
}

function spawnFlash(cellIdxs) {
  if (q.particles === 'off') return;
  const pal = COLOR_PALETTES[palette] || {};
  const glow = hex(pal.clearFlash || theme.clearFlash).multiplyScalar(LOOK.flashBoost);
  const top = FRAMING.cellHeight / 2 + 0.012;
  // A glowing plate over every cleared cell: a fade, so it stays under reduced motion.
  for (let i = 0; i < cellIdxs.length; i++) {
    let p = platePool.find(f => !f.visible);
    if (!p) {
      p = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      p.rotation.x = -Math.PI / 2;
      p.raycast = () => {};
      scene.add(p);
      platePool.push(p);
    }
    const { x, z } = cellCenter(Math.floor(cellIdxs[i] / N), cellIdxs[i] % N);
    p.material.color.copy(glow);
    p.position.set(x, top, z);
    p.visible = true;
    anims.push({ kind: 'plate', mesh: p, t: 0 });
  }
  if (motionOff()) return;
  // Wood chips burst up and fall back under gravity (count by particle tier).
  const max = Math.min(cellIdxs.length * 2, PARTICLE_COUNT[q.particles]);
  for (let i = 0; i < max; i++) {
    let m = flashPool.find(f => !f.visible);
    if (!m) {
      m = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.08, 0.22),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 })
      );
      m.raycast = () => {};
      scene.add(m);
      flashPool.push(m);
    }
    const idx = cellIdxs[i % cellIdxs.length];
    const { x, z } = cellCenter(Math.floor(idx / N), idx % N);
    m.material.color.copy(glow).multiplyScalar(i % 2 ? 1 : 0.6);
    m.position.set(x, 0.6, z);
    m.rotation.set(i * 0.7, i * 1.3, 0);
    m.visible = true;
    const a = i * 2.399; // golden-angle spread, deterministic
    anims.push({ kind: 'flash', mesh: m, t: 0, vy: 2.2 + (i % 3) * 0.4, vx: Math.cos(a) * 0.9, vz: Math.sin(a) * 0.9, spin: 4 + (i % 5) });
  }
}

// --- picking ------------------------------------------------------------------

// Convert client coords to a board cell [row, col] or null.
export function pickCell(clientX, clientY, canvasRect) {
  if (!camera) return null;
  _ndc.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
  _ndc.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, camera);
  const hits = _ray.intersectObject(boardPlane, false);
  if (!hits.length) return null;
  const p = hits[0].point;
  const col = Math.round(p.x / FRAMING.cellSize + (N - 1) / 2);
  const row = Math.round(p.z / FRAMING.cellSize + (N - 1) / 2);
  if (row < 0 || row >= N || col < 0 || col >= N) return null;
  return [row, col];
}

// --- render loop ---------------------------------------------------------------

let lastT = 0;
export function frame(nowMs) {
  if (!renderer || hidden || disposed) return;
  const rawMs = lastT ? nowMs - lastT : 16;
  const dt = Math.min(0.05, rawMs / 1000 || 0.016);
  lastT = nowMs;

  // Advance animations by time delta (not frame count).
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.kind === 'pop') {
      const k = Math.min(1, a.t / 0.18);
      const s = 0.6 + 0.4 * (motionOff() ? 1 : (1 - Math.pow(1 - k, 3)));
      const row = Math.floor(a.idx / N), col = a.idx % N;
      const { x, z } = cellCenter(row, col);
      _mat4.makeScale(1, s, 1);
      _mat4.setPosition(x, FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2, z);
      fillMesh.setMatrixAt(a.idx, _mat4);
      fillMesh.instanceMatrix.needsUpdate = true;
      if (k >= 1) anims.splice(i, 1);
    } else if (a.kind === 'flash') {
      const k = a.t / 0.7;
      if (k >= 1) { a.mesh.visible = false; anims.splice(i, 1); continue; }
      a.vy -= 6 * dt;
      a.mesh.position.y = Math.max(FRAMING.cellHeight / 2 + 0.05, a.mesh.position.y + a.vy * dt);
      a.mesh.position.x += a.vx * dt;
      a.mesh.position.z += a.vz * dt;
      a.mesh.rotation.x += a.spin * dt;
      a.mesh.material.opacity = 0.95 * (1 - k * k);
    } else if (a.kind === 'plate') {
      const k = a.t / 0.45;
      if (k >= 1) { a.mesh.visible = false; anims.splice(i, 1); continue; }
      a.mesh.material.opacity = 0.5 * (1 - k);
    }
  }

  // Decorative ambient motion: drifting motes and a gentle ghost bob.
  if (motes.visible) {
    clock += dt;
    const p = motes.geometry.attributes.position;
    const base = motes.userData.base, sd = motes.userData.seed;
    for (let i = 0; i < sd.length; i++) {
      const ph = sd[i];
      p.array[i * 3] = base[i * 3] + Math.sin(clock * 0.21 + ph) * 0.4;
      p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(clock * 0.33 + ph * 1.7) * 0.25;
      p.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(clock * 0.17 + ph) * 0.4;
    }
    p.needsUpdate = true;
    ghostMesh.position.y = 0.025 * (1 + Math.sin(clock * 3.2)) / 2;
  }

  // Event-tiered, low-amplitude camera shake; never affects raycast truth.
  if (camShake > 0 && !motionOff()) {
    camShake = Math.max(0, camShake - dt * 0.5);
    positionCamera(camera.aspect);
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
  } else if (camShake !== 0) {
    camShake = 0;
    positionCamera(camera.aspect);
  }

  // Resolution: device ratio capped per preset × render scale × adaptive scale.
  if (adapt(Math.min(250, rawMs)) || currentRatio() !== pixelRatio) {
    if (lastSize) resize(lastSize.w, lastSize.h);
  }
  if (lastSize) {
    const key = needsPost() && !postFailed
      ? [q.ao, q.bloom, q.grade, q.antialias, lastSize.w, lastSize.h, pixelRatio].join('|') : 'none';
    if (key !== postKey) { postKey = key; buildPost(lastSize.w, lastSize.h); }
  }
  if (composer) {
    try { composer.render(dt); return; } catch (_) {
      postFailed = true;
      composer.dispose(); composer = null;
    }
  }
  renderer.render(scene, camera);
}

export function setHidden(v) { hidden = !!v; }

export function dispose() {
  disposed = true;
  if (!renderer) return;
  if (composer) { composer.dispose(); composer = null; }
  if (envTex) { envTex.dispose(); envTex = null; }
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  for (const pair of Object.values(geos)) { pair.plain.dispose(); pair.detailed.dispose(); }
  for (const pair of Object.values(mats)) { pair.plain.dispose(); pair.detailed.dispose(); }
  if (woodTex) woodTex.dispose();
  renderer.dispose();
  renderer = null; scene = null; camera = null;
}
