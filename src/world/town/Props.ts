import {
  CatmullRomCurve3, CylinderGeometry, DoubleSide, ExtrudeGeometry, MeshStandardMaterial, PlaneGeometry, Shape,
  TorusGeometry, TubeGeometry, Vector3, type BufferGeometry, type Material,
} from 'three';
import { worldBox } from '../../render/Materials';
import { paintedTex, weather } from '../../render/Textures';
import type { Builder, Rot } from '../Builder';
import type { Surface } from '../Colliders';
import type { TownMaterials } from './TownMaterials';

type Rnd = () => number;

/**
 * Builds a prop in its own local frame (x right, y up, z toward the viewer) and drops it into the world at
 * (x, y, z) turned by `ry` (and optionally tilted). Colliders become the world AABB of each local box.
 */
export class Placer {
  constructor(private b: Builder, private x: number, private y: number, private z: number, private ry = 0,
    private tiltX = 0, private tiltZ = 0) {}

  box(lx: number, ly: number, lz: number, w: number, h: number, d: number, mat: Material, surface: Surface | null = null,
    tile = 2, rot: Rot | null = null, shadow = true) {
    const g = worldBox(w, h, d, tile);
    if (rot) this.b.place(g, 0, 0, 0, rot);
    g.translate(lx, ly + h / 2, lz);
    this.geo(g, mat, shadow);
    if (surface) this.collide(lx - w / 2, ly, lz - d / 2, lx + w / 2, ly + h, lz + d / 2, surface);
  }

  cyl(lx: number, ly: number, lz: number, r: number, h: number, mat: Material, seg = 12, rot: Rot | null = null, r2 = r) {
    const g = new CylinderGeometry(r2, r, h, seg);
    g.translate(0, h / 2, 0);
    if (rot) this.b.place(g, 0, 0, 0, rot);
    g.translate(lx, ly, lz);
    this.geo(g, mat);
  }

  /** A child placer at a local offset, turned a further `ry` (furniture inside a rotated building, etc.). */
  at(lx: number, lz: number, ry = 0, ly = 0): Placer {
    const c = Math.cos(this.ry), s = Math.sin(this.ry);
    return new Placer(this.b, this.x + lx * c + lz * s, this.y + ly, this.z - lx * s + lz * c, this.ry + ry);
  }

  geo(g: BufferGeometry, mat: Material, shadow = true) {
    this.b.place(g, this.x, this.y, this.z, [this.tiltX, this.ry, this.tiltZ]);
    this.b.add(g, mat, shadow);
  }

  collide(lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, surface: Surface) {
    const c = Math.cos(this.ry), s = Math.sin(this.ry);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [px, pz] of [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]]) {
      const wx = this.x + px * c + pz * s, wz = this.z - px * s + pz * c;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
    // Off-axis rotations inflate the AABB; pull it in a little so you don't bump into thin air.
    const k = Math.abs(Math.sin(2 * this.ry)) * 0.12;
    const sx = (x1 - x0) * k, sz = (z1 - z0) * k;
    this.b.collide(x0 + sx, this.y + ly0, z0 + sz, x1 - sx, this.y + ly1, z1 - sz, surface);
  }
}

const labelCache = new Map<string, MeshStandardMaterial>();

