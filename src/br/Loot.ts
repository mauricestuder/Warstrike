import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Renderer } from '../render/Renderer';
import {
  AMMO_BOX, AMMO_NAME, GUN_IDS, GUNS, RARITY, type AmmoType, type GunId, type Rarity,
} from '../weapons/defs';
import { buildGunMesh, TAN } from '../weapons/ViewModel';
import type { Colliders } from '../world/Colliders';

export type LootKind = 'gun' | 'ammo' | 'plate' | 'cash';

export interface LootItem {
  kind: LootKind;
  gun?: GunId;
  rarity: Rarity;
  ammo?: AmmoType;
  /** Rounds in the mag (guns), rounds in the box (ammo), plates, or dollars. */
  amount: number;
  pos: Vector3;
  obj: Group;
  vel: Vector3 | null;
  t: number;
  taken: boolean;
}

export interface SupplyBox { pos: Vector3; ry: number; lid: Group; beam: Mesh; opened: boolean; openT: number; }
export interface BuyStation { pos: Vector3; ry: number; }
export interface Spot { pos: Vector3; indoor: boolean; }
export type Focus = { type: 'item'; item: LootItem } | { type: 'supply'; box: SupplyBox } | { type: 'station'; station: BuyStation };

type Rnd = () => number;
const AMMO_FOR: Record<GunId, AmmoType> = { ar: 'rifle', smg: 'smg', sniper: 'sniper', shotgun: 'shells' };

/** Rolls a rarity. `boost` shifts the odds up (supply boxes, bought guns). */
export function rollRarity(rnd: Rnd, boost = 0): Rarity {
  const r = rnd();
  const table = boost >= 2 ? [0, 0, 0.4, 0.82, 1] : boost === 1 ? [0, 0.25, 0.65, 0.92, 1] : [0.42, 0.72, 0.88, 0.975, 1];
  return table.findIndex((t) => r < t) as Rarity;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new CanvasTexture(c);
}

function labelTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Everything you can pick up in a match: guns (with rarity), ammo boxes, armour plates and cash, plus supply boxes
 * that spill better loot and buy stations to spend the cash at.
 *
 * Spots are found automatically from the colliders: any floor with standing room is a candidate, and floors with a
 * roof over them (inside houses, the store, the warehouse, containers) are favoured, so the good stuff is indoors.
 */
export class Loot {
  readonly items: LootItem[] = [];
  readonly boxes: SupplyBox[] = [];
  readonly stations: BuyStation[] = [];
  private root = new Group();
  private glowMat: Map<string, MeshBasicMaterial> = new Map();
  private beamMat: Map<string, MeshBasicMaterial> = new Map();
  private glowGeo = new PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
  private beamGeo = new CylinderGeometry(0.04, 0.09, 2.6, 8, 1, true).translate(0, 1.3, 0);
  private glowTex = glowTexture();
  private beamTex = beamTexture();
  /** Merged gun meshes per gun and rarity. */
  private gunParts = new Map<string, { geo: BufferGeometry; mat: Material }[]>();
  private parts: Record<'ammo' | 'plate' | 'cash', Map<string, { geo: BufferGeometry; mat: Material }[]>> = {
    ammo: new Map(), plate: new Map(), cash: new Map(),
  };
  private matCache = new Map<Material, Material>();
  private time = 0;

  constructor(private r: Renderer, private colliders: Colliders, private rnd: Rnd) {
    r.scene.add(this.root);
  }

  // ---------------------------------------------------------------------------------------------- spots

