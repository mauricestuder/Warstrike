import type { Material } from 'three';
import type { Builder } from '../Builder';
import { door, shell, wall, win, type Opening, type WallStyle } from './Buildings';
import { bed, counter, couch, debris, decalMat, fridge, plane, Placer, shelf, table } from './Props';
import type { TownMaterials } from './TownMaterials';

type Rnd = () => number;

export type BlockUse = 'shop' | 'office' | 'apartment' | 'empty';

export interface BlockOpts {
  W: number; D: number; floors: number;
  ext: Material; int?: Material; trim?: Material; floorMat?: Material;
  /** Storefront on the ground floor of the front (+z) side, with an optional sign and awning. */
  shop?: { name?: string; color?: string; awning?: Material };
  use?: BlockUse;
  /** Stairs continue up to a hut on the roof. */
  roofAccess?: boolean;
  /** Back door on the -z side. */
  backDoor?: boolean;
  /** Side doors (west / east). */
  sideDoor?: 'w' | 'e';
  story?: number;
  /** Top floor open on all sides (a church belfry, a lookout). */
  belfry?: boolean;
  rnd: Rnd;
}

const BASE = 0.15, STEP_RUN = 0.3, STAIR_W = 1.3, LANDING = 1.2;

/** Window openings every `gap` metres along a wall of length `len`, skipping `skip` (an [a0, a1] range along it). */
function windows(len: number, gap: number, y0: number, y1: number, w: number, skip: [number, number][] = [], boarded = 0, rnd?: Rnd) {
  const out: Opening[] = [];
  const n = Math.max(1, Math.floor((len - 1) / gap));
  const start = (len - (n - 1) * gap) / 2;
  for (let k = 0; k < n; k++) {
    const at = start + k * gap;
    if (skip.some(([a, b]) => at + w / 2 > a && at - w / 2 < b)) continue;
    out.push(win(at, w, y0, y1, !!rnd && rnd() < boarded));
  }
  return out;
}

/**
 * A multi-storey town building (shops, offices, flats) in its local frame, front (+z) toward the street. Every floor
 * is walkable: a U-shaped concrete stair in the back-left corner climbs half a storey per flight, so each floor's
 * flights sit exactly one storey above the last (thin steps keep full head room). Optional stair hut onto a flat
 * roof with a parapet, AC units and a water tank.
 */
