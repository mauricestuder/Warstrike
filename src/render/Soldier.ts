import {
  BoxGeometry, CapsuleGeometry, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  SphereGeometry, Vector3,
} from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { WeaponId } from '../weapons/defs';

/** Leg and arm segment lengths (m). Hip height standing is THIGH + SHIN + FOOT. */
const THIGH = 0.42, SHIN = 0.41, FOOT = 0.08, UPPER = 0.3, FORE = 0.27, HAND = 0.07;
const HIP_W = 0.11, SHOULDER_W = 0.2, SHOULDER_Y = 0.42, NECK_Y = 0.52;

/**
 * Where the hands go on each gun, in the gun's own model space (barrel down -z, as built for the view model):
 * the pistol grip and the support hand's spot on the handguard or pump.
 */
const HOLDS: Record<Exclude<WeaponId, 'hands'>, { grip: Vector3; fore: Vector3 }> = {
  ar: { grip: new Vector3(0, -0.03, 0.03), fore: new Vector3(0, 0.0, -0.34) },
  smg: { grip: new Vector3(0, -0.03, 0.04), fore: new Vector3(0, -0.04, -0.22) },
  sniper: { grip: new Vector3(0, -0.04, 0.06), fore: new Vector3(0, -0.02, -0.4) },
  shotgun: { grip: new Vector3(0, -0.03, 0.04), fore: new Vector3(0, -0.01, -0.36) },
};

/** What drives the pose each frame. Velocities are in world space; the rig turns them into its own frame. */
export interface SoldierState {
  /** World velocity (m/s). */
  vx: number; vz: number;
  /** Facing; 0 looks toward +z (bots) — the player passes its yaw + π. */
  yaw: number;
  /** Look pitch (rad, up positive). */
  pitch: number;
  grounded: boolean;
  sprint: boolean;
  crouch: boolean;
  slide: boolean;
  /** 0..1 aiming down sights (gun raised to the eye). */
  ads?: number;
  /** Skydiving: freefall (spread-eagle) or hanging under the canopy. */
  sky?: 'none' | 'freefall' | 'chute';
  /** 0..1 reload progress, or -1. */
  reload?: number;
  /** Seconds of recoil kick to show (set to a small value when a shot goes off). */
  kick?: number;
}

type MatFactory = (color: number, rough?: number, metal?: number) => MeshStandardMaterial;

/**
 * An articulated soldier (pelvis, spine, head, two-bone arms and legs) with a procedural animation blend:
 * idle sway, walk and run cycles that follow the direction you're actually moving (strafing swings the legs sideways,
 * backpedalling reverses the stride), crouch, slide, jump tuck, skydive and parachute poses. Every pose weight is
 * smoothed, so going from walk to sprint or standing to crouch eases over a few tenths of a second instead of
 * snapping. Hands are placed on the gun with two-bone IK, so they stay on the grip and handguard while it aims.
 */
export class Soldier {
  readonly root = new Group();
  /** Everything that tips over when the soldier dies. */
  readonly body = new Group();
  readonly pelvis = new Group();
  readonly spine = new Group();
  readonly head = new Group();
  /** Gun held here: origin is the right hand on the grip; the gun points down +z. */
  readonly gunMount = new Group();
  readonly canopy: Group;
  private legs: { hip: Group; knee: Group; foot: Mesh }[] = [];
  private arms: { shoulder: Group; elbow: Group; side: number }[] = [];
  private gunObj: Object3D | null = null;
  private gunId: WeaponId = 'hands';
  private fore = new Vector3();
  /** Parts that hide in first person (head, arms, gun: the view model draws its own). */
  private fpHidden: Object3D[] = [];
  private meshes: Mesh[] = [];
  // Smoothed pose weights.
  private phase = Math.random() * 6;
  private moveK = 0;
  private runK = 0;
  private crouchK = 0;
  private slideK = 0;
  private airK = 0;
  private armedK = 0;
  private adsK = 0;
  private freeK = 0;
  private chuteK = 0;
  private fwdN = 1;
  private sideN = 0;
  private kickK = 0;
  private time = Math.random() * 10;
  private twist = 0;
  private pitch = 0;

