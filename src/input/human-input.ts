import type { ControlInput } from '../sim/types';

/** 键盘输入 -> 与 AI 完全一致的 ControlInput（边沿在读取后被消费） */
export class HumanInput {
  private keys = new Set<string>();
  private jumpPressed = false;
  private hitPressed = false;
  private blockPressed = false;

  enabled = true;
  onEscape: (() => void) | null = null;
  onMute: (() => void) | null = null;

  constructor(target: Window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.clear);
  }

  private onDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      this.onEscape?.();
      return;
    }
    if (e.code === 'KeyM') {
      this.onMute?.();
      return;
    }
    const block = [
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ShiftLeft',
      'ShiftRight',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
    ];
    if (block.includes(e.code)) e.preventDefault();
    if (!this.enabled) return;

    const repeat = this.keys.has(e.code);
    this.keys.add(e.code);
    if (repeat) return;
    if (e.code === 'Space') this.jumpPressed = true;
    if (e.code === 'KeyJ') this.hitPressed = true;
    if (e.code === 'KeyK') this.blockPressed = true;
  };

  private onUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private clear = (): void => {
    this.keys.clear();
    this.jumpPressed = false;
    this.hitPressed = false;
    this.blockPressed = false;
  };

  reset(): void {
    this.clear();
  }

  read(): ControlInput {
    if (!this.enabled) {
      this.jumpPressed = false;
      this.hitPressed = false;
      this.blockPressed = false;
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
    const k = this.keys;
    const right = k.has('KeyD') || k.has('ArrowRight');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const up = k.has('KeyW') || k.has('ArrowUp');

    const inp: ControlInput = {
      moveX: (right ? 1 : 0) - (left ? 1 : 0),
      moveZ: (down ? 1 : 0) - (up ? 1 : 0),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      jump: this.jumpPressed,
      hit: this.hitPressed,
      hitHeld: k.has('KeyJ'),
      block: this.blockPressed,
      blockHeld: k.has('KeyK'),
    };
    this.jumpPressed = false;
    this.hitPressed = false;
    this.blockPressed = false;
    return inp;
  }
}
