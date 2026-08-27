// PIT WIRE — an alphabet held as bending instructions, not as outlines.
//
// The source is a plate of brass wire inlaid into wood, 1740: numerals only,
// so the letters here are an extrapolation. What the plate actually dictates:
//
//   CIRCLE OR LINE, NOTHING BETWEEN. Wire is bent round a mandrel or left
//   alone. Every curve on the plate is a true circle — the 6's bulb, the 5's
//   bowl, the 0 — and every straight is dead straight, the 7's diagonal, the
//   4's bar. There are no polite transitional curves anywhere, and the joint
//   between a circle and a line is abrupt.
//
//   THE SMITH OVERSHOOTS. The 4's stem runs well past its own crossbar top and
//   bottom. Ends stop where the wire ran out, not where a designer would put
//   them, and they stop bluntly — the cut face of the wire, a hemisphere.
//
//   IT WRAPS MOST OF THE WAY ROUND. The 5's bowl is a circle with a gap on the
//   left; the 0 is a ring with a seam; the 9's bowl never closes. Nothing is
//   sealed, and terminals often curl a further quarter turn before stopping.
//
//   NOTHING IS THE SAME HEIGHT. The 4 is visibly shorter than the 6, the 7 is
//   taller than both, and nothing sits square on a baseline. That unevenness
//   is applied per glyph at layout time, not written in here.
//
// The one thing the plate does NOT have is a shaky line. The strokes are
// smooth and confident; the irregularity is all in the forms, in the sizes and
// in the seating. So `hand` in the typesetter moves and scales whole glyphs and
// barely touches the line itself.
//
// Everything below is em space: baseline y=0, cap height y=1, ink from x=0.

import { Node, Strand, arc, deg } from './rod';

export interface Glyph {
  adv: number;
  strands: Strand[];
  /** Nails through the inlay. Radius is a multiple of the wire gauge. */
  rivets?: { x: number; y: number; r?: number }[];
}

const MITRE = 0.07;   // hammered hard against the pliers
const EASY = 0.55;
const OVER = 0.055;   // how far a stem runs past where it had to stop

/** side bearing, both sides */
const SB = 0.085;
const gl = (w: number, strands: Strand[], rivets?: Glyph['rivets']): Glyph =>
  ({ adv: w + SB * 2, strands, rivets });

const s = (nodes: Node[], z = 0): Strand => ({ nodes, z });

/** A true circle, or a piece of one. Every curve in this face is made here. */
const ring = (cx: number, cy: number, r: number, a0: number, a1: number, n?: number) =>
  arc(cx, cy, r, r, deg(a0), deg(a1), n ?? Math.max(10, Math.round(Math.abs(a1 - a0) / 9)));

export const CAP = 1.0;
/** Wire gauge as a fraction of cap height, measured off the plate. */
export const GAUGE = 0.078;

