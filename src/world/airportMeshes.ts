import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AirportLayout, PolyFeature, Runway } from '../data/osm';
import type { TaxiGraph } from '../sim/taxiGraph';
import { type XZ, dist, headingToRotY, headingVec } from '../geo/projection';

/** Collects flat quads/discs on the ground plane into one BufferGeometry. */
class FlatBatch {
  private pos: number[] = [];
  private idx: number[] = [];
  constructor(private y: number) {}

  quad(a: XZ, b: XZ, c: XZ, d: XZ) {
    const i = this.pos.length / 3;
    this.pos.push(a.x, this.y, a.z, b.x, this.y, b.z, c.x, this.y, c.z, d.x, this.y, d.z);
    this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }

  /** Rectangle centred on `c`, long side along `hdg`. */
  rect(c: XZ, hdg: number, length: number, width: number) {
    const f = headingVec(hdg);
    const r = { x: -f.z, z: f.x };
    const hl = length / 2, hw = width / 2;
    const P = (sl: number, sw: number) => ({ x: c.x + f.x * sl + r.x * sw, z: c.z + f.z * sl + r.z * sw });
    this.quad(P(-hl, -hw), P(-hl, hw), P(hl, hw), P(hl, -hw));
  }

  segment(a: XZ, b: XZ, width: number) {
    const len = dist(a, b);
    if (len < 0.01) return;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const nx = -dz * (width / 2), nz = dx * (width / 2);
    this.quad({ x: a.x + nx, z: a.z + nz }, { x: a.x - nx, z: a.z - nz }, { x: b.x - nx, z: b.z - nz }, { x: b.x + nx, z: b.z + nz });
  }

  disc(c: XZ, r: number, n = 10) {
    const i0 = this.pos.length / 3;
    this.pos.push(c.x, this.y, c.z);
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.pos.push(c.x + Math.cos(a) * r, this.y, c.z + Math.sin(a) * r);
    }
    for (let k = 0; k < n; k++) this.idx.push(i0, i0 + k + 2, i0 + k + 1);
  }

  polyline(pts: XZ[], width: number, joints = true) {
    for (let i = 1; i < pts.length; i++) this.segment(pts[i - 1], pts[i], width);
    if (joints && width > 2) for (const p of pts) this.disc(p, width / 2, 12);
  }

  dashed(pts: XZ[], width: number, dash: number, gap: number) {
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = dist(a, b);
      let s = carry;
      while (s < len) {
        const e = Math.min(len, s + dash);
        const t0 = s / len, t1 = e / len;
        this.segment({ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 }, width);
        s += dash + gap;
      }
      carry = s - len;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    return g;
  }
}

function flatMesh(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, order: number, opts: { opacity?: number; lit?: boolean } = {}): THREE.Mesh {
  const mat = opts.lit === false
    ? new THREE.MeshBasicMaterial({ color, depthWrite: false, transparent: opts.opacity != null, opacity: opts.opacity ?? 1 })
    : new THREE.MeshLambertMaterial({ color, depthWrite: false, transparent: opts.opacity != null, opacity: opts.opacity ?? 1 });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = order;
  m.receiveShadow = true;
  return m;
}

function shapeFrom(outer: XZ[], holes: XZ[][]): THREE.Shape {
  const s = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  return s;
}

export interface AirportScene {
  group: THREE.Group;
  nightGroup: THREE.Group;
  standLabels: THREE.Group;
  tower: THREE.Group;
  towerCab: THREE.Vector3;
  setNight(n: boolean): void;
}

