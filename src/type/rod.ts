// A glyph in this face is not an outline. It is a length of wire.
//
// That single decision decides everything downstream. Wire has one gauge
// everywhere, so there is no thick/thin to model. Wire cannot turn a corner of
// zero radius, so every vertex is an arc whose size says how hard the smith
// squeezed. Wire does not stretch, so the letter has a LENGTH — a real number
// of millimetres you could cut off a spool. And wire springs: bend it and it
// comes back, which is why the letterform here is not drawn but SETTLED.
//
// So the primitive is a rod: beads at a fixed spacing that remember the angle
// at every joint. Pin one bead and drag another and the whole thing follows —
// that is the IK, and it falls out of the material rather than being bolted on.

export interface Pt { x: number; y: number }

/** One instruction on the bending sheet: go here, and turn this hard. */
export interface Node extends Pt {
  /**
   * 0 = a pliers-tight mitre, 1 = the fullest arc the two legs will allow.
   * A square of four 1.0 corners is a circle; that is how the round forms in
   * this face are built, rather than by a separate curve primitive.
   */
  round?: number;
  /** A nail driven through the inlay. This joint never moves. */
  pin?: boolean;
}

/** A tail that keeps turning after the last node — the ear of a 2, the hook of a 5. */
export interface Curl {
  /** Signed radians. Positive turns anticlockwise. */
  turn: number;
  /** Radius at the start of the curl, in em. */
  r: number;
  /** Radius multiplier per full turn. <1 spirals inward. */
  decay?: number;
}

export interface Strand {
  nodes: Node[];
  /**
   * These points are already a centreline — traced off the plate — not a
   * bending sheet. Take them as they are; the corner-filleting that turns
   * instructions into wire would only round off the smith's own mitres.
   */
  raw?: boolean;
  closed?: boolean;
  curlA?: Curl; // grows backwards off the first node
  curlB?: Curl; // grows forwards off the last node
  /** Lifts this piece off the board so crossings sort. In em. */
  z?: number;
}

/** A sample on the centreline, carrying how stiff the wire is right there. */
interface Sample extends Pt { k: number }

const TAU = Math.PI * 2;
const hyp = Math.hypot;

// Stiffness by feature. A straight run resists bending more than an easy arc;
// a hammered mitre is the stiffest thing on the glyph and holds its angle even
// when the rest of the letter is swinging.
const K_STRAIGHT = 0.55;
const K_ARC_SOFT = 0.22;
const K_ARC_HARD = 0.95;

/** Dense points along an ellipse arc. Round forms are authored with this. */
export function arc(
  cx: number, cy: number, rx: number, ry: number,
  a0: number, a1: number, n = 28, round = 0.9,
): Node[] {
  const out: Node[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, round });
  }
  return out;
}

const D = Math.PI / 180;
export const deg = (d: number) => d * D;

/**
 * Turn the bending sheet into a centreline.
 *
 * Every interior vertex becomes a circular fillet tangent to both legs. The
 * tangent length is a fraction of the room available (half the shorter leg, so
 * neighbouring fillets can never eat each other), and `round` is that
 * fraction. Radius then follows from the turn: R = t·tan(a/2).
 */
