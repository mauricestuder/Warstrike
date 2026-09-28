import { ExtrudeGeometry, Shape, type Material } from 'three';
import type { Builder } from '../Builder';
import type { Surface } from '../Colliders';
import {
  bed, counter, couch, debris, decalMat, fridge, pallet, plane, Placer, shelf, table, tire, barrel,
} from './Props';
import { ivy } from './Vegetation';
import type { TownMaterials } from './TownMaterials';

type Rnd = () => number;

/** A hole in a wall: centred `at` metres along it, `w` wide, from `y0` to `y1` above the wall's base. */
export interface Opening { at: number; w: number; y0: number; y1: number; boarded?: boolean; }
export const door = (at: number, w = 1.0, h = 2.15): Opening => ({ at, w, y0: 0, y1: h });
export const win = (at: number, w = 1.2, y0 = 0.9, y1 = 2.2, boarded = false): Opening => ({ at, w, y0, y1, boarded });

export interface WallStyle { ext: Material; int: Material; surface: Surface; trim?: Material; }

/**
 * A straight wall in a Placer's local frame, cut around openings. Axis 'x' runs from a0 to a1 along local x at
 * z = c; axis 'z' runs along local z at x = c. The outer half uses `ext`, the inner half `int`; `out` is which side
 * (+1/-1) is outside. One collider per solid piece, the full thickness.
 */
export function wall(p: Placer, m: TownMaterials, axis: 'x' | 'z', a0: number, a1: number, c: number, t: number, y: number,
  h: number, openings: Opening[], style: WallStyle, out: 1 | -1, rnd: Rnd) {
  const pieces: [number, number, number, number][] = [];
  let u = a0;
  const ops = [...openings].sort((a, b) => a.at - b.at);
  for (const o of ops) {
    const o0 = a0 + o.at - o.w / 2, o1 = a0 + o.at + o.w / 2;
    if (o0 > u) pieces.push([u, o0, 0, h]);
    if (o.y0 > 0) pieces.push([o0, o1, 0, o.y0]);
    if (o.y1 < h) pieces.push([o0, o1, o.y1, h]);
    u = o1;
  }
  if (u < a1) pieces.push([u, a1, 0, h]);
  const half = t / 2;
  for (const [u0, u1, v0, v1] of pieces) {
    const len = u1 - u0, mid = (u0 + u1) / 2, hh = v1 - v0;
    if (len < 1e-3 || hh < 1e-3) continue;
    for (const [mat, side] of [[style.ext, out], [style.int, -out]] as const) {
      const off = c + side * half / 2;
      if (axis === 'x') p.box(mid, y + v0, off, len, hh, half, mat, null, 2);
      else p.box(off, y + v0, mid, half, hh, len, mat, null, 2);
    }
    if (axis === 'x') p.collide(u0, y + v0, c - half, u1, y + v1, c + half, style.surface);
    else p.collide(c - half, y + v0, u0, c + half, y + v1, u1, style.surface);
  }
  // Trim around openings on the outside, and boards over the boarded ones.
  const trim = style.trim;
  for (const o of ops) {
    const mid = a0 + o.at, fo = c + out * (half + 0.03);
    const frame = (du: number, v: number, w: number, hh: number) => {
      if (!trim) return;
      if (axis === 'x') p.box(mid + du, y + v, fo, w, hh, 0.07, trim, null, 1);
      else p.box(fo, y + v, mid + du, 0.07, hh, w, trim, null, 1);
    };
    frame(-o.w / 2 - 0.05, o.y0 - (o.y0 > 0 ? 0.05 : 0), 0.1, o.y1 - o.y0 + 0.1);
    frame(o.w / 2 + 0.05, o.y0 - (o.y0 > 0 ? 0.05 : 0), 0.1, o.y1 - o.y0 + 0.1);
    frame(0, o.y1, o.w + 0.2, 0.1);
    if (o.y0 > 0 && trim) {
      if (axis === 'x') p.box(mid, y + o.y0 - 0.07, c + out * (half + 0.06), o.w + 0.3, 0.07, 0.14, trim, null, 1);
      else p.box(c + out * (half + 0.06), y + o.y0 - 0.07, mid, 0.14, 0.07, o.w + 0.3, trim, null, 1);
    }
    if (o.boarded) {
      const fb = c + out * (half + 0.06);
      for (let k = 0; k < 3; k++) {
        const v = o.y0 + (o.y1 - o.y0) * (0.2 + k * 0.3), tilt = (rnd() - 0.5) * 0.35;
        if (axis === 'x') p.box(mid, y + v, fb, o.w + 0.3, 0.16, 0.03, m.woodGrey, null, 1, [0, 0, tilt]);
        else p.box(fb, y + v, mid, 0.03, 0.16, o.w + 0.3, m.woodGrey, null, 1, [tilt, 0, 0]);
      }
      if (axis === 'x') p.collide(mid - o.w / 2, y + o.y0, c - half, mid + o.w / 2, y + o.y1, c + half, 'wood');
      else p.collide(c - half, y + o.y0, mid - o.w / 2, c + half, y + o.y1, mid + o.w / 2, 'wood');
    }
  }
}

