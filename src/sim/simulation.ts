import { type XZ, KT, dist, headingVec, angleDiff, headingOf } from '../geo/projection';
import type { AirportLayout, Runway, RunwayEnd } from '../data/osm';
import { type TypeSpec, TYPES, SIM_TYPE_POOL, typeSpec } from '../data/aircraftTypes';
import { telephony, airlineOf } from '../data/airlines';
import type { VehicleKind } from '../world/models';
import { Path } from './path';
import { Radio, type Speaker } from './radio';
import { TaxiGraph, type GNode, type Stand } from './taxiGraph';
import { Fleet, type Vehicle } from './vehicles';

export type Phase =
  | 'APPROACH' | 'GO_AROUND' | 'ROLLOUT' | 'VACATED' | 'TAXI_IN' | 'AT_STAND' | 'DOCKING' | 'PARKED'
  | 'READY' | 'PUSH_WAIT' | 'PUSHBACK' | 'PUSHED' | 'TAXI_OUT' | 'HOLD_SHORT' | 'LINEUP' | 'LINED_UP'
  | 'TAKEOFF' | 'CLIMB' | 'GONE';

export type ServiceKind = 'baggage' | 'catering' | 'cleaning' | 'fuel';
export const SERVICE_KINDS: ServiceKind[] = ['baggage', 'catering', 'cleaning', 'fuel'];
const SERVICE_TIME: Record<ServiceKind, number> = { baggage: 120, catering: 90, cleaning: 75, fuel: 100 };
type ServiceState = 'todo' | 'enroute' | 'working' | 'done';

export const PHASE_LABEL: Record<Phase, string> = {
  APPROACH: 'On final', GO_AROUND: 'Going around', ROLLOUT: 'Landing roll', VACATED: 'Clear of runway',
  TAXI_IN: 'Taxiing to stand', AT_STAND: 'Awaiting marshaller', DOCKING: 'Marshalling in', PARKED: 'On stand',
  READY: 'Ready for pushback', PUSH_WAIT: 'Waiting for tug', PUSHBACK: 'Pushing back', PUSHED: 'Ready to taxi',
  TAXI_OUT: 'Taxiing to runway', HOLD_SHORT: 'Holding short', LINEUP: 'Lining up', LINED_UP: 'Lined up',
  TAKEOFF: 'Takeoff roll', CLIMB: 'Departing', GONE: 'Gone',
};

/** Stop point before entering a runway; `sOut` is where the path leaves the runway area again. */
interface Hold { s: number; sOut: number; runway: Runway; kind: 'cross' | 'depart' | 'vacate'; cleared: boolean }

const DESTS = ['LHR', 'CDG', 'FRA', 'AMS', 'DXB', 'DOH', 'SIN', 'HKG', 'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'BKK', 'KUL', 'SYD', 'LAX', 'SFO', 'JFK', 'ORD', 'ATL', 'DFW', 'MIA', 'YYZ', 'MEX', 'GRU', 'IST', 'MAD', 'FCO', 'ZRH', 'MUC', 'DEL', 'BOM', 'CGK', 'MNL', 'TPE', 'RGN', 'SGN', 'HAN', 'AKL', 'MEL', 'SEA', 'BOS', 'IAD', 'LAS', 'DEN', 'CPH', 'HEL', 'DUB', 'LIS', 'VIE', 'BRU', 'CAI', 'JNB', 'NBO', 'ADD', 'HKT', 'MDL'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
function weighted<T>(pool: Array<[T, number]>): T {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pool) if ((r -= w) <= 0) return v;
  return pool[0][0];
}

let nextId = 1;

export class SimAircraft {
  id = `A${nextId++}`;
  phase: Phase = 'APPROACH';
  pos: XZ = { x: 0, z: 0 };
  alt = 0;
  heading = 0;
  speed = 0;
  pitch = 0;
  path: Path | null = null;
  s = 0;
  holds: Hold[] = [];
  stand: Stand | null = null;
  rwy: RunwayEnd | null = null;
  finalDist = 0;
  rwyS = 0;
  exitNode: GNode | null = null;
  exitS = 0;
  clearedLand = false;
  taxiCleared = false;
  lineupCleared = false;
  takeoffCleared = false;
  heldByAtc = false;
  blockedFor = 0;
  wait = 0;
  delay = 0;
  services: Record<ServiceKind, ServiceState> = { baggage: 'done', catering: 'done', cleaning: 'done', fuel: 'done' };
  serviceProgress: Partial<Record<ServiceKind, number>> = {};
  onBlocksAt = 0;
  minTurn = 0;
  emergency = false;
  fireAlerted = false;
  goArounds = 0;
  dormant = false;
  squawk: string;
  std = 0;
  /** Stand the flight left from (kept for the board after pushback). */
  gateRef = '';
  landedAt = 0;
  pendingRoute: Path | null = null;
  tugId: string | null = null;
  followMeId: string | null = null;
  said = new Set<string>();
  cleanupAt = 0;

  constructor(public callsign: string, public spec: TypeSpec, public kind: 'ARR' | 'DEP', public origin: string, public dest: string) {
    this.squawk = String(Math.floor(rand(1000, 7000))).replace(/[89]/g, '4');
  }
  get airline() { return airlineOf(this.callsign); }
  get tel() { return telephony(this.callsign); }
  get onGround() { return this.alt < 1; }
  get isActive() { return !this.dormant && this.phase !== 'GONE'; }
}

export interface SimOptions {
  difficulty: 'easy' | 'normal' | 'hard';
  autoTower: boolean;
  autoGround: boolean;
  autoRamp: boolean;
  airlines: string[];
  radioName: string;
  iata: string;
}

export interface Marshaller { id: string; pos: XZ; heading: number; acId: string; state: 'GUIDE' | 'STOP'; t: number }

export interface Wind { dir: number; speed: number; variable?: boolean }

const DIFF = {
  easy: { arr: 220, dep: 260, maxApp: 2 },
  normal: { arr: 140, dep: 170, maxApp: 3 },
  hard: { arr: 85, dep: 110, maxApp: 5 },
};

export class Simulation {
  time = 0;
  aircraft: SimAircraft[] = [];
  fleet: Fleet;
  marshallers: Marshaller[] = [];
  arrEnd: RunwayEnd;
  depEnd: RunwayEnd;
  wind: Wind = { dir: 0, speed: 0 };
  score = 0;
  stats = { landed: 0, departed: 0, goArounds: 0, incursions: 0, services: 0, delay: 0, emergencies: 0 };
  seedFlights: { callsign: string; type?: string }[] = [];
  onAlert: (text: string, level: 'warn' | 'bad' | 'good') => void = () => {};
  private arrTimer = 20;
  planned: { callsign: string; spec: TypeSpec; origin: string }[] = [];
  /** Completed flights for the information board. */
  history: { kind: 'ARR' | 'DEP'; callsign: string; place: string; stand: string; t: number; std: number }[] = [];
  private depTimer = 60;
  private reentry: { ac: SimAircraft; at: number }[] = [];
  private incidentKeys = new Set<string>();
  incidents: { t: number; rw: string; a: string; b: string }[] = [];
  private autoTimers = new Map<string, number>();

  constructor(public layout: AirportLayout, public graph: TaxiGraph, public radio: Radio, public opts: SimOptions) {
    // fleet grows with the size of the ramp
    const k = Math.max(1, Math.min(3, graph.stands.length / 60));
    const c = (base: number) => Math.round(base * k);
    this.fleet = new Fleet(graph, layout, {
      fuel: c(3), catering: c(3), baggage: c(4), cleaning: c(2), tug: c(3), followme: 2, fire: 3,
    });
    const ends = layout.runways.flatMap((r) => r.ends);
    this.arrEnd = ends[0];
    this.depEnd = ends[0];
  }

  // ---------------- setup ----------------

  setWind(w: Wind) {
    this.wind = w;
    const ends = this.layout.runways.flatMap((r) => r.ends);
    const score = (e: RunwayEnd) => Math.cos(((w.dir - e.heading) * Math.PI) / 180) * Math.max(3, w.speed) + e.runway.length / 4000;
    const best = ends.slice().sort((a, b) => score(b) - score(a))[0];
    const parallel = ends.filter((e) => e.runway !== best.runway && Math.abs(angleDiff(e.heading, best.heading)) < 25 && e.runway.length > 1800);
    this.arrEnd = best;
    this.depEnd = parallel.sort((a, b) => b.runway.length - a.runway.length)[0] ?? best;
  }