function fillet(nodes: Node[], closed: boolean): Sample[] {
  const n = nodes.length;
  if (n < 2) return nodes.map(p => ({ x: p.x, y: p.y, k: K_STRAIGHT }));

  const out: Sample[] = [];
  const first = closed ? 0 : 1;
  const last = closed ? n - 1 : n - 2;

  if (!closed) out.push({ x: nodes[0].x, y: nodes[0].y, k: K_STRAIGHT });

  for (let i = first; i <= last; i++) {
    const c = nodes[i];
    const p = nodes[(i - 1 + n) % n];
    const q = nodes[(i + 1) % n];

    let d1x = p.x - c.x, d1y = p.y - c.y;
    let d2x = q.x - c.x, d2y = q.y - c.y;
    const l1 = hyp(d1x, d1y), l2 = hyp(d2x, d2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;

    // Interior angle between the legs. Near-straight needs no fillet at all.
    const cosA = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
    const a = Math.acos(cosA);
    const turn = Math.PI - a;
    const round = c.round ?? 0.5;
    if (turn < 0.02 || round <= 0) {
      out.push({ x: c.x, y: c.y, k: turn > 0.6 ? K_ARC_HARD : K_STRAIGHT });
      continue;
    }

    const room = Math.min(l1, l2) * 0.5;
    const t = Math.max(1e-4, room * round);
    const R = t * Math.tan(a / 2);

    const t1x = c.x + d1x * t, t1y = c.y + d1y * t;
    const t2x = c.x + d2x * t, t2y = c.y + d2y * t;

    // Centre lies along the bisector, at R/sin(a/2) from the corner.
    let bx = d1x + d2x, by = d1y + d2y;
    const bl = hyp(bx, by);
    if (bl < 1e-6) { out.push({ x: c.x, y: c.y, k: K_ARC_HARD }); continue; }
    bx /= bl; by /= bl;
    const h = R / Math.sin(a / 2);
    const ox = c.x + bx * h, oy = c.y + by * h;

    let s0 = Math.atan2(t1y - oy, t1x - ox);
    let s1 = Math.atan2(t2y - oy, t2x - ox);
    let sweep = s1 - s0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;

    // Tight fillets are hammered corners; open ones are the wire's own spring.
    const k = K_ARC_SOFT + (K_ARC_HARD - K_ARC_SOFT) * Math.pow(1 - round, 1.4);
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.22));
    for (let s = 0; s <= steps; s++) {
      const ang = s0 + sweep * (s / steps);
      out.push({ x: ox + Math.cos(ang) * R, y: oy + Math.sin(ang) * R, k });
    }
  }

  if (!closed) {
    const e = nodes[n - 1];
    out.push({ x: e.x, y: e.y, k: K_STRAIGHT });
  } else if (out.length) {
    out.push({ ...out[0] });
  }
  return out;
}

/** Spiral off the end of the path, continuing its tangent. */
function spiral(path: Sample[], c: Curl, atEnd: boolean): Sample[] {
  const n = path.length;
  if (n < 2) return [];
  const a = atEnd ? path[n - 2] : path[1];
  const b = atEnd ? path[n - 1] : path[0];
  let tx = b.x - a.x, ty = b.y - a.y;
  const tl = hyp(tx, ty);
  if (tl < 1e-9) return [];
  tx /= tl; ty /= tl;

  const sign = Math.sign(c.turn) || 1;
  const total = Math.abs(c.turn);
  const decay = c.decay ?? 0.45;
  // Centre sits perpendicular to the tangent, on the side we are turning to.
  const steps = Math.max(3, Math.ceil(total / 0.2));
  const out: Sample[] = [];
  let px = b.x, py = b.y, dx = tx, dy = ty, r = c.r;
  const dA = total / steps;
  for (let i = 0; i < steps; i++) {
    // walk an arc of radius r through dA, then shrink r
    const cx = px - dy * r * sign, cy = py + dx * r * sign;
    const ang = Math.atan2(py - cy, px - cx) + sign * dA;
    px = cx + Math.cos(ang) * r;
    py = cy + Math.sin(ang) * r;
    const nd = Math.atan2(dy, dx) + sign * dA;
    dx = Math.cos(nd); dy = Math.sin(nd);
    r *= Math.pow(decay, dA / TAU);
    out.push({ x: px, y: py, k: K_ARC_SOFT });
  }
  return out;
}

/**
 * A traced centreline, with stiffness read off its own curvature.
 *
 * The authored glyphs say how hard each corner was squeezed; a trace has to be
 * asked. Turn per unit length gives it away: nothing is a straight run, a lot
 * over a short distance is a hammered mitre, and the easy middle is the wire's
 * own spring.
 */
function traced(nodes: Node[]): Sample[] {
  const n = nodes.length;
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    let k = K_STRAIGHT;
    if (i > 0 && i < n - 1) {
      const ax = nodes[i].x - nodes[i - 1].x, ay = nodes[i].y - nodes[i - 1].y;
      const bx = nodes[i + 1].x - nodes[i].x, by = nodes[i + 1].y - nodes[i].y;
      const la = hyp(ax, ay), lb = hyp(bx, by);
      if (la > 1e-9 && lb > 1e-9) {
        const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
        const curv = turn / ((la + lb) * 0.5);   // radians per em
        k = curv < 1.2 ? K_STRAIGHT
          : curv < 16 ? K_ARC_SOFT + (K_STRAIGHT - K_ARC_SOFT) * (1 - (curv - 1.2) / 14.8)
          : K_ARC_SOFT + (K_ARC_HARD - K_ARC_SOFT) * Math.min(1, (curv - 16) / 26);
      }
    }
    out.push({ x: nodes[i].x, y: nodes[i].y, k });
  }
  // curvature off single samples is noisy; the stiffness field should not be
  for (let p = 0; p < 3; p++) {
    for (let i = 1; i < n - 1; i++) out[i].k = (out[i - 1].k + 2 * out[i].k + out[i + 1].k) / 4;
  }
  return out;
}

