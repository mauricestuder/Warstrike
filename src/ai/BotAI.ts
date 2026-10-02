import { Vector3 } from 'three';
import { clamp } from '../core/math';
import type { Game } from '../Game';
import type { Match } from '../br/Match';
import type { LootItem } from '../br/Loot';
import { Player, type Controls } from '../player/Player';
import type { Bot, Zone as HitZone } from '../targets/Targets';
import { falloffMul, GUNS, HANDS, rarityDef, type GunDef, type GunId, type Rarity } from '../weapons/defs';
import { Nav } from './Nav';

/** Who a bot can fight: the player or another bot. */
export type Foe = Bot | 'player';

const DEG = Math.PI / 180;
/** Bots shoot you a little softer than the numbers on the gun (they don't get headshot multipliers as often either). */
const DMG_TO_PLAYER = 0.9;
/** Bot-on-bot fights are slower, so most of the lobby is still around when you get there. */
const DMG_TO_BOT = 0.33;
const SIGHT = 115, SIGHT_SNIPER = 160, FOV_HALF = 75 * DEG;
/** How far each gun is willing to fight, and the distance it likes to fight at. */
const RANGE: Record<GunId | 'hands', [number, number]> = { smg: [50, 11], ar: [115, 24], sniper: [180, 55], hands: [14, 1.2] };
/** Bots fire a bit slower than the real cyclic rate and in bursts. */
const BURST: Record<GunId, [number, number, number]> = { ar: [3, 7, 1.3], smg: [4, 9, 1.25], sniper: [1, 1, 1.15] };
/** How far away a gunshot draws attention. */
export const HEARING = 70;

class VirtualControls implements Controls {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  isDown(c: string) { return this.down.has(c); }
  wasPressed(c: string) { return this.pressed.has(c); }
  hold(c: string, on: boolean) { if (on) this.down.add(c); else this.down.delete(c); }
  tap(c: string) { this.pressed.add(c); this.down.add(c); }
}

interface BotGun { id: GunId; rarity: Rarity; def: GunDef; mag: number; }

const tA = new Vector3(), tB = new Vector3(), tC = new Vector3(), tD = new Vector3(), tE = new Vector3();

/** Ray vs axis-aligned box; entry distance or -1. */
function slab(o: Vector3, d: Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number) {
  let tmin = 0, tmax = maxT;
  const lo = [x0, y0, z0], hi = [x1, y1, z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < lo[i] || oo[i] > hi[i]) return -1; continue; }
    let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

/**
 * One bot's mind. It rides the plane, skydives toward a spot with loot, runs to the nearest gun, then roams, follows
 * the circle, hunts what it heard, and fights: strafing, keeping its preferred range, firing in bursts, reloading,
 * backing off to heal when it's hurt. It moves with the same movement code as you (so it steps, jumps and mantles).
 */
class Brain {
  readonly mover: Player;
  readonly ctl = new VirtualControls();
  state: 'plane' | 'sky' | 'ground' = 'plane';
  gun: BotGun | null = null;
  /** 0..1: aim, reaction speed and awareness. */
  readonly skill = 0.25 + Math.random() * 0.75;
  jumpS = 0;
  landing = new Vector3();
  // Navigation.
  path: Vector3[] = [];
  goal: Vector3 | null = null;
  goalKind: 'loot' | 'roam' | 'zone' | 'hunt' | 'cover' | 'none' = 'none';
  goalItem: LootItem | null = null;
  thinkT = Math.random() * 0.5;
  repathT = 0;
  stuckT = 0;
  readonly stuckFrom = new Vector3();
  groundT = 0;
  // Combat.
  target: Foe | null = null;
  visible = false;
  seenT = 0;
  readonly lastSeen = new Vector3();
  lastSeenAt = -99;
  lookT = Math.random() * 0.2;
  reaction = 0.4;
  cooldown = 0;
  burstLeft = 0;
  reloadT = 0;
  strafe = 1;
  strafeT = 0;
  heard: { pos: Vector3; t: number } | null = null;
  hurtFrom: Foe | null = null;

  constructor(readonly bot: Bot, ai: BotAI) {
    this.mover = new Player(ai.colliders, {
      step: (sprint) => ai.footstep(this.bot, sprint), jump: () => {}, land: () => {}, slide: () => {}, mantle: () => {},
    });
    this.mover.speedMul = 0.95;
    this.mover.sprintMul = 0.95;
  }

  get pos() { return this.mover.pos; }
  get armed() { return !!this.gun; }
}

/**
 * The battle royale bots: their navigation grid, their brains, and everything they do to each other and to you.
 * The match calls `update` once a frame.
 */
