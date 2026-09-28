import {
  Color, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Vector3, type Material,
} from 'three';
import { mulberry32 } from '../../core/math';
import type { Renderer } from '../../render/Renderer';
import { paintedTex, weather } from '../../render/Textures';
import { Builder } from '../Builder';
import type { BotLane, SteelSpot, World } from '../World';
import { door, garage, guardHut, house, ruin, shell, trailer, wall, win, type WallStyle } from './Buildings';
import { containerYard, crane, quay, seaBackdrop, tankFarm, warehouse } from './Port';
import {
  barrel, car, chainFence, counter, decalMat, hydrant, jersey, mailbox, pallet, picketFence, Placer, plane, powerPole,
  shelf, signPost, stopSign, streetLight, streetName, table, tire, wire,
} from './Props';
import { TownMaterials, WIND } from './TownMaterials';
import { bush, grass, tree, type TreeKind } from './Vegetation';

type Rect = [number, number, number, number];

/** Playable area. Everything outside is scenery behind invisible walls. */
const X0 = -120, X1 = 120, Z0 = -118, Z1 = 120;
const QUAY = -118;

/**
 * "Harbor Outskirts": the first chunk of the big map. An abandoned, overgrown US suburb (Maple Street), a gas
 * station at the junction, an auto shop and fields on the east side, and past the fence a port with a warehouse,
 * a container yard, a gantry crane, fuel tanks and the quay.
 *
 * North is -z. Harbor Road runs north–south along x = 0 into the port gate; Maple Street runs west from it at z = 20.
 */
export class Town implements World {
  readonly spawn = new Vector3(0, 0.02, 104);
  readonly spawnYaw = 0;
  readonly steel: SteelSpot[] = [];
  readonly botLanes: BotLane[] = [];
  readonly wallDummies: Vector3[] = [];
  readonly infiniteAmmo = false;
  readonly welcome = 'Harbor Outskirts · suburb, gas station and port · 12 bots are hiding around the map · T refills ammo';
  readonly colliders;
  private b = new Builder();
  private m: TownMaterials;
  private rnd = mulberry32(2026);
  private paved: Rect[] = [];
  private blocked: Rect[] = [];
  private lines: Record<'white' | 'yellow', Material>;
  private grassCells: InstancedMesh[] = [];
  /** 0.5 m occupancy grid over the play area: 0 open ground, 1 paved, 2 paved edge, 3 blocked. */
  private occ = new Uint8Array(0);

  constructor(r: Renderer) {
    this.m = new TownMaterials(r);
    this.colliders = this.b.colliders;
    r.scene.add(this.b.root);
    this.lines = { white: this.lineMat('#e6e2d6', 1), yellow: this.lineMat('#d8a92a', 2) };
    this.ground(r);
    this.roads();
    this.suburb();
    this.gasStation();
    this.eastSide();
    this.port();
    this.edges();
    this.nature();
    this.bots();
    this.b.finish();
    const grassRoot = new Group();
    r.scene.add(grassRoot);
    const hi = r.quality === 'high';
    this.rasterize();
    this.grassCells = grass(grassRoot, this.m, X0 - 6, Z0 + 1, X1 + 6, Z1 + 8, hi ? 0.8 : 1.15, (x, z) => this.grassDensity(x, z), this.rnd);
    this.grassFar = hi ? 95 : 70;
  }

  private grassFar = 90;

  update(dt: number, viewer: Vector3) {
    WIND.value += dt;
    // Grass is only worth drawing up close; far cells are hidden (fog and distance make them invisible anyway).
    for (const c of this.grassCells) {
      const s = c.boundingSphere!;
      c.visible = Math.hypot(s.center.x - viewer.x, s.center.z - viewer.z) - s.radius < this.grassFar;
    }
    const n = this.m.water.normalMap!;
    n.offset.x += dt * 0.004;
    n.offset.y += dt * 0.007;
  }

  // ------------------------------------------------------------------------------------------------ helpers

  /** Flat decal-like plane with world-space UVs (roads, lots, markings). */
  private flat(x0: number, z0: number, x1: number, z1: number, y: number, mat: Material, tile: number) {
    const g = new PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
    this.b.add(g, mat, false);
  }

  private lineMat(color: string, seed: number) {
    const t = paintedTex(32, 512, (ctx, w, h) => { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); weather(ctx, w, h, seed, 3); });
    t.wrapS = t.wrapT = RepeatWrapping;
    return this.m.r.setupMaterial(new MeshStandardMaterial({
      map: t, alphaTest: 0.45, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
  }

  /** Painted road line from (x0, z0) to (x1, z1), axis aligned. */
  private line(x0: number, z0: number, x1: number, z1: number, w: number, color: 'white' | 'yellow') {
    const alongZ = Math.abs(z1 - z0) > Math.abs(x1 - x0), len = alongZ ? Math.abs(z1 - z0) : Math.abs(x1 - x0);
    const g = new PlaneGeometry(w, len);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 4);
    g.rotateX(-Math.PI / 2);
    if (!alongZ) g.rotateY(Math.PI / 2);
    g.translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    this.b.add(g, this.lines[color], false);
  }

  private sidewalk(x0: number, z0: number, x1: number, z1: number) {
    this.b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 0.14, z1 - z0, this.m.slab, 'concrete', 1.6);
    this.paved.push([x0, z0, x1, z1]);
  }

  private inRect(x: number, z: number, list: Rect[], pad = 0) {
    for (const [a, b, c, d] of list) if (x >= a - pad && x <= c + pad && z >= b - pad && z <= d + pad) return true;
    return false;
  }

  private static readonly GX0 = X0 - 8; private static readonly GZ0 = Z0; private static readonly GW = (X1 - X0 + 16) * 2;
  private static readonly GH = (Z1 - Z0 + 10) * 2;

