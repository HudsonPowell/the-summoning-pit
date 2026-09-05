// Motes: the pit's particles.
//
// EVERY OTHER ENGINE DRAWS PARTICLES AS BILLBOARDS — a camera-facing quad with
// a soft texture, added on top of the frame in a pass of its own. This one has
// no quads, no textures, no alpha and no second pass. It has capsules in a
// blended distance field, and that turns out to be a better instrument than
// the one we do not have:
//
//   FUSION. Neighbouring blobs melt into one silhouette and pull apart as they
//   separate. Smoke is not a stack of soft sprites here; it is a mass that
//   genuinely coalesces and genuinely breaks up, for free, because the field
//   already does that for arms and legs.
//
//   STRETCH. A particle is drawn from where it WAS to where it IS, so speed
//   becomes length. A spark does not need a motion-blur pass; it is a streak
//   because it is fast, and a dot when it is slow.
//
//   NO ALPHA. Nothing fades out by going transparent. It fades by SHRINKING
//   until it is smaller than a pixel, and by falling toward the colour of the
//   void behind it. Both are honest in a distance field, and both are what
//   real embers and real smoke actually do.
//
// Nothing here crosses the wire, ever. The server says a bolt was loosed and
// where it struck; every screen decides for itself what that looked like. And
// nothing here is authored per creature: the character of a shot's sparks
// comes from the spec the model already composed — its colour, its size, how
// fast it goes — so a new spell throws new sparks without a line being added.

import { Capsule } from './pose';
import { v3 } from './vec';

export type MoteKind = 'spark' | 'ember' | 'smoke' | 'flare' | 'mote' | 'shard' | 'ash';

const KINDS: MoteKind[] = ['spark', 'ember', 'smoke', 'flare', 'mote', 'shard', 'ash'];

interface Physics {
  gravity: number;   // m/s², negative falls
  drag: number;      // per second, exponential
  bounce: number;    // 0 dies on the floor, >0 kicks back off it
  swirl: number;     // how much the drift field pushes it about
  hot: number;       // 0 keeps its colour, 1 is born white
  fade: number;      // >1 holds its colour then drops late, <1 dims at once
  stretch: number;   // seconds of velocity drawn behind it
  grow: number;      // radius gained per second of life, as a fraction
  shrink: number;    // radius lost by the end of life, as a fraction
  flicker: number;   // radius wobble
}

/**
 * The whole vocabulary, as numbers rather than as branches. A spark is not a
 * different code path from smoke; it is heavier, faster, hotter and thinner.
 */
const PHYSICS: Record<MoteKind, Physics> = {
  // struck metal and burning grit: fast, falls hard, skips off the floor
  spark:  { gravity: -11, drag: 0.9, bounce: 0.34, swirl: 0.4, hot: 0.72, fade: 1.5, stretch: 0.028, grow: 0, shrink: 0.75, flicker: 0 },
  // what is left of a spark: slower, heavier, and it pulses as it cools
  ember:  { gravity: -3.4, drag: 1.7, bounce: 0.22, swirl: 1.1, hot: 0.32, fade: 1.2, stretch: 0.014, grow: 0, shrink: 0.55, flicker: 0.3 },
  // SMOKE IS THE HARD ONE. In a field with no alpha a big soft mass is not
  // translucent, it is SOLID — a dark blob reads as a hole cut in the pit
  // rather than as vapour. So smoke here is small, pale and plural: wisps
  // that fuse loosely with each other and never grow wider than a limb.
  // and it leaves by SHRINKING, not by darkening. Fading a pale puff toward
  // the void turns it black halfway through its life — a hole again, just a
  // slower one. It swells, thins, and is gone, holding its colour throughout.
  smoke:  { gravity: 0.42, drag: 2.1, bounce: 0, swirl: 2.2, hot: 0, fade: 2.4, stretch: 0, grow: 1.4, shrink: 0.85, flicker: 0.08 },
  // the flash itself: no weight, no travel, gone before you can look at it.
  // Near-white, because a flash that is merely a lighter version of its own
  // colour reads as a solid ball rather than as light
  flare:  { gravity: 0, drag: 6, bounce: 0, swirl: 0, hot: 0.97, fade: 0.6, stretch: 0.01, grow: 2.4, shrink: 0.2, flicker: 0 },
  // magic does not fall. It hangs, drifts, and goes out
  mote:   { gravity: 0.15, drag: 1.2, bounce: 0, swirl: 3.4, hot: 0.4, fade: 1.8, stretch: 0.012, grow: 0, shrink: 0.6, flicker: 0.45 },
  // thrown pieces of something solid, tumbling
  shard:  { gravity: -10, drag: 0.5, bounce: 0.3, swirl: 0.2, hot: 0.15, fade: 1.6, stretch: 0.05, grow: 0, shrink: 0.25, flicker: 0 },
  // WHAT A BLAST LEAVES. Not a scorch decal — a capsule has a round section,
  // so a flat mark of any size is a buried DOME, and a two-metre one is a
  // hill in the middle of the pit. Scattered specks instead: the medium can
  // say "something burned here" honestly, and an explosion does leave grit.
  ash:    { gravity: 0, drag: 0, bounce: 0, swirl: 0, hot: 0, fade: 0.6, stretch: 0, grow: 0, shrink: 0.55, flicker: 0 },
};