  setRunways(arr: RunwayEnd, dep: RunwayEnd) {
    this.arrEnd = arr;
    this.depEnd = dep;
    this.radio.say('SYS', `Runway configuration: arrivals ${arr.name}, departures ${dep.name}`);
  }

  windText(): string {
    if (this.wind.speed < 3) return 'calm';
    return `${String(Math.round(this.wind.dir / 10) * 10 || 360).padStart(3, '0')} at ${Math.round(this.wind.speed)}`;
  }

  start() {
    // dormant aircraft fill part of the ramp, a few are about to become active
    const stands = this.graph.stands.slice().sort(() => Math.random() - 0.5);
    const fill = Math.min(70, Math.floor(stands.length * 0.4));
    let placed = 0;
    for (const st of stands) {
      if (placed >= fill) break;
      if (!this.standFree(st)) continue;
      const spec = this.typeFor(st.maxSpan);
      if (!spec) continue;
      const ac = new SimAircraft(this.newCallsign(), spec, 'DEP', this.opts.iata, pick(DESTS.filter((d) => d !== this.opts.iata)));
      this.parkAt(ac, st);
      ac.dormant = true;
      ac.std = this.time + rand(1500, 3 * 3600); // later today's departures, shown on the board
      this.aircraft.push(ac);
      placed++;
    }
    // three active departures in different states
    const dormant = this.aircraft.filter((a) => a.dormant);
    dormant.slice(0, 3).forEach((ac, i) => {
      ac.dormant = false;
      if (i === 0) {
        ac.phase = 'READY';
        ac.std = this.time + 60;
        this.say('PILOT', `${this.opts.radioName} Ground, ${ac.tel}, stand ${ac.stand!.ref}, ready for pushback`, ac);
      } else {
        this.beginTurnaround(ac, i === 1 ? 2 : 4);
        ac.std = this.time + (i === 1 ? 600 : 900);
      }
    });
    this.spawnArrival(9000);
    this.arrTimer = DIFF[this.opts.difficulty].arr * 0.6;
    this.radio.say('SYS', `${this.layout.name}: ${this.graph.stands.length} stands, ${this.layout.runways.length} runways. Arrivals ${this.arrEnd.name}, departures ${this.depEnd.name}. Wind ${this.windText()}.`);
  }

  private typeFor(maxSpan: number): TypeSpec | null {
    for (let i = 0; i < 12; i++) {
      const t = TYPES[weighted(SIM_TYPE_POOL)];
      if (t.span <= maxSpan + 2) return t;
    }
    return maxSpan >= 36 ? TYPES.A320 : maxSpan >= 29 ? TYPES.E190 : null;
  }

  private newCallsign(): string {
    for (let i = 0; i < 50; i++) {
      const code = pick(this.opts.airlines);
      const cs = `${code}${Math.floor(rand(10, 2999))}`;
      if (!this.aircraft.some((a) => a.callsign === cs) && !this.planned.some((p) => p.callsign === cs)) return cs;
    }
    return `SIM${nextId}`;
  }

  standFree(st: Stand, exceptId?: string): boolean {
    if (st.occupant && st.occupant !== exceptId) return false;
    return st.conflicts.every((i) => {
      const o = this.graph.stands[i].occupant;
      return !o || o === exceptId;
    });
  }

  findStand(spec: TypeSpec, exceptId?: string): Stand | null {
    const fits = this.graph.stands.filter((s) => this.standFree(s, exceptId) && s.maxSpan + 2 >= spec.span);
    if (!fits.length) return null;
    fits.sort((a, b) => a.maxSpan - b.maxSpan);
    return pick(fits.slice(0, Math.min(10, fits.length)));
  }

  compatibleStands(ac: SimAircraft): Stand[] {
    return this.graph.stands.filter((s) => (s === ac.stand || this.standFree(s, ac.id)) && s.maxSpan + 2 >= ac.spec.span);
  }

  private parkAt(ac: SimAircraft, st: Stand) {
    ac.stand = st;
    st.occupant = ac.id;
    ac.pos = { ...st.stop.p };
    ac.heading = st.heading;
    ac.phase = 'PARKED';
    ac.alt = 0;
    ac.speed = 0;
    ac.path = null;
  }

  private beginTurnaround(ac: SimAircraft, pending: number) {
    ac.phase = 'PARKED';
    ac.onBlocksAt = this.time;
    ac.minTurn = ac.kind === 'ARR' ? 240 : 120;
    const kinds = SERVICE_KINDS.slice().sort(() => Math.random() - 0.5);
    for (const k of SERVICE_KINDS) ac.services[k] = 'done';
    for (const k of kinds.slice(0, pending)) ac.services[k] = 'todo';
    ac.serviceProgress = {};
  }

  // ---------------- schedule ----------------

  /** Keep a short queue of planned arrivals so the board can show them before they appear. */
  private fillPlan() {
    while (this.planned.length < 6) {
      const seed = this.seedFlights.find((f) => !this.aircraft.some((a) => a.callsign === f.callsign) && !this.planned.some((p) => p.callsign === f.callsign));
      if (seed && Math.random() < 0.7) {
        this.seedFlights.splice(this.seedFlights.indexOf(seed), 1);
        this.planned.push({ callsign: seed.callsign, spec: typeSpec(seed.type), origin: pick(DESTS.filter((d) => d !== this.opts.iata)) });
      } else {
        this.planned.push({ callsign: this.newCallsign(), spec: TYPES[weighted(SIM_TYPE_POOL)], origin: pick(DESTS.filter((d) => d !== this.opts.iata)) });
      }
    }
  }

  /** Planned arrivals with an estimated touchdown time (sim seconds). */
  upcomingArrivals(): { callsign: string; origin: string; spec: TypeSpec; eta: number }[] {
    this.fillPlan();
    const gap = DIFF[this.opts.difficulty].arr;
    const firstSpawn = this.time + Math.max(0, this.arrTimer);
    return this.planned.map((p, i) => ({ ...p, eta: firstSpawn + i * gap + 16000 / 75 }));
  }

  private logHistory(kind: 'ARR' | 'DEP', ac: SimAircraft, t: number) {
    this.history.push({ kind, callsign: ac.callsign, place: kind === 'ARR' ? ac.origin : ac.dest, stand: ac.stand?.ref ?? ac.gateRef, t, std: ac.std || t });
    if (this.history.length > 60) this.history.shift();
  }

  // ---------------- spawning ----------------

  private spawnArrival(dist0 = 16000, reuse?: SimAircraft): boolean {
    let ac = reuse;
    if (!ac) {
      this.fillPlan();
      const plan = this.planned[0];
      const st = this.findStand(plan.spec);
      if (!st) return false;
      this.planned.shift();
      ac = new SimAircraft(plan.callsign, plan.spec, 'ARR', plan.origin, this.opts.iata);
      ac.stand = st;
      st.occupant = ac.id;
      if (Math.random() < (this.opts.difficulty === 'easy' ? 0.02 : 0.05)) {
        ac.emergency = true;
        ac.squawk = '7700';
      }
      this.aircraft.push(ac);
    }
    ac.phase = 'APPROACH';
    ac.rwy = this.arrEnd;
    ac.finalDist = dist0;
    ac.speed = 165 * KT;
    ac.clearedLand = false;
    ac.said.clear();
    this.updateApproach(ac, 0);
    const nm = Math.round(dist0 / 1852);
    if (ac.emergency) {
      this.stats.emergencies++;
      this.say('PILOT', `Mayday, mayday, mayday, ${ac.tel}, engine failure, ${nm} miles final runway ${ac.rwy.name}, request emergency services`, ac);
      this.onAlert(`${ac.callsign} declared an EMERGENCY — alert fire services`, 'bad');
    } else {
      this.say('PILOT', `${this.opts.radioName} Tower, ${ac.tel}, ${nm} mile final runway ${ac.rwy.name}`, ac);
    }
    return true;
  }

