import { DEG } from '../core/math';

export type GunId = 'ar' | 'smg' | 'sniper';
/** Everything you can hold: a gun or your bare hands. */
export type WeaponId = GunId | 'hands';
export type AmmoType = 'rifle' | 'smg' | 'sniper';

/** Everything that makes one gun feel different from another. Angles in radians unless noted. */
export interface GunDef {
  id: WeaponId;
  name: string;
  ammo: AmmoType;
  /** Sprint speed multiplier (light weapons let you run faster). */
  sprintMult: number;
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
    id: 'ar', name: 'M7 VANGUARD', ammo: 'rifle', sprintMult: 1, damage: 29, headMult: 1.45, limbMult: 0.85, falloff: [45, 90], minDamageMul: 0.78,
    rpm: 760, auto: true, mag: 30, reserve: 180, reload: 2.05, reloadEmpty: 2.65,
    hipSpread: 2.1 * DEG, adsSpread: 0.08 * DEG, moveSpread: 1.4 * DEG, bloomPerShot: 0.35 * DEG, bloomMax: 2.2 * DEG,
    adsTime: 0.26, sprintToFire: 0.21, moveMult: 0.96, bulletVel: 760, penetration: 0.4,
    pattern: pattern(30, 0.52, 0.35, 0.16, 0.33, 0.4), recoilJitter: 0.07, firstShotKick: 1.3, adsRecoilMul: 0.8,
    zoom: 1.45, scope: false, drawTime: 0.45,
  },
  smg: {
    id: 'smg', name: 'VIPER-9', ammo: 'smg', sprintMult: 1.03, damage: 23, headMult: 1.3, limbMult: 0.9, falloff: [12, 32], minDamageMul: 0.62,
    rpm: 920, auto: true, mag: 32, reserve: 192, reload: 1.75, reloadEmpty: 2.2,
    hipSpread: 1.6 * DEG, adsSpread: 0.28 * DEG, moveSpread: 0.6 * DEG, bloomPerShot: 0.18 * DEG, bloomMax: 1.3 * DEG,
    adsTime: 0.17, sprintToFire: 0.11, moveMult: 1.04, bulletVel: 0, penetration: 0.12,
    pattern: pattern(32, 0.36, 0.2, 0.2, 0.55, 2.1), recoilJitter: 0.12, firstShotKick: 1.15, adsRecoilMul: 0.85,
    zoom: 1.15, scope: false, drawTime: 0.35,
  },
  sniper: {
    id: 'sniper', name: 'LONGBOW .338', ammo: 'sniper', sprintMult: 0.96, damage: 118, headMult: 2.2, limbMult: 0.8, falloff: [150, 400], minDamageMul: 0.85,
    rpm: 46, auto: false, mag: 5, reserve: 25, reload: 3.1, reloadEmpty: 3.7,
    hipSpread: 5 * DEG, adsSpread: 0, moveSpread: 2.5 * DEG, bloomPerShot: 0, bloomMax: 0,
    adsTime: 0.45, sprintToFire: 0.38, moveMult: 0.9, bulletVel: 880, penetration: 0.9,
    pattern: [[3.2, 0.4]], recoilJitter: 0.4, firstShotKick: 1, adsRecoilMul: 0.9,
    zoom: 6, scope: true, drawTime: 0.6,
  },
};

export const LOADOUT: GunId[] = ['ar', 'smg', 'sniper'];

/** Bare hands: no gun to carry, so you move faster. Left click punches. */
export const HANDS: GunDef = {
  id: 'hands', name: 'FISTS', ammo: 'rifle', sprintMult: 1.1, damage: 34, headMult: 1.5, limbMult: 0.8, falloff: [10, 20],
  minDamageMul: 1, rpm: 140, auto: false, mag: 0, reserve: 0, reload: 1, reloadEmpty: 1, hipSpread: 0, adsSpread: 0,
  moveSpread: 0, bloomPerShot: 0, bloomMax: 0, adsTime: 0.2, sprintToFire: 0.08, moveMult: 1.1, bulletVel: 0,
  penetration: 0, pattern: [[0, 0]], recoilJitter: 0, firstShotKick: 1, adsRecoilMul: 1, zoom: 1, scope: false, drawTime: 0.25,
};
/** How far a punch reaches. */
export const MELEE_RANGE = 2.1;

/** Most ammo you can carry of each type, and how much one ammo box holds. */
export const AMMO_MAX: Record<AmmoType, number> = { rifle: 240, smg: 256, sniper: 30 };
export const AMMO_BOX: Record<AmmoType, number> = { rifle: 60, smg: 64, sniper: 10 };
export const AMMO_NAME: Record<AmmoType, string> = { rifle: 'Rifle ammo', smg: 'SMG ammo', sniper: 'Sniper ammo' };

/** Grey → gold. Better rarity = more damage and less recoil, and the gun's furniture takes the rarity colour. */
export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY = [
  { name: 'Common', color: '#b9bec4', dmg: 1, recoil: 1 },
  { name: 'Uncommon', color: '#5fd35a', dmg: 1.05, recoil: 0.95 },
  { name: 'Rare', color: '#3fa0ff', dmg: 1.1, recoil: 0.9 },
  { name: 'Epic', color: '#b35cff', dmg: 1.15, recoil: 0.85 },
  { name: 'Legendary', color: '#ffb02e', dmg: 1.2, recoil: 0.78 },
] as const;

const rarityCache = new Map<string, GunDef>();
/** The gun's stats at a rarity (cached, so the same object comes back every time). */
export function rarityDef(id: GunId, r: Rarity): GunDef {
  const key = `${id}:${r}`;
  let d = rarityCache.get(key);
  if (!d) {
    const b = GUNS[id], k = RARITY[r];
    d = { ...b, damage: b.damage * k.dmg, pattern: b.pattern.map(([u, s]) => [u * k.recoil, s * k.recoil] as [number, number]), recoilJitter: b.recoilJitter * k.recoil };
    rarityCache.set(key, d);
  }
  return d;
}

/** Damage multiplier at a distance. */
export function falloffMul(d: GunDef, dist: number): number {
  const [a, b] = d.falloff;
  if (dist <= a) return 1;
  if (dist >= b) return d.minDamageMul;
  return 1 + (d.minDamageMul - 1) * ((dist - a) / (b - a));
}
