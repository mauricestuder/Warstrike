import { BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, type Material } from 'three';
import { block } from './Blocks';
import { door, gable, house, shell, win, type WallStyle } from './Buildings';
import { barrel, car, decalMat, pallet, Placer, plane, signPost, table, tire } from './Props';
import type { Site } from './Site';
import { bush, tree } from './Vegetation';

const floorY = (k: number) => 0.15 + k * 3.2;

/**
 * The west side: the fish docks on the harbour, Miller Farm along Maple Street (barn with a hayloft, silos, grain bins,
 * the farmhouse, a cornfield tall enough to lose someone in), and south of it the woods with cabins, a pond, a
 * campground and a fire lookout tower.
 */
export function westSide(s: Site) {
  fishDocks(s);
  farm(s);
  woods(s);
}

// ------------------------------------------------------------------------------------------------ fish docks

function fishDocks(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Two boat sheds open toward the water, boats up on cradles in and in front of them.
  for (const cx of [-222, -196]) {
    const p = new Placer(s.b, cx, 0, -96), W = 22, D = 18, H = 8;
    const style: WallStyle = { ext: m.warehouse, int: m.warehouse, surface: 'metal', trim: m.steel };
    p.box(0, 0, 0, W, 0.1, D, m.concreteDark, 'concrete', 4);
    shell(p, m, W, D, 0.1, H, 0.16, style, { n: [door(W / 2, W - 3, 6.2)], s: [door(4, 1.0, 2.2), win(12, 3, 4.6, 6)], e: [win(9, 3, 4.6, 6)] }, rnd);
    for (const side of [-1, 1]) p.box(0, H - 0.3 + 1.1, side * D / 4, W + 0.8, 0.12, D / 2 + 0.9, m.metal, side > 0 ? 'metal' : null, 3, [side * 0.24, 0, 0]);
    p.box(0, H, 0, W, 0.12, D, m.metal, 'metal', 3);
    boat(s, cx - 3, -98, 0.05, rnd() < 0.5 ? m.bluePaint : m.redPaint, 1);
    s.occupy([cx - W / 2 - 0.3, -96 - D / 2 - 0.3, cx + W / 2 + 0.3, -96 + D / 2 + 0.3]);
  }
  boat(s, -170, -108, Math.PI / 2 + 0.1, m.whitePaint, 1.2);
  boat(s, -150, -100, Math.PI / 2 - 0.05, m.greenPaint, 0.9);
  // Fish market: two storeys with a roof you can get to.
  block(s.b, m, -150, -76, 0, { W: 22, D: 12, floors: 2, ext: m.boardWhite, trim: m.bluePaint, use: 'shop', roofAccess: true, backDoor: true, rnd,
    shop: { name: 'CALVERT FISH CO.', color: '#23466a', awning: m.bluePaint } });
  s.occupy([-161.3, -82.3, -138.7, -69.7]);
  // Crates, nets, barrels, a forklift-sized clutter of pallets.
  for (let k = 0; k < 8; k++) pallet(s.b, m, -180 + (k % 4) * 1.4, 0.14 * Math.floor(k / 4), -72, 0.1 * k, k % 2 ? 'boxes' : 'sacks', rnd);
  for (let k = 0; k < 6; k++) barrel(s.b, m, -132 + (k % 3) * 0.62, -110 + Math.floor(k / 3) * 0.62, rnd, m.containers[(k + 1) % 4], k === 5);
  // Boats moored out in the harbour (backdrop) and a wooden pier past the quay edge.
  const pier = new Placer(s.b, -178, 0, -130);
  pier.box(0, 0.2, 0, 4, 0.2, 24, m.woodGrey, null, 1.4);
  for (let z = -11; z <= 11; z += 3.6) for (const sx of [-1.8, 1.8]) pier.cyl(sx, -2.5, z, 0.16, 2.9, m.bark, 8);
  boat(s, -186, -140, 0.1, m.redPaint, 1.1, -1.2);
  boat(s, -168, -146, -0.2, m.bluePaint, 1, -1.2);
  s.dummy(-150, floorY(2), -74);
  s.dummy(-196, 0.1, -94);
  s.anchor(-180, -70);
}

