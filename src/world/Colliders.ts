import { Vector3 } from 'three';

/** Surface kinds drive impact effects, sounds and how easily bullets pass through. */
export type Surface = 'concrete' | 'wood' | 'metal' | 'dirt' | 'steel' | 'sand';

export interface Box {
  min: Vector3;
  max: Vector3;
  surface: Surface;
}

/**
 * How many metres of "penetration power" one metre of this surface costs.
 * Infinity = bullets never pass (ground, target steel, sandbags).
 */
export const PEN_COST: Record<Surface, number> = {
  wood: 0.45, concrete: 1, metal: 2.2, dirt: Infinity, steel: Infinity, sand: Infinity,
};

export interface RayHit {
  t: number;
  box: Box;
  normal: Vector3;
}

const hitNormal = new Vector3();

/** Slab test. Returns the entry distance (or -1 for a miss) and writes the entry face normal to `hitNormal`. */
function rayBox(o: Vector3, d: Vector3, b: Box, maxT: number): number {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = o.getComponent(i), di = d.getComponent(i);
    const lo = b.min.getComponent(i), hi = b.max.getComponent(i);
    if (Math.abs(di) < 1e-9) {
      if (oi < lo || oi > hi) return -1;
      continue;
    }
    const inv = 1 / di;
    let t1 = (lo - oi) * inv, t2 = (hi - oi) * inv, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis < 0) return -1; // ray starts inside the box
  hitNormal.set(0, 0, 0).setComponent(axis, sign);
  return tmin;
}

/** Distance along the ray at which it leaves `b` (for a ray already inside it or entering it). */
export function boxExit(o: Vector3, d: Vector3, b: Box): number {
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const di = d.getComponent(i);
    if (Math.abs(di) < 1e-9) continue;
    const oi = o.getComponent(i);
    const t = ((di > 0 ? b.max.getComponent(i) : b.min.getComponent(i)) - oi) / di;
    if (t < tmax) tmax = t;
  }
  return tmax;
}

export class Colliders {
  readonly boxes: Box[] = [];

  add(min: Vector3, max: Vector3, surface: Surface): Box {
    const b = { min: min.clone(), max: max.clone(), surface };
    this.boxes.push(b);
    return b;
  }

  /** Nearest box hit along a normalized ray within maxT. `skip` ignores one box (the one a bullet just exited). */
  raycast(o: Vector3, d: Vector3, maxT: number, skip?: Box): RayHit | null {
    let best: RayHit | null = null;
    for (const b of this.boxes) {
      if (b === skip) continue;
      const t = rayBox(o, d, b, best ? best.t : maxT);
      if (t >= 0 && (!best || t < best.t)) {
        if (best) { best.t = t; best.box = b; best.normal.copy(hitNormal); }
        else best = { t, box: b, normal: hitNormal.clone() };
      }
    }
    return best;
  }

  /** Any box overlapping the AABB [min,max]? */
  overlaps(min: Vector3, max: Vector3): Box | null {
    for (const b of this.boxes) {
      if (min.x < b.max.x && max.x > b.min.x && min.y < b.max.y && max.y > b.min.y && min.z < b.max.z && max.z > b.min.z) return b;
    }
    return null;
  }

  /** Highest box top under the column at (x,z) with half-size r, at or below `y`. Returns -Infinity over a void. */
  groundBelow(x: number, z: number, r: number, y: number): number {
    let top = -Infinity;
    for (const b of this.boxes) {
      if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
      if (b.max.y <= y + 1e-4 && b.max.y > top) top = b.max.y;
    }
    return top;
  }
}