/** Four outer walls of a W×D rectangle centred on the placer origin. Openings measured from the west/north end. */
export function shell(p: Placer, m: TownMaterials, W: number, D: number, y: number, h: number, t: number, style: WallStyle,
  o: { n?: Opening[]; s?: Opening[]; w?: Opening[]; e?: Opening[] }, rnd: Rnd) {
  wall(p, m, 'x', -W / 2, W / 2, -D / 2 + t / 2, t, y, h, o.n ?? [], style, -1, rnd);
  wall(p, m, 'x', -W / 2, W / 2, D / 2 - t / 2, t, y, h, o.s ?? [], style, 1, rnd);
  wall(p, m, 'z', -D / 2 + t, D / 2 - t, -W / 2 + t / 2, t, y, h, o.w ?? [], style, -1, rnd);
  wall(p, m, 'z', -D / 2 + t, D / 2 - t, W / 2 - t / 2, t, y, h, o.e ?? [], style, 1, rnd);
}

/** Straight flight of box steps rising along local +x from (x, z), `n` steps of `rise` × `run`. */
export function stairs(p: Placer, x: number, z: number, y: number, n: number, rise: number, run: number, width: number, mat: Material,
  dir: 1 | -1 = 1) {
  for (let k = 0; k < n; k++) {
    const top = y + rise * (k + 1);
    p.box(x + dir * (k + 0.5) * run, y, z, run, top - y, width, mat, 'concrete', 1);
  }
}

/** Pitched roof with the ridge along local x: two shingled slabs, gable ends, stepped colliders you can stand on. */
export function gable(p: Placer, m: TownMaterials, W: number, D: number, y: number, pitch: number, over: number, roof: Material,
  gableMat: Material, missing = false) {
  const tan = Math.tan(pitch), rise = (D / 2) * tan, half = D / 2 + over, slope = half / Math.cos(pitch);
  const yr = y + rise;
  for (const side of [-1, 1]) {
    if (missing && side > 0) {
      // Collapsed half: just a few rafters left.
      for (let x = -W / 2 + 0.6; x < W / 2; x += 1.2) {
        p.box(x, yr - (half / 2) * tan - 0.1, side * half / 2, 0.08, 0.15, slope, m.charred, null, 1, [pitch, 0, 0]);
      }
      continue;
    }
    p.box(0, yr - (half / 2) * tan - 0.08 + 0.02, side * half / 2, W + 2 * over, 0.12, slope, roof, null, 3,
      side > 0 ? [pitch, 0, 0] : [pitch, Math.PI, 0]);
    // Fascia board along the eave.
    p.box(0, yr - half * tan - 0.22, side * (half - 0.02), W + 2 * over, 0.2, 0.05, m.trim, null, 1);
    // Colliders: three steps approximating the slope.
    for (let k = 0; k < 3; k++) {
      const za = (k / 3) * half, zb = ((k + 1) / 3) * half, top = yr - ((k + 0.5) / 3) * half * tan;
      if (side > 0) p.collide(-W / 2 - over, y - 0.05, za, W / 2 + over, top, zb, 'wood');
      else p.collide(-W / 2 - over, y - 0.05, -zb, W / 2 + over, top, -za, 'wood');
    }
  }
  // Gable ends.
  const s = new Shape();
  s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, rise); s.closePath();
  for (const side of [-1, 1]) {
    const g = new ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false });
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
    g.translate(0, 0, -0.1);
    g.rotateY(Math.PI / 2);
    g.translate(side * (W / 2 - 0.1), y, 0);
    p.geo(g, gableMat);
  }
}

