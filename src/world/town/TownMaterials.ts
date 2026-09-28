import {
  Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, type MeshStandardMaterialParameters, type Texture,
} from 'three';
import type { Renderer } from '../../render/Renderer';
import {
  asphaltTex, brickTex, chainTex, concreteTex, corrugatedTex, grassTex, groundTex, leafTex, metalTex, plasterTex,
  rustPaintTex, sandbagTex, shingleTex, sidingTex, slabTex, tileTex, waterNormal, woodTex, type TexSet,
} from '../../render/Textures';

/** Shared uniform for everything that sways in the wind (grass, leaves). */
export const WIND = { value: 0 };

/**
 * Patches a material so vertices sway with the wind. `weight` is GLSL for how much a vertex moves,
 * computed from `position` (local) and `wpos` (world).
 */
export function addWind(m: MeshStandardMaterial, key: string, weight: string) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms.uWind = WIND;
    shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 wpos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
        #endif
        wpos = modelMatrix * wpos;
        float gust = 0.6 + 0.4 * sin(uWind * 0.37 + wpos.x * 0.021);
        float sway = (sin(uWind * 1.7 + wpos.x * 0.31 + wpos.z * 0.23) + 0.45 * sin(uWind * 3.1 + wpos.z * 0.8)) * gust;
        float w = ${weight};
        transformed.x += sway * w;
        transformed.z += sway * w * 0.6;
      }`);
  };
  m.customProgramCacheKey = () => `wind-${key}`;
}

/** Every material the town uses. Textures scale with the quality setting. */
export class TownMaterials {
  readonly asphalt; readonly slab; readonly grass; readonly dirt; readonly concrete; readonly concreteDark; readonly brick;
  readonly siding: MeshStandardMaterial[]; readonly shingle; readonly shingleRed; readonly trim; readonly plaster;
  readonly plasterBlue; readonly floorWood; readonly tile; readonly wood; readonly woodGrey; readonly metal; readonly steel;
  readonly containers: MeshStandardMaterial[]; readonly warehouse; readonly craneYellow; readonly tankWhite;
  readonly carPaint: MeshStandardMaterial[]; readonly rust; readonly pumpRed; readonly glass; readonly rubber;
  readonly chrome; readonly fabric: MeshStandardMaterial[]; readonly charred; readonly leaves; readonly leavesDry;
  readonly bushLeaves; readonly ivy; readonly bark; readonly deadBark; readonly chain; readonly water; readonly sandbag;
  readonly black; readonly white; readonly lampGlass; readonly yellowPaint; readonly grassBlade; readonly hazard;

  constructor(readonly r: Renderer) {
    const hi = r.quality === 'high', n = hi ? 512 : 256, s = hi ? 256 : 128;
    const mk = (t: Partial<TexSet> | null, p: MeshStandardMaterialParameters = {}) =>
      r.setupMaterial(new MeshStandardMaterial({ ...(t ?? {}), metalness: 0, roughness: 1, ...p }));
    const tint = (hex: number) => new Color(hex);

    this.asphalt = mk(asphaltTex(n));
    this.slab = mk(slabTex(s));
    this.grass = mk(grassTex(n), { vertexColors: true });
    this.dirt = mk(groundTex(s));
    const conc = concreteTex(n);
    this.concrete = mk(conc);
    this.concreteDark = mk(conc, { color: tint(0x9a968e) });
    this.brick = mk(brickTex(n));
    const sid = sidingTex(n);
    // Faded house colours: pale blue, butter yellow, white, sage green, barn red.
    this.siding = [0xa9bccb, 0xd9c98e, 0xe8e4da, 0xa7b394, 0xa0584a].map((c) => mk(sid, { color: tint(c) }));
    const sh = shingleTex(n);
    this.shingle = mk(sh);
    this.shingleRed = mk(sh, { color: tint(0xb07a6a) });
    this.trim = mk(null, { color: tint(0xd8d4c8), roughness: 0.7 });
    const pl = plasterTex(s);
    // Interiors: sky light doesn't reach inside, so tone the image-based light down on indoor surfaces.
    const indoor = { envMapIntensity: 0.25 };
    this.plaster = mk(pl, { color: tint(0xd2cbbf), ...indoor });
    this.plasterBlue = mk(pl, { color: tint(0xb8c8d0), ...indoor });
    const wd = woodTex(s);
    this.floorWood = mk(wd, { color: tint(0xd8c0a0), ...indoor });
    this.wood = mk(wd);
    this.woodGrey = mk(wd, { color: tint(0x9a948a) });
    this.tile = mk(tileTex(s), indoor);
    this.metal = mk(metalTex(s, [120, 122, 118]), { metalness: 0.6 });
    this.steel = mk(metalTex(s, [70, 72, 74]), { metalness: 0.7 });
    // Shipping lines' colours.
    this.containers = ([[150, 52, 38], [38, 74, 118], [48, 94, 64], [186, 104, 38], [128, 132, 134], [120, 30, 34]] as const)
      .map((c, i) => mk(corrugatedTex(s, [c[0], c[1], c[2]], 150 + i * 7), { metalness: 0.35 }));
    this.warehouse = mk(corrugatedTex(n, [176, 178, 170], 190, 8), { metalness: 0.35 });
    this.craneYellow = mk(rustPaintTex(s, [214, 164, 28], 200, 0.35), { metalness: 0.3 });
    this.tankWhite = mk(rustPaintTex(n, [206, 204, 196], 210, 0.55), { metalness: 0.25 });
    this.carPaint = ([[132, 34, 30], [46, 70, 104], [196, 190, 178], [58, 82, 64], [156, 134, 92]] as const)
      .map((c, i) => mk(rustPaintTex(s, [c[0], c[1], c[2]], 220 + i * 9, 0.4 + (i % 3) * 0.15), { metalness: 0.3 }));
    this.rust = mk(rustPaintTex(s, [90, 60, 40], 270, 1), { metalness: 0.4 });
    this.pumpRed = mk(rustPaintTex(s, [168, 36, 34], 280, 0.3), { metalness: 0.2 });
    this.yellowPaint = mk(rustPaintTex(s, [206, 170, 40], 290, 0.3));
    this.glass = mk(null, { color: tint(0x1a2226), roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
    this.lampGlass = mk(null, { color: tint(0xd8d6c8), roughness: 0.3, emissive: tint(0x222018) });
    this.rubber = mk(null, { color: tint(0x1c1c1c), roughness: 0.9 });
    this.chrome = mk(null, { color: tint(0x9a9a96), roughness: 0.35, metalness: 0.9 });
    this.black = mk(null, { color: tint(0x151617), roughness: 0.8 });
    this.white = mk(null, { color: tint(0xe0ddd4), roughness: 0.6 });
    this.hazard = mk(null, { color: tint(0xc8a030), roughness: 0.7 });
    this.fabric = [0x6b5a48, 0x4a5a6a, 0x7a3e36, 0x5a6048].map((c) => mk(sandbagTex(s / 2), { color: tint(c) }));
    this.charred = mk(wd, { color: tint(0x2a2622), roughness: 1 });
    this.sandbag = mk(sandbagTex(s / 2));

    const leafMat = (t: Texture, color: number, key: string, weight: string) => {
      const m = mk(null, { map: t, color: tint(color), alphaTest: 0.42, side: DoubleSide, roughness: 0.85, alphaToCoverage: hi });
      addWind(m, key, weight);
      return m;
    };
    const lt = leafTex(s * 2, 301, [78, 112]);
    this.leaves = leafMat(lt, 0xffffff, 'leaves', 'clamp(wpos.y - 2.5, 0.0, 10.0) * 0.012');
    this.leavesDry = leafMat(leafTex(s * 2, 302, [34, 62], 44, 36), 0xffffff, 'leaves', 'clamp(wpos.y - 2.5, 0.0, 10.0) * 0.012');
    this.bushLeaves = leafMat(lt, 0x8a9a78, 'bush', 'clamp(wpos.y, 0.0, 2.0) * 0.02');
    this.ivy = mk(null, { map: leafTex(s * 2, 303, [90, 120], 34, 24), alphaTest: 0.42, side: DoubleSide, roughness: 0.85, alphaToCoverage: hi });
    this.bark = mk(wd, { color: tint(0x5a4a3c) });
    this.deadBark = mk(wd, { color: tint(0x6a625a) });
    const ch = chainTex(32);
    this.chain = mk(null, { map: ch, alphaTest: 0.22, side: DoubleSide, metalness: 0.6, roughness: 0.5, alphaToCoverage: hi });
    this.grassBlade = mk(null, { vertexColors: true, side: DoubleSide, roughness: 0.9 });
    addWind(this.grassBlade, 'grass', 'position.y * position.y * 0.3');
    const wn = waterNormal(s);
    wn.wrapS = wn.wrapT = RepeatWrapping;
    wn.repeat.set(60, 60);
    this.water = mk(null, { color: tint(0x1d3a44), roughness: 0.06, normalMap: wn, envMapIntensity: 1.2 });
    this.water.normalScale.set(0.35, 0.35);
  }
}
