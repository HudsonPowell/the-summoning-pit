// PIT WIRE — an alphabet held as bending instructions, not as outlines.
//
// The source is a plate of brass wire inlaid into wood, 1740. It shows figures
// only, so everything here is extrapolated — but the plate is unusually strict
// about how it is made, and the whole face is those rules and nothing else:
//
//   R1  CIRCLE OR LINE, NOTHING BETWEEN. Wire is bent round a mandrel or left
//       alone. Every curve on the plate is a true circle — the 6's bulb, the
//       5's bowl, the 0 — and every straight is dead straight. There are no
//       transitional curves anywhere, and the join between the two is abrupt.
//
//   R2  TWO BENDS ONLY: the fullest arc the wire will take, or a hammered
//       mitre (the 7's apex, the 4's vertex). Nothing in between.
//
//   R3  ONE PIECE, AND THE STEM ROLLS INTO THE BOWL. This is the rule the
//       plate is most emphatic about and the easiest to miss. Look at the 10:
//       it is an n and a b, and the b's stem does not stop and hand over to a
//       separate ring — it runs down and rolls straight into a circle tangent
//       to itself. The 6 does it, the 9 does it, the 2 does it. A glyph is cut
//       into separate pieces only where one wire genuinely could not reach:
//       the 4's stem crossing its own bar, the 5's crook above its bowl.
//
//   R4  SMALL ROUND PARTS ON LONG LIMBS. The 6's bulb is a third of its
//       height; the 9's tail is longer than its bowl is wide; the 10's b hangs
//       a small loop off a tall stem. Round parts are never generous.
//
//   R5  IT WRAPS PAST WHERE IT SHOULD AND STOPS SHORT OF CLOSING. Loops go
//       round some 340 degrees and leave a seam. The 9's bowl never closes,
//       the 0 has a visible gap. Nothing is sealed.
//
//   R6  THE SMITH OVERSHOOTS. The 4's stem runs well past its own crossbar,
//       top and bottom. Free ends stop where the wire ran out, bluntly.
//
//   R7  NOTHING IS THE SAME HEIGHT. The 4 is a head shorter than the 6, the 7
//       overtops both. Applied per glyph at layout time, not written in here.
//
// The one thing the plate does NOT have is a shaky line. The strokes are
// smooth and confident; all the irregularity is in the forms, the sizes and
// the seating.
//
// Two cases, because the plate's figures are lowercase in spirit — the 1 IS an
// n, the 10 IS an n beside a b, the 0 IS an o. So the lowercase is the direct
// extrapolation and the caps are the ones that had to be argued for.
//
// Em space: baseline y=0, cap height y=1, x-height 0.60, ink from x=0.

import { Node, Strand, arc, deg } from './rod';

export interface Glyph {
  adv: number;
  strands: Strand[];
  /** Nails through the inlay. Radius is a multiple of the wire gauge. */
  rivets?: { x: number; y: number; r?: number }[];
}

const MITRE = 0.07;   // hammered hard against the pliers
const EASY = 0.55;
const OV = 0.07;      // R6: how far a free end runs past where it had to stop
const SEAM = 344;     // R5: degrees a loop turns before it gives up

export const CAP = 1.0;
export const XH = 0.60;
export const ASC = 1.02;
export const DESC = -0.26;
/** Wire gauge as a fraction of cap height, measured off the plate. */
export const GAUGE = 0.078;

/** side bearing, both sides */
const SB = 0.085;
const gl = (w: number, strands: Strand[], rivets?: Glyph['rivets']): Glyph =>
  ({ adv: w + SB * 2, strands, rivets });

const s = (nodes: Node[], z = 0): Strand => ({ nodes, z });

/** R1: a true circle, or a piece of one. Every curve in this face is made here. */
const ring = (cx: number, cy: number, r: number, a0: number, a1: number, n?: number) =>
  arc(cx, cy, r, r, deg(a0), deg(a1), n ?? Math.max(10, Math.round(Math.abs(a1 - a0) / 9)));

