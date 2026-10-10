import { CylinderGeometry, ConeGeometry, MeshStandardMaterial, SphereGeometry } from 'three';
import { paintedTex } from '../../render/Textures';
import { block } from './Blocks';
import { door, shell, win, type WallStyle } from './Buildings';
import { trailerBox } from './Downtown';
import { barrel, container, decalMat, pallet, Placer, plane, signPost } from './Props';
import type { Site } from './Site';

const floorY = (k: number, story = 3.2) => 0.15 + k * story;
/** Track centre lines. */
const T1 = 139, T2 = 144.5;

/**
 * The east side: a double-track railway running the length of the map with a freight train and a station, the grain
 * terminal on the quay, the steel works with its furnace hall and smokestack, a truck depot under the water tower,
 * and Calvert High with the stadium.
 */
export function eastSide(s: Site) {
  railway(s);
  grainTerminal(s);
  steelWorks(s);
  depot(s);
  school(s);
  stadium(s);
}

// ------------------------------------------------------------------------------------------------ railway

function railway(s: Site) {
  const m = s.m, b = s.b, z0 = -118, z1 = 520;
  s.flat(134.5, z0, 149.5, z1, 0.02, m.ballast, 3);
  s.pave([134.5, z0, 149.5, z1]);
  for (const tx of [T1, T2]) {
    // Sleepers, then two rails on top (no colliders: you step over them).
    for (let z = z0 + 0.4; z < z1; z += 0.68) b.box(tx, 0.02, z, 2.6, 0.14, 0.24, m.woodGrey, null, 1, false);
    for (const side of [-0.72, 0.72]) {
      b.box(tx + side, 0.16, (z0 + z1) / 2, 0.08, 0.14, z1 - z0, m.steel, null, 4, false);
      b.box(tx + side, 0.16, (z0 + z1) / 2, 0.14, 0.03, z1 - z0, m.steel, null, 4, false);
    }
  }
  // Level crossing on Main Street: planks between the rails, crossbucks and barrier arms.
  for (const tx of [T1, T2]) b.box(tx, 0.02, 240, 2.4, 0.17, 10, m.asphalt, null, 4, false);
  const xb = decalMat(m, 'crossbuck', 512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#ece8dc'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#111'; ctx.font = 'bold 60px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('RAILROAD', w / 2, h / 2 + 3);
  }, { wear: 0.6 });
  for (const [x, z, ry] of [[133, 233.5, 0], [151, 246.5, Math.PI]] as const) {
    const p = new Placer(b, x, 0, z, ry);
    p.cyl(0, 0, 0, 0.09, 3.8, m.whitePaint, 8);
    for (const a of [0.6, -0.6]) p.box(0, 3.2, 0.08, 1.7, 0.3, 0.02, m.white, null, 1, [0, 0, a]);
    plane(p, 0, 2.75, 0.12, 1.6, 0.3, xb);
    p.box(0, 2.2, 0.1, 0.9, 0.4, 0.2, m.black, null, 1);
    p.box(3.2, 1.0, 0.25, 6.4, 0.12, 0.12, m.redPaint, null, 1, [0, 0, 1.25]);
    b.collide(x - 0.1, 0, z - 0.1, x + 0.1, 3.8, z + 0.1, 'metal');
  }
  // Freight train standing on track 2 from the port out past the steel works.
  let z = -112;
  locomotive(s, T2, z, 0); z += 22;
  const kinds = ['box', 'box', 'tank', 'flat', 'box', 'hopper', 'tank', 'box', 'flat', 'box', 'hopper'];
  for (const k of kinds) { z += car(s, T2, z, k) + 0.8; }
  // A few cars on track 1 by the station, and a derailed boxcar on its side.
  z = 150;
  for (const k of ['box', 'hopper', 'box']) z += car(s, T1, z, k) + 0.8;
  const tipped = new Placer(b, T1 + 4, 0, 112, 0.25);
  tipped.box(0, 0, 0, 3.2, 3.0, 15, m.redPaint, 'metal', 2, [0, 0, 1.45]);
  s.occupy([T1 + 1, 104, T1 + 8, 120]);
  station(s);
}

