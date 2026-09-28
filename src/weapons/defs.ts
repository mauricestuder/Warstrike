import { DEG } from '../core/math';

export type GunId = 'ar' | 'smg' | 'sniper';

/** Everything that makes one gun feel different from another. Angles in radians unless noted. */
export interface GunDef {
  id: GunId;
  name: string;
  /** Body damage at close range. Targets have 150 HP (100 health + 50 armour). */
  damage: number;
  headMult: number;
  /** Arms/legs multiplier. */
  limbMult: number;
  /** Damage falls off linearly from `falloff[0]` to `falloff[1]` metres, down to `minDamageMul`. */
  falloff: [number, number];
  minDamageMul: number;
  rpm: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  /** Cone half-angle from the hip, while ADS, and extra when moving at full speed. */
  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  /** Extra hip spread per shot, and the cap. Bleeds away when not firing. */
  bloomPerShot: number;
  bloomMax: number;
  /** Seconds to fully aim down sights. */
  adsTime: number;
  /** Seconds after sprinting before the gun can fire. */
  sprintToFire: number;
  /** Movement speed multiplier while holding this gun (ADS multiplies by 0.65 on top). */
  moveMult: number;
  /** Muzzle velocity in m/s; 0 = hitscan (instant). */
  bulletVel: number;
  /** Metres of concrete a round can punch through (wood counts ~half, metal ~double). */
  penetration: number;
  /** Per-shot kick in degrees: [up, right]. Loops the last third once the pattern runs out. */
  pattern: [number, number][];
  /** Random extra kick in degrees on each axis. */
  recoilJitter: number;
  /** First shot kick multiplier (makes tapping honest). */
  firstShotKick: number;
  adsRecoilMul: number;
  /** Optical zoom when aiming. */
  zoom: number;
  scope: boolean;
  /** Seconds to swap to this gun. */
  drawTime: number;
}

/** Builds a learnable spray pattern: steady climb with a gentle S-shaped horizontal drift. */
function pattern(n: number, up: number, upFade: number, drift: number, driftFreq: number, phase: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const climb = up * (1 - upFade * Math.min(1, i / (n * 0.6)));
    const side = drift * Math.sin(i * driftFreq + phase) + drift * 0.35 * Math.sin(i * driftFreq * 2.7);
    out.push([climb, side]);
  }
  return out;
}

export const GUNS: Record<GunId, GunDef> = {
  ar: {
    id: 'ar', name: 'M7 VANGUARD', damage: 29, headMult: 1.45, limbMult: 0.85, falloff: [45, 90], minDamageMul: 0.78,
    rpm: 760, auto: true, mag: 30, reserve: 180, reload: 2.05, reloadEmpty: 2.65,
    hipSpread: 2.1 * DEG, adsSpread: 0.08 * DEG, moveSpread: 1.4 * DEG, bloomPerShot: 0.35 * DEG, bloomMax: 2.2 * DEG,
    adsTime: 0.26, sprintToFire: 0.21, moveMult: 0.96, bulletVel: 760, penetration: 0.4,
    pattern: pattern(30, 0.52, 0.35, 0.16, 0.33, 0.4), recoilJitter: 0.07, firstShotKick: 1.3, adsRecoilMul: 0.8,
    zoom: 1.45, scope: false, drawTime: 0.45,
  },
  smg: {
    id: 'smg', name: 'VIPER-9', damage: 23, headMult: 1.3, limbMult: 0.9, falloff: [12, 32], minDamageMul: 0.62,
    rpm: 920, auto: true, mag: 32, reserve: 192, reload: 1.75, reloadEmpty: 2.2,
    hipSpread: 1.6 * DEG, adsSpread: 0.28 * DEG, moveSpread: 0.6 * DEG, bloomPerShot: 0.18 * DEG, bloomMax: 1.3 * DEG,
    adsTime: 0.17, sprintToFire: 0.11, moveMult: 1.04, bulletVel: 0, penetration: 0.12,
    pattern: pattern(32, 0.36, 0.2, 0.2, 0.55, 2.1), recoilJitter: 0.12, firstShotKick: 1.15, adsRecoilMul: 0.85,
    zoom: 1.15, scope: false, drawTime: 0.35,
  },
  sniper: {
    id: 'sniper', name: 'LONGBOW .338', damage: 118, headMult: 2.2, limbMult: 0.8, falloff: [150, 400], minDamageMul: 0.85,
    rpm: 46, auto: false, mag: 5, reserve: 25, reload: 3.1, reloadEmpty: 3.7,
    hipSpread: 5 * DEG, adsSpread: 0, moveSpread: 2.5 * DEG, bloomPerShot: 0, bloomMax: 0,
    adsTime: 0.45, sprintToFire: 0.38, moveMult: 0.9, bulletVel: 880, penetration: 0.9,
    pattern: [[3.2, 0.4]], recoilJitter: 0.4, firstShotKick: 1, adsRecoilMul: 0.9,
    zoom: 6, scope: true, drawTime: 0.6,
  },
};

export const LOADOUT: GunId[] = ['ar', 'smg', 'sniper'];

/** Damage multiplier at a distance. */
export function falloffMul(d: GunDef, dist: number): number {
  const [a, b] = d.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return d.minDamageMul;
  return 1 + (d.minDamageMul - 1) * ((dist - a) / (b - a));
}
