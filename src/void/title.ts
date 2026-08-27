// The title, built out of the same stuff as everything else: capsules through
// the blend field. It stands in the middle of the scene when the page loads,
// holds a moment, and then dies the way the figures do — sinking and fading
// rather than being switched off.
//
// The glyphs come from the 5x7 farm font for now. Jody has a proper type
// system being built elsewhere; when it lands, swap `linesToStrokes` for its
// outlines and everything downstream stays the same.

import { GLYPHS, GLYPH_W, GLYPH_H } from '../../farm/font';
import { Capsule } from '../pose';
import { v3 } from '../vec';

interface Stroke { x0: number; y0: number; x1: number; y1: number }

/** Horizontal runs of lit pixels become single strokes — far fewer capsules. */
function linesToStrokes(lines: string[], px: number): { strokes: Stroke[]; w: number; h: number } {
  const strokes: Stroke[] = [];
  const lineH = (GLYPH_H + 3) * px;
  const wMax = Math.max(...lines.map(l => l.length)) * (GLYPH_W + 1) * px;
  lines.forEach((line, li) => {
    const lineW = line.length * (GLYPH_W + 1) * px;
    const ox = -lineW / 2;
    const oy = ((lines.length - 1) / 2 - li) * lineH;
    [...line.toUpperCase()].forEach((ch, ci) => {
      if (ch === ' ') return;
      const rows = (GLYPHS[ch] ?? '').split('/');
      rows.forEach((row, ry) => {
        let run = -1;
        for (let rx = 0; rx <= row.length; rx++) {
          const on = rx < row.length && row[rx] === '1';
          if (on && run < 0) run = rx;
          if (!on && run >= 0) {
            const gx = ox + (ci * (GLYPH_W + 1)) * px;
            const gy = oy + (GLYPH_H - 1 - ry) * px;
            strokes.push({ x0: gx + run * px, y0: gy, x1: gx + (rx - 1) * px, y1: gy });
            run = -1;
          }
        }
      });
    });
  });
  return { strokes, w: wMax, h: lines.length * lineH };
}

export class Title {
  private strokes: Stroke[];
  private t = 0;
  private ink: [number, number, number];
  done = false;

  constructor(lines: string[], private px = 0.11, ink: [number, number, number] = [176, 184, 196]) {
    this.strokes = linesToStrokes(lines, px).strokes;
    this.ink = ink;
  }

  /**
   * Billboarded to the camera yaw, so the words face whoever is watching
   * however the observer camera has drifted.
   */
  caps(dt: number, camYaw: number, baseY: number): Capsule[] {
    this.t += dt;
    const IN = 1.2, HOLD = 4.5, OUT = 1.8;
    if (this.t > IN + HOLD + OUT) { this.done = true; return []; }

    // rise in, hold, then melt — sink and thin like a figure going down
    const inK = Math.min(1, this.t / IN);
    const rise = 1 - Math.pow(1 - inK, 3);
    const outT = Math.max(0, this.t - IN - HOLD) / OUT;
    const melt = outT * outT;

    const fade = inK * (1 - outT);
    const col: [number, number, number] = [
      this.ink[0] * fade, this.ink[1] * fade, this.ink[2] * fade,
    ];
    const r = this.px * 0.62 * (1 - melt * 0.55);
    const yaw = -camYaw;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lift = baseY + rise * 0.25 - melt * (baseY + 0.4);

    const out: Capsule[] = [];
    for (const st of this.strokes) {
      // the melt is uneven: strokes lower in the word let go first
      const wave = melt * (1 + Math.sin(st.x0 * 7.3) * 0.35);
      const y0 = st.y0 * (1 - wave) + lift;
      const y1 = st.y1 * (1 - wave) + lift;
      if (y0 < 0.02 && y1 < 0.02) continue;
      out.push({
        a: v3(st.x0 * c, Math.max(0.02, y0), st.x0 * s),
        b: v3(st.x1 * c, Math.max(0.02, y1), st.x1 * s),
        r, color: col, part: 'title',
      });
    }
    return out;
  }
}