export interface Burst {
  x: number; y: number; z: number;
  dx?: number; dy?: number; dz?: number;  // aim; need not be a unit vector
  speed?: number;                          // metres/sec along the aim
  spread?: number;                         // random metres/sec in every direction
  r?: number;                              // birth radius
  life?: number;                           // seconds, before its own scatter
  color?: [number, number, number];
  jitter?: number;                         // metres of scatter at birth
}

/** How many motes may be alive at once before the oldest start giving way. */
const POOL = 340;

export class Motes {
  private px = new Float32Array(POOL);
  private py = new Float32Array(POOL);
  private pz = new Float32Array(POOL);
  private vx = new Float32Array(POOL);
  private vy = new Float32Array(POOL);
  private vz = new Float32Array(POOL);
  private life = new Float32Array(POOL);
  private full = new Float32Array(POOL);   // the life it was born with
  private rad = new Float32Array(POOL);
  private cr = new Float32Array(POOL);
  private cg = new Float32Array(POOL);
  private cb = new Float32Array(POOL);
  private kind = new Uint8Array(POOL);
  private salt = new Float32Array(POOL);
  private n = 0;
  private seed = 0x9e3779b9;

  /**
   * The governor's dial, 0..1. A phone that has had to give up pixels gives up
   * motes FIRST — they are the most decorative thing the pit draws, and the
   * cheapest to do without.
   */
  budget = 1;

  /** Live motes, for the fps tag and the tests. */
  get count(): number { return this.n; }

  private rnd(): number {
    // xorshift: cheap, and no Math.random in the step, so a test can replay it
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s >>> 0;
    return (this.seed & 0xffffff) / 0x1000000;
  }

  private spread(v: number): number { return (this.rnd() * 2 - 1) * v; }

  /**
   * Ask for particles; get what the pool can spare. Emission is a REQUEST, not
   * a promise — that is the whole budget discipline in one sentence, and it is
   * why a ten-creature brawl cannot cost more than a duel.
   */
  emit(kind: MoteKind, count: number, b: Burst): void {
    const want = Math.round(count * this.budget);
    const k = KINDS.indexOf(kind);
    const col = b.color ?? [255, 255, 255];
    const speed = b.speed ?? 0;
    const spread = b.spread ?? 0;
    const jitter = b.jitter ?? 0;
    const life = b.life ?? 0.6;
    const rad = b.r ?? 0.03;
    // normalise the aim once, not per particle
    let ax = b.dx ?? 0, ay = b.dy ?? 0, az = b.dz ?? 0;
    const m = Math.hypot(ax, ay, az);
    if (m > 1e-6) { ax /= m; ay /= m; az /= m; } else { ax = ay = az = 0; }

    for (let i = 0; i < want; i++) {
      // full pool: the oldest gives way, because the newest is the thing the
      // eye is actually looking at
      let at = this.n;
      if (at >= POOL) {
        at = 0;
        for (let j = 1; j < POOL; j++) if (this.life[j] < this.life[at]) at = j;
      } else {
        this.n++;
      }
      this.px[at] = b.x + this.spread(jitter);
      this.py[at] = b.y + this.spread(jitter);
      this.pz[at] = b.z + this.spread(jitter);
      this.vx[at] = ax * speed + this.spread(spread);
      this.vy[at] = ay * speed + this.spread(spread);
      this.vz[at] = az * speed + this.spread(spread);
      const l = life * (0.72 + this.rnd() * 0.56);
      this.life[at] = l;
      this.full[at] = l;
      this.rad[at] = rad * (0.7 + this.rnd() * 0.6);
      this.cr[at] = col[0]; this.cg[at] = col[1]; this.cb[at] = col[2];
      this.kind[at] = k;
      this.salt[at] = this.rnd() * 100;
    }
  }