  /** Every walkable floor with headroom on a grid, tagged indoor when something solid is overhead. */
  static findSpots(c: Colliders, b: { x0: number; x1: number; z0: number; z1: number }, step: number, rnd: Rnd): Spot[] {
    // Bucket boxes into 8 m cells so each column only checks nearby boxes.
    const CELL = 8, cols = Math.ceil((b.x1 - b.x0) / CELL) + 1, rows = Math.ceil((b.z1 - b.z0) / CELL) + 1;
    const grid: number[][] = Array.from({ length: cols * rows }, () => []);
    c.boxes.forEach((box, i) => {
      if (box.clip) return;
      const i0 = Math.max(0, Math.floor((box.min.x - b.x0) / CELL)), i1 = Math.min(cols - 1, Math.floor((box.max.x - b.x0) / CELL));
      const j0 = Math.max(0, Math.floor((box.min.z - b.z0) / CELL)), j1 = Math.min(rows - 1, Math.floor((box.max.z - b.z0) / CELL));
      if (i1 - i0 > 20 && j1 - j0 > 20) { for (const cell of grid) cell.push(i); return; } // the ground
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) grid[j * cols + k].push(i);
    });
    const spots: Spot[] = [], R = 0.3;
    for (let x = b.x0 + 1; x < b.x1 - 1; x += step) {
      for (let z = b.z0 + 1; z < b.z1 - 1; z += step) {
        const px = x + (rnd() - 0.5) * step * 0.6, pz = z + (rnd() - 0.5) * step * 0.6;
        const cell = grid[Math.floor((pz - b.z0) / CELL) * cols + Math.floor((px - b.x0) / CELL)];
        if (!cell) continue;
        const near = cell.map((i) => c.boxes[i]);
        for (const fl of near) {
          // A floor the whole footprint stands on.
          if (fl.min.x > px - R || fl.max.x < px + R || fl.min.z > pz - R || fl.max.z < pz + R) continue;
          const y = fl.max.y;
          if (y > 14) continue;
          let blocked = false, roof = false;
          for (const o of near) {
            if (o === fl) continue;
            if (px + R <= o.min.x || px - R >= o.max.x || pz + R <= o.min.z || pz - R >= o.max.z) continue;
            if (o.max.y > y + 0.02 && o.min.y < y + 1.75) { blocked = true; break; }
            if (o.min.y >= y + 1.75 && o.min.y < y + 7 && o.min.x <= px && o.max.x >= px && o.min.z <= pz && o.max.z >= pz) roof = true;
          }
          if (blocked) continue;
          if (!roof && y > 0.7) continue; // outdoors only at street level (no loot on sloped roofs)
          spots.push({ pos: new Vector3(px, y, pz), indoor: roof });
        }
      }
    }
    return spots;
  }

  /** Thins spots out so loot is spread around: indoors every few metres, outdoors sparser. */
  static spread(spots: Spot[], rnd: Rnd, indoorGap: number, outdoorGap: number, max: number): Spot[] {
    const pool = spots.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const out: Spot[] = [];
    for (const s of pool) {
      if (out.length >= max) break;
      const gap = s.indoor ? indoorGap : outdoorGap;
      if (out.some((o) => o.pos.distanceToSquared(s.pos) < gap * gap)) continue;
      out.push(s);
    }
    return out;
  }

  /** True when a w×h×d box centred on (x, z) standing at y is free. */
  private clear(p: Vector3, w: number, h: number, d: number) {
    return !this.colliders.overlaps(new Vector3(p.x - w / 2, p.y + 0.02, p.z - d / 2), new Vector3(p.x + w / 2, p.y + h, p.z + d / 2));
  }

  /** Fills the map: floor loot, supply boxes and buy stations near the given anchors. */
  populate(spots: Spot[], stationAnchors: [number, number][]) {
    const rnd = this.rnd;
    // Buy stations: the open street-level spot nearest each anchor with room around it.
    for (const [ax, az] of stationAnchors) {
      const best = spots.filter((s) => !s.indoor && s.pos.y < 0.3 && this.clear(s.pos, 2.4, 2.4, 2.4))
        .sort((a, b) => Math.hypot(a.pos.x - ax, a.pos.z - az) - Math.hypot(b.pos.x - ax, b.pos.z - az))[0];
      if (best) this.addStation(best.pos, rnd() * Math.PI * 2);
    }
    // Supply boxes, indoors and out, spread around the whole map.
    const boxSpots = Loot.spread(spots.filter((s) => this.clear(s.pos, 1.6, 1.0, 1.6)
      && !this.stations.some((st) => st.pos.distanceTo(s.pos) < 6)), rnd, 22, 22, 22);
    for (const s of boxSpots) this.addSupply(s.pos, Math.round(rnd() * 4) * Math.PI / 2 + (rnd() - 0.5) * 0.3);
    // Floor loot.
    const used = (p: Vector3) => this.boxes.some((b) => b.pos.distanceTo(p) < 2) || this.stations.some((s) => s.pos.distanceTo(p) < 2.5);
    const floor = Loot.spread(spots.filter((s) => !used(s.pos)), rnd, 4, 9, 230);
    for (const s of floor) {
      const k = rnd();
      if (k < 0.45) {
        const id = GUN_IDS[Math.floor(rnd() * GUN_IDS.length)];
        this.spawnGun(s.pos, id, rollRarity(rnd));
        // Often with a box of its ammo next to it.
        if (rnd() < 0.5) {
          const a = rnd() * Math.PI * 2, p = s.pos.clone().add(new Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6));
          if (this.colliders.groundBelow(p.x, p.z, 0.1, p.y + 0.05) > p.y - 0.05 && this.clear(p, 0.3, 0.3, 0.3)) this.spawnAmmo(p, AMMO_FOR[id]);
        }
      } else if (k < 0.7) this.spawnAmmo(s.pos, (['rifle', 'smg', 'sniper', 'shells', 'rifle', 'smg'] as AmmoType[])[Math.floor(rnd() * 6)]);
      else if (k < 0.86) this.spawn({ kind: 'plate', rarity: 2, amount: 1 + (rnd() < 0.3 ? 1 : 0) }, s.pos);
      else this.spawn({ kind: 'cash', rarity: 4, amount: 100 * Math.round(2 + rnd() * 6) }, s.pos);
    }
  }

  // ---------------------------------------------------------------------------------------------- models

  /** A copy of `m` patched for cascaded shadows (cached). */
  private worldMat(m: Material): Material {
    let w = this.matCache.get(m);
    if (!w) { w = this.r.setupMaterial(m.clone()); this.matCache.set(m, w); }
    return w;
  }

  /** Merges a group of meshes into one geometry per material. */
  private bake(g: Group): { geo: BufferGeometry; mat: Material }[] {
    g.updateMatrixWorld(true);
    const by = new Map<Material, BufferGeometry[]>();
    g.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      let geo = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      const list = by.get(o.material as Material) ?? [];
      list.push(geo);
      by.set(o.material as Material, list);
    });
    return [...by].map(([mat, geos]) => ({ geo: mergeGeometries(geos)!, mat: this.worldMat(mat) }));
  }

  gunModel(id: GunId, rarity: Rarity) {
    const key = `${id}:${rarity}`;
    let parts = this.gunParts.get(key);
    if (!parts) {
      const accent = new MeshStandardMaterial({ color: rarity === 0 ? TAN : RARITY[rarity].color, roughness: rarity === 4 ? 0.3 : 0.7, metalness: rarity === 4 ? 0.85 : 0 });
      if (rarity > 0 && rarity < 4) accent.color.multiplyScalar(0.75);
      const g = buildGunMesh(id, accent);
      // Centre it on its length so it spins about its middle.
      g.position.z = id === 'sniper' ? 0.42 : id === 'ar' || id === 'shotgun' ? 0.25 : 0.1;
      const wrap = new Group();
      wrap.add(g);
      parts = this.bake(wrap);
      this.gunParts.set(key, parts);
    }
    return parts;
  }

  private simpleModel(kind: 'ammo' | 'plate' | 'cash', variant: string) {
    let parts = this.parts[kind].get(variant);
    if (parts) return parts;
    const g = new Group();
    const add = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (kind === 'ammo') {
      const band = { rifle: '#d8b030', smg: '#3f8fd8', sniper: '#d84a3a', shells: '#e07a20' }[variant as AmmoType];
      const label = labelTexture(128, 64, (ctx) => {
        ctx.fillStyle = '#4a5233'; ctx.fillRect(0, 0, 128, 64);
        ctx.fillStyle = band; ctx.fillRect(0, 20, 128, 24);
        ctx.fillStyle = '#111'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
        ctx.fillText({ rifle: '5.56', smg: '9MM', sniper: '.338', shells: '12 GA' }[variant as AmmoType], 64, 39);
      });
      const body = new MeshStandardMaterial({ map: label, roughness: 0.6, metalness: 0.3 });
      add(new BoxGeometry(0.34, 0.2, 0.16), body, 0, 0.1, 0);
      add(new BoxGeometry(0.1, 0.03, 0.03), new MeshStandardMaterial({ color: 0x222222 }), 0, 0.215, 0);
    } else if (kind === 'plate') {
      const plate = new MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.35 });
      const strap = new MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.6 });
      for (let i = 0; i < 2; i++) {
        const m = add(new BoxGeometry(0.26, 0.32, 0.03), plate, i * 0.04, 0.17, i * 0.05);
        m.rotation.x = -0.25;
        const s = add(new BoxGeometry(0.265, 0.05, 0.035), strap, i * 0.04, 0.24, i * 0.05 - 0.018);
        s.rotation.x = -0.25;
      }
    } else {
      const bills = labelTexture(64, 32, (ctx) => {
        ctx.fillStyle = '#5f8a4f'; ctx.fillRect(0, 0, 64, 32);
        ctx.fillStyle = '#e8e4d0'; ctx.fillRect(28, 0, 8, 32);
        ctx.strokeStyle = '#3f5f33'; ctx.strokeRect(2, 2, 60, 28);
      });
      const mat = new MeshStandardMaterial({ map: bills, roughness: 0.8 });
      for (const [x, y, z, r] of [[0, 0.04, 0, 0.1], [0.05, 0.12, 0.03, -0.2], [-0.04, 0.12, -0.04, 0.4]]) {
        const m = add(new BoxGeometry(0.16, 0.08, 0.07), mat, x, y, z);
        m.rotation.y = r;
      }
    }
    parts = this.bake(g);
    this.parts[kind].set(variant, parts);
    return parts;
  }

  private glow(color: string, beam: boolean, strength = 1): Group {
    const g = new Group();
    let gm = this.glowMat.get(color + strength);
    if (!gm) {
      gm = new MeshBasicMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.55 * strength, blending: AdditiveBlending, depthWrite: false });
      this.glowMat.set(color + strength, gm);
    }
    const disc = new Mesh(this.glowGeo, gm);
    disc.position.y = 0.03;
    disc.renderOrder = 2;
    g.add(disc);
    if (beam) {
      let bm = this.beamMat.get(color + strength);
      if (!bm) {
        bm = new MeshBasicMaterial({ map: this.beamTex, color, transparent: true, opacity: 0.5 * strength, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
        this.beamMat.set(color + strength, bm);
      }
      const b = new Mesh(this.beamGeo, bm);
      b.renderOrder = 2;
      g.add(b);
    }
    return g;
  }

  // ---------------------------------------------------------------------------------------------- spawning

  spawn(spec: Omit<LootItem, 'pos' | 'obj' | 'vel' | 't' | 'taken'>, at: Vector3, vel: Vector3 | null = null): LootItem {
    const obj = new Group();
    const model = new Group();
    let parts: { geo: BufferGeometry; mat: Material }[];
    let color: string;
    if (spec.kind === 'gun') { parts = this.gunModel(spec.gun!, spec.rarity); color = RARITY[spec.rarity].color; }
    else if (spec.kind === 'ammo') { parts = this.simpleModel('ammo', spec.ammo!); color = '#d8d4c0'; }
    else if (spec.kind === 'plate') { parts = this.simpleModel('plate', 'p'); color = '#6cc4ff'; }
    else { parts = this.simpleModel('cash', 'c'); color = '#8fe08a'; }
    // No shadows: dozens of small floating items would triple their draw calls in the shadow cascades.
    for (const p of parts) model.add(new Mesh(p.geo, p.mat));
    model.name = 'model';
    obj.add(model);
    obj.add(this.glow(color, spec.kind === 'gun' && spec.rarity >= 2, spec.kind === 'gun' ? 1 : 0.6));
    obj.position.copy(at);
    this.root.add(obj);
    const item: LootItem = { ...spec, pos: at.clone(), obj, vel, t: this.rnd() * 10, taken: false };
    this.items.push(item);
    return item;
  }

  spawnGun(at: Vector3, id: GunId, rarity: Rarity, vel: Vector3 | null = null, mag?: number) {
    return this.spawn({ kind: 'gun', gun: id, rarity, amount: mag ?? GUNS[id].mag }, at, vel);
  }

  spawnAmmo(at: Vector3, type: AmmoType, vel: Vector3 | null = null, amount = AMMO_BOX[type]) {
    return this.spawn({ kind: 'ammo', ammo: type, rarity: 0, amount }, at, vel);
  }

  /** A burst of loot flying out of a point (supply box, eliminated bot). */
  spill(at: Vector3, specs: Omit<LootItem, 'pos' | 'obj' | 'vel' | 't' | 'taken'>[]) {
    specs.forEach((s, i) => {
      const a = (i / specs.length) * Math.PI * 2 + this.rnd() * 0.5, sp = 1.6 + this.rnd() * 1.2;
      this.spawn(s, at.clone().setY(at.y + 0.6), new Vector3(Math.cos(a) * sp, 3 + this.rnd() * 1.5, Math.sin(a) * sp));
    });
  }

  /** What a gun's ammo is called, for prompts. */
  static ammoFor(id: GunId) { return AMMO_FOR[id]; }

  private crateMats: { body: Material; dark: Material; lamp: Material } | null = null;

  private makeCrateMats() {
    const crate = labelTexture(256, 128, (ctx) => {
      ctx.fillStyle = '#3f4a2c'; ctx.fillRect(0, 0, 256, 128);
      for (let i = -2; i < 14; i++) { ctx.fillStyle = i % 2 ? '#e0b020' : '#1a1a1a'; ctx.beginPath(); ctx.moveTo(i * 22, 96); ctx.lineTo(i * 22 + 22, 96); ctx.lineTo(i * 22 + 34, 120); ctx.lineTo(i * 22 + 12, 120); ctx.fill(); }
      ctx.fillStyle = '#e8e2c8'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.fillText('SUPPLY', 128, 60);
      ctx.strokeStyle = '#2a3220'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 122);
    });
    return {
      body: this.r.setupMaterial(new MeshStandardMaterial({ map: crate, roughness: 0.7, metalness: 0.2 })),
      dark: this.r.setupMaterial(new MeshStandardMaterial({ color: 0x2c3420, roughness: 0.6, metalness: 0.3 })),
      lamp: new MeshBasicMaterial({ color: 0xffc040 }),
    };
  }

  private addSupply(p: Vector3, ry: number) {
    const { body, dark, lamp } = this.crateMats ??= this.makeCrateMats();
    const g = new Group();
    g.position.copy(p);
    g.rotation.y = ry;
    const base = new Mesh(new BoxGeometry(1.1, 0.5, 0.62), body);
    base.position.y = 0.25;
    base.castShadow = base.receiveShadow = true;
    g.add(base);
    // Lid hinged on the back edge.
    const lid = new Group();
    lid.position.set(0, 0.5, -0.31);
    const lidMesh = new Mesh(new BoxGeometry(1.14, 0.1, 0.66), dark);
    lidMesh.position.set(0, 0.05, 0.31);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    const light = new Mesh(new BoxGeometry(0.12, 0.08, 0.12), lamp);
    light.position.set(0.4, 0.13, 0.31);
    lid.add(light);
    g.add(lid);
    for (const s of [-1, 1]) {
      const h = new Mesh(new BoxGeometry(0.06, 0.06, 0.3), dark);
      h.position.set(s * 0.58, 0.32, 0);
      g.add(h);
    }
    const beam = this.glow('#ffc040', true, 1.4);
    beam.scale.set(1.4, 2.2, 1.4);
    g.add(beam);
    this.root.add(g);
    // Solid, at an angle-proof size (a little smaller than the crate).
    this.colliders.add(new Vector3(p.x - 0.42, p.y, p.z - 0.42), new Vector3(p.x + 0.42, p.y + 0.55, p.z + 0.42), 'metal');
    this.boxes.push({ pos: p.clone(), ry, lid, beam: beam.children[1] as Mesh, opened: false, openT: 0 });
  }

  private addStation(p: Vector3, ry: number) {
    const screen = labelTexture(256, 320, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 320);
      g.addColorStop(0, '#0e2a14'); g.addColorStop(1, '#06120a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 320);
      ctx.fillStyle = '#8fe08a'; ctx.textAlign = 'center';
      ctx.font = 'bold 120px Arial'; ctx.fillText('$', 128, 150);
      ctx.font = 'bold 40px Arial'; ctx.fillText('BUY', 128, 220);
      ctx.font = '24px Arial'; ctx.fillText('STATION', 128, 258);
      ctx.strokeStyle = '#8fe08a'; ctx.lineWidth = 4; ctx.strokeRect(10, 10, 236, 300);
    });
    const shell = this.r.setupMaterial(new MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.45, metalness: 0.6 }));
    const trim = this.r.setupMaterial(new MeshStandardMaterial({ color: 0x8fe08a, roughness: 0.4, emissive: 0x2a6a28, emissiveIntensity: 0.6 }));
    const face = new MeshBasicMaterial({ map: screen });
    const g = new Group();
    g.position.copy(p);
    g.rotation.y = ry;
    const add = (geo: BufferGeometry, m: Material, x: number, y: number, z: number) => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(new BoxGeometry(1.2, 0.15, 0.8), shell, 0, 0.075, 0);
    add(new BoxGeometry(0.95, 2.1, 0.6), shell, 0, 1.2, 0);
    add(new BoxGeometry(1.0, 0.08, 0.65), trim, 0, 2.29, 0);
    add(new BoxGeometry(0.97, 0.05, 0.62), trim, 0, 0.18, 0);
    const scr = new Mesh(new PlaneGeometry(0.72, 0.9), face);
    scr.position.set(0, 1.55, 0.302);
    g.add(scr);
    add(new BoxGeometry(0.7, 0.06, 0.25), shell, 0, 0.95, 0.38).rotation.x = 0.3;
    g.add(this.glow('#8fe08a', true, 1.2));
    this.root.add(g);
    // Face the screen toward +z of the station; the collider is the kiosk's rotated footprint as an AABB.
    const hw = 0.55;
    this.colliders.add(new Vector3(p.x - hw, p.y, p.z - hw), new Vector3(p.x + hw, p.y + 2.3, p.z + hw), 'metal');
    this.stations.push({ pos: p.clone(), ry });
  }

  // ---------------------------------------------------------------------------------------------- per frame

  update(dt: number, viewer: Vector3) {
    this.time += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.taken) { this.root.remove(it.obj); this.items.splice(i, 1); continue; }
      if (it.vel) {
        // Flying out of a box: simple ballistic hop that settles on whatever is below.
        it.vel.y -= 14 * dt;
        it.pos.addScaledVector(it.vel, dt);
        const g = this.colliders.groundBelow(it.pos.x, it.pos.z, 0.05, it.pos.y + 0.4);
        if (it.pos.y <= g && it.vel.y < 0) { it.pos.y = g; it.vel = null; }
      }
      const far = it.pos.distanceToSquared(viewer) > 85 * 85;
      it.obj.visible = !far;
      if (far) continue;
      it.t += dt;
      it.obj.position.copy(it.pos);
      const model = it.obj.children[0];
      model.position.y = 0.3 + Math.sin(it.t * 2.2) * 0.05;
      model.rotation.y = it.t * 0.9;
    }
    for (const b of this.boxes) {
      if (b.opened && b.openT < 1) {
        b.openT = Math.min(1, b.openT + dt * 2.2);
        const e = 1 - (1 - b.openT) ** 3;
        b.lid.rotation.x = -1.9 * e;
        b.beam.visible = false;
      }
    }
  }

  /**
   * What you're looking at within reach: the item closest to the centre of the screen, or a supply box / station.
   * `eye` is the camera position and `dir` its forward vector.
   */
  focus(eye: Vector3, dir: Vector3, feet: Vector3): Focus | null {
    let best: Focus | null = null, bestScore = -Infinity;
    const v = new Vector3();
    const consider = (p: Vector3, reach: number, f: Focus) => {
      v.copy(p).sub(eye);
      const d = v.length();
      const flat = Math.hypot(p.x - feet.x, p.z - feet.z);
      if (d > reach && flat > 1.1) return;
      if (Math.abs(p.y - feet.y) > 2.2) return;
      const dot = v.dot(dir) / Math.max(d, 1e-3);
      if (dot < 0.55 && flat > 1.1) return;
      const score = dot * 2 - d * 0.35;
      if (score > bestScore) { bestScore = score; best = f; }
    };
    for (const it of this.items) if (!it.taken && !it.vel) consider(it.pos.clone().setY(it.pos.y + 0.3), 3, { type: 'item', item: it });
    for (const b of this.boxes) if (!b.opened) consider(b.pos.clone().setY(b.pos.y + 0.4), 3.2, { type: 'supply', box: b });
    for (const s of this.stations) consider(s.pos.clone().setY(s.pos.y + 1.2), 3.4, { type: 'station', station: s });
    return best;
  }

  /** Display name for a prompt. */
  static label(it: LootItem): string {
    if (it.kind === 'gun') return `<em style="color:${RARITY[it.rarity].color}">${RARITY[it.rarity].name} ${GUNS[it.gun!].name}</em>`;
    if (it.kind === 'ammo') return `<em>${AMMO_NAME[it.ammo!]} ×${it.amount}</em>`;
    if (it.kind === 'plate') return `<em style="color:#6cc4ff">Armor plate${it.amount > 1 ? ` ×${it.amount}` : ''}</em>`;
    return `<em style="color:#8fe08a">$${it.amount}</em>`;
  }
}