  /** Burns the paved and blocked rectangles into the occupancy grid once, so grass placement is a lookup. */
  private rasterize() {
    const W = Town.GW, H = Town.GH, g = this.occ = new Uint8Array(W * H);
    const fill = (r: Rect, v: number, pad: number) => {
      const i0 = Math.max(0, Math.floor((r[0] - pad - Town.GX0) * 2)), i1 = Math.min(W - 1, Math.ceil((r[2] + pad - Town.GX0) * 2));
      const j0 = Math.max(0, Math.floor((r[1] - pad - Town.GZ0) * 2)), j1 = Math.min(H - 1, Math.ceil((r[3] + pad - Town.GZ0) * 2));
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (g[j * W + i] < v) g[j * W + i] = v;
    };
    for (const r of this.paved) fill(r, 2, 0);
    // Paved-over-paved: interior cells stay 1 only where no edge of another slab was burnt; edges are 2.
    for (const r of this.paved) {
      const i0 = Math.max(0, Math.floor((r[0] + 0.8 - Town.GX0) * 2)), i1 = Math.min(W - 1, Math.ceil((r[2] - 0.8 - Town.GX0) * 2));
      const j0 = Math.max(0, Math.floor((r[1] + 0.8 - Town.GZ0) * 2)), j1 = Math.min(H - 1, Math.ceil((r[3] - 0.8 - Town.GZ0) * 2));
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (g[j * W + i] === 2) g[j * W + i] = 1;
    }
    for (const r of this.blocked) fill(r, 3, 0);
  }

  private grassDensity(x: number, z: number): number {
    if (z < QUAY + 0.5) return 0;
    const i = Math.floor((x - Town.GX0) * 2), j = Math.floor((z - Town.GZ0) * 2);
    const o = i >= 0 && j >= 0 && i < Town.GW && j < Town.GH ? this.occ[j * Town.GW + i] : 0;
    if (o === 3) return 0;
    const patch = 0.5 + 0.5 * Math.sin(x * 0.13 + Math.sin(z * 0.09) * 2) * Math.sin(z * 0.11 - x * 0.03);
    // Grass pushing through cracks in paving, thicker along the edges.
    if (o === 1) return patch > 0.8 ? 0.06 : 0.015;
    if (o === 2) return 0.4;
    if (patch > 0.78) return 1.3; // tall weeds
    return 0.55 + patch * 0.45;
  }

  private tree(x: number, z: number, kind: TreeKind = 'oak', scale = 1) {
    tree(this.b, this.m, x, z, this.rnd, kind, scale);
    this.blocked.push([x - 0.4, z - 0.4, x + 0.4, z + 0.4]);
  }

  // ------------------------------------------------------------------------------------------------ terrain

  private ground(r: Renderer) {
    // Big grass sheet with gentle colour variation; hills rise outside the playable area so there is no edge.
    const x0 = -520, x1 = 520, z0 = QUAY, z1 = 560, seg = 130;
    const g = new PlaneGeometry(x1 - x0, z1 - z0, seg, Math.round(seg * (z1 - z0) / (x1 - x0)));
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv'), col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const out = Math.max(Math.abs(x) - 135, z - 135, 0);
      const hill = out > 0 ? Math.min(out / 90, 1) ** 1.5 * (22 + 16 * Math.sin(x * 0.02) * Math.cos(z * 0.017)) : 0;
      pos.setY(i, hill - (out > 0 ? 0 : 0.002));
      uv.setXY(i, x / 2.4, -z / 2.4);
      const v = 0.86 + 0.1 * Math.sin(x * 0.05 + Math.sin(z * 0.03) * 2) + 0.06 * Math.sin(z * 0.11 + x * 0.02);
      col.push(v * (1 + Math.min(out / 200, 0.2)), v, v * 0.92);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new Mesh(g, this.m.grass);
    mesh.receiveShadow = true;
    this.b.root.add(mesh);
    this.b.collide(-600, -5, QUAY, 600, 0, 600, 'dirt');

    // Sea and the quay wall.
    const water = new Mesh(new PlaneGeometry(2400, 1400).rotateX(-Math.PI / 2).translate(0, -1.4, QUAY - 700), this.m.water);
    water.receiveShadow = true;
    this.b.root.add(water);
    this.b.box(0, -4.5, QUAY - 0.5, 1040, 4.5, 1, this.m.concreteDark, null, 3, false);
    void r;
  }

