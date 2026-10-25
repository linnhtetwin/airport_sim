import { type XZ, dist, headingOf, angleDiff } from '../geo/projection';
import type { AirportLayout } from '../data/osm';
import { centroid } from '../data/osm';
import type { VehicleKind } from '../world/models';
import { Path } from './path';
import type { GNode, TaxiGraph } from './taxiGraph';

export type VehicleState = 'IDLE' | 'OUTBOUND' | 'ARRIVED' | 'WORKING' | 'ATTACHED' | 'LEADING' | 'STANDBY' | 'RETURN';

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  pos: XZ;
  heading: number;
  speed: number;
  state: VehicleState;
  home: GNode;
  path: Path | null;
  s: number;
  target: string | null;
  work: number;
  workTotal: number;
}

export const FLEET_LABEL: Record<VehicleKind, string> = {
  fuel: 'Fuel truck', catering: 'Catering', baggage: 'Baggage', cleaning: 'Cleaning',
  tug: 'Pushback tug', followme: 'Follow-me', fire: 'Fire tender',
};

/**
 * Airport ground-vehicle pool. Vehicles are spread over a few ramp depots
 * (big airports get several) and wait hidden at their depot when idle.
 */
export class Fleet {
  vehicles: Vehicle[] = [];
  readonly depots: GNode[] = [];

  constructor(private graph: TaxiGraph, layout: AirportLayout, counts: Record<VehicleKind, number>) {
    const onNet = (n: GNode) => !n.runwayId && n.edges.some((e) => e.kind === 'taxilane' || e.kind === 'taxiway');
    const hangars = layout.polys.filter((p) => p.kind === 'hangar');
    const anchor = hangars.length ? centroid(hangars.map((h) => centroid(h.outer))) : layout.tower?.pos ?? { x: 0, z: 0 };
    const first = graph.nearestNode(anchor, onNet) ?? graph.stands[0]?.entry ?? graph.nodes.values().next().value!;
    this.depots.push(first);
    // farthest-point sampling over stand entries: one depot per ~40 stands, max 5
    const want = Math.min(5, Math.max(1, Math.round(graph.stands.length / 40)));
    const entries = graph.stands.map((s) => s.entry);
    while (this.depots.length < want && entries.length) {
      let best = entries[0], bd = -1;
      for (const e of entries) {
        const d = Math.min(...this.depots.map((p) => dist(p.p, e.p)));
        if (d > bd) { bd = d; best = e; }
      }
      if (bd < 400) break;
      this.depots.push(best);
    }
    let n = 1;
    for (const kind of Object.keys(counts) as VehicleKind[]) {
      for (let i = 0; i < counts[kind]; i++) {
        const home = this.depots[i % this.depots.length];
        this.vehicles.push({ id: `V${n++}`, kind, home, pos: { ...home.p }, heading: 0, speed: 0, state: 'IDLE', path: null, s: 0, target: null, work: 0, workTotal: 0 });
      }
    }
  }

  get depot(): XZ { return this.depots[0].p; }

  available(kind: VehicleKind): number {
    return this.vehicles.filter((v) => v.kind === kind && v.state === 'IDLE').length;
  }
  total(kind: VehicleKind): number {
    return this.vehicles.filter((v) => v.kind === kind).length;
  }

  private route(from: XZ, fromNode: GNode | null, to: XZ, toNode: GNode | null): Path {
    const accept = (n: GNode) => !n.runwayId;
    const a = fromNode ?? this.graph.nearestNode(from, accept);
    const b = toNode ?? this.graph.nearestNode(to, accept);
    if (!a || !b) return new Path([from, to]);
    const r = this.graph.findPath(a, b, [], true);
    if (!r) return new Path([from, to]);
    return new Path([from, ...r.nodes.map((n) => n.p), to]);
  }

  dispatch(kind: VehicleKind, target: string, dest: XZ, destNode: GNode | null): Vehicle | null {
    // nearest idle vehicle (by straight-line distance from its depot)
    let v: Vehicle | undefined, bd = Infinity;
    for (const x of this.vehicles) {
      if (x.kind !== kind || x.state !== 'IDLE') continue;
      const d = dist(x.home.p, dest);
      if (d < bd) { bd = d; v = x; }
    }
    if (!v) return null;
    v.pos = { ...v.home.p };
    v.path = this.route(v.home.p, v.home, dest, destNode);
    v.s = 0;
    v.speed = 0;
    v.state = 'OUTBOUND';
    v.target = target;
    v.heading = v.path.headingAt(0);
    return v;
  }

  /** Re-target a moving vehicle (e.g. follow-me chasing a taxiing aircraft). */
  redirect(v: Vehicle, dest: XZ) {
    v.path = this.route(v.pos, null, dest, null);
    v.s = 0;
  }

  sendHome(v: Vehicle) {
    v.path = this.route(v.pos, null, v.home.p, v.home);
    v.s = 0;
    v.state = 'RETURN';
    v.target = null;
  }

  update(dt: number) {
    for (const v of this.vehicles) {
      if ((v.state !== 'OUTBOUND' && v.state !== 'RETURN') || !v.path) continue;
      const remain = v.path.length - v.s;
      const turn = v.path.turnAhead(v.s, 30);
      const target = Math.min(turn > 40 ? 6 : 15, Math.sqrt(2 * 2.5 * Math.max(0, remain)) + 0.5);
      v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), 2.5 * dt);
      v.s = Math.min(v.path.length, v.s + v.speed * dt);
      const prev = v.pos;
      v.pos = v.path.at(v.s);
      if (dist(prev, v.pos) > 0.05) {
        const h = headingOf(prev, v.pos);
        v.heading += angleDiff(v.heading, h) * Math.min(1, dt * 5);
      }
      if (v.s >= v.path.length - 0.3) {
        v.speed = 0;
        if (v.state === 'RETURN') { v.state = 'IDLE'; v.path = null; }
        else v.state = 'ARRIVED';
      }
    }
  }
}