/** Length (z) used along the track. */
function car(s: Site, x: number, z: number, kind: string): number {
  const m = s.m, b = s.b, rnd = s.rnd, L = 15, deck = 1.2;
  const p = new Placer(b, x, 0, z + L / 2);
  // Bogies and frame.
  for (const lz of [-L / 2 + 2.4, L / 2 - 2.4]) {
    p.box(0, 0.2, lz, 2.0, 0.6, 2.6, m.black, null, 1);
    for (const ax of [-0.7, 0.7]) for (const side of [-1, 1]) p.cyl(side * 0.72, 0.42, lz + ax, 0.42, 0.12, m.steel, 12, [0, 0, Math.PI / 2]);
  }
  p.box(0, 0.85, 0, 2.8, 0.35, L, m.steel, 'metal', 2);
  if (kind === 'box') {
    // Hollow boxcar with both side doors rolled open: climb in through the doorway.
    const paint = [m.redPaint, m.rust, m.bluePaint, m.greenPaint][Math.floor(rnd() * 4)];
    const q = p.at(0, 0, Math.PI / 2, deck);
    const style: WallStyle = { ext: paint, int: m.woodGrey, surface: 'metal', trim: m.steel };
    shell(q, m, L, 3, 0, 3.0, 0.08, style, { s: [door(L / 2, 2.4, 2.5)], n: [door(L / 2, 2.4, 2.5)] }, rnd);
    q.box(0, 0, 0, L, 0.05, 3, m.woodGrey, 'wood', 1.6);
    q.box(0, 3.0, 0, L + 0.1, 0.1, 3.1, paint, 'metal', 2);
    if (rnd() < 0.5) pallet(b, m, x + 0.4, deck + 0.05, z + L / 2 - 4, 0.2, 'boxes', rnd);
  } else if (kind === 'tank') {
    const g = new CylinderGeometry(1.45, 1.45, L - 1.2, 24).rotateX(Math.PI / 2).translate(x, deck + 1.55, z + L / 2);
    b.add(g, rnd() < 0.5 ? m.black : m.whitePaint);
    for (const e of [-1, 1]) b.add(new SphereGeometry(1.45, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(e * Math.PI / 2).scale(1, 1, 0.35)
      .translate(x, deck + 1.55, z + L / 2 + e * (L / 2 - 0.6)), m.black);
    p.box(0, deck + 3.0, 0, 0.9, 0.3, 0.9, m.steel, null, 1);
    b.collide(x - 1.3, deck, z + 0.6, x + 1.3, deck + 2.9, z + L - 0.6, 'steel');
  } else if (kind === 'hopper') {
    p.box(0, deck, 0, 3.0, 2.8, L - 0.6, m.rust, 'metal', 2);
    for (let k = -2; k <= 2; k++) p.box(0, 0.4, k * 2.6, 2.2, 0.8, 1.4, m.rust, null, 1);
  } else {
    // Flatcar with a container (or two) chained down.
    if (rnd() < 0.5) container(b, m, x, deck, z + L / 2, true, Math.PI / 2, Math.floor(rnd() * 6), rnd);
    else { container(b, m, x, deck, z + L / 2 - 3.2, false, Math.PI / 2, Math.floor(rnd() * 6), rnd); }
  }
  s.occupy([x - 1.8, z, x + 1.8, z + L]);
  return L;
}

function locomotive(s: Site, x: number, z: number, ry: number) {
  const m = s.m, b = s.b, L = 21;
  const p = new Placer(b, x, 0, z + L / 2, ry);
  for (const lz of [-L / 2 + 3, L / 2 - 3]) {
    p.box(0, 0.2, lz, 2.4, 0.7, 4, m.black, null, 1);
    for (const ax of [-1.3, 0, 1.3]) for (const side of [-1, 1]) p.cyl(side * 0.72, 0.5, lz + ax, 0.5, 0.12, m.steel, 12, [0, 0, Math.PI / 2]);
  }
  p.box(0, 0.9, 0, 3.0, 0.4, L, m.steel, 'metal', 2);
  p.box(0, 1.3, 1, 2.6, 2.8, L - 6, m.yellowPaint, 'metal', 2);
  p.box(0, 1.3, -L / 2 + 2.6, 3.0, 3.4, 3.6, m.yellowPaint, 'metal', 2);
  p.box(0, 3.3, -L / 2 + 0.79, 2.4, 0.9, 0.02, m.glass, null, 1);
  for (const side of [-1, 1]) p.box(side * 1.51, 3.3, -L / 2 + 2.6, 0.02, 0.8, 2.4, m.glass, null, 1);
  p.box(0, 4.1, 2, 1.6, 0.4, 3, m.black, null, 1);
  p.box(0, 1.3, 1, 2.62, 0.25, L - 6, m.redPaint, null, 1);
  const logo = decalMat(m, 'loco', 512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 84px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('C&H  4417', w / 2, h / 2 + 4);
  }, { transparent: true, wear: 0.8 });
  for (const side of [-1, 1]) plane(p, side * 1.32, 2.5, 2, 5, 1.25, logo, side * Math.PI / 2);
  s.occupy([x - 2, z, x + 2, z + L]);
}

