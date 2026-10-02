import type { Vector3 } from 'three';
import type { GunId } from '../weapons/defs';

const SPEED_OF_SOUND = 343;

/** Where the shots echo: open berms on the range, houses and containers in town. */
export type SoundEnv = 'range' | 'town';

/** Recipe for one gun's report, rendered sample by sample into a buffer. */
interface ShotSpec {
  len: number;          // seconds of dry sound
  crack: number;        // supersonic crack level
  blast: number;        // muzzle blast level
  blastLp: number;      // blast brightness (Hz), falls to a third over the decay
  blastDecay: number;   // seconds
  boomHz: number;       // resonant body of the blast
  boom: number;
  thump: [number, number, number, number]; // start Hz, end Hz, decay s, level: the punch you feel in your chest
  drive: number;        // saturation: real recordings of gunfire are always clipped
  mech: [number, number, number][]; // [time s, Hz, level] action noise
}

const SHOTS: Record<GunId, ShotSpec> = {
  ar: {
    len: 0.55, crack: 1.1, blast: 1.5, blastLp: 3600, blastDecay: 0.05, boomHz: 160, boom: 0.9,
    thump: [125, 46, 0.1, 0.55], drive: 2.4, mech: [[0.018, 3900, 0.12], [0.034, 2100, 0.1]],
  },
  smg: {
    len: 0.4, crack: 0.8, blast: 1.4, blastLp: 4200, blastDecay: 0.035, boomHz: 200, boom: 0.7,
    thump: [150, 60, 0.07, 0.4], drive: 2.0, mech: [[0.012, 4600, 0.12], [0.024, 2600, 0.08]],
  },
  sniper: {
    len: 1.1, crack: 1.4, blast: 1.7, blastLp: 3000, blastDecay: 0.09, boomHz: 110, boom: 1.1,
    thump: [95, 32, 0.22, 0.8], drive: 3.0, mech: [],
  },
};

/** RBJ biquad, used offline while rendering shots and impulse responses. */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number) {
    const w = 2 * Math.PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Small seeded PRNG so every variant of a shot is different but stable. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

/**
 * Renders one gunshot. Layers, in the order you hear them:
 * the supersonic crack (a sub-millisecond N-wave plus a hiss), the muzzle blast (noise that darkens as it decays),
 * a resonant "boom" around 100–200 Hz, and a falling sine thump below that. The sum is soft-clipped, the way
 * gunfire always clips a microphone, which is a big part of why it sounds loud rather than just big.
 */
function renderShot(sp: ShotSpec, sr: number, seed: number): Float32Array {
  const n = Math.floor(sp.len * sr), out = new Float32Array(n), r = rng(seed);
  const jitter = 1 + r() * 0.06;
  const lp1 = new Biquad('lp', sp.blastLp * jitter, 0.7, sr), lp2 = new Biquad('lp', sp.blastLp * 0.5 * jitter, 0.7, sr);
  const boomBp = new Biquad('bp', sp.boomHz * jitter, 1.4, sr);
  const crackHp = new Biquad('hp', 3200, 0.7, sr);
  const [t0, t1, td, tg] = sp.thump;
  const nWave = 0.0006 * sr;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = r();
    // Crack: a single N-wave, then a short bright hiss.
    let crack = i < nWave ? 1 - 2 * i / nWave : 0;
    crack += crackHp.run(w) * Math.exp(-t / 0.006) * 1.6;
    // Blast: brighter at the start, darker as it decays, with a long low tail.
    const benv = (1 - Math.exp(-t / 0.0005)) * (Math.exp(-t / sp.blastDecay) + 0.12 * Math.exp(-t / (sp.blastDecay * 5)));
    const bright = Math.exp(-t / (sp.blastDecay * 0.6));
    const blast = (lp1.run(w) * bright + lp2.run(w) * (1 - bright) * 1.6) * benv;
    const boom = boomBp.run(w) * 4 * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / (sp.blastDecay * 2.2));
    // Thump: a sine that falls quickly in pitch, the punch you feel more than hear.
    const f = t1 + (t0 - t1) * Math.exp(-t / 0.025);
    ph += 2 * Math.PI * f / sr;
    const thump = Math.sin(ph) * (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / td);
    let mech = 0;
    for (const [mt, mf, mg] of sp.mech) {
      if (t < mt) continue;
      const dt = t - mt;
      mech += (Math.sin(2 * Math.PI * mf * dt) * 0.6 + w * 0.4) * Math.exp(-dt / 0.006) * mg;
    }
    out[i] = crack * sp.crack + blast * sp.blast + boom * sp.boom + thump * tg + mech;
  }
  // Saturate, take the DC out, fade the end and normalise.
  const dc = new Biquad('hp', 22, 0.7, sr), k = Math.tanh(sp.drive);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let y = dc.run(Math.tanh(out[i] * sp.drive) / k);
    const fade = Math.min(1, (n - i) / (0.05 * sr));
    y *= fade;
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.95 / peak;
  return out;
}

