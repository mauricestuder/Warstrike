import { CylinderGeometry, ConeGeometry, ExtrudeGeometry, Shape } from 'three';
import type { Builder } from '../Builder';
import { door, shell, stairs, wall, win, type WallStyle } from './Buildings';
import { barrel, container, decalMat, pallet, Placer, plane, shelf, tire } from './Props';
import type { TownMaterials } from './TownMaterials';

type Rnd = () => number;

/**
 * Warehouse: tall corrugated shed with roll-up door openings (one half down), steel columns, pallet racks you can
 * climb, a mezzanine office with stairs, and a collapsed roof panel that lets a shaft of sun in.
 */
export function warehouse(b: Builder, m: TownMaterials, x: number, z: number, rnd: Rnd) {
  const W = 40, D = 24, H = 8, p = new Placer(b, x, 0, z, 0);
  p.box(0, 0, 0, W, 0.1, D, m.concreteDark, 'concrete', 4);
  const style: WallStyle = { ext: m.warehouse, int: m.warehouse, surface: 'metal', trim: m.steel };
  shell(p, m, W, D, 0.1, H, 0.16, style, {
    s: [door(10, 5, 5), door(26, 5, 5), door(35, 1.0, 2.2), win(4, 3, 5.6, 6.8), win(17.5, 3, 5.6, 6.8)],
    n: [door(5, 1.0, 2.2), win(14, 3, 5.6, 6.8), win(26, 3, 5.6, 6.8)],
    w: [win(8, 2.4, 5.6, 6.8), win(16, 2.4, 5.6, 6.8)],
    e: [door(12, 5, 5)],
  }, rnd);
  // Second roll-up door jammed half down (you can walk under it).
  p.box(-W / 2 + 26, 2.3, D / 2 - 0.08, 5, 2.8, 0.08, m.metal, 'metal', 1.2);
  // Columns and roof trusses.
  for (const cx of [-10, 0, 10]) for (const cz of [-4.5, 4.5]) p.box(cx, 0.1, cz, 0.3, H - 0.1, 0.3, m.steel, 'metal', 1);
  for (const cx of [-15, -5, 5, 15]) p.box(cx, H - 0.5, 0, 0.18, 0.4, D - 0.4, m.steel, null, 1);
  // Low-pitch roof with one panel missing (sunlight shaft onto the floor).
  const pitch = 0.12, half = D / 2 + 0.3, rise = (D / 2) * Math.tan(pitch);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      if (side > 0 && k === 5) continue;
      const px = -W / 2 - 0.3 + (k + 0.5) * ((W + 0.6) / 8);
      p.box(px, H + rise - (half / 2) * Math.tan(pitch) - 0.05, side * half / 2, (W + 0.6) / 8, 0.1, half / Math.cos(pitch),
        m.warehouse, null, 2.4, side > 0 ? [pitch, 0, 0] : [pitch, Math.PI, 0]);
    }
    p.collide(-W / 2, H, side > 0 ? 0 : -D / 2, W / 2, H + rise * 0.5, side > 0 ? D / 2 : 0, 'metal');
  }
  // Gable ends.
  const s = new Shape();
  s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, rise); s.closePath();
  for (const side of [-1, 1]) {
    const g = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(side * (W / 2 - 0.08), H + 0.1, 0);
    p.geo(g, m.warehouse);
  }
  // Mezzanine office at the west end: office walls below, deck with railing on top, stairs up the side.
  const mx0 = -W / 2 + 0.16, mx1 = -12, mz0 = -D / 2 + 0.16, mz1 = 4.4, my = 3.4;
  p.box((mx0 + mx1) / 2, my, (mz0 + mz1) / 2, mx1 - mx0, 0.2, mz1 - mz0, m.concreteDark, 'concrete', 3);
  for (const cz of [-8, -2, 3.8]) p.box(mx1 + 0.2, 0.1, cz, 0.2, my - 0.1, 0.2, m.steel, 'metal', 1);
  const office: WallStyle = { ext: m.plaster, int: m.plaster, surface: 'wood', trim: m.steel };
  wall(p, m, 'z', mz0, 2.6, mx1 - 0.1, 0.14, 0.1, my - 0.1, [win(3, 2.6, 1.0, 2.3), door(9, 0.95, 2.2), win(12.5, 2.2, 1.0, 2.3)], office, 1, rnd);
  wall(p, m, 'x', mx0, mx1, 2.6, 0.14, 0.1, my - 0.1, [win(4, 2, 1.0, 2.3)], office, 1, rnd);
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lx = Math.abs(x1 - x0) || 0.05, lz = Math.abs(z1 - z0) || 0.05;
    p.box(cx, my + 0.2 + 0.95, cz, lx + 0.05, 0.05, lz + 0.05, m.hazard, null, 1);
    p.box(cx, my + 0.2 + 0.45, cz, lx, 0.04, lz, m.hazard, null, 1);
    p.collide(cx - lx / 2, my + 0.2, cz - lz / 2, cx + lx / 2, my + 1.2, cz + lz / 2, 'metal');
  };
  rail(mx1, mz0, mx1, 3.1);
  rail(mx0, mz1, mx1, mz1);
  // Stairs: from the floor at x = -6 up to the deck edge at x = -12, along z = 3.8.
  stairs(p, -6.2, 3.8, 0.1, 14, (my + 0.2 - 0.1) / 14, 0.42, 1.1, m.steel, -1);
  // Pallet racks: uprights, beams and decks you can climb and stand on.
  for (const rz of [-6.5, 0.5]) {
    for (let bay = 0; bay < 5; bay++) {
      const bx = -6 + bay * 3.2;
      for (const s2 of [0, 1]) for (const dz of [-0.55, 0.55]) p.box(bx + s2 * 3.1, 0.1, rz + dz, 0.1, 5.4, 0.1, m.containers[3], 'metal', 1);
      for (const ly of [1.7, 3.5, 5.2]) {
        p.box(bx + 1.55, ly, rz, 3.1, 0.12, 1.2, m.containers[1], 'metal', 1);
        if (rnd() < 0.75) pallet(b, m, x + bx + 1.55 + (rnd() - 0.5) * 0.8, ly + 0.12, z + rz, 0, rnd() < 0.7 ? 'boxes' : 'sacks', rnd);
      }
      if (rnd() < 0.6) pallet(b, m, x + bx + 1.55, 0.1, z + rz, 0, 'boxes', rnd);
    }
  }
  // Forklift, barrels, loose pallets, a workbench.
  forklift(b, m, x + 8, z + 8, -0.4 + Math.PI / 2);
  for (let k = 0; k < 6; k++) barrel(b, m, x + 15 + (k % 3) * 0.62, z - 9 + Math.floor(k / 3) * 0.62, rnd, m.containers[k % 2 ? 1 : 0]);
  barrel(b, m, x + 13.5, z - 7, rnd, m.rust, true);
  for (let k = 0; k < 4; k++) pallet(b, m, x - 3 + k * 0.1, 0.1 + k * 0.14, z + 8.5, 0.05 * k);
  shelf(p.at(0, 0, 0, 0.1), m, -W / 2 + 0.5, 8, Math.PI / 2, 3.5, 2.4, m.steel, rnd, [m.fabric[0], m.containers[2]]);
  const sign = decalMat(m, 'wh-sign', 512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1f3040'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 76px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WAREHOUSE 3', w / 2, h / 2 + 4);
  }, { wear: 1 });
  plane(p, -W / 2 + 18, 6.2, D / 2 + 0.02, 6, 1.5, sign);
}