function station(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Platform between the tracks and the depot, a canopy, and the old brick station house.
  const p = new Placer(s.b, 152.5, 0, 216);
  p.box(0, 0, 0, 5, 0.9, 30, m.concrete, 'concrete', 2);
  p.box(-2.35, 0.9, 0, 0.3, 0.005, 30, m.hazard, null, 1, null, false);
  for (let lz = -12; lz <= 12; lz += 6) p.box(0.8, 0.9, lz, 0.18, 3.2, 0.18, m.greenPaint, 'metal', 1);
  p.box(0.2, 4.1, 0, 4.2, 0.12, 28, m.greenPaint, 'metal', 2, [0, 0, -0.08]);
  // Steps down at both ends.
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) p.box(0, 0, e * (15.175 + k * 0.35), 5, 0.9 - (k + 1) * 0.225, 0.35, m.concrete, 'concrete', 1);
  block(s.b, m, 164, 216, -Math.PI / 2, { W: 18, D: 9, floors: 2, ext: m.brick, trim: m.whitePaint, use: 'office', roofAccess: true, backDoor: true, rnd,
    shop: { name: 'CALVERT STATION', color: '#2a3a2a', awning: m.greenPaint } });
  s.occupy([150, 200, 169, 232]);
  const board = decalMat(m, 'departures', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0c0f12'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffb020'; ctx.font = 'bold 30px monospace';
    for (const [i, t] of ['08:12 HARBOR   CANCELLED', '09:40 RIVERTON CANCELLED', '11:05 CAPITAL  CANCELLED', '13:30 CALVERT  ------'].entries()) ctx.fillText(t, 18, 60 + i * 50);
  }, { wear: 0.5 });
  plane(p, 0.8, 2.7, 6, 2.2, 1.1, board, -Math.PI / 2);
  for (let k = 0; k < 3; k++) barrel(s.b, m, 157.5 + k * 0.7, 234, rnd, m.containers[k + 1]);
  s.dummy(164, floorY(2), 214);
  s.dummy(152.5, 0.9, 210);
}

// ------------------------------------------------------------------------------------------------ grain terminal

function grainTerminal(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Six concrete silos in two rows, a head house you can climb, and a conveyor gallery out to the quay.
  const r = 4.4, H = 26;
  for (const sx of [172, 182, 192]) for (const sz of [-104, -94]) {
    const g = new CylinderGeometry(r, r, H, 32, 1, true);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / 3, uv.getY(i) * H / 3);
    s.b.add(g.translate(sx, H / 2, sz), m.concretePanel);
    s.b.add(new CylinderGeometry(r, r, 0.4, 32).translate(sx, H + 0.2, sz), m.concrete);
    s.b.collide(sx - r * 0.92, 0, sz - r * 0.62, sx + r * 0.92, H, sz + r * 0.62, 'concrete');
    s.b.collide(sx - r * 0.62, 0, sz - r * 0.92, sx + r * 0.62, H, sz + r * 0.92, 'concrete');
  }
  s.occupy([166, -110, 198, -88]);
  // Roof gallery joining the tops of the silos (visual) and the head house beside them.
  new Placer(s.b, 182, H + 0.4, -99).box(0, 0, 0, 24, 2.6, 4, m.warehouse, null, 2);
  block(s.b, m, 206, -99, Math.PI / 2, { W: 12, D: 10, floors: 7, ext: m.concretePanel, trim: m.concrete, use: 'empty', roofAccess: true, backDoor: true, rnd, floorMat: m.concrete });
  s.occupy([200.7, -105.3, 211.3, -92.7]);
  const conv = new Placer(s.b, 0, 0, 0);
  conv.box(223.5, 18, -104, 25, 1.8, 2.2, m.warehouse, null, 2);
  for (const x of [220, 230]) conv.box(x, 0, -104, 0.4, 18, 0.4, m.steel, 'metal', 1);
  const sign = decalMat(m, 'grain-co', 1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#e4dccc'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#7a2a1a'; ctx.font = 'bold 92px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CALVERT GRAIN CO-OP', w / 2, h / 2 + 4);
  }, { wear: 2.2 });
  plane(new Placer(s.b, 182, 0, -99), 0, H - 3, 9.5, 18, 2.8, sign);
  for (let k = 0; k < 5; k++) pallet(s.b, m, 214 + (k % 3) * 1.4, 0, -80 + Math.floor(k / 3) * 1.4, 0.2, 'sacks', rnd);
  for (let k = 0; k < 4; k++) container(s.b, m, 168 + k * 13.5, 0, -73, true, 0, Math.floor(rnd() * 6), rnd);
  s.occupy([161, -75, 222, -71]);
  s.dummy(206, floorY(7), -97);
  s.dummy(186, 0.1, -84);
  s.anchor(200, -80);
}