  private canSpawnArrival(): boolean {
    const app = this.aircraft.filter((a) => a.phase === 'APPROACH');
    if (app.length >= DIFF[this.opts.difficulty].maxApp) return false;
    const last = Math.max(0, ...app.map((a) => a.finalDist));
    return last < 16000 - 7500;
  }

  // ---------------- main update ----------------

  update(dt: number) {
    this.time += dt;
    this.fleet.update(dt);

    // spawns
    this.arrTimer -= dt;
    this.depTimer -= dt;
    const re = this.reentry[0];
    if (re && re.at <= this.time && this.canSpawnArrival()) {
      this.reentry.shift();
      this.spawnArrival(16000, re.ac);
    } else if (this.arrTimer <= 0 && this.canSpawnArrival()) {
      if (this.spawnArrival()) this.arrTimer = DIFF[this.opts.difficulty].arr * rand(0.7, 1.3);
      else this.arrTimer = 20;
    }
    if (this.depTimer <= 0) {
      const dormant = this.aircraft.filter((a) => a.dormant);
      if (dormant.length) {
        const ac = pick(dormant);
        ac.dormant = false;
        ac.std = this.time + 420;
        this.beginTurnaround(ac, 2 + Math.floor(Math.random() * 3));
        this.say('RAMP', `${ac.callsign} at stand ${ac.stand?.ref} scheduled for departure to ${ac.dest}, turnaround services required`, ac, 'RAMP');
      }
      this.depTimer = DIFF[this.opts.difficulty].dep * rand(0.7, 1.3);
    }

    this.computeBlocking(dt);
    for (const ac of this.aircraft) {
      if (ac.dormant || ac.phase === 'GONE') continue;
      this.step(ac, dt);
      const req = this.request(ac);
      if (req && !req.passive) {
        ac.wait += dt;
        if (ac.wait > 60) {
          ac.delay += dt;
          this.stats.delay += dt;
          this.score -= dt * 0.25;
        }
      } else ac.wait = 0;
      this.runAuto(ac, dt, req?.key ?? null);
    }
    this.updateVehicles(dt);
    this.updateMarshallers(dt);
    this.checkRunways();
    this.aircraft = this.aircraft.filter((a) => a.phase !== 'GONE' || this.time < a.cleanupAt);
  }

  private step(ac: SimAircraft, dt: number) {
    switch (ac.phase) {
      case 'APPROACH': return this.updateApproach(ac, dt);
      case 'GO_AROUND': return this.updateGoAround(ac, dt);
      case 'ROLLOUT': return this.updateRollout(ac, dt);
      case 'TAXI_IN':
      case 'TAXI_OUT':
      case 'LINEUP':
      case 'DOCKING':
      case 'PUSHBACK':
        return this.updateGroundMove(ac, dt);
      case 'PARKED': return this.updateParked(ac);
      case 'PUSH_WAIT': return this.updatePushWait(ac);
      case 'TAKEOFF':
      case 'CLIMB':
        return this.updateTakeoff(ac, dt);
    }
  }

  // ---------------- airborne ----------------

  private updateApproach(ac: SimAircraft, dt: number) {
    const end = ac.rwy!;
    const vref = ac.spec.vref * KT;
    const target = ac.finalDist > 9000 ? 165 * KT : ac.finalDist > 3500 ? vref + ((ac.finalDist - 3500) / 5500) * (165 * KT - vref) : vref;
    ac.speed += Math.sign(target - ac.speed) * Math.min(Math.abs(target - ac.speed), 1.2 * dt);
    ac.finalDist -= ac.speed * dt;
    const f = headingVec(end.heading);
    ac.pos = { x: end.threshold.x - f.x * ac.finalDist, z: end.threshold.z - f.z * ac.finalDist };
    ac.alt = Math.max(0, (ac.finalDist + 350) * Math.tan((3 * Math.PI) / 180));
    ac.heading = end.heading;
    ac.pitch = ac.finalDist < 0 ? 4 : 2;
    if (dt === 0) return;

    if (!ac.clearedLand && ac.finalDist < 1800) {
      this.goAround(ac, 'no landing clearance', -50);
      return;
    }
    if (ac.finalDist < 700 && !ac.said.has('shortfinal')) {
      ac.said.add('shortfinal');
      const occ = this.runwayOccupants(end.runway).filter((o) => o !== ac && !(o.phase === 'TAKEOFF' && o.speed > 50));
      if (occ.length) {
        this.goAround(ac, `runway occupied by ${occ[0].callsign}`, ac.clearedLand ? -150 : -50);
        if (ac.clearedLand) this.onAlert(`Loss of separation: ${ac.callsign} cleared to land with ${occ[0].callsign} on the runway`, 'bad');
        return;
      }
    }
    if (ac.finalDist <= -350) this.touchdown(ac);
  }

  private touchdown(ac: SimAircraft) {
    const end = ac.rwy!;
    ac.phase = 'ROLLOUT';
    ac.landedAt = this.time;
    ac.alt = 0;
    ac.pitch = 0;
    ac.rwyS = 350;
    ac.path = null;
    const decel = 2.0;
    const stopS = ac.rwyS + (ac.speed ** 2 - 14 ** 2) / (2 * decel) + 40;
    const exits = this.graph.exitsFor(end).filter((x) => x.s > ac.rwyS + 50);
    const forward = (x: { node: GNode }) => x.node.edges.some((e) => {
      if (e.kind === 'runway') return false;
      const o = e.a === x.node ? e.b : e.a;
      return Math.abs(angleDiff(end.heading, headingOf(x.node.p, o.p))) < 110;
    });
    const ex = exits.find((x) => x.s >= stopS && forward(x)) ?? exits.find((x) => x.s >= stopS) ?? exits[exits.length - 1];
    if (ex) { ac.exitNode = ex.node; ac.exitS = ex.s; } else { ac.exitNode = null; ac.exitS = end.runway.length - 100; }
    this.stats.landed++;
    if (ac.emergency) {
      if (ac.fireAlerted) { this.addScore(150, `${ac.callsign} emergency landing handled — fire services were standing by`); }
      else { this.addScore(-100, `${ac.callsign} landed with an emergency but fire services were not alerted`); }
    }
  }

  goAround(ac: SimAircraft, reason: string, penalty: number) {
    if (ac.phase !== 'APPROACH') return;
    ac.phase = 'GO_AROUND';
    ac.goArounds++;
    this.stats.goArounds++;
    this.score += penalty;
    this.say('TWR', `${ac.tel}, go around, fly runway heading, climb 3000 feet`, ac);
    this.say('PILOT', `Going around, runway heading, 3000, ${ac.tel}`, ac);
    this.onAlert(`${ac.callsign} going around (${reason}) ${penalty}`, 'warn');
  }

  private updateGoAround(ac: SimAircraft, dt: number) {
    ac.speed = Math.min(85, ac.speed + 1.5 * dt);
    ac.alt += 9 * dt;
    ac.pitch = 8;
    const f = headingVec(ac.heading);
    ac.pos = { x: ac.pos.x + f.x * ac.speed * dt, z: ac.pos.z + f.z * ac.speed * dt };
    if (ac.alt > 900) {
      ac.phase = 'GONE';
      ac.cleanupAt = this.time + 1;
      // the flight rejoins the approach sequence later as a new object
      const again = new SimAircraft(ac.callsign, ac.spec, 'ARR', ac.origin, ac.dest);
      again.stand = ac.stand;
      if (ac.stand) ac.stand.occupant = again.id;
      again.emergency = ac.emergency;
      again.fireAlerted = ac.fireAlerted;
      again.goArounds = ac.goArounds;
      again.squawk = ac.squawk;
      this.aircraft.push(again);
      again.phase = 'GONE';
      again.cleanupAt = Infinity;
      this.reentry.push({ ac: again, at: this.time + 100 });
    }
  }

