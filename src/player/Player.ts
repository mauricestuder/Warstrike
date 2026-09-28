import { Vector3 } from 'three';
import type { Input } from '../core/Input';
import { clamp, damp } from '../core/math';
import type { Colliders } from '../world/Colliders';

// All speeds in m/s, accelerations in m/s².
const WALK = 4.8, SPRINT = 6.9, TAC_SPRINT = 8.4, CROUCH = 2.7;
const GROUND_ACCEL = 55, AIR_ACCEL = 9, FRICTION = 9;
const GRAVITY = 17, JUMP_VEL = 5.5;
const SLIDE_MIN_ENTRY = 5.4, SLIDE_BOOST = 2.3, SLIDE_MAX = 10.8, SLIDE_DECEL = 5.2, SLIDE_END = 3.6, SLIDE_TIME = 1.15;
const SLIDE_COOLDOWN = 0.55;
const TAC_TIME = 3.2, TAC_RECHARGE = 5;
const RADIUS = 0.3, STAND_H = 1.8, CROUCH_H = 1.15, SLIDE_H = 0.95;
const STEP = 0.45, MANTLE_MAX = 2.05, MANTLE_MIN = 0.4;
const EYE_STAND = 1.64, EYE_CROUCH = 1.08, EYE_SLIDE = 0.82;
const SUBSTEP = 1 / 120;

export type Stance = 'stand' | 'crouch' | 'slide';

export interface PlayerEvents {
  step(sprinting: boolean): void;
  jump(): void;
  land(impact: number): void;
  slide(): void;
  mantle(height: number): void;
}

/**
 * First-person movement with a custom AABB collider (no physics engine):
 * walk / sprint / tactical sprint (double-tap Shift), crouch, slide (crouch while sprinting), slide-jump that keeps
 * momentum, automatic step-up for stairs, and mantling onto ledges up to ~2 m by jumping into them.
 */
export class Player {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  stance: Stance = 'stand';
  sprinting = false;
  tacSprinting = false;
  /** Set by the weapon each frame: aiming or firing blocks sprint. */
  sprintBlocked = false;
  /** Set by the weapon: speed multiplier for the gun in hand and ADS. */
  speedMul = 1;
  /** Smoothed eye height for the camera. */
  eye = EYE_STAND;
  /** 0..1 how far into a slide we are (camera tilt). */
  slideT = 0;
  /** Distance of the last completed slide (for the slide strip readout). */
  lastSlide = 0;
  mantling = false;
  private mantleFrom = new Vector3();
  private mantleTo = new Vector3();
  private mantleT = 0;
  private mantleDur = 0;
  private slideTime = 0;
  private slideCooldown = 0;
  private slideStart = new Vector3();
  private tacLeft = TAC_TIME;
  private lastShiftTap = -1;
  private time = 0;
  private stepDist = 0;
  private crouchToggle = false;
  private airTime = 0;

  constructor(private world: Colliders, private events: PlayerEvents) {}

  spawn(p: Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.stance = 'stand';
    this.mantling = false;
  }

  get height() { return this.stance === 'stand' ? STAND_H : this.stance === 'crouch' ? CROUCH_H : SLIDE_H; }
  get horizSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
  get moving() { return this.horizSpeed > 0.5; }
  get tacFraction() { return this.tacLeft / TAC_TIME; }

  update(dt: number, input: Input) {
    this.time += dt;
    const fwdIn = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const sideIn = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);

    // Crouch: C toggles, Ctrl holds. Either one while sprinting starts a slide.
    const crouchPressed = input.wasPressed('KeyC') || input.wasPressed('ControlLeft');
    if (input.wasPressed('KeyC')) this.crouchToggle = !this.crouchToggle;
    const wantCrouch = this.crouchToggle || input.isDown('ControlLeft');

