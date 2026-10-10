import { ConeGeometry, CylinderGeometry, MeshStandardMaterial, PlaneGeometry, type Material } from 'three';
import { paintedTex } from '../../render/Textures';
import { block, type BlockOpts } from './Blocks';
import { door, gable, shell, win, type WallStyle } from './Buildings';
import { warehouse } from './Port';
import { barrel, car, decalMat, hydrant, jersey, pallet, Placer, plane, signPost, stopSign, streetLight, streetName, table } from './Props';
import type { Rect, Site } from './Site';
import { bush } from './Vegetation';

type Face = 'n' | 's' | 'e' | 'w';
const RY: Record<Face, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

/** Downtown street grid (x and z ranges of the asphalt). */
const MAIN: Rect = [-520, 235, 520, 245];
const FIRST: Rect = [-132, 146, 132, 154];
const THIRD: Rect = [-132, 316, 132, 324];
const ELM: Rect = [-66, 154, -58, 316];
const OAK: Rect = [58, 154, 66, 316];
const COUNTY: Rect = [-132, 24.5, -124, 520];
const RAIL_RD: Rect = [124, -62, 132, 520];
/** Blocks inside their sidewalks: columns A–D west to east, rows N (north of Main) and S. */
const COLS: [number, number][] = [[-121.5, -68.5], [-55.5, -7], [7, 55.5], [68.5, 121.5]];
const ROWS: [number, number][] = [[156.5, 232.5], [247.5, 313.5]];

/**
 * Downtown Calvert, south of the suburb: a street grid around Harbor Road and Main Street with three- to six-storey
 * blocks you can climb floor by floor, a parking garage, the town square and city hall, a church with a bell tower,
 * a hotel, and the county and rail roads that tie the districts together.
 */
export function downtown(s: Site) {
  streets(s);
  blockAN(s); blockBN(s); blockCN(s); blockDN(s);
  blockAS(s); church(s); square(s); blockDS(s);
  park(s);
  southLots(s);
  streetLife(s);
}

/** A building on a footprint rectangle, its front facing `face`. */
function bld(s: Site, r: Rect, face: Face, floors: number, o: Partial<BlockOpts>) {
  const [x0, z0, x1, z1] = r, ns = face === 'n' || face === 's';
  block(s.b, s.m, (x0 + x1) / 2, (z0 + z1) / 2, RY[face], {
    W: ns ? x1 - x0 : z1 - z0, D: ns ? z1 - z0 : x1 - x0, floors, ext: s.m.brick, rnd: s.rnd, ...o,
  });
  s.occupy([x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3]);
}

/** Top of floor k of a block (matches Blocks.ts). */
const floorY = (k: number, story = 3.2) => 0.15 + k * story;

// ------------------------------------------------------------------------------------------------ streets

function road(s: Site, r: Rect) {
  s.flat(r[0], r[1], r[2], r[3], 0.01, s.m.asphalt, 6);
  s.pave(r);
}

function streets(s: Site) {
  for (const r of [MAIN, FIRST, THIRD, ELM, OAK, COUNTY, RAIL_RD]) road(s, r);
  // Harbor Road already runs the full length; its markings resume south of 1st Avenue.
  const yl = (x0: number, z0: number, x1: number, z1: number) => {
    if (x0 === x1) for (const d of [-0.13, 0.13]) s.line(x0 + d, z0, x1 + d, z1, 0.1, 'yellow');
    else for (const d of [-0.13, 0.13]) s.line(x0, z0 + d, x1, z1 + d, 0.1, 'yellow');
  };
  // Centre lines, broken at every junction.
  yl(0, 157, 0, 232); yl(0, 248, 0, 313); yl(0, 327, 0, 520);
  for (const [a, b] of [[-520, -135], [-121, -69], [-55, -8], [8, 55], [69, 121], [135, 520]]) yl(a, 240, b, 240);
  for (const [a, b] of [[-121, -69], [-55, -8], [8, 55], [69, 121]]) { yl(a, 150, b, 150); yl(a, 320, b, 320); }
  for (const x of [-62, 62]) { yl(x, 157, x, 232); yl(x, 248, x, 313); }
  for (const x of [-128, 128]) { yl(x, 27, x, 143); yl(x, 157, x, 232); yl(x, 248, x, 313); yl(x, 327, x, 520); }
  yl(128, -59, 128, 143);
  // Edge lines on Main Street and crosswalks at the Harbor Road junction.
  for (const z of [235.4, 244.6]) for (const [a, b] of [[-520, -135], [-121, -69], [-55, -8], [8, 55], [69, 121], [135, 520]]) s.line(a, z, b, z, 0.12, 'white');
  for (let x = -3.8; x < 4; x += 0.95) { s.line(x, 231.4, x, 234.2, 0.48, 'white'); s.line(x, 245.8, x, 248.6, 0.48, 'white'); }
  for (let z = 235.8; z < 244.4; z += 0.95) { s.line(-8.6, z, -5.6, z, 0.48, 'white'); s.line(5.6, z, 8.6, z, 0.48, 'white'); }
  for (const x of [-4.1, 4.1]) { s.line(x, 156, x, 234, 0.12, 'white'); s.line(x, 246, x, 314, 0.12, 'white'); }
  // Sidewalk rings round every block.
  for (const [x0, x1] of COLS) for (const [z0, z1] of ROWS) {
    s.sidewalk(x0 - 2.5, z0 - 2.5, x1 + 2.5, z0);
    s.sidewalk(x0 - 2.5, z1, x1 + 2.5, z1 + 2.5);
    s.sidewalk(x0 - 2.5, z0, x0, z1);
    s.sidewalk(x1, z0, x1 + 2.5, z1);
  }
  // North side of 1st Avenue (along the park) and south side of 3rd Avenue.
  s.sidewalk(-124, 143.5, -7, 146); s.sidewalk(7, 143.5, 124, 146);
  s.sidewalk(-124, 324, -7, 326.5); s.sidewalk(7, 324, 124, 326.5);
  // Stop signs and street names at the corners, traffic lights at Harbor & Main.
  const m = s.m;
  for (const [x, z, ry, name] of [[-9.6, 233.4, -Math.PI / 2, 'MAIN ST'], [9.6, 246.6, Math.PI / 2, 'MAIN ST'],
    [-60, 233.4, 0, 'ELM ST'], [64, 246.6, Math.PI, 'OAK ST'], [-9.6, 148, Math.PI / 2, '1ST AVE'], [9.6, 322, -Math.PI / 2, '3RD AVE']] as const) {
    signPost(s.b, x, z, ry, streetName(m, name), m.steel, 1.4, 0.26, 2.9);
  }
  for (const [x, z, ry] of [[-57, 234, -Math.PI / 2], [57, 246, Math.PI / 2], [-67, 246, Math.PI], [67, 234, 0],
    [-57, 156, 0], [57, 156, 0], [-7.6, 156, Math.PI / 2], [-122.6, 233.4, -Math.PI / 2]] as const) {
    signPost(s.b, x, z, ry, stopSign(m), m.steel, 0.75, 0.75, 2.4, 0.08);
  }
  trafficLights(s);
  // Street lights along Main Street and Harbor Road.
  for (let x = -230; x < 230; x += 24) if (Math.abs(x) > 12) streetLight(s.b, m, x, 246.6, Math.PI / 2);
  for (let z = 160; z < 360; z += 26) if (Math.abs(z - 240) > 10) streetLight(s.b, m, 6.5, z, Math.PI);
  // Manholes and patched tar.
  for (const [x, z] of [[1.8, 200], [-2, 270], [-40, 238], [90, 241], [-128, 120], [128, 60]]) new Placer(s.b, x, 0, z).cyl(0, 0, 0, 0.35, 0.02, m.steel, 16);
  puddles(s, [[-4, 160, 4, 230], [-200, 236, 200, 244], [-131, 30, -125, 330], [125, -50, 131, 330], [-55, 147, 55, 153]], 70);
}