  private updateTakeoff(ac: SimAircraft, dt: number) {
    const vr = ac.spec.vr * KT;
    const f = headingVec(ac.heading);
    if (ac.phase === 'TAKEOFF') {
      ac.speed += 2.3 * dt;
      if (ac.speed > vr) {
        ac.pitch = Math.min(9, ac.pitch + 3 * dt);
        ac.alt += ac.speed * Math.sin((ac.pitch * 0.7 * Math.PI) / 180) * dt;
      }
      if (ac.alt > 12) {
        ac.phase = 'CLIMB';
        this.logHistory('DEP', ac, this.time);
        this.say('TWR', `${ac.tel}, contact departure, good day`, ac);
      }
    } else {
      ac.speed = Math.min(130, ac.speed + 1.2 * dt);
      ac.pitch = Math.max(6, ac.pitch - dt);
      ac.alt += ac.speed * Math.sin((7 * Math.PI) / 180) * dt;
      if (ac.alt > 2500 || dist(ac.pos, { x: 0, z: 0 }) > 18000) {
        ac.phase = 'GONE';
        ac.cleanupAt = this.time;
        this.stats.departed++;
        this.addScore(100, `${ac.callsign} departed to ${ac.dest}`, true);
      }
    }
    ac.pos = { x: ac.pos.x + f.x * ac.speed * dt, z: ac.pos.z + f.z * ac.speed * dt };
  }

  // ---------------- ground ----------------

  private updateRollout(ac: SimAircraft, dt: number) {
    const end = ac.rwy!;
    if (!ac.path) {
      const target = ac.rwyS > ac.exitS - 120 ? 12 : 14;
      ac.speed = Math.max(target, ac.speed - 2.0 * dt);
      ac.rwyS += ac.speed * dt;
      const f = headingVec(end.heading);
      ac.pos = { x: end.threshold.x + f.x * ac.rwyS, z: end.threshold.z + f.z * ac.rwyS };
      ac.heading = end.heading;
      if (ac.rwyS >= ac.exitS) this.buildVacatePath(ac);
      return;
    }
    this.updateGroundMove(ac, dt);
    if (ac.phase === 'ROLLOUT' && ac.taxiCleared && !inRunwayArea(end.runway, ac.pos, 45)) ac.phase = 'TAXI_IN';
  }

  private buildVacatePath(ac: SimAircraft) {
    const end = ac.rwy!;
    const st = ac.stand;
    let r = ac.exitNode && st ? this.graph.findPath(ac.exitNode, st.entry, [st.idx]) : null;
    if (!r && ac.exitNode) {
      // no stand route: vacate to the nearest non-runway node
      const off = ac.exitNode.edges.find((e) => e.kind !== 'runway');
      if (off) r = { nodes: [ac.exitNode, off.a === ac.exitNode ? off.b : off.a], edges: [off] };
    }
    if (!r) {
      // degenerate layout: just stop at the runway end
      ac.phase = 'VACATED';
      ac.speed = 0;
      return;
    }
    const path = new Path([ac.pos, ...r.nodes.map((n) => n.p)], [null, ...r.nodes]);
    this.setPath(ac, path, { startRunway: end.runway });
  }

  /** Assign a path and compute runway hold points along it. */
  private setPath(ac: SimAircraft, path: Path, o: { startRunway?: Runway; departRunway?: Runway } = {}) {
    ac.path = path;
    ac.s = 0;
    ac.holds = [];
    for (const iv of runwayIntervals(path, this.layout.runways)) {
      if (iv.sIn < 2) {
        if (o.startRunway && iv.runway === o.startRunway && !ac.taxiCleared && ac.phase === 'ROLLOUT') {
          const s = Math.min(path.length, iv.sOut + ac.spec.length * 0.6 + 10);
          ac.holds.push({ s, sOut: s, runway: iv.runway, kind: 'vacate', cleared: false });
        }
        continue;
      }
      if (o.departRunway && iv.runway === o.departRunway && iv.sOut >= path.length - 3) {
        ac.holds.push({ s: iv.sIn, sOut: iv.sOut, runway: iv.runway, kind: 'depart', cleared: false });
      } else {
        ac.holds.push({ s: iv.sIn, sOut: iv.sOut, runway: iv.runway, kind: 'cross', cleared: false });
      }
    }
    if (o.startRunway && !ac.holds.some((h) => h.kind === 'vacate') && ac.phase === 'ROLLOUT' && !ac.taxiCleared) {
      const s = Math.min(path.length, 120);
      ac.holds.push({ s, sOut: s, runway: o.startRunway, kind: 'vacate', cleared: false });
    }
    ac.holds.sort((a, b) => a.s - b.s);
  }

  nextHold(ac: SimAircraft): Hold | null {
    for (const h of ac.holds) if (!h.cleared && h.s >= ac.s - 0.5) return h;
    return null;
  }

  private updateGroundMove(ac: SimAircraft, dt: number) {
    const path = ac.path;
    if (!path) return;
    const reverse = ac.phase === 'PUSHBACK';
    let maxV = ac.phase === 'DOCKING' ? 2.5 : reverse ? 1.6 : ac.phase === 'LINEUP' ? 5 : ac.phase === 'ROLLOUT' ? 12 : 9;
    const turn = path.turnAhead(ac.s, 60);
    if (!reverse && turn > 35) maxV = Math.min(maxV, 4.5);
    const hold = this.nextHold(ac);
    const stopS = hold ? hold.s : path.length;
    let target = Math.min(maxV, Math.sqrt(2 * 1.2 * Math.max(0, stopS - ac.s)));
    if (ac.heldByAtc || ac.blockedFor > 0) target = 0;
    const acc = target > ac.speed ? 0.9 : 1.8;
    ac.speed += Math.sign(target - ac.speed) * Math.min(Math.abs(target - ac.speed), acc * dt);
    ac.s = Math.min(stopS, ac.s + ac.speed * dt);
    const prev = ac.pos;
    ac.pos = path.at(ac.s);
    const moved = dist(prev, ac.pos);
    if (moved > 0.01) {
      const travel = headingOf(prev, ac.pos);
      const want = reverse ? (travel + 180) % 360 : travel;
      ac.heading = (ac.heading + angleDiff(ac.heading, want) * Math.min(1, dt * (reverse ? 1.2 : 3)) + 360) % 360;
    }
    const arrived = ac.s >= stopS - 0.3 && ac.speed < 0.3;
    if (!arrived) return;
    ac.speed = 0;
    if (hold) {
      this.onHoldReached(ac, hold);
      return;
    }
    this.onPathEnd(ac);
  }

  private onHoldReached(ac: SimAircraft, h: Hold) {
    const end = this.endOf(h.runway, ac);
    if (h.kind === 'vacate') {
      if (ac.taxiCleared) { h.cleared = true; return; }
      ac.phase = 'VACATED';
      this.say('PILOT', `${this.opts.radioName} Ground, ${ac.tel}, clear of runway ${ac.rwy?.name}, request taxi to stand ${ac.stand?.ref ?? ''}`, ac);
    } else if (h.kind === 'depart') {
      if (ac.phase !== 'TAXI_OUT') return;
      ac.phase = 'HOLD_SHORT';
      this.say('PILOT', `${this.opts.radioName} Tower, ${ac.tel}, holding short runway ${end.name}, ready for departure`, ac);
    } else if (!ac.said.has(`cross${h.s}`)) {
      ac.said.add(`cross${h.s}`);
      this.say('PILOT', `${this.opts.radioName} Tower, ${ac.tel}, holding short runway ${h.runway.ref}, request crossing`, ac);
    }
  }

  private endOf(rw: Runway, ac: SimAircraft): RunwayEnd {
    if (this.depEnd.runway === rw) return this.depEnd;
    if (this.arrEnd.runway === rw) return this.arrEnd;
    return Math.abs(angleDiff(rw.ends[0].heading, ac.heading)) < 90 ? rw.ends[0] : rw.ends[1];
  }

