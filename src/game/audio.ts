type Sfx = "flip" | "core" | "death" | "win" | "switch" | "step";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  musicOn = true;
  sfxOn = true;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? 0.12 : 0;
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxOn ? 0.25 : 0;
      this.sfxGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.12 : 0;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.25 : 0;
  }

  play(kind: Sfx) {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain || !this.sfxOn) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(this.sfxGain);
    const cfg: Record<Sfx, { type: OscillatorType; from: number; to: number; dur: number }> = {
      flip: { type: "square", from: 340, to: 760, dur: 0.16 },
      core: { type: "triangle", from: 880, to: 1500, dur: 0.14 },
      death: { type: "sawtooth", from: 320, to: 60, dur: 0.45 },
      win: { type: "triangle", from: 520, to: 1320, dur: 0.6 },
      switch: { type: "square", from: 200, to: 420, dur: 0.12 },
      step: { type: "square", from: 160, to: 120, dur: 0.05 },
    };
    const c = cfg[kind];
    osc.type = c.type;
    osc.frequency.setValueAtTime(c.from, now);
    osc.frequency.exponentialRampToValueAtTime(c.to, now + c.dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.6, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + c.dur);
    osc.start(now);
    osc.stop(now + c.dur + 0.02);
  }

  startMusic() {
    const ctx = this.ensure();
    if (!ctx || !this.musicOn || this.timer !== null) return;
    const scale = [110, 146.83, 164.81, 196, 220, 261.63, 293.66, 329.63];
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      const now = this.ctx.currentTime;
      const idx = [0, 2, 4, 2, 5, 4, 3, 1][this.step % 8];
      const note = scale[idx] * (this.step % 16 >= 8 ? 2 : 1);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = note;
      osc.connect(g);
      g.connect(this.musicGain);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.start(now);
      osc.stop(now + 0.42);

      const bass = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bass.type = "sine";
      bass.frequency.value = scale[0] / 2;
      bass.connect(bg);
      bg.connect(this.musicGain);
      bg.gain.setValueAtTime(0.0001, now);
      bg.gain.exponentialRampToValueAtTime(0.4, now + 0.05);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      bass.start(now);
      bass.stop(now + 0.55);
      this.step++;
    };
    tick();
    this.timer = window.setInterval(tick, 420);
  }

  stopMusic() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
  }
}