function trafficLights(s: Site) {
  const m = s.m;
  const head = (p: Placer, ly: number) => {
    p.box(0, ly, 0, 0.36, 1.0, 0.3, m.black, null, 1);
    for (let k = 0; k < 3; k++) p.cyl(0, ly + 0.2 + k * 0.3, 0.16, 0.1, 0.03, k === 2 ? m.neon : m.glass, 10, [Math.PI / 2, 0, 0]);
  };
  for (const [x, z, ry] of [[-6.2, 233.8, 0], [6.2, 246.2, Math.PI], [6.2, 233.8, Math.PI / 2], [-6.2, 246.2, -Math.PI / 2]] as const) {
    const p = new Placer(s.b, x, 0, z, ry);
    p.cyl(0, 0, 0, 0.13, 6.2, m.steel, 10);
    p.box(1.9, 5.9, 0, 3.8, 0.14, 0.14, m.steel, null, 1);
    head(p.at(3.4, 0.2), 4.9);
    head(p, 2.6);
    s.b.collide(x - 0.15, 0, z - 0.15, x + 0.15, 6.2, z + 0.15, 'metal');
  }
}

/** Rain puddles on the asphalt: near-mirror dark patches that pick up the sky. */
function puddles(s: Site, areas: Rect[], count: number) {
  const tex = paintedTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < 5; k++) {
      const g = ctx.createRadialGradient(w * (0.3 + k * 0.1), h * (0.4 + (k % 2) * 0.2), 4, w * 0.5, h * 0.5, w * 0.48);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(w * (0.35 + k * 0.08), h * (0.45 + (k % 3) * 0.05), w * (0.18 + k * 0.03), h * (0.12 + (k % 2) * 0.08), k, 0, Math.PI * 2); ctx.fill();
    }
  });
  const mat = s.m.r.setupMaterial(new MeshStandardMaterial({
    color: 0x22262a, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.6, alphaMap: tex, alphaTest: 0.35,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  const rnd = s.rnd;
  for (let k = 0; k < count; k++) {
    const [x0, z0, x1, z1] = areas[Math.floor(rnd() * areas.length)];
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), w = 1.5 + rnd() * 3.5;
    s.b.add(new PlaneGeometry(w, w * (0.5 + rnd() * 0.5)).rotateX(-Math.PI / 2).rotateY(rnd() * Math.PI).translate(x, 0.025, z), mat, false);
  }
}

// ------------------------------------------------------------------------------------------------ blocks

/** Elm Court flats and the laundromat (west of Elm Street, north of Main). */
function blockAN(s: Site) {
  const m = s.m, [x0, x1] = COLS[0], [z0, z1] = ROWS[0];
  bld(s, [x1 - 13, 162, x1, 186], 'e', 4, { ext: m.stucco[4], use: 'apartment', roofAccess: true, backDoor: true, trim: m.white });
  bld(s, [x1 - 13, 196, x1, 220], 'e', 4, { ext: m.stucco[1], use: 'apartment', roofAccess: true, backDoor: true, trim: m.white });
  bld(s, [x0 + 2, z1 - 11, x0 + 16, z1], 's', 1, { ext: m.brickTan, use: 'shop', shop: { name: 'SPIN CITY LAUNDRY', color: '#2a6aa0', awning: m.bluePaint } });
  bld(s, [x0 + 18, z1 - 11, x0 + 32, z1], 's', 2, { ext: m.brick, use: 'shop', backDoor: true, shop: { name: 'PAWN & GUNS', color: '#6a1a16', awning: m.redPaint } });
  // Back lot: parking and a fenced playground.
  s.flat(x0, z0 + 2, x1 - 15, z1 - 13, 0.012, m.asphalt, 6);
  s.pave([x0, z0 + 2, x1 - 15, z1 - 13]);
  for (let k = 0; k < 6; k++) parkedCar(s, x0 + 5 + k * 5.5, z0 + 12, Math.PI / 2 + (s.rnd() - 0.5) * 0.2);
  for (let k = 0; k < 4; k++) parkedCar(s, x0 + 5 + k * 5.5, z0 + 30, -Math.PI / 2 + (s.rnd() - 0.5) * 0.2);
  dumpster(s, x1 - 18, 192, Math.PI / 2);
  dumpster(s, x0 + 36, z1 - 15, 0);
  s.dummy(x1 - 6.5, floorY(4), 174);
  s.dummy(x0 + 20, 0.1, z0 + 21);
}

/** Main Street shops and the Harbor Road row (between Elm and Harbor, north of Main). */
function blockBN(s: Site) {
  const m = s.m, [x0, x1] = COLS[1], [z0, z1] = ROWS[0], rnd = s.rnd;
  // Main Street frontage, west to east.
  const row: [number, number, Partial<BlockOpts>][] = [
    [14, 3, { ext: m.brick, use: 'office', shop: { name: 'CALVERT GAZETTE', color: '#1d2a38', awning: m.greenPaint }, roofAccess: true, backDoor: true }],
    [10, 2, { ext: m.stucco[3], use: 'shop', shop: { name: 'ROSA\'S PIZZA', color: '#7a1e18', awning: m.redPaint }, backDoor: true }],
    [12, 3, { ext: m.brickDark, use: 'apartment', shop: { name: 'HARBOR BOOKS', color: '#3a3020', awning: m.bluePaint }, backDoor: true }],
    [12.5, 4, { ext: m.stucco[0], use: 'office', shop: { name: 'FIRST NATIONAL', color: '#1f3a2a' }, roofAccess: true, sideDoor: 'e', backDoor: true }],
  ];
  let x = x0;
  for (const [w, f, o] of row) { bld(s, [x, z1 - 12, x + w, z1], 's', f, o); x += w; }
  // Harbor Road frontage, north to south (fronts face east).
  bld(s, [x1 - 12, 158, x1, 172], 'e', 2, { ext: m.stucco[2], use: 'shop', shop: { name: 'MARINE SUPPLY', color: '#23466a', awning: m.bluePaint }, backDoor: true });
  bld(s, [x1 - 12, 172, x1, 184], 'e', 3, { ext: m.brick, use: 'apartment', backDoor: true });
  bld(s, [x1 - 12, 190, x1, 204], 'e', 5, { ext: m.brickTan, use: 'office', roofAccess: true, backDoor: true, trim: m.concrete });
  // Back lot with cars, a fire-escape style stack of pallets and dumpsters.
  s.flat(x0, z0, x1 - 12, z1 - 12, 0.012, m.asphalt, 6);
  s.pave([x0, z0, x1 - 12, z1 - 12]);
  for (let k = 0; k < 5; k++) parkedCar(s, x0 + 4 + k * 5.6, z0 + 18, Math.PI / 2 + (rnd() - 0.5) * 0.15);
  parkedCar(s, x0 + 10, z0 + 34, 0.4, true);
  dumpster(s, x0 + 8, z1 - 14.5, 0); dumpster(s, x0 + 30, z1 - 14.5, 0.1);
  for (let k = 0; k < 4; k++) pallet(s.b, m, x0 + 20 + (k % 2) * 1.3, 0.14 * Math.floor(k / 2), z0 + 30, 0.1, k % 3 ? 'boxes' : 'sacks', rnd);
  // Small two-storey house of flats at the back, and a three-storey corner block, both facing 1st Avenue.
  bld(s, [x0 + 2, z0 + 1, x0 + 18, z0 + 1 + 10], 'n', 2, { ext: m.siding[2], use: 'apartment', trim: m.white });
  bld(s, [x0 + 20, z0, x0 + 33, z0 + 12], 'n', 3, { ext: m.stucco[1], use: 'apartment', roofAccess: true, backDoor: true, trim: m.white });
  s.dummy(x0 + 7, floorY(3), z1 - 6);
  s.dummy(x1 - 6, floorY(5), 197);
  s.anchor(-30, 204);
}

/** The parking garage, a diner, a drugstore and the bank (between Harbor and Oak, north of Main). */
function blockCN(s: Site) {
  const m = s.m, [x0, x1] = COLS[2], [z0, z1] = ROWS[0];
  parkingGarage(s, x1 - 30, z0 + 1, x1 - 0.5, z0 + 43);
  bld(s, [x0, z1 - 12, x0 + 14, z1], 's', 3, { ext: m.brick, use: 'shop', shop: { name: 'CALVERT DRUGS', color: '#a01e1e', awning: m.redPaint }, roofAccess: true, backDoor: true, sideDoor: 'w' });
  bld(s, [x0 + 14, z1 - 10, x0 + 26, z1], 's', 1, { ext: m.whitePaint, use: 'shop', shop: { name: 'MEL\'S DINER', color: '#2a7a8a', awning: m.redPaint }, backDoor: true });
  bld(s, [x0 + 28, z1 - 13, x1, z1], 's', 2, { ext: m.stucco[0], use: 'office', shop: { name: 'CALVERT SAVINGS BANK', color: '#1f2e44' }, trim: m.concrete, backDoor: true });
  bld(s, [x0, z0 + 2, x0 + 12, z0 + 16], 'w', 2, { ext: m.stucco[5], use: 'shop', shop: { name: 'TACKLE & BAIT', color: '#2a4a2a', awning: m.greenPaint } });
  s.flat(x0, z0 + 17, x1 - 31, z1 - 14, 0.012, m.asphalt, 6);
  s.pave([x0, z0 + 17, x1 - 31, z1 - 14]);
  parkedCar(s, x0 + 6, z0 + 30, 0.1);
  parkedCar(s, x0 + 12, z0 + 40, Math.PI - 0.2, true);
  s.dummy(x0 + 7, floorY(3), z1 - 6);
  s.anchor(20, 205);
}

/** Grand Harbor Hotel, the police station and its lot (east of Oak, north of Main). */
function blockDN(s: Site) {
  const m = s.m, [x0, x1] = COLS[3], [z0, z1] = ROWS[0];
  bld(s, [x0 + 4, z1 - 15, x0 + 26, z1], 's', 6, { ext: m.brickDark, use: 'apartment', roofAccess: true, backDoor: true, trim: m.concrete,
    shop: { name: 'GRAND HARBOR HOTEL', color: '#4a1a20', awning: m.redPaint } });
  bld(s, [x0, z0 + 4, x0 + 14, z0 + 28], 'w', 2, { ext: m.stucco[4], use: 'office', roofAccess: true, backDoor: true, shop: { name: 'POLICE', color: '#1a2a4a' } });
  bld(s, [x1 - 20, z1 - 12, x1, z1], 's', 3, { ext: m.brick, use: 'apartment', shop: { name: 'HARDWARE', color: '#8a4a10', awning: m.greenPaint }, backDoor: true });
  s.flat(x0 + 16, z0, x1, z1 - 17, 0.012, m.asphalt, 6);
  s.pave([x0 + 16, z0, x1, z1 - 17]);
  for (let k = 0; k < 3; k++) parkedCar(s, x0 + 18 + k * 6, z0 + 8, Math.PI / 2, false, m.whitePaint);
  bld(s, [x1 - 20, z0, x1, z0 + 13], 'n', 3, { ext: m.brickTan, use: 'office', roofAccess: true, backDoor: true, shop: { name: 'HARBOR TITLE & LOAN', color: '#2a2a3a' } });
  for (let k = 0; k < 4; k++) parkedCar(s, x0 + 24 + k * 6, z0 + 34, -Math.PI / 2 + (s.rnd() - 0.5) * 0.2);
  for (const z of [z0 + 18, z0 + 22]) jersey(s.b, m, x0 + 18, z, 0.05);
  s.dummy(x0 + 18, floorY(6), z1 - 6);
  s.dummy(x0 + 7, floorY(1), z0 + 12);
  s.anchor(100, 205);
}

/** Calvert Hardware's big shed and lumber yard (west of Elm, south of Main). */
function blockAS(s: Site) {
  const m = s.m, [x0, x1] = COLS[0], [z0, z1] = ROWS[1], rnd = s.rnd;
  bld(s, [x0 + 2, z0 + 1, x1 - 2, z0 + 15], 'n', 1, { ext: m.warehouse, story: 5, use: 'shop', backDoor: true, sideDoor: 'e',
    shop: { name: 'CALVERT LUMBER & HARDWARE', color: '#2a4a20', awning: m.greenPaint } });
  // Lumber yard behind: stacks of planks under an open shed you can climb onto.
  const p = new Placer(s.b, (x0 + x1) / 2, 0, z0 + 40);
  for (let k = 0; k < 6; k++) {
    const lx = -20 + k * 8, h = 0.6 + rnd() * 1.6;
    p.box(lx, 0, -6, 5, h, 2.2, m.wood, 'wood', 1.4);
    p.box(lx, 0, 6, 5, 0.6 + rnd() * 1.6, 2.2, m.wood, 'wood', 1.4);
  }
  for (const lx of [-24, -8, 8, 24]) for (const lz of [-10, 10]) p.box(lx, 0, lz, 0.3, 4.6, 0.3, m.steel, 'metal', 1);
  p.box(0, 4.6, 0, 50, 0.15, 21, m.metal, 'metal', 2);
  s.occupy([x0 + 1, z0 + 28, x1 - 1, z0 + 52]);
  s.flat(x0, z0 + 16, x1, z1, 0.012, m.track, 4);
  s.pave([x0, z0 + 16, x1, z1]);
  for (let k = 0; k < 4; k++) pallet(s.b, m, x0 + 6 + k * 1.4, 0, z1 - 6, 0.05, 'sacks', rnd);
  car(s.b, m, x1 - 8, z1 - 7, 0.3, m.carPaint[4], rnd);
  s.dummy(x0 + 30, 4.75, z0 + 40);
  s.anchor(-95, 290);
}

/** St. Mary's: a nave with tall windows, a five-storey bell tower you can climb, and the graveyard. */
function church(s: Site) {
  const m = s.m, rnd = s.rnd, [x0, x1] = COLS[1], [z0, z1] = ROWS[1];
  const cx = (x0 + x1) / 2 + 3, nz0 = z0 + 7, nz1 = nz0 + 26;
  // Nave: local x runs north→south (ry = π/2 maps local +x to world -z), so the 'e' wall faces Main Street.
  const p = new Placer(s.b, cx, 0, (nz0 + nz1) / 2, Math.PI / 2), W = 26, D = 14, H = 8;
  const style: WallStyle = { ext: m.stucco[0], int: m.plaster, surface: 'concrete', trim: m.concrete };
  p.box(0, 0, 0, W + 0.2, 0.15, D + 0.2, m.concreteDark, 'concrete', 3);
  p.box(0, 0.13, 0, W - 0.6, 0.02, D - 0.6, m.tile, null, 1.2);
  const tall = (len: number) => [3.5, 8, 12.5, 17, 21.5].filter((a) => a < len - 2).map((a) => win(a, 1.3, 2.2, 6.4));
  shell(p, m, W, D, 0.15, H, 0.4, style, { n: tall(W), s: tall(W), e: [door(D / 2, 2.4, 3.4), win(2.5, 1.0, 2.5, 5.5), win(D - 2.5, 1.0, 2.5, 5.5)], w: [door(D - 2.2, 1.0, 2.2)] }, rnd);
  gable(p, m, W, D, H + 0.15, 0.72, 0.5, m.roofTile, m.stucco[0]);
  // Pews in two banks and the altar at the south end.
  for (let k = 0; k < 8; k++) for (const side of [-1, 1]) {
    const lx = 9 - k * 2.1;
    p.box(lx, 0.15, side * 3.4, 0.5, 0.45, 4.6, m.wood, 'wood', 1);
    p.box(lx - 0.25, 0.15, side * 3.4, 0.08, 0.95, 4.6, m.wood, null, 1);
  }
  p.box(-W / 2 + 2.2, 0.15, 0, 1.6, 0.4, 6, m.wood, 'wood', 1);
  p.box(-W / 2 + 2.2, 0.55, 0, 1.0, 0.95, 2.4, m.white, 'wood', 1);
  // Bell tower at the north-west corner, front door onto Main Street.
  const tx = cx - D / 2 - 2.9, tz = nz0 + 2.4;
  block(s.b, m, tx, tz, Math.PI, { W: 5.4, D: 4.4, floors: 5, ext: m.stucco[0], trim: m.concrete, use: 'empty', belfry: true, rnd, floorMat: m.wood });
  s.occupy([tx - 3, tz - 2.5, tx + 3, tz + 2.5], [cx - D / 2 - 0.3, nz0 - 0.3, cx + D / 2 + 0.3, nz1 + 0.3]);
  // Spire above the belfry.
  const top = floorY(5) + 0.75;
  const spire = new ConeGeometry(3.4, 10, 4).rotateY(Math.PI / 4).translate(tx, top + 5, tz);
  s.b.add(spire, m.copper);
  const cross = new Placer(s.b, tx, top + 10, tz);
  cross.box(0, 0, 0, 0.14, 1.8, 0.14, m.chrome, null, 1);
  cross.box(0, 1.1, 0, 0.9, 0.14, 0.14, m.chrome, null, 1);
  // A bell hanging in the belfry.
  const bell = new CylinderGeometry(0.35, 0.75, 1.1, 18, 1, true).translate(tx + 1.2, floorY(4) + 2.1, tz + 0.6);
  s.b.add(bell, m.copper);
  const sign = decalMat(m, 'st-marys', 512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2a3a'; ctx.font = 'bold 54px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText("ST. MARY'S", w / 2, 70);
    ctx.font = 'italic 32px Georgia, serif'; ctx.fillText('Sunday Mass 9 & 11', w / 2, 124);
  }, { wear: 1.4 });
  signPost(s.b, cx + 5, z0 + 1.2, 0, sign, m.black, 1.8, 0.56, 1.5);
  // Graveyard: rows of headstones behind a low wall.
  const g = new Placer(s.b, 0, 0, 0);
  for (let row = 0; row < 6; row++) for (let k = 0; k < 9; k++) {
    if (rnd() < 0.15) continue;
    const gx = x0 + 3 + k * 2.4 + (rnd() - 0.5) * 0.3, gz = nz1 + 3 + row * 2.6;
    if (gz > z1 - 1.5) continue;
    const big = rnd() < 0.2;
    g.box(gx, 0, gz, big ? 0.9 : 0.6, big ? 1.3 : 0.8 + rnd() * 0.3, 0.16, rnd() < 0.5 ? m.concrete : m.concreteDark, 'concrete', 1, [(rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.15, 0]);
  }
  g.box(x0 + 13, 0, nz1 + 1.4, 25, 0.9, 0.35, m.concreteDark, 'concrete', 1.5);
  s.occupy([x0, nz1 + 1, x0 + 25, z1]);
  for (const t of [[x0 + 30, z1 - 4], [x0 + 4, nz1 + 20], [x1 - 3, nz0 + 4]] as const) s.tree(t[0], t[1], 'tall', 0.9);
  s.dummy(tx, floorY(4), tz - 1.4);
}

/** Town square: pavers, fountain and statue, benches and planters, and City Hall on the south side. */
function square(s: Site) {
  const m = s.m, rnd = s.rnd, [x0, x1] = COLS[2], [z0, z1] = ROWS[1];
  s.flat(x0, z0, x1, z1, 0.03, m.pavers, 2.2);
  s.pave([x0, z0, x1, z1 - 17]);
  const cx = (x0 + x1) / 2, cz = z0 + 22;
  // Fountain: stepped basin, water, a column with a bronze-green statue on top.
  const f = new Placer(s.b, cx, 0, cz);
  f.cyl(0, 0, 0, 5.2, 0.55, m.concrete, 32);
  f.cyl(0, 0.55, 0, 4.7, 0.02, m.water, 32);
  f.cyl(0, 0, 0, 1.0, 2.2, m.concrete, 16);
  f.cyl(0, 2.2, 0, 1.6, 0.3, m.concrete, 20);
  f.box(0, 2.5, 0, 0.9, 1.0, 0.7, m.concrete, null, 1);
  // Statue: a sailor with a coil of rope, roughly blocked out in weathered bronze.
  f.box(0, 3.5, 0, 0.55, 1.0, 0.35, m.copper, null, 1);
  f.box(0, 4.5, 0, 0.7, 0.9, 0.4, m.copper, null, 1);
  f.cyl(0, 5.4, 0, 0.17, 0.3, m.copper, 10);
  f.cyl(0, 5.55, 0, 0.32, 0.12, m.copper, 12);
  f.box(0.45, 4.5, 0.1, 0.18, 0.85, 0.18, m.copper, null, 1, [0, 0, 0.5]);
  f.box(-0.45, 4.3, 0, 0.18, 0.85, 0.18, m.copper, null, 1, [0, 0, -0.25]);
  s.b.collide(cx - 3.7, 0, cz - 3.7, cx + 3.7, 0.55, cz + 3.7, 'concrete');
  s.b.collide(cx - 1, 0, cz - 1, cx + 1, 6, cz + 1, 'concrete');
  s.occupy([cx - 5.4, cz - 5.4, cx + 5.4, cz + 5.4]);
  // Planters with trees at the corners, benches on the paths.
  for (const [px, pz] of [[x0 + 6, z0 + 6], [x1 - 6, z0 + 6], [x0 + 6, z0 + 38], [x1 - 6, z0 + 38]]) {
    new Placer(s.b, px, 0, pz).box(0, 0, 0, 3.2, 0.55, 3.2, m.concrete, 'concrete', 1.2);
    s.tree(px, pz, 'oak', 0.85);
    bush(s.b, m, px + 1, pz + 0.8, rnd, 0.6);
  }
  for (const [bx, bz, ry] of [[cx - 9, cz, Math.PI / 2], [cx + 9, cz, -Math.PI / 2], [cx, cz - 9, 0], [cx, cz + 9, Math.PI], [x0 + 14, z0 + 6, 0], [x1 - 14, z0 + 6, 0]] as const) bench(s, bx, bz, ry);
  for (const [lx, lz] of [[cx - 12, cz - 12], [cx + 12, cz - 12], [cx - 12, cz + 12], [cx + 12, cz + 12]]) lampPost(s, lx, lz);
  // City Hall: three storeys, a portico with columns and steps, a clock tower on the roof.
  const hz0 = z1 - 16, hall: Rect = [x0 + 2, hz0, x1 - 2, z1];
  bld(s, hall, 'n', 3, { ext: m.stucco[0], trim: m.white, use: 'office', roofAccess: true, backDoor: true, floorMat: m.tile, story: 3.6 });
  const hx = (hall[0] + hall[2]) / 2, p = new Placer(s.b, hx, 0, hz0);
  p.box(0, 0, -2.2, 16, 0.15, 4.4, m.concrete, 'concrete', 2);
  p.box(0, 0, -4.7, 14, 0.15, 0.6, m.concrete, 'concrete', 1);
  for (let k = 0; k < 6; k++) p.cyl(-7 + k * 2.8, 0.15, -3.6, 0.38, 7.0, m.white, 16);
  for (let k = 0; k < 6; k++) p.collide(-7.35 + k * 2.8, 0.15, -3.95, -6.65 + k * 2.8, 7.15, -3.25, 'concrete');
  p.box(0, 7.15, -2.1, 17, 0.6, 4.6, m.white, 'concrete', 2);
  const roofY = floorY(3, 3.6);
  const clock = new Placer(s.b, hx, roofY, hz0 + 4);
  clock.box(0, 0, 0, 4.2, 6, 4.2, m.stucco[0], 'concrete', 2);
  clock.box(0, 6, 0, 4.8, 0.3, 4.8, m.white, null, 1);
  s.b.add(new ConeGeometry(3.2, 4, 4).rotateY(Math.PI / 4).translate(hx, roofY + 8.3, hz0 + 4), m.copper);
  const face = decalMat(m, 'clock', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ece6d4'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 8; ctx.stroke();
    ctx.lineWidth = 5;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * h * 0.36); ctx.lineTo(w / 2 + Math.cos(a) * w * 0.42, h / 2 + Math.sin(a) * h * 0.42); ctx.stroke(); }
    ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 + w * 0.2, h / 2 - h * 0.12); ctx.stroke();
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(w / 2 - w * 0.05, h / 2 - h * 0.32); ctx.stroke();
  }, { transparent: true });
  for (const [lx, lz, ry] of [[0, -2.13, Math.PI], [0, 2.13, 0], [2.13, 0, Math.PI / 2], [-2.13, 0, -Math.PI / 2]] as const) plane(clock, lx, 3.6, lz, 2.8, 2.8, face, ry);
  const name = decalMat(m, 'city-hall', 1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2a2a'; ctx.font = 'bold 80px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CALVERT  CITY  HALL', w / 2, h / 2 + 4);
  }, { wear: 0.6 });
  plane(p, 0, 7.25, -4.42, 14, 1.4, name, Math.PI);
  s.dummy(hx + 12, roofY, hz0 + 8);
  s.dummy(cx + 2, 0.1, cz + 12);
  s.anchor(cx - 14, z0 + 20);
}

