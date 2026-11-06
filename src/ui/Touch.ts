import type { Input } from '../core/Input';

/** On-screen button: label, the key or mouse code it holds, where it sits, and whether dragging it also turns the view. */
interface Btn { label: string; code: string; cls: string; look?: boolean; tap?: boolean }

const BUTTONS: Btn[] = [
  { label: 'FIRE', code: 'Mouse0', cls: 'fire', look: true },
  { label: 'FIRE', code: 'Mouse0', cls: 'fire2', look: true },
  { label: 'AIM', code: 'Mouse2', cls: 'aim', look: true },
  { label: 'JUMP', code: 'Space', cls: 'jump' },
  { label: 'CROUCH', code: 'ControlLeft', cls: 'crouch' },
  { label: 'RELOAD', code: 'KeyR', cls: 'reload' },
  { label: 'SWAP', code: 'KeyE', cls: 'swap', tap: true },
  { label: 'USE', code: 'KeyF', cls: 'use' },
  { label: 'PLATE', code: 'Digit4', cls: 'plate' },
  { label: 'FISTS', code: 'KeyX', cls: 'fists' },
  { label: 'MAP', code: 'KeyM', cls: 'map' },
  { label: 'VIEW', code: 'KeyV', cls: 'view' },
  { label: 'REFILL', code: 'KeyT', cls: 'refill' },
  { label: 'II', code: 'pause', cls: 'pause', tap: true },
];

/** Stick travel in CSS px; pushing it past this much of the way forward sprints. */
const STICK_R = 56;
const SPRINT_AT = 0.9;

/**
 * Touch controls: a floating move stick on the left half, drag anywhere on the right half to look,
 * and buttons that hold the same codes the keyboard and mouse use. Several fingers work at once.
 */
export class Touch {
  readonly root = document.createElement('div');
  /** Seconds since a finger last turned the view. */
  sinceLook = 99;
  onPause: () => void = () => {};
  private stick = document.createElement('div');
  private knob = document.createElement('i');
  private stickId = -1;
  private stickO = { x: 0, y: 0 };
  /** Fingers that turn the view, with their last position. */
  private lookers = new Map<number, { x: number; y: number }>();
  private moveKeys = new Set<string>();

  constructor(private input: Input) {
    this.root.id = 'touch';
    this.stick.className = 'stick';
    this.stick.append(this.knob);
    this.root.append(this.stick);
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tb ${b.cls}`;
      el.textContent = b.label;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        capture(el, e.pointerId);
        el.classList.add('on');
        if (b.code === 'pause') { this.onPause(); return; }
        if (b.code === 'KeyE') input.wheel += 1;
        else input.hold(b.code, `t${e.pointerId}`);
        if (b.look) this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      });
      const up = (e: PointerEvent) => {
        el.classList.remove('on');
        if (!b.tap) input.let(b.code, `t${e.pointerId}`);
        this.lookers.delete(e.pointerId);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointermove', (e) => this.lookMove(e));
      this.root.append(el);
    }
    // The bare screen: the left half places the stick, the right half looks.
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(this.root, e.pointerId);
      if (e.clientX < innerWidth * 0.42 && this.stickId < 0) {
        this.stickId = e.pointerId;
        this.stickO = { x: e.clientX, y: e.clientY };
        this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.stick.classList.add('on');
        this.knob.style.transform = '';
      } else this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.stickMove(e.clientX - this.stickO.x, e.clientY - this.stickO.y);
      else this.lookMove(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) {
        this.stickId = -1;
        this.stick.classList.remove('on');
        this.stickMove(0, 0);
      }
      this.lookers.delete(e.pointerId);
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    // Buy station rows: tap one to buy it (the same as pressing its number).
    const shop = document.getElementById('shop');
    shop?.addEventListener('pointerdown', (e) => {
      const n = (e.target as HTMLElement).closest('.row')?.querySelector('kbd')?.textContent;
      if (!n) return;
      e.preventDefault();
      input.hold(`Digit${n}`, 'shop');
      setTimeout(() => input.let(`Digit${n}`, 'shop'), 80);
    });
    document.body.append(this.root);
  }

  private lookMove(e: PointerEvent) {
    const l = this.lookers.get(e.pointerId);
    if (!l) return;
    this.input.touchDX += e.clientX - l.x;
    this.input.touchDY += e.clientY - l.y;
    if (e.clientX !== l.x || e.clientY !== l.y) this.sinceLook = 0;
    l.x = e.clientX;
    l.y = e.clientY;
  }

  /** The stick drives WASD (with a dead zone) and Shift when pushed nearly all the way forward. */
  private stickMove(dx: number, dy: number) {
    const len = Math.hypot(dx, dy), k = len > STICK_R ? STICK_R / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const x = (dx * k) / STICK_R, y = (dy * k) / STICK_R;
    const want = new Set<string>();
    if (y < -0.35) want.add('KeyW');
    if (y > 0.35) want.add('KeyS');
    if (x < -0.35) want.add('KeyA');
    if (x > 0.35) want.add('KeyD');
    if (-y > SPRINT_AT) want.add('ShiftLeft');
    for (const c of this.moveKeys) if (!want.has(c)) this.input.let(c, 'stick');
    for (const c of want) this.input.hold(c, 'stick');
    this.moveKeys = want;
  }

  /** Lets go of everything (pausing, or the window losing focus). */
  reset() {
    this.stickId = -1;
    this.stick.classList.remove('on');
    this.stickMove(0, 0);
    this.lookers.clear();
    for (const el of this.root.querySelectorAll('.on')) el.classList.remove('on');
  }

  update(dt: number) { this.sinceLook += dt; }
}

/** Keeps a finger's moves coming to the element it went down on, even after it slides off. */
function capture(el: Element, id: number) {
  try { el.setPointerCapture(id); } catch { /* pointer already gone */ }
}

/** Phones and tablets (no hover, coarse pointer), or any device that has just been touched. */
export const isTouchDevice = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
