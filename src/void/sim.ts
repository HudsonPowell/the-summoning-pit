// THE VOID — an attract mode. Nobody is playing: the creatures off the
// bestiary shelf wander an empty plane, think, notice each other, and pick
// fights. Continuous space, no grid, no walls; the only rules are wanting
// things and bumping into each other.

import { Character, StrikeSpec, RangedSpec, DEFAULT_STRIKE_LIGHT } from '../character';
import { Genome, effectiveGait, heightOf } from '../genome';
import { Temper, temperOf } from '../temper';
import { Secondary, newSecondary, stepSecondary, jolt } from '../secondary';
import { Pacts, newPacts, stanceOf } from './pacts';

export type AgentState = 'wander' | 'think' | 'approach' | 'fight' | 'flee' | 'down';

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
  hurtT: number;
  strikeT: number;           // -1 idle, else seconds into the swing
  struck: boolean;
  heavy: boolean;            // this swing is the heavy one
  deadT: number;             // -1 alive
  target: Agent | null;
  nerve: number;             // aggression, kept under its old name for the AI
  temper: Temper;            // what it is like, read off what it is made of
  sec: Secondary;            // the parts of the body that are late
  lookAt: number;            // world angle the head is resting on
  scanT: number;             // seconds until it looks somewhere else
  turnRate: number;          // radians/sec, for secondary motion
  bulk: number;              // rough size, for reach and shoving
  speed: number;             // metres/sec walking
}

export type EventKind =
  | 'spawn' | 'notice' | 'flee' | 'strike' | 'loose' | 'hit' | 'kill' | 'despawn';

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
}

/** Something in flight. Nobody owns it once it leaves. */
export interface Shot {
  x: number; z: number; y: number;
  vx: number; vz: number;
  life: number;
  spec: RangedSpec;
  from: Agent;
  trail: { x: number; z: number; y: number }[];
}

