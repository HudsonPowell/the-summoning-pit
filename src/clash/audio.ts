// CLASH audio: entirely synthesised, no samples — flat colour for the ears.
// The fuse is a gameplay system: every burning candle hums, pitch rising as
// it shortens, in its owner's timbre. You learn to hear who placed what and
// how long you have.

import { Game, GameEvent, Pickup } from './sim';

const FUSE_WAVES: OscillatorType[] = ['square', 'sawtooth', 'triangle', 'sine'];

export class ClashAudio {
  private ctx: AudioContext;
  private master: GainNode;
  private fuses = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume(): void {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    gain = 0.12,
    glideTo?: number,
  ): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, filterFreq: number, gain = 0.2, sweepTo?: number): void {
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  private arpeggio(freqs: number[], step = 0.09, type: OscillatorType = 'triangle'): void {
    freqs.forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.16, type, 0.12), i * step * 1000);
    });
  }

  /** The burning candles hum. Call every render frame. */
  updateFuses(game: Game): void {
    const seen = new Set<string>();
    for (const c of game.candles) {
      const key = `${c.owner}:${c.tx}:${c.ty}`;
      seen.add(key);
      const frac = Math.max(0, c.timer) / c.fuse;
      const freq = 180 + (1 - frac) * 420 + c.owner * 40;
      let f = this.fuses.get(key);
      if (!f) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = FUSE_WAVES[c.owner % FUSE_WAVES.length];
        gain.gain.value = 0.018;
        osc.connect(gain).connect(this.master);
        osc.start();
        f = { osc, gain };
        this.fuses.set(key, f);
      }
      f.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
      // urgency flutter in the last third
      f.gain.gain.setTargetAtTime(frac < 0.33 ? 0.03 : 0.018, this.ctx.currentTime, 0.05);
    }
    for (const [key, f] of this.fuses) {
      if (!seen.has(key)) {
        f.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
        f.osc.stop(this.ctx.currentTime + 0.1);
        this.fuses.delete(key);
      }
    }
  }

  countdownTick(n: number): void {
    this.tone(n === 0 ? 780 : 490, n === 0 ? 0.22 : 0.1, 'triangle', 0.14);
  }

  handle(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'place':
          this.tone(300 + e.owner * 60, 0.08, 'triangle', 0.1, 380 + e.owner * 60);
          break;
        case 'explode': {
          const size = Math.min(1, e.tiles / 12);
          this.noise(0.3 + size * 0.2, 900 + size * 800, 0.28, 120);
          this.tone(75, 0.32, 'sine', 0.3, 40);
          break;
        }
        case 'pickup':
          this.arpeggio(e.kind === Pickup.BOOTS ? [520, 780] : [660, 990], 0.07);
          break;
        case 'hurtPlayer':
          this.tone(420, 0.16, 'sawtooth', 0.16, 180);
          break;
        case 'hurtBeast':
          this.tone(160, 0.1, 'square', 0.12, 120);
          break;
        case 'diePlayer':
          this.tone(320, 0.55, 'sawtooth', 0.2, 55);
          this.noise(0.4, 600, 0.15, 80);
          break;
        case 'dieBeast':
          this.tone(220, 0.3, 'square', 0.16, 60);
          this.noise(0.2, 500, 0.12);
          break;
        case 'strike':
          this.noise(0.1, 2400, 0.1, 500);
          break;
        case 'strikeHit':
          this.tone(120, 0.12, 'sine', 0.26, 70);
          this.noise(0.06, 1200, 0.14);
          break;
        case 'bite':
          this.tone(95, 0.24, 'sawtooth', 0.14, 70);
          break;
        case 'roundOver':
          this.arpeggio(e.winner >= 0 ? [392, 494, 587] : [330, 311], 0.1);
          break;
        case 'matchOver':
          this.arpeggio([392, 494, 587, 784, 988], 0.11);
          break;
      }
    }
  }
}
