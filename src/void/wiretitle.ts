// The title, set in the wire type (src/type).
//
// The arrival IS the death, run backwards. Springing the letters in on the
// live physics read as bouncing; what Jody wanted was the fluid snaking the
// wires do when they are cut loose — so the fall is simulated once, recorded,
// and played in reverse: the word pours up out of the dark along exactly the
// paths it will later take back down. Hold and death stay live physics.

import { WireText } from '../type/typeset';
import { GAUGE } from '../type/alphabet';
import { Capsule } from '../pose';
import { v3, rotY, rotX } from '../vec';

const HOLD = 2.1;
const FALL_EACH = 1.6;
const FALL_SPREAD = 1.8;
const REC_DT = 1 / 40;
const ARRIVE = FALL_SPREAD + FALL_EACH + 0.3;   // the recording's length

function rng(seed: number) {
  let s = (seed | 0) || 1;
  s = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) | 0;
  s ^= s >>> 13;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffff) / 0xffff;
  };
}

const hash01 = (n: number) => {
  let h = (n * 2654435761) | 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 8) & 0xffff) / 0xffff;
};

/** Browns, greys, black. Old iron and dry earth, not treasure. */
function forgeInks(r: () => number): [number, number, number][] {
  const mk = (h: number, sat: number, lit: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * lit - 1)) * sat;
    const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
    const m = lit - c / 2;
    const seg = Math.floor(h * 6) % 6;
    const [rr, gg, bb] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
  };
  const warm = 0.05 + r() * 0.05;              // the browns live here
  // two NATURAL tints ride along with the earth — moss, rust, ochre, slate —
  // muted enough to read as weathering rather than paint
  const tints = [0.24 + r() * 0.06, 0.07 + r() * 0.03, 0.11 + r() * 0.03, 0.55 + r() * 0.07];
  const t1 = tints[Math.floor(r() * tints.length) % tints.length];
  const t2 = tints[Math.floor(r() * tints.length) % tints.length];
  return [
    mk(warm, 0.22 + r() * 0.12, 0.33 + r() * 0.07),  // brown
    mk(warm, 0.16 + r() * 0.08, 0.23 + r() * 0.05),  // dark brown
    mk(warm + 0.02, 0.04 + r() * 0.04, 0.39 + r() * 0.06), // grey
    mk(warm, 0.05, 0.25 + r() * 0.04),               // dark grey
    mk(warm, 0.1, 0.16 + r() * 0.03),                // near-black
    mk(t1, 0.2 + r() * 0.12, 0.32 + r() * 0.08),     // a natural tint
    mk(t2, 0.16 + r() * 0.1, 0.28 + r() * 0.08),     // and another
  ];
}

interface Line { wire: WireText; beads: number }

/** Everything the word needs to know about where it is being looked at from. */
export interface TitleCam { yaw: number; pitch: number; cx: number; cz: number }

/** How much punishment one glyph takes before it comes away from the word. */
const CUT = 0.8;

/** The word stands this far toward the camera, clear of the creatures' plane. */
const FWD = 4.6;

/**
 * How a word arrives or leaves. Rolling only the SEED gave the same ceremony
 * with the letters relabelled; the pit picks a different manner each time, and
 * picks separately for the way in and the way out — so a word can pour in left
 * to right and fall away from the middle outward, and the next load will do
 * neither.
 */
type Manner = 'scatter' | 'sweep' | 'backsweep' | 'outward' | 'inward' | 'cascade';
const MANNERS: Manner[] = ['scatter', 'sweep', 'backsweep', 'outward', 'inward', 'cascade'];

/**
 * A glyph whose base ink sits on the floor of the palette disappears into the
 * pit floor — the lowercase p did it on every load, because the chunk hash was
 * built from constants and always drew the same dark slots. Accent chunks may
 * still go near-black; the BASE of every glyph is lifted to readable.
 */
function lift(c: [number, number, number]): [number, number, number] {
  const m = Math.max(c[0], c[1], c[2]);
  if (m >= 74) return c;
  const k = 74 / Math.max(1, m);
  return [c[0] * k, c[1] * k, c[2] * k];
}