/** Shops facing Main, the fire station, and a block of flats (east of Oak, south of Main). */
function blockDS(s: Site) {
  const m = s.m, [x0, x1] = COLS[3], [z0, z1] = ROWS[1];
  let x = x0;
  for (const [w, f, o] of [
    [12, 2, { ext: m.stucco[3], use: 'shop', shop: { name: 'BAYSIDE CAFE', color: '#5a3a1a', awning: m.greenPaint }, backDoor: true }],
    [12, 3, { ext: m.brick, use: 'apartment', shop: { name: 'VIDEO PALACE', color: '#3a1a5a', awning: m.bluePaint }, backDoor: true }],
    [14, 2, { ext: m.stucco[5], use: 'shop', shop: { name: 'ACE ELECTRONICS', color: '#1a3a5a' }, backDoor: true }],
  ] as [number, number, Partial<BlockOpts>][]) { bld(s, [x, z0, x + w, z0 + 12], 'n', f, o); x += w; }
  // Fire station: wide bay doors facing Oak Street.
  bld(s, [x0, z0 + 20, x0 + 16, z0 + 42], 'w', 2, { ext: m.brick, use: 'office', roofAccess: true, backDoor: true, shop: { name: 'FIRE DEPT  No 3', color: '#8a1a14' } });
  bld(s, [x1 - 22, z1 - 14, x1, z1], 's', 4, { ext: m.stucco[2], use: 'apartment', roofAccess: true, backDoor: true, trim: m.white });
  s.flat(x0 + 17, z0 + 13, x1, z1 - 15, 0.012, m.asphalt, 6);
  s.pave([x0 + 17, z0 + 13, x1, z1 - 15]);
  car(s.b, m, x0 + 24, z0 + 28, 0.2, m.redPaint, s.rnd);
  parkedCar(s, x0 + 34, z0 + 20, Math.PI / 2);
  parkedCar(s, x0 + 40, z0 + 36, -Math.PI / 2 + 0.3, true);
  dumpster(s, x1 - 4, z0 + 16, Math.PI / 2);
  bld(s, [x0, z1 - 12, x0 + 18, z1], 's', 2, { ext: m.brickDark, use: 'shop', backDoor: true, shop: { name: 'HARBOR LIQUOR', color: '#3a1a1a', awning: m.redPaint } });
  s.dummy(x1 - 11, floorY(4), z1 - 7);
  s.anchor(95, 290);
}

