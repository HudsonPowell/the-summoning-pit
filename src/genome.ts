// A creature is a genome: a body curve, a set of tagged chains hanging off it,
// gait drivers and a palette.
//
// The body is a chain of segments from tail-end (0) to head-end (1), and every
// limb, head, horn and fin attaches at a position ALONG that curve. One
// abstraction covers a snake (long body, no legs), a hippo (short fat body,
// stumpy legs), a spider (legs at many points) and a two-headed ogre (two head
// chains at 1.0). Nothing in the solver counts limbs to decide what it is
// looking at — layers claim chains by role, as they always have.

export type ChainRole = 'leg' | 'arm' | 'wing' | 'tail' | 'head' | 'horn' | 'fin';
export type Locomotion = 'walk' | 'slither' | 'fly' | 'hop';

export interface ChainSpec {
  role: ChainRole;
  at: number;        // 0..1 along the body: 0 = rear, 1 = front
  seg: number[];     // segment lengths, metres (limbs use the first two for IK)
  r: number;         // base capsule radius
  spread: number;    // sideways offset from the centreline
  mirror?: boolean;  // paired left/right; defaults true except tail/head
  ink?: number;      // palette index; defaults by role
  angle?: number;    // base pitch, radians — head carriage, horn rake, fin lie
}