function forklift(b: Builder, m: TownMaterials, x: number, z: number, ry: number) {
  const p = new Placer(b, x, 0, z, ry);
  p.box(0, 0.25, 0, 2.2, 0.9, 1.1, m.yellowPaint, 'metal', 1);
  p.box(-0.6, 1.15, 0, 0.9, 0.5, 1.1, m.black, null, 1);
  for (const s of [-1, 1]) {
    p.box(-0.2, 1.15, s * 0.5, 0.06, 1.1, 0.06, m.black, null, 1);
    p.box(1.25, 0, s * 0.35, 0.08, 2.6, 0.1, m.steel, null, 1);
    p.box(1.8, 0.05, s * 0.3, 1.1, 0.05, 0.12, m.steel, null, 1);
    for (const wx of [-0.7, 0.7]) p.cyl(wx, 0.3, s * 0.55, 0.3, 0.2, m.rubber, 12, [Math.PI / 2, 0, 0]);
  }
  p.box(-0.2, 2.2, 0, 1.1, 0.06, 1.1, m.black, null, 1);
}

/**
 * Container yard between the warehouse and the crane: double rows of 40 ft boxes stacked 1–3 high with aisles you
 * can fight down, gaps between stacks, and a few open 20 ft boxes you can walk into.
 */
