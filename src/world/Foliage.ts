import type { Vector3 } from 'three';

/** A leafy volume (bush, tree crown) as an upright ellipsoid: radius `r` across, `ry` up. */
interface Blob { x: number; y: number; z: number; r: number; ry: number; }

const CELL = 8;

/**
 * Leaves that don't stop bullets or bodies but do stop eyes: bushes and tree crowns are stored as ellipsoids, and a
 * sight line is blocked when it passes through enough of them. Tall weeds hide anyone crouching in them.
 */
export class Foliage {
  private blobs: Blob[] = [];
  private grid = new Map<number, Blob[]>();
  private stamp = 0;
  private seen = new WeakMap<Blob, number>();
  /** Is there tall grass at this spot (set by the map)? */
  tallGrass: (x: number, z: number) => boolean = () => false;

  private static key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }

  add(x: number, y: number, z: number, r: number, ry: number) {
    const b: Blob = { x, y, z, r, ry };
    this.blobs.push(b);
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const k = Foliage.key(i, j);
        let c = this.grid.get(k);
        if (!c) this.grid.set(k, c = []);
        c.push(b);
      }
  }

  get count() { return this.blobs.length; }

  /**
   * Metres of leaves between a and b (each crown's chord counts a bit less near its fuzzy edge). Stops counting
   * once it reaches `cap`.
   */
  leaves(a: Vector3, b: Vector3, cap = 2): number {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return 0;
    const s = ++this.stamp;
    let total = 0;
    // Walk the 8 m grid cells along the segment (in XZ).
    const steps = Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)) + 1;
    for (let n = 0; n <= steps; n++) {
      const t = n / steps, px = a.x + dx * t, pz = a.z + dz * t;
      const ci = Math.floor(px / CELL), cj = Math.floor(pz / CELL);
      for (let oi = -1; oi <= 1; oi++) for (let oj = -1; oj <= 1; oj++) {
        const k = Foliage.key(ci + oi, cj + oj);
        const c = this.grid.get(k);
        if (!c) continue;
        for (const f of c) {
          if (this.seen.get(f) === s) continue;
          this.seen.set(f, s);
          total += this.chord(a, dx / len, dy / len, dz / len, len, f);
          if (total >= cap) return total;
        }
      }
    }
    return total;
  }

  /** Length of the segment inside the ellipsoid (scaled to 80 % so grazing the edge barely counts). */
  private chord(a: Vector3, ux: number, uy: number, uz: number, len: number, f: Blob) {
    const r = f.r * 0.8, ry = f.ry * 0.8;
    // Squash space so the ellipsoid becomes a unit sphere.
    const ox = (a.x - f.x) / r, oy = (a.y - f.y) / ry, oz = (a.z - f.z) / r;
    const vx = ux / r, vy = uy / ry, vz = uz / r;
    const A = vx * vx + vy * vy + vz * vz, B = 2 * (ox * vx + oy * vy + oz * vz), C = ox * ox + oy * oy + oz * oz - 1;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return 0;
    const sq = Math.sqrt(disc), t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(len, (-B + sq) / (2 * A));
    return t1 > t0 ? t1 - t0 : 0;
  }
}
