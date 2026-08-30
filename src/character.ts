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
  boom?: number;   // metres: it EXPLODES where it lands, hurting all inside
  sticks?: boolean;// it lands in the floor and its owner wants it back
  spark?: boolean; // debris of a boom: pretty, brief, harmless
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
  /** Where on the victim this blow is aimed (height ratio, side). */
  spot?: { h: number; side: number };
  /** A FEINT: these posts replace the shown ones the moment the windup ends —
   *  the blow arrives on a different line than the one the guard was raised
   *  against. */
  feintPosts?: [number[], number[], number[]];
  /** Set once the feint has turned — the guard it beat needs to know. */
  feinted?: boolean;
}

/**
 * PHASE 2 of 'model composes, engine budgets': the designer of a weapon may
 * also say HOW it fights — tempo, reach, the shape of the arc, and for
 * ranged things the projectile itself. Every knob is clamped, and the whole
 * attack is PRICED: a fast far-reaching flurry pays for itself in stretched
 * duration. The model gets agency; it cannot buy power.
 */
export interface AttackTune {
  speed?: number;                 // 0.6 ponderous .. 1.6 flurry
  reach?: number;                 // 0.7 close-in  .. 1.4 sweeping
  arc?: 'high' | 'low' | 'wide' | 'straight';
  shot?: { speed?: number; size?: number; color?: string; arcing?: boolean; boom?: number };
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
  /** How it fights, chosen by whoever designed it — clamped and priced. */
  attack?: AttackTune;
  /** How it is USED — picked by the model that designed it. One of
   *  STRIKE_STYLES' keys; anything else falls back to the name heuristics. */
  style?: string;
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

/** The staff's answer: a slow lobbed ball of fire that goes off where it lands. */
export const STRIKE_FIREBALL: StrikeSpec = {
  ...STRIKE_CAST,
  duration: 0.95, windup: 0.6,
  ranged: { speed: 6.5, range: 8.5, size: 0.16, color: '#ff8a3a', arcing: true, trail: 8, boom: 1.4 },
};

/** The wand's answer: quick violet needles. */
export const STRIKE_ARCANE: StrikeSpec = {
  ...STRIKE_CAST,
  duration: 0.55,
  ranged: { speed: 13, range: 8, size: 0.07, color: '#c9a0ff', arcing: false, trail: 5 },
};

/** The orb's answer: a slow pale shard of frost. */
export const STRIKE_FROST: StrikeSpec = {
  ...STRIKE_CAST,
  duration: 0.8,
  ranged: { speed: 5.5, range: 9, size: 0.13, color: '#bfe6ff', arcing: false, trail: 6 },
};

/** The tome's answer: a line of light, gone before the eye settles. */
export const STRIKE_ZAP: StrikeSpec = {
  ...STRIKE_CAST,
  duration: 0.85, windup: 0.66,
  ranged: { speed: 26, range: 10, size: 0.05, color: '#f2f0b0', arcing: false, trail: 14 },
};

/** Thrown, not loosed: the spear leaves the hand and stays where it lands.
 *  The thrower fights bare until it walks back and pulls it out of the floor. */
export const STRIKE_THROW: StrikeSpec = {
  ...STRIKE_SHOOT,
  duration: 0.8, windup: 0.55,
  ranged: { speed: 12, range: 8, size: 0.08, color: '#c9b795', arcing: true, trail: 4, sticks: true },
};

/**
 * Not a strike: a stance. The arm brings the held thing up and ACROSS, and
 * holds it there — the pose the whole block/riposte exchange reads from.
 * Used frozen at mid-arc (u ~0.5) with the guard's own weight.
 */
export const GUARD_STANCE: StrikeSpec = {
  duration: 1, windup: 0.5, strike: 0.3,
  posts: [[0.55, 0.25, 0.35], [0.5, 0.55, 0.05], [0.55, 0.4, -0.3]],
  reachMin: 0.5, reachMax: 0.62, twist: 0.1,
};

export const STRIKE_STYLES: Record<string, StrikeSpec> = {
  swipe: STRIKE_SWIPE, slam: STRIKE_SLAM, thrust: STRIKE_THRUST,
  bite: STRIKE_BITE, lash: STRIKE_LASH, cast: STRIKE_CAST, shoot: STRIKE_SHOOT,
  breath: STRIKE_BREATH, fireball: STRIKE_FIREBALL, arcane: STRIKE_ARCANE,
  frost: STRIKE_FROST, zap: STRIKE_ZAP, throw: STRIKE_THROW,
};

// kept for older callers
export const DEFAULT_STRIKE_LIGHT = STRIKE_SWIPE;
export const DEFAULT_STRIKE_HEAVY = STRIKE_SLAM;

/** What a creature should naturally do, given what it has and what it holds. */
/**
 * The designer of the weapon said how it is used; honour that first. Each
 * choice pairs a light and a heavy the engine already knows how to execute —
 * closed verbs, open geometry.
 */
const STYLE_PAIRS: Record<string, { light: StrikeSpec; heavy: StrikeSpec }> = {
  swipe: { light: STRIKE_SWIPE, heavy: STRIKE_SLAM },
  slam: { light: STRIKE_SWIPE, heavy: STRIKE_SLAM },
  thrust: { light: STRIKE_THRUST, heavy: STRIKE_SLAM },
  lash: { light: STRIKE_SWIPE, heavy: STRIKE_LASH },
  shoot: { light: STRIKE_SHOOT, heavy: STRIKE_SHOOT },
  cast: { light: STRIKE_ARCANE, heavy: STRIKE_CAST },
  fireball: { light: STRIKE_ARCANE, heavy: STRIKE_FIREBALL },
  frost: { light: STRIKE_FROST, heavy: STRIKE_FROST },
  zap: { light: STRIKE_ZAP, heavy: STRIKE_ZAP },
  throw: { light: STRIKE_THROW, heavy: STRIKE_THROW },
};

function styleByChoice(
  weapon: WeaponSpec | undefined, hasArms: boolean, hasTail: boolean, breath?: string,
): { light: StrikeSpec; heavy: StrikeSpec } | null {
  void hasTail;
  if (!weapon?.style || !hasArms || breath) return null;
  return STYLE_PAIRS[weapon.style] ?? null;
}

/**
 * The tuned name table alone — null when the name says nothing. These pairs
 * were chosen by hand and OUTRANK the model's style pick, because a 70B will
 * cheerfully mark a staff 'swipe'.
 */
/** Apply a designer's tune to a strike pair, inside the fairness budget. */
export function tuneStrike(
  pair: { light: StrikeSpec; heavy: StrikeSpec }, tune: AttackTune,
): { light: StrikeSpec; heavy: StrikeSpec } {
  const speed = Math.max(0.6, Math.min(1.6, tune.speed ?? 1));
  const reach = Math.max(0.7, Math.min(1.4, tune.reach ?? 1));
  const one = (s: StrikeSpec): StrikeSpec => {
    let duration = s.duration / speed;
    // THE PRICE: tempo times reach is capped — a fast, far attack stretches
    // its own duration back out until it is fair. The cap sits ~20% above
    // the hottest BASE style, so a tune buys character, not double DPS.
    const cost = (1 / duration) * (0.55 + 0.45 * reach);
    const CAP = 3.2;
    if (cost > CAP) duration = (0.55 + 0.45 * reach) / CAP;
    duration = Math.max(0.22, duration);
    const posts = s.posts.map(p => [...p]) as StrikeSpec['posts'];
    if (tune.arc === 'high') { posts[0][1] += 0.35; posts[1][1] += 0.2; }
    if (tune.arc === 'low') { posts[0][1] -= 0.25; posts[1][1] -= 0.25; posts[2][1] -= 0.15; }
    if (tune.arc === 'wide') { posts[0][2] += 0.3; posts[2][2] -= 0.3; }
    if (tune.arc === 'straight') { posts[0][2] *= 0.3; posts[1][2] *= 0.3; posts[2][2] *= 0.3; }
    let ranged = s.ranged;
    if (ranged && tune.shot) {
      const sh = tune.shot;
      let speed2 = Math.max(4, Math.min(22, sh.speed ?? ranged.speed));
      const size = Math.max(0.04, Math.min(0.2, sh.size ?? ranged.size));
      const boom = ranged.boom !== undefined || (sh.boom ?? 0) > 0
        ? Math.max(0, Math.min(1.6, sh.boom ?? ranged.boom ?? 0)) : undefined;
      // projectile price: velocity times presence times blast
      const shotCost = speed2 * (1 + size * 3) * (1 + (boom ?? 0) * 0.8);
      if (shotCost > 36) speed2 = 36 / ((1 + size * 3) * (1 + (boom ?? 0) * 0.8));
      ranged = {
        ...ranged, speed: speed2, size,
        arcing: sh.arcing ?? ranged.arcing,
        color: typeof sh.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(sh.color) ? sh.color : ranged.color,
        ...(boom !== undefined && boom > 0.2 ? { boom } : {}),
      };
    }
    return { ...s, duration, posts, reachMax: s.reachMax * reach, lunge: (s.lunge ?? 0) * reach, ranged };
  };
  return { light: one(pair.light), heavy: one(pair.heavy) };
}

export function styleForStrict(weaponName: string): { light: StrikeSpec; heavy: StrikeSpec } | null {
  const w = weaponName.toLowerCase();
  if (/javelin|harpoon|throwing spear|throwing axe|throwing knife|boomerang/.test(w)) {
    return { light: STRIKE_THROW, heavy: STRIKE_THROW };
  }
  if (/crossbow|arbalest/.test(w)) {
    return { light: { ...STRIKE_SHOOT, ranged: { ...STRIKE_SHOOT.ranged!, speed: 19, range: 11, color: '#d8cfc0' } }, heavy: STRIKE_SHOOT };
  }
  if (/bow\b|sling/.test(w)) return { light: STRIKE_SHOOT, heavy: STRIKE_SHOOT };
  if (/staff|stave/.test(w)) return { light: STRIKE_ARCANE, heavy: STRIKE_FIREBALL };
  if (/\bwand\b|rod\b|sceptre|scepter/.test(w)) return { light: STRIKE_ARCANE, heavy: STRIKE_ARCANE };
  if (/\borb\b/.test(w)) return { light: STRIKE_FROST, heavy: STRIKE_FROST };
  if (/\btome\b|grimoire|spellbook/.test(w)) return { light: STRIKE_ZAP, heavy: STRIKE_ZAP };
  if (/whip|scourge/.test(w)) return { light: STRIKE_SWIPE, heavy: STRIKE_LASH };
  if (/spear|pike|lance|trident|rapier|halberd/.test(w)) return { light: STRIKE_THRUST, heavy: STRIKE_SLAM };
  return null;
}

export function styleFor(
  weaponName: string | undefined, hasArms: boolean, hasTail: boolean, breath?: string,
): {
  light: StrikeSpec; heavy: StrikeSpec;
} {
  const w = (weaponName ?? '').toLowerCase();
  // a breather leads with the bite and finishes with the flame
  if (breath) {
    const tint = breath === 'frost' ? '#9fd8ff'
      : breath === 'venom' ? '#9fe07a'
      : breath === 'lightning' ? '#f2f0b0'
      : breath === 'shadow' ? '#8a6fb8'
      : '#ff9a3d';
    const heavy: StrikeSpec = {
      ...STRIKE_BREATH,
      ranged: { ...STRIKE_BREATH.ranged!, color: tint },
    };
    return { light: hasArms ? STRIKE_SWIPE : STRIKE_BITE, heavy };
  }
  if (!hasArms) {
    return { light: STRIKE_BITE, heavy: hasTail ? STRIKE_LASH : STRIKE_BITE };
  }
  // every ranged school has its own projectile now — the pit had exactly one
  // arrow and one blue bolt, fired by everything from wizards to slingers
  if (/javelin|throwing spear|throwing axe|throwing knife/.test(w)) {
    return { light: STRIKE_THROW, heavy: STRIKE_THROW };
  }
  if (/crossbow|arbalest/.test(w)) {
    return { light: { ...STRIKE_SHOOT, ranged: { ...STRIKE_SHOOT.ranged!, speed: 19, range: 11, color: '#d8cfc0' } }, heavy: STRIKE_SHOOT };
  }
  if (/bow|sling/.test(w)) return { light: STRIKE_SHOOT, heavy: STRIKE_SHOOT };
  if (/staff|stave/.test(w)) return { light: STRIKE_ARCANE, heavy: STRIKE_FIREBALL };
  if (/\bwand\b|rod\b|sceptre|scepter/.test(w)) return { light: STRIKE_ARCANE, heavy: STRIKE_ARCANE };
  if (/\borb\b/.test(w)) return { light: STRIKE_FROST, heavy: STRIKE_FROST };
  if (/\btome\b|grimoire|spellbook/.test(w)) return { light: STRIKE_ZAP, heavy: STRIKE_ZAP };
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
  if (Array.isArray(w.parts)) {
    // style and attack are the designer's word on HOW it is used — migrate
    // must carry EVERYTHING it does not understand the loss of. (Style was
    // dropped here once and no model-styled weapon ever fired a shot;
    // attack was dropped here once and no tune ever applied.)
    return {
      name: w.name ?? 'weapon', parts: w.parts,
      ...(w.style ? { style: w.style } : {}),
      ...(w.attack ? { attack: w.attack } : {}),
    };
  }
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
    behaviors: defaultBehaviors(genome.gait, (() => {
      let pair =
        (!genome.breath && hasArms && weapon?.name ? styleForStrict(weapon.name) : null)
        ?? styleByChoice(weapon, hasArms, hasTail, genome.breath)
        ?? styleFor(weapon?.name ?? genome.name, hasArms, hasTail, genome.breath);
      // the designer's tempo, reach, arc and projectile — priced, then obeyed
      if (weapon?.attack && !genome.breath && hasArms) pair = tuneStrike(pair, weapon.attack);
      return pair;
    })()),
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