/** A fishing boat hull with a wheelhouse, on a cradle (`y` 0) or afloat (negative `y`). */
function boat(s: Site, x: number, z: number, ry: number, paint: Material, scale: number, y = 0) {
  const m = s.m, L = 12 * scale, B = 4 * scale, Dp = 2.2 * scale, lift = y < 0 ? y : 1.1;
  const sh = new Shape();
  sh.moveTo(-L / 2, Dp); sh.lineTo(-L / 2 + 0.3, 0.6 * scale); sh.quadraticCurveTo(-L / 2 + 1, 0, 0, 0);
  sh.quadraticCurveTo(L / 2 - 1.5, 0, L / 2, Dp + 0.4 * scale); sh.closePath();
  const p = new Placer(s.b, x, lift, z, ry);
  for (const side of [-1, 1]) {
    const g = new ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
    g.translate(0, 0, side * B / 2 - (side > 0 ? 0.12 : 0));
    p.geo(g, paint);
  }
  p.box(0, 0.2, 0, L - 1.6, 0.15, B - 0.2, m.woodGrey, null, 1.2);
  p.box(-L / 2 + 0.06, 0.6 * scale, 0, 0.12, Dp - 0.6 * scale, B, paint, null, 1);
  p.box(-L / 4, Dp, 0, L * 0.3, 2.0 * scale, B * 0.7, m.white, null, 1);
  p.box(-L / 4, Dp + 1.2 * scale, B * 0.351, L * 0.26, 0.6 * scale, 0.02, m.glass, null, 1);
  p.cyl(L / 8, Dp, 0, 0.1, 5 * scale, m.steel, 8);
  if (y >= 0) {
    for (const lx of [-L / 3, 0, L / 3]) for (const side of [-1, 1]) p.box(lx, -lift, side * (B / 2 - 0.3), 0.3, lift + 0.3, 0.3, m.wood, null, 1);
    p.collide(-L / 2, -lift, -B / 2, L / 2, Dp, B / 2, 'wood');
  }
}

// ------------------------------------------------------------------------------------------------ farm

