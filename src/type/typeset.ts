// Setting a word in wire.
//
// Nothing here draws anything. It cuts lengths of wire, bends them to the
// shapes on the bending sheet, hammers them in slightly crooked, and hands the
// result to the same capsule field the creatures and the scenery go through —
// so the type is not styled to look like the world, it is made of the world.

import { Capsule } from '../pose';
import { v3 } from '../vec';
import { Rod, Strand, centreline, Pt } from './rod';
import { GLYPHS, GAUGE, Glyph } from './alphabet';

export interface SetOptions {
  /** Cap height in world metres. Everything else is a multiple of it. */
  size: number;
  /** Wire gauge as a fraction of cap height. */
  gauge: number;
  /** Bead spacing as a fraction of the gauge. Smaller = smoother, slower. */
  density: number;
  /** Extra space between glyphs, in em. */
  tracking: number;
  /** Hand-work: 0 is machined, 1 is visibly beaten in. */
  hand: number;
  /** Same seed, same crooked letters, forever. */
  seed: number;
  /** Where the word sits: 'left' | 'centre' | 'right' relative to x=0. */
  align?: 'left' | 'centre' | 'right';
  /** Baseline height in metres. */
  baseline?: number;
  inks?: [number, number, number][];
}

export const DEFAULTS: SetOptions = {
  size: 1,
  gauge: GAUGE,
  density: 0.55,
  tracking: 0.0,
  hand: 1,
  seed: 1740,
  align: 'centre',
  baseline: 0,
};

// Brass that has been in a dark room for a while. Enough spread between the
// four that the blob field has something to cross-fade between.
const BRASS: [number, number, number][] = [
  [214, 172, 96], [188, 142, 74], [232, 198, 128], [166, 124, 70],
];

function rng(seed: number) {
  let s = (seed | 0) || 1;
  s = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) | 0;
  s ^= s >>> 13;
  s = Math.imul(s, 0xc2b2ae35) | 0;
  s ^= s >>> 16;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0xffffff;
  };
}

interface Rivet { x: number; y: number; r: number; color: [number, number, number]; z: number }

/** One glyph's worth of wire, with the bookkeeping needed to animate it. */
export interface Piece {
  rod: Rod;
  /** Index of the glyph this piece belongs to — used to stagger the summon. */
  glyph: number;
  /** 0..1 across the line, for left-to-right sweeps. */
  u: number;
}

export class WireText {
  readonly text: string;
  readonly opts: SetOptions;
  readonly pieces: Piece[] = [];
  readonly rivets: Rivet[] = [];
  /** Set width in metres, and the x of the ink's left edge. */
  width = 0;
  left = 0;
  private caps: Capsule[] = [];

  constructor(text: string, opts: Partial<SetOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.text = text;
    this.build();
  }

  private build(): void {
    const o = this.opts;
    const em = o.size;
    const link = Math.max(1e-4, o.gauge * o.density);   // in em
    const inks = o.inks ?? BRASS;
    const r = rng(o.seed);

    // --- measure -------------------------------------------------------
    const chars = [...this.text.toUpperCase()];
    let adv = 0;
    const xs: number[] = [];
    for (const c of chars) {
      const gl: Glyph | undefined = GLYPHS[c];
      xs.push(adv);
      adv += (gl ? gl.adv : 0.5) + o.tracking;
    }
    adv -= o.tracking;
    this.width = adv * em;
    const originX =
      o.align === 'centre' ? -adv / 2 : o.align === 'right' ? -adv : 0;
    this.left = originX * em;
    const y0 = (o.baseline ?? 0) / em;

    // --- cut, bend, hammer ----------------------------------------------
    chars.forEach((c, gi) => {
      const gl = GLYPHS[c];
      if (!gl) return;
      const gx = originX + xs[gi];
      const u = adv > 1e-6 ? (xs[gi] + gl.adv / 2) / adv : 0.5;

      // On the plate the LINE is smooth and confident; what varies is the
      // pieces. The 4 is a head shorter than the 6, the 7 overtops both, and
      // nothing sits square. So the hand works at the scale of a whole glyph —
      // height, width, tilt and seating — and the height varies most, because
      // that is the thing the eye reads as handmade rather than set.
      const h = o.hand;
      const rot = (r() - 0.5) * 0.075 * h;      // up to ~2 degrees of lean
      const sy = 1 + (r() - 0.5) * 0.17 * h;    // the big one: nothing is the same height
      const sx = 1 + (r() - 0.5) * 0.08 * h;
      const dy = (r() - 0.5) * 0.045 * h;
      const dx = (r() - 0.5) * 0.028 * h;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      // scale about the baseline, not the middle: a short glyph on the plate is
      // short at the top, it does not sink into the wood
      const cx = gl.adv / 2;
      const place = (p: Pt): Pt => {
        const px = (p.x - cx) * sx, py = p.y * sy;
        return {
          x: gx + cx + dx + px * cs - py * sn,
          y: y0 + dy + px * sn + py * cs,
        };
      };

      for (const st of gl.strands) {
        const pts = centreline(st, link);
        if (pts.length < 2) continue;
        const rod = new Rod(pts, link, st.z ?? 0);

        // the elastica pass: let the wire find its own curve before we spoil it
        rod.relax(6);

        // A whisper of wander along the normal — enough that two instances of
        // the same letter are not the same object, far too little to read as a
        // shaky line. The plate has no shake in it.
        const ph1 = r() * 100, ph2 = r() * 100;
        const w1 = (0.07 + r() * 0.05) * o.gauge * h;
        const w2 = (0.02 + r() * 0.02) * o.gauge * h;
        const len = Math.max(1e-4, rod.length);
        rod.warp((x, y, t, i) => {
          const n = rod.tangent(i);
          const s = t * len;
          const off =
            Math.sin(s * 9.1 + ph1) * w1 +
            Math.sin(s * 31.7 + ph2) * w2;
          return place({ x: x - n.y * off, y: y + n.x * off });
        });

        rod.color = inks[Math.floor(r() * inks.length) % inks.length];
        rod.z = (st.z ?? 0) + (r() - 0.5) * 0.004;
        rod.part = `wire${gi}`;
        this.pieces.push({ rod, glyph: gi, u });
      }

      for (const rv of gl.rivets ?? []) {
        const p = place(rv);
        this.rivets.push({
          x: p.x, y: p.y,
          r: o.gauge * (rv.r ?? 0.78) * (0.9 + r() * 0.2),
          color: inks[Math.floor(r() * inks.length) % inks.length],
          z: 0.01,
        });
      }
    });
  }

