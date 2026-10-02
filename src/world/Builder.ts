import { BufferAttribute, BufferGeometry, Euler, Group, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldBox } from '../render/Materials';
import { Colliders, type Surface } from './Colliders';
import { Foliage } from './Foliage';

interface Bucket { mat: Material; geos: BufferGeometry[]; shadow: boolean; }

const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), one = new Vector3(), at = new Vector3(), c = new Vector3();

/** Rotation as [x, y, z] Euler angles applied in Y, X, Z order (yaw first, like a person turning then tilting). */
export type Rot = [number, number, number];

/**
 * Collects static world geometry and merges it into one mesh per material per map cell, so a town made of
 * thousands of boxes renders in a few hundred draw calls while still frustum-culling by area.
 * Also owns the collider list, so solid pieces can be added in one call.
 */
export class Builder {
  readonly colliders = new Colliders();
  /** Leaves that block sight (for the bots) but not bullets. */
  readonly foliage = new Foliage();
  readonly root = new Group();
  private buckets = new Map<string, Bucket>();

  constructor(private cellSize = 48) {}

  /** Axis-aligned box: (x, z) is the footprint centre, y the bottom. With a surface it is also solid. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: Material, surface: Surface | null = null,
    tile = 2, shadow = true) {
    const g = worldBox(w, h, d, tile);
    g.translate(x, y + h / 2, z);
    this.add(g, mat, shadow);
    if (surface) this.collide(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, surface);
  }

  /** Rotated box around its centre (x, y, z). Visual only. */
  rbox(x: number, y: number, z: number, w: number, h: number, d: number, rot: Rot, mat: Material, tile = 2, shadow = true) {
    this.add(this.place(worldBox(w, h, d, tile), x, y, z, rot), mat, shadow);
  }

  /** Transforms a geometry in place: rotate (Y, X, Z), scale, then move to (x, y, z). */
  place<G extends BufferGeometry>(g: G, x: number, y: number, z: number, rot: Rot = [0, 0, 0], scale: number | Vector3 = 1): G {
    e.set(rot[0], rot[1], rot[2], 'YXZ');
    q.setFromEuler(e);
    if (typeof scale === 'number') one.setScalar(scale); else one.copy(scale);
    m4.compose(at.set(x, y, z), q, one);
    g.applyMatrix4(m4);
    return g;
  }

  /** Solid AABB without a mesh (used under visuals whose shape is not a box). */
  collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, surface: Surface) {
    this.colliders.add(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1), surface);
  }

  /** Invisible player-only wall; bullets pass through. */
  clip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.colliders.add(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1), 'dirt', true);
  }

  /** Queue a world-space geometry for merging. */
  add(g: BufferGeometry, mat: Material, shadow = true) {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.clearGroups();
    geo.computeBoundingBox();
    geo.boundingBox!.getCenter(c);
    const key = `${mat.uuid}|${shadow ? 1 : 0}|${Math.floor(c.x / this.cellSize)}|${Math.floor(c.z / this.cellSize)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, b = { mat, geos: [], shadow });
    b.geos.push(geo);
  }

  /** Merge everything queued so far into meshes under `root`. */
  finish() {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
    }
    this.buckets.clear();
  }
}
