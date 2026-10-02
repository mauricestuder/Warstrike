import { Vector3, type PerspectiveCamera } from 'three';
import type { Sfx } from '../audio/Sfx';
import type { Input } from '../core/Input';
import { clamp, damp, DEG, lerp } from '../core/math';
import type { Player } from '../player/Player';
import type { Effects } from '../render/Effects';
import type { Hud } from '../ui/Hud';
import type { Ballistics } from './Ballistics';
import { AMMO_MAX, GUNS, HANDS, LOADOUT, RARITY, rarityDef, type AmmoType, type GunDef, type GunId, type Rarity } from './defs';
import type { ViewModel } from './ViewModel';

export interface GunState { def: GunDef; base: GunId | 'hands'; rarity: Rarity; mag: number; }

/** Recovery starts this long after the last shot and closes the gap at RECOVER_RATE × remaining per second. */
const RECOVER_DELAY = 0.12, RECOVER_RATE = 7;
const BREATH_HOLD = 4, BREATH_WINDED = 2.5;

/**
 * The player's guns: firing with real spread (hip / ADS / movement / bloom), learnable recoil patterns that move
 * your actual aim, recoil recovery, per-gun ADS and sprint-to-fire times, reloads (tactical vs empty), weapon swap,
 * inspect, and scope sway with hold-breath on the sniper.
 */
