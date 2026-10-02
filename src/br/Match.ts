import { Color, Vector2, Vector3, type FogExp2 } from 'three';
import { clamp, damp } from '../core/math';
import type { Game } from '../Game';
import { BotAI, HEARING } from '../ai/BotAI';
import type { Bot } from '../targets/Targets';
import { AMMO_BOX, AMMO_MAX, AMMO_NAME, AMMO_TYPES, GUN_IDS, GUNS, type AmmoType } from '../weapons/defs';
import { Loot, rollRarity, type BuyStation, type Focus, type LootItem } from './Loot';
import { Minimap } from './Minimap';
import { Plane } from './Plane';
import { Zone } from './Zone';

export type MatchPhase = 'plane' | 'sky' | 'ground' | 'over';

const MAX_PLATES = 5, PLATE_TIME = 0.95, REGEN_DELAY = 5, REGEN_RATE = 25;
const GAS_COLOR = new Color(0.55, 0.6, 0.2);

interface ShopItem { name: string; desc: string; price: number; }
const SHOP: ShopItem[] = [
  { name: 'Armor plates ×3', desc: 'Restock your plate carrier', price: 800 },
  { name: 'Ammo resupply', desc: 'Fill every ammo type to the max', price: 600 },
  { name: 'Epic weapon', desc: 'Random gun, epic rarity', price: 2500 },
  { name: 'Legendary weapon', desc: 'Random gun, legendary rarity (gold)', price: 4500 },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * One battle royale match on Harbor Outskirts: the plane flight and drop, the gas, health and armour plates, loot,
 * supply boxes, buy stations, the kill feed and the win / lose screen. The game calls `update` every frame.
 */
export class Match {
  phase: MatchPhase = 'plane';
  hp = 100;
  armor = 0;
  plates = 0;
  cash = 0;
  readonly loot: Loot;
  readonly zone: Zone;
  readonly plane: Plane;
  readonly ai: BotAI;
  /** Who got you (null = the gas). */
  private killer: string | null = null;
  private map: Minimap;
  private regenWait = 0;
  private plating = -1;
  private lowerK = 0;
  private shop: BuyStation | null = null;
  private gasTick = 0;
  private coughT = 0;
  private bigMap = false;
  private fog: FogExp2;
  private fogColor: Color;
  private fogDensity: number;
  private planeGone = false;
  private mini = document.getElementById('minimap') as HTMLCanvasElement;
  private big = document.querySelector('#bigmap canvas') as HTMLCanvasElement;
  readonly stats = { kills: 0, damage: 0, taken: 0, cash: 0, loot: 0, longest: 0, time: 0, boxes: 0 };
  private bounds: { x0: number; x1: number; z0: number; z1: number };
  private center: Vector3;

  constructor(private g: Game) {
    const w = g.world, rnd = Math.random;
    this.bounds = w.bounds!;
    const b = this.bounds;
    this.center = new Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    this.loot = new Loot(g.renderer, w.colliders, rnd);
    const spots = Loot.findSpots(w.colliders, b, 2.2, rnd);
    this.loot.populate(spots, w.stationAnchors ?? []);
    this.zone = new Zone(g.renderer.scene, new Vector2(this.center.x, this.center.z), 175, b, rnd);
    this.zone.onStage = (stage, phase) => {
      if (stage === 'shrink') { g.hud.feed('<b>The gas is closing in</b> — get inside the white circle'); g.sfx.gasAlarm(); }
      else if (stage === 'wait') g.hud.feed(`Phase ${phase + 1} · new circle on the map (M)`);
      else { g.hud.feed('<b>Final circle</b> — the gas is everywhere'); g.sfx.gasAlarm(); }
    };
    this.plane = new Plane(g.renderer, this.center, b, rnd);
    this.map = new Minimap(this.center.x, this.center.z, 128);
    this.map.capture(g.renderer, (on) => w.mapView?.(on));
    g.player.area = b;
    for (const bot of g.targets.bots) bot.respawn = false;
    this.ai = new BotAI(g, this);
    g.weapons.emptyHanded();
    g.weapons.infiniteReserve = false;
    g.hud.setMode(true);
    this.fog = g.renderer.scene.fog as FogExp2;
    this.fogColor = this.fog.color.clone();
    this.fogDensity = this.fog.density;
    g.weapons.melee = g.melee;
  }

  get alive() { return this.g.targets.bots.filter((b) => b.alive).length + (this.hp > 0 ? 1 : 0); }
  get total() { return this.g.targets.bots.length + 1; }
  /** No firing or weapon switching right now. */
  get blocksWeapons() { return this.phase !== 'ground' || !!this.shop || this.plating >= 0; }
  get inPlane() { return this.phase === 'plane'; }

  /** Camera position while riding the plane. */
  planeCamera(out: Vector3) { return this.plane.rampPosition(out); }

  // ------------------------------------------------------------------------------------------- per frame

  update(dt: number) {
    const g = this.g, p = g.player, input = g.input, hud = g.hud;
    if (this.phase === 'over') return;
    this.stats.time += dt;
    this.zone.update(dt);
    this.ai.update(dt);
    this.loot.update(dt, g.renderer.camera.position);

    // --- Plane and drop ---
    if (!this.planeGone) {
      this.plane.update(dt);
      const d = this.plane.pos.distanceTo(g.renderer.camera.position);
      g.sfx.loop('plane', this.phase === 'plane' ? 0.45 : 0.45 * clamp(1 - d / 450, 0, 1));
      if (this.plane.done) { this.planeGone = true; g.renderer.scene.remove(this.plane.obj); g.sfx.loop('plane', 0); }
    }
    if (this.phase === 'plane') {
      const canJump = this.plane.s > this.plane.enterS - 40;
      hud.setPrompt(canJump ? '<kbd>SPACE</kbd>Jump' : 'Approaching Harbor Outskirts…');
      if ((canJump && input.wasPressed('Space')) || this.plane.s > this.plane.exitS - 20) this.jump();
    } else if (this.phase === 'sky') {
      const fall = -p.vel.y;
      g.sfx.loop('wind', p.skydive === 'freefall' ? clamp(fall / 58, 0.2, 1) * 0.5 : 0.1);
      hud.setPrompt(p.skydive === 'freefall' ? `<kbd>SPACE</kbd>Open parachute · ${Math.round(p.altitude)} m` : `${Math.round(p.altitude)} m`);
      if (p.skydive === 'none') {
        this.phase = 'ground';
        g.sfx.loop('wind', 0);
        hud.setPrompt(null);
        hud.showHint('Loot up! F picks up · 4 plates up · stay inside the circle', 5);
      }
    } else this.ground(dt);

    // --- Gas ---
    const out = this.zone.outside(p.pos.x, p.pos.z);
    this.gasTick += dt;
    if (this.gasTick >= 1) {
      this.gasTick -= 1;
      const dps = this.zone.dps;
      if (this.phase !== 'plane' && out > 0) this.damage(dps, true);
      for (const bot of g.targets.bots) {
        if (bot.alive && !bot.hidden && this.zone.outside(bot.position.x, bot.position.z) > 0 && bot.gas(dps)) this.botDown(bot, null, false);
      }
    }
    if (out > 0 && this.phase !== 'plane') {
      this.coughT -= dt;
      if (this.coughT <= 0) { g.sfx.cough(); this.coughT = 2.2 + Math.random(); }
    }
    const inGas = this.phase === 'plane' ? 0 : clamp((out + 4) / 10, 0, 1);
    hud.setGas(inGas * 0.85);
    // From the plane the wall would hide the whole map; keep it faint until you're near the ground.
    this.zone.opacity = this.phase === 'plane' ? 0 : this.phase === 'sky' ? 0.4 : 1;
    g.sfx.loop('gas', inGas * 0.25);
    // Thinner haze up high (the plane and the drop), thick yellow fog inside the gas.
    const high = clamp((g.renderer.camera.position.y - 25) / 110, 0, 1);
    this.fog.color.copy(this.fogColor).lerp(GAS_COLOR, inGas * 0.85);
    this.fog.density = this.fogDensity * (1 - 0.6 * high) + (0.03 - this.fogDensity) * inGas;

    // --- Health regen ---
    this.regenWait -= dt;
    if (this.regenWait <= 0 && this.hp < 100) this.hp = Math.min(100, this.hp + REGEN_RATE * dt);

    // --- HUD ---
    hud.setVitals(this.hp, this.armor, this.plates, this.cash);
    hud.setAlive(this.alive, this.stats.kills);
    const s = this.zone.state;
    let z: string;
    if (this.phase === 'plane') z = 'DROP ZONE · <b>HARBOR OUTSKIRTS</b>';
    else if (s.stage === 'wait') z = `PHASE ${s.phase + 1} · GAS MOVES IN<b>${fmt(s.left)}</b>`;
    else if (s.stage === 'shrink') z = `GAS CLOSING<b>${fmt(s.left)}</b>`;
    else z = 'FINAL CIRCLE<b>GAS EVERYWHERE</b>';
    if (out > 0 && this.phase !== 'plane') z += '<br><span style="color:#d8e04a">YOU ARE IN THE GAS — MOVE TO THE CIRCLE</span>';
    hud.setZone(z, s.stage !== 'wait' || s.left < 10 || out > 0);
    if (input.wasPressed('KeyM')) {
      this.bigMap = !this.bigMap;
      document.getElementById('bigmap')!.classList.toggle('hidden', !this.bigMap);
    }
    const marks = this.marks();
    this.map.draw(this.mini, { x: marks.plane ? marks.plane.pos.x : p.pos.x, z: marks.plane ? marks.plane.pos.z : p.pos.z }, 70, marks);
    if (this.bigMap) this.map.draw(this.big, { x: this.center.x, z: this.center.z }, 128, marks);

    // --- Win ---
    if (this.hp > 0 && this.g.targets.bots.every((bot) => !bot.alive)) this.end(true);
  }

  private marks() {
    const p = this.g.player, pl = this.plane;
    const plane = this.phase === 'plane'
      ? { from: pl.pos.clone().addScaledVector(pl.dir, -(pl.s + 420)), to: pl.pos.clone().addScaledVector(pl.dir, 420 - pl.s), pos: pl.pos } : null;
    return {
      player: p.pos, yaw: p.yaw, zone: { c: this.zone.center, r: this.zone.radius },
      next: this.phase === 'plane' ? null : this.zone.next, plane,
      boxes: this.loot.boxes.filter((b) => !b.opened).map((b) => b.pos), stations: this.loot.stations.map((s) => s.pos),
      pings: this.ai.pings,
    };
  }

  private jump() {
    const p = this.g.player;
    this.plane.rampPosition(p.pos);
    p.vel.copy(this.plane.velocity).multiplyScalar(0.6);
    p.skydive = 'freefall';
    p.onGround = false;
    this.phase = 'sky';
    this.g.sfx.chute();
    this.g.hud.showHint('Look down to dive faster · SPACE opens the parachute early', 4);
  }

  // ------------------------------------------------------------------------------------------- on the ground

  private ground(dt: number) {
    const g = this.g, p = g.player, w = g.weapons, input = g.input, hud = g.hud;
    const cam = g.renderer.camera, dir = cam.getWorldDirection(new Vector3());

    // Shop.
    let shopClosed = false;
    if (this.shop) {
      if (input.wasPressed('KeyF') || this.shop.pos.distanceTo(p.pos) > 3.5) { this.closeShop(); shopClosed = true; }
      else for (let i = 0; i < SHOP.length; i++) if (input.wasPressed(`Digit${i + 1}`)) this.buy(i);
    }

    // Plating.
    if (!this.shop && this.plating < 0 && input.wasPressed('Digit4')) {
      if (this.plates <= 0) hud.info('No armor plates', '');
      else if (this.armor >= 150) hud.info('Armor full', '');
      else { this.plating = 0; g.sfx.plateStart(); }
    }
    if (this.plating >= 0) {
      this.plating += dt / PLATE_TIME;
      if (this.plating >= 1) {
        this.armor = Math.min(150, (Math.floor(this.armor / 50 + 1e-6) + 1) * 50);
        this.plates--;
        g.sfx.plateIn();
        if (this.armor >= 150) { g.sfx.armorFull(); this.plating = -1; }
        else if (this.plates > 0 && input.isDown('Digit4')) { this.plating = 0; g.sfx.plateStart(); }
        else this.plating = -1;
      }
    }
    w.plateT = this.plating;
    this.lowerK = damp(this.lowerK, this.plating >= 0 || this.shop ? 1 : 0, 14, dt);
    w.lower = this.lowerK < 0.01 ? 0 : this.lowerK;

    // Walk-over pickups: ammo, plates and cash.
    for (const it of this.loot.items) {
      if (it.taken || it.vel || it.kind === 'gun') continue;
      if (Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z) < 1.3 && Math.abs(it.pos.y - p.pos.y) < 1.6) this.take(it, true);
    }

    // Look-at interaction.
    if (this.shop) { hud.setPrompt(null); return; }
    const f = this.loot.focus(cam.position, dir, p.pos);
    hud.setPrompt(this.promptFor(f));
    if (f && input.wasPressed('KeyF') && !shopClosed) {
      if (f.type === 'item') this.take(f.item, false);
      else if (f.type === 'supply') this.openSupply(f.box);
      else this.openShop(f.station);
    }
  }

  private promptFor(f: Focus | null): string | null {
    if (!f) return null;
    if (f.type === 'supply') return '<kbd>F</kbd>Open <em style="color:#ffc040">supply box</em>';
    if (f.type === 'station') return '<kbd>F</kbd>Use <em style="color:#8fe08a">buy station</em>';
    const it = f.item, w = this.g.weapons;
    if (it.kind === 'gun') return `<kbd>F</kbd>${w.full ? 'Swap for' : 'Pick up'} ${Loot.label(it)}`;
    if (it.kind === 'ammo' && w.ammo[it.ammo!] >= AMMO_MAX[it.ammo!]) return `${Loot.label(it)} · full`;
    if (it.kind === 'plate' && this.plates >= MAX_PLATES) return `${Loot.label(it)} · carrier full`;
    return `<kbd>F</kbd>Pick up ${Loot.label(it)}`;
  }

  /** Picks an item up. Auto pickups (walking over) stay quiet when there's no room. */
  private take(it: LootItem, auto: boolean) {
    const g = this.g, w = g.weapons, p = g.player;
    if (it.kind === 'gun') {
      const dropped = w.give(it.gun!, it.rarity, it.amount);
      it.taken = true;
      const ammo = Loot.ammoFor(it.gun!);
      if (w.ammo[ammo] === 0) w.addAmmo(ammo, Math.round(AMMO_BOX[ammo] / 2));
      if (dropped && dropped.base !== 'hands') {
        const fwd = new Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        this.loot.spawnGun(p.pos.clone().addScaledVector(fwd, 0.5), dropped.base, dropped.rarity, fwd.multiplyScalar(1.5).setY(2), dropped.mag);
      }
      g.sfx.pickup();
      g.hud.info(`${GUNS[it.gun!].name}`, '');
    } else if (it.kind === 'ammo') {
      const n = w.addAmmo(it.ammo!, it.amount);
      if (n <= 0) { if (!auto) g.sfx.denied(); return; }
      it.amount -= n;
      if (it.amount <= 0) it.taken = true;
      g.sfx.pickup();
      g.hud.info(`+${n} ${AMMO_NAME[it.ammo!]}`, '');
    } else if (it.kind === 'plate') {
      const n = Math.min(it.amount, MAX_PLATES - this.plates);
      if (n <= 0) { if (!auto) g.sfx.denied(); return; }
      this.plates += n;
      it.amount -= n;
      if (it.amount <= 0) it.taken = true;
      g.sfx.pickup();
      g.hud.info(`+${n} armor plate${n > 1 ? 's' : ''} · press 4`, '');
    } else {
      this.cash += it.amount;
      this.stats.cash += it.amount;
      it.taken = true;
      g.sfx.cash();
      g.hud.info(`+$${it.amount}`, '');
    }
    this.stats.loot++;
  }

  private openSupply(box: { pos: Vector3; opened: boolean }) {
    box.opened = true;
    this.stats.boxes++;
    const rnd = Math.random, gun = GUN_IDS[Math.floor(rnd() * GUN_IDS.length)];
    const other = AMMO_TYPES[Math.floor(rnd() * AMMO_TYPES.length)];
    this.loot.spill(box.pos, [
      { kind: 'gun', gun, rarity: rollRarity(rnd, 2), amount: GUNS[gun].mag },
      { kind: 'ammo', ammo: Loot.ammoFor(gun), rarity: 0, amount: AMMO_BOX[Loot.ammoFor(gun)] },
      { kind: 'ammo', ammo: other, rarity: 0, amount: AMMO_BOX[other] },
      { kind: 'plate', rarity: 2, amount: 2 },
      { kind: 'cash', rarity: 4, amount: 100 * Math.round(5 + rnd() * 10) },
    ]);
    this.g.sfx.supplyOpen();
  }

  // ------------------------------------------------------------------------------------------- shop

  private openShop(s: BuyStation) {
    this.shop = s;
    this.g.sfx.pickup();
    this.renderShop();
    document.getElementById('shop')!.classList.remove('hidden');
  }

  closeShop() {
    this.shop = null;
    document.getElementById('shop')!.classList.add('hidden');
  }

  private renderShop() {
    const rows = SHOP.map((s, i) => `<div class="row${this.cash < s.price ? ' poor' : ''}"><kbd>${i + 1}</kbd><div>${s.name}<small>${s.desc}</small></div><b>$${s.price.toLocaleString('en-US')}</b></div>`);
    document.getElementById('shop')!.innerHTML = `<span class="cash">$${this.cash.toLocaleString('en-US')}</span><h2>BUY STATION</h2>${rows.join('')}<p>Press 1–4 to buy · F to close</p>`;
  }

  private buy(i: number) {
    const g = this.g, item = SHOP[i];
    if (this.cash < item.price) { g.sfx.denied(); g.hud.info('Not enough cash', ''); return; }
    if (i === 0) {
      if (this.plates >= MAX_PLATES) { g.sfx.denied(); g.hud.info('Plate carrier full', ''); return; }
      this.plates = Math.min(MAX_PLATES, this.plates + 3);
    } else if (i === 1) {
      for (const k of Object.keys(AMMO_MAX) as AmmoType[]) g.weapons.addAmmo(k, AMMO_MAX[k]);
    } else {
      const gun = GUN_IDS[Math.floor(Math.random() * GUN_IDS.length)];
      const s = this.loot.spawnGun(g.player.pos.clone(), gun, i === 2 ? 3 : 4);
      this.take(s, false);
    }
    this.cash -= item.price;
    g.sfx.buy();
    this.renderShop();
  }

  // ------------------------------------------------------------------------------------------- damage and kills

  /** Damage to you. Gas skips armour; everything else hits plates first. `by` and `from` say who shot you and from where. */
  damage(amount: number, gas: boolean, by: string | null = null, from: Vector3 | null = null) {
    if (this.phase === 'over') return;
    let left = amount;
    const hadArmor = this.armor > 0;
    if (!gas && this.armor > 0) { const a = Math.min(this.armor, left); this.armor -= a; left -= a; }
    this.hp -= left;
    this.regenWait = REGEN_DELAY;
    this.stats.taken += amount;
    this.g.hud.hurt();
    this.g.sfx.hurt();
    if (hadArmor && this.armor <= 0 && !gas) { this.g.sfx.armorBreak(); this.g.hud.info('ARMOR BROKEN', 'kill'); }
    if (from) {
      // Direction indicator: 0 = straight ahead, positive = to your right.
      const p = this.g.player, dx = from.x - p.pos.x, dz = from.z - p.pos.z;
      this.g.hud.hitFrom(Math.atan2(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), -dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw)));
    }
    if (this.hp <= 0) { this.hp = 0; this.killer = by; this.end(false); }
  }

  /** Called by the game for every hit you land. */
  onHit(dealt: number) { this.stats.damage += dealt; }

  /** You hit a bot: it knows where you are now. */
  botHit(bot: Bot) { this.ai.attacked(bot, 'player'); }

  /** You fired: everyone in earshot hears it (and you show up on nobody's minimap, but they come looking). */
  playerShot() {
    const p = this.g.player.pos;
    this.ai.noise(p, HEARING, 'player');
  }

  /** A bot went down: by you (with distance), by another bot, or by the gas. Drops what it was carrying. */
  botDown(bot: Bot, dist: number | null, head: boolean, by: Bot | null = null) {
    const rnd = Math.random;
    if (dist !== null) {
      this.stats.kills++;
      this.stats.longest = Math.max(this.stats.longest, dist);
      this.g.hud.feed(`You eliminated <b>${bot.name}</b>${head ? ' · headshot' : ''} · ${Math.round(dist)} m`);
    } else if (by) this.g.hud.feed(`<span class="other">${by.name} eliminated ${bot.name}${head ? ' · headshot' : ''}</span>`);
    else this.g.hud.feed(`<span class="gas">${bot.name} was taken by the gas</span>`);
    const left = this.g.targets.bots.filter((b) => b.alive).length + (this.hp > 0 ? 1 : 0);
    if (this.hp > 0 && left > 1 && left <= 3) this.g.hud.feed(`<b>${left} players left</b>`);
    const specs: Omit<LootItem, 'pos' | 'obj' | 'vel' | 't' | 'taken'>[] = [
      { kind: 'cash', rarity: 4, amount: 100 * Math.round(3 + rnd() * 4) },
      { kind: 'ammo', ammo: AMMO_TYPES[Math.floor(rnd() * AMMO_TYPES.length)], rarity: 0, amount: 0 },
    ];
    specs[1].amount = AMMO_BOX[specs[1].ammo!];
    if (rnd() < 0.6) specs.push({ kind: 'plate', rarity: 2, amount: 1 });
    // The gun it was holding.
    const held = this.ai.gunOf(bot);
    if (held) specs.push({ kind: 'gun', gun: held.id, rarity: held.rarity, amount: Math.max(held.mag, Math.ceil(GUNS[held.id].mag / 2)) });
    this.ai.disarm(bot);
    this.loot.spill(bot.position, specs);
  }

  // ------------------------------------------------------------------------------------------- end

  private end(win: boolean) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const g = this.g, place = win ? 1 : this.alive + 1;
    this.closeShop();
    g.sfx.loop('wind', 0); g.sfx.loop('gas', 0); g.sfx.loop('plane', 0);
    g.hud.setPrompt(null);
    const show = () => {
      if (win) g.sfx.victory(); else g.sfx.defeat();
      g.over = true;
      document.exitPointerLock();
      const st = this.stats;
      const el = document.getElementById('end')!;
      el.className = win ? 'win' : 'lose';
      el.innerHTML = `<div class="card"><h1>${win ? 'VICTORY' : 'ELIMINATED'}</h1>
        <div class="place">#${place} OF ${this.total}${win ? ' · LAST ONE STANDING' : this.killer ? ` · ELIMINATED BY ${this.killer.toUpperCase()}` : ' · TAKEN BY THE GAS'}</div>
        <div class="stats">
          <div><b>${st.kills}</b><span>KILLS</span></div>
          <div><b>${Math.round(st.damage)}</b><span>DAMAGE</span></div>
          <div><b>${fmt(st.time)}</b><span>SURVIVED</span></div>
          <div><b>$${st.cash.toLocaleString('en-US')}</b><span>CASH FOUND</span></div>
          <div><b>${st.loot}</b><span>ITEMS LOOTED</span></div>
          <div><b>${Math.round(st.longest)} m</b><span>LONGEST KILL</span></div>
        </div>
        <div class="btns"><button class="primary" id="again">PLAY AGAIN</button><button class="ghost" id="tomenu">MAIN MENU</button></div></div>`;
      document.getElementById('again')!.addEventListener('click', () => { sessionStorage.setItem('warstrike.autostart', 'br'); location.reload(); });
      document.getElementById('tomenu')!.addEventListener('click', () => location.reload());
    };
    setTimeout(show, win ? 1100 : 600);
  }
}