  /**
   * One integration for every kind. The drift field is a cheap standing swirl
   * rather than real turbulence: enough that no two motes travel the same line,
   * and no memory at all.
   */
  step(dt: number, t: number): void {
    if (dt <= 0) return;
    const h = Math.min(0.05, dt);
    for (let i = 0; i < this.n; i++) {
      const p = PHYSICS[KINDS[this.kind[i]]];
      this.life[i] -= h;
      if (this.life[i] <= 0) {
        // swap the dead one out so the live set stays contiguous
        this.n--;
        if (i !== this.n) {
          this.px[i] = this.px[this.n]; this.py[i] = this.py[this.n]; this.pz[i] = this.pz[this.n];
          this.vx[i] = this.vx[this.n]; this.vy[i] = this.vy[this.n]; this.vz[i] = this.vz[this.n];
          this.life[i] = this.life[this.n]; this.full[i] = this.full[this.n];
          this.rad[i] = this.rad[this.n];
          this.cr[i] = this.cr[this.n]; this.cg[i] = this.cg[this.n]; this.cb[i] = this.cb[this.n];
          this.kind[i] = this.kind[this.n]; this.salt[i] = this.salt[this.n];
        }
        i--;
        continue;
      }
      if (p.swirl) {
        const s = this.salt[i];
        this.vx[i] += Math.sin(t * 0.9 + s + this.py[i] * 2.1) * p.swirl * h;
        this.vz[i] += Math.cos(t * 1.1 + s * 1.7 + this.px[i] * 1.9) * p.swirl * h;
      }
      this.vy[i] += p.gravity * h;
      const d = Math.exp(-p.drag * h);
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      this.px[i] += this.vx[i] * h;
      this.py[i] += this.vy[i] * h;
      this.pz[i] += this.vz[i] * h;
      // the floor is real for anything with weight
      if (this.py[i] < 0.015 && p.gravity < 0) {
        this.py[i] = 0.015;
        if (p.bounce > 0 && Math.abs(this.vy[i]) > 0.35) {
          this.vy[i] = -this.vy[i] * p.bounce;
          this.vx[i] *= 0.6; this.vz[i] *= 0.6;
        } else {
          this.vy[i] = 0;
          this.vx[i] *= 0.82; this.vz[i] *= 0.82;
          // grounded things go out faster than airborne ones
          this.life[i] -= h * 1.4;
        }
      }
    }
  }

  /**
   * Write the live motes as capsules. `dark` is the colour of the void behind
   * them: fading toward it IS the fade, because there is no alpha to spend.
   */
  caps(out: Capsule[], dark: [number, number, number], t: number): void {
    for (let i = 0; i < this.n; i++) {
      const kind = KINDS[this.kind[i]];
      const p = PHYSICS[kind];
      const u = Math.max(0, Math.min(1, this.life[i] / Math.max(1e-4, this.full[i])));
      const age = 1 - u;
      let r = this.rad[i] * (1 + p.grow * age) * (1 - p.shrink * age);
      if (p.flicker) r *= 1 + Math.sin(t * 26 + this.salt[i] * 7) * p.flicker * age;
      if (kind === 'flare') r = this.rad[i] * (0.35 + 2.4 * Math.sin(Math.PI * Math.pow(age, 0.42)));
      if (r < 0.004) continue;
      // BORN HOT, DYING INTO THE DARK. Two moves stand in for the alpha this
      // renderer does not have: a young mote is pushed toward white, and an
      // old one falls toward the colour of the void behind it. Together with
      // the shrink above, that is a fade — and it is what an ember does.
      const hot = p.hot * u * u;
      const gone = Math.pow(age, p.fade);
      const cr = this.cr[i] + (255 - this.cr[i]) * hot;
      const cg = this.cg[i] + (255 - this.cg[i]) * hot;
      const cb = this.cb[i] + (255 - this.cb[i]) * hot;
      const s = p.stretch;
      out.push({
        a: v3(this.px[i] - this.vx[i] * s, this.py[i] - this.vy[i] * s, this.pz[i] - this.vz[i] * s),
        b: v3(this.px[i], this.py[i], this.pz[i]),
        r,
        color: [
          cr + (dark[0] - cr) * gone,
          cg + (dark[1] - cg) * gone,
          cb + (dark[2] - cb) * gone,
        ],
        part: 'mote',
      });
    }
  }

