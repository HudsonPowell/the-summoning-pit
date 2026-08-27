// PIT WIRE — an alphabet cut out of the 1740 plate.
//
// Earlier versions of this file drew letters in the plate's manner. They were
// wrong in a way that was hard to argue with: a rule set is a description of a
// hand, and a description is not the hand. So nothing here is drawn. The plate
// is traced into lengths of centreline (see farm/type/extract.py -> plate.ts),
// and every glyph is those lengths, cut at a stated point and put somewhere —
// the same pieces of brass, moved about.
//
// What that buys is not authenticity for its own sake. It is that the parts
// carry things no rule captures: the way the 1's arch is a hair lopsided, the
// slight bow in a run the smith called straight, the exact tightness of the 7's
// mitre, the flick where a leg was cut. Those survive being cut and reused.
//
// The parts bin, and what each is good for:
//
//   one.arch     the 1 — a full n. Arches for n m h r, flipped for u.
//   one.arch.b   the second 1, narrower. The other arch.
//   ten          an n whose right leg runs on down, plus the b's bowl.
//   six          a long shallow sweep, and a small tight bulb.
//   nine         a bulb with a long straight tail: g, a, q, 9.
//   ring         the 0. A true circle with a seam: o, c, e.
//   five.bowl    a bowl open at one side, with two cut ends.
//   five.crook   a shallow arc that hooks over: f t j r.
//   seven        bar, mitre, long diagonal — two thirds of a z, and every k v w x y.
//   four.bent    a dead straight diagonal and a dead straight bar.
//   four.stem    a stem. bar.tall / bar.short, shorter ones.
//   two three eight   bowls and shoulders, for s and the figures.
//
// Ranges are arc length along the piece, 0..1. Run `python3 farm/type/_atlas.py`
// to print the plate with those numbers on it.

import { Strand } from './rod';
import { Cut, resolve, strandOf } from './cuts';
import { PLATE_GAUGE } from './plate';

export interface Glyph {
  adv: number;
  strands: Strand[];
  rivets?: { x: number; y: number; r?: number }[];
}

export const CAP = 1.0;
export const XH = 0.70;      // large, because everything on the plate is
export const ASC = 1.0;
export const DESC = -0.26;
export const GAUGE = PLATE_GAUGE;

const SB = 0.085;            // side bearing, both sides

// --- scales, all derived from what the pieces actually measure -------------
const ARCH = 0.70 / 0.85;    // one.arch / one.arch.b -> x-height
const ARCH_C = 1.00 / 0.85;  // ...and to cap height
const TEN = 0.70 / 0.88;
const RING = 0.70 / 0.29;    // the 0 -> an o
const RING_C = 1.00 / 0.29;
const BOWL = 0.60 / 0.38;    // ten#1 -> a lowercase bowl
const BOWL_C = 0.56 / 0.38;
const SIXB = 0.56 / 0.37;    // six#1 -> a lowercase bowl
const STEM_A = 1.00 / 0.68;  // four.stem -> an ascender
const STEM_X = 0.70 / 0.48;  // bar.short -> an x-height stem
const DIAG = 0.70 / 0.44;    // four.bent#0 -> an x-height diagonal
const DIAG_C = 1.00 / 0.44;
const BAR = 0.44 / 0.35;     // four.bent#1 -> a crossbar
const SEV = 0.70 / 0.95;     // seven, dip trimmed -> x-height
const SEV_C = 1.00 / 0.95;
const CROOK = 0.62 / 0.36;

/**
 * Resolve a glyph's cuts, then shift the lot so the ink starts at x = 0.
 *
 * The shift is applied to the whole group at once, which is the only way a
 * figure kept whole — the 4's three butted pieces, the 5's crook above its
 * bowl — keeps the spacing the smith left between them.
 */
function G(cuts: Cut[], rivets?: { x: number; y: number; r?: number }[]): Glyph {
  const pts = cuts.map(resolve);
  let x0 = Infinity, x1 = -Infinity;
  for (const s of pts) for (const p of s) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
  if (!isFinite(x0)) { x0 = 0; x1 = 0; }
  const dx = SB - x0;
  return {
    adv: (x1 - x0) + SB * 2,
    strands: pts.map((s, i) => ({
      nodes: s.map(p => ({ x: p.x + dx, y: p.y })), raw: true, z: cuts[i].z ?? 0,
    })),
    rivets: rivets?.map(r => ({ ...r, x: r.x + dx })),
  };
}

