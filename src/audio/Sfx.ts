import type { GunId } from '../weapons/defs';

const SPEED_OF_SOUND = 343;

/**
 * All sounds are synthesized with WebAudio (no files), layered like real gun recordings:
 * a sharp crack, a low body "thump", mechanical noise, and a long outdoor tail with a slap-back echo off the berms.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private echo!: DelayNode;
  private echoIn!: GainNode;
  volume = 0.7;

  /** Must be called from a user gesture (the Play click). */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    // Echo off the range berms: a single delayed, darkened copy with a little feedback.
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 0.22;
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.19;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 1400;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    this.echoIn.connect(this.echo).connect(echoLp).connect(this.master);
    echoLp.connect(fb).connect(this.echo);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Filtered noise burst with an exponential-ish envelope. */
  private burst(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.001,
    freqEnd?: number, dest: AudioNode = this.master) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  private tone(at: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine', dest: AudioNode = this.master) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  shot(id: GunId) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, v = 0.9 + Math.random() * 0.2;
    if (id === 'ar') {
      this.burst(t, 0.06, 'highpass', 2200, 0.7, 0.9 * v);
      this.burst(t, 0.16, 'lowpass', 1800, 0.8, 1.1 * v, 0.001, 300);
      this.tone(t, 0.12, 150, 48, 0.9 * v);
      this.burst(t + 0.01, 0.9, 'lowpass', 900, 0.5, 0.25, 0.02, 200, this.echoIn);
      this.burst(t + 0.02, 0.05, 'bandpass', 4200, 3, 0.12); // bolt carrier
    } else if (id === 'smg') {
      this.burst(t, 0.045, 'highpass', 2800, 0.7, 0.7 * v);
      this.burst(t, 0.1, 'bandpass', 1400, 0.9, 0.9 * v, 0.001, 500);
      this.tone(t, 0.08, 190, 70, 0.55 * v);
      this.burst(t + 0.01, 0.6, 'lowpass', 1100, 0.5, 0.16, 0.02, 250, this.echoIn);
      this.burst(t + 0.015, 0.04, 'bandpass', 5200, 3, 0.1);
    } else {
      this.burst(t, 0.08, 'highpass', 1800, 0.7, 1.2 * v);
      this.burst(t, 0.35, 'lowpass', 1400, 0.9, 1.4 * v, 0.001, 120);
      this.tone(t, 0.3, 110, 30, 1.3 * v);
      this.burst(t + 0.01, 1.6, 'lowpass', 700, 0.5, 0.5, 0.03, 90, this.echoIn);
      // Bolt cycle.
      this.burst(t + 0.55, 0.05, 'bandpass', 2500, 4, 0.35);
      this.burst(t + 0.72, 0.06, 'bandpass', 1900, 4, 0.4);
    }
  }

  dryFire() {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime, 0.03, 'bandpass', 3500, 5, 0.3);
  }

  /** Reload foley at the right moments: mag out, mag in, charging handle / bolt. */
  reload(dur: number, empty: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t + dur * 0.18, 0.05, 'bandpass', 1800, 4, 0.35);
    this.burst(t + dur * 0.55, 0.06, 'bandpass', 1300, 4, 0.5);
    this.burst(t + dur * 0.58, 0.03, 'bandpass', 3800, 6, 0.3);
    if (empty) {
      this.burst(t + dur * 0.8, 0.05, 'bandpass', 2400, 5, 0.4);
      this.burst(t + dur * 0.86, 0.05, 'bandpass', 1600, 5, 0.45);
    }
  }

  swap() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.12, 'bandpass', 900, 1, 0.18);
    this.burst(t + 0.1, 0.04, 'bandpass', 3000, 5, 0.2);
  }

  step(sprint: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, v = sprint ? 0.32 : 0.2;
    this.burst(t, 0.09, 'lowpass', 500 + Math.random() * 300, 1, v, 0.004);
    this.burst(t, 0.05, 'bandpass', 2200 + Math.random() * 800, 1.5, v * 0.3, 0.002); // gravel crunch
  }

  jump() {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime, 0.18, 'bandpass', 1200, 0.8, 0.12, 0.02);
  }

  land(impact: number) {
    if (!this.ok) return;
    const v = Math.min(1, impact / 9);
    this.burst(this.ctx!.currentTime, 0.14, 'lowpass', 400, 1, 0.2 + v * 0.5, 0.003);
  }

  slide() {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime, 0.7, 'bandpass', 1400, 0.6, 0.35, 0.03, 500);
  }

  mantle() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.1, 'lowpass', 600, 1, 0.3);
    this.burst(t + 0.05, 0.25, 'bandpass', 1100, 0.8, 0.12, 0.02);
  }

  /** Hitmarker feedback. */
  hit(head: boolean, armor: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    if (head) {
      this.tone(t, 0.18, 2400, 2300, 0.28, 'triangle');
      this.tone(t, 0.12, 3700, 3600, 0.12, 'sine');
    } else if (armor) this.burst(t, 0.05, 'bandpass', 3000, 2, 0.35);
    else this.burst(t, 0.06, 'bandpass', 1800, 1.5, 0.4);
  }

  armorBreak() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.25, 'highpass', 3500, 1, 0.45, 0.001, 6000);
    this.tone(t, 0.2, 1800, 900, 0.12, 'square');
  }

  kill() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.1, 880, 870, 0.22, 'triangle');
    this.tone(t + 0.07, 0.18, 1320, 1300, 0.22, 'triangle');
  }

  /** Steel "ding", delayed by the real time sound takes to come back from that distance. */
  steel(dist: number) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime + dist / SPEED_OF_SOUND;
    const v = Math.max(0.12, 0.6 - dist / 800);
    for (const [f, g] of [[1180, 1], [2710, 0.5], [4430, 0.3], [690, 0.4]] as const) this.tone(t, 0.9, f, f * 0.995, g * v * 0.35);
  }

  breath(inhale: boolean) {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime, inhale ? 0.5 : 0.7, 'bandpass', inhale ? 900 : 650, 0.7, 0.08, 0.15);
  }

  inspect() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t + 0.2, 0.15, 'bandpass', 900, 1, 0.12, 0.02);
    this.burst(t + 1.4, 0.04, 'bandpass', 3000, 5, 0.18);
  }
}