  private onPathEnd(ac: SimAircraft) {
    switch (ac.phase) {
      case 'ROLLOUT':
        // vacated straight onto the stand route (pre-cleared)
        ac.phase = 'AT_STAND';
        this.say('PILOT', `${ac.tel}, at stand ${ac.stand?.ref}, awaiting marshaller`, ac);
        this.releaseFollowMe(ac);
        break;
      case 'TAXI_IN':
        ac.phase = 'AT_STAND';
        this.say('PILOT', `${ac.tel}, at stand ${ac.stand?.ref}, awaiting marshaller`, ac);
        this.releaseFollowMe(ac);
        break;
      case 'DOCKING': {
        ac.heading = ac.stand ? ac.stand.heading : ac.heading;
        ac.path = null;
        const m = this.marshallers.find((x) => x.acId === ac.id);
        if (m) { m.state = 'STOP'; m.t = 0; }
        this.beginTurnaround(ac, 4);
        ac.minTurn = 240;
        this.addScore(100, `${ac.callsign} on blocks at stand ${ac.stand?.ref}`, true);
        this.say('PILOT', `${ac.tel}, on blocks stand ${ac.stand?.ref}`, ac);
        this.becomeDeparture(ac);
        break;
      }
      case 'PUSHBACK': {
        ac.phase = 'PUSHED';
        if (ac.stand) { ac.gateRef = ac.stand.ref; ac.stand.occupant = null; ac.stand = null; }
        const tug = this.fleet.vehicles.find((v) => v.id === ac.tugId);
        if (tug) this.fleet.sendHome(tug);
        ac.tugId = null;
        this.say('PILOT', `${ac.tel}, pushback complete, ready to taxi`, ac);
        break;
      }
      case 'TAXI_OUT':
        // route ended without a depart hold (e.g. already on runway area)
        ac.phase = 'HOLD_SHORT';
        break;
      case 'LINEUP':
        if (ac.takeoffCleared) this.beginTakeoffRoll(ac);
        else {
          ac.phase = 'LINED_UP';
          ac.heading = ac.rwy!.heading;
        }
        break;
    }
  }

  /** An arrival on blocks becomes its outbound flight (next flight number, new destination). */
  private becomeDeparture(ac: SimAircraft) {
    this.logHistory('ARR', ac, ac.onBlocksAt);
    const num = parseInt(ac.callsign.slice(3), 10);
    const code = ac.airline;
    ac.callsign = code && !isNaN(num) ? `${code}${num + 1}` : `${ac.callsign}D`;
    ac.kind = 'DEP';
    ac.origin = this.opts.iata;
    ac.dest = pick(DESTS.filter((d) => d !== this.opts.iata));
    ac.std = ac.onBlocksAt + ac.minTurn + 300;
  }

  private updateParked(ac: SimAircraft) {
    if (ac.dormant) return;
    const allDone = SERVICE_KINDS.every((k) => ac.services[k] === 'done');
    if (allDone && this.time - ac.onBlocksAt >= ac.minTurn) {
      if (ac.kind === 'ARR') this.becomeDeparture(ac);
      ac.phase = 'READY';
      if (!ac.std) ac.std = this.time + 90;
      this.say('PILOT', `${this.opts.radioName} Ground, ${ac.tel}, stand ${ac.stand?.ref}, ready for pushback, destination ${ac.dest}`, ac);
    }
  }

  private updatePushWait(ac: SimAircraft) {
    const tug = this.fleet.vehicles.find((v) => v.id === ac.tugId);
    if (!tug) {
      const v = this.dispatchVehicle('tug', ac);
      if (v) ac.tugId = v.id;
      return;
    }
    if (tug.state === 'ATTACHED') {
      // push back along the lead-in, then swing the tail away from the taxi direction
      const st = ac.stand!;
      const route = ac.pendingRoute;
      const pushPts = st.leadIn.slice().reverse();
      if (route && route.pts.length > 1) {
        const d = headingVec(route.headingAt(0));
        const back = ac.spec.length * 0.55;
        pushPts.push({ x: st.entry.p.x - d.x * back, z: st.entry.p.z - d.z * back });
      }
      ac.phase = 'PUSHBACK';
      ac.path = new Path(pushPts);
      ac.s = 0;
      ac.holds = [];
    }
  }

  private beginTakeoffRoll(ac: SimAircraft) {
    ac.phase = 'TAKEOFF';
    ac.heading = ac.rwy!.heading;
    ac.path = null;
    ac.pitch = 0;
  }

  // ---------------- vehicles & marshallers ----------------

  private serviceSpot(ac: SimAircraft, kind: VehicleKind): XZ {
    const f = headingVec(ac.heading);
    const r = { x: -f.z, z: f.x };
    const L = ac.spec.length, S = ac.spec.span;
    const off: Record<string, [number, number]> = {
      fuel: [-L * 0.02, S * 0.24],
      catering: [-L * 0.32, 6],
      baggage: [L * 0.18, -6],
      cleaning: [-L * 0.3, -7],
      tug: [L * 0.5 + 4.5, 0],
      followme: [0, 0],
      fire: [0, 0],
    };
    const [a, b] = off[kind];
    return { x: ac.pos.x + f.x * a + r.x * b, z: ac.pos.z + f.z * a + r.z * b };
  }

  private dispatchVehicle(kind: VehicleKind, ac: SimAircraft): Vehicle | null {
    const spot = this.serviceSpot(ac, kind);
    return this.fleet.dispatch(kind, ac.id, spot, ac.stand?.entry ?? null);
  }

  private updateVehicles(dt: number) {
    for (const v of this.fleet.vehicles) {
      const ac = v.target ? this.aircraft.find((a) => a.id === v.target) : undefined;
      if (v.state === 'ARRIVED') {
        if (!ac || ac.phase === 'GONE') { this.fleet.sendHome(v); continue; }
        if (v.kind === 'tug') { v.state = 'ATTACHED'; }
        else if (v.kind === 'fire') { v.state = 'STANDBY'; }
        else if (v.kind === 'followme') { v.state = 'LEADING'; }
        else {
          v.state = 'WORKING';
          v.workTotal = v.work = SERVICE_TIME[v.kind as ServiceKind] * rand(0.85, 1.15);
          ac.services[v.kind as ServiceKind] = 'working';
        }
      }
      if (v.state === 'WORKING' && ac) {
        v.work -= dt;
        ac.serviceProgress[v.kind as ServiceKind] = 1 - v.work / v.workTotal;
        if (v.work <= 0) {
          ac.services[v.kind as ServiceKind] = 'done';
          ac.serviceProgress[v.kind as ServiceKind] = 1;
          this.stats.services++;
          this.score += 10;
          this.fleet.sendHome(v);
        }
      } else if (v.state === 'WORKING') this.fleet.sendHome(v);
      if (v.state === 'ATTACHED') {
        if (!ac || (ac.phase !== 'PUSHBACK' && ac.phase !== 'PUSH_WAIT')) { this.fleet.sendHome(v); continue; }
        const f = headingVec(ac.heading);
        const d = ac.spec.length * 0.5 + 4.5;
        v.pos = { x: ac.pos.x + f.x * d, z: ac.pos.z + f.z * d };
        v.heading = (ac.heading + 180) % 360;
      }
      if (v.state === 'LEADING') {
        if (!ac || !ac.path || (ac.phase !== 'TAXI_IN' && ac.phase !== 'VACATED' && ac.phase !== 'ROLLOUT')) { this.fleet.sendHome(v); continue; }
        const lead = Math.min(ac.path.length, ac.s + ac.spec.length * 0.5 + 30);
        const want = ac.path.at(lead);
        const k = Math.min(1, dt * 1.5);
        v.pos = { x: v.pos.x + (want.x - v.pos.x) * k, z: v.pos.z + (want.z - v.pos.z) * k };
        v.heading = ac.path.headingAt(lead);
      }
      if (v.state === 'STANDBY' && (!ac || !['APPROACH', 'ROLLOUT', 'GO_AROUND'].includes(ac.phase))) {
        this.fleet.sendHome(v);
      }
    }
  }

  private releaseFollowMe(ac: SimAircraft) {
    const v = this.fleet.vehicles.find((x) => x.id === ac.followMeId);
    if (v) this.fleet.sendHome(v);
    ac.followMeId = null;
  }

  private updateMarshallers(dt: number) {
    for (const m of this.marshallers) m.t += dt;
    this.marshallers = this.marshallers.filter((m) => !(m.state === 'STOP' && m.t > 6));
  }

  // ---------------- conflicts ----------------

  runwayOccupants(rw: Runway): SimAircraft[] {
    return this.aircraft.filter((a) => a.isActive && a.alt < 3 && a.phase !== 'PARKED' && inRunwayArea(rw, a.pos, 12));
  }

