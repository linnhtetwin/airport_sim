import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TypeSpec } from '../data/aircraftTypes';
import { airlineColors } from '../data/airlines';

// All models face -Z (nose) with y = 0 at ground contact.

const matCache = new Map<string, THREE.Material>();
function mat(color: THREE.ColorRepresentation, opts: { metal?: number; rough?: number; emissive?: boolean } = {}): THREE.Material {
  const key = `${new THREE.Color(color).getHexString()}|${opts.metal ?? 0.25}|${opts.rough ?? 0.5}|${opts.emissive ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = opts.emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, metalness: opts.metal ?? 0.25, roughness: opts.rough ?? 0.5 });
    matCache.set(key, m);
  }
  return m;
}

function wingShape(halfSpan: number, root: number, tip: number, sweep: number, side: 1 | -1): THREE.Shape {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(side * halfSpan, sweep),
    new THREE.Vector2(side * halfSpan, sweep + tip),
    new THREE.Vector2(0, root),
  ];
  return new THREE.Shape(pts);
}

/** Wing-like flat surface lying in the XZ plane; leading edge root at origin, extending +z. */
function surface(halfSpan: number, root: number, tip: number, sweep: number, thick: number, side: 1 | -1, dihedralDeg: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(wingShape(halfSpan, root, tip, sweep, side), { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> -y
  g.translate(0, thick / 2, 0);
  g.rotateZ((side * dihedralDeg * Math.PI) / 180);
  return g;
}

interface ModelParts { geos: Map<THREE.Material, THREE.BufferGeometry[]>; }
function add(parts: ModelParts, m: THREE.Material, g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
  const list = parts.geos.get(m) ?? [];
  list.push(ng);
  parts.geos.set(m, list);
}

interface AircraftTemplate {
  meshes: { geo: THREE.BufferGeometry; mat: THREE.Material; gear: boolean }[];
  wingTipX: number;
  wingTipY: number;
  wingTipZ: number;
  topY: number;
  length: number;
}

const templates = new Map<string, AircraftTemplate>();
const aircraftAssetLoader = new GLTFLoader();
const aircraftAssetCache = new Map<string, Promise<THREE.Group | null>>();

function aircraftAsset(spec: TypeSpec): { name: string; yaw: number } | null {
  // These neutral models have their nose along +X after the GLB's own axis
  // normalization. A quarter turn points them along the simulator's -Z nose.
  if (/^B75/.test(spec.code)) return { name: 'B752', yaw: Math.PI / 2 };
  if (/^B76/.test(spec.code)) return { name: 'B763', yaw: Math.PI / 2 };
  if (/^(E170|E75L|E190|E195|E295)$/.test(spec.code)) return { name: 'E190', yaw: Math.PI / 2 };
  // Keep the built-in layout where the available assets have the wrong silhouette.
  if (/^(A34|B74)/.test(spec.code)) return null;
  if (spec.size === 'jumbo') return spec.code === 'A388' ? { name: 'A380', yaw: Math.PI / 2 } : null;
  if (spec.size === 'wide') {
    if (/^B78/.test(spec.code)) return { name: 'B787', yaw: Math.PI / 2 };
    if (/^B77/.test(spec.code)) return { name: 'B787', yaw: Math.PI / 2 };
    return { name: 'A350', yaw: Math.PI / 2 };
  }
  if (spec.size === 'narrow') return /^B73/.test(spec.code)
    ? { name: 'B737', yaw: Math.PI / 2 }
    : { name: 'A320', yaw: Math.PI / 2 };
  return null;
}

function loadAircraftAsset(name: string): Promise<THREE.Group | null> {
  let pending = aircraftAssetCache.get(name);
  if (!pending) {
    pending = new Promise((resolve) => {
      aircraftAssetLoader.load(`/models/${name}.glb`, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
    });
    aircraftAssetCache.set(name, pending);
  }
  return pending;
}

function prepareAircraftAsset(source: THREE.Group, spec: TypeSpec, yaw: number, airline: string | null): { model: THREE.Group; box: THREE.Box3; tips: THREE.Vector3[] } {
  const model = new THREE.Group();
  model.rotation.y = yaw;
  model.add(source.clone(true));
  const tint = airlineColors(airline).tail;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const recolor = (material: THREE.Material) => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      if (standard.map) {
        const liveryColor = new THREE.Color(tint);
        standard.onBeforeCompile = (shader) => {
          shader.uniforms.airlineLiveryColor = { value: liveryColor };
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 airlineLiveryColor;')
            .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            vec3 liverySample = diffuseColor.rgb;
            float liveryMax = max(max(liverySample.r, liverySample.g), liverySample.b);
            float liveryMin = min(min(liverySample.r, liverySample.g), liverySample.b);
            float liveryChroma = liveryMax - liveryMin;
            float liveryHue = 0.0;
            if (liveryChroma > 0.0001) {
              if (liveryMax == liverySample.r) liveryHue = mod((liverySample.g - liverySample.b) / liveryChroma, 6.0);
              else if (liveryMax == liverySample.g) liveryHue = (liverySample.b - liverySample.r) / liveryChroma + 2.0;
              else liveryHue = (liverySample.r - liverySample.g) / liveryChroma + 4.0;
              liveryHue /= 6.0;
              if (liveryHue < 0.0) liveryHue += 1.0;
            }
            float liverySaturation = liveryChroma / max(liveryMax, 0.0001);
            float liveryMask = smoothstep(0.22, 0.42, liverySaturation)
              * smoothstep(0.46, 0.52, liveryHue)
              * (1.0 - smoothstep(0.76, 0.82, liveryHue));
            diffuseColor.rgb = mix(diffuseColor.rgb, airlineLiveryColor, liveryMask * 0.92);`,
            );
        };
        standard.customProgramCacheKey = () => 'airport-airline-livery-v1';
        standard.needsUpdate = true;
      }
      else if (standard.name !== 'CAT neutral reference') standard.color.set(tint);
      return clone;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(recolor)
      : recolor(object.material);
  });
  model.updateMatrixWorld(true);
  const originalBox = new THREE.Box3().setFromObject(model);
  const originalSize = originalBox.getSize(new THREE.Vector3());
  const spanScale = spec.span / originalSize.x;
  const lengthScale = spec.length / originalSize.z;
  // Fit the E-Jet family's length and span independently. In particular, the
  // E175 is shorter than the E190 while its published wingspan is the same.
  if (/^(E170|E75L|E190|E195|E295)$/.test(spec.code)) model.scale.set(spanScale, Math.min(spanScale, lengthScale), lengthScale);
  else model.scale.setScalar(Math.min(spanScale, lengthScale));
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.updateMatrixWorld(true);
  const normalizedBox = new THREE.Box3().setFromObject(model);
  const maxX = normalizedBox.max.x;
  const tipBand = Math.max(0.15, spec.span * 0.008);
  const tipSums = [new THREE.Vector3(), new THREE.Vector3()];
  const tipCounts = [0, 0];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const side = point.x < 0 ? 0 : 1;
      const outerX = side === 0 ? normalizedBox.min.x : maxX;
      if (Math.abs(point.x - outerX) <= tipBand) {
        tipSums[side].add(point);
        tipCounts[side]++;
      }
    }
  });
  const tips = tipSums.map((sum, i) => tipCounts[i]
    ? sum.multiplyScalar(1 / tipCounts[i])
    : new THREE.Vector3(i === 0 ? normalizedBox.min.x : normalizedBox.max.x, spec.length * 0.1, spec.length * 0.04));
  return { model, box: normalizedBox, tips };
}