export function containerYard(b: Builder, m: TownMaterials, rnd: Rnd, blocked: [number, number, number, number][]) {
  const rows = [-73.5, -75.95, -87.5, -89.95, -99.5, -101.95];
  const xs = [-13, 0.5, 14, 27.5, 41];
  const H = 2.59;
  rows.forEach((rz, ri) => {
    xs.forEach((cx, ci) => {
      const r = rnd();
      if (r < 0.14) return; // gap in the row
      if (r < 0.26) {
        // Two 20 ft boxes; one of them open.
        container(b, m, cx - 3.05, 0, rz, false, 0, Math.floor(rnd() * 6), rnd, rnd() < 0.7);
        container(b, m, cx + 3.05, 0, rz, false, Math.PI, Math.floor(rnd() * 6), rnd, false);
        blocked.push([cx - 6.1, rz - 1.25, cx + 6.1, rz + 1.25]);
        return;
      }
      const height = (ri + ci) % 4 === 0 ? 3 : rnd() < 0.45 ? 2 : 1;
      for (let k = 0; k < height; k++) {
        const jitter = k ? (rnd() - 0.5) * 0.25 : 0;
        container(b, m, cx + jitter, k * H, rz, true, rnd() < 0.5 ? 0 : Math.PI, Math.floor(rnd() * 6), rnd);
      }
      blocked.push([cx - 6.1, rz - 1.25, cx + 6.1, rz + 1.25]);
    });
  });
  // A couple of boxes left in the aisles, one knocked askew.
  container(b, m, -4, 0, -94.6, false, Math.PI / 2, 2, rnd, false);
  container(b, m, 33, 0, -81.2, false, 0.12, 4, rnd, false);
  blocked.push([-5.3, -97.7, -2.7, -91.6], [29.5, -83, 36.5, -79.5]);
}