export interface HouseOpts {
  W: number; D: number; floors: 1 | 2; siding: Material; roof: Material; boarded?: boolean; rnd: Rnd;
  chimney?: boolean; porch?: boolean;
}

const FLOOR = 0.5, STORY = 2.8;

/**
 * Suburban house in its local frame: front (+z) faces the street. Raised floor with porch steps, siding outside,
 * plaster inside, partition walls, furniture, optional second floor with a staircase, gable roof, porch roof.
 */
export function house(b: Builder, m: TownMaterials, x: number, z: number, ry: number, o: HouseOpts) {
  const p = new Placer(b, x, 0, z, ry), { W, D, rnd } = o;
  const t = 0.22, style: WallStyle = { ext: o.siding, int: m.plaster, surface: 'wood', trim: m.trim };
  const bd = !!o.boarded;
  // Foundation and floor.
  p.box(0, 0, 0, W + 0.1, FLOOR - 0.04, D + 0.1, m.concreteDark, 'concrete');
  p.box(0, FLOOR - 0.04, 0, W - 0.1, 0.04, D - 0.1, m.floorWood, null, 1.6);
  // Ground floor.
  shell(p, m, W, D, FLOOR, STORY, t, style, {
    // Opening positions are measured from the west end; the front door lines up with the porch (local x = W/2 - 1.5).
    s: [win(1.5, 1.3, 0.9, 2.2, bd), win(W / 2 + 0.5, 1.8, 0.8, 2.2, bd && rnd() < 0.5), door(W - 1.5)],
    n: [win(2.5, 1.1, 1.0, 2.1, bd), win(W / 2, 1.1, 1.0, 2.1), door(W / 2 + 1.6)],
    w: [win(D * 0.3, 1.1, 1.0, 2.1, bd), win(D * 0.72, 1.1, 1.0, 2.1)],
    e: [win(D / 2, 1.3, 0.9, 2.2, bd)],
  }, rnd);
  const inner: WallStyle = { ext: m.plaster, int: o.siding === m.siding[2] ? m.plasterBlue : m.plaster, surface: 'wood' };
  // Partition: front living room vs. back rooms, and the back split in two.
  const pz = -0.4;
  wall(p, m, 'x', -W / 2 + t, W / 2 - t, pz, 0.12, FLOOR, STORY, [door(2.6, 0.95), door(W - 2.4, 0.95)], inner, 1, rnd);
  wall(p, m, 'z', -D / 2 + t, pz - 0.06, 0.6, 0.12, FLOOR, STORY, [], inner, 1, rnd);
  // Furniture.
  const f = p.at(0, 0, 0, FLOOR);
  const fab = m.fabric[Math.floor(rnd() * m.fabric.length)];
  couch(f, m, 1.5, 2.6, Math.PI, fab);
  table(f, m, 1.6, 1.2, 0, 1.1, 0.6, rnd() < 0.4);
  counter(f, m, W / 2 - 2.0, -D / 2 + t + 0.32, 0, 2.6);
  fridge(f, m, W / 2 - t - 0.45, -D / 2 + 1.6, -Math.PI / 2, rnd() < 0.3);
  table(f, m, 2.8, -2.6, 0, 1.2, 0.8, rnd() < 0.5);
  bed(f, m, -W / 2 + 1.3, -D / 2 + 1.3, 0, m.fabric[(Math.floor(rnd() * 4) + 1) % 4]);
  shelf(f, m, -1.0, -D / 2 + t + 0.26, 0, 1.4, 1.8, m.wood, rnd, [m.fabric[0], m.white]);
  debris(f, m, 0, 1, W * 0.6, 14, rnd);

  let top = FLOOR + STORY;
  if (o.floors === 2) {
    // Staircase along the west wall of the living room, rising toward the back.
    const n = 12, rise = (STORY + 0.25) / n, run = 0.27, sx = -W / 2 + t + 0.55;
    for (let k = 0; k < n; k++) {
      const zz = D / 2 - t - 0.6 - (k + 0.5) * run;
      p.box(sx, FLOOR, zz, 1.0, rise * (k + 1), run, m.floorWood, 'wood', 1);
    }
    const holeZ0 = D / 2 - t - 0.6 - n * run - 0.2, holeZ1 = D / 2 - t - 0.3;
    // Second floor slab with a stairwell hole.
    const slab = (x0: number, x1: number, z0: number, z1: number) =>
      p.box((x0 + x1) / 2, top, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, m.floorWood, 'wood', 1.6);
    slab(-W / 2 + t, W / 2 - t, -D / 2 + t, holeZ0);
    slab(sx + 0.55, W / 2 - t, holeZ0, D / 2 - t);
    slab(-W / 2 + t, sx - 0.55, holeZ0, D / 2 - t);
    // Railing around the stairwell.
    p.box(sx + 0.55, top + 0.25, (holeZ0 + holeZ1) / 2, 0.06, 0.95, holeZ1 - holeZ0 - 0.9, m.wood, 'wood', 1);
    top += 0.25;
    p.box(0, FLOOR + STORY, 0, W + 0.02, 0.25, D + 0.02, o.siding, null, 2);
    shell(p, m, W, D, top, STORY - 0.2, t, style, {
      s: [win(2, 1.1, 0.8, 2.0, bd), win(W / 2, 1.1, 0.8, 2.0), win(W - 2, 1.1, 0.8, 2.0, bd)],
      n: [win(3, 1.1, 0.8, 2.0), win(W - 3, 1.1, 0.8, 2.0, bd)],
      w: [win(D / 2, 1.1, 0.8, 2.0)],
      e: [win(D * 0.3, 1.1, 0.8, 2.0), win(D * 0.7, 1.1, 0.8, 2.0, bd)],
    }, rnd);
    wall(p, m, 'x', -W / 2 + t, W / 2 - t, pz - 0.6, 0.12, top, STORY - 0.2, [door(W / 2 - 1.5, 0.95), door(W - 3, 0.95)], inner, 1, rnd);
    const f2 = p.at(0, 0, 0, top);
    bed(f2, m, W / 2 - 1.4, -D / 2 + 1.4, 0, m.fabric[2]);
    bed(f2, m, -W / 2 + 1.4, -D / 2 + 1.4, 0, m.fabric[1]);
    debris(f2, m, 1, 2, W * 0.5, 10, rnd);
    top += STORY - 0.2;
  }
  // Ceiling (solid, so the attic stays out of the way) and the roof.
  p.box(0, top, 0, W, 0.12, D, m.plaster, 'wood', 2);
  gable(p, m, W, D, top + 0.12, 0.52, 0.45, o.roof, o.siding);
  if (o.chimney) {
    p.box(W / 2 - 1.6, top - 0.5, -D * 0.18, 0.8, (D / 2) * Math.tan(0.52) + 1.8, 0.8, m.brick, 'concrete', 1.2);
  }
  // Front porch: deck, steps, posts, roof, railing.
  if (o.porch !== false) {
    const px = W / 2 - 1.5, pw = 4.6, pd = 2.2;
    p.box(px, 0, D / 2 + pd / 2, pw, FLOOR - 0.02, pd, m.woodGrey, 'wood', 1.2);
    for (let k = 0; k < 2; k++) p.box(px, 0, D / 2 + pd + 0.2 + k * 0.3, 1.6, FLOOR - (k + 1) * 0.17, 0.32, m.concreteDark, 'concrete', 1);
    for (const s of [-1, 1]) {
      p.box(px + s * (pw / 2 - 0.1), FLOOR - 0.02, D / 2 + pd - 0.1, 0.14, 2.5, 0.14, m.trim, 'wood', 1);
      p.box(px + s * (pw / 4 + 0.5), FLOOR - 0.02, D / 2 + pd - 0.06, pw / 2 - 1.2, 0.9, 0.06, m.trim, 'wood', 1);
    }
    p.box(px, FLOOR + 2.45, D / 2 + pd / 2 - 0.1, pw + 0.4, 0.14, pd + 0.4, o.roof, 'wood', 2);
  }
  // Ivy climbing the west side, an AC unit, junk by the back door.
  if (rnd() < 0.7) {
    const [ix, iz] = wxz(x, z, ry, -W / 2, 0);
    ivy(b, m, ix, 0.3, iz, D * 0.7, 2 + rnd() * 2.5, 'x', Math.cos(ry) > 0 ? -1 : 1, rnd);
  }
  p.box(W / 2 + 0.6, 0, -D / 4, 0.8, 0.8, 0.8, m.metal, 'metal', 1);
  const [bx, bz] = wxz(x, z, ry, W / 2 - 1.2, -D / 2 - 1.2);
  barrel(b, m, bx, bz, rnd, m.containers[4]);
  const [tx, tz] = wxz(x, z, ry, -W / 2 - 0.8, -D / 2 - 1.5);
  tire(b, m, tx, 0.12, tz, [Math.PI / 2, 0, 0.1]);
}