export class Weapons {
  /** Gun slots (keys 1, 2, …). Empty slots are null. Hands are always available on X. */
  readonly slots: (GunState | null)[];
  private hands: GunState = { def: HANDS, base: 'hands', rarity: 0, mag: 0 };
  private cur: GunState;
  private lastGun = 0;
  /** Shared ammo pools by type. */
  readonly ammo: Record<AmmoType, number> = { rifle: 0, smg: 0, sniper: 0 };
  /** Set by the game: no firing or switching (in the plane, falling, plating, shop open). */
  blocked = false;
  /** 0..1 lowered gun (plating, shop). */
  lower = 0;
  /** Plate insert progress for the view model, or -1. */
  plateT = -1;
  chute = false;
  /** Camera pitch, so the parachute stays overhead in the view model scene. */
  pitch = 0;
  hidden = false;
  /** Punch hit test, wired up by the game. Returns true if something was hit. */
  melee: (dir: Vector3) => boolean = () => false;
  /** Called on every shot you fire (bots hear it). */
  onShot: () => void = () => {};
  private punchCd = 0;
  private punchPending = -1;
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
    this.slots = LOADOUT.map((id) => ({ def: GUNS[id], base: id, rarity: 0 as Rarity, mag: GUNS[id].mag }));
    this.cur = this.slots[0]!;
    this.select(this.cur, true);
  }

  /** Battle royale: start with empty pockets and two empty slots. */
  emptyHanded() {
    this.slots.length = 0;
    this.slots.push(null, null);
    for (const k of Object.keys(this.ammo) as AmmoType[]) this.ammo[k] = 0;
    this.select(this.hands, true);
  }

  get def() { return this.cur.def; }
  get current() { return this.cur; }
  get onHands() { return this.cur === this.hands; }
  get reloading() { return this.reloadT >= 0; }
  get scoped() { return this.def.scope && this.ads > 0.92; }

  private select(g: GunState, instant = false) {
    if (g === this.cur && !instant) return;
    this.cur = g;
    const si = this.slots.indexOf(g);
    if (si >= 0) this.lastGun = si;
    this.reloadT = -1;
    this.inspectT = -1;
    this.drawT = instant ? 1 : 0;
    this.sprayIdx = 0;
    this.bloom = 0;
    this.queued = false;
    this.vm.select(this.def.id);
    if (g.base !== 'hands') this.vm.setRarity(g.base, RARITY[g.rarity].color, g.rarity === 4);
    if (!instant) this.sfx.swap();
    this.syncAmmo();
  }

  /** Pushes weapon name, rarity, ammo and slots to the HUD. */
  syncAmmo() {
    const g = this.cur;
    this.hud.setGun(g.def.name, g.base === 'hands' ? null : RARITY[g.rarity]);
    if (g.base === 'hands') this.hud.setAmmo(-1, 0, 0);
    else this.hud.setAmmo(g.mag, this.infiniteReserve ? Infinity : this.ammo[g.def.ammo], g.def.mag);
    this.hud.setSlots(this.slots.map((s) => s && { name: s.def.name, color: RARITY[s.rarity].color }), this.slots.indexOf(g));
  }

  /** Refill everything (range convenience). */
  refill() {
    for (const g of this.slots) if (g) g.mag = g.def.mag;
    for (const k of Object.keys(this.ammo) as AmmoType[]) this.ammo[k] = AMMO_MAX[k];
    this.syncAmmo();
  }

  /** Adds ammo up to the carry limit; returns how much was taken. */
  addAmmo(type: AmmoType, n: number) {
    const take = Math.min(n, AMMO_MAX[type] - this.ammo[type]);
    this.ammo[type] += take;
    this.syncAmmo();
    return take;
  }

  /**
   * Picks up a gun: into an empty slot if there is one, otherwise it replaces the gun in hand (or slot 1 when on
   * fists). Returns the gun that was dropped, if any.
   */
  give(id: GunId, rarity: Rarity, mag: number): GunState | null {
    const g: GunState = { def: rarityDef(id, rarity), base: id, rarity, mag };
    let i = this.slots.indexOf(null);
    let dropped: GunState | null = null;
    if (i < 0) {
      i = this.onHands ? this.lastGun : this.slots.indexOf(this.cur);
      dropped = this.slots[i];
    }
    this.slots[i] = g;
    this.select(g, false);
    return dropped;
  }

  /** Same gun type already held: lets the loot system show "swap" vs "pick up". */
  get full() { return !this.slots.includes(null); }

  private startReload() {
    const g = this.cur;
    if (g.base === 'hands') return;
    if (this.reloading || g.mag >= g.def.mag || (this.ammo[g.def.ammo] <= 0 && !this.infiniteReserve)) return;
    this.reloadEmpty = g.mag === 0;
    this.reloadDur = this.reloadEmpty ? g.def.reloadEmpty : g.def.reload;
    this.reloadT = 0;
    this.inspectT = -1;
    this.sfx.reload(this.reloadDur, this.reloadEmpty);
  }

  update(dt: number, input: Input, camera: PerspectiveCamera) {
    this.time += dt;
    const p = this.player;

    // --- Switching, inspect, reload ---
    if (!this.blocked) {
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        if (s && input.wasPressed(`Digit${i + 1}`)) this.select(s);
      }
      if (input.wasPressed('KeyX')) {
        const back = this.slots[this.lastGun] ?? this.slots.find((s) => s);
        this.select(this.onHands && back ? back : this.hands);
      }
      if (input.wheel) {
        const ring = [...this.slots.filter((s): s is GunState => !!s), this.hands];
        const i = ring.indexOf(this.cur);
        this.select(ring[(i + (input.wheel > 0 ? 1 : ring.length - 1)) % ring.length]);
      }
      if (input.wasPressed('KeyR')) this.startReload();
      if (input.wasPressed('KeyY') && !this.reloading && this.ads < 0.1 && !this.onHands) { this.inspectT = 0; this.sfx.inspect(); }
    }
    const g = this.cur, d = g.def;
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt / d.drawTime);
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.reloadDur) {
        const take = this.infiniteReserve ? d.mag - g.mag : Math.min(d.mag - g.mag, this.ammo[d.ammo]);
        g.mag += take;
        if (!this.infiniteReserve) this.ammo[d.ammo] -= take;
        this.reloadT = -1;
        this.syncAmmo();
      }
    }

    // --- Aim and sprint interplay ---
    const wantAds = input.isDown('Mouse2') && !this.onHands && !this.blocked;
    const trigger = !this.blocked && (d.auto ? input.isDown('Mouse0') : input.wasPressed('Mouse0'));
    if (!d.auto && trigger) { this.queued = true; this.queuedAt = this.time; }
    p.sprintBlocked = wantAds || (input.isDown('Mouse0') && !this.onHands) || this.queued;
    if (p.sprinting) this.sprintOut = d.sprintToFire;
    else this.sprintOut = Math.max(0, this.sprintOut - dt);
    const canAds = wantAds && !p.sprinting && this.drawT > 0.3;
    this.ads = clamp(this.ads + (canAds ? 1 : -1.4) * (dt / d.adsTime), 0, 1);
    p.speedMul = d.moveMult * lerp(1, 0.62, this.ads);
    p.sprintMul = d.sprintMult;
    if (this.inspectT >= 0) {
      this.inspectT += dt / 3;
      if (this.inspectT >= 1 || wantAds || p.sprinting || input.isDown('Mouse0')) this.inspectT = -1;
    }

    // --- Spread ---
    const moveK = clamp(p.horizSpeed / 7.6, 0, 1.2);
    const air = p.onGround ? 0 : 1;
    const hipK = 1 - this.ads;
    this.bloom = Math.max(0, this.bloom - dt * d.bloomMax * 2.2 * (this.time - this.lastShot > 0.15 ? 1.6 : 0.3));
    this.spread = lerp(d.hipSpread, d.adsSpread, this.ads) + d.moveSpread * moveK * lerp(1, 0.25, this.ads)
      + this.bloom * hipK + air * d.hipSpread * 0.8 + (p.stance === 'slide' ? d.hipSpread * 0.4 : 0)
      - (p.stance === 'crouch' && !p.moving ? d.hipSpread * 0.2 * hipK : 0);

    // --- Punching ---
    if (this.onHands) {
      this.queued = false;
      this.punchCd = Math.max(0, this.punchCd - dt);
      if (trigger && this.punchCd <= 0 && this.drawT >= 1 && !p.mantling) {
        this.punchCd = 60 / HANDS.rpm;
        this.vm.punch();
        this.sfx.punch();
        this.punchPending = 0.11; // the fist lands a beat after the swing starts
        p.sprinting = false;
      }
      if (this.punchPending >= 0 && (this.punchPending -= dt) < 0) {
        if (this.melee(camera.getWorldDirection(this.tmpDir))) this.sfx.punchHit();
      }
    }

    // --- Firing ---
    this.cooldown = Math.max(0, this.cooldown - dt);
    const wantsFire = d.auto ? trigger : this.queued;
    const ready = !this.reloading && this.drawT >= 1 && this.sprintOut <= 0 && !p.mantling && !this.onHands && this.lower < 0.05;
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
      draw: this.drawT, inspect: this.inspectT, hidden: this.scoped || this.hidden, lower: this.lower, plate: this.plateT,
      chute: this.chute, pitch: this.pitch,
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
    this.sfx.shot(g.base as GunId);
    this.onShot();

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
    if (g.mag === 0 && (this.ammo[d.ammo] > 0 || this.infiniteReserve)) setTimeout(() => { if (this.cur === g && g.mag === 0) this.startReload(); }, 250);
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