/**
 * Stereo impulse response for the outdoor tail. Discrete early reflections (walls, containers, berms) come
 * first, then a diffuse tail that loses its highs over time, so the echo rolls away like distant thunder.
 */
function renderImpulse(ctx: BaseAudioContext, env: SoundEnv): AudioBuffer {
  const sr = ctx.sampleRate, len = env === 'town' ? 1.3 : 1.6;
  const n = Math.floor(len * sr), ir = ctx.createBuffer(2, n, sr);
  const reflections: [number, number][] = env === 'town'
    ? [[0.017, 0.55], [0.029, 0.42], [0.044, 0.38], [0.063, 0.3], [0.088, 0.26], [0.12, 0.2], [0.17, 0.16], [0.26, 0.12]]
    : [[0.045, 0.18], [0.19, 0.42], [0.36, 0.12]];
  const decay = env === 'town' ? 0.27 : 0.34;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch), r = rng(91 + ch * 17 + (env === 'town' ? 5 : 0));
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // The tail darkens as it goes: a one-pole lowpass whose cutoff falls from ~5 kHz to ~250 Hz.
      const fc = 350 + 4600 * Math.exp(-t / 0.15);
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      lp += a * (r() - lp);
      const onset = Math.min(1, t / 0.012);
      d[i] = lp * onset * Math.exp(-t / decay) * 0.5;
    }
    // Early reflections, slightly different per ear so the space feels wide.
    for (const [rt, rg] of reflections) {
      const at = Math.floor((rt + r() * 0.004) * sr);
      for (let j = 0; j < 0.003 * sr && at + j < n; j++) d[at + j] += rg * 6 * r() * Math.exp(-j / (0.0008 * sr));
    }
    // Unit energy, so the send levels below mean the same thing whatever the room.
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const k = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return ir;
}

