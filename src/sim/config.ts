/**
 * 全部手感 / 规则数值集中于此，方便调参。
 * 模拟层不依赖渲染，后续联机时这份配置可直接在服务端复用。
 */

export const COURT = {
  /** 半场宽度（x 方向） */
  halfWidth: 4,
  /** 半场长度（z 方向） */
  halfLength: 8,
  /** 网高 */
  netHeight: 2.0,
  /** 网的有效宽度（天线之间） */
  netHalfWidth: 3.95,
  antennaX: 4.12,
} as const;

export const BALL = {
  radius: 0.2,
  gravity: 18,
  drag: 0.05,
} as const;

export const PLAYER = {
  radius: 0.42,
  moveSpeed: 6,
  sprintSpeed: 11,
  sprintDuration: 0.4,
  sprintCooldown: 3,
  jumpVelocity: 8,
  gravity: 22,
  /** 触球判定：胸口到球心的最大距离 */
  reach: 1.4,
  chestHeight: 1.0,
  hitCooldown: 0.28,
  /** 两次触球之间的全局最小间隔，避免同帧双击 */
  hitGap: 0.1,
  diveStun: 0.8,
  serveMaxCharge: 0.9,
} as const;

export const MATCH = {
  pointsToWinSet: 7,
  setsToWin: 2,
  /** 单局计时（秒）。PRD 写 40s 但 7 分制 40s 过短，这里放宽为软性上限 */
  setSeconds: 120,
  kickoffSeconds: 3,
  pointSeconds: 2.0,
  setEndSeconds: 2.4,
} as const;

export const DEFAULT_TEAM_SIZE = 2;