/** A painted sign/decal material (cached by key). `draw` paints onto a w×h canvas. */
export function decalMat(m: TownMaterials, key: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: { transparent?: boolean; wear?: number } = {}) {
  let mat = labelCache.get(key);
  if (mat) return mat;
  const t = paintedTex(w, h, (ctx) => {
    draw(ctx, w, h);
    if (opts.wear) weather(ctx, w, h, key.length * 31 + w, opts.wear);
  });
  mat = m.r.setupMaterial(new MeshStandardMaterial({
    map: t, roughness: 0.8, alphaTest: opts.transparent ? 0.3 : 0, transparent: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  labelCache.set(key, mat);
  return mat;
}

/** Plane facing +z in local space, w × h, centred at (lx, ly, lz). */
export function plane(p: Placer, lx: number, ly: number, lz: number, w: number, h: number, mat: Material, ry = 0, shadow = false) {
  const g = new PlaneGeometry(w, h);
  g.rotateY(ry);
  g.translate(lx, ly, lz);
  p.geo(g, mat, shadow);
}

// ------------------------------------------------------------------------------------------------ vehicles

/** Abandoned sedan: extruded body profile with wheel arches, glass greenhouse, bumpers, lights, flat or missing tyres. */
export function car(b: Builder, m: TownMaterials, x: number, z: number, ry: number, paint: Material, rnd: Rnd,
  opts: { burnt?: boolean; noWheels?: boolean } = {}) {
  const sunk = opts.noWheels ? -0.2 : 0;
  const p = new Placer(b, x, sunk, z, ry, 0, opts.noWheels ? 0.03 : (rnd() - 0.5) * 0.02);
  const W = 1.78;
  const s = new Shape();
  s.moveTo(-2.25, 0.32);
  s.lineTo(-1.73, 0.32);
  s.absarc(-1.35, 0.32, 0.38, Math.PI, 0, true);
  s.lineTo(0.97, 0.32);
  s.absarc(1.35, 0.32, 0.38, Math.PI, 0, true);
  s.lineTo(2.2, 0.32);
  s.lineTo(2.28, 0.55);
  s.lineTo(2.2, 0.78);
  s.lineTo(1.2, 0.9);
  s.lineTo(0.45, 1.36);
  s.lineTo(-0.75, 1.4);
  s.lineTo(-1.45, 0.98);
  s.lineTo(-2.2, 0.94);
  s.lineTo(-2.28, 0.6);
  s.closePath();
  const body = new ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 6 });
  body.translate(0, 0, -W / 2);
  const paintMat = opts.burnt ? m.charred : paint;
  p.geo(body, paintMat);
  const gl = new Shape();
  gl.moveTo(1.23, 0.95);
  gl.lineTo(0.48, 1.41);
  gl.lineTo(-0.77, 1.41);
  gl.lineTo(-1.49, 1.03);
  gl.closePath();
  const glass = new ExtrudeGeometry(gl, { depth: 1.9, bevelEnabled: false });
  glass.translate(0, 0, -0.95);
  p.geo(glass, opts.burnt ? m.black : m.glass);
  p.box(-0.15, 0.98, 0, 0.1, 0.4, 1.92, paintMat);
  // Bumpers, lights, grille.
  p.box(2.26, 0.36, 0, 0.12, 0.2, 1.8, opts.burnt ? m.rust : m.chrome);
  p.box(-2.27, 0.38, 0, 0.12, 0.2, 1.8, opts.burnt ? m.rust : m.chrome);
  p.box(2.27, 0.58, 0, 0.04, 0.14, 0.8, m.black);
  for (const side of [-1, 1]) {
    p.box(2.25, 0.6, side * 0.66, 0.06, 0.12, 0.34, m.lampGlass);
    p.box(-2.29, 0.66, side * 0.66, 0.04, 0.12, 0.3, m.pumpRed);
    p.box(0.95, 0.95, side * 0.95, 0.12, 0.08, 0.1, paintMat); // mirrors
  }
  // Wheels: tyres and rims (flat tyres sit lower; stripped cars have none).
  if (!opts.noWheels) {
    for (const wx of [-1.35, 1.35]) for (const side of [-1, 1]) {
      const flat = rnd() < 0.4 ? 0.06 : 0;
      p.cyl(wx, 0.33 - flat, side * 0.8 - side * 0.11, 0.33, 0.22, m.rubber, 16, [Math.PI / 2, 0, 0]);
      p.cyl(wx, 0.33 - flat, side * 0.8 + side * 0.005 - side * 0.11, 0.2, 0.23, opts.burnt ? m.rust : m.chrome, 10, [Math.PI / 2, 0, 0]);
    }
  }
  p.collide(-2.3, 0.1, -0.93, 2.3, 0.95, 0.93, 'metal');
  p.collide(-1.4, 0.95, -0.9, 1.1, 1.42, 0.9, 'metal');
}

// ------------------------------------------------------------------------------------------------ port

const LINES = ['NORDLINE', 'PACIFICA', 'OCEANIC', 'MERIDIAN', 'KESTREL', 'HANSA'];

/** ISO shipping container. `open` builds a hollow 20 ft box you can walk into, with its doors swung open. */
export function container(b: Builder, m: TownMaterials, x: number, y: number, z: number, long: boolean, ry: number,
  colour: number, rnd: Rnd, open = false) {
  const L = long ? 12.19 : 6.06, W = 2.44, H = 2.59, mat = m.containers[colour % m.containers.length];
  const p = new Placer(b, x, y, z, ry);
  if (!open) {
    p.box(0, 0, 0, L, H, W, mat, 'metal', 2.4);
  } else {
    const t = 0.06;
    p.box(0, 0, 0, L, 0.14, W, m.woodGrey, 'wood', 2);
    p.box(0, H - t, 0, L, t, W, mat, 'metal', 2.4);
    p.box(0, 0.14, -W / 2 + t / 2, L, H - 0.14 - t, t, mat, 'metal', 2.4);
    p.box(0, 0.14, W / 2 - t / 2, L, H - 0.14 - t, t, mat, 'metal', 2.4);
    p.box(-L / 2 + t / 2, 0.14, 0, t, H - 0.14 - t, W - 2 * t, mat, 'metal', 2.4);
    // Doors swung open against the sides.
    for (const side of [-1, 1]) p.box(L / 2 + W / 4, 0.02, side * (W / 2 + 0.05), W / 2, H - 0.04, 0.05, mat, 'metal', 2.4);
  }
  // Frame: corner posts, top and bottom rails.
  const f = m.steel;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(sx * (L / 2 - 0.08), 0, sz * (W / 2 - 0.08), 0.18, H, 0.18, f, null, 1);
  for (const sz of [-1, 1]) for (const yy of [0, H - 0.14]) p.box(0, yy, sz * (W / 2 - 0.02), L - 0.2, 0.14, 0.08, f, null, 1);
  // Door end: seam and locking bars.
  if (!open) {
    p.box(L / 2 + 0.005, 0.1, 0, 0.02, H - 0.2, 0.03, m.black, null, 1);
    for (const bz of [-0.85, -0.45, 0.45, 0.85]) p.cyl(L / 2 + 0.04, 0.1, bz, 0.025, H - 0.2, m.metal, 6);
  }
  // Shipping line name on both long sides.
  const name = LINES[(colour + (long ? 2 : 0)) % LINES.length];
  const logo = decalMat(m, `line-${name}`, 512, 128, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e8e4da';
    ctx.font = 'bold 92px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, w / 2, h / 2 + 4);
  }, { transparent: true, wear: 0.9 });
  if (long || rnd() < 0.6) for (const side of [-1, 1]) plane(p, 0, H * 0.62, side * (W / 2 + 0.012), L * 0.5, L * 0.125, logo, side > 0 ? 0 : Math.PI);
}

