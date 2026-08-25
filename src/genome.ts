// A creature is a genome: a skeleton of tagged chains + gait drivers + palette.
// The skeleton doesn't know what a walk is. Layers claim chains by role —
// locomotion takes 'leg', swing takes 'arm', flap takes 'wing' — and if a
// six-limbed thing needs special-casing, the architecture has failed.

export type ChainRole = 'leg' | 'arm' | 'wing' | 'tail';
export type Girdle = 'hip' | 'chest';

export interface ChainSpec {
  role: ChainRole;
  attach: Girdle;
  seg: number[];  // segment lengths, metres (limbs use the first two for IK)
  r: number;      // base capsule radius
  spread: number; // z offset from the centreline (legs/arms/wings mirror; tails sit on it)
}

export interface Skeleton {
  prone: boolean;  // horizontal spine (quadruped) vs upright
  spine: number;   // pelvis -> chest
  neck: number;
  headR: number;
  hipW: number;    // girdle widths (informational; chains carry their own spread)
  chestW: number;
  torsoR: number;
  chains: ChainSpec[];
}

export interface Gait {
  cadence: number;
  stride: number;
  stance: number;
  lift: number;
  bounce: number;
  sway: number;
  lean: number;
  slump: number;
  crouch: number;
  pelvisTwist: number;
  shoulderTwist: number;
  armSwing: number;
  elbowBase: number;
  elbowAmp: number;
  elbowLag: number;
  headPitch: number;
  flapAmp: number;  // wing beat amplitude, radians
  tailWave: number; // tail lateral wave amplitude, radians
}

export interface Mood {
  tired: number;
  angry: number;
}

export interface Weapon {
  length: number;
  r: number;
  color: string;
}

export interface Genome {
  name: string;
  skeleton: Skeleton;
  gait: Gait;
  palette: { torso: string; limbs: string; head: string; accent: string };
  weapon?: Weapon;
}

const BASE_GAIT: Gait = {
  cadence: 0.9, stride: 1.35, stance: 0.6, lift: 0.11,
  bounce: 0.028, sway: 0.03, lean: 0.06, slump: 0, crouch: 0.03,
  pelvisTwist: 0.1, shoulderTwist: 0.14,
  armSwing: 0.42, elbowBase: 0.35, elbowAmp: 0.5, elbowLag: 1 / 6,
  headPitch: 0, flapAmp: 0.5, tailWave: 0.35,
};

// --- presets -------------------------------------------------------------

export function defaultBiped(): Genome {
  return {
    name: 'scout',
    skeleton: {
      prone: false, spine: 0.5, neck: 0.09, headR: 0.115,
      hipW: 0.22, chestW: 0.36, torsoR: 0.1,
      chains: [
        { role: 'leg', attach: 'hip', seg: [0.44, 0.43], r: 0.055, spread: 0.11 },
        { role: 'arm', attach: 'chest', seg: [0.3, 0.28], r: 0.05, spread: 0.18 },
      ],
    },
    gait: { ...BASE_GAIT },
    palette: { torso: '#3aa7a0', limbs: '#2b7f8f', head: '#e8c39a', accent: '#d5573b' },
    weapon: { length: 0.62, r: 0.032, color: '#cfd6e4' },
  };
}

