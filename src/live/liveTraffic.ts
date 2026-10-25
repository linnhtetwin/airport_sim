import type { LiveFlight } from '../data/flights';
import type { FaFlight } from '../data/flightaware';
import { type XZ, type Projection, KT, FT, headingVec, headingOf, angleDiff } from '../geo/projection';
import { typeSpec } from '../data/aircraftTypes';
import { airlineOf } from '../data/airlines';
import type { Runway } from '../data/osm';
import { TaxiGraph } from '../sim/taxiGraph';

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
  /** FlightAware schedule entry for this flight, when one matches the callsign. */
  fa?: FaFlight;
  /** What has already been announced for this flight (event detection). */
  memo: { ground?: boolean; approach?: boolean; landed?: boolean; departed?: boolean; squawk?: string };
}

/** A real-world event derived from ADS-B data (never from the simulation). */
export interface LiveEvent { text: string; callsign: string; level: 'info' | 'alert' }

const EMERGENCY_SQUAWK: Record<string, string> = { '7700': 'general emergency', '7600': 'radio failure', '7500': 'unlawful interference' };

/** Real ADS-B traffic, smoothed and dead-reckoned between polls. */
export class LiveTraffic {
  tracks = new Map<string, LiveTrack>();
  lastUpdate = 0;
  source = '';
  error = '';

  onEvent: (e: LiveEvent) => void = () => {};
  /** Set after the first poll: aircraft already on the ground/airborne then aren't "events". */
  private primed = false;

  constructor(private proj: Projection, private elevation: number, private icao: string, private iata: string, private runways: Runway[] = []) {}

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
        this.detect(t);
      } else {
        const p = this.proj.toXZ(f.lat, f.lon);
        const alt = f.onGround || f.altFt == null ? 0 : Math.max(0, f.altFt * FT - this.elevation);
        const nt: LiveTrack = { id, f, pos: p, alt, heading: f.track, target: p, targetAlt: alt, phase: 'Overflight', distKm: Math.hypot(p.x, p.z) / 1000, firstSeen: now, memo: {} };
        this.tracks.set(id, nt);
        this.detect(nt);
      }
    }
    for (const [id, t] of this.tracks) if (now - t.f.seenAt > 90_000) this.tracks.delete(id);
    this.primed = true;
  }

  /** Turn changes in a flight's real state into events: landed, departed, on approach, emergency. */
  private detect(t: LiveTrack) {
    const f = t.f, m = t.memo;
    const cs = f.callsign;
    const p = this.proj.toXZ(f.lat, f.lon);
    const km = Math.hypot(p.x, p.z) / 1000;
    const ground = f.onGround || (f.altFt != null && f.altFt * FT - this.elevation < 15 && f.gs < 80);
    const altText = ground ? 'on the ground' : f.altFt != null ? `${Math.round(f.altFt / 100) * 100} ft` : 'altitude unknown';
    const from = f.originName ?? f.origin, to = f.destName ?? f.dest;

    // real emergency squawks are always reported, even on the first poll
    const sq = f.squawk && EMERGENCY_SQUAWK[f.squawk] ? f.squawk : undefined;
    if (sq && m.squawk !== sq) {
      this.onEvent({ level: 'alert', callsign: cs, text: `${cs} squawking ${sq} (${EMERGENCY_SQUAWK[sq]}), ${altText}, ${km.toFixed(0)} km from the airport` });
    }
    m.squawk = sq;

    if (this.primed && m.ground !== undefined && km < 8) {
      if (!m.ground && ground && !m.landed) {
        m.landed = true;
        const rwy = this.runwayFor(p, f.track);
        this.onEvent({ level: 'info', callsign: cs, text: `${cs}${from ? ` from ${from}` : ''} landed${rwy ? ` runway ${rwy}` : ''}` });
      } else if (m.ground && !ground && !m.departed) {
        m.departed = true;
        const rwy = this.runwayFor(p, f.track);
        this.onEvent({ level: 'info', callsign: cs, text: `${cs} departed${rwy ? ` runway ${rwy}` : ''}${to ? ` for ${to}` : ''}` });
      }
    }
    if (!ground && !m.approach && !m.landed && km < 30 && km > 2 && f.vrate < -300 && f.altFt != null && f.altFt < 6000) {
      const inbound = Math.abs(angleDiff(f.track, headingOf(p, { x: 0, z: 0 }))) < 50;
      if (inbound) {
        m.approach = true;
        if (this.primed) this.onEvent({ level: 'info', callsign: cs, text: `${cs}${from ? ` from ${from}` : ''} on approach, ${altText}, ${km.toFixed(0)} km out` });
      }
    }
    m.ground = ground;
  }

  /** Runway an aircraft at p with this track is using (on or near its centreline), if any. */
  private runwayFor(p: XZ, track: number): string | null {
    for (const rw of this.runways) {
      for (const end of rw.ends) {
        if (Math.abs(angleDiff(end.heading, track)) > 25) continue;
        const along = TaxiGraph.alongRunway(end, p);
        if (along < -800 || along > rw.length + 800) continue;
        if (Math.abs(TaxiGraph.lateralRunway(end, p)) < rw.width / 2 + 120) return end.name;
      }
    }
    return null;
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
