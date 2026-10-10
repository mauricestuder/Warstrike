import {
  Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, type MeshStandardMaterialParameters, type Texture,
} from 'three';
import type { Renderer } from '../../render/Renderer';
import {
  asphaltTex, boardTex, brickTex, chainTex, concreteTex, cornTex, corrugatedTex, grassTex, gravelTex, groundTex, leafTex,
  metalTex, paverTex, plasterTex, roofTileTex, rustPaintTex, sandbagTex, shingleTex, sidingTex, slabTex, stuccoTex, tileTex,
  trackTex, waterNormal, woodTex, type TexSet,
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

/**
 * Breaks up visible texture repetition on big surfaces (ground, roads, walls): the map is sampled a second time at a
 * rotated, larger scale and the two are blended by low-frequency noise, then a broad light/dark variation is laid on
 * top. UVs on world geometry are in metres / tile, so the noise is stable in world space.
 */
export function antiTile(m: MeshStandardMaterial, key: string, blend = 0.8, macro = 0.16) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float atHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float atNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(atHash(i), atHash(i + vec2(1.0, 0.0)), f.x), mix(atHash(i + vec2(0.0, 1.0)), atHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 atUv = vMapUv;
          vec4 atA = texture2D(map, atUv);
          vec4 atB = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * atUv * 0.43 + vec2(0.37, 0.71));
          float atN = atNoise(atUv * 0.21) * 0.65 + atNoise(atUv * 0.53 + 3.1) * 0.35;
          vec4 sampledDiffuseColor = mix(atA, atB, smoothstep(0.38, 0.62, atN) * ${blend.toFixed(3)});
          float atM = atNoise(atUv * 0.047 + 11.0) * 0.7 + atNoise(atUv * 0.13 + 5.0) * 0.3;
          sampledDiffuseColor.rgb *= 1.0 + (atM - 0.5) * ${(macro * 2).toFixed(3)};
          diffuseColor *= sampledDiffuseColor;
        #endif`);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${prevKey()}|at-${key}`;
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
  readonly stucco: MeshStandardMaterial[]; readonly pavers; readonly gravel; readonly barnRed; readonly boardWhite;
  readonly track; readonly roofTile; readonly concretePanel; readonly ballast; readonly corn; readonly lawn; readonly brickDark;
  readonly brickTan; readonly copper; readonly redPaint; readonly bluePaint; readonly greenPaint; readonly whitePaint; readonly neon; readonly hay; readonly redTrack;

  constructor(readonly r: Renderer) {
    const hi = r.quality !== 'low', ultra = r.quality === 'ultra';
    const n = ultra ? 1024 : hi ? 512 : 256, s = ultra ? 512 : hi ? 256 : 128;
    const mk = (t: Partial<TexSet> | null, p: MeshStandardMaterialParameters = {}) =>
      r.setupMaterial(new MeshStandardMaterial({ ...(t ?? {}), metalness: 0, roughness: 1, ...p }));
    const tint = (hex: number) => new Color(hex);

    this.asphalt = mk(asphaltTex(n));
    antiTile(this.asphalt, 'asphalt', 0.7);
    this.slab = mk(slabTex(s));
    antiTile(this.slab, 'slab', 0, 0.14);
    this.grass = mk(grassTex(n), { vertexColors: true });
    antiTile(this.grass, 'grass', 0.85, 0.2);
    this.dirt = mk(groundTex(s));
    antiTile(this.dirt, 'dirt', 0.8);
    const conc = concreteTex(n);
    this.concrete = mk(conc);
    antiTile(this.concrete, 'concrete', 0.6, 0.12);
    this.concreteDark = mk(conc, { color: tint(0x9a968e) });
    antiTile(this.concreteDark, 'concrete', 0.6, 0.12);
    const br = brickTex(n);
    this.brick = mk(br);
    this.brickDark = mk(br, { color: tint(0x8a7a74) });
    this.brickTan = mk(br, { color: tint(0xd8c4a0) });
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
    // Downtown facades: cream, terracotta, sage, sand and grey render.
    const st = stuccoTex(n);
    this.stucco = [0xe6dccb, 0xc98c6c, 0xa9b49a, 0xd8bf8e, 0xa8a8a2, 0x9cb0bc].map((c) => {
      const mat = mk(st, { color: tint(c) });
      antiTile(mat, 'stucco', 0.5, 0.1);
      return mat;
    });
    this.pavers = mk(paverTex(n));
    antiTile(this.pavers, 'pavers', 0, 0.16);
    this.gravel = mk(gravelTex(s));
    antiTile(this.gravel, 'gravel', 0.8);
    const bd = boardTex(n);
    this.barnRed = mk(bd, { color: tint(0xa8483a) });
    this.boardWhite = mk(bd, { color: tint(0xe0dcd0) });
    this.track = mk(trackTex(n));
    antiTile(this.track, 'track', 0.6, 0.18);
    this.roofTile = mk(roofTileTex(n));
    this.concretePanel = mk(conc, { color: tint(0xc4c0b6) });
    this.ballast = mk(gravelTex(s), { color: tint(0x9a8a7a) });
    antiTile(this.ballast, 'gravel', 0.8);
    this.lawn = mk(grassTex(n), { color: tint(0xb4c49a) });
    antiTile(this.lawn, 'grass', 0.85, 0.2);
    this.copper = mk(rustPaintTex(s, [88, 150, 128], 310, 0.15), { metalness: 0.5, roughness: 0.6 });
    this.redPaint = mk(rustPaintTex(s, [150, 40, 34], 320, 0.35), { metalness: 0.25 });
    this.bluePaint = mk(rustPaintTex(s, [44, 72, 120], 330, 0.35), { metalness: 0.25 });
    this.greenPaint = mk(rustPaintTex(s, [52, 90, 60], 340, 0.35), { metalness: 0.25 });
    this.whitePaint = mk(rustPaintTex(s, [214, 212, 204], 350, 0.25), { metalness: 0.2 });
    this.redTrack = mk(gravelTex(s), { color: tint(0xc0705a) });
    antiTile(this.redTrack, 'gravel', 0.8);
    this.hay = mk(sandbagTex(s / 2), { color: tint(0xf0d890) });
    this.neon = mk(null, { color: tint(0x301010), emissive: tint(0xff4a2a), emissiveIntensity: 1.6, roughness: 0.4 });
    this.corn = mk(null, { map: cornTex(s, 361), alphaTest: 0.4, side: DoubleSide, roughness: 0.85, alphaToCoverage: hi });
    addWind(this.corn, 'corn', 'clamp(position.y, 0.0, 3.0) * 0.03');
    const wn = waterNormal(s);
    wn.wrapS = wn.wrapT = RepeatWrapping;
    wn.repeat.set(60, 60);
    this.water = mk(null, { color: tint(0x1d3a44), roughness: 0.06, normalMap: wn, envMapIntensity: 1.2 });
    this.water.normalScale.set(0.35, 0.35);
  }
}
