import {
  BoxGeometry, CanvasTexture, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
  Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { clamp, rand } from '../core/math';
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
  private root = new Group();
  private body = new Group();
  private hp = MAX_HP;
  private armor = MAX_ARMOR;
  private dead = 0;
  private dir = 1;
  private dirTimer = 0;
  private speed = 0;
  private yaw = 0;
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
    const fabric = mat(0x55603f), vest = mat(0x2f3328, 0.7), skin = mat(0xc49a7c, 0.6), helmet = mat(0x3c4232, 0.5, 0.2);
    const boots = mat(0x1d1b19, 0.6);
    const add = (g: THREE_Geo, m: MeshStandardMaterial, x: number, y: number, z: number) => {
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    for (const s of [-1, 1]) {
      add(new CapsuleGeometry(0.1, 0.72, 4, 8), fabric, s * 0.11, 0.5, 0);
      add(new BoxGeometry(0.14, 0.1, 0.26), boots, s * 0.11, 0.05, -0.04);
      const arm = add(new CapsuleGeometry(0.07, 0.5, 4, 8), fabric, s * 0.31, 1.2, 0);
      arm.rotation.z = s * 0.12;
    }
    add(new CapsuleGeometry(0.2, 0.42, 4, 12), fabric, 0, 1.22, 0).scale.set(1, 1, 0.7);
    add(new BoxGeometry(0.44, 0.44, 0.3), vest, 0, 1.24, 0);
    add(new CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 1.5, 0);
    add(new SphereGeometry(0.12, 16, 12), skin, 0, 1.64, 0);
    add(new SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet, 0, 1.66, 0);
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
    if (this.dead > 0) return null;
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
    const killed = this.hp <= 0;
    if (killed) { this.hp = 0; this.dead = 3; }
    this.drawBar();
    return { dealt, killed, armorBroke, steel: false };
  }

  update(dt: number, viewer: Vector3) {
    if (this.hp <= 0 && !this.respawn) {
      // Stays where it fell.
      this.body.rotation.x = Math.max(this.body.rotation.x - dt * 5, -Math.PI / 2);
      this.bar.visible = false;
      for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
      return;
    }
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
    if (this.lane) {
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
    this.yaw = Math.atan2(viewer.x - this.position.x, viewer.z - this.position.z);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    // Brief red flash on hit.
    if (this.flash > 0) this.flash -= dt;
    for (const m of this.mats) m.emissive.setRGB(this.flash > 0 ? 0.6 : 0, 0, 0);
  }
}

type THREE_Geo = ConstructorParameters<typeof Mesh>[0];

const NAMES = ['Kowalski', 'Ghost_77', 'Reyes', 'NightOwl', 'Viktor', 'Hawk', 'Mendez', 'Sly', 'Bravo-6', 'Tanaka', 'Rook',
  'Okafor', 'Dutch', 'Wolfie', 'Sato', 'Frost'];

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
