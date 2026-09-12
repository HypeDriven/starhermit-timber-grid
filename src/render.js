// Timber Grid — Three.js render layer. Consumes immutable snapshots; never
// mutates rules state. The board is the visual hero: a wooden puzzle bench.
import * as THREE from 'three';
import { N } from './rules.js';

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

const QUALITY_TIERS = {
  high: { pixelRatioCap: 2, shadows: true, particles: 64 },
  medium: { pixelRatioCap: 1.5, shadows: true, particles: 24 },
  low: { pixelRatioCap: 1, shadows: false, particles: 0 },
};

const COLOR_PALETTES = {
  standard: null,
  deuteranopia: { clearFlash: '#ffe08a', piece: '#3a6ea8' },
  protanopia: { clearFlash: '#ffe08a', piece: '#3a6ea8' },
  tritanopia: { clearFlash: '#ffd0a0', piece: '#a8563a' },
};

let renderer = null;
let scene = null;
let camera = null;
let boardPlane = null; // invisible raycast target
let cellMesh = null; // InstancedMesh: board cells
let fillMesh = null; // InstancedMesh: placed blocks
let ghostMesh = null; // InstancedMesh: preview blocks
let flashPool = []; // pooled clear-flash meshes
let benchGroup = null;
let keyLight = null;
let theme = null;
let quality = 'medium';
let reducedMotion = false;
let palette = 'standard';
let anims = []; // active deterministic-phase animations
let hidden = false;
let disposed = false;
let camShake = 0;

const _mat4 = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function hex(c) { return new THREE.Color(c); }

let camDist = FRAMING.cameraDistance;
function applyFog() {
  if (!scene || !scene.fog) return;
  scene.fog.near = camDist * 1.35;
  scene.fog.far = camDist * 2.5;
}

function cellCenter(row, col) {
  const s = FRAMING.cellSize;
  return { x: (col - (N - 1) / 2) * s, z: (row - (N - 1) / 2) * s };
}

export function init(canvas, initialTheme, opts = {}) {
  quality = opts.quality && opts.quality !== 'auto' ? opts.quality : 'medium';
  reducedMotion = !!opts.reducedMotion;
  palette = opts.palette || 'standard';
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low' });
  } catch (_) {
    return false;
  }
  const tier = QUALITY_TIERS[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap));
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FRAMING.cameraFov, 1, 0.1, 100);
  positionCamera(1);

  // Lighting: one dominant key, soft fill, ambient bounce.
  keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4);
  keyLight.position.set(-6, 10, 4);
  keyLight.castShadow = tier.shadows;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8;
  keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0xcfd8ff, 0.55);
  fill.position.set(5, 6, -6);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  boardPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(N + 2, N + 2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  boardPlane.rotation.x = -Math.PI / 2;
  scene.add(boardPlane);

  buildBoard();
  setTheme(initialTheme);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; });
  }
  return true;
}

function buildBoard() {
  benchGroup = new THREE.Group();
  scene.add(benchGroup);

  // Tabletop slab.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(N + 5, 0.6, N + 5),
    new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 })
  );
  slab.position.y = -0.42;
  slab.receiveShadow = true;
  benchGroup.add(slab);

  // Board cells: one instanced mesh.
  const cellGeo = new THREE.BoxGeometry(
    FRAMING.cellSize - FRAMING.cellGap, FRAMING.cellHeight, FRAMING.cellSize - FRAMING.cellGap);
  cellMesh = new THREE.InstancedMesh(cellGeo, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.02 }), N * N);
  cellMesh.receiveShadow = true;
  fillMesh = new THREE.InstancedMesh(cellGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), N * N);
  fillMesh.castShadow = true;
  ghostMesh = new THREE.InstancedMesh(
    cellGeo,
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
  }
  benchGroup.add(cellMesh, fillMesh, ghostMesh);

  // 3x3 region grooves: slightly raised frame bars.
  const barMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  for (let i = 0; i <= 3; i++) {
    const off = (i * 3 - N / 2) * FRAMING.cellSize - FRAMING.cellSize / 2;
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(N + 0.25, 0.08, 0.08), barMat);
    hBar.position.set(0, FRAMING.cellHeight / 2 + 0.02, off + FRAMING.cellSize / 2 + FRAMING.cellSize / 2 * 0);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, N + 0.25), barMat);
    vBar.position.set(off + 0, FRAMING.cellHeight / 2 + 0.02, 0);
    // position bars between region boundaries
    const p = (i - 1.5) * 3 * FRAMING.cellSize - FRAMING.cellSize / 2 + FRAMING.cellSize * 0;
    hBar.position.z = p; vBar.position.x = p;
    benchGroup.add(hBar, vBar);
  }

  // Pooled clear-flash effects.
  flashPool = [];
}