function farm(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Farmhouse facing Maple Street, with a gravel drive and a mailbox.
  house(s.b, m, -150, -2, 0, { W: 12, D: 10, floors: 2, siding: m.siding[2], roof: m.shingle, chimney: true, rnd });
  s.occupy([-156.2, -7.2, -143.8, 3.2], [-152, 3, -146, 6.4]);
  s.flat(-142, -4, -138, 15.5, 0.013, m.track, 4);
  s.pave([-142, -4, -138, 15.5]);
  // Farm track north from Maple Street to the barnyard.
  s.flat(-212, -48, -170, -8, 0.012, m.track, 5);
  s.flat(-186, -8, -180, 15.5, 0.012, m.track, 4);
  s.pave([-212, -48, -170, -8], [-186, -8, -180, 15.5]);
  barn(s, -192, -28);
  // Silos and grain bins.
  silo(s, -222, -40, 3.2, 15, m.concrete, m.copper);
  silo(s, -222, -24, 3.2, 17, m.concrete, m.copper);
  for (const [bx, bz] of [[-226, -4], [-216, -4], [-206, -4]]) grainBin(s, bx, bz);
  // Pole barn with a tractor and hay.
  const pb = new Placer(s.b, -166, 0, -38);
  for (let lx = -9; lx <= 9; lx += 6) for (const lz of [-5, 5]) pb.box(lx, 0, lz, 0.25, 4.4, 0.25, m.wood, 'wood', 1);
  pb.box(0, 4.4, 0, 20, 0.12, 11.5, m.metal, 'metal', 3, [0.06, 0, 0]);
  tractor(s, -170, -38, 0.2);
  for (let k = 0; k < 6; k++) hayBale(s, -161 + (k % 3) * 1.9, -41 + Math.floor(k / 3) * 1.6, 0, k >= 3 ? 1.4 : 0);
  s.occupy([-176.5, -44, -155.5, -32]);
  // Round bales out in the hay meadow and a rail fence along the road.
  for (let k = 0; k < 14; k++) hayBale(s, -232 + rnd() * 80, -112 + rnd() * 12 + (k % 2) * 40, rnd() * Math.PI, 0);
  railFence(s, -238, 13, -138, 13, rnd);
  railFence(s, -238, 27, -134, 27, rnd);
  // Chicken coop and a water trough.
  const coop = new Placer(s.b, -206, 0, -58, 0.2);
  shell(coop, m, 5, 3.4, 0.4, 2, 0.1, { ext: m.woodGrey, int: m.woodGrey, surface: 'wood', trim: m.white }, { s: [door(1.2, 0.8, 1.6)] }, rnd);
  for (const sx of [-2.3, 2.3]) for (const sz of [-1.5, 1.5]) coop.box(sx, 0, sz, 0.15, 0.4, 0.15, m.wood, null, 1);
  coop.box(0, 0.3, 0, 5, 0.1, 3.4, m.wood, 'wood', 1);
  coop.box(0, 2.4, 0, 5.6, 0.1, 4.0, m.metal, 'metal', 2, [0.12, 0, 0]);
  s.occupy([-209, -60.5, -203, -55.5]);
  car(s.b, m, -146, 10, 0.1, m.carPaint[4], rnd, { noWheels: true });
  car(s.b, m, -186, -14, 1.2, m.redPaint, rnd);
  for (let k = 0; k < 5; k++) tire(s.b, m, -175 + k * 0.7, 0.12, -50, [Math.PI / 2, 0, 0]);
  // The cornfield south of Maple Street, split by a track.
  cornfield(s, -236, 34, -186, 116);
  cornfield(s, -180, 34, -138, 116);
  s.flat(-186, 27, -180, 120, 0.012, m.track, 4);
  s.pave([-186, 27, -180, 120]);
  scarecrow(s, -210, 70);
  // Farm trees, a windbreak along the north edge.
  for (let x = -236; x < -140; x += 7 + rnd() * 4) s.tree(x, -60 - rnd() * 3, 'tall', 1 + rnd() * 0.3);
  for (const [tx, tz] of [[-160, -16], [-138, -14], [-172, 6], [-232, 4]]) s.tree(tx, tz, 'oak', 1.1);
  const sign = decalMat(m, 'miller-farm', 512, 192, (ctx, w, h) => {
    ctx.fillStyle = '#8a2a20'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 10; ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#e8e0d0'; ctx.font = 'bold 64px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('MILLER FARM', w / 2, 90);
    ctx.font = 'italic 34px Georgia, serif'; ctx.fillText('Fresh eggs · Sweet corn', w / 2, 150);
  }, { wear: 1.6 });
  signPost(s.b, -178, 14, 0, sign, m.wood, 2.4, 0.9, 1.4);
  s.dummy(-198, 3.6, -30);
  s.dummy(-150, 3.55, -4);
  s.dummy(-200, 0.1, 80);
  s.anchor(-200, -12);
}

