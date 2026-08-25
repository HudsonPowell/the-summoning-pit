// Drivers -> joints, every frame, for any body plan.
// Layers claim chains by role: locomotion takes every 'leg' and phase-offsets
// them by girdle; swing takes 'arm' pairs; flap takes 'wing'; wave takes
// 'tail'. Chains don't know about layers. Nothing here counts limbs to decide
// what kind of animal it is looking at.

import { V3, v3, add, sub, scale, dot, len, norm, cross, lerp as vlerp, TAU, frac, clamp } from './vec';
import { Genome, Gait, Mood, ChainSpec, effectiveGait } from './genome';
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

/** Optional extras: a crafted multi-part weapon and breathing character. */
export interface PoseExtras {
  weapon?: WeaponSpec;
  breatheAmp?: number;
  breatheRate?: number;
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

  const cTorso = hex(genome.palette.torso);
  const cLimb = hex(genome.palette.limbs);
  const cHead = hex(genome.palette.head);
  const cAccent = hex(genome.palette.accent);

  const legChains = sk.chains.filter(c => c.role === 'leg');
  const legLenAt = (girdle: 'hip' | 'chest') => {
    const ls = legChains.filter(c => c.attach === girdle);
    return ls.length ? Math.max(...ls.map(c => c.seg[0] + c.seg[1])) : 0;
  };

  const slumpCo = g.slump + co * 1.0;
  const leanCo = g.lean + co * 0.3;
  const headCo = g.headPitch + co * 0.8;

  // --- body frame -----------------------------------------------------
  // girdle world positions + the twist each girdle applies to its chains
  let pelvis: V3, neckBase: V3, hipTwist: number, chestTwist: number;
  const bounceAt = (off: number) => g.bounce * Math.cos(2 * TAU * (phase - 0.3 - off)) * mv;
  const swayAt = () => -g.sway * Math.cos(TAU * (phase - 0.3)) * mv;

  const slash = intent?.slash;
  const spec = slash?.spec ?? DEFAULT_STRIKE_LIGHT;
  const sw2 = slash ? slash.weight : 0;
  const su = slash ? slashU(clamp(slash.t, 0, 1), spec) : 0;
  const slashTw = sw2 * spec.twist * (su < 0.3 ? -su / 0.3 : Math.sin((Math.PI * (su - 0.3)) / 0.7));

  if (!sk.prone) {
    const hipH = (legLenAt('hip') * 0.985 - g.crouch) * (1 - 0.72 * co) + ANKLE_H;
    pelvis = v3(leanCo * 0.12, hipH + bounceAt(0) + breathe, swayAt());
    hipTwist = g.pelvisTwist * Math.sin(TAU * phase) * mv;
    chestTwist = -g.shoulderTwist * Math.sin(TAU * phase) * mv - slashTw;
    const lowAng = leanCo * 0.6;
    const spineMid = add(pelvis, v3(Math.sin(lowAng) * sk.spine * 0.52, Math.cos(lowAng) * sk.spine * 0.52, 0));
    const upAng = leanCo * 1.3 + slumpCo;
    neckBase = add(spineMid, v3(Math.sin(upAng) * sk.spine * 0.48, Math.cos(upAng) * sk.spine * 0.48, 0));
    caps.push({ a: pelvis, b: spineMid, r: sk.torsoR, color: cTorso, part: 'spineLow' });
    caps.push({ a: spineMid, b: neckBase, r: sk.torsoR * 1.05, color: mul(cTorso, 1.08), part: 'spineUp' });
    const hw = sk.hipW / 2;
    caps.push({
      a: add(pelvis, v3(hw * Math.sin(hipTwist), 0, -hw * Math.cos(hipTwist))),
      b: add(pelvis, v3(-hw * Math.sin(hipTwist), 0, hw * Math.cos(hipTwist))),
      r: sk.torsoR * 0.95, color: cTorso, part: 'pelvis',
    });
  } else {
    const hindH = (legLenAt('hip') * 0.96 - g.crouch) * (1 - 0.72 * co) + ANKLE_H;
    const frontH = (legLenAt('chest') * 0.96 - g.crouch) * (1 - 0.72 * co) + ANKLE_H;
    pelvis = v3(-sk.spine * 0.45, hindH + bounceAt(0) + breathe, swayAt());
    neckBase = v3(
      sk.spine * 0.45,
      frontH + bounceAt(0.25) + breathe - slumpCo * 0.12,
      swayAt() * 0.7,
    );
    hipTwist = g.pelvisTwist * Math.sin(TAU * phase) * mv;
    chestTwist = -g.shoulderTwist * Math.sin(TAU * phase) * mv;
    caps.push({ a: pelvis, b: neckBase, r: sk.torsoR, color: cTorso, part: 'spine' });
    caps.push({ a: pelvis, b: pelvis, r: sk.torsoR * 1.15, color: mul(cTorso, 0.95), part: 'haunch' });
    caps.push({ a: neckBase, b: neckBase, r: sk.torsoR * 1.05, color: mul(cTorso, 1.05), part: 'brisket' });
  }