/** Calvert Park between the suburb and downtown: lawn, trees, a gazebo, a ball field backstop, picnic tables. */
function park(s: Site) {
  const m = s.m, rnd = s.rnd;
  s.flat(-120, 121, -8, 143.5, 0.006, m.lawn, 2.4);
  s.flat(8, 121, 120, 143.5, 0.006, m.lawn, 2.4);
  // Gazebo: an octagon of posts on a raised deck with a pointed roof you can stand under.
  const gx = -60, gz = 132, g = new Placer(s.b, gx, 0, gz);
  g.cyl(0, 0, 0, 3.6, 0.45, m.woodGrey, 8);
  s.b.collide(gx - 3.2, 0, gz - 3.2, gx + 3.2, 0.45, gz + 3.2, 'wood');
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, px = Math.cos(a) * 3.3, pz = Math.sin(a) * 3.3;
    g.box(px, 0.45, pz, 0.16, 2.6, 0.16, m.white, 'wood', 1);
    if (k !== 2) g.box(px * 0.92, 0.45, pz * 0.92, 0.06, 0.9, 2.4, m.white, null, 1, [0, -a, 0]);
  }
  s.b.add(new ConeGeometry(4.2, 2.2, 8).rotateY(Math.PI / 8).translate(gx, 4.15, gz), m.shingleRed);
  s.occupy([gx - 4, gz - 4, gx + 4, gz + 4]);
  // Ball field backstop and benches.
  const bfx = 60, bfz = 132, bf = new Placer(s.b, bfx, 0, bfz);
  for (let k = -2; k <= 2; k++) bf.box(k * 2.4, 0, 0, 0.1, 4, 0.1, m.steel, 'metal', 1);
  bf.box(0, 0.1, 0, 9.6, 3.8, 0.04, m.chain, null, 1, null, false);
  s.b.collide(bfx - 4.8, 0, bfz - 0.1, bfx + 4.8, 4, bfz + 0.1, 'metal');
  s.flat(bfx - 14, bfz - 22, bfx + 14, bfz - 2, 0.007, m.track, 6);
  for (const [bx, bz, ry] of [[bfx - 8, bfz + 2, 0], [bfx + 8, bfz + 2, 0], [-30, 128, 0.3], [-90, 136, -0.4]] as const) bench(s, bx, bz, ry);
  for (let k = 0; k < 5; k++) table(new Placer(s.b, -100 + k * 9, 0, 126), m, 0, 0, rnd() * 0.6, 1.8, 0.8, false);
  for (const [tx, tz] of [[-110, 140], [-84, 126], [-40, 138], [-22, 125], [24, 139], [36, 126], [92, 138], [110, 125], [84, 141]]) s.tree(tx, tz, rnd() < 0.3 ? 'tall' : 'oak', 0.9 + rnd() * 0.3);
}

