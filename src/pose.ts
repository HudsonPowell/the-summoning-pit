// Drivers -> joints, every frame. Nothing here is a keyframe: the whole pose
// is resolved from the gait phase and a handful of authored relationships.

import { V3, v3, add, sub, scale, dot, len, norm, lerp as vlerp, TAU, frac, clamp } from './vec';
import { Genome, Gait, Mood, effectiveGait } from './genome';

/**
 * The intent layer: grabs specific limbs toward targets and blends in and
 * out by weight. It claims the right arm (and borrows a little torso);
 * locomotion neither knows nor cares.
 */
export interface Intent {
  slash?: { t: number; weight: number }; // t runs 0..1 through the move
}

// Wind-up, whip, settle: a bezier through three direction posts, with the
// timing squeezed so the middle of the arc happens fast.
function slashDir(u: number): V3 {
  const p0 = v3(-0.35, 0.55, 0.55);
  const p1 = v3(0.9, 0.35, 0.15);
  const p2 = v3(0.7, -0.5, -0.45);
  const a = vlerp(p0, p1, u), b = vlerp(p1, p2, u);
  return norm(vlerp(a, b, u));
}
function slashU(t: number): number {
  if (t < 0.4) return 0.25 * (t / 0.4);            // wind-up
  if (t < 0.6) return 0.25 + 0.6 * ((t - 0.4) / 0.2); // strike
  return 0.85 + 0.15 * ((t - 0.6) / 0.4);          // settle
}
/** Envelope for blending the whole move in and out. */
export function slashWeight(t: number): number {
  const inW = clamp(t / 0.12, 0, 1);
  const outW = 1 - clamp((t - 0.82) / 0.18, 0, 1);
  return inW * outW;
}

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
  color: [number, number, number];
  part: string;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mul(c: [number, number, number], s: number): [number, number, number] {
  return [c[0] * s, c[1] * s, c[2] * s];
}

/**
 * Two-bone analytic IK. Bend direction comes from a pole hint; caller keeps
 * the same pole frame to frame, which keeps the fold stable without pole
 * vector fiddling.
 */