export interface Skeleton {
  upright: boolean;      // spine stands up (biped) vs runs level (beast)
  body: number[];        // segment lengths rear → front
  girth: number[];       // radius at each body node; short arrays are stretched
  locomotion: Locomotion;
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
  flapAmp: number;   // wing beat amplitude, radians
  tailWave: number;  // tail lateral wave amplitude, radians
  bodyWave: number;  // lateral travelling wave through the body itself
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

export interface Palette {
  torso: string;
  limbs: string;
  head: string;
  accent: string;
  extra?: string[];  // further inks a chain may point at by index
}

export interface Genome {
  name: string;
  skeleton: Skeleton;
  gait: Gait;
  palette: Palette;
  weapon?: Weapon;
}

// --- palette helpers -------------------------------------------------------

export const INK_TORSO = 0, INK_LIMBS = 1, INK_HEAD = 2, INK_ACCENT = 3;

export function inkList(p: Palette): string[] {
  return [p.torso, p.limbs, p.head, p.accent, ...(p.extra ?? [])];
}

export function defaultInk(role: ChainRole): number {
  switch (role) {
    case 'head': return INK_HEAD;
    case 'horn': case 'fin': return INK_ACCENT;
    default: return INK_LIMBS;
  }
}

export function mirrorsByDefault(role: ChainRole): boolean {
  return role !== 'tail' && role !== 'head';
}

/** Girth at a node index, stretching short arrays across the body. */
export function girthAt(sk: Skeleton, node: number): number {
  const g = sk.girth;
  if (g.length === 0) return 0.1;
  if (g.length === 1) return g[0];
  const nodes = sk.body.length; // node count is body.length + 1
  const u = nodes <= 0 ? 0 : node / nodes;
  const f = u * (g.length - 1);
  const i = Math.min(g.length - 2, Math.floor(f));
  const t = f - i;
  return g[i] + (g[i + 1] - g[i]) * t;
}

/** Rough standing height, used for framing and scale everywhere. */
export function heightOf(g: Genome): number {
  const sk = g.skeleton;
  const legs = sk.chains.filter(c => c.role === 'leg');
  const legLen = legs.length ? Math.max(...legs.map(c => c.seg[0] + (c.seg[1] ?? 0))) : 0;
  const bodyLen = sk.body.reduce((a, b) => a + b, 0);
  const head = sk.chains.find(c => c.role === 'head');
  const headLen = head ? head.seg.reduce((a, b) => a + b, 0) + head.r : 0.15;
  const fattest = Math.max(...sk.girth, 0.06);
  if (sk.upright) return legLen + bodyLen + headLen;
  return Math.max(legLen, fattest * 2) + fattest + headLen * 0.5;
}

const BASE_GAIT: Gait = {
  cadence: 1.05, stride: 1.45, stance: 0.6, lift: 0.11,
  bounce: 0.028, sway: 0.03, lean: 0.06, slump: 0, crouch: 0.03,
  pelvisTwist: 0.1, shoulderTwist: 0.14,
  armSwing: 0.42, elbowBase: 0.35, elbowAmp: 0.5, elbowLag: 1 / 6,
  headPitch: 0, flapAmp: 0.5, tailWave: 0.35, bodyWave: 0,
};

const head = (at: number, seg: number[], r: number, angle = 0): ChainSpec =>
  ({ role: 'head', at, seg, r, spread: 0, angle, ink: INK_HEAD });

// --- presets ---------------------------------------------------------------

export function defaultBiped(): Genome {
  return {
    name: 'scout',
    skeleton: {
      upright: true,
      body: [0.26, 0.24],
      girth: [0.1, 0.105],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [0.44, 0.43], r: 0.055, spread: 0.11 },
        { role: 'arm', at: 1, seg: [0.3, 0.28], r: 0.05, spread: 0.18 },
        head(1, [0.09, 0.115], 0.115),
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
      upright: true,
      body: [0.15, 0.13],
      girth: [0.07, 0.075],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [0.2, 0.2], r: 0.04, spread: 0.07 },
        { role: 'arm', at: 1, seg: [0.17, 0.16], r: 0.035, spread: 0.1 },
        { role: 'wing', at: 0.9, seg: [0.3, 0.34], r: 0.022, spread: 0.06 },
        { role: 'tail', at: 0, seg: [0.22, 0.2, 0.16], r: 0.03, spread: 0 },
        { role: 'horn', at: 1, seg: [0.09], r: 0.018, spread: 0.05, angle: 0.9 },
        head(1, [0.05, 0.13], 0.13),
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
      upright: false,
      body: [0.3, 0.32],
      girth: [0.1, 0.12, 0.1],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0.08, seg: [0.3, 0.3], r: 0.05, spread: 0.12 },
        { role: 'leg', at: 0.92, seg: [0.28, 0.28], r: 0.045, spread: 0.11 },
        { role: 'tail', at: 0, seg: [0.26, 0.2], r: 0.03, spread: 0 },
        head(1, [0.16, 0.14], 0.1, 0.35),
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
      upright: true,
      body: [0.32, 0.3],
      girth: [0.15, 0.16],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [0.5, 0.48], r: 0.075, spread: 0.15 },
        { role: 'arm', at: 1, seg: [0.45, 0.42], r: 0.07, spread: 0.26 },
        { role: 'arm', at: 0.78, seg: [0.38, 0.36], r: 0.055, spread: 0.22 },
        head(1, [0.07, 0.12], 0.11),
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
      upright: true,
      body: [0.36, 0.34],
      girth: [0.17, 0.18],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [0.55, 0.52], r: 0.09, spread: 0.19 },
        { role: 'arm', at: 1, seg: [0.5, 0.46], r: 0.085, spread: 0.31 },
        head(1, [0.08, 0.14], 0.135),
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

// --- the new range ---------------------------------------------------------

export function hippo(): Genome {
  return {
    name: 'hippo',
    skeleton: {
      upright: false,
      body: [0.34, 0.36, 0.3],
      girth: [0.16, 0.29, 0.3, 0.22],   // a barrel
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0.12, seg: [0.16, 0.15], r: 0.085, spread: 0.17 },
        { role: 'leg', at: 0.88, seg: [0.16, 0.15], r: 0.085, spread: 0.17 },
        { role: 'tail', at: 0, seg: [0.1, 0.07], r: 0.035, spread: 0 },
        head(1, [0.12, 0.26], 0.21, 0.1),  // stubby neck into an enormous snout
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 0.85, stride: 0.5, lift: 0.04, bounce: 0.012,
      sway: 0.03, pelvisTwist: 0.03, shoulderTwist: 0.03, tailWave: 0.2,
    },
    palette: { torso: '#7b6b86', limbs: '#5f5269', head: '#8d7c98', accent: '#c88fa0' },
  };
}