  private checkRunways() {
    for (const rw of this.layout.runways) {
      const occ = this.runwayOccupants(rw);
      if (occ.length < 2) continue;
      // only a fast mover on its own runway counts (not one passing through an intersection)
      const fast = occ.filter((a) => (a.phase === 'TAKEOFF' || (a.phase === 'ROLLOUT' && !a.path)) && a.speed > 25 && a.rwy?.runway === rw);
      for (const f of fast) {
        for (const o of occ) {
          if (o === f) continue;
          const key = [f.id, o.id].sort().join('|');
          if (this.incidentKeys.has(key)) continue;
          this.incidentKeys.add(key);
          this.stats.incursions++;
          this.score -= 250;
          this.incidents.push({ t: this.time, rw: rw.ref, a: `${f.callsign}:${f.phase}`, b: `${o.callsign}:${o.phase}` });
          this.radio.say('ALERT', `RUNWAY INCURSION on ${rw.ref}: ${f.callsign} and ${o.callsign}`);
          this.onAlert(`RUNWAY INCURSION ${rw.ref}: ${f.callsign} / ${o.callsign} (−250)`, 'bad');
        }
      }
    }
  }

  /** Aircraft cleared to cross/backtrack this runway that haven't left it yet. */
  private crossers(rw: Runway, self?: SimAircraft): SimAircraft[] {
    return this.aircraft.filter((a) => a !== self && a.isActive && a.holds.some((h) => h.kind === 'cross' && h.cleared && h.runway === rw && a.s < h.sOut));
  }

  private landingSafe(rw: Runway, self?: SimAircraft): boolean {
    if (this.crossers(rw, self).length) return false;
    return this.runwayOccupants(rw).every((o) => o === self || (o.phase === 'TAKEOFF' && o.speed > 40));
  }

  /** Another departure already lining up / rolling on this runway. */
  private runwayReserved(rw: Runway, self: SimAircraft): boolean {
    return this.aircraft.some((o) => o !== self && o.rwy?.runway === rw && (o.phase === 'LINEUP' || o.phase === 'LINED_UP' || o.phase === 'TAKEOFF'));
  }

  private takeoffSafe(ac: SimAircraft): boolean {
    const rw = ac.rwy!.runway;
    if (this.runwayOccupants(rw).some((o) => o !== ac) || this.runwayReserved(rw, ac) || this.crossers(rw, ac).length) return false;
    return !this.aircraft.some((a) => a.phase === 'APPROACH' && a.rwy?.runway === rw && a.finalDist < 4500);
  }

  private crossingSafe(h: Hold, self: SimAircraft): boolean {
    const rw = h.runway;
    if (this.runwayOccupants(rw).some((o) => o !== self && o.speed > 3)) return false;
    if (this.aircraft.some((a) => a !== self && a.rwy?.runway === rw && a.takeoffCleared && (a.phase === 'LINEUP' || a.phase === 'LINED_UP' || a.phase === 'TAKEOFF'))) return false;
    // time on the runway (a crossing ~20 s, a backtrack much longer) vs the next arrival's time to touchdown
    const needSec = (h.sOut - h.s) / 7 + 25;
    return !this.aircraft.some((a) => a.phase === 'APPROACH' && a.rwy?.runway === rw && a.finalDist / Math.max(60, a.speed) < needSec + 20);
  }

  private computeBlocking(dt: number) {
    const ground = this.aircraft.filter((a) => a.isActive && a.alt < 1 && a.phase !== 'PARKED' && a.phase !== 'READY' && a.phase !== 'PUSH_WAIT');
    const blocker = new Map<SimAircraft, SimAircraft>();
    for (const a of ground) {
      if (a.phase !== 'TAXI_IN' && a.phase !== 'TAXI_OUT') continue;
      if (this.layout.runways.some((rw) => inRunwayArea(rw, a.pos, 30))) continue; // never stop on a runway
      for (const b of ground) {
        if (a === b || b.phase === 'TAKEOFF') continue;
        const d = dist(a.pos, b.pos);
        const sep = a.spec.length / 2 + b.spec.length / 2 + 22;
        if (d > sep) continue;
        const brg = headingOf(a.pos, b.pos);
        if (Math.abs(angleDiff(a.heading, brg)) < 38) { blocker.set(a, b); break; }
      }
    }
    for (const a of ground) {
      const b = blocker.get(a);
      // mutual block: let the lower id go first
      let blocked = !!b && !(blocker.get(b) === a && a.id < b.id);
      // a long wait behind another *blocked* taxiing aircraft is a gridlock (e.g. three-way at a junction):
      // let it squeeze past. Queues behind a stationary holder never dissolve this way.
      if (blocked && a.blockedFor > 150 && b && blocker.has(b) && (b.phase === 'TAXI_IN' || b.phase === 'TAXI_OUT')) blocked = false;
      a.blockedFor = blocked ? a.blockedFor + dt : 0;
    }
  }

  // ---------------- requests (strips) ----------------

  request(ac: SimAircraft): { key: string; who: Speaker; text: string; passive?: boolean } | null {
    if (ac.dormant) return null;
    const h = this.nextHold(ac);
    const atHold = h && ac.speed < 0.3 && ac.path && Math.abs(ac.s - h.s) < 1;
    if (ac.emergency && !ac.fireAlerted && (ac.phase === 'APPROACH' || ac.phase === 'ROLLOUT')) return { key: 'fire', who: 'ALERT', text: 'EMERGENCY — alert fire services' };
    switch (ac.phase) {
      case 'APPROACH':
        return ac.clearedLand ? null : { key: 'land', who: 'TWR', text: `Request landing RWY ${ac.rwy?.name}`, passive: ac.finalDist > 9000 };
      case 'ROLLOUT':
        return ac.path && !ac.taxiCleared ? { key: 'taxiin', who: 'GND', text: 'Vacating — taxi clearance', passive: true } : null;
      case 'VACATED':
        return { key: 'taxiin', who: 'GND', text: `Request taxi to stand ${ac.stand?.ref ?? '?'}` };
      case 'TAXI_IN':
      case 'TAXI_OUT':
        if (atHold && h!.kind === 'cross') return { key: 'cross', who: 'TWR', text: `Request crossing RWY ${h!.runway.ref}` };
        if (ac.blockedFor > 20) return { key: 'blocked', who: 'GND', text: 'Blocked by traffic', passive: true };
        return null;
      case 'AT_STAND':
        return { key: 'marshal', who: 'RAMP', text: `Marshaller needed at ${ac.stand?.ref}` };
      case 'PARKED': {
        const todo = SERVICE_KINDS.filter((k) => ac.services[k] === 'todo');
        return todo.length ? { key: 'services', who: 'RAMP', text: `Needs ${todo.join(', ')}`, passive: todo.every((k) => this.fleet.available(k) === 0) } : null;
      }
      case 'READY':
        return { key: 'push', who: 'GND', text: 'Request pushback' };
      case 'PUSHED':
        return { key: 'taxiout', who: 'GND', text: `Request taxi RWY ${this.depEnd.name}` };
      case 'HOLD_SHORT':
        return { key: 'lineup', who: 'TWR', text: `Ready for departure RWY ${ac.rwy?.name ?? this.depEnd.name}` };
      case 'LINED_UP':
        return { key: 'takeoff', who: 'TWR', text: 'Lined up, awaiting takeoff clearance' };
    }
    return null;
  }

  // ---------------- automation ----------------