export class BotAI {
  readonly nav: Nav;
  readonly brains: Brain[] = [];
  private time = 0;
  private whizT = 0;
  private claimed = new Set<LootItem>();
  private thinkBudget = 1;
  /** Recent gunfire close to you, shown as red dots on the minimap: position and seconds left. */
  readonly pings: { pos: Vector3; life: number }[] = [];

  constructor(private g: Game, private m: Match) {
    const b = g.world.bounds!;
    this.nav = new Nav(g.world.colliders, b.x0, b.z0, b.x1, b.z1);
    const pl = m.plane, span = pl.exitS - 30 - (pl.enterS + 10);
    g.targets.bots.forEach((bot, i) => {
      bot.driven = true;
      bot.hidden = true;
      const br = new Brain(bot, this);
      // Spread the jumps along the flight, a little random so they don't leave in a perfect line.
      br.jumpS = pl.enterS + 10 + span * ((i + 0.2 + Math.random() * 0.6) / g.targets.bots.length);
      this.brains.push(br);
    });
  }

  get colliders() { return this.g.world.colliders; }

  brainOf(bot: Bot) { return this.brains.find((b) => b.bot === bot)!; }

  /** The gun a bot is carrying (dropped when it dies). */
  gunOf(bot: Bot): { id: GunId; rarity: Rarity; mag: number } | null {
    const b = this.brainOf(bot);
    return b?.gun ? { id: b.gun.id, rarity: b.gun.rarity, mag: b.gun.mag } : null;
  }

  /** Something shot at this bot: it knows where from and turns to fight. */
  attacked(bot: Bot, by: Foe) {
    const b = this.brainOf(bot);
    if (!b || b.state !== 'ground' || !bot.alive) return;
    b.hurtFrom = by;
    if (!b.target || b.target === by || !b.visible) {
      if (b.target !== by) { b.seenT = 0; b.reaction = this.reactionFor(b) + 0.15; }
      b.target = by;
      this.foeChest(by, b.lastSeen);
      b.lastSeenAt = this.time;
    }
  }

  /** A gunshot at `pos`: bots in earshot remember where it came from. */
  noise(pos: Vector3, radius: number, from: Foe) {
    for (const b of this.brains) {
      if (b.state !== 'ground' || !b.bot.alive || b.bot === from) continue;
      if (b.pos.distanceToSquared(pos) > radius * radius) continue;
      b.heard = { pos: pos.clone(), t: this.time };
    }
  }

  footstep(bot: Bot, sprint: boolean) {
    const cam = this.g.renderer.camera;
    this.g.sfx.stepAt(bot.position, cam.position, this.g.player.yaw, sprint);
  }

  // --------------------------------------------------------------------------------------------- per frame

  /** Empties a dead bot's hands (its gun has been dropped). */
  disarm(bot: Bot) {
    const b = this.brainOf(bot);
    if (b) b.gun = null;
    bot.holdGun(null);
  }

  update(dt: number) {
    this.time += dt;
    this.whizT -= dt;
    // Path finding is the expensive part: at most one bot gets to plan per frame.
    this.thinkBudget = 1;
    for (let i = this.pings.length - 1; i >= 0; i--) if ((this.pings[i].life -= dt) <= 0) this.pings.splice(i, 1);
    for (const b of this.brains) {
      const bot = b.bot;
      if (!bot.alive) { b.ctl.down.clear(); this.unclaim(b); continue; }
      if (b.state === 'plane') this.inPlane(b);
      else if (b.state === 'sky') this.inSky(b, dt);
      else this.onGround(b, dt);
      b.ctl.pressed.clear();
      bot.position.copy(b.pos);
      bot.yaw = b.mover.yaw + Math.PI;
      bot.moveSpeed = b.mover.onGround ? b.mover.horizSpeed : 0;
      bot.chute = b.mover.skydive === 'chute';
    }
  }

