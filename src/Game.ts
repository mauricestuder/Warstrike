import { Vector3 } from 'three';
import { Sfx } from './audio/Sfx';
import { Match } from './br/Match';
import { Input } from './core/Input';
import { clamp, damp, DEG } from './core/math';
import type { Settings } from './core/Settings';
import { Player } from './player/Player';
import { Effects } from './render/Effects';
import { Renderer } from './render/Renderer';
import { Bot, Targets, type Target, type Zone } from './targets/Targets';
import { Hud } from './ui/Hud';
import { Ballistics } from './weapons/Ballistics';
import { falloffMul, HANDS, MELEE_RANGE, type GunDef } from './weapons/defs';
import { ViewModel } from './weapons/ViewModel';
import { Weapons } from './weapons/Weapons';
import { Range } from './world/Range';
import { Town } from './world/town/Town';
import type { World } from './world/World';

export type MapId = 'range' | 'town' | 'br';

/** Wires everything together and runs the frame: input → movement → weapons → bullets → camera → render. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly hud = new Hud();
  readonly world: World;
  readonly player: Player;
  readonly targets: Targets;
  readonly fx: Effects;
  readonly ballistics: Ballistics;
  readonly vm: ViewModel;
  readonly weapons: Weapons;
  running = false;
  /** The battle royale match (null on the range and in free roam). */
  readonly match: Match | null = null;
  /** Match finished: the end screen is up. */
  over = false;
  private last = performance.now();
  private fov = 80;
  private roll = 0;
  private landDip = 0;
  private landV = 0;
  private bob = 0;
  /** Latest damage events (exposed for automated tests). */
  readonly log: { zone: Zone; dmg: number; dist: number; wallbang: boolean; steel: boolean }[] = [];

  constructor(public settings: Settings, readonly map: MapId) {
    this.sfx.env = map === 'range' ? 'range' : 'town';
    this.renderer = new Renderer(settings.quality);
    this.input = new Input(this.renderer.gl.domElement);
    const w = this.world = map === 'range' ? new Range(this.renderer) : new Town(this.renderer);
    this.fx = new Effects(this.renderer.scene);
    this.targets = new Targets(this.renderer, w.steel, w.botLanes, w.wallDummies);
    this.player = new Player(w.colliders, {
      step: (s) => this.sfx.step(s),
      jump: () => this.sfx.jump(),
      land: (v) => { this.sfx.land(v); this.landV -= Math.min(v, 12) * 0.018; this.vm.land(v); },
      slide: () => this.sfx.slide(),
      mantle: () => this.sfx.mantle(),
      chute: () => this.sfx.chute(),
    });
    this.player.spawn(w.spawn, w.spawnYaw);
    this.ballistics = new Ballistics(w.colliders, this.targets, {
      impact: (p, n, s, exit) => { this.fx.impact(p, n, s); void exit; },
      hit: (t, zone, gun, mul, dist, p, dir, wb) => this.onHit(t, zone, gun, mul, dist, p, dir, wb),
      tracer: (a, b, bullet) => this.fx.tracer(a, b, bullet ? 0.016 : 0.01, bullet ? 0.035 : 0.04),
    });
    this.vm = new ViewModel(this.renderer.vmScene);
    this.weapons = new Weapons(this.player, this.vm, this.ballistics, this.sfx, this.hud, this.fx);
    this.weapons.infiniteReserve = w.infiniteAmmo;
    this.weapons.refill();
    this.weapons.melee = this.melee;
    this.hud.setMode(false);
    if (map === 'br') {
      this.match = new Match(this);
      this.weapons.onShot = () => this.match?.playerShot();
    }
    this.applySettings();
    requestAnimationFrame(() => this.frame());
  }

  applySettings() {
    this.sfx.setVolume(this.settings.volume);
    this.hud.showFps = this.settings.showFps;
  }

  get welcome() {
    return this.match
      ? 'Battle royale · SPACE to jump from the plane · loot guns with F · plate up with 4 · M for the map · 12 bots drop with you and shoot back · last one standing wins'
      : this.world.welcome;
  }

  /** A punch: the nearest bot within reach in front of you, unless a wall is closer. */
  readonly melee = (dir: Vector3) => {
    const eye = this.renderer.camera.position;
    const hit = this.targets.raycast(eye, dir, MELEE_RANGE);
    if (!hit) return false;
    const wall = this.world.colliders.raycast(eye, dir, hit.hit.t);
    if (wall) return false;
    const p = eye.clone().addScaledVector(dir, hit.hit.t);
    this.onHit(hit.target, hit.hit.zone, HANDS, 1, hit.hit.t, p, dir, false);
    return true;
  };

  private onHit(t: Target, zone: Zone, gun: GunDef, mul: number, dist: number, p: Vector3, dir: Vector3, wallbang: boolean) {
    const zoneMul = zone === 'head' ? gun.headMult : zone === 'limb' ? gun.limbMult : 1;
    const dmg = gun.damage * falloffMul(gun, dist) * zoneMul * mul;
    const r = t.damage(dmg, zone);
    const head = zone === 'head';
    this.log.push({ zone, dmg: r.dealt, dist, wallbang, steel: r.steel });
    if (this.log.length > 50) this.log.shift();
    const m = `${Math.round(dist)} m`;
    if (r.steel) {
      // The ding arrives after the sound travels back; the marker is instant so you know you connected.
      this.sfx.steel(dist);
      this.hud.hit('steel');
      this.hud.info(`${head ? 'HIGH HIT' : 'HIT'} · ${m}`, head ? 'head' : '');
      this.fx.impact(p, dir.clone().negate(), 'steel');
      return;
    }
    this.fx.blood(p, dir, head);
    this.hud.damageNumber(p, r.dealt, head);
    this.match?.onHit(r.dealt);
    if (t instanceof Bot && !r.killed) this.match?.botHit(t);
    if (r.killed && t instanceof Bot) this.match?.botDown(t, dist, head);
    if (r.killed) {
      this.hud.hit('kill');
      this.sfx.kill();
      this.hud.info(`${head ? 'HEADSHOT KILL' : 'KILL'} · ${m}${wallbang ? ' · WALLBANG' : ''}`, 'kill');
    } else {
      this.hud.hit(head ? 'head' : r.armorBroke ? 'armor' : 'body');
      this.sfx.hit(head, !r.armorBroke);
      if (r.armorBroke) this.sfx.armorBreak();
      if (head || wallbang || dist > 50) this.hud.info(`${head ? 'HEADSHOT' : zone === 'limb' ? 'LIMB' : 'BODY'} · ${m}${wallbang ? ' · WALLBANG' : ''}`, head ? 'head' : '');
    }
  }

  /** Converts the horizontal FOV setting (at 16:9, like most shooters) to three.js's vertical FOV. */
  private baseVFov() {
    return 2 * Math.atan(Math.tan((this.settings.fov * DEG) / 2) / (16 / 9)) / DEG;
  }

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.running) this.step(dt);
    this.renderer.render();
    this.input.endFrame();
  }

  /** One simulation frame. Public so tests can drive the game with fixed time steps. */
  step(dt: number) {
    const input = this.input, p = this.player, w = this.weapons, cam = this.renderer.camera;
    // Mouse look (degrees per count like CS, scaled down while zoomed so tracking feels the same).
    const vBase = this.baseVFov();
    const zoomRatio = Math.tan((this.fov * DEG) / 2) / Math.tan((vBase * DEG) / 2);
    const adsScale = 1 + (zoomRatio * this.settings.adsSens - 1) * w.ads;
    const k = 0.022 * this.settings.sens * DEG * adsScale;
    p.look(input.mouseDX * k, input.mouseDY * k);

    const m = this.match, plane = !!m && m.inPlane, sky = p.skydive !== 'none';
    if (!plane) p.update(dt, input);
    w.blocked = !!m && m.blocksWeapons;
    w.hidden = plane || sky;
    w.chute = p.skydive === 'chute';
    w.pitch = p.pitch;
    w.update(dt, input, cam);
    this.ballistics.update(dt);
    this.targets.update(dt, p.pos);
    this.world.update(dt, cam.position);
    // Safety net: anything that ends up outside the world goes back to spawn.
    if (p.pos.y < -20) p.spawn(this.world.spawn, this.world.spawnYaw);
    this.fx.update(dt);
    m?.update(dt);

    if (input.wasPressed('KeyH')) document.getElementById('help')!.classList.toggle('show');
    if (input.wasPressed('KeyT') && !m) { w.refill(); this.hud.showHint('Ammo refilled', 1.5); }

    // --- Camera feel ---
    // Landing dip on a spring, gentle head bob, slide roll and a little strafe lean.
    this.landV += (-80 * this.landDip - 11 * this.landV) * dt;
    this.landDip += this.landV * dt;
    if (p.onGround && p.moving && p.stance !== 'slide') this.bob += dt * p.horizSpeed * 1.9;
    const bobAmp = (p.onGround ? clamp(p.horizSpeed / 6, 0, 1.2) : 0) * (1 - w.ads * 0.9) * 0.022;
    const sideVel = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw);
    this.roll = damp(this.roll, -p.slideT * 0.07 - clamp(sideVel / 7, -1, 1) * 0.012 * (1 - w.ads), 8, dt);
    if (plane) m!.planeCamera(cam.position);
    else cam.position.set(p.pos.x, p.pos.y + p.eye + this.landDip + Math.abs(Math.sin(this.bob)) * bobAmp, p.pos.z);
    cam.rotation.set(p.pitch + w.punch + w.breathPitch, p.yaw + w.breathYaw + Math.sin(this.bob * 0.5) * bobAmp * 0.15, this.roll, 'YXZ');

    // FOV: sprint widens a touch, ADS zooms by the gun's optic (lerped in tan-space so zoom feels linear).
    const sprintK = p.skydive === 'freefall' ? 1 + clamp(-p.vel.y / 58, 0, 1) * 0.22 : p.tacSprinting ? 1.1 : p.sprinting ? 1.05 : 1;
    const tBase = Math.tan((vBase * DEG) / 2) * (w.ads > 0 ? 1 : sprintK);
    const tAds = Math.tan((vBase * DEG) / 2) / w.def.zoom;
    const target = (2 * Math.atan(tBase + (tAds - tBase) * w.ads)) / DEG;
    this.fov = damp(this.fov, target, w.ads > 0 && w.ads < 1 ? 40 : 12, dt);
    this.renderer.setFov(this.fov);
    this.renderer.setNear(plane ? 2 : sky ? clamp(p.altitude * 0.012, 0.05, 1.5) : 0.05);

    // --- HUD ---
    const crossVis = w.scoped || p.sprinting || plane || sky ? 0 : (w.onHands ? 0.6 : 1) * (1 - w.ads) * (1 - w.lower);
    this.hud.crosshair(w.spread, this.fov, crossVis, dt);
    this.hud.setScope(w.scoped);
    this.hud.setMove(p.horizSpeed, p.mantling ? 'mantle' : p.tacSprinting ? 'tac sprint' : p.sprinting ? 'sprint' : p.stance, p.lastSlide);
    this.hud.setTac(p.tacFraction, p.tacSprinting);
    this.hud.update(dt, cam);
  }
}