  clear(): void { this.n = 0; }
}

// --- the vocabulary ---------------------------------------------------------
// Effects, composed out of the six kinds. These say WHAT a thing looks like;
// the pit says WHEN. Every one of them takes the projectile's own colour and
// size, so the model that composed the spell composed its sparks too.

/**
 * Smoke is PALER than the pit, never darker. Dark smoke on a dark floor is an
 * absence; smoke lit by the pool of light is a presence, and this pit has a
 * pool of light. It keeps a breath of the fire's own colour so a purple spell
 * does not smoke the same grey as a fireball.
 */
const vapour = (c: [number, number, number], k = 0.2): [number, number, number] =>
  [c[0] * k + 96, c[1] * k + 98, c[2] * k + 104];

/** Grit and cinders: the one thing here that IS darker than the floor. */
const cinder = (c: [number, number, number]): [number, number, number] =>
  [c[0] * 0.16 + 22, c[1] * 0.15 + 21, c[2] * 0.15 + 24];

/**
 * The projectile itself, drawn as a fused ribbon rather than a string of
 * beads. The remembered positions are sampled at the sim's rate, so at bolt
 * speed they sit a third of a metre apart — joined end to end instead, the
 * distance field closes the gaps and the thing reads as moving.
 */
export function streak(out: Capsule[], hx: number, hy: number, hz: number,
  trail: { x: number; y: number; z: number }[],
  color: [number, number, number], size: number, dark: [number, number, number]): void {
  let px = hx, py = hy, pz = hz;
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const f = 1 - (i + 1) / (trail.length + 1);   // 1 at the head, 0 at the tail
    out.push({
      a: v3(px, py, pz), b: v3(t.x, t.y, t.z),
      r: size * (0.22 + 0.78 * f),
      color: [
        color[0] + (dark[0] - color[0]) * (1 - f),
        color[1] + (dark[1] - color[1]) * (1 - f),
        color[2] + (dark[2] - color[2]) * (1 - f),
      ],
      part: 'trail',
    });
    px = t.x; py = t.y; pz = t.z;
  }
  // the head last and hottest: a white-hot core says which end goes first
  out.push({
    a: v3(hx, hy, hz), b: v3(hx, hy, hz), r: size,
    color: [color[0] + (255 - color[0]) * 0.45, color[1] + (255 - color[1]) * 0.45, color[2] + (255 - color[2]) * 0.45],
    part: 'shot',
  });
}

/** The instant of release: a flash at the hand, a cough of smoke, a few sparks. */
export function muzzle(m: Motes, x: number, y: number, z: number,
  dx: number, dz: number, color: [number, number, number], size: number): void {
  // a flare's drawn radius peaks near three times its birth radius, so these
  // are small numbers on purpose — the flash is brief and bright, not broad
  m.emit('flare', 1, { x, y, z, r: size * 0.55, life: 0.1, color });
  m.emit('spark', 5, { x, y, z, dx, dy: 0.12, dz, speed: 3.4, spread: 1.5, r: size * 0.3, life: 0.26, color });
  m.emit('smoke', 3, { x, y, z, dx, dy: 0.3, dz, speed: 0.7, spread: 0.35, r: 0.035, life: 0.5, jitter: 0.05, color: vapour(color) });
}

/**
 * What a shot leaves behind it, chosen by what KIND of shot it is rather than
 * by a flag: a fast small thing throws sparks, a slow fat one trails motes and
 * smoke. Bolt and spell were always different; nobody had to say so.
 */
export function wake(m: Motes, x: number, y: number, z: number,
  vx: number, vy: number, vz: number, color: [number, number, number], size: number, dt: number): void {
  const speed = Math.hypot(vx, vy, vz);
  const fast = Math.min(1, speed / 14);
  // 34 a second, spent as whole motes: the fraction is settled by a coin
  // rather than carried, so a shot needs no state of its own to trail
  const want = 34 * dt;
  const n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
  if (n <= 0) return;
  if (fast > 0.5) {
    m.emit('spark', n, { x, y, z, dx: -vx, dy: -vy, dz: -vz, speed: speed * 0.12, spread: 0.5, r: size * 0.3, life: 0.22, color });
  } else {
    m.emit('mote', n, { x, y, z, spread: 0.35, r: size * 0.45, life: 0.5, jitter: size * 0.5, color });
    if (Math.random() < 0.35) {
      m.emit('smoke', 1, { x, y, z, spread: 0.15, r: 0.03, life: 0.6, color: vapour(color) });
    }
  }
}