  private inPlane(b: Brain) {
    const pl = this.m.plane;
    if (pl.s < b.jumpS && !pl.done) return;
    pl.rampPosition(b.pos);
    b.pos.x += (Math.random() - 0.5) * 3;
    b.pos.z += (Math.random() - 0.5) * 3;
    b.mover.vel.copy(pl.velocity).multiplyScalar(0.6);
    b.mover.skydive = 'freefall';
    b.mover.onGround = false;
    b.mover.area = this.g.world.bounds!;
    b.state = 'sky';
    b.bot.hidden = false;
    // Aim for the most loot-rich of a few spots within gliding reach.
    let best: Vector3 | null = null, bestScore = -1;
    for (let i = 0; i < 7; i++) {
      const c = this.nav.randomIn(b.pos.x, b.pos.z, 120, Math.random);
      if (!c || this.m.zone.outside(c.x, c.z) > -10) continue;
      let score = Math.random() * 2;
      for (const it of this.m.loot.items) if (it.kind === 'gun' && !it.taken && it.pos.distanceToSquared(c) < 400) score += 1 + it.rarity * 0.3;
      // Spread out: nobody wants to land on top of someone else.
      for (const o of this.brains) if (o !== b && o.state !== 'plane' && o.landing.distanceToSquared(c) < 45 * 45) score -= 4;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    b.landing.copy(best ?? this.nav.randomIn(b.pos.x, b.pos.z, 120, Math.random) ?? this.nav.randomAnywhere(Math.random));
  }

  private inSky(b: Brain, dt: number) {
    const mv = b.mover, dx = b.landing.x - b.pos.x, dz = b.landing.z - b.pos.z, d = Math.hypot(dx, dz);
    mv.yaw = Math.atan2(-dx, -dz);
    b.ctl.hold('KeyW', d > 2.5);
    // Dive when the spot is below; glide flat when it's still far away.
    mv.pitch = mv.skydive === 'freefall' && d < Math.max(20, mv.altitude * 0.55) ? -1.2 : 0;
    mv.update(dt, b.ctl);
    if (mv.skydive === 'none') {
      b.state = 'ground';
      b.ctl.down.clear();
      b.thinkT = 0.3 + Math.random() * 0.4;
    }
  }

  // --------------------------------------------------------------------------------------------- on the ground

  private onGround(b: Brain, dt: number) {
    const bot = b.bot, mv = b.mover, z = this.m.zone;
    b.groundT += dt;
    // Health comes back after a few quiet seconds, like yours.
    if (bot.sinceHit > 5) bot.heal(22 * dt);
    if (!b.gun && b.groundT > 32) this.giveGun(b, Math.random() < 0.7 ? 0 : 1);
    if (b.reloadT > 0) {
      b.reloadT -= dt;
      if (b.reloadT <= 0 && b.gun) b.gun.mag = b.gun.def.mag;
    }
    b.cooldown -= dt;

    // --- Perception ---
    b.lookT -= dt;
    if (b.lookT <= 0) {
      b.lookT = 0.14 + Math.random() * 0.08;
      this.perceive(b);
    }
    if (b.target && !this.foeAlive(b.target)) { b.target = null; b.visible = false; }
    if (b.visible) b.seenT += dt;

    // --- Decide where to go ---
    b.thinkT -= dt;
    b.repathT -= dt;
    if (b.thinkT <= 0 && this.thinkBudget > 0) {
      this.thinkBudget--;
      b.thinkT = 0.6 + Math.random() * 0.4;
      this.think(b);
    }

    // --- Move and look ---
    const fighting = !!b.target && b.visible && (b.armed || this.foeDist(b, b.target) < RANGE.hands[0]);
    const gunR = RANGE[b.gun?.id ?? 'hands'];
    let mx = 0, mz = 0, sprint = false;
    // Follow the path.
    while (b.path.length && Math.hypot(b.path[0].x - b.pos.x, b.path[0].z - b.pos.z) < 0.55) b.path.shift();
    if (b.path.length) {
      mx = b.path[0].x - b.pos.x; mz = b.path[0].z - b.pos.z;
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const far = b.goal ? Math.hypot(b.goal.x - b.pos.x, b.goal.z - b.pos.z) : 0;
      sprint = !fighting && (b.goalKind === 'zone' || b.goalKind === 'loot' || b.goalKind === 'cover' || far > 25);
    } else if (b.goal) this.arrive(b);
    const urgent = b.goalKind === 'zone' && z.outside(b.pos.x, b.pos.z) > -3;
    let lookYaw: number | null = null;
    if (b.target && (b.visible || this.time - b.lastSeenAt < 2.5)) {
      // Face the target (or where it was last seen).
      const tp = b.visible ? this.foeChest(b.target, tA) : b.lastSeen;
      lookYaw = Math.atan2(-(tp.x - b.pos.x), -(tp.z - b.pos.z));
      if (fighting && !urgent && b.goalKind !== 'cover') {
        // Combat movement: strafe, and close in or back off toward the preferred range.
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = Math.random() < 0.15 ? 0 : Math.random() < 0.5 ? -1 : 1; b.strafeT = 0.35 + Math.random() * 0.9; }
        const d = this.foeDist(b, b.target), fx = -Math.sin(lookYaw), fz = -Math.cos(lookYaw);
        const rx = Math.cos(lookYaw), rz = -Math.sin(lookYaw);
        const toward = !b.armed ? 1 : d > gunR[1] * 1.5 ? 1 : d < gunR[1] * 0.55 ? -1 : 0;
        mx = fx * toward + rx * b.strafe * (b.armed ? 1 : 0.4);
        mz = fz * toward + rz * b.strafe * (b.armed ? 1 : 0.4);
        // Don't strafe off a ledge, into the water or the gas.
        if ((mx || mz) && (!this.nav.walkableAt(b.pos.x + mx * 1.1, b.pos.z + mz * 1.1) || z.outside(b.pos.x + mx * 3, b.pos.z + mz * 3) > 0)) {
          b.strafe = -b.strafe;
          mx = fx * toward; mz = fz * toward;
          if (toward && !this.nav.walkableAt(b.pos.x + mx * 1.1, b.pos.z + mz * 1.1)) mx = mz = 0;
        }
        // Snipers plant their feet to line up the shot.
        if (b.gun?.id === 'sniper' && d > 20) { mx = mz = 0; }
        sprint = !b.armed && d > 5;
        if (b.gun?.id !== 'sniper' && Math.random() < dt * 0.25 * b.skill && mv.onGround) b.ctl.tap('Space');
      }
    }
    if (lookYaw === null && (mx || mz)) lookYaw = Math.atan2(-mx, -mz);
    if (lookYaw !== null) {
      let dy = lookYaw - mv.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = (fighting ? 7 + b.skill * 5 : 6) * dt;
      mv.yaw += clamp(dy, -rate, rate);
    }
    // World direction → W/A/S/D relative to where the bot faces.
    const fx = -Math.sin(mv.yaw), fz = -Math.cos(mv.yaw), rx = Math.cos(mv.yaw), rz = -Math.sin(mv.yaw);
    const ml = Math.hypot(mx, mz);
    const f = ml ? (mx * fx + mz * fz) / ml : 0, s = ml ? (mx * rx + mz * rz) / ml : 0;
    b.ctl.hold('KeyW', f > 0.38);
    b.ctl.hold('KeyS', f < -0.38);
    b.ctl.hold('KeyD', s > 0.38);
    b.ctl.hold('KeyA', s < -0.38);
    b.ctl.hold('ShiftLeft', sprint && f > 0.7);
    mv.sprintBlocked = fighting && b.armed;

    // Stuck on something: hop (which also mantles), then try another route.
    if (ml > 0) {
      b.stuckT += dt;
      if (b.stuckT > 0.8) {
        const moved = Math.hypot(b.pos.x - b.stuckFrom.x, b.pos.z - b.stuckFrom.z);
        if (moved < 0.45) {
          b.ctl.tap('Space');
          if (b.stuckT > 2.4) { b.path = []; b.goal = null; b.goalKind = 'none'; b.thinkT = 0; b.stuckT = 0; b.stuckFrom.copy(b.pos); }
        } else { b.stuckT = 0; b.stuckFrom.copy(b.pos); }
      }
    } else { b.stuckT = 0; b.stuckFrom.copy(b.pos); }

    mv.update(dt, b.ctl);
    if (mv.pos.y < -5) { const p = this.nav.randomAnywhere(Math.random); mv.spawn(p, mv.yaw); }

    // --- Shoot ---
    if (fighting) this.attack(b);
  }

