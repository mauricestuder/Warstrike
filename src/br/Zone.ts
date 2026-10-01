import { CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, Vector2, type Scene } from 'three';

interface Phase {
  /** Seconds the circle holds before moving in. */
  wait: number;
  /** Seconds it takes to shrink to the next circle. */
  shrink: number;
  /** Radius it shrinks to. */
  r: number;
  /** Damage per second outside the circle during this phase (ignores armour). */
  dps: number;
}

/** Five phases, about five and a half minutes in total. The first wait covers the flight and the drop. */
const PHASES: Phase[] = [
  { wait: 80, shrink: 40, r: 105, dps: 2 },
  { wait: 40, shrink: 30, r: 62, dps: 4 },
  { wait: 30, shrink: 25, r: 34, dps: 7 },
  { wait: 25, shrink: 20, r: 15, dps: 11 },
  { wait: 20, shrink: 25, r: 0, dps: 18 },
];
const FINAL_DPS = 30;

const vert = /* glsl */ `
  varying vec3 vWorld;
  varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vH = position.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vWorld;
  varying float vH;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // Coordinate around the wall (angle × a big number keeps detail even) and up it.
    float a = atan(vWorld.z, vWorld.x) * 60.0;
    float y = vWorld.y;
    float n = noise(vec2(a * 0.6 + uTime * 0.4, y * 0.08 - uTime * 0.25)) * 0.6
            + noise(vec2(a * 1.7 - uTime * 0.7, y * 0.2 + uTime * 0.3)) * 0.4;
    float fade = smoothstep(1.0, 0.55, vH) * smoothstep(-0.02, 0.03, vH);
    vec3 col = mix(vec3(0.62, 0.68, 0.16), vec3(0.95, 0.78, 0.25), n);
    gl_FragColor = vec4(col * 1.4, (0.14 + n * 0.24) * fade * uOpacity);
  }`;

/**
 * The closing gas: a circle that holds, then shrinks toward a new random circle inside it, phase after phase.
 * Outside the circle you take damage that ignores armour. Drawn as a tall glowing wall of churning gas.
 */
export class Zone {
  /** Circle centres and radii: index 0 covers the whole map, index i+1 is where phase i shrinks to. */
  private centers: Vector2[] = [];
  private radii: number[] = [];
  time = 0;
  readonly center = new Vector2();
  radius = 0;
  private wall: Mesh;
  private mat: ShaderMaterial;
  private lastStage = '';
  /** Called when a phase starts closing ("shrink") or a new circle is revealed ("wait"). */
  onStage: (stage: 'wait' | 'shrink' | 'final', phase: number) => void = () => {};

  constructor(scene: Scene, start: Vector2, startR: number, bounds: { x0: number; x1: number; z0: number; z1: number }, rnd: () => number) {
    this.centers.push(start.clone());
    this.radii.push(startR);
    for (const p of PHASES) {
      const pc = this.centers[this.centers.length - 1], pr = this.radii[this.radii.length - 1];
      let c = pc.clone();
      // A random point that keeps the new circle inside the old one and on land, away from the map edge.
      for (let k = 0; k < 60; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * Math.max(0, pr - p.r) * 0.85;
        const t = new Vector2(pc.x + Math.cos(a) * d, pc.y + Math.sin(a) * d);
        const m = Math.min(p.r * 0.6, 40) + 12;
        if (t.x > bounds.x0 + m && t.x < bounds.x1 - m && t.y > bounds.z0 + m && t.y < bounds.z1 - m) { c = t; break; }
      }
      this.centers.push(c);
      this.radii.push(p.r);
    }
    this.mat = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } }, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, side: DoubleSide, fog: false,
    });
    this.wall = new Mesh(new CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0), this.mat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 3;
    scene.add(this.wall);
    this.update(0);
  }

  /** Which phase we're in, whether it's holding or shrinking, and seconds left in that stage. */
  get state(): { phase: number; stage: 'wait' | 'shrink' | 'final'; left: number; k: number } {
    let t = this.time;
    for (let i = 0; i < PHASES.length; i++) {
      const p = PHASES[i];
      if (t < p.wait) return { phase: i, stage: 'wait', left: p.wait - t, k: 0 };
      t -= p.wait;
      if (t < p.shrink) return { phase: i, stage: 'shrink', left: p.shrink - t, k: t / p.shrink };
      t -= p.shrink;
    }
    return { phase: PHASES.length, stage: 'final', left: 0, k: 1 };
  }

  get dps() {
    const s = this.state;
    return s.phase < PHASES.length ? PHASES[s.phase].dps : FINAL_DPS;
  }

  /** The circle the gas is heading to (the current one while holding). */
  get next(): { c: Vector2; r: number } {
    const i = Math.min(this.state.phase + 1, this.centers.length - 1);
    return { c: this.centers[i], r: this.radii[i] };
  }

  set opacity(v: number) { this.mat.uniforms.uOpacity.value = v; }

  /** How far outside the circle a point is (negative = safe inside). */
  outside(x: number, z: number) { return Math.hypot(x - this.center.x, z - this.center.y) - this.radius; }

  update(dt: number) {
    this.time += dt;
    const s = this.state;
    const i = Math.min(s.phase, this.centers.length - 1), j = Math.min(s.phase + 1, this.centers.length - 1);
    if (s.stage === 'shrink') {
      this.center.lerpVectors(this.centers[i], this.centers[j], s.k);
      this.radius = this.radii[i] + (this.radii[j] - this.radii[i]) * s.k;
    } else if (s.stage === 'final') {
      this.center.copy(this.centers[this.centers.length - 1]);
      this.radius = 0;
    } else {
      this.center.copy(this.centers[i]);
      this.radius = this.radii[i];
    }
    const key = `${s.phase}:${s.stage}`;
    if (key !== this.lastStage) {
      if (this.lastStage) this.onStage(s.stage, s.phase);
      this.lastStage = key;
    }
    this.mat.uniforms.uTime.value = this.time;
    this.wall.position.set(this.center.x, -20, this.center.y);
    this.wall.scale.set(Math.max(this.radius, 0.01), 320, Math.max(this.radius, 0.01));
  }
}
