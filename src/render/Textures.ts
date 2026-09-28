import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedural PBR texture sets (albedo + normal + roughness), painted on canvases at startup so the whole game
 * stays one self-contained HTML file. Every texture tiles seamlessly.
 */
export interface TexSet {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
}

type RGB = [number, number, number];

/** Tileable value-noise fractal (fbm) over an N×N grid. */
function fbm(n: number, seed: number, baseCells: number, octaves: number, gain = 0.5): Float32Array {
  const out = new Float32Array(n * n);
  const rnd = mulberry32(seed);
  let amp = 1, cells = baseCells, total = 0;
  for (let o = 0; o < octaves; o++) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const y1 = (y0 + 1) % cells;
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % cells;
        const a = lattice[y0 * cells + x0], b = lattice[y0 * cells + x1];
        const c = lattice[y1 * cells + x0], d = lattice[y1 * cells + x1];
        out[y * n + x] += amp * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy);
      }
    }
    total += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  return { c, ctx, img: ctx.createImageData(n, n) };
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat: number): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/** Builds the three maps from a height field plus per-pixel colour and roughness callbacks. */
function build(n: number, h: Float32Array, color: (i: number, x: number, y: number) => RGB,
  rough: (i: number) => number, bump: number, repeat: number): TexSet {
  const alb = canvas(n), nor = canvas(n), rgh = canvas(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x, p = i * 4;
      const [r, g, b] = color(i, x, y);
      alb.img.data[p] = r; alb.img.data[p + 1] = g; alb.img.data[p + 2] = b; alb.img.data[p + 3] = 255;
      // Sobel-ish normal from the wrapped height field.
      const l = h[y * n + ((x - 1 + n) % n)], rr = h[y * n + ((x + 1) % n)];
      const u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
      let nx = (l - rr) * bump, ny = (u - d) * bump, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      nor.img.data[p] = (nx * 0.5 + 0.5) * 255; nor.img.data[p + 1] = (ny * 0.5 + 0.5) * 255;
      nor.img.data[p + 2] = (nz * 0.5 + 0.5) * 255; nor.img.data[p + 3] = 255;
      const ro = Math.max(0, Math.min(1, rough(i))) * 255;
      rgh.img.data[p] = rgh.img.data[p + 1] = rgh.img.data[p + 2] = ro; rgh.img.data[p + 3] = 255;
    }
  }
  alb.ctx.putImageData(alb.img, 0, 0);
  nor.ctx.putImageData(nor.img, 0, 0);
  rgh.ctx.putImageData(rgh.img, 0, 0);
  return { map: finish(alb.c, true, repeat), normalMap: finish(nor.c, false, repeat), roughnessMap: finish(rgh.c, false, repeat) };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export function concreteTex(n: number): TexSet {
  const h = fbm(n, 11, 8, 6, 0.55), spots = fbm(n, 12, 4, 4);
  const pores = mulberry32(13);
  const pit = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) pit[i] = pores() < 0.012 ? -0.35 : 0;
  for (let i = 0; i < h.length; i++) h[i] += pit[i];
  return build(n, h,
    (i) => shade(mix([150, 148, 142], [118, 116, 112], spots[i]), 0.8 + h[i] * 0.4),
    (i) => 0.82 + spots[i] * 0.15 - pit[i] * 0.2, 2.2, 1);
}

export function groundTex(n: number): TexSet {
  const h = fbm(n, 21, 16, 6, 0.6), patch = fbm(n, 22, 3, 4);
  const pebbles = mulberry32(23);
  for (let k = 0; k < n * 1.5; k++) {
    const cx = Math.floor(pebbles() * n), cy = Math.floor(pebbles() * n), r = 1 + pebbles() * 3;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dd = Math.hypot(dx, dy);
      if (dd > r) continue;
      const i = ((cy + dy + n) % n) * n + ((cx + dx + n) % n);
      h[i] += (1 - dd / r) * 0.35;
    }
  }
  return build(n, h,
    (i) => shade(mix([118, 100, 74], [92, 96, 62], patch[i] * patch[i] * 1.6), 0.7 + h[i] * 0.55),
    (i) => 0.92 - h[i] * 0.1, 3, 1);
}

