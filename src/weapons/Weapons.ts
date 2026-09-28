import { Vector3, type PerspectiveCamera } from 'three';
import type { Sfx } from '../audio/Sfx';
import type { Input } from '../core/Input';
import { clamp, damp, DEG, lerp } from '../core/math';
import type { Player } from '../player/Player';
import type { Effects } from '../render/Effects';
import type { Hud } from '../ui/Hud';
import type { Ballistics } from './Ballistics';
import { GUNS, LOADOUT, type GunDef } from './defs';
import type { ViewModel } from './ViewModel';

interface GunState { def: GunDef; mag: number; reserve: number; }

/** Recovery starts this long after the last shot and closes the gap at RECOVER_RATE × remaining per second. */
const RECOVER_DELAY = 0.12, RECOVER_RATE = 7;
const BREATH_HOLD = 4, BREATH_WINDED = 2.5;

/**
 * The player's guns: firing with real spread (hip / ADS / movement / bloom), learnable recoil patterns that move
 * your actual aim, recoil recovery, per-gun ADS and sprint-to-fire times, reloads (tactical vs empty), weapon swap,
 * inspect, and scope sway with hold-breath on the sniper.
 */
export class Weapons {
  private guns: GunState[];
  private idx = 0;
  ads = 0;
  private cooldown = 0;
  private sprayIdx = 0;
  private lastShot = -10;
  private bloom = 0;
  private reloadT = -1;
  private reloadDur = 0;
  private reloadEmpty = false;
  private drawT = 1;
  private sprintOut = 0;
  private queued = false;
  private queuedAt = 0;
  private inspectT = -1;
  private time = 0;
  // Recoil recovery: how much the gun kicked since the spray started, and the pitch at that moment.
  private sprayRise = 0;
  private sprayStartPitch = 0;
  /** Visual camera punch from recoil (not aim), decays quickly. */
  punch = 0;
  // Scope sway.
  breathPitch = 0;
  breathYaw = 0;
  private breathT = 0;
  private holdLeft = BREATH_HOLD;
  private winded = 0;
  private holding = false;
  /** Range mode: reloads never use up reserve ammo. */
  infiniteReserve = false;
  /** Spread (half-angle, rad) used for the crosshair. */
  spread = 0;
  private readonly tmpDir = new Vector3();
  private readonly tmpMuzzle = new Vector3();

  constructor(private player: Player, private vm: ViewModel, private ballistics: Ballistics, private sfx: Sfx,
    private hud: Hud, private fx: Effects) {
    this.guns = LOADOUT.map((id) => ({ def: GUNS[id], mag: GUNS[id].mag, reserve: GUNS[id].reserve }));
    this.select(0, true);
  }

  get def() { return this.guns[this.idx].def; }
  get reloading() { return this.reloadT >= 0; }
  get scoped() { return this.def.scope && this.ads > 0.92; }

  private select(i: number, instant = false) {
    if (i === this.idx && !instant) return;
    this.idx = i;
    this.reloadT = -1;
    this.inspectT = -1;
    this.drawT = instant ? 1 : 0;
    this.sprayIdx = 0;
    this.bloom = 0;
    this.queued = false;
    this.vm.select(this.def.id);
    this.hud.setGun(this.def.name);
    if (!instant) this.sfx.swap();
    this.syncAmmo();
  }

  private syncAmmo() {
    const g = this.guns[this.idx];
    this.hud.setAmmo(g.mag, this.infiniteReserve ? Infinity : g.reserve, g.def.mag);
  }

  /** Refill everything (range convenience). */
  refill() {
    for (const g of this.guns) { g.mag = g.def.mag; g.reserve = g.def.reserve; }
    this.syncAmmo();
  }

  private startReload() {
    const g = this.guns[this.idx];
    if (this.reloading || g.mag >= g.def.mag || (g.reserve <= 0 && !this.infiniteReserve)) return;
    this.reloadEmpty = g.mag === 0;
    this.reloadDur = this.reloadEmpty ? g.def.reloadEmpty : g.def.reload;
    this.reloadT = 0;
    this.inspectT = -1;
    this.sfx.reload(this.reloadDur, this.reloadEmpty);
  }