/** South of 3rd Avenue: a cannery warehouse, a trailer lot and fields running out to the tree line. */
function southLots(s: Site) {
  const m = s.m, rnd = s.rnd;
  warehouse(s.b, m, 40, 344, rnd);
  s.occupy([20, 332, 60, 356]);
  s.flat(10, 327, 75, 358, 0.012, m.concreteDark, 5);
  s.pave([10, 327, 75, 358]);
  for (let k = 0; k < 4; k++) trailerBox(s, -40 + k * 5, 344, Math.PI / 2 + (rnd() - 0.5) * 0.1);
  s.flat(-50, 330, -10, 358, 0.012, m.track, 4);
  s.pave([-50, 330, -10, 358]);
  for (let k = 0; k < 6; k++) barrel(s.b, m, -14 + (k % 3) * 0.62, 334 + Math.floor(k / 3) * 0.62, rnd, m.containers[k % 4]);
  jersey(s.b, m, 90, 340, 0.4); jersey(s.b, m, 93, 342, 1.2);
  s.dummy(-30, 0.1, 352);
  s.dummy(42, 0.1, 338);
}

// ------------------------------------------------------------------------------------------------ props

function parkedCar(s: Site, x: number, z: number, ry: number, burnt = false, paint?: Material) {
  car(s.b, s.m, x, z, ry, paint ?? s.m.carPaint[Math.floor(s.rnd() * s.m.carPaint.length)], s.rnd, { burnt, noWheels: !burnt && s.rnd() < 0.15 });
}

