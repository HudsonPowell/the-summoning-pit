import { motionOf, livingMotion } from '../motion';
// THE VOID — an attract mode. Nobody is playing: the creatures off the
// bestiary shelf wander an empty plane, think, notice each other, and pick
// fights. Continuous space, no grid, no walls; the only rules are wanting
// things and bumping into each other.

import { STRIKE_SWIPE, Character, StrikeSpec, RangedSpec, DEFAULT_STRIKE_LIGHT, Evasion, evadedBy } from '../character';
import { Genome, effectiveGait, heightOf } from '../genome';
import { Temper, temperOf } from '../temper';
import { Secondary, newSecondary, stepSecondary, jolt } from '../secondary';
import { Pacts, newPacts, stanceOf } from './pacts';
import { Prop, pitScenery } from '../props';
import { Relic, Flora, leaveRemains, seedFlora, stepRelics, stepFlora, takeRelicId } from './relics';
import { Record as Deeds, takeSpoil, takeTrophy } from './spoils';

export type AgentState = 'wander' | 'think' | 'approach' | 'fight' | 'flee' | 'down' | 'rest';

export interface Agent {
  id: number;
  by?: string;      // whose creature this is
  ch: Character;
  genome: Genome;
  x: number; z: number;      // metres
  heading: number;           // drawn heading, smoothed
  aim: number;               // where it wants to face
  phase: number;             // gait cycle
  move: number;              // 0..1 idle↔walk blend
  idleT: number;
  state: AgentState;
  stateT: number;            // seconds in this state
  hp: number;
  maxHp: number;
  scars: number;             // wounds no rest closes — the price of the reign
  hurtT: number;
  strikeT: number;           // -1 idle, else seconds into the swing
  struck: boolean;
  heavy: boolean;            // this swing is the heavy one
  deadT: number;             // -1 alive
  recalled: boolean;         // left because its summoner replaced it, not killed
  target: Agent | null;
  nerve: number;             // aggression, kept under its old name for the AI
  temper: Temper;            // what it is like, read off what it is made of
  sec: Secondary;            // the parts of the body that are late
  swing: StrikeSpec | null;  // THIS swing, varied — never the same twice
  deeds: Deeds;              // what it has done, and what it took for doing it
  calm: number;              // seconds since anything happened to it
  rest: number;              // 0 up .. 1 lying down, for the long wait
  thrownRelic: number | null;// the spear is OUT THERE, and this is where
  guardT: number;            // seconds left holding a block up
  staggerT: number;          // seconds of recovery after being parried
  riposteT: number;          // a window to answer a blocked blow
  /** Getting out of the way: -1 idle, else seconds into it. */
  evadeT: number;
  evade: Evasion | null;
  evadeSide: number;         // which way it threw itself, for a dodge
  flinch: { h: number; side: number; t: number } | null; // where the last blow landed
  lookAt: number;            // world angle the head is resting on
  scanT: number;             // seconds until it looks somewhere else
  turnRate: number;          // radians/sec, for secondary motion
  bulk: number;              // rough size, for reach and shoving
  speed: number;             // metres/sec walking
  vx: number; vz: number;    // carried momentum between decisions
}

export type EventKind =
  | 'spawn' | 'notice' | 'flee' | 'strike' | 'loose' | 'hit' | 'kill' | 'despawn'
  | 'spoil' | 'evade';

/** Who did the thing. Enough to name it in a feed without the sim attached. */
export interface EventWho { id: number; name: string; by?: string }

/**
 * One record, five consumers: sound, camera, kill feed, records, clips.
 * It has to SAY what happened — a bare position is only good for a shake.
 */
export interface VoidEvent {
  kind: EventKind;
  t: number;
  x: number; z: number;
  actor?: EventWho;
  target?: EventWho;
  how?: string;      // 'bite' | 'lash' | 'swipe' | 'thrust' | 'bolt' | 'spell'
  range?: number;    // metres between them when it happened
  spotH?: number;    // where on the body a blow landed (height ratio)
  spotS?: number;    // and which side
}

let shotSeq = 1;

/** Something in flight. Nobody owns it once it leaves. */
export interface Shot {
  id: number;        // stable across snapshots, so clients can interpolate it
  x: number; z: number; y: number;
  vx: number; vz: number;
  life: number;
  spec: RangedSpec;
  from: Agent;
  trail: { x: number; z: number; y: number }[];
}

export interface VoidSim {
  challengeT: number;        // seconds a lone creature has held the pit
  props: Prop[];             // the fixed scenery, grown from sim.seed
  relics: Relic[];           // bones and dropped arms — the floor's memory
  flora: Flora[];            // the living greenery; grows, gets trampled
  seed: number;              // the whole pit's layout is this number
  pacts: Pacts;              // who spares whom, and who is owed a killing
  agents: Agent[];
  shots: Shot[];
  roster: Character[];
  events: VoidEvent[];
  t: number;
  spawnT: number;
  population: number;
  peace: number; // 0 = brawl constantly, 1 = never fight
}

const TURN_RATE = 6;        // radians/sec toward the aim
const REACH_BASE = 1.15;    // metres, before bulk
const NOTICE_R = 7;
const FIGHT_R = 1.5;
/** How long one creature may hold the pit before the house sends someone. */
const CHALLENGE_AFTER = 40;
const STRIKE_PERIOD = 1.1;  // seconds between swings in a fight

const rnd = (a: number, b: number) => a + Math.random() * (b - a);


let nextAgentId = 1;

export function makeAgent(ch: Character, x: number, z: number, by?: string): Agent {
  // Its OWN copy of the body. An agent's genome gets rewritten when it takes a
  // trophy, and the character it came from is the shelf everything else spawns
  // off — grafting a stolen horn onto that would give it to every hound that
  // ever spawns again.
  const g: Genome = JSON.parse(JSON.stringify(ch.genome));
  const eff = effectiveGait(g.gait, { tired: 0, angry: 0 });
  const h = heightOf(g);
  const temper = temperOf(g);
  return {
    id: nextAgentId++,
    by,
    ch: { ...ch, genome: g },
    genome: g,
    x, z,
    heading: rnd(-Math.PI, Math.PI),
    aim: rnd(-Math.PI, Math.PI),
    phase: Math.random(),
    move: 0,
    vx: 0, vz: 0,
    idleT: Math.random() * 10,
    state: 'wander',
    stateT: 0,
    // beasts are tougher and keener; heroes are cagier
    // a braver thing is usually a bigger thing, and takes more killing
    hp: Math.round(3 + temper.bravery * 3),
    maxHp: Math.round(3 + temper.bravery * 3),
    scars: 0,
    hurtT: 0,
    strikeT: -1,
    struck: false,
    heavy: false,
    deadT: -1,
    recalled: false,
    target: null,
    nerve: temper.aggression,
    temper,
    sec: newSecondary(),
    swing: null,
    deeds: { kills: 0, spoils: [], born: 0 },
    calm: 0,
    rest: 0,
    thrownRelic: null,
    guardT: 0,
    staggerT: 0,
    riposteT: 0,
    evadeT: -1,
    evade: null,
    evadeSide: 1,
    flinch: null,
    lookAt: rnd(-Math.PI, Math.PI),
    scanT: rnd(0, 0.8),
    turnRate: 0,
    bulk: h,
    // the gait says how fast it CAN move; temperament says how much it does
    speed: Math.max(0.45, eff.stride * eff.cadence) * (0.55 + temper.speed * 0.95),
  };
}

export function createVoid(roster: Character[], population = 1): VoidSim {
  const sim: VoidSim = {
    challengeT: 0,
    seed: 1337,
    props: pitScenery(1337),
    relics: [],
    flora: seedFlora(1337, 8),
    pacts: newPacts(),
    agents: [], shots: [], roster, events: [], t: 0, spawnT: 0, population, peace: 0.35,
  };
  // population 0 is legitimate now: the pit spawns NOTHING of its own.
  for (let i = 0; i < population; i++) spawnOne(sim, true);
  return sim;
}