// ------------------------------------------------------------------------------------------------ steel works

function steelWorks(s: Site) {
  const m = s.m, rnd = s.rnd;
  s.flat(152, -58, 238, 62, 0.012, m.concreteDark, 5);
  s.pave([152, -58, 238, 62]);
  // Furnace hall: tall corrugated shed with an overhead crane rail, two furnaces and a mezzanine.
  const x = 196, z = 0, W = 64, D = 32, H = 13;
  const p = new Placer(s.b, x, 0, z, Math.PI / 2);
  const style: WallStyle = { ext: m.warehouse, int: m.warehouse, surface: 'metal', trim: m.steel };
  p.box(0, 0, 0, W, 0.1, D, m.concreteDark, 'concrete', 4);
  shell(p, m, W, D, 0.1, H, 0.2, style, {
    s: [door(10, 6, 7), door(40, 6, 7), door(56, 1.0, 2.2), win(25, 8, 9, 11.5)],
    n: [door(18, 6, 7), door(50, 1.0, 2.2), win(34, 8, 9, 11.5)],
    w: [door(D / 2, 7, 8)], e: [door(D / 2, 1.2, 2.2), win(8, 4, 9, 11.5), win(24, 4, 9, 11.5)],
  }, rnd);
  for (let lx = -W / 2 + 4; lx < W / 2; lx += 8) for (const lz of [-D / 2 + 1.2, D / 2 - 1.2]) p.box(lx, 0.1, lz, 0.5, H - 0.1, 0.5, m.steel, 'metal', 1);
  for (const lz of [-D / 2 + 1.2, D / 2 - 1.2]) p.box(0, 9.2, lz, W - 2, 0.6, 0.6, m.steel, null, 2);
  p.box(-6, 8.6, 0, 1.2, 1.2, D - 2.4, m.craneYellow, null, 2);
  p.box(-6, 8.2, 2, 2.4, 0.8, 2.4, m.craneYellow, null, 1);
  // Roof: two pitched halves with a monitor strip of glass along the ridge.
  for (const side of [-1, 1]) p.box(0, H + 0.9, side * (D / 4 + 0.4), W + 0.6, 0.14, D / 2 + 1.2, m.metal, side > 0 ? 'metal' : null, 3, [side * 0.12, 0, 0]);
  p.box(0, H, 0, W, 0.12, D, m.metal, 'metal', 3);
  // Furnaces: big steel drums on plinths you can hide behind.
  for (const lx of [-18, 8]) {
    p.box(lx, 0.1, -2, 9, 1.4, 9, m.concrete, 'concrete', 2);
    const g = new CylinderGeometry(3.6, 3.9, 7, 24);
    s.b.add(s.b.place(g, ...worldAt(x, z, lx, -2), [0, 0, 0]).translate(0, 5.0, 0), m.rust);
    const [fx, fz] = worldAt(x, z, lx, -2);
    s.b.collide(fx - 3.6, 1.5, fz - 2.5, fx + 3.6, 8.5, fz + 2.5, 'steel');
    s.b.collide(fx - 2.5, 1.5, fz - 3.6, fx + 2.5, 8.5, fz + 3.6, 'steel');
  }
  // Mezzanine along the north wall (local -z), reached by a straight stair.
  const my = 4.6;
  p.box(-4, my - 0.25, -D / 2 + 3.4, W - 16, 0.25, 6, m.steel, 'metal', 2);
  p.box(-4, my, -D / 2 + 6.38, W - 16, 1.0, 0.06, m.steel, 'metal', 1);
  for (let lx = -W / 2 + 10; lx < W / 2 - 10; lx += 6) p.box(lx, 0.1, -D / 2 + 6.2, 0.2, my - 0.35, 0.2, m.steel, 'metal', 1);
  const n = 17, rise = (my - 0.1) / n;
  // (rising west onto the mezzanine's east end)
  for (let k = 0; k < n; k++) p.box(20 + (n - k - 0.5) * 0.3, 0.1 + rise * (k + 1) - 0.2, -12.6, 0.3, 0.2, 1.2, m.steel, 'metal', 1);
  // Steel plate stacks and coils on the floor.
  for (let k = 0; k < 6; k++) p.box(-26 + k * 8.5, 0.1, 9, 4.2, 0.4 + rnd() * 1.3, 2.4, m.steel, 'steel', 2);
  for (let k = 0; k < 5; k++) p.cyl(16 + k * 2.6, 0.1, 4, 1.0, 1.2, m.metal, 18);
  for (let k = 0; k < 5; k++) p.collide(15 + k * 2.6, 0.1, 3, 17 + k * 2.6, 1.3, 5, 'steel');
  s.occupy([x - D / 2 - 0.3, z - W / 2 - 0.3, x + D / 2 + 0.3, z + W / 2 + 0.3]);
  // Smokestack and the slag heap.
  const sx = 226, sz = -40;
  s.b.add(new CylinderGeometry(1.8, 3.0, 48, 20).translate(sx, 24, sz), m.brick);
  for (const y of [12, 26, 40]) s.b.add(new CylinderGeometry(2.9 - y * 0.024, 2.95 - y * 0.024, 0.5, 20).translate(sx, y, sz), m.steel);
  s.b.collide(sx - 2.6, 0, sz - 2.6, sx + 2.6, 48, sz + 2.6, 'concrete');
  s.occupy([sx - 3.5, sz - 3.5, sx + 3.5, sz + 3.5]);
  for (const [hx, hz, hr] of [[166, -46, 6], [174, -50, 4.5]] as const) {
    s.b.add(new ConeGeometry(hr, hr * 0.8, 12).translate(hx, hr * 0.4, hz), m.charred);
    s.b.collide(hx - hr * 0.5, 0, hz - hr * 0.5, hx + hr * 0.5, hr * 0.5, hz + hr * 0.5, 'dirt');
    s.occupy([hx - hr, hz - hr, hx + hr, hz + hr]);
  }
  const sign = decalMat(m, 'steel-sign', 1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#23304a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 88px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CALVERT STEEL WORKS', w / 2, h / 2 + 4);
  }, { wear: 2 });
  plane(p, 0, H - 3, D / 2 + 0.05, 22, 3.4, sign);
  for (let k = 0; k < 8; k++) barrel(s.b, m, 156 + (k % 4) * 0.62, 40 + Math.floor(k / 4) * 0.62, rnd, m.containers[k % 6], k === 7);
  for (const [cx, cz, ry] of [[160, 10, 0.1], [232, 50, 1.4]] as const) container(s.b, m, cx, 0, cz, true, ry + Math.PI / 2, Math.floor(rnd() * 6), rnd);
  s.occupy([158, 3, 162.5, 17], [225, 47, 239, 53]);
  s.dummy(183.4, my, 4);
  s.dummy(186, 0.1, 10);
  s.anchor(170, 30);
}