export function block(b: Builder, m: TownMaterials, x: number, z: number, ry: number, o: BlockOpts) {
  const p = new Placer(b, x, 0, z, ry), { W, D, rnd } = o;
  const S = o.story ?? 3.2, t = 0.3, F = (k: number) => BASE + k * S;
  const style: WallStyle = { ext: o.ext, int: o.int ?? m.plaster, surface: 'concrete', trim: o.trim ?? m.trim };
  const floorMat = o.floorMat ?? m.floorWood, use = o.use ?? 'office';
  // Footing and ground floor.
  p.box(0, 0, 0, W + 0.1, BASE, D + 0.1, m.concreteDark, 'concrete', 3);
  p.box(0, BASE - 0.02, 0, W - 2 * t, 0.02, D - 2 * t, o.shop ? m.tile : floorMat, null, 1.6);
  // Stairwell rectangle (northwest inside corner): landing, flights, mid landing along +x; lane A north, lane B south.
  // Steps of at most ~0.27 m: taller storeys get longer flights so they stay as easy to climb (for the bots too).
  const steps = Math.ceil(S / 2 / 0.267 - 1e-6);
  const sx = -W / 2 + t, sz = -D / 2 + t, run = steps * STEP_RUN, hx0 = sx + LANDING, hx1 = hx0 + run + LANDING, hz1 = sz + 2 * STAIR_W;
  const top = o.floors - 1 + (o.roofAccess ? 1 : 0); // flights go from floor k to k+1 for k < top
  const stair = m.concrete;
  for (let k = 0; k < top; k++) {
    const y = F(k), half = S / 2, rise = half / steps;
    // Lane A: east, from this floor up to the mid landing.
    for (let i = 0; i < steps; i++) {
      const tp = y + rise * (i + 1);
      p.box(hx0 + (i + 0.5) * STEP_RUN, tp - 0.2, sz + STAIR_W / 2, STEP_RUN, 0.2, STAIR_W, stair, 'concrete', 1);
    }
    // Mid landing.
    p.box(hx1 - LANDING / 2, y + half - 0.2, sz + STAIR_W, LANDING, 0.2, 2 * STAIR_W, stair, 'concrete', 1);
    // Lane B: west, from the mid landing up to the next floor.
    for (let i = 0; i < steps; i++) {
      const tp = y + half + rise * (i + 1);
      p.box(hx1 - LANDING - (i + 0.5) * STEP_RUN, tp - 0.2, sz + STAIR_W * 1.5, STEP_RUN, 0.2, STAIR_W, stair, 'concrete', 1);
    }
  }
  // Wall between the lanes and the stairwell's south wall (open at the landing), full height of the stair.
  const stairTop = F(top) + (o.roofAccess ? 2.6 : 0);
  if (top > 0) {
    p.box(hx0 + run / 2, BASE, sz + STAIR_W, run, stairTop - BASE, 0.12, m.plaster, 'concrete', 2);
    p.box((hx0 + hx1) / 2, BASE, hz1 + 0.06, hx1 - hx0, stairTop - BASE, 0.12, m.plaster, 'concrete', 2);
  }
  const doorsFront = (W: number): Opening[] => {
    if (o.shop) {
      // Storefront: wide low windows either side of a central door.
      const d = W / 2, side = (W - 2.4) / 2;
      return [win(side / 2 + 0.2, side - 1.2, 0.5, 2.7), door(d, 1.6, 2.5), win(W - side / 2 - 0.2, side - 1.2, 0.5, 2.7)];
    }
    return [...windows(W, 3.2, 0.9, 2.3, 1.2, [[W / 2 - 1.4, W / 2 + 1.4]]), door(W / 2, 1.4, 2.3)];
  };
  for (let k = 0; k < o.floors; k++) {
    const y = F(k), ground = k === 0, h = S;
    // Walls: the floor slab of the storey above sits inside them.
    const backSkip: [number, number][] = [[0, hx1 + W / 2 + 0.3]];
    if (o.belfry && k === o.floors - 1) {
      const arch = (len: number) => [win(len / 2, len - 1.4, 0.95, 2.75)];
      shell(p, m, W, D, y, h, t, style, { s: arch(W), n: arch(W), w: arch(D), e: arch(D) }, rnd);
      if (k > 0) slab(p, m, floorMat, W, D, t, y, sx, sz, hx0, hx1, hz1);
      continue;
    }
    shell(p, m, W, D, y, h, t, style, {
      s: ground ? doorsFront(W) : windows(W, 3.0, 0.9, 2.3, 1.3, [], 0.12, rnd),
      n: ground && o.backDoor ? [...windows(W, 3.4, 1.2, 2.3, 1.1, [...backSkip, [W - 3.4, W]]), door(W - 2.2, 1.0, 2.2)]
        : windows(W, 3.4, 1.0, 2.3, 1.2, backSkip, 0.1, rnd),
      w: ground && o.sideDoor === 'w' ? [door(D * 0.7, 1.0, 2.2)] : windows(D, 3.4, 1.0, 2.3, 1.2, [[0, 2.4 * 2 + 0.6]], 0.1, rnd),
      e: ground && o.sideDoor === 'e' ? [door(D * 0.5, 1.0, 2.2), ...windows(D, 6, 1.0, 2.3, 1.2, [[D * 0.5 - 1.5, D * 0.5 + 1.5]])] : windows(D, 3.4, 1.0, 2.3, 1.2, [], 0.1, rnd),
    }, rnd);
    // Cornice band outside at each floor line.
    if (k > 0) for (const s of [-1, 1]) {
      p.box(0, y - 0.18, s * (D / 2 + 0.06), W + 0.24, 0.22, 0.12, style.trim!, null, 1);
      p.box(s * (W / 2 + 0.06), y - 0.18, 0, 0.12, 0.22, D, style.trim!, null, 1);
    }
    // Floor slab of this storey (not the ground floor), with the stairwell hole.
    if (!ground) slab(p, m, floorMat, W, D, t, y, sx, sz, hx0, hx1, hz1);
    // A partition across the middle with two doorways, and furniture.
    const pz = D * 0.08;
    const pl = W / 2 - t - (hx1 + 0.06);
    if (D > 9 && pl > 5) wall(p, m, 'x', hx1 + 0.06, W / 2 - t, pz, 0.12, y, h, [door(1.8, 1.0, 2.2), door(pl - 1.8, 1.0, 2.2)],
      { ext: style.int, int: style.int, surface: 'wood' }, 1, rnd);
    furnish(p.at(0, 0, 0, y), m, use, ground, W, D, t, pz, hx1, rnd);
  }
  // Roof: slab (holed when there's a stair hut), parapet, roof clutter.
  const R = F(o.floors);
  if (o.roofAccess) slab(p, m, m.gravel, W, D, t, R, sx, sz, hx0, hx1, hz1, true);
  else p.box(0, R - 0.25, 0, W, 0.25, D, m.gravel, 'concrete', 2.5);
  p.box(0, R - 0.25, 0, W + 0.02, 0.24, D + 0.02, style.ext, null, 2);
  for (const s of [-1, 1]) {
    p.box(0, R, s * (D / 2 - 0.12), W, 0.75, 0.24, style.ext, 'concrete', 1.6);
    p.box(s * (W / 2 - 0.12), R, 0, 0.24, 0.75, D - 0.48, style.ext, 'concrete', 1.6);
    p.box(0, R + 0.75, s * (D / 2 - 0.12), W + 0.16, 0.08, 0.4, style.trim!, null, 1);
    p.box(s * (W / 2 - 0.12), R + 0.75, 0, 0.4, 0.08, D, style.trim!, null, 1);
  }
  if (o.roofAccess) {
    // Stair hut: walls round the stairwell, a door onto the roof at the landing, a flat lid.
    const hut: WallStyle = { ext: style.ext, int: m.plaster, surface: 'concrete', trim: m.steel };
    const cx = (sx + hx1) / 2, cz = (sz + hz1) / 2, hw = hx1 - sx + 0.24, hd = hz1 - sz + 0.24;
    const q = p.at(cx, cz);
    shell(q, m, hw, hd, R, 2.6, 0.12, hut, { s: [door(0.72, 1.05, 2.2)] }, rnd);
    q.box(0, R + 2.6, 0, hw + 0.3, 0.16, hd + 0.3, m.metal, 'metal', 2);
  }
  // Rooftop units and a timber water tank on a steel stand on bigger buildings.
  const ac = (lx: number, lz: number) => { p.box(lx, R, lz, 1.6, 1.1, 1.2, m.metal, 'metal', 1); p.box(lx, R + 1.1, lz, 1.2, 0.08, 0.9, m.black, null, 1); };
  ac(W / 2 - 2.2, D / 2 - 2.4);
  if (W > 14) ac(W * 0.1, -D / 2 + 3);
  if (o.floors >= 3 && W > 14 && rnd() < 0.7) {
    const tx = W / 2 - 3.5, tz = -D / 2 + 3.2;
    for (const a of [-1, 1]) for (const c of [-1, 1]) p.box(tx + a * 1.1, R, tz + c * 1.1, 0.14, 2.4, 0.14, m.steel, null, 1);
    p.collide(tx - 1.2, R, tz - 1.2, tx + 1.2, R + 2.4, tz + 1.2, 'metal');
    p.box(tx, R + 2.3, tz, 2.6, 0.12, 2.6, m.steel, 'metal', 1);
    p.cyl(tx, R + 2.42, tz, 1.25, 2.4, m.woodGrey, 16);
    p.cyl(tx, R + 4.82, tz, 1.3, 0.8, m.metal, 16, null, 0.1);
    p.collide(tx - 1.25, R + 2.42, tz - 1.25, tx + 1.25, R + 5.2, tz + 1.25, 'wood');
  }
  p.cyl(-W / 2 + 6, R, D / 2 - 1.5, 0.12, 1.4, m.steel, 8);
  // Shop sign and awning over the storefront.
  if (o.shop) {
    const y = BASE + 2.95;
    if (o.shop.name) {
      const col = o.shop.color ?? '#23466a', name = o.shop.name;
      const sign = decalMat(m, 'shop-' + name, 1024, 160, (ctx, w, h) => {
        ctx.fillStyle = col; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(232,228,218,0.85)'; ctx.lineWidth = 6; ctx.strokeRect(10, 10, w - 20, h - 20);
        ctx.fillStyle = '#ece6d6'; ctx.font = `bold ${name.length > 14 ? 74 : 96}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(name, w / 2, h / 2 + 4);
      }, { wear: 1.1 });
      plane(p, 0, y + 0.1, D / 2 + 0.04, Math.min(W - 1, 9), 1.15, sign);
    }
    if (o.shop.awning) {
      p.box(0, BASE + 2.75, D / 2 + 0.9, W - 1.2, 0.08, 1.9, o.shop.awning, null, 1, [0.32, 0, 0]);
      for (let lx = -W / 2 + 1; lx < W / 2 - 0.5; lx += 0.5) p.box(lx, BASE + 2.36, D / 2 + 1.78, 0.5, 0.22, 0.03, o.shop.awning, null, 1);
    }
  }
}

/** A floor slab at height y (top surface) covering the inside, minus the stairwell flights (the landing stays). */
function slab(p: Placer, m: TownMaterials, mat: Material, W: number, D: number, t: number, y: number,
  sx: number, sz: number, hx0: number, hx1: number, hz1: number, roof = false) {
  const x0 = -W / 2 + (roof ? 0 : t), x1 = W / 2 - (roof ? 0 : t), z0 = -D / 2 + (roof ? 0 : t), z1 = D / 2 - (roof ? 0 : t);
  const th = 0.25;
  const piece = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 - a0 < 0.01 || b1 - b0 < 0.01) return;
    p.box((a0 + a1) / 2, y - th, (b0 + b1) / 2, a1 - a0, th, b1 - b0, mat, 'concrete', roof ? 2.5 : 1.6);
  };
  piece(x0, x1, hz1, z1);
  piece(x0, hx0, z0, hz1);
  piece(hx1, x1, z0, hz1);
  // Plaster ceiling under the slab.
  if (!roof) p.box(0, y - th - 0.02, (hz1 + z1) / 2, W - 2 * t, 0.02, z1 - hz1, m.plaster, null, 2, null, false);
  // Railing along the hole's open south edge beside the lanes is the stairwell wall; nothing else to add.
  void sx; void sz;
}

function furnish(f: Placer, m: TownMaterials, use: BlockUse, ground: boolean, W: number, D: number, t: number, pz: number, hx1: number, rnd: Rnd) {
  const front = D / 2 - t, back = -D / 2 + t, x1 = W / 2 - t;
  if (use === 'empty') { debris(f, m, 0, 0, W * 0.6, 16, rnd); return; }
  if (ground && use === 'shop') {
    const goods = [m.containers[0], m.containers[1], m.white, m.fabric[2], m.containers[3]];
    for (let gx = -W / 2 + 3; gx < W / 2 - 3; gx += 3.2) shelf(f, m, gx, pz + 2.6, Math.PI / 2, 3.4, 1.6, m.white, rnd, goods);
    counter(f, m, x1 - 1.4, front - 2.4, Math.PI / 2, 2.6);
    debris(f, m, 0, pz + 2, W * 0.6, 14, rnd);
    shelf(f, m, hx1 + 2.5, back + 0.3, 0, 3, 2, m.steel, rnd, [m.fabric[0], m.containers[2]]);
    return;
  }
  if (use === 'office') {
    for (let gx = -W / 2 + 2.5; gx < W / 2 - 2; gx += 3) {
      table(f, m, gx, front - 2.2, 0, 1.6, 0.8, rnd() < 0.25);
      if (rnd() < 0.6) table(f, m, gx, pz + 1.6, Math.PI, 1.6, 0.8, rnd() < 0.25);
    }
    shelf(f, m, x1 - 0.3, back + 2, Math.PI / 2, 2.4, 2, m.steel, rnd, [m.white, m.fabric[1]]);
    debris(f, m, 0, 0, W * 0.7, 18, rnd);
    return;
  }
  // Apartment: living room at the front, bedroom and kitchen behind the partition.
  couch(f, m, -W / 4, front - 1.0, Math.PI, m.fabric[Math.floor(rnd() * m.fabric.length)]);
  table(f, m, -W / 4, front - 2.4, 0, 1.2, 0.6, rnd() < 0.4);
  bed(f, m, x1 - 1.3, back + 1.4, 0, m.fabric[(Math.floor(rnd() * 3) + 1) % 4]);
  counter(f, m, hx1 + 2, back + 0.33, 0, 2.6);
  fridge(f, m, hx1 + 3.8, back + 0.45, 0, rnd() < 0.2);
  debris(f, m, 0, pz, W * 0.6, 12, rnd);
}