  constructor(mat: MatFactory, colors = { fabric: 0x55603f, vest: 0x2f3328, helmet: 0x3c4232 }) {
    const fabric = mat(colors.fabric), vest = mat(colors.vest, 0.7), skin = mat(0xc49a7c, 0.6), helmet = mat(colors.helmet, 0.5, 0.2);
    const boots = mat(0x1d1b19, 0.6), gloves = mat(0x2b2a27, 0.8), pouch = mat(0x3a3f2e, 0.85);
    const add = (parent: Object3D, geo: ConstructorParameters<typeof Mesh>[0], m: MeshStandardMaterial, x: number, y: number, z: number) => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    this.root.add(this.body);
    this.body.add(this.pelvis);
    // Hips and belt.
    add(this.pelvis, new BoxGeometry(0.34, 0.2, 0.22), fabric, 0, 0.0, 0);
    add(this.pelvis, new BoxGeometry(0.36, 0.05, 0.24), pouch, 0, 0.08, 0);
    // Legs: hip pivot → thigh → knee pivot → shin → boot.
    for (const s of [-1, 1]) {
      const hip = new Group();
      hip.position.set(s * HIP_W, -0.04, 0);
      this.pelvis.add(hip);
      add(hip, new CapsuleGeometry(0.085, THIGH - 0.1, 4, 8), fabric, 0, -THIGH / 2, 0);
      const knee = new Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      add(knee, new CapsuleGeometry(0.07, SHIN - 0.08, 4, 8), fabric, 0, -SHIN / 2, 0);
      add(knee, new BoxGeometry(0.1, 0.07, 0.08), pouch, 0, -0.02, 0.06); // knee pad
      const foot = add(knee, new BoxGeometry(0.12, FOOT, 0.26), boots, 0, -SHIN - FOOT / 2 + 0.02, 0.05);
      this.legs.push({ hip, knee, foot });
    }
    // Torso: shirt, plate carrier, pouches, backpack-style hydration pack.
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.08;
    // (Hidden in first person too: looking down you see your belt, legs and boots instead of the top of your vest.)
    this.fpHidden.push(
      add(this.spine, new CapsuleGeometry(0.17, 0.26, 4, 12), fabric, 0, 0.26, 0),
      add(this.spine, new BoxGeometry(0.42, 0.38, 0.28), vest, 0, 0.27, 0),
      add(this.spine, new BoxGeometry(0.3, 0.12, 0.06), pouch, 0, 0.16, 0.16),
      add(this.spine, new BoxGeometry(0.28, 0.3, 0.1), pouch, 0, 0.27, -0.18),
    );
    this.fpHidden[0].scale.set(1.12, 1, 0.72);
    // Head and helmet on a neck pivot.
    this.head.position.y = NECK_Y;
    this.spine.add(this.head);
    add(this.head, new CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 0.0, 0);
    add(this.head, new SphereGeometry(0.115, 14, 10), skin, 0, 0.12, 0.01);
    add(this.head, new SphereGeometry(0.132, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet, 0, 0.14, 0);
    add(this.head, new BoxGeometry(0.16, 0.035, 0.03), mat(0x111111, 0.3, 0.5), 0, 0.13, 0.11); // goggles strap
    this.fpHidden.push(this.head);
    // Arms: shoulder pivot → upper arm → elbow pivot → forearm → glove.
    for (const s of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(s * SHOULDER_W, SHOULDER_Y, 0);
      this.spine.add(shoulder);
      add(shoulder, new CapsuleGeometry(0.065, UPPER - 0.08, 4, 8), fabric, 0, -UPPER / 2, 0);
      const elbow = new Group();
      elbow.position.y = -UPPER;
      shoulder.add(elbow);
      add(elbow, new CapsuleGeometry(0.055, FORE - 0.07, 4, 8), fabric, 0, -FORE / 2, 0);
      add(elbow, new BoxGeometry(0.07, HAND + 0.02, 0.08), gloves, 0, -FORE - HAND / 2, 0);
      this.arms.push({ shoulder, elbow, side: s });
      this.fpHidden.push(shoulder);
    }
    this.spine.add(this.gunMount);
    this.fpHidden.push(this.gunMount);

    // Parachute: a domed canopy on four lines (hidden until it opens).
    this.canopy = new Group();
    const cloth = mat(0x5d6b4a, 0.9);
    cloth.side = DoubleSide;
    const dome = new Mesh(new SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), cloth);
    dome.scale.set(1, 0.55, 0.75);
    dome.position.y = 2.4;
    this.canopy.add(dome);
    const line = mat(0x222222);
    for (const [x, z] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6]]) {
      const l = new Mesh(new CylinderGeometry(0.008, 0.008, 2.6, 3), line);
      l.position.set(x * 0.6, 3.0, z * 0.45);
      l.rotation.set(-z * 0.3, 0, x * 0.42);
      this.canopy.add(l);
    }
    this.canopy.position.y = 1.4;
    this.canopy.visible = false;
    this.root.add(this.canopy);
    this.pelvis.position.y = THIGH + SHIN + FOOT;
  }

  /** First person: hide the head, arms and gun (the camera sits in the head; the view model has its own arms). */
  set firstPerson(on: boolean) { this.fp = on; for (const o of this.fpHidden) o.visible = !on; }
  private fp = false;

  set castShadow(on: boolean) { for (const m of this.meshes) m.castShadow = on; }

  /**
   * Puts a gun in the hands. `model` is built barrel-down -z (like the view model); `zShift` is how far it was moved
   * along z when it was wrapped (loot models are centred on their length).
   */
  setGun(model: Object3D | null, id: WeaponId, zShift = 0) {
    if (this.gunObj) this.gunMount.remove(this.gunObj);
    this.gunObj = model;
    this.gunId = model ? id : 'hands';
    if (!model || id === 'hands') return;
    const hold = HOLDS[id];
    // Turn it to point down +z (a half turn maps (x, y, z) to (-x, y, -z)) with the grip on the mount's origin.
    const wrap = new Group();
    wrap.rotation.y = Math.PI;
    wrap.add(model);
    const g = hold.grip, f = hold.fore;
    wrap.position.set(g.x, -g.y, g.z + zShift);
    this.fore.set(g.x - f.x, f.y - g.y, g.z - f.z);
    model.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).castShadow = true; });
    this.gunObj = wrap;
    this.gunMount.add(wrap);
  }

  /** World position of the gun's muzzle (for tracers and flashes), roughly. */
  muzzle(out: Vector3) {
    const len = this.gunId === 'sniper' ? 1.1 : this.gunId === 'smg' ? 0.45 : this.gunId === 'shotgun' ? 0.74 : 0.78;
    out.set(0, 0.07, len);
    this.gunMount.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.gunMount.matrixWorld);
  }

  /** World position of the head (eye level), after animation. */
  headPos(out: Vector3) {
    this.head.updateWorldMatrix(true, false);
    return out.set(0, 0.13, 0.08).applyMatrix4(this.head.matrixWorld);
  }

  update(dt: number, s: SoldierState) {
    this.time += dt;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    // Velocity in the soldier's frame: +z forward, +x to its left (three.js +x when facing +z).
    const fwd = s.vx * sn + s.vz * c, side = s.vx * c - s.vz * sn;
    const speed = s.grounded ? Math.hypot(s.vx, s.vz) : 0;
    const sky = s.sky ?? 'none';
    const armed = this.gunId !== 'hands' && sky === 'none';

    // Smooth every weight: this is what removes the "snap" between states.
    this.moveK = damp(this.moveK, clamp(speed / 3, 0, 1), 8, dt);
    this.runK = damp(this.runK, s.sprint || (!s.crouch && speed > 6.5) ? clamp((speed - 3) / 4, 0, 1) : 0, 6, dt);
    this.crouchK = damp(this.crouchK, s.crouch && !s.slide ? 1 : 0, 9, dt);
    this.slideK = damp(this.slideK, s.slide ? 1 : 0, 10, dt);
    this.airK = damp(this.airK, !s.grounded && sky === 'none' ? 1 : 0, 9, dt);
    this.armedK = damp(this.armedK, armed ? 1 : 0, 8, dt);
    this.adsK = damp(this.adsK, s.ads ?? 0, 14, dt);
    this.freeK = damp(this.freeK, sky === 'freefall' ? 1 : 0, 4, dt);
    this.chuteK = damp(this.chuteK, sky === 'chute' ? 1 : 0, 4, dt);
    this.kickK = Math.max(0, damp(this.kickK, 0, 14, dt), s.kick ?? 0);
    this.pitch = damp(this.pitch, s.pitch, 20, dt);
    if (speed > 0.4) {
      this.fwdN = damp(this.fwdN, fwd / speed, 8, dt);
      this.sideN = damp(this.sideN, side / speed, 8, dt);
    }
    // Stride length grows with speed, so cadence doesn't go silly when sprinting.
    const stride = lerp(1.25, 2.1, this.runK) * (s.crouch ? 0.75 : 1);
    this.phase += (speed / stride) * Math.PI * dt;

    const mv = this.moveK * (1 - this.slideK), run = this.runK;
    const thighAmp = (0.42 + 0.16 * run) * mv * (1 - this.crouchK * 0.35);
    const lean = 0.05 * mv + 0.22 * run - 0.05 * this.adsK;
    const back = this.fwdN < -0.2;

    // --- Legs ---
    let pelvisY = 0;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const ph = this.phase + i * Math.PI;
      const sw = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
      // Forward-positive thigh angle and knee bend; the swing leg (moving forward) bends its knee to clear the ground.
      // Facing +z, leg 0 is the right leg (at -x); +z rotation swings a foot toward +x.
      const out = i ? 1 : -1;
      let thigh = sw * thighAmp * (this.fwdN + Math.abs(this.sideN) * 0.25);
      let thighSide = sw * thighAmp * this.sideN * 0.5;
      // Strafing: step out and bring the feet together, but never cross them.
      thighSide = out > 0 ? Math.max(thighSide, -0.02) : Math.min(thighSide, 0.02);
      thighSide += out * 0.05;
      let knee = (lift * (back ? 0.5 : 0.75 + 0.6 * run) + 0.12 * run) * mv + 0.05;
      // Crouch: thighs forward, knees bent.
      thigh += this.crouchK * (i ? 0.75 : 1.15);
      knee += this.crouchK * (i ? 1.95 : 1.55);
      // Slide: lead leg out straight, the other folded under.
      thigh = lerp(thigh, i ? 1.35 : 0.55, this.slideK);
      knee = lerp(knee, i ? 0.15 : 1.9, this.slideK);
      thighSide = lerp(thighSide, i ? -0.1 : 0.15, this.slideK);
      // In the air: knees tuck a little.
      thigh = lerp(thigh, i ? 0.55 : 0.2, this.airK * 0.8);
      knee = lerp(knee, i ? 0.9 : 0.55, this.airK * 0.8);
      // Freefall: legs out behind, slightly bent. Under the canopy: legs hang.
      thigh = lerp(thigh, -0.25, this.freeK);
      knee = lerp(knee, 0.7, this.freeK);
      thigh = lerp(thigh, i ? 0.25 : 0.05, this.chuteK);
      knee = lerp(knee, i ? 0.35 : 0.15, this.chuteK);
      thighSide = lerp(thighSide, (i ? 1 : -1) * 0.25, this.freeK);
      L.hip.rotation.set(-thigh, 0, thighSide);
      L.knee.rotation.x = knee;
      // Keep the boot flat-ish on the ground.
      L.foot.rotation.x = (thigh - knee) * 0.7;
      // How tall this leg stands: the planted leg sets the hip height.
      const h = (THIGH * Math.cos(thigh) + SHIN * Math.cos(thigh - knee)) * Math.cos(thighSide) + FOOT;
      pelvisY = Math.max(pelvisY, h);
    }
    // The slide's planted leg is the bent one; in the air the hips stay where they are.
    const standH = THIGH + SHIN + FOOT;
    pelvisY = lerp(pelvisY, standH - 0.06, Math.max(this.airK, this.freeK, this.chuteK));
    pelvisY = lerp(pelvisY, 0.42, this.slideK);
    this.pelvis.position.y = pelvisY - 0.01;
    // Hips sway side to side over the planted foot.
    this.pelvis.position.x = Math.sin(this.phase) * 0.025 * mv;
    this.pelvis.rotation.set(0, Math.sin(this.phase) * 0.1 * mv * (1 - run * 0.5), 0);

    // --- Body ---
    // Freefall: whole body tips forward to horizontal; aiming twists the shoulders like a real stance.
    this.body.rotation.x = this.freeK * 1.35;
    this.body.position.y = this.freeK * 0.5;
    // Negative twist brings the left shoulder forward, like a right-handed shooter's stance.
    this.twist = damp(this.twist, armed && !s.sprint ? -0.42 : 0, 8, dt);
    const breathe = Math.sin(this.time * 1.7) * 0.012 * (1 - mv);
    const spineX = lean + this.crouchK * 0.25 - this.slideK * 0.55 + breathe - this.pitch * 0.25 * this.armedK - this.kickK * 0.08;
    this.spine.rotation.set(spineX, this.twist - this.pelvis.rotation.y, Math.sin(this.phase) * 0.04 * mv);
    // Head looks along the aim: undo the spine's lean and twist.
    this.head.rotation.set(-this.pitch * 0.6 - spineX * 0.7 + this.freeK * -0.9, -this.twist, 0);

    // --- Gun ---
    // Low ready when sprinting, shouldered when walking, raised to the eye when aiming.
    const sprintGun = this.runK * this.armedK * (1 - this.adsK);
    const g = this.gunMount;
    g.position.set(
      -lerp(0.1, 0.04, this.adsK) + sprintGun * 0.04,
      lerp(0.26, 0.47, this.adsK) - sprintGun * 0.1,
      lerp(0.24, 0.26, this.adsK) - sprintGun * 0.04 - this.kickK * 0.05,
    );
    let gx = -this.pitch - spineX + this.kickK * -0.15, gy = -this.twist;
    gx = lerp(gx, 0.75, sprintGun);
    gy = lerp(gy, 0.6, sprintGun);
    // Reload: tip the gun in and down for a moment.
    const rl = s.reload ?? -1;
    if (rl >= 0) { const k = Math.sin(clamp(rl, 0, 1) * Math.PI); gx += k * 0.45; g.position.y -= k * 0.06; }
    g.rotation.set(gx, gy, sprintGun * 0.5, 'YXZ');
    g.visible = !this.fp && this.armedK > 0.02 && this.gunObj !== null;

    // --- Arms ---
    g.updateMatrix();
    for (const a of this.arms) {
      const sd = a.side;
      // Unarmed: swing opposite to the legs, elbows bend more when running.
      const sw = -Math.sin(this.phase + (sd > 0 ? Math.PI : 0)) * (0.35 + 0.55 * run) * mv * this.fwdN;
      let ax = sw + 0.05, az = sd * (0.12 + 0.05 * run), el = 0.25 + 1.2 * run * mv + 0.1 * mv;
      // Freefall: arms out wide. Chute: hands up on the risers.
      ax = lerp(ax, -0.3, this.freeK); az = lerp(az, sd * 1.25, this.freeK); el = lerp(el, 0.6, this.freeK);
      ax = lerp(ax, 2.6, this.chuteK); az = lerp(az, sd * 0.35, this.chuteK); el = lerp(el, 0.5, this.chuteK);
      a.shoulder.rotation.set(-ax, 0, az, 'XYZ');
      a.elbow.rotation.set(-el, 0, 0);
      if (this.armedK > 0.01 && this.gunObj) {
        // Two-bone IK onto the grip (right) or the handguard (left), blended in as the gun comes up.
        // Facing +z, the soldier's right is -x: the right hand (sd < 0) takes the grip.
        const target = sd < 0 ? this.ikT.set(0, 0, 0) : this.ikT.copy(this.fore);
        target.applyMatrix4(g.matrix);
        this.ik(a, target, this.armedK);
      }
    }
  }

  private ikT = new Vector3();
  private ikM = new Matrix4();

  /** Solves shoulder and elbow so the hand lands on `t` (spine space), blending with the free pose by `w`. */
  private ik(a: { shoulder: Group; elbow: Group; side: number }, t: Vector3, w: number) {
    const S = a.shoulder.position;
    const d = new Vector3().subVectors(t, S);
    const reach = UPPER + FORE + HAND * 0.5;
    let len = d.length();
    len = clamp(len, 0.08, reach - 1e-3);
    const dir = d.normalize();
    const lo = UPPER, hi = FORE + HAND * 0.5;
    const cosA = clamp((lo * lo + len * len - hi * hi) / (2 * lo * len), -1, 1);
    const alpha = Math.acos(cosA);
    // Elbows drop down and out.
    const pole = new Vector3(a.side * 0.6, -1, -0.2);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbowDir = dir.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha));
    const E = elbowDir.clone().multiplyScalar(lo).add(S);
    const toHand = new Vector3().subVectors(S.clone().addScaledVector(dir, len), E);
    // Upper arm basis: local -y along the bone, local x the hinge axis.
    const y = elbowDir.clone().negate();
    const x = new Vector3().crossVectors(elbowDir, toHand).normalize();
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    const z = new Vector3().crossVectors(x, y).normalize();
    x.crossVectors(y, z);
    this.ikM.makeBasis(x, y, z);
    const q = a.shoulder.quaternion.clone();
    a.shoulder.quaternion.setFromRotationMatrix(this.ikM);
    if (w < 1) a.shoulder.quaternion.copy(q.slerp(a.shoulder.quaternion, w));
    // Forearm in the upper arm's frame: lies in its y-z plane.
    const ly = toHand.dot(y), lz = toHand.dot(z);
    const bend = Math.atan2(-lz, -ly);
    a.elbow.rotation.x = lerp(a.elbow.rotation.x, bend, w);
  }
}