/** Ship-to-shore gantry crane straddling the quay: four legs, portal beams, a long boom out over the water. */
export function crane(b: Builder, m: TownMaterials, cx: number, zLand: number, zSea: number) {
  const y = m.craneYellow, legH = 30, x0 = cx - 10, x1 = cx + 10;
  const p = new Placer(b, 0, 0, 0, 0);
  for (const lx of [x0, x1]) for (const lz of [zLand, zSea]) {
    p.box(lx, 0, lz, 1.3, legH, 1.3, y, 'metal', 2);
    p.box(lx, 0, lz, 2.4, 0.9, 3.2, m.steel, 'metal', 1); // bogie
  }
  for (const lz of [zLand, zSea]) for (const yy of [12, legH - 1.5]) p.box(cx, yy, lz, 20, 1.2, 1.1, y, null, 2);
  for (const lx of [x0, x1]) {
    p.box(lx, legH - 1.5, (zLand + zSea) / 2, 1.1, 1.3, zLand - zSea, y, null, 2);
    // Diagonal bracing on each side frame.
    const len = Math.hypot(zLand - zSea, legH - 13.5), a = Math.atan2(legH - 13.5, zLand - zSea);
    b.rbox(lx, 12.5 + (legH - 13.5) / 2, (zLand + zSea) / 2, 0.6, 0.6, len, [a, 0, 0], y, 2);
  }
  // Boom: twin girders from the backreach over the land to far out over the water.
  const zBack = zLand + 14, zTip = zSea - 58, by = legH + 1;
  for (const gx of [cx - 3.2, cx + 3.2]) {
    p.box(gx, by, (zBack + zTip) / 2, 1.4, 2.4, zBack - zTip, y, null, 2);
    // Truss diagonals.
    for (let zz = zTip + 3; zz < zBack - 3; zz += 6) b.rbox(gx, by + 1.2, zz, 0.25, 0.25, 2.6, [0.8, 0, 0], m.steel, 1);
  }
  for (let zz = zTip + 2; zz < zBack; zz += 8) p.box(cx, by + 2.2, zz, 7.8, 0.3, 0.4, y, null, 1);
  // Machinery house and operator cab.
  p.box(cx, by + 2.4, zBack - 5, 9, 4, 9, m.white, null, 2);
  p.box(cx - 1.5, by - 3.2, zSea - 4, 3, 3, 3, m.white, null, 1);
  p.box(cx - 1.5, by - 2.7, zSea - 5.52, 2.6, 1.6, 0.04, m.glass, null, 1);
  // A-frame apex and forestay cables to the tip.
  const apexY = by + 18, apexZ = (zLand + zSea) / 2;
  for (const gx of [cx - 3.2, cx + 3.2]) {
    for (const dz of [-6, 6]) {
      const len = Math.hypot(dz, apexY - by), a = Math.atan2(dz, apexY - by);
      b.rbox(gx, (by + apexY) / 2, apexZ + dz / 2, 0.9, len, 0.9, [-a, 0, 0], y, 2);
    }
    for (const [tz, ty] of [[zTip + 2, by + 2], [zSea - 25, by + 2], [zBack - 2, by + 2]] as const) {
      const dz = tz - apexZ, dy = ty - apexY, len = Math.hypot(dz, dy), a = Math.atan2(-dz, -dy);
      b.rbox(gx, (apexY + ty) / 2, (apexZ + tz) / 2, 0.08, len, 0.08, [a, 0, 0], m.black, 1, false);
    }
  }
  p.box(cx, apexY - 0.5, apexZ, 7.8, 1.2, 1.2, y, null, 1);
  // Spreader hanging under the boom, and the crane rails on the quay.
  p.box(cx, 18, zSea - 20, 3, 0.8, 12.5, y, null, 1);
  for (const gx of [cx - 1, cx + 1]) b.rbox(gx, (by + 18.8) / 2, zSea - 20, 0.05, by - 18.8, 0.05, [0, 0, 0], m.black, 1, false);
  for (const lz of [zLand, zSea]) p.box(cx, 0, lz, 120, 0.05, 0.3, m.steel, null, 1);
  const logo = decalMat(m, 'crane-no', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 190px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('07', w / 2, h / 2 + 10);
  }, { transparent: true, wear: 0.5 });
  plane(p, x0, 22, zLand + 0.66, 2.4, 2.4, logo);
}

/** Two fuel tanks inside a concrete bund wall, with pipe runs toward the quay. */
export function tankFarm(b: Builder, m: TownMaterials, x0: number, z0: number, x1: number, z1: number) {
  const p = new Placer(b, 0, 0, 0, 0);
  const t = 0.35, h = 1.3;
  p.box((x0 + x1) / 2, 0, z0, x1 - x0, h, t, m.concrete, 'concrete', 2);
  p.box((x0 + x1) / 2, 0, z1, x1 - x0, h, t, m.concrete, 'concrete', 2);
  p.box(x0, 0, (z0 + z1) / 2, t, h, z1 - z0 - t, m.concrete, 'concrete', 2);
  // East wall with a gap to walk in.
  p.box(x1, 0, z0 + (z1 - z0) * 0.25, t, h, (z1 - z0) * 0.5, m.concrete, 'concrete', 2);
  const cz = (z0 + z1) / 2, r = 7, H = 11;
  for (const cx of [x0 + 9, x0 + 27]) {
    const g = new CylinderGeometry(r, r, H, 40, 1, true);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / 3, uv.getY(i) * H / 3);
    g.translate(cx, H / 2, cz);
    b.add(g, m.tankWhite);
    const roof = new ConeGeometry(r + 0.15, 1.6, 40);
    roof.translate(cx, H + 0.8, cz);
    b.add(roof, m.tankWhite);
    // Colliders: a cross of boxes approximating the cylinder.
    const a = r * 0.92, c2 = r * 0.62;
    b.collide(cx - a, 0, cz - c2, cx + a, H, cz + c2, 'steel');
    b.collide(cx - c2, 0, cz - a, cx + c2, H, cz + a, 'steel');
    // Spiral-ish stair suggested by a ladder cage and a top railing ring.
    p.box(cx + r + 0.3, 0, cz, 0.6, H + 1, 0.06, m.steel, null, 1);
    const ring = new CylinderGeometry(r + 0.1, r + 0.1, 0.05, 40, 1, true);
    ring.translate(cx, H + 1.0, cz);
    b.add(ring, m.steel);
  }
  // Pipe rack running north to the quay.
  for (let zz = z0 - 4; zz > -116; zz -= 6) {
    p.box(x0 + 18, 0, zz, 0.25, 2.6, 0.25, m.steel, 'metal', 1);
    p.box(x0 + 18, 2.6, zz, 2.6, 0.2, 0.25, m.steel, null, 1);
  }
  for (const dx of [-0.8, 0, 0.8]) {
    const len = z0 - 4 + 116;
    const g = new CylinderGeometry(0.2, 0.2, len, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x0 + 18 + dx, 3.0, z0 - 4 - len / 2);
    b.add(g, m.rust);
  }
}

