// A character is a genome plus everything it can DO: named behaviour sets
// (each one a small driver-parameter object — data, never code), a crafted
// weapon, and the look of its blast. Heroes and beasts share the schema;
// the bestiary is just a shelf of these files.

import { Genome, Gait, Skeleton, Mood, migrateGenome, effectiveGait } from './genome';

// --- behaviours -----------------------------------------------------------

/** A locomotion behaviour: the drivers of a walk/run/sneak, plus a resting mood. */
export interface GaitBehavior {
  type: 'gait';
  gait: Gait;
  mood: Mood;
}

/** A stationary behaviour: idle, sleep, guard... */
export interface StillSpec {
  collapse: number;     // 0 standing .. 1 crumpled (sleep lies in between)
  tired: number;
  angry: number;
  breatheAmp: number;   // multiplier on the idle breath
  breatheRate: number;  // Hz
}
export interface StillBehavior {
  type: 'still';
  still: StillSpec;
}

/** Which part of the creature performs the move. */
export type StrikeLimb = 'arm' | 'head' | 'tail';

/** A thing that leaves the body and travels. */
export interface RangedSpec {
  speed: number;   // metres/sec
  range: number;   // metres before it gives up
  size: number;    // radius, metres
  color: string;
  arcing: boolean; // lobbed, or flat and fast
  trail: number;   // how many ghosts it draws behind itself
}

/**
 * A punctuation move. The three direction posts ARE the attack style — a
 * thrust is posts that run straight out, a slam is posts that fall from
 * overhead — so shape stays data rather than a switch statement. What needs
 * real code is WHICH limb performs it, and whether it lets go of something.
 */
export interface StrikeSpec {
  duration: number;                      // seconds
  posts: [number[], number[], number[]]; // bezier direction posts, creature space
  windup: number;                        // fraction of the move
  strike: number;                        // fraction (settle = remainder)
  reachMin: number;                      // fraction of limb length at rest of arc
  reachMax: number;                      // at the apex
  twist: number;                         // torso borrow, radians
  limb?: StrikeLimb;                     // default 'arm'
  lunge?: number;                        // metres the whole body drives forward
  ranged?: RangedSpec;                   // releases instead of connecting
}
export interface StrikeBehavior {
  type: 'strike';
  strike: StrikeSpec;
}

export type Behavior = GaitBehavior | StillBehavior | StrikeBehavior;

// --- weapon & blast -------------------------------------------------------

/** Grip space: +x runs along the blade from the hand, +y is knuckle-side. */
export interface WeaponPart {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  color: string;
}
export interface WeaponSpec {
  name: string;
  parts: WeaponPart[];
}

/**
 * The character's PLACED attack — the CLASH verb. delay and radius are the
 * two gameplay numbers the grammar allows; the rest is its look.
 */
export interface BlastSpec {
  core: string;
  edge: string;
  pattern: 'flame' | 'rune' | 'vine' | 'oil' | 'curse' | 'bell' | 'imp';
  delay: number;  // seconds of fuse
  radius: number; // cross reach in tiles
}

// --- the character --------------------------------------------------------

export interface Character {
  name: string;
  kind: 'hero' | 'beast';
  genome: Genome;                       // skeleton + palette + canonical walk gait
  behaviors: Record<string, Behavior>;
  weapon?: WeaponSpec;
  offhand?: WeaponSpec;                 // shield / buckler / torch / second blade
  gear?: any[];                         // helm, plate, cloak — see src/gear.ts
  blast: BlastSpec;
}

// --- the styles ------------------------------------------------------------
// Each is the same machinery pointed differently. Names are for the forge.

export const STRIKE_SWIPE: StrikeSpec = {
  duration: 0.38,
  posts: [[-0.2, 0.35, 0.6], [0.95, 0.15, 0.2], [0.6, -0.2, -0.5]],
  windup: 0.3, strike: 0.25, reachMin: 0.7, reachMax: 0.9, twist: 0.3,
};

export const STRIKE_SLAM: StrikeSpec = {
  duration: 0.95,
  posts: [[-0.45, 0.85, 0.35], [0.55, 0.75, 0.05], [0.8, -0.55, -0.3]],
  windup: 0.5, strike: 0.14, reachMin: 0.75, reachMax: 1.0, twist: 0.7,
  lunge: 0.12,
};

