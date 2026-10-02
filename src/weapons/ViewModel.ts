import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CapsuleGeometry, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, SphereGeometry, TorusGeometry, Vector3, type Scene,
} from 'three';
import { clamp, damp, smoothstep } from '../core/math';
import type { GunId, WeaponId } from './defs';

interface GunModel {
  root: Group;
  muzzle: Object3D;
  mag: Object3D;
  magHome: Vector3;
  /** Height of the sight line above the gun origin, and its z, for lining up ADS. */
  sightY: number;
  sightZ: number;
  /** How far in front of the eye the sight sits when aiming. */
  eyeRelief: number;
  /** Pump-action forend (slides back and forth after each shot). */
  pump?: Object3D;
}

const polymer = new MeshStandardMaterial({ color: 0x1f2124, roughness: 0.62, metalness: 0.05 });
const metal = new MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.32, metalness: 0.85 });
/** Default furniture colour; every gun gets its own copy so it can take its rarity colour. */
export const TAN = 0x8b7a5a;
const glove = new MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.8 });
const sleeve = new MeshStandardMaterial({ color: 0x4f573f, roughness: 0.9 });
const glass = new MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 });
const redDot = new MeshBasicMaterial({ color: 0xff2020 });

function box(g: Group, m: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  g.add(mesh);
  return mesh;
}

