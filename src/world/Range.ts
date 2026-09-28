import {
  CanvasTexture, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Shape, SRGBColorSpace, Vector3, type BufferGeometry,
  type Material,
} from 'three';
import { mulberry32 } from '../core/math';
import { Materials, worldBox } from '../render/Materials';
import type { Renderer } from '../render/Renderer';
import { Colliders, type Surface } from './Colliders';

import type { BotLane, SteelSpot, World } from './World';

/**
 * The gun range: a covered firing line, a centre lane of steel plates from 10 to 300 m, a bot pen for tracking,
 * a wallbang lane (wood, thin and thick concrete) and a movement course behind spawn (mantle crates, stairs,
 * a container stack and a measured slide strip). Everything solid is an axis-aligned box collider.
 *
 * Forward (downrange) is -z. The firing line is at z ≈ 0.
 */
export class Range implements World {
  readonly colliders = new Colliders();
  readonly root = new Group();
  readonly spawn = new Vector3(0, 0.12, 4);
  readonly spawnYaw = 0;
  readonly infiniteAmmo = true;
  readonly welcome = 'Welcome to the range · steel downrange, bots right, wallbang lane left, movement course behind you';
  readonly steel: SteelSpot[] = [];
  readonly botLanes: BotLane[] = [];
  /** Standing dummies placed behind the wallbang walls. */
  readonly wallDummies: Vector3[] = [];
  private mats: Materials;

  constructor(private r: Renderer) {
    this.mats = new Materials(r);
    r.scene.add(this.root);
    this.ground();
    this.firingLine();
    this.targetLane();
    this.botPen();
    this.wallbangLane();
    this.movementCourse();
    this.scenery();
  }

  update() {}