function dumpster(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0, 0.12, 0, 1.9, 1.15, 1.2, m.greenPaint, 'metal', 1);
  p.box(0, 1.27, -0.15, 1.95, 0.06, 0.95, m.black, null, 1, [0.25, 0, 0]);
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.5, 0.5]) p.cyl(sx, 0, sz, 0.07, 0.12, m.rubber, 8);
}

function bench(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0, 0.42, 0, 1.8, 0.06, 0.45, m.wood, 'wood', 1);
  p.box(0, 0.55, -0.22, 1.8, 0.4, 0.05, m.wood, null, 1, [-0.15, 0, 0]);
  for (const sx of [-0.75, 0.75]) p.box(sx, 0, 0, 0.06, 0.42, 0.45, m.black, null, 1);
}

function lampPost(s: Site, x: number, z: number) {
  const p = new Placer(s.b, x, 0, z), m = s.m;
  p.cyl(0, 0, 0, 0.09, 3.6, m.black, 10);
  p.cyl(0, 3.6, 0, 0.24, 0.5, m.lampGlass, 10, null, 0.16);
  p.cyl(0, 4.1, 0, 0.3, 0.12, m.black, 10, null, 0.05);
  s.b.collide(x - 0.1, 0, z - 0.1, x + 0.1, 3.6, z + 0.1, 'metal');
}