  private runAuto(ac: SimAircraft, dt: number, key: string | null) {
    if (!key) { this.autoTimers.delete(ac.id); return; }
    const o = this.opts;
    const tower = ['land', 'cross', 'lineup', 'takeoff', 'fire'].includes(key) && o.autoTower;
    const ground = ['taxiin', 'push', 'taxiout'].includes(key) && o.autoGround;
    const ramp = ['marshal', 'services'].includes(key) && o.autoRamp;
    if (!tower && !ground && !ramp) return;
    const t = (this.autoTimers.get(ac.id) ?? 0) + dt;
    this.autoTimers.set(ac.id, t);
    if (t < 4) return;
    this.autoTimers.set(ac.id, 0);
    switch (key) {
      case 'fire': this.alertFire(ac); break;
      case 'land': if (ac.finalDist < 8000 && this.landingSafe(ac.rwy!.runway, ac)) this.clearLanding(ac); break;
      case 'cross': { const h = this.nextHold(ac); if (h && this.crossingSafe(h, ac)) this.crossRunway(ac); break; }
      case 'lineup': {
        const rw = ac.rwy!.runway;
        if (this.takeoffSafe(ac)) this.clearTakeoff(ac);
        else if (this.runwayOccupants(rw).length === 0 && !this.runwayReserved(rw, ac) && !this.aircraft.some((a) => a.phase === 'APPROACH' && a.rwy?.runway === rw && a.finalDist < 7000)) this.lineUp(ac);
        break;
      }
      case 'takeoff': if (this.takeoffSafe(ac)) this.clearTakeoff(ac); break;
      case 'taxiin': this.taxiToStand(ac); break;
      case 'push': this.approvePushback(ac); break;
      case 'taxiout': this.taxiToRunway(ac); break;
      case 'marshal': this.marshalIn(ac); break;
      case 'services': this.dispatchAllServices(ac, true); break;
    }
  }

  // ---------------- player commands ----------------

  private say(who: Speaker, text: string, ac?: SimAircraft, _freq?: string) {
    this.radio.say(who, text, ac?.callsign);
  }

  private addScore(n: number, msg: string, quiet = false) {
    this.score += n;
    if (!quiet || n < 0) this.onAlert(`${msg} (${n > 0 ? '+' : ''}${n})`, n >= 0 ? 'good' : 'bad');
    else this.radio.say('SYS', `${msg} (+${n})`);
  }

  clearLanding(ac: SimAircraft) {
    if (ac.phase !== 'APPROACH' || ac.clearedLand) return;
    ac.clearedLand = true;
    this.say('TWR', `${ac.tel}, runway ${ac.rwy!.name}, wind ${this.windText()}, cleared to land`, ac);
    this.say('PILOT', `Cleared to land runway ${ac.rwy!.name}, ${ac.tel}`, ac);
  }

  commandGoAround(ac: SimAircraft) {
    this.goAround(ac, 'instructed by tower', 0);
  }

  taxiToStand(ac: SimAircraft, stand?: Stand) {
    if (stand && stand !== ac.stand) this.changeStand(ac, stand, true);
    if (!['VACATED', 'ROLLOUT', 'TAXI_IN'].includes(ac.phase)) return;
    if (!ac.stand) {
      const st = this.findStand(ac.spec, ac.id);
      if (!st) { this.say('GND', `${ac.tel}, hold position, no stand available`, ac); return; }
      ac.stand = st;
      st.occupant = ac.id;
    }
    ac.taxiCleared = true;
    ac.heldByAtc = false;
    for (const h of ac.holds) if (h.kind === 'vacate') h.cleared = true;
    if (ac.phase === 'VACATED') {
      // continue along the existing route (it already leads to the stand)
      ac.phase = 'TAXI_IN';
    } else if (ac.phase === 'ROLLOUT' && !ac.path) {
      // pre-cleared while rolling out; the vacate path is built at the exit
    }
    const route = ac.path ? TaxiGraph.routeNames(this.edgesAhead(ac)) : [];
    const crossings = ac.holds.filter((h) => h.kind === 'cross' && !h.cleared).map((h) => h.runway.ref);
    this.say('GND', `${ac.tel}, taxi to stand ${ac.stand.ref}${route.length ? ` via ${route.join(', ')}` : ''}${crossings.length ? `, hold short runway ${crossings[0]}` : ''}`, ac);
  }

  private edgesAhead(ac: SimAircraft) {
    const path = ac.path!;
    const edges = [];
    for (let i = Math.max(0, path.nextNodeIndex(ac.s)); i < path.nodes.length - 1; i++) {
      const a = path.nodes[i], b = path.nodes[i + 1];
      if (!a || !b) continue;
      const e = a.edges.find((x) => x.a === b || x.b === b);
      if (e) edges.push(e);
    }
    return edges;
  }

  changeStand(ac: SimAircraft, stand: Stand, quiet = false) {
    if (!['APPROACH', 'ROLLOUT', 'VACATED', 'TAXI_IN', 'GO_AROUND', 'GONE'].includes(ac.phase)) return;
    if (!this.standFree(stand, ac.id)) return;
    if (ac.stand && ac.stand.occupant === ac.id) ac.stand.occupant = null;
    ac.stand = stand;
    stand.occupant = ac.id;
    if (ac.path && (ac.phase === 'TAXI_IN' || ac.phase === 'VACATED' || ac.phase === 'ROLLOUT')) this.reroute(ac, stand.entry, [stand.idx]);
    if (!quiet) this.say('GND', `${ac.tel}, new stand ${stand.ref}`, ac);
  }

  /** Re-plan from the next graph node ahead. */
  private reroute(ac: SimAircraft, target: GNode, standOk: number[], departRunway?: Runway) {
    const path = ac.path!;
    const i = path.nextNodeIndex(ac.s + 1);
    if (i < 0) return;
    const from = path.nodes[i]!;
    const r = this.graph.findPath(from, target, standOk);
    if (!r) return;
    const keepVacate = ac.holds.filter((h) => h.kind === 'vacate' && !h.cleared && h.s > ac.s);
    const head = new Path([ac.pos, ...path.pts.slice(path.indexAfter(ac.s), i + 1)]);
    const full = new Path([...head.pts, ...r.nodes.slice(1).map((n) => n.p)], [...head.pts.map(() => null), ...r.nodes.slice(1)]);
    const phase = ac.phase;
    this.setPath(ac, full, { departRunway, startRunway: phase === 'ROLLOUT' ? ac.rwy?.runway : undefined });
    if (keepVacate.length && !ac.holds.some((h) => h.kind === 'vacate')) {
      ac.holds.push({ ...keepVacate[0], s: Math.min(full.length, keepVacate[0].s - 0) });
    }
  }

  marshalIn(ac: SimAircraft) {
    if (ac.phase !== 'AT_STAND' || !ac.stand) return;
    const st = ac.stand;
    const f = headingVec(st.heading);
    const d = ac.spec.length * 0.5 + 8;
    this.marshallers.push({ id: `M${ac.id}`, pos: { x: st.stop.p.x + f.x * d, z: st.stop.p.z + f.z * d }, heading: (st.heading + 180) % 360, acId: ac.id, state: 'GUIDE', t: 0 });
    // lead-in starts at the entry node, which is where the aircraft is
    ac.path = new Path([ac.pos, ...st.leadIn.slice(1)]);
    ac.s = 0;
    ac.holds = [];
    ac.phase = 'DOCKING';
    this.say('RAMP', `${ac.tel}, marshaller in position stand ${st.ref}, follow the marshaller's signals`, ac);
  }

  dispatchService(ac: SimAircraft, kind: ServiceKind, quiet = false): boolean {
    if (ac.phase !== 'PARKED' || ac.services[kind] !== 'todo') return false;
    const v = this.dispatchVehicle(kind, ac);
    if (!v) {
      if (!quiet) this.onAlert(`No ${kind} vehicle available — wait for one to return`, 'warn');
      return false;
    }
    ac.services[kind] = 'enroute';
    this.say('RAMP', `${{ fuel: 'Fuel truck', catering: 'Catering truck', baggage: 'Baggage team', cleaning: 'Cleaning crew' }[kind]} dispatched to ${ac.callsign} at stand ${ac.stand?.ref}`, ac);
    return true;
  }

  dispatchAllServices(ac: SimAircraft, quiet = false) {
    const missing: string[] = [];
    for (const k of SERVICE_KINDS) if (ac.services[k] === 'todo' && !this.dispatchService(ac, k, true)) missing.push(k);
    if (missing.length && !quiet) this.onAlert(`No vehicle free for ${missing.join(', ')} — dispatch again when one returns`, 'warn');
  }

