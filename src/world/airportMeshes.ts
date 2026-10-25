import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  const byKind: Record<string, THREE.BufferGeometry[]> = { terminal: [], hangar: [], building: [] };
  for (const p of layout.polys) {
    if (p.kind === 'apron' || p.kind === 'helipad') continue;
    try {
      byKind[p.kind].push(extrude(p));
    } catch { /* degenerate footprint */ }
  }
  const buildingMats: Record<string, THREE.Material> = {
    terminal: new THREE.MeshStandardMaterial({ color: 0xa9bccb, roughness: 0.35, metalness: 0.35 }),
    hangar: new THREE.MeshStandardMaterial({ color: 0xd6d9dd, roughness: 0.6, metalness: 0.2 }),
    building: new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.85 }),
  };
  for (const k of Object.keys(byKind)) {
    if (!byKind[k].length) continue;
    const m = new THREE.Mesh(mergeGeometries(byKind[k]), buildingMats[k]);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------- jet bridges ----------
  const bridges: THREE.BufferGeometry[] = [];
  for (const ln of layout.lines) {
    if (ln.kind !== 'jet_bridge') continue;
    for (let i = 1; i < ln.pts.length; i++) {
      const a = ln.pts[i - 1], b = ln.pts[i];
      const len = dist(a, b);
      if (len < 0.5) continue;
      const g = new THREE.BoxGeometry(3.2, 3.2, len);
      g.rotateY(Math.atan2(b.x - a.x, b.z - a.z));
      g.translate((a.x + b.x) / 2, 4.6, (a.z + b.z) / 2);
      bridges.push(g);
      const leg = new THREE.CylinderGeometry(0.35, 0.35, 3, 6);
      leg.translate(b.x, 1.5, b.z);
      bridges.push(leg);
    }
  }
  if (bridges.length) {
    const m = new THREE.Mesh(mergeGeometries(bridges.map((g) => g.index ? g.toNonIndexed() : g)), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.4 }));
    m.castShadow = true;
    group.add(m);
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
      (buildingMats.terminal as THREE.MeshStandardMaterial).emissive.set(n ? 0x3a3020 : 0x000000);
    },
  };
}

function extrude(p: PolyFeature): THREE.BufferGeometry {
  const h = Math.max(3, p.height - p.minHeight);
  const g = new THREE.ExtrudeGeometry(shapeFrom(p.outer, p.holes), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, p.minHeight, 0);
  return g.index ? g.toNonIndexed() : g;
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
