import { motionOf, legSides, legOffset, hopHeight, livingMotion, swingVariation } from './motion';
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
import { GearPiece } from './gear';

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
  /** Living drift (personality noise on pace, posture, gaze, limbs); 0 removes it. */
  variation?: number;
  /**
   * Rubber-hose silhouette — bowed continuous limbs, a soft torso, squash and
   * stretch; 0 keeps hinged limbs and a segmented torso. NOTE: neither flag is
   * a true before/after switch. The weapon carry pose, the foot-lift curve and
   * the head's share of breath and bob are always on.
   */
  hose?: number;
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
  gear?: GearPiece[];
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

/** A continuous flexible limb, with fixed endpoints and volume-aware thickness. */
function hoseLimb(caps: Capsule[], root: V3, joint: V3, tip: V3, bow: V3,
  r0: number, r1: number, color: [number, number, number], parts: [string, string], restLength: number) {
  const c1 = add(vlerp(root, joint, 0.88), bow);
  const c2 = sub(vlerp(tip, joint, 0.88), scale(bow, 0.4));
  const points = [root];
  // four, not six: the gpu walks every capsule for every pixel three times,
  // and a limb is most of a creature. Four keeps the bow; six was 2.1x the
  // capsule count of the whole pit.
  const segments = 4;
  let arcLength = 0;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments, u = 1 - t;
    const p = add(add(scale(root, u * u * u), scale(c1, 3 * u * u * t)),
      add(scale(c2, 3 * u * t * t), scale(tip, t * t * t)));
    arcLength += len(sub(p, points[i - 1]));
    points.push(p);
  }
  const thickness = clamp(Math.sqrt(restLength / Math.max(0.01, arcLength)), 0.85, 1.2);
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    caps.push({ a: points[i], b: points[i + 1], r: (r0 + (r1 - r0) * t) * thickness,
      color, part: parts[i < segments / 2 ? 0 : 1] });
  }
}

