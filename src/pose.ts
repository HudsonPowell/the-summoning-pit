// Drivers -> joints, every frame, for any body plan.
//
// The body is a curve of segments. Everything else hangs off a POSITION along
// that curve, so a spider's eight legs, a hydra's two necks and a hippo's
// enormous snout are all the same operation. Layers claim chains by role:
// locomotion takes every 'leg', swing takes 'arm', flap takes 'wing', wave
// takes 'tail', and nothing anywhere counts limbs to decide what it is
// looking at.

import { V3, v3, add, sub, scale, dot, len, norm, cross, lerp as vlerp, TAU, frac, clamp } from './vec';
import {
  Genome, Gait, Mood, ChainSpec, effectiveGait, inkList, defaultInk, mirrorsByDefault, girthAt,
} from './genome';
import { StrikeSpec, WeaponSpec, DEFAULT_STRIKE_LIGHT } from './character';

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
  color: [number, number, number];
  part: string;
}

export interface Intent {
  slash?: { t: number; weight: number; spec?: StrikeSpec };
}

export interface PoseExtras {
  weapon?: WeaponSpec;
  offhand?: WeaponSpec;
  breatheAmp?: number;
  breatheRate?: number;
  /**
   * Secondary motion. The caller already knows how fast the creature is
   * turning and how hard it is moving; handing that over lets the body lean
   * into a turn and the loose parts trail behind it, which is most of what
   * separates "animated" from "alive".
   */
  turn?: number;    // radians/sec, + turning one way
  lookYaw?: number; // where the head wants to point, relative to facing
  /**
   * The springs (src/secondary.ts). These are the parts that are LATE: the
   * bank that overshoots the turn, the torso dragged round after the feet,
   * weight landing, and flesh still moving after the frame stopped.
   */
  lean?: number;
  twist?: number;
  bob?: number;
  jiggle?: number;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mul(c: [number, number, number], s: number): [number, number, number] {
  return [c[0] * s, c[1] * s, c[2] * s];
}

function twoBoneIK(root: V3, target: V3, l1: number, l2: number, pole: V3): V3 {
  const d = sub(target, root);
  const dist = clamp(len(d), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = norm(d);
  const perp = norm(sub(pole, scale(dir, dot(pole, dir))));
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return add(add(root, scale(dir, a)), scale(perp, h));
}

function footTrack(p: number, g: Gait): { x: number; y: number } {
  const S = g.stance;
  const travel = g.stride * S;
  if (p < S) {
    const u = p / S;
    return { x: (0.5 - u) * travel, y: 0 };
  }
  const u = (p - S) / (1 - S);
  const e = (1 - Math.cos(Math.PI * u)) / 2;
  return { x: (-0.5 + e) * travel, y: g.lift * Math.sin(Math.PI * u) };
}

function slashDir(u: number, s: StrikeSpec): V3 {
  const p0 = v3(s.posts[0][0], s.posts[0][1], s.posts[0][2]);
  const p1 = v3(s.posts[1][0], s.posts[1][1], s.posts[1][2]);
  const p2 = v3(s.posts[2][0], s.posts[2][1], s.posts[2][2]);
  const a = vlerp(p0, p1, u), b = vlerp(p1, p2, u);
  return norm(vlerp(a, b, u));
}
function slashU(t: number, s: StrikeSpec): number {
  const w = s.windup, st = s.strike;
  if (t < w) return 0.25 * (t / w);
  if (t < w + st) return 0.25 + 0.6 * ((t - w) / st);
  return 0.85 + 0.15 * ((t - w - st) / Math.max(1e-4, 1 - w - st));
}
export function slashWeight(t: number): number {
  const inW = clamp(t / 0.12, 0, 1);
  const outW = 1 - clamp((t - 0.82) / 0.18, 0, 1);
  return inW * outW;
}

const ANKLE_H = 0.06;

export function solvePose(
  genome: Genome,
  mood: Mood,
  phase: number,
  move = 1,
  idleT = 0,
  intent?: Intent,
  collapse = 0,
  extras?: PoseExtras,
): Capsule[] {
  const sk = genome.skeleton;
  const g = effectiveGait(genome.gait, mood);
  const caps: Capsule[] = [];
  const co = clamp(collapse, 0, 1);
  const mv = clamp(move, 0, 1) * (1 - co);
  const breathe =
    (1 - mv) * 0.012 * (extras?.breatheAmp ?? 1) *
    Math.sin(TAU * (extras?.breatheRate ?? 0.35) * idleT);

  const inks = inkList(genome.palette).map(hex);
  const inkOf = (c: ChainSpec) => inks[c.ink ?? defaultInk(c.role)] ?? inks[1];
  const cTorso = inks[0];

  const slumpCo = g.slump + co * 1.0;
  const leanCo = g.lean + co * 0.3;
  const headCo = g.headPitch + co * 0.8;

  // the strike is resolved before the body, because a lunge moves the body
  const slash0 = intent?.slash;
  const spec0 = slash0?.spec ?? DEFAULT_STRIKE_LIGHT;
  const strikeW = slash0 ? slash0.weight : 0;
  const strikeU = slash0 ? slashU(clamp(slash0.t, 0, 1), spec0) : 0;
  // drive forward through the strike, recover after it
  const lungeAmt = (spec0.lunge ?? 0) * strikeW * Math.sin(Math.PI * Math.min(1, strikeU * 1.15));
  const turnRate = extras?.turn ?? 0;
  const sLean = extras?.lean ?? 0;
  const sTwist = extras?.twist ?? 0;
  const sBob = extras?.bob ?? 0;
  const sJig = extras?.jiggle ?? 0;
  // the wobble travels along the body rather than moving all of it at once
  const jigAt = (u: number) => sJig * Math.sin(u * 3.1 + 0.6) * 0.5;

  const legs = sk.chains.filter(c => c.role === 'leg').sort((a, b) => a.at - b.at);
  const N = Math.max(1, sk.body.length);
  const slither = sk.locomotion === 'slither' || legs.length === 0;
  const flying = sk.locomotion === 'fly';

  // --- the body curve --------------------------------------------------
  // Nodes run rear/bottom (0) to front/top (N). Everything hangs off it.
  const nodes: V3[] = [];
  const fattest = Math.max(...sk.girth, 0.05);

  // how high the body rides: a leg holds its own attachment point up
  const supportH = (at: number): number => {
    if (slither) return fattest * 0.9;
    let best = legs[0];
    let bestD = Infinity;
    for (const l of legs) {
      const d = Math.abs(l.at - at);
      if (d < bestD) { bestD = d; best = l; }
    }
    const legLen = best.seg[0] + (best.seg[1] ?? 0);
    return legLen * 0.985 - g.crouch + ANKLE_H;
  };

  const waveAt = (i: number) => {
    const amp = g.bodyWave * (slither ? 0.35 + 0.65 * mv : mv);
    // several bends travelling down a long body, few down a short one — a
    // snake needs to READ as a snake, and one lazy curve does not
    const cycles = slither ? 5.6 : 2.4;
    const reach = slither ? 0.3 : 0.12;
    return Math.sin(TAU * phase - (i / N) * cycles) * amp * reach;
  };

  if (sk.upright) {
    const hipH = supportH(0) * (1 - 0.72 * co);
    let p = v3(leanCo * 0.12,
      hipH + g.bounce * Math.cos(2 * TAU * (phase - 0.3)) * mv + breathe + sBob,
      -g.sway * Math.cos(TAU * (phase - 0.3)) * mv);
    nodes.push(p);
    for (let i = 0; i < N; i++) {
      // lean rises up the spine, slump concentrates at the top
      const u = (i + 1) / N;
      const ang = leanCo * (0.6 + 0.7 * u) + slumpCo * u * u;
      p = add(p, v3(Math.sin(ang) * sk.body[i], Math.cos(ang) * sk.body[i], waveAt(i)));
      // banking into a turn, strongest at the top of the spine — and the
      // spring carries it past the turn and back
      nodes.push(add(p, v3(
        lungeAmt * u + sTwist * 0.09 * u,
        jigAt(u) * 0.35,
        -turnRate * 0.06 * u + sLean * 0.16 * u * u + jigAt(u),
      )));
    }
  } else {
    const total = sk.body.reduce((a, b) => a + b, 0);
    const hover = flying ? 0.25 * mv : 0;
    let x = -total * 0.5;
    for (let i = 0; i <= N; i++) {
      const at = i / N;
      const h = supportH(at) * (1 - 0.72 * co) + hover
        + g.bounce * Math.cos(2 * TAU * (phase - 0.3 - at * 0.25)) * mv
        + breathe - slumpCo * 0.12 * at + sBob + jigAt(at) * 0.4;
      nodes.push(v3(
        x + lungeAmt * (0.35 + 0.65 * at) + sTwist * 0.06 * at,
        h,
        waveAt(i) + -g.sway * Math.cos(TAU * (phase - 0.3)) * mv * (1 - at)
          - turnRate * 0.05 * at + sLean * 0.2 * at + jigAt(at),
      ));
      if (i < N) x += sk.body[i];
    }
  }

  // draw the body as tapering capsules
  for (let i = 0; i < N; i++) {
    caps.push({
      a: nodes[i], b: nodes[i + 1],
      r: (girthAt(sk, i) + girthAt(sk, i + 1)) * 0.5,
      color: mul(cTorso, 0.94 + 0.12 * (i / N)),
      part: 'body',
    });
  }

  // --- attachment frame -------------------------------------------------
  const hipTwist = g.pelvisTwist * Math.sin(TAU * phase) * mv;
  const slash = slash0;
  const spec = spec0;
  const limb = spec.limb ?? 'arm';
  // only the limb that owns the move gets the weight
  const sw2 = limb === 'arm' ? strikeW : 0;
  const headStrike = limb === 'head' ? strikeW : 0;
  const tailStrike = limb === 'tail' ? strikeW : 0;
  const su = strikeU;
  const slashTw = sw2 * spec.twist * (su < 0.3 ? -su / 0.3 : Math.sin((Math.PI * (su - 0.3)) / 0.7));
  const chestTwist = -g.shoulderTwist * Math.sin(TAU * phase) * mv - slashTw;

  const curveAt = (t: number): V3 => {
    const f = clamp(t, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return vlerp(nodes[i], nodes[i + 1], f - i);
  };
  const twistAt = (t: number) => hipTwist + (chestTwist - hipTwist) * clamp(t, 0, 1);
  /** forward along the body at t, in world terms */
  const fwdAt = (t: number): V3 => {
    const f = clamp(t, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return norm(sub(nodes[i + 1], nodes[i]));
  };

  const attachPoint = (c: ChainSpec, side: number, yOff = 0): V3 => {
    const base = curveAt(c.at);
    const tw = twistAt(c.at);
    return add(base, v3(-side * c.spread * Math.sin(tw), yOff, side * c.spread * Math.cos(tw)));
  };

  const sidesOf = (c: ChainSpec): number[] =>
    (c.mirror ?? mirrorsByDefault(c.role)) ? [-1, 1] : [0];

  // --- locomotion: claims every leg -------------------------------------
  // One rule sets the whole gait library. Few legs: offset by where they sit
  // on the body (the lateral-sequence walk). Many legs: a wave down the body.
  legs.forEach((chain, li) => {
    for (const side of [-1, 1] as const) {
      const spreadOff = legs.length >= 3
        ? (li / legs.length) * 0.5
        : chain.at * 0.25;
      const p = frac(phase + spreadOff + (side < 0 ? 0 : 0.5));
      const t = footTrack(p, g);
      const hip = attachPoint(chain, side);
      // A PLANTED FOOT DOES NOT MOVE. During stance the track retreats by
      // exactly stride*stance, which is exactly how far the body travels in
      // that time — so the foot holds its place in the world and the body
      // passes over it. Scaling that retreat by `mv` broke it: a creature
      // circling in a fight has move=0.45 and covers ground at full speed, so
      // its feet gave back less than half the distance and skated the rest.
      // The blend is redundant anyway, because phase only advances with
      // distance travelled — stand still and the feet are already frozen.
      // It survives only as a settle, easing the legs to neutral when a
      // creature genuinely stops rather than leaving one in mid-air.
      const settle = clamp(mv / 0.3, 0, 1);
      const ankle = v3(hip.x + t.x * settle, t.y * settle + ANKLE_H, hip.z * 0.94);
      const knee = twoBoneIK(hip, ankle, chain.seg[0], chain.seg[1] ?? chain.seg[0], v3(1, 0, 0));
      const swingU = p < g.stance ? 0 : (p - g.stance) / (1 - g.stance);
      const toePitch = (p < g.stance ? 0 : 0.5 * Math.sin(Math.PI * swingU)) * mv;
      const footLen = (chain.seg[1] ?? chain.seg[0]) * 0.37;
      const toe = add(ankle, v3(footLen * Math.cos(toePitch), footLen * Math.sin(toePitch), 0));
      const shade = side < 0 ? 0.82 : 1.0;
      const ink = inkOf(chain);
      caps.push({ a: hip, b: knee, r: chain.r * 1.15, color: mul(ink, shade), part: 'thigh' });
      caps.push({ a: knee, b: ankle, r: chain.r, color: mul(ink, shade * 0.9), part: 'shin' });
      caps.push({ a: ankle, b: toe, r: chain.r * 0.9, color: mul(inks[3], shade), part: 'foot' });
    }
  });

  // --- heads: a chain of segments ending in a skull ----------------------
  for (const chain of sk.chains.filter(c => c.role === 'head')) {
    for (const side of sidesOf(chain)) {
      let p = attachPoint(chain, side);
      const ink = inkOf(chain);
      // a bite rears the head back, then snaps it forward and down
      const bite = headStrike * (spec.reachMin +
        (spec.reachMax - spec.reachMin) * Math.sin(Math.PI * su));
      const biteAng = headStrike * (su < 0.3 ? 0.55 : -0.75 * Math.sin(Math.PI * (su - 0.3) / 0.7));
      const look = (extras?.lookYaw ?? 0) * (1 - headStrike * 0.5);
      const baseAng = (chain.angle ?? 0) + headCo + (sk.upright ? 0 : -slumpCo * 0.4) + biteAng;
      const fwd = fwdAt(chain.at);
      // splay multiple heads apart, and carry them along the body's direction
      const yawOff = side * 1.0 * (chain.spread > 0 ? 1 : 0) + look;
      chain.seg.forEach((segLen, i) => {
        const ang = baseAng - i * 0.12 + (sk.upright ? 0 : 0);
        const dir = sk.upright
          ? norm(v3(Math.sin(ang), Math.cos(ang), Math.sin(yawOff) * 0.5))
          : norm(add(scale(fwd, Math.cos(ang)),
              v3(0, Math.sin(ang), Math.sin(yawOff) * 0.6)));
        const q = add(p, scale(dir, segLen * (1 + bite * 0.35)));
        const taper = 1 - 0.18 * (i / Math.max(1, chain.seg.length));
        caps.push({
          a: p, b: q,
          r: chain.r * (i === 0 ? 0.5 : 0.8) * taper,
          color: mul(ink, i === 0 ? 0.85 : 1),
          part: i === 0 ? 'neck' : 'skull',
        });
        p = q;
      });
      caps.push({ a: p, b: p, r: chain.r, color: ink, part: 'head' });
    }
  }

  // --- swing: claims arms, in pairs --------------------------------------
  const armChains = sk.chains.filter(c => c.role === 'arm');
  armChains.forEach((chain, pair) => {
    for (const side of sidesOf(chain)) {
      const s = side === 0 ? 1 : side;
      const hunch = 0.03 * mood.angry;
      const shoulder = attachPoint(chain, s, -0.02 - pair * 0.13 + hunch * 0.7);
      const pArm = frac(phase + (s < 0 ? 0.5 : 0) + pair * 0.06);
      const alpha = g.armSwing * Math.sin(TAU * pArm) * mv + g.lean;
      const beta =
        g.elbowBase + g.elbowAmp * 0.5 * (1 + Math.sin(TAU * (pArm - g.elbowLag))) * mv;
      const dU = v3(Math.sin(alpha), -Math.cos(alpha), s * 0.12);
      let elbow = add(shoulder, scale(norm(dU), chain.seg[0]));
      const dF = v3(Math.sin(alpha + beta), -Math.cos(alpha + beta), s * 0.16);
      let hand = add(elbow, scale(norm(dF), chain.seg[1] ?? chain.seg[0]));

      // intent claims the first right arm only
      if (pair === 0 && s > 0 && sw2 > 0) {
        const l1 = chain.seg[0], l2 = chain.seg[1] ?? chain.seg[0];
        const reach = (l1 + l2) *
          (spec.reachMin + (spec.reachMax - spec.reachMin) * Math.sin(Math.PI * su));
        const target = add(shoulder, scale(slashDir(su, spec), reach));
        hand = vlerp(hand, target, sw2);
        elbow = twoBoneIK(shoulder, hand, l1, l2, v3(-0.6, -0.25, 0.9));
      }

      const shade = (s < 0 ? 0.8 : 1.0) * (1 - pair * 0.12);
      const ink = inkOf(chain);
      caps.push({ a: shoulder, b: elbow, r: chain.r, color: mul(ink, shade * 1.05), part: 'upperArm' });
      caps.push({ a: elbow, b: hand, r: chain.r * 0.9, color: mul(ink, shade * 0.95), part: 'forearm' });
      caps.push({ a: hand, b: hand, r: chain.r * 1.05, color: mul(inks[2], shade * 0.95), part: 'hand' });

      // the right hand holds the weapon, the left holds the shield
      if (pair === 0) {
        const w = s > 0 ? extras?.weapon : extras?.offhand;
        if (w) {
          const ex = norm(sub(hand, elbow));
          let ez = cross(ex, v3(0, 1, 0));
          if (len(ez) < 1e-3) ez = v3(0, 0, 1);
          // mirror the grip for the off hand, so a shield faces out and a
          // second blade curves the other way
          ez = scale(norm(ez), s > 0 ? 1 : -1);
          const ey = cross(ez, ex);
          // Grip space is authored for an average arm. A 1 m greatsword on a
          // 0.6 m imp is a lance, so the weapon scales with the arm holding it.
          const armLen = chain.seg[0] + (chain.seg[1] ?? chain.seg[0]);
          const ws = Math.min(1.5, Math.max(0.45, armLen / 0.58));
          const grip = (p: [number, number, number]): V3 =>
            add(hand, add(scale(ex, p[0] * ws), add(scale(ey, p[1] * ws), scale(ez, p[2] * ws))));
          for (const part of w.parts) {
            caps.push({ a: grip(part.a), b: grip(part.b), r: part.r * ws, color: hex(part.color), part: 'weapon' });
          }
        } else if (s > 0 && genome.weapon?.length) {
          const bladeDir = norm(sub(hand, elbow));
          const tip = add(hand, scale(bladeDir, genome.weapon.length));
          caps.push({ a: add(hand, scale(bladeDir, 0.06)), b: tip, r: genome.weapon.r ?? 0.03,
            color: hex(genome.weapon.color ?? '#cfd6e4'), part: 'blade' });
        }
      }
    }
  });

  // --- flap: claims wings ------------------------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'wing')) {
    const beat = flying ? 1 : mv;
    const flap = beat * g.flapAmp * Math.sin(TAU * 2 * phase)
      + (1 - beat) * 0.12 * Math.sin(TAU * 0.6 * idleT);
    for (const side of sidesOf(chain)) {
      const s = side === 0 ? 1 : side;
      const base = add(attachPoint(chain, s, 0.06), v3(-0.06, 0, 0));
      // elevation stays mostly out to the side: a wing that reaches vertical
      // projects to a spike rather than a wing
      const e = 0.2 + flap * 0.55 - co * 0.9;
      const d0 = norm(v3(-0.2, Math.sin(e), s * Math.cos(e)));
      const mid = add(base, scale(d0, chain.seg[0]));
      const e2 = e - 0.5;
      const d1 = norm(v3(-0.35, Math.sin(e2), s * Math.cos(e2)));
      const tip = add(mid, scale(d1, chain.seg[1] ?? chain.seg[0]));
      const shade = s < 0 ? 0.7 : 0.85;
      const ink = inkOf(chain);
      caps.push({ a: base, b: mid, r: chain.r, color: mul(ink, shade), part: 'wing' });
      caps.push({ a: mid, b: tip, r: chain.r * 0.75, color: mul(ink, shade * 0.85), part: 'wingTip' });
    }
  }

  // --- wave: claims tails -------------------------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'tail')) {
    for (const side of sidesOf(chain)) {
      let p = add(attachPoint(chain, side), scale(fwdAt(chain.at), -girthAt(sk, 0) * 0.6));
      const droop = 0.25 + slumpCo * 0.5 + co * 0.6;
      const ink = inkOf(chain);
      chain.seg.forEach((segLen, i) => {
        const lash = tailStrike * 2.6 *
          (su < 0.35 ? -su / 0.35 : Math.sin(Math.PI * (su - 0.35) / 0.65));
        const yaw =
          g.tailWave * Math.sin(TAU * phase - i * 0.9) * (0.35 + 0.65 * mv) +
          (1 - mv) * 0.15 * Math.sin(TAU * 0.3 * idleT - i * 0.9) +
          lash * (0.4 + 0.6 * (i / Math.max(1, chain.seg.length))) +
          // the tail swings wide when the body turns under it
          turnRate * 0.09 * (1 + i);
        const pitch = (sk.upright ? -0.35 : 0.25) - i * 0.28 - droop * 0.4;
        const d = norm(v3(-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.sin(yaw)));
        const q = add(p, scale(d, segLen));
        caps.push({ a: p, b: q, r: chain.r * (1 - i * 0.22), color: mul(ink, 0.9 - i * 0.08), part: 'tail' });
        p = q;
      });
    }
  }

  // --- static furniture: horns, fins, plates ------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'horn' || c.role === 'fin')) {
    for (const side of sidesOf(chain)) {
      let p = attachPoint(chain, side, chain.role === 'fin' ? 0 : 0.02);
      const fwd = fwdAt(chain.at);
      const ang = chain.angle ?? 0.8;
      const ink = inkOf(chain);
      chain.seg.forEach((segLen, i) => {
        const dir = norm(add(
          scale(fwd, Math.cos(ang) * (chain.role === 'fin' ? 0.15 : 0.6)),
          v3(0, Math.sin(ang), (side === 0 ? 0 : side) * 0.45 * Math.cos(ang)),
        ));
        const q = add(p, scale(dir, segLen));
        caps.push({ a: p, b: q, r: chain.r * (1 - i * 0.3), color: ink, part: chain.role });
        p = q;
      });
    }
  }

  return caps;
}

/** Ground speed implied by the current drivers, for scrolling the floor. */
export function walkSpeed(genome: Genome, mood: Mood): number {
  const g = effectiveGait(genome.gait, mood);
  return g.stride * g.cadence;
}