export class WireTitle {
  private lines: Line[] = [];
  private t = 0;
  private out: Capsule[] = [];
  private deathAt = new Map<string, number>();     // per line:glyph, 0..FALL_SPREAD
  private arriveAt = new Map<string, number>();    // the way IN, rolled apart
  private salt = 0;                                // re-rolls the chunk hash each load
  private frames: Float32Array[] = [];             // the recorded fall
  private hold = HOLD;
  private gustAt = 1.5;
  private inks: [number, number, number][];
  private glyphAt = new Map<string, { x: number; y: number; r: number }>(); // metres, in the word's own plane
  private wound = new Map<string, number>();       // how much punishment each glyph has taken
  private cutAt = new Map<string, number>();       // and the moment it gave way
  private r = rng(Date.now() | 0);
  done = false;

  /** How many glyphs the fight has taken off the word, out of how many. */
  get cuts(): number { return this.cutAt.size; }
  get glyphs(): number { return this.glyphAt.size; }

  constructor(text = 'the summoning pit', maxWidth = 12, baseline = 1.15, sizeCap = 0.62) {
    const words = text.split(/\s+/);
    // A word cannot wrap. On a phone-narrow frame the longest word sets the
    // size, with a little air either side, or 'summoning' grazes the bezels.
    const widestEm = Math.max(...words.map(w => new WireText(w, { size: 1 }).width));
    const size = Math.min(sizeCap, (maxWidth * 0.84) / widestEm);
    const inks = forgeInks(this.r);
    this.salt = Math.floor(this.r() * 4096);
    this.inks = inks;
    const gauge = GAUGE * 1.15 * Math.max(0.82, size / 0.62);

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
    // Centre the BLOCK, not the first baseline: the word stands 4.6m toward
    // a pitched camera, which drags it down-screen, and one desktop line sat
    // visibly low while three phone lines looked fine. Aim the block's middle
    // at a fixed height and let the row count fall out of it.
    const mid = 2.3;
    const base = Math.max(0.9, mid - ((rows.length - 1) * lineH) / 2 - size * 0.35);
    rows.forEach((row, i) => {
      const wire = new WireText(row, {
        size, gauge, inks, align: 'centre',
        baseline: base + (rows.length - 1 - i) * lineH,
        seed: 1740 + i,
      });
      wire.settle();
      let beads = 0;
      for (const p of wire.pieces) beads += p.rod.n;
      this.lines.push({ wire, beads });
    });

    this.measure();

    // Two rolls, taken independently: the word need not leave the way it came.
    // The recording runs backwards to arrive, so the arrival roll is inverted
    // — a letter that must land FIRST is the one that falls LAST.
    this.arriveAt = this.roll(this.pickManner(), true);
    this.deathAt = this.roll(this.pickManner(), false);
    this.hold = HOLD + this.r() * 0.7;

    this.record();
  }

  /**
   * Where each glyph sits and how big it is, in the word's own flat space.
   * Taken once from the settled word: a letter shifts by millimetres while it
   * hangs, and a circle per glyph is all a blow needs to know what it crossed.
   */
  private measure(): void {
    this.lines.forEach((ln, li) => {
      const em = ln.wire.opts.size;
      const box = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
      for (const p of ln.wire.pieces) {
        let b = box.get(p.glyph);
        if (!b) { b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; box.set(p.glyph, b); }
        for (let i = 0; i < p.rod.n; i++) {
          const x = p.rod.x[i] * em, y = p.rod.y[i] * em;
          if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
          if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
        }
      }
      for (const [g, b] of box) {
        this.glyphAt.set(`${li}:${g}`, {
          x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2,
          r: Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2,
        });
      }
    });
  }