/** Hermite curve shared by torso drawing and its attachments. */
function softSpine(nodes: V3[], t: number, softness: number): V3 {
  const count = nodes.length - 1, f = clamp(t, 0, 1) * count;
  const i = Math.min(count - 1, Math.floor(f)), u = f - i;
  const a = nodes[i], b = nodes[i + 1];
  const m0 = i === 0 ? sub(b, a) : scale(sub(b, nodes[i - 1]), 0.5);
  const m1 = i + 2 >= nodes.length ? sub(b, a) : scale(sub(nodes[i + 2], a), 0.5);
  const smooth = add(add(scale(a, 2 * u ** 3 - 3 * u * u + 1), scale(m0, u ** 3 - 2 * u * u + u)),
    add(scale(b, -2 * u ** 3 + 3 * u * u), scale(m1, u ** 3 - u * u)));
  return vlerp(vlerp(a, b, u), smooth, softness);
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
  return { x: (-0.5 + e) * travel, y: g.lift * Math.pow(Math.sin(Math.PI * u), 2) * (1.15 - 0.3 * u) };
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
  const hose = clamp(extras?.hose ?? 1, 0, 1);
  const rubber = hose * (1 - co);
  const personality = motionOf(genome);
  const life = livingMotion(genome, idleT, (extras?.variation ?? 1) * (1 - co) * (1 - (intent?.slash?.weight ?? 0) * 0.85));
  const breathe =
    (1 - mv * 0.65) * 0.012 * (extras?.breatheAmp ?? 1) * (1 + life.breath * 0.22) *
    Math.sin(TAU * (extras?.breatheRate ?? personality.breath) * idleT + personality.offset + life.breath * 0.35);

  const inks = inkList(genome.palette).map(hex);
  const inkOf = (c: ChainSpec) => inks[c.ink ?? defaultInk(c.role)] ?? inks[1];
  const cTorso = inks[0];

  const slumpCo = g.slump + co * 1.0;
  const leanCo = g.lean + co * 0.3;
  const headCo = g.headPitch + co * 0.8 + life.drift(5, 0.42) * 0.065;

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

  interface AnchorPoint { at: V3; size: number; dir: V3; side: number }
  const anchors: { head?: AnchorPoint } = {};
  const shoulders: AnchorPoint[] = [];
  // forearms and shins, so a bracer or a greave can find a limb to sit on.
  // Bounded: a spider in greaves is a delight, a spider in eight PAIRS of
  // greaves is a capsule bill nobody asked for.
  const forearms: AnchorPoint[] = [];
  const shins: AnchorPoint[] = [];

  const legs = sk.chains.filter(c => c.role === 'leg').sort((a, b) => a.at - b.at);
  const N = Math.max(1, sk.body.length);
  const slither = sk.locomotion === 'slither' || legs.length === 0;
  const hopping = sk.locomotion === 'hop';
  const hop = hopping ? hopHeight(phase, g) * mv * (1 + life.effort * 0.18) : 0;
  const hopCrouch = hopping && frac(phase) < g.stance
    ? Math.sin(Math.PI * frac(phase) / Math.max(0.01, g.stance)) * Math.min(0.09, g.lift * 0.65) * mv : 0;
  const bounce = hopping ? 0 : g.bounce;
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
    const amp = g.bodyWave * (slither ? (0.35 + 0.65 * mv) * (1 + life.effort * 0.22) : mv);
    // several bends travelling down a long body, few down a short one — a
    // snake needs to READ as a snake, and one lazy curve does not
    const cycles = slither ? 5.6 : 2.4;
    const reach = slither ? 0.3 : 0.12;
    const drift = slither ? life.drift(170, 0.47, i * 0.13) * 0.35 : 0;
    return Math.sin(TAU * phase - (i / N) * cycles + drift) * amp * reach;
  };

  if (sk.upright) {
    const hipH = supportH(0) * (1 - 0.72 * co);
    let p = v3(leanCo * 0.12,
      hipH + bounce * Math.cos(2 * TAU * (phase - 0.3)) * mv + breathe + sBob + hop - hopCrouch,
      -g.sway * Math.cos(TAU * (phase - 0.3)) * mv);
    nodes.push(p);
    for (let i = 0; i < N; i++) {
      // lean rises up the spine, slump concentrates at the top
      const u = (i + 1) / N;
      const ang = leanCo * (0.6 + 0.7 * u) + slumpCo * u * u + life.posture * u * u;
      p = add(p, v3(Math.sin(ang) * sk.body[i], Math.cos(ang) * sk.body[i], waveAt(i)));
      // banking into a turn, strongest at the top of the spine — and the
      // spring carries it past the turn and back
      nodes.push(add(p, v3(
        lungeAmt * u + sTwist * 0.09 * u,
        jigAt(u) * 0.35 + life.drift(6, 0.55) * 0.008 * u,
        -turnRate * 0.06 * u + sLean * 0.16 * u * u + jigAt(u),
      )));
    }
  } else {
    const total = sk.body.reduce((a, b) => a + b, 0);
    const hangingLength = Math.max(0, ...sk.chains.filter(c => c.role === 'tentacle').map(c => c.seg.reduce((a, b) => a + b, 0)));
    const hover = flying ? Math.max(0.25, hangingLength * 0.85) : 0;
    let x = -total * 0.5;
    for (let i = 0; i <= N; i++) {
      const at = i / N;
      const h = supportH(at) * (1 - 0.72 * co) + hover
        + bounce * Math.cos(2 * TAU * (phase - 0.3 - at * 0.25)) * mv
        + breathe + hop - hopCrouch - slumpCo * 0.12 * at + sBob + jigAt(at) * 0.4;
      nodes.push(v3(
        x + lungeAmt * (0.35 + 0.65 * at) + sTwist * 0.06 * at,
        h,
        waveAt(i) + -g.sway * Math.cos(TAU * (phase - 0.3)) * mv * (1 - at)
          - turnRate * 0.05 * at + sLean * 0.2 * at + jigAt(at),
      ));
      if (i < N) x += sk.body[i];
    }
  }

  // Keep foot targets on the undeformed support frame. The flesh can sway,
  // compress and stretch around it without carrying the planted feet along.
  const supportNodes = nodes.map(p => ({ ...p }));
  const bodyLength = sk.body.reduce((sum, value) => sum + value, 0);
  const pulse = Math.sin(2 * TAU * (phase - 0.12));
  const squash = rubber * mv * 0.075 * pulse;
  const stretch = 1 + squash;
  const hipY = nodes[0].y;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const delayed = Math.sin(TAU * (phase - u * 0.22) + life.effort * 0.2);
    if (sk.upright) {
      nodes[i].y = hipY + (nodes[i].y - hipY) * stretch
        - rubber * mv * Math.min(0.075, hipY * 0.075) * pulse;
      nodes[i].x += rubber * mv * bodyLength * 0.12 * u * delayed;
      nodes[i].z += rubber * mv * bodyLength * 0.055 * u * u * Math.sin(TAU * (phase - u * 0.3));
    } else {
      nodes[i].y += rubber * mv * Math.min(0.08, bodyLength * 0.075)
        * Math.sin(2 * TAU * (phase - u * 0.18));
      nodes[i].z += rubber * mv * bodyLength * 0.04 * Math.sin(TAU * (phase - u * 0.28));
    }
  }

  // Even a one-segment torso gets a flexible centre, not just a tilted rod.
  const bodyPoint = (t: number): V3 => {
    const p = softSpine(nodes, t, hose);
    const bend = Math.sin(Math.PI * t) * rubber * mv * bodyLength;
    return add(p, sk.upright
      ? v3(bend * 0.13 * Math.sin(TAU * (phase - t * 0.2)), 0,
          bend * 0.055 * Math.sin(TAU * (phase - t * 0.3)))
      : v3(0, bend * 0.065 * Math.sin(TAU * (phase - t * 0.2)),
          bend * 0.075 * Math.sin(TAU * (phase - t * 0.3))));
  };

  // Smooth curvature and gentle thickness changes replace the hinged torso.
  const bodySteps = hose ? Math.max(4, N * 2) : N;
  for (let i = 0; i < bodySteps; i++) {
    const u = i / bodySteps, v = (i + 1) / bodySteps;
    caps.push({
      a: bodyPoint(u), b: bodyPoint(v),
      r: (girthAt(sk, u * N) + girthAt(sk, v * N)) * 0.5 / Math.sqrt(stretch),
      color: mul(cTorso, 0.94 + 0.12 * u), part: 'body',
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

  const curveAt = bodyPoint;
  const twistAt = (t: number) => hipTwist + (chestTwist - hipTwist) * clamp(t, 0, 1);
  /** forward along the body at t, in world terms */
  const fwdAt = (t: number): V3 => {
    const lo = clamp(t - 0.001, 0, 1), hi = clamp(t + 0.001, 0, 1);
    return norm(sub(bodyPoint(hi), bodyPoint(lo)));
  };

  const attachPoint = (c: ChainSpec, side: number, yOff = 0): V3 => {
    const base = curveAt(c.at);
    const tw = twistAt(c.at);
    return add(base, v3(-side * c.spread * Math.sin(tw), yOff, side * c.spread * Math.cos(tw)));
  };

  const sidesOf = (c: ChainSpec): number[] =>
    (c.mirror ?? mirrorsByDefault(c.role)) ? [-1, 1] : [c.side ?? 0];

  // --- locomotion: claims every leg -------------------------------------
  // One rule sets the whole gait library. Few legs: offset by where they sit
  // on the body (the lateral-sequence walk). Many legs: a wave down the body.
  legs.forEach((chain, li) => {
    for (const side of legSides(chain)) {
      const p = frac(phase + legOffset(genome, chain, li, legs.length, side));
      const variation = swingVariation(p, g,
        life.drift(20 + li * 3 + side, 0.83), life.drift(50 + li * 3 + side, 0.72));
      const t = footTrack(variation.phase, g);
      t.y *= variation.lift;
      const hip = attachPoint(chain, side);
      const support = softSpine(supportNodes, chain.at, 0);
      const plantHip = add(support, v3(-side * chain.spread * Math.sin(twistAt(chain.at)),
        0, side * chain.spread * Math.cos(twistAt(chain.at))));
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
      // A PLANTED FOOT HOLDS ITS LINE. The retreat below cancels the body's
      // travel and the chord cancels its yaw, but the hip also SWAYS — a
      // phase-locked cosine — and the foot re-read its z from the hip every
      // frame, so every planted foot skated gently side to side through its
      // stance: the hip-sway residual. The sway is a pure function of phase,
      // so evaluate it where it stood when THIS foot planted (its p = 0) and
      // hold that. The body then sways over still feet, which is most of
      // what carrying weight looks like. Stateless, like the chord.
      const swayAmp = g.sway * mv * (sk.upright ? 1 : 1 - chain.at);
      const swayDrift = p < g.stance
        ? -swayAmp * (Math.cos(TAU * (phase - 0.3)) - Math.cos(TAU * (phase - p - 0.3)))
        : 0;
      const hipZPlant = plantHip.z - swayDrift;
      let ankle = v3(plantHip.x + t.x * settle, (hopping ? hop : t.y * settle) + ANKLE_H, hipZPlant * 0.94);
      // A PLANTED FOOT DOES NOT TURN EITHER. The stance rule above holds the
      // foot still while the body advances in a straight line, but when the
      // body YAWS the local frame rotates and dragged every planted foot
      // round in an arc — the turning skate. Reconstruct where the world-
      // fixed plant point sits in TODAY'S frame: the plant-time ankle rotated
      // by the yaw accumulated since, minus the travel — which on a turning
      // path is a chord behind the current heading, not a straight retreat.
      // Stateless (turn rate × time in stance), so every caller gets it free.
      const spin = extras?.turn ?? 0;
      if (spin && p < g.stance && settle > 0) {
        const dh = clamp(spin * (p / Math.max(0.2, g.cadence)), -0.7, 0.7) * settle;
        const t0 = footTrack(0.0001, g);
        const trav = (t0.x - t.x) * settle;               // metres since plant
        // the same plant-time z as above: the chord must pivot the foot the
        // sway-held position, or the turn fix would reintroduce the skate
        const px = plantHip.x + t0.x * settle, pz = hipZPlant * 0.94;  // plant-time local
        const ca = Math.cos(dh), sa = Math.sin(dh);
        const rx = px * ca + pz * sa, rz = -px * sa + pz * ca;
        const half = dh / 2;
        const sinc = Math.abs(dh) < 1e-4 ? 1 : Math.sin(dh / 2) / (dh / 2);
        const chord = trav * sinc;
        ankle = v3(
          rx - chord * Math.cos(half),
          ankle.y,
          rz - chord * -Math.sin(half),
        );
      }
      // Side clearance fades to zero at both ends, so stance feet never inherit noise.
      ankle.z += (hopping ? 0 : variation.arc) * life.drift(80 + li * 3 + side, 0.61) * 0.025 * mv;
      const knee = twoBoneIK(hip, ankle, chain.seg[0], chain.seg[1] ?? chain.seg[0], v3(1, 0, 0));
      const swingU = p < g.stance ? 0 : (p - g.stance) / (1 - g.stance);
      const toePitch = (p < g.stance ? 0 : 0.5 * Math.sin(Math.PI * swingU)) * mv;
      const footLen = (chain.seg[1] ?? chain.seg[0]) * 0.37;
      const toe = add(ankle, v3(footLen * Math.cos(toePitch), footLen * Math.sin(toePitch), 0));
      const shade = side < 0 ? 0.82 : 1.0;
      const ink = inkOf(chain);
      if (hose) {
        const legLength = chain.seg[0] + (chain.seg[1] ?? chain.seg[0]);
        const bow = v3(rubber * legLength * (0.12 + 0.15 * Math.sin(TAU * (p - 0.12))) * (0.25 + 0.75 * mv),
          0, rubber * side * legLength * 0.035 * Math.sin(TAU * (p - 0.2)) * mv);
        hoseLimb(caps, hip, knee, ankle, bow, chain.r * 1.15, chain.r * 0.9,
          mul(ink, shade), ['thigh', 'shin'], legLength);
      } else {
        caps.push({ a: hip, b: knee, r: chain.r * 1.15, color: mul(ink, shade), part: 'thigh' });
        caps.push({ a: knee, b: ankle, r: chain.r, color: mul(ink, shade * 0.9), part: 'shin' });
      }
      caps.push({ a: ankle, b: toe, r: chain.r * 0.9, color: mul(inks[3], shade) , part: 'foot' });
      if (shins.length < 4) {
        shins.push({ at: vlerp(knee, ankle, 0.5), size: chain.r * 3.2, dir: norm(sub(ankle, knee)), side: side === 0 ? 1 : side });
      }
    }
  });

  // --- heads: a chain of segments ending in a skull ----------------------
  for (const chain of sk.chains.filter(c => c.role === 'head')) {
    for (const side of sidesOf(chain)) {
      let p = attachPoint(chain, side);
      p.y -= (sBob + breathe) * 0.6 * (1 - co);
      let lastHeadDir = v3(0, 1, 0);
      const ink = inkOf(chain);
      // a bite rears the head back, then snaps it forward and down
      const bite = headStrike * (spec.reachMin +
        (spec.reachMax - spec.reachMin) * Math.sin(Math.PI * su));
      const biteAng = headStrike * (su < 0.3 ? 0.55 : -0.75 * Math.sin(Math.PI * (su - 0.3) / 0.7));
      const look = ((extras?.lookYaw ?? 0) + life.gaze * (extras?.lookYaw == null ? 1 : 0.35)) * (1 - headStrike * 0.5);
      const baseAng = (chain.angle ?? 0) + headCo + (sk.upright ? 0 : -slumpCo * 0.4) + biteAng;
      const fwd = fwdAt(chain.at);
      // splay multiple heads apart, and carry them along the body's direction
      const yawOff = side * 1.0 * (chain.spread > 0 ? 1 : 0) + (chain.yaw ?? 0) + look;
      chain.seg.forEach((segLen, i) => {
        const ang = baseAng - i * 0.12 + (sk.upright ? 0 : 0);
        lastHeadDir = sk.upright
          ? norm(v3(Math.sin(ang), Math.cos(ang), Math.sin(yawOff) * 0.5))
          : norm(add(scale(fwd, Math.cos(ang)),
              v3(0, Math.sin(ang), Math.sin(yawOff) * 0.6)));
        const q = add(p, scale(lastHeadDir, segLen * (1 + bite * 0.35)));
        const taper = 1 - 0.18 * (i / Math.max(1, chain.seg.length));
        caps.push({
          a: p, b: q,
          r: chain.r * (i === 0 ? 0.5 : 0.8) * taper * (1 + ((chain.taper ?? 1) - 1) * i / Math.max(1, chain.seg.length - 1)),
          color: mul(ink, i === 0 ? 0.85 : 1),
          part: i === 0 ? 'neck' : 'skull',
        });
        p = q;
      });
      caps.push({ a: p, b: p, r: chain.r * (chain.taper ?? 1), color: ink, part: 'head' });
      // where a helmet goes, and how big it has to be
      if (!anchors.head) anchors.head = { at: p, size: chain.r * 2.1, dir: sk.upright ? v3(1, 0, 0) : lastHeadDir, side: 1 };
    }
  }

  // --- swing: claims arms, in pairs --------------------------------------
  const armChains = sk.chains.filter(c => c.role === 'arm');
  armChains.forEach((chain, pair) => {
    for (const side of sidesOf(chain)) {
      const s = side === 0 ? 1 : side;
      const hunch = 0.03 * mood.angry;
      const shoulder = attachPoint(chain, s, -0.02 - pair * 0.13 + hunch * 0.7);
      const armDrift = life.drift(110 + pair * 3 + s, 0.56, 0.16);
      const pArm = frac(phase + (s < 0 ? 0.5 : 0) + pair * 0.06 + armDrift * 0.055);
      const alpha = g.armSwing * (1 + life.effort * 0.16 + armDrift * 0.22) * Math.sin(TAU * pArm) * mv + g.lean + armDrift * 0.055;
      const beta =
        g.elbowBase + life.drift(130 + pair * 3 + s, 0.44, 0.28) * 0.085 + g.elbowAmp * 0.5 * (1 + Math.sin(TAU * (pArm - g.elbowLag - armDrift * 0.03))) * mv;
      const dU = v3(Math.sin(alpha), -Math.cos(alpha), s * 0.12);
      let elbow = add(shoulder, scale(norm(dU), chain.seg[0]));
      const dF = v3(Math.sin(alpha + beta), -Math.cos(alpha + beta), s * 0.16);
      let hand = add(elbow, scale(norm(dF), chain.seg[1] ?? chain.seg[0]));

      const armLength = chain.seg[0] + (chain.seg[1] ?? chain.seg[0]);
      const armStretch = 1 + rubber * mv * 0.09 * Math.sin(TAU * (pArm - 0.18));
      hand = add(shoulder, scale(sub(hand, shoulder), armStretch));

      const rawHeld = pair === 0 ? (s > 0 ? (extras && 'weapon' in extras ? extras.weapon : genome.weapon) : (extras && 'offhand' in extras ? extras.offhand : genome.offhand)) : undefined;
      const held = rawHeld?.parts?.length ? { ...rawHeld, name: rawHeld.name ?? 'relic', parts: rawHeld.parts } : undefined;
      const heldStrike = s > 0 ? sw2 : 0;
      if (held) {
        const shield = /shield|buckler/.test(held.name.toLowerCase());
        const carryTarget = add(shoulder, v3(armLength * (shield ? 0.8 : 0.4), -armLength * 0.4, s * armLength * 0.18));
        hand = vlerp(hand, carryTarget, 0.88 * (1 - heldStrike));
        elbow = twoBoneIK(shoulder, hand, chain.seg[0], chain.seg[1] ?? chain.seg[0], v3(-0.2, -0.4, s));
      }

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
      if (pair === 0) shoulders.push({ at: shoulder, size: chain.r * 2.6, dir: fwdAt(chain.at), side: s });
      if (forearms.length < 4) {
        forearms.push({ at: vlerp(elbow, hand, 0.45), size: chain.r * 3.4, dir: norm(sub(hand, elbow)), side: s });
      }
      if (hose) {
        const bow = v3(-rubber * armLength * 0.22 * Math.sin(TAU * (pArm - 0.12)) * mv,
          0, rubber * s * armLength * 0.065 * (0.25 + 0.75 * mv));
        hoseLimb(caps, shoulder, elbow, hand, bow, chain.r, chain.r * 0.88,
          mul(ink, shade), ['upperArm', 'forearm'], armLength);
      } else {
        caps.push({ a: shoulder, b: elbow, r: chain.r, color: mul(ink, shade * 1.05), part: 'upperArm' });
        caps.push({ a: elbow, b: hand, r: chain.r * 0.9, color: mul(ink, shade * 0.95), part: 'forearm' });
      }
      caps.push({ a: hand, b: hand, r: chain.r * 1.05, color: mul(inks[2], shade * 0.95), part: 'hand' });

      // the right hand holds the weapon, the left holds the shield
      if (pair === 0) {
        const w = held;
        if (w) {
          // A weapon runs along the forearm, so an arm hanging at rest points
          // it straight at the floor — every armed creature stood there using
          // its greatsword as a walking stick. Carry it: at rest the grip is
          // swung up and forward, and it only lines up with the arm as the
          // swing takes over.
          const along = norm(sub(hand, elbow));
          const name = w.name.toLowerCase();
          const carried = /shield|buckler/.test(name) ? norm(v3(0.75, 0.05, s * 0.65))
            : /bow|gun|pistol|rifle/.test(name)
            ? norm(v3(1, 0.08, s * 0.06))
            : /staff|stave|spear|pike|lance|halberd|torch/.test(name)
              ? norm(v3(0.12, 1, s * 0.06)) : norm(v3(0.28, 1, s * 0.08));
          const ex = norm(vlerp(carried, along, heldStrike * 0.95));
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
        } else if (s > 0 && genome.weapon?.length && !(extras && 'weapon' in extras)) {
          const bladeDir = norm(sub(hand, elbow));
          const tip = add(hand, scale(bladeDir, genome.weapon.length));
          caps.push({ a: add(hand, scale(bladeDir, 0.06)), b: tip, r: genome.weapon.r ?? 0.03,
            color: hex(genome.weapon.color ?? '#cfd6e4'), part: 'blade' });
        }
      }
    }
  });

  // --- flap: claims wings ------------------------------------------------
  const wingClock = (flying && idleT !== 0 ? idleT * g.cadence * 2 : phase * 2) + life.drift(150, 0.72) * 0.055;
  for (const chain of sk.chains.filter(c => c.role === 'wing')) {
    const beat = flying ? 1 : mv;
    const flap = beat * g.flapAmp * (1 + life.effort * 0.15) * Math.sin(TAU * wingClock)
      + (1 - beat) * 0.12 * Math.sin(TAU * 0.6 * idleT);
    for (const side of sidesOf(chain)) {
      const s = side === 0 ? 1 : side;
      const base = add(attachPoint(chain, s, 0.06), v3(-0.06, 0, 0));
      // elevation stays mostly out to the side: a wing that reaches vertical
      // projects to a spike rather than a wing
      const e = 0.2 + flap * 0.55 - co * 0.9;
      const d0 = norm(v3(-0.2, Math.sin(e), s * Math.cos(e)));
      const mid = add(base, scale(d0, chain.seg[0]));
      const e2 = e - 0.5 + beat * g.flapAmp * 0.18 * Math.sin(TAU * wingClock - 0.7);
      const d1 = norm(v3(-0.35, Math.sin(e2), s * Math.cos(e2)));
      const tip = add(mid, scale(d1, chain.seg[1] ?? chain.seg[0]));
      const shade = s < 0 ? 0.7 : 0.85;
      const ink = inkOf(chain);
      caps.push({ a: base, b: mid, r: chain.r, color: mul(ink, shade), part: 'wing' });
      caps.push({ a: mid, b: tip, r: chain.r * 0.75, color: mul(ink, shade * 0.85), part: 'wingTip' });
    }
  }

  // --- wave: claims tails -------------------------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'tail' || c.role === 'tentacle')) {
    for (const side of sidesOf(chain)) {
      let p = add(attachPoint(chain, side), scale(fwdAt(chain.at), -girthAt(sk, 0) * 0.6));
      const droop = 0.25 + slumpCo * 0.5 + co * 0.6;
      const ink = inkOf(chain);
      chain.seg.forEach((segLen, i) => {
        const lash = tailStrike * 2.6 *
          (su < 0.35 ? -su / 0.35 : Math.sin(Math.PI * (su - 0.35) / 0.65));
        const yaw =
          (chain.yaw ?? 0) + g.tailWave * (1 + life.drift(160, 0.4, i * 0.12) * 0.2) * Math.sin(TAU * phase - i * 0.9 + life.drift(161, 0.63, i * 0.12) * 0.4) * (0.35 + 0.65 * mv) +
          (1 - mv) * 0.15 * Math.sin(TAU * 0.3 * idleT - i * 0.9) +
          lash * (0.4 + 0.6 * (i / Math.max(1, chain.seg.length))) +
          // the tail swings wide when the body turns under it
          turnRate * 0.09 * (1 + i) + life.drift(162 + side, 0.5, i * 0.15) * 0.11;
        const pitch = chain.role === 'tentacle' ? -1.15 + i * 0.12 : (sk.upright ? -0.35 : 0.25) - i * 0.28 - droop * 0.4;
        const d = norm(v3(-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.sin(yaw)));
        const q = add(p, scale(d, segLen));
        caps.push({ a: p, b: q, r: chain.r * (1 + ((chain.taper ?? 0.34) - 1) * i / Math.max(1, chain.seg.length - 1)), color: mul(ink, 0.9 - i * 0.08), part: 'tail' });
        p = q;
      });
    }
  }

  // --- static furniture: horns, fins, plates ------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'horn' || c.role === 'fin' || c.role === 'spike')) {
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
        const yaw = chain.yaw ?? 0;
        const turned = v3(dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw), dir.y, dir.x * Math.sin(yaw) + dir.z * Math.cos(yaw));
        const q = add(p, scale(turned, segLen));
        caps.push({ a: p, b: q, r: chain.r * (1 + ((chain.taper ?? 0.15) - 1) * i / Math.max(1, chain.seg.length - 1)), color: ink, part: chain.role });
        p = q;
      });
    }
  }

  // --- what it is wearing -------------------------------------------------
  // Placed in ANCHOR space and scaled by the part it hangs off, so one helmet
  // spec fits a hound and an ogre without either knowing about the other. It
  // goes through the same field as the body, so it reads as worn rather than
  // stuck on.
  const worn = extras?.gear;
  if (worn && worn.length) {
    const chestAt = curveAt(sk.upright ? 0.72 : 0.6);
    // FACING, not the body curve. fwdAt() runs along the spine, which on an
    // upright creature points at the sky — so a breastplate placed "forward"
    // was being driven up into its own neck and vanished inside the blend.
    const facing = sk.upright ? v3(1, 0, 0) : fwdAt(0.6);
    const chestSize = fattest * 2.2;

    const place = (
      origin: V3, size: number, fwd: V3, side: number, p: [number, number, number],
    ): V3 => {
      // +x along facing, +y up, +z out to the side
      const up = v3(0, 1, 0);
      let out = cross(fwd, up);
      if (len(out) < 1e-3) out = v3(0, 0, 1);
      out = norm(out);
      return add(origin, v3(
        (fwd.x * p[0] + out.x * p[2] * side) * size,
        (p[1] + fwd.y * p[0]) * size,
        (fwd.z * p[0] + out.z * p[2] * side) * size,
      ));
    };

    const waistAt = curveAt(sk.upright ? 0.5 : 0.42);

    for (const piece of worn) {
      const spots: { at: V3; size: number; dir: V3; side: number }[] =
        piece.at === 'head' ? (anchors.head ? [anchors.head] : [])
        : piece.at === 'shoulder' ? shoulders
        : piece.at === 'arm' ? forearms
        : piece.at === 'leg' ? shins
        : piece.at === 'hip'
          ? [1, -1].map(side => ({ at: waistAt, size: chestSize * 0.85, dir: facing, side }))
        : piece.at === 'back'
          ? [{ at: add(chestAt, scale(facing, -chestSize * 0.3)), size: chestSize, dir: facing, side: 1 }]
        : piece.at === 'waist'
          ? [{ at: waistAt, size: chestSize * 0.9, dir: facing, side: 1 }]
          : [{ at: chestAt, size: chestSize, dir: facing, side: 1 }];

      // CLOTH IS NOT WELDED ON. A helm should ride the skull exactly; a cloak
      // that does the same is a painted board. Everything a hem needs to know
      // is already here — how fast the body is going, how hard it is turning,
      // where it is in its stride, whether it is mid-swing — so the drape is
      // a function of this frame and nothing else: no simulation, no memory,
      // no state to keep in step across screens, nothing on the wire.
      const cloth = clamp(piece.drape ?? 0, 0, 1);
      const flow = (q: [number, number, number]): [number, number, number] => {
        if (!cloth) return q;
        // pinned at the anchor, free at the hem: how far this point hangs
        // below the fixing is exactly how much licence it has
        const k = Math.pow(clamp(-q[1] / 1.4, 0, 1), 1.25) * cloth;
        if (k <= 0.001) return q;
        const stream = mv * 1.15;                              // running drags it back
        const swing = clamp(turnRate, -3.5, 3.5) * 0.24;       // and a turn throws it wide
        const snap = strikeW * 0.55;                           // so does a swing of the arm
        const ripple = Math.sin(TAU * phase * 2 + k * 4.5) * 0.12 * mv
          + Math.sin(idleT * 1.15 + k * 2.6 + personality.offset) * 0.055 * (1 - mv);
        return [
          q[0] - (stream + snap) * k,
          // cloth does not merely trail, it LIFTS — that is the difference
          // between a cape and a dead weight nailed to a shoulder
          q[1] + (stream * 0.52 + Math.abs(swing) * 0.35) * k,
          q[2] + (swing + ripple) * k,
        ];
      };

      for (const spot of spots) {
        for (const part of piece.parts) {
          caps.push({
            a: place(spot.at, spot.size, spot.dir, spot.side, flow(part.a)),
            b: place(spot.at, spot.size, spot.dir, spot.side, flow(part.b)),
            r: part.r * spot.size,
            color: hex(part.color),
            part: 'gear',
          });
        }
      }
    }
  }

  return caps;
}

/** Ground speed implied by the current drivers, for scrolling the floor. */
export function walkSpeed(genome: Genome, mood: Mood): number {
  const g = effectiveGait(genome.gait, mood);
  return g.stride * g.cadence;
}