/**
 * Where it lands. A plain shot ticks and is gone; a boom is the pit's loudest
 * moment and gets the whole vocabulary — flash, a ring of shards, rolling
 * smoke, embers falling out of it, and a mark on the floor that outlives all
 * of them.
 */
export function impact(m: Motes, x: number, y: number, z: number,
  color: [number, number, number], size: number, boom = 0): void {
  if (boom > 0) {
    const s = Math.max(0.6, boom);
    // THE BLAST RADIUS SETS HOW FAR THINGS FLY, NEVER HOW BIG THEY ARE. Sized
    // the other way — every puff scaled by a two-metre blast — one fireball
    // filled the whole frame with a single brown mass. The reach is the sim's
    // number; the pieces stay the size pieces are.
    m.emit('flare', 1, { x, y: y + 0.1, z, r: 0.1, life: 0.15, color });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      m.emit('flare', 1, { x, y: y + 0.1, z, dx: Math.cos(a), dy: 0.35, dz: Math.sin(a), speed: s * 5, r: 0.05, life: 0.13, color });
    }
    m.emit('shard', 9, { x, y: y + 0.12, z, dy: 0.55, speed: s * 2.2, spread: s * 2.6, r: 0.03, life: 0.9, color: cinder(color) });
    m.emit('ember', 14, { x, y: y + 0.15, z, dy: 0.7, speed: s * 1.8, spread: s * 2.2, r: 0.028, life: 1.1, color });
    m.emit('smoke', 14, { x, y: y + 0.18, z, dy: 0.8, speed: s * 1.1, spread: s * 0.9, r: 0.055, life: 1.3, jitter: s * 0.3, color: vapour(color) });
    m.emit('ash', 10, { x, y: 0.03, z, jitter: s * 0.55, r: 0.03, life: 5, color: cinder(color) });
    return;
  }
  m.emit('flare', 1, { x, y, z, r: size, life: 0.1, color });
  m.emit('spark', 7, { x, y, z, dy: 0.4, speed: 2.6, spread: 2.1, r: size * 0.3, life: 0.34, color });
  m.emit('smoke', 3, { x, y, z, dy: 0.5, speed: 0.5, spread: 0.3, r: 0.04, life: 0.5, color: vapour(color) });
}

/**
 * A blow landing. The struck creature throws its OWN colours — the same rule
 * the hit-wave already follows, so a stone thing sheds grit and a green thing
 * sheds green.
 */
export function spatter(m: Motes, x: number, y: number, z: number,
  dx: number, dz: number, color: [number, number, number], force: number): void {
  const n = Math.round(3 + force * 6);
  m.emit('spark', n, { x, y, z, dx, dy: 0.5, dz, speed: 2.2 * force, spread: 1.6, r: 0.022, life: 0.3, color });
  m.emit('shard', Math.round(force * 3), { x, y, z, dx, dy: 0.6, dz, speed: 1.7 * force, spread: 1.2, r: 0.02, life: 0.6, color });
}

/** The last of something. Motes rise off it, unhurried, and go out. */
export function undoing(m: Motes, x: number, y: number, z: number,
  color: [number, number, number], bulk: number): void {
  m.emit('mote', 14, { x, y: y + bulk * 0.4, z, dy: 1, speed: 0.55, spread: 0.5, r: 0.028, life: 1.5, jitter: bulk * 0.3, color });
  m.emit('smoke', 6, { x, y: y + bulk * 0.3, z, dy: 1, speed: 0.4, spread: 0.35, r: bulk * 0.06, life: 1.2, jitter: bulk * 0.3, color: vapour(color) });
}

/** Weight landing on a dry floor. The same phase crossing that makes the sound. */
export function dust(m: Motes, x: number, z: number, bulk: number, force: number,
  floor: [number, number, number]): void {
  const n = Math.round(1 + force * 2.5);
  m.emit('smoke', n, {
    x, y: 0.03, z, dy: 1, speed: 0.28 * force, spread: 0.3 * force,
    r: 0.03 + bulk * 0.025, life: 0.44 + bulk * 0.16, jitter: 0.07,
    // lifted off the floor's own colour, and paler than it: dust catches the
    // light, and anything darker than the ground reads as a hole in it
    color: [floor[0] * 0.4 + 64, floor[1] * 0.4 + 66, floor[2] * 0.4 + 70],
  });
}