    // Sprint (hold Shift, forward only). Double-tap Shift for tactical sprint.
    if (input.wasPressed('ShiftLeft')) {
      if (this.time - this.lastShiftTap < 0.3 && this.tacLeft > 0.5) this.tacSprinting = true;
      this.lastShiftTap = this.time;
    }
    const canSprint = fwdIn > 0 && !this.sprintBlocked && this.stance !== 'slide' && !this.mantling;
    const wasSprinting = this.sprinting;
    this.sprinting = canSprint && input.isDown('ShiftLeft') && (this.onGround || this.sprinting);
    if (this.sprinting && this.crouchToggle && !crouchPressed) this.crouchToggle = false;
    if (!this.sprinting) this.tacSprinting = false;
    if (this.tacSprinting) {
      this.tacLeft -= dt;
      if (this.tacLeft <= 0) this.tacSprinting = false;
    } else this.tacLeft = Math.min(TAC_TIME, this.tacLeft + (dt * TAC_TIME) / TAC_RECHARGE);

    this.slideCooldown -= dt;
    if (crouchPressed && this.onGround && (wasSprinting || this.sprinting) && this.horizSpeed > SLIDE_MIN_ENTRY
      && this.slideCooldown <= 0 && this.stance !== 'slide') this.startSlide();
    else if (this.stance !== 'slide') {
      if (wantCrouch && !this.sprinting) this.stance = 'crouch';
      else if (this.stance === 'crouch' && this.fits(STAND_H)) this.stance = 'stand';
    }

    const jump = input.wasPressed('Space');
    if (this.mantling) this.updateMantle(dt);
    else {
      if (jump || (input.isDown('Space') && !this.onGround && fwdIn > 0)) this.tryMantle(fwdIn);
      if (!this.mantling) {
        if (jump && this.onGround) this.doJump();
        this.moveWish(dt, fwdIn, sideIn);
        let t = dt;
        while (t > 1e-6) {
          const h = Math.min(SUBSTEP, t);
          this.physics(h);
          t -= h;
        }
      }
    }