export function woodTex(n: number): TexSet {
  const grain = fbm(n, 31, 4, 5), h = new Float32Array(n * n);
  const planks = 6, plankH = n / planks, tint = mulberry32(32);
  const plankTint = Array.from({ length: planks }, () => 0.85 + tint() * 0.3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, p = Math.floor(y / plankH);
    const rings = Math.sin((x / n) * 40 + grain[i] * 18 + p * 7) * 0.5 + 0.5;
    const edge = y % plankH < 2 ? -0.6 : 0;
    h[i] = rings * 0.25 + grain[i] * 0.4 + edge;
    grain[i] = rings * plankTint[p];
  }
  return build(n, h,
    (i) => (h[i] < -0.2 ? [40, 28, 18] : shade(mix([150, 110, 68], [112, 78, 46], grain[i]), 1)),
    (i) => 0.75 + h[i] * 0.1, 1.6, 1);
}

export function metalTex(n: number, paint: RGB): TexSet {
  const h = fbm(n, 41, 8, 5), scratches = mulberry32(42), wear = fbm(n, 43, 6, 5);
  const scratch = new Float32Array(n * n);
  for (let k = 0; k < 90; k++) {
    let x = scratches() * n, y = scratches() * n;
    const a = scratches() * Math.PI, len = 10 + scratches() * 60;
    for (let s = 0; s < len; s++) {
      x += Math.cos(a); y += Math.sin(a);
      scratch[(((y | 0) % n + n) % n) * n + (((x | 0) % n + n) % n)] = 1;
    }
  }
  return build(n, h,
    (i) => (scratch[i] || wear[i] > 0.8 ? [118, 118, 120] : shade(paint, 0.85 + h[i] * 0.3)),
    (i) => (scratch[i] || wear[i] > 0.8 ? 0.4 : 0.6 + h[i] * 0.2), 0.8, 1);
}

export function sandbagTex(n: number): TexSet {
  const weave = new Float32Array(n * n), h = fbm(n, 51, 8, 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    weave[i] = ((x >> 1) + (y >> 1)) % 2 ? 0.15 : 0;
    h[i] = h[i] * 0.6 + weave[i];
  }
  return build(n, h, (i) => shade([142, 124, 90], 0.8 + h[i] * 0.3), () => 0.95, 2.5, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Town textures
// ---------------------------------------------------------------------------------------------------------------

const wrapI = (n: number, x: number, y: number) => ((((y | 0) % n) + n) % n) * n + ((((x | 0) % n) + n) % n);

/** Branching hairline cracks (1 = crack) that wrap around the tile edges. */
function cracks(n: number, seed: number, count: number, len: number, width = 1): Float32Array {
  const m = new Float32Array(n * n), rnd = mulberry32(seed);
  const walk = (x: number, y: number, a: number, l: number, depth: number) => {
    for (let s = 0; s < l; s++) {
      a += (rnd() - 0.5) * 0.55;
      x += Math.cos(a); y += Math.sin(a);
      m[wrapI(n, x, y)] = 1;
      if (width > 1) { m[wrapI(n, x + 1, y)] = 1; m[wrapI(n, x, y + 1)] = 1; }
      if (depth < 2 && rnd() < 0.01) walk(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.7), l * 0.45, depth + 1);
    }
  };
  for (let k = 0; k < count; k++) walk(rnd() * n, rnd() * n, rnd() * Math.PI * 2, len * (0.5 + rnd()), 0);
  return m;
}

/** 1-D tileable value noise across columns: gives perfectly vertical streaks (rust runs, grime). */
function columns(n: number, seed: number, cells: number, octaves = 3): Float32Array {
  const out = new Float32Array(n), rnd = mulberry32(seed);
  let amp = 1, c = cells, total = 0;
  for (let o = 0; o < octaves; o++) {
    const lat = Array.from({ length: c }, () => rnd());
    for (let x = 0; x < n; x++) {
      const f = (x / n) * c, i = Math.floor(f), t = f - i, s = t * t * (3 - 2 * t);
      out[x] += amp * (lat[i % c] + (lat[(i + 1) % c] - lat[i % c]) * s);
    }
    total += amp; amp *= 0.5; c *= 2;
  }
  for (let x = 0; x < n; x++) out[x] /= total;
  return out;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Weathered asphalt: aggregate grit, sealed tar snakes, open cracks and lighter worn patches. */
export function asphaltTex(n: number): TexSet {
  const h = fbm(n, 61, 32, 4, 0.6), patch = fbm(n, 62, 3, 4), crack = cracks(n, 63, 4, n * 0.7);
  const tar = cracks(n, 65, 3, n * 0.9, 2), grit = mulberry32(64), g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    g[i] = grit() < 0.1 ? grit() * 0.55 : 0;
    h[i] = h[i] * 0.45 + g[i] - crack[i] * 0.9;
  }
  return build(n, h,
    (i) => crack[i] ? [24, 24, 23] : tar[i] ? [30, 30, 30]
      : shade(mix([98, 97, 94], [72, 72, 70], sstep(0.35, 0.7, patch[i])), 0.8 + g[i] * 0.9 + h[i] * 0.2),
    (i) => (crack[i] ? 1 : tar[i] ? 0.45 : 0.9 - g[i] * 0.25 + patch[i] * 0.06), 1.8, 1);
}

/** One sidewalk slab per tile: seams with moss, a couple of cracks, stained concrete. */
export function slabTex(n: number): TexSet {
  const h = fbm(n, 71, 8, 6, 0.55), stain = fbm(n, 72, 3, 4), crack = cracks(n, 73, 2, n * 0.5);
  const seam = (x: number, y: number) => x < 3 || y < 3 || x > n - 3 || y > n - 3;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (seam(x, y)) h[i] -= 0.7;
    h[i] -= crack[i] * 0.5;
  }
  return build(n, h, (i, x, y) => {
    if (seam(x, y)) return stain[i] > 0.45 ? [58, 72, 38] : [70, 68, 62];
    if (crack[i]) return [60, 58, 54];
    return shade(mix([168, 164, 156], [128, 124, 116], sstep(0.4, 0.75, stain[i])), 0.82 + h[i] * 0.3);
  }, (i) => 0.85 + stain[i] * 0.1, 2, 1);
}