/**
 * R3, as a function. A vertical stem at x0 arrives at height cy and rolls into
 * a circle of radius r tangent to it, on the given side, continuing in the
 * direction it was already travelling — so the tangent carries through and the
 * wire never has to be cut. It comes back round to within a seam of where it
 * started.
 *
 * Append it straight after the stem's last node and the two are one piece.
 */
const roll = (
  x0: number, cy: number, r: number,
  side: 'R' | 'L', going: 'up' | 'down', sweep = SEAM,
): Node[] => {
  // the tangent point sits at 180° on a circle to the right, 0° on one to the left
  const start = side === 'R' ? 180 : 0;
  // at either tangent point one sense of travel is up and the other is down
  const forward = (side === 'R') === (going === 'up') ? -1 : 1;
  const cx = side === 'R' ? x0 + r : x0 - r;
  return ring(cx, cy, r, start, start + forward * sweep);
};

export const GLYPHS: Record<string, Glyph> = {
  ' ': { adv: 0.32, strands: [] },

  // ======================================================================
  // CAPS — the same rules, argued onto a skeleton the plate never shows
  // ======================================================================

  A: gl(0.68, [
    s([{ x: 0.02, y: -OV }, { x: 0.35, y: 1.01, round: MITRE }, { x: 0.68, y: -OV }]),
    s([{ x: 0.04, y: 0.27 }, { x: 0.66, y: 0.27 }], 0.006),   // R6: past both legs
  ]),

  // one wire: up the stem, roll into the lower bowl, keep going up, roll into
  // the upper one. Not a post with two rings butted against it.
  B: gl(0.60, [
    s([
      { x: 0, y: -OV }, { x: 0, y: 0.25 },
      ...roll(0, 0.25, 0.28, 'R', 'up'),
      { x: 0, y: 0.76 },
      ...roll(0, 0.76, 0.235, 'R', 'up'),
    ]),
  ]),

  C: gl(0.82, [
    { nodes: ring(0.43, 0.455, 0.43, 54, 302),
      curlA: { turn: deg(30), r: 0.26, decay: 1 },
      curlB: { turn: deg(-52), r: 0.22, decay: 0.85 } },
  ]),

  D: gl(0.62, [
    s([
      { x: 0, y: -OV }, { x: 0, y: 1.0 },
      ...ring(0.02, 0.49, 0.51, 90, -90),
      { x: -0.02, y: -0.01 },
    ]),
  ]),

  E: gl(0.54, [
    s([{ x: 0.55, y: 1 }, { x: 0, y: 1, round: MITRE }, { x: 0, y: 0, round: MITRE }, { x: 0.58, y: 0 }]),
    s([{ x: -0.05, y: 0.53 }, { x: 0.44, y: 0.53 }], 0.006),
  ]),

  F: gl(0.54, [
    s([{ x: 0.56, y: 1 }, { x: 0, y: 1, round: MITRE }, { x: 0, y: -OV }]),
    s([{ x: -0.05, y: 0.56 }, { x: 0.42, y: 0.56 }], 0.006),
  ]),

  G: gl(0.86, [
    s([
      ...ring(0.43, 0.455, 0.43, 56, 350),
      { x: 0.88, y: 0.52, round: EASY },
      { x: 0.44, y: 0.52 },
    ]),
  ]),

  H: gl(0.62, [
    s([{ x: 0, y: -OV }, { x: 0, y: 1 + OV }]),
    s([{ x: 0.62, y: -OV }, { x: 0.62, y: 1 + OV }]),
    s([{ x: -0.05, y: 0.53 }, { x: 0.67, y: 0.53 }], 0.006),
  ]),

  I: gl(0.03, [s([{ x: 0.015, y: -OV }, { x: 0.015, y: 1 + OV }])]),

  J: gl(0.54, [
    { nodes: [{ x: 0.54, y: 1 + OV }, { x: 0.54, y: 0.30 }],
      curlB: { turn: deg(-186), r: 0.23, decay: 1 } },
  ]),

  K: gl(0.60, [
    s([{ x: 0, y: -OV }, { x: 0, y: 1 + OV }]),
    s([{ x: 0.61, y: 1.02 }, { x: 0.02, y: 0.42, round: MITRE }, { x: 0.63, y: -OV }], 0.006),
  ]),

  L: gl(0.50, [
    s([{ x: 0, y: 1 + OV }, { x: 0, y: 0, round: MITRE }, { x: 0.53, y: 0 }]),
  ]),

  M: gl(0.80, [
    s([{ x: 0, y: -OV }, { x: 0, y: 1.01, round: MITRE }, { x: 0.40, y: 0.24, round: 0.09 },
       { x: 0.80, y: 1.01, round: MITRE }, { x: 0.80, y: -OV }]),
  ]),

  N: gl(0.62, [
    s([{ x: 0, y: -OV }, { x: 0, y: 1.01, round: MITRE }, { x: 0.62, y: -0.01, round: MITRE },
       { x: 0.62, y: 1 + OV }]),
  ]),

  O: gl(0.86, [s(ring(0.43, 0.455, 0.43, 100, 100 - SEAM - 8))]),

  // R3: the stem runs up and rolls into the bowl, and stops there — the bowl
  // is what makes the top, exactly as the plate's b works.
  P: gl(0.60, [
    s([
      { x: 0, y: -OV }, { x: 0, y: 0.735 },
      ...roll(0, 0.735, 0.265, 'R', 'up'),
    ]),
  ]),

  Q: gl(0.86, [
    s(ring(0.43, 0.455, 0.43, 100, 100 - SEAM - 8)),
    s([{ x: 0.48, y: 0.20 }, { x: 0.94, y: -0.18 }], 0.009),
  ]),

  R: gl(0.64, [
    s([
      { x: 0, y: -OV }, { x: 0, y: 0.75 },
      ...roll(0, 0.75, 0.25, 'R', 'up'),
    ]),
    s([{ x: 0.08, y: 0.53 }, { x: 0.66, y: -OV }], 0.006),
  ]),

  S: gl(0.62, [
    s([
      ...ring(0.31, 0.725, 0.28, -38, 202),
      ...ring(0.31, 0.265, 0.29, 22, -202),
    ]),
  ]),

  T: gl(0.58, [
    s([{ x: 0, y: 1 }, { x: 0.58, y: 1 }]),
    s([{ x: 0.29, y: 1 + OV }, { x: 0.29, y: -OV }], 0.006),
  ]),

  U: gl(0.62, [
    s([
      { x: 0, y: 1 + OV }, { x: 0, y: 0.31 },
      ...ring(0.31, 0.31, 0.31, 180, 360),
      { x: 0.62, y: 1 + OV },
    ]),
  ]),

  V: gl(0.64, [
    s([{ x: 0, y: 1 + OV }, { x: 0.32, y: -0.01, round: 0.08 }, { x: 0.64, y: 1 + OV }]),
  ]),

  W: gl(0.90, [
    s([{ x: 0, y: 1 + OV }, { x: 0.22, y: -0.01, round: 0.08 }, { x: 0.45, y: 0.64, round: 0.10 },
       { x: 0.68, y: -0.01, round: 0.08 }, { x: 0.90, y: 1 + OV }]),
  ]),

  X: gl(0.62, [
    s([{ x: -0.03, y: 1.03 }, { x: 0.65, y: -0.03 }]),
    s([{ x: -0.03, y: -0.03 }, { x: 0.65, y: 1.03 }], 0.009),
  ]),

  Y: gl(0.62, [
    s([{ x: 0, y: 1 + OV }, { x: 0.31, y: 0.45, round: 0.10 }, { x: 0.62, y: 1 + OV }]),
    s([{ x: 0.31, y: 0.50 }, { x: 0.31, y: -OV }], 0.006),
  ]),

  Z: gl(0.58, [
    s([{ x: 0, y: 1 }, { x: 0.60, y: 1, round: MITRE }, { x: 0, y: 0, round: MITRE }, { x: 0.60, y: 0 }]),
  ]),

  // ======================================================================
  // LOWERCASE — the plate's own vocabulary. Its 1 is this n, its 10 is this
  // n beside this b, its 0 is this o.
  // ======================================================================

  a: gl(0.58, [
    s([
      { x: 0.56, y: 0.62 }, { x: 0.56, y: 0.30 },
      ...roll(0.56, 0.30, 0.28, 'L', 'down'),
      { x: 0.56, y: -OV },
    ]),
  ]),

  // straight off the plate's 10
  b: gl(0.60, [
    s([
      { x: 0, y: ASC }, { x: 0, y: 0.29 },
      ...roll(0, 0.29, 0.29, 'R', 'down'),
    ]),
  ]),

  c: gl(0.56, [
    { nodes: ring(0.29, 0.30, 0.29, 54, 300),
      curlA: { turn: deg(28), r: 0.18, decay: 1 },
      curlB: { turn: deg(-50), r: 0.16, decay: 0.85 } },
  ]),

  d: gl(0.60, [
    s([
      { x: 0.58, y: ASC }, { x: 0.58, y: 0.29 },
      ...roll(0.58, 0.29, 0.29, 'L', 'down'),
    ]),
  ]),

  // bar and circle are one wire: the bar runs left straight into the tangent
  e: gl(0.60, [
    s([{ x: 0.60, y: 0.34 }, ...ring(0.29, 0.34, 0.29, 180, -150)]),
  ]),

  f: gl(0.42, [
    s([{ x: 0.20, y: -OV }, { x: 0.20, y: 0.80 }, ...roll(0.20, 0.80, 0.19, 'R', 'up', 96)]),
    s([{ x: -0.05, y: 0.58 }, { x: 0.44, y: 0.58 }], 0.006),
  ]),

  g: gl(0.58, [
    { nodes: [
        { x: 0.56, y: 0.62 }, { x: 0.56, y: 0.30 },
        ...roll(0.56, 0.30, 0.28, 'L', 'down'),
        { x: 0.56, y: -0.12 },
      ],
      curlB: { turn: deg(-150), r: 0.16, decay: 0.8 } },
  ]),

  // the plate's 1, hung off an ascender
  h: gl(0.58, [
    s([{ x: 0, y: ASC }, { x: 0, y: -OV }]),
    s([{ x: 0.01, y: 0.30 }, ...ring(0.29, 0.33, 0.28, 180, 0), { x: 0.57, y: 0.31 },
       { x: 0.58, y: -OV }], 0.006),
  ]),

  i: gl(0.04, [s([{ x: 0.02, y: 0.60 }, { x: 0.02, y: -OV }])], [{ x: 0.02, y: 0.83 }]),

  j: gl(0.22, [
    { nodes: [{ x: 0.20, y: 0.60 }, { x: 0.20, y: 0.02 }],
      curlB: { turn: deg(-176), r: 0.18, decay: 1 } },
  ], [{ x: 0.20, y: 0.83 }]),

  k: gl(0.54, [
    s([{ x: 0, y: ASC }, { x: 0, y: -OV }]),
    s([{ x: 0.55, y: 0.62 }, { x: 0.02, y: 0.26, round: MITRE }, { x: 0.57, y: -OV }], 0.006),
  ]),

  l: gl(0.04, [s([{ x: 0.02, y: ASC }, { x: 0.02, y: -OV }])]),

  m: gl(0.92, [
    s([{ x: 0, y: 0.62 }, { x: 0, y: -OV }]),
    s([{ x: 0.01, y: 0.30 }, ...ring(0.27, 0.33, 0.26, 180, 0), { x: 0.53, y: 0.31 },
       { x: 0.53, y: -OV }], 0.006),
    s([{ x: 0.54, y: 0.30 }, ...ring(0.72, 0.33, 0.26, 180, 0), { x: 0.98, y: 0.31 },
       { x: 0.94, y: -OV }], 0.009),
  ]),

  // THE glyph: the plate's 1, unchanged
  n: gl(0.56, [
    s([
      { x: 0, y: -OV }, { x: 0.005, y: 0.31 },
      ...ring(0.28, 0.31, 0.28, 180, 0),
      { x: 0.555, y: 0.30 }, { x: 0.56, y: -OV },
    ]),
  ]),

  o: gl(0.58, [s(ring(0.29, 0.30, 0.29, 98, 98 - SEAM - 8))]),

  p: gl(0.60, [
    s([
      { x: 0, y: 0.62 }, { x: 0, y: 0.29 },
      ...roll(0, 0.29, 0.29, 'R', 'down'),
      { x: -0.01, y: DESC },
    ]),
  ]),

  q: gl(0.60, [
    s([
      { x: 0.58, y: 0.62 }, { x: 0.58, y: 0.29 },
      ...roll(0.58, 0.29, 0.29, 'L', 'down'),
      { x: 0.59, y: DESC },
    ]),
  ]),

  r: gl(0.42, [
    s([{ x: 0, y: 0.62 }, { x: 0, y: -OV }]),
    s([{ x: 0.01, y: 0.30 }, ...ring(0.24, 0.36, 0.23, 180, 26)], 0.006),
  ]),

  s: gl(0.50, [
    s([
      ...ring(0.25, 0.435, 0.17, -38, 202),
      ...ring(0.25, 0.165, 0.18, 22, -202),
    ]),
  ]),

  t: gl(0.40, [
    { nodes: [{ x: 0.20, y: 0.88 }, { x: 0.20, y: 0.08 }],
      curlB: { turn: deg(-84), r: 0.14, decay: 0.85 } },
    s([{ x: -0.05, y: 0.60 }, { x: 0.42, y: 0.60 }], 0.006),
  ]),

  u: gl(0.58, [
    s([
      { x: 0, y: 0.62 }, { x: 0, y: 0.29 },
      ...ring(0.29, 0.29, 0.29, 180, 360),
      { x: 0.58, y: 0.62 }, { x: 0.585, y: -OV },
    ]),
  ]),

  v: gl(0.56, [
    s([{ x: 0, y: 0.62 }, { x: 0.28, y: -0.01, round: 0.08 }, { x: 0.56, y: 0.62 }]),
  ]),

  w: gl(0.82, [
    s([{ x: 0, y: 0.62 }, { x: 0.20, y: -0.01, round: 0.08 }, { x: 0.41, y: 0.40, round: 0.10 },
       { x: 0.62, y: -0.01, round: 0.08 }, { x: 0.82, y: 0.62 }]),
  ]),

  x: gl(0.54, [
    s([{ x: -0.03, y: 0.64 }, { x: 0.57, y: -0.03 }]),
    s([{ x: -0.03, y: -0.03 }, { x: 0.57, y: 0.64 }], 0.009),
  ]),

  y: gl(0.56, [
    s([{ x: 0, y: 0.62 }, { x: 0.30, y: 0.02 }]),
    s([{ x: 0.58, y: 0.62 }, { x: 0.14, y: DESC }], 0.009),
  ]),

  z: gl(0.52, [
    s([{ x: 0, y: 0.60 }, { x: 0.54, y: 0.60, round: MITRE }, { x: 0, y: 0, round: MITRE },
       { x: 0.54, y: 0 }]),
  ]),

  // ======================================================================
  // FIGURES — straight off the plate
  // ======================================================================

  '0': gl(0.80, [s(ring(0.40, 0.44, 0.40, 96, 96 - SEAM - 10))]),

  // an arch, not a stroke. This is the n.
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

/**
 * The face is bicameral, so a missing glyph falls through to the other case
 * rather than to a blank. Set anything; get back whatever the plate can say.
 */
export function glyphFor(ch: string): Glyph | undefined {
  return GLYPHS[ch] ?? GLYPHS[ch.toLowerCase()] ?? GLYPHS[ch.toUpperCase()];
}

export const COVERAGE = Object.keys(GLYPHS).join('');