export const GLYPHS: Record<string, Glyph> = {
  ' ': { adv: 0.32, strands: [] },

  // ---- straight-sided caps: dead lines, hammered corners, overshoot -------

  A: gl(0.68, [
    s([{ x: 0.02, y: -OVER }, { x: 0.35, y: 1.01, round: MITRE }, { x: 0.68, y: -OVER }]),
    s([{ x: 0.07, y: 0.29 }, { x: 0.63, y: 0.29 }], 0.006),
  ]),

  E: gl(0.52, [
    s([{ x: 0.52, y: 1 }, { x: 0, y: 1, round: MITRE }, { x: 0, y: 0, round: MITRE }, { x: 0.54, y: 0 }]),
    s([{ x: -0.03, y: 0.53 }, { x: 0.43, y: 0.53 }], 0.006),
  ]),

  F: gl(0.52, [
    s([{ x: 0.53, y: 1 }, { x: 0, y: 1, round: MITRE }, { x: 0, y: -OVER }]),
    s([{ x: -0.03, y: 0.55 }, { x: 0.41, y: 0.55 }], 0.006),
  ]),

  H: gl(0.62, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s([{ x: 0.62, y: -OVER }, { x: 0.62, y: 1 + OVER }]),
    s([{ x: -0.03, y: 0.53 }, { x: 0.65, y: 0.53 }], 0.006),
  ]),

  I: gl(0.03, [s([{ x: 0.015, y: -OVER }, { x: 0.015, y: 1 + OVER }])]),

  K: gl(0.60, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s([{ x: 0.60, y: 1.01 }, { x: 0.03, y: 0.42, round: MITRE }, { x: 0.62, y: -OVER }], 0.006),
  ]),

  L: gl(0.50, [
    s([{ x: 0, y: 1 + OVER }, { x: 0, y: 0, round: MITRE }, { x: 0.52, y: 0 }]),
  ]),

  M: gl(0.80, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1.01, round: MITRE }, { x: 0.40, y: 0.26, round: 0.09 },
       { x: 0.80, y: 1.01, round: MITRE }, { x: 0.80, y: -OVER }]),
  ]),

  N: gl(0.62, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1.01, round: MITRE }, { x: 0.62, y: -0.01, round: MITRE },
       { x: 0.62, y: 1 + OVER }]),
  ]),

  T: gl(0.58, [
    s([{ x: 0, y: 1 }, { x: 0.58, y: 1 }]),
    s([{ x: 0.29, y: 1.03 }, { x: 0.29, y: -OVER }], 0.006),
  ]),

  V: gl(0.64, [
    s([{ x: 0, y: 1.02 }, { x: 0.32, y: -0.01, round: 0.08 }, { x: 0.64, y: 1.02 }]),
  ]),

  W: gl(0.90, [
    s([{ x: 0, y: 1.02 }, { x: 0.22, y: -0.01, round: 0.08 }, { x: 0.45, y: 0.64, round: 0.10 },
       { x: 0.68, y: -0.01, round: 0.08 }, { x: 0.90, y: 1.02 }]),
  ]),

  X: gl(0.62, [
    s([{ x: -0.02, y: 1.02 }, { x: 0.64, y: -0.02 }]),
    s([{ x: -0.02, y: -0.02 }, { x: 0.64, y: 1.02 }], 0.009),
  ]),

  Y: gl(0.62, [
    s([{ x: 0, y: 1.02 }, { x: 0.31, y: 0.45, round: 0.10 }, { x: 0.62, y: 1.02 }]),
    s([{ x: 0.31, y: 0.50 }, { x: 0.31, y: -OVER }], 0.006),
  ]),

  Z: gl(0.58, [
    s([{ x: 0, y: 1 }, { x: 0.58, y: 1, round: MITRE }, { x: 0, y: 0, round: MITRE }, { x: 0.60, y: 0 }]),
  ]),

  // ---- round caps: true circles, wrapped most of the way ------------------

  // the seam is the point — a ring of wire never quite closes
  O: gl(0.86, [s(ring(0.43, 0.455, 0.43, 100, -254))]),

  Q: gl(0.86, [
    s(ring(0.43, 0.455, 0.43, 100, -254)),
    s([{ x: 0.50, y: 0.21 }, { x: 0.93, y: -0.17 }], 0.009),
  ]),

  C: gl(0.82, [
    { nodes: ring(0.43, 0.455, 0.43, 52, 300), curlB: { turn: deg(-58), r: 0.24, decay: 0.85 } },
  ]),

  G: gl(0.86, [
    s([
      ...ring(0.43, 0.455, 0.43, 56, 350),
      { x: 0.86, y: 0.52, round: EASY },
      { x: 0.47, y: 0.52 },
    ]),
  ]),

  // stem plus circles hung off it, exactly as the plate's 10 hangs its bowl
  B: gl(0.58, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s(ring(0.23, 0.775, 0.225, 154, -154)),
    s(ring(0.26, 0.255, 0.26, 154, -154)),
  ]),

  D: gl(0.62, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s(ring(0.10, 0.49, 0.51, 101, -101)),
  ]),

  P: gl(0.58, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s(ring(0.245, 0.745, 0.245, 152, -152)),
  ]),

  R: gl(0.62, [
    s([{ x: 0, y: -OVER }, { x: 0, y: 1 + OVER }]),
    s(ring(0.24, 0.75, 0.24, 152, -152)),
    s([{ x: 0.11, y: 0.51 }, { x: 0.64, y: -OVER }], 0.006),
  ]),

  // two circles and a straight spine between them
  S: gl(0.62, [
    s([
      ...ring(0.31, 0.725, 0.28, -38, 202),
      ...ring(0.31, 0.265, 0.29, 22, -202),
    ]),
  ]),

  J: gl(0.52, [
    { nodes: [{ x: 0.52, y: 1 + OVER }, { x: 0.52, y: 0.28 }],
      curlB: { turn: deg(-172), r: 0.22, decay: 1 } },
  ]),

  U: gl(0.62, [
    s([
      { x: 0, y: 1 + OVER }, { x: 0, y: 0.31 },
      ...ring(0.31, 0.31, 0.31, 180, 360),
      { x: 0.62, y: 1 + OVER },
    ]),
  ]),

  // ---- numerals, straight off the plate ----------------------------------

  '0': gl(0.80, [s(ring(0.40, 0.44, 0.40, 96, -258))]),

  // the plate's 1 is an arch, not a stroke: two straight legs and a half circle
  '1': gl(0.54, [
    s([
      { x: 0, y: 0.01 }, { x: 0.02, y: 0.55 },
      ...ring(0.27, 0.55, 0.25, 180, 0),
      { x: 0.52, y: 0.54 }, { x: 0.56, y: 0.05 },
    ]),
  ]),

  // shoulder circle, straight diagonal, straight base bar, curled ear
  '2': gl(0.62, [
    { nodes: [
        ...ring(0.31, 0.675, 0.30, 168, -38),
        { x: 0.02, y: 0.03, round: 0.26 }, { x: 0.62, y: 0.03 },
      ],
      curlA: { turn: deg(-96), r: 0.11, decay: 0.7 } },
  ]),

  '3': gl(0.58, [
    { nodes: [
        ...ring(0.27, 0.755, 0.24, 156, -58),
        ...ring(0.29, 0.275, 0.28, 56, -178),
      ],
      curlA: { turn: deg(-44), r: 0.12, decay: 0.8 },
      curlB: { turn: deg(-64), r: 0.15, decay: 0.8 } },
  ]),

  // three straight pieces butted, the stem overshooting hard both ways
  '4': gl(0.64, [
    s([{ x: 0.46, y: 0.98 }, { x: 0.02, y: 0.24, round: 0.09 }, { x: 0.64, y: 0.24 }]),
    s([{ x: 0.46, y: 1.06 }, { x: 0.46, y: -0.06 }], 0.009),
  ]),

  // two pieces and a nail, like the plate
  '5': gl(0.58, [
    { nodes: ring(0.30, 1.26, 0.43, 234, 306),
      curlB: { turn: deg(-152), r: 0.10, decay: 0.7 } },
    s(ring(0.30, 0.285, 0.285, 104, -196)),
  ], [{ x: 0.05, y: 0.60, r: 0.60 }]),

  // one long shallow sweep that becomes a full circular bulb
  '6': gl(0.58, [
    s([
      { x: 0.54, y: 1.02 }, { x: 0.22, y: 0.62, round: 1 },
      ...ring(0.29, 0.27, 0.27, 150, -186),
    ]),
  ]),

  '7': gl(0.64, [
    s([{ x: 0, y: 0.99 }, { x: 0.64, y: 0.99, round: 0.08 }, { x: 0.15, y: -0.04 }]),
  ]),

  '8': gl(0.58, [
    s([
      ...ring(0.29, 0.75, 0.26, -78, 258),
      ...ring(0.29, 0.245, 0.245, 102, 438),
    ]),
  ]),

  // full circular bulb, long dead-straight tail
  '9': gl(0.58, [
    s([
      ...ring(0.30, 0.735, 0.26, 8, 336),
      { x: 0.02, y: -0.02 },
    ]),
  ]),

  // ---- marks --------------------------------------------------------------

  '.': gl(0.05, [], [{ x: 0.025, y: 0.05 }]),
  ',': gl(0.10, [s([{ x: 0.09, y: 0.11 }, { x: 0, y: -0.15 }])]),
  ':': gl(0.05, [], [{ x: 0.025, y: 0.05 }, { x: 0.025, y: 0.54 }]),
  '-': gl(0.36, [s([{ x: 0, y: 0.47 }, { x: 0.36, y: 0.47 }])]),
  "'": gl(0.05, [s([{ x: 0.06, y: 1.02 }, { x: 0, y: 0.72 }])]),
  '!': gl(0.05, [s([{ x: 0.025, y: 1.02 }, { x: 0.025, y: 0.24 }])], [{ x: 0.025, y: 0.05 }]),
  '?': gl(0.52, [
    { nodes: [
        ...ring(0.26, 0.745, 0.25, 182, -34),
        { x: 0.26, y: 0.30 },
      ],
      curlA: { turn: deg(-54), r: 0.10, decay: 0.8 } },
  ], [{ x: 0.26, y: 0.05 }]),
};

/** Everything the face can set. Anything else falls back to a blank advance. */
export const COVERAGE = Object.keys(GLYPHS).join('');
