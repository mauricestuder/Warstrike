import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  NormalBlending, PlaneGeometry, PointLight, Quaternion, Sprite, SpriteMaterial, Vector3, type Scene,
} from 'three';
import { rand } from '../core/math';
import type { Surface } from '../world/Colliders';

const MAX_DECALS = 256, MAX_TRACERS = 48, MAX_PARTICLES = 220;

function softDot(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Bullet hole: dark core, torn ring, faint scorch. Tinted per surface through instance colour. */
function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.22, 'rgba(20,16,12,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // Jagged cracks.
  ctx.strokeStyle = 'rgba(20,16,12,0.6)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, l = 10 + Math.random() * 14;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    ctx.lineTo(32 + Math.cos(a + 0.2) * l, 32 + Math.sin(a + 0.2) * l);
    ctx.stroke();
  }
  return new CanvasTexture(c);
}

const DECAL_TINT: Record<Surface, number> = {
  concrete: 0xb8b2a8, wood: 0xd8b888, metal: 0xe8e8ee, dirt: 0x5a4a36, steel: 0xffffff, sand: 0x7a6a50,
};
const DUST: Record<Surface, number> = {
  concrete: 0xb5ada0, wood: 0x9c7a52, metal: 0x9a9a9a, dirt: 0x7a6548, steel: 0xaaaaaa, sand: 0xa89470,
};

interface Particle { s: Sprite; v: Vector3; life: number; max: number; grow: number; gravity: number; }
interface Tracer { m: Mesh; life: number; max: number; }

/**
 * World-space effects: decals (instanced, ring buffer), tracers, impact dust and sparks, blood puffs, and a
 * muzzle light that briefly lights the surroundings when you fire.
 */
export class Effects {
  private decals: InstancedMesh;
  private decalIdx = 0;
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private particles: Particle[] = [];
  private particleIdx = 0;
  private dustMat: SpriteMaterial;
  private sparkMat: SpriteMaterial;
  private bloodMat: SpriteMaterial;
  readonly muzzleLight = new PointLight(0xffb060, 0, 12, 2);
  private muzzleT = 0;

