// Local tangent-plane projection: x = east (m), z = south (m), y = up (m).
// Accurate to well under 0.5% within ~80 km of the origin, which is all we need.

export interface LatLon { lat: number; lon: number }
export interface XZ { x: number; z: number }

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;

export class Projection {
  readonly lat0: number;
  readonly lon0: number;
  private readonly kx: number;

  constructor(lat0: number, lon0: number) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    this.kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  }

  toXZ(lat: number, lon: number): XZ {
    return { x: (lon - this.lon0) * this.kx, z: -(lat - this.lat0) * M_PER_DEG_LAT };
  }

  toLatLon(x: number, z: number): LatLon {
    return { lat: this.lat0 - z / M_PER_DEG_LAT, lon: this.lon0 + x / this.kx };
  }
}

// --- small 2D vector helpers on the XZ plane ---

export const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

/** Compass heading in degrees (0 = north, 90 = east) of the vector a->b. */
export function headingOf(a: XZ, b: XZ): number {
  const h = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
  return (h + 360) % 360;
}

/** Unit vector for a compass heading. */
export function headingVec(hdg: number): XZ {
  const r = (hdg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** Signed smallest difference b - a in degrees, range (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = ((((b - a) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

/** Three.js rotation.y for an object whose nose points along -Z at rotation 0. */
export const headingToRotY = (hdg: number) => (-hdg * Math.PI) / 180;

export function lerpXZ(a: XZ, b: XZ, t: number): XZ {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Project p onto segment ab; returns t in [0,1], the closest point and its distance. */
export function projectOnSegment(p: XZ, a: XZ, b: XZ): { t: number; point: XZ; d: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + dx * t, z: a.z + dz * t };
  return { t, point, d: dist(p, point) };
}

export function pointInPolygon(p: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const NM = 1852; // m per nautical mile