function buildTemplate(spec: TypeSpec, airline: string | null): AircraftTemplate {
  const L = spec.length, S = spec.span;
  const colors = airlineColors(airline);
  const body = mat(colors.body, { metal: 0.35, rough: 0.35 });
  const tail = mat(colors.tail, { metal: 0.2, rough: 0.45 });
  const accent = mat(colors.accent, { metal: 0.3, rough: 0.4 });
  const dark = mat(0x1d2127, { metal: 0.2, rough: 0.6 });
  const grey = mat(0xa7adb5, { metal: 0.5, rough: 0.4 });
  const parts: ModelParts = { geos: new Map() };
  const gearParts: ModelParts = { geos: new Map() };

  if (spec.size === 'heli') {
    const r = 1.2;
    const cab = new THREE.SphereGeometry(r * 1.4, 16, 12).scale(1, 1, 1.6).translate(0, 2.2, 0);
    add(parts, tail, cab);
    add(parts, tail, new THREE.CylinderGeometry(0.25, 0.45, 6, 8).rotateX(Math.PI / 2).translate(0, 2.6, 4.5));
    add(parts, dark, new THREE.CylinderGeometry(0.1, 0.1, 1, 6).translate(0, 3.9, 0));
    add(parts, dark, new THREE.BoxGeometry(S, 0.08, 0.35).translate(0, 4.4, 0));
    add(parts, dark, new THREE.BoxGeometry(0.35, 0.08, S).translate(0, 4.4, 0));
    add(parts, dark, new THREE.BoxGeometry(0.15, 1.4, 1.6).translate(0, 2.8, 7.4));
    add(parts, grey, new THREE.BoxGeometry(0.12, 0.12, 3.4).translate(0.9, 0.2, 0));
    add(parts, grey, new THREE.BoxGeometry(0.12, 0.12, 3.4).translate(-0.9, 0.2, 0));
    return finish(parts, gearParts, S / 2, 4.5, 0, 4.5, L);
  }

  const r = spec.size === 'light' ? 0.65 : spec.size === 'jumbo' ? L * 0.052 : L * 0.05;
  const gh = spec.size === 'light' ? 0.6 : r * 0.85; // ground clearance of fuselage bottom
  const yc = gh + r;
  const Lbody = L * 0.68;
  const zc = -0.04 * L;
  const zFront = zc - Lbody / 2, zBack = zc + Lbody / 2;

  // A continuous tapered fuselage avoids the stacked-cylinder/block silhouette.
  const noseLen = Math.min(L * 0.16, r * 2.8);
  const tailLen = Math.max(0.1, L / 2 - zBack);
  const fuselageProfile = [
    new THREE.Vector2(0.02 * r, -Lbody / 2 - noseLen),
    new THREE.Vector2(0.42 * r, -Lbody / 2 - noseLen * 0.72),
    new THREE.Vector2(0.82 * r, -Lbody / 2 - noseLen * 0.28),
    new THREE.Vector2(r, -Lbody / 2),
    new THREE.Vector2(r, Lbody / 2 - tailLen * 0.22),
    new THREE.Vector2(r * 0.72, Lbody / 2 + tailLen * 0.18),
    new THREE.Vector2(r * 0.22, Lbody / 2 + tailLen * 0.78),
    new THREE.Vector2(0.02 * r, Lbody / 2 + tailLen),
  ];
  add(parts, body, new THREE.LatheGeometry(fuselageProfile, 24).rotateX(Math.PI / 2).translate(0, yc, zc));
  // Small oval passenger windows sit flush with the curved cabin sides.
  const windowGeo = new THREE.SphereGeometry(Math.max(0.09, r * 0.09), 8, 6).scale(0.22, 0.7, 1);
  const windowCount = Math.max(5, Math.floor(Lbody / Math.max(1.2, r * 1.25)));
  for (const sx of [-1, 1]) for (let i = 0; i < windowCount; i++) {
    const z = zFront + Lbody * (0.12 + 0.76 * (i / Math.max(1, windowCount - 1)));
    add(parts, dark, windowGeo.clone().translate(sx * r * 0.96, yc + r * 0.28, z));
  }

  // wings
  const half = S / 2;
  const rootChord = spec.size === 'light' ? 1.5 : L * 0.2;
  const sweepDeg = spec.size === 'light' || spec.size === 'regional' && /AT|DH/.test(spec.code) ? 2 : 27;
  const sweep = Math.tan((sweepDeg * Math.PI) / 180) * half;
  const highWing = spec.size === 'light' || /AT76|DH8D/.test(spec.code);
  const wingY = highWing ? yc + r * 0.85 : yc - r * 0.55;
  const wingZ = highWing ? zc - rootChord * 0.3 : -0.1 * L;
  const tipChord = rootChord * 0.28;
  const thick = Math.max(0.25, r * 0.16);
  for (const side of [1, -1] as const) {
    add(parts, grey, surface(half, rootChord, tipChord, sweep, thick, side, highWing ? 1 : 5).translate(0, wingY, wingZ));
    // winglet
    if (!highWing) {
      const tipX = side * half, tipZ = wingZ + sweep;
      const dih = Math.tan((5 * Math.PI) / 180) * half;
      add(parts, tail, new THREE.BoxGeometry(0.15, r * 0.9, tipChord * 0.8).translate(tipX, wingY + dih + r * 0.45, tipZ + tipChord * 0.4));
    }
    // horizontal stabiliser
    const hsHalf = S * (spec.size === 'light' ? 0.2 : 0.17);
    add(parts, grey, surface(hsHalf, L * 0.1, L * 0.04, Math.tan(0.55) * hsHalf, thick * 0.7, side, 3).translate(0, yc + r * 0.35, L * 0.355));
  }

  // vertical fin (shape in z/y plane)
  const finH = spec.size === 'light' ? 1.6 : r * (spec.size === 'jumbo' ? 2.8 : 3.0);
  const finRoot = L * 0.16, finTip = L * 0.065;
  const fin = new THREE.Shape([
    new THREE.Vector2(0, 0), new THREE.Vector2(finRoot, 0),
    new THREE.Vector2(finRoot * 1.02, finH), new THREE.Vector2(finRoot * 1.02 - finTip, finH),
  ]);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: Math.max(0.3, r * 0.14), bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  finGeo.translate(Math.max(0.3, r * 0.14) / 2, yc + r * 0.55, L * 0.5 - finRoot * 1.05);
  add(parts, tail, finGeo);

  // engines
  if (spec.size !== 'light') {
    const re = r * (spec.size === 'jumbo' ? 0.38 : 0.5);
    const le = r * (spec.size === 'regional' ? 1.4 : 2.0);
    const stations = spec.tailEngines ? [] : spec.engines === 4 ? [0.36, 0.64] : [0.34];
    const mkEngine = (x: number, y: number, z: number) => {
      add(parts, accent, new THREE.CylinderGeometry(re, re * 0.85, le, 18).rotateX(Math.PI / 2).translate(x, y, z));
      add(parts, dark, new THREE.CircleGeometry(re * 0.88, 18).rotateY(Math.PI).translate(x, y, z - le / 2 - 0.02));
      add(parts, grey, new THREE.ConeGeometry(re * 0.45, le * 0.3, 12).rotateX(Math.PI / 2).translate(x, y, z + le / 2 + le * 0.12));
    };
    for (const st of stations) {
      for (const side of [1, -1]) {
        const x = side * half * st;
        const zLead = wingZ + Math.tan((sweepDeg * Math.PI) / 180) * half * st;
        const y = highWing ? wingY - re * 0.2 : wingY - re * 1.05;
        mkEngine(x, y, zLead - le * 0.35);
        if (!highWing) add(parts, grey, new THREE.BoxGeometry(re * 0.25, re * 0.8, le * 0.8).translate(x, wingY - re * 0.3, zLead));
      }
    }
    if (spec.tailEngines) for (const side of [1, -1]) mkEngine(side * (r + re * 1.1), yc + r * 0.35, L * 0.27);
  } else {
    add(parts, dark, new THREE.BoxGeometry(0.1, 1.8, 0.15).translate(0, yc, zFront - 0.12 * L - 0.1));
  }

  // landing gear (separate so it can retract)
  const wheelR = spec.size === 'light' ? 0.25 : Math.max(0.45, r * 0.3);
  const strut = (x: number, z: number, wheels: number) => {
    add(gearParts, grey, new THREE.CylinderGeometry(0.12 * Math.max(1, r / 2), 0.12 * Math.max(1, r / 2), gh, 6).translate(x, gh / 2 + wheelR * 0.5, z));
    for (let k = 0; k < wheels; k++) {
      const dz = (k - (wheels - 1) / 2) * wheelR * 2.3;
      add(gearParts, dark, new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 0.9, 10).rotateZ(Math.PI / 2).translate(x, wheelR, z + dz));
    }
  };
  strut(0, zFront - 0.04 * L, 1);
  const mainWheels = spec.size === 'jumbo' || spec.size === 'wide' ? 2 : 1;
  const mainX = spec.size === 'light' ? 1.2 : r * 0.75;
  strut(mainX, wingZ + rootChord * 0.65, mainWheels);
  strut(-mainX, wingZ + rootChord * 0.65, mainWheels);
  if (spec.size === 'jumbo') { strut(r * 0.35, wingZ + rootChord * 0.9, 2); strut(-r * 0.35, wingZ + rootChord * 0.9, 2); }

  const dih = Math.sin(((highWing ? 1 : 5) * Math.PI) / 180) * half;
  return finish(parts, gearParts, half, wingY + dih, wingZ + sweep + tipChord * 0.5, yc + r + (wingY - yc) + dih, L);
}

