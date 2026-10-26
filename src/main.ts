import './styles.css';
import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const fxLayer = document.getElementById('fx-layer') as HTMLElement;

const game = new Game(canvas, fxLayer);

// 开发期调试钩子（生产构建同样可用，便于快速排查对局状态）
(window as unknown as { __paiqiu?: Game }).__paiqiu = game;
