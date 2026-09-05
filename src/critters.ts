// The things that live here anyway.
//
// A pit with nothing in it but combatants is an arena. A pit with a rat
// crossing behind the fight is a PLACE — somewhere that carried on before
// anyone was summoned into it and will carry on afterwards. Nothing here can
// be hurt, nothing here can hurt anything, and nothing here decides anything.
// That is the point: they are evidence that the floor is real.
//
// Client-side, like the motes, and for the same reason. A rat scurrying is
// not a fact anyone needs to agree on — your rat and my rat can be different
// rats — so it costs the wire nothing and the sim nothing. But the asymmetry
// runs one way only: a critter KNOWS about the creatures, because the client
// has their positions anyway, and bolts when one comes near. The fight is
// unaware of the rat; the rat is extremely aware of the fight.

import { Capsule } from './pose';
import { v3 } from './vec';

/**
 * Anything with legs big enough to tread on you. Shaped so the pit's own
 * agents satisfy it directly — no per-frame array of copies just to tell a
 * rat where the boots are.
 */
export interface Threat { x: number; z: number; bulk: number; deadT: number }

type Kind = 'rat' | 'beetle';

interface Beast {
  kind: Kind;
  x: number; z: number;
  yaw: number;
  speed: number;
  timer: number;   // seconds until it thinks again
  bolt: number;    // seconds of panic left
  phase: number;   // scurry cycle, for the tail and the gait
  salt: number;
}

/** An ant column: one path, many followers, no thinking at all. */
interface Line {
  x0: number; z0: number; dir: number;
  u: number; span: number; speed: number; wobble: number;
  n: number; gap: number; salt: number;
}

const RIM = 8.6;          // beyond this it has left the pit and is forgotten
const HOME = 7.2;         // where new ones wander in from

export class Critters {
  private beasts: Beast[] = [];
  private lines: Line[] = [];
  private next = 2;       // seconds until something new wanders in
  private seed = 0x1b873593;

  /** 0..1 from the governor: ambience is the first thing a busy phone drops. */
  budget = 1;

  get count(): number {
    return this.beasts.length + this.lines.reduce((n, l) => n + l.n, 0);
  }

  private rnd(): number {
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.seed = s >>> 0;
    return (this.seed & 0xffffff) / 0x1000000;
  }

  private range(a: number, b: number): number { return a + this.rnd() * (b - a); }

