import type { Vector3 } from 'three';
import type { Colliders } from './Colliders';
import type { Foliage } from './Foliage';

export interface SteelSpot { pos: Vector3; w: number; h: number; }
export interface BotLane { center: Vector3; halfWidth: number; }

/** What the game needs from a map: collision, where you start, what to shoot at, and per-frame animation. */
export interface World {
  readonly colliders: Colliders;
  /** Bushes, tree crowns and tall grass that hide people from the bots (maps without any leave it out). */
  readonly foliage?: Foliage;
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
  /** Playable area (battle royale maps). */
  readonly bounds?: { x0: number; x1: number; z0: number; z1: number };
  /** Rough places for buy stations; the loot system finds open ground nearby. */
  readonly stationAnchors?: [number, number][];
  /** Prepares the scene for the top-down map capture (hides grass, which is only drawn near the player). */
  mapView?(on: boolean): void;
  /** Per-frame animation and level-of-detail; `viewer` is the camera position. */
  update(dt: number, viewer: Vector3): void;
}