export function buildAirportScene(layout: AirportLayout, graph: TaxiGraph): AirportScene {
  const group = new THREE.Group();
  const nightGroup = new THREE.Group();
  const standLabels = new THREE.Group();
  group.add(nightGroup, standLabels);

  // ---------- pavement ----------
  const aprons = layout.polys.filter((p) => p.kind === 'apron' || p.kind === 'helipad');
  if (aprons.length) {
    const geos = aprons.map((p) => new THREE.ShapeGeometry(shapeFrom(p.outer, p.holes)).rotateX(-Math.PI / 2));
    group.add(flatMesh(mergeGeometries(geos), 0x8d9096, -9));
  }
  const taxi = new FlatBatch(0.05);
  const taxiLine = new FlatBatch(0.12);
  const standLine = new FlatBatch(0.12);
  const holdBars = new FlatBatch(0.14);
  for (const ln of layout.lines) {
    if (ln.kind === 'taxiway' || ln.kind === 'taxilane') {
      taxi.polyline(ln.pts, ln.width);
      taxiLine.polyline(ln.pts, ln.kind === 'taxiway' ? 0.6 : 0.4, false);
    } else if (ln.kind === 'parking') {
      standLine.polyline(ln.pts, 0.45, false);
    } else if (ln.kind === 'holding_position') {
      holdBars.polyline(ln.pts, 1.6, false);
    } else if (ln.kind === 'stopway') {
      taxi.polyline(ln.pts, ln.width);
    }
  }
  for (const p of layout.holdingNodes) holdBars.disc(p, 1.5, 6);
  // Point-mapped stands only have their lead-in in the graph.
  for (const s of graph.stands) {
    if (s.leadIn.length === 2) standLine.polyline(s.leadIn, 0.45, false);
    const f = headingVec(s.parkHeading);
    standLine.rect({ x: s.stop.p.x + f.x * 2, z: s.stop.p.z + f.z * 2 }, s.parkHeading + 90, 6, 0.6);
  }
  group.add(flatMesh(taxi.build(), 0x6b6e73, -8));
  group.add(flatMesh(taxiLine.build(), 0xe8b923, -6, { lit: false }));
  group.add(flatMesh(standLine.build(), 0xf0c419, -6, { lit: false }));
  group.add(flatMesh(holdBars.build(), 0xf3c11b, -5, { lit: false }));

  // ---------- runways ----------
  const rwy = new FlatBatch(0.08);
  const white = new FlatBatch(0.16);
  for (const r of layout.runways) {
    rwy.polyline(r.pts, r.width, true);
    runwayMarkings(r, white);
    group.add(...runwayDesignators(r));
  }
  group.add(flatMesh(rwy.build(), 0x3a3c40, -7));
  group.add(flatMesh(white.build(), 0xf4f4f0, -5, { lit: false }));

  // ---------- buildings ----------
  // Walls carry a facade texture in real metres (glazed curtain wall, metal cladding or
  // windowed concrete); roofs are separate, flat and lighter.
  const walls: Record<BuildingKind, THREE.BufferGeometry[]> = { terminal: [], hangar: [], building: [] };
  const roofs: Record<BuildingKind, THREE.BufferGeometry[]> = { terminal: [], hangar: [], building: [] };
  for (const p of layout.polys) {
    if (p.kind === 'apron' || p.kind === 'helipad') continue;
    try {
      walls[p.kind].push(buildingWalls(p, FACADES[p.kind]));
      roofs[p.kind].push(buildingRoof(p));
    } catch { /* degenerate footprint */ }
  }
  const facades = facadeMaterials();
  for (const k of BUILDING_KINDS) {
    if (walls[k].length) {
      const m = new THREE.Mesh(mergeGeometries(walls[k]), facades.walls[k]);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    if (roofs[k].length) {
      const m = new THREE.Mesh(mergeGeometries(roofs[k]), facades.roofs[k]);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------- jet bridges ----------
  // Fixed links from the building are simple boxes; the movable apron-drive bridge out to the
  // aircraft is a model (rotunda, telescoping tunnel, wheel bogie, cab), boxes until it loads.
  const fixed: THREE.BufferGeometry[] = [];
  const movable: { from: XZ; to: XZ }[] = [];
  const bridgeBox = (a: XZ, b: XZ, into: THREE.BufferGeometry[]) => {
    const len = dist(a, b);
    if (len < 0.5) return;
    const g = new THREE.BoxGeometry(3.2, 3.2, len);
    g.rotateY(Math.atan2(b.x - a.x, b.z - a.z));
    g.translate((a.x + b.x) / 2, 4.6, (a.z + b.z) / 2);
    into.push(g);
  };
  const buildings = layout.polys.filter((p) => p.kind === 'terminal' || p.kind === 'building' || p.kind === 'hangar');
  for (const ln of layout.lines) {
    if (ln.kind !== 'jet_bridge' || ln.pts.length < 2) continue;
    // mappers draw them either way: the aircraft end is the one away from the buildings
    const pts = distToBuildings(ln.pts[0], buildings) <= distToBuildings(ln.pts[ln.pts.length - 1], buildings) ? ln.pts : ln.pts.slice().reverse();
    for (let i = 1; i < pts.length - 1; i++) bridgeBox(pts[i - 1], pts[i], fixed);
    const from = pts[pts.length - 2], to = pts[pts.length - 1];
    if (dist(from, to) >= 0.5) movable.push({ from, to });
  }
  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.5, metalness: 0.3 });
  if (fixed.length) {
    const m = new THREE.Mesh(mergeGeometries(fixed.map((g) => g.index ? g.toNonIndexed() : g)), bridgeMat);
    m.castShadow = true;
    group.add(m);
  }
  if (movable.length) {
    const stand = movable.map(({ from, to }) => { const g: THREE.BufferGeometry[] = []; bridgeBox(from, to, g); return g[0]; }).filter(Boolean);
    const placeholder = new THREE.Mesh(mergeGeometries(stand.map((g) => g.index ? g.toNonIndexed() : g)), bridgeMat);
    placeholder.castShadow = true;
    group.add(placeholder);
    void jetBridgeModels(movable).then((models) => {
      if (!models) return;
      group.remove(placeholder);
      group.add(models);
    });
  }

  // ---------- control tower ----------
  const t = layout.tower!;
  const tower = buildTower(t.height);
  tower.position.set(t.pos.x, 0, t.pos.z);
  group.add(tower);
  const towerCab = new THREE.Vector3(t.pos.x, t.height - 3, t.pos.z);

  // ---------- stand labels ----------
  for (const s of graph.stands) {
    // label at the taxilane end of the lead-in, where a pilot would read the stand sign
    const sp = textSprite(s.ref, '#ffd84a', 'rgba(10,14,22,0.75)');
    const a = s.leadIn[0], b = s.leadIn[Math.min(1, s.leadIn.length - 1)];
    const d = Math.max(1, dist(a, b));
    const k = Math.min(18, d) / d;
    sp.position.set(a.x + (b.x - a.x) * k, 3, a.z + (b.z - a.z) * k);
    sp.scale.set(10, 5, 1);
    standLabels.add(sp);
  }

  // ---------- lights (night) ----------
  buildLights(layout, nightGroup);
  nightGroup.visible = false;

  return {
    group, nightGroup, standLabels, tower, towerCab,
    setNight(n: boolean) {
      nightGroup.visible = n;
      // lit interiors show through the glass only (the emissive map is the window mask)
      for (const k of BUILDING_KINDS) facades.walls[k].emissive.set(n ? 0x5c4a30 : 0x000000);
    },
  };
}

/** Shortest distance from p to any building outline (0 inside one). */
function distToBuildings(p: XZ, polys: PolyFeature[]): number {
  let best = Infinity;
  for (const poly of polys) {
    const ring = poly.outer;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z));
    }
    if (inside) return 0;
  }
  return best;
}

