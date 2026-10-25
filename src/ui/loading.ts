// Loading screen: a runway-style progress bar with an aircraft riding the leading edge, a
// checklist of the real loading steps, elapsed time and rotating tips.
//
// The slow step (downloading the layout from OpenStreetMap) has no known size, so its share
// of the bar creeps forward on an easing curve; real signals (bytes received, tiles loaded,
// step changes) move it on. The bar never goes backwards and only reaches 100% when done.

export type StageId = 'map' | 'network' | 'scene' | 'imagery' | 'weather' | 'traffic';

interface Stage { id: StageId; label: string; from: number; to: number; tau: number }

const STAGES: Stage[] = [
  { id: 'map', label: 'Airport layout from OpenStreetMap', from: 2, to: 60, tau: 30 },
  { id: 'network', label: 'Taxiway & runway network', from: 60, to: 66, tau: 1 },
  { id: 'scene', label: '3D runways, terminals & tower', from: 66, to: 74, tau: 1.5 },
  { id: 'imagery', label: 'Satellite imagery', from: 74, to: 88, tau: 4 },
  { id: 'weather', label: 'Live weather (METAR)', from: 88, to: 92, tau: 2 },
  { id: 'traffic', label: 'Live air traffic', from: 92, to: 99, tau: 3 },
];

const TIPS = [
  'Press Tab to jump to the next aircraft that needs you, and Enter to give the clearance it asks for.',
  'An arrival that reaches 1 nm final without a landing clearance has to go around.',
  'Heathrow lands on 27R and departs from 27L when the wind is from the west, just like in the game.',
  'Press T for the tower view, then scroll to use the binoculars.',
  'Turnarounds need fuel, catering, baggage and cleaning trucks. Watch your ground fleet.',
  'A MAYDAY call means: alert the fire services before the aircraft lands.',
  'Press H to hide every panel for a clean view of the airport.',
  'Runway numbers are the magnetic heading divided by ten: runway 27 points west (270°).',
  'Live Watch mode shows every real aircraft around the airport, straight from ADS-B receivers.',
  'Open the FIDS board to watch the split-flap departures and arrivals update.',
  'Hand any position to the computer in Settings and run just Tower, Ground or Ramp yourself.',
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class LoadingScreen {
  private el: HTMLElement;
  private current = -1;
  private stageStart = performance.now();
  private start = performance.now();
  private explicit: number | null = null;
  private shown = 0;
  private finished = false;
  private raf = 0;
  private tipTimer = 0;
  private q = <T extends HTMLElement = HTMLElement>(k: string) => this.el.querySelector<T>(`[data-l="${k}"]`)!;

  constructor(root: HTMLElement, icao: string, name?: string) {
    root.innerHTML = `
      <div class="loader">
        <div class="loader-radar"></div>
        <div class="loader-card">
          <div class="loader-brand"><span class="logo">✈</span> AIRPORT OPS</div>
          <h2>Opening <b>${icao}</b></h2>
          <p class="loader-name">${name ?? ''}</p>
          <div class="loader-pct"><b data-l="pct">0</b><span>%</span></div>
          <div class="loader-runway">
            <div class="loader-fill" data-l="fill"></div>
            <div class="loader-plane" data-l="plane">✈</div>
          </div>
          <ol class="loader-steps">
            ${STAGES.map((s) => `<li data-stage="${s.id}"><i></i><span>${s.label}</span><small></small></li>`).join('')}
          </ol>
          <div class="loader-foot"><span data-l="elapsed">0:00</span><span data-l="note"></span></div>
          <p class="loader-tip" data-l="tip"></p>
        </div>
      </div>`;
    this.el = root.querySelector('.loader')!;
    this.showTip();
    this.tipTimer = window.setInterval(() => this.showTip(), 6500);
    this.tick();
  }

  private showTip() {
    const tip = this.q('tip');
    tip.classList.remove('in');
    window.setTimeout(() => {
      tip.textContent = `💡 ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
      tip.classList.add('in');
    }, 250);
  }

  /** Move to a loading step; earlier steps are ticked off. */
  stage(id: StageId, detail = '') {
    const i = STAGES.findIndex((s) => s.id === id);
    if (i < 0 || i === this.current) { if (detail) this.detail(detail); return; }
    this.current = i;
    this.stageStart = performance.now();
    this.explicit = null;
    STAGES.forEach((s, k) => {
      const li = this.el.querySelector<HTMLElement>(`[data-stage="${s.id}"]`)!;
      li.className = k < i ? 'done' : k === i ? 'active' : '';
      if (k < i) li.querySelector('small')!.textContent = '';
    });
    this.detail(detail);
  }

  /** Small status text under the active step. */
  detail(text: string) {
    const li = this.current >= 0 ? this.el.querySelector(`[data-stage="${STAGES[this.current].id}"] small`) : null;
    if (li) li.textContent = text;
  }

  /** Bytes of the map download received so far. */
  bytes(n: number) {
    this.detail(n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB received` : `${(n / 1024 / 1024).toFixed(1)} MB received`);
  }

  /** Known completion (0..1) of the current step, e.g. imagery tiles loaded. */
  fraction(f: number) {
    this.explicit = Math.max(this.explicit ?? 0, Math.min(1, f));
  }

  private target(): number {
    if (this.finished) return 100;
    const s = STAGES[this.current];
    if (!s) return 1;
    const t = (performance.now() - this.stageStart) / 1000;
    const f = this.explicit ?? 0.95 * (1 - Math.exp(-t / s.tau));
    return s.from + (s.to - s.from) * f;
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const target = this.target();
    this.shown += (target - this.shown) * (this.finished ? 0.25 : 0.08);
    if (target - this.shown < 0.05) this.shown = target;
    const pct = Math.min(100, this.shown);
    this.q('pct').textContent = String(Math.floor(pct));
    this.q('fill').style.width = `${pct}%`;
    this.q('plane').style.left = `${pct}%`;
    // the aircraft lifts off over the last stretch of runway
    const lift = Math.max(0, (pct - 90) / 10);
    this.q('plane').style.transform = `translate(-50%, ${-50 - lift * 120}%) rotate(${-lift * 14}deg)`;

    const elapsed = (performance.now() - this.start) / 1000;
    this.q('elapsed').textContent = mmss(elapsed);
    const onMap = STAGES[this.current]?.id === 'map';
    this.q('note').textContent = onMap && elapsed > 12
      ? 'First visit to an airport downloads its map from OpenStreetMap’s public servers. This can take a minute or two; next time it opens instantly.'
      : '';
  };

  /** Run the bar to 100%, then fade the screen out. */
  async finish(): Promise<void> {
    this.finished = true;
    this.el.querySelectorAll('[data-stage]').forEach((li) => (li.className = 'done'));
    await new Promise((r) => setTimeout(r, 650));
    this.el.classList.add('out');
    await new Promise((r) => setTimeout(r, 450));
    this.dispose();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.tipTimer);
  }
}