/** Jersey barrier: sloped concrete profile, 3 m long. */
export function jersey(b: Builder, m: TownMaterials, x: number, z: number, ry: number) {
  const s = new Shape();
  s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.3, 0.08); s.lineTo(0.2, 0.3); s.lineTo(0.09, 0.82); s.lineTo(-0.09, 0.82);
  s.lineTo(-0.2, 0.3); s.lineTo(-0.3, 0.08); s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
  g.translate(0, 0, -1.5);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  const p = new Placer(b, x, 0, z, ry);
  p.geo(g, m.concrete);
  p.collide(-0.28, 0, -1.5, 0.28, 0.82, 1.5, 'concrete');
}

export function barrel(b: Builder, m: TownMaterials, x: number, z: number, rnd: Rnd, mat?: Material, tipped = false) {
  const mm = mat ?? (rnd() < 0.5 ? m.rust : m.containers[1]);
  if (tipped) {
    const p = new Placer(b, x, 0, z, rnd() * Math.PI);
    p.cyl(0, 0.29, -0.44, 0.29, 0.88, mm, 14, [Math.PI / 2, 0, 0]);
    p.collide(-0.29, 0, -0.44, 0.29, 0.58, 0.44, 'metal');
    return;
  }
  const p = new Placer(b, x, 0, z, 0);
  p.cyl(0, 0, 0, 0.29, 0.88, mm, 14);
  for (const yy of [0.29, 0.58]) p.cyl(0, yy, 0, 0.3, 0.03, mm, 14);
  b.collide(x - 0.28, 0, z - 0.28, x + 0.28, 0.88, z + 0.28, 'metal');
}

