import { Vector3 } from 'three';
import type { Colliders } from '../world/Colliders';

const CELL = 0.5;
/** Bots walk on the ground floor: anything you stand on above this is roof or upstairs. */
const MAX_FLOOR = 1.3;
const STEP = 0.45, RADIUS = 0.3, BODY_LO = 0.46, BODY_HI = 1.75;
const MAX_EXPAND = 60000;
// Neighbour offsets: left, right, up, down, then the diagonals (each needs both of its straight neighbours open).
const DI = [-1, 1, 0, 0, -1, 1, -1, 1], DJ = [0, 0, -1, 1, -1, -1, 1, 1];
const DIAG_NEED = [0b0101, 0b0110, 0b1001, 0b1010];

/**
 * A walkability grid (half-metre cells) over the playable area, built once from the collision boxes, with A* paths
 * and string-pulling so bots walk straight lines instead of grid zig-zags. Only the ground level is navigable.
 */
export class Nav {
  readonly w: number;
  readonly h: number;
  private floor: Float32Array;
  private open: Uint8Array;
  /** Connected region of each cell (0 = blocked); bots only pick goals in the biggest region. */
  private region: Int32Array;
  private main = 0;
  private walkable: number[] = [];
  // A* scratch.
  private g: Float32Array;
  private from: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private run = 0;

  constructor(colliders: Colliders, private x0: number, private z0: number, x1: number, z1: number) {
    const w = this.w = Math.ceil((x1 - x0) / CELL), h = this.h = Math.ceil((z1 - z0) / CELL), n = w * h;
    this.floor = new Float32Array(n).fill(-Infinity);
    this.open = new Uint8Array(n);
    this.region = new Int32Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    const span = (lo: number, hi: number, o: number, max: number) =>
      [Math.max(0, Math.ceil((lo - o) / CELL - 0.5)), Math.min(max - 1, Math.floor((hi - o) / CELL - 0.5))];
    // Pass 1: the floor of each cell is the highest low box top under its centre.
    for (const b of colliders.boxes) {
      if (b.clip || b.max.y > MAX_FLOOR) continue;
      const [i0, i1] = span(b.min.x, b.max.x, x0, w), [j0, j1] = span(b.min.z, b.max.z, z0, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (b.max.y > this.floor[k]) this.floor[k] = b.max.y;
      }
    }
    for (let k = 0; k < n; k++) this.open[k] = this.floor[k] > -0.6 ? 1 : 0;
    // Pass 2: anything (grown by the body radius) in the way between knee and head height blocks the cell.
    for (const b of colliders.boxes) {
      const [i0, i1] = span(b.min.x - RADIUS, b.max.x + RADIUS, x0, w), [j0, j1] = span(b.min.z - RADIUS, b.max.z + RADIUS, z0, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i, f = this.floor[k];
        if (this.open[k] && b.max.y > f + BODY_LO && b.min.y < f + BODY_HI) this.open[k] = 0;
      }
    }
    // Regions by flood fill.
    let id = 0, best = 0;
    const stack: number[] = [];
    for (let s = 0; s < n; s++) {
      if (!this.open[s] || this.region[s]) continue;
      id++;
      let size = 0;
      this.region[s] = id;
      stack.push(s);
      while (stack.length) {
        const k = stack.pop()!;
        size++;
        this.neighbours(k, (m) => { if (!this.region[m]) { this.region[m] = id; stack.push(m); } });
      }
      if (size > best) { best = size; this.main = id; }
    }
    for (let k = 0; k < n; k++) if (this.region[k] === this.main) this.walkable.push(k);
  }

  private cellOf(x: number, z: number) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  private centre(k: number, out = new Vector3()) {
    const i = k % this.w, j = (k - i) / this.w;
    return out.set(this.x0 + (i + 0.5) * CELL, this.floor[k], this.z0 + (j + 0.5) * CELL);
  }

  private step(a: number, b: number) { return Math.abs(this.floor[a] - this.floor[b]) <= STEP; }

  /** 8-connected neighbours you can walk to (no corner cutting). */
  private neighbours(k: number, fn: (m: number, cost: number) => void) {
    const w = this.w, i = k % w, j = (k - i) / w;
    const ok = (m: number) => this.open[m] === 1 && this.step(k, m);
    const l = i > 0 && ok(k - 1), r = i < w - 1 && ok(k + 1), u = j > 0 && ok(k - w), d = j < this.h - 1 && ok(k + w);
    if (l) fn(k - 1, 1);
    if (r) fn(k + 1, 1);
    if (u) fn(k - w, 1);
    if (d) fn(k + w, 1);
    if (l && u && ok(k - w - 1)) fn(k - w - 1, Math.SQRT2);
    if (r && u && ok(k - w + 1)) fn(k - w + 1, Math.SQRT2);
    if (l && d && ok(k + w - 1)) fn(k + w - 1, Math.SQRT2);
    if (r && d && ok(k + w + 1)) fn(k + w + 1, Math.SQRT2);
  }

  /** Is the point on walkable ground in the main region? */
  walkableAt(x: number, z: number) {
    const k = this.cellOf(x, z);
    return k >= 0 && this.region[k] === this.main;
  }

