import * as THREE from 'three';
import { Arena, skyTexture } from './arena';
import { BallView } from './ball-view';
import { CharacterView } from './character';
import { Effects } from './effects';
import { clamp, damp } from '../core/math';
import type { World } from '../sim/world';
import type { GameEvents } from '../sim/types';

/** 表现层：只读取 World 状态，不写回任何模拟数据 */
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly effects: Effects;

  private arena = new Arena();
  private ballView = new BallView();
  private views = new Map<number, CharacterView>();

  private camPos = new THREE.Vector3(0, 9.9, 15.8);
  private camLook = new THREE.Vector3(0, 0.55, 0.35);
  private shake = 0;
  private dustTimer = 0;
  private elapsed = 0;
  private previewLine: THREE.Line;
  private previewPts = new Float32Array(70 * 3);
  private receiverMark: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement, fxLayer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 220);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0xe2f1fd, 32, 86);

    const hemi = new THREE.HemisphereLight(0xeaf7ff, 0xffffff, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff6e6, 1.65);
    dir.position.set(7, 13, 9);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xbfe0ff, 0.45);
    fill.position.set(-8, 6, -10);
    this.scene.add(fill);

    this.scene.add(this.arena.group);
    this.scene.add(this.ballView.group);
    this.effects = new Effects(this.scene, this.camera, fxLayer);

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.previewPts, 3));
    pGeo.setDrawRange(0, 0);
    this.previewLine = new THREE.Line(
      pGeo,
      new THREE.LineDashedMaterial({
        color: 0xff7aa8,
        dashSize: 0.26,
        gapSize: 0.18,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    this.previewLine.frustumCulled = false;
    this.previewLine.visible = false;
    this.scene.add(this.previewLine);

    // 接球指示：头顶橙色倒三角
    this.receiverMark = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.32, 4),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 }),
    );
    this.receiverMark.rotation.x = Math.PI;
    this.receiverMark.visible = false;
    this.scene.add(this.receiverMark);

    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  build(world: World): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    for (const p of world.players) {
      const v = new CharacterView(p, p.id);
      this.views.set(p.id, v);
      this.scene.add(v.root);
    }
  }

  sync(world: World, alpha: number, dt: number): void {
    this.elapsed += dt;
    for (const p of world.players) {
      const view = this.views.get(p.id);
      if (!view) continue;
      const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
      const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
      view.update(dt, x, z, p);
    }

    const b = world.ball;
    const bx = b.prev.x + (b.pos.x - b.prev.x) * alpha;
    const by = b.prev.y + (b.pos.y - b.prev.y) * alpha;
    const bz = b.prev.z + (b.pos.z - b.prev.z) * alpha;

    const human = world.players.find((p) => p.isHuman);
    const hittable =
      world.phase === 'rally' && human !== undefined && world.ballInReach(human);
    this.ballView.setVisible(b.live || b.heldBy !== null);
    if (b.heldBy !== null) this.ballView.resetTrail();
    this.ballView.update(dt, bx, by, bz, hittable);

    const preview = world.servePreview();
    if (preview && preview.length > 1) {
      const n = Math.min(preview.length, 70);
      for (let i = 0; i < n; i++) {
        this.previewPts[i * 3] = preview[i].x;
        this.previewPts[i * 3 + 1] = preview[i].y;
        this.previewPts[i * 3 + 2] = preview[i].z;
      }
      const geo = this.previewLine.geometry as THREE.BufferGeometry;
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      geo.setDrawRange(0, n);
      this.previewLine.computeLineDistances();
      this.previewLine.visible = true;
      const last = preview[n - 1];
      this.effects.setLanding(last.x, last.z, true);
    } else {
      this.previewLine.visible = false;
      const landing = world.phase === 'rally' ? world.predictLanding() : null;
      if (landing) this.effects.setLanding(landing.x, landing.z, true);
      else this.effects.setLanding(0, 0, false);
    }

    // 冲刺脚边烟尘
    this.dustTimer -= dt;
    if (this.dustTimer <= 0) {
      this.dustTimer = 0.035;
      for (const p of world.players) {
        if (p.sprintTimer > 0 && p.grounded) {
          this.effects.puff(p.pos.x, p.pos.z, p.team === 0 ? '#8bffc4' : '#ffc0b0');
        }
      }
    }

    // 我方接球人头顶指示
    const rid = world.phase === 'rally' ? world.receiverOf(world.humanTeam) : null;
    const rp = rid !== null ? world.players.find((p) => p.id === rid) : null;
    if (rp) {
      this.receiverMark.visible = true;
      this.receiverMark.position.set(rp.pos.x, 3.1 + rp.pos.y, rp.pos.z);
      const s = 1 + Math.sin(this.elapsed * 9) * 0.12;
      this.receiverMark.scale.setScalar(s);
    } else {
      this.receiverMark.visible = false;
    }

    // 镜头跟随球做小幅平移，不做旋转
    const targetX = clamp(bx * 0.3, -2, 2);
    const targetZ = 15.8 + clamp(bz * 0.12, -1.2, 1.2);
    this.camPos.x = damp(this.camPos.x, targetX, 2.4, dt);
    this.camPos.z = damp(this.camPos.z, targetZ, 2.4, dt);
    this.camLook.x = damp(this.camLook.x, bx * 0.14, 2.4, dt);
    this.camLook.z = damp(this.camLook.z, bz * 0.1, 2.4, dt);

    this.shake = Math.max(0, this.shake - dt * 2.2);

    this.camera.position.copy(this.camPos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.camLook);

    this.effects.update(dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  onHit(e: GameEvents['hit']): void {
    const color = e.team === 0 ? '#8dffc0' : '#ffa6b8';
    this.shake = Math.min(0.5, this.shake + e.power / 220);
    this.effects.burst(e.x, e.y, e.z, color, e.kind === 'attack' ? 16 : 8, e.kind === 'attack' ? 6 : 3.4);
    this.effects.popNumber(e.x, e.y + 0.25, e.z, e.power, e.combo, e.perfect, e.kind);
  }

  onBlock(e: GameEvents['block']): void {
    this.shake = Math.min(0.4, this.shake + 0.16);
    this.effects.burst(e.x, e.y, e.z, '#ffffff', 14, 5);
  }

  onLand(e: GameEvents['land']): void {
    const color = e.winner === 0 ? '#5dffae' : '#ff7a9a';
    this.effects.ripple(e.x, e.z, color, 4.2, 0.75);
    this.effects.burst(e.x, 0.3, e.z, color, 26, 6.5);
    this.shake = Math.min(0.4, this.shake + 0.12);
  }

  celebratePlayer(id: number): void {
    this.views.get(id)?.celebrate();
  }
}