export function pallet(b: Builder, m: TownMaterials, x: number, y: number, z: number, ry: number, load: 'none' | 'boxes' | 'sacks' = 'none', rnd?: Rnd) {
  const p = new Placer(b, x, y, z, ry);
  for (const bz of [-0.5, 0, 0.5]) p.box(0, 0, bz, 1.2, 0.1, 0.1, m.woodGrey, null, 1);
  for (let k = 0; k < 7; k++) p.box(-0.54 + k * 0.18, 0.1, 0, 0.12, 0.03, 1.1, m.wood, null, 1);
  p.collide(-0.6, 0, -0.55, 0.6, 0.14, 0.55, 'wood');
  if (load === 'boxes') {
    const h = 0.5 + (rnd ? rnd() : 0.5) * 0.9;
    p.box(0, 0.14, 0, 1.1, h, 1.0, m.fabric[0], 'wood', 1);
  } else if (load === 'sacks') p.box(0, 0.14, 0, 1.1, 0.6, 1.0, m.sandbag, 'sand', 1);
}

export function tire(b: Builder, m: TownMaterials, x: number, y: number, z: number, rot: Rot) {
  const g = new TorusGeometry(0.3, 0.12, 8, 16);
  b.add(b.place(g, x, y, z, rot), m.rubber);
}

// ------------------------------------------------------------------------------------------------ street furniture

/** Wooden utility pole with a crossarm. Returns the three wire attachment points. */
export function powerPole(b: Builder, m: TownMaterials, x: number, z: number, ry: number, lean = 0, transformer = false): Vector3[] {
  const p = new Placer(b, x, 0, z, ry, lean, 0);
  p.cyl(0, -0.3, 0, 0.15, 10.3, m.bark, 8, null, 0.12);
  p.box(0, 9.1, 0, 2.3, 0.12, 0.12, m.woodGrey, null, 1);
  const pts: Vector3[] = [];
  for (const k of [-1, 0, 1]) {
    p.cyl(k * 1.0, 9.22, 0, 0.05, 0.2, m.white, 6);
    const c = Math.cos(ry), s = Math.sin(ry);
    pts.push(new Vector3(x + k * 1.0 * c, 9.4 + (lean ? -0.2 : 0), z - k * 1.0 * s));
  }
  if (transformer) p.cyl(0.25, 7.2, 0.3, 0.3, 1.0, m.metal, 12);
  b.collide(x - 0.15, 0, z - 0.15, x + 0.15, 9, z + 0.15, 'wood');
  return pts;
}

/** A sagging cable between two points. */
export function wire(b: Builder, m: TownMaterials, a: Vector3, c: Vector3, sag = 0.9) {
  const pts: Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new Vector3().lerpVectors(a, c, t).setY(a.y + (c.y - a.y) * t - sag * 4 * t * (1 - t)));
  }
  b.add(new TubeGeometry(new CatmullRomCurve3(pts), 10, 0.014, 3, false), m.black, false);
}

export function streetLight(b: Builder, m: TownMaterials, x: number, z: number, ry: number) {
  const p = new Placer(b, x, 0, z, ry);
  p.cyl(0, 0, 0, 0.1, 7.6, m.steel, 8, null, 0.07);
  p.box(0.9, 7.45, 0, 1.9, 0.08, 0.08, m.steel, null, 1);
  p.box(1.9, 7.3, 0, 0.7, 0.18, 0.32, m.steel, null, 1);
  p.box(1.9, 7.26, 0, 0.6, 0.04, 0.26, m.lampGlass, null, 1);
  b.collide(x - 0.12, 0, z - 0.12, x + 0.12, 7, z + 0.12, 'metal');
}

export function hydrant(b: Builder, m: TownMaterials, x: number, z: number) {
  const p = new Placer(b, x, 0, z, 0);
  p.cyl(0, 0, 0, 0.14, 0.6, m.pumpRed, 10);
  p.cyl(0, 0.6, 0, 0.1, 0.12, m.pumpRed, 10, null, 0.04);
  p.cyl(0, 0.36, 0, 0.05, 0.36, m.pumpRed, 8, [0, 0, Math.PI / 2]);
  b.collide(x - 0.15, 0, z - 0.15, x + 0.15, 0.7, z + 0.15, 'metal');
}

export function mailbox(b: Builder, m: TownMaterials, x: number, z: number, ry: number, rnd: Rnd) {
  const p = new Placer(b, x, 0, z, ry, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.2);
  p.box(0, 0, 0, 0.1, 1.0, 0.1, m.woodGrey, null, 1);
  p.box(0, 1.0, 0, 0.24, 0.22, 0.48, rnd() < 0.5 ? m.black : m.rust, null, 1);
}

