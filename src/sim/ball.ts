import { BALL, COURT } from './config';
import type { Vec3 } from '../core/math';
import type { BallEvent, BlockerBox, TeamId } from './types';

/** 抛物线求解：给定飞行时间反推初速度（用于扣球 / 平快球） */
export function solveVelocity(from: Vec3, to: Vec3, time: number, gravity = BALL.gravity): Vec3 {
  const t = Math.max(0.08, time);
  return {
    x: (to.x - from.x) / t,
    y: (to.y - from.y) / t + 0.5 * gravity * t,
    z: (to.z - from.z) / t,
  };
}

/** 抛物线求解：给定最高点，算出能落到目标点的初速度（用于垫球 / 二传 / 发球） */
export function lobVelocity(from: Vec3, to: Vec3, apex: number): Vec3 {
  const g = BALL.gravity;
  const top = Math.max(apex, from.y + 0.4, to.y + 0.4);
  const vy = Math.sqrt(2 * g * (top - from.y));
  const tUp = vy / g;
  const tDown = Math.sqrt(Math.max(0.0001, (2 * (top - to.y)) / g));
  const t = tUp + tDown;
  return {
    x: (to.x - from.x) / t,
    y: vy,
    z: (to.z - from.z) / t,
  };
}

/** 排球实体：自写弹道 + 简化网碰撞，不含任何刚体引擎 */
export class Ball {
  pos: Vec3 = { x: 0, y: 1, z: 0 };
  prev: Vec3 = { x: 0, y: 1, z: 0 };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  live = false;
  dead = false;
  heldBy: number | null = null;
  lastHitTeam: TeamId | null = null;
  lastHitterId: number | null = null;
  landX = 0;
  landZ = 0;

  reset(): void {
    this.pos = { x: 0, y: 1.4, z: 0 };
    this.prev = { ...this.pos };
    this.vel = { x: 0, y: 0, z: 0 };
    this.live = false;
    this.dead = false;
    this.heldBy = null;
    this.lastHitTeam = null;
    this.lastHitterId = null;
    this.landX = 0;
    this.landZ = 0;
  }

  step(dt: number, blockers: BlockerBox[], emit: (e: BallEvent) => void): void {
    if (!this.live || this.dead || this.heldBy !== null) return;

    this.prev = { ...this.pos };

    this.vel.y -= BALL.gravity * dt;
    const drag = Math.max(0, 1 - BALL.drag * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const prevZ = this.prev.z;
    const z = this.pos.z;
    const crossed = (prevZ > 0 && z <= 0) || (prevZ < 0 && z >= 0);
    if (crossed) {
      const t = prevZ / (prevZ - z);
      const cx = this.prev.x + (this.pos.x - this.prev.x) * t;
      const cy = this.prev.y + (this.pos.y - this.prev.y) * t;

      if (Math.abs(cx) <= COURT.netHalfWidth && cy <= COURT.netHeight + 0.05) {
        const blocker = blockers.find(
          (b) => Math.abs(cx - b.x) <= b.halfW && cy >= b.minY && cy <= b.maxY,
        );
        this.pos.z = prevZ;
        if (blocker) {
          this.vel.z = -this.vel.z * 0.55;
          this.vel.x *= 0.55;
          this.vel.y = Math.min(this.vel.y, -1.4);
          emit({ type: 'block', playerId: blocker.playerId, x: cx, y: cy, z: 0 });
        } else {
          this.vel.z *= -0.45;
          this.vel.y *= 0.5;
          emit({ type: 'net', x: cx, y: cy, z: 0 });
        }
      } else {
        emit({ type: 'cross', x: cx, y: cy, z: 0 });
      }
    }

    if (this.pos.y <= BALL.radius) {
      this.pos.y = BALL.radius;
      this.landX = this.pos.x;
      this.landZ = this.pos.z;
      this.dead = true;
      this.live = false;
      emit({ type: 'ground', x: this.pos.x, y: BALL.radius, z: this.pos.z });
    }
  }
}