    const eyeTarget = this.stance === 'stand' ? EYE_STAND : this.stance === 'crouch' ? EYE_CROUCH : EYE_SLIDE;
    this.eye = damp(this.eye, eyeTarget, 14, dt);
    this.slideT = damp(this.slideT, this.stance === 'slide' ? 1 : 0, 10, dt);
    this.footsteps(dt);
  }

  private startSlide() {
    this.stance = 'slide';
    this.sprinting = this.tacSprinting = false;
    this.crouchToggle = false;
    const s = this.horizSpeed, k = Math.min(SLIDE_MAX, Math.max(s + SLIDE_BOOST, 8.8)) / Math.max(s, 1e-3);
    this.vel.x *= k;
    this.vel.z *= k;
    this.slideTime = 0;
    this.slideStart.copy(this.pos);
    this.events.slide();
  }

  private endSlide() {
    this.lastSlide = Math.hypot(this.pos.x - this.slideStart.x, this.pos.z - this.slideStart.z);
    this.stance = this.fits(STAND_H) ? 'stand' : 'crouch';
    this.slideCooldown = SLIDE_COOLDOWN;
  }

  private doJump() {
    if (this.stance === 'crouch') {
      if (this.fits(STAND_H)) this.stance = 'stand';
      this.crouchToggle = false;
      return; // jump from crouch just stands up, like most shooters
    }
    if (this.stance === 'slide') this.endSlide(); // slide-jump: keep all horizontal momentum
    this.vel.y = JUMP_VEL;
    this.onGround = false;
    this.events.jump();
  }

  /** Accelerate toward the wanted velocity. Slides ignore input and just bleed speed. */
  private moveWish(dt: number, fwdIn: number, sideIn: number) {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is -z at yaw 0.
    let wx = -sin * fwdIn + cos * sideIn, wz = -cos * fwdIn - sin * sideIn;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.stance === 'slide') {
      this.slideTime += dt;
      const s = this.horizSpeed, ns = Math.max(0, s - SLIDE_DECEL * dt * (0.6 + this.slideTime));
      if (s > 1e-3) { this.vel.x *= ns / s; this.vel.z *= ns / s; }
      // A little steering while sliding.
      if (wl > 0) { this.vel.x += wx * 3 * dt; this.vel.z += wz * 3 * dt; }
      if ((ns < SLIDE_END || this.slideTime > SLIDE_TIME) && this.onGround) this.endSlide();
      return;
    }

    let speed = this.stance === 'crouch' ? CROUCH : this.tacSprinting ? TAC_SPRINT : this.sprinting ? SPRINT : WALK;
    if (!this.sprinting) speed *= this.speedMul;
    if (fwdIn < 0) speed *= 0.85; // backpedal slower
    const tx = wx * speed, tz = wz * speed;
    if (this.onGround) {
      const dx = tx - this.vel.x, dz = tz - this.vel.z, dl = Math.hypot(dx, dz);
      // Decelerate with friction when there's no input, accelerate otherwise.
      const a = (wl > 0 ? GROUND_ACCEL : FRICTION * Math.max(this.horizSpeed, 2)) * dt;
      if (dl <= a) { this.vel.x = tx; this.vel.z = tz; } else { this.vel.x += (dx / dl) * a; this.vel.z += (dz / dl) * a; }
    } else if (wl > 0) {
      // Air strafe: can steer, can't gain speed past the ground speed limit (or your jump speed if faster).
      const cap = Math.max(speed, this.horizSpeed);
      this.vel.x += wx * AIR_ACCEL * dt;
      this.vel.z += wz * AIR_ACCEL * dt;
      const s = this.horizSpeed;
      if (s > cap) { this.vel.x *= cap / s; this.vel.z *= cap / s; }
    }
  }

  private physics(dt: number) {
    const wasGround = this.onGround;
    this.vel.y -= GRAVITY * dt;
    this.moveAxis(0, this.vel.x * dt);
    this.moveAxis(2, this.vel.z * dt);
    const vy = this.vel.y;
    this.onGround = false;
    this.moveAxis(1, vy * dt);
    // Stick to the ground when walking down steps.
    if (!this.onGround && wasGround && vy <= 0) {
      const g = this.world.groundBelow(this.pos.x, this.pos.z, RADIUS - 0.02, this.pos.y);
      if (this.pos.y - g < STEP + 0.02) { this.pos.y = g; this.vel.y = 0; this.onGround = true; }
    }
    if (!this.onGround) {
      if (wasGround) this.airTime = 0;
      this.airTime += dt;
    } else if (!wasGround) this.events.land(Math.max(0, -vy));
    if (this.pos.y < -20) this.pos.set(0, 1, 4); // fell out of the world
  }

  private readonly bmin = new Vector3();
  private readonly bmax = new Vector3();

  private bounds(p: Vector3, h: number) {
    this.bmin.set(p.x - RADIUS, p.y, p.z - RADIUS);
    this.bmax.set(p.x + RADIUS, p.y + h, p.z + RADIUS);
  }

  /** Moves along one axis and resolves any overlap back against the movement direction. */
  private moveAxis(axis: 0 | 1 | 2, d: number) {
    if (d === 0) return;
    const p = this.pos;
    p.setComponent(axis, p.getComponent(axis) + d);
    const h = this.height;
    for (let iter = 0; iter < 4; iter++) {
      this.bounds(p, h);
      const b = this.world.overlaps(this.bmin, this.bmax);
      if (!b) return;
      if (axis !== 1) {
        // Step up onto low obstacles (stairs, kerbs) when on the ground.
        const rise = b.max.y - p.y;
        if (this.onGroundish() && rise > 0 && rise <= STEP) {
          this.bmin.y = b.max.y + 0.001; this.bmax.y = b.max.y + h + 0.001;
          if (!this.world.overlaps(this.bmin, this.bmax)) { p.y = b.max.y + 0.001; continue; }
        }
        p.setComponent(axis, d > 0 ? b.min.getComponent(axis) - RADIUS - 1e-4 : b.max.getComponent(axis) + RADIUS + 1e-4);
        // Kill velocity into the wall.
        this.vel.setComponent(axis, 0);
      } else {
        if (d < 0) { p.y = b.max.y; this.onGround = true; } else p.y = b.min.y - h - 1e-4;
        this.vel.y = 0;
      }
    }
  }

  private onGroundish() {
    return this.onGround || this.airTime < 0.1;
  }

  private fits(h: number): boolean {
    this.bounds(this.pos, h);
    this.bmin.y += 0.01;
    return !this.world.overlaps(this.bmin, this.bmax);
  }

  private tryMantle(fwdIn: number) {
    if (fwdIn <= 0 || this.stance === 'slide') return;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const feet = this.pos.y;
    // Something must actually be in front of us at knee-to-chest height...
    this.bounds(new Vector3(this.pos.x + fx * 0.25, feet + MANTLE_MIN, this.pos.z + fz * 0.25), 0.5);
    if (!this.world.overlaps(this.bmin, this.bmax)) {
      this.bounds(new Vector3(this.pos.x + fx * 0.25, feet + 1.1, this.pos.z + fz * 0.25), 0.8);
      if (!this.world.overlaps(this.bmin, this.bmax)) return;
    }
    // ...with a top we can reach and room to stand on it.
    for (const reach of [0.55, 0.8]) {
      const px = this.pos.x + fx * reach, pz = this.pos.z + fz * reach;
      const top = this.world.groundBelow(px, pz, 0.12, feet + MANTLE_MAX);
      const rise = top - feet;
      if (rise < MANTLE_MIN || rise > MANTLE_MAX) continue;
      const to = new Vector3(px, top + 0.001, pz);
      this.bounds(to, STAND_H);
      if (this.world.overlaps(this.bmin, this.bmax)) {
        this.bounds(to, CROUCH_H);
        if (this.world.overlaps(this.bmin, this.bmax)) continue;
        this.stance = 'crouch';
      }
      // The path up must be clear too (no ceiling above us).
      this.bounds(new Vector3(this.pos.x, feet, this.pos.z), top - feet + CROUCH_H);
      this.bmin.y += 0.05;
      if (this.world.overlaps(this.bmin, this.bmax)) continue;
      this.mantling = true;
      this.mantleFrom.copy(this.pos);
      this.mantleTo.copy(to);
      this.mantleT = 0;
      this.mantleDur = 0.22 + rise * 0.17;
      this.vel.set(0, 0, 0);
      this.sprinting = this.tacSprinting = false;
      this.events.mantle(rise);
      return;
    }
  }

  private updateMantle(dt: number) {
    this.mantleT += dt / this.mantleDur;
    const t = clamp(this.mantleT, 0, 1);
    // Up first, then over the lip.
    const up = Math.min(1, t / 0.7), over = clamp((t - 0.45) / 0.55, 0, 1);
    this.pos.y = this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * (1 - (1 - up) * (1 - up));
    this.pos.x = this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * over;
    this.pos.z = this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * over;
    if (t >= 1) {
      this.mantling = false;
      this.onGround = true;
      this.pos.copy(this.mantleTo);
      // Keep a bit of forward momentum so vaulting feels fluid.
      this.vel.set(-Math.sin(this.yaw) * 3, 0, -Math.cos(this.yaw) * 3);
    }
  }

  private footsteps(dt: number) {
    if (!this.onGround || this.stance === 'slide' || this.mantling) { this.stepDist = 0; return; }
    const s = this.horizSpeed;
    this.stepDist += s * dt;
    const stride = this.sprinting ? 2.1 : this.stance === 'crouch' ? 1.2 : 1.7;
    if (this.stepDist > stride) {
      this.stepDist = 0;
      if (this.stance !== 'crouch') this.events.step(this.sprinting);
    }
  }

  /** Mouse look. Pitch is clamped a hair short of straight up/down. */
  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.53, 1.53);
  }
}
