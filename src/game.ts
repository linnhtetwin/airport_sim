import * as THREE from 'three';
import type { AirportPreset } from './data/airports';
import { DEFAULT_AIRLINES } from './data/airports';
import { loadAirport, type AirportLayout } from './data/osm';
import { FlightFeed, fetchMetar, type Metar, type Provider } from './data/flights';
import { FlightAwareFeed } from './data/flightaware';
import { airportWallClock, utcOffsetMinutes } from './data/time';
import { airlineOf } from './data/airlines';
import { FT, headingVec } from './geo/projection';
import { LiveTraffic, type LiveTrack } from './live/liveTraffic';
import { Radio } from './sim/radio';
import { Simulation, type SimAircraft, type ServiceKind, PHASE_LABEL } from './sim/simulation';
import { TaxiGraph } from './sim/taxiGraph';
import { buildAirportScene, type AirportScene } from './world/airportMeshes';
import { TileGround, type MapStyle } from './world/ground';
import { World } from './world/scene';
import { TrafficView, VehicleView, MarshallerView, type AcRender } from './world/traffic';
import { Hud } from './ui/hud';
import type { LoadingScreen } from './ui/loading';

export interface GameConfig {
  icao: string;
  preset?: AirportPreset;
  mode: 'sim' | 'live';
  difficulty: 'easy' | 'normal' | 'hard';
  mapStyle: MapStyle;
  provider: Provider;
  fr24Key: string;
  /** Player's own FlightAware AeroAPI key (optional; the site may also have one). */
  faKey: string;
  autoTower: boolean;
  autoGround: boolean;
  autoRamp: boolean;
  speech: boolean;
}

export type Selected = { kind: 'sim'; ac: SimAircraft } | { kind: 'live'; t: LiveTrack } | null;

export class Game {
  layout!: AirportLayout;
  graph!: TaxiGraph;
  world!: World;
  ground!: TileGround;
  airport!: AirportScene;
  sim!: Simulation;
  live!: LiveTraffic;
  feed!: FlightFeed;
  fa!: FlightAwareFeed;
  /** Airport's UTC offset in minutes (real time zone when known, else a longitude guess). */
  utcOffsetMin = 0;
  radio = new Radio();
  traffic = new TrafficView();
  vehicles = new VehicleView();
  marshallers = new MarshallerView();
  hud!: Hud;
  metar: Metar | null = null;

  mode: 'sim' | 'live';
  timeScale = 1;
  paused = false;
  selectedId: string | null = null;
  showLabels = true;
  towerTrack = false;
  startLocal = new Date();
  private timer = new THREE.Timer();
  private elapsed = 0;
  private liveTimer = 0;
  private liveBusy = false;
  private faTimer = 0;

  constructor(public cfg: GameConfig, private viewport: HTMLElement, private hudRoot: HTMLElement) {
    this.mode = cfg.mode;
  }