/** Standard sign on a post: `face` is a decal material for the plate. */
export function signPost(b: Builder, x: number, z: number, ry: number, face: Material, pole: Material, w: number, h: number, top = 2.6,
  tilt = 0) {
  const p = new Placer(b, x, 0, z, ry, 0, tilt);
  p.cyl(0, 0, 0, 0.035, top, pole, 6);
  plane(p, 0, top - h / 2, 0.045, w, h, face, 0, true);
  plane(p, 0, top - h / 2, 0.04, w, h, pole, Math.PI, true);
}

export function stopSign(m: TownMaterials) {
  return decalMat(m, 'stop', 256, 256, (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    const oct = (r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        ctx.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
      }
      ctx.fill();
    };
    oct(126, '#eeeae0'); oct(116, '#a8261e');
    ctx.fillStyle = '#eeeae0';
    ctx.font = 'bold 78px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('STOP', w / 2, w / 2 + 4);
  }, { transparent: true, wear: 0.4 });
}

export function streetName(m: TownMaterials, name: string) {
  return decalMat(m, `street-${name}`, 512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#2d5a3a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8e4da'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 58px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, w / 2, h / 2 + 3);
  }, { wear: 0.25 });
}

/** Picket fence between two points on one axis. Missing pickets and a sagging section here and there. */
export function picketFence(b: Builder, m: TownMaterials, x0: number, z0: number, x1: number, z1: number, rnd: Rnd, mat?: Material) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const wood = mat ?? m.white;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const p = new Placer(b, cx, 0, cz, alongX ? 0 : Math.PI / 2);
  for (const yy of [0.25, 0.75]) p.box(0, yy, 0, len, 0.08, 0.04, wood, null, 1);
  for (let u = -len / 2; u <= len / 2; u += 2.4) p.box(u, 0, 0.04, 0.1, 1.1, 0.1, m.woodGrey, null, 1);
  for (let u = -len / 2 + 0.07; u < len / 2; u += 0.15) {
    if (rnd() < 0.1) continue;
    const lean = rnd() < 0.05 ? (rnd() - 0.5) * 0.6 : 0;
    p.box(u, 0.02, -0.04, 0.09, 0.98 + rnd() * 0.06, 0.025, wood, null, 1, lean ? [0, 0, lean] : null);
  }
  p.collide(-len / 2, 0, -0.08, len / 2, 1.0, 0.08, 'wood');
}

/** Chain-link fence with steel posts and a top rail. `gaps` are [from, to] distances along the run left open. */
export function chainFence(b: Builder, m: TownMaterials, x0: number, z0: number, x1: number, z1: number, h: number,
  gaps: [number, number][] = []) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const start = alongX ? Math.min(x0, x1) : Math.min(z0, z1), fixed = alongX ? z0 : x0;
  const runs: [number, number][] = [];
  let u = 0;
  for (const [g0, g1] of [...gaps].sort((a, c) => a[0] - c[0])) { if (g0 > u) runs.push([u, g0]); u = g1; }
  if (u < len) runs.push([u, len]);
  for (const [a, c] of runs) {
    const l = c - a, mid = start + (a + c) / 2;
    const p = new Placer(b, alongX ? mid : fixed, 0, alongX ? fixed : mid, alongX ? 0 : Math.PI / 2);
    const g = new PlaneGeometry(l, h - 0.05);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * l / 0.1, uv.getY(i) * h / 0.1);
    g.translate(0, h / 2, 0);
    p.geo(g, m.chain, false);
    p.cyl(-l / 2, h - 0.04, 0, 0.03, l, m.metal, 6, [0, 0, -Math.PI / 2]);
    for (let k = 0; k <= Math.ceil(l / 3); k++) p.cyl(-l / 2 + Math.min(l, k * 3), 0, 0, 0.04, h + 0.35, m.metal, 6);
    // Barbed wire strands on top.
    for (const yy of [h + 0.12, h + 0.26]) p.box(0, yy, -0.06, l, 0.012, 0.012, m.black, null, 1, null, false);
    p.collide(-l / 2, 0, -0.04, l / 2, h + 0.3, 0.04, 'metal');
  }
}

// ------------------------------------------------------------------------------------------------ indoor