function worldAt(x: number, z: number, lx: number, lz: number): [number, number, number] {
  // Placer with ry = π/2: world = (x + lz, z - lx).
  return [x + lz, 0, z - lx];
}

// ------------------------------------------------------------------------------------------------ depot

function depot(s: Site) {
  const m = s.m, rnd = s.rnd;
  s.flat(152, 66, 238, 132, 0.012, m.asphalt, 6);
  s.pave([152, 66, 238, 132]);
  for (let k = 0; k < 6; k++) trailerBox(s, 166 + k * 5, 112, Math.PI / 2 + (rnd() - 0.5) * 0.08);
  for (let k = 0; k < 3; k++) trailerBox(s, 172 + k * 9, 82, (rnd() - 0.5) * 0.3);
  block(s.b, m, 226, 108, -Math.PI / 2, { W: 16, D: 10, floors: 2, ext: m.stucco[4], trim: m.white, use: 'office', backDoor: true, rnd,
    shop: { name: 'HARBOR FREIGHT LINES', color: '#5a1a1a' } });
  s.occupy([220.7, 99.7, 231.3, 116.3]);
  // Water tower on four legs with a ladder, the town name painted round the tank.
  const wx = 214, wz = 80, legH = 22;
  const p = new Placer(s.b, wx, 0, wz);
  for (const [lx, lz] of [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]]) {
    p.box(lx, 0, lz, 0.45, legH, 0.45, m.steel, 'metal', 1);
    p.box(lx, 0, lz, 1.0, 0.6, 1.0, m.concrete, 'concrete', 1);
  }
  for (const y of [7, 14]) for (const [a, b2, w, d] of [[0, -3.2, 6.4, 0.2], [0, 3.2, 6.4, 0.2], [-3.2, 0, 0.2, 6.4], [3.2, 0, 0.2, 6.4]]) p.box(a, y, b2, w, 0.2, d, m.steel, null, 1);
  // The tank's UVs wrap once round it: paint the town name twice on a pale blue band.
  const tex = paintedTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c8d4d8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d3a5a'; ctx.font = 'bold 74px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) { ctx.save(); ctx.translate(w * u, h / 2); ctx.scale(-1, 1); ctx.fillText('CALVERT', 0, 4); ctx.restore(); }
  });
  const tankMat = m.r.setupMaterial(new MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.3 }));
  s.b.add(new CylinderGeometry(6, 6, 7, 32, 1, true).translate(wx, legH + 3.5, wz), tankMat);
  s.b.add(new ConeGeometry(6.2, 3.2, 32).translate(wx, legH + 8.6, wz), m.whitePaint);
  s.b.add(new SphereGeometry(6, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.4, 1).translate(wx, legH, wz), m.whitePaint);
  p.box(0, legH - 0.2, 0, 14, 0.12, 14, m.steel, null, 2, null, false);
  p.box(6.6, 0, 0, 0.5, legH, 0.06, m.steel, null, 1);
  s.occupy([wx - 4, wz - 4, wx + 4, wz + 4]);
  s.dummy(196, 0.1, 96);
  s.anchor(190, 96);
}

