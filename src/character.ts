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

/** A punctuation move: the arm-claiming arc, fully parameterised. */
export interface StrikeSpec {
  duration: number;                      // seconds
  posts: [number[], number[], number[]]; // bezier direction posts, creature space
  windup: number;                        // fraction of the move
  strike: number;                        // fraction (settle = remainder)
  reachMin: number;                      // fraction of arm length at rest of arc
  reachMax: number;                      // at the apex
  twist: number;                         // torso borrow, radians
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
  blast: BlastSpec;
}

export const DEFAULT_STRIKE_LIGHT: StrikeSpec = {
  duration: 0.38,
  posts: [[-0.2, 0.35, 0.6], [0.95, 0.15, 0.2], [0.6, -0.2, -0.5]],
  windup: 0.3,
  strike: 0.25,
  reachMin: 0.7,
  reachMax: 0.9,
  twist: 0.3,
};

export const DEFAULT_STRIKE_HEAVY: StrikeSpec = {
  duration: 0.95,
  posts: [[-0.45, 0.85, 0.35], [0.55, 0.75, 0.05], [0.8, -0.55, -0.3]],
  windup: 0.5,
  strike: 0.14,
  reachMin: 0.75,
  reachMax: 1.0,
  twist: 0.7,
};

export function defaultBehaviors(walk: Gait): Record<string, Behavior> {
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
    'attack-light': { type: 'strike', strike: { ...DEFAULT_STRIKE_LIGHT } },
    'attack-heavy': { type: 'strike', strike: { ...DEFAULT_STRIKE_HEAVY } },
  };
}

/** Old single-capsule weapons become one-part specs. */
export function migrateWeapon(w: any): WeaponSpec | undefined {
  if (!w) return undefined;
  if (Array.isArray(w.parts)) return w as WeaponSpec;
  return {
    name: 'blade',
    parts: [
      { a: [0.06, 0, 0], b: [w.length ?? 0.5, 0, 0], r: w.r ?? 0.032, color: w.color ?? '#cfd6e4' },
    ],
  };
}

export function makeCharacter(genome: Genome, kind: 'hero' | 'beast' = 'beast'): Character {
  return {
    name: genome.name,
    kind,
    genome,
    behaviors: defaultBehaviors(genome.gait),
    weapon: migrateWeapon(genome.weapon),
    blast: { core: '#fff3c4', edge: '#ffd25e', pattern: 'flame', delay: 2.5, radius: 2 },
  };
}

/** Accepts a Character file, a bare Genome (v1 or v2), and fills gaps. */
export function migrateCharacter(raw: any): Character {
  if (raw?.genome && raw?.behaviors) {
    const c = raw as Character;
    c.genome = migrateGenome(c.genome);
    c.weapon = migrateWeapon(c.weapon);
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