/** A semi trailer parked without its cab: a long box on wheels with a landing gear at the front. */
export function trailerBox(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0, 1.25, 0, 13.6, 2.7, 2.5, m.whitePaint, 'metal', 2.4);
  p.box(0, 1.05, 0, 13.6, 0.2, 2.3, m.steel, null, 1);
  for (const lx of [-5.4, -4.2]) for (const side of [-1, 1]) p.cyl(lx, 0.5, side * 0.95, 0.5, 0.4, m.rubber, 14, [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) p.box(4.8, 0, side * 0.8, 0.12, 1.1, 0.12, m.steel, null, 1);
  s.occupy([x - 7, z - 7, x + 7, z + 7]);
}

function streetLife(s: Site) {
  const m = s.m, rnd = s.rnd;
  // Abandoned cars in the streets, a bus across Main Street and a police roadblock.
  parkedCar(s, -2.2, 175, -Math.PI / 2 + 0.1);
  parkedCar(s, 2.4, 280, Math.PI / 2 - 0.2, true);
  parkedCar(s, -80, 238, 0.1);
  parkedCar(s, 150, 242, Math.PI - 0.3);
  parkedCar(s, -128.5, 200, Math.PI / 2 + 0.05);
  parkedCar(s, 127.6, 90, -Math.PI / 2 + 0.2, true);
  parkedCar(s, 30, 150.8, 0.05);
  parkedCar(s, -61.5, 290, Math.PI / 2);
  bus(s, 34, 240.5, 0.12);
  for (const [x, z, ry] of [[-30, 241, 0.2], [-34, 238, -0.2]] as const) jersey(s.b, m, x, z, ry);
  car(s.b, m, -26, 242.5, 0.6, m.whitePaint, rnd);
  for (const [x, z] of [[-6.4, 170], [6.6, 300], [-62.5, 160.8], [57.6, 250]]) hydrant(s.b, m, x, z);
  for (let k = 0; k < 14; k++) {
    const x = -110 + rnd() * 220, z = rnd() < 0.5 ? 233.6 : 246.4;
    if (Math.abs(x) < 10) continue;
    barrel(s.b, m, x, z, rnd, m.containers[4], rnd() < 0.3);
  }
  // Bus shelter on Main Street.
  const bs = new Placer(s.b, -40, 0, 246.8, Math.PI);
  bs.box(0, 0, 0.6, 3.6, 2.4, 0.05, m.glass, null, 1);
  for (const sx of [-1.8, 1.8]) bs.box(sx, 0, 0, 0.08, 2.5, 1.3, m.steel, null, 1);
  bs.box(0, 2.5, 0, 3.8, 0.1, 1.5, m.steel, 'metal', 1);
  s.b.collide(-41.8, 0, 245.9, -38.2, 2.5, 246.3, 'metal');
}

