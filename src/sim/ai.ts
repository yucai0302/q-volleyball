import { clamp, dist2D, rand } from '../core/math';
import { COURT } from './config';
import { slotPosition } from './formation';
import { emptyInput } from './types';
import type { ControlInput, Phase, Player } from './types';
import type { World } from './world';

export type Skill = 'easy' | 'normal' | 'hard';

interface SkillCfg {
  label: string;
  moveScale: number;
  reaction: number;
  aimError: number;
  canSpike: boolean;
}

export const SKILLS: Record<Skill, SkillCfg> = {
  easy: { label: '简单', moveScale: 0.72, reaction: 0.42, aimError: 0.85, canSpike: false },
  normal: { label: '普通', moveScale: 0.95, reaction: 0.22, aimError: 0.45, canSpike: true },
  hard: { label: '困难', moveScale: 1.06, reaction: 0.1, aimError: 0.18, canSpike: true },
};

/** 人机大脑：每 tick 产出一份与真人完全一致的 ControlInput */
export class AIBrain {
  private cfg: SkillCfg;
  private phase: Phase = 'idle';
  private thinkTimer = 0;
  private target: { x: number; z: number } | null = null;
  private servePower = 0.6;

  constructor(skill: Skill) {
    this.cfg = SKILLS[skill];
    this.thinkTimer = rand(0, 0.1);
  }

  get moveScale(): number {
    return this.cfg.moveScale;
  }

  think(world: World, p: Player, dt: number): ControlInput {
    const inp = emptyInput();
    const phase = world.phase;

    if (phase !== this.phase) {
      if (phase === 'serve') {
        this.servePower = rand(0.5, 0.95);
        this.thinkTimer = 0;
        this.target = null;
      }
      this.phase = phase;
    }

    if (phase === 'idle' || phase === 'point' || phase === 'setend' || phase === 'matchend') {
      return inp;
    }

    if (phase === 'serve') {
      if (p.id === world.serverId) {
        inp.hitHeld = p.charge < this.servePower;
      } else {
        const s = slotPosition(p.team, world.teamSize, p.slot);
        this.moveTo(p, inp, s.x, s.z);
      }
      return inp;
    }

    // ---- 对打阶段 ----
    const ball = world.ball;
    const landing = world.predictLanding();

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0 || !this.target) {
      this.thinkTimer = this.cfg.reaction;
      this.updateTarget(world, p, landing);
    }
    if (this.target) this.moveTo(p, inp, this.target.x, this.target.z);

    const canHit = world.ballInReach(p);
    const myTouches = world.touches[p.team];
    const closest = this.isClosest(world, p, landing);
    const hd = dist2D(ball.pos.x, ball.pos.z, p.pos.x, p.pos.z);
    const plan = world.attackPlan[p.team];
    const isSetter = plan.setterId === p.id;
    const isAttacker = plan.attackerId === null || plan.attackerId === p.id;

    if (myTouches >= 2) {
      // 第三拍：只由指定扣球手进攻，二传不抢球
      if (isAttacker) {
        if (p.grounded && this.cfg.canSpike && hd < 1.9 && ball.pos.y > 2.5 && ball.pos.y < 4.7) {
          inp.jump = true;
        }
        if (canHit && (closest || hd < 1.0)) {
          inp.hit = true;
          let avgX = 0;
          const opps = world.players.filter((q) => q.team !== p.team);
          for (const q of opps) avgX += q.pos.x;
          avgX = opps.length ? avgX / opps.length : 0;
          inp.aimX = clamp(-Math.sign(avgX || 1) * rand(2.2, 3.4), -3.5, 3.5);
        }
      } else if (canHit && ball.pos.y < 1.4 && hd < 1.0) {
        // 扣球手没跟上，二传兜底把球处理过网
        inp.hit = true;
      }
    } else if (myTouches === 1) {
      // 第二拍默认由二传处理，扣球手不要抢；二传赶不上时才由最近的人救
      const setter = plan.setterId !== null ? world.players.find((q) => q.id === plan.setterId) : null;
      // 二传就在球边（或真人在主动跑位）时不抢；真人站着不动就让 AI 兜底，避免球直接落地
      const setterNear = setter
        ? dist2D(setter.pos.x, setter.pos.z, ball.pos.x, ball.pos.z) < 1.9 &&
          !(setter.isHuman && !setter.moving)
        : false;
      const canTake = !isAttacker || !setterNear;
      if (canHit && canTake && (isSetter || closest || hd < 0.9)) inp.hit = true;
    } else if (canHit && (closest || hd < 0.8)) {
      inp.hit = true;
    }

