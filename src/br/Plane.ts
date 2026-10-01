import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import type { Renderer } from '../render/Renderer';

const SPEED = 52, ALT = 170, HALF = 420;

/**
 * The drop plane: a four-engine military transport crossing the map on a random line.
 * You ride on the open rear ramp and jump whenever you like; at the far edge of the map you're thrown out.
 */
export class Plane {
  readonly obj = new Group();
  readonly dir: Vector3;
  private origin: Vector3;
  s = -HALF;
  private props: Mesh[] = [];
  /** Distance along the path where it leaves the playable area. */
  readonly exitS: number;
  readonly enterS: number;

  constructor(r: Renderer, center: Vector3, bounds: { x0: number; x1: number; z0: number; z1: number }, rnd: () => number) {
    const a = rnd() * Math.PI * 2;
    this.dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const perp = new Vector3(-this.dir.z, 0, this.dir.x);
    this.origin = center.clone().addScaledVector(perp, (rnd() - 0.5) * 90).setY(ALT);
    let enter = HALF, exit = -HALF;
    for (let s = -HALF; s <= HALF; s += 2) {
      const p = this.at(s);
      if (p.x > bounds.x0 && p.x < bounds.x1 && p.z > bounds.z0 && p.z < bounds.z1) { enter = Math.min(enter, s); exit = Math.max(exit, s); }
    }
    this.enterS = enter;
    this.exitS = exit;

    const body = r.setupMaterial(new MeshStandardMaterial({ color: 0x59605a, roughness: 0.55, metalness: 0.45 }));
    const dark = r.setupMaterial(new MeshStandardMaterial({ color: 0x2a2d2b, roughness: 0.5, metalness: 0.5 }));
    const glass = r.setupMaterial(new MeshStandardMaterial({ color: 0x1a2630, roughness: 0.1, metalness: 0.9 }));
    const add = (geo: BoxGeometry | CylinderGeometry | SphereGeometry, m: MeshStandardMaterial, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      mesh.castShadow = true;
      this.obj.add(mesh);
      return mesh;
    };
    // Built nose toward -z, then the whole group is turned to face the flight direction.
    add(new CylinderGeometry(2.3, 2.3, 22, 20), body, 0, 0, 0, Math.PI / 2);
    add(new SphereGeometry(2.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 0, -11, -Math.PI / 2).scale.set(1, 1.6, 1);
    add(new CylinderGeometry(2.3, 0.9, 9, 20), body, 0, 0.9, 15.4, Math.PI / 2 - 0.12);
    add(new BoxGeometry(2.4, 0.5, 1.2), glass, 0, 1.3, -13.6, -0.5);
    add(new BoxGeometry(40, 0.45, 4.2), body, 0, 1.9, -2);
    add(new BoxGeometry(14, 0.3, 3), body, 0, 2.2, 18.5);
    add(new BoxGeometry(0.35, 7, 4.5), body, 0, 5.2, 18.2);
    for (const x of [-13, -6.5, 6.5, 13]) {
      add(new CylinderGeometry(0.85, 0.75, 5, 12), dark, x, 1.3, -3.5, Math.PI / 2);
      const prop = add(new BoxGeometry(5.2, 0.25, 0.08), dark, x, 1.3, -6.1);
      this.props.push(prop);
    }
    r.scene.add(this.obj);
    this.update(0);
  }

  private at(s: number) { return this.origin.clone().addScaledVector(this.dir, s); }

  get pos() { return this.obj.position; }
  get done() { return this.s > HALF; }

  /** Where you stand: on the ramp under the tail. */
  rampPosition(out: Vector3) {
    return out.copy(this.obj.position).addScaledVector(this.dir, -21).setY(this.obj.position.y - 1.6);
  }

  update(dt: number) {
    this.s += SPEED * dt;
    this.obj.position.copy(this.at(this.s));
    this.obj.rotation.y = Math.atan2(-this.dir.x, -this.dir.z);
    for (const p of this.props) p.rotation.z += dt * 40;
  }

  get velocity() { return this.dir.clone().multiplyScalar(SPEED); }
}