/** Model length of the CC0 jet bridge (3DAssets.dev), rotunda at -z, cab at +z. */
const JET_BRIDGE_LENGTH = 21.91;

/**
 * One instanced mesh per part of the jet bridge model, an instance per bridge: rotunda end at
 * `from`, cab at `to`, stretched along its length to fit (within limits). Null if it won't load.
 */
async function jetBridgeModels(bridges: { from: XZ; to: XZ }[]): Promise<THREE.Group | null> {
  let scene: THREE.Group;
  try {
    scene = (await new GLTFLoader().loadAsync('/models/terminal/jet-bridge.glb')).scene;
  } catch {
    return null;
  }
  scene.updateMatrixWorld(true);
  const place = bridges.map(({ from, to }) => {
    const len = dist(from, to);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((from.x + to.x) / 2, 0, (from.z + to.z) / 2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(to.x - from.x, to.z - from.z)),
      new THREE.Vector3(1, 1, Math.min(1.8, Math.max(0.6, len / JET_BRIDGE_LENGTH))),
    );
    return m;
  });
  const out = new THREE.Group();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // bake the part's own transform into its geometry, then place one copy per bridge
    // (the file is quantised: normalised integers can't hold baked metres, so go to floats)
    const geo = o.geometry.clone();
    for (const name of ['position', 'normal']) {
      const a = geo.getAttribute(name);
      if (!a || a.array instanceof Float32Array) continue;
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
    }
    geo.applyMatrix4(o.matrixWorld);
    const inst = new THREE.InstancedMesh(geo, o.material, place.length);
    place.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.castShadow = true;
    out.add(inst);
  });
  return out;
}