/** Red timber barn: big doors front and back, a hayloft on posts with stairs, a pitched metal roof. */
function barn(s: Site, x: number, z: number) {
  const m = s.m, rnd = s.rnd, W = 24, D = 16, H = 6.4, loft = 3.6;
  const p = new Placer(s.b, x, 0, z, 0);
  const style: WallStyle = { ext: m.barnRed, int: m.woodGrey, surface: 'wood', trim: m.boardWhite };
  p.box(0, 0, 0, W, 0.12, D, m.concreteDark, 'concrete', 4);
  shell(p, m, W, D, 0.12, H, 0.2, style, {
    s: [door(W / 2, 4.6, 4.2), win(4, 1.2, 4.4, 5.6), win(W - 4, 1.2, 4.4, 5.6)],
    n: [door(W / 2, 4.6, 4.2), door(3, 1.0, 2.2)],
    w: [win(D / 2, 1.6, 4.3, 5.8)], e: [win(5, 1.2, 1.2, 2.4), win(11, 1.2, 1.2, 2.4)],
  }, rnd);
  // Hayloft over the west half, open over the east half (a drop you can jump down).
  p.box(-W / 4 - 0.1, loft - 0.2, 0, W / 2 - 0.6, 0.2, D - 0.4, m.wood, 'wood', 1.6);
  for (const lx of [-1.2, -6]) for (const lz of [-4, 4]) p.box(lx, 0.12, lz, 0.3, loft - 0.32, 0.3, m.wood, 'wood', 1);
  p.box(-0.7, loft, 0.85, 0.08, 1.0, D - 2.3, m.wood, 'wood', 1);
  // Stairs up the north wall, rising west.
  const n = 13, rise = (loft - 0.12) / n, run = 0.3;
  for (let k = 0; k < n; k++) p.box(3.4 - (k + 0.5) * run, 0.12 + rise * (k + 1) - 0.2, -D / 2 + 1.0, run, 0.2, 1.1, m.wood, 'wood', 1);
  p.box(3.4 - n * run - 0.6, loft - 0.2, -D / 2 + 1.0, 1.2, 0.2, 1.1, m.wood, 'wood', 1);
  // Bales in the loft and on the floor, stalls along the east wall.
  for (let k = 0; k < 8; k++) p.box(-W / 2 + 1.4 + (k % 4) * 1.3, loft + Math.floor(k / 4) * 0.5, 4 + (k % 2) * 0.5, 1.2, 0.5, 0.6, m.hay, 'wood', 1);
  for (let k = 0; k < 3; k++) p.box(W / 2 - 1.5, 0.12, -4 + k * 3.3, 2.8, 1.3, 0.1, m.woodGrey, 'wood', 1, [0, Math.PI / 2, 0]);
  gable(p, m, W, D, H + 0.12, 0.62, 0.5, m.metal, m.barnRed);
  const sign = decalMat(m, 'barn-star', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#e8e0d0'; ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? w * 0.2 : w * 0.46; ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    ctx.fill();
  }, { transparent: true, wear: 1.5 });
  plane(p, 0, H + 1.6, D / 2 + 0.13, 2.2, 2.2, sign);
  s.occupy([x - W / 2 - 0.3, z - D / 2 - 0.3, x + W / 2 + 0.3, z + D / 2 + 0.3]);
}

function silo(s: Site, x: number, z: number, r: number, h: number, wallMat: Material, cap: Material) {
  const g = new CylinderGeometry(r, r, h, 28, 1, true);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / 2.4, uv.getY(i) * h / 2.4);
  s.b.add(g.translate(x, h / 2, z), wallMat);
  s.b.add(new ConeGeometry(r + 0.2, 2.2, 28).translate(x, h + 1.1, z), cap);
  for (let y = 1.5; y < h; y += 2.2) s.b.add(new CylinderGeometry(r + 0.05, r + 0.05, 0.12, 28, 1, true).translate(x, y, z), s.m.steel);
  const a = r * 0.9, c = r * 0.6;
  s.b.collide(x - a, 0, z - c, x + a, h, z + c, 'concrete');
  s.b.collide(x - c, 0, z - a, x + c, h, z + a, 'concrete');
  s.occupy([x - r - 0.5, z - r - 0.5, x + r + 0.5, z + r + 0.5]);
}

function grainBin(s: Site, x: number, z: number) {
  const m = s.m, r = 3.6, h = 5;
  const g = new CylinderGeometry(r, r, h, 28, 1, true);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / 3, uv.getY(i) * h / 3);
  s.b.add(g.translate(x, h / 2, z), m.warehouse);
  s.b.add(new ConeGeometry(r + 0.15, 1.8, 28).translate(x, h + 0.9, z), m.warehouse);
  const a = r * 0.9, c = r * 0.6;
  s.b.collide(x - a, 0, z - c, x + a, h, z + c, 'metal');
  s.b.collide(x - c, 0, z - a, x + c, h, z + a, 'metal');
  s.occupy([x - r - 0.4, z - r - 0.4, x + r + 0.4, z + r + 0.4]);
}