function cyl(g: Group, m: MeshStandardMaterial, r: number, len: number, x: number, y: number, z: number, seg = 16) {
  const mesh = new Mesh(new CylinderGeometry(r, r, len, seg), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Gloved hands and sleeves, posed on the grip and the handguard. Returns the left hand and arm. */
function hands(g: Group, gripZ: number, foreZ: number, foreY: number, show: boolean): Object3D[] {
  if (!show) return [];
  const right = box(g, glove, 0.05, 0.07, 0.07, 0.012, -0.04, gripZ + 0.01);
  right.rotation.x = -0.3;
  const left = box(g, glove, 0.06, 0.05, 0.09, -0.012, foreY - 0.03, foreZ);
  left.rotation.z = 0.3;
  const arm = (from: Vector3, to: Vector3, r: number) => {
    const len = from.distanceTo(to);
    const m = new Mesh(new CapsuleGeometry(r, len, 4, 10), sleeve);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    m.rotateX(Math.PI / 2);
    g.add(m);
    return m;
  };
  arm(new Vector3(0.02, -0.07, gripZ + 0.05), new Vector3(0.12, -0.26, gripZ + 0.34), 0.038);
  return [left, arm(new Vector3(-0.03, foreY - 0.06, foreZ + 0.03), new Vector3(-0.2, -0.28, foreZ + 0.3), 0.036)];
}

function buildAR(tan: MeshStandardMaterial, withHands = true): GunModel {
  const g = new Group();
  box(g, polymer, 0.058, 0.075, 0.3, 0, 0.035, -0.1);
  box(g, tan, 0.056, 0.062, 0.28, 0, 0.045, -0.38);
  for (let i = 0; i < 5; i++) box(g, polymer, 0.058, 0.01, 0.025, 0, 0.012, -0.28 - i * 0.045); // handguard slots
  cyl(g, metal, 0.011, 0.18, 0, 0.045, -0.6);
  cyl(g, metal, 0.016, 0.055, 0, 0.045, -0.71, 8);
  const mag = box(g, polymer, 0.034, 0.17, 0.068, 0, -0.07, -0.12, 0.22);
  box(g, polymer, 0.03, 0.1, 0.045, 0, -0.04, 0.02, -0.35);
  box(g, tan, 0.045, 0.07, 0.22, 0, 0.03, 0.17);
  box(g, polymer, 0.05, 0.1, 0.03, 0, 0.02, 0.28);
  box(g, metal, 0.022, 0.012, 0.36, 0, 0.078, -0.2);
  // Red-dot sight: base, window frame, tinted glass, dot.
  const sightY = 0.118, sz = -0.07;
  box(g, metal, 0.03, 0.022, 0.06, 0, 0.093, sz);
  box(g, polymer, 0.036, 0.006, 0.05, 0, sightY + 0.02, sz);
  for (const s of [-1, 1]) box(g, polymer, 0.005, 0.04, 0.05, s * 0.0175, sightY, sz);
  const lens = new Mesh(new PlaneGeometry(0.03, 0.034), glass);
  lens.position.set(0, sightY, sz - 0.02);
  g.add(lens);
  const dot = new Mesh(new SphereGeometry(0.0009, 6, 4), redDot);
  dot.position.set(0, sightY, sz - 0.021);
  g.add(dot);
  hands(g, 0.02, -0.36, 0.02, withHands);
  const muzzle = new Object3D();
  muzzle.position.set(0, 0.045, -0.75);
  g.add(muzzle);
  return { root: g, muzzle, mag, magHome: mag.position.clone(), sightY, sightZ: sz, eyeRelief: 0.2 };
}

function buildSMG(tan: MeshStandardMaterial, withHands = true): GunModel {
  const g = new Group();
  box(g, polymer, 0.052, 0.085, 0.3, 0, 0.03, -0.1);
  box(g, tan, 0.054, 0.03, 0.22, 0, -0.012, -0.1); // lower receiver
  box(g, tan, 0.022, 0.05, 0.03, 0.03, 0.02, 0.23); // stock pad
  cyl(g, metal, 0.018, 0.13, 0, 0.04, -0.31);
  cyl(g, metal, 0.009, 0.04, 0, 0.04, -0.39, 8);
  const mag = box(g, metal, 0.03, 0.2, 0.048, 0, -0.1, -0.09, 0.05);
  box(g, polymer, 0.03, 0.1, 0.045, 0, -0.04, 0.03, -0.3);
  box(g, metal, 0.012, 0.012, 0.2, 0.03, 0.02, 0.12); // folded stock
  // Iron sights: rear aperture ring and a hooded front post.
  const sightY = 0.1;
  const ring = new Mesh(new TorusGeometry(0.0065, 0.0025, 6, 16), metal);
  ring.position.set(0, sightY, 0.02);
  g.add(ring);
  box(g, metal, 0.02, 0.018, 0.012, 0, sightY - 0.014, 0.02);
  box(g, metal, 0.003, 0.018, 0.004, 0, sightY - 0.009, -0.33);
  for (const s of [-1, 1]) box(g, metal, 0.003, 0.024, 0.01, s * 0.011, sightY - 0.008, -0.33);
  box(g, metal, 0.03, 0.012, 0.03, 0, 0.08, -0.33);
  hands(g, 0.03, -0.28, 0.0, withHands);
  const muzzle = new Object3D();
  muzzle.position.set(0, 0.04, -0.42);
  g.add(muzzle);
  return { root: g, muzzle, mag, magHome: mag.position.clone(), sightY, sightZ: 0.02, eyeRelief: 0.14 };
}

function buildSniper(tan: MeshStandardMaterial, withHands = true): GunModel {
  const g = new Group();
  box(g, polymer, 0.062, 0.075, 0.36, 0, 0.03, -0.1);
  box(g, tan, 0.05, 0.11, 0.3, 0, 0.0, 0.22);
  box(g, tan, 0.04, 0.03, 0.12, 0, 0.07, 0.18); // cheek rest
  box(g, polymer, 0.064, 0.05, 0.35, 0, 0.0, -0.44);
  cyl(g, metal, 0.014, 0.65, 0, 0.04, -0.72);
  cyl(g, metal, 0.022, 0.08, 0, 0.04, -1.06, 8);
  const mag = box(g, metal, 0.04, 0.09, 0.08, 0, -0.04, -0.1);
  box(g, polymer, 0.03, 0.1, 0.045, 0, -0.05, 0.05, -0.3);
  const bolt = cyl(g, metal, 0.006, 0.05, 0.045, 0.045, 0.02, 8);
  bolt.rotation.set(0, 0, Math.PI / 2);
  const knob = new Mesh(new SphereGeometry(0.012, 10, 8), metal);
  knob.position.set(0.07, 0.045, 0.02);
  g.add(knob);
  // Scope: tube, bells, turrets, rings.
  const sightY = 0.115;
  cyl(g, polymer, 0.017, 0.3, 0, sightY, -0.1);
  cyl(g, polymer, 0.027, 0.08, 0, sightY, -0.28);
  cyl(g, polymer, 0.023, 0.07, 0, sightY, 0.08);
  const tur = new Mesh(new CylinderGeometry(0.012, 0.012, 0.03, 12), polymer);
  tur.position.set(0, sightY + 0.025, -0.1);
  g.add(tur);
  for (const z of [-0.18, -0.02]) box(g, metal, 0.03, 0.05, 0.02, 0, 0.085, z);
  const lens = new Mesh(new PlaneGeometry(0.04, 0.04), glass);
  lens.position.set(0, sightY, -0.321);
  g.add(lens);
  hands(g, 0.05, -0.42, 0.02, withHands);
  const muzzle = new Object3D();
  muzzle.position.set(0, 0.04, -1.1);
  g.add(muzzle);
  return { root: g, muzzle, mag, magHome: mag.position.clone(), sightY, sightZ: 0.1, eyeRelief: 0.12 };
}

/** Pump-action shotgun: receiver, barrel over a tube magazine, a sliding forend, bead sight. */
function buildShotgun(tan: MeshStandardMaterial, withHands = true): GunModel {
  const g = new Group();
  box(g, polymer, 0.056, 0.08, 0.26, 0, 0.03, -0.08); // receiver
  box(g, metal, 0.004, 0.03, 0.08, 0.029, 0.04, -0.1); // ejection port edge
  box(g, tan, 0.046, 0.09, 0.26, 0, 0.0, 0.17, 0.12); // stock
  box(g, polymer, 0.05, 0.11, 0.03, 0, -0.01, 0.31, 0.12); // butt pad
  box(g, polymer, 0.03, 0.1, 0.045, 0, -0.04, 0.03, -0.3); // grip
  box(g, metal, 0.012, 0.03, 0.05, 0, -0.025, -0.02); // trigger guard
  cyl(g, metal, 0.016, 0.5, 0, 0.05, -0.45); // barrel
  cyl(g, metal, 0.013, 0.42, 0, 0.012, -0.4); // tube magazine
  cyl(g, metal, 0.015, 0.02, 0, 0.012, -0.62, 10); // mag cap
  box(g, metal, 0.02, 0.012, 0.02, 0, 0.012, -0.66); // barrel band
  // Raised rib along the barrel with a bead at the end and a notch at the back (high enough to see over the receiver).
  const sightY = 0.094;
  box(g, polymer, 0.01, 0.022, 0.62, 0, 0.078, -0.38);
  const bead = new Mesh(new SphereGeometry(0.0045, 8, 6), new MeshStandardMaterial({ color: 0xd8d0b0, roughness: 0.3, metalness: 0.6 }));
  bead.position.set(0, sightY, -0.67);
  g.add(bead);
  for (const s of [-1, 1]) box(g, metal, 0.008, 0.012, 0.01, s * 0.009, sightY, -0.02);
  // The pump: a ribbed forend on the tube, and the left hand rides on it.
  const pump = new Group();
  box(pump, tan, 0.046, 0.042, 0.17, 0, 0.012, -0.36);
  for (let i = 0; i < 6; i++) box(pump, polymer, 0.048, 0.006, 0.012, 0, -0.008, -0.295 - i * 0.026);
  g.add(pump);
  for (const o of hands(g, 0.03, -0.36, 0.0, withHands)) pump.attach(o);
  // A shell going into the loading port during reloads.
  const mag = new Group();
  mag.position.set(0, -0.02, -0.09);
  const shell = new Mesh(new CylinderGeometry(0.009, 0.009, 0.06, 10), new MeshStandardMaterial({ color: 0xb02020, roughness: 0.5 }));
  shell.rotation.x = Math.PI / 2;
  mag.add(shell);
  g.add(mag);
  const muzzle = new Object3D();
  muzzle.position.set(0, 0.05, -0.71);
  g.add(muzzle);
  return { root: g, muzzle, mag, magHome: mag.position.clone(), sightY, sightZ: -0.02, eyeRelief: 0.26, pump };
}

/** A gun without arms, for loot on the ground. The accent material carries the rarity colour. */
export function buildGunMesh(id: GunId, accent: MeshStandardMaterial): Group {
  const m = id === 'ar' ? buildAR(accent, false) : id === 'smg' ? buildSMG(accent, false)
    : id === 'shotgun' ? buildShotgun(accent, false) : buildSniper(accent, false);
  return m.root;
}

interface Fists { model: GunModel; arms: [Group, Group]; }

/** Bare hands: two gloved fists in a loose guard, each on a forearm that pivots at the elbow. */
function buildHands(): Fists {
  const g = new Group();
  const leather = new MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.75 });
  const knuckle = new MeshStandardMaterial({ color: 0x4a3c2e, roughness: 0.7 });
  const arm = (side: number) => {
    const a = new Group();
    // Elbow sits low and to the side; the fist is ~0.33 m in front of it.
    a.position.set(side < 0 ? -0.391 : 0.061, -0.083, 0.2);
    const fore = new Mesh(new CapsuleGeometry(0.042, 0.24, 4, 10), sleeve);
    fore.rotation.x = Math.PI / 2;
    fore.position.set(0, 0, -0.12);
    a.add(fore);
    const cuff = new Mesh(new CylinderGeometry(0.044, 0.04, 0.06, 12), glove);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, -0.26);
    a.add(cuff);
    // Back of the hand, then four curled fingers with a knuckle ridge, and the thumb across them.
    const palm = new Mesh(new BoxGeometry(0.078, 0.07, 0.07), leather);
    palm.position.set(0, 0, -0.31);
    a.add(palm);
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.019;
      const finger = new Mesh(new BoxGeometry(0.017, 0.05, 0.03), leather);
      finger.position.set(fx, -0.006, -0.355);
      a.add(finger);
      const k = new Mesh(new BoxGeometry(0.017, 0.016, 0.022), knuckle);
      k.position.set(fx, 0.026, -0.36);
      a.add(k);
    }
    const thumb = new Mesh(new BoxGeometry(0.05, 0.02, 0.022), leather);
    thumb.position.set(-side * 0.012, -0.03, -0.372);
    thumb.rotation.y = side * 0.25;
    a.add(thumb);
    a.rotation.set(0.35, side * 0.18, side * -0.15);
    g.add(a);
    return a;
  };
  const arms: [Group, Group] = [arm(-1), arm(1)];
  const muzzle = new Object3D();
  muzzle.position.set(-0.165, 0.1, -0.4);
  g.add(muzzle);
  const mag = new Object3D();
  g.add(mag);
  return { model: { root: g, muzzle, mag, magHome: mag.position.clone(), sightY: 0, sightZ: 0, eyeRelief: 0.3 }, arms };
}

