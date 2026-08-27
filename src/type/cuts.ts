// Chopping the plate up.
//
// The letters are not drawn in the manner of the figures — they are cut out of
// them. A cut names a traced piece, a range along its length, what to do to it,
// and where to put it. Nothing else is allowed: if a shape cannot be made from
// a length of the smith's own wire it does not go in the face.
//
// Ranges are measured in arc length, 0 to 1, because that is how you cut wire —
// so far along, snip. `farm/type/_atlas.py` prints the plate with those numbers
// marked on it, which is what the ranges below were read off.

import { PLATE, Trace } from './plate';
import { Strand } from './rod';

/**
 * Where on the cut the `at` coordinate lands.
 *   bl br tl tr   corners of its bounding box
 *   c  cb ct cl cr   centre, and the middle of each edge
 *   s  e          the cut ends themselves
 *   xl xc xr      line up horizontally only, and leave the height alone — which
 *                 is how the figures keep the plate's own baseline, 7 included
 */
export type Anchor =
  | 'bl' | 'br' | 'tl' | 'tr'
  | 'c' | 'cb' | 'ct' | 'cl' | 'cr'
  | 's' | 'e'
  | 'xl' | 'xc' | 'xr';

export interface Cut {
  /** key into PLATE */
  p: string;
  /** which piece of that figure (default 0) */
  i?: number;
  /** cut from here to here along its length, 0..1 */
  from?: number;
  to?: number;
  /** uniform scale, then sy overrides the vertical if the piece needs squashing */
  s?: number;
  sy?: number;
  /** mirror before scaling */
  fx?: boolean;
  fy?: boolean;
  /** degrees, anticlockwise, after mirroring */
  rot?: number;
  a?: Anchor;
  at?: [number, number];
  /** lift off the board so crossings sort */
  z?: number;
}

interface Pt { x: number; y: number }

const lengths = (t: Trace): number[] => {
  const d = [0];
  for (let i = 1; i < t.length; i++) {
    d.push(d[i - 1] + Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]));
  }
  return d;
};

/** The sub-length between two fractions, with the ends landing exactly. */
function slice(t: Trace, from: number, to: number): Pt[] {
  const d = lengths(t);
  const L = d[d.length - 1];
  if (L < 1e-9) return t.map(([x, y]) => ({ x, y }));
  const a = Math.max(0, Math.min(1, from)) * L;
  const b = Math.max(0, Math.min(1, to)) * L;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const at = (s: number): Pt => {
    let j = 1;
    while (j < d.length - 1 && d[j] < s) j++;
    const seg = d[j] - d[j - 1];
    const u = seg > 1e-12 ? (s - d[j - 1]) / seg : 0;
    return {
      x: t[j - 1][0] + (t[j][0] - t[j - 1][0]) * u,
      y: t[j - 1][1] + (t[j][1] - t[j - 1][1]) * u,
    };
  };
  const out: Pt[] = [at(lo)];
  for (let j = 0; j < d.length; j++) if (d[j] > lo && d[j] < hi) out.push({ x: t[j][0], y: t[j][1] });
  out.push(at(hi));
  return from > to ? out.reverse() : out;
}

/** Resolve one cut into points in glyph space. */
export function resolve(c: Cut): Pt[] {
  const piece = PLATE[c.p];
  if (!piece) throw new Error(`no such piece on the plate: ${c.p}`);
  const t = piece[c.i ?? 0];
  if (!t) throw new Error(`${c.p} has no strand ${c.i}`);

  let pts = slice(t, c.from ?? 0, c.to ?? 1);

  const sx = (c.s ?? 1) * (c.fx ? -1 : 1);
  const sy = (c.sy ?? c.s ?? 1) * (c.fy ? -1 : 1);
  pts = pts.map(p => ({ x: p.x * sx, y: p.y * sy }));

  if (c.rot) {
    const r = (c.rot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    pts = pts.map(p => ({ x: p.x * cs - p.y * sn, y: p.x * sn + p.y * cs }));
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const first = pts[0], last = pts[pts.length - 1];
  const A: Record<Anchor, Pt> = {
    bl: { x: x0, y: y0 }, br: { x: x1, y: y0 },
    tl: { x: x0, y: y1 }, tr: { x: x1, y: y1 },
    c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    cb: { x: (x0 + x1) / 2, y: y0 }, ct: { x: (x0 + x1) / 2, y: y1 },
    cl: { x: x0, y: (y0 + y1) / 2 }, cr: { x: x1, y: (y0 + y1) / 2 },
    s: first, e: last,
    xl: { x: x0, y: 0 }, xc: { x: (x0 + x1) / 2, y: 0 }, xr: { x: x1, y: 0 },
  };
  const anchor = A[c.a ?? 'bl'];
  const [tx, ty] = c.at ?? [0, 0];
  const dx = tx - anchor.x;
  // the x-only anchors leave the plate's own height alone
  const dy = (c.a === 'xl' || c.a === 'xc' || c.a === 'xr') ? (c.at ? ty : 0) : ty - anchor.y;
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/** A cut, as a strand the rod builder will take verbatim. */
export function strandOf(c: Cut): Strand {
  return { nodes: resolve(c), raw: true, z: c.z ?? 0 };
}

/** Width of a set of cuts, once placed. */
export function extent(cuts: Cut[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of cuts) {
    for (const p of resolve(c)) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, x1, y0, y1 };
}