function hayBale(s: Site, x: number, z: number, ry: number, y: number) {
  const p = new Placer(s.b, x, y, z, ry), m = s.m;
  p.cyl(0, 0.7, -0.6, 0.7, 1.2, m.hay, 16, [Math.PI / 2, 0, 0]);
  p.collide(-0.62, 0, -0.6, 0.62, 1.35, 0.6, 'sand');
}

function tractor(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0.6, 0.7, 0, 2.6, 0.9, 1.0, m.greenPaint, null, 1);
  p.box(-0.9, 0.8, 0, 1.4, 0.7, 1.2, m.greenPaint, null, 1);
  p.box(-1.0, 1.5, 0, 1.3, 1.4, 1.3, m.glass, null, 1);
  p.box(-1.0, 2.9, 0, 1.5, 0.1, 1.5, m.greenPaint, null, 1);
  p.cyl(1.2, 1.5, 0.3, 0.07, 1.2, m.black, 8);
  for (const side of [-1, 1]) {
    p.cyl(-1.0, 0.85, side * 0.85, 0.85, 0.5, m.rubber, 16, [Math.PI / 2, 0, 0]);
    p.cyl(1.4, 0.5, side * 0.75, 0.5, 0.3, m.rubber, 14, [Math.PI / 2, 0, 0]);
  }
  p.collide(-1.9, 0, -1.1, 2, 2.9, 1.1, 'metal');
}

function railFence(s: Site, x0: number, z0: number, x1: number, z1: number, rnd: () => number) {
  const m = s.m, len = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0);
  const p = new Placer(s.b, (x0 + x1) / 2, 0, (z0 + z1) / 2, ry);
  for (let u = -len / 2; u <= len / 2; u += 3) {
    if (rnd() < 0.08) continue;
    p.box(u, 0, 0, 0.14, 1.2, 0.14, m.woodGrey, null, 1);
    if (u + 3 <= len / 2 && rnd() > 0.1) for (const y of [0.45, 0.95]) p.box(u + 1.5, y, 0, 3, 0.1, 0.06, m.woodGrey, null, 1);
  }
}

function scarecrow(s: Site, x: number, z: number) {
  const p = new Placer(s.b, x, 0, z, 0.4), m = s.m;
  p.box(0, 0, 0, 0.1, 2.6, 0.1, m.wood, null, 1);
  p.box(0, 1.9, 0, 1.8, 0.08, 0.08, m.wood, null, 1);
  p.box(0, 1.5, 0, 0.5, 0.7, 0.25, m.fabric[2], null, 1);
  p.cyl(0, 2.25, 0, 0.16, 0.32, m.sandbag, 8);
  p.cyl(0, 2.55, 0, 0.32, 0.06, m.hay, 10, null, 0.2);
}

/**
 * Rows of corn: crossed cards with an alpha-tested stalk texture, built straight into big merged geometries (one per
 * 16 m tile), plus leaf volumes so the bots can't see through it and tall weeds so it hides a crouching player.
 */