/** Armour plate held in the left hand while plating up. */
function buildPlate(): Group {
  const g = new Group();
  const plate = new Mesh(new BoxGeometry(0.22, 0.28, 0.025), new MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.55, metalness: 0.35 }));
  g.add(plate);
  const strap = new Mesh(new BoxGeometry(0.224, 0.05, 0.03), new MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.6 }));
  strap.position.y = 0.06;
  g.add(strap);
  const hand = new Mesh(new BoxGeometry(0.06, 0.08, 0.07), glove);
  hand.position.set(-0.08, -0.12, 0.03);
  g.add(hand);
  const arm = new Mesh(new CapsuleGeometry(0.038, 0.3, 4, 10), sleeve);
  arm.position.set(-0.14, -0.28, 0.12);
  arm.rotation.set(0.5, 0, 0.45);
  g.add(arm);
  return g;
}

/** Parachute canopy above your head, with lines down to the harness. Striped so it reads from below. */
function buildCanopy(): Group {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#5b6a3e' : '#d0702a'; ctx.fillRect(i * 32, 0, 32, 32); }
  const tex = new CanvasTexture(c);
  const g = new Group();
  const dome = new Mesh(new SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.32),
    new MeshStandardMaterial({ map: tex, side: DoubleSide, roughness: 0.9 }));
  dome.scale.set(3.4, 1.4, 2.4);
  dome.position.y = 2.4;
  g.add(dome);
  const lineMat = new MeshBasicMaterial({ color: 0x222222 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const top = new Vector3(Math.cos(a) * 3.4 * 0.84, 2.4 + 1.4 * 0.54, Math.sin(a) * 2.4 * 0.84);
    const bot = new Vector3(Math.cos(a) > 0 ? 0.2 : -0.2, -0.1, 0.1);
    const len = top.distanceTo(bot);
    const l = new Mesh(new CylinderGeometry(0.004, 0.004, len, 3), lineMat);
    l.position.copy(top).add(bot).multiplyScalar(0.5);
    l.lookAt(top);
    l.rotateX(Math.PI / 2);
    g.add(l);
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,200,100,0.9)');
  g.addColorStop(0.6, 'rgba(255,120,30,0.25)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 26 : 64;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.fill();
  return new CanvasTexture(c);
}

export interface VmState {
  ads: number;
  sprint: number;
  crouch: number;
  slide: number;
  speed: number;
  grounded: boolean;
  /** 0..1 reload progress, or -1 when not reloading. */
  reload: number;
  reloadEmpty: boolean;
  /** 0..1 draw progress. */
  draw: number;
  /** 0..1 inspect progress, or -1. */
  inspect: number;
  /** Hide the gun (looking through a scope, falling, in the plane). */
  hidden: boolean;
  /** 0..1 how far the gun is lowered (plating up, shop open). */
  lower: number;
  /** 0..1 progress of the plate being inserted, or -1. */
  plate: number;
  /** Parachute open. */
  chute: boolean;
  /** Camera pitch (the canopy is counter-rotated so it stays above you). */
  pitch: number;
}

/**
 * The first-person gun: procedural models plus all the motion that sells weight —
 * mouse-lag sway, walk bob, sprint and slide poses, ADS lerp that lines the real sight up with the eye,
 * spring-driven recoil kick, reload (mag drops and returns), draw and inspect.
 */
export class ViewModel {
  private models: Record<WeaponId, GunModel>;
  private accents: Record<GunId, MeshStandardMaterial>;
  private current: GunModel;
  private fists: Fists;
  private punchT = -1;
  private punchSide = 0;
  private plateMesh: Group;
  private canopy: Group;
  private chuteK = 0;
  private pivot = new Group();
  private flash: Group;
  private flashT = 0;
  // Springs for recoil kick (position z / pitch) and mouse sway.
  private kickZ = 0; private kickZV = 0;
  private kickP = 0; private kickPV = 0;
  private kickYaw = 0; private kickYawV = 0;
  private swayX = 0; private swayY = 0;
  private bobT = 0;
  private landDip = 0; private landV = 0;
  private pumpT = -1;

  constructor(scene: Scene) {
    const accent = () => new MeshStandardMaterial({ color: TAN, roughness: 0.7, metalness: 0 });
    this.accents = { ar: accent(), smg: accent(), sniper: accent(), shotgun: accent() };
    this.fists = buildHands();
    this.models = {
      ar: buildAR(this.accents.ar), smg: buildSMG(this.accents.smg), sniper: buildSniper(this.accents.sniper),
      shotgun: buildShotgun(this.accents.shotgun), hands: this.fists.model,
    };
    this.plateMesh = buildPlate();
    this.plateMesh.scale.setScalar(0.75);
    this.plateMesh.visible = false;
    this.plateMesh.traverse((o) => { o.frustumCulled = false; });
    scene.add(this.plateMesh);
    this.canopy = buildCanopy();
    this.canopy.visible = false;
    scene.add(this.canopy);
    for (const m of Object.values(this.models)) {
      m.root.visible = false;
      m.root.traverse((o) => { o.frustumCulled = false; });
      this.pivot.add(m.root);
    }
    this.current = this.models.ar;
    this.current.root.visible = true;
    scene.add(this.pivot);

    const mat = new MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.flash = new Group();
    for (let i = 0; i < 3; i++) {
      const p = new Mesh(new PlaneGeometry(0.16, 0.16), mat);
      if (i === 1) { p.rotation.y = Math.PI / 2; p.scale.set(2.2, 1, 1); p.position.z = -0.08; }
      if (i === 2) { p.rotation.x = Math.PI / 2; p.scale.set(1, 2.2, 1); p.position.z = -0.08; }
      this.flash.add(p);
    }
    this.flash.visible = false;
  }

  /** Paints the gun's furniture in its rarity colour (legendary is gold, and metallic). */
  setRarity(id: GunId, color: string, legendary: boolean) {
    const m = this.accents[id];
    m.color.set(color === '#b9bec4' ? TAN : color);
    if (!legendary && color !== '#b9bec4') m.color.multiplyScalar(0.75);
    m.metalness = legendary ? 0.85 : 0;
    m.roughness = legendary ? 0.3 : 0.7;
  }

  /** Throws a punch with alternating fists. */
  punch() {
    this.punchSide = 1 - this.punchSide;
    this.punchT = 0;
  }

  select(id: WeaponId) {
    this.current.root.visible = false;
    this.current = this.models[id];
    this.current.root.visible = true;
    this.current.muzzle.add(this.flash);
  }

  /** World-ish muzzle position in viewmodel space (for tracers we convert via the camera). */
  muzzleLocal(out: Vector3) {
    this.current.muzzle.updateWorldMatrix(true, false);
    return this.current.muzzle.getWorldPosition(out);
  }

  kick(up: number, back: number, side: number) {
    this.kickPV += up;
    this.kickZV += back;
    this.kickYawV += side;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flashT = 0.035;
  }

  /** Racks the pump after a shotgun shot. */
  cycle() { this.pumpT = 0; }

  land(impact: number) {
    this.landV -= Math.min(impact, 12) * 0.012;
  }

  update(dt: number, s: VmState, mouseDX: number, mouseDY: number) {
    const m = this.current;
    // Springs (critically-ish damped).
    const spring = (x: number, v: number, k: number, c: number): [number, number] => {
      v += (-k * x - c * v) * dt;
      return [x + v * dt, v];
    };
    [this.kickZ, this.kickZV] = spring(this.kickZ, this.kickZV, 380, 30);
    [this.kickP, this.kickPV] = spring(this.kickP, this.kickPV, 300, 26);
    [this.kickYaw, this.kickYawV] = spring(this.kickYaw, this.kickYawV, 300, 26);
    [this.landDip, this.landV] = spring(this.landDip, this.landV, 120, 14);

    const adsK = 1 - s.ads * 0.85;
    this.swayX = damp(this.swayX, clamp(-mouseDX * 0.0009, -0.05, 0.05) * adsK, 10, dt);
    this.swayY = damp(this.swayY, clamp(mouseDY * 0.0009, -0.05, 0.05) * adsK, 10, dt);

    if (s.grounded && s.speed > 0.3) this.bobT += dt * (s.sprint > 0.5 ? 13 : 9.5) * Math.min(1.2, s.speed / 4.8);
    const bobAmp = (s.grounded ? Math.min(1.3, s.speed / 5) : 0) * adsK;
    const bobX = Math.sin(this.bobT) * 0.012 * bobAmp;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmp;

    // Hip → ADS base position: in ADS the sight sits dead centre, `eyeRelief` in front of the eye.
    const hip = new Vector3(0.165, -0.2, -0.36);
    const ads = new Vector3(0, -m.sightY, -m.eyeRelief - m.sightZ);
    const ease = smoothstep(0, 1, s.ads);
    const pos = hip.lerp(ads, ease);
    let rx = 0, ry = 0, rz = 0;

    // Sprint: gun tucked down and canted.
    const sp = s.sprint * (1 - s.ads);
    pos.x += sp * -0.04; pos.y += sp * -0.05; pos.z += sp * 0.04;
    rx += sp * -0.35; ry += sp * 0.6; rz += sp * 0.25;
    rx += Math.sin(this.bobT * 2) * 0.03 * sp;

    // Slide: roll the gun in.
    rz += s.slide * 0.35 * (1 - s.ads);
    pos.x -= s.slide * 0.03;

    // Crouch: slight cant.
    rz += s.crouch * 0.06 * (1 - s.ads);

    // Reload: tilt the gun, drop the mag and bring a new one back.
    const magPos = m.magHome.clone();
    if (s.reload >= 0) {
      const r = s.reload, tilt = smoothstep(0, 0.15, r) * (1 - smoothstep(0.85, 1, r));
      rz += tilt * 0.55; rx += tilt * 0.25; pos.y -= tilt * 0.03; pos.x -= tilt * 0.02;
      const out = smoothstep(0.12, 0.3, r) * (1 - smoothstep(0.42, 0.6, r));
      magPos.y -= out * 0.3;
      if (s.reloadEmpty && r > 0.75) {
        const rack = Math.sin(clamp((r - 0.75) / 0.15, 0, 1) * Math.PI);
        rz -= rack * 0.2; pos.z += rack * 0.02;
      }
    }
    m.mag.position.copy(magPos);
    if (m.pump) {
      // Pump: back and forward a beat after the shot, and once more after an empty reload.
      let back = 0;
      if (this.pumpT >= 0) {
        this.pumpT += dt;
        const t = (this.pumpT - 0.1) / 0.36;
        if (t > 0) back = Math.sin(Math.min(1, t) * Math.PI);
        if (t >= 1) this.pumpT = -1;
        rx -= back * 0.06;
      }
      if (s.reload >= 0 && s.reloadEmpty && s.reload > 0.75) back = Math.max(back, Math.sin(clamp((s.reload - 0.75) / 0.15, 0, 1) * Math.PI));
      m.pump.position.z = back * 0.09;
    }

    // Lowered: plating up or browsing the shop.
    pos.y -= s.lower * 0.22; rx -= s.lower * 0.5;

    // Fists: guard sways with the walk, pumps when sprinting, punches snap out and come back.
    if (m === this.fists.model) {
      if (this.punchT >= 0) { this.punchT += dt / 0.36; if (this.punchT >= 1) this.punchT = -1; }
      for (let i = 0; i < 2; i++) {
        const a = this.fists.arms[i], side = i === 0 ? -1 : 1;
        const t = this.punchT >= 0 && this.punchSide === i ? this.punchT : -1;
        const e = t < 0 ? 0 : t < 0.3 ? smoothstep(0, 0.3, t) : 1 - smoothstep(0.3, 1, t);
        const pump = Math.sin(this.bobT + i * Math.PI) * s.sprint;
        a.position.set((side < 0 ? -0.391 : 0.061) - side * e * 0.08, -0.083 + e * 0.06 + pump * 0.03, 0.2 - e * 0.26 + pump * 0.04);
        a.rotation.set(0.35 - e * 0.3 + s.sprint * 0.3 + pump * 0.2, side * (0.18 + e * 0.08), side * (-0.15 - e * 0.1));
      }
    }

    // Draw: come up from below.
    const drawOff = 1 - smoothstep(0, 1, s.draw);
    pos.y -= drawOff * 0.25; rx -= drawOff * 0.8;

    // Inspect: turn the gun to show its side, then the top.
    if (s.inspect >= 0) {
      const t = s.inspect, a = smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t));
      const turn = t < 0.55 ? 1 : 1 - smoothstep(0.55, 0.7, t);
      ry += a * turn * 0.9; rz += a * (0.5 * turn - 0.4 * (1 - turn)); rx += a * (1 - turn) * 0.4;
      pos.x -= a * 0.1; pos.z += a * 0.08; pos.y += a * 0.03;
    }

    pos.x += this.swayX + bobX;
    pos.y += this.swayY + bobY + this.landDip;
    pos.z += this.kickZ;
    rx += this.kickP + this.swayY * 2;
    ry += this.kickYaw + this.swayX * 2;

    this.pivot.position.copy(pos);
    this.pivot.rotation.set(rx, ry, rz, 'YXZ');
    this.pivot.visible = !s.hidden;

    // Plate: the left hand brings it up from below and pushes it into the vest.
    this.plateMesh.visible = s.plate >= 0 && !s.hidden;
    if (s.plate >= 0) {
      const t = s.plate, up = smoothstep(0, 0.45, t), push = smoothstep(0.55, 0.9, t);
      this.plateMesh.position.set(-0.05 - up * 0.04, -0.45 + up * 0.27 - push * 0.3, -0.42 + push * 0.14);
      this.plateMesh.rotation.set(-0.3 + up * 0.25 + push * 0.6, 0.1, 0.15 - up * 0.1);
    }

    // Parachute: opens with a quick bloom, sways a little.
    this.chuteK = damp(this.chuteK, s.chute ? 1 : 0, s.chute ? 5 : 12, dt);
    this.canopy.visible = this.chuteK > 0.02;
    this.canopy.scale.set(0.3 + this.chuteK * 0.7, 0.3 + this.chuteK * 0.7, 0.3 + this.chuteK * 0.7);
    this.canopy.rotation.set(-s.pitch, 0, Math.sin(performance.now() / 900) * 0.04, 'XYZ');

    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }
}