export interface VoidSim {
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
const STRIKE_PERIOD = 1.1;  // seconds between swings in a fight

const rnd = (a: number, b: number) => a + Math.random() * (b - a);


let nextAgentId = 1;

export function makeAgent(ch: Character, x: number, z: number, by?: string): Agent {
  const g = ch.genome;
  const eff = effectiveGait(g.gait, { tired: 0, angry: 0 });
  const h = heightOf(g);
  const temper = temperOf(g);
  return {
    id: nextAgentId++,
    by,
    ch, genome: g,
    x, z,
    heading: rnd(-Math.PI, Math.PI),
    aim: rnd(-Math.PI, Math.PI),
    phase: Math.random(),
    move: 0,
    idleT: Math.random() * 10,
    state: 'wander',
    stateT: 0,
    // beasts are tougher and keener; heroes are cagier
    // a braver thing is usually a bigger thing, and takes more killing
    hp: Math.round(3 + temper.bravery * 3),
    maxHp: Math.round(3 + temper.bravery * 3),
    hurtT: 0,
    strikeT: -1,
    struck: false,
    heavy: false,
    deadT: -1,
    target: null,
    nerve: temper.aggression,
    temper,
    sec: newSecondary(),
    lookAt: rnd(-Math.PI, Math.PI),
    scanT: rnd(0, 0.8),
    turnRate: 0,
    bulk: h,
    // the gait says how fast it CAN move; temperament says how much it does
    speed: Math.max(0.45, eff.stride * eff.cadence) * (0.55 + temper.speed * 0.95),
  };
}

export function createVoid(roster: Character[], population = 4): VoidSim {
  const sim: VoidSim = {
    pacts: newPacts(),
    agents: [], shots: [], roster, events: [], t: 0, spawnT: 0, population, peace: 0.35,
  };
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
  sim.agents.push(a);
  sim.events.push({ kind: 'spawn', t: sim.t, x, z, actor: whoOf(a) });
  return a;
}

export function spawnOne(sim: VoidSim, quiet = false): Agent | null {
  if (sim.roster.length === 0) return null;
  const ch = sim.roster[Math.floor(Math.random() * sim.roster.length)];
  const { x, z } = spawnSpot(sim);
  const a = makeAgent(ch, x, z);
  sim.agents.push(a);
  if (!quiet) sim.events.push({ kind: 'spawn', t: sim.t, x, z, actor: whoOf(a) });
  return a;
}

function turnToward(a: Agent, dt: number): void {
  let d = a.aim - a.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = d * (1 - Math.exp(-TURN_RATE * dt));
  a.heading += step;
  // remembered so the body can bank and the tail can trail
  a.turnRate += (step / Math.max(1e-4, dt) - a.turnRate) * Math.min(1, 8 * dt);
}

function walk(a: Agent, dt: number, scale = 1): void {
  const step = a.speed * scale * dt;
  a.x += Math.cos(a.heading) * step;
  a.z += Math.sin(a.heading) * step;
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

function strikeSpecOf(a: Agent): StrikeSpec {
  const key = a.heavy ? 'attack-heavy' : 'attack-light';
  const b = a.ch.behaviors[key] as { strike?: StrikeSpec } | undefined;
  return b?.strike ?? DEFAULT_STRIKE_LIGHT;
}

export function strikeDuration(a: Agent): number {
  return strikeSpecOf(a).duration;
}

export function rangedOf(a: Agent): RangedSpec | undefined {
  const light = (a.ch.behaviors['attack-light'] as { strike?: StrikeSpec } | undefined)?.strike;
  return light?.ranged;
}

/** How far this creature likes to be. Archers keep their distance. */
export function preferredRange(a: Agent): number {
  const r = rangedOf(a);
  return r ? Math.min(r.range * 0.55, 5.5) : FIGHT_R;
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
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d > maxR) continue;

    // an ally is not a target, whatever else is true of it
    const stance = stanceOf(sim.pacts, a.by, o.by);
    if (stance === 'ally') continue;

    let score = 1 - d / maxR;                       // close is easy
    // a feud outweighs sense: you came here for them
    if (stance === 'feud') score += 1.4;
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

function hurt(sim: VoidSim, a: Agent, fromX: number, fromZ: number, by?: Agent, how?: string): void {
  if (a.hurtT > 0 || a.deadT >= 0) return;
  a.hp--;
  a.hurtT = 0.55;
  // the blow goes into the body, not just into the hit points
  const fromYaw = Math.atan2(fromZ - a.z, fromX - a.x) - a.heading;
  jolt(a.sec, a.hp <= 0 ? 0.55 : 0.3, fromYaw, a.bulk);

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
  a.x += ((a.x - fromX) / d) * 0.35;
  a.z += ((a.z - fromZ) / d) * 0.35;
  const common = {
    t: sim.t, x: a.x, z: a.z,
    actor: by ? whoOf(by) : undefined,
    target: whoOf(a),
    how,
    range: by ? Math.hypot(by.x - a.x, by.z - a.z) : undefined,
  };
  sim.events.push({ kind: 'hit', ...common });
  if (a.hp <= 0) {
    a.deadT = 0;
    a.state = 'down';
    a.strikeT = -1;
    a.target = null;
    sim.events.push({ kind: 'kill', ...common });
  } else if (a.hp <= 1 && Math.random() > a.temper.bravery) {
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

export function stepVoid(sim: VoidSim, dt: number): void {
  sim.events.length = 0;
  sim.t += dt;

  for (const a of sim.agents) {
    a.stateT += dt;
    a.idleT += dt;
    if (a.hurtT > 0) a.hurtT -= dt;

    if (a.deadT >= 0) {
      a.deadT += dt;
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
      const hitAt = spec.windup + spec.strike * 0.5;
      if (!a.struck && a.strikeT >= spec.duration * hitAt) {
        a.struck = true;
        const t = a.target;
        if (spec.ranged) {
          // let go, and stop caring — the shot is on its own now
          const aim = t && t.deadT < 0 ? Math.atan2(t.z - a.z, t.x - a.x) : a.heading;
          sim.shots.push({
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

    switch (a.state) {
      case 'wander': {
        a.move += (1 - a.move) * Math.min(1, 4 * dt);
        walk(a, dt);
        if (a.stateT > rnd(2, 4) && Math.random() < dt * 0.8) setState(a, 'think');
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
          walk(a, dt, 1.25); // a purposeful stride
        } else {
          setState(a, 'fight');
        }
        if (a.stateT > 12) { a.target = null; setState(a, 'wander'); }
        break;
      }
      case 'fight': {
        const t = a.target;
        if (!t || t.deadT >= 0) { a.target = null; setState(a, 'think'); break; }
        const d = Math.hypot(t.x - a.x, t.z - a.z);
        a.aim = Math.atan2(t.z - a.z, t.x - a.x);
        const want = preferredRange(a);
        if (d > want * 1.5) { setState(a, 'approach'); break; }
        // an archer backs off when something closes on it
        if (rangedOf(a) && d < want * 0.55) walk(a, dt, -1.1);
        // circle and jockey rather than stand still
        const circling = Math.sin(sim.t * 1.3 + a.phase * 6) * 0.5;
        a.move += (0.45 - a.move) * Math.min(1, 5 * dt);
        a.x += Math.cos(a.heading + Math.PI / 2) * circling * dt * 0.8;
        a.z += Math.sin(a.heading + Math.PI / 2) * circling * dt * 0.8;
        if (!rangedOf(a) && d < reachOf(a) * 0.75) walk(a, dt, -0.35); // too close, give ground
        // an aggressive thing swings oftener, and swings heavy
        const period = STRIKE_PERIOD * (1.5 - a.temper.aggression * 0.85);
        if (a.strikeT < 0 && a.stateT > 0.35 && Math.random() < dt / period) {
          a.strikeT = 0;
          a.struck = false;
          a.heavy = Math.random() < 0.15 + a.temper.aggression * 0.4;
          sim.events.push({
            kind: 'strike', t: sim.t, x: a.x, z: a.z, actor: whoOf(a),
            target: t ? whoOf(t) : undefined, how: styleName(a),
            range: Math.hypot(t.x - a.x, t.z - a.z),
          });
        }
        break;
      }
      case 'flee': {
        const t = a.target ?? pickTarget(sim, a, NOTICE_R);
        if (t) a.aim = Math.atan2(a.z - t.z, a.x - t.x);
        a.move += (1 - a.move) * Math.min(1, 6 * dt);
        walk(a, dt, 1.4);
        if (a.stateT > rnd(2.5, 4.5)) { a.target = null; setState(a, 'wander'); }
        break;
      }
      default:
        break;
    }

    // noticing: only while going about your business
    if ((a.state === 'wander' || a.state === 'think') && a.stateT > 0.5) {
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
    // keep the gait cycle honest to distance travelled
    const eff = effectiveGait(a.genome.gait, { tired: 0, angry: a.state === 'fight' ? 0.7 : 0 });
    a.phase = (a.phase + eff.cadence * a.move * dt) % 1;

    // a target holds the head; otherwise it rests where the scan left it
    if (a.target && a.target.deadT < 0 && (a.state === 'fight' || a.state === 'approach')) {
      a.lookAt = Math.atan2(a.target.z - a.z, a.target.x - a.x);
    }
    const rel = Math.atan2(Math.sin(a.lookAt - a.heading), Math.cos(a.lookAt - a.heading));
    stepSecondary(a.sec, dt, {
      turnRate: a.turnRate,
      move: a.move,
      speed: a.speed,
      mass: a.bulk,
      lookYaw: Math.max(-1.0, Math.min(1.0, rel)),
      phase: a.phase,
      dead: a.deadT >= 0,
    });

    // soft separation so bodies do not occupy each other
    for (const o of sim.agents) {
      if (o === a || o.deadT >= 0) continue;
      const dx = a.x - o.x, dz = a.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = 0.55 * (a.bulk + o.bulk) * 0.5;
      if (d > 0.0001 && d < min) {
        const push = (min - d) * 0.5;
        a.x += (dx / d) * push;
        a.z += (dz / d) * push;
      }
    }
  }

  // things in flight
  for (const s of sim.shots) {
    s.trail.unshift({ x: s.x, z: s.z, y: s.y });
    if (s.trail.length > s.spec.trail) s.trail.pop();
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    if (s.spec.arcing) s.y += (s.life * 0.5 - 0.25) * dt * 3;
    s.life -= dt;
    for (const o of sim.agents) {
      if (o === s.from || o.deadT >= 0) continue;
      if (Math.hypot(o.x - s.x, o.z - s.z) < 0.45 + s.spec.size) {
        hurt(sim, o, s.x - s.vx * 0.1, s.z - s.vz * 0.1, s.from, s.spec.speed > 12 ? 'bolt' : 'spell');
        s.life = -1;
        break;
      }
    }
  }
  sim.shots = sim.shots.filter(s => s.life > 0);

  // the fallen fade, and the void refills
  const before = sim.agents.length;
  sim.agents = sim.agents.filter(a => a.deadT < 0 || a.deadT < 3.5);
  if (sim.agents.length < before) sim.spawnT = 1.5;
  if (sim.agents.length < sim.population) {
    sim.spawnT -= dt;
    if (sim.spawnT <= 0) {
      spawnOne(sim);
      sim.spawnT = rnd(2, 5);
    }
  }
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
