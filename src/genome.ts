// A creature is a genome: skeleton proportions + gait drivers + palette.
// Everything a creature is fits in this object. Serialised it should stay
// in the hundreds-of-bytes range — if it grows past that, something is
// sneaking keyframes in through the back door.

export interface Body {
  hipWidth: number;
  shoulderWidth: number;
  thigh: number;
  shin: number;
  foot: number;
  lowerSpine: number; // pelvis -> chest
  upperSpine: number; // chest -> neck base
  neck: number;
  headR: number;
  upperArm: number;
  forearm: number;
  torsoR: number; // capsule radii, metres
  limbR: number;
}

export interface Gait {
  cadence: number;   // gait cycles per second (2 steps per cycle)
  stride: number;    // metres travelled per full cycle
  stance: number;    // fraction of cycle each foot is planted (human ~0.6)
  lift: number;      // swing-foot apex height, metres
  bounce: number;    // pelvis vertical oscillation amplitude, metres
  sway: number;      // pelvis lateral shift toward stance leg, metres
  lean: number;      // whole-torso forward lean, radians
  slump: number;     // extra curvature in the upper spine, radians
  crouch: number;    // standing knee-bend depth, metres off full height
  pelvisTwist: number;   // yaw oscillation of the hips, radians
  shoulderTwist: number; // counter-yaw of the shoulders, radians
  armSwing: number;  // shoulder pitch amplitude, radians
  elbowBase: number; // resting elbow flexion, radians (never negative: elbows don't hyperextend)
  elbowAmp: number;  // additional flexion over the cycle, radians
  elbowLag: number;  // elbow trails shoulder by this fraction of a cycle (~1/6)
  headPitch: number; // head droop, radians
}

export interface Mood {
  tired: number; // 0..1
  angry: number; // 0..1
}

export interface Genome {
  name: string;
  body: Body;
  gait: Gait;
  palette: { torso: string; limbs: string; head: string; accent: string };
}

export function defaultBiped(): Genome {
  return {
    name: 'scout',
    body: {
      hipWidth: 0.22,
      shoulderWidth: 0.36,
      thigh: 0.44,
      shin: 0.43,
      foot: 0.16,
      lowerSpine: 0.26,
      upperSpine: 0.24,
      neck: 0.09,
      headR: 0.115,
      upperArm: 0.3,
      forearm: 0.28,
      torsoR: 0.1,
      limbR: 0.055,
    },
    gait: {
      cadence: 0.9,
      stride: 1.35,
      stance: 0.6,
      lift: 0.11,
      bounce: 0.028,
      sway: 0.03,
      lean: 0.06,
      slump: 0.0,
      crouch: 0.03,
      pelvisTwist: 0.1,
      shoulderTwist: 0.14,
      armSwing: 0.42,
      elbowBase: 0.35,
      elbowAmp: 0.5,
      elbowLag: 1 / 6,
      headPitch: 0.0,
    },
    palette: { torso: '#3aa7a0', limbs: '#2b7f8f', head: '#e8c39a', accent: '#d5573b' },
  };
}

// Adverbs, not new animations: a mood is a re-weighting of the same drivers.
export function effectiveGait(g: Gait, m: Mood): Gait {
  const t = m.tired, a = m.angry;
  return {
    ...g,
    cadence: g.cadence * (1 - 0.35 * t) * (1 + 0.3 * a),
    stride: g.stride * (1 - 0.4 * t) * (1 + 0.08 * a),
    lift: g.lift * (1 - 0.55 * t) * (1 + 0.25 * a),
    bounce: g.bounce * (1 - 0.5 * t) * (1 + 0.5 * a),
    sway: g.sway * (1 + 0.5 * t),
    lean: g.lean + 0.1 * t + 0.22 * a,
    slump: g.slump + 0.45 * t + 0.12 * a,
    crouch: g.crouch + 0.05 * t + 0.04 * a,
    pelvisTwist: g.pelvisTwist * (1 - 0.4 * t),
    shoulderTwist: g.shoulderTwist * (1 - 0.4 * t) * (1 + 0.4 * a),
    armSwing: g.armSwing * (1 - 0.6 * t) * (1 + 0.7 * a),
    elbowBase: g.elbowBase + 0.5 * a + 0.1 * t,
    elbowAmp: g.elbowAmp * (1 - 0.4 * t),
    headPitch: g.headPitch + 0.5 * t - 0.1 * a,
  };
}

export function serializeGenome(g: Genome, m: Mood): string {
  const round = (_k: string, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return JSON.stringify({ ...g, mood: m }, round, 1);
}