type BuildingKind = 'terminal' | 'hangar' | 'building';
const BUILDING_KINDS: BuildingKind[] = ['terminal', 'hangar', 'building'];

/** Size in metres of one repeat of each facade texture (one bay wide, one storey high). */
const FACADES: Record<BuildingKind, { w: number; h: number }> = {
  terminal: { w: 3, h: 6 },
  hangar: { w: 6, h: 25 },
  building: { w: 3, h: 3.6 },
};

/** Vertical walls of a footprint (outer ring and courtyards), with UVs in facade repeats. */
function buildingWalls(p: PolyFeature, tile: { w: number; h: number }): THREE.BufferGeometry {
  const y0 = p.minHeight, y1 = Math.max(p.minHeight + 3, p.height);
  const pos: number[] = [], uv: number[] = [];
  for (const ring of [p.outer, ...p.holes]) {
    let along = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = dist(a, b);
      if (len < 0.05) continue;
      // whole bays per wall, so mullions meet the corners
      const u0 = Math.round(along / tile.w), u1 = u0 + Math.max(1, Math.round(len / tile.w));
      along += len;
      const v0 = y0 / tile.h, v1 = y1 / tile.h;
      pos.push(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function buildingRoof(p: PolyFeature): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeFrom(p.outer, p.holes));
  g.rotateX(-Math.PI / 2);
  g.translate(0, Math.max(p.minHeight + 3, p.height), 0);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/** A repeating facade texture drawn on a canvas; `glass` marks what glows at night. */
function facadeTexture(px: { w: number; h: number }, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  draw(canvas.getContext('2d')!, px.w, px.h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function facadeMaterials() {
  // terminal: floor-to-ceiling glazing between mullions, a spandrel panel at each floor slab
  const termDraw = (glow: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    const slab = h * 0.14;
    if (glow) {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff';
      c.fillRect(3, 0, w - 6, h - slab);
      return;
    }
    const g = c.createLinearGradient(0, 0, 0, h - slab);
    g.addColorStop(0, '#8fb0c9');
    g.addColorStop(1, '#46657f');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#d5dade';
    c.fillRect(0, h - slab, w, slab);
    c.fillStyle = '#2f353c';
    c.fillRect(0, 0, 3, h);
    c.fillRect(w - 3, 0, 3, h);
    c.fillRect(0, h * 0.42, w, 2);
  };
  // hangar: vertical ribbed metal cladding with a darker band of door panels at the bottom
  const hangarDraw = (c: CanvasRenderingContext2D, w: number, h: number) => {
    c.fillStyle = '#cfd3d7';
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      c.fillStyle = '#b4b9bf';
      c.fillRect(x, 0, 3, h);
    }
    c.fillStyle = 'rgba(70, 80, 92, 0.35)';
    c.fillRect(0, h * 0.45, w, h * 0.55);
    c.fillStyle = '#8b939b';
    c.fillRect(0, h * 0.45, w, 3);
  };
  // other buildings: concrete panels with a strip of windows on each storey
  const buildingDraw = (glow: boolean) => (c: CanvasRenderingContext2D, w: number, h: number) => {
    const win = { x: w * 0.12, y: h * 0.28, w: w * 0.76, h: h * 0.42 };
    c.fillStyle = glow ? '#000' : '#cdc6bb';
    c.fillRect(0, 0, w, h);
    c.fillStyle = glow ? '#fff' : '#3d4a56';
    c.fillRect(win.x, win.y, win.w, win.h);
    if (!glow) {
      c.fillStyle = '#b9b2a7';
      c.fillRect(0, h - 3, w, 3);
    }
  };
  const tile = { w: 64, h: 96 };
  const walls: Record<BuildingKind, THREE.MeshStandardMaterial> = {
    terminal: new THREE.MeshStandardMaterial({
      map: facadeTexture(tile, termDraw(false)), emissiveMap: facadeTexture(tile, termDraw(true)),
      roughness: 0.25, metalness: 0.35, side: THREE.DoubleSide,
    }),
    hangar: new THREE.MeshStandardMaterial({ map: facadeTexture({ w: 64, h: 256 }, hangarDraw), roughness: 0.55, metalness: 0.3, side: THREE.DoubleSide }),
    building: new THREE.MeshStandardMaterial({
      map: facadeTexture(tile, buildingDraw(false)), emissiveMap: facadeTexture(tile, buildingDraw(true)),
      roughness: 0.85, side: THREE.DoubleSide,
    }),
  };
  walls.hangar.emissiveMap = facadeTexture({ w: 4, h: 4 }, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); });
  for (const k of BUILDING_KINDS) walls[k].map!.colorSpace = THREE.SRGBColorSpace;
  const roofs: Record<BuildingKind, THREE.MeshStandardMaterial> = {
    terminal: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.7, metalness: 0.15 }),
    hangar: new THREE.MeshStandardMaterial({ color: 0xc4c9ce, roughness: 0.5, metalness: 0.35 }),
    building: new THREE.MeshStandardMaterial({ color: 0xa9a49c, roughness: 0.9 }),
  };
  return { walls, roofs };
}

