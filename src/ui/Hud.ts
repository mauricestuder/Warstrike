import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { damp } from '../core/math';

interface Floater { el: HTMLDivElement; pos: Vector3; life: number; }

const $ = <T extends HTMLElement = HTMLDivElement>(id: string) => document.getElementById(id) as T;

/**
 * DOM overlay: dynamic crosshair (gap follows real spread), hitmarkers (body / head / kill), floating damage numbers,
 * hit readout (zone + distance), ammo, movement readout, tactical sprint meter, scope overlay and FPS.
 */
export class Hud {
  private cross = $('crosshair');
  private hitmark = $('hitmarker');
  private readout = $('readout');
  private ammo = $('ammo');
  private gunName = $('gun-name');
  private move = $('move');
  private tac = $('tac');
  private scope = $('scope');
  private fps = $('fps');
  private hint = $('hint');
  private slotsEl = $('slots');
  private vitalsEl = $('vitals');
  private promptEl = $('prompt');
  private feedEl = $('feed');
  private zoneEl = $('zone');
  private aliveEl = $('alive');
  private hurtEl = $('hurt');
  private gasEl = $('gas');
  private prompt = '';
  private lastVitals = '';
  private gap = 20;
  private floaters: Floater[] = [];
  private readoutT = 0;
  private hintT = 0;
  private hitT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  showFps = true;

  /** `spread` is the cone half-angle in radians; convert to pixels with the current vertical FOV. */
  crosshair(spread: number, fovDeg: number, visible: number, dt: number) {
    const px = (Math.tan(spread) / Math.tan((fovDeg * Math.PI) / 360)) * (innerHeight / 2);
    this.gap = damp(this.gap, Math.max(4, px), 22, dt);
    this.cross.style.setProperty('--gap', `${this.gap.toFixed(1)}px`);
    this.cross.style.opacity = visible.toFixed(2);
  }

  hit(kind: 'body' | 'head' | 'kill' | 'steel' | 'armor') {
    this.hitmark.className = '';
    void this.hitmark.offsetWidth; // restart the CSS animation
    this.hitmark.className = `show ${kind}`;
    this.hitT = 0.3;
  }

  damageNumber(p: Vector3, amount: number, head: boolean) {
    const el = document.createElement('div');
    el.className = `dmg${head ? ' head' : ''}`;
    el.textContent = Math.round(amount).toString();
    $('floaters').appendChild(el);
    this.floaters.push({ el, pos: p.clone().add(new Vector3((Math.random() - 0.5) * 0.3, 0.2, 0)), life: 0.9 });
  }

  /** Big readout under the crosshair: "HEADSHOT · 187 m". */
  info(text: string, cls = '') {
    this.readout.textContent = text;
    this.readout.className = `show ${cls}`;
    this.readoutT = 1.6;
  }

  showHint(text: string, time = 3) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintT = time;
  }

  setGun(name: string, rarity: { name: string; color: string } | null) {
    this.gunName.innerHTML = rarity ? `<i style="color:${rarity.color}">${rarity.name.toUpperCase()}</i> ${name}` : name;
  }

  /** `mag` < 0 hides the counter (fists). */
  setAmmo(mag: number, reserve: number, magSize: number) {
    if (mag < 0) { this.ammo.innerHTML = '<span class="melee">LMB punch · X back to gun</span>'; return; }
    this.ammo.innerHTML = `<b class="${mag <= magSize * 0.25 ? 'low' : ''}">${mag}</b><span>${reserve === Infinity ? '∞' : reserve}</span>`;
  }

  setSlots(slots: ({ name: string; color: string } | null)[], active: number) {
    const chips = slots.map((s, i) => `<div class="slot${i === active ? ' on' : ''}" style="--c:${s ? s.color : 'transparent'}"><u>${i + 1}</u>${s ? s.name : 'EMPTY'}</div>`);
    chips.push(`<div class="slot${active < 0 ? ' on' : ''}" style="--c:#888"><u>X</u>FISTS</div>`);
    this.slotsEl.innerHTML = chips.join('');
  }

  /** Battle royale vitals: three armour plate segments over the health bar, plates carried and cash. */
  setVitals(hp: number, armor: number, plates: number, cash: number) {
    const key = `${Math.ceil(hp)}|${Math.ceil(armor)}|${plates}|${cash}`;
    if (key === this.lastVitals) return;
    this.lastVitals = key;
    const segs = [0, 1, 2].map((i) => `<i style="--f:${Math.max(0, Math.min(1, (armor - i * 50) / 50)).toFixed(3)}"></i>`).join('');
    this.vitalsEl.innerHTML = `<div class="plates">${segs}</div><div class="hp${hp < 35 ? ' low' : ''}"><i style="--f:${(hp / 100).toFixed(3)}"></i></div>`
      + `<div class="inv"><span class="pl">▣ ${plates}<small> plates · 4</small></span><span class="cash">$${cash.toLocaleString('en-US')}</span></div>`;
  }

  setPrompt(text: string | null) {
    const t = text ?? '';
    if (t === this.prompt) return;
    this.prompt = t;
    this.promptEl.innerHTML = t;
    this.promptEl.classList.toggle('show', !!t);
  }

  feed(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html;
    this.feedEl.prepend(el);
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5600);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild!.remove();
  }

  setZone(html: string, urgent: boolean) {
    if (this.zoneEl.innerHTML !== html) this.zoneEl.innerHTML = html;
    this.zoneEl.classList.toggle('urgent', urgent);
  }

  setAlive(alive: number, kills: number) {
    const t = `<b>${alive}</b> ALIVE<span>${kills} KILLS</span>`;
    if (this.aliveEl.innerHTML !== t) this.aliveEl.innerHTML = t;
  }

  hurt() {
    this.hurtEl.classList.remove('show');
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('show');
  }

  /** 0..1 how deep in the gas you are. */
  setGas(k: number) { this.gasEl.style.opacity = k.toFixed(2); }

  /** Battle royale HUD on/off; the range HUD keeps the movement readout instead. */
  setMode(br: boolean) {
    document.body.classList.toggle('br', br);
  }

  setMove(speed: number, stance: string, lastSlide: number) {
    this.move.textContent = `${speed.toFixed(1)} m/s · ${stance}${lastSlide > 0 ? ` · last slide ${lastSlide.toFixed(1)} m` : ''}`;
  }

  setTac(frac: number, active: boolean) {
    this.tac.style.setProperty('--f', frac.toFixed(3));
    this.tac.classList.toggle('active', active);
    this.tac.classList.toggle('full', frac >= 0.999 && !active);
  }

  setScope(on: boolean) { this.scope.classList.toggle('show', on); }

  update(dt: number, camera: PerspectiveCamera) {
    if (this.readoutT > 0 && (this.readoutT -= dt) <= 0) this.readout.className = '';
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.hint.classList.remove('show');
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.hitmark.className = '';
    const v = new Vector3();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.pos.y += dt * 0.6;
      v.copy(f.pos).project(camera);
      if (f.life <= 0 || v.z > 1) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      f.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
      f.el.style.opacity = Math.min(1, f.life * 2.5).toFixed(2);
    }
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps.textContent = this.showFps ? `${Math.round(this.fpsN / this.fpsAcc)} FPS` : '';
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }
}
