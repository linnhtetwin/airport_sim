import { AIRPORTS } from '../data/airports';
import { PROVIDER_LABEL, type Provider } from '../data/flights';
import { lsGet, lsSet } from '../data/cache';
import type { GameConfig } from '../game';
import type { MapStyle } from '../world/ground';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const saved = (k: string, d: string) => lsGet(`aos:${k}`, d);

/** Config from a direct link like ?icao=EGLL&mode=live, using saved options for the rest. */
export function configFromUrl(): GameConfig | null {
  const p = new URLSearchParams(location.search);
  const icao = p.get('icao')?.toUpperCase();
  if (!icao || !/^[A-Z0-9]{4}$/.test(icao)) return null;
  return {
    icao,
    preset: AIRPORTS.find((a) => a.icao === icao),
    mode: p.get('mode') === 'live' ? 'live' : 'sim',
    difficulty: (p.get('difficulty') ?? saved('difficulty', 'normal')) as GameConfig['difficulty'],
    mapStyle: (p.get('map') ?? saved('map', 'satellite')) as MapStyle,
    provider: saved('provider', 'adsb') as Provider,
    fr24Key: saved('fr24', ''),
    faKey: saved('fa', ''),
    autoTower: saved('autoTower', '0') === '1',
    autoGround: saved('autoGround', '0') === '1',
    autoRamp: saved('autoRamp', '0') === '1',
    speech: saved('speech', '0') === '1',
  };
}

/** Airport picker and game options. Resolves with the chosen configuration. */
export function showStartScreen(root: HTMLElement): Promise<GameConfig> {
  let icao = saved('icao', 'KJFK');
  let mode: 'sim' | 'live' = saved('mode', 'sim') as 'sim' | 'live';

  root.innerHTML = `
  <div class="start">
    <div class="start-card">
      <div class="start-head">
        <span class="logo big">✈</span>
        <div><h1>AIRPORT OPS</h1><p>Run the tower, ground and ramp of a real airport — built in 3D from OpenStreetMap, with live ADS-B traffic.</p></div>
      </div>
      <h3>1 · Choose an airport</h3>
      <div class="apt-grid">${AIRPORTS.map((a) => `<button class="apt" data-icao="${a.icao}"><b>${a.icao}</b><span>${esc(a.city)}</span><small>${esc(a.name)}</small></button>`).join('')}</div>
      <div class="custom"><label>Any other airport (ICAO code) <input data-el="icao" maxlength="4" placeholder="e.g. VTCC" spellcheck="false"></label></div>
      <h3>2 · Choose a mode</h3>
      <div class="modes">
        <button class="mode" data-mode="sim"><b>🎧 ATC Simulation</b><span>You're the controller: clear landings and takeoffs, taxi aircraft, send marshallers, dispatch fuel, catering, baggage, tugs and fire crews. Real airlines operating here right now fill the schedule.</span></button>
        <button class="mode" data-mode="live"><b>📡 Live Watch</b><span>Watch real aircraft around the airport in real time from the tower — check callsign, route, altitude, speed and status of every flight.</span></button>
      </div>
      <details class="opts"><summary>Options</summary>
        <div class="opt-grid">
          <label>Difficulty <select data-el="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard (busy hub)</option></select></label>
          <label>Map <select data-el="map"><option value="satellite">Satellite imagery</option><option value="osm">OpenStreetMap</option><option value="plain">Plain</option></select></label>
          <label>Live data <select data-el="provider">${(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => `<option value="${p}">${PROVIDER_LABEL[p]}</option>`).join('')}</select></label>
          <label data-el="fr24row">Flightradar24 API key <input data-el="fr24" type="password" placeholder="paste your FR24 API token" autocomplete="off"></label>
          <label title="Adds real schedules, gates, terminals and delays. AeroAPI bills per query; the game asks at most every 5 minutes.">FlightAware AeroAPI key (optional) <input data-el="fa" type="password" placeholder="your own key for exact schedules &amp; gates" autocomplete="off"></label>
          <label class="chk"><input type="checkbox" data-el="autoTower"> Auto Tower</label>
          <label class="chk"><input type="checkbox" data-el="autoGround"> Auto Ground</label>
          <label class="chk"><input type="checkbox" data-el="autoRamp"> Auto Ramp (marshal + services)</label>
          <label class="chk"><input type="checkbox" data-el="speech"> Read radio aloud</label>
        </div>
      </details>
      <button class="go" data-el="go">Open airport ▸</button>
      <p class="fine">Airport data © OpenStreetMap contributors. Live positions from adsb.lol / OpenSky / Flightradar24. This is a game, not for real-world navigation. · <a href="#" data-consent-open>Cookie settings</a></p>
    </div>
  </div>`;

  const q = <T extends HTMLElement>(k: string) => root.querySelector<T>(`[data-el="${k}"]`)!;
  const icaoIn = q<HTMLInputElement>('icao');
  const sel = (k: string) => q<HTMLSelectElement>(k);
  const chk = (k: string) => q<HTMLInputElement>(k);
  sel('difficulty').value = saved('difficulty', 'normal');
  sel('map').value = saved('map', 'satellite');
  sel('provider').value = saved('provider', 'adsb');
  q<HTMLInputElement>('fr24').value = saved('fr24', '');
  q<HTMLInputElement>('fa').value = saved('fa', '');
  for (const k of ['autoTower', 'autoGround', 'autoRamp', 'speech']) chk(k).checked = saved(k, '0') === '1';

  const refresh = () => {
    root.querySelectorAll<HTMLElement>('.apt').forEach((b) => b.classList.toggle('on', b.dataset.icao === icao));
    root.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    q('fr24row').style.display = sel('provider').value === 'fr24' ? '' : 'none';
    if (!AIRPORTS.some((a) => a.icao === icao)) icaoIn.value = icao;
  };
  refresh();
  root.querySelectorAll<HTMLElement>('.apt').forEach((b) => b.addEventListener('click', () => { icao = b.dataset.icao!; icaoIn.value = ''; refresh(); }));
  root.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as 'sim' | 'live'; refresh(); }));
  icaoIn.addEventListener('input', () => {
    icaoIn.value = icaoIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (icaoIn.value.length === 4) { icao = icaoIn.value; refresh(); }
  });
  sel('provider').addEventListener('change', refresh);

  return new Promise((resolve) => {
    q('go').addEventListener('click', () => {
      const cfg: GameConfig = {
        icao,
        preset: AIRPORTS.find((a) => a.icao === icao),
        mode,
        difficulty: sel('difficulty').value as GameConfig['difficulty'],
        mapStyle: sel('map').value as MapStyle,
        provider: sel('provider').value as Provider,
        fr24Key: q<HTMLInputElement>('fr24').value.trim(),
        faKey: q<HTMLInputElement>('fa').value.trim(),
        autoTower: chk('autoTower').checked,
        autoGround: chk('autoGround').checked,
        autoRamp: chk('autoRamp').checked,
        speech: chk('speech').checked,
      };
      lsSet('aos:icao', icao); lsSet('aos:mode', mode);
      lsSet('aos:difficulty', cfg.difficulty); lsSet('aos:map', cfg.mapStyle); lsSet('aos:provider', cfg.provider); lsSet('aos:fr24', cfg.fr24Key); lsSet('aos:fa', cfg.faKey);
      for (const k of ['autoTower', 'autoGround', 'autoRamp', 'speech'] as const) lsSet(`aos:${k}`, cfg[k] ? '1' : '0');
      resolve(cfg);
    });
  });
}
