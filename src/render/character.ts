import * as THREE from 'three';
import { shadowTexture } from './arena';
import type { Player } from '../sim/types';

const SKINS = ['#f8cba6', '#eab792', '#d49a72', '#b07a52'];
const HAIRS = ['#2e2622', '#4a2f22', '#1a2440', '#c9932f', '#e2643f', '#3f3a63'];
const HOME_KIT = ['#2fd07a', '#1fbf85', '#4ade9a', '#16a86d'];
const AWAY_KIT = ['#ff5f8f', '#ff7a5c', '#ef4f6d', '#ff9a63'];

const G = {
  head: new THREE.SphereGeometry(0.3, 20, 16),
  body: new THREE.CapsuleGeometry(0.26, 0.22, 6, 16),
  arm: new THREE.CapsuleGeometry(0.075, 0.24, 4, 8),
  leg: new THREE.CapsuleGeometry(0.095, 0.24, 4, 8),
  hair: new THREE.SphereGeometry(0.315, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
  eye: new THREE.SphereGeometry(0.048, 8, 8),
  hand: new THREE.SphereGeometry(0.085, 10, 8),
  shoe: new THREE.SphereGeometry(0.115, 10, 8),
  sleeve: new THREE.SphereGeometry(0.105, 10, 8),
  ring: new THREE.RingGeometry(0.4, 0.55, 40),
  shadow: new THREE.PlaneGeometry(1.25, 1.25),
};

const SHADOW_TEX = shadowTexture();

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function makeLabel(name: string, color: string, num: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  g.font = '700 36px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(9,26,44,0.82)';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 34);

  const bw = 60;
  const bh = 32;
  g.fillStyle = color;
  roundRect(g, 128 - bw / 2, 62, bw, bh, 16);
  g.fill();
  g.fillStyle = '#08202f';
  g.font = '900 24px system-ui,sans-serif';
  g.fillText(String(num).padStart(2, '0'), 128, 79);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.35, 1.03, 1);
  return sprite;
}

