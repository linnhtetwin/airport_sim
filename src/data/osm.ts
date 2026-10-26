import { Projection, type XZ, type LatLon, headingOf, dist, pointInPolygon } from '../geo/projection';
import { cacheGet, cacheSet } from './cache';
import { syntheticAirport } from './synthetic';
import { AIRPORTS } from './airports';
import { LAYOUT_VERSION, LayoutNotFound, OVERPASS_MIRRORS, aerodromeCenter, isLayoutFile, layoutQuery, lookupQuery, usableElements } from './airportSource';

// ---------- raw Overpass types ----------

interface OsmLatLon { lat: number; lon: number }
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: OsmLatLon;
  nodes?: number[];
  geometry?: (OsmLatLon | null)[];
  members?: { type: string; ref: number; role: string; geometry?: (OsmLatLon | null)[] }[];
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

// ---------- parsed layout ----------

export interface RunwayEnd {
  name: string; // "31L"
  threshold: XZ;
  heading: number; // direction of travel when landing/departing from this end
  runway: Runway;
}

export interface Runway {
  id: string;
  ref: string;
  width: number;
  length: number;
  pts: XZ[];
  nodeIds: number[];
  ends: [RunwayEnd, RunwayEnd];
}

export type LineKind = 'taxiway' | 'taxilane' | 'parking' | 'stopway' | 'jet_bridge' | 'holding_position';

export interface LineFeature {
  kind: LineKind;
  pts: XZ[];
  nodeIds: number[];
  width: number;
  ref?: string;
}

export type PolyKind = 'apron' | 'terminal' | 'hangar' | 'building' | 'helipad';

export interface PolyFeature {
  kind: PolyKind;
  outer: XZ[];
  holes: XZ[][];
  height: number;
  minHeight: number;
  name?: string;
}

export interface StandRaw {
  ref: string;
  /** For node stands: single point. For way stands: polyline with node ids. */
  pts: XZ[];
  nodeIds: number[];
}

export interface AirportLayout {
  icao: string;
  name: string;
  iata: string;
  center: LatLon;
  proj: Projection;
  elevation: number; // m MSL
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boundary: XZ[] | null;
  runways: Runway[];
  lines: LineFeature[];
  polys: PolyFeature[];
  standsRaw: StandRaw[];
  gates: { ref: string; pos: XZ }[];
  holdingNodes: XZ[];
  tower: { pos: XZ; height: number; name: string } | null;
  synthetic: boolean;
}

// ---------- layout download ----------

/** Read a response body, reporting bytes as they arrive (for the loading screen). */
async function readText(res: Response, onBytes?: (n: number) => void): Promise<string> {
  if (!res.body || !onBytes) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(n);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

/**
 * A layout file from the game's own site: a prebuilt preset (public/airports) or the
 * /api/airport endpoint (shared global cache). Null when it isn't there or can't be read.
 */
async function ownLayout(url: string, icao: string, waitMs: number, onBytes?: (n: number) => void): Promise<OsmElement[] | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), waitMs);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    // the API checked OpenStreetMap and found nothing usable: the public servers won't either
    if (res.status === 404 && res.headers.get('X-Layout') === 'not-found') {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new LayoutNotFound(body.error ?? `Airport ${icao} not found in OpenStreetMap`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file: unknown = JSON.parse(await readText(res, onBytes)); // a missing static file may come back as index.html
    return isLayoutFile(file, icao) ? file.elements : null;
  } catch (e) {
    if (e instanceof LayoutNotFound) throw e;
    console.warn('Airport layout not available from', url, e);
    return null;
  }
}

