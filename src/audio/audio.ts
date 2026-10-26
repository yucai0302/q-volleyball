/** 全程序化音效（Web Audio），不加载任何音频资源 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextBeat = 0;
  private beat = 0;
  private bgmRunning = false;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(ctx.destination);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(this.master);

      this.music = ctx.createGain();
      this.music.gain.value = 0.5;
      this.music.connect(this.master);

      const len = Math.floor(ctx.sampleRate * 0.3);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  startBgm(): void {
    if (!this.ctx) return;
    if (!this.bgmRunning) {
      this.bgmRunning = true;
      this.nextBeat = this.ctx.currentTime + 0.2;
    }
  }

  stopBgm(): void {
    this.bgmRunning = false;
  }

  // ---------------------------------------------------------------- 音色

  private tone(o: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }): void {
    const ctx = this.ctx;
    const out = this.sfx;
    if (!ctx || !out) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq), t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, o.gain ?? 0.2), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  }

  private noiseBurst(o: {
    freq: number;
    q?: number;
    dur: number;
    gain?: number;
    delay?: number;
    type?: BiquadFilterType;
  }): void {
    const ctx = this.ctx;
    const out = this.sfx;
    if (!ctx || !out || !this.noise) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, o.gain ?? 0.2), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  // ---------------------------------------------------------------- 事件音

  hit(power: number, attack: boolean): void {
    const norm = Math.min(1, Math.max(0, power / 100));
    this.tone({
      freq: attack ? 165 : 220,
      to: attack ? 62 : 130,
      dur: attack ? 0.22 : 0.14,
      type: 'sine',
      gain: attack ? 0.4 : 0.3,
    });
    this.noiseBurst({
      freq: 800 + norm * 1500,
      dur: 0.09,
      gain: attack ? 0.26 : 0.18,
    });
    this.tone({
      freq: 480 + norm * 620,
      dur: 0.09,
      type: 'triangle',
      gain: 0.12 + norm * 0.08,
      delay: 0.005,
    });
  }

  jump(): void {
    this.tone({ freq: 320, to: 520, dur: 0.11, type: 'sine', gain: 0.09 });
  }

  /** 空挥：短促的风声 */
  swing(): void {
    this.noiseBurst({ freq: 1100, q: 0.7, dur: 0.12, gain: 0.1 });
  }

  dive(): void {
    this.noiseBurst({ freq: 500, dur: 0.22, gain: 0.12, type: 'lowpass' });
  }

  serve(): void {
    this.noiseBurst({ freq: 1400, q: 0.6, dur: 0.18, gain: 0.18 });
    this.tone({ freq: 300, to: 700, dur: 0.16, type: 'triangle', gain: 0.12 });
  }

  block(): void {
    this.tone({ freq: 180, to: 90, dur: 0.16, type: 'square', gain: 0.16 });
    this.noiseBurst({ freq: 320, dur: 0.14, gain: 0.2, type: 'lowpass' });
  }

  net(): void {
    this.tone({ freq: 120, to: 70, dur: 0.2, type: 'sine', gain: 0.18 });
    this.noiseBurst({ freq: 260, dur: 0.16, gain: 0.1, type: 'lowpass' });
  }

  land(): void {
    this.tone({ freq: 140, to: 60, dur: 0.24, type: 'sine', gain: 0.3 });
    this.noiseBurst({ freq: 420, dur: 0.2, gain: 0.18, type: 'lowpass' });
  }

  tick(): void {
    this.tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.1 });
  }

  whistle(): void {
    this.tone({ freq: 1750, dur: 0.12, type: 'square', gain: 0.08 });
    this.tone({ freq: 2050, dur: 0.14, type: 'square', gain: 0.08, delay: 0.13 });
  }

  score(): void {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) =>
      this.tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.16, delay: i * 0.075 }),
    );
  }

  fanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) =>
      this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.17, delay: i * 0.12 }),
    );
  }

  // ---------------------------------------------------------------- BGM

  update(_dt: number): void {
    const ctx = this.ctx;
    const out = this.music;
    if (!ctx || !out || !this.bgmRunning) return;
    const now = ctx.currentTime;
    if (this.nextBeat < now) this.nextBeat = now + 0.05;
    while (this.nextBeat < now + 0.35) {
      this.scheduleBeat(this.nextBeat, this.beat++);
      this.nextBeat += 0.46;
    }
  }

  private scheduleBeat(t: number, i: number): void {
    const ctx = this.ctx;
    const out = this.music;
    if (!ctx || !out) return;
    const roots = [130.81, 174.61, 146.83, 196.0]; // C3 F3 D3 G3
    const chord = roots[Math.floor(i / 8) % roots.length];

    if (i % 8 === 0) {
      [1, 1.25, 1.5].forEach((m) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = chord * m * 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 1.1);
        g.gain.linearRampToValueAtTime(0.0001, t + 4.2);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 4.3);
      });
    }

    const arp = [0, 4, 7, 12, 7, 4, 2, 4];
    const semis = arp[i % arp.length];
    const freq = chord * 4 * Math.pow(2, semis / 12);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.018, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.55);
  }
}