  /** A solid box: mesh + collider. (x, z) is the centre of the footprint, y the bottom. */
  private solid(x: number, y: number, z: number, w: number, h: number, d: number, surface: Surface,
    mat: Material = this.mats.bySurface[surface], tile = 2) {
    const m = new Mesh(worldBox(w, h, d, tile), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    this.root.add(m);
    this.colliders.add(new Vector3(x - w / 2, y, z - d / 2), new Vector3(x + w / 2, y + h, z + d / 2), surface);
    return m;
  }

  /** Visual-only mesh (no collision). */
  private deco(g: BufferGeometry, mat: Material, x: number, y: number, z: number, shadow = true) {
    const m = new Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  private ground() {
    const W = 900, D = 1000;
    const g = new PlaneGeometry(W, D, 1, 1);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 4, uv.getY(i) * D / 4);
    g.rotateX(-Math.PI / 2);
    this.deco(g, this.mats.ground, 0, 0, -200, false);
    this.colliders.add(new Vector3(-W / 2, -5, -200 - D / 2), new Vector3(W / 2, 0, -200 + D / 2), 'dirt');

    // Earth berms: sloped visual, box collider in the middle. Sides of the range and the backstop.
    this.berm(-44, -170, 380, 6, 'z');
    this.berm(44, -170, 380, 6, 'z');
    this.berm(0, -352, 100, 12, 'x');
    this.berm(0, 74, 100, 5, 'x');
  }

  private berm(x: number, z: number, length: number, height: number, along: 'x' | 'z') {
    const top = 3, base = top + height * 2.4;
    const s = new Shape();
    s.moveTo(-base / 2, 0); s.lineTo(base / 2, 0); s.lineTo(top / 2, height); s.lineTo(-top / 2, height); s.closePath();
    const g = new ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
    g.translate(0, 0, -length / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    if (along === 'x') g.rotateY(Math.PI / 2);
    this.deco(g, this.mats.ground, x, 0, z);
    const half = (top + base) / 4;
    const hx = along === 'z' ? half : length / 2, hz = along === 'z' ? length / 2 : half;
    this.colliders.add(new Vector3(x - hx, 0, z - hz), new Vector3(x + hx, height * 0.8, z + hz), 'dirt');
  }

  private firingLine() {
    const m = this.mats;
    this.solid(0, 0, 3.5, 64, 0.12, 9, 'concrete');
    // Steel canopy on posts.
    for (const x of [-31, -10.5, 10.5, 31]) for (const z of [-0.6, 7.6]) this.solid(x, 0.12, z, 0.25, 3.2, 0.25, 'metal', m.metalDark);
    this.solid(0, 3.32, 3.5, 64, 0.14, 10.5, 'metal', m.metal, 3);
    // Shooting benches with gaps between them to walk downrange.
    for (const x of [-15, -9, -3, 3, 9, 15]) {
      this.solid(x, 0.12, -1.2, 2.6, 0.08, 0.8, 'wood', m.wood, 1);
      for (const lx of [-1.15, 1.15]) this.solid(x + lx, 0.12, -1.2, 0.12, 0.82, 0.7, 'wood', m.wood, 1);
    }
    this.sign('STEEL  10 – 300 m', 0, 3.02, -1.8, 0.5, 0, true);
    this.sign('BOT PEN', 26, 2.6, -9, 1.6, 0, true);
    this.sign('WALLBANG', -26, 2.6, -9, 1.6, 0, true);
    this.sign('MOVEMENT COURSE', 0, 3.02, 8.8, 0.5, Math.PI, true);
  }

  private targetLane() {
    const spots: [number, number, number, number][] = [
      [10, -4, 0.45, 0.6], [25, 3, 0.45, 0.6], [50, -2, 0.5, 0.7], [100, 4, 0.6, 0.8], [200, -3, 0.9, 1.2], [300, 1, 1.2, 1.6],
    ];
    for (const [dist, x, w, h] of spots) {
      const z = -dist;
      const y = 0.9;
      // Post and a sandbag base to stop bullets skipping under.
      this.deco(new CylinderGeometry(0.05, 0.05, y + h * 0.3, 6), this.mats.wood, x, (y + h * 0.3) / 2, z - 0.15);
      this.solid(x, 0, z + 0.9, w + 1.4, 0.55, 0.6, 'sand', this.mats.sandbag, 1);
      this.steel.push({ pos: new Vector3(x, y + h / 2, z), w, h });
      this.sign(`${dist} m`, x, 0.28, z + 1.21, dist >= 200 ? 1.4 : 0.6);
    }
  }

  private botPen() {
    const m = this.mats;
    for (const z of [-22, -38, -56]) this.botLanes.push({ center: new Vector3(26, 0, z), halfWidth: 6 });
    // Sandbag cover on the sides of the pen plus a few crates for context.
    for (const z of [-16, -30, -46]) {
      this.solid(17, 0, z, 1.6, 0.9, 0.6, 'sand', m.sandbag, 1);
      this.solid(35, 0, z - 4, 1.6, 0.9, 0.6, 'sand', m.sandbag, 1);
    }
    this.solid(33, 0, -64, 2.4, 2.4, 2.4, 'wood', m.wood, 2.4);
    this.solid(19, 0, -66, 1.2, 1.2, 1.2, 'wood', m.wood, 1.2);
  }

  private wallbangLane() {
    const z = -16, h = 2.6;
    const walls: [number, number, number, Surface, string][] = [
      [-32, 5, 0.12, 'wood', 'WOOD 12 cm'], [-26, 5, 0.3, 'concrete', 'CONCRETE 30 cm'], [-20, 5, 1, 'concrete', 'CONCRETE 1 m'],
    ];
    for (const [x, w, t, surface, label] of walls) {
      this.solid(x, 0, z - t / 2, w, h, t, surface, this.mats.bySurface[surface], surface === 'wood' ? 1.3 : 2);
      this.sign(label, x, h + 0.35, z + 0.02, 0.7);
      this.wallDummies.push(new Vector3(x, 0, z - 3));
    }
  }

  private movementCourse() {
    const m = this.mats;
    // Mantle crates: 0.5 / 1.0 / 1.5 / 2.0 m.
    [0.5, 1, 1.5, 2].forEach((h, i) => {
      this.solid(-14 + i * 3, 0.12, 14, 1.4, h, 1.4, 'wood', m.wood, 1.4);
      this.sign(`${h.toFixed(1)} m`, -14 + i * 3, 0.12 + h + 0.25, 13.28, 0.35, Math.PI);
    });
    // Concrete tower reached by stairs.
    this.solid(11, 0.12, 19, 6, 3, 6, 'concrete');
    for (let k = 1; k <= 12; k++) {
      const top = 0.12 + (3 / 12) * k, z = 22 + (12 - k) * 0.35 + 0.175;
      this.solid(8.7, 0, z, 1.4, top, 0.35, 'concrete', m.concrete, 1);
    }
    // Container stack: crate (1.3 m) → container (2.6 m) → second container on top.
    this.solid(-9, 0.12, 30, 2.4, 2.6, 6, 'metal', m.metal, 2.6);
    this.solid(-6, 0.12, 30, 2.4, 2.6, 6, 'metal', m.metalDark, 2.6);
    this.solid(-7.5, 2.72, 31, 2.4, 2.6, 6, 'metal', m.metal, 2.6);
    this.solid(-4.1, 0.12, 26, 1.3, 1.3, 1.3, 'wood', m.wood, 1.3);
    // Measured slide strip with a line every 2 m.
    this.solid(6, 0, 44, 4, 0.12, 36, 'concrete');
    const paint = new MeshBasicMaterial({ color: 0xe8e2d0 });
    for (let d = 0; d <= 34; d += 2) {
      this.deco(new PlaneGeometry(4, d % 10 === 0 ? 0.12 : 0.05).rotateX(-Math.PI / 2), paint, 6, 0.125, 27 + d, false);
      if (d % 10 === 0 && d > 0) this.sign(`${d} m`, 8.6, 0.4, 27 + d, 0.4, -Math.PI / 2);
    }
    this.sign('SLIDE STRIP', 6, 1.4, 25.8, 0.8, Math.PI);
  }

  private scenery() {
    const rnd = mulberry32(7);
    // Distant hills, faceted and hazed out by fog.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.3, d = 420 + rnd() * 160;
      const g = new IcosahedronGeometry(1, 2);
      const p = g.getAttribute('position');
      for (let v = 0; v < p.count; v++) {
        const k = 0.85 + rnd() * 0.3;
        p.setXYZ(v, p.getX(v) * k, Math.max(0, p.getY(v)) * k, p.getZ(v) * k);
      }
      g.computeVertexNormals();
      const hill = this.deco(g, new MeshStandardMaterial({ color: 0x566246, roughness: 1, flatShading: true }),
        Math.cos(a) * d, -2, -200 + Math.sin(a) * d, false);
      hill.scale.set(120 + rnd() * 80, 30 + rnd() * 50, 120 + rnd() * 80);
      hill.receiveShadow = false;
    }
    // Pines outside the berms.
    const cone = new ConeGeometry(1, 1, 7), trunk = new CylinderGeometry(0.12, 0.18, 1, 5);
    for (let i = 0; i < 90; i++) {
      const side = i % 2 ? 1 : -1, x = side * (58 + rnd() * 70), z = 60 - rnd() * 420;
      const h = 7 + rnd() * 7;
      this.deco(trunk, this.mats.bark, x, h * 0.15, z).scale.set(1, h * 0.3, 1);
      for (let k = 0; k < 3; k++) {
        const r = (1 - k * 0.28) * h * 0.22;
        this.deco(cone, this.mats.foliage, x, h * (0.35 + k * 0.2), z).scale.set(r, h * 0.42, r);
      }
    }
  }

  /** Flat text board. `back` puts a dark board behind the text. */
  private sign(text: string, x: number, y: number, z: number, height: number, rotY = 0, board = false) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 96px "Segoe UI", Arial, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 64;
    c.width = w; c.height = 128;
    ctx.fillStyle = board ? '#1d2126' : 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, 128);
    ctx.font = 'bold 96px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = board ? '#f0c040' : '#f3eee2';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 68);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    const mat = this.r.setupMaterial(new MeshStandardMaterial({ map: t, transparent: !board, roughness: 0.8, side: DoubleSide }));
    const mesh = this.deco(new PlaneGeometry((height * w) / 128, height), mat, x, y, z, false);
    mesh.rotation.y = rotY;
  }
}