/** Last resort: the public Overpass servers directly from the browser. */
async function overpass(query: string, onStatus: (s: string) => void, timeoutMs: number, onBytes?: (n: number) => void): Promise<OsmElement[]> {
  let lastErr: unknown = null;
  for (const url of OVERPASS_MIRRORS) {
    const host = new URL(url).host;
    try {
      onStatus(`Trying OpenStreetMap server ${host}…`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
      const json = JSON.parse(await readText(res, onBytes)) as { elements: OsmElement[]; remark?: string };
      if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
      return json.elements;
    } catch (e) {
      lastErr = e;
      console.warn('Overpass mirror failed', url, e);
    }
  }
  throw lastErr ?? new Error('All Overpass mirrors failed');
}

export interface LoadOptions { icao: string; fallbackCenter?: LatLon; name?: string; iata?: string; onBytes?: (n: number) => void }

export async function loadAirport(opts: LoadOptions, onStatus: (s: string) => void): Promise<AirportLayout> {
  const icao = opts.icao.toUpperCase();
  const cacheKey = `osm:v${LAYOUT_VERSION}:${icao}`;
  let elements = await cacheGet<OsmElement[]>(cacheKey, 1000 * 60 * 60 * 24 * 30);

  if (elements) {
    onStatus('Loaded airport layout from local cache');
  } else {
    try {
      // 1. preset airports ship with the game (scripts/update-airports.mjs)
      if (AIRPORTS.some((a) => a.icao === icao)) {
        onStatus('Loading the bundled airport layout…');
        elements = await ownLayout(`/airports/${icao}.json`, icao, 30_000, opts.onBytes);
      }
      // 2. the game's own API: one shared copy per airport for every player
      //    (it may have to ask OpenStreetMap itself, within 150 s, so give it a little longer)
      if (!elements) {
        onStatus('Waiting for OpenStreetMap to prepare the map data…');
        elements = await ownLayout(`/api/airport/${icao}`, icao, 160_000, opts.onBytes);
      }
      // 3. the public servers directly
      if (!elements) {
        let c0 = opts.fallbackCenter;
        if (!c0) {
          onStatus(`Looking up ${icao} in OpenStreetMap…`);
          const c = aerodromeCenter((await overpass(lookupQuery(icao), onStatus, 100_000))[0]);
          if (!c) throw new LayoutNotFound(`Airport ${icao} not found in OpenStreetMap`);
          c0 = c;
        }
        onStatus('Downloading runways, taxiways, aprons and buildings…');
        elements = usableElements(await overpass(layoutQuery(icao, c0), onStatus, 170_000, opts.onBytes));
      }
      await cacheSet(cacheKey, elements);
    } catch (e) {
      console.warn('Falling back to a generated airport:', e);
      onStatus(`OpenStreetMap unavailable (${(e as Error).message}). Generating a stand-in airport…`);
      const c = opts.fallbackCenter ?? { lat: 0, lon: 0 };
      elements = syntheticAirport(c.lat, c.lon);
      const layout = parseLayout(elements, icao, c);
      layout.synthetic = true;
      if (opts.name) layout.name = opts.name;
      return layout;
    }
  }

  // keep the aerodrome we asked for first so it wins over nearby heliports/airfields
  elements.sort((a, b) => Number(b.tags?.icao === icao && b.tags?.aeroway === 'aerodrome') - Number(a.tags?.icao === icao && a.tags?.aeroway === 'aerodrome'));
  elements = elements.filter((e) => e.tags?.aeroway !== 'aerodrome' || e.tags?.icao === icao);
  const center = pickCenter(elements, opts.fallbackCenter);
  const layout = parseLayout(elements, icao, center);
  if (opts.name) layout.name = opts.name;
  if (opts.iata && !layout.iata) layout.iata = opts.iata;
  return layout;
}

function pickCenter(elements: OsmElement[], fallback?: LatLon): LatLon {
  const ad = elements.find((e) => e.tags?.aeroway === 'aerodrome');
  if (ad?.bounds) return { lat: (ad.bounds.minlat + ad.bounds.maxlat) / 2, lon: (ad.bounds.minlon + ad.bounds.maxlon) / 2 };
  const rw = elements.filter((e) => e.tags?.aeroway === 'runway' && e.geometry);
  if (rw.length) {
    let lat = 0, lon = 0, n = 0;
    for (const r of rw) for (const g of r.geometry!) if (g) { lat += g.lat; lon += g.lon; n++; }
    return { lat: lat / n, lon: lon / n };
  }
  return fallback ?? { lat: 0, lon: 0 };
}

// ---------- parsing ----------

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const m = /-?\d+(\.\d+)?/.exec(v);
  return m ? parseFloat(m[0]) : null;
};