/** Straight out and straight back — a spear, a rapier, a jab. */
export const STRIKE_THRUST: StrikeSpec = {
  duration: 0.45,
  posts: [[-0.55, 0.1, 0.35], [1.0, 0.02, 0.0], [0.55, -0.02, 0.05]],
  windup: 0.42, strike: 0.16, reachMin: 0.5, reachMax: 1.05, twist: 0.45,
  lunge: 0.22,
};

/** The head does the work: rear back, then snap forward and down. */
export const STRIKE_BITE: StrikeSpec = {
  duration: 0.5,
  posts: [[-0.5, 0.5, 0], [1.0, -0.1, 0], [0.6, -0.35, 0]],
  windup: 0.44, strike: 0.18, reachMin: 0.55, reachMax: 1.15, twist: 0.12,
  limb: 'head', lunge: 0.3,
};

/** A tail crack — wide, late, and heavy. */
export const STRIKE_LASH: StrikeSpec = {
  duration: 0.62,
  posts: [[-0.6, 0.1, -0.9], [0.2, 0.05, 1.0], [0.5, -0.1, 0.4]],
  windup: 0.46, strike: 0.2, reachMin: 0.6, reachMax: 1.2, twist: 0.5,
  limb: 'tail',
};

/** Raise, gather, release — the projectile carries the damage. */
export const STRIKE_CAST: StrikeSpec = {
  duration: 0.72,
  posts: [[-0.35, 0.85, 0.3], [0.55, 0.55, 0.1], [0.95, 0.15, -0.05]],
  windup: 0.55, strike: 0.15, reachMin: 0.55, reachMax: 1.0, twist: 0.35,
  ranged: { speed: 9, range: 9, size: 0.11, color: '#8fd6ff', arcing: false, trail: 4 },
};

/** Draw and loose — flatter and faster than a cast. */
export const STRIKE_SHOOT: StrikeSpec = {
  duration: 0.6,
  posts: [[-0.7, 0.25, 0.25], [0.9, 0.12, 0.0], [0.8, 0.05, -0.05]],
  windup: 0.62, strike: 0.1, reachMin: 0.45, reachMax: 1.05, twist: 0.3,
  ranged: { speed: 15, range: 12, size: 0.055, color: '#e8d9a8', arcing: false, trail: 6 },
};

/** Rear the head back and pour fire out of it. The projectile is the flame. */
export const STRIKE_BREATH: StrikeSpec = {
  duration: 1.05,
  posts: [[-0.5, 0.55, 0], [0.9, 0.15, 0], [0.85, -0.1, 0]],
  windup: 0.4, strike: 0.3, reachMin: 0.5, reachMax: 1.0, twist: 0.15,
  limb: 'head', lunge: 0.1,
  ranged: { speed: 6.5, range: 5, size: 0.17, color: '#ff9a3d', arcing: false, trail: 9 },
};

export const STRIKE_STYLES: Record<string, StrikeSpec> = {
  swipe: STRIKE_SWIPE, slam: STRIKE_SLAM, thrust: STRIKE_THRUST,
  bite: STRIKE_BITE, lash: STRIKE_LASH, cast: STRIKE_CAST, shoot: STRIKE_SHOOT,
  breath: STRIKE_BREATH,
};

// kept for older callers
export const DEFAULT_STRIKE_LIGHT = STRIKE_SWIPE;
export const DEFAULT_STRIKE_HEAVY = STRIKE_SLAM;

/** What a creature should naturally do, given what it has and what it holds. */
export function styleFor(
  weaponName: string | undefined, hasArms: boolean, hasTail: boolean, breath?: string,
): {
  light: StrikeSpec; heavy: StrikeSpec;
} {
  const w = (weaponName ?? '').toLowerCase();
  // a breather leads with the bite and finishes with the flame
  if (breath) {
    const tint = breath === 'frost' ? '#9fd8ff' : breath === 'venom' ? '#9fe07a' : '#ff9a3d';
    const heavy: StrikeSpec = {
      ...STRIKE_BREATH,
      ranged: { ...STRIKE_BREATH.ranged!, color: tint },
    };
    return { light: hasArms ? STRIKE_SWIPE : STRIKE_BITE, heavy };
  }
  if (!hasArms) {
    return { light: STRIKE_BITE, heavy: hasTail ? STRIKE_LASH : STRIKE_BITE };
  }
  if (/bow|crossbow|sling/.test(w)) return { light: STRIKE_SHOOT, heavy: STRIKE_SHOOT };
  if (/staff|stave|wand|rod|orb|tome/.test(w)) return { light: STRIKE_CAST, heavy: STRIKE_CAST };
  if (/spear|pike|lance|trident|rapier|halberd/.test(w)) return { light: STRIKE_THRUST, heavy: STRIKE_SLAM };
  if (/whip|scourge/.test(w)) return { light: STRIKE_SWIPE, heavy: STRIKE_LASH };
  if (/hammer|maul|mace|flail|axe|club|cudgel/.test(w)) return { light: STRIKE_SWIPE, heavy: STRIKE_SLAM };
  return { light: STRIKE_SWIPE, heavy: STRIKE_SLAM };
}