  /** Something loud happened. Everything with legs decides to be elsewhere. */
  scatter(x: number, z: number, force = 1): void {
    for (const b of this.beasts) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > 3.5 * force) continue;
      b.yaw = Math.atan2(b.z - z, b.x - x) + this.range(-0.4, 0.4);
      b.bolt = Math.max(b.bolt, this.range(0.7, 1.5) * force);
      b.timer = b.bolt;
    }
  }

  step(dt: number, threats: Threat[]): void {
    const h = Math.min(0.05, dt);

    // --- who is here at all ------------------------------------------------
    // Occasional means occasional: a couple of things at a time, arriving on
    // their own schedule, never a population that has to be maintained.
    this.next -= h;
    const want = Math.round(3 * this.budget);
    if (this.next <= 0) {
      this.next = this.range(6, 22);
      if (this.budget > 0.1) {
        if (this.rnd() < 0.34 && this.lines.length < 1) this.addLine();
        else if (this.beasts.length < want) this.addBeast();
      }
    }

    // --- rats and beetles --------------------------------------------------
    for (let i = 0; i < this.beasts.length; i++) {
      const b = this.beasts[i];
      const rat = b.kind === 'rat';

      // NEAREST BOOT. A creature that is standing still is scenery; one that
      // is moving is a thing about to tread on you.
      let near = 1e9, nx = 0, nz = 0;
      for (const t of threats) {
        if (t.deadT >= 0) continue;
        const d = Math.hypot(t.x - b.x, t.z - b.z) - t.bulk * 0.35;
        if (d < near) { near = d; nx = t.x; nz = t.z; }
      }
      if (near < (rat ? 1.3 : 0.8)) {
        b.yaw = Math.atan2(b.z - nz, b.x - nx);
        b.bolt = Math.max(b.bolt, rat ? 0.9 : 0.5);
        b.timer = b.bolt;
      }

      b.timer -= h;
      if (b.timer <= 0) {
        if (rat) {
          // a rat does not travel, it DARTS: a run, then a long suspicious
          // pause with its nose up, then another run somewhere else
          const running = b.speed < 0.05;
          b.speed = running ? this.range(0.9, 1.7) : 0;
          b.timer = running ? this.range(0.25, 0.6) : this.range(0.5, 1.8);
          if (running) b.yaw += this.range(-1.5, 1.5);
        } else {
          b.speed = this.range(0.1, 0.26);
          b.timer = this.range(1.5, 4);
          b.yaw += this.range(-0.9, 0.9);
        }
      }
      if (b.bolt > 0) { b.bolt -= h; b.speed = rat ? 2.6 : 0.9; }

      b.x += Math.cos(b.yaw) * b.speed * h;
      b.z += Math.sin(b.yaw) * b.speed * h;
      b.phase += b.speed * h * 9;
      if (Math.hypot(b.x, b.z) > RIM) { this.beasts.splice(i--, 1); continue; }
    }

    // --- the ant column ----------------------------------------------------
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      l.u += l.speed * h;
      if (l.u > l.span + l.gap * l.n) this.lines.splice(i--, 1);
    }
  }

  private addBeast(): void {
    const a = this.rnd() * Math.PI * 2;
    this.beasts.push({
      kind: this.rnd() < 0.62 ? 'rat' : 'beetle',
      x: Math.cos(a) * HOME, z: Math.sin(a) * HOME,
      yaw: a + Math.PI + this.range(-0.7, 0.7),
      speed: 0, timer: this.range(0.2, 1), bolt: 0,
      phase: this.rnd() * 10, salt: this.rnd() * 100,
    });
  }

  private addLine(): void {
    const a = this.rnd() * Math.PI * 2;
    this.lines.push({
      x0: Math.cos(a) * HOME, z0: Math.sin(a) * HOME,
      dir: a + Math.PI + this.range(-0.5, 0.5),
      u: 0, span: this.range(9, 15), speed: this.range(0.16, 0.3),
      wobble: this.range(0.15, 0.5),
      n: Math.round(this.range(7, 15)), gap: this.range(0.07, 0.13),
      salt: this.rnd() * 100,
    });
  }

  /**
   * Small, dark and low. They are meant to be caught out of the corner of the
   * eye rather than looked at, so they are barely above life size — big enough
   * to read as a moving thing at the pit's zoom, small enough that nobody
   * mistakes one for a summon.
   */
  caps(out: Capsule[], t: number): void {
    for (const b of this.beasts) {
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const scurry = Math.sin(b.phase) * (b.speed > 0.05 ? 1 : 0);
      if (b.kind === 'rat') {
        // THE BLEND EATS SMALL DETAIL. Parts closer together than the field's
        // smoothing radius melt into one lozenge, so a rat cannot be built the
        // way a creature is — it needs a LONG tail, well clear of the body,
        // because that is the one line that says rat rather than pebble.
        const hide: [number, number, number] = [82, 72, 66];
        const y = 0.042 + Math.abs(scurry) * 0.008;
        out.push({
          a: v3(b.x - c * 0.05, y, b.z - s * 0.05),
          b: v3(b.x + c * 0.03, y + 0.004, b.z + s * 0.03),
          r: 0.036, color: hide, part: 'critter',
        });
        out.push({
          a: v3(b.x + c * 0.066, y - 0.002, b.z + s * 0.066),
          b: v3(b.x + c * 0.086, y - 0.006, b.z + s * 0.086),
          r: 0.021, color: [96, 86, 78], part: 'critter',
        });
        const w = b.yaw + Math.PI + scurry * 0.55;
        out.push({
          a: v3(b.x - c * 0.062, y - 0.006, b.z - s * 0.062),
          b: v3(b.x - c * 0.062 + Math.cos(w) * 0.19, y - 0.016, b.z - s * 0.062 + Math.sin(w) * 0.19),
          r: 0.0075, color: [104, 92, 86], part: 'critter',
        });
      } else {
        const shell: [number, number, number] = [46, 48, 58];
        out.push({
          a: v3(b.x - c * 0.03, 0.036, b.z - s * 0.03),
          b: v3(b.x + c * 0.03, 0.038, b.z + s * 0.03),
          r: 0.036, color: shell, part: 'critter',
        });
        out.push({
          a: v3(b.x + c * 0.055, 0.03, b.z + s * 0.055),
          b: v3(b.x + c * 0.062, 0.03, b.z + s * 0.062),
          r: 0.018, color: [58, 60, 70], part: 'critter',
        });
      }
    }

    // AN ANT IS NOT WORTH A THOUGHT. The whole column is one closed-form
    // path walked at different times, so a line of fifteen costs no more
    // decisions than a line of one — and they stay in single file, which is
    // the only thing about ants anybody actually recognises.
    for (const l of this.lines) {
      const c = Math.cos(l.dir), s = Math.sin(l.dir);
      for (let i = 0; i < l.n; i++) {
        const u = l.u - i * l.gap;
        if (u < 0 || u > l.span) continue;
        const off = Math.sin(u * 1.1 + l.salt) * l.wobble;
        const x = l.x0 + c * u - s * off;
        const z = l.z0 + s * u + c * off;
        const step = Math.sin(u * 40 + i) * 0.004;
        out.push({
          a: v3(x - c * 0.012, 0.026 + step, z - s * 0.012),
          b: v3(x + c * 0.012, 0.026 - step, z + s * 0.012),
          r: 0.013, color: [52, 46, 44], part: 'critter',
        });
      }
    }
  }

  /** For tests and previews: what is here and where, right now. */
  snapshot(): { kind: string; x: number; z: number; speed: number }[] {
    const out: { kind: string; x: number; z: number; speed: number }[] =
      this.beasts.map(b => ({ kind: b.kind as string, x: b.x, z: b.z, speed: b.speed }));
    for (const l of this.lines) {
      const c = Math.cos(l.dir), s2 = Math.sin(l.dir);
      for (let i = 0; i < l.n; i++) {
        const u = l.u - i * l.gap;
        if (u < 0 || u > l.span) continue;
        const off = Math.sin(u * 1.1 + l.salt) * l.wobble;
        out.push({ kind: 'ant', x: l.x0 + c * u - s2 * off, z: l.z0 + s2 * u + c * off, speed: l.speed });
      }
    }
    return out;
  }

  clear(): void { this.beasts.length = 0; this.lines.length = 0; }
}