// ------------------------------------------------------------------------------------------------ school

function school(s: Site) {
  const m = s.m, rnd = s.rnd;
  s.flat(152, 140, 238, 232, 0.006, m.lawn, 2.4);
  // Main building: two long storeys facing Main Street, roof access, a gym block behind.
  block(s.b, m, 204, 210, 0, { W: 60, D: 16, floors: 2, story: 3.6, ext: m.brickTan, trim: m.white, use: 'office', roofAccess: true, backDoor: true, sideDoor: 'w', rnd,
    floorMat: m.tile, shop: { name: 'CALVERT HIGH SCHOOL', color: '#1d2a5a' } });
  s.occupy([173.7, 201.7, 234.3, 218.3]);
  // Classroom desks in rows on both floors (west half).
  for (const fy of [0.15, 0.15 + 3.6]) for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    new Placer(s.b, 180 + c * 1.6, fy, 212 + r * 1.3).box(0, 0, 0, 1.0, 0.75, 0.6, m.wood, 'wood', 1);
  }
  const gym = new Placer(s.b, 186, 0, 176), GW = 34, GD = 24, GH = 8;
  gym.box(0, 0, 0, GW, 0.12, GD, m.floorWood, 'wood', 2);
  shell(gym, m, GW, GD, 0.12, GH, 0.3, { ext: m.brickTan, int: m.plaster, surface: 'concrete', trim: m.white }, {
    s: [door(8, 2.4, 2.6), door(GW - 8, 2.4, 2.6)], n: [door(GW / 2, 2.4, 2.6), win(6, 4, 5, 7), win(GW - 6, 4, 5, 7)],
    w: [win(GD / 2, 6, 5, 7)], e: [door(6, 1.2, 2.2), win(GD / 2 + 2, 6, 5, 7)],
  }, rnd);
  gym.box(0, GH + 0.12, 0, GW, 0.3, GD, m.gravel, 'concrete', 2.5);
  // Bleachers along the north wall and two hoops.
  for (let k = 0; k < 5; k++) gym.box(0, 0.12, -GD / 2 + 0.6 + k * 0.7, GW - 6, 0.45 * (5 - k), 0.7, m.wood, 'wood', 1);
  for (const sx of [-1, 1]) {
    gym.box(sx * (GW / 2 - 0.6), 0.12, 2, 0.2, 3.9, 0.2, m.steel, null, 1);
    gym.box(sx * (GW / 2 - 1.0), 3.0, 2, 0.06, 1.1, 1.8, m.white, null, 1);
  }
  s.occupy([168.7, 163.7, 203.3, 188.3]);
  // Bus loop and buses in front.
  s.flat(152, 219, 238, 233, 0.012, m.asphalt, 6);
  s.pave([152, 219, 238, 233]);
  for (const [bx, bz, ry] of [[176, 226, 0.02], [196, 226.6, -0.04], [222, 225.6, 0.3]] as const) schoolBus(s, bx, bz, ry);
  const flag = new Placer(s.b, 237.5, 0, 214);
  flag.cyl(0, 0, 0, 0.07, 10, m.chrome, 8);
  flag.box(0.75, 8.6, 0, 1.5, 1.0, 0.02, m.redPaint, null, 1, null, false);
  s.dummy(188, floorY(1, 3.6), 208);
  s.dummy(204, floorY(2, 3.6), 212);
  s.dummy(186, 0.15, 168);
  s.anchor(216, 190);
}

