import type { Vec3 } from '../core/math';

export type TeamId = 0 | 1;

/** 0 = 近侧（+Z，玩家方），1 = 远侧（-Z） */
export const HOME: TeamId = 0;
export const AWAY: TeamId = 1;

export type HitKind = 'pass' | 'set' | 'send' | 'attack';

export type AnimState = 'idle' | 'run' | 'jump' | 'hit' | 'dive' | 'stun' | 'cheer';

export type Phase = 'idle' | 'kickoff' | 'serve' | 'rally' | 'point' | 'setend' | 'matchend';

export interface ControlInput {
  /** -1 = 左, +1 = 右（世界 x） */
  moveX: number;
  /** -1 = 远离镜头（朝网，对主队而言）, +1 = 朝镜头 */
  moveZ: number;
  sprint: boolean;
  jump: boolean;
  hit: boolean;
  hitHeld: boolean;
  block: boolean;
  blockHeld: boolean;
  /** 扣球落点（世界 x），仅人机使用；真人由移动方向决定 */
  aimX?: number;
}

export function emptyInput(): ControlInput {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jump: false,
    hit: false,
    hitHeld: false,
    block: false,
    blockHeld: false,
  };
}

export interface Player {
  id: number;
  name: string;
  team: TeamId;
  isHuman: boolean;
  slot: number;
  /** 移动速度倍率（人机难度） */
  speedScale: number;
  /** y 为离地高度（跳跃时 > 0） */
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  facing: number;
  grounded: boolean;
  moving: boolean;
  blocking: boolean;
  sprintTimer: number;
  sprintCd: number;
  sprintDir: { x: number; z: number };
  hitCd: number;
  blockCd: number;
  /** 击球输入缓冲（秒），按下 J 后短时间内进入判定范围也能生效 */
  hitBuffer: number;
  stun: number;
  charge: number;
  /** 发球瞄准点（世界 x），蓄力时用左右键微调 */
  serveAim: number;
  anim: AnimState;
  animTimer: number;
  stats: { points: number; hits: number };
}

export interface GameEvents {
  phase: { phase: Phase };
  announce: { text: string; sub?: string; ms?: number };
  tick: { n: number };
  serve: { playerId: number; power: number };
  hit: {
    playerId: number;
    team: TeamId;
    power: number;
    combo: number;
    kind: HitKind;
    perfect: boolean;
    x: number;
    y: number;
    z: number;
  };
  block: { playerId: number; x: number; y: number; z: number };
  net: { x: number; y: number; z: number };
  jump: { playerId: number };
  dive: { playerId: number };
  /** 空挥（按了击球但没碰到球） */
  swing: { playerId: number };
  land: { x: number; z: number; winner: TeamId; inBounds: boolean };
  score: { winner: TeamId; scores: [number, number]; setsWon: [number, number] };
  setEnd: { winner: TeamId; setsWon: [number, number] };
  matchEnd: { winner: TeamId; mvp: string };
}

export interface BallEventNet {
  type: 'net';
  x: number;
  y: number;
  z: number;
}
export interface BallEventBlock {
  type: 'block';
  playerId: number;
  x: number;
  y: number;
  z: number;
}
export interface BallEventCross {
  type: 'cross';
  x: number;
  y: number;
  z: number;
}
export interface BallEventGround {
  type: 'ground';
  x: number;
  y: number;
  z: number;
}

export type BallEvent = BallEventNet | BallEventBlock | BallEventCross | BallEventGround;

export interface BlockerBox {
  playerId: number;
  x: number;
  halfW: number;
  minY: number;
  maxY: number;
}
