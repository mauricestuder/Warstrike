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