export function imp(): Genome {
  return {
    name: 'imp',
    skeleton: {
      prone: false, spine: 0.28, neck: 0.05, headR: 0.13,
      hipW: 0.13, chestW: 0.2, torsoR: 0.07,
      chains: [
        { role: 'leg', attach: 'hip', seg: [0.2, 0.2], r: 0.04, spread: 0.07 },
        { role: 'arm', attach: 'chest', seg: [0.17, 0.16], r: 0.035, spread: 0.1 },
        { role: 'wing', attach: 'chest', seg: [0.3, 0.34], r: 0.022, spread: 0.06 },
        { role: 'tail', attach: 'hip', seg: [0.22, 0.2, 0.16], r: 0.03, spread: 0 },
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 1.5, stride: 0.55, lift: 0.09, bounce: 0.035,
      armSwing: 0.5, lean: 0.1, flapAmp: 0.7, tailWave: 0.55,
    },
    palette: { torso: '#b5484d', limbs: '#8a3038', head: '#d98b6a', accent: '#e2b33c' },
  };
}

export function hound(): Genome {
  return {
    name: 'hound',
    skeleton: {
      prone: true, spine: 0.62, neck: 0.16, headR: 0.1,
      hipW: 0.24, chestW: 0.22, torsoR: 0.11,
      chains: [
        { role: 'leg', attach: 'hip', seg: [0.3, 0.3], r: 0.05, spread: 0.12 },
        { role: 'leg', attach: 'chest', seg: [0.28, 0.28], r: 0.045, spread: 0.11 },
        { role: 'tail', attach: 'hip', seg: [0.26, 0.2], r: 0.03, spread: 0 },
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 1.4, stride: 0.95, lift: 0.09, bounce: 0.02,
      sway: 0.015, pelvisTwist: 0.05, shoulderTwist: 0.05, tailWave: 0.5,
    },
    palette: { torso: '#6e7276', limbs: '#4c5054', head: '#8a8f94', accent: '#c14b4b' },
  };
}

export function troll(): Genome {
  return {
    name: 'troll',
    skeleton: {
      prone: false, spine: 0.62, neck: 0.07, headR: 0.11,
      hipW: 0.3, chestW: 0.52, torsoR: 0.15,
      chains: [
        { role: 'leg', attach: 'hip', seg: [0.5, 0.48], r: 0.075, spread: 0.15 },
        { role: 'arm', attach: 'chest', seg: [0.45, 0.42], r: 0.07, spread: 0.26 },
        { role: 'arm', attach: 'chest', seg: [0.38, 0.36], r: 0.055, spread: 0.22 },
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 0.7, stride: 1.2, lean: 0.15, slump: 0.25,
      armSwing: 0.3, elbowBase: 0.25, bounce: 0.035, headPitch: 0.1,
    },
    palette: { torso: '#5e7d4a', limbs: '#43602f', head: '#7ea05f', accent: '#8f5540' },
  };
}

export function ogre(): Genome {
  return {
    name: 'ogre',
    skeleton: {
      prone: false, spine: 0.7, neck: 0.08, headR: 0.135,
      hipW: 0.4, chestW: 0.6, torsoR: 0.17,
      chains: [
        { role: 'leg', attach: 'hip', seg: [0.55, 0.52], r: 0.09, spread: 0.19 },
        { role: 'arm', attach: 'chest', seg: [0.5, 0.46], r: 0.085, spread: 0.31 },
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 0.65, stride: 1.3, bounce: 0.04, sway: 0.05,
      lean: 0.1, armSwing: 0.32, elbowBase: 0.3,
    },
    palette: { torso: '#7d6a4c', limbs: '#5a4a33', head: '#a58a63', accent: '#b03a2e' },
    weapon: { length: 0.55, r: 0.07, color: '#6b4a2f' },
  };
}

export const PRESETS: Record<string, () => Genome> = {
  scout: defaultBiped, imp, hound, troll, ogre,
};

// --- migration from the v1 biped schema ----------------------------------

export function migrateGenome(raw: any): Genome {
  if (raw.skeleton) return raw as Genome;
  const b = raw.body;
  return {
    name: raw.name,
    skeleton: {
      prone: false,
      spine: (b.lowerSpine ?? 0.26) + (b.upperSpine ?? 0.24),
      neck: b.neck ?? 0.09,
      headR: b.headR ?? 0.115,
      hipW: b.hipWidth ?? 0.22,
      chestW: b.shoulderWidth ?? 0.36,
      torsoR: b.torsoR ?? 0.1,
      chains: [
        { role: 'leg', attach: 'hip', seg: [b.thigh, b.shin], r: b.limbR, spread: (b.hipWidth ?? 0.22) / 2 },
        { role: 'arm', attach: 'chest', seg: [b.upperArm, b.forearm], r: b.limbR * 0.95, spread: (b.shoulderWidth ?? 0.36) / 2 },
      ],
    },
    gait: { flapAmp: 0.5, tailWave: 0.35, ...raw.gait },
    palette: raw.palette,
    weapon: raw.weapon,
  };
}

// --- scaling (studio sliders, breeding) ----------------------------------

export interface SkeletonScales {
  legs: number; arms: number; head: number; bulk: number; width: number;
}

export function scaleSkeleton(base: Skeleton, s: SkeletonScales): Skeleton {
  return {
    ...base,
    headR: base.headR * s.head,
    hipW: base.hipW * s.width,
    chestW: base.chestW * s.width,
    torsoR: base.torsoR * s.bulk,
    chains: base.chains.map(c => ({
      ...c,
      seg: c.seg.map(l => l * (c.role === 'leg' ? s.legs : s.arms)),
      r: c.r * s.bulk,
      spread: c.spread * s.width,
    })),
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
    flapAmp: g.flapAmp * (1 - 0.5 * t) * (1 + 0.5 * a),
    tailWave: g.tailWave * (1 - 0.6 * t) * (1 + 0.6 * a),
  };
}

export function serializeGenome(g: Genome, m: Mood): string {
  const round = (_k: string, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return JSON.stringify({ ...g, mood: m }, round, 1);
}
