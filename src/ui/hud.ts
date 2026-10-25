import type { Game } from '../game';
import { AIRLINES, telephony } from '../data/airlines';
import { FT, KT, NM } from '../geo/projection';
import { PHASE_LABEL, SERVICE_KINDS, type Phase, type SimAircraft, type ServiceKind } from '../sim/simulation';
import { FLEET_LABEL } from '../sim/vehicles';
import type { LiveTrack } from '../live/liveTraffic';
import { LiveTraffic } from '../live/liveTraffic';
import type { RadioMsg } from '../sim/radio';
import { ATTRIBUTION, type MapStyle } from '../world/ground';
import { Radar } from './radar';
import type { VehicleKind } from '../world/models';
import { lsGet, lsSet } from '../data/cache';
import { cityOf } from '../data/cities';
import { Clatter, FlipBoard, type FlipColumn, type FlipRow } from './flipboard';

// split-flap board layout: time, flight, city, gate, remarks
const FIDS_COLS: FlipColumn[] = [{ width: 5 }, { width: 7, cls: 'fl' }, { width: 15 }, { width: 5 }, { width: 14, cls: 'rm' }];
const FIDS_DEP_HEAD = ['TIME', 'FLIGHT', 'DESTINATION', 'GATE', 'REMARKS'];
const FIDS_ARR_HEAD = ['TIME', 'FLIGHT', 'ORIGIN', 'GATE', 'REMARKS'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const GROUPS: { key: string; title: string; phases: Phase[] }[] = [
  { key: 'twr', title: 'Tower · runway & final', phases: ['APPROACH', 'GO_AROUND', 'ROLLOUT', 'HOLD_SHORT', 'LINEUP', 'LINED_UP', 'TAKEOFF', 'CLIMB'] },
  { key: 'gnd', title: 'Ground · taxiways', phases: ['VACATED', 'TAXI_IN', 'PUSH_WAIT', 'PUSHBACK', 'PUSHED', 'TAXI_OUT'] },
  { key: 'ramp', title: 'Ramp · stands & services', phases: ['AT_STAND', 'DOCKING', 'PARKED', 'READY'] },
];

/** Minimise/restore toggle for a panel; `label` is what stays visible when minimised (radar only). */
const minBtn = (panel: string, label = '') =>
  `<button class="min-btn" data-min="${panel}" title="Minimize / restore"><span class="when-open">–</span><span class="when-min">${label ? label + ' ' : ''}+</span></button>`;

const SERVICE_ICON: Record<ServiceKind, string> = { baggage: '🧳', catering: '🍱', cleaning: '🧹', fuel: '⛽' };

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private radar: Radar;
  private acc = 0;
  private lastStrips = '';
  private lastCmdKey = '';
  private toastsEl!: HTMLElement;
  private clatter = Object.assign(new Clatter(), { enabled: lsGet('aos:flapSound', '1') === '1' });

  constructor(private g: Game, private root: HTMLElement) {
    root.innerHTML = this.template();
    root.querySelectorAll<HTMLElement>('[data-el]').forEach((n) => (this.el[n.dataset.el!] = n));
    this.toastsEl = this.el.toasts;
    this.radar = new Radar(this.el.radar as HTMLCanvasElement, g);
    this.bind();
    this.fillRunways();
    this.updateAttribution();
    for (const m of g.radio.msgs) this.addRadio(m);
    g.radio.onMessage((m) => this.addRadio(m));
    // restore minimised panels / clean view from the last session
    for (const p of lsGet('aos:minimized', '').split(',').filter(Boolean)) this.toggleMin(p, true);
    if (lsGet('aos:clean') === '1') this.toggleClean(true);
    this.refreshTopbar();
  }

  /** Collapse a panel to its header (or the radar to a small button). */
  toggleMin(panel: string, force?: boolean) {
    const el = this.root.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
    if (!el) return;
    el.classList.toggle('min', force);
    const minimized = [...this.root.querySelectorAll<HTMLElement>('[data-panel].min')].map((n) => n.dataset.panel!);
    lsSet('aos:minimized', minimized.join(','));
  }

  /** Hide every panel for an unobstructed map; toasts and aircraft labels stay. */
  toggleClean(force?: boolean) {
    const on = this.root.classList.toggle('clean', force);
    lsSet('aos:clean', on ? '1' : '0');
  }

  private template(): string {
    const L = this.g.layout;
    return `
<header class="topbar">
  <div class="brand"><span class="logo">✈</span><div><b>AIRPORT OPS</b><small data-el="aptName">${esc(L.icao)} · ${esc(L.name)}${L.synthetic ? ' (generated layout)' : ''}</small></div></div>
  <div class="tb-mid">
    <div class="clock"><b data-el="clock">--:--</b><small data-el="clockSub">LOCAL</small></div>
    <div class="wx" data-el="wx" title=""></div>
    <label class="rwysel">ARR<select data-el="arrRwy"></select></label>
    <label class="rwysel">DEP<select data-el="depRwy"></select></label>
  </div>
  <div class="tb-right">
    <div class="seg" data-el="modeSeg"><button data-mode="sim">ATC SIM</button><button data-mode="live">LIVE</button></div>
    <div class="seg" data-el="speedSeg"><button data-speed="0" title="Pause (Space)">❚❚</button><button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button><button data-speed="8">8×</button></div>
    <div class="score" data-el="score"></div>
    <button class="icon" data-act="fids" title="Arrivals & departures board">FIDS</button>
    <button class="icon" data-act="settings" title="Settings">⚙</button>
    <button class="icon" data-act="menu" title="Change airport">⌂</button>
  </div>
</header>
<aside class="panel strips" data-panel="strips"><div class="panel-head"><span class="head-main" data-el="stripHead"></span>${minBtn('strips')}</div><div class="strip-list" data-el="strips"></div></aside>
<aside class="panel details" data-panel="details" data-el="details"><div class="panel-head"><span class="head-main" data-el="detailsHead">AIRCRAFT</span>${minBtn('details')}</div><div class="details-body" data-el="detailsBody"></div></aside>
<section class="radio panel" data-panel="radio"><div class="panel-head"><span class="head-main">RADIO <span class="freqs"><i class="twr">TWR</i><i class="gnd">GND</i><i class="ramp">RAMP</i></span></span><button class="mini" data-act="speech" data-el="speechBtn">🔇 Voice off</button>${minBtn('radio')}</div><div class="radio-log" data-el="radio"></div></section>
<nav class="cams" data-el="cams">
  <button data-act="clean" class="clean-btn" title="Hide all panels for a clean map view (H)">⤢ Hide panels</button>
  <button data-cam="overview" title="O">Overview</button>
  <button data-cam="tower" title="T">Tower view</button>
  <button data-cam="follow" title="F">Follow</button>
  <button data-cam="ramp" title="R">Ramp</button>
  <button data-cam="night" title="N">Day/Night</button>
  <button data-cam="labels" title="L">Labels</button>
  <span class="towerinfo" data-el="towerInfo"></span>
</nav>
<div class="radar-wrap" data-panel="radar"><canvas class="radar" data-el="radar" width="440" height="440" title="Click to change range"></canvas>${minBtn('radar', 'Radar')}</div>
<button class="hud-restore" data-act="clean" title="Show panels (H)">☰ Show panels</button>
<div class="toasts" data-el="toasts"></div>
<div class="modal hidden" data-el="modal"><div class="modal-box" data-el="modalBox"></div></div>
<div class="attribution" data-el="attrib"></div>`;
  }

  private bind() {
    const g = this.g;
    this.el.modeSeg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
      if (b) { g.setMode(b.dataset.mode as 'sim' | 'live'); this.refreshTopbar(); }
    });
    this.el.speedSeg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]');
      if (!b) return;
      const v = Number(b.dataset.speed);
      if (v === 0) g.paused = !g.paused; else { g.timeScale = v; g.paused = false; }
      this.refreshTopbar();
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'fids') this.showFids();
      else if (act === 'settings') this.showSettings();
      else if (act === 'menu') { if (confirm('Leave this airport and pick another?')) location.href = location.pathname; }
      else if (act === 'speech') { g.radio.setSpeech(!g.radio.speech); this.refreshTopbar(); }
      else if (act === 'close') this.el.modal.classList.add('hidden');
      else if (act === 'clean') this.toggleClean();
      const min = t.closest<HTMLElement>('[data-min]')?.dataset.min;
      if (min) this.toggleMin(min);
      const cam = t.closest<HTMLElement>('[data-cam]')?.dataset.cam;
      if (cam === 'overview') g.cameraOverview();
      else if (cam === 'tower') { g.cameraTower(); g.towerTrack = !!g.selectedId; }
      else if (cam === 'follow') g.cameraFollow();
      else if (cam === 'ramp') g.cameraRamp();
      else if (cam === 'night') g.setNight(!g.world.night);
      else if (cam === 'labels') g.showLabels = !g.showLabels;
      else if (cam === 'track') g.towerTrack = !g.towerTrack;
    });
    this.el.strips.addEventListener('click', (e) => {
      const s = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (s) g.select(s.dataset.id!);
    });
    this.el.details.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
      if (b && !b.disabled) g.command(b.dataset.cmd!, b.dataset.arg);
    });
    this.el.details.addEventListener('change', (e) => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.cmd === 'stand') g.command('stand', s.value);
    });
    this.el.radio.addEventListener('click', (e) => {
      const cs = (e.target as HTMLElement).closest<HTMLElement>('[data-cs]')?.dataset.cs;
      if (!cs) return;
      const ac = g.mode === 'sim' ? g.sim.aircraft.find((a) => a.callsign === cs && a.phase !== 'GONE') : undefined;
      if (ac) g.select(ac.id);
    });
    const rwyChange = () => {
      const ends = g.layout.runways.flatMap((r) => r.ends);
      const a = ends.find((x) => x.name === (this.el.arrRwy as HTMLSelectElement).value);
      const d = ends.find((x) => x.name === (this.el.depRwy as HTMLSelectElement).value);
      if (a && d) g.sim.setRunways(a, d);
    };
    this.el.arrRwy.addEventListener('change', rwyChange);
    this.el.depRwy.addEventListener('change', rwyChange);
    this.el.modal.addEventListener('click', (e) => { if (e.target === this.el.modal) this.el.modal.classList.add('hidden'); });
  }

  private fillRunways() {
    const ends = this.g.layout.runways.flatMap((r) => r.ends);
    const opts = ends.map((e) => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');
    (this.el.arrRwy as HTMLSelectElement).innerHTML = opts;
    (this.el.depRwy as HTMLSelectElement).innerHTML = opts;
    (this.el.arrRwy as HTMLSelectElement).value = this.g.sim.arrEnd.name;
    (this.el.depRwy as HTMLSelectElement).value = this.g.sim.depEnd.name;
  }

  updateAttribution() {
    this.el.attrib.textContent = ATTRIBUTION[this.g.cfg.mapStyle] + ' · Live traffic: adsb.lol / OpenSky / Flightradar24 · Weather: aviationweather.gov';
  }

  onModeChanged() {
    this.lastStrips = '';
    this.lastCmdKey = '';
    this.root.classList.toggle('live-mode', this.g.mode === 'live');
    this.onSelect();
    this.refreshTopbar();
  }

  onSelect() {
    this.lastCmdKey = '';
    this.lastStrips = '';
    this.renderDetails();
    this.renderStrips();
  }

  refreshTopbar() {
    const g = this.g;
    this.el.modeSeg.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === g.mode));
    this.el.speedSeg.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => {
      const v = Number(b.dataset.speed);
      b.classList.toggle('on', v === 0 ? g.paused : !g.paused && g.timeScale === v);
    });
    this.el.speedSeg.classList.toggle('hidden', g.mode === 'live');
    this.el.speechBtn.textContent = g.radio.speech ? '🔊 Voice on' : '🔇 Voice off';
    const m = g.metar;
    this.el.wx.innerHTML = `<b>WIND ${esc(g.sim.windText().toUpperCase())}</b><small>${m ? esc(m.raw.slice(0, 64)) : 'METAR unavailable — simulated wind'}</small>`;
    this.el.wx.title = m?.raw ?? '';
  }

  frame(dt: number) {
    this.acc += dt;
    this.radar.draw(dt);
    if (this.acc < 0.25) return;
    this.acc = 0;
    const g = this.g;
    const now = g.mode === 'sim' ? g.localTime() : new Date(Date.now() + new Date().getTimezoneOffset() * 60_000 + Math.round(g.layout.center.lon / 15) * 3_600_000);
    (this.el.clock as HTMLElement).textContent = `${hhmm(now)}:${String(now.getSeconds()).padStart(2, '0')}`;
    this.el.clockSub.textContent = g.mode === 'sim' ? (g.paused ? 'PAUSED' : `LOCAL · ${g.timeScale}×`) : 'LOCAL · REAL TIME';
    const st = g.sim.stats;
    this.el.score.innerHTML = g.mode === 'sim'
      ? `<b>${Math.round(g.sim.score)}</b><small>⬇${st.landed} ⬆${st.departed} ↺${st.goArounds} ⚠${st.incursions}</small>`
      : `<b>${g.live.tracks.size}</b><small>live aircraft</small>`;
    this.el.towerInfo.innerHTML = g.world.mode === 'tower'
      ? `Binoculars ×${g.world.zoomFactor.toFixed(1)} (scroll) · <button class="mini${g.towerTrack ? ' on' : ''}" data-cam="track">Track selected</button>`
      : '';
    this.renderStrips();
    this.renderDetails();
  }

  // ---------------- strips ----------------

  private renderStrips() {
    const html = this.g.mode === 'sim' ? this.simStrips() : this.liveStrips();
    if (html !== this.lastStrips) {
      this.el.strips.innerHTML = html;
      this.lastStrips = html;
    }
  }

  private simStrips(): string {
    const g = this.g, sim = g.sim;
    const active = sim.aircraft.filter((a) => a.isActive);
    const attention = active.filter((a) => { const r = sim.request(a); return r && !r.passive; }).length;
    this.el.stripHead.innerHTML = `FLIGHT STRIPS <span class="pill">${active.length} active</span>${attention ? `<span class="pill warn">${attention} waiting</span>` : ''}`;
    let out = '';
    for (const grp of GROUPS) {
      const list = active.filter((a) => grp.phases.includes(a.phase));
      list.sort((a, b) => grp.phases.indexOf(a.phase) - grp.phases.indexOf(b.phase) || a.finalDist - b.finalDist);
      out += `<div class="grp ${grp.key}"><div class="grp-head">${grp.title}<span>${list.length}</span></div>`;
      for (const ac of list) out += this.simStrip(ac);
      if (!list.length) out += '<div class="strip-empty">—</div>';
      out += '</div>';
    }
    return out;
  }

  private simStrip(ac: SimAircraft): string {
    const sim = this.g.sim;
    const req = sim.request(ac);
    let st: string = PHASE_LABEL[ac.phase];
    if (ac.phase === 'APPROACH') st = `${(ac.finalDist / NM).toFixed(1)} nm final${ac.clearedLand ? ' · cleared' : ''}`;
    if (ac.heldByAtc) st = 'Holding position';
    const pos = ac.kind === 'ARR' || ['PARKED', 'READY', 'AT_STAND', 'DOCKING', 'PUSH_WAIT', 'PUSHBACK'].includes(ac.phase) ? (ac.stand?.ref ?? '—') : (ac.rwy?.name ?? sim.depEnd.name);
    const cls = ['strip', ac.kind.toLowerCase(), ac.id === this.g.selectedId ? 'selected' : '', req && !req.passive ? 'attention' : '', ac.emergency ? 'emergency' : ''].join(' ');
    return `<div class="${cls}" data-id="${ac.id}">
      <div class="s-l"><b>${esc(ac.callsign)}</b><small>${ac.spec.code} · ${ac.kind === 'ARR' ? esc(ac.origin) + '→' : '→' + esc(ac.dest)}</small></div>
      <div class="s-m"><span>${esc(st)}</span>${req && !req.passive ? `<em class="${req.who.toLowerCase()}">${esc(req.text)}</em>` : ''}</div>
      <div class="s-r"><b>${esc(pos)}</b>${ac.wait > 30 && req && !req.passive ? `<small class="${ac.wait > 60 ? 'late' : ''}">${mmss(ac.wait)}</small>` : ac.kind === 'ARR' ? '<small>ARR</small>' : '<small>DEP</small>'}</div>
    </div>`;
  }

  private liveStrips(): string {
    const g = this.g, live = g.live;
    const age = live.lastUpdate ? Math.round((Date.now() - live.lastUpdate) / 1000) : -1;
    this.el.stripHead.innerHTML = live.error && !live.tracks.size
      ? `LIVE TRAFFIC <span class="pill warn">offline: ${esc(live.error)}</span>`
      : `LIVE TRAFFIC <span class="pill">${esc(live.source || '…')}</span><span class="pill">${age >= 0 ? `${age}s ago` : 'connecting'}</span>`;
    const tracks = live.list();
    const groups: { title: string; key: string; test: (t: LiveTrack) => boolean; max: number }[] = [
      { title: 'Arrivals · approach', key: 'twr', test: (t) => t.phase === 'Approach' || t.phase === 'Arriving', max: 40 },
      { title: 'Departures · climbing out', key: 'twr', test: (t) => t.phase === 'Departing' || t.phase === 'Climbing out', max: 40 },
      { title: 'On the ground', key: 'gnd', test: (t) => t.phase === 'Taxiing' || t.phase === 'Runway' || (t.phase === 'Parked' && t.distKm < 5), max: 80 },
      { title: 'Overflights & pattern', key: 'ramp', test: (t) => t.phase === 'Overflight' || t.phase === 'Pattern', max: 30 },
    ];
    let out = '';
    for (const grp of groups) {
      const list = tracks.filter(grp.test);
      out += `<div class="grp ${grp.key}"><div class="grp-head">${grp.title}<span>${list.length}</span></div>`;
      for (const t of list.slice(0, grp.max)) {
        const f = t.f;
        const alt = f.onGround || f.altFt == null ? 'GND' : f.altFt >= 10000 ? `FL${String(Math.round(f.altFt / 100)).padStart(3, '0')}` : `${Math.round(f.altFt / 100) * 100}ft`;
        out += `<div class="strip live ${t.id === g.selectedId ? 'selected' : ''} ${f.squawk === '7700' ? 'emergency' : ''}" data-id="${t.id}">
          <div class="s-l"><b>${esc(f.callsign)}</b><small>${esc(f.type ?? '—')}${f.origin || f.dest ? ` · ${esc(f.origin ?? '?')}→${esc(f.dest ?? '?')}` : ''}</small></div>
          <div class="s-m"><span>${t.phase}</span><em class="info">${alt} · ${Math.round(f.gs)}kt</em></div>
          <div class="s-r"><b>${t.distKm < 10 ? t.distKm.toFixed(1) : Math.round(t.distKm)}</b><small>km</small></div>
        </div>`;
      }
      if (!list.length) out += '<div class="strip-empty">—</div>';
      out += '</div>';
    }
    return out;
  }

  // ---------------- details ----------------

  private renderDetails() {
    const sel = this.g.selected();
    // header stays visible when the panel is minimised, so it names the selection
    const head = sel ? `AIRCRAFT · ${esc(sel.kind === 'sim' ? sel.ac.callsign : sel.t.f.callsign)}` : 'AIRCRAFT';
    if (this.el.detailsHead.innerHTML !== head) this.el.detailsHead.innerHTML = head;
    if (!sel) {
      if (this.lastCmdKey !== 'none') {
        this.el.detailsBody.innerHTML = `<div class="empty">Select an aircraft on the map or in the strip list.<br><br><kbd>Tab</kbd> next aircraft needing attention<br><kbd>Enter</kbd> perform the requested action<br><kbd>T</kbd> tower view · <kbd>F</kbd> follow · <kbd>O</kbd> overview<br><kbd>Space</kbd> pause · <kbd>1-4</kbd> sim speed<br><kbd>H</kbd> hide all panels · <b>–</b> minimise a panel</div>${this.g.mode === 'sim' ? this.fleetHtml() : ''}`;
        this.lastCmdKey = 'none';
      } else if (this.g.mode === 'sim') {
        const f = this.el.details.querySelector('.fleet');
        if (f) f.outerHTML = this.fleetHtml();
      }
      return;
    }
    if (sel.kind === 'sim') this.simDetails(sel.ac); else this.liveDetails(sel.t);
  }

  private fleetHtml(): string {
    const fleet = this.g.sim.fleet;
    const kinds: VehicleKind[] = ['tug', 'fuel', 'catering', 'baggage', 'cleaning', 'followme', 'fire'];
    return `<div class="fleet"><h4>Ground fleet</h4>${kinds.map((k) => {
      const a = fleet.available(k), t = fleet.total(k);
      return `<div class="fl"><span>${FLEET_LABEL[k]}</span><i style="--p:${(a / t) * 100}%"></i><b>${a}/${t}</b></div>`;
    }).join('')}</div>`;
  }

  private simDetails(ac: SimAircraft) {
    const sim = this.g.sim;
    const req = sim.request(ac);
    const hold = sim.nextHold(ac);
    const crossPending = !!hold && hold.kind === 'cross';
    const moving = ['TAXI_IN', 'TAXI_OUT', 'ROLLOUT', 'DOCKING', 'PUSHBACK', 'LINEUP'].includes(ac.phase);
    const standPhase = ['APPROACH', 'ROLLOUT', 'VACATED', 'TAXI_IN'].includes(ac.phase);
    const services = ac.phase === 'PARKED' ? SERVICE_KINDS.map((k) => `${k}:${ac.services[k]}`).join(',') : '';
    const key = [ac.id, ac.phase, ac.clearedLand, ac.taxiCleared, ac.takeoffCleared, ac.heldByAtc, crossPending, ac.followMeId, ac.fireAlerted, ac.stand?.idx, services, req?.key, sim.depEnd.name, ac.callsign].join('|');

    if (key !== this.lastCmdKey) {
      this.lastCmdKey = key;
      const airline = ac.airline ? AIRLINES[ac.airline] : undefined;
      const btn = (cmd: string, label: string, on: boolean, primary = false, arg?: string, danger = false) =>
        `<button data-cmd="${cmd}" ${arg ? `data-arg="${arg}"` : ''} ${on ? '' : 'disabled'} class="${primary && on ? 'primary' : ''}${danger ? ' danger' : ''}">${label}</button>`;
      const rk = req?.key;
      let stands = '';
      if (standPhase) {
        const list = sim.compatibleStands(ac).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
        stands = `<label class="sel">Stand <select data-cmd="stand">${list.map((s) => `<option value="${s.idx}" ${s === ac.stand ? 'selected' : ''}>${esc(s.ref)}${s.maxSpan >= 60 ? ' (heavy)' : ''}</option>`).join('')}</select></label>`;
      }
      const svc = ac.phase === 'PARKED' ? `<div class="services">${SERVICE_KINDS.map((k) => {
        const s = ac.services[k];
        const p = s === 'done' ? 100 : Math.round((ac.serviceProgress[k] ?? 0) * 100);
        return `<div class="svc ${s}" data-svc="${k}"><span>${SERVICE_ICON[k]} ${k}</span><i style="--p:${p}%"></i>${s === 'todo' ? btn('service', 'Dispatch', true, false, k) : `<small>${s === 'enroute' ? 'en route' : s === 'working' ? `${p}%` : '✓ done'}</small>`}</div>`;
      }).join('')}${btn('services', 'Dispatch all services', SERVICE_KINDS.some((k) => ac.services[k] === 'todo'), rk === 'services')}</div>` : '';

      this.el.detailsBody.innerHTML = `
        <div class="d-head ${ac.kind.toLowerCase()}${ac.emergency ? ' emergency' : ''}">
          <div><b>${esc(ac.callsign)}</b><small>"${esc(telephony(ac.callsign))}" · ${esc(airline?.name ?? 'Unknown operator')}</small></div>
          <span class="badge">${ac.kind === 'ARR' ? 'ARRIVAL' : 'DEPARTURE'}</span>
        </div>
        <div class="d-route"><b>${esc(ac.origin)}</b><span>✈</span><b>${esc(ac.dest)}</b><small>${esc(ac.spec.name)} · SQK ${ac.squawk}</small></div>
        <div class="d-status"><span data-dyn="phase"></span>${req && !req.passive ? `<em class="${req.who.toLowerCase()}">${esc(req.text)}</em>` : ''}</div>
        <div class="d-grid" data-dyn="grid"></div>
        <div class="cmds">
          <h4>Tower</h4>
          <div class="row">
            ${btn('land', 'Cleared to land', ac.phase === 'APPROACH' && !ac.clearedLand, rk === 'land')}
            ${btn('goaround', 'Go around', ac.phase === 'APPROACH', false, undefined, true)}
            ${btn('cross', `Cross RWY${crossPending ? ' ' + esc(hold!.runway.ref) : ''}`, crossPending && moving, rk === 'cross')}
            ${btn('lineup', 'Line up & wait', ac.phase === 'HOLD_SHORT', false)}
            ${btn('takeoff', 'Cleared for takeoff', ['HOLD_SHORT', 'LINED_UP'].includes(ac.phase) || (ac.phase === 'LINEUP' && !ac.takeoffCleared), rk === 'takeoff' || rk === 'lineup')}
            ${ac.emergency ? btn('fire', '🚒 Alert fire services', !ac.fireAlerted, rk === 'fire', undefined, true) : ''}
          </div>
          <h4>Ground</h4>
          <div class="row">
            ${btn('taxiin', `Taxi to stand${ac.stand ? ' ' + esc(ac.stand.ref) : ''}`, ac.phase === 'VACATED' || (ac.phase === 'ROLLOUT' && !ac.taxiCleared), rk === 'taxiin')}
            ${stands}
            ${btn('followme', '🚗 Follow-me car', ['VACATED', 'TAXI_IN', 'ROLLOUT'].includes(ac.phase) && !ac.followMeId)}
            ${btn('push', 'Approve pushback', ac.phase === 'READY', rk === 'push')}
            ${btn('taxiout', `Taxi to RWY ${esc(sim.depEnd.name)}`, ac.phase === 'PUSHED', rk === 'taxiout')}
            ${ac.heldByAtc ? btn('resume', 'Continue taxi', true, true) : btn('hold', 'Hold position', moving)}
          </div>
          <h4>Ramp & services</h4>
          <div class="row">${btn('marshal', '🦺 Send marshaller', ac.phase === 'AT_STAND', rk === 'marshal')}</div>
          ${svc}
        </div>
        <div class="row cam-row"><button data-cmd="follow">Follow camera</button><button data-cmd="tower">Watch from tower</button></div>
        ${this.fleetHtml()}`;
    }
    // dynamic values
    const phaseEl = this.el.details.querySelector('[data-dyn="phase"]');
    if (phaseEl) phaseEl.textContent = ac.heldByAtc ? 'Holding position (ATC)' : ac.blockedFor > 3 ? 'Waiting for traffic ahead' : PHASE_LABEL[ac.phase];
    const grid = this.el.details.querySelector('[data-dyn="grid"]');
    if (grid) {
      const turn = ac.phase === 'PARKED' ? `<div><small>TURNAROUND</small><b>${mmss(sim.time - ac.onBlocksAt)}</b></div>` : '';
      grid.innerHTML = `
        <div><small>ALT</small><b>${ac.alt > 2 ? Math.round(ac.alt / FT / 10) * 10 + ' ft' : 'GND'}</b></div>
        <div><small>SPEED</small><b>${Math.round(ac.speed / KT)} kt</b></div>
        <div><small>HDG</small><b>${String(Math.round(ac.heading) || 360).padStart(3, '0')}°</b></div>
        <div><small>${ac.phase === 'APPROACH' ? 'FINAL' : 'STAND'}</small><b>${ac.phase === 'APPROACH' ? (ac.finalDist / NM).toFixed(1) + ' nm' : esc(ac.stand?.ref ?? '—')}</b></div>
        <div><small>RWY</small><b>${esc(ac.rwy?.name ?? '—')}</b></div>
        <div><small>DELAY</small><b class="${ac.delay > 0 ? 'late' : ''}">${mmss(ac.delay)}</b></div>${turn}`;
    }
    if (ac.phase === 'PARKED') {
      for (const k of SERVICE_KINDS) {
        const row = this.el.details.querySelector<HTMLElement>(`[data-svc="${k}"]`);
        if (!row) continue;
        const p = ac.services[k] === 'done' ? 100 : Math.round((ac.serviceProgress[k] ?? 0) * 100);
        row.querySelector<HTMLElement>('i')?.style.setProperty('--p', `${p}%`);
        const sm = row.querySelector('small');
        if (sm && ac.services[k] === 'working') sm.textContent = `${p}%`;
      }
    }
    const f = this.el.details.querySelector('.fleet');
    if (f) f.outerHTML = this.fleetHtml();
  }

  private liveDetails(t: LiveTrack) {
    const f = t.f;
    const key = `live|${t.id}|${f.origin}|${f.dest}`;
    if (key !== this.lastCmdKey) {
      this.lastCmdKey = key;
      const code = LiveTraffic.airline(t);
      const airline = code ? AIRLINES[code] : undefined;
      const spec = LiveTraffic.spec(t);
      this.el.detailsBody.innerHTML = `
        <div class="d-head live${f.squawk === '7700' ? ' emergency' : ''}">
          <div><b>${esc(f.callsign)}</b><small>${esc(airline ? `"${telephony(f.callsign)}" · ${airline.name}` : f.reg ?? 'Private / unknown operator')}</small></div>
          <span class="badge">LIVE</span>
        </div>
        <div class="d-route"><b>${esc(f.origin ?? '???')}</b><span>✈</span><b>${esc(f.dest ?? '???')}</b>${f.originName ? `<small>${esc(f.originName)} → ${esc(f.destName ?? '?')}</small>` : ''}<small>${esc(f.type ? `${f.type} (${spec.name})` : spec.name)}${f.reg ? ' · ' + esc(f.reg) : ''}</small></div>
        <div class="d-status"><span data-dyn="phase"></span></div>
        <div class="d-grid" data-dyn="grid"></div>
        <div class="row cam-row"><button data-cmd="follow">Follow camera</button><button data-cmd="tower">Watch from tower</button></div>
        <p class="note">Real-time ADS-B position, smoothed between updates. Route data from the adsbdb.com callsign database (may be missing or out of date for some flights). Live mode is view-only — switch to ATC SIM to give instructions.</p>`;
    }
    const phaseEl = this.el.details.querySelector('[data-dyn="phase"]');
    if (phaseEl) phaseEl.textContent = t.phase + (f.squawk === '7700' ? ' · EMERGENCY (7700)' : f.squawk === '7600' ? ' · RADIO FAILURE (7600)' : '');
    const grid = this.el.details.querySelector('[data-dyn="grid"]');
    if (grid) {
      const eta = t.phase === 'Approach' || t.phase === 'Arriving' ? (t.distKm * 1000) / Math.max(30, f.gs * KT) : null;
      const age = Math.round((Date.now() - f.seenAt) / 1000);
      grid.innerHTML = `
        <div><small>ALT</small><b>${f.onGround || f.altFt == null ? 'GND' : Math.round(f.altFt).toLocaleString() + ' ft'}</b></div>
        <div><small>GROUND SPD</small><b>${Math.round(f.gs)} kt</b></div>
        <div><small>TRACK</small><b>${String(Math.round(f.track)).padStart(3, '0')}°</b></div>
        <div><small>V/S</small><b>${f.vrate > 0 ? '+' : ''}${Math.round(f.vrate)} fpm</b></div>
        <div><small>SQUAWK</small><b class="${f.squawk === '7700' ? 'late' : ''}">${esc(f.squawk ?? '—')}</b></div>
        <div><small>DISTANCE</small><b>${t.distKm.toFixed(1)} km</b></div>
        <div><small>ETA (est.)</small><b>${eta != null ? mmss(eta) : '—'}</b></div>
        <div><small>HEX</small><b>${esc(f.hex.toUpperCase())}</b></div>
        <div><small>DATA AGE</small><b>${age}s</b></div>`;
    }
  }

  // ---------------- radio ----------------

  private addRadio(m: RadioMsg) {
    const d = document.createElement('div');
    d.className = `msg ${m.who.toLowerCase()}`;
    const t = this.g.sim ? this.g.localTime() : new Date();
    d.innerHTML = `<time>${hhmm(t)}</time><b>${m.who === 'PILOT' ? '✈' : m.who}</b><span ${m.callsign ? `data-cs="${esc(m.callsign)}"` : ''}>${esc(m.text)}</span>`;
    const log = this.el.radio;
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.appendChild(d);
    while (log.children.length > 150) log.firstChild!.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  }

  toast(text: string, level: 'warn' | 'bad' | 'good') {
    const d = document.createElement('div');
    d.className = `toast ${level}`;
    d.textContent = text;
    this.toastsEl.appendChild(d);
    setTimeout(() => d.classList.add('out'), 5000);
    setTimeout(() => d.remove(), 5600);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild!.remove();
  }

  // ---------------- modals ----------------

  private openModal(html: string) {
    this.el.modalBox.className = 'modal-box';
    this.el.modalBox.innerHTML = `<button class="close" data-act="close">✕</button>${html}`;
    this.el.modal.classList.remove('hidden');
  }

  // ---------------- split-flap information board ----------------

  private fids: { board: FlipBoard; clock: FlipBoard; tab: 'DEP' | 'ARR'; timer: number; auto: number } | null = null;

  private showFids() {
    const g = this.g;
    this.openModal(`
      <div class="fids-board">
        <div class="fids-top">
          <div class="fids-title"><span data-el="fidsIcon">🛫</span><b data-el="fidsTitle">DEPARTURES</b><small>${esc(g.layout.name)}${g.mode === 'live' ? ' · LIVE' : ''}</small></div>
          <div class="fids-clock" data-el="fidsClock"></div>
        </div>
        <div class="fids-tabs">
          <button data-fids="DEP" class="on">Departures</button><button data-fids="ARR">Arrivals</button>
          <label><input type="checkbox" data-fids-auto> Alternate every 15 s</label>
          <button data-fids-sound class="sound">${this.clatter.enabled ? '🔊 Sound' : '🔇 Sound'}</button>
        </div>
        <div class="fids-head" data-el="fidsHead"></div>
        <div data-el="fidsMount"></div>
        <p class="fids-note">${g.mode === 'sim' ? 'Simulated schedule for this airport.' : 'Live flights near the airport. Routes and times are estimates from ADS-B data.'}</p>
      </div>`);
    const box = this.el.modalBox;
    box.classList.add('fids-modal');
    const q = (k: string) => box.querySelector<HTMLElement>(`[data-el="${k}"]`)!;
    const board = new FlipBoard(FIDS_COLS, 12, this.clatter);
    const clock = new FlipBoard([{ width: 5 }], 1, this.clatter, false);
    q('fidsMount').appendChild(board.el);
    q('fidsClock').appendChild(clock.el);
    if (this.fids) { clearInterval(this.fids.timer); clearInterval(this.fids.auto); }
    const st = { board, clock, tab: 'DEP' as 'DEP' | 'ARR', timer: 0, auto: 0 };
    this.fids = st;
    // column titles sit exactly over the first tile of each column (measured, so any font/size works)
    const placeHead = () => {
      const head = q('fidsHead');
      const cols = board.el.querySelector('.fb-row')?.querySelectorAll<HTMLElement>('.fb-col');
      if (!cols) return;
      const x0 = head.getBoundingClientRect().left;
      head.querySelectorAll<HTMLElement>('span').forEach((s, i) => {
        if (cols[i]) s.style.left = `${cols[i].getBoundingClientRect().left - x0}px`;
      });
    };
    board.el.addEventListener('scroll', placeHead);
    window.addEventListener('resize', placeHead);
    const render = () => {
      if (!board.el.isConnected || this.el.modal.classList.contains('hidden')) {
        clearInterval(st.timer);
        clearInterval(st.auto);
        if (this.fids === st) this.fids = null;
        return;
      }
      const dep = st.tab === 'DEP';
      q('fidsTitle').textContent = dep ? 'DEPARTURES' : 'ARRIVALS';
      q('fidsIcon').textContent = dep ? '🛫' : '🛬';
      const heads = dep ? FIDS_DEP_HEAD : FIDS_ARR_HEAD;
      q('fidsHead').innerHTML = heads.map((h) => `<span>${h}</span>`).join('');
      placeHead();
      board.set(dep ? this.depRows() : this.arrRows());
      clock.set([{ cells: [hhmm(this.airportNow())] }]);
      box.querySelectorAll<HTMLElement>('[data-fids]').forEach((b) => b.classList.toggle('on', b.dataset.fids === st.tab));
    };
    box.querySelectorAll<HTMLElement>('[data-fids]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.fids as 'DEP' | 'ARR'; render(); }));
    box.querySelector<HTMLInputElement>('[data-fids-auto]')!.addEventListener('change', (e) => {
      clearInterval(st.auto);
      if ((e.target as HTMLInputElement).checked) st.auto = window.setInterval(() => { st.tab = st.tab === 'DEP' ? 'ARR' : 'DEP'; render(); }, 15_000);
    });
    box.querySelector<HTMLElement>('[data-fids-sound]')!.addEventListener('click', (e) => {
      this.clatter.enabled = !this.clatter.enabled;
      lsSet('aos:flapSound', this.clatter.enabled ? '1' : '0');
      (e.currentTarget as HTMLElement).textContent = this.clatter.enabled ? '🔊 Sound' : '🔇 Sound';
    });
    render();
    st.timer = window.setInterval(render, 2000);
  }

  private airportNow(): Date {
    const g = this.g;
    return g.mode === 'sim' ? g.localTime() : new Date(Date.now() + new Date().getTimezoneOffset() * 60_000 + Math.round(g.layout.center.lon / 15) * 3_600_000);
  }

  /** Departure board rows: a few recent departures, then upcoming flights by scheduled time. */
  private depRows(): FlipRow[] {
    const g = this.g;
    const now = this.airportNow();
    const at = (simT: number) => hhmm(new Date(now.getTime() + (simT - g.sim.time) * 1000));
    if (g.mode === 'live') {
      return g.live.list()
        .filter((t) => t.f.origin === g.layout.iata || t.f.originIcao === g.layout.icao)
        .map((t): FlipRow & { k: number } => {
          const f = t.f;
          const remark = t.phase === 'Parked' ? 'AT GATE' : t.phase === 'Taxiing' ? 'TAXIING' : t.phase === 'Runway' ? 'TAKING OFF' : 'DEPARTED';
          const lamp: FlipRow['lamp'] = t.phase === 'Parked' ? 'green' : t.phase === 'Taxiing' || t.phase === 'Runway' ? 'blue' : '';
          return { k: remark === 'DEPARTED' ? 0 : 1, cells: ['', f.callsign, f.destName ?? cityOf(f.dest), this.gateNear(t), remark], lamp };
        })
        .sort((a, b) => a.k - b.k)
        .slice(0, 12);
    }
    // rows are ordered by scheduled time, like a real board; departed flights show the actual time
    const done = g.sim.history.filter((h) => h.kind === 'DEP' && g.sim.time - h.t < 1200).slice(-3)
      .map((h): FlipRow & { k: number } => ({ k: h.std, cells: [at(h.std), h.callsign, cityOf(h.place), h.stand, `DEPARTED ${at(h.t)}`] }));
    const upcoming = g.sim.aircraft
      .filter((a) => a.kind === 'DEP' && a.phase !== 'GONE' && a.phase !== 'CLIMB' && a.std > 0)
      .sort((a, b) => a.std - b.std)
      .map((a): FlipRow & { k: number } => {
        let remark: string, lamp: FlipRow['lamp'] = '';
        if (a.dormant) remark = a.std - g.sim.time > 3600 ? 'SCHEDULED' : 'ON TIME';
        else if (a.phase === 'PARKED') { remark = a.std - g.sim.time < 1200 ? 'BOARDING' : 'ON TIME'; if (remark === 'BOARDING') lamp = 'green'; }
        else if (a.phase === 'READY' || a.phase === 'PUSH_WAIT') { remark = 'GATE CLOSED'; lamp = 'blue'; }
        else if (a.phase === 'PUSHBACK' || a.phase === 'PUSHED') { remark = 'PUSHBACK'; lamp = 'blue'; }
        else if (a.phase === 'TAKEOFF') { remark = 'TAKING OFF'; lamp = 'blue'; }
        else { remark = 'TAXIING'; lamp = 'blue'; }
        if (g.sim.time > a.std + 60 && (a.dormant || a.phase === 'PARKED' || a.phase === 'READY')) { remark = 'DELAYED'; lamp = 'amber'; }
        return { k: a.std, cells: [at(a.std), a.callsign, cityOf(a.dest), a.stand?.ref ?? a.gateRef, remark], lamp };
      });
    return [...done, ...upcoming].sort((a, b) => a.k - b.k).slice(0, 12);
  }

  /** Arrival board rows: recent arrivals, aircraft on approach or landed, then planned flights. */
  private arrRows(): FlipRow[] {
    const g = this.g;
    const now = this.airportNow();
    const at = (simT: number) => hhmm(new Date(now.getTime() + (simT - g.sim.time) * 1000));
    if (g.mode === 'live') {
      const inbound = g.live.list().filter((t) => t.f.dest === g.layout.iata || t.f.destIcao === g.layout.icao || t.phase === 'Approach');
      return inbound.map((t): FlipRow & { k: number } => {
        const f = t.f;
        const etaSec = (t.distKm * 1000) / Math.max(40, f.gs * KT);
        const onGround = t.phase === 'Parked' || t.phase === 'Taxiing' || t.phase === 'Runway';
        const remark = t.phase === 'Parked' ? 'ARRIVED' : t.phase === 'Taxiing' ? 'TAXIING' : t.phase === 'Runway' ? 'LANDED' : t.distKm < 20 ? 'FINAL APPROACH' : 'EN ROUTE';
        const time = onGround ? '' : hhmm(new Date(now.getTime() + etaSec * 1000));
        const lamp: FlipRow['lamp'] = f.squawk === '7700' ? 'red' : onGround ? 'green' : t.distKm < 20 ? 'blue' : '';
        return { k: onGround ? 0 : etaSec, cells: [time, f.callsign, f.originName ?? cityOf(f.origin), onGround ? this.gateNear(t) : '', f.squawk === '7700' ? 'EMERGENCY' : remark], lamp };
      }).sort((a, b) => a.k - b.k).slice(0, 12);
    }
    const rows: (FlipRow & { k: number })[] = [];
    for (const h of g.sim.history.filter((h) => h.kind === 'ARR' && g.sim.time - h.t < 1200).slice(-3)) {
      rows.push({ k: h.t, cells: [at(h.t), h.callsign, cityOf(h.place), h.stand, `ARRIVED ${at(h.t)}`], lamp: 'green' });
    }
    for (const a of g.sim.aircraft) {
      if (a.kind !== 'ARR' || a.dormant || (a.phase === 'GONE' && a.cleanupAt !== Infinity)) continue;
      let t: number, remark: string, lamp: FlipRow['lamp'] = 'green';
      if (a.phase === 'APPROACH') {
        t = g.sim.time + a.finalDist / Math.max(60, a.speed);
        remark = a.finalDist < 9000 ? 'FINAL APPROACH' : 'APPROACHING';
        lamp = 'blue';
      } else if (a.phase === 'GO_AROUND' || a.phase === 'GONE') {
        t = g.sim.time + 300;
        remark = 'GO-AROUND';
        lamp = 'amber';
      } else {
        t = a.landedAt || g.sim.time;
        remark = `LANDED ${at(t)}`;
      }
      if (a.emergency && a.phase === 'APPROACH') { remark = 'EMERGENCY'; lamp = 'red'; }
      rows.push({ k: t, cells: [at(t), a.callsign, cityOf(a.origin), a.stand?.ref ?? '', remark], lamp });
    }
    for (const p of g.sim.upcomingArrivals()) {
      rows.push({ k: p.eta, cells: [at(p.eta), p.callsign, cityOf(p.origin), '', 'EXPECTED'], lamp: '' });
    }
    return rows.sort((a, b) => a.k - b.k).slice(0, 12);
  }

  /** Stand nearest a live aircraft on the ground (for the gate column). */
  private gateNear(t: LiveTrack): string {
    if (t.alt > 15) return '';
    let best = '', bd = 70;
    for (const s of this.g.graph.stands) {
      const d = Math.hypot(s.stop.p.x - t.pos.x, s.stop.p.z - t.pos.z);
      if (d < bd) { bd = d; best = s.ref; }
    }
    return best;
  }

  private showSettings() {
    const g = this.g, o = g.sim.opts;
    this.openModal(`<h2>Settings</h2>
      <div class="settings">
        <h4>Automation (let the computer handle a position)</h4>
        <label><input type="checkbox" data-set="autoTower" ${o.autoTower ? 'checked' : ''}> Auto Tower — landing, crossing & takeoff clearances</label>
        <label><input type="checkbox" data-set="autoGround" ${o.autoGround ? 'checked' : ''}> Auto Ground — taxi & pushback clearances</label>
        <label><input type="checkbox" data-set="autoRamp" ${o.autoRamp ? 'checked' : ''}> Auto Ramp — marshalling & turnaround services</label>
        <h4>Traffic</h4>
        <label>Difficulty <select data-set="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard (busy hub)</option></select></label>
        <h4>Display</h4>
        <label>Map <select data-set="map"><option value="satellite">Satellite imagery</option><option value="osm">OpenStreetMap</option><option value="plain">Plain</option></select></label>
        <label><input type="checkbox" data-set="speech" ${g.radio.speech ? 'checked' : ''}> Read radio calls aloud (speech synthesis)</label>
        <h4>Keyboard</h4>
        <p class="keys"><kbd>Tab</kbd> next aircraft needing attention · <kbd>Enter</kbd> do the requested action · <kbd>Esc</kbd> deselect<br>
        <kbd>T</kbd> tower view (scroll = binoculars) · <kbd>O</kbd> overview · <kbd>F</kbd> follow · <kbd>R</kbd> ramp view<br>
        <kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>4</kbd> sim speed 1×/2×/4×/8× · <kbd>N</kbd> day/night · <kbd>L</kbd> labels · <kbd>H</kbd> hide/show all panels<br>
        Each panel's <b>–</b> button minimises it to its title bar; <b>+</b> restores it.</p>
      </div>`);
    const box = this.el.modalBox;
    (box.querySelector('[data-set="difficulty"]') as HTMLSelectElement).value = o.difficulty;
    (box.querySelector('[data-set="map"]') as HTMLSelectElement).value = g.cfg.mapStyle;
    box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-set]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.set!;
      if (k === 'autoTower' || k === 'autoGround' || k === 'autoRamp') o[k] = (inp as HTMLInputElement).checked;
      else if (k === 'difficulty') o.difficulty = inp.value as typeof o.difficulty;
      else if (k === 'map') g.setMapStyle(inp.value as MapStyle);
      else if (k === 'speech') g.radio.setSpeech((inp as HTMLInputElement).checked);
      this.refreshTopbar();
    }));
  }
}