  async init(progress: LoadingScreen) {
    const p = this.cfg.preset;
    progress.stage('map', 'Checking local cache…');
    this.layout = await loadAirport(
      { icao: this.cfg.icao, fallbackCenter: p ? { lat: p.lat, lon: p.lon } : undefined, name: p?.name, iata: p?.iata, onBytes: (n) => progress.bytes(n) },
      (s) => progress.detail(s),
    );
    if (!this.layout.iata && p) this.layout.iata = p.iata;
    progress.stage('network', `${this.layout.runways.length} runways, ${this.layout.lines.length} taxi lines`);
    await tick();
    this.graph = new TaxiGraph(this.layout);
    console.info(`Taxi graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges, ${this.graph.stands.length} stands`);
    if (!this.graph.stands.length) throw new Error('No usable aircraft stands found for this airport in OpenStreetMap');

    progress.stage('scene', `${this.graph.stands.length} stands, ${this.layout.polys.length} buildings`);
    await tick();
    this.world = new World(this.viewport);
    this.ground = new TileGround(this.layout, this.cfg.mapStyle, this.world.renderer.capabilities.getMaxAnisotropy());
    this.airport = buildAirportScene(this.layout, this.graph);
    this.world.scene.add(this.ground.group, this.airport.group, this.traffic.group, this.vehicles.group, this.marshallers.group);
    this.traffic.onPick = (id) => this.select(id);

    // let the first view open on real imagery rather than grey ground (but don't wait forever)
    progress.stage('imagery', this.ground.total ? `0 / ${this.ground.total} map tiles` : 'Plain map');
    this.ground.onProgress = (done, total) => { progress.fraction(done / total); progress.detail(`${done} / ${total} map tiles`); };
    await this.ground.ready(12_000);
    this.ground.onProgress = () => {}; // late tiles keep loading quietly

    progress.stage('weather', this.layout.icao);
    this.metar = await fetchMetar(this.layout.icao);
    progress.detail(this.metar ? this.metar.raw.split(' ').slice(2, 4).join(' ') : 'Unavailable: using simulated wind');

    const airlines = this.cfg.preset?.airlines ?? DEFAULT_AIRLINES;
    this.sim = new Simulation(this.layout, this.graph, this.radio, {
      difficulty: this.cfg.difficulty,
      autoTower: this.cfg.autoTower,
      autoGround: this.cfg.autoGround,
      autoRamp: this.cfg.autoRamp,
      airlines,
      radioName: this.cfg.preset?.radio ?? (this.layout.name.split(/\s+/)[0] || this.layout.icao),
      iata: this.layout.iata || this.layout.icao,
    });
    const wdir = this.metar?.wdir ?? Math.floor(Math.random() * 36) * 10;
    this.sim.setWind({ dir: wdir, speed: this.metar?.wspd ?? 8, variable: this.metar?.wdir == null });

    this.live = new LiveTraffic(this.layout.proj, this.layout.elevation, this.layout.icao, this.layout.iata, this.layout.runways);
    // real-world events from ADS-B go to the live channel only
    this.live.onEvent = (e) => {
      this.radio.say(e.level === 'alert' ? 'ALERT' : 'LIVE', e.text, e.callsign, 'live');
      if (e.level === 'alert' && this.mode === 'live') this.hud?.toast(`Real world · ${e.text}`, 'bad');
    };
    this.feed = new FlightFeed(this.cfg.provider, this.cfg.fr24Key);
    this.radio.setSpeech(this.cfg.speech);

    progress.stage('traffic', 'Connecting to ADS-B receivers…');
    await this.pollLive(true);
    progress.detail(this.live.tracks.size ? `${this.live.tracks.size} aircraft nearby` : 'Offline: generated flights only');

    // FlightAware (if a key is available): real schedule, gates and times for this airport
    this.fa = new FlightAwareFeed(this.layout.icao, this.cfg.faKey);
    progress.detail('Checking FlightAware schedule…');
    await this.fa.refresh();
    this.faTimer = this.fa.interval;
    this.applyFlightAware();
    if (this.fa.board) progress.detail(`FlightAware: ${this.fa.board.flights.length} scheduled flights`);

    // airport local time: real time zone from the preset or FlightAware, else from longitude
    const tz = p?.tz ?? this.fa.board?.tz;
    this.utcOffsetMin = (tz ? utcOffsetMinutes(tz) : null) ?? Math.round(this.layout.center.lon / 15) * 60;
    this.startLocal = airportWallClock(this.utcOffsetMin);
    // seed the sim with real callsigns operating here right now
    const seeds = [...this.live.tracks.values()]
      .filter((t) => /^[A-Z]{3}\d/.test(t.f.callsign) && t.f.type)
      .map((t) => ({ callsign: t.f.callsign, type: t.f.type }));
    this.sim.seedFlights = seeds.sort(() => Math.random() - 0.5);
    const liveAirlines = [...new Set(seeds.map((s) => airlineOf(s.callsign)).filter((a): a is string => !!a))];
    if (liveAirlines.length >= 4) this.sim.opts.airlines = liveAirlines;

    this.hud = new Hud(this, this.hudRoot);
    this.sim.onAlert = (text, level) => { if (this.mode === 'sim') this.hud.toast(text, level); };
    this.sim.start();
    if (this.fa.board) this.sim.applySchedule(this.fa.board.flights, Date.now());
    this.setNight(this.isNightNow());
    this.cameraOverview();
    this.bindInput();
    this.setMode(this.mode);
    this.timer.connect(document); // resets the delta when the tab comes back from the background
    this.loop();
  }

  isNightNow(): boolean {
    const h = this.localTime().getHours();
    return h < 6 || h >= 19;
  }

  localTime(): Date {
    return this.sim ? this.sim.clock(this.startLocal) : this.startLocal;
  }

  setNight(n: boolean) {
    this.world.setNight(n);
    this.ground.setNight(n);
    this.airport.setNight(n);
  }

  setMapStyle(style: MapStyle) {
    this.cfg.mapStyle = style;
    this.world.scene.remove(this.ground.group);
    this.ground = new TileGround(this.layout, style, this.world.renderer.capabilities.getMaxAnisotropy());
    this.ground.setNight(this.world.night);
    this.world.scene.add(this.ground.group);
    this.hud.updateAttribution();
  }