/** Even spacing is what makes it a rope rather than a drawing. */
function resample(path: Sample[], step: number): Sample[] {
  if (path.length < 2) return path.slice();
  const out: Sample[] = [{ ...path[0] }];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const seg = hyp(b.x - a.x, b.y - a.y);
    if (seg < 1e-9) continue;
    let d = step - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        k: a.k + (b.k - a.k) * t,
      });
      d += step;
    }
    carry = seg - (d - step);
  }
  const tail = path[path.length - 1];
  const lastOut = out[out.length - 1];
  // Keep the cut end where the smith put it, unless it lands on top of a bead.
  if (hyp(tail.x - lastOut.x, tail.y - lastOut.y) > step * 0.35) out.push({ ...tail });
  else { lastOut.x = tail.x; lastOut.y = tail.y; }
  return out;
}

/** Build the full centreline for a strand, at a given bead spacing. */
export function centreline(s: Strand, step: number): Sample[] {
  let path = s.raw ? traced(s.nodes) : fillet(s.nodes, !!s.closed);
  if (s.curlA) path = spiral(path, s.curlA, false).reverse().concat(path);
  if (s.curlB) path = path.concat(spiral(path, s.curlB, true));
  return resample(path, step);
}

// --------------------------------------------------------------------------
// The rod
// --------------------------------------------------------------------------

/**
 * Verlet beads with three constraints, solved in that order every step:
 *
 *   length  the wire does not stretch
 *   bend    every joint remembers the angle it was bent to, and how hard
 *   home    each bead knows where it belongs on the letter
 *
 * Drop `home` to zero and it is a loose piece of wire falling. Raise it and
 * the word reassembles itself. Pin a bead and drag another and you have IK.
 */
export class Rod {
  readonly n: number;
  link: number;
  x: Float32Array; y: Float32Array;
  px: Float32Array; py: Float32Array;
  hx: Float32Array; hy: Float32Array;  // home — the letterform
  private sx: Float32Array; private sy: Float32Array;  // pre-constraint scratch
  stiff: Float32Array;                  // per interior joint
  /**
   * How far apart bead i-1 and bead i+1 sit when the joint is bent the way the
   * letter wants it. This is the bend memory, held as a length rather than an
   * angle — see solveBend for why.
   */
  span: Float32Array;
  pinned: Uint8Array;
  z: number;
  /** Ink for the whole strand; set by the typesetter. */
  color: [number, number, number] = [200, 170, 110];
  part = 'wire';