export function parseLayout(elements: OsmElement[], icao: string, center: LatLon): AirportLayout {
  const proj = new Projection(center.lat, center.lon);
  const P = (g: OsmLatLon) => proj.toXZ(g.lat, g.lon);
  const geomPts = (geom?: (OsmLatLon | null)[]) => (geom ?? []).filter((g): g is OsmLatLon => !!g).map(P);

  const ad = elements.find((e) => e.tags?.aeroway === 'aerodrome');
  const layout: AirportLayout = {
    icao,
    name: ad?.tags?.['name:en'] ?? ad?.tags?.name ?? icao,
    iata: ad?.tags?.iata ?? '',
    center,
    proj,
    elevation: num(ad?.tags?.ele) ?? 0,
    bounds: { minX: -3000, maxX: 3000, minZ: -3000, maxZ: 3000 },
    boundary: null,
    runways: [],
    lines: [],
    polys: [],
    standsRaw: [],
    gates: [],
    holdingNodes: [],
    tower: null,
    synthetic: false,
  };

  if (ad?.type === 'way' && ad.geometry) layout.boundary = geomPts(ad.geometry);
  else if (ad?.type === 'relation' && ad.members) {
    // join the outer member ways into rings and use the largest as the boundary
    const outers = ad.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => geomPts(m.geometry));
    const rings = joinRings(outers).sort((a, b) => area(b) - area(a));
    if (rings[0]?.length > 3) layout.boundary = rings[0];
  }

  const seenStandKeys = new Set<string>();
  const rawRunways: { id: string; ref: string; width: number; pts: XZ[]; nodeIds: number[] }[] = [];

  for (const e of elements) {
    const t = e.tags ?? {};
    const aw = t.aeroway;
    if (e.type === 'node') {
      if (e.lat == null || e.lon == null) continue;
      const p = proj.toXZ(e.lat, e.lon);
      if (aw === 'parking_position') {
        layout.standsRaw.push({ ref: t.ref ?? t.name ?? '', pts: [p], nodeIds: [e.id] });
      } else if (aw === 'gate') {
        if (t.ref) layout.gates.push({ ref: t.ref, pos: p });
      } else if (aw === 'holding_position') {
        layout.holdingNodes.push(p);
      } else if (aw === 'tower' || aw === 'control_tower' || (t.man_made === 'tower' && /control|aircraft/.test(t.service ?? t['tower:type'] ?? ''))) {
        if (!layout.tower || aw) layout.tower = { pos: p, height: num(t.height) ?? 60, name: t.name ?? 'Control Tower' };
      }
      continue;
    }

    if (e.type === 'way') {
      const pts = geomPts(e.geometry);
      if (pts.length < 2) continue;
      const nodeIds = e.nodes ?? [];
      const width = num(t.width);
      switch (aw) {
        case 'runway':
          rawRunways.push({ id: String(e.id), ref: t.ref ?? '', width: width ?? 45, pts, nodeIds });
          continue;
        case 'taxiway':
          layout.lines.push({ kind: 'taxiway', pts, nodeIds, width: width ?? 23, ref: t.ref });
          continue;
        case 'taxilane':
          layout.lines.push({ kind: 'taxilane', pts, nodeIds, width: width ?? 18, ref: t.ref });
          continue;
        case 'parking_position': {
          const closed = nodeIds.length > 3 && nodeIds[0] === nodeIds[nodeIds.length - 1];
          if (closed) {
            // area-mapped stand: use the centroid as a point stand
            const c = centroid(pts);
            layout.standsRaw.push({ ref: t.ref ?? '', pts: [c], nodeIds: [] });
          } else {
            const key = `${t.ref ?? ''}@${Math.round(pts[pts.length - 1].x)},${Math.round(pts[pts.length - 1].z)}`;
            if (seenStandKeys.has(key)) continue;
            seenStandKeys.add(key);
            layout.standsRaw.push({ ref: t.ref ?? '', pts, nodeIds });
            layout.lines.push({ kind: 'parking', pts, nodeIds, width: 0.5, ref: t.ref });
          }
          continue;
        }
        case 'stopway':
          layout.lines.push({ kind: 'stopway', pts, nodeIds, width: width ?? 45 });
          continue;
        case 'jet_bridge':
          layout.lines.push({ kind: 'jet_bridge', pts, nodeIds, width: width ?? 3.5 });
          continue;
        case 'holding_position':
          layout.lines.push({ kind: 'holding_position', pts, nodeIds, width: 1 });
          continue;
        case 'tower':
        case 'control_tower': {
          const c = centroid(pts);
          layout.tower = { pos: c, height: num(t.height) ?? 60, name: t.name ?? 'Control Tower' };
          continue;
        }
      }
      const closed = pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 0.5;
      if (!closed) continue;
      if (aw === 'apron') layout.polys.push(poly('apron', pts, [], t));
      else if (aw === 'helipad') layout.polys.push(poly('helipad', pts, [], t));
      else if (aw === 'terminal') layout.polys.push(poly('terminal', pts, [], t));
      else if (aw === 'hangar') layout.polys.push(poly('hangar', pts, [], t));
      else if (t.building) {
        if (t.man_made === 'tower' && !layout.tower) {
          layout.tower = { pos: centroid(pts), height: num(t.height) ?? 60, name: t.name ?? 'Control Tower' };
        }
        layout.polys.push(poly(t.building === 'hangar' ? 'hangar' : t.building === 'terminal' ? 'terminal' : 'building', pts, [], t));
      }
      continue;
    }

    // only apron/terminal/hangar multipolygons are geometry here (the aerodrome relation is the boundary)
    if (e.type === 'relation' && e.members && (aw === 'apron' || aw === 'terminal' || aw === 'hangar')) {
      const outers: XZ[][] = [];
      const inners: XZ[][] = [];
      for (const m of e.members) {
        if (!m.geometry) continue;
        const pts = geomPts(m.geometry);
        if (pts.length < 3) continue;
        (m.role === 'inner' ? inners : outers).push(pts);
      }
      const kind: PolyKind = aw === 'apron' ? 'apron' : aw === 'hangar' ? 'hangar' : 'terminal';
      for (const ring of joinRings(outers)) {
        const holes = joinRings(inners).filter((h) => pointInPolygon(h[0], ring));
        layout.polys.push(poly(kind, ring, holes, t));
      }
    }
  }

  // Runways are sometimes split into several ways (or have displaced-threshold stubs with a
  // different ref): chain collinear pieces that share an end node. Longest pieces go first so
  // they keep their ref.
  const pool = rawRunways.slice().sort((a, b) => b.pts.length - a.pts.length);
  const hdg = (p: XZ[]) => headingOf(p[0], p[p.length - 1]);
  const collinear = (a: XZ[], b: XZ[]) => {
    const d = Math.abs(((hdg(a) - hdg(b)) % 180 + 180) % 180);
    return d < 8 || d > 172;
  };
  while (pool.length) {
    const r = pool.shift()!;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        if (o.ref !== r.ref && !collinear(o.pts, r.pts)) continue;
        const rs = r.nodeIds[0], re = r.nodeIds[r.nodeIds.length - 1];
        const os = o.nodeIds[0], oe = o.nodeIds[o.nodeIds.length - 1];
        if (re === os) { r.pts = r.pts.concat(o.pts.slice(1)); r.nodeIds = r.nodeIds.concat(o.nodeIds.slice(1)); }
        else if (re === oe) { r.pts = r.pts.concat(o.pts.slice(0, -1).reverse()); r.nodeIds = r.nodeIds.concat(o.nodeIds.slice(0, -1).reverse()); }
        else if (rs === oe) { r.pts = o.pts.slice(0, -1).concat(r.pts); r.nodeIds = o.nodeIds.slice(0, -1).concat(r.nodeIds); }
        else if (rs === os) { r.pts = o.pts.slice(1).reverse().concat(r.pts); r.nodeIds = o.nodeIds.slice(1).reverse().concat(r.nodeIds); }
        else continue;
        r.width = Math.max(r.width, o.width);
        // prefer the more specific designator, e.g. "09L/27R" over "09/27"
        if (!r.ref || (/[LRC]/.test(o.ref) && !/[LRC]/.test(r.ref))) r.ref = o.ref;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    const rw = makeRunway(r.id, r.ref, r.width, r.pts, r.nodeIds);
    if (rw) layout.runways.push(rw);
  }

  // Keep runways and buildings on the airfield (the bbox can catch neighbouring airfields).
  if (layout.boundary && layout.boundary.length > 3) {
    const b = layout.boundary;
    const onField = layout.runways.filter((r) => pointInPolygon(centroid([r.pts[0], r.pts[r.pts.length - 1]]), b));
    if (onField.length) layout.runways = onField;
    layout.polys = layout.polys.filter((p) => p.kind !== 'building' || pointInPolygon(centroid(p.outer), b));
  }
  // safety net: no real building is larger than ~1.5 km² — anything bigger is a mis-tagged outline
  layout.polys = layout.polys.filter((p) => p.kind === 'apron' || area(p.outer) < 1_500_000);
  const buildings = layout.polys.filter((p) => p.kind === 'building');
  if (buildings.length > 2500) {
    const keep = new Set(buildings.sort((a, b) => area(b.outer) - area(a.outer)).slice(0, 2500));
    layout.polys = layout.polys.filter((p) => p.kind !== 'building' || keep.has(p));
  }

  // bounds from runways + aprons
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (p: XZ) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); };
  for (const r of layout.runways) r.pts.forEach(grow);
  for (const p of layout.polys) if (p.kind !== 'building') p.outer.forEach(grow);
  if (isFinite(minX)) layout.bounds = { minX, maxX, minZ, maxZ };

  if (!layout.tower) {
    // place a tower near the centroid of terminals/aprons
    const anchor = layout.polys.filter((p) => p.kind === 'terminal' || p.kind === 'apron');
    const c = anchor.length ? centroid(anchor.map((p) => centroid(p.outer))) : { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    layout.tower = { pos: { x: c.x + 60, z: c.z + 60 }, height: 65, name: 'Control Tower' };
  }
  return layout;
}