export function couch(p: Placer, m: TownMaterials, lx: number, lz: number, ry: number, fabric: Material) {
  const q = sub(p, lx, lz, ry);
  q.box(0, 0.1, 0, 2.0, 0.35, 0.85, fabric, 'wood', 1);
  q.box(0, 0.45, -0.34, 2.0, 0.45, 0.2, fabric, null, 1);
  for (const s of [-1, 1]) q.box(s * 0.92, 0.45, 0, 0.18, 0.22, 0.85, fabric, null, 1);
  q.box(0, 0, 0, 1.9, 0.1, 0.75, m.black, null, 1);
}

export function table(p: Placer, m: TownMaterials, lx: number, lz: number, ry: number, w = 1.4, d = 0.8, knocked = false) {
  const q = sub(p, lx, lz, ry);
  if (knocked) {
    q.box(0, 0.04, 0, w, 0.05, d, m.wood, 'wood', 1, [0, 0, 0.12]);
    return;
  }
  q.box(0, 0.72, 0, w, 0.05, d, m.wood, 'wood', 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) q.box(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.06, 0.72, 0.06, m.wood, null, 1);
}

export function bed(p: Placer, m: TownMaterials, lx: number, lz: number, ry: number, fabric: Material) {
  const q = sub(p, lx, lz, ry);
  q.box(0, 0, 0, 1.5, 0.3, 2.0, m.wood, 'wood', 1);
  q.box(0, 0.3, 0.02, 1.44, 0.22, 1.94, fabric, null, 1, [0, 0.05, 0]);
  q.box(0, 0.3, -0.98, 1.5, 0.7, 0.06, m.wood, null, 1);
}

export function counter(p: Placer, m: TownMaterials, lx: number, lz: number, ry: number, len: number, top: Material = m.concrete) {
  const q = sub(p, lx, lz, ry);
  q.box(0, 0, 0, len, 0.88, 0.62, m.woodGrey, 'wood', 1);
  q.box(0, 0.88, 0.02, len + 0.04, 0.05, 0.66, top, null, 1);
}

export function fridge(p: Placer, m: TownMaterials, lx: number, lz: number, ry: number, tipped = false) {
  const q = sub(p, lx, lz, ry);
  if (tipped) q.box(0, 0, 0.6, 0.75, 0.7, 1.75, m.white, 'metal', 1);
  else { q.box(0, 0, 0, 0.75, 1.75, 0.7, m.white, 'metal', 1); q.box(0.3, 1.0, 0.36, 0.04, 0.5, 0.04, m.chrome, null, 1); }
}

export function shelf(p: Placer, _m: TownMaterials, lx: number, lz: number, ry: number, len: number, h: number, mat: Material, rnd: Rnd,
  goods: Material[] = []) {
  const q = sub(p, lx, lz, ry);
  for (const s of [-1, 1]) q.box(s * (len / 2 - 0.03), 0, 0, 0.05, h, 0.5, mat, null, 1);
  q.box(0, 0, -0.22, len, h, 0.04, mat, null, 1);
  for (let yy = 0.1; yy < h; yy += 0.45) {
    q.box(0, yy, 0, len, 0.03, 0.5, mat, null, 1);
    if (goods.length) for (let u = -len / 2 + 0.2; u < len / 2 - 0.15; u += 0.22) {
      if (rnd() < 0.45) continue;
      q.box(u, yy + 0.03, (rnd() - 0.5) * 0.2, 0.16, 0.12 + rnd() * 0.2, 0.18, goods[Math.floor(rnd() * goods.length)], null, 1);
    }
  }
  q.collide(-len / 2, 0, -0.25, len / 2, h, 0.25, 'wood');
}

/** Scattered junk: planks, cans and paper on the floor, visual only. */
export function debris(p: Placer, m: TownMaterials, lx: number, lz: number, spread: number, count: number, rnd: Rnd) {
  for (let k = 0; k < count; k++) {
    const x = lx + (rnd() - 0.5) * spread, z = lz + (rnd() - 0.5) * spread;
    const kind = rnd();
    if (kind < 0.4) p.box(x, 0.01, z, 0.8 + rnd() * 1.2, 0.03, 0.12, m.woodGrey, null, 1, [0, rnd() * Math.PI, 0]);
    else if (kind < 0.7) p.box(x, 0.01, z, 0.3, 0.005, 0.22, m.white, null, 1, [0, rnd() * Math.PI, 0], false);
    else p.cyl(x, 0.035, z, 0.035, 0.12, m.chrome, 6, [Math.PI / 2, rnd() * Math.PI, 0]);
  }
}

const sub = (p: Placer, lx: number, lz: number, ry: number) => p.at(lx, lz, ry);
