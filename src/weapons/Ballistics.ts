import { Vector3 } from 'three';
import type { Target, Zone } from '../targets/Targets';
import type { Targets } from '../targets/Targets';
import { boxExit, PEN_COST, type Box, type Colliders, type Surface } from '../world/Colliders';
import type { GunDef } from './defs';

/** Bullet drop (m/s²). */
const GRAVITY = 9.81;
/** The first slice of flight is traced the instant you fire, so close-range hits never feel delayed. */
const INSTANT = 0.03;
const MAX_LIFE = 2.5;
const MAX_RANGE = 1000;
/** Damage kept after punching through a wall. */
const PEN_KEEP = 0.65;

export interface BallisticsHooks {
  impact(p: Vector3, n: Vector3, surface: Surface, exit: boolean): void;
  hit(target: Target, zone: Zone, gun: GunDef, dmgMul: number, dist: number, p: Vector3, dir: Vector3, wallbang: boolean): void;
  tracer(from: Vector3, to: Vector3, bullet: boolean): void;
  /** A shotgun shell's pellets start (true) and end (false): hits in between count as one for feedback. */
  volley?(on: boolean): void;
}

interface Bullet {
  gun: GunDef;
  pos: Vector3;
  vel: Vector3;
  traveled: number;
  life: number;
  dmgMul: number;
  pen: number;
  skip?: Box;
  wallbang: boolean;
  muzzle: Vector3 | null;
}

interface TraceResult {
  /** Distance travelled along the ray before stopping (or `len` if nothing stopped it). */
  t: number;
  stopped: boolean;
  /** Set when the round went through a wall: where it came out. */
  exit?: Vector3;
  exitBox?: Box;
  penCost?: number;
}

/**
 * Travelling bullets (guns with a muzzle velocity) and instant hitscan shots share one trace:
 * the nearest target or wall along a segment. Walls thin enough for the round's remaining penetration are passed
 * through at reduced damage (wood cheaply, concrete harder, metal hardest); ground and steel always stop it.
 */
export class Ballistics {
  private list: Bullet[] = [];

  constructor(private world: Colliders, private targets: Targets, private hooks: BallisticsHooks) {}

  fire(origin: Vector3, dir: Vector3, gun: GunDef, muzzle: Vector3) {
    const b: Bullet = {
      gun, pos: origin.clone(), vel: dir.clone().multiplyScalar(gun.bulletVel || 1), traveled: 0, life: 0,
      dmgMul: 1, pen: gun.penetration, wallbang: false, muzzle: muzzle.clone(),
    };
    if (!gun.bulletVel) {
      this.hitscan(b, dir);
      return;
    }
    if (this.step(b, INSTANT)) this.list.push(b);
  }

  volley(on: boolean) { this.hooks.volley?.(on); }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) if (!this.step(this.list[i], dt)) this.list.splice(i, 1);
  }

  private hitscan(b: Bullet, dir: Vector3) {
    let from = b.pos.clone();
    let left = MAX_RANGE;
    const tracerFrom = b.muzzle!;
    for (let pass = 0; pass < 4; pass++) {
      const r = this.trace(b, from, dir, left);
      if (pass === 0) this.hooks.tracer(tracerFrom, from.clone().addScaledVector(dir, Math.min(r.t, 400)), false);
      if (!r.exit) return;
      b.traveled += r.t + r.exit.distanceTo(from.clone().addScaledVector(dir, r.t));
      left = MAX_RANGE - b.traveled;
      from = r.exit;
    }
  }

  /** Advances a travelling bullet one step. Returns false once it's done. */
  private step(b: Bullet, dt: number): boolean {
    const next = b.pos.clone().addScaledVector(b.vel, dt);
    next.y -= 0.5 * GRAVITY * dt * dt;
    b.vel.y -= GRAVITY * dt;
    const seg = next.clone().sub(b.pos);
    const len = seg.length();
    seg.divideScalar(len);
    const r = this.trace(b, b.pos, seg, len);
    const end = r.stopped || r.exit ? b.pos.clone().addScaledVector(seg, r.t) : next;
    // Streak: from the muzzle on the first step, then along the path.
    this.hooks.tracer(b.muzzle ?? b.pos, end, true);
    b.muzzle = null;
    if (r.exit) {
      b.traveled += b.pos.distanceTo(r.exit);
      b.pos.copy(r.exit);
      // Keep the true (dropping) velocity; the next step continues from the exit hole.
      return true;
    }
    if (r.stopped) return false;
    b.traveled += len;
    b.pos.copy(next);
    b.life += dt;
    return b.life < MAX_LIFE && b.traveled < MAX_RANGE && b.pos.y > -5;
  }

  private trace(b: Bullet, o: Vector3, d: Vector3, len: number): TraceResult {
    const wall = this.world.raycast(o, d, len, b.skip);
    b.skip = undefined;
    const tgt = this.targets.raycast(o, d, wall ? wall.t : len);
    if (tgt) {
      const p = o.clone().addScaledVector(d, tgt.hit.t);
      this.hooks.hit(tgt.target, tgt.hit.zone, b.gun, b.dmgMul, b.traveled + tgt.hit.t, p, d, b.wallbang);
      return { t: tgt.hit.t, stopped: true };
    }
    if (!wall) return { t: len, stopped: false };
    const p = o.clone().addScaledVector(d, wall.t);
    this.hooks.impact(p, wall.normal, wall.box.surface, false);
    // Penetration: how thick is the wall along this path, and can we afford it?
    const cost = PEN_COST[wall.box.surface];
    if (cost !== Infinity && b.pen > 0) {
      const inside = p.clone().addScaledVector(d, 1e-3);
      const thick = boxExit(inside, d, wall.box);
      const price = thick * cost;
      if (price <= b.pen) {
        const exit = inside.addScaledVector(d, thick + 1e-3);
        this.hooks.impact(exit, d.clone(), wall.box.surface, true);
        b.pen -= price;
        b.dmgMul *= PEN_KEEP;
        b.wallbang = true;
        b.skip = wall.box;
        return { t: wall.t, stopped: false, exit, exitBox: wall.box, penCost: price };
      }
    }
    return { t: wall.t, stopped: true };
  }
}
