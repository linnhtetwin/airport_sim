import { type XZ, dist, headingOf, headingVec, pointInPolygon, projectOnSegment } from '../geo/projection';
import type { AirportLayout, Runway, RunwayEnd } from '../data/osm';

export type EdgeKind = 'taxiway' | 'taxilane' | 'parking' | 'runway' | 'link';

export interface GNode {
  id: number;
  p: XZ;
  edges: GEdge[];
  runwayId?: string;
}

export interface GEdge {
  id: number;
  a: GNode;
  b: GNode;
  len: number;
  kind: EdgeKind;
  ref?: string;
  runwayId?: string;
  standIdx?: number;
}

export interface Stand {
  idx: number;
  ref: string;
  stop: GNode;
  entry: GNode;
  /** Points from the entry node (on the taxilane) to the stop position. */
  leadIn: XZ[];
  /** Nose heading of a parked aircraft. */
  heading: number;
  maxSpan: number;
  conflicts: number[];
  occupant: string | null;
}

export interface RunwayExit { node: GNode; s: number }

const other = (e: GEdge, n: GNode) => (e.a === n ? e.b : e.a);

export class TaxiGraph {
  nodes = new Map<number, GNode>();
  edges: GEdge[] = [];
  stands: Stand[] = [];
  private nextNodeId = -1_000_000;
  private nextEdgeId = 1;

  constructor(private layout: AirportLayout) {
    this.build();
  }

  // ---------------- construction ----------------

