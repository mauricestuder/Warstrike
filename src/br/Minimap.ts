import { OrthographicCamera, Vector2, type FogExp2, type Vector3 } from 'three';
import type { Renderer } from '../render/Renderer';

const SIZE = 512;

export interface MapMarks {
  player: Vector3;
  yaw: number;
  zone: { c: Vector2; r: number };
  next: { c: Vector2; r: number } | null;
  plane: { from: Vector3; to: Vector3; pos: Vector3 } | null;
  boxes: Vector3[];
  stations: Vector3[];
}

/**
 * A top-down picture of the real map, rendered once from straight above, with the gas, circles, plane path,
 * supply boxes, buy stations and your arrow drawn over it. The corner minimap is a zoomed window around you; M opens
 * the whole map.
 */
export class Minimap {
  private base = document.createElement('canvas');
  private x0: number;
  private z0: number;
  private span: number;

  constructor(cx: number, cz: number, private half: number) {
    this.base.width = this.base.height = SIZE;
    this.x0 = cx - half;
    this.z0 = cz - half;
    this.span = half * 2;
  }

  /** Renders the scene from above straight onto the canvas and copies it before the browser presents the frame. */
  capture(r: Renderer, hideForMap: (on: boolean) => void) {
    const cam = new OrthographicCamera(-this.half, this.half, this.half, -this.half, 1, 1200);
    cam.position.set(this.x0 + this.half, 500, this.z0 + this.half);
    cam.up.set(0, 0, -1);
    cam.lookAt(this.x0 + this.half, 0, this.z0 + this.half);
    const fog = r.scene.fog as FogExp2 | null, density = fog?.density ?? 0;
    if (fog) fog.density = 0;
    hideForMap(true);
    const gl = r.gl, buf = gl.getDrawingBufferSize(new Vector2());
    const px = Math.min(buf.x, buf.y, 1024), pr = gl.getPixelRatio();
    gl.setRenderTarget(null);
    gl.setViewport(0, 0, px / pr, px / pr);
    gl.render(r.scene, cam);
    const ctx = this.base.getContext('2d')!;
    ctx.drawImage(gl.domElement, 0, buf.y - px, px, px, 0, 0, SIZE, SIZE);
    gl.setViewport(0, 0, buf.x / pr, buf.y / pr);
    hideForMap(false);
    if (fog) fog.density = density;
    // Gentle grade so the overlays read on top.
    ctx.fillStyle = 'rgba(10, 14, 12, 0.18)';
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  /**
   * Draws the map into `canvas`. `viewHalf` is how many metres from the centre to the edge are visible; `center` is
   * the world point at the middle (the player for the minimap, the map centre for the full map).
   */
  draw(canvas: HTMLCanvasElement, center: { x: number; z: number }, viewHalf: number, m: MapMarks) {
    const ctx = canvas.getContext('2d')!, W = canvas.width;
    const k = W / (viewHalf * 2);
    const sx = (x: number) => (x - center.x) * k + W / 2, sy = (z: number) => (z - center.z) * k + W / 2;
    ctx.fillStyle = '#1d2a33';
    ctx.fillRect(0, 0, W, W);
    const bk = SIZE / this.span;
    ctx.drawImage(this.base, (center.x - viewHalf - this.x0) * bk, (center.z - viewHalf - this.z0) * bk, viewHalf * 2 * bk, viewHalf * 2 * bk, 0, 0, W, W);
    // Gas everywhere outside the circle.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.arc(sx(m.zone.c.x), sy(m.zone.c.y), Math.max(0, m.zone.r) * k, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(190, 200, 50, 0.32)';
    ctx.fill('evenodd');
    ctx.restore();
    ctx.lineWidth = Math.max(1.5, W / 220);
    ctx.strokeStyle = 'rgba(230, 210, 90, 0.95)';
    ctx.beginPath(); ctx.arc(sx(m.zone.c.x), sy(m.zone.c.y), Math.max(0, m.zone.r) * k, 0, Math.PI * 2); ctx.stroke();
    if (m.next && m.next.r < m.zone.r - 0.5) {
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath(); ctx.arc(sx(m.next.c.x), sy(m.next.c.y), m.next.r * k, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (m.plane) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(sx(m.plane.from.x), sy(m.plane.from.z)); ctx.lineTo(sx(m.plane.to.x), sy(m.plane.to.z)); ctx.stroke();
      ctx.setLineDash([]);
    }
    const icon = (p: Vector3, color: string, label: string) => {
      const x = sx(p.x), y = sy(p.z), s = Math.max(5, W / 60);
      if (x < -s || y < -s || x > W + s || y > W + s) return;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(s * 1.5)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 1);
    };
    for (const b of m.boxes) icon(b, '#ffc040', '▣');
    for (const s of m.stations) icon(s, '#8fe08a', '$');
    // You (or the plane).
    const me = m.plane ? m.plane.pos : m.player;
    ctx.save();
    ctx.translate(sx(me.x), sy(me.z));
    ctx.rotate(-m.yaw);
    const a = Math.max(7, W / 40);
    ctx.beginPath();
    ctx.moveTo(0, -a); ctx.lineTo(a * 0.65, a * 0.7); ctx.lineTo(0, a * 0.35); ctx.lineTo(-a * 0.65, a * 0.7); ctx.closePath();
    ctx.fillStyle = m.plane ? '#ffffff' : '#ffd23a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // North.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 12);
  }
}
