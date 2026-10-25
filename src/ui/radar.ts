import type { Game } from '../game';
import { NM } from '../geo/projection';

/** Small ASR-style radar scope: runways, traffic blips and a rotating sweep. */
export class Radar {
  private ctx: CanvasRenderingContext2D;
  private ranges = [8, 16, 32, 64];
  private rangeIdx = 1;
  private sweep = 0;
  private acc = 0;

  constructor(private canvas: HTMLCanvasElement, private g: Game) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('click', () => (this.rangeIdx = (this.rangeIdx + 1) % this.ranges.length));
  }

  draw(dt: number) {
    this.sweep = (this.sweep + dt * 1.6) % (Math.PI * 2);
    this.acc += dt;
    if (this.acc < 1 / 20) return;
    this.acc = 0;
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const R = W / 2 - 6;
    const rangeKm = this.ranges[this.rangeIdx];
    const k = R / (rangeKm * 1000);
    const cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = 'rgba(4, 18, 14, 0.88)';
    c.fill();
    c.clip();
    // range rings
    c.strokeStyle = 'rgba(70, 200, 140, 0.18)';
    c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2); c.stroke(); }
    // runways
    c.strokeStyle = 'rgba(200, 230, 220, 0.85)';
    c.lineCap = 'round';
    for (const r of this.g.layout.runways) {
      c.lineWidth = Math.max(2, r.width * k);
      c.beginPath();
      r.pts.forEach((p, i) => (i ? c.lineTo(cx + p.x * k, cy + p.z * k) : c.moveTo(cx + p.x * k, cy + p.z * k)));
      c.stroke();
    }
    // extended centreline of the arrival runway
    if (this.g.mode === 'sim') {
      const e = this.g.sim.arrEnd;
      const r = (e.heading * Math.PI) / 180;
      c.setLineDash([4, 6]);
      c.strokeStyle = 'rgba(120, 220, 255, 0.35)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx + e.threshold.x * k, cy + e.threshold.z * k);
      c.lineTo(cx + (e.threshold.x - Math.sin(r) * 20 * NM) * k, cy + (e.threshold.z + Math.cos(r) * 20 * NM) * k);
      c.stroke();
      c.setLineDash([]);
    }
    // sweep
    const grad = c.createConicGradient(this.sweep - Math.PI / 2 - 0.6, cx, cy);
    grad.addColorStop(0, 'rgba(60,255,150,0)');
    grad.addColorStop(0.095, 'rgba(60,255,150,0.18)');
    grad.addColorStop(0.0955, 'rgba(60,255,150,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    // blips
    c.font = '15px ui-monospace, Consolas, monospace';
    const blips = this.g.mode === 'sim'
      ? this.g.sim.aircraft.filter((a) => a.isActive).map((a) => ({ id: a.id, x: a.pos.x, z: a.pos.z, air: a.alt > 5, cs: a.callsign, warn: !!this.g.sim.request(a) && !this.g.sim.request(a)!.passive, emer: a.emergency }))
      : [...this.g.live.tracks.values()].map((t) => ({ id: t.id, x: t.pos.x, z: t.pos.z, air: t.alt > 15, cs: t.f.callsign, warn: false, emer: t.f.squawk === '7700' }));
    for (const b of blips) {
      const x = cx + b.x * k, y = cy + b.z * k;
      if (Math.hypot(x - cx, y - cy) > R) continue;
      const sel = b.id === this.g.selectedId;
      c.fillStyle = b.emer ? '#ff4d4d' : sel ? '#ffffff' : b.warn ? '#ffd24a' : b.air ? '#5cffaa' : 'rgba(150, 220, 190, 0.7)';
      const s = b.air ? 4.5 : 3;
      c.fillRect(x - s / 2, y - s / 2, s, s);
      if (b.air || sel || b.warn) {
        c.fillText(b.cs, x + 6, y - 4);
      }
      if (sel) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(x - 7, y - 7, 14, 14); }
    }
    c.restore();
    c.fillStyle = 'rgba(160, 255, 200, 0.85)';
    c.font = 'bold 15px ui-monospace, Consolas, monospace';
    c.fillText(`${rangeKm} km`, 14, H - 14);
    c.fillText('N', cx - 5, 22);
  }
}
