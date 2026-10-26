import * as THREE from 'three';
import { COURT } from '../sim/config';

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function skyTexture(): THREE.Texture {
  const [c, g] = canvas2d(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9ed3ff');
  grad.addColorStop(0.5, '#d3ecff');
  grad.addColorStop(1, '#f6fbff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function shadowTexture(): THREE.Texture {
  const [c, g] = canvas2d(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(18,44,70,0.55)');
  grad.addColorStop(0.6, 'rgba(18,44,70,0.22)');
  grad.addColorStop(1, 'rgba(18,44,70,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function ballTexture(): THREE.Texture {
  const [c, g] = canvas2d(512, 256);
  g.fillStyle = '#f6c445';
  g.fillRect(0, 0, 512, 256);

  g.lineCap = 'round';
  g.strokeStyle = '#2f57c8';
  g.lineWidth = 14;
  for (let i = 0; i < 3; i++) {
    const x0 = i * 176 + 30;
    g.beginPath();
    g.moveTo(x0, 16);
    g.bezierCurveTo(x0 + 96, 74, x0 - 34, 176, x0 + 62, 244);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(0, 128);
  g.bezierCurveTo(128, 92, 384, 168, 512, 128);
  g.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function courtTexture(): THREE.Texture {
  const [c, g] = canvas2d(64, 64);
  g.fillStyle = '#fbfdff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e8f0f7';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function netTexture(): THREE.Texture {
  const [c, g] = canvas2d(256, 128);
  g.clearRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(26,42,60,0.55)';
  g.lineWidth = 2;
  const step = 16;
  for (let x = 0; x <= 256; x += step) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 128);
    g.stroke();
  }
  for (let y = 0; y <= 128; y += step) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 静态场景：雪地、球场、球网、远景装饰 */
export class Arena {
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.buildGround());
    this.group.add(this.buildCourt());
    this.group.add(this.buildNet());
    this.group.add(this.buildDecor());
  }

  private buildGround(): THREE.Group {
    const g = new THREE.Group();
    const snow = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: 0xf1f7fc, roughness: 0.98, metalness: 0 }),
    );
    snow.rotation.x = -Math.PI / 2;
    snow.position.y = -0.04;
    g.add(snow);

    // 球场近边的一点雪堆
    for (let i = 0; i < 10; i++) {
      const mound = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xeaf4fd, roughness: 1 }),
      );
      const a = (i / 10) * Math.PI * 2;
      mound.position.set(Math.cos(a) * (15 + (i % 3) * 4), -0.7, Math.sin(a) * (17 + (i % 4) * 5));
      mound.scale.set(1.2, 0.45, 1.2);
      g.add(mound);
    }
    return g;
  }

  private buildCourt(): THREE.Group {
    const g = new THREE.Group();
    const w = COURT.halfWidth * 2;
    const l = COURT.halfLength * 2;

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshStandardMaterial({
        map: courtTexture(),
        roughness: 0.82,
        metalness: 0,
        color: 0xffffff,
      }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.002;
    g.add(surface);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0x3b6fe0 });
    const addLine = (lw: number, ll: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, ll), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.014, z);
      g.add(m);
    };

    addLine(0.1, l, -COURT.halfWidth, 0);
    addLine(0.1, l, COURT.halfWidth, 0);
    addLine(w, 0.1, 0, -COURT.halfLength);
    addLine(w, 0.1, 0, COURT.halfLength);
    addLine(w, 0.06, 0, 0);
    // 进攻线
    addLine(w, 0.05, 0, 3);
    addLine(w, 0.05, 0, -3);

    return g;
  }

  private buildNet(): THREE.Group {
    const g = new THREE.Group();
    const netW = COURT.netHalfWidth * 2 + 0.2;
    const netBottom = 1.15;
    const netTop = COURT.netHeight;

    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(netW, netTop - netBottom),
      new THREE.MeshBasicMaterial({
        map: netTexture(),
        transparent: true,
        alphaTest: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    net.position.set(0, (netTop + netBottom) / 2, 0);
    g.add(net);

    const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(netW + 0.1, 0.09, 0.06), bandMat);
    top.position.set(0, netTop + 0.02, 0);
    g.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(netW, 0.05, 0.05), bandMat);
    bottom.position.set(0, netBottom, 0);
    g.add(bottom);

    const postMat = new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.4, metalness: 0.35 });
    for (const x of [-COURT.halfWidth - 0.25, COURT.halfWidth + 0.25]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.55, 12), postMat);
      post.position.set(x, 1.275, 0);
      g.add(post);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 14), postMat);
      base.position.set(x, 0.06, 0);
      g.add(base);
    }

    const red = new THREE.MeshStandardMaterial({ color: 0xff4d5e, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    for (const x of [-COURT.antennaX, COURT.antennaX]) {
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.25, 8), i % 2 ? red : white);
        seg.position.set(x, netTop + 0.125 + i * 0.25, 0);
        g.add(seg);
      }
    }

    return g;
  }

  private buildDecor(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf7fbff, roughness: 0.9 });
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.35, metalness: 0.1 });
    const spots: Array<[number, number, number, number]> = [
      [-42, 1.5, -34, 6],
      [46, 1.2, -28, 5],
      [-48, 1.4, 10, 5.5],
      [44, 1.6, 26, 6],
      [12, 1.4, -50, 7],
    ];
    for (const [x, y, z, s] of spots) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), y > 3 ? iceMat : mat);
      rock.position.set(x, y, z);
      rock.scale.set(s, s * 0.8, s);
      rock.rotation.set(x, y, z);
      g.add(rock);
    }
    return g;
  }
}
