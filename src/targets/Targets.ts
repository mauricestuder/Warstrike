import {
  BoxGeometry, BufferGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Material,
} from 'three';
import { clamp, rand } from '../core/math';
import { Soldier } from '../render/Soldier';
import type { GunId } from '../weapons/defs';
import type { Renderer } from '../render/Renderer';
import type { BotLane, SteelSpot } from '../world/World';

export type Zone = 'head' | 'body' | 'limb';

export interface TargetRay { t: number; zone: Zone; normal: Vector3; }

export interface DamageResult {
  dealt: number;
  killed: boolean;
  armorBroke: boolean;
  /** Steel plates just ding, they don't have health. */
  steel: boolean;
}

export interface Target {
  /** Nearest hit along a normalized ray, or null. */
  raycast(o: Vector3, d: Vector3, maxT: number): TargetRay | null;
  damage(amount: number, zone: Zone): DamageResult;
  update(dt: number, viewer: Vector3): void;
  readonly position: Vector3;
}

const tmpO = new Vector3(), tmpD = new Vector3(), tmpN = new Vector3();

/** Ray vs local-space AABB; returns entry t or -1 and sets tmpN to the face normal. */
function rayAabb(o: Vector3, d: Vector3, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, maxT: number) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < lo[i] || oo[i] > hi[i]) return -1; continue; }
    let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i], s = -1;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis < 0) return -1;
  tmpN.set(0, 0, 0).setComponent(axis, sign);
  return tmin;
}

function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number, maxT: number) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxT) return -1;
  tmpN.set(ox + d.x * t, oy + d.y * t, oz + d.z * t).normalize();
  return t;
}

/** A painted steel plate on a post. Knocks back on a hit and resets after a moment. */
class SteelTarget implements Target {
  readonly position: Vector3;
  private mesh: Mesh;
  private downT = 0;

  constructor(private spot: SteelSpot, root: Group, mat: MeshStandardMaterial) {
    this.position = spot.pos;
    this.mesh = new Mesh(new BoxGeometry(spot.w, spot.h, 0.03), mat);
    // Hinge at the bottom edge.
    this.mesh.geometry.translate(0, spot.h / 2, 0);
    this.mesh.position.set(spot.pos.x, spot.pos.y - spot.h / 2, spot.pos.z);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    root.add(this.mesh);
  }

  raycast(o: Vector3, d: Vector3, maxT: number): TargetRay | null {
    if (this.downT > 0) return null;
    const p = this.spot.pos, hw = this.spot.w / 2, hh = this.spot.h / 2;
    const t = rayAabb(o, d, p.x - hw, p.y - hh, p.z - 0.02, p.x + hw, p.y + hh, p.z + 0.02, maxT);
    if (t < 0) return null;
    // The top quarter of the plate counts as the "head" for feedback purposes.
    const y = o.y + d.y * t;
    return { t, zone: y > p.y + hh * 0.5 ? 'head' : 'body', normal: tmpN.clone() };
  }

  damage(amount: number): DamageResult {
    this.downT = 1.6;
    return { dealt: amount, killed: false, armorBroke: false, steel: true };
  }

  update(dt: number) {
    if (this.downT > 0) this.downT -= dt;
    const target = this.downT > 0 ? -1.2 : 0;
    this.mesh.rotation.x += (target - this.mesh.rotation.x) * clamp(dt * (this.downT > 0 ? 18 : 6), 0, 1);
  }
}

const MAX_HP = 100, MAX_ARMOR = 50;

/**
 * A training bot: a soldier-shaped dummy with head / body / limb hitboxes, 100 HP + 50 armour.
 * Lane bots strafe with random ADAD timing; wall dummies stand still.
 */
