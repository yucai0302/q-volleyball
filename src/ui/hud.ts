import { MATCH } from '../sim/config';
import type { Skill } from '../sim/ai';
import type { TeamId } from '../sim/types';
import type { World } from '../sim/world';

export interface HudHandlers {
  onStart: (skill: Skill) => void;
  onAgain: () => void;
  onHome: () => void;
  onResume: () => void;
  onQuit: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private timer = $('timer');
  private scoreHome = $('score-home');
  private scoreAway = $('score-away');
  private scoreBox = document.querySelector('.score') as HTMLElement;
  private setLabel = $('set-label');
  private dots = $('dots');
  private setDots = $('set-dots');
  private announceEl = $('announce');
  private announceT = this.announceEl.querySelector('b') as HTMLElement;
  private announceS = this.announceEl.querySelector('span') as HTMLElement;
  private touchBox = $('touch');
  private touchLabel = this.touchBox.querySelector('.touch-label') as HTMLElement;
  private touchPips = $('touch-pips');
  private serveBar = $('servebar');
  private serveFill = $('serve-fill');

  private startScreen = $('start');
  private resultScreen = $('result');
  private pauseScreen = $('pause');
  private resultTitle = $('result-title');
  private resultSub = $('result-sub');
  private resultScore = $('result-score');
  private resultMvp = $('result-mvp');

  private skill: Skill = 'normal';
  private announceTimer = 0;
  private prev = { timer: -1, sh: -1, sa: -1, set: '', touch: -1, sets: '', serve: false };

  constructor(private handlers: HudHandlers) {
    for (let i = 0; i < MATCH.pointsToWinSet; i++) this.dots.appendChild(document.createElement('i'));
    for (let i = 0; i < 3; i++) this.setDots.appendChild(document.createElement('i'));

    const seg = $('difficulty');
    seg.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn || !btn.dataset.skill) return;
      this.skill = btn.dataset.skill as Skill;
      for (const b of Array.from(seg.querySelectorAll('button'))) {
        b.classList.toggle('on', b === btn);
      }
    });

    $('btn-start').addEventListener('click', () => this.handlers.onStart(this.skill));
    $('btn-again').addEventListener('click', () => this.handlers.onAgain());
    $('btn-home').addEventListener('click', () => this.handlers.onHome());
    $('btn-resume').addEventListener('click', () => this.handlers.onResume());
    $('btn-quit').addEventListener('click', () => this.handlers.onQuit());
  }

  update(world: World): void {
    const clock = Math.ceil(world.clock);
    if (clock !== this.prev.timer) {
      this.prev.timer = clock;
      this.timer.textContent = String(clock);
    }
    const warn = world.clock <= 5 && (world.phase === 'rally' || world.phase === 'serve');
    this.timer.classList.toggle('warn', warn);

    const sh = world.scores[0];
    const sa = world.scores[1];
    if (sh !== this.prev.sh || sa !== this.prev.sa) {
      const scored = this.prev.sh !== sh || this.prev.sa !== sa;
      this.prev.sh = sh;
      this.prev.sa = sa;
      this.scoreHome.textContent = String(sh);
      this.scoreAway.textContent = String(sa);
      if (scored) {
        this.scoreBox.classList.remove('pop');
        void this.scoreBox.offsetWidth;
        this.scoreBox.classList.add('pop');
      }
      for (let i = 0; i < this.dots.children.length; i++) {
        this.dots.children[i].classList.toggle('on', i < sh);
      }
    }

    const setText = `SET ${world.setIndex + 1}`;
    if (setText !== this.prev.set) {
      this.prev.set = setText;
      this.setLabel.textContent = setText;
    }

    const setsKey = `${world.setsWon[0]}-${world.setsWon[1]}`;
    if (setsKey !== this.prev.sets) {
      this.prev.sets = setsKey;
      for (let i = 0; i < 3; i++) {
        const el = this.setDots.children[i];
        el.className = i < world.setsWon[0] ? 'home' : i >= 3 - world.setsWon[1] ? 'away' : '';
      }
    }

    const t = world.touches[world.humanTeam];
    if (t !== this.prev.touch) {
      this.prev.touch = t;
      for (let i = 0; i < 3; i++) this.touchPips.children[i].classList.toggle('on', i < t);
      this.touchLabel.textContent = t >= 3 ? '第 3 次要过网' : `触球 ${t}/3`;
      this.touchBox.classList.toggle('danger', t === 2);
      this.touchBox.classList.toggle('over', t >= 3);
    }

    const human = world.players.find((p) => p.isHuman);
    const serving = world.phase === 'serve' && !!human && world.serverId === human.id;
    if (serving !== this.prev.serve) {
      this.prev.serve = serving;
      this.serveBar.classList.toggle('show', serving);
    }
    if (serving && human) {
      this.serveFill.style.width = `${Math.round(human.charge * 100)}%`;
    }
  }

  announce(text: string, sub?: string, ms = 1200): void {
    if (!text) return;
    this.announceT.textContent = text;
    this.announceS.textContent = sub ?? '';
    this.announceEl.classList.remove('show');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('show');
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => this.announceEl.classList.remove('show'), ms);
  }

  showStart(v: boolean): void {
    this.startScreen.classList.toggle('hidden', !v);
  }

  showResult(world: World, winner: TeamId, mvp: string): void {
    const win = winner === world.humanTeam;
    this.resultTitle.textContent = win ? '胜利！' : '惜败';
    this.resultSub.textContent = win ? '配合默契，再来一局？' : '差一点，调整节奏再战';
    this.resultScore.textContent = `${world.setsWon[0]} : ${world.setsWon[1]}`;
    this.resultMvp.textContent = mvp ? `MVP · ${mvp}` : '';
    this.resultScreen.classList.remove('hidden');
  }

  hideResult(): void {
    this.resultScreen.classList.add('hidden');
  }

  showPause(v: boolean): void {
    this.pauseScreen.classList.toggle('hidden', !v);
  }
}