  /**
   * SOMETHING SWUNG THROUGH THE WORD.
   *
   * The word hangs 4.6m nearer the camera than the floor the creatures fight
   * on, so nothing in the pit can literally reach it — that gap is deliberate,
   * it is what stops the pit lord standing inside the O. What a blade CAN do
   * is cross the word on screen, and under an orthographic camera that has an
   * exact answer: where would this world point have to sit on the word's own
   * plane to land on the same pixel?
   *
   * Rather than derive that by hand and get a sign wrong the day someone
   * changes the pitch convention, the word measures it. Its plane is flat and
   * the camera is affine, so three probes — the origin and one metre along
   * each axis — give the 2x2 that takes any world point to a letter position,
   * and it stays right by construction.
   */
  strike(cam: TitleCam, ax: number, ay: number, az: number,
    bx: number, by: number, bz: number, radius: number, power: number,
  ): { x: number; y: number; z: number; ink: [number, number, number] } | null {
    // while the word is still pouring in, the recording owns every bead and
    // any shove would be overwritten on the next frame — let it arrive first
    if (this.done || this.t < ARRIVE || !this.lines.length) return null;

    const view = (x: number, y: number, z: number) =>
      rotX(rotY(v3(x - cam.cx, y, z - cam.cz), cam.yaw), cam.pitch);
    const onPlane = (lx: number, ly: number) => {
      const w = rotY(v3(lx, 0, FWD), -cam.yaw);
      return view(w.x, ly, w.z);
    };
    const o = onPlane(0, 0), ex = onPlane(1, 0), ey = onPlane(0, 1);
    const xx = ex.x - o.x, xy = ex.y - o.y, yx = ey.x - o.x, yy = ey.y - o.y;
    const det = xx * yy - yx * xy;
    if (Math.abs(det) < 1e-9) return null;      // looking straight down the plane

    let best: { x: number; y: number } | null = null;
    let bite = 0;
    let ink: [number, number, number] = [150, 140, 130];

    // THE SHOVE IS SAMPLED; THE DAMAGE IS MEASURED. Shoving wants several
    // points along the blade, so the word bends around it rather than pivoting
    // about one pinprick. Damage does not: summing what each sample happened
    // to be near made a blow's power depend on how the segment fell across the
    // sample grid, so a sword through the middle of a letter scored the same
    // 0.24 as a graze and nothing was ever cut. What matters is how close the
    // blade actually came, which is one segment-to-point distance.
    const N = 4;
    const ends: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const v = view(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);
      const dx = v.x - o.x, dy = v.y - o.y;
      const lx = (dx * yy - dy * yx) / det;
      const ly = (xx * dy - xy * dx) / det;
      // ONE NUMBER, TWO CONSEQUENCES. `power` is how hard the blow was, and
      // the shove and the damage are both read off it, so they can never
      // drift apart into a word that flails without breaking or breaks
      // without flinching. The shove is deliberately of the same order as the
      // gusts that already move the word — a sword should disturb it like
      // strong weather, not like an explosion.
      for (const ln of this.lines) ln.wire.push(lx, ly, radius, power * 0.11);
      if (i === 0 || i === N - 1) ends.push({ x: lx, y: ly });
    }