  /** Total wire the smith would need for this word, in metres. */
  get wireLength(): number {
    return this.pieces.reduce((a, p) => a + p.rod.length, 0) * this.opts.size;
  }

  // ---- states ---------------------------------------------------------

  /** Everything exactly where it belongs. */
  settle(): void { for (const p of this.pieces) p.rod.snap(); }

  /**
   * Coil every piece up and drop it into the pit.
   *
   * The wire has to physically travel from here to the letter, because the
   * length constraint will not let it teleport — which is the whole reason the
   * arrival reads as something being pulled out of the dark rather than a
   * fade-in.
   */
  coil(depth = 1.1, spread = 0.35): void {
    const r = rng(this.opts.seed ^ 0x5eed);
    for (const p of this.pieces) {
      const rod = p.rod;
      const hx = rod.hx[0], hy = rod.hy[0];
      const ox = hx + (r() - 0.5) * spread;
      const oy = hy - depth - r() * 0.4;
      const a0 = r() * Math.PI * 2;
      const dir = r() < 0.5 ? -1 : 1;
      let a = a0, rad = rod.link * 1.2;
      for (let i = 0; i < rod.n; i++) {
        rod.x[i] = rod.px[i] = ox + Math.cos(a) * rad;
        rod.y[i] = rod.py[i] = oy + Math.sin(a) * rad * 0.75;
        a += dir * rod.link / Math.max(rod.link, rad);
        rad += rod.link * 0.17;
      }
    }
  }

  /** Cut the pieces loose and let them hang. */
  slack(amount = 0.4): void {
    const r = rng(this.opts.seed ^ 0xfa11);
    for (const p of this.pieces) {
      const rod = p.rod;
      const kx = (r() - 0.5) * amount, ky = -r() * amount;
      for (let i = 0; i < rod.n; i++) {
        const t = rod.n > 1 ? i / (rod.n - 1) : 0;
        const bow = Math.sin(t * Math.PI);
        rod.x[i] = rod.px[i] = rod.hx[i] + kx * bow;
        rod.y[i] = rod.py[i] = rod.hy[i] + ky * bow;
      }
    }
  }

  /** Nail a piece down so the rest of it swings from there. */
  pin(pieceIndex: number, beadIndex: number, on = true): void {
    const p = this.pieces[pieceIndex];
    if (!p) return;
    const i = Math.max(0, Math.min(p.rod.n - 1, beadIndex));
    p.rod.pinned[i] = on ? 1 : 0;
  }

  /** Shove the wire, in em space. */
  push(x: number, y: number, radius: number, force: number): void {
    const em = this.opts.size;
    for (const p of this.pieces) p.rod.push(x / em, y / em, radius / em, force / em);
  }