  /** The nearest main-region cell centre within `maxR` metres, or null. */
  nearest(x: number, z: number, maxR = 6): Vector3 | null {
    const k = this.cellOf(x, z);
    if (k >= 0 && this.region[k] === this.main) return this.centre(k);
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((z - this.z0) / CELL), rr = Math.ceil(maxR / CELL);
    for (let r = 1; r <= rr; r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const m = j * this.w + i;
        if (this.region[m] !== this.main) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = m; }
      }
      if (best >= 0) return this.centre(best);
    }
    return null;
  }

  /** A random walkable point within `r` of (cx, cz); falls back to the closest walkable cell to the centre. */
  randomIn(cx: number, cz: number, r: number, rnd: () => number): Vector3 | null {
    for (let n = 0; n < 40; n++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const k = this.cellOf(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
      if (k >= 0 && this.region[k] === this.main) return this.centre(k);
    }
    return this.nearest(cx, cz, Math.max(8, r));
  }

  randomAnywhere(rnd: () => number) { return this.centre(this.walkable[Math.floor(rnd() * this.walkable.length)]); }

  /** Can you walk in a straight line from a to b (every cell open and no step too tall)? */
  straight(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), n = Math.ceil(len / (CELL * 0.5));
    let prev = this.cellOf(ax, az);
    if (prev < 0 || !this.open[prev]) return false;
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      // Check a little to each side as well, so the line keeps clear of corners.
      const k = this.cellOf(ax + dx * t, az + dz * t);
      if (k < 0 || !this.open[k] || !this.step(prev, k)) return false;
      if (len > 0.01) {
        const ox = (-dz / len) * 0.2, oz = (dx / len) * 0.2;
        const a = this.cellOf(ax + dx * t + ox, az + dz * t + oz), b = this.cellOf(ax + dx * t - ox, az + dz * t - oz);
        if (a < 0 || b < 0 || !this.open[a] || !this.open[b]) return false;
      }
      prev = k;
    }
    return true;
  }

  /** Waypoints from `a` to `b` (excluding the start), or null when there's no way through. */
  path(a: Vector3, b: Vector3): Vector3[] | null {
    const sa = this.nearest(a.x, a.z, 3), sb = this.nearest(b.x, b.z, 6);
    if (!sa || !sb) return null;
    const s = this.cellOf(sa.x, sa.z), t = this.cellOf(sb.x, sb.z);
    if (s === t) return [sb];
    const run = ++this.run, w = this.w;
    const ti = t % w, tj = (t - ti) / w;
    const hfn = (k: number) => {
      const i = k % w, j = (k - i) / w, dx = Math.abs(i - ti), dz = Math.abs(j - tj);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    // Binary heap of [f, cell].
    const heapF: number[] = [], heapK: number[] = [];
    const push = (f: number, k: number) => {
      let i = heapF.length;
      heapF.push(f); heapK.push(k);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapF[i] = heapF[p]; heapK[i] = heapK[p];
        i = p;
      }
      heapF[i] = f; heapK[i] = k;
    };
    const pop = () => {
      const k = heapK[0], lf = heapF.pop()!, lk = heapK.pop()!;
      if (heapF.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i, mf = lf;
          if (l < heapF.length && heapF[l] < mf) { m = l; mf = heapF[l]; }
          if (r < heapF.length && heapF[r] < mf) { m = r; mf = heapF[r]; }
          if (m === i) break;
          heapF[i] = heapF[m]; heapK[i] = heapK[m];
          i = m;
        }
        heapF[i] = lf; heapK[i] = lk;
      }
      return k;
    };
    this.gen[s] = run;
    this.g[s] = 0;
    this.from[s] = -1;
    push(hfn(s), s);
    let found = false, expanded = 0;
    while (heapF.length) {
      const k = pop();
      if (this.closed[k] === run) continue;
      this.closed[k] = run;
      if (k === t) { found = true; break; }
      if (++expanded > MAX_EXPAND) break;
      const gk = this.g[k], i = k % w, j = (k - i) / w, fk = this.floor[k];
      // The eight neighbours inline (this loop is the hot path): straight moves first, then diagonals that
      // don't cut a corner.
      let mask = 0;
      for (let n = 0; n < 8; n++) {
        const di = DI[n], dj = DJ[n], ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const m = k + dj * w + di;
        if (!this.open[m] || Math.abs(this.floor[m] - fk) > STEP) continue;
        if (n < 4) mask |= 1 << n;
        else if ((mask & DIAG_NEED[n - 4]) !== DIAG_NEED[n - 4]) continue;
        if (this.closed[m] === run) continue;
        const ng = gk + (n < 4 ? 1 : Math.SQRT2);
        if (this.gen[m] !== run || ng < this.g[m]) {
          this.gen[m] = run;
          this.g[m] = ng;
          this.from[m] = k;
          push(ng + hfn(m) * 1.2, m);
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = t; k !== -1; k = this.from[k]) cells.push(k);
    cells.reverse();
    // String pulling: from each anchor, walk ahead while the straight line to the next cell stays walkable.
    const pts = cells.map((k) => this.centre(k));
    const out: Vector3[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && this.straight(pts[i].x, pts[i].z, pts[j + 1].x, pts[j + 1].z)) j++;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