  /** Finds the best foe in sight. */
  private perceive(b: Brain) {
    const eye = b.bot.eye(tB), fwdX = -Math.sin(b.mover.yaw), fwdZ = -Math.cos(b.mover.yaw);
    const sight = b.gun?.id === 'sniper' ? SIGHT_SNIPER : SIGHT;
    let best: Foe | null = null, bestScore = Infinity;
    const consider = (f: Foe) => {
      if (!this.foeAlive(f)) return;
      // Without a gun, a bot only squares up to you (or whoever hit it); other bots it avoids.
      if (!b.gun && f !== 'player' && f !== b.hurtFrom) return;
      // Fresh off the plane, bots are busy looting and leave each other alone unless shot at.
      if (f !== 'player' && f !== b.hurtFrom && b.groundT < 55 + b.skill * 20) return;
      const c = this.foeChest(f, tC), d = c.distanceTo(eye);
      const isPlayer = f === 'player';
      // Only two bots fight you at a time (unless you shoot the others); the rest stay busy with each other.
      if (isPlayer && f !== b.hurtFrom && !(b.target === 'player' && b.visible) && this.onPlayer(b) >= 2) return;
      // Bots mostly leave each other alone at range (keeps them from wiping each other out before you land).
      let range = sight * (isPlayer ? 1 : 0.38);
      // Rotating to the circle: only bots that get close are worth the trouble.
      if (!isPlayer && b.goalKind === 'zone' && f !== b.hurtFrom) range = Math.min(range, 22);
      if (isPlayer && this.g.player.stance !== 'stand') range *= 0.75;
      const known = f === b.target && this.time - b.lastSeenAt < 3;
      if (d > range && !known) return;
      const ang = Math.acos(clamp(((c.x - eye.x) * fwdX + (c.z - eye.z) * fwdZ) / Math.max(0.01, Math.hypot(c.x - eye.x, c.z - eye.z)), -1, 1));
      if (ang > FOV_HALF && d > 7 && !known && f !== b.hurtFrom) return;
      tD.subVectors(c, eye).normalize();
      if (this.colliders.raycast(eye, tD, d - 0.3)) {
        // Chest hidden; try the head (someone peeking over cover).
        const h = this.foeHead(f, tC);
        const dh = h.distanceTo(eye);
        tD.subVectors(h, eye).normalize();
        if (this.colliders.raycast(eye, tD, dh - 0.2)) return;
      }
      const score = d * (f === b.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = f; }
    };
    consider('player');
    for (const o of this.brains) if (o !== b && o.state === 'ground') consider(o.bot);
    if (best) {
      if (best !== b.target || !b.visible) {
        if (best !== b.target || this.time - b.lastSeenAt > 1.5) { b.seenT = 0; b.reaction = this.reactionFor(b); }
        b.target = best;
      }
      b.visible = true;
      this.foeChest(best, b.lastSeen);
      b.lastSeenAt = this.time;
    } else {
      b.visible = false;
      b.seenT = 0;
      if (b.target && this.time - b.lastSeenAt > 9) b.target = null;
    }
  }