/** Burnt-out house: foundation, charred wall stubs, a standing chimney, fallen beams. */
export function ruin(b: Builder, m: TownMaterials, x: number, z: number, W: number, D: number, rnd: Rnd) {
  const p = new Placer(b, x, 0, z, 0);
  p.box(0, 0, 0, W + 0.1, FLOOR - 0.04, D + 0.1, m.concreteDark, 'concrete');
  p.box(0, FLOOR - 0.04, 0, W - 0.1, 0.04, D - 0.1, m.charred, null, 1.6);
  const style: WallStyle = { ext: m.charred, int: m.charred, surface: 'wood' };
  // Walls broken into ragged chunks of random height.
  const seg = (axis: 'x' | 'z', a0: number, a1: number, c: number) => {
    for (let u = a0; u < a1 - 0.2;) {
      const len = Math.min(a1 - u, 0.8 + rnd() * 2.2), h = rnd() < 0.25 ? 0 : 0.4 + rnd() * rnd() * 2.6;
      if (h > 0) wall(p, m, axis, u, u + len, c, 0.2, FLOOR, h, [], style, 1, rnd);
      u += len;
    }
  };
  seg('x', -W / 2, W / 2, -D / 2 + 0.1); seg('x', -W / 2, W / 2, D / 2 - 0.1);
  seg('z', -D / 2 + 0.2, D / 2 - 0.2, -W / 2 + 0.1); seg('z', -D / 2 + 0.2, D / 2 - 0.2, W / 2 - 0.1);
  p.box(W / 2 - 1.2, 0, -1, 1.0, 7.2, 1.0, m.brick, 'concrete', 1.2);
  for (let k = 0; k < 7; k++) {
    const len = 3 + rnd() * 4;
    p.box((rnd() - 0.5) * W * 0.7, FLOOR + 0.1, (rnd() - 0.5) * D * 0.7, len, 0.18, 0.2, m.charred, null, 1,
      [rnd() * 0.3, rnd() * Math.PI, rnd() * 0.25]);
  }
  debris(p.at(0, 0, 0, FLOOR), m, 0, 0, W * 0.8, 30, rnd);
}

