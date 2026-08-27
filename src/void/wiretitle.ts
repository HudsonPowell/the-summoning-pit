// The title, set in the wire type (src/type). Summoned out of the dark under
// the floor, alive in the draught while it stands, then dying letter by
// letter — each one giving up in its own time, like the figures do.
//
// A phone shows four metres of world where a desktop shows sixteen, and
// shrinking the word to fit filled the counters solid at this blend. So the
// word does what type does: it BREAKS INTO LINES, and the caps stay a size
// the field can hold.

import { WireText } from '../type/typeset';
import { GAUGE } from '../type/alphabet';
import { Capsule } from '../pose';
import { v3, rotY } from '../vec';

const HOLD = 2.1;
const FALL_EACH = 1.6;
const FALL_SPREAD = 2.2;

function rng(seed: number) {
  let s = (seed | 0) || 1;
  s = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) | 0;
  s ^= s >>> 13;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0xffffff;
  };
}

/** Inks the way a hero gets them: a hue family, an accent across the wheel. */
function forgeInks(r: () => number): [number, number, number][] {
  const hue = r();
  const accent = (hue + 0.38 + r() * 0.2) % 1;
  const mk = (h: number, sat: number, lit: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * lit - 1)) * sat;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = lit - c / 2;
    const seg = Math.floor(h * 6) % 6;
    const [rr, gg, bb] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
  };
  // dull, dark metals: low saturation, lightness kept under 0.5 — the word
  // should sit IN the gloom, not glow against it
  const s = 0.2 + r() * 0.16;
  return [
    mk(hue, s, 0.44), mk(hue, s * 0.85, 0.33), mk(hue, s * 1.15, 0.5),
    mk(hue, s * 0.7, 0.26), mk(accent, s * 1.2, 0.38),
  ];
}

interface Line { wire: WireText; offset: number }

const hash01 = (n: number) => {
  let h = (n * 2654435761) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 8) & 0xffff) / 0xffff;
};

export class WireTitle {
  private lines: Line[] = [];
  private t = 0;
  private out: Capsule[] = [];
  private deathAt = new Map<string, number>();
  private gustAt = 1.5;
  private inks: [number, number, number][];
  private r = rng(Date.now() | 0);
  private summonEnd = 0;
  done = false;