  private roads() {
    const m = this.m;
    // Harbor Road (north–south) and Maple Street (west from the junction). Both run off beyond the map as scenery.
    this.flat(-4.5, -62, 4.5, 560, 0.01, m.asphalt, 6);
    this.flat(-520, 15.5, -4.5, 24.5, 0.011, m.asphalt, 6);
    this.paved.push([-4.5, -62, 4.5, 560], [-520, 15.5, -4.5, 24.5]);
    // Sidewalks (with gaps for the gas station driveways).
    this.sidewalk(-7, 24.5, -4.5, Z1 + 20);
    this.sidewalk(-7, -60, -4.5, 13);
    this.sidewalk(4.5, -60, 7, 4);
    this.sidewalk(4.5, 12, 7, 30);
    this.sidewalk(4.5, 38, 7, Z1 + 20);
    this.sidewalk(X0 - 20, 13, -7, 15.5);
    this.sidewalk(X0 - 20, 24.5, -7, 27);
    // Markings: faded double yellow, edge lines, stop line and crosswalks at the junction.
    for (const dx of [-0.13, 0.13]) { this.line(dx, -60, dx, 11, 0.1, 'yellow'); this.line(dx, 29, dx, 200, 0.1, 'yellow'); }
    for (const dz of [19.87, 20.13]) this.line(X0 - 30, dz, -14, dz, 0.1, 'yellow');
    this.line(-4.1, -60, -4.1, 13, 0.12, 'white'); this.line(-4.1, 27, -4.1, 200, 0.12, 'white');
    this.line(4.1, -60, 4.1, 200, 0.12, 'white');
    this.line(-9, 20.3, -9, 24.2, 0.45, 'white');
    for (let z = 16.2; z < 24.2; z += 0.95) this.line(-13.8, z, -11, z, 0.48, 'white');
    for (let x = -3.8; x < 4; x += 0.95) this.line(x, 10, x, 12.6, 0.48, 'white');
    // Tar patches and manholes.
    const patchMat = m.r.setupMaterial(new MeshStandardMaterial({
      map: m.asphalt.map, normalMap: m.asphalt.normalMap, color: new Color(0x8a8a88), roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    for (let k = 0; k < 14; k++) {
      const z = -55 + this.rnd() * 170, x = (this.rnd() - 0.5) * 6, w = 1 + this.rnd() * 3, d = 1 + this.rnd() * 4;
      this.flat(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0.015, patchMat, 6);
    }
    for (const [x, z] of [[1.8, 40], [-2, -20], [-40, 21], [-2, 90]]) new Placer(this.b, x, 0, z).cyl(0, 0, 0, 0.35, 0.02, m.steel, 16);
    // Power line down the west side of Harbor Road and along Maple Street, one pole snapped and lying in the street.
    let prev: Vector3[] | null = null;
    for (let z = Z1 - 4; z > -58; z -= 30) {
      const pts = powerPole(this.b, m, -8.2, z, 0, (this.rnd() - 0.5) * 0.05, this.rnd() < 0.3);
      if (prev) for (let i = 0; i < 3; i++) wire(this.b, m, prev[i], pts[i], 0.8 + this.rnd() * 0.4);
      prev = pts;
    }
    prev = null;
    for (let x = -14; x > X0 - 10; x -= 30) {
      if (Math.abs(x + 74) < 2) {
        // Snapped pole across the road, wires drooping to the ground.
        new Placer(this.b, x, 0.16, 19, Math.PI / 2 + 0.25, 0, Math.PI / 2 - 0.02).cyl(0, 0, 0, 0.15, 10, m.bark, 8, null, 0.12);
        this.b.collide(x - 0.9, 0, 14, x + 0.9, 0.34, 23.5, 'wood');
        if (prev) for (let i = 0; i < 3; i++) wire(this.b, m, prev[i], new Vector3(x + 2 + i, 0.05, 17 + i * 1.5), 3);
        prev = null;
        continue;
      }
      const pts = powerPole(this.b, m, x, 11.8, Math.PI / 2);
      if (prev) for (let i = 0; i < 3; i++) wire(this.b, m, prev[i], pts[i], 0.9);
      prev = pts;
    }
    for (let z = 98; z > -58; z -= 36) streetLight(this.b, m, 6.5, z, Math.PI);
    signPost(this.b, -7.6, 26, -Math.PI / 2, stopSign(m), m.steel, 0.75, 0.75, 2.4, 0.08);
    signPost(this.b, -7.6, 13.4, 0, streetName(m, 'MAPLE ST'), m.steel, 1.4, 0.26, 2.9);
    signPost(this.b, -7.8, 12.9, Math.PI / 2, streetName(m, 'HARBOR RD'), m.steel, 1.4, 0.26, 2.65);
    const limit = decalMat(m, 'limit', 192, 256, (ctx, w, h) => {
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = 'bold 34px Arial'; ctx.fillText('SPEED', w / 2, 60); ctx.fillText('LIMIT', w / 2, 100);
      ctx.font = 'bold 110px Arial'; ctx.fillText('35', w / 2, 210);
    }, { wear: 0.5 });
    signPost(this.b, 7.4, 80, 0, limit, m.steel, 0.6, 0.8, 2.5, -0.1);
    hydrant(this.b, m, -7.5, 11.6);
    hydrant(this.b, m, 7.6, 58);
    // Wrecks on the roads.
    const cars = m.carPaint, rnd = this.rnd;
    car(this.b, m, -38, 22.2, 0.08, cars[0], rnd);
    car(this.b, m, -72, 17.8, Math.PI - 0.2, cars[1], rnd, { noWheels: true });
    car(this.b, m, 2.2, 62, Math.PI / 2 + 0.06, cars[2], rnd);
    car(this.b, m, -1.8, 88, -Math.PI / 2 - 0.1, cars[3], rnd, { burnt: true });
    car(this.b, m, 1.2, -38, Math.PI / 2 - 0.35, cars[4], rnd);
  }

  // ------------------------------------------------------------------------------------------------ suburb

  private suburb() {
    const m = this.m, b = this.b, rnd = this.rnd;
    const lots: { x: number; z: number; ry: number; W: number; D: number; floors: 1 | 2; siding: number; roof: Material;
      boarded?: boolean; chimney?: boolean }[] = [
      { x: -26, z: -1, ry: 0, W: 12, D: 10, floors: 1, siding: 0, roof: m.shingle, chimney: true },
      { x: -56, z: -2, ry: 0, W: 12, D: 11, floors: 2, siding: 1, roof: m.shingleRed },
      { x: -88, z: 0, ry: 0, W: 11, D: 9, floors: 1, siding: 4, roof: m.shingle, boarded: true },
      { x: -28, z: 40, ry: Math.PI, W: 12, D: 10, floors: 1, siding: 3, roof: m.shingle, chimney: true },
      { x: -58, z: 41, ry: Math.PI, W: 12, D: 11, floors: 2, siding: 2, roof: m.shingle, boarded: true },
    ];
    for (const l of lots) {
      house(b, m, l.x, l.z, l.ry, {
        W: l.W, D: l.D, floors: l.floors, siding: m.siding[l.siding], roof: l.roof, boarded: l.boarded, chimney: l.chimney, rnd,
      });
      const front = l.ry === 0 ? 1 : -1;
      this.blocked.push([l.x - l.W / 2 - 0.2, l.z - l.D / 2 - 0.2, l.x + l.W / 2 + 0.2, l.z + l.D / 2 + 0.2]);
      // Porch footprint (porch sits at the +x end in local space, which flips with the house).
      const px = l.x + front * (l.W / 2 - 1.5), pz0 = l.z + front * l.D / 2, pz1 = l.z + front * (l.D / 2 + 3.2);
      this.blocked.push([px - 2.4, Math.min(pz0, pz1), px + 2.4, Math.max(pz0, pz1)]);
      // Walkway to the sidewalk, driveway beside the house, mailbox.
      const walkX = l.x + front * (l.W / 2 - 1.5), sideZ = front > 0 ? 13 : 27;
      const wz0 = Math.min(pz1, sideZ), wz1 = Math.max(pz1, sideZ);
      this.flat(walkX - 0.6, wz0, walkX + 0.6, wz1, 0.012, m.slab, 1.2);
      this.paved.push([walkX - 0.6, wz0, walkX + 0.6, wz1]);
      const dx = l.x - front * (l.W / 2 + 2.2), dz0 = Math.min(l.z, sideZ), dz1 = Math.max(l.z, sideZ);
      this.flat(dx - 1.6, dz0, dx + 1.6, dz1, 0.013, m.concreteDark, 3);
      this.paved.push([dx - 1.6, dz0, dx + 1.6, dz1]);
      mailbox(b, m, walkX + 1.2, sideZ + (front > 0 ? -0.5 : 0.5), l.ry, rnd);
      // Bushes along the front wall.
      for (let k = 0; k < 3; k++) {
        const bx = l.x - front * (l.W / 2 - 1.5 - k * 2.2), bz = l.z + front * (l.D / 2 + 0.9);
        if (rnd() < 0.75) bush(b, m, bx, bz, rnd, 0.9);
      }
    }
    // Cars left in driveways.
    car(b, m, -34.2, 6, Math.PI / 2 + 0.03, m.carPaint[1], rnd);
    car(b, m, -48.2, 33.5, -Math.PI / 2, m.carPaint[3], rnd, { noWheels: true });
    ruin(b, m, -90, 40, 11, 9, rnd);
    this.blocked.push([-96, 35, -84, 45]);
    // Back fences and lot dividers, with gaps and missing sections.
    picketFence(b, m, -100, -19, -70, -19, rnd); picketFence(b, m, -66, -19, -14, -19, rnd, m.woodGrey);
    picketFence(b, m, -41, -19, -41, -8, rnd); picketFence(b, m, -72, -19, -72, -3, rnd, m.woodGrey);
    picketFence(b, m, -100, 58, -60, 58, rnd); picketFence(b, m, -54, 58, -16, 58, rnd);
    picketFence(b, m, -43, 46, -43, 58, rnd, m.woodGrey); picketFence(b, m, -74, 47, -74, 58, rnd);
    picketFence(b, m, -66, 28.5, -50, 28.5, rnd);
    // Yard clutter: swing set, shed, grill, pallets, tyres.
    this.swingSet(-26, 52);
    this.shed(-20, -13);
    this.shed(-96, 52);
    table(new Placer(b, -60, 0, -12), m, 0, 0, 0.3, 1.6, 0.9);
    for (let k = 0; k < 4; k++) tire(b, m, -84 + k * 0.3, 0.12 + (k % 2) * 0.24, -14, [Math.PI / 2, 0, 0]);
    pallet(b, m, -30, 0, 55, 0.4);
    // Yard trees.
    this.tree(-38, -12); this.tree(-70, 6, 'oak', 1.2); this.tree(-100, -8, 'dead'); this.tree(-16, 50, 'oak', 1.1);
    this.tree(-44, 52); this.tree(-78, 36, 'dead'); this.tree(-106, 30, 'tall'); this.tree(-12, 32, 'oak', 0.8);
    this.tree(-64, 50, 'tall');
  }

  private swingSet(x: number, z: number) {
    const p = new Placer(this.b, x, 0, z, 0.3), m = this.m;
    for (const s of [-1, 1]) for (const d of [-1, 1]) p.box(s * 1.6, 1.1, d * 0.55, 0.06, 2.35, 0.06, m.rust, null, 1, [d * 0.45, 0, 0]);
    p.box(0, 2.15, 0, 3.4, 0.08, 0.08, m.rust, null, 1);
    for (const sx of [-0.6, 0.6]) {
      p.box(sx, 0.55, 0, 0.5, 0.04, 0.2, m.rubber, null, 1);
      for (const e of [-0.22, 0.22]) p.box(sx + e, 0.57, 0, 0.01, 1.58, 0.01, m.black, null, 1, null, false);
    }
    p.collide(-1.7, 0, -0.9, 1.7, 2.2, 0.9, 'metal');
  }

  private shed(x: number, z: number) {
    const p = new Placer(this.b, x, 0, z, 0), m = this.m;
    const st: WallStyle = { ext: m.woodGrey, int: m.woodGrey, surface: 'wood', trim: m.white };
    shell(p, m, 3.4, 2.6, 0, 2.3, 0.1, st, { s: [door(1.2, 1.1, 2.0)] }, this.rnd);
    p.box(0, 2.3, 0, 3.8, 0.1, 3.0, m.metal, 'wood', 2, [0.08, 0, 0]);
    shelf(p, m, 0, -0.9, 0, 2.6, 1.8, m.wood, this.rnd, [m.containers[0], m.fabric[1]]);
    this.blocked.push([x - 1.8, z - 1.4, x + 1.8, z + 1.4]);
  }

  // ------------------------------------------------------------------------------------------------ gas station

  private gasStation() {
    const m = this.m, b = this.b, rnd = this.rnd;
    this.flat(7, -2, 52, 44, 0.014, m.slab, 4);
    this.flat(4.5, 4, 7, 12, 0.014, m.slab, 4);
    this.flat(4.5, 30, 7, 38, 0.014, m.slab, 4);
    this.paved.push([7, -2, 52, 44], [4.5, 4, 7, 12], [4.5, 30, 7, 38]);

    // Canopy over two pump islands.
    const cx = 21, cz = 21, cw = 20, cd = 15;
    const p = new Placer(b, cx, 0, cz, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(sx * 7, 0, sz * 4, 0.6, 5, 0.6, m.white, 'metal', 1);
    p.box(0, 5, 0, cw, 0.9, cd, m.white, 'metal', 2);
    const band = decalMat(m, 'fuel-band', 1024, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b8261e'; ctx.fillRect(0, 8, w, 18);
      ctx.fillStyle = '#23466a'; ctx.fillRect(0, 34, w, 18);
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(w * 0.36, 0, w * 0.28, h);
      ctx.fillStyle = '#b8261e'; ctx.font = 'bold 46px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('HARBOR FUEL', w / 2, h / 2 + 2);
    }, { wear: 1.2 });
    plane(p, 0, 5.45, cd / 2 + 0.015, cw, 0.9, band);
    plane(p, 0, 5.45, -cd / 2 - 0.015, cw, 0.9, band, Math.PI);
    plane(p, -cw / 2 - 0.015, 5.45, 0, cd, 0.9, band, -Math.PI / 2);
    plane(p, cw / 2 + 0.015, 5.45, 0, cd, 0.9, band, Math.PI / 2);
    for (let ix = -3; ix <= 3; ix++) for (const iz of [-5, 0, 5]) if ((ix + iz) % 2 === 0 && rnd() < 0.8) p.box(ix * 2.6, 4.97, iz, 1.2, 0.04, 0.6, m.lampGlass, null, 1, null, false);
    // A panel hanging loose from the canopy.
    p.box(5.2, 3.9, 3, 2.4, 0.04, 1.2, m.white, null, 1, [0.1, 0.2, 0.9]);
    for (const iz of [-4, 4]) {
      p.box(0, 0, iz, 7.5, 0.2, 1.3, m.concrete, 'concrete', 1);
      for (const ex of [-3.4, 3.4]) { p.cyl(ex, 0.2, iz, 0.1, 0.9, m.hazard, 10); p.collide(ex - 0.1, 0, iz - 0.1, ex + 0.1, 1.1, iz + 0.1, 'metal'); }
      for (const px of [-1.8, 1.8]) this.pump(cx + px, cz + iz, rnd() < 0.2);
    }
    this.blocked.push([cx - 4, cz - 5, cx + 4, cz - 3], [cx - 4, cz + 3, cx + 4, cz + 5]);
    const stain = decalMat(m, 'oil', 128, 128, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(12,12,10,0.8)'); g.addColorStop(0.6, 'rgba(20,20,18,0.45)'); g.addColorStop(1, 'rgba(20,20,18,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    }, { transparent: true });
    stain.alphaTest = 0.08;
    for (let k = 0; k < 10; k++) {
      const s = 1 + rnd() * 2.2;
      const g = new PlaneGeometry(s, s * (0.6 + rnd() * 0.6)).rotateX(-Math.PI / 2).rotateY(rnd() * 3).translate(12 + rnd() * 20, 0.022, 12 + rnd() * 18);
      b.add(g, stain, false);
    }
    car(b, m, cx - 0.5, cz, 0.04, m.carPaint[2], rnd);

    // Convenience store (front faces the pumps, -x).
    this.store(43, 20);

    // Price sign by the road.
    const sign = new Placer(b, 10, 0, 40.5, 0);
    for (const s of [-1, 1]) sign.box(s * 0.9, 0, 0, 0.25, 7, 0.25, m.steel, 'metal', 1);
    sign.box(0, 4, 0, 2.6, 3.2, 0.4, m.white, null, 1);
    const prices = decalMat(m, 'prices', 256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#b8261e'; ctx.fillRect(0, 0, w, 90);
      ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.fillText('HARBOR', w / 2, 44); ctx.fillText('FUEL', w / 2, 82);
      ctx.fillStyle = '#141414'; ctx.fillRect(0, 90, w, h - 90);
      ctx.font = 'bold 36px monospace'; ctx.textAlign = 'left';
      for (const [i, [n, p2]] of [['REG', '3.49'], ['PLUS', '3.6'], ['DSL', '-.--']].entries()) {
        ctx.fillStyle = '#d8d4c8'; ctx.fillText(n, 16, 140 + i * 66);
        ctx.fillStyle = '#e0a020'; ctx.fillText(p2, 140, 140 + i * 66);
      }
    }, { wear: 1.2 });
    plane(sign, 0, 5.6, 0.21, 2.5, 3.1, prices);
    plane(sign, 0, 5.6, -0.21, 2.5, 3.1, prices, Math.PI);
  }

  private pump(x: number, z: number, knocked: boolean) {
    const m = this.m;
    const p = new Placer(this.b, x, 0.2, z, knocked ? 0.3 : 0, knocked ? 1.2 : 0, 0);
    p.box(0, 0, 0, 0.95, 0.12, 0.6, m.steel, null, 1);
    p.box(0, 0.12, 0, 0.85, 1.55, 0.5, m.pumpRed, null, 1);
    p.box(0, 1.67, 0, 0.95, 0.38, 0.58, m.white, null, 1);
    for (const s of [-1, 1]) {
      p.box(0, 1.05, s * 0.255, 0.55, 0.4, 0.01, m.glass, null, 1);
      p.box(0.47 * s, 0.7, 0, 0.1, 0.25, 0.18, m.black, null, 1);
    }
    if (!knocked) this.b.collide(x - 0.47, 0, z - 0.3, x + 0.47, 2.25, z + 0.3, 'metal');
  }

  private store(x: number, z: number) {
    const m = this.m, rnd = this.rnd, W = 20, D = 12, H = 3.6;
    const p = new Placer(this.b, x, 0, z, -Math.PI / 2);
    p.box(0, 0, 0, W, 0.1, D, m.tile, 'concrete', 1.2);
    const style: WallStyle = { ext: m.brick, int: m.plaster, surface: 'concrete', trim: m.steel };
    shell(p, m, W, D, 0.1, H, 0.3, style, {
      s: [win(4.5, 7, 0, 2.6), door(10.25, 2.2, 2.5), win(15.6, 6.4, 0.6, 2.6)],
      n: [win(5, 1.2, 1.6, 2.4), door(16, 1.0, 2.2)],
      w: [win(6, 1.2, 1.6, 2.4, true)],
      e: [win(3, 1.2, 1.6, 2.4)],
    }, rnd);
    const inner: WallStyle = { ext: m.plaster, int: m.plaster, surface: 'wood' };
    wall(p, m, 'x', 3, W / 2 - 0.3, -2.5, 0.14, 0.1, H, [door(2, 0.95, 2.2)], inner, 1, rnd);
    wall(p, m, 'z', -D / 2 + 0.3, -2.57, 3, 0.14, 0.1, H, [], inner, 1, rnd);
    // Roof, parapet, rooftop units.
    p.box(0, H + 0.1, 0, W, 0.25, D, m.concreteDark, 'concrete', 3);
    for (const s of [-1, 1]) {
      // 0.55 m: taller than a step (so you can't walk off the roof), low enough to mantle up from the crates.
      p.box(0, H + 0.35, s * (D / 2 - 0.12), W, 0.55, 0.24, m.brick, 'concrete', 1.2);
      p.box(s * (W / 2 - 0.12), H + 0.35, 0, 0.24, 0.55, D - 0.48, m.brick, 'concrete', 1.2);
    }
    p.box(-4, H + 0.35, -1.5, 2.2, 1.2, 1.5, m.metal, 'metal', 1);
    p.box(3.5, H + 0.35, 2, 1.4, 0.9, 1.4, m.metal, 'metal', 1);
    p.cyl(6, H + 0.35, -3, 0.25, 0.9, m.steel, 10);
    const mart = decalMat(m, 'mart', 1024, 160, (ctx, w, h) => {
      ctx.fillStyle = '#23466a'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 110px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('HARBOR  MART', w / 2, h / 2 + 6);
      ctx.fillStyle = '#b8261e'; ctx.fillRect(0, h - 16, w, 16);
    }, { wear: 1.3 });
    plane(p, 0, 3.15, D / 2 + 0.03, 9, 1.0, mart);
    // Interior: coolers on the back wall, gondola shelving, counter, back room.
    const f = p.at(0, 0, 0, 0.1);
    for (let k = 0; k < 8; k++) {
      const cxk = -9.2 + k * 1.3;
      p.box(cxk, 0.1, -D / 2 + 0.36, 1.25, 2.3, 0.08, m.glass, null, 1);
      p.box(cxk - 0.62, 0.1, -D / 2 + 0.38, 0.05, 2.3, 0.1, m.steel, null, 1);
    }
    p.collide(-9.9, 0.1, -D / 2 + 0.3, 0.9, 2.4, -D / 2 + 0.42, 'metal');
    const goods = [m.containers[0], m.containers[1], m.containers[3], m.white, m.fabric[2]];
    for (const gz of [-1.4, 1.6]) {
      shelf(f, m, -4.2, gz - 0.26, 0, 5.2, 1.5, m.white, rnd, goods);
      shelf(f, m, -4.2, gz + 0.26, Math.PI, 5.2, 1.5, m.white, rnd, goods);
    }
    counter(f, m, 6.6, 2.4, 0, 3.6);
    counter(f, m, 8.6, 0.6, Math.PI / 2, 2.4);
    p.box(6, 1.03, 2.3, 0.4, 0.25, 0.35, m.black, null, 1);
    shelf(f, m, 7, -5.5, 0, 4, 2, m.steel, rnd, [m.fabric[0]]);
    table(f, m, 5.5, -4, 0.2, 1.2, 0.7, true);
    // Crates stacked against the back wall: the way up onto the roof.
    const back = p.at(0, -D / 2 - 1.0);
    back.box(-6, 0, 0, 1.9, 1.3, 1.3, m.containers[2], 'metal', 1);
    back.box(-3.6, 0, 0, 1.3, 1.25, 1.3, m.wood, 'wood', 1.3);
    back.box(-3.6, 1.25, 0, 1.3, 1.25, 1.3, m.wood, 'wood', 1.3);
    back.box(-2.2, 0, 0.1, 1.2, 1.1, 1.1, m.wood, 'wood', 1.1);
    this.blocked.push([x - 7, z - 11, x + 8, z + 11]);
    // Ice chest and propane cage out front, a car that went through the front window.
    const ice = decalMat(m, 'ice', 256, 96, (ctx, w, h) => {
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#2a6aa0'; ctx.font = 'bold 72px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ICE', w / 2, h / 2 + 4);
    }, { wear: 0.8 });
    const front = p.at(0, D / 2 + 0.7);
    front.box(8.2, 0, 0, 1.8, 1.3, 0.8, m.white, 'metal', 1);
    plane(front, 8.2, 0.8, 0.41, 1.2, 0.45, ice);
    front.box(-10.8 + 1.6, 0, 0, 1.4, 1.6, 0.8, m.steel, 'metal', 1);
    car(this.b, m, x - D / 2 - 1.3, z - 5, 0.06, m.carPaint[0], rnd);
  }

  // ------------------------------------------------------------------------------------------------ east side

  private eastSide() {
    const m = this.m, b = this.b, rnd = this.rnd;
    // Auto shop and its yard.
    this.flat(7, -48, 44, -12, 0.013, m.concreteDark, 5);
    this.paved.push([7, -48, 44, -12]);
    garage(b, m, 32, -28, -Math.PI / 2, rnd);
    this.blocked.push([26, -37, 38, -19]);
    car(b, m, 16, -42, 0.3 + Math.PI / 2, m.carPaint[4], rnd, { noWheels: true });
    car(b, m, 20, -16, -0.1, m.carPaint[1], rnd, { burnt: true });
    car(b, m, 41, -44, Math.PI / 2, m.carPaint[0], rnd, { noWheels: true });
    for (let k = 0; k < 5; k++) tire(b, m, 22 + k * 0.7, 0.12, -45.5, [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 4; k++) barrel(b, m, 40.5 + (k % 2) * 0.62, -20 + Math.floor(k / 2) * 0.62, rnd);

    // Billboard in the east field, facing the road.
    const bb = new Placer(b, 34, 0, 76, -Math.PI / 2);
    for (const s of [-1, 1]) { bb.box(s * 3.5, 0, 0, 0.35, 9, 0.35, m.steel, 'metal', 1); }
    bb.box(0, 4.5, -0.12, 13, 5.2, 0.2, m.steel, null, 1);
    for (let k = 0; k < 4; k++) bb.box(-5 + k * 3.3, 4.1, 0.6, 0.06, 0.06, 1.3, m.steel, null, 1);
    bb.box(0, 4.1, 1.2, 13, 0.06, 0.4, m.steel, null, 1);
    const poster = decalMat(m, 'billboard', 1024, 400, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e8a050'); g.addColorStop(0.55, '#d05838'); g.addColorStop(0.56, '#2a5a7a'); g.addColorStop(1, '#1a3a52');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f3d27a'; ctx.beginPath(); ctx.arc(w * 0.75, h * 0.52, 70, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 84px Georgia, serif'; ctx.fillText('Sunset Harbor', 50, 120);
      ctx.font = '40px Georgia, serif'; ctx.fillText('New homes by the sea — from $189,000', 54, 180);
      ctx.font = 'bold 36px Arial'; ctx.fillText('CALL 555-0142', 54, 340);
    }, { wear: 3.2 });
    plane(bb, 0, 7.1, 0.0, 12.6, 4.9, poster);

    trailer(b, m, 64, 94, 0, rnd);
    this.blocked.push([55.5, 91.5, 72.5, 96.5]);
    car(b, m, 58, 100, 0.05, m.carPaint[3], rnd);
    for (let k = 0; k < 3; k++) barrel(b, m, 74 + k * 0.7, 92, rnd, undefined, k === 2);
    // Jersey barriers and a pallet pile marking an old work site.
    jersey(b, m, 50, 50, 0.1); jersey(b, m, 52.6, 53.2, 0.9);
    for (let k = 0; k < 5; k++) pallet(b, m, 88, 0.14 * k, 60, 0.1 * k);
  }

  // ------------------------------------------------------------------------------------------------ port

  private port() {
    const m = this.m, b = this.b, rnd = this.rnd;
    this.flat(-520, QUAY, 520, -62, 0.012, m.slab, 6);
    this.paved.push([-520, QUAY, 520, -62]);
    chainFence(b, m, X0 - 1, -62, X1 + 1, -62, 2.4, [[114.5, 127.5], [78, 81.5]]);
    // Gate: barrier arm (snapped up), guard hut, jersey barriers.
    const gate = new Placer(b, 6, 0, -61.2, 0);
    gate.box(0, 0, 0, 0.35, 1.1, 0.35, m.white, 'metal', 1);
    gate.box(-2.4, 1.05, 0, 5, 0.1, 0.1, m.pumpRed, null, 1, [0, 0, -1.1]);
    guardHut(b, m, 10.5, -67, rnd);
    this.blocked.push([8.5, -69, 12.5, -65]);
    jersey(b, m, -3, -64.5, Math.PI / 2 + 0.1);
    const port = decalMat(m, 'port-sign', 512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#1f3040'; ctx.textAlign = 'center';
      ctx.font = 'bold 54px Arial'; ctx.fillText('PORT OF CALVERT', w / 2, 64);
      ctx.font = 'bold 36px Arial'; ctx.fillStyle = '#b8261e'; ctx.fillText('AUTHORIZED ENTRY ONLY', w / 2, 122);
    }, { wear: 1.2 });
    signPost(b, -8, -60.5, 0, port, m.steel, 2.2, 0.7, 2.7);

    warehouse(b, m, -50, -92, rnd);
    this.blocked.push([-70, -104, -30, -80]);
    containerYard(b, m, rnd, this.blocked);
    crane(b, m, 62, -106, -116.5);
    tankFarm(b, m, 81, -95, 117, -77);
    this.blocked.push([81, -95, 117, -77]);
    quay(b, m, QUAY, X0 + 4, X1 - 4, rnd);
    // Light masts.
    for (const [x, z] of [[-10, -95], [48, -78], [-22, -68]]) {
      const lm = new Placer(b, x, 0, z, 0);
      lm.cyl(0, 0, 0, 0.3, 20, m.steel, 10, null, 0.18);
      lm.box(0, 20, 0, 3, 0.6, 1.2, m.steel, null, 1);
      for (let k = -1; k <= 1; k++) lm.box(k, 20.1, 0.62, 0.8, 0.4, 0.05, m.lampGlass, null, 1);
      b.collide(x - 0.3, 0, z - 0.3, x + 0.3, 20, z + 0.3, 'metal');
    }
    // Loose cargo around the yard.
    for (let k = 0; k < 6; k++) pallet(b, m, -24 + rnd() * 4, 0, -110 + k * 1.4, rnd() * 0.3, rnd() < 0.5 ? 'sacks' : 'boxes', rnd);
    for (let k = 0; k < 7; k++) barrel(b, m, 72 + (k % 4) * 0.62, -70 + Math.floor(k / 4) * 0.62, rnd, m.containers[k % 3]);
    car(b, m, -24, -72, 0.4, m.carPaint[2], rnd);
    seaBackdrop(b, m, rnd);
  }

  // ------------------------------------------------------------------------------------------------ edges

  private edges() {
    const b = this.b, m = this.m;
    b.clip(X0 - 2, 0, Z0, X0, 30, Z1 + 2);
    b.clip(X1, 0, Z0, X1 + 2, 30, Z1 + 2);
    b.clip(X0 - 2, 0, Z1, X1 + 2, 30, Z1 + 2);
    b.clip(X0 - 2, -2, Z0 - 2, X1 + 2, 30, Z0 + 0.3);
    // Road closed where Harbor Road and Maple Street leave the map.
    for (const x of [-3, 0.1, 3.2]) jersey(b, m, x, Z1 - 1.5, Math.PI / 2 + (x % 2) * 0.05);
    for (const z of [17, 20.1, 23.2]) jersey(b, m, X0 + 1.5, z, 0.04);
    const closed = decalMat(m, 'closed', 512, 128, (ctx, w, h) => {
      for (let i = -4; i < 20; i++) { ctx.fillStyle = i % 2 ? '#d8d4c8' : '#c8641e'; ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40 + 40, 0); ctx.lineTo(i * 40 + 80, h); ctx.lineTo(i * 40 + 40, h); ctx.fill(); }
      ctx.fillStyle = '#111'; ctx.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.56);
      ctx.fillStyle = '#e8e4da'; ctx.font = 'bold 52px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ROAD CLOSED', w / 2, h / 2 + 3);
    }, { wear: 0.8 });
    signPost(b, 5.5, Z1 - 2, Math.PI, closed, m.steel, 2, 0.5, 1.6);
  }

  // ------------------------------------------------------------------------------------------------ nature

  private nature() {
    const rnd = this.rnd;
    // Wild zones: fields and woods that have taken over the empty lots.
    const zones: [Rect, number][] = [
      [[-116, -58, -10, -24], 0.012],
      [[10, 46, 116, 116], 0.006],
      [[48, -58, 116, -4], 0.01],
      [[-116, 62, -10, 116], 0.02],
      [[-116, 28, -104, 60], 0.02],
      [[56, 0, 116, 44], 0.008],
    ];
    for (const [[x0, z0, x1, z1], dens] of zones) {
      const n = Math.round((x1 - x0) * (z1 - z0) * dens);
      for (let k = 0; k < n; k++) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
        if (this.inRect(x, z, this.blocked, 2) || this.inRect(x, z, this.paved, 1.5)) continue;
        const r = rnd();
        this.tree(x, z, r < 0.12 ? 'dead' : r < 0.35 ? 'tall' : 'oak', 0.8 + rnd() * 0.5);
      }
      for (let k = 0; k < n * 2.5; k++) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
        if (this.inRect(x, z, this.blocked, 0.8) || this.inRect(x, z, this.paved, 0.5)) continue;
        bush(this.b, this.m, x, z, rnd, 0.7 + rnd() * 0.8);
      }
    }
    // Along the fences and the port fence.
    for (let x = X0 + 4; x < X1 - 4; x += 5 + rnd() * 6) {
      if (Math.abs(x) < 9) continue;
      if (!this.inRect(x, -60.5, this.blocked)) bush(this.b, this.m, x, -60.2 + rnd() * 0.8, rnd, 0.9 + rnd() * 0.5);
    }
    // Tree line outside the map so the edge reads as woods, not a wall.
    for (let k = 0; k < 170; k++) {
      const side = k % 3;
      let x: number, z: number;
      if (side === 0) { x = X0 - 4 - rnd() * 60; z = -50 + rnd() * 220; }
      else if (side === 1) { x = X1 + 4 + rnd() * 60; z = -50 + rnd() * 220; }
      else { x = -170 + rnd() * 340; z = Z1 + 4 + rnd() * 50; }
      if (Math.abs(x) < 8 && z > Z1) continue;
      if (z > 13 && z < 27 && x < X0) continue;
      tree(this.b, this.m, x, z, rnd, rnd() < 0.5 ? 'tall' : 'oak', 1 + rnd() * 0.5);
    }
  }

  // ------------------------------------------------------------------------------------------------ bots

  private bots() {
    const d = this.wallDummies;
    d.push(new Vector3(41, 0.1, 23.5));     // inside the store, by the counter
    d.push(new Vector3(45, 3.95, 26));      // on the store roof
    d.push(new Vector3(-53, 3.55, 1.5));    // upstairs in the yellow house
    d.push(new Vector3(-32.5, 0.48, 34.2)); // on a porch across Maple Street
    d.push(new Vector3(-90, 0.5, 41));      // in the burnt-out house
    d.push(new Vector3(30, 0.08, -31));     // in the auto shop
    d.push(new Vector3(-64, 3.6, -97));     // on the warehouse mezzanine
    d.push(new Vector3(60, 0.9, 93.5));     // inside the trailer
    d.push(new Vector3(62, 0, -112));       // under the crane
    this.botLanes.push({ center: new Vector3(10, 0, -81.7), halfWidth: 7 });
    this.botLanes.push({ center: new Vector3(15, 0, -94.7), halfWidth: 5 });
    this.botLanes.push({ center: new Vector3(-48, 0, 20), halfWidth: 5 });
  }
}
