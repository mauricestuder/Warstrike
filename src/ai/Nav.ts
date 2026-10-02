import { Vector3 } from 'three';
import type { Colliders } from '../world/Colliders';

const CELL = 0.5;
/** Surfaces above this are never stood on (crane tops, the sky). */
const MAX_FLOOR = 30;
/**
 * Height difference allowed between neighbouring cells. A bit more than you can step up in one go, because steep
 * stairs climb about half a metre per cell (two steps the movement code takes one at a time).
 */
const STEP = 0.55;
/** Half the body's width (it's a box, like the player's) and its height. */
const R = 0.28, BODY_HI = 1.75;
const MAX_EXPAND = 60000;
// Neighbour offsets: left, right, up, down, then the diagonals (each needs both of its straight neighbours open).
const DI = [-1, 1, 0, 0, -1, 1, -1, 1], DJ = [0, 0, -1, 1, -1, -1, 1, 1];
const DIAG_NEED = [0b0101, 0b0110, 0b1001, 0b1010];

/**
 * A layered walkability grid (half-metre cells) over the playable area, built once from the collision boxes. Each
 * cell can hold several floors (ground, a staircase, an upstairs room above it); each floor with head room is a
 * node. A* runs over the nodes, and string-pulling turns grid zig-zags into straight lines.
 */
export class Nav {
  readonly w: number;
  readonly h: number;
  /** Nodes of cell k are start[k] .. start[k + 1] - 1, lowest floor first. */
  private start: Int32Array;
  private floor: Float32Array;
  private cell: Int32Array;
  private open: Uint8Array;
  /** Connected region of each node (0 = blocked); bots only use the biggest region. */
  private region: Int32Array;
  private main = 0;
  private walkable: number[] = [];
  /** Main-region nodes upstairs (above 1.5 m): upper floors, decks. */
  private high: number[] = [];
  // A* scratch.
  private g: Float32Array;
  private from: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private run = 0;

