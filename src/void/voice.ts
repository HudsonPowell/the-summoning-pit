// The pit has a voice, and it is mostly the ROOM.
//
// A sample triggered dry is a sample. The same sample through a space — early
// reflections, a tail, a floor of grain — is a thing that happened somewhere.
// So there is one room, everything is sent to it, and that is what makes a
// harvested grunt and a stolen shriek sound like they are in the same place.
//
// On top of that, per creature: pitch and formant from its MASS, so one
// fragment is an imp or a troll depending on who made it; and per trigger, a
// small amount of movement — detune, a pitch fall, a filter sweep — because
// nothing alive makes exactly the same noise twice.
//
// No audio files are needed for the room. A reverb impulse is just decaying
// noise, and we can make one.

export type Bank = 'hit' | 'call' | 'hurt' | 'growl' | 'die';

interface Clip { buf: AudioBuffer; bank: Bank }

export interface VoiceBody {
  mass: number;     // roughly height in metres
  girth: number;    // how thick — drives the formant
  grit: number;     // 0..1, how rough the throat is
}

const BANKS: Bank[] = ['hit', 'call', 'hurt', 'growl', 'die'];

export class Pit {
  private ctx: AudioContext | null = null;
  private clips: Clip[] = [];
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private air: BiquadFilterNode | null = null;
  private lastAt = 0;
  private lastStepAt = 0;
  private dripTimer = 0;
  private scuff: AudioBuffer | null = null;
  ready = false;

  /** Nothing starts until a person has touched the page — browsers insist. */
  async start(manifest: string[]): Promise<void> {
    if (this.ctx) return;
    const Ctx = (window.AudioContext ?? (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    this.ctx = ctx;

    // --- the room ---------------------------------------------------------
    const out = ctx.destination;
    // a gentle roll-off at the top: the pit is underground, not a studio
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 7200;
    this.air.connect(out);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.62;
    this.dry.connect(this.air);

    this.verb = ctx.createConvolver();
    this.verb.buffer = makeRoom(ctx, 2.6, 0.62);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.85;
    this.verb.connect(this.wet);
    this.wet.connect(this.air);

    // --- the floor of grain -----------------------------------------------
    // A silent room reads as a bug. A quiet moving hiss reads as a place.
    const grain = ctx.createBufferSource();
    grain.buffer = makeGrain(ctx, 4);
    grain.loop = true;
    const grainFilter = ctx.createBiquadFilter();
    grainFilter.type = 'bandpass';
    grainFilter.frequency.value = 420;
    grainFilter.Q.value = 0.5;
    const grainGain = ctx.createGain();
    grainGain.gain.value = 0.012;
    grain.connect(grainFilter).connect(grainGain).connect(this.air);
    grain.start();
    // and the floor breathes, so it never sits perfectly still
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.06;
    const driftAmt = ctx.createGain();
    driftAmt.gain.value = 0.006;
    drift.connect(driftAmt).connect(grainGain.gain);
    drift.start();

    this.wind();
    this.dripLoop();

    await this.load(manifest);
    this.ready = this.clips.length > 0;
  }

  // --- the place itself ---------------------------------------------------
  // None of this is sampled. Wind is noise that will not sit still, a drip is a
  // pitch falling off a cliff into a resonant tail, and a footfall is a burst
  // shaped by how heavy the thing making it is. Synthesis suits an engine where
  // nothing else is drawn either.

  private wind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = makeGrain(ctx, 6);
    src.loop = true;

    // two bands, moving against each other, so it never reads as a loop
    for (const [freq, q, level, rate] of [[240, 1.4, 0.05, 0.037], [820, 2.2, 0.022, 0.023]]) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;

      // the gust: slow, and deliberately not in step with the other band
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const amt = ctx.createGain();
      amt.gain.value = level * 0.8;
      lfo.connect(amt).connect(g.gain);
      lfo.start();

      // and the band itself wanders, which is what stops it sounding like a filter
      const sweep = ctx.createOscillator();
      sweep.frequency.value = rate * 0.6;
      const sweepAmt = ctx.createGain();
      sweepAmt.gain.value = freq * 0.35;
      sweep.connect(sweepAmt).connect(band.frequency);
      sweep.start();

      src.connect(band).connect(g);
      g.connect(this.air!);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      g.connect(send).connect(this.verb!);
    }
    src.start();
  }