/** Somewhere out of the way, but inside the pool of light. */
function spawnSpot(sim: VoidSim): { x: number; z: number } {
  for (let i = 0; i < 40; i++) {
    const a = rnd(-Math.PI, Math.PI);
    const r = rnd(1.5, 4.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (sim.agents.every(o => Math.hypot(o.x - x, o.z - z) > 2.5)) return { x, z };
  }
  return { x: rnd(-4, 4), z: rnd(-4, 4) };
}

export const whoOf = (a: Agent): EventWho => ({ id: a.id, name: a.ch.name, by: a.by });

/** Put a specific creature into the pit — what summoning actually does. */
export function spawnChar(sim: VoidSim, ch: Character, by?: string): Agent {
  const { x, z } = spawnSpot(sim);
  const a = makeAgent(ch, x, z);
  a.by = by;
  a.deeds.born = sim.t;
  sim.agents.push(a);
  sim.events.push({ kind: 'spawn', t: sim.t, x, z, actor: whoOf(a) });
  return a;
}

export function spawnOne(sim: VoidSim, quiet = false): Agent | null {
  if (sim.roster.length === 0) return null;
  const ch = sim.roster[Math.floor(Math.random() * sim.roster.length)];
  const { x, z } = spawnSpot(sim);
  const a = makeAgent(ch, x, z);
  a.deeds.born = sim.t;
  sim.agents.push(a);
  if (!quiet) sim.events.push({ kind: 'spawn', t: sim.t, x, z, actor: whoOf(a) });
  return a;
}

function turnToward(a: Agent, dt: number): void {
  let d = a.aim - a.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  // THE EYES GO FIRST. A creature checks where it is about to go, a beat
  // before the body commits — the head spring then arrives late off THIS,
  // so the whole turn reads look, lean, wheel instead of turret-swivel.
  if (Math.abs(d) > 0.4) a.lookAt = a.aim;
  // and pivoting on the spot is easy, while turning at speed carves an arc
  const rate = TURN_RATE * (1.35 - 0.7 * Math.min(1, a.move));
  const step = d * (1 - Math.exp(-rate * dt));
  a.heading += step;
  // remembered so the body can bank and the tail can trail
  a.turnRate += (step / Math.max(1e-4, dt) - a.turnRate) * Math.min(1, 8 * dt);
}

function walk(a: Agent, dt: number, scale = 1): void {
  // THE BODY SURGES WITH THE STRIDE. `speed * dt` alone is a conveyor —
  // perfectly uniform translation, which nothing that pushes off the ground
  // produces. Two pushes per cycle, one per footfall, with the mean held at
  // exactly 1 so the distance-driven leg phase and every average the wire
  // sees are untouched: the surge only redistributes the same ground within
  // the cycle. Bigger bodies lurch harder.
  const surge = Math.min(0.16, 0.05 + a.bulk * 0.06);
  const pulse = 1 + surge * Math.sin(Math.PI * 2 * (a.phase * 2 - 0.1));
  // A SHARP TURN COSTS SPEED: nothing runs full tilt through a hundred and
  // eighty — it wheels, slowing as it comes round, and accelerates out.
  let mis = a.aim - a.heading;
  while (mis > Math.PI) mis -= Math.PI * 2;
  while (mis < -Math.PI) mis += Math.PI * 2;
  const grip = 1 - 0.5 * Math.min(1, Math.abs(mis) / Math.PI);
  const step = a.speed * scale * dt * pulse * grip * livingMotion(a.genome, a.idleT).pace;
  a.x += Math.cos(a.heading) * step;
  a.z += Math.sin(a.heading) * step;
  // The homeward drift at the pit's edge must NEVER fire during a pursuit:
  // it overwrites `aim` on the same frame the chase sets it, the heading
  // settles halfway between the two, and the chaser orbits its target at
  // ninety degrees forever. The pit's own wall was the kiter's bodyguard.
  // Busy creatures get a hard boundary instead, and keep their aim.
  if (a.state === 'approach' || a.state === 'fight' || a.state === 'flee') {
    const r2 = Math.hypot(a.x, a.z);
    if (r2 > 7.6) { a.x *= 7.6 / r2; a.z *= 7.6 / r2; }
    return;
  }
  // the void is a pool of light, not an infinite plane — drift back if they
  // wander out of frame, by aiming home rather than by a hard wall
  const r = Math.hypot(a.x, a.z);
  if (r > 6.5) a.aim = Math.atan2(-a.z, -a.x) + rnd(-0.4, 0.4);
}

function reachOf(a: Agent): number {
  return REACH_BASE * (0.7 + a.bulk * 0.45);
}

/** What this creature's current swing should be CALLED. */
export function styleName(a: Agent): string {
  const spec = strikeSpecOf(a);
  if (spec.ranged) return spec.ranged.speed > 12 ? 'bolt' : 'spell';
  if (spec.limb === 'head') return 'bite';
  if (spec.limb === 'tail') return 'lash';
  const w = a.ch.weapon?.name;
  return w ? w.split(/[^a-z]+/i).filter(Boolean).slice(-1)[0] || 'blow' : 'blow';
}

function strikeStyleOf(a: Agent, heavy: boolean): StrikeSpec {
  const b = a.ch.behaviors[heavy ? 'attack-heavy' : 'attack-light'] as { strike?: StrikeSpec } | undefined;
  return b?.strike ?? DEFAULT_STRIKE_LIGHT;
}

/** The swing in progress, if there is one — otherwise the creature's style. */
export function strikeSpecOf(a: Agent): StrikeSpec {
  const spec = a.swing ?? strikeStyleOf(a, a.heavy);
  if (spec.ranged?.sticks && a.thrownRelic != null) return STRIKE_SWIPE;
  return spec;
}

export function strikeDuration(a: Agent): number {
  return strikeSpecOf(a).duration;
}

export function rangedOf(a: Agent): RangedSpec | undefined {
  const light = (a.ch.behaviors['attack-light'] as { strike?: StrikeSpec } | undefined)?.strike;
  // a thrown spear is not in the hand: until it is pulled back out of the
  // floor, this creature fights like anything else with empty hands
  if (light?.ranged?.sticks && a.thrownRelic != null) return undefined;
  return light?.ranged;
}

/** How far this creature likes to be. Archers keep their distance. */
export function preferredRange(a: Agent): number {
  const r = rangedOf(a);
  if (r) return Math.min(r.range * 0.55, 5.5);
  // Melee closed to a flat 1.5m and circled there, which for most creatures is
  // outside its own arms — two things standing near each other, swinging at
  // air. Fight at the distance your reach actually is.
  return Math.max(0.7, reachOf(a) * 0.72);
}

function nearest(sim: VoidSim, a: Agent, maxR: number): Agent | null {
  let best: Agent | null = null;
  let bestD = maxR;
  for (const o of sim.agents) {
    if (o === a || o.deadT >= 0) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/**
 * Who to go for. "Nearest" is how a thing with no eyes behaves; a creature
 * that is actually looking around weighs up what it can see — how far, how
 * hurt, how big, and whether it is already busy with someone else. A brave
 * thing will take on something larger. A timid one picks off the wounded.
 */
function pickTarget(sim: VoidSim, a: Agent, maxR: number): Agent | null {
  let best: Agent | null = null;
  let bestScore = 0;
  for (const o of sim.agents) {
    if (o === a || o.deadT >= 0) continue;
    // A fresh arrival gets a breath. A newcomer's creature died inside a
    // minute to whatever was already standing, and the summoner never even
    // got a proud look at it. Ten seconds of being nobody's target — it can
    // still start its own fight if that is its nature.
    if (sim.t - o.deeds.born < 10) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d > maxR) continue;

    // an ally is not a target, whatever else is true of it
    const stance = stanceOf(sim.pacts, a.by, o.by);
    if (stance === 'ally') continue;

    let score = 1 - d / maxR;                       // close is easy
    // a feud outweighs sense: you came here for them
    if (stance === 'feud') score += 1.4;
    // GLORY. Whatever has been killing things is the thing worth killing, and
    // this is the only reason the pit does not simply crown its first winner.
    score += Math.min(0.9, o.deeds.kills * 0.3);
    score += (1 - o.hp / Math.max(1, o.maxHp)) * 0.55;  // wounded is easier
    // size it up: a big thing is only appealing if you have the nerve
    const odds = (a.bulk - o.bulk) * 0.5 + (a.temper.bravery - 0.5) * 0.8;
    score += Math.max(-0.7, Math.min(0.45, odds));
    // something already fighting has its back to you
    if (o.state === 'fight' && o.target !== a) score += 0.3;
    // and something running away invites a chase
    if (o.state === 'flee') score += 0.25 * a.temper.aggression;
    // a little arbitrariness, so the pit does not gang up in lockstep
    score += Math.random() * 0.22;

    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/**
 * The same two moves forever is what made every fight look identical. A swing
 * is now a variant of the creature's style: it can come from the other side,
 * run fast or heavy, reach further or pull short. Same machinery, never quite
 * the same arc, and it costs nothing because the shape was always data.
 */
function varyStrike(base: StrikeSpec, r: number): StrikeSpec {
  const v = { ...base, posts: base.posts.map(p => [...p]) as StrikeSpec['posts'] };
  const pick = Math.floor(r * 1000) % 4;
  const jitter = (r * 7919) % 1;

  // backhand: the whole arc comes across the other way
  if (pick === 1) for (const p of v.posts) { p[2] = -p[2]; p[1] *= 0.75; }
  // rising: from low up through the target rather than down onto it
  if (pick === 2) for (const p of v.posts) { p[1] = -p[1] * 0.85; }
  // a wider, looser sweep
  if (pick === 3) for (const p of v.posts) { p[2] *= 1.5; }

  v.duration = base.duration * (0.78 + jitter * 0.5);
  v.reachMax = base.reachMax * (0.92 + jitter * 0.2);
  v.twist = base.twist * (0.7 + jitter * 0.8);
  if (base.lunge) v.lunge = base.lunge * (0.6 + jitter * 1.1);
  return v;
}

/** Used by the live client so watchers see varied swings too. */
/** The same swing on every screen: seed strikes from the sim clock. */
export function strikeSeed(t: number, id: number): number {
  return ((t * 9301 + id * 49297) % 233280) / 233280;
}

/**
 * WEAPONS PICK SPOTS. A swing is aimed at a place on the victim's body —
 * head, torso, or legs, left or right — and the strike arc bends to reach
 * it: the posts rise for a skull, drop for a hamstring, and pull across for
 * the chosen side. The spot comes off the deterministic seed, so every
 * watcher sees the same blow land in the same place.
 */
function spotPosts(v: StrikeSpec, a: Agent, t: Agent, h: number, side: number): StrikeSpec['posts'] {
  const dy = Math.max(-0.5, Math.min(0.5, (t.bulk * h - a.bulk * 0.55) * 0.9));
  const posts = v.posts.map(p => [...p]) as StrikeSpec['posts'];
  posts[1][1] += dy * 0.6;
  posts[2][1] += dy;
  posts[2][2] += side * 0.22;
  return posts;
}

function aimAtSpot(v: StrikeSpec, a: Agent, r: number): StrikeSpec {
  const t = a.target;
  if (!t || t.deadT >= 0 || v.ranged || v.limb === 'head' || v.limb === 'tail') return v;
  const h = r < 0.33 ? 0.9 : r < 0.72 ? 0.55 : 0.22;          // head / torso / legs
  const side = ((r * 7919) % 1) < 0.5 ? -1 : 1;
  const spot = { h, side };
  // A FEINT shows one line and lands on another: the windup draws the guard
  // high, the blow goes low (or the reverse, or across). Cunning is
  // aggression here — the ones who swing most also lie best.
  const feinting = !v.limb && ((r * 3571) % 1) < 0.1 + a.temper.aggression * 0.22;
  if (feinting) {
    const shownH = h > 0.5 ? 0.22 : 0.9;                       // the opposite line
    return {
      ...v,
      spot,
      posts: spotPosts(v, a, t, shownH, -side),                // the lie, shown
      feintPosts: spotPosts(v, a, t, h, side),                 // the truth, landed
    };
  }
  return { ...v, spot, posts: spotPosts(v, a, t, h, side) };
}

export function varyFor(a: Agent, heavy: boolean, r: number): StrikeSpec {
  return aimAtSpot(varyStrike(strikeStyleOf(a, heavy), r), a, r);
}

/**
 * THE DEFENCE IS A DECISION, made while the windup is readable: a fighter
 * who sees the blow coming — facing, armed, hands free — gets its guard up
 * for the length of it. Nerve decides. Called wherever a strike begins.
 */
export function offerGuard(attacker: Agent, spec: StrikeSpec): void {
  const t = attacker.target;
  if (!t || t.deadT >= 0 || spec.ranged) return;
  const seesIt = Math.cos(Math.atan2(attacker.z - t.z, attacker.x - t.x) - t.heading) > -0.1;
  const armed = !!(t.ch.weapon || t.ch.offhand);
  if (seesIt && armed && t.strikeT < 0 && Math.random() < 0.35 + t.temper.bravery * 0.4) {
    t.guardT = spec.duration * (spec.windup + spec.strike) + 0.15;
  }
}

/** How long an evasion lasts, and the window inside it that actually beats a blow. */
export const EVADE_TIME = 0.5;
const EVADE_FROM = 0.07, EVADE_TO = 0.36;

/**
 * GET OUT OF THE WAY. A guard is the armed answer to a blow; this is the
 * other one, and until now the pit had no other one — an unarmed creature
 * simply stood there and took everything, because offerGuard requires a
 * weapon to raise. Now it can move instead.
 *
 * Which way is not a choice: the blow's own arc says whether it goes over a
 * crouch, under a jump, or past a sidestep. What IS a choice is whether to
 * try, and that is temperament — a quick thing evades, a brave one would
 * rather meet it, and something with nothing in its hands has no other option.
 */
export function offerEvade(sim: VoidSim, attacker: Agent, spec: StrikeSpec): void {
  const t = attacker.target;
  if (!t || t.deadT >= 0 || spec.ranged) return;
  if (t.strikeT >= 0 || t.evadeT >= 0 || t.guardT > 0 || t.staggerT > 0) return;
  // it has to see it coming
  const toThreat = Math.atan2(attacker.z - t.z, attacker.x - t.x);
  if (Math.cos(toThreat - t.heading) < -0.1) return;

  const armed = !!(t.ch.weapon || t.ch.offhand);
  // quick things move, brave things stand, and empty hands decide it outright
  const nerve = armed ? 0.16 + t.temper.speed * 0.5 - t.temper.bravery * 0.25
    : 0.5 + t.temper.speed * 0.4;
  if (Math.random() > nerve) return;

  // read the swing that is ACTUALLY being thrown, not the style it came from:
  // every strike is varied as it begins, and a defender answering the average
  // of a style rather than the blow in front of it will answer wrong
  t.evade = evadedBy(attacker.swing ?? spec);
  // YOU MOVE AT THE BLOW, NOT AT THE WINDUP. The window was a fixed half
  // second from the moment the swing started, so a slow heavy attack simply
  // outlasted it — and slow heavy attacks are precisely the ones you sidestep,
  // which is why not one dodge in four hundred seconds ever worked. The
  // movement is now delayed to meet the blow, waiting out the telegraph first.
  const meets = spec.duration * (spec.windup + spec.strike * 0.5);
  // and it is not timed perfectly: a quick creature reads it within a
  // twentieth of a second, a slow one is out by twice that and pays for it
  const slop = (Math.random() - 0.5) * (0.26 - t.temper.speed * 0.16);
  t.evadeT = Math.min(0, 0.21 - meets) + slop;
  t.evadeSide = Math.random() < 0.5 ? -1 : 1;
  // announced, so every watching screen plays the same movement — the client
  // advances the clock itself from here, exactly as it does for a swing
  sim.events.push({
    kind: 'evade', t: sim.t, x: t.x, z: t.z,
    actor: whoOf(t), target: whoOf(attacker),
    // spotS is already 'which side'; range means METRES to the narrator, so
    // borrowing it for a direction would have the feed announcing distances
    // that do not exist
    how: t.evade, spotS: t.evadeSide, spotH: t.evadeT,
  });
}

export function beginStrike(a: Agent, heavy: boolean, seed = Math.random()): void {
  a.strikeT = 0;
  a.struck = false;
  a.heavy = heavy;
  const v = aimAtSpot(varyStrike(strikeStyleOf(a, heavy), seed), a, seed);
  // A head strike moves a head, and a head is small: on a hound that is 64cm
  // of neck in an animal a metre long, which reads as nothing at all. An
  // animal that bites throws its whole body at you.
  if (v.limb === 'head' || v.limb === 'tail') {
    v.lunge = (v.lunge ?? 0.2) * 1.9;
    v.reachMax *= 1.25;
    v.duration *= 0.82;
  }
  a.swing = v;
}

function hurt(sim: VoidSim, a: Agent, fromX: number, fromZ: number, by?: Agent, how?: string): void {
  if (a.hurtT > 0 || a.deadT >= 0) return;

  // A RAISED GUARD TURNS THE BLOW — unless it was drawn by a FEINT (wrong
  // line, wrong-footed) or smashed by a HEAVY (guard-break). This is the
  // triangle: light blows lose to guards, guards lose to feints and heavies,
  // heavies lose to the quick interrupt below. The exchange has stakes in
  // every direction now.
  // GOT OUT OF THE WAY. Resolved before the guard, because a blow that misses
  // was never parried. The window is short and sits in the middle of the
  // movement: commit too early and it has already landed back on its feet,
  // too late and it is still standing where the blow is going.
  if (a.evadeT >= EVADE_FROM && a.evadeT <= EVADE_TO && a.evade
    && how !== 'bolt' && how !== 'spell' && by?.swing
    && a.evade === evadedBy(by.swing)) {
    a.riposteT = 0.42;                    // and it is now the one with time
    sim.events.push({
      kind: 'hit', t: sim.t, x: a.x, z: a.z,
      actor: by ? whoOf(by) : undefined, target: whoOf(a),
      how: a.evade === 'duck' ? 'ducked' : a.evade === 'jump' ? 'jumped' : 'dodged',
    });
    return;
  }

  let guardBeaten = false;
  if (a.guardT > 0 && how !== 'bolt' && how !== 'spell') {
    const toThreat = Math.atan2(fromZ - a.z, fromX - a.x);
    if (Math.cos(toThreat - a.heading) > -0.1) {
      const shielded = /shield|buckler/.test(a.ch.offhand?.name ?? '');
      const feinted = !!by?.swing?.feinted;
      if (feinted && Math.random() < 0.6) {
        // the guard went to the shown line; the blow arrives on the other
        a.guardT = 0;
        guardBeaten = true;
      } else if (by?.heavy) {
        // GUARD-BREAK: the heavy comes down through the guard
        a.guardT = 0;
        a.staggerT = 0.45;
        a.hurtT = 0.4;
        jolt(a.sec, 0.34, toThreat - a.heading, a.bulk);
        if (shielded) {
          // the shield holds most of it: one point, and knocked open
          a.hp = Math.max(1, a.hp - 1);
          sim.events.push({
            kind: 'hit', t: sim.t, x: a.x, z: a.z,
            actor: by ? whoOf(by) : undefined, target: whoOf(a), how: 'guard-broken',
          });
          return;
        }
        guardBeaten = true;   // a bare parry is simply smashed aside
      } else {
        a.guardT = 0;
        a.hurtT = 0.3;
        jolt(a.sec, shielded ? 0.16 : 0.24, toThreat - a.heading, a.bulk);
        // a weapon parry stings a little; a shield takes it clean
        if (!shielded && Math.random() < 0.25) a.hp = Math.max(1, a.hp - 1);
        if (by && by.deadT < 0) {
          by.staggerT = 0.55;
          by.strikeT = -1;
          by.swing = null;
          jolt(by.sec, 0.3, Math.atan2(a.z - by.z, a.x - by.x) - by.heading, by.bulk);
        }
        a.riposteT = 0.5;
        sim.events.push({
          kind: 'hit', t: sim.t, x: a.x, z: a.z,
          actor: by ? whoOf(by) : undefined, target: whoOf(a),
          how: shielded ? 'blocked' : 'parried',
        });
        return;
      }
    }
  }

  // THE SHIELD DOES ITS JOB. A blow from the front, against a creature
  // carrying one, has a real chance of being taken on the shield — arrows
  // included, which is the honest counter to kiting: summon a shield-bearer
  // and walk through the arrows. From behind it helps nobody.
  const held = a.ch.offhand?.name ?? '';
  const shieldy = held === 'shield' ? 0.55 : held === 'buckler' ? 0.3 : 0;
  if (shieldy > 0 && !guardBeaten) {
    const toThreat = Math.atan2(fromZ - a.z, fromX - a.x);
    // generous arc: a shield is carried, not bolted to the sternum
    const frontal = Math.cos(toThreat - a.heading) > -0.2;
    if (frontal && Math.random() < shieldy) {
      a.hurtT = 0.35;
      jolt(a.sec, 0.2, toThreat - a.heading, a.bulk);
      // A block is not just a no: the bearer sets the shield and STEPS IN.
      // Every ordinary hit knocks its victim backwards, which is why kiting
      // was self-reinforcing — each arrow pushed the chaser away. Behind a
      // shield the arrows become the rhythm you advance to.
      a.x += Math.cos(toThreat) * 0.24;
      a.z += Math.sin(toThreat) * 0.24;
      sim.events.push({
        kind: 'hit', t: sim.t, x: a.x, z: a.z,
        actor: by ? whoOf(by) : undefined, target: whoOf(a), how: 'blocked',
      });
      return;
    }
  }

  // Not every blow is a wound. A quick thing rolls with it — it still gets
  // knocked about, it just does not bleed for it. Without this every exchange
  // was a countdown and nothing in the pit ever lived long enough to have a
  // history worth watching.
  if (Math.random() < 0.22 + a.temper.speed * 0.28) {
    a.hurtT = 0.3;
    const graze = Math.atan2(fromZ - a.z, fromX - a.x) - a.heading;
    jolt(a.sec, 0.16, graze, a.bulk);
    return;
  }
  a.hp--;
  a.hurtT = 0.55;
  // the blow goes into the body, not just into the hit points
  const fromYaw = Math.atan2(fromZ - a.z, fromX - a.x) - a.heading;
  jolt(a.sec, a.hp <= 0 ? 0.55 : 0.3, fromYaw, a.bulk);

  // A blow lands and the thing being hit carries on swinging as though nothing
  // touched it — that is why exchanges read as two creatures taking turns at a
  // wall. Being wounded costs you the swing you were in the middle of, and
  // knocks you off the spot you were standing on.
  a.strikeT = -1;
  a.struck = false;
  a.swing = null;
  a.stateT = Math.min(a.stateT, 0.15);   // a beat to recover before the next
  const knock = 0.16 / Math.max(0.5, a.bulk);
  a.x -= Math.cos(fromYaw + a.heading) * knock;
  a.z -= Math.sin(fromYaw + a.heading) * knock;

  // Anything that has sworn to this one comes running. This is the only way a
  // pact is ever visible: nothing is announced, you just watch two creatures
  // that have no reason to help each other converge on whoever swung.
  if (by && a.by) {
    for (const o of sim.agents) {
      if (o === a || o === by || o.deadT >= 0) continue;
      if (stanceOf(sim.pacts, o.by, a.by) !== 'ally') continue;
      if (stanceOf(sim.pacts, o.by, by.by) === 'ally') continue;  // torn — stays out
      if (o.state === 'fight' || o.state === 'flee') continue;
      if (Math.hypot(o.x - a.x, o.z - a.z) > NOTICE_R * 1.5) continue;
      o.target = by;
      setState(o, 'approach');
    }
  }
  // knocked back along the blow
  const d = Math.hypot(a.x - fromX, a.z - fromZ) || 1;
  // A maul shoves you; an arrow does not. Ranged hits used to knock their
  // victim half a metre backwards, which made kiting self-reinforcing — every
  // arrow pushed the chaser back onto the treadmill. Projectiles sting now;
  // only a blow with a body behind it moves one.
  const shove = (how === 'bolt' || how === 'spell') ? 0.06 : 0.35;
  a.x += ((a.x - fromX) / d) * shove;
  a.z += ((a.z - fromZ) / d) * shove;
  const common = {
    t: sim.t, x: a.x, z: a.z,
    actor: by ? whoOf(by) : undefined,
    target: whoOf(a),
    how,
    range: by ? Math.hypot(by.x - a.x, by.z - a.z) : undefined,
  };
  // THE INTERRUPT: land a real blow on something mid-windup and its swing
  // dies in its hand — the quick answer to the heavy. Third side of the
  // triangle.
  if (a.strikeT >= 0) {
    const sw = strikeSpecOf(a);
    if (a.strikeT < sw.duration * sw.windup) {
      a.strikeT = -1;
      a.swing = null;
      a.hurtT = Math.max(a.hurtT, 0.25);
    }
  }
  // where it landed is how it hurts: the struck part carries the blow
  const spot = by?.swing?.spot;
  a.flinch = {
    h: spot?.h ?? 0.55,
    side: spot?.side ?? (Math.random() < 0.5 ? -1 : 1),
    t: 0.5,
  };
  sim.events.push({ kind: 'hit', ...common, spotH: a.flinch.h, spotS: a.flinch.side });
  if (a.hp <= 0) {
    a.deadT = 0;
    a.state = 'down';
    a.strikeT = -1;
    a.target = null;
    sim.events.push({ kind: 'kill', ...common });
    // the floor takes the rest: bones, and the weapon if nobody claims it
    leaveRemains(sim.relics, a.x, a.z, a.ch.weapon);
    if (by && by.deadT < 0) {
      by.deeds.kills++;
      // it takes something off the body. The graft is on the agent's own copy
      // of the genome, so it shows on the next frame — you watch it change.
      const took = takeSpoil(by.genome, a.genome, by.deeds);
      // whatever it has taken has made it harder to put down — though the
      // blood-won surge stops at the scar line like every other healing
      by.maxHp = Math.min(12, by.maxHp + 1);
      by.scars = scarsOf(sim, by);
      by.hp = Math.min(Math.max(by.hp, by.maxHp - by.scars), by.hp + 1);
      by.bulk = heightOf(by.genome);
      // AND IT TAKES SOMETHING TO WEAR. The graft is a limb bolted on; this
      // is the proof hung at the belt, in the dead thing's colours. It goes
      // on the agent's OWN character object — the roster's copy is the shelf
      // every future summon spawns off, and a trophy is not hereditary.
      const trophy = takeTrophy(a.genome, (by.ch.gear ?? []).length);
      if (trophy) by.ch = { ...by.ch, gear: [...(by.ch.gear ?? []), trophy] };
      if (took || trophy) {
        sim.events.push({
          kind: 'spoil', t: sim.t, x: by.x, z: by.z,
          actor: whoOf(by), target: whoOf(a), how: took ?? trophy?.name,
        });
      }
    }
  } else if (a.hp <= Math.max(1, a.maxHp * 0.4) && Math.random() > a.temper.bravery + 0.25) {
    // losing and not brave enough for this
    a.state = 'flee';
    a.stateT = 0;
    sim.events.push({ kind: 'flee', t: sim.t, x: a.x, z: a.z, actor: whoOf(a) });
  }
}

function setState(a: Agent, s: AgentState): void {
  a.state = s;
  a.stateT = 0;
}

/**
 * The open wounds of a reign. The first hour and the first kill are free;
 * after that, every second kill and every hour held is one hp that healing
 * can never reach again. Capped so even the oldest lord keeps over half its
 * bar — worn down, not hollowed out.
 */
export function scarsOf(sim: VoidSim, a: Agent): number {
  const hours = Math.max(0, (sim.t - a.deeds.born) / 3600 - 1);
  return Math.min(
    Math.floor(a.maxHp * 0.45),
    Math.floor(a.deeds.kills / 2 + hours),
  );
}

export function stepVoid(sim: VoidSim, dt: number): void {
  sim.events.length = 0;
  sim.t += dt;

  for (const a of sim.agents) {
    a.stateT += dt;
    a.idleT += dt;
    if (a.guardT > 0) a.guardT -= dt;
    if (a.staggerT > 0) a.staggerT -= dt;
    if (a.evade) {
      a.evadeT += dt;                       // may start negative: it is waiting
      if (a.evadeT > EVADE_TIME) { a.evadeT = -1; a.evade = null; }
    }
    if (a.riposteT > 0) a.riposteT -= dt;
    if (a.flinch && (a.flinch.t -= dt) <= 0) a.flinch = null;

    // Nothing healed, ever. Every creature was on a one-way trip from spawn to
    // death, which is why the pit was all churn and no history: it does not
    // matter what a thing has done if it cannot live long enough to have done
    // anything. Left alone, it gets its wind back — but only so much of it.
    // The reign keeps a ledger: every trophy and every hour on the throne is
    // a wound rest never closes, so an old lord can no longer stand there
    // resetting to full between challengers. Each one that falls leaves a
    // mark that stays, and the crown is taken by accumulation — the only way
    // a newborn was ever going to take it.
    a.scars = scarsOf(sim, a);
    if (a.state === 'wander' || a.state === 'think') a.calm += dt; else a.calm = 0;
    if (a.calm > 7 && a.hp < a.maxHp - a.scars && a.deadT < 0) {
      a.hp++;
      a.calm = 3.5;   // the next one comes quicker, but never for free
    }
    if (a.hurtT > 0) a.hurtT -= dt;

    if (a.deadT >= 0) {
      a.deadT += dt;
      a.vx = a.vz = 0;
      a.move += (0 - a.move) * Math.min(1, 8 * dt);
      stepSecondary(a.sec, dt, {
        turnRate: 0, move: 0, speed: 0, mass: a.bulk,
        lookYaw: 0, phase: a.phase, dead: true,
      });
      continue;
    }

    // a swing in progress owns the body until it lands and recovers
    if (a.strikeT >= 0) {
      a.strikeT += dt;
      const spec = strikeSpecOf(a);
      // the feint turns: at windup's end the shown line becomes the true one
      if (a.swing?.feintPosts && a.strikeT >= spec.duration * spec.windup) {
        a.swing = { ...a.swing, posts: a.swing.feintPosts, feintPosts: undefined, feinted: true };
      }
      const hitAt = spec.windup + spec.strike * 0.5;
      if (!a.struck && a.strikeT >= spec.duration * hitAt) {
        a.struck = true;
        const t = a.target;
        if (spec.ranged) {
          // let go, and stop caring — the shot is on its own now.
          // (Unless it STICKS: a spear is a possession in flight.)
          const aim = t && t.deadT < 0 ? Math.atan2(t.z - a.z, t.x - a.x) : a.heading;
          sim.shots.push({
            id: shotSeq++,
            x: a.x + Math.cos(aim) * 0.35,
            z: a.z + Math.sin(aim) * 0.35,
            y: a.bulk * 0.62,
            vx: Math.cos(aim) * spec.ranged.speed,
            vz: Math.sin(aim) * spec.ranged.speed,
            life: spec.ranged.range / spec.ranged.speed,
            spec: spec.ranged,
            from: a,
            trail: [],
          });
          sim.events.push({
            kind: 'loose', t: sim.t, x: a.x, z: a.z, actor: whoOf(a),
            target: t ? whoOf(t) : undefined, how: styleName(a),
            range: t ? Math.hypot(t.x - a.x, t.z - a.z) : undefined,
          });
        } else if (t && t.deadT < 0) {
          const d = Math.hypot(t.x - a.x, t.z - a.z);
          const facing = Math.cos(Math.atan2(t.z - a.z, t.x - a.x) - a.heading);
          if (d < reachOf(a) + reachOf(t) * 0.5 && facing > 0.3) hurt(sim, t, a.x, a.z, a, styleName(a));
        }
      }
      if (a.strikeT >= spec.duration) { a.strikeT = -1; a.struck = false; }
    }

    // where it was before it did anything, so the legs can be told the truth
    const wasX = a.x, wasZ = a.z;

    switch (a.state) {
      case 'wander': {
        a.move += (1 - a.move) * Math.min(1, 4 * dt);
        // an empty-handed thrower wanders TOWARD its spear, the way anyone
        // circles back for the thing they put down
        if (a.thrownRelic != null) {
          const r = sim.relics.find(x => x.id === a.thrownRelic);
          if (r) a.aim = Math.atan2(r.z - a.z, r.x - a.x);
        }
        walk(a, dt);
        if (a.stateT > rnd(2, 4) && Math.random() < dt * 0.8) setState(a, 'think');
        break;
      }
      // Alone in the pit with nothing to do and no idea when anyone is
      // coming. It settles, sleeps, wakes, looks around, and settles again.
      case 'rest': {
        a.move += (0 - a.move) * Math.min(1, 3 * dt);
        a.rest = Math.min(1, a.rest + dt * 0.35);
        a.scanT -= dt;
        if (a.scanT <= 0) {
          // a head lifted at nothing in particular, then put back down
          a.lookAt = a.heading + rnd(-1.2, 1.2);
          a.scanT = rnd(2.5, 7);
        }
        // it gets its wind back faster lying down — never past its scars
        if (a.hp < a.maxHp - a.scars && a.stateT > 6 && Math.random() < dt * 0.12) a.hp++;
        if (a.stateT > rnd(14, 40)) setState(a, 'wander');
        break;
      }
      case 'think': {
        a.move += (0 - a.move) * Math.min(1, 5 * dt);
        // Look about. The head sweeps across whatever is out there and rests
        // on each thing for a beat — this is the tell that it is deciding
        // rather than waiting for a timer to expire.
        a.scanT -= dt;
        if (a.scanT <= 0) {
          const seen = sim.agents.filter(o => o !== a && o.deadT < 0
            && Math.hypot(o.x - a.x, o.z - a.z) < NOTICE_R * 1.3);
          if (seen.length) {
            const at = seen[Math.floor(Math.random() * seen.length)];
            a.lookAt = Math.atan2(at.z - a.z, at.x - a.x);
          } else {
            a.lookAt = a.heading + rnd(-1.5, 1.5);
          }
          a.scanT = rnd(0.5, 1.2);
        }
        if (a.stateT > 0.6 && Math.random() < dt * 2) a.aim = rnd(-Math.PI, Math.PI);
        if (a.stateT > rnd(1.2, 2.6)) setState(a, 'wander');
        break;
      }
      case 'approach': {
        const t = a.target;
        if (!t || t.deadT >= 0) { a.target = null; setState(a, 'wander'); break; }
        const d = Math.hypot(t.x - a.x, t.z - a.z);
        a.aim = Math.atan2(t.z - a.z, t.x - a.x);
        if (d > preferredRange(a)) {
          a.move += (1 - a.move) * Math.min(1, 5 * dt);
          walk(a, dt, 1.32); // a purposeful stride
          // Swing ON THE WAY IN. A backpedalling target ping-pongs its chaser
          // between approach and fight so fast that fight's settling time
          // never elapses — a tank chased an archer for seventeen seconds,
          // touched one metre, and threw nothing at all. If it is in reach,
          // it is in reach.
          if (d < reachOf(a) + 0.5 && a.strikeT < 0
            && Math.random() < dt / (STRIKE_PERIOD * (1.1 - a.temper.aggression * 0.5))) {
            beginStrike(a, Math.random() < 0.3, strikeSeed(sim.t, a.id));
            offerGuard(a, strikeSpecOf(a));
            offerEvade(sim, a, strikeSpecOf(a));
            sim.events.push({
              kind: 'strike', t: sim.t, x: a.x, z: a.z, actor: whoOf(a),
              target: whoOf(t), how: styleName(a), range: d,
            });
          }
        } else {
          setState(a, 'fight');
        }
        // give up on something that will not stand and fight — a chase that
        // never ends is a death sentence for whichever tires first
        if (a.stateT > 5 && t.state === 'flee') { a.target = null; setState(a, 'wander'); }
        // ...but NEVER give up on something that is standing there shooting
        // you. The approach timeout made every archer unreachable: twelve
        // seconds of backpedalling, the chaser shrugs and wanders off, and
        // the arrows carry on. If it is fighting you, you keep coming.
        if (a.stateT > 12 && t.state !== 'fight') { a.target = null; setState(a, 'wander'); }
        break;
      }
      case 'fight': {
        const t = a.target;
        if (!t || t.deadT >= 0) { a.target = null; setState(a, 'think'); break; }
        const d = Math.hypot(t.x - a.x, t.z - a.z);
        a.aim = Math.atan2(t.z - a.z, t.x - a.x);
        const want = preferredRange(a);
        if (d > want * 1.5) { setState(a, 'approach'); break; }
        // STAGGERED: the blow was turned and the answer is coming. Stand
        // there and take the lesson.
        if (a.staggerT > 0) {
          a.move += (0.05 - a.move) * Math.min(1, 8 * dt);
          break;
        }
        // an archer backs off when something closes on it
        if (rangedOf(a) && d < want * 0.55) walk(a, dt, -1.1);
        // FEET PLANT FOR THE SWING. The old circling drift ran straight
        // through strikes and blocks — most of the sliding he could see was
        // fighters strafing mid-blow with their gait ignoring it.
        const busy = a.strikeT >= 0 || a.guardT > 0;
        if (!busy) {
          // WHICH WAY IT CIRCLES IS A DECISION, NOT A WOBBLE. Every fighter
          // strafed on the same shared sine, so a whole pit swayed together
          // like weather and none of it read as intent. Each one picks a
          // side now, holds it for a few seconds, and changes its mind at
          // its own rate — and an aggressive thing circles less, because it
          // would rather be closing.
          const own = motionOf(a.genome);
          const spell = 2.4 + own.spring * 2.6;
          const way = ((Math.floor(sim.t / spell + own.offset) ^ a.id) & 1) ? 1 : -1;
          const circling = way * (0.62 - a.temper.aggression * 0.3);
          a.move += (0.45 - a.move) * Math.min(1, 5 * dt);
          a.x += Math.cos(a.heading + Math.PI / 2) * circling * dt * 0.8;
          a.z += Math.sin(a.heading + Math.PI / 2) * circling * dt * 0.8;

          // REACH IS THE ARGUMENT. A thing with a longer weapon wins by
          // keeping the distance it already owns; a thing with a shorter one
          // only ever wins inside. They used to fight at whatever range they
          // happened to drift to, which handed every exchange to nobody.
          if (!rangedOf(a)) {
            const mine = reachOf(a), theirs = reachOf(t);
            if (mine > theirs + 0.12) {
              // hold the edge: close only to where it can still hit first
              if (d < mine * 0.82) walk(a, dt, -0.5);
            } else if (d > mine * 0.85) {
              walk(a, dt, 0.55 + a.temper.aggression * 0.4);   // get inside it
            } else if (d < reachOf(a) * 0.7) {
              walk(a, dt, -0.35);
            }
          }
        } else {
          a.move += (0.1 - a.move) * Math.min(1, 8 * dt);
        }
        // A RIPOSTE ANSWERS A BLOCK: the window is short and it takes it.
        if (a.riposteT > 0 && a.strikeT < 0 && d < reachOf(a) + 0.6) {
          a.riposteT = 0;
          const seed = strikeSeed(sim.t, a.id);
          beginStrike(a, false, seed);
          offerGuard(a, strikeSpecOf(a));
            offerEvade(sim, a, strikeSpecOf(a));
          sim.events.push({
            kind: 'strike', t: sim.t, x: a.x, z: a.z, actor: whoOf(a),
            target: whoOf(t), how: styleName(a), range: d,
          });
          break;
        }
        // AN OPENING IS WORTH TAKING. Something staggered, or still
        // recovering from a blow it has already thrown, cannot answer — and a
        // fighter that swings at the same rate whether or not its opponent can
        // defend itself is not fighting, it is taking turns.
        const open = t.staggerT > 0 || (t.strikeT >= 0 && t.struck);
        // and something badly hurt gets careful, unless it is too brave to
        const hurt = 1 - a.hp / Math.max(1, a.maxHp);
        const wary = 1 + hurt * 0.9 * (1 - a.temper.bravery);
        const period = STRIKE_PERIOD * (1.5 - a.temper.aggression * 0.85)
          * (open ? 0.55 : 1) * wary;
        if (a.strikeT < 0 && a.stateT > 0.35 && Math.random() < dt / period) {
          const seed = strikeSeed(sim.t, a.id);
          beginStrike(a, Math.random() < 0.15 + a.temper.aggression * 0.4, seed);
          sim.events.push({
            kind: 'strike', t: sim.t, x: a.x, z: a.z, actor: whoOf(a),
            target: t ? whoOf(t) : undefined, how: styleName(a),
            range: Math.hypot(t.x - a.x, t.z - a.z),
          });
          offerGuard(a, strikeSpecOf(a));
            offerEvade(sim, a, strikeSpecOf(a));
        }
        break;
      }
      case 'flee': {
        const t = a.target ?? pickTarget(sim, a, NOTICE_R);
        if (t) a.aim = Math.atan2(a.z - t.z, a.x - t.x);
        a.move += (1 - a.move) * Math.min(1, 6 * dt);
        walk(a, dt, 1.4);
        if (a.stateT > rnd(4, 7)) { a.target = null; setState(a, 'wander'); }
        break;
      }
      default:
        break;
    }

    // Nothing has happened for a long time and there is nobody here. Lie down.
    // This was a dice roll inside `think`, which lasts 1.4s on average against
    // a 2s threshold — so in five minutes of an empty pit the keeper never once
    // sat down. Boredom is not a coincidence; it is a length of time.
    if ((a.state === 'wander' || a.state === 'think') && a.calm > 16
        && sim.agents.every(o => o === a || o.deadT >= 0)) {
      setState(a, 'rest');
    }

    // something arrived. Get up.
    if (a.state === 'rest' && sim.agents.some(o => o !== a && o.deadT < 0)) {
      setState(a, 'think');
    }
    a.rest = a.state === 'rest' ? a.rest : Math.max(0, a.rest - dt * 1.6);

    // noticing: only while going about your business
    if ((a.state === 'wander' || a.state === 'think' || a.state === 'rest') && a.stateT > 0.5) {
      const other = pickTarget(sim, a, NOTICE_R);
      if (other && Math.random() < dt * 0.9 * (1 - sim.peace) * (0.4 + a.nerve)) {
        a.target = other;
        setState(a, 'approach');
        sim.events.push({ kind: 'notice', t: sim.t, x: a.x, z: a.z, actor: whoOf(a), target: whoOf(other) });
        // Being stalked is worth reacting to — unless you have sworn to spare
        // them, in which case you do not raise a hand even now. That is what
        // makes a one-way pact cost something: your creatures will stand there
        // and take it from someone who never swore anything back.
        if (other.state === 'wander' || other.state === 'think') {
          if (stanceOf(sim.pacts, other.by, a.by) === 'ally') {
            setState(other, 'flee');
          } else {
            other.target = a;
            setState(other, Math.random() < other.temper.bravery ? 'approach' : 'flee');
          }
        }
      }
    }

    turnToward(a, dt);

    // Ease the requested travel, including sidesteps. Attacks, blocks and
    // stagger retain their planted stance instead of drifting through a blow.
    if (dt > 0) {
      const planted = a.strikeT >= 0 || a.guardT > 0 || a.staggerT > 0 || a.state === 'rest';
      if (planted) {
        a.vx = a.vz = 0;
      } else {
        const wantX = (a.x - wasX) / dt, wantZ = (a.z - wasZ) / dt;
        const response = motionOf(a.genome).response * (0.75 + Math.min(2, a.bulk) * 0.25);
        const blend = 1 - Math.exp(-dt / response);
        const oldX = a.vx, oldZ = a.vz;
        a.vx += (wantX - a.vx) * blend;
        a.vz += (wantZ - a.vz) * blend;
        a.x = wasX + wantX * dt + (oldX - wantX) * response * blend;
        a.z = wasZ + wantZ * dt + (oldZ - wantZ) * response * blend;
        // the easing runs AFTER walk() clamped to the wall, and carried
        // momentum was taking creatures to 8 m — out through the wall and
        // into the rim ring. The wall is the last word.
        const r = Math.hypot(a.x, a.z);
        if (r > 7.6) { a.x *= 7.6 / r; a.z *= 7.6 / r; a.vx = a.vz = 0; }
      }
    }

    // The legs cycle on DISTANCE, not on a clock. Advancing the phase by
    // cadence*dt meant a creature backing off, circling, chasing at 1.25x or
    // fleeing at 1.4x all cycled its legs at exactly the same rate as one
    // strolling — so the feet slid across the floor. Stride is metres per
    // cycle, so a cycle is one stride travelled, whatever the speed.
    const eff = effectiveGait(a.genome.gait, { tired: 0, angry: a.state === 'fight' ? 0.7 : 0 });
    const dx = a.x - wasX, dz = a.z - wasZ;
    const fwd = dx * Math.cos(a.heading) + dz * Math.sin(a.heading);
    const lat = -dx * Math.sin(a.heading) + dz * Math.cos(a.heading);
    const stride = Math.max(0.08, eff.stride);
    // backing up runs the cycle backwards; sidestepping still lifts the feet
    const phaseDelta = (fwd + Math.abs(lat) * 0.5) / stride;
    a.phase = ((a.phase + phaseDelta) % 1 + 1) % 1;
    const actualSpeed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    a.move = Math.max(a.move, Math.min(1, actualSpeed / Math.max(0.2, stride * eff.cadence)));

    // a target holds the head; otherwise it rests where the scan left it
    if (a.target && a.target.deadT < 0 && (a.state === 'fight' || a.state === 'approach')) {
      a.lookAt = Math.atan2(a.target.z - a.z, a.target.x - a.x);
    }
    const rel = Math.atan2(Math.sin(a.lookAt - a.heading), Math.cos(a.lookAt - a.heading));
    stepSecondary(a.sec, dt, {
      turnRate: a.turnRate,
      move: a.move,
      speed: actualSpeed,
      genome: a.genome, gait: eff, phaseDelta,
      mass: a.bulk,
      lookYaw: Math.max(-1.0, Math.min(1.0, rel)),
      phase: a.phase,
      dead: a.deadT >= 0,
    });

    // the scenery is in the way. A rock you can walk through is set dressing;
    // a rock you have to go round is a place.
    for (const pr of sim.props) {
      if (pr.radius <= 0) continue;
      const dx = a.x - pr.x, dz = a.z - pr.z;
      const d = Math.hypot(dx, dz);
      const min = pr.radius + a.bulk * 0.22;
      if (d > 0.0001 && d < min) {
        const push = min - d;
        a.x += (dx / d) * push;
        a.z += (dz / d) * push;
        if (push > 0.01) {
          // walking into a boulder should be felt, not silently corrected
          jolt(a.sec, Math.min(0.18, push * 2.2), Math.atan2(-dz, -dx) - a.heading, a.bulk);
          if (a.state === 'wander') a.aim = Math.atan2(dz, dx) + rnd(-0.7, 0.7);
        }
      }
    }

    // soft separation so bodies do not occupy each other
    for (const o of sim.agents) {
      if (o === a || o.deadT >= 0) continue;
      const dx = a.x - o.x, dz = a.z - o.z;
      const d = Math.hypot(dx, dz);
      // heavier things give less ground: a hound bouncing off a troll should
      // be the one that moves
      const min = 0.55 * (a.bulk + o.bulk) * 0.5;
      if (d > 0.0001 && d < min) {
        const give = o.bulk / (a.bulk + o.bulk);
        const push = (min - d) * give;
        a.x += (dx / d) * push;
        a.z += (dz / d) * push;
        // and it is felt. Bodies used to interpenetrate and slide apart with
        // the pose completely unaware — the world had no effect on them.
        if (push > 0.004) {
          const from = Math.atan2(-dz, -dx) - a.heading;
          jolt(a.sec, Math.min(0.22, push * 3.2), from, a.bulk);
        }
      }
    }
    // THE WALL IS THE LAST WORD. Props push, bodies separate, momentum
    // carries — every one of those can end a step outside the pit, and with
    // the eased travel they compounded to 8 m: creatures standing in the rim
    // ring. Whatever moved it this frame, it ends the frame inside.
    {
      const r = Math.hypot(a.x, a.z);
      if (r > 7.6) { a.x *= 7.6 / r; a.z *= 7.6 / r; a.vx = a.vz = 0; }
    }
  }

  // things in flight
  const landed: Shot[] = [];
  for (const s of sim.shots) {
    s.trail.unshift({ x: s.x, z: s.z, y: s.y });
    if (s.trail.length > s.spec.trail) s.trail.pop();
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    if (s.spec.arcing) s.y += (s.life * 0.5 - 0.25) * dt * 3;
    s.life -= dt;
    if (s.spec.spark) continue;                 // debris hits nothing
    for (const o of sim.agents) {
      if (o === s.from || o.deadT >= 0) continue;
      if (Math.hypot(o.x - s.x, o.z - s.z) < 0.45 + s.spec.size) {
        // a boom does not hurt on touch — it goes off, and the blast decides
        if (!s.spec.boom) hurt(sim, o, s.x - s.vx * 0.1, s.z - s.vz * 0.1, s.from, s.spec.speed > 12 ? 'bolt' : 'spell');
        s.life = -1;
        break;
      }
    }
    if (s.life <= 0) landed.push(s);
  }
  for (const s of landed) {
    if (s.spec.boom) {
      // everything inside the blast takes it, friend and stranger alike —
      // a fireball has no opinion about who is standing where
      for (const o of sim.agents) {
        if (o === s.from || o.deadT >= 0) continue;
        if (Math.hypot(o.x - s.x, o.z - s.z) < s.spec.boom) hurt(sim, o, s.x, s.z, s.from, 'spell');
      }
      // THE FLASH IS NOT THE SIM'S BUSINESS. Six harmless debris projectiles
      // used to be pushed in here — simulated authoritatively, snapshotted,
      // interpolated and streamed to every watcher, all so that something
      // pretty happened for a fifth of a second. Every screen now draws its
      // own explosion from the fact that one occurred, which is cheaper on
      // the wire, cheaper in the sim, and looks enormously better.
    }
    if (s.spec.sticks && s.from) {
      // the spear stands where it landed, a relic like any other — except its
      // owner knows exactly which one is theirs
      const spear: Relic = {
        id: takeRelicId(), kind: 'wpn',
        x: s.x, z: s.z, vx: 0, vz: 0,
        yaw: Math.atan2(s.vz, s.vx), vyaw: 0, sink: 0,
        item: s.from.ch.weapon,
      };
      sim.relics.push(spear);
      s.from.thrownRelic = spear.id;
    }
  }
  sim.shots = sim.shots.filter(s => s.life > 0);

  // pulling the spear back out of the floor: walk to it and it is yours again
  for (const a of sim.agents) {
    if (a.thrownRelic == null || a.deadT >= 0) continue;
    const r = sim.relics.find(x => x.id === a.thrownRelic);
    if (!r) { a.thrownRelic = null; continue; }   // the floor swallowed it
    if (Math.hypot(r.x - a.x, r.z - a.z) < 0.6) {
      sim.relics.splice(sim.relics.indexOf(r), 1);
      a.thrownRelic = null;
    }
  }

  // The fallen fade. Nothing spawns by itself — no keeper, no refill, no
  // house challenger. Every creature in the pit was summoned by a person, and
  // an empty pit is an empty pit; the scenery and the title carry the room
  // until someone types. (The keeper design lasted a day: it made the pit
  // feel inhabited, and made every identity bug look like something else.)
  sim.agents = sim.agents.filter(a => a.deadT < 0 || a.deadT < 3.5);

  // the floor lives too: bones get kicked and sink, plants grow and suffer
  stepRelics(sim.relics, sim.agents, dt);
  stepFlora(sim.flora, sim.events, sim.agents, dt, sim.t);
}

/** Where the interesting thing is happening, for the camera to look at. */
export function focusOf(sim: VoidSim): { x: number; z: number; tension: number; radius: number } {
  const live = sim.agents.filter(a => a.deadT < 0);
  if (live.length === 0) return { x: 0, z: 0, tension: 0, radius: 1.5 };
  // a brawl outranks everything
  const fighters = live.filter(a => a.state === 'fight' || a.state === 'approach');
  const cast = fighters.length ? fighters : live;
  let x = 0, z = 0;
  for (const a of cast) { x += a.x; z += a.z; }
  x /= cast.length;
  z /= cast.length;
  // how tight the camera should pull in: brawls close, wandering wide
  const spread = Math.max(...cast.map(a => Math.hypot(a.x - x, a.z - z)), 0.5);
  const tallest = Math.max(...cast.map(a => a.bulk), 1);
  const tension = fighters.length ? Math.min(1, fighters.length / 2) : 0;
  // how much room the shot needs: the cast's spread plus headroom for the
  // biggest thing in it, so a lone creature fills the frame
  return { x, z, tension, radius: spread + tallest * 0.8 };
}
