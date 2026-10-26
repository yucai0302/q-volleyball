import type { TeamId } from './types';

export interface Slot {
  x: number;
  /** 距网距离（米） */
  d: number;
}

/** 按人数生成的初始阵型：d 越大越靠后（发球位） */
export const FORMATIONS: Record<number, Slot[]> = {
  1: [{ x: 0, d: 4.5 }],
  2: [
    { x: -1.9, d: 3.1 },
    { x: 1.9, d: 5.8 },
  ],
  3: [
    { x: -2.4, d: 2.4 },
    { x: 0, d: 4.7 },
    { x: 2.4, d: 6.4 },
  ],
  4: [
    { x: -2.6, d: 2.2 },
    { x: -0.9, d: 4.0 },
    { x: 0.9, d: 5.6 },
    { x: 2.6, d: 7.0 },
  ],
};

export function formationFor(size: number): Slot[] {
  return FORMATIONS[size] ?? FORMATIONS[2];
}

export function slotPosition(team: TeamId, size: number, slot: number): { x: number; z: number } {
  const f = formationFor(size);
  const s = f[Math.min(slot, f.length - 1)];
  return { x: s.x, z: team === 0 ? s.d : -s.d };
}