/** Single-wide mobile home on blocks, one end sagging. */
export function trailer(b: Builder, m: TownMaterials, x: number, z: number, ry: number, rnd: Rnd) {
  const p = new Placer(b, x, 0, z, ry, 0, 0.015);
  const L = 16, Wd = 4.2, y = 0.7;
  for (let u = -L / 2 + 1; u < L / 2; u += 2.4) for (const s of [-1, 1]) p.box(u, 0, s * 1.6, 0.4, y, 0.4, m.concreteDark, 'concrete', 1);
  p.box(0, y, 0, L, 0.1, Wd, m.floorWood, 'wood', 1.6);
  shell(p, m, L, Wd, y + 0.1, 2.5, 0.12, { ext: m.siding[2], int: m.plaster, surface: 'wood', trim: m.trim }, {
    s: [win(3, 1.2, 0.9, 2.0, true), door(7, 0.95, 2.0), win(11, 1.6, 0.9, 2.0), win(14.5, 0.9, 0.9, 2.0)],
    n: [win(4, 1.2, 0.9, 2.0), win(12, 1.2, 0.9, 2.0, true)],
    e: [win(2.1, 1.0, 0.9, 2.0)],
  }, rnd);
  p.box(0, y + 2.6, 0, L + 0.3, 0.14, Wd + 0.3, m.metal, 'metal', 2);
  for (let k = 0; k < 3; k++) p.box(7 - L / 2, 0, Wd / 2 + 0.3 + k * 0.28, 1.2, y - k * 0.23, 0.3, m.woodGrey, 'wood', 1);
  const f = p.at(0, 0, 0, y + 0.1);
  couch(f, m, 3, 1, Math.PI, m.fabric[3]);
  bed(f, m, -6, 0.4, Math.PI / 2, m.fabric[1]);
  debris(f, m, 0, 0, L * 0.6, 18, rnd);
}