/** Overgrown ground: patchy green and straw-coloured grass over dirt. */
export function grassTex(n: number): TexSet {
  const h = fbm(n, 81, 24, 5, 0.65), patch = fbm(n, 82, 4, 4), dry = fbm(n, 83, 6, 4);
  const blades = mulberry32(84), streak = new Float32Array(n * n);
  for (let k = 0; k < n * 6; k++) {
    let x = blades() * n, y = blades() * n;
    const a = -Math.PI / 2 + (blades() - 0.5) * 1.2, l = 4 + blades() * 8, v = blades();
    for (let s = 0; s < l; s++) { x += Math.cos(a); y += Math.sin(a); streak[wrapI(n, x, y)] = v; }
  }
  for (let i = 0; i < n * n; i++) h[i] = h[i] * 0.6 + streak[i] * 0.3;
  return build(n, h, (i) => {
    const green = mix([58, 78, 34], [104, 104, 52], sstep(0.35, 0.75, dry[i]));
    const base = mix(green, [96, 80, 58], sstep(0.55, 0.8, patch[i]));
    return shade(base, 0.72 + h[i] * 0.5 + streak[i] * 0.25);
  }, (i) => 0.95 - streak[i] * 0.1, 2.4, 1);
}

/** Painted lap siding (near white, tinted per house through the material colour) with peeling paint and grime. */
export function sidingTex(n: number): TexSet {
  const boards = 8, bh = n / boards, wear = fbm(n, 91, 6, 5), grain = fbm(n, 92, 16, 3), dirt = columns(n, 93, 8);
  const h = new Float32Array(n * n);
  const peel = (i: number) => wear[i] > 0.77;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, t = (y % bh) / bh;
    h[i] = t * 0.5 + (t > 0.9 ? -0.8 : 0) + (peel(i) ? -0.12 : 0) + grain[i] * 0.05;
  }
  return build(n, h, (i, x, y) => {
    const t = (y % bh) / bh;
    const lip = t > 0.9 ? 0.5 : 1 - (1 - t) * 0.08;
    const grime = 1 - dirt[x] * 0.25;
    if (peel(i)) return shade([132, 124, 110], (0.8 + grain[i] * 0.3) * lip);
    return shade([236, 232, 222], (0.88 + grain[i] * 0.1) * lip * grime);
  }, (i) => (peel(i) ? 0.95 : 0.72), 2, 1);
}