function poly(kind: PolyKind, outer: XZ[], holes: XZ[][], t: Record<string, string>): PolyFeature {
  const levels = num(t['building:levels']);
  const defaults: Record<PolyKind, number> = { apron: 0, helipad: 0, terminal: 18, hangar: 22, building: 9 };
  const height = num(t.height) ?? (levels != null ? levels * 3.6 + 2 : defaults[kind]);
  const minHeight = num(t.min_height) ?? 0;
  return { kind, outer, holes, height: Math.max(3, Math.min(height, 120)), minHeight, name: t.name };
}

function makeRunway(id: string, ref: string, width: number, pts: XZ[], nodeIds: number[]): Runway | null {
  const a = pts[0], b = pts[pts.length - 1];
  const length = pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
  if (length < 300) return null;
  const hdgAB = headingOf(a, b);
  const parts = ref.split('/').map((s) => s.trim()).filter(Boolean);
  // Name the ends from the ref if it matches the geometry, else derive from heading.
  const fromHdg = (h: number) => String(Math.round(h / 10) === 0 ? 36 : Math.round(h / 10)).padStart(2, '0');
  let nameA = fromHdg(hdgAB), nameB = fromHdg((hdgAB + 180) % 360);
  if (parts.length === 2) {
    const n0 = parseInt(parts[0], 10);
    if (!isNaN(n0)) {
      const diff0 = Math.abs(((n0 * 10 - hdgAB + 540) % 360) - 180);
      if (diff0 < 60) { nameA = parts[0]; nameB = parts[1]; } else { nameA = parts[1]; nameB = parts[0]; }
    }
  }
  const rw: Runway = { id, ref: ref || `${nameA}/${nameB}`, width, length, pts, nodeIds, ends: null as unknown as [RunwayEnd, RunwayEnd] };
  rw.ends = [
    { name: nameA, threshold: a, heading: hdgAB, runway: rw },
    { name: nameB, threshold: b, heading: (hdgAB + 180) % 360, runway: rw },
  ];
  return rw;
}

export function centroid(pts: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of pts) { x += p.x; z += p.z; }
  return { x: x / pts.length, z: z / pts.length };
}

function area(pts: XZ[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].z - pts[i].z);
  return Math.abs(s / 2);
}

/** Join open way segments of a multipolygon into closed rings. */
function joinRings(segs: XZ[][]): XZ[][] {
  const rings: XZ[][] = [];
  const pool = segs.map((s) => s.slice());
  const near = (a: XZ, b: XZ) => dist(a, b) < 0.5;
  while (pool.length) {
    let ring = pool.shift()!;
    let grew = true;
    while (!near(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const end = ring[ring.length - 1];
        if (near(end, s[0])) ring = ring.concat(s.slice(1));
        else if (near(end, s[s.length - 1])) ring = ring.concat(s.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
