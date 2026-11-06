/** Keys near the arrow keys that stand in for the mouse buttons, so the game plays on the keyboard alone. */
const ALIAS: Record<string, string> = {
  Enter: 'Mouse0', NumpadEnter: 'Mouse0', ControlRight: 'Mouse0', Numpad0: 'Mouse0',
  ShiftRight: 'Mouse2', Slash: 'Mouse2', NumpadDecimal: 'Mouse2',
};
/** Arrow keys and the number pad look around. */
const LOOK_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Numpad4', 'Numpad6', 'Numpad8', 'Numpad2'];

/**
 * Keyboard + mouse state. `down` is held keys; `pressed` holds keys that went down since the last
 * `endFrame()` so a tap is never lost between frames. Mouse movement is accumulated per frame.
 * Touch buttons and the keyboard-only keys feed the same codes through `hold()` / `let()`.
 */
export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  readonly released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** Touch look drag this frame, in CSS pixels. */
  touchDX = 0;
  touchDY = 0;
  wheel = 0;
  locked = false;
  /** Playing without pointer lock (keyboard only or touch): keys are still captured. */
  free = false;
  /** Seconds since the mouse last moved the view (aim assist only helps when you aim without the mouse). */
  sinceMouse = 99;
  /** Called when pointer lock is lost (the pause menu opens). */
  onUnlock: () => void = () => {};
  /** Called when Esc is pressed while playing without pointer lock. */
  onPause: () => void = () => {};
  /** Every source currently holding each code (a real key and an alias, or two touch buttons). */
  private holders = new Map<string, Set<string>>();

  get active() { return this.locked || this.free; }

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (this.active && e.code !== 'F11' && e.code !== 'F12')) e.preventDefault();
      if (e.repeat) return;
      if (this.free && e.code === 'Escape') { this.onPause(); return; }
      this.hold(e.code, e.code);
      const alias = ALIAS[e.code];
      if (alias && this.active) this.hold(alias, e.code);
      if (this.active && (e.code === 'KeyQ' || e.code === 'KeyE')) this.wheel += e.code === 'KeyE' ? 1 : -1;
    });
    addEventListener('keyup', (e) => {
      this.let(e.code, e.code);
      const alias = ALIAS[e.code];
      if (alias) this.let(alias, e.code);
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.hold(code, code);
    });
    addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.let(code, code);
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Browsers sometimes emit a huge spike on the first event after locking; drop it.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      if (e.movementX || e.movementY) this.sinceMouse = 0;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.clear();
        this.onUnlock();
      }
    });
    addEventListener('blur', () => this.clear());
  }

  lock() {
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    // unadjustedMovement (raw input) isn't supported everywhere; fall back to a normal lock.
    p?.catch?.(() => this.canvas.requestPointerLock());
  }

  /** `source` starts holding `code` (a key, or a touch button standing in for one). */
  hold(code: string, source: string) {
    let h = this.holders.get(code);
    if (!h) this.holders.set(code, h = new Set());
    if (h.has(source)) return;
    h.add(source);
    if (!this.down.has(code)) { this.down.add(code); this.pressed.add(code); }
  }

  /** `source` lets go of `code`; the code stays down while anything else still holds it. */
  let(code: string, source: string) {
    const h = this.holders.get(code);
    if (!h?.delete(source) || h.size) return;
    this.down.delete(code);
    this.released.add(code);
  }

  clear() {
    for (const c of this.down) this.released.add(c);
    this.down.clear();
    this.holders.clear();
  }

  /** Arrow-key look: -1..1 on each axis (x right, y down). */
  keyLook(): [number, number] {
    const d = (a: string, b: string) => (this.down.has(a) ? 1 : 0) - (this.down.has(b) ? 1 : 0);
    return [d('ArrowRight', 'ArrowLeft') || d('Numpad6', 'Numpad4'), d('ArrowDown', 'ArrowUp') || d('Numpad2', 'Numpad8')];
  }

  get lookKeyHeld() { return LOOK_KEYS.some((k) => this.down.has(k)); }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  wasReleased(code: string) { return this.released.has(code); }

  endFrame(dt = 0) {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.touchDX = this.touchDY = 0;
    this.sinceMouse += dt;
  }
}