/** Quay furniture along the water's edge: bollards and hanging tyre fenders. */
export function quay(b: Builder, m: TownMaterials, zEdge: number, xa: number, xb: number, rnd: Rnd) {
  const p = new Placer(b, 0, 0, 0, 0);
  for (let x = xa; x <= xb; x += 14) {
    p.cyl(x, 0, zEdge + 0.7, 0.22, 0.55, m.steel, 12);
    p.cyl(x, 0.55, zEdge + 0.7, 0.3, 0.1, m.steel, 12);
    b.collide(x - 0.25, 0, zEdge + 0.45, x + 0.25, 0.6, zEdge + 0.95, 'steel');
    tire(b, m, x + 7, -0.8, zEdge - 0.15, [0, 0, 0]);
  }
  // Yellow safety line.
  p.box(0, 0.012, zEdge + 1.4, xb - xa, 0.005, 0.15, m.hazard, null, 1, null, false);
  void rnd;
}

/** A container ship moored offshore, a breakwater and a little lighthouse: pure backdrop. */
export function seaBackdrop(b: Builder, m: TownMaterials, rnd: Rnd) {
  const L = 190, B = 30, D = 16;
  const s = new Shape();
  s.moveTo(-L / 2, D); s.lineTo(-L / 2 + 6, 0); s.lineTo(L / 2 - 22, 0); s.quadraticCurveTo(L / 2 + 4, 0, L / 2 + 8, D);
  s.closePath();
  const hull = new ExtrudeGeometry(s, { depth: B, bevelEnabled: false });
  hull.translate(0, -8, -B / 2);
  b.add(b.place(hull, -80, 0, -360, [0, 0.12, 0]), m.containers[5], false);
  const p = new Placer(b, -80, 0, -360, 0.12);
  p.box(-L / 2 + 16, 8, 0, 16, 18, B - 4, m.white, null, 3);
  p.box(-L / 2 + 14, 26, 0, 4, 8, 3, m.black, null, 2);
  for (let bx = -L / 2 + 34; bx < L / 2 - 20; bx += 12.5) {
    for (let row = -2; row <= 2; row++) {
      const h = 1 + Math.floor(rnd() * 4);
      p.box(bx, 8, row * 5.2, 12.2, h * 2.6, 5, m.containers[Math.floor(rnd() * 6)], null, 3);
    }
  }
  // Breakwater with a lighthouse.
  for (let x = 60; x < 420; x += 9) {
    b.rbox(x, -0.6, -250 + Math.sin(x * 0.05) * 3, 10, 3.2, 7, [0, rnd() * 0.4, (rnd() - 0.5) * 0.2], m.concreteDark, 3, false);
  }
  const lh = new Placer(b, 66, 0, -250, 0);
  lh.cyl(0, 0.8, 0, 2.2, 14, m.white, 16, null, 1.6);
  lh.cyl(0, 6, 0, 2.05, 3, m.pumpRed, 16, null, 1.9);
  lh.cyl(0, 14.8, 0, 1.4, 2, m.glass, 12);
  lh.cyl(0, 16.8, 0, 1.6, 1.2, m.pumpRed, 12, null, 0.2);
}