  setMode(mode: 'sim' | 'live') {
    this.mode = mode;
    this.selectedId = null;
    this.vehicles.group.visible = mode === 'sim';
    this.marshallers.group.visible = mode === 'sim';
    this.traffic.clear();
    this.radio.setActive(mode);
    this.hud.onModeChanged();
    if (mode === 'live') this.liveTimer = 0;
  }

  // ---------------- live polling ----------------

  private async pollLive(initial = false) {
    if (this.liveBusy) return;
    this.liveBusy = true;
    try {
      const radiusNm = this.mode === 'live' ? 60 : 30;
      const r = await this.feed.fetch(this.layout.center.lat, this.layout.center.lon, radiusNm);
      this.live.ingest(r.flights, r.source);
      this.applyFlightAware();
    } catch (e) {
      this.live.error = (e as Error).message ?? 'unavailable';
      if (initial) this.radio.say('SYS', `Live traffic unavailable (${this.live.error}). Simulation uses generated flights.`);
    } finally {
      this.liveBusy = false;
    }
  }

  /**
   * Attach FlightAware schedule entries to live ADS-B tracks by callsign. FlightAware's route,
   * aircraft type and registration replace the guessed ones (adsbdb), and gates/times come along.
   */
  applyFlightAware() {
    if (!this.fa?.board || !this.live) return;
    for (const t of this.live.tracks.values()) {
      const fa = this.fa.byCallsign(t.f.callsign);
      t.fa = fa;
      if (!fa) continue;
      const f = t.f;
      f.origin = fa.origin.iata ?? f.origin;
      f.dest = fa.dest.iata ?? f.dest;
      f.originIcao = fa.origin.icao ?? f.originIcao;
      f.destIcao = fa.dest.icao ?? f.destIcao;
      f.originName = fa.origin.city ?? f.originName;
      f.destName = fa.dest.city ?? f.destName;
      f.type = f.type || fa.aircraftType;
      f.reg = f.reg || fa.registration;
    }
  }

  /** Real wall-clock time at the airport (as a shifted Date, like startLocal). */
  airportNow(): Date {
    return airportWallClock(this.utcOffsetMin);
  }

  // ---------------- main loop ----------------

  private loop = (now?: number) => {
    requestAnimationFrame(this.loop);
    this.timer.update(now);
    const dt = Math.min(0.1, this.timer.getDelta());
    this.elapsed += dt;

    // the simulation only runs while it's on screen: nothing from it may reach Live Watch
    if (!this.paused && this.mode === 'sim') {
      const simDt = dt * this.timeScale;
      const steps = Math.ceil(simDt / 0.1);
      for (let i = 0; i < steps; i++) this.sim.update(simDt / steps);
    }

    this.liveTimer -= dt;
    const interval = this.mode === 'live' ? (this.feed.provider === 'opensky' ? 15 : 6) : 30;
    if (this.liveTimer <= 0) {
      this.liveTimer = interval;
      void this.pollLive();
    }
    this.live.update(dt);
    if (this.fa?.enabled) {
      this.faTimer -= dt;
      if (this.faTimer <= 0) {
        this.faTimer = this.fa.interval;
        void this.fa.refresh().then(() => this.applyFlightAware());
      }
    }

    const states = this.mode === 'sim' ? this.simRenders() : this.liveRenders();
    this.traffic.sync(states, this.selectedId, this.elapsed, this.world.night);
    if (this.mode === 'sim') {
      this.vehicles.sync(this.sim.fleet.vehicles.map((v) => ({
        id: v.id, kind: v.kind, x: v.pos.x, z: v.pos.z, heading: v.heading,
        visible: v.state !== 'IDLE', flashing: v.state === 'OUTBOUND' || v.state === 'RETURN' || v.state === 'LEADING' || v.kind === 'fire',
      })), this.elapsed);
      this.marshallers.sync(this.sim.marshallers.map((m) => ({ id: m.id, x: m.pos.x, z: m.pos.z, heading: m.heading, state: m.state })), this.elapsed);
    }

    if (this.world.mode === 'tower' && this.towerTrack && this.selectedId) {
      const p = this.traffic.position(this.selectedId);
      if (p) this.world.towerView(this.world.towerEye, p.setY(p.y + 4));
    }
    const camDist = this.world.camera.position.distanceTo(this.world.controls.target);
    this.airport.tower.visible = this.world.mode !== 'tower'; // we're standing in the cab
    this.airport.standLabels.visible = this.world.mode === 'tower' ? this.world.zoomFactor > 3 : camDist < 1400;
    this.world.update();
    this.world.render();
    this.hud.frame(dt);
  };

