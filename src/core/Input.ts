/**
 * Keyboard + mouse state. `down` is held keys; `pressed` holds keys that went down since the last
 * `endFrame()` so a tap is never lost between frames. Mouse movement is accumulated per frame.
 */
export class Input {
  readonly down = new Set<string>();
  readonly pressed = new Set<string>();
  readonly released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Called when pointer lock is lost (the pause menu opens). */
  onUnlock: () => void = () => {};

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (this.locked && e.code !== 'F11' && e.code !== 'F12')) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      this.down.delete(code);
      this.released.add(code);
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Browsers sometimes emit a huge spike on the first event after locking; drop it.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.down.clear();
        this.onUnlock();
      }
    });
    addEventListener('blur', () => this.down.clear());
  }

  lock() {
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    // unadjustedMovement (raw input) isn't supported everywhere; fall back to a normal lock.
    p?.catch?.(() => this.canvas.requestPointerLock());
  }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }
  wasReleased(code: string) { return this.released.has(code); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
  }
}