function runwayMarkings(r: Runway, b: FlatBatch) {
  const w = r.width;
  // edge lines
  for (const side of [-1, 1]) {
    const off = side * (w / 2 - 1.2);
    const pts = r.pts.map((p, i) => {
      const a = r.pts[Math.max(0, i - 1)], c = r.pts[Math.min(r.pts.length - 1, i + 1)];
      const len = dist(a, c) || 1;
      return { x: p.x + (-(c.z - a.z) / len) * off, z: p.z + ((c.x - a.x) / len) * off };
    });
    b.polyline(pts, 0.9, false);
  }
  for (const end of r.ends) {
    const f = headingVec(end.heading);
    const rt = { x: -f.z, z: f.x };
    const at = (s: number, l = 0) => ({ x: end.threshold.x + f.x * s + rt.x * l, z: end.threshold.z + f.z * s + rt.z * l });
    // threshold piano keys
    const keys = w >= 45 ? 8 : w >= 30 ? 6 : 4;
    const spacing = (w - 6) / (keys * 2);
    for (let k = 0; k < keys; k++) {
      const lat = 1.8 + spacing * (k + 0.5);
      b.rect(at(21, lat), end.heading, 30, spacing * 0.8);
      b.rect(at(21, -lat), end.heading, 30, spacing * 0.8);
    }
    b.rect(at(3), end.heading + 90, w - 2, 1.8);
    // aiming point
    b.rect(at(400, w * 0.22), end.heading, 50, w >= 45 ? 9 : 6);
    b.rect(at(400, -w * 0.22), end.heading, 50, w >= 45 ? 9 : 6);
    // touchdown zone bars
    for (const [s, n] of [[150, 3], [300, 2], [550, 2], [700, 1], [850, 1]] as const) {
      if (s > r.length / 2 - 100) break;
      for (let k = 0; k < n; k++) {
        const lat = w * 0.17 + k * 3;
        b.rect(at(s, lat), end.heading, 22, 1.8);
        b.rect(at(s, -lat), end.heading, 22, 1.8);
      }
    }
  }
  // centreline (between designators)
  const e0 = r.ends[0];
  const f = headingVec(e0.heading);
  const start = 110, stop = r.length - 110;
  const cl: XZ[] = [];
  for (let s = start; s <= stop; s += 60) {
    cl.push({ x: e0.threshold.x + f.x * s, z: e0.threshold.z + f.z * s });
  }
  // follow the actual polyline for bent runways by snapping to it
  b.dashed(cl.length > 1 ? cl : r.pts, 0.9, 30, 20);
}