export function serpent(): Genome {
  return {
    name: 'serpent',
    skeleton: {
      upright: false,
      body: [0.3, 0.3, 0.3, 0.3, 0.3, 0.28, 0.24],
      girth: [0.04, 0.09, 0.11, 0.1, 0.08, 0.06, 0.05, 0.05],
      locomotion: 'slither',
      chains: [
        head(1, [0.1, 0.18], 0.115, 0.12),
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 1.1, stride: 0.9, bodyWave: 0.85, lift: 0,
      bounce: 0, sway: 0, tailWave: 0,
    },
    palette: { torso: '#4f8f52', limbs: '#3c6f3f', head: '#77b06a', accent: '#e0d264' },
  };
}

export function raptor(): Genome {
  return {
    name: 'raptor',
    skeleton: {
      upright: false,
      body: [0.24, 0.26],
      girth: [0.1, 0.19, 0.13],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0.38, seg: [0.15, 0.17], r: 0.026, spread: 0.07 },
        { role: 'wing', at: 0.7, seg: [0.3, 0.32], r: 0.036, spread: 0.12 },
        { role: 'tail', at: 0, seg: [0.2, 0.16], r: 0.06, spread: 0 },
        head(1, [0.12, 0.15], 0.085, 0.3),
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 1.6, stride: 0.7, flapAmp: 1.1, lift: 0.16,
      bounce: 0.05, tailWave: 0.3,
    },
    palette: { torso: '#8a6a3c', limbs: '#6b512c', head: '#d8cbb0', accent: '#e2a53c' },
  };
}

export function spider(): Genome {
  return {
    name: 'spider',
    skeleton: {
      upright: false,
      body: [0.16, 0.2],
      girth: [0.13, 0.1, 0.17],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0.62, seg: [0.24, 0.28], r: 0.022, spread: 0.11 },
        { role: 'leg', at: 0.74, seg: [0.26, 0.3], r: 0.022, spread: 0.12 },
        { role: 'leg', at: 0.86, seg: [0.24, 0.28], r: 0.022, spread: 0.12 },
        { role: 'leg', at: 0.97, seg: [0.2, 0.24], r: 0.02, spread: 0.11 },
        head(1, [0.06, 0.08], 0.07, 0.1),
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 1.9, stride: 0.42, lift: 0.06, bounce: 0.01,
      sway: 0.005, pelvisTwist: 0.02, shoulderTwist: 0.02,
    },
    palette: { torso: '#3b3550', limbs: '#2b2740', head: '#4d4468', accent: '#c9603f' },
  };
}

export function hydra(): Genome {
  return {
    name: 'hydra',
    skeleton: {
      upright: false,
      body: [0.3, 0.32, 0.26],
      girth: [0.12, 0.22, 0.24, 0.16],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0.12, seg: [0.24, 0.24], r: 0.06, spread: 0.15 },
        { role: 'leg', at: 0.86, seg: [0.24, 0.24], r: 0.06, spread: 0.15 },
        { role: 'tail', at: 0, seg: [0.24, 0.2, 0.16], r: 0.05, spread: 0 },
        // two necks off the same shoulder, leaning apart
        { role: 'head', at: 1, seg: [0.22, 0.18, 0.12], r: 0.085, spread: 0.14,
          mirror: true, angle: 0.5, ink: INK_HEAD },
        { role: 'fin', at: 0.5, seg: [0.12], r: 0.02, spread: 0, angle: 1.4 },
      ],
    },
    gait: {
      ...BASE_GAIT, cadence: 0.9, stride: 0.8, lift: 0.07, bounce: 0.02,
      tailWave: 0.45, headPitch: -0.1,
    },
    palette: { torso: '#3f6f6a', limbs: '#2e534f', head: '#6fae94', accent: '#d5a13b' },
  };
}