export class Bot implements Target {
  readonly position = new Vector3();
  /** Battle royale: bots stay down when killed. */
  respawn = true;
  name = 'Bot';
  /** Moved and turned by an AI brain instead of the training-lane logic. */
  driven = false;
  /** Not in the world yet (still on the plane). */
  hidden = false;
  /** Facing (driven bots); 0 looks toward +z. */
  yaw = 0;
  /** Skydiving pose (driven bots). */
  sky: 'none' | 'freefall' | 'chute' = 'none';
  /** Parachute open (driven bots). */
  chute = false;
  /** Seconds since the last damage, for regen. */
  sinceHit = 99;
  /** Look pitch (rad, up positive), for the aim pose. */
  pitch = 0;
  /** World velocity, so the legs stride the way the bot is actually moving. */
  readonly vel = new Vector3();
  grounded = true;
  sprinting = false;
  /** Seconds since the bot last fired (recoil in the animation). */
  shotT = 9;
  private soldier: Soldier;
  private armed = false;
  private root = new Group();
  private body = new Group();
  private hp = MAX_HP;
  private armor = MAX_ARMOR;
  private dead = 0;
  private dir = 1;
  private dirTimer = 0;
  private speed = 0;
  private bar: Sprite;
  private barCtx: CanvasRenderingContext2D;
  private barTex: CanvasTexture;
  private flash = 0;
  private mats: MeshStandardMaterial[] = [];