  constructor(pts: Sample[], link: number, z = 0) {
    this.n = pts.length;
    this.link = link;
    this.z = z;
    const n = this.n;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.hx = new Float32Array(n); this.hy = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n);
    this.pinned = new Uint8Array(n);
    this.stiff = new Float32Array(Math.max(0, n - 2));
    this.span = new Float32Array(Math.max(0, n - 2));
    for (let i = 0; i < n; i++) {
      this.x[i] = this.px[i] = this.hx[i] = pts[i].x;
      this.y[i] = this.py[i] = this.hy[i] = pts[i].y;
    }
    for (let i = 1; i < n - 1; i++) this.stiff[i - 1] = pts[i].k;
    this.reseat();
  }

  /**
   * Even out the curvature before anything else sees the letter.
   *
   * An arc authored as a polygon has curvature that steps; a real sprung wire
   * has curvature that flows. Nudging each soft bead toward the midpoint of its
   * neighbours converges on the elastica — the shape a bent rod actually takes
   * — and it is the difference between a letter that looks plotted and one
   * that looks bent. Hard joints are excluded: the mitre must stay a mitre.
   */
  relax(passes = 6, amount = 0.5): void {
    const n = this.n;
    if (n < 4) return;
    const tx = new Float32Array(n), ty = new Float32Array(n);
    for (let p = 0; p < passes; p++) {
      tx.set(this.hx); ty.set(this.hy);
      for (let i = 1; i < n - 1; i++) {
        const soft = 1 - this.stiff[i - 1];
        if (soft < 0.2) continue;   // a mitre is not up for discussion
        const w = soft * amount;
        tx[i] += ((this.hx[i - 1] + this.hx[i + 1]) * 0.5 - this.hx[i]) * w;
        ty[i] += ((this.hy[i - 1] + this.hy[i + 1]) * 0.5 - this.hy[i]) * w;
      }
      this.hx.set(tx); this.hy.set(ty);
    }
    this.respace();
    this.reseat();
  }

  /**
   * Smoothing pulls beads together unevenly, and unevenly spaced beads make an
   * inextensible rope behave like a stretchy one. Lay them back out at equal
   * arc length along the curve they now describe, and adopt that spacing as the
   * link length so the solver and the shape agree.
   */
  private respace(): void {
    const n = this.n;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + hyp(this.hx[i] - this.hx[i - 1], this.hy[i] - this.hy[i - 1]);
    }
    const total = cum[n - 1];
    if (total < 1e-9) return;
    const step = total / (n - 1);
    const nx = new Float32Array(n), ny = new Float32Array(n);
    nx[0] = this.hx[0]; ny[0] = this.hy[0];
    nx[n - 1] = this.hx[n - 1]; ny[n - 1] = this.hy[n - 1];
    let j = 1;
    for (let i = 1; i < n - 1; i++) {
      const d = step * i;
      while (j < n - 1 && cum[j] < d) j++;
      const seg = cum[j] - cum[j - 1];
      const t = seg > 1e-12 ? (d - cum[j - 1]) / seg : 0;
      nx[i] = this.hx[j - 1] + (this.hx[j] - this.hx[j - 1]) * t;
      ny[i] = this.hy[j - 1] + (this.hy[j] - this.hy[j - 1]) * t;
    }
    this.hx.set(nx); this.hy.set(ny);
    this.link = step;
  }

  /**
   * Move the letterform, then take the new shape as the one to remember.
   *
   * This is where hand-work gets in: the wander of a hammered run, a glyph set
   * a degree off square, a gauge that varies down the length. It has to happen
   * AFTER relax() — the elastica pass would only smooth it back out — and the
   * rest angles have to be re-read afterwards or the rod would spend every
   * frame trying to straighten the very irregularity we just put in.
   */
  warp(f: (x: number, y: number, t: number, i: number) => Pt): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const p = f(this.hx[i], this.hy[i], n > 1 ? i / (n - 1) : 0, i);
      this.hx[i] = p.x; this.hy[i] = p.y;
    }
    this.reseat();
  }

  /** Re-read the bend memory from wherever home now is. */
  reseat(): void {
    for (let i = 1; i < this.n - 1; i++) {
      this.span[i - 1] = hyp(this.hx[i + 1] - this.hx[i - 1], this.hy[i + 1] - this.hy[i - 1]);
    }
    this.snap();
  }

  /** Unit tangent at bead i, for offsetting along the normal. */
  tangent(i: number): Pt {
    const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
    const dx = this.hx[b] - this.hx[a], dy = this.hy[b] - this.hy[a];
    const l = hyp(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }

  /** Total cut length of this piece of wire, in em. */
  get length(): number { return this.link * (this.n - 1); }

  /** Drop the whole rod onto its home. Used to seed and to hard-reset. */
  snap(): void {
    for (let i = 0; i < this.n; i++) {
      this.x[i] = this.px[i] = this.hx[i];
      this.y[i] = this.py[i] = this.hy[i];
    }
  }

  step(opts: {
    dt: number;
    gravity?: number;   // em/s², negative is down
    damp?: number;      // 0..1 velocity kept per step
    home?: number;      // 0..1 pull toward the letterform, per step
    bend?: number;      // 0..1 how much of the rest angle is enforced
    iters?: number;
    absorb?: number;    // 0..1 how much constraint work is kept out of velocity
  }): void {
    const n = this.n;
    if (n < 2) return;
    const dt = opts.dt;
    const damp = opts.damp ?? 0.94;
    const g = (opts.gravity ?? 0) * dt * dt;
    const home = opts.home ?? 0;
    const bendAmt = opts.bend ?? 1;
    const iters = opts.iters ?? 6;

    // Verlet reads velocity back out of the last frame's positions, so every
    // correction the constraint solver makes becomes momentum on the next step.
    // Bend and length corrections can then feed each other and the rod cooks
    // itself apart — slowly, so it looks fine for a second and then explodes.
    // Capping the step length is the cheap, standard guard, and at three links
    // per step it never touches anything that is behaving.
    const vmax = this.link * 3;
    const vmax2 = vmax * vmax;

    for (let i = 0; i < n; i++) {
      if (this.pinned[i]) { this.px[i] = this.x[i]; this.py[i] = this.y[i]; continue; }
      let vx = (this.x[i] - this.px[i]) * damp;
      let vy = (this.y[i] - this.py[i]) * damp;
      const v2 = vx * vx + vy * vy;
      if (v2 > vmax2) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; }
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      this.x[i] += vx;
      this.y[i] += vy + g;
      if (home > 0) {
        this.x[i] += (this.hx[i] - this.x[i]) * home;
        this.y[i] += (this.hy[i] - this.y[i]) * home;
      }
    }

    // Remember where the integrator left things, so the constraint solver's
    // corrections can be kept out of next frame's velocity.
    const absorb = opts.absorb ?? 0.65;
    if (absorb > 0) { this.sx.set(this.x); this.sy.set(this.y); }

    for (let it = 0; it < iters; it++) {
      this.solveLength();
      if (bendAmt > 0) this.solveBend(bendAmt);
    }

    // Bend and length corrections disagree at every mitre, and Verlet would
    // read that disagreement back as speed — a zigzag like N slowly shakes
    // itself off the letter. Feeding the correction into `prev` as well means
    // the rod still MOVES where the constraints put it, but does not gain
    // energy from having been put there.
    if (absorb > 0) {
      for (let i = 0; i < n; i++) {
        if (this.pinned[i]) continue;
        this.px[i] += (this.x[i] - this.sx[i]) * absorb;
        this.py[i] += (this.y[i] - this.sy[i]) * absorb;
      }
    }
  }

  private solveLength(): void {
    const n = this.n, L = this.link;
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1;
      let dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
      const d = hyp(dx, dy);
      if (d < 1e-9) continue;
      const corr = (d - L) / d * 0.5;
      const wi = this.pinned[i] ? 0 : 1, wj = this.pinned[j] ? 0 : 1;
      const w = wi + wj;
      if (w === 0) continue;
      dx *= corr; dy *= corr;
      this.x[i] += dx * (2 * wi / w); this.y[i] += dy * (2 * wi / w);
      this.x[j] -= dx * (2 * wj / w); this.y[j] -= dy * (2 * wj / w);
    }
  }

  /**
   * Bending, held as the distance across the joint rather than the angle at it.
   *
   * The obvious formulation — measure the angle at bead i, rotate its two
   * neighbours until it matches — buckles. Straightening joint i is done by
   * moving i-1 and i+1, which bends joints i-1 and i+1, and on a long straight
   * run those corrections chase each other into a standing zigzag that
   * satisfies every length constraint exactly and never decays. Every stem in
   * the word grows a sawtooth.
   *
   * Two beads either side of a joint sit a fixed distance apart for a given
   * bend, so the same information is a plain distance constraint between i-1
   * and i+1 — which cannot buckle, because ANY zigzag pulls those two beads
   * closer together and the constraint pushes straight back. It also costs less
   * than the angular form. The one thing it gives up is the sign of the bend,
   * so a piece with no memory of where it belongs may flip a curl the wrong
   * way; for a length of wire that has been cut loose, that is not a lie.
   */
  private solveBend(amt: number): void {
    const n = this.n;
    for (let i = 1; i < n - 1; i++) {
      const k = this.stiff[i - 1] * amt;
      if (k <= 0) continue;
      const a = i - 1, c = i + 1;
      let dx = this.x[c] - this.x[a], dy = this.y[c] - this.y[a];
      const d = hyp(dx, dy);
      if (d < 1e-9) continue;
      const wa = this.pinned[a] ? 0 : 1, wc = this.pinned[c] ? 0 : 1;
      const w = wa + wc;
      if (w === 0) continue;
      const corr = (d - this.span[i - 1]) / d * k * 0.5;
      dx *= corr; dy *= corr;
      this.x[a] += dx * (2 * wa / w); this.y[a] += dy * (2 * wa / w);
      this.x[c] -= dx * (2 * wc / w); this.y[c] -= dy * (2 * wc / w);
    }
  }

  /** Shove the wire away from a point — a cursor, a blast, a falling body. */
  push(cx: number, cy: number, radius: number, force: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.n; i++) {
      if (this.pinned[i]) continue;
      const dx = this.x[i] - cx, dy = this.y[i] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const f = (1 - d / radius) * force;
      this.x[i] += (dx / d) * f;
      this.y[i] += (dy / d) * f;
    }
  }
}