  simRenders(): AcRender[] {
    const out: AcRender[] = [];
    for (const ac of this.sim.aircraft) {
      if (ac.phase === 'GONE') continue;
      const req = this.sim.request(ac);
      const alt = ac.alt;
      const airborne = alt > 2;
      const line2 = airborne ? `${String(Math.round(alt / FT / 100)).padStart(3, '0')} ${Math.round(ac.speed / 0.5144)}kt` : `${ac.spec.code} ${ac.stand && !['TAXI_OUT', 'HOLD_SHORT', 'LINEUP', 'LINED_UP', 'TAKEOFF'].includes(ac.phase) ? '▸' + ac.stand.ref : ac.rwy && ac.kind === 'DEP' ? '▸' + ac.rwy.name : ''}`;
      const status = req && !req.passive ? `<i class="req ${req.who.toLowerCase()}">${req.text}</i>` : `<i>${PHASE_LABEL[ac.phase]}</i>`;
      out.push({
        id: ac.id,
        type: ac.spec.code,
        airline: ac.airline,
        x: ac.pos.x, y: alt, z: ac.pos.z,
        heading: ac.heading,
        pitch: ac.pitch,
        gear: alt < 400,
        label: ac.dormant ? `<b>${ac.callsign}</b>` : `<b>${ac.callsign}</b><span>${line2}</span>${status}`,
        cls: `${ac.kind === 'ARR' ? 'arr' : 'dep'}${ac.dormant ? ' dormant' : ''}${req && !req.passive ? ' attention' : ''}${ac.emergency ? ' emergency' : ''}`,
        showLabel: this.showLabels && !ac.dormant,
        lights: !ac.dormant && ac.phase !== 'PARKED' && ac.phase !== 'READY',
      });
    }
    return out;
  }

  /** Stand a parked live aircraft is on, worked out again only when a new position arrives. */
  private liveStand(t: LiveTrack) {
    let memo = this.liveStands.get(t);
    if (!memo || memo.seenAt !== t.f.seenAt) {
      memo = { seenAt: t.f.seenAt, on: this.graph.standAt(t.pos) };
      this.liveStands.set(t, memo);
    }
    return memo.on;
  }
  private liveStands = new WeakMap<LiveTrack, { seenAt: number; on: ReturnType<TaxiGraph['standAt']> }>();

  liveRenders(): AcRender[] {
    const out: AcRender[] = [];
    for (const t of this.live.tracks.values()) {
      if (t.distKm > 110) continue;
      const f = t.f;
      let heading = t.heading, x = t.pos.x, z = t.pos.z;
      // A parked aircraft's reported heading is often stale (left over from landing). On a
      // stand it lines up with the stand's lead-in line instead, nose toward the gate.
      if (t.phase === 'Parked') {
        const on = this.liveStand(t);
        if (on) { heading = on.stand.parkHeading; x = on.point.x; z = on.point.z; }
      }
      const airborne = t.alt > 15 && !f.onGround;
      const line2 = airborne ? `${f.altFt != null ? (f.altFt >= 10000 ? 'FL' + String(Math.round(f.altFt / 100)).padStart(3, '0') : Math.round(f.altFt) + 'ft') : ''} ${Math.round(f.gs)}kt` : `${f.type ?? ''} ${Math.round(f.gs)}kt`;
      const route = f.origin || f.dest ? `<i>${f.origin ?? '?'} → ${f.dest ?? '?'}</i>` : `<i>${t.phase}</i>`;
      out.push({
        id: t.id,
        type: f.type ?? '',
        category: f.category,
        airline: airlineOf(f.callsign),
        x, y: t.alt, z,
        heading,
        pitch: airborne ? Math.max(-3, Math.min(10, f.vrate / 300)) : 0,
        gear: !airborne || t.alt < 600,
        label: `<b>${f.callsign}</b><span>${line2}</span>${route}`,
        cls: `live ${t.phase.toLowerCase().replace(/\s+/g, '-')}${f.squawk === '7700' ? ' emergency' : ''}`,
        showLabel: this.showLabels && (t.phase !== 'Parked' || t.distKm < 0.8),
        lights: t.phase !== 'Parked',
      });
    }
    return out;
  }

  // ---------------- selection & camera ----------------

  select(id: string | null) {
    this.selectedId = id;
    this.hud.onSelect();
  }

  selected(): Selected {
    if (!this.selectedId) return null;
    if (this.mode === 'sim') {
      const ac = this.sim.aircraft.find((a) => a.id === this.selectedId && a.phase !== 'GONE');
      return ac ? { kind: 'sim', ac } : null;
    }
    const t = this.live.tracks.get(this.selectedId);
    return t ? { kind: 'live', t } : null;
  }

