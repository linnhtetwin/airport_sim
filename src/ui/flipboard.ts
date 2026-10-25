// Split-flap ("Solari") display. Each character is a tile that flips through the
// character drum, one flap at a time, until it reaches the target letter.

const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/+>';
const FLIP_MS = 64; // one flap: top half falls, then bottom half lands
const MAX_FLAPS = 10; // long trips spin fast to within this many flaps of the target

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Board text: upper-case, accents stripped, anything off the drum becomes a blank. */
export function flapText(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  let t = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  t = [...t].map((c) => (DRUM.includes(c) ? c : ' ')).join('').slice(0, width);
  return align === 'right' ? t.padStart(width) : t.padEnd(width);
}

/** Short mechanical clicks synthesised with WebAudio (no audio files). */
export class Clatter {
  private ctx: AudioContext | null = null;
  private buf: AudioBuffer | null = null;
  private last = 0;
  enabled = true;

  private init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      const len = Math.floor(this.ctx.sampleRate * 0.018);
      this.buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    } catch {
      this.enabled = false;
    }
  }

  tick() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.last < 14) return; // hundreds of flaps blend into one rattle
    this.last = now;
    this.init();
    const ctx = this.ctx, buf = this.buf;
    if (!ctx || !buf) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 1600;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.05 + Math.random() * 0.04;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  }
}

interface Tile {
  top: HTMLElement; // static upper half (shows the next letter)
  bottom: HTMLElement; // static lower half (shows the current letter)
  foldTop: HTMLElement; // falling upper flap
  foldBottom: HTMLElement; // landing lower flap
  cur: string;
  target: string;
  running: boolean;
}

export interface FlipColumn { width: number; align?: 'left' | 'right'; cls?: string }
export interface FlipRow { cells: string[]; lamp?: '' | 'green' | 'amber' | 'red' | 'blue' }

export class FlipBoard {
  readonly el: HTMLElement;
  private rows: Tile[][][] = []; // row -> column -> tiles
  private lamps: HTMLElement[] = [];

  constructor(private cols: FlipColumn[], rowCount: number, private clatter: Clatter, lamps = true) {
    this.el = document.createElement('div');
    this.el.className = 'flipboard';
    for (let r = 0; r < rowCount; r++) {
      const row = document.createElement('div');
      row.className = 'fb-row';
      const tilesByCol: Tile[][] = [];
      for (const col of cols) {
        const group = document.createElement('span');
        group.className = `fb-col ${col.cls ?? ''}`;
        const tiles: Tile[] = [];
        for (let i = 0; i < col.width; i++) {
          const t = this.tile();
          group.appendChild(t.el);
          tiles.push(t.tile);
        }
        row.appendChild(group);
        tilesByCol.push(tiles);
      }
      if (lamps) {
        const lamp = document.createElement('i');
        lamp.className = 'fb-lamp';
        row.appendChild(lamp);
        this.lamps.push(lamp);
      }
      this.el.appendChild(row);
      this.rows.push(tilesByCol);
    }
  }

  private tile(): { el: HTMLElement; tile: Tile } {
    const el = document.createElement('span');
    el.className = 'flap';
    const half = (cls: string) => {
      const h = document.createElement('span');
      h.className = `half ${cls}`;
      const glyph = document.createElement('span');
      glyph.textContent = ' ';
      h.appendChild(glyph);
      el.appendChild(h);
      return glyph;
    };
    const top = half('top'), bottom = half('bottom'), foldTop = half('top fold'), foldBottom = half('bottom fold');
    return { el, tile: { top, bottom, foldTop, foldBottom, cur: ' ', target: ' ', running: false } };
  }

  /** Show new content; only tiles whose letter changes will flip. */
  set(data: FlipRow[]) {
    this.rows.forEach((row, r) => {
      const d = data[r];
      row.forEach((tiles, c) => {
        const col = this.cols[c];
        const text = flapText(d?.cells[c] ?? '', col.width, col.align);
        tiles.forEach((t, i) => {
          if (t.target === text[i]) return;
          t.target = text[i];
          // a wave: rows top to bottom, characters left to right
          if (!t.running) void this.spin(t, r * 45 + (c * 6 + i) * 12 + Math.random() * 40);
        });
      });
      if (this.lamps[r]) this.lamps[r].className = `fb-lamp ${d?.lamp ?? ''}`;
    });
  }

  private async spin(t: Tile, delay: number) {
    t.running = true;
    await wait(delay);
    while (t.cur !== t.target) {
      const ci = DRUM.indexOf(t.cur), ti = DRUM.indexOf(t.target);
      const dist = (ti - ci + DRUM.length) % DRUM.length;
      // the drum only turns forward; far targets skip ahead invisibly first
      const next = dist > MAX_FLAPS ? DRUM[(ti - MAX_FLAPS + DRUM.length) % DRUM.length] : DRUM[(ci + 1) % DRUM.length];
      await this.flap(t, next);
    }
    t.running = false;
  }

  private async flap(t: Tile, next: string) {
    const from = t.cur;
    t.top.textContent = next;
    t.bottom.textContent = from;
    t.foldTop.textContent = from;
    t.foldBottom.textContent = next;
    const ft = t.foldTop.parentElement!, fb = t.foldBottom.parentElement!;
    ft.style.visibility = 'visible';
    this.clatter.tick();
    try {
      await ft.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: FLIP_MS / 2, easing: 'ease-in' }).finished;
      ft.style.visibility = 'hidden';
      fb.style.visibility = 'visible';
      await fb.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], { duration: FLIP_MS / 2, easing: 'ease-out' }).finished;
    } catch {
      /* animation cancelled (element removed) */
    }
    fb.style.visibility = 'hidden';
    t.bottom.textContent = next;
    t.cur = next;
  }
}