  requestFollowMe(ac: SimAircraft) {
    if (ac.followMeId || !['VACATED', 'TAXI_IN', 'ROLLOUT'].includes(ac.phase)) return;
    const near = this.graph.nearestNode(ac.pos, (n) => !n.runwayId);
    const v = this.fleet.dispatch('followme', ac.id, near?.p ?? ac.pos, near);
    if (!v) { this.onAlert('No follow-me car available', 'warn'); return; }
    ac.followMeId = v.id;
    this.say('GND', `${ac.tel}, follow-me car is on its way, follow the car to stand ${ac.stand?.ref}`, ac);
  }

  alertFire(ac: SimAircraft) {
    if (ac.fireAlerted) return;
    ac.fireAlerted = true;
    const end = ac.rwy ?? this.arrEnd;
    const f = headingVec(end.heading);
    const r = { x: -f.z, z: f.x };
    let sent = 0;
    for (let i = 0; i < 2; i++) {
      const s = 700 + i * 500;
      const lat = end.runway.width / 2 + 70;
      const spot = { x: end.threshold.x + f.x * s + r.x * lat, z: end.threshold.z + f.z * s + r.z * lat };
      if (this.fleet.dispatch('fire', ac.id, spot, null)) sent++;
    }
    this.say('TWR', `Fire services, aircraft emergency, ${ac.callsign}, ${ac.spec.code}, landing runway ${end.name}, take up standby positions`, ac);
    this.radio.say('SYS', `${sent} fire tenders rolling to runway ${end.name}`);
  }

  approvePushback(ac: SimAircraft) {
    if (ac.phase !== 'READY' || !ac.stand) return;
    const entry = this.depEntry(ac);
    const r = entry ? this.graph.findPath(ac.stand.entry, entry, []) : null;
    ac.pendingRoute = r ? new Path(r.nodes.map((n) => n.p), r.nodes) : null;
    ac.phase = 'PUSH_WAIT';
    const face = ac.pendingRoute ? compass(ac.pendingRoute.headingAt(0)) : 'as required';
    this.say('GND', `${ac.tel}, pushback and start approved, face ${face}`, ac);
    this.say('PILOT', `Push and start approved, ${ac.tel}`, ac);
    const v = this.dispatchVehicle('tug', ac);
    if (v) ac.tugId = v.id;
    else this.radio.say('SYS', `All pushback tugs busy — ${ac.callsign} waiting for a tug`);
  }

  private depEntry(ac: SimAircraft): GNode | null {
    const end = this.depEnd;
    ac.rwy = end;
    const entries = this.graph.entriesFor(end);
    if (!entries.length) {
      const all = this.graph.exitsFor(end);
      return all[0]?.node ?? null;
    }
    // prefer the full-length entry; allow an intersection departure only if it's much closer
    return entries[0].node;
  }

  taxiToRunway(ac: SimAircraft) {
    if (ac.phase !== 'PUSHED') return;
    const entry = this.depEntry(ac);
    const startNode = this.graph.nearestNode(ac.pos, (n) => !n.runwayId);
    const r = entry && startNode ? this.graph.findPath(startNode, entry, []) : null;
    if (!r) { this.say('GND', `${ac.tel}, hold position, unable to find a taxi route`, ac); return; }
    const end = this.depEnd;
    const f = headingVec(end.heading);
    const entryP = r.nodes[r.nodes.length - 1].p;
    // extend onto the runway centreline so the depart hold sits at the runway edge
    const path = new Path([ac.pos, ...r.nodes.map((n) => n.p), { x: entryP.x + f.x * 50, z: entryP.z + f.z * 50 }], [null, ...r.nodes, null]);
    ac.phase = 'TAXI_OUT';
    ac.heldByAtc = false;
    this.setPath(ac, path, { departRunway: end.runway });
    const names = TaxiGraph.routeNames(r.edges);
    const crossings = ac.holds.filter((h) => h.kind === 'cross').map((h) => h.runway.ref);
    this.say('GND', `${ac.tel}, runway ${end.name}, taxi via ${names.length ? names.join(', ') : 'the apron'}${crossings.length ? `, hold short runway ${crossings[0]}` : `, hold short runway ${end.name}`}`, ac);
    this.say('PILOT', `Runway ${end.name}, taxi via ${names.join(', ') || 'apron'}, ${ac.tel}`, ac);
  }

  holdPosition(ac: SimAircraft) {
    if (!['TAXI_IN', 'TAXI_OUT', 'ROLLOUT', 'DOCKING', 'PUSHBACK', 'LINEUP'].includes(ac.phase)) return;
    ac.heldByAtc = true;
    this.say('GND', `${ac.tel}, hold position`, ac);
    this.say('PILOT', `Holding position, ${ac.tel}`, ac);
  }

  resumeTaxi(ac: SimAircraft) {
    if (!ac.heldByAtc) return;
    ac.heldByAtc = false;
    ac.blockedFor = 0;
    this.say('GND', `${ac.tel}, continue taxi`, ac);
  }

  crossRunway(ac: SimAircraft) {
    const h = this.nextHold(ac);
    if (!h || h.kind !== 'cross') return;
    h.cleared = true;
    if (h.sOut - h.s > 400) {
      this.say('TWR', `${ac.tel}, enter runway ${h.runway.ref} and backtrack, report runway vacated`, ac);
      this.say('PILOT', `Backtrack runway ${h.runway.ref}, ${ac.tel}`, ac);
    } else {
      this.say('TWR', `${ac.tel}, cross runway ${h.runway.ref}`, ac);
      this.say('PILOT', `Crossing runway ${h.runway.ref}, ${ac.tel}`, ac);
    }
  }

  lineUp(ac: SimAircraft) {
    if (ac.phase !== 'HOLD_SHORT') return;
    const h = this.nextHold(ac);
    if (h) h.cleared = true;
    ac.lineupCleared = true;
    ac.phase = 'LINEUP';
    this.say('TWR', `${ac.tel}, runway ${ac.rwy!.name}, line up and wait`, ac);
    this.say('PILOT', `Line up and wait runway ${ac.rwy!.name}, ${ac.tel}`, ac);
  }

  clearTakeoff(ac: SimAircraft) {
    if (ac.phase !== 'HOLD_SHORT' && ac.phase !== 'LINED_UP' && ac.phase !== 'LINEUP') return;
    if (ac.phase === 'HOLD_SHORT') {
      const h = this.nextHold(ac);
      if (h) h.cleared = true;
      ac.phase = 'LINEUP';
    }
    ac.takeoffCleared = true;
    this.say('TWR', `${ac.tel}, wind ${this.windText()}, runway ${ac.rwy!.name}, cleared for takeoff`, ac);
    this.say('PILOT', `Cleared for takeoff runway ${ac.rwy!.name}, ${ac.tel}`, ac);
    if (ac.phase === 'LINED_UP') this.beginTakeoffRoll(ac);
  }

  /** Clock time at the airport for display. */
  clock(startLocal: Date): Date {
    return new Date(startLocal.getTime() + this.time * 1000);
  }
}

// ---------------- helpers ----------------

export function inRunwayArea(rw: Runway, p: XZ, margin: number): boolean {
  const e = rw.ends[0];
  const along = TaxiGraph.alongRunway(e, p);
  if (along < -60 || along > rw.length + 60) return false;
  return Math.abs(TaxiGraph.lateralRunway(e, p)) < rw.width / 2 + margin;
}

/** Stretches of a path that lie inside runway protection areas. */
export function runwayIntervals(path: Path, runways: Runway[]): { runway: Runway; sIn: number; sOut: number }[] {
  const out: { runway: Runway; sIn: number; sOut: number }[] = [];
  for (const rw of runways) {
    let inside = false;
    let sIn = 0;
    const step = 3;
    for (let s = 0; s <= path.length + step; s += step) {
      const ss = Math.min(s, path.length);
      const now = inRunwayArea(rw, path.at(ss), 40);
      if (now && !inside) { inside = true; sIn = Math.max(0, ss - step); if (ss === 0) sIn = 0; }
      if (!now && inside) { inside = false; out.push({ runway: rw, sIn, sOut: ss }); }
      if (ss === path.length) break;
    }
    if (inside) out.push({ runway: rw, sIn, sOut: path.length });
  }
  return out.sort((a, b) => a.sIn - b.sIn);
}

function compass(h: number): string {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(h / 45) % 8];
}
