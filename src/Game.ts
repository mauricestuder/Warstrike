import { Group, Mesh, MeshStandardMaterial, Vector3, type Material } from 'three';
import { Sfx } from './audio/Sfx';
import { Match } from './br/Match';
import { Input } from './core/Input';
import { clamp, damp, DEG, smoothstep } from './core/math';
import { saveSettings, type Settings } from './core/Settings';
import { Player } from './player/Player';
import { Effects } from './render/Effects';
import { Renderer } from './render/Renderer';
import { Soldier } from './render/Soldier';
import { Bot, Targets, type Target, type Zone } from './targets/Targets';
import { Hud } from './ui/Hud';
import { Ballistics } from './weapons/Ballistics';
import { falloffMul, HANDS, MELEE_RANGE, RARITY, type GunDef, type GunId } from './weapons/defs';
import { buildGunMesh, TAN, ViewModel } from './weapons/ViewModel';
import { Weapons } from './weapons/Weapons';
import { Range } from './world/Range';
import { Town } from './world/town/Town';
import type { World } from './world/World';

export type MapId = 'range' | 'town' | 'br';

/** Below this much third person, the camera counts as first person: the view model shows and your head and arms hide. */
const FP_SWITCH = 0.7;

/** What one hit did, for the marker, sound and readout. */
interface HitFeedback {
  zone: Zone; dealt: number; head: boolean; killed: boolean; armorBroke: boolean; steel: boolean;
  dist: number; p: Vector3; dir: Vector3; wallbang: boolean;
}

