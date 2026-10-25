import { type XZ, dist, headingOf } from '../geo/projection';
import type { GNode } from './taxiGraph';

/** Arc-length parameterised polyline used for every ground movement. */
export class Path {
  readonly pts: XZ[];
  readonly nodes: (GNode | null)[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: XZ[], nodes?: (GNode | null)[]) {
    // drop duplicate points
    const p: XZ[] = [];
    const n: (GNode | null)[] = [];
    pts.forEach((q, i) => {
      if (p.length && dist(p[p.length - 1], q) < 0.05) return;
      p.push(q);
      n.push(nodes?.[i] ?? null);
    });
    if (p.length === 1) { p.push({ x: p[0].x + 0.01, z: p[0].z }); n.push(null); }
    this.pts = p;
    this.nodes = n;
    this.cum = [0];
    for (let i = 1; i < p.length; i++) this.cum.push(this.cum[i - 1] + dist(p[i - 1], p[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  private seg(s: number): number {
    const c = this.cum;
    if (s <= 0) return 0;
    if (s >= this.length) return c.length - 2;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (c[m] <= s) lo = m; else hi = m;
    }
    return lo;
  }

  at(s: number): XZ {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const L = this.cum[i + 1] - this.cum[i];
    const t = L > 0 ? Math.max(0, Math.min(1, (s - this.cum[i]) / L)) : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  headingAt(s: number): number {
    const i = this.seg(s);
    return headingOf(this.pts[i], this.pts[i + 1]);
  }

  /** Largest heading change within the next `ahead` metres (for slowing in turns). */
  turnAhead(s: number, ahead: number): number {
    const h0 = this.headingAt(s);
    let worst = 0;
    for (let d = 10; d <= ahead; d += 10) {
      if (s + d > this.length) break;
      const h = this.headingAt(s + d);
      worst = Math.max(worst, Math.abs(((h - h0 + 540) % 360) - 180));
    }
    return worst;
  }

  /** Index of the first graph node at or beyond arc length s. */
  nextNodeIndex(s: number): number {
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] >= s - 0.5 && this.nodes[i]) return i;
    return -1;
  }

  /** Index of the first vertex strictly beyond arc length s. */
  indexAfter(s: number): number {
    for (let i = 0; i < this.cum.length; i++) if (this.cum[i] > s) return i;
    return this.cum.length - 1;
  }

  /** Sub-path from s to the end, starting at the exact current point. */
  rest(s: number): Path {
    const i = this.seg(s);
    return new Path([this.at(s), ...this.pts.slice(i + 1)], [null, ...this.nodes.slice(i + 1)]);
  }

  static concat(a: Path, b: Path): Path {
    return new Path([...a.pts, ...b.pts], [...a.nodes, ...b.nodes]);
  }

  reversed(): Path {
    return new Path(this.pts.slice().reverse(), this.nodes.slice().reverse());
  }
}