function finish(parts: ModelParts, gearParts: ModelParts, wingTipX: number, wingTipY: number, wingTipZ: number, topY: number, length: number): AircraftTemplate {
  const meshes: AircraftTemplate['meshes'] = [];
  for (const [m, list] of parts.geos) meshes.push({ geo: mergeGeometries(list), mat: m, gear: false });
  for (const [m, list] of gearParts.geos) meshes.push({ geo: mergeGeometries(list), mat: m, gear: true });
  return { meshes, wingTipX, wingTipY, wingTipZ, topY, length };
}

export interface AircraftModel {
  root: THREE.Group;
  /** Child holding the airframe, used for pitch/roll. */
  body: THREE.Group;
  gear: THREE.Object3D[];
  beacon: THREE.Mesh;
  strobes: THREE.Mesh[];
  navLights: THREE.Mesh[];
  length: number;
}

const lightGeo = new THREE.SphereGeometry(0.35, 6, 4);

export function buildAircraft(spec: TypeSpec, airline: string | null): AircraftModel {
  const key = `${spec.code}|${airline ?? ''}`;
  let t = templates.get(key);
  if (!t) { t = buildTemplate(spec, airline); templates.set(key, t); }
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fallbackAirframe = new THREE.Group();
  const fallbackGear = new THREE.Group();
  body.add(fallbackAirframe, fallbackGear);
  const gear: THREE.Object3D[] = [];
  for (const m of t.meshes) {
    const mesh = new THREE.Mesh(m.geo, m.mat);
    mesh.castShadow = true;
    (m.gear ? fallbackGear : fallbackAirframe).add(mesh);
    if (m.gear) gear.push(mesh);
  }
  const red = mat(0xff2a2a, { emissive: true }), green = mat(0x2aff5a, { emissive: true }), white = mat(0xffffff, { emissive: true });
  const yTip = t.wingTipY + 0.12;
  const navL = new THREE.Mesh(lightGeo, red); navL.position.set(-t.wingTipX, yTip, t.wingTipZ);
  const navR = new THREE.Mesh(lightGeo, green); navR.position.set(t.wingTipX, yTip, t.wingTipZ);
  const strobeZ = t.wingTipZ + Math.max(0.15, spec.length * 0.006);
  const sL = new THREE.Mesh(lightGeo, white); sL.position.set(-t.wingTipX, yTip, strobeZ);
  const sR = new THREE.Mesh(lightGeo, white); sR.position.set(t.wingTipX, yTip, strobeZ);
  const beacon = new THREE.Mesh(lightGeo, red);
  beacon.position.set(0, t.topY + 0.2, 0);
  beacon.scale.setScalar(1.3);
  body.add(navL, navR, sL, sR, beacon);
  const asset = aircraftAsset(spec);
  if (asset) {
    loadAircraftAsset(asset.name).then((source) => {
      if (!source) return;
      const prepared = prepareAircraftAsset(source, spec, asset.yaw, airline);
      body.add(prepared.model);
      fallbackAirframe.visible = false;
      fallbackGear.visible = false;
      gear.length = 0;
      for (let i = 0; i < prepared.tips.length; i++) {
        const tip = prepared.tips[i];
        const nav = i === 0 ? navL : navR;
        const strobe = i === 0 ? sL : sR;
        nav.position.set(tip.x, tip.y + 0.18, tip.z);
        strobe.position.set(tip.x, tip.y + 0.28, tip.z + 0.3);
      }
      beacon.position.set(0, Math.min(7, spec.length * 0.12) + 0.2, 0);
    });
  }
  return { root, body, gear, beacon, strobes: [sL, sR], navLights: [navL, navR], length: t.length };
}