/** Two-bay auto repair shop: brick, flat roof with parapet, roll-up door openings, a service pit and tyre stacks. */
export function garage(b: Builder, m: TownMaterials, x: number, z: number, ry: number, rnd: Rnd) {
  const p = new Placer(b, x, 0, z, ry), W = 18, D = 12, H = 5;
  p.box(0, 0, 0, W, 0.08, D, m.concreteDark, null, 3);
  const style: WallStyle = { ext: m.brick, int: m.concreteDark, surface: 'concrete', trim: m.steel };
  shell(p, m, W, D, 0.08, H, 0.3, style, {
    s: [door(3.5, 3.6, 3.6), door(8.5, 3.6, 3.6), win(13.2, 2.4, 1.0, 2.6), door(16.2, 1.0, 2.2)],
    n: [win(4, 1.6, 2.2, 3.4), win(12, 1.6, 2.2, 3.4, true)],
    w: [win(6, 1.4, 1.0, 2.4)],
    e: [door(3, 1.0, 2.2)],
  }, rnd);
  // Office partition at the east end.
  wall(p, m, 'z', -D / 2 + 0.3, D / 2 - 0.3, W / 2 - 5.5, 0.14, 0.08, H, [door(D - 3.5, 0.95, 2.2)], { ext: m.plaster, int: m.plaster, surface: 'wood' }, 1, rnd);
  // One roll-up door half down.
  p.box(-W / 2 + 8.5, 2.3, D / 2 - 0.15, 3.6, 1.3, 0.06, m.metal, 'metal', 1.2);
  // Roof with parapet.
  p.box(0, H + 0.08, 0, W, 0.25, D, m.concreteDark, 'concrete', 3);
  for (const s of [-1, 1]) {
    p.box(0, H + 0.33, s * (D / 2 - 0.12), W, 0.6, 0.24, m.brick, 'concrete', 1.2);
    p.box(s * (W / 2 - 0.12), H + 0.33, 0, 0.24, 0.6, D - 0.48, m.brick, 'concrete', 1.2);
  }
  const sign = decalMat(m, 'garage-sign', 1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#e4dccc'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#23304a'; ctx.font = 'bold 104px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText("DALE'S AUTO REPAIR", w / 2, h / 2 + 6);
  }, { wear: 1.4 });
  plane(p, -W / 2 + 6, H - 0.55, D / 2 + 0.02, 8, 1.25, sign);
  // Interior: pit, workbench, tyre stacks, shelving.
  const f = p.at(0, 0, 0, 0.08);
  p.box(-W / 2 + 3.5, 0.08, 0, 1.0, 0.02, 4.5, m.black, null, 1);
  counter(f, m, -W / 2 + 6, -D / 2 + 0.7, 0, 4, m.steel);
  shelf(f, m, -W / 2 + 1.0, -1, Math.PI / 2, 3.0, 2.2, m.steel, rnd, [m.containers[0], m.containers[1], m.rubber]);
  for (let k = 0; k < 3; k++) for (let s = 0; s < 4; s++) tire(b, m, ...wxz(x, z, ry, -W / 2 + 10 + k * 0.8, -D / 2 + 1), 0.12 + s * 0.24, [Math.PI / 2, 0, 0]);
  table(f, m, W / 2 - 2.8, -2, 0, 1.4, 0.7);
  debris(f, m, -2, 0, 10, 20, rnd);
}

function wxz(x: number, z: number, ry: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

/** Guard hut at the port gate. */
export function guardHut(b: Builder, m: TownMaterials, x: number, z: number, rnd: Rnd) {
  const p = new Placer(b, x, 0, z, 0);
  p.box(0, 0, 0, 3.6, 0.2, 3.2, m.concreteDark, 'concrete', 2);
  shell(p, m, 3.6, 3.2, 0.2, 2.6, 0.18, { ext: m.white, int: m.plaster, surface: 'wood', trim: m.steel }, {
    w: [win(1.5, 2.0, 1.0, 2.2)], s: [door(2.6, 0.9, 2.1)], e: [win(1.5, 2.0, 1.0, 2.2)], n: [win(1.8, 2.2, 1.0, 2.2)],
  }, rnd);
  p.box(0, 2.8, 0, 4.2, 0.16, 3.8, m.metal, 'metal', 2);
  counter(p.at(0, 0, 0, 0.2), m, 0, -1.1, 0, 2.6);
}

export { pallet };