export function setTheme(t) {
  theme = t;
  if (!scene) return;
  const pal = COLOR_PALETTES[palette] || {};
  scene.background = hex(t.bg);
  scene.fog = new THREE.Fog(hex(t.bg), 18, 34);
  applyFog();
  benchGroup.children[0].material.color = hex(t.bench);
  cellMesh.material.color = hex(t.board);
  fillMesh.material.color = hex(pal.piece || t.piece);
  ghostMesh.material.color = hex(t.ghost);
  // groove bars
  for (let i = 1; i < benchGroup.children.length; i++) {
    const m = benchGroup.children[i];
    if (m !== cellMesh && m !== fillMesh && m !== ghostMesh && m.material) m.material.color = hex(t.grid);
  }
}

export function setPalette(p) { palette = p; if (theme) setTheme(theme); }
export function setQuality(q) {
  quality = QUALITY_TIERS[q] ? q : 'medium';
  if (!renderer) return;
  // Apply the tier immediately; otherwise the setting only took effect on reload.
  const tier = QUALITY_TIERS[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap));
  renderer.shadowMap.enabled = tier.shadows;
  if (keyLight) keyLight.castShadow = tier.shadows;
  scene.traverse(o => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
  if (lastSize) resize(lastSize.w, lastSize.h); // re-apply the pixel ratio to the buffer
}
export function setReducedMotion(v) { reducedMotion = !!v; }

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
    for (const q of pts) { v.copy(q).project(probe); over = Math.max(over, Math.abs(v.x) / 0.94, Math.abs(v.y) / 0.92); }
    if (over <= 1) break;
    d *= Math.min(1.6, over + 0.02);
  }
  camera.position.set(0, Math.sin(pitch) * d, Math.cos(pitch) * d * 0.9);
  camera.lookAt(0, FRAMING.cameraTargetY, 0.4);
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
      const scale = events && events.cells && events.cells.some(([r, c]) => r * N + c === i) && !reducedMotion ? 0.6 : 1;
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
    if (!reducedMotion) camShake = Math.min(0.12, 0.04 + events.lineCount * 0.02);
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
  const tier = QUALITY_TIERS[quality];
  if (reducedMotion || tier.particles === 0) return;
  const pal = COLOR_PALETTES[palette] || {};
  const max = Math.min(cellIdxs.length, tier.particles);
  for (let i = 0; i < max; i++) {
    let m = flashPool.find(f => !f.visible);
    if (!m) {
      m = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 })
      );
      m.raycast = () => {};
      scene.add(m);
      flashPool.push(m);
    }
    const { x, z } = cellCenter(Math.floor(cellIdxs[i] / N), cellIdxs[i] % N);
    m.material.color = hex(pal.clearFlash || theme.clearFlash);
    m.position.set(x, 0.6, z);
    m.visible = true;
    anims.push({ kind: 'flash', mesh: m, t: 0, vy: 1.6, vx: (i % 3 - 1) * 0.4, vz: ((i * 7) % 3 - 1) * 0.4 });
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
  const dt = Math.min(0.05, (nowMs - lastT) / 1000 || 0.016);
  lastT = nowMs;

  // Advance animations by time delta (not frame count).
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    if (a.kind === 'pop') {
      const k = Math.min(1, a.t / 0.18);
      const s = 0.6 + 0.4 * (reducedMotion ? 1 : (1 - Math.pow(1 - k, 3)));
      const row = Math.floor(a.idx / N), col = a.idx % N;
      const { x, z } = cellCenter(row, col);
      _mat4.makeScale(1, s, 1);
      _mat4.setPosition(x, FRAMING.pieceHeight / 2 + FRAMING.cellHeight / 2, z);
      fillMesh.setMatrixAt(a.idx, _mat4);
      fillMesh.instanceMatrix.needsUpdate = true;
      if (k >= 1) anims.splice(i, 1);
    } else if (a.kind === 'flash') {
      const k = a.t / 0.5;
      if (k >= 1) { a.mesh.visible = false; anims.splice(i, 1); continue; }
      a.mesh.position.y += a.vy * dt;
      a.mesh.position.x += a.vx * dt;
      a.mesh.position.z += a.vz * dt;
      a.mesh.material.opacity = 0.9 * (1 - k);
    }
  }

  // Event-tiered, low-amplitude camera shake; never affects raycast truth.
  if (camShake > 0 && !reducedMotion) {
    camShake = Math.max(0, camShake - dt * 0.5);
    positionCamera(camera.aspect);
    camera.position.x += (Math.random() - 0.5) * camShake;
    camera.position.y += (Math.random() - 0.5) * camShake;
  } else if (camShake !== 0) {
    camShake = 0;
    positionCamera(camera.aspect);
  }

  renderer.render(scene, camera);
}

export function setHidden(v) { hidden = !!v; }

export function dispose() {
  disposed = true;
  if (!renderer) return;
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
      else o.material.dispose();
    }
  });
  renderer.dispose();
  renderer = null; scene = null; camera = null;
}