    const [p0, p1] = ends;
    const sx = p1.x - p0.x, sy = p1.y - p0.y;
    const span = sx * sx + sy * sy;
    for (const [key, g] of this.glyphAt) {
      if (this.cutAt.has(key)) continue;
      // how near the blade came to this letter, at its closest
      const u = span < 1e-9 ? 0 : Math.max(0, Math.min(1,
        ((g.x - p0.x) * sx + (g.y - p0.y) * sy) / span));
      const nx = p0.x + sx * u, ny = p0.y + sy * u;
      const reach = g.r + radius;
      const d = Math.hypot(g.x - nx, g.y - ny);
      if (d > reach) continue;
      const b = power * (1 - d / reach);
      const w = (this.wound.get(key) ?? 0) + b;
      this.wound.set(key, w);
      if (w >= CUT) this.sever(key);
      if (b > bite) { bite = b; best = { x: nx, y: ny }; ink = this.inks[0]; }
    }
    if (!best) return null;
    const w = rotY(v3(best.x, 0, FWD), -cam.yaw);
    return { x: w.x, y: best.y, z: w.z, ink };
  }

  /** A glyph comes away from the word and takes the rest of its fall alone. */
  private sever(key: string): void {
    this.cutAt.set(key, this.t);
    // a word beaten to pieces should not leave an invisible corpse standing
    // for the rest of its welcome: once nothing is left, bring the end forward
    if (this.cutAt.size >= this.glyphAt.size) {
      this.hold = Math.min(this.hold, Math.max(0, this.t - ARRIVE) + 0.25);
    }
  }

  private pickManner(): Manner {
    return MANNERS[Math.floor(this.r() * MANNERS.length) % MANNERS.length];
  }

  /**
   * Give every glyph its moment, in the given manner. The gaps between them
   * are drawn clumpy on purpose (r()*r() is small most of the time, wide
   * occasionally): evenly spaced moments are a metronome, and a metronome is
   * what makes a thing read as keyframed however random its order.
   */
  private roll(manner: Manner, invert: boolean): Map<string, number> {
    const items: { key: string; u: number; line: number }[] = [];
    this.lines.forEach((ln, li) => {
      const acc = new Map<number, { sum: number; n: number }>();
      for (const p of ln.wire.pieces) {
        const a = acc.get(p.glyph) ?? { sum: 0, n: 0 };
        a.sum += p.u; a.n++;
        acc.set(p.glyph, a);
      }
      for (const [g, a] of acc) items.push({ key: `${li}:${g}`, u: a.sum / a.n, line: li });
    });
    const out = new Map<string, number>();
    const n = items.length;
    if (!n) return out;

    const span = FALL_SPREAD * (0.7 + this.r() * 0.3);
    if (manner === 'scatter') {
      // no order at all: every letter takes its own moment out of the air
      for (const it of items) out.set(it.key, invert ? span - this.r() * span : this.r() * span);
      return out;
    }

    // Rows read top-down, so a sweep leans on the line it is crossing. Every
    // rank carries a little noise: a perfectly monotonic sweep is a machine
    // running down the word, and the eye names it instantly. With the noise,
    // neighbours trade places here and there and the sweep stays a gesture.
    const wobble = 0.1 + this.r() * 0.22;
    const rank = (it: { u: number; line: number }): number => {
      const n = (this.r() - 0.5) * wobble;
      switch (manner) {
        case 'sweep': return it.line * 1.4 + it.u + n;
        case 'backsweep': return it.line * 1.4 + (1 - it.u) + n;
        case 'outward': return Math.abs(it.u - 0.5) + n;
        case 'inward': return -Math.abs(it.u - 0.5) + n;
        default: return it.line * 4 + this.r();   // cascade: row by row, loose within
      }
    };
    const ranked = items
      .map(it => ({ it, k: rank(it) }))
      .sort((a, b) => a.k - b.k)
      .map(x => x.it);

    const gaps = ranked.map((_, i) => (i === 0 ? 0 : 0.25 + this.r() * this.r() * 2.4));
    const total = gaps.reduce((a, g) => a + g, 0) || 1;
    let acc = 0;
    ranked.forEach((it, i) => {
      acc += gaps[i];
      const at = (acc / total) * span;
      out.set(it.key, invert ? span - at : at);
    });
    return out;
  }

  /**
   * Simulate the fall once, from the settled word, and keep every frame. The
   * arrival plays this backwards, so the way on and the way off are the same
   * motion by construction — not two effects tuned to resemble each other.
   */
  private record(): void {
    const total = this.lines.reduce((a, l) => a + l.beads, 0);
    const steps = Math.ceil(ARRIVE / REC_DT);
    for (let f = 0; f <= steps; f++) {
      const t = f * REC_DT;
      const snap = new Float32Array(total * 2);
      let o = 0;
      this.lines.forEach((ln, li) => {
        for (const p of ln.wire.pieces) {
          const rod = p.rod;
          snap.set(rod.x, o); o += rod.n;
          snap.set(rod.y, o); o += rod.n;
        }
        // step AFTER snapshotting, so frame 0 is the settled word
        for (const p of ln.wire.pieces) {
          // the recording is the ARRIVAL's raw material, so it falls to that roll
          const dying = t >= (this.arriveAt.get(`${li}:${p.glyph}`) ?? 0);
          if (!dying) continue;
          // salted, so the weight of each letter's fall changes with the load too
          p.rod.step({ dt: REC_DT, gravity: -2.4 - hash01(p.glyph * 13 + li + this.salt) * 1.2,
            damp: 0.96, home: 0, bend: 0.1, iters: 5, absorb: 0.7 });
        }
      });
      this.frames.push(snap);
    }
    // put the word back; the playback will move it from here
    for (const ln of this.lines) ln.wire.settle();
  }

  /** Write a recorded frame into the rods (position and history both). */
  private load(frame: Float32Array): void {
    let o = 0;
    for (const ln of this.lines) {
      for (const p of ln.wire.pieces) {
        const rod = p.rod;
        rod.x.set(frame.subarray(o, o + rod.n)); rod.px.set(rod.x); o += rod.n;
        rod.y.set(frame.subarray(o, o + rod.n)); rod.py.set(rod.y); o += rod.n;
      }
    }
  }

  caps(dt: number, camYaw: number): Capsule[] {
    this.t += dt;
    const t = this.t;
    const dieBase = ARRIVE + this.hold;
    if (t > dieBase + FALL_SPREAD + FALL_EACH + 0.4) {
      this.done = true; this.out.length = 0; return this.out;
    }

    if (t < ARRIVE) {
      // the fall, backwards: the wires snake up out of the dark
      const back = (ARRIVE - t) / REC_DT;
      const idx = Math.max(0, Math.min(this.frames.length - 1, Math.round(back)));
      this.load(this.frames[idx]);
    } else {
      const sub = Math.min(3, Math.max(1, Math.ceil(dt / 0.012)));
      const h = dt / sub;
      this.lines.forEach((ln, li) => {
        for (const p of ln.wire.pieces) {
          // a glyph that was struck loose is already falling, whatever the
          // clock says the word's own ending was going to be
          const dying = this.cutAt.has(`${li}:${p.glyph}`)
            || t >= dieBase + (this.deathAt.get(`${li}:${p.glyph}`) ?? 0);
          const o = dying
            ? { dt: h, gravity: -2.4 - this.r() * 1.2, damp: 0.955, home: 0, bend: 0.1, iters: 5, absorb: 0.7 }
            : { dt: h, gravity: 0, damp: 0.93, home: 0.09, bend: 0.8, iters: 5, absorb: 0.86 };
          for (let s = 0; s < sub; s++) p.rod.step(o);
        }
        ln.wire.breathe(t + li * 1.7, 0.0042);
      });

      this.gustAt -= dt;
      if (this.gustAt <= 0) {
        this.gustAt = 1.1 + this.r() * 2.2;
        const ln = this.lines[Math.floor(this.r() * this.lines.length)];
        const x = ln.wire.left + this.r() * ln.wire.width;
        ln.wire.push(x, (ln.wire.opts.baseline ?? 1) + this.r() * 0.5, 0.55, 0.05 + this.r() * 0.06);
      }
    }

    this.out.length = 0;
    // 4.6m toward the camera (orthographic, so free): 2.2 left the word on the
  // plane creatures idle on, and the lord stood INSIDE it, blended to soup.
  const fwd = rotY(v3(0, 0, 4.6), -camYaw);
    this.lines.forEach((ln, li) => {
      for (const cap of ln.wire.frame()) {
        if (cap.a.y < 0.015 && cap.b.y < 0.015) continue;
        const g = cap.part.startsWith('wire') ? Number(cap.part.slice(4)) : -1;
        const gi = Math.max(0, g);
        // each end keeps its own clock, because each end has its own order
        let fade: number;
        if (t < ARRIVE) {
          const stagger = this.arriveAt.get(`${li}:${gi}`) ?? FALL_SPREAD * 0.5;
          const back = ARRIVE - t;                 // where we are in the fall
          fade = 1 - Math.max(0, Math.min(1, (back - stagger) / FALL_EACH)) ** 2;
        } else {
          const cut = this.cutAt.get(`${li}:${gi}`);
          const start = cut !== undefined
            ? cut
            : dieBase + (this.deathAt.get(`${li}:${gi}`) ?? FALL_SPREAD * 0.5);
          const fall = Math.max(0, Math.min(1, (t - start) / FALL_EACH));
          fade = 1 - fall * fall;
        }
        if (fade <= 0.02) continue;

        const rad = cap.r * (0.82 + hash01(li * 31 + gi * 7 + 3) * 0.5);
        const len = Math.hypot(cap.b.x - cap.a.x, cap.b.y - cap.a.y, cap.b.z - cap.a.z);
        const chunks = Math.max(1, Math.min(4, Math.round(len / 0.16)));
        for (let ci = 0; ci < chunks; ci++) {
          const t0 = ci / chunks, t1 = (ci + 1) / chunks;
          const ax = cap.a.x + (cap.b.x - cap.a.x) * t0, ay = cap.a.y + (cap.b.y - cap.a.y) * t0, az = cap.a.z + (cap.b.z - cap.a.z) * t0;
          const bx = cap.a.x + (cap.b.x - cap.a.x) * t1, by = cap.a.y + (cap.b.y - cap.a.y) * t1, bz = cap.a.z + (cap.b.z - cap.a.z) * t1;
          const pick = hash01(gi * 131 + ci * 17 + li * 7 + this.salt);
          const ink = pick < 0.4 ? lift(cap.color as [number, number, number]) : this.inks[Math.floor(pick * this.inks.length) % this.inks.length];
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
