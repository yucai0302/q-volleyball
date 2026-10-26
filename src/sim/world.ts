import { Emitter } from '../core/emitter';
import { angleDamp, clamp, dist2D, rand } from '../core/math';
import type { Vec3 } from '../core/math';
import { BALL, COURT, MATCH, PLAYER } from './config';
import { Ball, lobVelocity, solveVelocity } from './ball';
import { AIBrain, SKILLS } from './ai';
import type { Skill } from './ai';
import { slotPosition } from './formation';
import { emptyInput } from './types';
import type {
  BallEvent,
  ControlInput,
  GameEvents,
  HitKind,
  Phase,
  Player,
  TeamId,
} from './types';

export interface WorldOptions {
  teamSize: number;
  skill: Skill;
  humanTeam?: TeamId;
  humanName?: string;
}

const HOME_AI_NAMES = ['阿洛', '小北', '豆豆', '球球'];
const AWAY_NAMES = ['米娅', '卡尔', '波波', '娜娜'];

/**
 * 权威模拟层：不依赖 Three.js / DOM，固定步长推进。
 * 后续联机时整个 World 可直接搬到服务端（输入来自网络而非本地控制器）。
 */
export class World {
  readonly events = new Emitter<GameEvents>();
  readonly players: Player[] = [];
  readonly ball = new Ball();
  readonly teamSize: number;
  readonly humanTeam: TeamId;

  phase: Phase = 'idle';
  phaseTimer = 0;
  scores: [number, number] = [0, 0];
  setsWon: [number, number] = [0, 0];
  setIndex = 0;
  clock: number = MATCH.setSeconds;
  timeUp = false;
  suddenDeath = false;
  touches: [number, number] = [0, 0];
  /** 每次进攻的分工：谁二传、谁扣球（一传时确定） */
  attackPlan: Array<{ setterId: number | null; attackerId: number | null }> = [
    { setterId: null, attackerId: null },
    { setterId: null, attackerId: null },
  ];
  servingTeam: TeamId = 0;
  serverId = 0;
  matchWinner: TeamId | null = null;
  /** 慢动作剩余时间（真实时间，由外层递减） */
  slowmoTimer = 0;
  time = 0;
  serveElapsed = 0;

  private readonly brains = new Map<number, AIBrain>();
  private lastHitterByTeam: [number | null, number | null] = [null, null];
  private lastHitAt = -10;
  private lastCount = -1;

  inputProvider: (() => ControlInput) | null = null;

  constructor(opts: WorldOptions) {
    this.teamSize = clamp(Math.round(opts.teamSize), 1, 4);
    this.humanTeam = opts.humanTeam ?? 0;
    this.createPlayers(opts.skill, opts.humanName ?? '你');
    this.resetPlayers();
  }

  // ---------------------------------------------------------------- 生命周期

  startMatch(): void {
    this.scores = [0, 0];
    this.setsWon = [0, 0];
    this.setIndex = 0;
    this.clock = MATCH.setSeconds;
    this.timeUp = false;
    this.suddenDeath = false;
    this.matchWinner = null;
    this.servingTeam = this.humanTeam;
    this.lastHitterByTeam = [null, null];
    this.slowmoTimer = 0;
    for (const p of this.players) {
      p.stats.points = 0;
      p.stats.hits = 0;
    }
    this.resetPlayers();
    this.ball.reset();
    this.setPhase('kickoff');
    this.phaseTimer = MATCH.kickoffSeconds;
    this.lastCount = -1;
    this.events.emit('announce', {
      text: '准备',
      sub: `${MATCH.pointsToWinSet} 分制 · 三局两胜`,
      ms: 900,
    });
  }

  step(dt: number): void {
    this.time += dt;

    const inputs = new Map<number, ControlInput>();
    for (const p of this.players) {
      if (p.isHuman) {
        inputs.set(p.id, this.inputProvider ? this.inputProvider() : emptyInput());
      } else {
        const brain = this.brains.get(p.id);
        inputs.set(p.id, brain ? brain.think(this, p, dt) : emptyInput());
      }
    }

    for (const p of this.players) this.stepPlayer(p, inputs.get(p.id)!, dt);
    this.stepBall(dt);
    this.stepPhase(dt);
  }

  // ---------------------------------------------------------------- 查询接口

