import {
  BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Quaternion, Vector3,
  type Material,
} from 'three';
import type { Builder } from '../Builder';
import type { TownMaterials } from './TownMaterials';

type Rnd = () => number;

/**
 * A cloud of alpha-tested leaf cards around a centre. Normals point away from the centre (not along each card),
 * so the canopy shades like one soft volume instead of a pile of flat quads.
 */
export function leafCloud(cx: number, cy: number, cz: number, rx: number, ry: number, count: number, size: number, rnd: Rnd): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const q = new Quaternion(), v = new Vector3(), n = new Vector3(), axis = new Vector3();
  for (let k = 0; k < count; k++) {
    // Mostly near the surface of the ellipsoid, some inside to fill it.
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = 0.55 + Math.sqrt(rnd()) * 0.45;
    const sx = Math.sqrt(1 - u * u) * Math.cos(a) * rr, sy = u * rr, sz = Math.sqrt(1 - u * u) * Math.sin(a) * rr;
    const px = cx + sx * rx, py = cy + sy * ry, pz = cz + sz * rx;
    axis.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    q.setFromAxisAngle(axis, rnd() * Math.PI);
    const s = size * (0.75 + rnd() * 0.5);
    const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
    n.set(sx, sy * 0.8 + 0.25, sz).normalize();
    for (const [cxk, cyk, uu, vv] of corners) {
      v.set(cxk * s * 0.5, cyk * s * 0.5, 0).applyQuaternion(q);
      pos.push(px + v.x, py + v.y, pz + v.z);
      nor.push(n.x, n.y, n.z);
      uv.push(uu, vv);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

/** A tapered limb from a to b. */
function limb(b: Builder, a: Vector3, to: Vector3, r0: number, r1: number, mat: Material) {
  const len = a.distanceTo(to);
  const g = new CylinderGeometry(r1, r0, len, 7, 1);
  g.translate(0, len / 2, 0);
  const dir = to.clone().sub(a).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  b.add(g, mat);
}

export type TreeKind = 'oak' | 'dead' | 'tall';

/** Broadleaf tree: leaning trunk, a few limbs, a leaf cloud at the end of each. Adds a trunk collider. */
export function tree(b: Builder, m: TownMaterials, x: number, z: number, rnd: Rnd, kind: TreeKind = 'oak', scale = 1) {
  const h = (kind === 'tall' ? 11 : 7) * scale * (0.85 + rnd() * 0.3);
  const lean = new Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25).normalize();
  const base = new Vector3(x, -0.1, z), top = base.clone().addScaledVector(lean, h * 0.62);
  const bark = kind === 'dead' ? m.deadBark : m.bark;
  const r0 = 0.22 * scale * (kind === 'tall' ? 1.2 : 1);
  limb(b, base, top, r0, r0 * 0.55, bark);
  b.collide(x - r0, 0, z - r0, x + r0, Math.min(h * 0.55, 4), z + r0, 'wood');
  const limbs = kind === 'dead' ? 5 : 4;
  const leaves = rnd() < 0.2 ? m.leavesDry : m.leaves;
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + rnd() * 0.8;
    const start = base.clone().addScaledVector(lean, h * (0.38 + rnd() * 0.25));
    const reach = h * (0.22 + rnd() * 0.14);
    const end = start.clone().add(new Vector3(Math.cos(a) * reach, h * (0.18 + rnd() * 0.22), Math.sin(a) * reach));
    limb(b, start, end, r0 * 0.45, r0 * 0.15, bark);
    if (kind !== 'dead') {
      const cr = h * (0.2 + rnd() * 0.08);
      b.add(leafCloud(end.x, end.y + cr * 0.2, end.z, cr, cr * 0.78, Math.round(26 * scale), 1.5 * scale, rnd), leaves);
    } else {
      // Bare twigs.
      for (let t = 0; t < 2; t++) {
        const tw = end.clone().add(new Vector3((rnd() - 0.5) * 2, 0.6 + rnd(), (rnd() - 0.5) * 2));
        limb(b, end, tw, r0 * 0.12, r0 * 0.04, bark);
      }
    }
  }
  if (kind !== 'dead') {
    const cr = h * 0.27;
    b.add(leafCloud(top.x, top.y + cr * 0.35, top.z, cr, cr * 0.8, Math.round(38 * scale), 1.7 * scale, rnd), leaves);
  }
}

/** A shrub: a squashed leaf cloud sitting on the ground. No collider (you can push through, it's cover only). */
export function bush(b: Builder, m: TownMaterials, x: number, z: number, rnd: Rnd, size = 1) {
  const r = (0.8 + rnd() * 0.7) * size;
  b.add(leafCloud(x, r * 0.55, z, r, r * 0.65, Math.round(18 * size + 6), 0.9 * size, rnd), m.bushLeaves);
}