  private node(id: number, p: XZ): GNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, p, edges: [] };
      this.nodes.set(id, n);
    }
    return n;
  }

  newNode(p: XZ): GNode {
    return this.node(this.nextNodeId--, p);
  }

  addEdge(a: GNode, b: GNode, kind: EdgeKind, extra: Partial<GEdge> = {}): GEdge | null {
    if (a === b) return null;
    const len = dist(a.p, b.p);
    if (len < 0.05) return null;
    const e: GEdge = { id: this.nextEdgeId++, a, b, len, kind, ...extra };
    a.edges.push(e);
    b.edges.push(e);
    this.edges.push(e);
    return e;
  }

  private removeEdge(e: GEdge) {
    e.a.edges = e.a.edges.filter((x) => x !== e);
    e.b.edges = e.b.edges.filter((x) => x !== e);
    const i = this.edges.indexOf(e);
    if (i >= 0) this.edges.splice(i, 1);
  }

  /** Split an edge at a point on it, returning the new middle node. */
  splitEdge(e: GEdge, p: XZ): GNode {
    if (dist(p, e.a.p) < 1) return e.a;
    if (dist(p, e.b.p) < 1) return e.b;
    const m = this.newNode(p);
    if (e.runwayId) m.runwayId = e.runwayId;
    this.removeEdge(e);
    const extra = { ref: e.ref, runwayId: e.runwayId, standIdx: e.standIdx };
    this.addEdge(e.a, m, e.kind, extra);
    this.addEdge(m, e.b, e.kind, extra);
    return m;
  }

  private build() {
    const L = this.layout;
    const coordId = new Map<string, number>();
    const idFor = (ids: number[], i: number, p: XZ) => {
      if (ids[i] != null) return ids[i];
      const k = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
      let id = coordId.get(k);
      if (id == null) { id = this.nextNodeId--; coordId.set(k, id); }
      return id;
    };

    for (const rw of L.runways) {
      for (let i = 1; i < rw.pts.length; i++) {
        const a = this.node(idFor(rw.nodeIds, i - 1, rw.pts[i - 1]), rw.pts[i - 1]);
        const b = this.node(idFor(rw.nodeIds, i, rw.pts[i]), rw.pts[i]);
        a.runwayId = b.runwayId = rw.id;
        this.addEdge(a, b, 'runway', { runwayId: rw.id, ref: rw.ref });
      }
    }
    for (const ln of L.lines) {
      if (ln.kind !== 'taxiway' && ln.kind !== 'taxilane' && ln.kind !== 'parking') continue;
      for (let i = 1; i < ln.pts.length; i++) {
        const a = this.node(idFor(ln.nodeIds, i - 1, ln.pts[i - 1]), ln.pts[i - 1]);
        const b = this.node(idFor(ln.nodeIds, i, ln.pts[i]), ln.pts[i]);
        this.addEdge(a, b, ln.kind, { ref: ln.ref });
      }
    }
    this.connectRunwayCrossings();
    this.buildStands();
    this.alignStandRows();
    this.pruneToMainComponent();
    this.computeStandSizes();
  }

  /** OSM sometimes misses shared nodes where a taxiway meets a runway; repair that. */
  private connectRunwayCrossings() {
    const L = this.layout;
    for (const rw of L.runways) {
      const rEdges = () => this.edges.filter((e) => e.runwayId === rw.id);
      let rList = rEdges();
      const minX = Math.min(...rw.pts.map((p) => p.x)) - 50, maxX = Math.max(...rw.pts.map((p) => p.x)) + 50;
      const minZ = Math.min(...rw.pts.map((p) => p.z)) - 50, maxZ = Math.max(...rw.pts.map((p) => p.z)) + 50;
      // 1. taxiway segments crossing the centreline
      const taxi = this.edges.filter((e) => (e.kind === 'taxiway' || e.kind === 'taxilane') &&
        Math.max(e.a.p.x, e.b.p.x) > minX && Math.min(e.a.p.x, e.b.p.x) < maxX &&
        Math.max(e.a.p.z, e.b.p.z) > minZ && Math.min(e.a.p.z, e.b.p.z) < maxZ);
      for (const te of taxi) {
        if (te.a.runwayId === rw.id || te.b.runwayId === rw.id) continue;
        for (const re of rList) {
          const hit = segIntersect(te.a.p, te.b.p, re.a.p, re.b.p);
          if (!hit) continue;
          const rn = this.splitEdge(re, hit);
          rn.runwayId = rw.id;
          const tn = this.splitEdge(te, hit);
          if (tn !== rn) this.addEdge(tn, rn, 'link');
          rList = rEdges();
          break;
        }
      }
      rList = rEdges();
      // 2. dangling taxiway ends sitting on the runway surface
      for (const n of [...this.nodes.values()]) {
        if (n.runwayId || n.edges.length !== 1 || n.edges[0].kind === 'runway' || n.edges[0].kind === 'parking') continue;
        if (n.p.x < minX || n.p.x > maxX || n.p.z < minZ || n.p.z > maxZ) continue;
        let best: { e: GEdge; p: XZ; d: number } | null = null;
        for (const re of rList) {
          const pr = projectOnSegment(n.p, re.a.p, re.b.p);
          if (!best || pr.d < best.d) best = { e: re, p: pr.point, d: pr.d };
        }
        if (best && best.d < rw.width / 2 + 25) {
          const rn = this.splitEdge(best.e, best.p);
          rn.runwayId = rw.id;
          this.addEdge(n, rn, 'link');
          rList = rEdges();
        }
      }
    }
  }

  private nearestEdge(p: XZ, accept: (e: GEdge) => boolean): { e: GEdge; p: XZ; d: number } | null {
    let best: { e: GEdge; p: XZ; d: number } | null = null;
    for (const e of this.edges) {
      if (!accept(e)) continue;
      const pr = projectOnSegment(p, e.a.p, e.b.p);
      if (!best || pr.d < best.d) best = { e, p: pr.point, d: pr.d };
    }
    return best;
  }

  private buildStands() {
    const L = this.layout;
    const taxiOnly = (e: GEdge) => e.kind === 'taxiway' || e.kind === 'taxilane';
    const used: XZ[] = [];

    // Way-mapped stands first (they carry their own lead-in line).
    for (const s of L.standsRaw) {
      if (s.pts.length < 2 || s.nodeIds.length !== s.pts.length) continue;
      const first = this.nodes.get(s.nodeIds[0]);
      const last = this.nodes.get(s.nodeIds[s.nodeIds.length - 1]);
      if (!first || !last) continue;
      let stop = last, start = first;
      if (last.edges.length > 1 && first.edges.length === 1) { stop = first; start = last; }
      if (start.edges.length === 1) {
        // lead-in not connected to the network: snap its open end
        const near = this.nearestEdge(start.p, taxiOnly);
        if (!near || near.d > 120) continue;
        const sn = this.splitEdge(near.e, near.p);
        this.addEdge(sn, start, 'parking');
      }
      this.registerStand(s.ref, stop);
      used.push(stop.p);
    }
    // Point-mapped stands: create a straight lead-in from the nearest taxilane.
    for (const s of L.standsRaw) {
      if (s.pts.length !== 1) continue;
      const p = s.pts[0];
      if (used.some((u) => dist(u, p) < 15)) continue;
      const near = this.nearestEdge(p, taxiOnly);
      if (!near || near.d > 220 || near.d < 15) continue;
      const entry = this.splitEdge(near.e, near.p);
      const stop = this.newNode(p);
      this.addEdge(entry, stop, 'parking');
      this.registerStand(s.ref, stop);
      used.push(p);
    }
  }

  private registerStand(ref: string, stop: GNode) {
    const idx = this.stands.length;
    // walk back along parking edges to the taxilane network
    const chain: GNode[] = [stop];
    let cur = stop;
    let prev: GNode | null = null;
    for (let guard = 0; guard < 60; guard++) {
      const next = cur.edges.filter((e) => e.kind === 'parking' && other(e, cur) !== prev);
      const hasTaxi = cur.edges.some((e) => e.kind !== 'parking');
      if (cur !== stop && (hasTaxi || cur.edges.length > 2 || next.length === 0)) break;
      if (next.length === 0) break;
      const e = next[0];
      e.standIdx = idx;
      prev = cur;
      cur = other(e, cur);
      chain.push(cur);
    }
    if (chain.length < 2) return;
    const entry = chain[chain.length - 1];
    const leadIn = chain.map((n) => n.p).reverse();
    // Use the last ~25 m of the lead-in for the parked nose heading.
    let k = leadIn.length - 2;
    while (k > 0 && dist(leadIn[k], leadIn[leadIn.length - 1]) < 25) k--;
    const heading = headingOf(leadIn[k], leadIn[leadIn.length - 1]);
    // OSM stand points are often mapped on the terminal edge. Keep the full
    // fuselage footprint outside hard building footprints, sliding along the
    // stand lead-in axis so the stand remains aligned with its taxi lane.
    const safeStop = this.clearOfBuildings(stop.p, heading);
    if (safeStop) {
      stop.p = safeStop;
      for (const edge of stop.edges) edge.len = dist(edge.a.p, edge.b.p);
      leadIn[leadIn.length - 1] = safeStop;
    }
    let gateRef = ref;
    if (!gateRef) {
      const g = this.layout.gates.reduce<{ ref: string; d: number } | null>((best, g) => {
        const d = dist(g.pos, stop.p);
        return d < 70 && (!best || d < best.d) ? { ref: g.ref, d } : best;
      }, null);
      gateRef = g?.ref ?? `S${idx + 1}`;
    }
    this.stands.push({ idx, ref: gateRef.replace(/\s+/g, ' ').slice(0, 10), stop, entry, leadIn, heading, maxSpan: 80, conflicts: [], occupant: null });
  }

  private clearOfBuildings(origin: XZ, heading: number): XZ | null {
    const buildings = this.layout.polys.filter((p) => p.kind === 'terminal' || p.kind === 'hangar' || p.kind === 'building');
    if (!buildings.length) return null;
    const f = headingVec(heading), r = { x: f.z, z: -f.x };
    const blocked = (center: XZ) => {
      // Check the fuselage length rather than the much wider wingspan: wing
      // overhang is normal at a gate, but the body must never enter a building.
      for (let d = -40; d <= 40; d += 2) {
        for (const side of [-3.5, 0, 3.5]) {
          const p = { x: center.x + f.x * d + r.x * side, z: center.z + f.z * d + r.z * side };
          if (buildings.some((b) => pointInPolygon(p, b.outer) && !b.holes.some((hole) => pointInPolygon(p, hole)))) return true;
        }
      }
      return false;
    };
    if (!blocked(origin)) return null;
    // Search both directions along the stand axis and use the smallest clear
    // movement. This handles stands on either side of a terminal consistently.
    for (let step = 2; step <= 60; step += 2) {
      for (const sign of [-1, 1]) {
        const candidate = { x: origin.x + f.x * step * sign, z: origin.z + f.z * step * sign };
        if (!blocked(candidate)) return candidate;
      }
    }
    return null;
  }

  private alignStandRows() {
    // Smooth noisy OSM parking headings within a row while keeping opposing
    // terminal sides facing their own direction.
    const source = this.stands.map((s) => s.heading);
    for (const stand of this.stands) {
      const f = headingVec(source[stand.idx]);
      const row = this.stands
        .filter((other) => other !== stand && dist(other.stop.p, stand.stop.p) < 80)
        .filter((other) => {
          const o = headingVec(source[other.idx]);
          return f.x * o.x + f.z * o.z > 0.5;
        });
      if (!row.length) continue;
      let x = f.x, z = f.z;
      for (const other of row) {
        const o = headingVec(source[other.idx]);
        x += o.x; z += o.z;
      }
      const h = (Math.atan2(x, -z) * 180 / Math.PI + 360) % 360;
      // Avoid letting an unrelated nearby stand rotate this stand across its lead-in.
      const delta = ((h - source[stand.idx] + 540) % 360) - 180;
      if (Math.abs(delta) <= 30) {
        stand.heading = (source[stand.idx] + delta * 0.65 + 360) % 360;
        const safeStop = this.clearOfBuildings(stand.stop.p, stand.heading);
        if (safeStop) {
          stand.stop.p = safeStop;
          for (const edge of stand.stop.edges) edge.len = dist(edge.a.p, edge.b.p);
          stand.leadIn[stand.leadIn.length - 1] = safeStop;
        }
      }
    }
  }

  private pruneToMainComponent() {
    const comp = new Map<GNode, number>();
    const sizes: number[] = [];
    for (const n of this.nodes.values()) {
      if (comp.has(n)) continue;
      const id = sizes.length;
      let count = 0;
      const stack = [n];
      comp.set(n, id);
      while (stack.length) {
        const c = stack.pop()!;
        count++;
        for (const e of c.edges) {
          const o = other(e, c);
          if (!comp.has(o)) { comp.set(o, id); stack.push(o); }
        }
      }
      sizes.push(count);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    const inMain = (n: GNode) => comp.get(n) === main;
    // Reconnect stranded stands where possible.
    for (const s of this.stands) {
      if (inMain(s.entry)) continue;
      const near = this.nearestEdge(s.entry.p, (e) => (e.kind === 'taxiway' || e.kind === 'taxilane') && inMain(e.a));
      if (near && near.d < 250) {
        const n = this.splitEdge(near.e, near.p);
        comp.set(n, main);
        this.addEdge(n, s.entry, 'link');
        // flood the stranded component into main
        const stack = [s.entry];
        while (stack.length) {
          const c = stack.pop()!;
          if (comp.get(c) === main) continue;
          comp.set(c, main);
          for (const e of c.edges) stack.push(other(e, c));
        }
      }
    }
    // Also merge runway components (runway nodes must be reachable).
    this.stands = this.stands.filter((s) => inMain(s.entry) && inMain(s.stop));
    this.stands.forEach((s, i) => {
      for (const e of this.edges) if (e.standIdx === s.idx) e.standIdx = i;
      s.idx = i;
    });
    for (const n of [...this.nodes.values()]) {
      if (!inMain(n)) {
        for (const e of [...n.edges]) this.removeEdge(e);
        this.nodes.delete(n.id);
      }
    }
  }

  private computeStandSizes() {
    for (const s of this.stands) {
      let nearest = Infinity;
      for (const o of this.stands) {
        if (o === s) continue;
        const d = dist(o.stop.p, s.stop.p);
        if (d < 32) s.conflicts.push(o.idx);
        else nearest = Math.min(nearest, d);
      }
      const refSize = /A380|A388|380/i.test(s.ref) ? 82 : 0;
      s.maxSpan = Math.max(refSize, Math.min(85, Math.max(26, nearest - 3)));
    }
  }

  // ---------------- queries ----------------

  runwayNodes(rw: Runway): GNode[] {
    return [...this.nodes.values()].filter((n) => n.runwayId === rw.id);
  }

  /** Distance of a point along a runway end's centreline from its threshold. */
  static alongRunway(end: RunwayEnd, p: XZ): number {
    const r = (end.heading * Math.PI) / 180;
    return (p.x - end.threshold.x) * Math.sin(r) - (p.z - end.threshold.z) * Math.cos(r);
  }

  static lateralRunway(end: RunwayEnd, p: XZ): number {
    const r = (end.heading * Math.PI) / 180;
    return (p.x - end.threshold.x) * Math.cos(r) + (p.z - end.threshold.z) * Math.sin(r);
  }

  /** Exits for a landing on this runway end, sorted by distance from the threshold. */
  exitsFor(end: RunwayEnd): RunwayExit[] {
    const out: RunwayExit[] = [];
    for (const n of this.runwayNodes(end.runway)) {
      if (!n.edges.some((e) => e.kind !== 'runway')) continue;
      out.push({ node: n, s: TaxiGraph.alongRunway(end, n.p) });
    }
    return out.sort((a, b) => a.s - b.s);
  }

  /** Entry points (runway nodes with taxiway access) for a departure from this end. */
  entriesFor(end: RunwayEnd): RunwayExit[] {
    return this.exitsFor(end).filter((x) => x.s < end.runway.length * 0.6);
  }

  nearestNode(p: XZ, accept: (n: GNode) => boolean = () => true): GNode | null {
    let best: GNode | null = null, bd = Infinity;
    for (const n of this.nodes.values()) {
      if (!accept(n)) continue;
      const d = dist(n.p, p);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /**
   * A* route. Runways are strongly avoided (crossing at a node is free) and
   * stand lead-ins are only used for the stands passed in `standOk`.
   */
  findPath(from: GNode, to: GNode, standOk: number[] = [], vehicle = false): { nodes: GNode[]; edges: GEdge[] } | null {
    if (from === to) return { nodes: [from], edges: [] };
    const open = new MinHeap<GNode>();
    const g = new Map<GNode, number>();
    const came = new Map<GNode, GEdge>();
    g.set(from, 0);
    open.push(from, dist(from.p, to.p));
    const closed = new Set<GNode>();
    while (open.size) {
      const cur = open.pop()!;
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const e of cur.edges) {
        const nb = other(e, cur);
        if (closed.has(nb)) continue;
        let w = e.len;
        if (e.kind === 'runway') w *= vehicle ? 60 : 25;
        else if (e.kind === 'parking' && e.standIdx != null && !standOk.includes(e.standIdx)) w *= vehicle ? 3 : 80;
        else if (e.kind === 'taxilane') w *= 1.05;
        const ng = g.get(cur)! + w;
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng);
          came.set(nb, e);
          open.push(nb, ng + dist(nb.p, to.p));
        }
      }
    }
    if (!came.has(to)) return null;
    const nodes: GNode[] = [to];
    const edges: GEdge[] = [];
    let c = to;
    while (c !== from) {
      const e = came.get(c)!;
      edges.push(e);
      c = other(e, c);
      nodes.push(c);
    }
    return { nodes: nodes.reverse(), edges: edges.reverse() };
  }

  /** Compact list of taxiway names along a route, e.g. ["K", "A", "B"]. */
  static routeNames(edges: GEdge[]): string[] {
    const names: string[] = [];
    for (const e of edges) {
      if (e.kind !== 'taxiway' && e.kind !== 'taxilane') continue;
      const r = e.ref?.split(/[;,]/)[0]?.trim();
      if (r && names[names.length - 1] !== r) names.push(r);
    }
    return names.slice(0, 6);
  }
}

function segIntersect(p1: XZ, p2: XZ, p3: XZ, p4: XZ): XZ | null {
  const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
  if (t <= 0.001 || t >= 0.999 || u < 0 || u > 1) return null;
  return { x: p1.x + t * (p2.x - p1.x), z: p1.z + t * (p2.z - p1.z) };
}

class MinHeap<T> {
  private items: { v: T; k: number }[] = [];
  get size() { return this.items.length; }
  push(v: T, k: number) {
    const a = this.items;
    a.push({ v, k });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0].v;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
