import { BoxGeometry, BufferAttribute, Color, MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three';
import type { Surface } from '../world/Colliders';
import type { Renderer } from './Renderer';
import { concreteTex, groundTex, metalTex, sandbagTex, woodTex, type TexSet } from './Textures';

/** Shared PBR materials for the world. Built once; texture resolution follows the quality setting. */
export class Materials {
  readonly concrete: MeshStandardMaterial;
  readonly ground: MeshStandardMaterial;
  readonly wood: MeshStandardMaterial;
  readonly metal: MeshStandardMaterial;
  readonly metalDark: MeshStandardMaterial;
  readonly sandbag: MeshStandardMaterial;
  readonly steelPlate: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
  readonly bark: MeshStandardMaterial;
  readonly bySurface: Record<Surface, MeshStandardMaterial>;

  constructor(r: Renderer) {
    const n = r.quality === 'high' ? 512 : 256;
    const mk = (t: TexSet, extra: MeshStandardMaterialParameters = {}) =>
      r.setupMaterial(new MeshStandardMaterial({ ...t, metalness: 0, ...extra }));
    this.concrete = mk(concreteTex(n));
    this.ground = mk(groundTex(n));
    this.wood = mk(woodTex(n));
    this.metal = mk(metalTex(n, [84, 92, 70]), { metalness: 0.55 });
    this.metalDark = mk(metalTex(n, [52, 54, 56]), { metalness: 0.7 });
    this.sandbag = mk(sandbagTex(n / 2));
    this.steelPlate = mk(metalTex(n / 2, [206, 196, 180]), { metalness: 0.4 });
    this.foliage = r.setupMaterial(new MeshStandardMaterial({ color: new Color(0x3d5230), roughness: 0.95, flatShading: true }));
    this.bark = r.setupMaterial(new MeshStandardMaterial({ color: new Color(0x4a3a2c), roughness: 1 }));
    this.bySurface = {
      concrete: this.concrete, wood: this.wood, metal: this.metal, dirt: this.ground, steel: this.steelPlate, sand: this.sandbag,
    };
  }
}

/**
 * A box whose UVs are in world units (one texture tile per `tile` metres) so textures never stretch,
 * whatever the box's proportions.
 */
export function worldBox(w: number, h: number, d: number, tile = 2): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}