  predictLanding(): { x: number; z: number; t: number } | null {
    const b = this.ball;
    if (!b.live || b.dead || b.heldBy !== null) return null;
    let px = b.pos.x;
    let py = b.pos.y;
    let pz = b.pos.z;
    let vx = b.vel.x;
    let vy = b.vel.y;
    let vz = b.vel.z;
    const h = 1 / 30;
    for (let t = 0; t < 3.6; t += h) {
      vy -= BALL.gravity * h;
      px += vx * h;
      py += vy * h;
      pz += vz * h;
      if (py <= BALL.radius) return { x: px, z: pz, t };
    }
    return null;
  }

  /** 进攻区：二传把球送到这里，扣球的人从这里起跳 */
  attackZone(team: TeamId): { x: number; z: number } {
    const plan = this.attackPlan[team];
    const setter =
      plan.setterId !== null ? this.players.find((p) => p.id === plan.setterId) : undefined;
    const sign = team === 0 ? 1 : -1;
    return {
      x: clamp((setter ? setter.pos.x : 0) * 0.8, -2.6, 2.6),
      z: sign * 1.75,
    };
  }

  /** 当前这一球该由谁接（用于头顶指示） */
  receiverOf(team: TeamId): number | null {
    const landing = this.predictLanding();
    if (!landing || !this.ball.live) return null;
    const sign = team === 0 ? 1 : -1;
    if (Math.sign(landing.z) !== sign) return null;
    let bestId: number | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.team !== team) continue;
      let d = dist2D(p.pos.x, p.pos.z, landing.x, landing.z);
      if (p.isHuman && !p.moving) d += 2.2;
      if (d < bestD) {
        bestD = d;
        bestId = p.id;
      }
    }
    return bestId;
  }

  ballInReach(p: Player): boolean {
    const b = this.ball;
    if (!b.live || b.dead || b.heldBy !== null) return false;
    if (this.touches[p.team] >= 3) return false;
    const ownSide = p.team === 0 ? b.pos.z > -0.4 : b.pos.z < 0.4;
    if (!ownSide) return false;
    const chestY = p.pos.y + PLAYER.chestHeight;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.y - chestY, b.pos.z - p.pos.z);
    return d <= PLAYER.reach + BALL.radius;
  }

  mvpName(): string {
    const winner = this.matchWinner;
    const pool = winner === null ? this.players : this.players.filter((p) => p.team === winner);
    let best = pool[0];
    for (const p of pool) if (p.stats.points > best.stats.points) best = p;
    return best ? best.name : '';
  }

  // ---------------------------------------------------------------- 构建

  private createPlayers(skill: Skill, humanName: string): void {
    const n = this.teamSize;
    for (let i = 0; i < n; i++) {
      const human = i === 0 && this.humanTeam === 0;
      this.players.push(
        this.makePlayer({
          id: i,
          team: 0,
          slot: i === 0 ? n - 1 : i - 1,
          human,
          name: i === 0 ? humanName : HOME_AI_NAMES[(i - 1) % HOME_AI_NAMES.length],
          skill,
        }),
      );
    }
    for (let j = 0; j < n; j++) {
      this.players.push(
        this.makePlayer({
          id: n + j,
          team: 1,
          slot: j,
          human: false,
          name: AWAY_NAMES[j % AWAY_NAMES.length],
          skill,
        }),
      );
    }
  }

  private makePlayer(o: {
    id: number;
    team: TeamId;
    slot: number;
    human: boolean;
    name: string;
    skill: Skill;
  }): Player {
    if (!o.human) this.brains.set(o.id, new AIBrain(o.skill));
    return {
      id: o.id,
      name: o.name,
      team: o.team,
      isHuman: o.human,
      slot: o.slot,
      speedScale: o.human ? 1 : SKILLS[o.skill].moveScale,
      pos: { x: 0, y: 0, z: 0 },
      prev: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      facing: o.team === 0 ? Math.PI : 0,
      grounded: true,
      moving: false,
      blocking: false,
      sprintTimer: 0,
      sprintCd: 0,
      sprintDir: { x: 0, z: 0 },
      hitCd: 0,
      blockCd: 0,
      hitBuffer: 0,
      stun: 0,
      charge: 0,
      serveAim: 0,
      anim: 'idle',
      animTimer: 0,
      stats: { points: 0, hits: 0 },
    };
  }

  private resetPlayers(): void {
    for (const p of this.players) {
      const s = slotPosition(p.team, this.teamSize, p.slot);
      p.pos = { x: s.x, y: 0, z: s.z };
      p.prev = { ...p.pos };
      p.vel = { x: 0, y: 0, z: 0 };
      p.grounded = true;
      p.moving = false;
      p.blocking = false;
      p.sprintTimer = 0;
      p.sprintCd = 0;
      p.stun = 0;
      p.hitBuffer = 0;
      p.charge = 0;
      p.anim = 'idle';
      p.animTimer = 0;
      p.facing = p.team === 0 ? Math.PI : 0;
    }
  }

  // ---------------------------------------------------------------- 球员

  private stepPlayer(p: Player, inp: ControlInput, dt: number): void {
    p.prev.x = p.pos.x;
    p.prev.y = p.pos.y;
    p.prev.z = p.pos.z;

    p.sprintCd = Math.max(0, p.sprintCd - dt);
    p.hitCd = Math.max(0, p.hitCd - dt);
    p.blockCd = Math.max(0, p.blockCd - dt);
    p.animTimer = Math.max(0, p.animTimer - dt);

    if (p.stun > 0) {
      p.stun = Math.max(0, p.stun - dt);
      if (p.anim !== 'dive') p.anim = 'stun';
      p.vel.x *= 0.9;
      p.vel.z *= 0.9;
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      this.clampToCourt(p);
      this.stepVertical(p, dt);
      p.blocking = false;
      p.moving = false;
      return;
    }

    const active = this.phase === 'serve' || this.phase === 'rally';
    const locked = this.phase === 'serve' && p.id === this.serverId;

    if (active && !locked) {
      if (inp.sprint && p.grounded && p.sprintCd <= 0) {
        const len = Math.hypot(inp.moveX, inp.moveZ);
        if (len > 0.05) {
          p.sprintTimer = PLAYER.sprintDuration;
          p.sprintCd = PLAYER.sprintCooldown;
          p.sprintDir = { x: inp.moveX / len, z: inp.moveZ / len };
        }
      }

      let vx = 0;
      let vz = 0;
      if (p.sprintTimer > 0) {
        p.sprintTimer = Math.max(0, p.sprintTimer - dt);
        vx = p.sprintDir.x * PLAYER.sprintSpeed;
        vz = p.sprintDir.z * PLAYER.sprintSpeed;
      } else {
        const len = Math.hypot(inp.moveX, inp.moveZ);
        if (len > 0.05) {
          const sp = PLAYER.moveSpeed * p.speedScale * (p.grounded ? 1 : 0.55);
          vx = (inp.moveX / len) * sp;
          vz = (inp.moveZ / len) * sp;
        }
      }

      if (vx !== 0 || vz !== 0) {
        p.pos.x += vx * dt;
        p.pos.z += vz * dt;
        p.vel.x = vx;
        p.vel.z = vz;
        p.moving = true;
        p.facing = angleDamp(p.facing, Math.atan2(vx, vz), 16, dt);
      } else {
        p.moving = false;
        p.vel.x = 0;
        p.vel.z = 0;
      }

      if (inp.jump && p.grounded) {
        p.vel.y = PLAYER.jumpVelocity;
        p.grounded = false;
        this.events.emit('jump', { playerId: p.id });
      }
    } else {
      p.moving = false;
      p.vel.x = 0;
      p.vel.z = 0;
    }

    if (locked) {
      const face = p.team === 0 ? Math.PI : 0;
      p.facing = angleDamp(p.facing, face, 10, dt);
    }

    this.clampToCourt(p);
    this.stepVertical(p, dt);

    // 网前按 K 自动起跳，起跳后保持张臂拦网
    if (
      this.phase === 'rally' &&
      inp.block &&
      p.grounded &&
      p.stun <= 0 &&
      Math.abs(p.pos.z) < 1.8
    ) {
      p.vel.y = PLAYER.jumpVelocity;
      p.grounded = false;
      p.blockCd = 0.7;
      this.events.emit('jump', { playerId: p.id });
    }
    if (inp.block && Math.abs(p.pos.z) < 1.8) p.blockCd = Math.max(p.blockCd, 0.7);
    p.blocking =
      this.phase === 'rally' &&
      (inp.blockHeld || p.blockCd > 0) &&
      !p.grounded &&
      Math.abs(p.pos.z) < 1.8;

    if (this.phase === 'rally') {
      // 击球输入缓冲：按下后 0.35s 内进入判定范围都能打中，按住 J 也会持续尝试
      if (inp.hit) p.hitBuffer = 0.35;
      p.hitBuffer = Math.max(0, p.hitBuffer - dt);
      if (p.hitBuffer > 0 || inp.hitHeld) {
        const connected = this.tryHit(p, inp);
        if (connected) {
          p.hitBuffer = 0;
        } else if (inp.hit) {
          // 空挥也给动作反馈，避免"按了没反应"的错觉
          p.anim = 'hit';
          p.animTimer = 0.22;
          this.events.emit('swing', { playerId: p.id });
        }
      }
    }

    if (this.phase === 'serve' && p.id === this.serverId) {
      // 轻点也能发球：按下即给一个最小蓄力
      if (inp.hit && p.charge <= 0) p.charge = 0.06;
      if (inp.hitHeld) {
        p.charge = Math.min(1, p.charge + dt / PLAYER.serveMaxCharge);
        if (p.isHuman) p.serveAim = clamp(p.pos.x * 0.25 + inp.moveX * 1.8, -3.2, 3.2);
      } else if (p.charge > 0) {
        this.doServe(p, p.charge);
      }
      p.facing = angleDamp(p.facing, p.team === 0 ? Math.PI : 0, 10, dt);
    }

    if (p.animTimer > 0 && (p.anim === 'hit' || p.anim === 'dive' || p.anim === 'cheer')) return;
    if (!p.grounded) p.anim = 'jump';
    else if (p.moving) p.anim = 'run';
    else p.anim = 'idle';
  }

  private stepVertical(p: Player, dt: number): void {
    p.pos.y += p.vel.y * dt;
    p.vel.y -= PLAYER.gravity * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      if (p.vel.y < 0) p.vel.y = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }
  }

  private clampToCourt(p: Player): void {
    p.pos.x = clamp(p.pos.x, -COURT.halfWidth - 0.45, COURT.halfWidth + 0.45);
    if (p.team === 0) p.pos.z = clamp(p.pos.z, 0.5, COURT.halfLength + 0.6);
    else p.pos.z = clamp(p.pos.z, -COURT.halfLength - 0.6, -0.5);
  }

  private handPos(p: Player): { x: number; y: number; z: number } {
    const sign = p.team === 0 ? -1 : 1;
    return { x: p.pos.x + 0.32, y: p.pos.y + 1.35, z: p.pos.z + sign * 0.25 };
  }

  // ---------------------------------------------------------------- 击球

  private tryHit(p: Player, inp: ControlInput): boolean {
    if (!this.ballInReach(p)) return false;
    if (p.hitCd > 0) return false;
    if (this.time - this.lastHitAt < PLAYER.hitGap) return false;

    const b = this.ball;
    const sign = p.team === 0 ? -1 : 1;
    const chestY = p.pos.y + PLAYER.chestHeight;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.y - chestY, b.pos.z - p.pos.z);

    const airborne = !p.grounded;
    const ballAbove = b.pos.y > p.pos.y + 1.5;
    const t = this.touches[p.team];
    let kind: HitKind = 'pass';
    if (airborne && ballAbove) kind = 'attack';
    else if (t === 2) kind = 'send';
    else if (t === 1) kind = 'set';

    const mate = this.players.find((q) => q.team === p.team && q.id !== p.id);
    const from = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    const targetY = BALL.radius;

    if (kind === 'attack') {
      const opps = this.players.filter((q) => q.team !== p.team);
      let avgX = 0;
      for (const q of opps) avgX += q.pos.x;
      avgX = opps.length ? avgX / opps.length : 0;
      const autoAim = -Math.sign(avgX || (Math.random() - 0.5)) * rand(2.3, 3.6);
      const aim =
        inp.aimX ?? (inp.moveX !== 0 ? clamp(p.pos.x + inp.moveX * 3, -3.6, 3.6) : autoAim);
      const target = {
        x: clamp(aim, -3.7, 3.7),
        y: targetY,
        z: sign * (3.6 + rand(0, 2.8)),
      };
      const dist = Math.hypot(target.x - from.x, target.z - from.z);
      const T = clamp(dist / 18, 0.38, 0.65);
      b.vel = solveVelocity(from, target, T);
    } else if (kind === 'set') {
      // 二传：把球送到进攻区，让一传的人上来扣
      const zone = this.attackZone(p.team);
      b.vel = lobVelocity(from, { x: zone.x, y: targetY, z: zone.z }, 5.8);
    } else if (kind === 'send') {
      const aim = inp.aimX ?? clamp(p.pos.x + inp.moveX * 2.6, -3.5, 3.5);
      b.vel = lobVelocity(from, { x: aim, y: targetY, z: sign * (4.4 + rand(0, 2.4)) }, 5.2);
    } else if (mate) {
      // 一传：垫给队友（二传手），但落点不退出进攻区，保证还能组织进攻
      const tz = -sign * clamp(Math.abs(mate.pos.z) * 0.9, 1.2, 4.2);
      b.vel = lobVelocity(
        from,
        { x: clamp(mate.pos.x * 0.85, -3, 3), y: targetY, z: tz },
        5.4,
      );
    } else {
      b.vel = lobVelocity(from, { x: p.pos.x * 0.5, y: targetY, z: p.pos.z * 0.7 }, 5.4);
    }

    const q = clamp(1 - Math.abs(d - 0.55) / 1.05, 0.1, 1);
    let power = Math.round(10 + 40 * q);
    if (kind === 'attack') power *= 2;
    const samePlayer = t > 0 && this.lastHitterByTeam[p.team] === p.id;
    if (samePlayer) power = Math.round(power * 0.5);

    // 一传的一瞬间确定这次进攻的分工：垫球的人负责最后扣杀，离网最近的队友负责二传
    if (t === 0) {
      let setter: Player | null = null;
      for (const m of this.players) {
        if (m.team !== p.team || m.id === p.id) continue;
        if (!setter || Math.abs(m.pos.z) < Math.abs(setter.pos.z)) setter = m;
      }
      this.attackPlan[p.team] = {
        setterId: setter ? setter.id : p.id,
        attackerId: p.id,
      };
    }

    this.touches[p.team] = t + 1;
    this.lastHitAt = this.time;
    this.lastHitterByTeam[p.team] = p.id;
    b.lastHitTeam = p.team;
    b.lastHitterId = p.id;
    p.hitCd = PLAYER.hitCooldown;
    p.stats.hits++;
    p.anim = 'hit';
    p.animTimer = 0.26;

    if (p.sprintTimer > 0.06 && p.grounded) {
      p.stun = PLAYER.diveStun;
      p.anim = 'dive';
      p.animTimer = PLAYER.diveStun;
      p.vel.x = p.sprintDir.x * 6;
      p.vel.z = p.sprintDir.z * 6;
      p.sprintTimer = 0;
      this.events.emit('dive', { playerId: p.id });
    }

    this.events.emit('hit', {
      playerId: p.id,
      team: p.team,
      power,
      combo: this.touches[p.team],
      kind,
      perfect: q > 0.78,
      x: b.pos.x,
      y: b.pos.y,
      z: b.pos.z,
    });
    return true;
  }

  /** 发球轨迹（蓄力预览与实际发球共用，保证所见即所得） */
  private serveTrajectory(p: Player, power: number): { start: Vec3; vel: Vec3 } {
    const sign = p.team === 0 ? -1 : 1;
    const start = this.handPos(p);
    const apex = 6.4 - 2.3 * power;
    const vel = lobVelocity(start, { x: p.serveAim, y: BALL.radius, z: sign * (4.6 + 3 * power) }, apex);
    return { start, vel };
  }

  /** 蓄力时的虚线弹道预览 */
  servePreview(): Vec3[] | null {
    if (this.phase !== 'serve') return null;
    const server = this.players.find((p) => p.id === this.serverId);
    if (!server || server.charge <= 0.03) return null;
    const { start, vel } = this.serveTrajectory(server, clamp(server.charge, 0.15, 1));
    const pts: Vec3[] = [];
    let { x, y, z } = start;
    let vx = vel.x;
    let vy = vel.y;
    let vz = vel.z;
    const h = 0.04;
    for (let i = 0; i < 70; i++) {
      pts.push({ x, y, z });
      vy -= BALL.gravity * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (y <= BALL.radius) break;
    }
    return pts;
  }

  private doServe(p: Player, charge: number): void {
    const power = clamp(charge, 0.15, 1);
    const b = this.ball;
    const { start, vel } = this.serveTrajectory(p, power);
    b.pos = { ...start };
    b.prev = { ...start };
    b.vel = vel;
    b.live = true;
    b.dead = false;
    b.heldBy = null;
    b.lastHitTeam = p.team;
    b.lastHitterId = p.id;
    this.lastHitterByTeam[p.team] = p.id;
    this.touches = [0, 0];
    p.charge = 0;
    p.hitCd = 0.5;
    p.hitBuffer = 0;
    p.anim = 'hit';
    p.animTimer = 0.26;

    this.setPhase('rally');
    this.events.emit('serve', { playerId: p.id, power });
  }

  // ---------------------------------------------------------------- 球

  private stepBall(dt: number): void {
    const b = this.ball;
    if (b.heldBy !== null) {
      const p = this.players.find((q) => q.id === b.heldBy);
      if (p) {
        const hp = this.handPos(p);
        b.pos = hp;
        b.prev = { ...hp };
      }
      return;
    }
    const blockers = this.players
      .filter((p) => p.blocking)
      .map((p) => ({
        playerId: p.id,
        x: p.pos.x,
        halfW: 0.9,
        minY: 1.0 + p.pos.y * 0.5,
        maxY: 3.0 + p.pos.y * 0.5,
      }));
    b.step(dt, blockers, (e) => this.onBallEvent(e));
  }

  private onBallEvent(e: BallEvent): void {
    switch (e.type) {
      case 'net':
        this.events.emit('net', { x: e.x, y: e.y, z: e.z });
        break;
      case 'block':
        this.events.emit('block', { playerId: e.playerId, x: e.x, y: e.y, z: e.z });
        break;
      case 'cross':
        this.touches = [0, 0];
        this.attackPlan = [
          { setterId: null, attackerId: null },
          { setterId: null, attackerId: null },
        ];
        break;
      case 'ground':
        this.onGround(e.x, e.z);
        break;
    }
  }

  private onGround(x: number, z: number): void {
    const inBounds = Math.abs(x) <= COURT.halfWidth && Math.abs(z) <= COURT.halfLength;
    const landSide: TeamId = z >= 0 ? 0 : 1;
    const lastTeam = this.ball.lastHitTeam ?? this.servingTeam;
    let winner: TeamId;
    if (!inBounds) winner = (1 - lastTeam) as TeamId;
    else if (landSide !== lastTeam) winner = lastTeam;
    else winner = (1 - lastTeam) as TeamId;

    this.events.emit('land', { x, z, winner, inBounds });
    this.awardPoint(winner);
  }

  // ---------------------------------------------------------------- 阶段

  private stepPhase(dt: number): void {
    switch (this.phase) {
      case 'kickoff': {
        this.phaseTimer -= dt;
        const n = Math.ceil(this.phaseTimer);
        if (n !== this.lastCount && n > 0 && n <= 3) {
          this.lastCount = n;
          this.events.emit('announce', { text: String(n), ms: 620 });
          this.events.emit('tick', { n });
        }
        if (this.phaseTimer <= 0) this.beginServe();
        break;
      }
      case 'serve': {
        this.serveElapsed += dt;
        if (this.serveElapsed > 9) {
          const server = this.players.find((p) => p.id === this.serverId);
          if (server) this.doServe(server, 0.5);
        }
        break;
      }
      case 'rally': {
        if (this.clock > 0) {
          this.clock = Math.max(0, this.clock - dt);
          if (this.clock <= 0 && !this.timeUp) {
            this.timeUp = true;
            this.events.emit('announce', {
              text: '时间到',
              sub: '本回合结束后结算',
              ms: 1400,
            });
          }
        }
        break;
      }
      case 'point': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.afterPoint();
        break;
      }
      case 'setend': {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.afterSetEnd();
        break;
      }
      default:
        break;
    }
  }

  private beginServe(): void {
    this.setupServe();
    this.serveElapsed = 0;
    this.setPhase('serve');
    const mine = this.servingTeam === this.humanTeam;
    this.events.emit('announce', {
      text: mine ? '我方发球' : '对方发球',
      sub: mine ? '按住 J 蓄力，松开发球' : '',
      ms: 1300,
    });
  }

  private setupServe(): void {
    this.resetPlayers();
    const server = this.players.find(
      (p) => p.team === this.servingTeam && p.slot === this.teamSize - 1,
    );
    if (server) {
      this.serverId = server.id;
      const sign = server.team === 0 ? 1 : -1;
      server.pos.x = clamp(server.pos.x * 0.55, -2, 2);
      server.pos.z = sign * (COURT.halfLength + 0.55);
      server.prev = { ...server.pos };
      server.facing = server.team === 0 ? Math.PI : 0;
      server.charge = 0;
      server.serveAim = server.isHuman
        ? clamp(server.pos.x * 0.25, -3.2, 3.2)
        : rand(-2.4, 2.4);
    }
    this.ball.reset();
    const s = this.players.find((p) => p.id === this.serverId);
    if (s) {
      this.ball.heldBy = s.id;
      this.ball.pos = this.handPos(s);
      this.ball.prev = { ...this.ball.pos };
    }
    this.touches = [0, 0];
    this.attackPlan = [
      { setterId: null, attackerId: null },
      { setterId: null, attackerId: null },
    ];
  }

  private awardPoint(winner: TeamId): void {
    this.scores[winner]++;
    const scorerId = this.lastHitterByTeam[winner];
    if (scorerId !== null) {
      const sp = this.players.find((p) => p.id === scorerId);
      if (sp) sp.stats.points++;
    }
    this.servingTeam = winner;
    this.slowmoTimer = 0.9;
    this.touches = [0, 0];
    this.attackPlan = [
      { setterId: null, attackerId: null },
      { setterId: null, attackerId: null },
    ];
    this.setPhase('point');
    this.phaseTimer = MATCH.pointSeconds;
    this.events.emit('score', {
      winner,
      scores: [this.scores[0], this.scores[1]],
      setsWon: [this.setsWon[0], this.setsWon[1]],
    });
    this.events.emit('announce', {
      text: winner === this.humanTeam ? '我方得分' : '对方得分',
      ms: 900,
    });
  }

  private afterPoint(): void {
    const [a, b] = this.scores;
    const target = MATCH.pointsToWinSet;
    let setWinner: TeamId | null = null;

    if (this.suddenDeath) {
      setWinner = a > b ? 0 : 1;
    } else if (a >= target) {
      setWinner = 0;
    } else if (b >= target) {
      setWinner = 1;
    } else if (this.timeUp) {
      if (a !== b) {
        setWinner = a > b ? 0 : 1;
      } else {
        this.suddenDeath = true;
        this.events.emit('announce', { text: 'DEUCE', sub: '下一分决定本局', ms: 1700 });
        this.beginServe();
        return;
      }
    }

    if (setWinner === null) {
      this.beginServe();
      return;
    }
    this.endSet(setWinner);
  }

  private endSet(winner: TeamId): void {
    this.setsWon[winner]++;
    this.setPhase('setend');
    this.phaseTimer = MATCH.setEndSeconds;
    this.events.emit('setEnd', {
      winner,
      setsWon: [this.setsWon[0], this.setsWon[1]],
    });
    this.events.emit('announce', {
      text: `SET ${this.setIndex + 1}`,
      sub: winner === this.humanTeam ? '你的队伍拿下本局' : '对手拿下本局',
      ms: 2200,
    });
  }

  private afterSetEnd(): void {
    const win = this.setsWon[0] >= MATCH.setsToWin ? 0 : 1;
    if (this.setsWon[0] >= MATCH.setsToWin || this.setsWon[1] >= MATCH.setsToWin) {
      this.matchWinner = win as TeamId;
      this.setPhase('matchend');
      this.events.emit('matchEnd', { winner: this.matchWinner, mvp: this.mvpName() });
      return;
    }

    const prevWinner = this.setsWon[0] > this.setsWon[1] ? 0 : 1;
    this.setIndex++;
    this.scores = [0, 0];
    this.clock = MATCH.setSeconds;
    this.timeUp = false;
    this.suddenDeath = false;
    this.servingTeam = prevWinner as TeamId;
    this.lastHitterByTeam = [null, null];
    this.resetPlayers();
    this.ball.reset();
    this.setPhase('kickoff');
    this.phaseTimer = MATCH.kickoffSeconds;
    this.lastCount = -1;
    this.events.emit('announce', {
      text: `SET ${this.setIndex + 1}`,
      sub: this.servingTeam === this.humanTeam ? '我方发球' : '对方发球',
      ms: 1200,
    });
  }

  private setPhase(p: Phase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.events.emit('phase', { phase: p });
  }
}
