import { GameAudio } from './audio/audio';
import { HumanInput } from './input/human-input';
import { SceneView } from './render/scene';
import { DEFAULT_TEAM_SIZE } from './sim/config';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import type { Skill } from './sim/ai';

const STEP = 1 / 60;

/** 游戏外壳：固定步长驱动模拟，渲染层插值，UI 只读 */
export class Game {
  private world: World;
  private scene: SceneView;
  private hud: Hud;
  private audio = new GameAudio();
  private input: HumanInput;

  private acc = 0;
  private last = 0;
  private skill: Skill = 'normal';
  private teamSize = DEFAULT_TEAM_SIZE;

  private startVisible = true;
  private resultVisible = false;
  private pauseVisible = false;

  constructor(canvas: HTMLCanvasElement, fxLayer: HTMLElement) {
    const size = Number(new URLSearchParams(window.location.search).get('size'));
    if (Number.isFinite(size) && size >= 1 && size <= 4) {
      this.teamSize = Math.round(size);
    }

    this.scene = new SceneView(canvas, fxLayer);
    this.input = new HumanInput(window);
    this.hud = new Hud({
      onStart: (s) => this.startMatch(s),
      onAgain: () => this.startMatch(this.skill),
      onHome: () => this.backHome(),
      onResume: () => this.setPaused(false),
      onQuit: () => this.backHome(),
    });

    this.world = this.createWorld(this.skill);
    this.hud.showStart(true);

    window.addEventListener('resize', () => this.scene.resize());
    this.input.onEscape = () => this.togglePause();
    this.input.onMute = () => {
      const muted = this.audio.toggleMute();
      this.hud.announce(muted ? '已静音' : '音效开启', '', 700);
    };

    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- 流程

  private startMatch(skill: Skill): void {
    this.skill = skill;
    this.audio.unlock();
    this.audio.startBgm();

    this.world = this.createWorld(skill);
    this.world.startMatch();

    this.startVisible = false;
    this.resultVisible = false;
    this.pauseVisible = false;
    this.hud.showStart(false);
    this.hud.hideResult();
    this.hud.showPause(false);
    this.input.reset();
    this.acc = 0;
  }

  private backHome(): void {
    this.startVisible = true;
    this.resultVisible = false;
    this.pauseVisible = false;
    this.hud.showStart(true);
    this.hud.hideResult();
    this.hud.showPause(false);
    this.world = this.createWorld(this.skill);
    this.input.reset();
    this.acc = 0;
  }

  private togglePause(): void {
    if (this.startVisible || this.resultVisible) return;
    this.setPaused(!this.pauseVisible);
  }

  private setPaused(v: boolean): void {
    this.pauseVisible = v;
    this.hud.showPause(v);
    this.input.reset();
  }

  // ---------------------------------------------------------------- 装配

  private createWorld(skill: Skill): World {
    const world = new World({ teamSize: this.teamSize, skill });
    world.inputProvider = () => this.input.read();
    this.scene.build(world);
    this.wire(world);
    return world;
  }

  private wire(world: World): void {
    world.events.on('hit', (e) => {
      this.scene.onHit(e);
      this.audio.hit(e.power, e.kind === 'attack');
    });
    world.events.on('block', (e) => {
      this.scene.onBlock(e);
      this.audio.block();
    });
    world.events.on('land', (e) => {
      this.scene.onLand(e);
      this.audio.land();
    });
    world.events.on('score', (e) => {
      this.audio.score();
      for (const p of world.players) {
        if (p.team === e.winner) this.scene.celebratePlayer(p.id);
      }
    });
    world.events.on('announce', (e) => this.hud.announce(e.text, e.sub, e.ms));
    world.events.on('tick', () => this.audio.tick());
    world.events.on('serve', () => this.audio.serve());
    world.events.on('net', () => this.audio.net());
    world.events.on('jump', () => this.audio.jump());
    world.events.on('dive', () => this.audio.dive());
    world.events.on('swing', () => this.audio.swing());
    world.events.on('setEnd', () => this.audio.fanfare());
    world.events.on('matchEnd', (e) => {
      this.resultVisible = true;
      this.hud.showResult(world, e.winner, e.mvp);
      this.audio.fanfare();
    });
  }

  // ---------------------------------------------------------------- 主循环

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const realDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;

    const running = !this.startVisible && !this.resultVisible && !this.pauseVisible;
    this.input.enabled = running;

    if (running) {
      const slow = this.world.slowmoTimer > 0;
      if (slow) this.world.slowmoTimer = Math.max(0, this.world.slowmoTimer - realDt);
      this.acc += realDt * (slow ? 0.42 : 1);

      let guard = 0;
      while (this.acc >= STEP && guard++ < 6) {
        this.world.step(STEP);
        this.acc -= STEP;
      }
      this.scene.sync(this.world, this.acc / STEP, realDt);
      this.audio.update(realDt);
    } else {
      this.acc = 0;
      this.scene.sync(this.world, 1, realDt);
    }

    this.scene.render();
    this.hud.update(this.world);
  };
}