function cornfield(s: Site, x0: number, z0: number, x1: number, z1: number) {
  const rnd = s.rnd, T = 16;
  for (let tx = x0; tx < x1; tx += T) for (let tz = z0; tz < z1; tz += T) {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [];
    for (let z = tz + 0.45; z < Math.min(tz + T, z1); z += 0.95) {
      for (let x = tx + rnd() * 0.3; x < Math.min(tx + T, x1); x += 0.55 + rnd() * 0.15) {
        if (rnd() < 0.06) continue;
        const h = 2.0 + rnd() * 0.6, w = 0.75, cx = x, cz = z + (rnd() - 0.5) * 0.18, a = rnd() * Math.PI;
        for (const da of [0, Math.PI / 2]) {
          const dx = Math.cos(a + da) * w / 2, dz = Math.sin(a + da) * w / 2, lean = (rnd() - 0.5) * 0.25;
          const q = [[cx - dx, 0, cz - dz, 0, 0], [cx + dx, 0, cz + dz, 1, 0], [cx + dx + lean, h, cz + dz, 1, 1], [cx - dx + lean, h, cz - dz, 0, 1]];
          for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k][0], q[k][1], q[k][2]); uv.push(q[k][3], q[k][4]); nor.push(0, 0.85, 0.5); }
        }
      }
    }
    if (!pos.length) continue;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    s.b.add(g, s.m.corn, false);
  }
  for (let x = x0 + 2; x < x1; x += 4) for (let z = z0 + 2; z < z1; z += 4) s.b.foliage.add(x, 1.25, z, 2.7, 1.35);
  s.tall([x0, z0, x1, z1]);
}

// ------------------------------------------------------------------------------------------------ woods

function woods(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Dirt road from County Road to the lookout and the campground.
  s.flat(-232, 236, -132, 244, 0.012, m.track, 5);
  s.flat(-196, 244, -188, 330, 0.012, m.track, 5);
  s.pave([-232, 236, -132, 244], [-196, 244, -188, 330]);
  // Fire lookout: four storeys and an open cab on top, the highest view on the west side.
  block(s.b, m, -205, 270, Math.PI / 2, { W: 5.4, D: 4.4, floors: 5, story: 3.4, ext: m.woodGrey, trim: m.wood, int: m.woodGrey, use: 'empty', belfry: true, rnd, floorMat: m.wood });
  s.occupy([-208, 266.5, -202, 273.5]);
  s.b.add(new ConeGeometry(4.6, 2.4, 4).rotateY(Math.PI / 4).translate(-205, 0.15 + 5 * 3.4 + 0.75 + 1.2, 270), m.shingle);
  // Cabins.
  for (const [cx, cz, ry] of [[-222, 300, 0.3], [-160, 288, -0.4], [-170, 340, 1.2], [-226, 172, 0.1], [-150, 190, 2.8]] as const) cabin(s, cx, cz, ry);
  // Pond with reeds and a little dock.
  const px = -165, pz = 236 + 30;
  s.b.add(new CircleGeometry(17, 40).rotateX(-Math.PI / 2).translate(px, 0.02, pz), m.dirt, false);
  s.b.add(new CircleGeometry(14, 40).rotateX(-Math.PI / 2).translate(px, 0.04, pz), m.water, false);
  s.occupy([px - 13, pz - 13, px + 13, pz + 13]);
  s.tall([px - 18, pz - 18, px - 12, pz + 18], [px + 12, pz - 18, px + 18, pz + 18]);
  const dock = new Placer(s.b, px, 0, pz + 10);
  dock.box(0, 0.25, 0, 2.4, 0.12, 8, m.woodGrey, 'wood', 1.2);
  for (const sx of [-1, 1]) for (const lz of [-3.5, 0, 3.5]) dock.cyl(sx * 1.1, 0, lz, 0.1, 0.3, m.bark, 6);
  // Campground: tents, picnic tables, a fire ring, a parked camper van.
  for (const [tx, tz, ry] of [[-214, 320, 0.2], [-206, 326, -0.5], [-220, 332, 1.1]] as const) tent(s, tx, tz, ry);
  for (const [tx, tz] of [[-210, 312], [-198, 318]]) table(new Placer(s.b, tx, 0, tz), m, 0, 0, rnd(), 1.8, 0.8, rnd() < 0.3);
  const ring = new Placer(s.b, -212, 0, 324);
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; ring.box(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, 0.35, 0.25, 0.3, m.concreteDark, null, 1, [0, -a, 0]); }
  ring.box(0, 0.02, 0, 0.9, 0.02, 0.9, m.charred, null, 1);
  car(s.b, m, -196, 340, 1.4, m.carPaint[2], rnd);
  // The forest itself: dense trees and undergrowth, keeping the roads and clearings open.
  const clear = (x: number, z: number) => s.inRect(x, z, 'blocked', 2.5) || s.inRect(x, z, 'paved', 2);
  for (let k = 0; k < 520; k++) {
    const x = -238 + rnd() * 104, z = 128 + rnd() * 230;
    if (clear(x, z)) continue;
    if (Math.hypot(x + 210, z - 322) < 14) continue;
    const r = rnd();
    tree(s.b, m, x, z, rnd, r < 0.1 ? 'dead' : r < 0.6 ? 'tall' : 'oak', 0.9 + rnd() * 0.5);
    s.occupy([x - 0.4, z - 0.4, x + 0.4, z + 0.4]);
  }
  for (let k = 0; k < 900; k++) {
    const x = -238 + rnd() * 104, z = 128 + rnd() * 230;
    if (clear(x, z)) continue;
    bush(s.b, m, x, z, rnd, 0.7 + rnd() * 0.9);
  }
  s.tall([-238, 128, -134, 232]);
  s.dummy(-203.7, floorY(0) + 4 * 3.4, 270);
  s.dummy(-160, 0.5, 288);
  s.dummy(-212, 0.1, 318);
  s.anchor(-170, 240);
}