export function defaultBehaviors(walk: Gait, style?: { light: StrikeSpec; heavy: StrikeSpec }): Record<string, Behavior> {
  const run: Gait = {
    ...walk,
    cadence: walk.cadence * 1.35,
    stride: walk.stride * 1.25,
    lean: walk.lean + 0.14,
    armSwing: Math.min(1, walk.armSwing * 1.35),
    lift: walk.lift * 1.35,
    bounce: walk.bounce * 1.3,
    elbowBase: walk.elbowBase + 0.25,
  };
  return {
    // walk shares the genome's gait object by reference: it IS the canonical walk
    walk: { type: 'gait', gait: walk, mood: { tired: 0, angry: 0 } },
    run: { type: 'gait', gait: run, mood: { tired: 0, angry: 0 } },
    idle: {
      type: 'still',
      still: { collapse: 0, tired: 0, angry: 0, breatheAmp: 1, breatheRate: 0.35 },
    },
    sleep: {
      type: 'still',
      still: { collapse: 0.82, tired: 1, angry: 0, breatheAmp: 2.2, breatheRate: 0.14 },
    },
    'attack-light': { type: 'strike', strike: { ...(style?.light ?? STRIKE_SWIPE) } },
    'attack-heavy': { type: 'strike', strike: { ...(style?.heavy ?? STRIKE_SLAM) } },
  };
}

/** Old single-capsule weapons become one-part specs. */
export function migrateWeapon(w: any): WeaponSpec | undefined {
  if (!w) return undefined;
  if (Array.isArray(w.parts)) return { name: w.name ?? 'weapon', parts: w.parts };
  return {
    name: 'blade',
    parts: [
      { a: [0.06, 0, 0], b: [w.length ?? 0.5, 0, 0], r: w.r ?? 0.032, color: w.color ?? '#cfd6e4' },
    ],
  };
}

export function makeCharacter(genome: Genome, kind: 'hero' | 'beast' = 'beast'): Character {
  const hasArms = genome.skeleton.chains.some(c => c.role === 'arm');
  const hasTail = genome.skeleton.chains.some(c => c.role === 'tail');
  const weapon = migrateWeapon(genome.weapon);
  return {
    name: genome.name,
    kind,
    genome,
    behaviors: defaultBehaviors(genome.gait, styleFor(weapon?.name ?? genome.name, hasArms, hasTail, genome.breath)),
    weapon: migrateWeapon(genome.weapon),
    offhand: migrateWeapon(genome.offhand),
    gear: genome.gear,
    blast: { core: '#fff3c4', edge: '#ffd25e', pattern: 'flame', delay: 2.5, radius: 2 },
  };
}

/** Accepts a Character file, a bare Genome (v1 or v2), and fills gaps. */
export function migrateCharacter(raw: any): Character {
  if (raw?.genome && raw?.behaviors) {
    const c = raw as Character;
    c.genome = migrateGenome(c.genome);
    c.weapon = migrateWeapon(c.weapon);
    c.offhand = migrateWeapon(c.offhand);
    c.gear ??= c.genome.gear;
    c.blast ??= { core: '#fff3c4', edge: '#ffd25e', pattern: 'flame', delay: 2.5, radius: 2 };
    c.blast.delay ??= 2.5;
    c.blast.radius ??= 2;
    // fill any missing behaviour slots without clobbering authored ones
    const defaults = defaultBehaviors(c.genome.gait);
    for (const [k, v] of Object.entries(defaults)) c.behaviors[k] ??= v;
    return c;
  }
  return makeCharacter(migrateGenome(raw));
}

export function activeMood(b: Behavior): Mood {
  if (b.type === 'gait') return b.mood;
  if (b.type === 'still') return { tired: b.still.tired, angry: b.still.angry };
  return { tired: 0, angry: 0 };
}

export { effectiveGait };