  /** How many other bots are currently fighting you. */
  private onPlayer(self: Brain) {
    let n = 0;
    for (const o of this.brains) if (o !== self && o.bot.alive && o.target === 'player' && this.time - o.lastSeenAt < 4) n++;
    return n;
  }

  private reactionFor(b: Brain) { return 0.28 + (1 - b.skill) * 0.45 + Math.random() * 0.25; }

  /** Chooses where to go next. */
  private think(b: Brain) {
    const z = this.m.zone, pos = b.pos, rnd = Math.random;
    const set = (kind: Brain['goalKind'], p: Vector3 | null, item: LootItem | null = null) => {
      if (!p) return false;
      const path = this.nav.path(pos, p);
      if (!path) return false;
      this.unclaim(b);
      if (item) this.claimed.add(item);
      b.goal = p; b.goalKind = kind; b.goalItem = item; b.path = path; b.repathT = 4;
      return true;
    };
    // Off the walkable grid (a roof, a crate): head for the nearest ground.
    if (!this.nav.walkableAt(pos.x, pos.z)) {
      const n = this.nav.nearest(pos.x, pos.z, 14);
      if (n) { b.goal = n; b.goalKind = 'none'; b.path = [n]; }
      return;
    }
    // Re-plan the current route now and then (things move, bots get shoved).
    if (b.goal && b.repathT <= 0) {
      const path = this.nav.path(pos, b.goal);
      if (path) { b.path = path; b.repathT = 4; } else { b.goal = null; b.path = []; }
    }
    // 1. The gas: get inside the next circle when it's coming (or already here).
    const st = z.state, next = z.next;
    const outNow = z.outside(pos.x, pos.z) > -4;
    const outNext = Math.hypot(pos.x - next.c.x, pos.z - next.c.y) > next.r * 0.9;
    const moving = st.stage === 'shrink' || (st.stage === 'wait' && st.left < 30 - b.skill * 15);
    if ((outNow || (outNext && moving)) && b.goalKind !== 'zone') {
      const r = Math.max(2, (moving || outNow ? next.r : z.radius) * 0.8);
      if (set('zone', this.nav.randomIn(next.c.x, next.c.y, r, rnd))) return;
    }
    if (b.goalKind === 'zone' && b.goal) return;
    // 2. Hurt and in a fight: break line of sight and heal.
    if (b.armed && b.target && b.visible && b.bot.total < 55 && b.goalKind !== 'cover' && rnd() < 0.6) {
      if (set('cover', this.coverFrom(b, b.lastSeen))) return;
    }
    if (b.goalKind === 'cover') {
      if (b.bot.health < 95 && b.goal) return;
      b.goal = null; b.goalKind = 'none'; b.path = [];
    }
    // 3. No gun: run for the closest one nobody else is going for.
    if (!b.armed) {
      if (b.goalKind === 'loot' && b.goalItem && !b.goalItem.taken) return;
      const it = this.closestGun(b, 70, -1);
      if (it && set('loot', it.pos.clone(), it)) return;
      if (!b.goal) set('roam', this.nav.randomIn(pos.x, pos.z, 35, rnd));
      return;
    }
    // 4. Lost sight of someone: go to where they were.
    if (b.target && !b.visible && this.time - b.lastSeenAt < 8 && b.goalKind !== 'hunt' && b.bot.total > 70) {
      if (set('hunt', b.lastSeen.clone())) return;
    }
    if (b.visible) return;
    // 5. Heard a fight: some bots go and look, the rest carry on.
    if (b.heard && this.time - b.heard.t < 6 && b.goalKind !== 'hunt' && b.bot.total > 80) {
      const h = b.heard.pos;
      b.heard = null;
      if (rnd() < 0.2 + b.skill * 0.4 && h.distanceTo(pos) < 55 && z.outside(h.x, h.z) < 0 && set('hunt', this.nav.randomIn(h.x, h.z, 6, rnd))) return;
    }
    // 6. A better gun nearby.
    if (b.goalKind !== 'loot' || !b.goalItem || b.goalItem.taken) {
      const it = this.closestGun(b, 28, b.gun!.rarity);
      if (it && set('loot', it.pos.clone(), it)) return;
    } else return;
    // 7. Wander somewhere inside the circle.
    if (!b.goal || b.goalKind === 'hunt' && !b.path.length) {
      const c = st.stage === 'wait' ? { x: z.center.x, y: z.center.y, r: z.radius } : { x: next.c.x, y: next.c.y, r: next.r };
      const ang = rnd() * Math.PI * 2, d = 15 + rnd() * 40;
      let px = pos.x + Math.cos(ang) * d, pz = pos.z + Math.sin(ang) * d;
      if (Math.hypot(px - c.x, pz - c.y) > c.r * 0.85) { px = c.x + (px - c.x) * 0.5; pz = c.y + (pz - c.y) * 0.5; }
      set('roam', this.nav.randomIn(px, pz, 6, rnd));
    }
  }