  /** Water off stone: rare, irregular, and always wetter than anything else. */
  private dripLoop(): void {
    const ctx = this.ctx!;
    const next = () => {
      const wait = 2.5 + Math.random() * 9;
      this.dripTimer = window.setTimeout(() => { this.drip(); next(); }, wait * 1000);
    };
    next();
  }

  private drip(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    // a drip is a pitch falling fast into nothing
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const top = 900 + Math.random() * 1400;
    osc.frequency.setValueAtTime(top, now);
    osc.frequency.exponentialRampToValueAtTime(top * 0.35, now + 0.055);

    // the plink: a resonance that rings a moment longer than the pitch does
    const ring = ctx.createBiquadFilter();
    ring.type = 'bandpass';
    ring.frequency.value = top * 0.8;
    ring.Q.value = 9;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.035 + Math.random() * 0.03, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    const place = ctx.createStereoPanner();
    place.pan.value = (Math.random() * 2 - 1) * 0.85;

    osc.connect(ring).connect(env).connect(place);
    // barely any dry signal — a drip is mostly the room answering it
    const dry = ctx.createGain();
    dry.gain.value = 0.25;
    place.connect(dry).connect(this.air!);
    place.connect(this.verb!);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * A foot going down. The rig knows exactly when this happens — the gait
   * phase crossing into stance — which most games have to approximate.
   */
  step(mass: number, pan = 0, dist = 0.3, hard = 0.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const m = Math.max(0.3, Math.min(2.6, mass));

    const src = ctx.createBufferSource();
    src.buffer = this.scuff ??= makeScuff(ctx);
    src.playbackRate.value = (1.5 / (0.6 + m)) * (0.85 + Math.random() * 0.3);

    // heavier feet land lower and duller
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600 / (0.5 + m * 0.7);
    tone.Q.value = 0.7;

    // a thump under it, which is the mass rather than the surface
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(90 / (0.6 + m * 0.35), now);
    body.frequency.exponentialRampToValueAtTime(40, now + 0.09);
    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(0, now);
    bodyEnv.gain.linearRampToValueAtTime(0.05 * m * hard / (1 + dist), now + 0.006);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

    const env = ctx.createGain();
    env.gain.value = (0.06 + m * 0.03) * hard / (1 + dist * 2);

    const place = ctx.createStereoPanner();
    place.pan.value = Math.max(-1, Math.min(1, pan)) * 0.6;

    src.connect(tone).connect(env).connect(place);
    body.connect(bodyEnv).connect(place);
    place.connect(this.dry!);
    const send = ctx.createGain();
    send.gain.value = 0.2 + dist * 0.5;
    place.connect(send).connect(this.verb!);

    src.start(now);
    body.start(now);
    body.stop(now + 0.16);
  }

  private async load(manifest: string[]): Promise<void> {
    const ctx = this.ctx!;
    const jobs = manifest.map(async name => {
      try {
        const res = await fetch(`voices/${name}`);
        if (!res.ok) return;
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        const bank = (BANKS.find(b => name.startsWith(b)) ?? 'hit') as Bank;
        this.clips.push({ buf, bank });
      } catch { /* a clip we cannot read is one we do not play */ }
    });
    await Promise.all(jobs);
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  /**
   * @param pan  -1..1, where it is relative to the middle of the frame
   * @param dist 0..1, 0 = right here, 1 = across the pit
   */
  say(bank: Bank, body: VoiceBody, pan = 0, dist = 0.3, force = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    // never let a scrum turn into a wall of noise
    const now = ctx.currentTime;
    if (now - this.lastAt < 0.035) return;
    this.lastAt = now;

    const pool = this.clips.filter(c => c.bank === bank);
    const clip = (pool.length ? pool : this.clips)[
      Math.floor(Math.random() * (pool.length || this.clips.length))
    ];
    if (!clip) return;

    const src = ctx.createBufferSource();
    src.buffer = clip.buf;

    // MASS sets the pitch. A 2m thing is an octave under a 0.5m thing, and the
    // curve is gentle at the top so giants do not become inaudible rumble.
    const m = Math.max(0.3, Math.min(2.6, body.mass));
    const rate = Math.pow(0.62 / m, 0.55);
    // nothing alive repeats itself exactly
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    // and the pitch moves across the sound: a cry falls, a call pushes up
    const bend = bank === 'die' ? -0.16 : bank === 'call' ? 0.07 : -0.04;
    src.playbackRate.setValueAtTime(src.playbackRate.value, now);
    src.playbackRate.linearRampToValueAtTime(
      Math.max(0.2, src.playbackRate.value * (1 + bend)), now + clip.buf.duration,
    );

    // GIRTH sets the throat: a thick body resonates lower and narrower
    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 1500 / Math.max(0.4, body.girth * 6.5);
    formant.Q.value = 1.1 + body.girth * 4;
    formant.gain.value = 7;

    // a body cavity under it
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 220;
    low.gain.value = 3 + m * 4;

    // GRIT: a rough throat, and it roughens further as the sound peaks
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeGrit(0.15 + body.grit * 0.75) as WaveShaperNode['curve'];
    shaper.oversample = '2x';

    // a slow wobble on the formant so the sound is never static
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 4 + Math.random() * 5;
    const wobbleAmt = ctx.createGain();
    wobbleAmt.gain.value = formant.frequency.value * 0.03;
    wobble.connect(wobbleAmt).connect(formant.frequency);
    wobble.start(now);
    wobble.stop(now + clip.buf.duration + 0.2);

    const env = ctx.createGain();
    const level = force * (0.42 + m * 0.14) / (1 + dist * 1.6);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(level, now + 0.008);
    env.gain.setTargetAtTime(0, now + clip.buf.duration * 0.7, 0.18);

    const place = ctx.createStereoPanner();
    place.pan.value = Math.max(-1, Math.min(1, pan)) * 0.7;

    const send = ctx.createGain();
    // further away is wetter — that is most of what distance sounds like
    send.gain.value = 0.25 + dist * 0.7;

    src.connect(formant).connect(low).connect(shaper).connect(env).connect(place);
    place.connect(this.dry!);
    place.connect(send).connect(this.verb!);

    src.start(now);
    src.stop(now + clip.buf.duration + 0.4);
  }
}

/** A room is decaying noise. Early reflections give it a size. */
function makeRoom(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * decay;
    }
    // a handful of early reflections: this is what says "stone chamber"
    for (const [at, amp] of [[0.011, 0.6], [0.019, 0.45], [0.031, 0.35], [0.047, 0.25]]) {
      const i = Math.floor(rate * at * (1 + c * 0.13));
      if (i < n) d[i] += amp * (c ? -1 : 1);
    }
  }
  return buf;
}

/** The floor of the room: slow, dark, never quite still. */
function makeGrain(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < n; i++) {
    // brown-ish noise: heavier and less hissy than white
    v = (v + (Math.random() * 2 - 1) * 0.06) * 0.996;
    d[i] = v;
  }
  // seamless loop
  const f = Math.floor(rate * 0.25);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[i] = d[i] * k + d[n - f + i] * (1 - k);
  }
  return buf;
}

/** Grit on stone: a short noise burst that decays fast and unevenly. */
function makeScuff(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * 0.13);
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // two decays layered: the scrape, and the grit inside it
    const scrape = Math.pow(1 - t, 3.5);
    const grit = Math.random() < 0.35 ? 1.6 : 1;
    d[i] = (Math.random() * 2 - 1) * scrape * grit * 0.8;
  }
  return buf;
}

/** Soft saturation. Enough to sound like a throat, not like distortion. */
function makeGrit(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