  update(dt: number, input: Input, camera: PerspectiveCamera) {
    this.time += dt;
    const g = this.guns[this.idx], d = g.def, p = this.player;

    // --- Switching, inspect, reload ---
    for (let i = 0; i < this.guns.length; i++) if (input.wasPressed(`Digit${i + 1}`)) this.select(i);
    if (input.wheel) this.select((this.idx + (input.wheel > 0 ? 1 : this.guns.length - 1)) % this.guns.length);
    if (input.wasPressed('KeyR')) this.startReload();
    if (input.wasPressed('KeyY') && !this.reloading && this.ads < 0.1) { this.inspectT = 0; this.sfx.inspect(); }
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt / d.drawTime);
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.reloadDur) {
        const take = this.infiniteReserve ? d.mag - g.mag : Math.min(d.mag - g.mag, g.reserve);
        g.mag += take;
        if (!this.infiniteReserve) g.reserve -= take;
        this.reloadT = -1;
        this.syncAmmo();
      }
    }

    // --- Aim and sprint interplay ---
    const wantAds = input.isDown('Mouse2');
    const trigger = d.auto ? input.isDown('Mouse0') : input.wasPressed('Mouse0');
    if (!d.auto && trigger) { this.queued = true; this.queuedAt = this.time; }
    p.sprintBlocked = wantAds || input.isDown('Mouse0') || this.queued;
    if (p.sprinting) this.sprintOut = d.sprintToFire;
    else this.sprintOut = Math.max(0, this.sprintOut - dt);
    const canAds = wantAds && !p.sprinting && this.drawT > 0.3;
    this.ads = clamp(this.ads + (canAds ? 1 : -1.4) * (dt / d.adsTime), 0, 1);
    p.speedMul = d.moveMult * lerp(1, 0.62, this.ads);
    if (this.inspectT >= 0) {
      this.inspectT += dt / 3;
      if (this.inspectT >= 1 || wantAds || p.sprinting || input.isDown('Mouse0')) this.inspectT = -1;
    }

    // --- Spread ---
    const moveK = clamp(p.horizSpeed / 6.9, 0, 1.2);
    const air = p.onGround ? 0 : 1;
    const hipK = 1 - this.ads;
    this.bloom = Math.max(0, this.bloom - dt * d.bloomMax * 2.2 * (this.time - this.lastShot > 0.15 ? 1.6 : 0.3));
    this.spread = lerp(d.hipSpread, d.adsSpread, this.ads) + d.moveSpread * moveK * lerp(1, 0.25, this.ads)
      + this.bloom * hipK + air * d.hipSpread * 0.8 + (p.stance === 'slide' ? d.hipSpread * 0.4 : 0)
      - (p.stance === 'crouch' && !p.moving ? d.hipSpread * 0.2 * hipK : 0);

    // --- Firing ---
    this.cooldown = Math.max(0, this.cooldown - dt);
    const wantsFire = d.auto ? trigger : this.queued;
    const ready = !this.reloading && this.drawT >= 1 && this.sprintOut <= 0 && !p.mantling;
    if (wantsFire && ready && this.cooldown <= 0) {
      if (g.mag > 0) {
        this.fire(g, camera);
        this.queued = false;
      } else {
        if (input.wasPressed('Mouse0')) this.sfx.dryFire();
        this.queued = false;
        this.startReload();
      }
    }
    // Auto guns keep firing on the cooldown; reset the spray when the trigger is released.
    if (!input.isDown('Mouse0') && this.time - this.lastShot > 60 / d.rpm + 0.05) this.sprayIdx = 0;
    // A queued semi-auto shot (clicked while sprinting or mid-bolt) expires if it can't happen soon.
    if (this.queued && this.time - this.queuedAt > d.sprintToFire + 0.25) this.queued = false;

    // --- Recoil recovery: drift back toward where the spray started ---
    if (this.sprayRise > 0 && this.time - this.lastShot > RECOVER_DELAY) {
      // Only recover what the player hasn't already pulled down themselves.
      const pulledDown = Math.max(0, this.sprayStartPitch + this.sprayRise - p.pitch);
      const left = Math.max(0, this.sprayRise - pulledDown);
      const step = Math.min(left, Math.max(4 * DEG, left * RECOVER_RATE) * dt);
      p.pitch -= step;
      this.sprayRise = Math.max(0, left - step);
      if (left <= 1e-4) this.sprayRise = 0;
    }
    this.punch = damp(this.punch, 0, 18, dt);

    this.updateBreath(dt, input);

    this.vm.update(dt, {
      ads: this.ads, sprint: p.sprinting ? 1 : 0, crouch: p.stance === 'crouch' ? 1 : 0, slide: p.slideT, speed: p.horizSpeed,
      grounded: p.onGround, reload: this.reloading ? this.reloadT / this.reloadDur : -1, reloadEmpty: this.reloadEmpty,
      draw: this.drawT, inspect: this.inspectT, hidden: this.scoped,
    }, input.mouseDX, input.mouseDY);
  }

  private fire(g: GunState, camera: PerspectiveCamera) {
    const d = g.def, p = this.player;
    g.mag--;
    this.cooldown += 60 / d.rpm;
    const first = this.sprayIdx === 0;
    if (first) { this.sprayStartPitch = p.pitch; this.sprayRise = 0; }

    // Direction: camera forward jittered uniformly inside the spread cone.
    const dir = camera.getWorldDirection(this.tmpDir);
    const r = this.spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const right = new Vector3().crossVectors(dir, camera.up).normalize();
    const up = new Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();

    // Muzzle position in world space (viewmodel lives in camera space).
    const muzzle = this.vm.muzzleLocal(this.tmpMuzzle);
    camera.localToWorld(muzzle);
    this.ballistics.fire(camera.position, dir, d, muzzle);
    this.fx.muzzle(muzzle);
    this.sfx.shot(d.id);

    // Recoil: follow the gun's pattern, then loop its last third.
    const pat = d.pattern;
    const i = this.sprayIdx < pat.length ? this.sprayIdx : pat.length - 1 - ((this.sprayIdx - pat.length) % Math.ceil(pat.length / 3));
    let [kUp, kRight] = pat[Math.max(0, i)];
    const mul = (first ? d.firstShotKick : 1) * lerp(1, d.adsRecoilMul, this.ads) * (p.stance === 'crouch' ? 0.85 : 1);
    kUp = (kUp + (Math.random() - 0.3) * d.recoilJitter) * mul;
    kRight = (kRight + (Math.random() - 0.5) * d.recoilJitter) * mul;
    p.pitch += kUp * DEG;
    p.yaw -= kRight * DEG;
    this.sprayRise += kUp * DEG;
    this.punch += kUp * DEG * 0.4;
    this.sprayIdx++;
    this.lastShot = this.time;
    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloomPerShot);
    const heavy = d.id === 'sniper';
    this.vm.kick((heavy ? 0.16 : 0.035) * (1 - this.ads * 0.5), heavy ? 1.6 : 0.55, (Math.random() - 0.5) * 0.04);
    this.syncAmmo();
    if (g.mag === 0 && (g.reserve > 0 || this.infiniteReserve)) setTimeout(() => { if (this.guns[this.idx] === g && g.mag === 0) this.startReload(); }, 250);
  }

  /** Scoped sway: slow figure-eight. Shift steadies it for a few seconds, then you're winded. */
  private updateBreath(dt: number, input: Input) {
    const d = this.def;
    const scoped = d.scope && this.ads > 0.5;
    const wantHold = scoped && input.isDown('ShiftLeft') && this.winded <= 0 && this.holdLeft > 0;
    if (wantHold && !this.holding) this.sfx.breath(true);
    if (!wantHold && this.holding) this.sfx.breath(false);
    this.holding = wantHold;
    if (this.holding) {
      this.holdLeft -= dt;
      if (this.holdLeft <= 0) { this.winded = BREATH_WINDED; this.holding = false; this.sfx.breath(false); }
    } else {
      this.winded = Math.max(0, this.winded - dt);
      this.holdLeft = Math.min(BREATH_HOLD, this.holdLeft + dt * 0.8);
    }
    this.breathT += dt * (this.winded > 0 ? 1.8 : 1);
    const amp = scoped ? (this.holding ? 0.08 : this.winded > 0 ? 2.2 : 1) * 0.0028 * this.ads : 0;
    this.breathPitch = damp(this.breathPitch, Math.sin(this.breathT * 1.3) * amp, 8, dt);
    this.breathYaw = damp(this.breathYaw, Math.sin(this.breathT * 0.65) * amp * 1.4, 8, dt);
  }

  get breathState() { return this.holding ? 'hold' : this.winded > 0 ? 'winded' : 'normal'; }
}