export const PRESETS: Record<string, () => Genome> = {
  scout: defaultBiped, imp, hound, troll, ogre, hippo, serpent, raptor, spider, hydra,
};

// --- migration -------------------------------------------------------------

/** v1 (body/thigh/shin) and v2 (spine/hip/chest chains) both land here. */
export function migrateGenome(raw: any): Genome {
  if (raw?.skeleton?.body && Array.isArray(raw.skeleton.body)) return raw as Genome;

  // ---- v2: single spine number, hip/chest girdles ----
  if (raw?.skeleton) {
    const s = raw.skeleton;
    const spine = s.spine ?? 0.5;
    const chains: ChainSpec[] = (s.chains ?? []).map((c: any): ChainSpec => ({
      role: c.role,
      at: c.attach === 'chest' ? (s.prone ? 0.9 : 1) : (s.prone ? 0.1 : 0),
      seg: c.seg,
      r: c.r,
      spread: c.spread,
    }));
    chains.push(head(s.prone ? 1 : 1, [s.neck ?? 0.09, (s.headR ?? 0.115)], s.headR ?? 0.115,
      s.prone ? 0.35 : 0));
    return {
      name: raw.name,
      skeleton: {
        upright: !s.prone,
        body: [spine * 0.52, spine * 0.48],
        girth: [s.torsoR ?? 0.1, (s.torsoR ?? 0.1) * 1.05],
        locomotion: 'walk',
        chains,
      },
      gait: { bodyWave: 0, ...raw.gait },
      palette: raw.palette,
      weapon: raw.weapon,
    };
  }

  // ---- v1: flat body object ----
  const b = raw.body ?? {};
  const base = defaultBiped();
  return {
    name: raw.name ?? 'creature',
    skeleton: {
      upright: true,
      body: [b.lowerSpine ?? 0.26, b.upperSpine ?? 0.24],
      girth: [b.torsoR ?? 0.1, (b.torsoR ?? 0.1) * 1.05],
      locomotion: 'walk',
      chains: [
        { role: 'leg', at: 0, seg: [b.thigh ?? 0.44, b.shin ?? 0.43], r: b.limbR ?? 0.055,
          spread: (b.hipWidth ?? 0.22) / 2 },
        { role: 'arm', at: 1, seg: [b.upperArm ?? 0.3, b.forearm ?? 0.28],
          r: (b.limbR ?? 0.055) * 0.95, spread: (b.shoulderWidth ?? 0.36) / 2 },
        head(1, [b.neck ?? 0.09, b.headR ?? 0.115], b.headR ?? 0.115),
      ],
    },
    gait: { ...base.gait, ...raw.gait },
    palette: raw.palette ?? base.palette,
    weapon: raw.weapon,
  };
}

// --- scaling (studio sliders, breeding) ------------------------------------

export interface SkeletonScales {
  legs: number; arms: number; head: number; bulk: number; width: number;
}

export function scaleSkeleton(base: Skeleton, s: SkeletonScales): Skeleton {
  const limbScale = (role: ChainRole) =>
    role === 'leg' ? s.legs : role === 'head' ? s.head : s.arms;
  return {
    ...base,
    body: base.body.map(l => l * s.bulk ** 0.35),
    girth: base.girth.map(g => g * s.bulk),
    chains: base.chains.map(c => ({
      ...c,
      seg: c.seg.map(l => l * limbScale(c.role)),
      r: c.r * (c.role === 'head' ? s.head : s.bulk),
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
    bodyWave: g.bodyWave * (1 - 0.3 * t) * (1 + 0.3 * a),
  };
}

export function serializeGenome(g: Genome, m: Mood): string {
  const round = (_k: string, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  return JSON.stringify({ ...g, mood: m }, round, 1);
}