    return inp;
  }

  private updateTarget(
    world: World,
    p: Player,
    landing: { x: number; z: number; t: number } | null,
  ): void {
    const mySign = p.team === 0 ? 1 : -1;
    const slot = slotPosition(p.team, world.teamSize, p.slot);
    const ball = world.ball;
    const touches = world.touches[p.team];
    const plan = world.attackPlan[p.team];
    const err = this.cfg.aimError;

    const incoming = landing !== null && Math.sign(landing.z) === mySign && ball.live;

    // 救球：球快落地且最近的队友还够不到，全员去追
    if (incoming && landing!.t < 1.8) {
      let nearest = Infinity;
      for (const q of world.players) {
        if (q.team !== p.team) continue;
        let d = dist2D(q.pos.x, q.pos.z, landing!.x, landing!.z);
        if (q.isHuman && !q.moving) d += 1.2;
        nearest = Math.min(nearest, d);
      }
      if (nearest > 1.5) {
        this.target = { x: landing!.x, z: landing!.z };
        return;
      }
    }

    if (!incoming) {
      let tx = slot.x;
      let tz = slot.z;
      const oppTouches = world.touches[p.team === 0 ? 1 : 0];
      if (ball.live && Math.sign(ball.pos.z) !== mySign && oppTouches >= 2) {
        // 对手准备第三次触球：退到中场防守，盯住球的方向
        tx = clamp(ball.pos.x * 0.45 + slot.x * 0.3, -3, 3);
        tz = mySign * 4.1;
      }
      this.target = { x: tx, z: tz };
      return;
    }

    const landingTarget = {
      x: clamp(landing!.x + rand(-err, err), -COURT.halfWidth + 0.3, COURT.halfWidth - 0.3),
      z: clamp(landing!.z + rand(-err, err), mySign > 0 ? 0.6 : -8.4, mySign > 0 ? 8.4 : -0.6),
    };

    if (touches === 0) {
      // 第一拍：最近的人接一传，另一人提前到网前准备二传
      if (this.isClosest(world, p, landing)) {
        this.target = landingTarget;
      } else {
        this.target = {
          x: clamp(slot.x * 0.75 + landing!.x * 0.2, -3, 3),
          z: mySign * 2.4,
        };
      }
      return;
    }

    if (touches === 1) {
      // 第二拍：二传去接球；扣球手提前跑到网前进攻区
      if (plan.setterId === null || plan.setterId === p.id) {
        this.target = landingTarget;
      } else if (plan.attackerId === p.id) {
        const zone = world.attackZone(p.team);
        this.target = { x: zone.x, z: zone.z };
      } else {
        this.target = { x: slot.x, z: slot.z };
      }
      return;
    }

    // 第三拍：扣球手追球起跳，其余人回位防守
    if (plan.attackerId === null || plan.attackerId === p.id) {
      this.target = landingTarget;
    } else {
      this.target = { x: slot.x, z: mySign * Math.max(4, Math.abs(slot.z)) };
    }
  }

  private isClosest(world: World, p: Player, landing: { x: number; z: number } | null): boolean {
    if (!landing) return false;
    const d = dist2D(p.pos.x, p.pos.z, landing.x, landing.z);
    for (const q of world.players) {
      if (q.team !== p.team || q.id === p.id) continue;
      let dq = dist2D(q.pos.x, q.pos.z, landing.x, landing.z);
      // 真人站着不动时，人机接管这一球，避免队友白给
      if (q.isHuman && !q.moving) dq += 2.2;
      if (dq < d - 0.35) return false;
    }
    return true;
  }

  private moveTo(p: Player, inp: ControlInput, x: number, z: number): void {
    const dx = x - p.pos.x;
    const dz = z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.24) return;
    inp.moveX = dx / d;
    inp.moveZ = dz / d;
    if (d > 2.6 && p.sprintCd <= 0 && p.grounded) inp.sprint = true;
  }
}
