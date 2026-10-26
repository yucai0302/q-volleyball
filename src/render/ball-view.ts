import * as THREE from 'three';
import { ballTexture } from './arena';

function ringSprite(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 48, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(1.1);
  return s;
}

/** 排球表现：球体 + 高速拖尾 + 可击打脉冲环 */
export class BallView {
  readonly group = new THREE.Group();

  private mesh: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts = new Float32Array(16 * 3);
  private pulse = ringSprite();
  private t = 0;
  private visible = true;

  constructor() {
    const geo = new THREE.SphereGeometry(0.2, 24, 16);
    const mat = new THREE.MeshStandardMaterial({
      map: ballTexture(),
      roughness: 0.55,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    for (let i = 0; i < 16; i++) {
      this.trailPts[i * 3] = 0;
      this.trailPts[i * 3 + 1] = -50;
      this.trailPts[i * 3 + 2] = 0;
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
    const tmat = new THREE.LineBasicMaterial({
      color: 0xb6f4ff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.trail = new THREE.Line(tgeo, tmat);
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.pulse.visible = false;
    this.group.add(this.pulse);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }

  /** 重新发球 / 传送时清空拖尾，避免出现横穿球场的残影 */
  resetTrail(): void {
    for (let i = 0; i < 16; i++) {
      this.trailPts[i * 3] = 0;
      this.trailPts[i * 3 + 1] = -50;
      this.trailPts[i * 3 + 2] = 0;
    }
    const geo = this.trail.geometry as THREE.BufferGeometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, x: number, y: number, z: number, hittable: boolean): void {
    if (!this.visible) return;
    this.mesh.position.set(x, y, z);

    // 拖尾
    const p = this.trailPts;
    for (let i = 15; i > 0; i--) {
      p[i * 3] = p[(i - 1) * 3];
      p[i * 3 + 1] = p[(i - 1) * 3 + 1];
      p[i * 3 + 2] = p[(i - 1) * 3 + 2];
    }
    p[0] = x;
    p[1] = y;
    p[2] = z;
    const geo = this.trail.geometry as THREE.BufferGeometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    this.t += dt;
    this.pulse.visible = hittable;
    if (hittable) {
      this.pulse.position.set(x, y, z);
      const s = 0.95 + Math.sin(this.t * 9) * 0.13;
      this.pulse.scale.setScalar(s);
      (this.pulse.material as THREE.SpriteMaterial).opacity = 0.55 + Math.sin(this.t * 9) * 0.25;
    }
  }
}