/** Asphalt shingles: staggered tabs with per-tab tone and moss creeping in. */
export function shingleTex(n: number): TexSet {
  const rows = 8, rh = n / rows, tabs = 5, tw = n / tabs, rnd = mulberry32(101);
  const tone = Array.from({ length: rows * tabs }, () => 0.8 + rnd() * 0.35);
  const moss = fbm(n, 102, 5, 5), grit = fbm(n, 103, 64, 2), h = new Float32Array(n * n);
  const tabOf = (x: number, y: number) => {
    const r = Math.floor(y / rh), off = r % 2 ? tw / 2 : 0;
    return { r, c: Math.floor(((x + off) % n) / tw), u: ((x + off) % tw) / tw, v: (y % rh) / rh };
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const { u, v } = tabOf(x, y), i = y * n + x;
    h[i] = v * 0.6 + grit[i] * 0.3 - (v > 0.9 ? 0.7 : 0) - (u < 0.02 ? 0.5 : 0);
  }
  return build(n, h, (i, x, y) => {
    const { r, c, u, v } = tabOf(x, y);
    if (v > 0.9 || u < 0.02) return [22, 22, 22];
    const base = shade([74, 70, 66], tone[r * tabs + c] * (0.85 + grit[i] * 0.3));
    return mix(base, [70, 84, 44], sstep(0.58, 0.75, moss[i]) * 0.85);
  }, (i) => 0.92 - moss[i] * 0.05, 2.2, 1);
}

/** Red brick with recessed mortar joints. */
export function brickTex(n: number): TexSet {
  const rows = 16, cols = 4, rh = n / rows, cw = n / cols, rnd = mulberry32(111);
  const tone = Array.from({ length: rows * cols }, () => [0.75 + rnd() * 0.4, rnd()]);
  const noise = fbm(n, 112, 32, 4), soot = fbm(n, 113, 4, 4), h = new Float32Array(n * n);
  const at = (x: number, y: number) => {
    const r = Math.floor(y / rh), off = r % 2 ? cw / 2 : 0, xx = (x + off) % n;
    return { r, c: Math.floor(xx / cw), mortar: y % rh < 3 || xx % cw < 3 };
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = at(x, y).mortar ? -0.5 : noise[y * n + x] * 0.4;
  return build(n, h, (i, x, y) => {
    const b = at(x, y);
    if (b.mortar) return shade([150, 144, 134], 0.8 + noise[i] * 0.3);
    const [k, hue] = tone[b.r * cols + b.c];
    return shade(mix(mix([138, 62, 44], [110, 70, 54], hue), [60, 50, 46], sstep(0.55, 0.8, soot[i]) * 0.6), k * (0.85 + noise[i] * 0.3));
  }, (i) => 0.9 - noise[i] * 0.1, 2.5, 1);
}

/**
 * Corrugated steel (containers, warehouse): vertical ribs in the normal map, painted `paint`,
 * with rust runs dripping from the top and scraped patches.
 */
export function corrugatedTex(n: number, paint: RGB, seed: number, ribs = 10): TexSet {
  const runs = columns(n, seed, 12, 4), patch = fbm(n, seed + 1, 5, 5), grain = fbm(n, seed + 2, 32, 3);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ph = ((x / n) * ribs) % 1;
    h[y * n + x] = sstep(0.1, 0.25, ph) - sstep(0.6, 0.75, ph) + grain[y * n + x] * 0.04;
  }
  return build(n, h, (i, x, y) => {
    const run = sstep(0.55, 0.85, runs[x]) * (1 - y / n) * 1.3;
    const rust = Math.max(sstep(0.66, 0.8, patch[i]), clamp01(run) * 0.8);
    const ph = ((x / n) * ribs) % 1, facet = ph < 0.25 ? 0.92 : ph < 0.6 ? 1.04 : 0.95;
    return mix(shade(paint, facet * (0.9 + grain[i] * 0.2)), [104, 60, 34], rust);
  }, (i) => 0.55 + sstep(0.66, 0.8, patch[i]) * 0.35 + grain[i] * 0.1, 3.2, 1);
}

/** Interior plaster: off-white with water stains and hairline cracks. */
export function plasterTex(n: number): TexSet {
  const h = fbm(n, 121, 12, 5, 0.5), stain = fbm(n, 122, 3, 5), crack = cracks(n, 123, 1, n * 0.25);
  for (let i = 0; i < n * n; i++) h[i] = h[i] * 0.3 - crack[i] * 0.5;
  return build(n, h, (i) => {
    if (crack[i]) return [150, 142, 130];
    const s = sstep(0.62, 0.85, stain[i]);
    return shade(mix([208, 202, 190], [150, 132, 100], s * 0.7), 0.9 + h[i] * 0.2);
  }, () => 0.92, 0.8, 1);
}