  constructor(scene: Scene) {
    const decalMat = new MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true,
    });
    this.decals = new InstancedMesh(new PlaneGeometry(1, 1), decalMat, MAX_DECALS);
    this.decals.instanceMatrix.setUsage(DynamicDrawUsage);
    this.decals.frustumCulled = false;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) { this.decals.setMatrixAt(i, zero); this.decals.setColorAt(i, new Color(1, 1, 1)); }
    scene.add(this.decals);

    const tracerGeo = new BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new Mesh(tracerGeo, new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ m, life: 0, max: 1 });
    }

    this.dustMat = new SpriteMaterial({ map: softDot('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false, blending: NormalBlending });
    this.sparkMat = new SpriteMaterial({ map: softDot('rgba(255,240,200,1)', 'rgba(255,140,40,0)'), transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    this.bloodMat = new SpriteMaterial({ map: softDot('rgba(140,10,10,0.95)', 'rgba(90,0,0,0)'), transparent: true, depthWrite: false });
    for (let i = 0; i < MAX_PARTICLES; i++) {
      // Each particle owns its material so colour and fade are per particle.
      const s = new Sprite(this.dustMat.clone());
      s.visible = false;
      scene.add(s);
      this.particles.push({ s, v: new Vector3(), life: 0, max: 1, grow: 0, gravity: 0 });
    }
    scene.add(this.muzzleLight);
  }

  private readonly m4 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly z = new Vector3(0, 0, 1);

  decal(p: Vector3, n: Vector3, surface: Surface, size = 0.09) {
    if (surface === 'steel') return; // steel plates get repainted, keep them clean
    this.q.setFromUnitVectors(this.z, n);
    // Random spin so repeated holes don't look stamped.
    this.q.multiply(new Quaternion().setFromAxisAngle(this.z, Math.random() * Math.PI * 2));
    const s = size * rand(0.8, 1.25);
    this.m4.compose(p.clone().addScaledVector(n, 0.004), this.q, new Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIdx, this.m4);
    this.decals.setColorAt(this.decalIdx, new Color(DECAL_TINT[surface]));
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  private spawn(mat: SpriteMaterial, p: Vector3, v: Vector3, size: number, life: number, grow: number, gravity: number, color?: number) {
    const pt = this.particles[this.particleIdx];
    this.particleIdx = (this.particleIdx + 1) % MAX_PARTICLES;
    const m = pt.s.material;
    m.map = mat.map;
    m.blending = mat.blending;
    m.fog = mat.fog;
    m.color.set(color ?? 0xffffff);
    m.opacity = 1;
    pt.s.position.copy(p);
    pt.s.scale.setScalar(size);
    pt.s.visible = true;
    pt.v.copy(v);
    pt.life = pt.max = life;
    pt.grow = grow;
    pt.gravity = gravity;
  }

  impact(p: Vector3, n: Vector3, surface: Surface) {
    this.decal(p, n, surface);
    const hard = surface === 'metal' || surface === 'steel';
    const puffs = hard ? 2 : 5;
    for (let i = 0; i < puffs; i++) {
      const v = n.clone().multiplyScalar(rand(0.6, 2.2)).add(new Vector3(rand(-0.6, 0.6), rand(0, 0.9), rand(-0.6, 0.6)));
      this.spawn(this.dustMat, p, v, rand(0.08, 0.16), rand(0.5, 0.9), rand(0.5, 0.9), 0.6, DUST[surface]);
    }
    if (hard || surface === 'concrete') {
      for (let i = 0; i < (hard ? 7 : 3); i++) {
        const v = n.clone().multiplyScalar(rand(2, 6)).add(new Vector3(rand(-3, 3), rand(-1, 3), rand(-3, 3)));
        this.spawn(this.sparkMat, p, v, rand(0.025, 0.05), rand(0.12, 0.3), -0.05, 9.8);
      }
    }
  }

  blood(p: Vector3, dir: Vector3, head: boolean) {
    for (let i = 0; i < (head ? 9 : 5); i++) {
      const v = dir.clone().multiplyScalar(rand(0.5, 2)).add(new Vector3(rand(-0.8, 0.8), rand(-0.2, 1.2), rand(-0.8, 0.8)));
      this.spawn(this.bloodMat, p, v, rand(0.07, 0.16), rand(0.25, 0.5), 0.6, 4);
    }
  }

  tracer(from: Vector3, to: Vector3, width = 0.012, life = 0.05, color = 0xffd9a0) {
    const len = from.distanceTo(to);
    if (len < 0.3) return;
    const tr = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    tr.m.position.copy(from);
    tr.m.lookAt(to);
    tr.m.rotateY(Math.PI); // lookAt points +z at the target; the geometry extends along -z
    tr.m.scale.set(width, width, len);
    tr.m.visible = true;
    (tr.m.material as MeshBasicMaterial).color.set(color);
    tr.life = tr.max = life;
  }

  muzzle(p: Vector3) {
    this.muzzleLight.position.copy(p);
    this.muzzleT = 0.05;
  }

  update(dt: number) {
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.life -= dt;
      if (t.life <= 0) { t.m.visible = false; continue; }
      (t.m.material as MeshBasicMaterial).opacity = t.life / t.max;
    }
    for (const p of this.particles) {
      if (!p.s.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.y -= p.gravity * dt;
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.multiplyScalar(1 + p.grow * dt);
      p.s.material.opacity = Math.min(1, (p.life / p.max) * 2);
    }
    this.muzzleT -= dt;
    this.muzzleLight.intensity = this.muzzleT > 0 ? 30 * (this.muzzleT / 0.05) : 0;
  }
}