/** Wires everything together and runs the frame: input → movement → weapons → bullets → camera → render. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly sfx = new Sfx();
  readonly hud = new Hud();
  world!: World;
  player!: Player;
  targets!: Targets;
  fx!: Effects;
  ballistics!: Ballistics;
  vm!: ViewModel;
  weapons!: Weapons;
  /** Your own character: seen from behind in third person, your legs and chest when you look down in first person. */
  body!: Soldier;
  running = false;
  /** The battle royale match (null on the range and in free roam). */
  match: Match | null = null;
  /** Map built and ready to play. */
  ready = false;
  /** Match finished: the end screen is up. */
  over = false;
  private last = performance.now();
  private fov = 80;
  private roll = 0;
  private landDip = 0;
  private landV = 0;
  private bob = 0;
  private bobAmp = 0;
  /** 0..1 how third-person the camera is (eases when you toggle the view or aim down sights). */
  private tpK = 1;
  private tp = 1;
  private camDist = 2.4;
  private shotsSeen = 0;
  private bodyGun = '';
  private gunMats = new Map<string, Group>();
  /** Your head: where shots start in third person, and where reach (pick-ups, punches) is measured from. */
  readonly eyePos = new Vector3();
  /** Latest damage events (exposed for automated tests). */
  readonly log: { zone: Zone; dmg: number; dist: number; wallbang: boolean; steel: boolean }[] = [];

  constructor(public settings: Settings, readonly map: MapId) {
    this.sfx.env = map === 'range' ? 'range' : 'town';
    this.renderer = new Renderer(settings.quality);
    this.input = new Input(this.renderer.gl.domElement);
    this.tpK = this.tp = settings.view === 'third' ? 1 : 0;
  }

  /**
   * Builds the map and everything in it, a step at a time so the loading screen can show progress between steps.
   * `progress(fraction, label)` is called before each step and awaited (it yields a frame to the browser).
   */
  async load(progress: (f: number, label: string) => Promise<void>) {
    const map = this.map, r = this.renderer;
    await progress(0.04, map === 'range' ? 'Building the range' : 'Laying out Calvert');
    const town = map === 'range' ? null : new Town(r);
    const w = this.world = town ?? new Range(r);
    if (town) {
      const steps = town.steps();
      for (let i = 0; i < steps.length; i++) {
        await progress(0.06 + (0.6 * i) / steps.length, steps[i][0]);
        steps[i][1]();
      }
    }
    await progress(0.68, 'Training the bots');
    this.fx = new Effects(r.scene);
    this.targets = new Targets(r, w.steel, w.botLanes, w.wallDummies);
    this.player = new Player(w.colliders, {
      step: (s) => this.sfx.step(s),
      jump: () => this.sfx.jump(),
      land: (v) => { this.sfx.land(v); this.landV -= Math.min(v, 12) * 0.018; this.vm.land(v); },
      slide: () => this.sfx.slide(),
      mantle: () => this.sfx.mantle(),
      chute: () => this.sfx.chute(),
    });
    this.player.spawn(w.spawn, w.spawnYaw);
    this.body = new Soldier((color, rough = 0.85, metal = 0) => r.setupMaterial(new MeshStandardMaterial({ color, roughness: rough, metalness: metal })),
      { fabric: 0x4b5258, vest: 0x2a2d30, helmet: 0x30353a });
    r.scene.add(this.body.root);
    this.ballistics = new Ballistics(w.colliders, this.targets, {
      impact: (p, n, s, exit) => { this.fx.impact(p, n, s); void exit; },
      hit: (t, zone, gun, mul, dist, p, dir, wb) => this.onHit(t, zone, gun, mul, dist, p, dir, wb),
      tracer: (a, b, bullet) => this.fx.tracer(a, b, bullet ? 0.016 : 0.01, bullet ? 0.035 : 0.04),
      volley: (on) => this.volley(on),
    });
    this.vm = new ViewModel(r.vmScene);
    this.weapons = new Weapons(this.player, this.vm, this.ballistics, this.sfx, this.hud, this.fx);
    this.weapons.infiniteReserve = w.infiniteAmmo;
    this.weapons.refill();
    this.weapons.melee = this.melee;
    this.weapons.aimFrom = (dir) => this.aimFrom(dir);
    this.weapons.muzzleAt = (out) => this.body.muzzle(out);
    this.hud.setMode(false);
    if (map === 'br') {
      await progress(0.74, 'Mapping routes for 37 bots');
      this.match = new Match(this);
      this.weapons.onShot = () => this.match?.playerShot();
    }
    this.applySettings();
    await progress(0.9, 'Warming up shaders');
    // Compile every material now, so the first look around doesn't stutter.
    this.camera3p(0);
    this.syncBody(0);
    try { await r.gl.compileAsync(r.scene, r.camera); await r.gl.compileAsync(r.vmScene, r.vmCamera); } catch { /* not supported: compile lazily */ }
    await progress(1, 'Ready');
    this.ready = true;
    requestAnimationFrame(() => this.frame());
  }

  applySettings() {
    this.sfx.setVolume(this.settings.volume);
    this.hud.showFps = this.settings.showFps;
  }

  get welcome() {
    return this.match
      ? `Battle royale · SPACE to jump from the plane · loot guns with F · plate up with 4 · M for the map · V switches first / third person · ${this.targets.bots.length} bots drop with you and shoot back · last one standing wins`
      : `${this.world.welcome} · V switches first / third person`;
  }

  /** Third person: start the shot at your head and aim it at whatever is under the crosshair. */
  private aimFrom(dir: Vector3): Vector3 | null {
    if (this.tp < FP_SWITCH) return null;
    const cam = this.renderer.camera.position;
    // Look for what the crosshair is on, starting level with you (not at the camera behind you).
    const start = cam.clone().addScaledVector(dir, this.camDist * this.tp);
    let t = 900;
    const wall = this.world.colliders.raycast(start, dir, t);
    if (wall) t = wall.t;
    const hit = this.targets.raycast(start, dir, t);
    if (hit) t = hit.hit.t;
    const aim = start.addScaledVector(dir, Math.max(t, 1.5));
    const origin = this.eyePos.clone();
    dir.subVectors(aim, origin).normalize();
    return origin;
  }

  /** A punch: the nearest bot within reach in front of you, unless a wall is closer. */
  readonly melee = (dir: Vector3) => {
    const eye = this.eyePos;
    const hit = this.targets.raycast(eye, dir, MELEE_RANGE);
    if (!hit) return false;
    const wall = this.world.colliders.raycast(eye, dir, hit.hit.t);
    if (wall) return false;
    const p = eye.clone().addScaledVector(dir, hit.hit.t);
    this.onHit(hit.target, hit.hit.zone, HANDS, 1, hit.hit.t, p, dir, false);
    return true;
  };

  /** Shotgun pellets in flight: hits are summed per target and shown once when the shell is done. */
  private pellets: Map<Target, HitFeedback> | null = null;

  private volley(on: boolean) {
    if (on) { this.pellets = new Map(); return; }
    const hits = this.pellets;
    this.pellets = null;
    for (const h of hits?.values() ?? []) this.hitFeedback(h);
  }

  private onHit(t: Target, zone: Zone, gun: GunDef, mul: number, dist: number, p: Vector3, dir: Vector3, wallbang: boolean) {
    const zoneMul = zone === 'head' ? gun.headMult : zone === 'limb' ? gun.limbMult : 1;
    const dmg = gun.damage * falloffMul(gun, dist) * zoneMul * mul;
    const r = t.damage(dmg, zone);
    const head = zone === 'head';
    this.log.push({ zone, dmg: r.dealt, dist, wallbang, steel: r.steel });
    if (this.log.length > 50) this.log.shift();
    if (!r.steel) {
      this.fx.blood(p, dir, head);
      this.match?.onHit(r.dealt);
      if (t instanceof Bot && !r.killed) this.match?.botHit(t);
      if (r.killed && t instanceof Bot) this.match?.botDown(t, dist, head);
    }
    const h: HitFeedback = { zone, dealt: r.dealt, head, killed: r.killed, armorBroke: r.armorBroke, steel: r.steel, dist, p, dir, wallbang };
    const sum = this.pellets?.get(t);
    if (sum) {
      sum.dealt += h.dealt;
      sum.head ||= h.head;
      sum.killed ||= h.killed;
      sum.armorBroke ||= h.armorBroke;
      sum.wallbang &&= h.wallbang;
      if (h.zone === 'head' || sum.zone === 'limb') sum.zone = h.zone;
    } else if (this.pellets) this.pellets.set(t, h);
    else this.hitFeedback(h);
  }

  /** Hit marker, sound, damage number and readout for one hit (or one shotgun shell's worth). */
  private hitFeedback(r: HitFeedback) {
    const { zone, head, dist, p, dir, wallbang } = r;
    const m = `${Math.round(dist)} m`;
    if (r.steel) {
      // The ding arrives after the sound travels back; the marker is instant so you know you connected.
      this.sfx.steel(dist);
      this.hud.hit('steel');
      this.hud.info(`${head ? 'HIGH HIT' : 'HIT'} · ${m}`, head ? 'head' : '');
      this.fx.impact(p, dir.clone().negate(), 'steel');
      return;
    }
    this.hud.damageNumber(p, r.dealt, head);
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

  /** Pulls the camera back over your right shoulder (by `tp`), stopping short of walls. */
  private camera3p(dt: number) {
    const p = this.player, cam = this.renderer.camera;
    if (this.tp <= 0.001) return;
    const sky = p.skydive !== 'none';
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const dist = sky ? 5.5 : p.stance === 'slide' ? 2.2 : 2.5, side = sky ? 0 : 0.55, up = sky ? 0.6 : 0.22;
    // Back along the look direction, out to the right, a little up.
    const off = new Vector3(sy * cp * dist + cy * side, -sp * dist + up, cy * cp * dist - sy * side);
    const len = off.length();
    off.divideScalar(len);
    const hit = this.world.colliders.raycast(this.eyePos, off, len + 0.3);
    const allowed = hit ? Math.max(0.25, hit.t - 0.3) : len;
    // Snap in when a wall gets close, ease back out afterwards.
    this.camDist = allowed < this.camDist || dt === 0 ? allowed : damp(this.camDist, allowed, 5, dt);
    cam.position.addScaledVector(off, this.camDist * this.tp);
  }

  /** Poses your character and keeps the gun in its hands in step with the weapon you hold. */
  private syncBody(dt: number) {
    const p = this.player, w = this.weapons, b = this.body, m = this.match;
    const plane = !!m && m.inPlane;
    b.root.visible = !plane;
    if (plane) return;
    const g = w.current, key = g.base === 'hands' ? 'hands' : `${g.base}:${g.rarity}`;
    if (key !== this.bodyGun) {
      this.bodyGun = key;
      b.setGun(g.base === 'hands' ? null : this.worldGun(g.base, g.rarity), g.base === 'hands' ? 'hands' : g.base);
    }
    // In first person the body stands a little behind the camera, so looking down shows your legs rather than the inside of your head.
    const fp = 1 - this.tp, back = 0.14 * fp;
    b.root.position.set(p.pos.x + Math.sin(p.yaw) * back, p.pos.y, p.pos.z + Math.cos(p.yaw) * back);
    b.root.rotation.y = p.yaw + Math.PI;
    b.firstPerson = this.tp < FP_SWITCH;
    const kick = w.shots !== this.shotsSeen ? 1 : 0;
    this.shotsSeen = w.shots;
    b.update(dt, {
      vx: p.vel.x, vz: p.vel.z, yaw: p.yaw + Math.PI, pitch: p.pitch, grounded: p.onGround && !p.mantling,
      sprint: p.sprinting, crouch: p.stance === 'crouch', slide: p.stance === 'slide', ads: w.ads,
      sky: p.skydive, reload: w.reloadProgress, kick,
    });
    b.canopy.visible = p.skydive === 'chute' && this.tp >= FP_SWITCH;
  }

  /** A world-lit copy of a gun model in its rarity colour (cached). */
  private worldGun(id: GunId, rarity: number) {
    const key = `${id}:${rarity}`;
    let src = this.gunMats.get(key);
    if (!src) {
      const r = RARITY[rarity as 0];
      const accent = new MeshStandardMaterial({ color: r.color === '#b9bec4' ? TAN : r.color, roughness: rarity === 4 ? 0.3 : 0.7, metalness: rarity === 4 ? 0.85 : 0 });
      if (r.color !== '#b9bec4' && rarity < 4) accent.color.multiplyScalar(0.75);
      src = buildGunMesh(id, accent);
      // The view model's materials aren't set up for the world's cascaded shadows: give this copy its own.
      const copies = new Map<Material, Material>();
      src.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as Material;
        let c = copies.get(mat);
        if (!c) { c = this.renderer.setupMaterial(mat.clone()); copies.set(mat, c); }
        mesh.material = c;
      });
      this.gunMats.set(key, src);
    }
    return src.clone();
  }

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.running && this.ready) this.step(dt);
    this.renderer.render();
    this.input.endFrame();
  }

  /** One simulation frame. Public so tests can drive the game with fixed time steps. */
  step(dt: number) {
    const input = this.input, p = this.player, w = this.weapons, cam = this.renderer.camera;
    // Mouse look (degrees per count like CS, scaled down while zoomed so tracking feels the same).
    const vBase = this.baseVFov();
    const zoomRatio = Math.tan((this.fov * DEG) / 2) / Math.tan((vBase * DEG) / 2);
    // Separate multipliers for the sniper scope and for red dots / iron sights.
    const adsMul = w.def.scope ? this.settings.scopeSens : this.settings.adsSens;
    const adsScale = 1 + (zoomRatio * adsMul - 1) * w.ads;
    const k = 0.022 * this.settings.sens * DEG * adsScale;
    p.look(input.mouseDX * k, input.mouseDY * k);

    const m = this.match, plane = !!m && m.inPlane, sky = p.skydive !== 'none';
    if (!plane) p.update(dt, input);
    w.blocked = !!m && m.blocksWeapons;
    if (input.wasPressed('KeyV')) {
      this.settings.view = this.settings.view === 'third' ? 'first' : 'third';
      saveSettings(this.settings);
      this.hud.info(this.settings.view === 'third' ? 'THIRD PERSON' : 'FIRST PERSON');
    }
    this.tpK = damp(this.tpK, this.settings.view === 'third' ? 1 : 0, 7, dt);
    // Aiming down sights always looks through the sights in first person.
    // The camera moves in to the eye over the first part of the aim so the sight is up by the time it gets there.
    this.tp = plane ? 0 : this.tpK * (1 - smoothstep(0, 0.6, w.ads));
    w.hidden = plane || (sky && this.tp < FP_SWITCH) || this.tp >= FP_SWITCH;
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
    // Landing dip on a spring, gentle head bob, slide roll and a little strafe lean. Everything eases in and out.
    this.landV += (-80 * this.landDip - 11 * this.landV) * dt;
    this.landDip += this.landV * dt;
    if (p.onGround && p.moving && p.stance !== 'slide') this.bob += dt * p.horizSpeed * 1.9;
    this.bobAmp = damp(this.bobAmp, p.onGround && p.stance !== 'slide' ? clamp(p.horizSpeed / 6, 0, 1.2) : 0, 6, dt);
    const fp = 1 - this.tp, bobAmp = this.bobAmp * (1 - w.ads * 0.9) * 0.022 * fp;
    const sideVel = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw);
    this.roll = damp(this.roll, (-p.slideT * 0.07 - clamp(sideVel / 7, -1, 1) * 0.012 * (1 - w.ads)) * fp, 8, dt);
    this.eyePos.set(p.pos.x, p.pos.y + p.eye + this.landDip * fp, p.pos.z);
    if (plane) m!.planeCamera(cam.position);
    else {
      cam.position.copy(this.eyePos);
      cam.position.y += Math.abs(Math.sin(this.bob)) * bobAmp;
      this.camera3p(dt);
    }
    cam.rotation.set(p.pitch + w.punch + w.breathPitch, p.yaw + w.breathYaw + Math.sin(this.bob * 0.5) * bobAmp * 0.15, this.roll, 'YXZ');
    this.syncBody(dt);

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
    this.hud.crosshair(w.crosshairSpread, this.fov, crossVis, dt);
    const g = w.current;
    this.hud.magArc(w.onHands ? -1 : g.mag, g.def.mag, w.reloadProgress, plane || sky || w.scoped ? 0 : (1 - w.ads * 0.55) * (1 - w.lower) * (p.sprinting ? 0.35 : 1), dt);
    this.hud.setScope(w.scoped);
    this.hud.setMove(p.horizSpeed, p.mantling ? 'mantle' : p.tacSprinting ? 'tac sprint' : p.sprinting ? 'sprint' : p.stance, p.lastSlide);
    this.hud.setTac(p.tacFraction, p.tacSprinting);
    this.hud.update(dt, cam);
  }
}