function twoBoneIK(root: V3, target: V3, l1: number, l2: number, pole: V3): V3 {
  let d = sub(target, root);
  let dist = clamp(len(d), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = norm(d);
  // component of pole perpendicular to the root->target axis
  const perp = norm(sub(pole, scale(dir, dot(pole, dir))));
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return add(add(root, scale(dir, a)), scale(perp, h));
}

/**
 * Shared foot track: both feet run the same trajectory, half a cycle apart.
 * Returns position relative to the hip's ground point, walking along +x.
 */
function footTrack(p: number, g: Gait): { x: number; y: number } {
  const S = g.stance;
  const travel = g.stride * S; // how far the planted foot slides back, body-relative
  if (p < S) {
    const u = p / S;
    return { x: (0.5 - u) * travel, y: 0 };
  }
  const u = (p - S) / (1 - S);
  const e = (1 - Math.cos(Math.PI * u)) / 2; // ease through the swing
  return { x: (-0.5 + e) * travel, y: g.lift * Math.sin(Math.PI * u) };
}

/**
 * move: 1 = full locomotion, 0 = standing idle (drivers fade to rest and a
 * slow breath takes over). idleT feeds the breathing oscillator.
 */
/**
 * collapse: 0 = standing, 1 = crumpled on the ground. Death is not an
 * animation either — it's the same drivers with the height driven out of
 * them: the pelvis drops, the spine folds, the head goes, the legs fold
 * under IK like they always do.
 */
export function solvePose(
  genome: Genome,
  mood: Mood,
  phase: number,
  move = 1,
  idleT = 0,
  intent?: Intent,
  collapse = 0,
): Capsule[] {
  const b = genome.body;
  const g = effectiveGait(genome.gait, mood);
  const caps: Capsule[] = [];
  const mv = clamp(move, 0, 1) * (1 - clamp(collapse, 0, 1));
  const co = clamp(collapse, 0, 1);
  const breathe = (1 - mv) * (1 - co) * 0.012 * Math.sin(TAU * 0.35 * idleT);

  const cTorso = hex(genome.palette.torso);
  const cLimb = hex(genome.palette.limbs);
  const cHead = hex(genome.palette.head);
  const cAccent = hex(genome.palette.accent);

  // --- pelvis ---------------------------------------------------------
  const legLen = b.thigh + b.shin;
  const ankleH = 0.06;
  const hipH = (legLen * 0.985 - g.crouch) * (1 - 0.72 * co) + ankleH;
  const slumpCo = g.slump + co * 1.0;
  const leanCo = g.lean + co * 0.3;
  const headCo = g.headPitch + co * 0.8;
  // pelvis rides highest at each mid-stance (phi ~0.3 for the left, ~0.8 right)
  const pelvis = v3(
    g.lean * 0.12,
    hipH + g.bounce * Math.cos(2 * TAU * (phase - 0.3)) * mv + breathe,
    -g.sway * Math.cos(TAU * (phase - 0.3)) * mv,
  );

  // hips yaw with the swinging leg; shoulders counter it
  const pTw = g.pelvisTwist * Math.sin(TAU * phase) * mv;
  const hw = b.hipWidth / 2;
  const hipL = add(pelvis, v3(hw * Math.sin(pTw), 0, -hw * Math.cos(pTw)));
  const hipR = add(pelvis, v3(-hw * Math.sin(pTw), 0, hw * Math.cos(pTw)));
  caps.push({ a: hipL, b: hipR, r: b.torsoR * 0.95, color: cTorso, part: 'pelvis' });

  // --- legs -----------------------------------------------------------
  const kneePole = v3(1, 0, 0); // knees fold forward
  for (const side of [-1, 1] as const) {
    const hip = side < 0 ? hipL : hipR;
    const p = frac(phase + (side < 0 ? 0 : 0.5));
    const t = footTrack(p, g);
    const ankle = v3(t.x * mv, t.y * mv + ankleH, hip.z * 0.92);
    const knee = twoBoneIK(hip, ankle, b.thigh, b.shin, kneePole);
    const swingU = p < g.stance ? 0 : (p - g.stance) / (1 - g.stance);
    const toePitch = (p < g.stance ? 0 : 0.5 * Math.sin(Math.PI * swingU)) * mv;
    const toe = add(ankle, v3(b.foot * Math.cos(toePitch), b.foot * Math.sin(toePitch), 0));
    const shade = side < 0 ? 0.82 : 1.0; // far/near legs read as separate
    caps.push({ a: hip, b: knee, r: b.limbR * 1.15, color: mul(cLimb, shade), part: 'thigh' });
    caps.push({ a: knee, b: ankle, r: b.limbR, color: mul(cLimb, shade * 0.9), part: 'shin' });
    caps.push({ a: ankle, b: toe, r: b.limbR * 0.9, color: mul(cAccent, shade), part: 'foot' });
  }

  // --- spine ----------------------------------------------------------
  // lean is distributed: a bit at the pelvis, more at the top; slump bends
  // only the upper segment, which is what reads as "tired" vs "leaning".
  const lowAng = leanCo * 0.6;
  const chest = add(pelvis, v3(Math.sin(lowAng) * b.lowerSpine, Math.cos(lowAng) * b.lowerSpine, 0));
  const upAng = leanCo * 1.3 + slumpCo;
  const neckBase = add(chest, v3(Math.sin(upAng) * b.upperSpine, Math.cos(upAng) * b.upperSpine, 0));
  caps.push({ a: pelvis, b: chest, r: b.torsoR, color: cTorso, part: 'spineLow' });
  caps.push({ a: chest, b: neckBase, r: b.torsoR * 1.05, color: mul(cTorso, 1.08), part: 'spineUp' });

  // --- head -----------------------------------------------------------
  const headAng = upAng + headCo;
  const headC = add(neckBase, v3(Math.sin(headAng) * (b.neck + b.headR), Math.cos(headAng) * (b.neck + b.headR), 0));
  caps.push({ a: neckBase, b: headC, r: b.headR * 0.45, color: mul(cHead, 0.85), part: 'neck' });
  caps.push({ a: headC, b: headC, r: b.headR, color: cHead, part: 'head' });

  // --- arms -----------------------------------------------------------
  const slash = intent?.slash;
  const sw2 = slash ? slash.weight : 0;
  const su = slash ? slashU(clamp(slash.t, 0, 1)) : 0;
  // the intent layer borrows the torso: wind back, then throw into the cut
  const slashTw = sw2 * 0.5 * (su < 0.3 ? -su / 0.3 : Math.sin((Math.PI * (su - 0.3)) / 0.7));
  const sTw = -g.shoulderTwist * Math.sin(TAU * phase) * mv - slashTw;
  const sw = b.shoulderWidth / 2;
  const hunch = 0.03 * mood.angry;
  for (const side of [-1, 1] as const) {
    const shoulder = add(neckBase, v3(
      -side * sw * Math.sin(sTw) + hunch,
      -0.02 + hunch * 0.7,
      side * sw * Math.cos(sTw),
    ));
    // each arm swings opposite its own-side leg
    const pArm = frac(phase + (side < 0 ? 0.5 : 0));
    const alpha = g.armSwing * Math.sin(TAU * pArm) * mv + g.lean;
    // the elbow only flexes, and trails the shoulder — that lag is most of
    // what reads as natural
    const beta =
      g.elbowBase + g.elbowAmp * 0.5 * (1 + Math.sin(TAU * (pArm - g.elbowLag))) * mv;
    const dU = v3(Math.sin(alpha), -Math.cos(alpha), side * 0.12);
    let elbow = add(shoulder, scale(norm(dU), b.upperArm));
    const dF = v3(Math.sin(alpha + beta), -Math.cos(alpha + beta), side * 0.16);
    let hand = add(elbow, scale(norm(dF), b.forearm));

    // intent claims the right arm: blend the hand toward the slash arc and
    // re-solve the elbow with IK (pole back and out, so the fold stays human)
    if (side > 0 && sw2 > 0) {
      const reach = (b.upperArm + b.forearm) * (0.72 + 0.24 * Math.sin(Math.PI * su));
      const target = add(shoulder, scale(slashDir(su), reach));
      hand = vlerp(hand, target, sw2);
      elbow = twoBoneIK(shoulder, hand, b.upperArm, b.forearm, v3(-0.6, -0.25, 0.9));
    }

    const shade = side < 0 ? 0.8 : 1.0;
    caps.push({ a: shoulder, b: elbow, r: b.limbR, color: mul(cLimb, shade * 1.05), part: 'upperArm' });
    caps.push({ a: elbow, b: hand, r: b.limbR * 0.9, color: mul(cLimb, shade * 0.95), part: 'forearm' });
    caps.push({ a: hand, b: hand, r: b.limbR * 1.05, color: mul(cHead, shade * 0.95), part: 'hand' });

    // the weapon is just another chain: gripped along the forearm line
    if (side > 0 && genome.weapon) {
      const w = genome.weapon;
      const bladeDir = norm(sub(hand, elbow));
      const tip = add(hand, scale(bladeDir, w.length));
      caps.push({ a: add(hand, scale(bladeDir, 0.06)), b: tip, r: w.r, color: hex(w.color), part: 'blade' });
      caps.push({ a: hand, b: hand, r: b.limbR * 1.2, color: mul(cAccent, 0.9), part: 'guard' });
    }
  }

  return caps;
}

/** Ground speed implied by the current drivers, for scrolling the floor. */
export function walkSpeed(genome: Genome, mood: Mood): number {
  const g = effectiveGait(genome.gait, mood);
  return g.stride * g.cadence;
}