  /** Reached the goal: grab the gun if it's still there. */
  private arrive(b: Brain) {
    const it = b.goalItem;
    if (b.goalKind === 'loot' && it && !it.taken && Math.hypot(it.pos.x - b.pos.x, it.pos.z - b.pos.z) < 1.8 && it.kind === 'gun') {
      it.taken = true;
      if (b.gun) this.m.loot.spawnGun(b.pos.clone().setY(b.pos.y + 0.2), b.gun.id, b.gun.rarity, new Vector3(0, 2, 0), b.gun.mag);
      this.equip(b, it.gun!, it.rarity, it.amount);
    }
    if (b.goalKind !== 'cover') { b.goal = null; b.goalKind = 'none'; }
    this.unclaim(b);
    b.goalItem = null;
    b.thinkT = Math.min(b.thinkT, 0.3);
  }

  private unclaim(b: Brain) { if (b.goalItem) this.claimed.delete(b.goalItem); }

  private equip(b: Brain, id: GunId, rarity: Rarity, mag: number) {
    b.gun = { id, rarity, def: rarityDef(id, rarity), mag: mag > 0 ? mag : GUNS[id].mag };
    b.bot.holdGun(this.m.loot.gunModel(id, rarity));
  }

  private giveGun(b: Brain, rarity: Rarity) {
    const id = (['ar', 'smg', 'sniper', 'ar', 'smg'] as GunId[])[Math.floor(Math.random() * 5)];
    this.equip(b, id, rarity, GUNS[id].mag);
  }