// ---------------- ground vehicles ----------------

export type VehicleKind = 'fuel' | 'catering' | 'baggage' | 'cleaning' | 'tug' | 'followme' | 'fire';

const vehicleAssetLoader = new GLTFLoader();
const vehicleAssetCache = new Map<string, Promise<THREE.Group | null>>();
const vehicleAssetFiles: Partial<Record<VehicleKind, string>> = {
  fuel: 'fuel-bowser', catering: 'catering-truck', cleaning: 'lavatory-service-truck', tug: 'pushback-tug',
};

function loadVehicleAsset(name: string): Promise<THREE.Group | null> {
  let pending = vehicleAssetCache.get(name);
  if (!pending) {
    pending = new Promise((resolve) => {
      vehicleAssetLoader.load(`/models/vehicles/${name}.glb`, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
    });
    vehicleAssetCache.set(name, pending);
  }
  return pending;
}

function fitVehicleAsset(source: THREE.Group, maxWidth: number, maxLength: number): THREE.Group {
  const model = source.clone(true);
  // These assets face +Z; the sim's vehicle convention is nose toward -Z.
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = Math.min(maxWidth / size.x, maxLength / size.z);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -fitted.min.y, -center.z);
  model.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return model;
}

export function buildVehicle(kind: VehicleKind): THREE.Group {
  const g = new THREE.Group();
  const fallback = new THREE.Group();
  const box = (w: number, h: number, l: number, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0) => {
    const radius = Math.min(w, h, l) * 0.12;
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 2, radius), mat(color, { metal: 0.2, rough: 0.6 }));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const wheels = (w: number, l: number, r = 0.45) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 10).rotateZ(Math.PI / 2), mat(0x15171a));
      m.position.set((sx * w) / 2, r, (sz * l) / 2.6);
      g.add(m);
    }
  };
  const flasher = (color: number, y: number, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.35), mat(color, { emissive: true }));
    m.position.set(0, y, z);
    m.name = 'flasher';
    g.add(m);
  };
  switch (kind) {
    case 'fuel':
      box(2.5, 2.2, 2.4, 0xf2f2f2, 0, 0.5, -3.6);
      {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 6, 14).rotateX(Math.PI / 2), mat(0xe6e8ea, { metal: 0.6, rough: 0.3 }));
        tank.position.set(0, 2.0, 1.2);
        tank.castShadow = true;
        g.add(tank);
      }
      box(2.6, 0.25, 6.4, 0xd62828, 0, 0.6, 1.2);
      wheels(2.4, 9);
      flasher(0xffa500, 2.95, -3.6);
      break;
    case 'catering':
      box(2.4, 2.0, 2.2, 0xffffff, 0, 0.5, -3.2);
      box(2.5, 2.8, 5.2, 0xf4f4f4, 0, 2.4, 0.8);
      box(2.6, 0.3, 5.4, 0x2b6cb0, 0, 2.1, 0.8);
      wheels(2.3, 8);
      flasher(0xffa500, 2.7, -3.2);
      break;
    case 'baggage':
      box(1.6, 1.2, 2.2, 0xf2c200, 0, 0.4, -4);
      for (let i = 0; i < 3; i++) {
        box(1.7, 1.4, 2.4, 0x6b7280, 0, 0.45, -0.8 + i * 3);
        box(1.75, 0.15, 2.45, 0x374151, 0, 1.85, -0.8 + i * 3);
      }
      wheels(1.5, 10, 0.3);
      flasher(0xffa500, 1.75, -4);
      break;
    case 'cleaning':
      box(2.0, 2.2, 4.6, 0x2f855a, 0, 0.4, 0);
      box(2.05, 0.6, 1.5, 0x1a202c, 0, 1.6, -1.6);
      wheels(1.9, 6, 0.4);
      flasher(0xffa500, 2.75, -1);
      break;
    case 'tug':
      box(3.0, 1.1, 5.0, 0xf2c200, 0, 0.35, 0);
      box(1.8, 1.0, 1.4, 0x1f2937, 0, 1.45, 1.3);
      wheels(2.9, 7, 0.55);
      flasher(0xffa500, 2.6, 1.3);
      break;
    case 'followme': {
      box(1.9, 0.9, 4.4, 0xf6d32d, 0, 0.35, 0);
      box(1.7, 0.6, 2.2, 0xf6d32d, 0, 1.25, 0.3);
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const x = c.getContext('2d')!;
      for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#111' : '#f6d32d'; x.fillRect(i * 16, 0, 16, 10); }
      x.fillStyle = '#111'; x.fillRect(0, 10, 256, 54);
      x.fillStyle = '#ffe14d'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.fillText('FOLLOW ME', 128, 50);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      sign.position.set(0, 2.15, 0.6);
      g.add(sign);
      wheels(1.8, 6, 0.38);
      flasher(0xffa500, 1.95, -0.2);
      break;
    }
    case 'fire':
      box(2.8, 2.4, 3, 0xd61f1f, 0, 0.6, -3.8);
      box(2.9, 3.0, 7.5, 0xe02424, 0, 0.6, 1.4);
      box(0.4, 0.4, 2.5, 0xdddddd, 0, 3.6, -1.6);
      wheels(2.7, 11, 0.65);
      flasher(0x2b6cff, 3.25, -3.8);
      break;
  }
  // Keep the existing procedural model as a resilient first-frame and load-error fallback.
  for (const child of [...g.children]) fallback.add(child);
  g.add(fallback);
  const assetName = vehicleAssetFiles[kind];
  if (assetName) {
    loadVehicleAsset(assetName).then((source) => {
      if (!source) return;
      const model = fitVehicleAsset(source, kind === 'tug' ? 3.1 : 2.8, kind === 'catering' ? 9 : kind === 'fuel' ? 9 : kind === 'cleaning' ? 7 : 6);
      g.add(model);
      fallback.visible = false;
      const bounds = new THREE.Box3().setFromObject(model);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.24), mat(0xffa500, { emissive: true }));
      beacon.position.set(0, Math.max(1.8, bounds.max.y - 0.12), 0);
      beacon.name = 'flasher';
      g.add(beacon);
    });
  } else if (kind === 'baggage') {
    Promise.all([loadVehicleAsset('baggage-tug'), loadVehicleAsset('baggage-cart')]).then(([tug, cart]) => {
      if (!tug || !cart) return;
      const train = new THREE.Group();
      const tractor = fitVehicleAsset(tug, 1.9, 3.2);
      tractor.position.z = -3.1;
      train.add(tractor);
      const trailer = fitVehicleAsset(cart, 2.3, 3.1);
      for (const z of [0.8, 4.3, 7.8]) {
        const item = trailer.clone(true);
        item.position.z += z;
        train.add(item);
      }
      g.add(train);
      fallback.visible = false;
      const bounds = new THREE.Box3().setFromObject(train);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.24), mat(0xffa500, { emissive: true }));
      beacon.position.set(0, Math.max(1.8, bounds.max.y - 0.12), -3.1);
      beacon.name = 'flasher';
      g.add(beacon);
    });
  }
  return g;
}

// ---------------- marshaller ----------------

export interface MarshallerModel { root: THREE.Group; armL: THREE.Group; armR: THREE.Group }

export function buildMarshaller(): MarshallerModel {
  const root = new THREE.Group();
  const vest = mat(0xff7a00), skin = mat(0xc69c7a), dark = mat(0x1f2933), wand = mat(0xff5a00, { emissive: true });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.9, 0.25), dark);
  legs.position.y = 0.45;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), vest);
  torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skin);
  head.position.y = 1.78;
  const muffs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.12), dark);
  muffs.position.y = 1.8;
  root.add(legs, torso, head, muffs);
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.33, 1.55, 0);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), vest);
    a.position.y = -0.31;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), wand);
    w.position.y = -0.82;
    pivot.add(a, w);
    root.add(pivot);
    return pivot;
  };
  const armL = arm(-1), armR = arm(1);
  for (const o of [legs, torso, head]) o.castShadow = true;
  root.scale.setScalar(1.6); // keep the figure readable from the tower
  return { root, armL, armR };
}