function runwayDesignators(r: Runway): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const end of r.ends) {
    const m = /^(\d{1,2})([LRC]?)/.exec(end.name);
    if (!m) continue;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f4f0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 220px Arial Narrow, Arial, sans-serif';
    g.fillText(m[1].padStart(2, '0'), 128, m[2] ? 150 : 256);
    if (m[2]) g.fillText(m[2], 128, 390);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const across = Math.min(r.width * 0.55, 26), along = across * 2;
    const geo = new THREE.PlaneGeometry(across, along).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const f = headingVec(end.heading);
    mesh.position.set(end.threshold.x + f.x * (60 + along / 2), 0.2, end.threshold.z + f.z * (60 + along / 2));
    mesh.rotation.y = headingToRotY(end.heading);
    mesh.renderOrder = -4;
    out.push(mesh);
  }
  return out;
}

function buildTower(height: number): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x4f7fa6, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.6 });
  const shaftH = height - 9;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 8, 16), concrete);
  base.position.y = 4;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, shaftH, 16), concrete);
  shaft.position.y = shaftH / 2;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 6, 3, 8), concrete);
  deck.position.y = shaftH + 1.5;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 8.5, 5, 8, 1, true), glass);
  cab.position.y = shaftH + 5.5;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(7, 10.2, 1.6, 8), dark);
  roof.position.y = shaftH + 8.8;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), dark);
  mast.position.y = shaftH + 14;
  const radar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 0.6), dark);
  radar.position.y = shaftH + 18.5;
  radar.name = 'radar';
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  beacon.position.y = shaftH + 19.2;
  for (const m of [base, shaft, deck, roof, mast]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(base, shaft, deck, cab, roof, mast, radar, beacon);
  return g;
}

function buildLights(layout: AirportLayout, into: THREE.Group) {
  const pts: { p: XZ; y: number; color: number }[] = [];
  for (const r of layout.runways) {
    const e = r.ends[0];
    const f = headingVec(e.heading);
    const rt = { x: -f.z, z: f.x };
    for (let s = 0; s <= r.length; s += 60) {
      for (const side of [-1, 1]) {
        const l = side * (r.width / 2 + 1.5);
        pts.push({ p: { x: e.threshold.x + f.x * s + rt.x * l, z: e.threshold.z + f.z * s + rt.z * l }, y: 0.6, color: s > r.length - 600 ? 0xffc04a : 0xfff6dc });
      }
    }
    for (const end of r.ends) {
      const ef = headingVec(end.heading), er = { x: -ef.z, z: ef.x };
      for (let l = -r.width / 2; l <= r.width / 2; l += 3) {
        pts.push({ p: { x: end.threshold.x + er.x * l, z: end.threshold.z + er.z * l }, y: 0.5, color: 0x3dff6a });
      }
      // approach lighting system: 900 m with cross bars
      for (let s = 30; s <= 900; s += 30) {
        const bar = s % 300 === 0 ? 15 : 4;
        for (let l = -bar; l <= bar; l += 1.5) {
          pts.push({ p: { x: end.threshold.x - ef.x * s + er.x * l, z: end.threshold.z - ef.z * s + er.z * l }, y: 1.5, color: 0xffffff });
        }
      }
    }
  }
  for (const ln of layout.lines) {
    if (ln.kind !== 'taxiway') continue;
    for (let i = 1; i < ln.pts.length; i++) {
      const a = ln.pts[i - 1], b = ln.pts[i];
      const len = dist(a, b);
      for (let s = 0; s < len; s += 30) {
        const t = s / len;
        pts.push({ p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, y: 0.3, color: 0x2bff5c });
      }
    }
  }
  const geo = new THREE.SphereGeometry(0.9, 6, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  pts.forEach((q, i) => {
    m.makeTranslation(q.p.x, q.y, q.p.z);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, c.set(q.color));
  });
  inst.frustumCulled = false;
  into.add(inst);
}

export function textSprite(text: string, color: string, bg: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 8, 120, 48, 10);
  g.fill();
  g.fillStyle = color;
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 33, 112);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: true }));
  return sp;
}