/** A city bus broken down across a lane: long box body, window strip, destination board. */
function bus(s: Site, x: number, z: number, ry: number) {
  const p = new Placer(s.b, x, 0, z, ry), m = s.m;
  p.box(0, 0.45, 0, 12, 2.6, 2.5, m.whitePaint, 'metal', 2);
  p.box(0, 1.6, 1.26, 10.6, 1.0, 0.02, m.glass, null, 1);
  p.box(0, 1.6, -1.26, 10.6, 1.0, 0.02, m.glass, null, 1);
  p.box(0, 0.6, 1.27, 12, 0.3, 0.02, m.bluePaint, null, 1);
  p.box(0, 0.6, -1.27, 12, 0.3, 0.02, m.bluePaint, null, 1);
  p.box(6.01, 1.4, 0, 0.02, 1.4, 2.2, m.glass, null, 1);
  for (const lx of [-3.8, 3.8]) for (const side of [-1, 1]) p.cyl(lx, 0.48, side * 1.05, 0.48, 0.32, m.rubber, 14, [Math.PI / 2, 0, 0]);
  const board = decalMat(m, 'bus-board', 512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffb020'; ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('12  HARBOR', w / 2, h / 2 + 2);
  });
  plane(p, 6.03, 2.65, 0, 2.0, 0.28, board, Math.PI / 2);
}

/**
 * Four-level open parking garage: decks every 3 m joined by stacked ramps in a walled lane on the east side, low
 * parapets you can shoot over, columns, a few cars left on every level.
 */
function parkingGarage(s: Site, x0: number, z0: number, x1: number, z1: number) {
  const m = s.m, b = s.b, rnd = s.rnd, H = 3, L = 3;
  const lane0 = x1 - 4.6, lane1 = x1 - 0.3, zr0 = z0 + 8, zr1 = z0 + 28;
  const y = (k: number) => 0.1 + k * H;
  const p = new Placer(b, 0, 0, 0);
  p.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, m.concretePanel, 'concrete', 4);
  for (let k = 1; k <= L; k++) {
    const top = y(k), th = 0.3;
    const piece = (a0: number, a1: number, b0: number, b1: number) =>
      p.box((a0 + a1) / 2, top - th, (b0 + b1) / 2, a1 - a0, th, b1 - b0, m.concretePanel, 'concrete', 4);
    piece(x0, lane0, z0, z1);
    piece(lane0, x1, z0, zr0);
    piece(lane0, x1, zr1, z1);
    // Parapets (the ramp lane is walled instead).
    const par = (a0: number, b0: number, a1: number, b1: number) => p.box((a0 + a1) / 2, top, (b0 + b1) / 2, a1 - a0, 1.05, b1 - b0, m.concrete, 'concrete', 2);
    par(x0, z0, x1, z0 + 0.3); par(x0, z1 - 0.3, x1, z1); par(x0, z0 + 0.3, x0 + 0.3, z1 - 0.3);
    par(x1 - 0.3, z0 + 0.3, x1, zr0); par(x1 - 0.3, zr1, x1, z1 - 0.3);
    // Painted bay lines.
    for (let lz = z0 + 3; lz < z1 - 2; lz += 2.6) p.box(x0 + 3, top + 0.005, lz, 5, 0.005, 0.1, m.white, null, 1, null, false);
  }
  // Ramps: stepped colliders under a sloped slab, one storey per ramp, stacked in the lane.
  const len = zr1 - zr0, a = Math.atan2(H, len), seg = 20;
  for (let k = 0; k < L; k++) {
    const y0 = y(k);
    b.rbox((lane0 + lane1) / 2, y0 + H / 2 - 0.15, (zr0 + zr1) / 2, lane1 - lane0, 0.3, Math.hypot(len, H), [-a, 0, 0], m.concretePanel, 4);
    for (let j = 0; j < seg; j++) {
      const top = y0 + H * (j + 0.5) / seg, za = zr0 + (len * j) / seg, zb = zr0 + (len * (j + 1)) / seg;
      b.collide(lane0, top - 0.3, za, lane1, top, zb, 'concrete');
    }
    // Lane walls the full storey (inner and outer), so the ramp is a tube you can't fall out of.
    p.box(lane0 - 0.12, y0, (zr0 + zr1) / 2, 0.24, H - 0.3, len, m.concrete, 'concrete', 2);
    p.box(x1 - 0.15, y0, (zr0 + zr1) / 2, 0.3, H - 0.3, len, m.concrete, 'concrete', 2);
  }
  // Columns on a grid, clear of the lane.
  for (let k = 0; k < L; k++) for (const cx of [x0 + 0.6, x0 + (lane0 - x0) / 2, lane0 - 0.6]) for (let cz = z0 + 0.6; cz < z1; cz += 8.2) {
    p.box(cx, y(k), cz, 0.5, H - 0.3, 0.5, m.concrete, 'concrete', 1);
  }
  // Cars on the decks and a few on the ground.
  for (let k = 0; k <= L; k++) for (let j = 0; j < 4; j++) {
    if (rnd() < 0.45) continue;
    car(b, m, x0 + 3, z0 + 3 + j * 9.5 + rnd(), Math.PI + (rnd() - 0.5) * 0.1, m.carPaint[Math.floor(rnd() * m.carPaint.length)], rnd, { y: y(k) });
  }
  // Roof deck light poles and the sign.
  for (const lz of [z0 + 10, z1 - 10]) {
    const lp = new Placer(b, x0 + (lane0 - x0) / 2, y(L), lz);
    lp.cyl(0, 0, 0, 0.12, 5, m.steel, 8);
    lp.box(0, 5, 0, 1.6, 0.25, 0.5, m.steel, null, 1);
    b.collide(x0 + (lane0 - x0) / 2 - 0.12, y(L), lz - 0.12, x0 + (lane0 - x0) / 2 + 0.12, y(L) + 5, lz + 0.12, 'metal');
  }
  const sign = decalMat(m, 'park-sign', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1d4a8a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', w / 2, h / 2 + 10);
  });
  plane(p, x0 - 0.02, 7.5, (z0 + z1) / 2, 2.2, 2.2, sign, -Math.PI / 2);
  s.occupy([x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3]);
  s.dummy(x0 + 8, y(L), z1 - 6);
  s.dummy(x0 + 9, y(2), z0 + 14);
}