/** 程序化 Q 版角色：球体 + 胶囊拼装，附带跑动/跳跃/扣球/扑救/倒地程序动画 */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly label: THREE.Sprite;

  private rig = new THREE.Group();
  private lArm = new THREE.Group();
  private rArm = new THREE.Group();
  private lLeg = new THREE.Group();
  private rLeg = new THREE.Group();
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private phase = Math.random() * Math.PI * 2;
  private cheerTimer = 0;

  constructor(p: Player, idx: number) {
    const skin = SKINS[idx % SKINS.length];
    const hair = HAIRS[(idx * 3 + 1) % HAIRS.length];
    const kit = p.team === 0 ? HOME_KIT[idx % HOME_KIT.length] : AWAY_KIT[idx % AWAY_KIT.length];
    const teamColor = p.team === 0 ? '#4dffa0' : '#ff8a7a';

    const kitMat = new THREE.MeshStandardMaterial({ color: kit, roughness: 0.62 });
    const kitDark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(kit).multiplyScalar(0.62),
      roughness: 0.7,
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.66 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.78 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.35 });

    // 影子 + 脚下光环（跟随地面，不随跳跃升高）
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: SHADOW_TEX,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(G.shadow, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: teamColor,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(G.ring, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    this.root.add(this.rig);

    const body = new THREE.Mesh(G.body, kitMat);
    body.position.y = 0.88;
    this.rig.add(body);

    const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.235, 0.2, 14), kitDark);
    shorts.position.y = 0.56;
    this.rig.add(shorts);

    const head = new THREE.Mesh(G.head, skinMat);
    head.position.y = 1.44;
    this.rig.add(head);

    const hairMesh = new THREE.Mesh(G.hair, hairMat);
    hairMesh.position.y = 1.44;
    hairMesh.rotation.y = idx * 1.2;
    this.rig.add(hairMesh);

    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(G.eye, eyeMat);
      eye.position.set(sx * 0.105, 1.47, 0.278);
      eye.scale.z = 0.65;
      this.rig.add(eye);
    }

    const mouth = new THREE.Mesh(G.eye, eyeMat);
    mouth.position.set(0, 1.35, 0.283);
    mouth.scale.set(0.9, 0.35, 0.4);
    this.rig.add(mouth);

    // 手臂
    this.lArm.position.set(-0.31, 1.06, 0);
    this.rArm.position.set(0.31, 1.06, 0);
    for (const [arm, side] of [
      [this.lArm, -1],
      [this.rArm, 1],
    ] as const) {
      const limb = new THREE.Mesh(G.arm, skinMat);
      limb.position.y = -0.18;
      arm.add(limb);
      const sleeve = new THREE.Mesh(G.sleeve, kitMat);
      sleeve.position.y = -0.02;
      sleeve.scale.set(1, 1.1, 1);
      arm.add(sleeve);
      const hand = new THREE.Mesh(G.hand, skinMat);
      hand.position.set(side * 0.005, -0.4, 0);
      arm.add(hand);
      this.rig.add(arm);
    }

    // 腿
    this.lLeg.position.set(-0.125, 0.6, 0);
    this.rLeg.position.set(0.125, 0.6, 0);
    for (const leg of [this.lLeg, this.rLeg]) {
      const limb = new THREE.Mesh(G.leg, skinMat);
      limb.position.y = -0.2;
      leg.add(limb);
      const shoe = new THREE.Mesh(G.shoe, kitDark);
      shoe.position.set(0, -0.4, 0.04);
      shoe.scale.set(1, 0.75, 1.35);
      leg.add(shoe);
      this.rig.add(leg);
    }

    this.label = makeLabel(p.name, teamColor, p.id + 1);
    this.label.position.y = 2.25;
    this.root.add(this.label);
  }

  celebrate(): void {
    this.cheerTimer = 1.6;
  }

  /** 重开一局时释放本角色的材质与贴图（几何体为全局共享，不释放） */
  dispose(): void {
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh && !(obj as THREE.Sprite).isSprite) return;
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[];
      const list = Array.isArray(mat) ? mat : [mat];
      for (const m of list) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    });
    this.shadowMat.dispose();
    this.ringMat.dispose();
  }

  update(dt: number, x: number, z: number, p: Player): void {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = p.facing;

    this.cheerTimer = Math.max(0, this.cheerTimer - dt);
    this.phase += dt * (p.moving && p.grounded ? 13 : 2.4);

    let legL = 0;
    let legR = 0;
    let armL = 0;
    let armR = 0;
    let rigX = 0;
    let rigY = p.pos.y;
    let bounce = 0;

    if (this.cheerTimer > 0) {
      armL = -2.6;
      armR = -2.6;
      bounce = Math.abs(Math.sin(this.phase * 5)) * 0.16;
    } else if (p.blocking) {
      // 拦网：双臂高举、身体前倾
      armL = -2.95;
      armR = -2.95;
      legL = -0.18;
      legR = 0.18;
      rigX = 0.08;
    } else {
      switch (p.anim) {
        case 'run': {
          const s = Math.sin(this.phase);
          legL = s * 0.85;
          legR = -s * 0.85;
          armL = -s * 0.75;
          armR = s * 0.75;
          bounce = Math.abs(Math.sin(this.phase)) * 0.05;
          break;
        }
        case 'jump': {
          legL = -0.45;
          legR = 0.3;
          armL = -2.1;
          armR = -2.1;
          break;
        }
        case 'hit': {
          const k = 1 - Math.min(1, p.animTimer / 0.26);
          const s = Math.sin(k * Math.PI);
          armL = -2.2 * s;
          armR = -2.7 * s;
          rigX = 0.16 * s;
          break;
        }
        case 'dive': {
          rigX = 1.25;
          rigY = 0.3;
          armL = -2.4;
          armR = -2.4;
          break;
        }
        case 'stun': {
          rigX = 1.5;
          rigY = 0.22;
          armL = -1.2;
          armR = -1.2;
          break;
        }
        default: {
          const s = Math.sin(this.phase);
          armL = 0.06 + s * 0.06;
          armR = -0.06 - s * 0.06;
          bounce = Math.sin(this.phase * 2) * 0.015;
          break;
        }
      }
    }

    this.rig.position.y = THREE.MathUtils.damp(this.rig.position.y, rigY + bounce, 26, dt);
    this.rig.rotation.x = THREE.MathUtils.damp(this.rig.rotation.x, rigX, 16, dt);
    this.lLeg.rotation.x = THREE.MathUtils.damp(this.lLeg.rotation.x, legL, 20, dt);
    this.rLeg.rotation.x = THREE.MathUtils.damp(this.rLeg.rotation.x, legR, 20, dt);
    this.lArm.rotation.x = THREE.MathUtils.damp(this.lArm.rotation.x, armL, 20, dt);
    this.rArm.rotation.x = THREE.MathUtils.damp(this.rArm.rotation.x, armR, 20, dt);
    this.lArm.rotation.z = THREE.MathUtils.damp(this.lArm.rotation.z, -0.08, 12, dt);
    this.rArm.rotation.z = THREE.MathUtils.damp(this.rArm.rotation.z, 0.08, 12, dt);

    this.label.position.y = 2.25 + p.pos.y;

    const h = Math.min(1, p.pos.y / 1.5);
    this.shadow.scale.setScalar(1 - h * 0.35);
    this.shadowMat.opacity = 0.55 * (1 - h * 0.65);
    this.ringMat.opacity = 0.5 * (1 - h * 0.5);
  }
}