/**
 * All sounds are synthesized with WebAudio (no files). Gunshots are rendered once at startup into a few
 * variants per gun (no two shots sound identical) and played through a convolution reverb for the outdoor tail.
 * A separate low band feeds the reverb harder, so every shot rolls away with a deep boom.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private echoIn!: GainNode;
  private lowIn!: BiquadFilterNode;
  private shots = {} as Record<GunId, AudioBuffer[]>;
  volume = 0.7;
  env: SoundEnv = 'range';

  /** Must be called from a user gesture (the Play click). */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    // Outdoor tail: convolution reverb, its top end rolled off so it never hisses.
    const verb = ctx.createConvolver();
    verb.normalize = false;
    verb.buffer = renderImpulse(ctx, this.env);
    const verbLp = ctx.createBiquadFilter();
    verbLp.type = 'lowpass';
    verbLp.frequency.value = 3200;
    const verbOut = ctx.createGain();
    verbOut.gain.value = this.env === 'town' ? 0.3 : 0.26;
    this.echoIn = ctx.createGain();
    this.echoIn.gain.value = 1;
    this.echoIn.connect(verb).connect(verbLp).connect(verbOut).connect(this.master);
    // The low band of every shot also goes into the reverb on its own: the deep rolling boom.
    this.lowIn = ctx.createBiquadFilter();
    this.lowIn.type = 'lowpass';
    this.lowIn.frequency.value = 260;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.7;
    this.lowIn.connect(lowGain).connect(verb);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    // Four variants of every gun.
    for (const id of Object.keys(SHOTS) as GunId[]) {
      this.shots[id] = [];
      for (let v = 0; v < 4; v++) {
        const pcm = renderShot(SHOTS[id], ctx.sampleRate, 1000 * v + id.length * 7 + 3);
        const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
        buf.getChannelData(0).set(pcm);
        this.shots[id].push(buf);
      }
    }
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
    const ctx = this.ctx!, t = ctx.currentTime;
    const variants = this.shots[id];
    const src = ctx.createBufferSource();
    src.buffer = variants[Math.floor(Math.random() * variants.length)];
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = ctx.createGain();
    g.gain.value = (id === 'sniper' ? 0.75 : id === 'smg' ? 0.55 : 0.65) * (0.92 + Math.random() * 0.08);
    const send = ctx.createGain();
    send.gain.value = id === 'sniper' ? 0.4 : 0.35;
    src.connect(g).connect(this.master);
    g.connect(send).connect(this.echoIn);
    g.connect(this.lowIn);
    src.start(t);
    if (id === 'sniper') {
      // Bolt cycle.
      this.burst(t + 0.55, 0.05, 'bandpass', 2500, 4, 0.35);
      this.burst(t + 0.72, 0.06, 'bandpass', 1900, 4, 0.4);
    }
  }

  /**
   * Routes a sound from a point in the world: quieter and duller with distance, panned left/right, and arriving late
   * (sound travels 343 m/s). Distant sounds lean on the echo. Returns the node to feed, or null when out of earshot.
   */
  private spatial(pos: Vector3, ear: Vector3, yaw: number, gain: number, maxDist: number): AudioNode | null {
    const ctx = this.ctx!, d = pos.distanceTo(ear);
    if (d > maxDist) return null;
    const dx = pos.x - ear.x, dz = pos.z - ear.z;
    // Right of the listener is (cos yaw, -sin yaw) when forward is (-sin yaw, -cos yaw).
    const side = d > 0.01 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(d, 1) : 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.85, Math.min(0.85, side));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, 18000 / (1 + d / 18));
    const g = ctx.createGain();
    g.gain.value = gain / (1 + d / 14);
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = Math.min(1.4, d / 343);
    const send = ctx.createGain();
    send.gain.value = Math.min(0.9, 0.25 + d / 160) * gain;
    delay.connect(lp).connect(g).connect(pan).connect(this.master);
    lp.connect(send).connect(this.echoIn);
    return delay;
  }

  /** Someone else's gunshot. */
  shotAt(id: GunId, pos: Vector3, ear: Vector3, yaw: number) {
    if (!this.ok) return;
    const ctx = this.ctx!, dest = this.spatial(pos, ear, yaw, id === 'sniper' ? 1 : id === 'smg' ? 0.7 : 0.8, 400);
    if (!dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this.shots[id][Math.floor(Math.random() * this.shots[id].length)];
    src.playbackRate.value = 0.95 + Math.random() * 0.06;
    src.connect(dest);
    src.start(ctx.currentTime);
  }

  /** A bullet snapping past your head. */
  whiz(side: number) {
    if (!this.ok) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.9, Math.min(0.9, side));
    pan.connect(this.master);
    this.burst(t, 0.09, 'bandpass', 5200, 2.5, 0.5, 0.004, 1800, pan);
    this.burst(t, 0.03, 'highpass', 6000, 1, 0.25, 0.001, undefined, pan);
  }

  /** Someone else's footstep. */
  stepAt(pos: Vector3, ear: Vector3, yaw: number, sprint: boolean) {
    if (!this.ok) return;
    const dest = this.spatial(pos, ear, yaw, sprint ? 0.9 : 0.6, 35);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.07, 'lowpass', 900, 0.8, 0.5, 0.004, undefined, dest);
    this.burst(t + 0.01, 0.03, 'bandpass', 2600, 2, 0.12, 0.002, undefined, dest);
  }

  /** Someone else's punch landing. */
  punchAt(pos: Vector3, ear: Vector3, yaw: number) {
    if (!this.ok) return;
    const dest = this.spatial(pos, ear, yaw, 1, 30);
    if (!dest) return;
    this.burst(this.ctx!.currentTime, 0.08, 'lowpass', 500, 1, 0.8, 0.002, undefined, dest);
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

  // ------------------------------------------------------------------ fists, loot and battle royale

  punch() {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime, 0.16, 'bandpass', 900, 0.8, 0.22, 0.03, 2200); // whoosh
  }

  punchHit() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.08, 'lowpass', 700, 1, 0.7, 0.002);
    this.tone(t, 0.1, 140, 60, 0.5);
  }

  pickup() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.05, 'bandpass', 2600, 4, 0.3);
    this.burst(t + 0.07, 0.06, 'bandpass', 1500, 4, 0.35);
  }

  cash() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    for (const [d, f] of [[0, 2093], [0.06, 2637], [0.12, 3136]] as const) this.tone(t + d, 0.25, f, f, 0.1, 'triangle');
    this.burst(t, 0.12, 'highpass', 5000, 0.7, 0.12);
  }

  plateStart() {
    if (!this.ok) return;
    this.burst(this.ctx!.currentTime + 0.1, 0.35, 'bandpass', 3000, 0.8, 0.25, 0.01, 1800); // velcro rip
  }

  plateIn() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.06, 'lowpass', 900, 1, 0.6, 0.002);
    this.tone(t, 0.12, 320, 300, 0.12, 'triangle');
  }

  armorFull() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.15, 660, 660, 0.12, 'triangle');
    this.tone(t + 0.1, 0.2, 990, 990, 0.12, 'triangle');
  }

  supplyOpen() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.4, 'bandpass', 500, 2, 0.35, 0.05, 900); // hinge creak
    this.burst(t + 0.35, 0.08, 'lowpass', 600, 1, 0.5);
    for (const [d, f] of [[0.4, 784], [0.5, 988], [0.6, 1175], [0.7, 1568]] as const) this.tone(t + d, 0.4, f, f, 0.08, 'triangle');
  }

  buy() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 0.08, 1200, 1200, 0.15, 'square');
    this.tone(t + 0.08, 0.15, 1800, 1800, 0.12, 'square');
  }

  denied() {
    if (!this.ok) return;
    this.tone(this.ctx!.currentTime, 0.2, 220, 200, 0.15, 'square');
  }

  hurt() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.12, 'lowpass', 500, 1, 0.5, 0.003);
    this.tone(t, 0.15, 90, 50, 0.35);
  }

  cough() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    for (const d of [0, 0.28]) this.burst(t + d, 0.18, 'bandpass', 700 + Math.random() * 300, 1.2, 0.3, 0.01, 400);
  }

  /** Klaxon when the gas starts moving in. */
  gasAlarm() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) this.tone(t + i * 0.45, 0.35, 520, 440, 0.12, 'sawtooth');
  }

  chute() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.5, 'bandpass', 700, 0.7, 0.5, 0.02, 250); // canopy catching air
    this.burst(t + 0.3, 0.12, 'lowpass', 300, 1, 0.5);
  }

  victory() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const notes: [number, number[]][] = [[0, [523, 659, 784]], [0.3, [587, 740, 880]], [0.6, [659, 831, 988, 1319]]];
    for (const [d, fs] of notes) for (const f of fs) this.tone(t + d, d > 0.5 ? 1.6 : 0.35, f, f, 0.07, 'triangle');
  }

  defeat() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    for (const [d, f] of [[0, 392], [0.35, 330], [0.7, 262]] as const) this.tone(t + d, 0.6, f, f * 0.98, 0.09, 'triangle');
  }

  private loops = new Map<string, { gain: GainNode; filter: BiquadFilterNode }>();

  /** Continuous sounds (wind, plane engines), faded by setting their level every frame. 0 = silent. */
  loop(name: 'wind' | 'plane' | 'gas', level: number) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    let l = this.loops.get(name);
    if (!l) {
      if (level <= 0) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      if (name === 'plane') {
        // Engine drone: low noise plus a slightly beating pair of saws through a lowpass.
        filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 2;
        for (const f of [58, 61.5, 116]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = f;
          const og = ctx.createGain(); og.gain.value = 0.25;
          o.connect(og).connect(filter); o.start();
        }
      } else if (name === 'gas') { filter.type = 'bandpass'; filter.frequency.value = 300; filter.Q.value = 0.8; }
      else { filter.type = 'bandpass'; filter.frequency.value = 600; filter.Q.value = 0.5; }
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      l = { gain, filter };
      this.loops.set(name, l);
    }
    l.gain.gain.setTargetAtTime(Math.max(0, level), ctx.currentTime, 0.08);
    if (name === 'wind') l.filter.frequency.setTargetAtTime(300 + level * 900, ctx.currentTime, 0.1);
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
