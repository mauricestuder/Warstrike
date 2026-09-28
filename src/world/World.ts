import type { Vector3 } from 'three';
import type { Colliders } from './Colliders';

export interface SteelSpot { pos: Vector3; w: number; h: number; }
export interface BotLane { center: Vector3; halfWidth: number; }

/** What the game needs from a map: collision, where you start, what to shoot at, and per-frame animation. */
export interface World {
  readonly colliders: Colliders;
  readonly spawn: Vector3;
  /** Facing at spawn (0 = looking toward -z). */
  readonly spawnYaw: number;
  readonly steel: SteelSpot[];
  /** Bots that strafe left/right along x around a centre. */
  readonly botLanes: BotLane[];
  /** Bots that stand still. */
  readonly wallDummies: Vector3[];
  readonly infiniteAmmo: boolean;
  /** Shown once when you first drop in. */
  readonly welcome: string;
  /** Per-frame animation and level-of-detail; `viewer` is the camera position. */
  update(dt: number, viewer: Vector3): void;
}