  constructor(colliders: Colliders, private x0: number, private z0: number, x1: number, z1: number) {
    const w = this.w = Math.ceil((x1 - x0) / CELL), h = this.h = Math.ceil((z1 - z0) / CELL), n = w * h;
    // Cells whose body footprint (a square of half-size R around the centre) overlaps [lo, hi].
    const span = (lo: number, hi: number, o: number, max: number) =>
      [Math.max(0, Math.ceil((lo - R - o) / CELL - 0.5)), Math.min(max - 1, Math.floor((hi + R - o) / CELL - 0.5))];
    // Pass 1: the top of every box under the footprint is a height you might stand at (the movement code stands
    // you on the highest one under you). Count, then fill.
    const floors = colliders.boxes.filter((b) => !b.clip && b.max.y <= MAX_FLOOR && b.max.y > -0.6);
    const count = new Int32Array(n + 1);
    for (const b of floors) {
      const [i0, i1] = span(b.min.x, b.max.x, x0, w), [j0, j1] = span(b.min.z, b.max.z, z0, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) count[j * w + i]++;
    }
    const at = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) at[k + 1] = at[k] + count[k];
    const raw = new Float32Array(at[n]), fill = at.slice();
    for (const b of floors) {
      const [i0, i1] = span(b.min.x, b.max.x, x0, w), [j0, j1] = span(b.min.z, b.max.z, z0, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) raw[fill[j * w + i]++] = b.max.y;
    }
    // Sort each cell's tops and merge ones within 10 cm (a rug on a floor is the same floor).
    const start = this.start = new Int32Array(n + 1), out: number[] = [], cells: number[] = [];
    for (let k = 0; k < n; k++) {
      start[k] = out.length;
      const tops = Array.from(raw.subarray(at[k], at[k + 1])).sort((a, b) => a - b);
      for (let t = 0; t < tops.length; t++) {
        if (t + 1 < tops.length && tops[t + 1] - tops[t] < 0.1) continue;
        out.push(tops[t]);
        cells.push(k);
      }
    }
    start[n] = out.length;
    const N = out.length;
    this.floor = Float32Array.from(out);
    this.cell = Int32Array.from(cells);
    this.open = new Uint8Array(N).fill(1);
    this.region = new Int32Array(N);
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.gen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    // Pass 2: you can only stand at a height when nothing under the footprint pokes above it within head height
    // (a wall, the next stair step, the ground floor's ceiling over a wall top, the foundation over the dirt).
    for (const b of colliders.boxes) {
      const [i0, i1] = span(b.min.x, b.max.x, x0, w), [j0, j1] = span(b.min.z, b.max.z, z0, h);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        for (let m = start[k]; m < start[k + 1]; m++) {
          const f = this.floor[m];
          if (this.open[m] && b.max.y > f + 0.02 && b.min.y < f + BODY_HI) this.open[m] = 0;
        }
      }
    }
    // Regions by flood fill.
    let id = 0, best = 0;
    const stack: number[] = [];
    for (let s = 0; s < N; s++) {
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
    for (let k = 0; k < N; k++) if (this.region[k] === this.main) {
      this.walkable.push(k);
      if (this.floor[k] > 1.5) this.high.push(k);
    }
  }

  private cellOf(x: number, z: number) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  private centre(node: number, out = new Vector3()) {
    const k = this.cell[node], i = k % this.w, j = (k - i) / this.w;
    return out.set(this.x0 + (i + 0.5) * CELL, this.floor[node], this.z0 + (j + 0.5) * CELL);
  }

  /** The open node in cell `k` you can step to from a floor at height `y` (closest in height), or -1. */
  private stepTo(k: number, y: number) {
    let best = -1, bd = STEP;
    for (let m = this.start[k]; m < this.start[k + 1]; m++) {
      const d = Math.abs(this.floor[m] - y);
      if (this.open[m] && d <= bd) { bd = d; best = m; }
    }
    return best;
  }

  /** 8-connected neighbours you can walk to (no corner cutting). */
  private neighbours(node: number, fn: (m: number) => void) {
    const w = this.w, k = this.cell[node], i = k % w, j = (k - i) / w, y = this.floor[node];
    let mask = 0;
    for (let n = 0; n < 8; n++) {
      const ni = i + DI[n], nj = j + DJ[n];
      if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
      const m = this.stepTo(nj * w + ni, y);
      if (m < 0) continue;
      if (n < 4) mask |= 1 << n;
      else if ((mask & DIAG_NEED[n - 4]) !== DIAG_NEED[n - 4]) continue;
      fn(m);
    }
  }

  /** How badly a floor at `f` matches a point at height `y` (floors under you are much likelier than ones above). */
  private heightCost(f: number, y: number) { const d = y - f; return d >= -0.3 ? Math.abs(d) * 1.5 : -d * 4 + 2; }

  /**
   * The main-region node at (x, z) for something at height `y`: the floor it stands on, or the one under it when
   * `y` is a chest or head. -1 when there's none close enough.
   */
  private nodeAt(x: number, y: number, z: number) {
    const k = this.cellOf(x, z);
    if (k < 0) return -1;
    let best = -1, bd = Infinity;
    for (let m = this.start[k]; m < this.start[k + 1]; m++) {
      if (this.region[m] !== this.main) continue;
      const d = this.heightCost(this.floor[m], y);
      if (d < bd) { bd = d; best = m; }
    }
    if (best < 0) return -1;
    const d = y - this.floor[best];
    return d > -0.6 && d < 2.2 ? best : -1;
  }

  /** Is the point on walkable ground in the main region (at about this height)? */
  walkableAt(x: number, y: number, z: number) { return this.nodeAt(x, y, z) >= 0; }

  /** The nearest main-region floor point within `maxR` metres, or null. Prefers the floor at height `y`. */
  nearest(x: number, y: number, z: number, maxR = 6): Vector3 | null {
    const m0 = this.nodeAt(x, y, z);
    if (m0 >= 0) return this.centre(m0);
    const ci = Math.floor((x - this.x0) / CELL), cj = Math.floor((z - this.z0) / CELL), rr = Math.ceil(maxR / CELL);
    let best = -1, bc = Infinity;
    for (let r = 0; r <= rr; r++) {
      // Rings further out can't beat what we have.
      const ringD = Math.max(0, r - 1) * CELL;
      if (ringD * ringD >= bc) break;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const k = j * this.w + i;
        for (let m = this.start[k]; m < this.start[k + 1]; m++) {
          if (this.region[m] !== this.main) continue;
          const hc = this.heightCost(this.floor[m], y), c = (di * di + dj * dj) * CELL * CELL + hc * hc;
          if (c < bc) { bc = c; best = m; }
        }
      }
    }
    return best >= 0 ? this.centre(best) : null;
  }

  private randomNodeIn(k: number, rnd: () => number) {
    let n = 0;
    for (let m = this.start[k]; m < this.start[k + 1]; m++) if (this.region[m] === this.main) n++;
    if (!n) return -1;
    let pick = Math.floor(rnd() * n);
    for (let m = this.start[k]; m < this.start[k + 1]; m++) if (this.region[m] === this.main && pick-- === 0) return m;
    return -1;
  }

  /** A random walkable point (on any floor) within `r` of (cx, cz); falls back to the closest walkable ground. */
  randomIn(cx: number, cz: number, r: number, rnd: () => number): Vector3 | null {
    for (let n = 0; n < 40; n++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const k = this.cellOf(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
      if (k < 0) continue;
      const m = this.randomNodeIn(k, rnd);
      if (m >= 0) return this.centre(m);
    }
    return this.nearest(cx, 0, cz, Math.max(8, r));
  }

  /** How many walkable cells are upstairs. */
  get upper() { return this.high.length; }

  /** A random upstairs point within `r` of (cx, cz), or null when there's none. */
  randomHigh(cx: number, cz: number, r: number, rnd: () => number): Vector3 | null {
    const p = tmpA, near: number[] = [];
    for (const m of this.high) {
      this.centre(m, p);
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < r * r) near.push(m);
    }
    return near.length ? this.centre(near[Math.floor(rnd() * near.length)]) : null;
  }

  randomAnywhere(rnd: () => number) { return this.centre(this.walkable[Math.floor(rnd() * this.walkable.length)]); }

  /** Can you walk in a straight line from node `a` to node `b`, staying on connected floors all the way? */
  private straight(a: number, b: number) {
    const pa = this.centre(a, tmpA), pb = this.centre(b, tmpB);
    const dx = pb.x - pa.x, dz = pb.z - pa.z, len = Math.hypot(dx, dz), n = Math.ceil(len / (CELL * 0.5));
    const ox = len > 0.01 ? (-dz / len) * 0.2 : 0, oz = len > 0.01 ? (dx / len) * 0.2 : 0;
    let y = this.floor[a], node = a;
    for (let s = 1; s <= n; s++) {
      const t = s / n, px = pa.x + dx * t, pz = pa.z + dz * t;
      // Check a little to each side as well, so the line keeps clear of corners.
      const k = this.cellOf(px, pz), ka = this.cellOf(px + ox, pz + oz), kb = this.cellOf(px - ox, pz - oz);
      if (k < 0 || ka < 0 || kb < 0) return false;
      const m = this.stepTo(k, y);
      if (m < 0 || this.stepTo(ka, y) < 0 || this.stepTo(kb, y) < 0) return false;
      node = m;
      y = this.floor[m];
    }
    return node === b;
  }

  /** Waypoints from `a` to `b` (excluding the start), or null when there's no way through. */
  path(a: Vector3, b: Vector3): Vector3[] | null {
    const sa = this.nearest(a.x, a.y, a.z, 3), sb = this.nearest(b.x, b.y, b.z, 6);
    if (!sa || !sb) return null;
    const s = this.nodeAt(sa.x, sa.y, sa.z), t = this.nodeAt(sb.x, sb.y, sb.z);
    if (s < 0 || t < 0) return null;
    if (s === t) return [sb];
    const run = ++this.run, w = this.w;
    const tk = this.cell[t], ti = tk % w, tj = (tk - ti) / w, ty = this.floor[t];
    const hfn = (node: number) => {
      const k = this.cell[node], i = k % w, j = (k - i) / w, dx = Math.abs(i - ti), dz = Math.abs(j - tj);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(this.floor[node] - ty);
    };
    // Binary heap of [f, node].
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
    const start = this.start, floor = this.floor, open = this.open;
    while (heapF.length) {
      const node = pop();
      if (this.closed[node] === run) continue;
      this.closed[node] = run;
      if (node === t) { found = true; break; }
      if (++expanded > MAX_EXPAND) break;
      const gk = this.g[node], k = this.cell[node], i = k % w, j = (k - i) / w, fk = floor[node];
      // The eight neighbours inline (this loop is the hot path): straight moves first, then diagonals that
      // don't cut a corner.
      let mask = 0;
      for (let n = 0; n < 8; n++) {
        const ni = i + DI[n], nj = j + DJ[n];
        if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
        const c = nj * w + ni;
        let m = -1;
        // Most cells have a single floor; skip the search for those.
        if (start[c + 1] - start[c] === 1) { const o = start[c]; if (open[o] && Math.abs(floor[o] - fk) <= STEP) m = o; }
        else m = this.stepTo(c, fk);
        if (m < 0) continue;
        if (n < 4) mask |= 1 << n;
        else if ((mask & DIAG_NEED[n - 4]) !== DIAG_NEED[n - 4]) continue;
        if (this.closed[m] === run) continue;
        // Climbing costs a little extra so bots don't go up and down for nothing.
        const ng = gk + (n < 4 ? 1 : Math.SQRT2) + Math.abs(floor[m] - fk) * 0.5;
        if (this.gen[m] !== run || ng < this.g[m]) {
          this.gen[m] = run;
          this.g[m] = ng;
          this.from[m] = node;
          push(ng + hfn(m) * 1.2, m);
        }
      }
    }
    if (!found) return null;
    const nodes: number[] = [];
    for (let k = t; k !== -1; k = this.from[k]) nodes.push(k);
    nodes.reverse();
    // String pulling: from each anchor, walk ahead while the straight line to the next node stays on the floors.
    const out: Vector3[] = [];
    let i = 0;
    while (i < nodes.length - 1) {
      let j = i + 1;
      while (j + 1 < nodes.length && this.straight(nodes[i], nodes[j + 1])) j++;
      out.push(this.centre(nodes[j]));
      i = j;
    }
    return out;
  }
}

const tmpA = new Vector3(), tmpB = new Vector3();