  private closestGun(b: Brain, maxD: number, better: number): LootItem | null {
    let best: LootItem | null = null, bd = maxD;
    for (const it of this.m.loot.items) {
      if (it.kind !== 'gun' || it.taken || it.vel || this.claimed.has(it) || it.rarity <= better) continue;
      // Only things on the ground floor are reachable.
      const fl = this.nav.nearest(it.pos.x, it.pos.z, 1);
      if (!fl || Math.abs(fl.y - it.pos.y) > 0.6) continue;
      const d = Math.hypot(it.pos.x - b.pos.x, it.pos.z - b.pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** A nearby spot that the enemy at `from` can't see. */
  private coverFrom(b: Brain, from: Vector3): Vector3 | null {
    let best: Vector3 | null = null, bd = Infinity;
    for (let i = 0; i < 14; i++) {
      const p = this.nav.randomIn(b.pos.x, b.pos.z, 14, Math.random);
      if (!p) continue;
      tA.set(p.x, p.y + 1.3, p.z);
      const d = from.distanceTo(tA);
      tD.subVectors(tA, from).normalize();
      if (!this.colliders.raycast(from, tD, d - 0.3)) continue;
      const cost = p.distanceTo(b.pos) - Math.min(d, 30) * 0.2;
      if (cost < bd) { bd = cost; best = p; }
    }
    return best;
  }

  // --------------------------------------------------------------------------------------------- shooting

  private attack(b: Brain) {
    const t = b.target!, eye = b.bot.eye(tB), chest = this.foeChest(t, tC), d = chest.distanceTo(eye);
    // Must be roughly facing it and past the reaction time.
    const want = Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z));
    const off = Math.abs(Math.atan2(Math.sin(want - b.mover.yaw), Math.cos(want - b.mover.yaw)));
    if (off > 0.2 || b.seenT < b.reaction || b.cooldown > 0) return;
    if (!b.gun) {
      // Fists.
      if (d > 2.2) return;
      b.cooldown = 0.75 + Math.random() * 0.3;
      this.g.sfx.punchAt(b.bot.position, this.g.renderer.camera.position, this.g.player.yaw);
      this.hit(b, t, HANDS, 'body', d, chest);
      return;
    }
    const gun = b.gun, def = gun.def;
    if (b.reloadT > 0) return;
    if (gun.mag <= 0) { b.reloadT = def.reloadEmpty * 1.1; return; }
    if (d > RANGE[gun.id][0]) return;
    const [bmin, bmax, slow] = BURST[gun.id];
    if (b.burstLeft <= 0) b.burstLeft = bmin + Math.floor(Math.random() * (bmax - bmin + 1));
    gun.mag--;
    b.burstLeft--;
    b.cooldown = (60 / def.rpm) * slow;
    if (b.burstLeft <= 0) b.cooldown += gun.id === 'sniper' ? 0.5 + Math.random() * 0.7 : 0.15 + Math.random() * 0.3 + (1 - b.skill) * 0.2;

    // Aim: chest, sometimes the head; error shrinks as it tracks you and grows when you move.
    const headshot = Math.random() < 0.1 + b.skill * 0.12;
    const aim = headshot ? this.foeHead(t, tA) : tA.copy(chest);
    const vel = t === 'player' ? this.g.player.vel : this.brainOf(t).mover.vel;
    const dirX = (aim.x - eye.x) / d, dirZ = (aim.z - eye.z) / d;
    const lateral = Math.abs(vel.x * dirZ - vel.z * dirX);
    const track = Math.max(0, 1 - (b.seenT - b.reaction) / 1.3);
    let sigma = (0.6 + 1.5 * (1 - b.skill)) * DEG;
    sigma *= (1 + 1.5 * track) * (1 + lateral / 6) * (b.mover.horizSpeed > 1 ? 1.25 : 1) * (b.mover.onGround ? 1 : 1.6);
    sigma *= gun.id === 'sniper' ? 0.45 : gun.id === 'smg' ? 1.2 : 1;
    const dir = tD.subVectors(aim, eye).normalize();
    const right = new Vector3(dir.z, 0, -dir.x).normalize(), up = new Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, Math.tan(sigma * gauss())).addScaledVector(up, Math.tan(sigma * gauss())).normalize();

    const range = RANGE[gun.id][0] * 1.3;
    const wall = this.colliders.raycast(eye, dir, range);
    const maxT = wall ? wall.t : range;
    const muzzle = b.bot.muzzle(new Vector3());
    let hitT = -1, zone: HitZone = 'body';
    if (t === 'player') { const r = this.playerRay(eye, dir, maxT); if (r) { hitT = r.t; zone = r.zone; } }
    else { const r = t.raycast(eye, dir, maxT); if (r) { hitT = r.t; zone = r.zone; } }
    const end = eye.clone().addScaledVector(dir, hitT >= 0 ? hitT : maxT);
    const cam = this.g.renderer.camera.position;
    const near = muzzle.distanceToSquared(cam) < 90 * 90;
    this.g.fx.tracer(muzzle, end, gun.id === 'sniper' ? 0.02 : 0.014, gun.id === 'sniper' ? 0.08 : 0.05, 0xffc078);
    if (near) this.g.fx.muzzle(muzzle);
    this.g.sfx.shotAt(gun.id, muzzle, cam, this.g.player.yaw);
    this.noise(eye, HEARING, b.bot);
    if (b.pos.distanceToSquared(this.g.player.pos) < 90 * 90) {
      const pg = this.pings.find((q) => q.pos.distanceToSquared(b.pos) < 9);
      if (pg) { pg.pos.copy(b.pos); pg.life = 2; } else this.pings.push({ pos: b.pos.clone(), life: 2 });
    }
    if (hitT >= 0) {
      this.hit(b, t, def, zone, hitT, end);
    } else {
      if (wall && end.distanceToSquared(cam) < 80 * 80) this.g.fx.impact(end, wall.normal, wall.box.surface);
      if (t === 'player') this.whiz(eye, dir, maxT);
      else this.attacked(t, b.bot);
    }
  }