  /**
   * Advance the whole line. `t` is seconds since the summon began; each glyph
   * gets its own start so the word assembles left to right.
   *
   * While a piece is still travelling it is heavy and only loosely remembers
   * its bends. As it arrives the crimps come back AND the pull toward home goes
   * hard — that second part matters more than it looks. A rope that only
   * half-remembers where it belongs will find a pose that satisfies every
   * length and bend constraint while sitting several percent of a cap height
   * off the letter, and sit there forever, because the constraints outvote a
   * gentle pull. Driving `home` to near 1 at the end of the ramp makes the
   * letterform the one fixed point available, so it lands on it exactly.
   */
  step(dt: number, t: number, cfg: { stagger?: number; rise?: number; gravity?: number } = {}): void {
    const stagger = cfg.stagger ?? 0.16;
    const rise = cfg.rise ?? 1.25;
    const grav = cfg.gravity ?? -2.2;
    const sub = Math.min(3, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / sub;
    for (const p of this.pieces) {
      const t0 = p.glyph * stagger;
      const raw = (t - t0) / rise;
      const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
      const e = k * k * (3 - 2 * k);          // smoothstep
      const home = 0.015 + Math.pow(e, 2.6) * 0.85;
      const bend = 0.25 + e * 0.75;
      const g = grav * (1 - e) * (1 - e);
      for (let s = 0; s < sub; s++) {
        p.rod.step({ dt: h, gravity: g, damp: 0.965, home, bend, iters: 5 });
      }
    }
  }

  /**
   * The held state: every piece under the same conditions. Home is loose here
   * on purpose — the word has already landed, so the only job left is to be
   * springy enough that a cursor or a blast visibly disturbs it.
   */
  simulate(dt: number, cfg: { home?: number; bend?: number; gravity?: number; absorb?: number } = {}): void {
    const sub = Math.min(3, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / sub;
    const o = { dt: h, gravity: cfg.gravity ?? 0, damp: 0.94,
                home: cfg.home ?? 0.10, bend: cfg.bend ?? 1, iters: 5,
                absorb: cfg.absorb ?? 0.88 };
    for (const p of this.pieces) for (let s = 0; s < sub; s++) p.rod.step(o);
  }

  /** A gentle draught, for the hold after the word has arrived. */
  breathe(t: number, amount = 0.0022): void {
    for (const p of this.pieces) {
      const rod = p.rod;
      const ph = p.u * 6.0;
      const a = Math.sin(t * 1.1 + ph) * amount + Math.sin(t * 2.7 + ph * 1.7) * amount * 0.4;
      for (let i = 0; i < rod.n; i++) {
        if (rod.pinned[i]) continue;
        const w = rod.n > 1 ? Math.sin((i / (rod.n - 1)) * Math.PI) : 1;
        rod.x[i] += a * w;
      }
    }
  }

  // ---- output ----------------------------------------------------------

  /**
   * The rod is simulated fine and drawn coarse.
   *
   * Physics wants beads closer together than the wire is thick, or the bends
   * go faceted and the rope stretches. The field renderer wants as few capsules
   * as it can get — a straight run of forty beads is one capsule, and the
   * silhouette is identical. So a run is extended while every bead it swallows
   * stays within a fraction of the wire's own radius of the chord, which drops
   * a word from ~850 capsules to ~150 with nothing visible lost.
   *
   * Past that there is no styling step at all. The field renderer already
   * fuses overlapping capsules with a smooth minimum and cross-fades their
   * inks, so `blend` is what gives the letters their swollen, bled edges — the
   * same code path that fuses a creature's shoulder into its arm.
   */
  capsules(out: Capsule[] = []): Capsule[] {
    out.length = 0;
    const em = this.opts.size;
    const rad = this.opts.gauge * 0.5 * em;
    const tol = this.opts.gauge * 0.5 * 0.22;   // in em, against the centreline
    for (const p of this.pieces) {
      const rod = p.rod;
      const z = rod.z * em;
      let a = 0;
      while (a < rod.n - 1) {
        let b = a + 1;
        while (b < rod.n - 1) {
          const c = b + 1;
          const dx = rod.x[c] - rod.x[a], dy = rod.y[c] - rod.y[a];
          const len = Math.hypot(dx, dy);
          if (len < 1e-9) break;
          let worst = 0;
          for (let i = a + 1; i < c; i++) {
            const e = Math.abs((rod.x[i] - rod.x[a]) * dy - (rod.y[i] - rod.y[a]) * dx) / len;
            if (e > worst) worst = e;
          }
          if (worst > tol) break;
          b = c;
        }
        out.push({
          a: v3(rod.x[a] * em, rod.y[a] * em, z),
          b: v3(rod.x[b] * em, rod.y[b] * em, z),
          r: rad, color: rod.color, part: rod.part,
        });
        a = b;
      }
    }
    for (const rv of this.rivets) {
      const z = rv.z * em;
      out.push({
        a: v3(rv.x * em, rv.y * em, z), b: v3(rv.x * em, rv.y * em, z),
        r: rv.r * em, color: rv.color, part: 'rivet',
      });
    }
    return out;
  }

  /** Reuses one array across frames — do not hold on to it. */
  frame(): Capsule[] { return this.capsules(this.caps); }
}

/** One-liner for the common case. */
export function setWire(text: string, opts: Partial<SetOptions> = {}): WireText {
  return new WireText(text, opts);
}