function cabin(s: Site, x: number, z: number, ry: number) {
  const m = s.m, rnd = s.rnd, W = 7, D = 5.5;
  const p = new Placer(s.b, x, 0, z, ry);
  p.box(0, 0, 0, W + 0.2, 0.5, D + 0.2, m.concreteDark, 'concrete', 2);
  p.box(0, 0.48, 0, W - 0.2, 0.02, D - 0.2, m.floorWood, null, 1.6);
  shell(p, m, W, D, 0.5, 2.6, 0.2, { ext: m.bark, int: m.woodGrey, surface: 'wood', trim: m.wood }, {
    s: [door(2, 0.95, 2.1), win(5, 1.2, 0.9, 2.0, rnd() < 0.3)], n: [win(3.5, 1.2, 0.9, 2.0)], e: [win(D / 2, 1.0, 0.9, 2.0)],
  }, rnd);
  p.box(0, 3.1, 0, W, 0.1, D, m.woodGrey, 'wood', 2);
  gable(p, m, W, D, 3.2, 0.6, 0.4, m.shingle, m.bark);
  p.box(-W / 2 + 0.6, 0, -D / 2 + 0.5, 0.9, 5.2, 0.9, m.concreteDark, 'concrete', 1);
  const f = p.at(0, 0, 0, 0.5);
  table(f, m, 1.6, -0.8, 0.2, 1.2, 0.7);
  for (let k = 0; k < 2; k++) p.box(2 - W / 2 + 0.6, 0, D / 2 + 0.55 + k * 0.28, 1.2, 0.5 - (k + 1) * 0.17, 0.3, m.wood, 'wood', 1);
  const c = Math.cos(ry), sn = Math.sin(ry), hw = Math.abs(W / 2 * c) + Math.abs(D / 2 * sn) + 0.4, hd = Math.abs(W / 2 * sn) + Math.abs(D / 2 * c) + 1.2;
  s.occupy([x - hw, z - hd, x + hw, z + hd]);
}

function tent(s: Site, x: number, z: number, ry: number) {
  const m = s.m;
  const g = new ConeGeometry(1.7, 1.9, 4, 1, true).rotateY(Math.PI / 4);
  s.b.add(s.b.place(g.translate(0, 0.95, 0), x, 0, z, [0, ry, 0]), m.fabric[(Math.floor(x) & 3)], true);
  s.b.collide(x - 0.9, 0, z - 0.9, x + 0.9, 1.0, z + 0.9, 'sand');
  s.occupy([x - 1.6, z - 1.6, x + 1.6, z + 1.6]);
}