/** Ivy climbing a wall face: cards flattened against the plane (axis 'x' = wall facing ±x). */
export function ivy(b: Builder, m: TownMaterials, x: number, y: number, z: number, w: number, h: number, facing: 'x' | 'z',
  sign: number, rnd: Rnd) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const count = Math.round(w * h * 3);
  for (let k = 0; k < count; k++) {
    // Denser toward the bottom, thinning out as it climbs.
    const u = (rnd() - 0.5) * w, v = Math.pow(rnd(), 1.6) * h, s = 0.5 + rnd() * 0.5, a = rnd() * Math.PI;
    const off = 0.03 + rnd() * 0.04;
    const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
    for (const [cu, cv, uu, vv] of corners) {
      const ru = (cu * Math.cos(a) - cv * Math.sin(a)) * s * 0.5, rv = (cu * Math.sin(a) + cv * Math.cos(a)) * s * 0.5;
      if (facing === 'x') { pos.push(x + sign * off, y + v + rv, z + u + ru); nor.push(sign, 0.2, 0); }
      else { pos.push(x + u + ru, y + v + rv, z + sign * off); nor.push(0, 0.2, sign); }
      uv.push(uu, vv);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  b.add(g, m.ivy, false);
}

/** One clump of grass blades, bent and tapered, with a dark base fading to a lighter tip (vertex colour). */
function clumpGeometry(blades: number, rnd: Rnd): BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  for (let k = 0; k < blades; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.2, h = 0.2 + rnd() * 0.32, w = 0.016 + rnd() * 0.014;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const face = rnd() * Math.PI, fx = Math.cos(face), fz = Math.sin(face);
    const bend = 0.05 + rnd() * 0.14, bdx = Math.cos(a) * bend, bdz = Math.sin(a) * bend;
    const p = [
      [bx - fx * w, 0, bz - fz * w], [bx + fx * w, 0, bz + fz * w],
      [bx - fx * w * 0.6 + bdx * 0.35, h * 0.55, bz - fz * w * 0.6 + bdz * 0.35],
      [bx + fx * w * 0.6 + bdx * 0.35, h * 0.55, bz + fz * w * 0.6 + bdz * 0.35],
      [bx + bdx, h, bz + bdz],
    ];
    const tris = [[0, 1, 3], [0, 3, 2], [2, 3, 4]];
    for (const t of tris) for (const i of t) {
      pos.push(...p[i]);
      const k2 = p[i][1] / 0.52;
      col.push(0.13 + k2 * 0.3, 0.17 + k2 * 0.33, 0.06 + k2 * 0.12);
      nor.push(0, 1, 0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

/**
 * Instanced grass over the whole map, one InstancedMesh per 40 m cell so off-screen cells are culled.
 * `density(x, z)` returns 0..1 (probability of a clump at that spot; > 1 means taller weeds).
 */
export function grass(parent: Group, m: TownMaterials, x0: number, z0: number, x1: number, z1: number, spacing: number,
  density: (x: number, z: number) => number, rnd: Rnd): InstancedMesh[] {
  const geo = clumpGeometry(10, rnd), cells: InstancedMesh[] = [];
  const cell = 40, mat = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), up = new Vector3(0, 1, 0);
  const col = new Color();
  for (let cx = x0; cx < x1; cx += cell) for (let cz = z0; cz < z1; cz += cell) {
    const items: [number, number, number][] = [];
    for (let x = cx; x < Math.min(cx + cell, x1); x += spacing) for (let z = cz; z < Math.min(cz + cell, z1); z += spacing) {
      const px = x + rnd() * spacing, pz = z + rnd() * spacing, d = density(px, pz);
      if (d > 0 && rnd() < Math.min(d, 1)) items.push([px, pz, d]);
    }
    if (!items.length) continue;
    const mesh = new InstancedMesh(geo, m.grassBlade, items.length);
    items.forEach(([px, pz, d], i) => {
      const tall = d > 1 ? 1.8 + rnd() * 0.9 : 0.8 + rnd() * 0.6;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      mat.compose(p.set(px, 0, pz), q, s.set(1 + rnd() * 0.4, tall, 1 + rnd() * 0.4));
      mesh.setMatrixAt(i, mat);
      // Some clumps green, some straw-dry.
      const dry = rnd();
      col.setRGB(0.85 + dry * 0.5, 0.9 + dry * 0.25, 0.7 + dry * 0.1);
      mesh.setColorAt(i, col);
    });
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    cells.push(mesh);
  }
  return cells;
}