  cameraOverview() {
    const b = this.layout.bounds;
    const c = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.world.overview(c, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.75 + 800);
  }

  cameraTower() {
    const eye = this.airport.towerCab.clone();
    const sel = this.selectedId ? this.traffic.position(this.selectedId) : null;
    const b = this.layout.bounds;
    const look = sel ?? new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.world.towerView(eye, look);
  }

  cameraFollow() {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.world.follow(() => this.traffic.position(id));
  }

  cameraRamp() {
    const sel = this.selected();
    if (sel?.kind === 'sim' && sel.ac.stand) {
      const st = sel.ac.stand;
      const f = headingVec(st.parkHeading);
      this.world.rampView(new THREE.Vector3(st.stop.p.x - f.x * 20, 0, st.stop.p.z - f.z * 20), st.parkHeading);
      return;
    }
    const st = this.graph.stands[Math.floor(Math.random() * this.graph.stands.length)];
    this.world.rampView(new THREE.Vector3(st.stop.p.x, 0, st.stop.p.z), st.parkHeading);
  }

  // ---------------- commands ----------------

  command(cmd: string, arg?: string) {
    const sel = this.selected();
    if (cmd === 'follow') return this.cameraFollow();
    if (cmd === 'tower') { this.cameraTower(); this.towerTrack = true; return; }
    if (sel?.kind !== 'sim') return;
    const ac = sel.ac;
    const s = this.sim;
    switch (cmd) {
      case 'land': s.clearLanding(ac); break;
      case 'goaround': s.commandGoAround(ac); break;
      case 'taxiin': s.taxiToStand(ac); break;
      case 'stand': { const st = this.graph.stands[Number(arg)]; if (st) s.changeStand(ac, st); break; }
      case 'followme': s.requestFollowMe(ac); break;
      case 'marshal': s.marshalIn(ac); break;
      case 'service': s.dispatchService(ac, arg as ServiceKind); break;
      case 'services': s.dispatchAllServices(ac); break;
      case 'push': s.approvePushback(ac); break;
      case 'taxiout': s.taxiToRunway(ac); break;
      case 'hold': s.holdPosition(ac); break;
      case 'resume': s.resumeTaxi(ac); break;
      case 'cross': s.crossRunway(ac); break;
      case 'lineup': s.lineUp(ac); break;
      case 'takeoff': s.clearTakeoff(ac); break;
      case 'fire': s.alertFire(ac); break;
    }
    this.hud.onSelect();
  }

  /** Primary action for the selected aircraft's pending request (Enter key). */
  primaryAction() {
    const sel = this.selected();
    if (sel?.kind !== 'sim') return;
    const req = this.sim.request(sel.ac);
    const map: Record<string, string> = { land: 'land', taxiin: 'taxiin', cross: 'cross', marshal: 'marshal', services: 'services', push: 'push', taxiout: 'taxiout', lineup: 'lineup', takeoff: 'takeoff', fire: 'fire' };
    if (req && map[req.key]) this.command(map[req.key]);
  }

  /** Cycle through aircraft that need the controller. */
  nextAttention() {
    if (this.mode !== 'sim') return;
    const list = this.sim.aircraft.filter((a) => a.isActive && (() => { const r = this.sim.request(a); return r && !r.passive; })());
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === this.selectedId);
    this.select(list[(i + 1) % list.length].id);
  }

  private bindInput() {
    const el = this.world.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = el.getBoundingClientRect();
      const id = this.traffic.pick(e.clientX - r.left, e.clientY - r.top, this.world.camera, r.width, r.height);
      if (id || this.world.mode !== 'tower') this.select(id);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { this.paused = !this.paused; e.preventDefault(); }
      else if (k === '1') this.timeScale = 1;
      else if (k === '2') this.timeScale = 2;
      else if (k === '3') this.timeScale = 4;
      else if (k === '4') this.timeScale = 8;
      else if (k === 't') { this.cameraTower(); this.towerTrack = !!this.selectedId; }
      else if (k === 'o') this.cameraOverview();
      else if (k === 'f') this.cameraFollow();
      else if (k === 'r') this.cameraRamp();
      else if (k === 'n') this.setNight(!this.world.night);
      else if (k === 'l') this.showLabels = !this.showLabels;
      else if (k === 'h') this.hud.toggleClean();
      else if (k === 'escape') this.select(null);
      else if (k === 'tab') { e.preventDefault(); this.nextAttention(); }
      else if (k === 'enter') this.primaryAction();
      else return;
      this.hud.refreshTopbar();
    });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