  const girdlePos = (a: ChainSpec['attach']) => (a === 'hip' ? pelvis : neckBase);
  const girdleTwist = (a: ChainSpec['attach']) => (a === 'hip' ? hipTwist : chestTwist);
  const attachPoint = (c: ChainSpec, side: number, yOff = 0): V3 => {
    const gp = girdlePos(c.attach);
    const tw = girdleTwist(c.attach);
    return add(gp, v3(-side * c.spread * Math.sin(tw), yOff, side * c.spread * Math.cos(tw)));
  };

  // --- locomotion: claims every leg ------------------------------------
  // legs on the same girdle share a track half a cycle apart; each girdle
  // down the body starts a quarter-cycle later; extra chains on one girdle
  // interleave. This one rule is the whole gait library.
  const girdleIndex = (a: ChainSpec['attach']) => (a === 'hip' ? 0 : 1);
  legChains.forEach(chain => {
    const ci = legChains.filter(c => c.attach === chain.attach).indexOf(chain);
    for (const side of [-1, 1] as const) {
      const off =
        girdleIndex(chain.attach) * 0.25 + (side < 0 ? 0 : 0.5) + ci * 0.125;
      const p = frac(phase + off);
      const t = footTrack(p, g);
      const hip = attachPoint(chain, side);
      const ankle = v3(hip.x + t.x * mv, t.y * mv + ANKLE_H, hip.z * 0.92 + (sk.prone ? hip.z * 0.06 : 0));
      const knee = twoBoneIK(hip, ankle, chain.seg[0], chain.seg[1], v3(1, 0, 0));
      const swingU = p < g.stance ? 0 : (p - g.stance) / (1 - g.stance);
      const toePitch = (p < g.stance ? 0 : 0.5 * Math.sin(Math.PI * swingU)) * mv;
      const footLen = chain.seg[1] * 0.37;
      const toe = add(ankle, v3(footLen * Math.cos(toePitch), footLen * Math.sin(toePitch), 0));
      const shade = side < 0 ? 0.82 : 1.0;
      caps.push({ a: hip, b: knee, r: chain.r * 1.15, color: mul(cLimb, shade), part: 'thigh' });
      caps.push({ a: knee, b: ankle, r: chain.r, color: mul(cLimb, shade * 0.9), part: 'shin' });
      caps.push({ a: ankle, b: toe, r: chain.r * 0.9, color: mul(cAccent, shade), part: 'foot' });
    }
  });

  // --- head -------------------------------------------------------------
  let headC: V3;
  if (!sk.prone) {
    const upAng = leanCo * 1.3 + slumpCo;
    const headAng = upAng + headCo;
    headC = add(neckBase, v3(Math.sin(headAng) * (sk.neck + sk.headR), Math.cos(headAng) * (sk.neck + sk.headR), 0));
  } else {
    const headAng = 0.35 - headCo - slumpCo * 0.5; // above horizontal, drooping when tired
    headC = add(neckBase, v3(Math.cos(headAng) * (sk.neck + sk.headR), Math.sin(headAng) * (sk.neck + sk.headR), 0));
  }
  caps.push({ a: neckBase, b: headC, r: sk.headR * 0.45, color: mul(cHead, 0.85), part: 'neck' });
  caps.push({ a: headC, b: headC, r: sk.headR, color: cHead, part: 'head' });