function schoolBus(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0, 0.45, 0, 11, 2.5, 2.45, m.yellowPaint, 'metal', 2);
  for (const side of [-1, 1]) p.box(0, 1.6, side * 1.23, 9.4, 0.85, 0.02, m.glass, null, 1);
  p.box(5.5, 0.45, 0, 1.6, 1.3, 2.3, m.yellowPaint, 'metal', 1);
  for (const lx of [-3.5, 3.8]) for (const side of [-1, 1]) p.cyl(lx, 0.48, side * 1.05, 0.48, 0.3, m.rubber, 14, [Math.PI / 2, 0, 0]);
  p.box(0, 0.9, 1.24, 11, 0.12, 0.02, m.black, null, 1);
}

function stadium(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Running track round a football pitch with yard lines.
  const cx = 198, cz = 300, FW = 50, FL = 96;
  s.flat(cx - FW / 2 - 7, cz - FL / 2 - 6, cx + FW / 2 + 7, cz + FL / 2 + 6, 0.008, m.redTrack, 3);
  s.flat(cx - FW / 2, cz - FL / 2, cx + FW / 2, cz + FL / 2, 0.012, m.lawn, 2.4);
  s.pave([cx - FW / 2 - 7, cz - FL / 2 - 6, cx + FW / 2 + 7, cz + FL / 2 + 6]);
  for (let k = 0; k <= 10; k++) s.line(cx - FW / 2 + 1, cz - FL / 2 + 8 + k * 8, cx + FW / 2 - 1, cz - FL / 2 + 8 + k * 8, 0.15, 'white');
  for (const sx of [-1, 1]) s.line(cx + sx * (FW / 2 - 0.5), cz - FL / 2 + 1, cx + sx * (FW / 2 - 0.5), cz + FL / 2 - 1, 0.15, 'white');
  // Goal posts.
  for (const e of [-1, 1]) {
    const g = new Placer(s.b, cx, 0, cz + e * (FL / 2 - 1));
    g.box(0, 0, 0, 0.2, 3, 0.2, m.yellowPaint, 'metal', 1);
    g.box(0, 3, 0, 5.6, 0.15, 0.15, m.yellowPaint, null, 1);
    for (const sx of [-2.8, 2.8]) g.box(sx, 3, 0, 0.12, 6, 0.12, m.yellowPaint, null, 1);
  }
  // Grandstand on the west side: concrete steps you can climb, a press box on top.
  const gx = cx - FW / 2 - 14, gp = new Placer(s.b, gx, 0, cz);
  for (let k = 0; k < 10; k++) gp.box(4 - k * 0.85, 0, 0, 0.85, 0.45 * (k + 1), FL - 20, m.concrete, 'concrete', 2);
  for (let k = 0; k < 10; k++) gp.box(4 - k * 0.85 + 0.2, 0.45 * (k + 1), 0, 0.3, 0.05, FL - 22, m.bluePaint, null, 1);
  gp.box(0.2, 0, -(FL - 20) / 2 - 0.15, 8.6, 4.8, 0.3, m.concrete, 'concrete', 2);
  gp.box(0.2, 0, (FL - 20) / 2 + 0.15, 8.6, 4.8, 0.3, m.concrete, 'concrete', 2);
  const press = gp.at(-3.6, 0, 0, 4.5);
  shell(press, m, 3.4, 14, 0, 2.6, 0.15, { ext: m.whitePaint, int: m.plaster, surface: 'wood', trim: m.steel }, {
    e: [win(3, 2.4, 0.9, 2.2), win(7, 2.4, 0.9, 2.2), win(11, 2.4, 0.9, 2.2)], s: [door(1.7, 0.9, 2.1)],
  }, rnd);
  press.box(0, 2.6, 0, 3.8, 0.15, 14.4, m.metal, 'metal', 2);
  s.occupy([gx - 5.5, cz - FL / 2 + 9.5, gx + 4.5, cz + FL / 2 - 9.5]);
  // Away stand on the east side: low steel bleachers.
  const bx = cx + FW / 2 + 9, bp = new Placer(s.b, bx, 0, cz);
  for (let k = 0; k < 5; k++) bp.box(-1.5 + k * 0.8, 0.45 * k, 0, 0.8, 0.12, 40, m.chrome, 'metal', 1);
  for (let lz = -19; lz <= 19; lz += 4.75) bp.box(0, 0, lz, 4, 0.06, 0.1, m.steel, null, 1);
  for (let k = 0; k < 5; k++) bp.collide(-1.9 + k * 0.8, 0, -20, -1.1 + k * 0.8, 0.45 * k + 0.12, 20, 'metal');
  s.occupy([bx - 2, cz - 20.5, bx + 2.6, cz + 20.5]);
  // Floodlights at the corners and a scoreboard at the south end.
  for (const [fx, fz] of [[cx - FW / 2 - 6, cz - FL / 2 - 4], [cx + FW / 2 + 6, cz - FL / 2 - 4], [cx - FW / 2 - 6, cz + FL / 2 + 4], [cx + FW / 2 + 6, cz + FL / 2 + 4]]) {
    const f = new Placer(s.b, fx, 0, fz);
    f.cyl(0, 0, 0, 0.35, 24, m.steel, 10, null, 0.22);
    f.box(0, 24, 0, 4, 2.4, 0.4, m.steel, null, 1);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) f.box(-1.5 + c, 24.4 + r * 1.1, 0.22, 0.8, 0.8, 0.05, m.lampGlass, null, 1);
    s.b.collide(fx - 0.35, 0, fz - 0.35, fx + 0.35, 24, fz + 0.35, 'metal');
  }
  const sb = new Placer(s.b, cx, 0, cz + FL / 2 + 7.5);
  for (const sx of [-3, 3]) sb.box(sx, 0, 0, 0.4, 6, 0.4, m.steel, 'metal', 1);
  sb.box(0, 6, 0, 9, 3.6, 0.5, m.black, 'metal', 1);
  const score = decalMat(m, 'scoreboard', 512, 192, (ctx, w, h) => {
    ctx.fillStyle = '#0a0c0e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
    ctx.fillText('HOME', w * 0.25, 46); ctx.fillText('GUEST', w * 0.75, 46);
    ctx.fillStyle = '#ff5a2a'; ctx.font = 'bold 96px monospace'; ctx.fillText('21', w * 0.25, 150); ctx.fillText('14', w * 0.75, 150);
    ctx.fillStyle = '#e8b020'; ctx.font = 'bold 34px monospace'; ctx.fillText('Q4', w / 2, 112);
  }, { wear: 0.6 });
  plane(sb, 0, 7.8, -0.26, 8.6, 3.2, score, Math.PI);
  const sign = decalMat(m, 'mariners', 512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1d2a5a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e8b020'; ctx.font = 'bold 56px Georgia, serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; ctx.fillText('HOME OF THE MARINERS', w / 2, h / 2 + 3);
  }, { wear: 0.8 });
  signPost(s.b, cx - 12, cz - FL / 2 - 9, 0, sign, m.steel, 4, 1, 2.2);
  s.dummy(gx - 3.6, 4.5, cz + 2);
  s.dummy(cx + 4, 0.1, cz - 10);
  s.dummy(bx, 0.1, cz + 26);
  s.anchor(cx - 8, cz - FL / 2 - 12);
}