/** A figure kept exactly as the plate has it, only slid left to x = 0. */
const whole = (p: string, n: number, rivets?: { x: number; y: number; r?: number }[]) =>
  G(Array.from({ length: n }, (_, i) => ({ p, i, a: 'none' as const, z: i * 0.004 })), rivets);

export const GLYPHS: Record<string, Glyph> = {
  ' ': { adv: 0.34, strands: [] },

  // ====================================================================
  // FIGURES — the plate itself, untouched. The 7 still dips below the
  // line and the 4 is still shorter than the 6, because they are the
  // same wire.
  // ====================================================================

  '1': whole('one.arch', 1),
  '2': whole('two', 1),
  '3': whole('three', 4),
  '4': G([{ p: 'four.bent', i: 0, a: 'none' }, { p: 'four.bent', i: 1, a: 'none' },
          { p: 'four.stem', i: 0, a: 'none', z: 0.009 }],
         [{ x: 3.742, y: 0.885, r: 0.55 }]),
  '5': G([{ p: 'five.crook', i: 0, a: 'none' }, { p: 'five.bowl', i: 0, a: 'none' }],
         [{ x: 4.347, y: 0.702, r: 0.55 }]),
  '6': whole('six', 3),
  '7': whole('seven', 1),
  '8': G([
    { p: 'eight', i: 0, s: 1.18, a: 'cb', at: [0.24, 0.46] },
    { p: 'eight', i: 0, fy: true, fx: true, s: 1.30, a: 'ct', at: [0.24, 0.48], z: 0.006 },
  ]),
  '9': whole('nine', 1),
  '0': G([{ p: 'ring', s: 0.86 / 0.29, a: 'bl', at: [0, 0.02] }]),

  // ====================================================================
  // LOWERCASE — the plate's own vocabulary, so almost every letter is a
  // whole piece with at most one companion.
  // ====================================================================

  // the 1, entire
  n: G([{ p: 'one.arch', s: ARCH, a: 'bl', at: [0, 0] }]),

  // the 1 twice, sharing a leg, exactly as wire laid in a groove would
  m: G([
    { p: 'one.arch', s: ARCH, a: 'bl', at: [0, 0] },
    { p: 'one.arch.b', from: 0.14, s: ARCH, a: 'bl', at: [0.64, 0], z: 0.006 },
  ]),

  // an ascender with the 1's shoulder hung on it
  h: G([
    { p: 'four.stem', s: STEM_A, a: 'bl', at: [0, 0] },
    { p: 'one.arch', from: 0.24, s: ARCH, a: 'bl', at: [0.01, 0], z: 0.006 },
  ]),

  // the 1 upside down
  u: G([{ p: 'one.arch', fy: true, s: ARCH, a: 'bl', at: [0, 0] }]),

  // the 1's shoulder, snipped where it starts to come back down
  r: G([
    { p: 'bar.short', s: STEM_X, a: 'bl', at: [0, 0] },
    { p: 'one.arch', from: 0.24, to: 0.60, s: ARCH, a: 'bl', at: [0.01, 0.26], z: 0.006 },
  ]),

  // the 10's b, put back together on a proper ascender
  b: G([
    { p: 'four.stem', s: STEM_A, a: 'bl', at: [0, 0] },
    { p: 'ten', i: 1, s: BOWL, a: 'cl', at: [0.02, 0.30], z: 0.006 },
  ]),
  d: G([
    { p: 'four.stem', s: STEM_A, a: 'br', at: [0.35, 0] },
    { p: 'ten', i: 1, fx: true, s: BOWL, a: 'cr', at: [0.33, 0.30], z: 0.006 },
  ]),
  p: G([
    { p: 'four.stem', s: 0.96 / 0.68, a: 'bl', at: [0, DESC] },
    { p: 'ten', i: 1, s: BOWL, a: 'cl', at: [0.02, 0.30], z: 0.006 },
  ]),
  q: G([
    { p: 'four.stem', s: 0.96 / 0.68, a: 'br', at: [0.35, DESC] },
    { p: 'ten', i: 1, fx: true, s: BOWL, a: 'cr', at: [0.33, 0.30], z: 0.006 },
  ]),

  // the 9, entire: a bulb with a long tail already attached
  g: G([{ p: 'nine', s: 0.96 / 1.06, a: 'bl', at: [0, DESC] }]),

  // the 6's bulb, turned to close against a stem
  a: G([
    { p: 'six', i: 1, fx: true, s: SIXB, a: 'bl', at: [0, 0] },
    { p: 'bar.short', s: STEM_X, a: 'br', at: [0.40, 0], z: 0.006 },
  ]),

  // the 0
  o: G([{ p: 'ring', s: RING, a: 'bl', at: [0, 0] }]),

  // the 0 with the right-hand quarter cut out
  c: G([{ p: 'ring', from: 0.17, to: 0.95, s: RING, a: 'bl', at: [0, 0] }]),

  // ...and the same, with the 4's crossbar laid across it
  e: G([
    { p: 'ring', from: 0.19, to: 1, s: RING, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.62 / 0.35, a: 'cl', at: [0.01, 0.36], z: 0.006 },
  ]),

  // the 5's crook, which is what the wire does when it runs out of letter
  f: G([
    { p: 'four.stem', s: 0.86 / 0.68, a: 'bl', at: [0.12, 0] },
    { p: 'five.crook', s: 0.52, a: 'e', at: [0.13, 0.84], z: 0.006 },
    { p: 'four.bent', i: 1, s: BAR, a: 'cl', at: [-0.03, 0.66], z: 0.009 },
  ]),
  t: G([
    { p: 'four.stem', s: 0.92 / 0.68, a: 'bl', at: [0.14, -0.02] },
    { p: 'four.bent', i: 1, s: BAR, a: 'cl', at: [-0.02, 0.68], z: 0.006 },
  ]),
  j: G([
    { p: 'bar.short', s: 0.62 / 0.48, a: 'bl', at: [0.20, 0.02] },
    { p: 'five.crook', s: 0.48, a: 's', at: [0.21, 0.05], z: 0.006 },
  ], [{ x: 0.20, y: 0.86, r: 0.55 }]),

  i: G([{ p: 'bar.short', s: STEM_X, a: 'bl', at: [0, 0] }], [{ x: 0.01, y: 0.86, r: 0.55 }]),
  l: G([{ p: 'four.stem', s: STEM_A, a: 'bl', at: [0, 0] }]),

  k: G([
    { p: 'four.stem', s: STEM_A, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 0, fx: true, s: 0.40 / 0.44, a: 'tr', at: [0.44, 0.70], z: 0.006 },
    { p: 'four.bent', i: 0, fx: true, s: 0.34 / 0.44, a: 'tl', at: [0.09, 0.34], z: 0.009 },
  ]),

  // the 3's two bowls, the top one turned over
  s: G([
    { p: 'three', i: 0, fx: true, s: 1.24, a: 'tl', at: [0, 0.70] },
    { p: 'three', i: 1, s: 1.24, a: 'bl', at: [0, 0], z: 0.006 },
  ]),

  // the 7's long diagonal, twice
  v: G([
    { p: 'seven', from: 0.06, to: 0.62, fx: true, s: 0.60, a: 'br', at: [0.30, 0] },
    { p: 'seven', from: 0.06, to: 0.62, s: 0.60, a: 'bl', at: [0.30, 0], z: 0.006 },
  ]),
  w: G([
    { p: 'seven', from: 0.06, to: 0.62, fx: true, s: 0.58, a: 'br', at: [0.28, 0] },
    { p: 'seven', from: 0.06, to: 0.62, s: 0.58, a: 'bl', at: [0.28, 0], z: 0.006 },
    { p: 'seven', from: 0.06, to: 0.62, fx: true, s: 0.58, a: 'br', at: [0.84, 0], z: 0.009 },
    { p: 'seven', from: 0.06, to: 0.62, s: 0.58, a: 'bl', at: [0.84, 0], z: 0.012 },
  ]),
  x: G([
    { p: 'four.bent', i: 0, s: DIAG, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 0, fx: true, s: DIAG, a: 'br', at: [0.60, 0], z: 0.009 },
  ]),
  y: G([
    { p: 'seven', from: 0.06, to: 0.62, s: 0.96 / 1.05, a: 'bl', at: [0.14, DESC] },
    { p: 'four.bent', i: 0, fx: true, s: 0.46 / 0.44, a: 'tl', at: [0, 0.70], z: 0.009 },
  ]),

  // the 7 IS the top two thirds of a z
  z: G([
    { p: 'seven', from: 0.08, s: SEV, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.50 / 0.35, a: 'bl', at: [-0.02, 0], z: 0.006 },
  ]),

  // ====================================================================
  // CAPS — the same bin, opened wider
  // ====================================================================

  A: G([
    { p: 'seven', from: 0.06, to: 0.66, fx: true, s: 0.88, a: 'br', at: [0.36, 0] },
    { p: 'seven', from: 0.06, to: 0.66, s: 0.88, a: 'bl', at: [0.36, 0], z: 0.006 },
    { p: 'four.bent', i: 1, s: 0.56 / 0.35, a: 'cl', at: [0.06, 0.27], z: 0.009 },
  ]),
  B: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'ten', i: 1, s: 0.50 / 0.38, a: 'cl', at: [0.02, 0.745] },
    { p: 'six', i: 1, fy: true, s: 0.54 / 0.37, a: 'cl', at: [0.02, 0.26], z: 0.006 },
  ]),
  C: G([{ p: 'ring', from: 0.17, to: 0.95, s: RING_C, a: 'bl', at: [0, 0] }]),
  D: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'ring', from: 0.62, to: 1.12, fx: true, s: RING_C, sy: RING_C, a: 'cl', at: [0.01, 0.50], z: 0.006 },
  ]),
  E: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.56 / 0.35, a: 'cl', at: [-0.02, 1.0], z: 0.006 },
    { p: 'three', i: 2, s: 0.48 / 0.51, a: 'cl', at: [-0.02, 0.52], z: 0.009 },
    { p: 'four.bent', i: 1, s: 0.58 / 0.35, a: 'cl', at: [-0.02, 0.0], z: 0.012 },
  ]),
  F: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.56 / 0.35, a: 'cl', at: [-0.02, 1.0], z: 0.006 },
    { p: 'three', i: 2, s: 0.46 / 0.51, a: 'cl', at: [-0.02, 0.55], z: 0.009 },
  ]),
  G: G([
    { p: 'ring', from: 0.17, to: 0.99, s: RING_C, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.42 / 0.35, a: 'cr', at: [1.02, 0.50], z: 0.006 },
  ]),
  H: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'four.stem.b', s: 1.47, a: 'bl', at: [0.62, 0] },
    { p: 'three', i: 2, s: 0.68 / 0.51, a: 'cl', at: [-0.03, 0.53], z: 0.009 },
  ]),
  I: G([{ p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] }]),
  J: G([
    { p: 'four.stem', s: 1.28 / 0.68, a: 'bl', at: [0.34, 0.02] },
    { p: 'five.crook', s: 0.72, a: 's', at: [0.35, 0.06], z: 0.006 },
  ]),
  K: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 0, fx: true, s: 0.56 / 0.44, a: 'tr', at: [0.60, 1.0], z: 0.006 },
    { p: 'four.bent', i: 0, fx: true, s: 0.48 / 0.44, a: 'tl', at: [0.07, 0.48], z: 0.009 },
  ]),
  L: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.54 / 0.35, a: 'cl', at: [-0.02, 0.0], z: 0.006 },
  ]),
  M: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'seven', from: 0.06, to: 0.62, fx: true, s: 0.62, a: 'tl', at: [0.01, 1.0], z: 0.006 },
    { p: 'seven', from: 0.06, to: 0.62, s: 0.62, a: 'tr', at: [0.72, 1.0], z: 0.009 },
    { p: 'four.stem.b', s: 1.47, a: 'bl', at: [0.72, 0], z: 0.012 },
  ]),
  N: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'seven', from: 0.06, to: 0.70, fx: true, s: 0.82, a: 'tl', at: [0, 1.0], z: 0.006 },
    { p: 'four.stem.b', s: 1.47, a: 'bl', at: [0.60, 0], z: 0.009 },
  ]),
  O: G([{ p: 'ring', s: RING_C, a: 'bl', at: [0, 0] }]),
  P: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'ten', i: 1, s: 0.54 / 0.38, a: 'cl', at: [0.02, 0.72], z: 0.006 },
  ]),
  Q: G([
    { p: 'ring', s: RING_C, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 0, s: 0.44 / 0.44, a: 'tl', at: [0.62, 0.34], z: 0.009 },
  ]),
  R: G([
    { p: 'four.stem', s: 1.47, a: 'bl', at: [0, 0] },
    { p: 'ten', i: 1, s: 0.52 / 0.38, a: 'cl', at: [0.02, 0.73], z: 0.006 },
    { p: 'four.bent', i: 0, s: 0.50 / 0.44, a: 'tl', at: [0.08, 0.50], z: 0.009 },
  ]),
  S: G([
    { p: 'three', i: 0, fx: true, s: 1.78, a: 'tl', at: [0, 1.0] },
    { p: 'three', i: 1, s: 1.78, a: 'bl', at: [0, 0], z: 0.006 },
  ]),
  T: G([
    { p: 'four.bent', i: 1, s: 0.62 / 0.35, a: 'cb', at: [0.31, 1.0] },
    { p: 'four.stem', s: 1.47, a: 'cb', at: [0.31, 0], z: 0.006 },
  ]),
  U: G([{ p: 'one.arch', fy: true, s: ARCH_C, a: 'bl', at: [0, 0] }]),
  V: G([
    { p: 'seven', from: 0.06, to: 0.66, fx: true, s: 0.86, a: 'br', at: [0.34, 0] },
    { p: 'seven', from: 0.06, to: 0.66, s: 0.86, a: 'bl', at: [0.34, 0], z: 0.006 },
  ]),
  W: G([
    { p: 'seven', from: 0.06, to: 0.66, fx: true, s: 0.82, a: 'br', at: [0.32, 0] },
    { p: 'seven', from: 0.06, to: 0.66, s: 0.82, a: 'bl', at: [0.32, 0], z: 0.006 },
    { p: 'seven', from: 0.06, to: 0.66, fx: true, s: 0.82, a: 'br', at: [0.94, 0], z: 0.009 },
    { p: 'seven', from: 0.06, to: 0.66, s: 0.82, a: 'bl', at: [0.94, 0], z: 0.012 },
  ]),
  X: G([
    { p: 'four.bent', i: 0, s: DIAG_C, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 0, fx: true, s: DIAG_C, a: 'br', at: [0.86, 0], z: 0.009 },
  ]),
  Y: G([
    { p: 'four.bent', i: 0, s: 0.50 / 0.44, a: 'bl', at: [0.02, 0.50] },
    { p: 'four.bent', i: 0, fx: true, s: 0.50 / 0.44, a: 'br', at: [0.88, 0.50], z: 0.006 },
    { p: 'bar.short', s: 0.54 / 0.48, a: 'cb', at: [0.45, -0.02], z: 0.009 },
  ]),
  Z: G([
    { p: 'seven', from: 0.08, s: SEV_C, a: 'bl', at: [0, 0] },
    { p: 'four.bent', i: 1, s: 0.62 / 0.35, a: 'bl', at: [-0.02, 0], z: 0.006 },
  ]),

  // ---- marks --------------------------------------------------------------

  '.': G([], [{ x: 0, y: 0.05, r: 0.55 }]),
  ':': G([], [{ x: 0, y: 0.05, r: 0.55 }, { x: 0, y: 0.50, r: 0.55 }]),
  ',': G([{ p: 'five.crook', from: 0.0, to: 0.35, s: 0.34, a: 'tr', at: [0.10, 0.10] }]),
  '-': G([{ p: 'four.bent', i: 1, s: 1.1, a: 'cl', at: [0, 0.42] }]),
  "'": G([{ p: 'bar.short', from: 0, to: 0.35, s: 0.9, a: 'ct', at: [0, 1.0] }]),
  '!': G([{ p: 'bar.short', from: 0.1, s: 1.62, a: 'bl', at: [0, 0.22] }], [{ x: 0.01, y: 0.05, r: 0.55 }]),
  '?': G([
    { p: 'two', from: 0.0, to: 0.42, s: 0.72, a: 'ct', at: [0.22, 1.0] },
    { p: 'bar.short', from: 0, to: 0.3, s: 0.9, a: 'ct', at: [0.22, 0.42], z: 0.006 },
  ], [{ x: 0.22, y: 0.05, r: 0.55 }]),
};

/**
 * The face is bicameral, so a missing glyph falls through to the other case
 * rather than to a blank. Set anything; get back whatever the plate can say.
 */
export function glyphFor(ch: string): Glyph | undefined {
  return GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()] ?? GLYPHS[ch.toUpperCase()];
}

export const COVERAGE = Object.keys(GLYPHS).join('');
export { strandOf };