  // --- swing: claims arms, in pairs -------------------------------------
  const armChains = sk.chains.filter(c => c.role === 'arm');
  armChains.forEach((chain, pair) => {
    for (const side of [-1, 1] as const) {
      const shoulder = attachPoint(chain, side, -0.02 - pair * 0.13);
      const pArm = frac(phase + (side < 0 ? 0.5 : 0) + pair * 0.06);
      const alpha = g.armSwing * Math.sin(TAU * pArm) * mv + g.lean;
      const beta =
        g.elbowBase + g.elbowAmp * 0.5 * (1 + Math.sin(TAU * (pArm - g.elbowLag))) * mv;
      const dU = v3(Math.sin(alpha), -Math.cos(alpha), side * 0.12);
      let elbow = add(shoulder, scale(norm(dU), chain.seg[0]));
      const dF = v3(Math.sin(alpha + beta), -Math.cos(alpha + beta), side * 0.16);
      let hand = add(elbow, scale(norm(dF), chain.seg[1]));

      // intent claims the first right arm only
      if (pair === 0 && side > 0 && sw2 > 0) {
        const reach =
          (chain.seg[0] + chain.seg[1]) *
          (spec.reachMin + (spec.reachMax - spec.reachMin) * Math.sin(Math.PI * su));
        const target = add(shoulder, scale(slashDir(su, spec), reach));
        hand = vlerp(hand, target, sw2);
        elbow = twoBoneIK(shoulder, hand, chain.seg[0], chain.seg[1], v3(-0.6, -0.25, 0.9));
      }

      const shade = (side < 0 ? 0.8 : 1.0) * (1 - pair * 0.12);
      caps.push({ a: shoulder, b: elbow, r: chain.r, color: mul(cLimb, shade * 1.05), part: 'upperArm' });
      caps.push({ a: elbow, b: hand, r: chain.r * 0.9, color: mul(cLimb, shade * 0.95), part: 'forearm' });
      caps.push({ a: hand, b: hand, r: chain.r * 1.05, color: mul(cHead, shade * 0.95), part: 'hand' });

      if (pair === 0 && side > 0) {
        // crafted multi-part weapon in grip space (+x along the blade),
        // else the legacy single-capsule weapon from old genomes
        const spec2 = extras?.weapon;
        if (spec2) {
          const ex = norm(sub(hand, elbow));
          let ez = cross(ex, v3(0, 1, 0));
          if (len(ez) < 1e-3) ez = v3(0, 0, 1);
          ez = norm(ez);
          const ey = cross(ez, ex);
          const gripToWorld = (p: [number, number, number]): V3 =>
            add(hand, add(scale(ex, p[0]), add(scale(ey, p[1]), scale(ez, p[2]))));
          for (const part of spec2.parts) {
            caps.push({
              a: gripToWorld(part.a),
              b: gripToWorld(part.b),
              r: part.r,
              color: hex(part.color),
              part: 'weapon',
            });
          }
        } else if (genome.weapon) {
          const w = genome.weapon;
          const bladeDir = norm(sub(hand, elbow));
          const tip = add(hand, scale(bladeDir, w.length));
          caps.push({ a: add(hand, scale(bladeDir, 0.06)), b: tip, r: w.r, color: hex(w.color), part: 'blade' });
          caps.push({ a: hand, b: hand, r: chain.r * 1.2, color: mul(cAccent, 0.9), part: 'guard' });
        }
      }
    }
  });

  // --- flap: claims wings ------------------------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'wing')) {
    const flap =
      mv * g.flapAmp * Math.sin(TAU * 2 * phase) +
      (1 - mv) * 0.12 * Math.sin(TAU * 0.6 * idleT);
    for (const side of [-1, 1] as const) {
      const base = add(girdlePos(chain.attach), v3(-0.06, 0.06, side * chain.spread));
      const e = 0.55 + flap - co * 0.9;
      const d0 = norm(v3(-0.2, Math.sin(e), side * Math.cos(e)));
      const mid = add(base, scale(d0, chain.seg[0]));
      const e2 = e - 0.85;
      const d1 = norm(v3(-0.35, Math.sin(e2), side * Math.cos(e2)));
      const tip = add(mid, scale(d1, chain.seg[1] ?? chain.seg[0]));
      const shade = side < 0 ? 0.7 : 0.85;
      caps.push({ a: base, b: mid, r: chain.r, color: mul(cLimb, shade), part: 'wing' });
      caps.push({ a: mid, b: tip, r: chain.r * 0.75, color: mul(cLimb, shade * 0.85), part: 'wingTip' });
    }
  }

  // --- wave: claims tails ------------------------------------------------
  for (const chain of sk.chains.filter(c => c.role === 'tail')) {
    let p = add(girdlePos(chain.attach), v3(-sk.torsoR * 0.6, 0, 0));
    const droop = 0.25 + slumpCo * 0.5 + co * 0.6;
    chain.seg.forEach((segLen, i) => {
      const yaw =
        g.tailWave * Math.sin(TAU * phase - i * 0.9) * (0.35 + 0.65 * mv) +
        (1 - mv) * 0.15 * Math.sin(TAU * 0.3 * idleT - i * 0.9);
      const pitch = (sk.prone ? 0.25 : -0.35) - i * 0.28 - droop * 0.4;
      const d = norm(v3(-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.sin(yaw)));
      const q = add(p, scale(d, segLen));
      caps.push({
        a: p, b: q, r: chain.r * (1 - i * 0.22),
        color: mul(cLimb, 0.9 - i * 0.08), part: 'tail',
      });
      p = q;
    });
  }

  return caps;
}

/** Ground speed implied by the current drivers, for scrolling the floor. */
export function walkSpeed(genome: Genome, mood: Mood): number {
  const g = effectiveGait(genome.gait, mood);
  return g.stride * g.cadence;
}