  constructor(text = 'the summoning pit', maxWidth = 12, baseline = 1.15) {
    const size = 0.62;
    const inks = forgeInks(this.r);
    this.inks = inks;
    const gauge = GAUGE * 1.15;

    // break into lines: words that fit, largest caps we allow
    const words = text.split(/\s+/);
    const fits = (s: string) => new WireText(s, { size: 1 }).width * size <= maxWidth * 0.92;
    const rows: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && !fits(next)) { rows.push(cur); cur = w; }
      else cur = next;
    }
    if (cur) rows.push(cur);

    const lineH = size * 1.18;
    rows.forEach((row, i) => {
      const wire = new WireText(row, {
        size, gauge, inks, align: 'centre',
        baseline: baseline + (rows.length - 1 - i) * lineH,
        seed: 1740 + i,
      });
      wire.coil(1.3 + i * 0.15, 0.45);
      const offset = i * 0.55;             // lines arrive top to bottom
      this.lines.push({ wire, offset });

      const glyphs = new Set(wire.pieces.map(p => p.glyph));
      const order = [...glyphs].sort(() => this.r() - 0.5);
      order.forEach((g, gi) => {
        this.deathAt.set(`${i}:${g}`,
          (gi / Math.max(1, order.length - 1)) * FALL_SPREAD + this.r() * 0.3);
      });
      const summon = offset + row.length * 0.16 + 1.4;
      if (summon > this.summonEnd) this.summonEnd = summon;
    });
  }

  caps(dt: number, camYaw: number): Capsule[] {
    this.t += dt;
    const t = this.t;
    const dieBase = this.summonEnd + HOLD;
    if (t > dieBase + FALL_SPREAD + FALL_EACH + 0.4) {
      this.done = true; this.out.length = 0; return this.out;
    }

    const sub = Math.min(3, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / sub;
    this.lines.forEach((ln, li) => {
      const lt = t - ln.offset;
      if (lt < this.summonEnd - ln.offset && t < this.summonEnd) {
        // arriving — and wiggling as it does, the same draught that will
        // eventually kill it already pulling at it on the way in
        if (lt > 0) {
          ln.wire.step(dt, lt);
          ln.wire.breathe(t + li * 1.7, 0.006);
        }
        return;
      }
      // ALIVE, not displayed: loose joints, an unsteady draught, the odd shove
      // — the same physics that kills each letter is what animates it standing.
      for (const p of ln.wire.pieces) {
        const dying = t >= dieBase + (this.deathAt.get(`${li}:${p.glyph}`) ?? 0);
        const o = dying
          ? { dt: h, gravity: -2.4 - this.r() * 1.2, damp: 0.955, home: 0, bend: 0.1, iters: 5, absorb: 0.7 }
          : { dt: h, gravity: 0, damp: 0.93, home: 0.09, bend: 0.8, iters: 5, absorb: 0.86 };
        for (let s = 0; s < sub; s++) p.rod.step(o);
      }
      ln.wire.breathe(t + li * 1.7, 0.0048);
    });

    // a gust every couple of seconds, somewhere along one of the lines —
    // during the arrival too, so on and off are the same weather
    this.gustAt -= dt;
    if (this.gustAt <= 0 && t > 0.8) {
      this.gustAt = 1.1 + this.r() * 2.2;
      const ln = this.lines[Math.floor(this.r() * this.lines.length)];
      const x = ln.wire.left + this.r() * ln.wire.width;
      ln.wire.push(x, (ln.wire.opts.baseline ?? 1) + this.r() * 0.5, 0.55, 0.05 + this.r() * 0.06);
    }

    this.out.length = 0;
    const fwd = rotY(v3(0, 0, 2.2), -camYaw);    // forward of the scenery
    this.lines.forEach((ln, li) => {
      for (const cap of ln.wire.frame()) {
        if (cap.a.y < 0.015 && cap.b.y < 0.015) continue;
        const g = cap.part.startsWith('wire') ? Number(cap.part.slice(4)) : -1;
        const dAt = dieBase + (g >= 0 ? (this.deathAt.get(`${li}:${g}`) ?? 0) : FALL_SPREAD * 0.5);
        const fall = Math.max(0, Math.min(1, (t - dAt) / FALL_EACH));
        const fade = 1 - fall * fall;
        if (fade <= 0.02) continue;
        // PER-LETTER VARIANCE. Each glyph has its own wire weight, and long
        // runs are split into chunks that alternate between the glyph's ink
        // and a second one — the field cross-fades where they meet, so the
        // blending is VISIBLE along the wire instead of hiding inside joins.
        const gv = hash01(li * 31 + g * 7 + 3);
        const rad = cap.r * (0.82 + gv * 0.5);
        // rivets have no glyph; a negative index walked off the ink array
        const gi = Math.max(0, g);
        const len = Math.hypot(cap.b.x - cap.a.x, cap.b.y - cap.a.y, cap.b.z - cap.a.z);
        const chunks = Math.max(1, Math.min(4, Math.round(len / 0.16)));
        for (let ci = 0; ci < chunks; ci++) {
          const t0 = ci / chunks, t1 = (ci + 1) / chunks;
          const ax = cap.a.x + (cap.b.x - cap.a.x) * t0, ay = cap.a.y + (cap.b.y - cap.a.y) * t0, az = cap.a.z + (cap.b.z - cap.a.z) * t0;
          const bx = cap.a.x + (cap.b.x - cap.a.x) * t1, by = cap.a.y + (cap.b.y - cap.a.y) * t1, bz = cap.a.z + (cap.b.z - cap.a.z) * t1;
          // each chunk draws from the whole palette, hashed stably — a
          // letter is three or four metals, and the field cross-fades them
          const pick = hash01(gi * 131 + ci * 17 + li * 7);
          const ink = pick < 0.4 ? cap.color : this.inks[Math.floor(pick * this.inks.length) % this.inks.length];
          const a = rotY(v3(ax, 0, az), -camYaw);
          const b = rotY(v3(bx, 0, bz), -camYaw);
          this.out.push({
            a: v3(a.x + fwd.x, Math.max(0.015, ay), a.z + fwd.z),
            b: v3(b.x + fwd.x, Math.max(0.015, by), b.z + fwd.z),
            r: rad,
            color: [ink[0] * fade, ink[1] * fade, ink[2] * fade],
            part: cap.part,
          });
        }
      }
    });
    return this.out;
  }
}
