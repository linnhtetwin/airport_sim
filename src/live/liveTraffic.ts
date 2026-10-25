import type { LiveFlight } from '../data/flights';
import { type XZ, type Projection, KT, FT, headingVec, headingOf, angleDiff } from '../geo/projection';
import { typeSpec } from '../data/aircraftTypes';
import { airlineOf } from '../data/airlines';

export type LivePhase = 'Parked' | 'Taxiing' | 'Runway' | 'Approach' | 'Departing' | 'Arriving' | 'Climbing out' | 'Pattern' | 'Overflight';

export interface LiveTrack {
  id: string;
  f: LiveFlight;
  pos: XZ;
  alt: number; // m above field
  heading: number;
  target: XZ;
  targetAlt: number;
  phase: LivePhase;
  distKm: number;
  firstSeen: number;
}

/** Real ADS-B traffic, smoothed and dead-reckoned between polls. */
export class LiveTraffic {
  tracks = new Map<string, LiveTrack>();
  lastUpdate = 0;
  source = '';
  error = '';

  constructor(private proj: Projection, private elevation: number, private icao: string, private iata: string) {}

  ingest(list: LiveFlight[], source: string) {
    const now = Date.now();
    this.lastUpdate = now;
    this.source = source;
    this.error = '';
    for (const f of list) {
      const id = `L${f.hex}`;
      const t = this.tracks.get(id);
      if (t) {
        t.f = f;
      } else {
        const p = this.proj.toXZ(f.lat, f.lon);
        const alt = f.onGround || f.altFt == null ? 0 : Math.max(0, f.altFt * FT - this.elevation);
        this.tracks.set(id, { id, f, pos: p, alt, heading: f.track, target: p, targetAlt: alt, phase: 'Overflight', distKm: 0, firstSeen: now });
      }
    }
    for (const [id, t] of this.tracks) if (now - t.f.seenAt > 90_000) this.tracks.delete(id);
  }

  update(dt: number) {
    const now = Date.now();
    for (const t of this.tracks.values()) {
      const f = t.f;
      const age = Math.min(25, Math.max(0, (now - f.seenAt) / 1000));
      const base = this.proj.toXZ(f.lat, f.lon);
      const v = headingVec(f.track);
      const spd = f.gs * KT;
      t.target = { x: base.x + v.x * spd * age, z: base.z + v.z * spd * age };
      const baseAlt = f.onGround || f.altFt == null ? 0 : Math.max(0, f.altFt * FT - this.elevation);
      t.targetAlt = Math.max(0, baseAlt + (f.vrate * FT / 60) * age);
      const k = 1 - Math.exp(-dt * 1.8);
      // snap if far off (first fix or a big jump)
      const dx = t.target.x - t.pos.x, dz = t.target.z - t.pos.z;
      if (Math.hypot(dx, dz) > 3000) t.pos = { ...t.target };
      else t.pos = { x: t.pos.x + dx * k, z: t.pos.z + dz * k };
      t.alt += (t.targetAlt - t.alt) * k;
      const hk = Math.min(1, dt * 2);
      t.heading = (t.heading + angleDiff(t.heading, f.track) * hk + 360) % 360;
      t.distKm = Math.hypot(t.pos.x, t.pos.z) / 1000;
      t.phase = this.classify(t);
    }
  }

  private classify(t: LiveTrack): LivePhase {
    const f = t.f;
    const toApt = headingOf(t.pos, { x: 0, z: 0 });
    const inbound = Math.abs(angleDiff(f.track, toApt)) < 60;
    const destHere = f.dest === this.iata || f.destIcao === this.icao;
    const origHere = f.origin === this.iata || f.originIcao === this.icao;
    if (f.onGround || t.alt < 15) {
      if (f.gs < 3) return 'Parked';
      if (f.gs < 45) return 'Taxiing';
      return 'Runway';
    }
    const agl = t.alt / FT;
    const routeElsewhere = !!(f.origin && f.dest) && !destHere && !origHere;
    if (routeElsewhere && (agl > 3000 || t.distKm > 15)) return 'Overflight';
    if (agl < 4000 && t.distKm < 25) {
      if (f.vrate < -250 || (destHere && inbound)) return 'Approach';
      if (f.vrate > 250 || origHere) return 'Departing';
      return 'Pattern';
    }
    if ((destHere || (f.vrate < -400 && inbound)) && t.distKm < 150) return 'Arriving';
    if (origHere || (f.vrate > 400 && !inbound && t.distKm < 80)) return 'Climbing out';
    return 'Overflight';
  }

  list(): LiveTrack[] {
    return [...this.tracks.values()].sort((a, b) => a.distKm - b.distKm);
  }

  static spec(t: LiveTrack) {
    return typeSpec(t.f.type, t.f.category);
  }

  static airline(t: LiveTrack) {
    return airlineOf(t.f.callsign);
  }
}