  constructor(private home: Vector3, private lane: BotLane | null, parent: Group, r: Renderer) {
    this.position.copy(home);
    const mat = (color: number, rough = 0.85, metal = 0) => {
      const m = r.setupMaterial(new MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
      this.mats.push(m);
      return m;
    };
    this.soldier = new Soldier(mat);
    this.body.add(this.soldier.root);
    this.root.add(this.body);
    const c = document.createElement('canvas');
    c.width = 128; c.height = 20;
    this.barCtx = c.getContext('2d')!;
    this.barTex = new CanvasTexture(c);
    this.barTex.colorSpace = SRGBColorSpace;
    this.bar = new Sprite(new SpriteMaterial({ map: this.barTex, depthTest: true, fog: false }));
    this.bar.scale.set(0.8, 0.125, 1);
    this.bar.position.y = 2.05;
    this.root.add(this.bar);
    this.drawBar();
    parent.add(this.root);
  }

  private drawBar() {
    const ctx = this.barCtx;
    ctx.clearRect(0, 0, 128, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 128, 20);
    ctx.fillStyle = '#4aa8ff';
    ctx.fillRect(2, 2, (124 * this.armor) / MAX_ARMOR, 6);
    ctx.fillStyle = this.hp > 35 ? '#f2f2f2' : '#ff5a4a';
    ctx.fillRect(2, 10, (124 * this.hp) / MAX_HP, 8);
    this.barTex.needsUpdate = true;
  }

  raycast(o: Vector3, d: Vector3, maxT: number): TargetRay | null {
    if (this.dead > 0 || this.hidden || this.hp <= 0) return null;
    // Transform the ray into the bot's local (unrotated) frame.
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const lx = o.x - this.position.x, lz = o.z - this.position.z;
    tmpO.set(lx * c + lz * s, o.y - this.position.y, -lx * s + lz * c);
    tmpD.set(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
    let best: TargetRay | null = null;
    const consider = (t: number, zone: Zone) => {
      if (t >= 0 && (!best || t < best.t)) {
        // Rotate the normal back to world space.
        const n = new Vector3(tmpN.x * c - tmpN.z * s, tmpN.y, tmpN.x * s + tmpN.z * c);
        best = { t, zone, normal: n };
      }
    };
    consider(raySphere(tmpO, tmpD, new Vector3(0, 1.65, 0), 0.14, maxT), 'head');
    consider(rayAabb(tmpO, tmpD, -0.23, 0.92, -0.16, 0.23, 1.52, 0.16, maxT), 'body');
    consider(rayAabb(tmpO, tmpD, -0.22, 0, -0.13, 0.22, 0.92, 0.13, maxT), 'limb');
    for (const sx of [-1, 1]) consider(rayAabb(tmpO, tmpD, sx > 0 ? 0.23 : -0.4, 0.9, -0.1, sx > 0 ? 0.4 : -0.23, 1.48, 0.1, maxT), 'limb');
    return best;
  }

  get alive() { return this.dead <= 0 && this.hp > 0; }
  /** Health plus armour, 0..150. */
  get total() { return this.hp + this.armor; }
  get health() { return this.hp; }

  /** Regenerates health (not armour), like the player. */
  heal(amount: number) {
    if (!this.alive || this.hp >= MAX_HP) return;
    this.hp = Math.min(MAX_HP, this.hp + amount);
    this.drawBar();
  }

  /** Puts a gun model in the bot's hands (or empties them). `zShift` is how far the loot model was centred along z. */
  holdGun(parts: { geo: BufferGeometry; mat: Material }[] | null, id: GunId = 'ar', zShift = 0) {
    this.armed = !!parts;
    if (!parts) { this.soldier.setGun(null, 'hands'); return; }
    const g = new Group();
    for (const p of parts) { const m = new Mesh(p.geo, p.mat); m.castShadow = true; g.add(m); }
    this.soldier.setGun(g, id, zShift);
  }

  /** World-space muzzle position (roughly the end of the barrel). */
  muzzle(out: Vector3) {
    if (this.armed) return this.soldier.muzzle(out);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return out.set(this.position.x + c * 0.12 + s * 0.85, this.position.y + 1.3, this.position.z - s * 0.12 + c * 0.85);
  }

  /** Eye position, where the bot looks and shoots from. */
  eye(out: Vector3) { return out.set(this.position.x, this.position.y + 1.6, this.position.z); }

  /** Gas ignores armour. */
  gas(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 0.06;
    if (this.hp <= 0) { this.hp = 0; this.dead = 3; this.drawBar(); return true; }
    this.drawBar();
    return false;
  }

  damage(amount: number): DamageResult {
    if (!this.alive) return { dealt: 0, killed: false, armorBroke: false, steel: false };
    let left = amount, armorBroke = false;
    if (this.armor > 0) {
      const a = Math.min(this.armor, left);
      this.armor -= a;
      left -= a;
      armorBroke = this.armor <= 0;
    }
    const dealt = amount - Math.max(0, left - this.hp);
    this.hp -= left;
    this.flash = 0.08;
    this.sinceHit = 0;
    const killed = this.hp <= 0;
    if (killed) { this.hp = 0; this.dead = 3; }
    this.drawBar();
    return { dealt, killed, armorBroke, steel: false };
  }

  /** Whether the body parts currently cast shadows (only bots near the camera do: 16 parts × every shadow cascade). */
  private shadows = true;
  private animT = 0;

  update(dt: number, viewer: Vector3) {
    this.root.visible = !this.hidden;
    if (this.hidden) return;
    const near = this.position.distanceToSquared(viewer) < 60 * 60;
    if (near !== this.shadows) {
      this.shadows = near;
      this.soldier.castShadow = near;
    }
    if (this.hp <= 0 && !this.respawn) {
      // Stays where it fell.
      this.root.position.copy(this.position);
      this.body.rotation.x = Math.max(this.body.rotation.x - dt * 5, -Math.PI / 2);
      this.bar.visible = false;
      this.soldier.canopy.visible = false;
      for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
      return;
    }
    this.sinceHit += dt;
    if (this.dead > 0) {
      this.dead -= dt;
      // Topple backwards, then respawn.
      this.body.rotation.x = Math.max(this.body.rotation.x - dt * 5, -Math.PI / 2);
      this.bar.visible = false;
      if (this.dead <= 0) {
        this.hp = MAX_HP; this.armor = MAX_ARMOR;
        this.body.rotation.x = 0;
        this.bar.visible = true;
        this.position.copy(this.home);
        this.drawBar();
      }
      return;
    }
    if (this.lane && !this.driven) {
      this.dirTimer -= dt;
      if (this.dirTimer <= 0) {
        this.dir = Math.random() < 0.5 ? -1 : 1;
        this.dirTimer = rand(0.35, 1.3);
        if (Math.random() < 0.2) this.dir = 0;
      }
      const x = this.position.x - this.lane.center.x;
      if (Math.abs(x) > this.lane.halfWidth) this.dir = -Math.sign(x);
      this.speed += (this.dir * 4.4 - this.speed) * clamp(dt * 9, 0, 1);
      this.position.x += this.speed * dt;
    }
    if (!this.driven) this.yaw = Math.atan2(viewer.x - this.position.x, viewer.z - this.position.z);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    // Lane bots move on their own; driven bots get their velocity from the AI.
    if (this.lane && !this.driven) this.vel.set(this.speed, 0, 0);
    // Only animate bots you could see: a far-off stride isn't worth the matrix work.
    const far = this.position.distanceToSquared(viewer) > 160 * 160;
    this.animT += dt;
    if (!far || this.animT > 0.25) {
      this.soldier.update(this.animT, {
        vx: this.vel.x, vz: this.vel.z, yaw: this.yaw, pitch: this.pitch, grounded: this.grounded && this.sky === 'none',
        sprint: this.sprinting, crouch: false, slide: false, sky: this.sky,
        kick: this.shotT < 0.02 ? 1 : 0,
      });
      this.animT = 0;
    }
    this.shotT += dt;
    this.soldier.canopy.visible = this.chute;
    this.bar.visible = !this.chute && (this.respawn || this.sinceHit < 4);
    // Brief red flash on hit.
    if (this.flash > 0) this.flash -= dt;
    for (const m of this.mats) m.emissive.setRGB(this.flash > 0 ? 0.6 : 0, 0, 0);
  }
}

const NAMES = ['Kowalski', 'Ghost_77', 'Reyes', 'NightOwl', 'Viktor', 'Hawk', 'Mendez', 'Sly', 'Bravo-6', 'Tanaka', 'Rook',
  'Okafor', 'Dutch', 'Wolfie', 'Sato', 'Frost', 'Lazarus', 'Kilo-2', 'Moreau', 'Jinx', 'Abara', 'Petrov', 'Nova', 'Halvorsen',
  'Ruiz', 'Static', 'Brennan', 'Ivanova', 'Crow', 'Mako', 'Delgado', 'Hex', 'Lindqvist', 'Ortega', 'Zulu-9', 'Banks', 'Kaito',
  'Riptide', 'Novak', 'Ash'];

export class Targets {
  readonly list: Target[] = [];
  readonly bots: Bot[] = [];
  private root = new Group();

  constructor(r: Renderer, steel: SteelSpot[], lanes: BotLane[], dummies: Vector3[]) {
    r.scene.add(this.root);
    const paint = r.setupMaterial(new MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.55, metalness: 0.3 }));
    for (const s of steel) this.list.push(new SteelTarget(s, this.root, paint));
    for (const l of lanes) this.bots.push(new Bot(l.center.clone().setX(l.center.x + rand(-3, 3)), l, this.root, r));
    for (const p of dummies) this.bots.push(new Bot(p, null, this.root, r));
    this.bots.forEach((b, i) => { b.name = NAMES[i % NAMES.length]; });
    this.list.push(...this.bots);
  }

  raycast(o: Vector3, d: Vector3, maxT: number): { target: Target; hit: TargetRay } | null {
    let best: { target: Target; hit: TargetRay } | null = null;
    for (const t of this.list) {
      const h = t.raycast(o, d, best ? best.hit.t : maxT);
      if (h && (!best || h.t < best.hit.t)) best = { target: t, hit: h };
    }
    return best;
  }

  update(dt: number, viewer: Vector3) {
    for (const t of this.list) t.update(dt, viewer);
  }
}