  /** Damage from a bot's shot or punch. */
  private hit(b: Brain, t: Foe, def: GunDef, zone: HitZone, dist: number, at: Vector3) {
    const zm = zone === 'head' ? def.headMult : zone === 'limb' ? def.limbMult : 1;
    const dmg = def.damage * falloffMul(def, dist) * zm;
    const cam = this.g.renderer.camera.position;
    if (t === 'player') {
      this.m.damage(dmg * DMG_TO_PLAYER, false, b.bot.name, b.bot.eye(new Vector3()));
      return;
    }
    const r = t.damage(dmg * DMG_TO_BOT);
    if (at.distanceToSquared(cam) < 70 * 70) this.g.fx.blood(at, at.clone().sub(b.bot.eye(new Vector3())).normalize(), zone === 'head');
    this.attacked(t, b.bot);
    if (r.killed) {
      this.m.botDown(t, null, zone === 'head', b.bot);
      if (b.target === t) { b.target = null; b.visible = false; }
    }
  }

  /** A miss that passes close to your head cracks past you. */
  private whiz(o: Vector3, d: Vector3, maxT: number) {
    const p = this.g.player, head = tA.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
    const t = tC.subVectors(head, o).dot(d);
    if (t < 0 || t > maxT || this.whizT > 0) return;
    const closest = tC.copy(o).addScaledVector(d, t);
    if (closest.distanceTo(head) > 2.2) return;
    this.whizT = 0.08;
    const dx = closest.x - head.x, dz = closest.z - head.z;
    this.g.sfx.whiz(clamp((dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) * 1.5, -1, 1));
  }

  /** Your hitboxes as bots see them: head sphere, torso, legs (follow your stance). */
  private playerRay(o: Vector3, d: Vector3, maxT: number): { t: number; zone: HitZone } | null {
    const p = this.g.player, x = p.pos.x, y = p.pos.y, zz = p.pos.z, h = p.height;
    let best: { t: number; zone: HitZone } | null = null;
    const take = (t: number, zone: HitZone) => { if (t >= 0 && (!best || t < best.t)) best = { t, zone }; };
    // Head.
    const hc = tE.set(x, y + h - 0.17, zz), ox = o.x - hc.x, oy = o.y - hc.y, oz = o.z - hc.z;
    const bq = ox * d.x + oy * d.y + oz * d.z, cq = ox * ox + oy * oy + oz * oz - 0.15 * 0.15, disc = bq * bq - cq;
    if (disc >= 0) { const t = -bq - Math.sqrt(disc); if (t >= 0 && t <= maxT) take(t, 'head'); }
    take(slab(o, d, x - 0.26, y + h * 0.48, zz - 0.26, x + 0.26, y + h - 0.3, zz + 0.26, maxT), 'body');
    take(slab(o, d, x - 0.22, y, zz - 0.22, x + 0.22, y + h * 0.48, zz + 0.22, maxT), 'limb');
    return best;
  }

  // --------------------------------------------------------------------------------------------- foes

  private foeAlive(f: Foe) {
    if (f === 'player') return this.m.hp > 0 && this.m.phase === 'ground';
    return f.alive && !f.hidden && this.brainOf(f).state === 'ground';
  }

  private foeChest(f: Foe, out: Vector3) {
    if (f === 'player') { const p = this.g.player; return out.set(p.pos.x, p.pos.y + p.height * 0.68, p.pos.z); }
    return out.set(f.position.x, f.position.y + 1.22, f.position.z);
  }

  private foeHead(f: Foe, out: Vector3) {
    if (f === 'player') { const p = this.g.player; return out.set(p.pos.x, p.pos.y + p.height - 0.17, p.pos.z); }
    return out.set(f.position.x, f.position.y + 1.65, f.position.z);
  }

  private foeDist(b: Brain, f: Foe) { return this.foeChest(f, tD).distanceTo(b.pos); }
}
