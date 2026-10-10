import type { Material } from 'three';
import type { Builder } from '../Builder';
import type { TownMaterials } from './TownMaterials';
import type { TreeKind } from './Vegetation';

export type Rect = [number, number, number, number];

/** What a district builder gets from the map: the builder, materials, and the map's bookkeeping helpers. */
export interface Site {
  readonly b: Builder;
  readonly m: TownMaterials;
  readonly rnd: () => number;
  /** Flat ground decal (roads, lots) with world-space UVs, one tile per `tile` metres. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, mat: Material, tile: number): void;
  /** Painted road line, axis aligned. */
  line(x0: number, z0: number, x1: number, z1: number, w: number, color: 'white' | 'yellow'): void;
  sidewalk(x0: number, z0: number, x1: number, z1: number): void;
  tree(x: number, z: number, kind?: TreeKind, scale?: number): void;
  /** Paved ground: thin grass in the cracks only. */
  pave(...r: Rect[]): void;
  /** Covered ground (buildings, yards): no grass, no wild trees. */
  occupy(...r: Rect[]): void;
  /** Tall cover (crop fields, reeds): weeds that hide a crouching player. */
  tall(...r: Rect[]): void;
  inRect(x: number, z: number, list: 'paved' | 'blocked', pad?: number): boolean;
  /** A standing bot (battle royale: one of the players). */
  dummy(x: number, y: number, z: number): void;
  /** A buy station near here. */
  anchor(x: number, z: number): void;
}