/** Store floor: 4×4 vinyl tiles in two tones, grimy grout, scuffs. */
export function tileTex(n: number): TexSet {
  const k = 4, tw = n / k, dirt = fbm(n, 131, 4, 5), h = fbm(n, 132, 32, 3), crack = cracks(n, 133, 2, n * 0.3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    h[i] = h[i] * 0.1 - (x % tw < 2 || y % tw < 2 ? 0.5 : 0) - crack[i] * 0.4;
  }
  return build(n, h, (i, x, y) => {
    if (x % tw < 2 || y % tw < 2 || crack[i]) return [70, 66, 60];
    const odd = (Math.floor(x / tw) + Math.floor(y / tw)) % 2;
    return shade(mix(odd ? [196, 192, 182] : [150, 154, 150], [110, 98, 80], sstep(0.5, 0.8, dirt[i]) * 0.7), 1);
  }, (i) => 0.5 + dirt[i] * 0.35, 1, 1);
}

/** Painted metal gone to rust: faded paint, scratches, orange-brown corrosion blooms (cars, pumps, barrels, cranes). */
export function rustPaintTex(n: number, paint: RGB, seed: number, rustiness = 0.5): TexSet {
  const h = fbm(n, seed, 8, 5), rust = fbm(n, seed + 1, 6, 6, 0.6), fade = fbm(n, seed + 2, 3, 3);
  const threshold = 0.78 - rustiness * 0.22;
  return build(n, h, (i) => {
    const r = sstep(threshold, threshold + 0.1, rust[i]);
    const p = mix(paint, [200, 196, 188], fade[i] * 0.25);
    return mix(shade(p, 0.88 + h[i] * 0.2), shade([112, 60, 32], 0.8 + h[i] * 0.4), r);
  }, (i) => 0.5 + sstep(threshold, threshold + 0.1, rust[i]) * 0.4, 1.2, 1);
}

/** Leaf atlas with transparency: dozens of overlapping leaves and a few twigs. Used on alpha-tested cards. */
export function leafTex(n: number, seed: number, hues: [number, number], sat = 38, light = 30): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!, rnd = mulberry32(seed);
  ctx.strokeStyle = '#3b2e22';
  for (let k = 0; k < 7; k++) {
    ctx.lineWidth = n * 0.006;
    ctx.beginPath();
    ctx.moveTo(n * 0.5, n * 0.95);
    ctx.quadraticCurveTo(n * (0.2 + rnd() * 0.6), n * 0.5, n * (0.1 + rnd() * 0.8), n * (0.08 + rnd() * 0.3));
    ctx.stroke();
  }
  for (let k = 0; k < 340; k++) {
    const x = n * (0.08 + rnd() * 0.84), y = n * (0.06 + rnd() * 0.86), s = n * (0.028 + rnd() * 0.03);
    const hue = hues[0] + rnd() * (hues[1] - hues[0]), l = light + rnd() * 16 - 4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI * 2);
    const g = ctx.createLinearGradient(-s, 0, s, 0);
    g.addColorStop(0, `hsl(${hue},${sat}%,${l - 6}%)`);
    g.addColorStop(1, `hsl(${hue},${sat + 6}%,${l + 6}%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(0, -s * 0.55, s, 0);
    ctx.quadraticCurveTo(0, s * 0.55, -s, 0);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue},30%,${l - 12}%,0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s * 0.8, 0); ctx.stroke();
    ctx.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Chain-link diamond mesh with transparency. */
export function chainTex(n: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#8a8c88';
  ctx.lineWidth = Math.max(2.5, n / 10);
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath(); ctx.moveTo(k * n, 0); ctx.lineTo(k * n + n, n); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k * n + n, 0); ctx.lineTo(k * n, n); ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Normal map for small wind ripples on water. */
export function waterNormal(n: number): Texture {
  const h = fbm(n, 141, 8, 5, 0.55);
  return build(n, h, () => [0, 0, 0], () => 0, 3.5, 1).normalMap;
}

/** Canvas texture for signs, posters and markings. */
export function paintedTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Eats random holes into whatever is on the canvas so paint looks worn (road lines, posters, signs). */
export function weather(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, amount: number) {
  const rnd = mulberry32(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < w * h * amount * 0.004; k++) {
    ctx.globalAlpha = 0.3 + rnd() * 0.7;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, 1 + rnd() * rnd() * Math.min(w, h) * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
