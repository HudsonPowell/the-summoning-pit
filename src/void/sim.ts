// THE VOID — an attract mode. Nobody is playing: the creatures off the
// bestiary shelf wander an empty plane, think, notice each other, and pick
// fights. Continuous space, no grid, no walls; the only rules are wanting
// things and bumping into each other.

import { Character, StrikeSpec, DEFAULT_STRIKE_LIGHT } from '../character';
import { Genome, effectiveGait } from '../genome';

export type AgentState = 'wander' | 'think' | 'approach' | 'fight' | 'flee' | 'down';

export interface Agent {
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
  nerve: number;             // 0 timid .. 1 belligerent
  bulk: number;              // rough size, for reach and shoving
  speed: number;             // metres/sec walking
}

export interface VoidEvent {
  type: 'strike' | 'hit' | 'die' | 'notice' | 'spawn';
  x: number; z: number;
  agent?: Agent;
}

export interface VoidSim {
  agents: Agent[];
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

function heightOf(g: Genome): number {
  const sk = g.skeleton;
  const legs = sk.chains.filter(c => c.role === 'leg' && c.attach === 'hip');
  const legLen = legs.length ? Math.max(...legs.map(c => c.seg[0] + c.seg[1])) : 0.8;
  return sk.prone ? legLen + sk.torsoR + sk.headR * 2 : legLen + sk.spine + sk.neck + sk.headR * 2;
}

export function makeAgent(ch: Character, x: number, z: number): Agent {
  const g = ch.genome;
  const eff = effectiveGait(g.gait, { tired: 0, angry: 0 });
  const h = heightOf(g);
  return {
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
    hp: ch.kind === 'beast' ? 4 : 5,
    maxHp: ch.kind === 'beast' ? 4 : 5,
    hurtT: 0,
    strikeT: -1,
    struck: false,
    heavy: false,
    deadT: -1,
    target: null,
    nerve: ch.kind === 'beast' ? rnd(0.5, 1) : rnd(0.25, 0.8),
    bulk: h,
    speed: Math.max(0.6, eff.stride * eff.cadence),
  };
}

export function createVoid(roster: Character[], population = 4): VoidSim {
  const sim: VoidSim = {
    agents: [], roster, events: [], t: 0, spawnT: 0, population, peace: 0.35,
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

export function spawnOne(sim: VoidSim, quiet = false): Agent | null {
  if (sim.roster.length === 0) return null;
  const ch = sim.roster[Math.floor(Math.random() * sim.roster.length)];
  const { x, z } = spawnSpot(sim);
  const a = makeAgent(ch, x, z);
  sim.agents.push(a);
  if (!quiet) sim.events.push({ type: 'spawn', x, z, agent: a });
  return a;
}

function turnToward(a: Agent, dt: number): void {
  let d = a.aim - a.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a.heading += d * (1 - Math.exp(-TURN_RATE * dt));
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

function strikeSpecOf(a: Agent): StrikeSpec {
  const key = a.heavy ? 'attack-heavy' : 'attack-light';
  const b = a.ch.behaviors[key] as { strike?: StrikeSpec } | undefined;
  return b?.strike ?? DEFAULT_STRIKE_LIGHT;
}

export function strikeDuration(a: Agent): number {
  return strikeSpecOf(a).duration;
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

function hurt(sim: VoidSim, a: Agent, fromX: number, fromZ: number): void {
  if (a.hurtT > 0 || a.deadT >= 0) return;
  a.hp--;
  a.hurtT = 0.55;
  // knocked back along the blow
  const d = Math.hypot(a.x - fromX, a.z - fromZ) || 1;
  a.x += ((a.x - fromX) / d) * 0.35;
  a.z += ((a.z - fromZ) / d) * 0.35;
  sim.events.push({ type: 'hit', x: a.x, z: a.z, agent: a });
  if (a.hp <= 0) {
    a.deadT = 0;
    a.state = 'down';
    a.strikeT = -1;
    a.target = null;
    sim.events.push({ type: 'die', x: a.x, z: a.z, agent: a });
  } else if (a.hp <= 1 && Math.random() > a.nerve) {
    // losing and not brave enough for this
    a.state = 'flee';
    a.stateT = 0;
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
        if (t && t.deadT < 0) {
          const d = Math.hypot(t.x - a.x, t.z - a.z);
          const facing = Math.cos(Math.atan2(t.z - a.z, t.x - a.x) - a.heading);
          if (d < reachOf(a) + reachOf(t) * 0.5 && facing > 0.3) hurt(sim, t, a.x, a.z);
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
        // look about, then commit to a new direction
        if (a.stateT > 0.6 && Math.random() < dt * 2) a.aim = rnd(-Math.PI, Math.PI);
        if (a.stateT > rnd(1.2, 2.6)) setState(a, 'wander');
        break;
      }
      case 'approach': {
        const t = a.target;
        if (!t || t.deadT >= 0) { a.target = null; setState(a, 'wander'); break; }
        const d = Math.hypot(t.x - a.x, t.z - a.z);
        a.aim = Math.atan2(t.z - a.z, t.x - a.x);
        if (d > FIGHT_R) {
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
        if (d > FIGHT_R * 1.6) { setState(a, 'approach'); break; }
        // circle and jockey rather than stand still
        const circling = Math.sin(sim.t * 1.3 + a.phase * 6) * 0.5;
        a.move += (0.45 - a.move) * Math.min(1, 5 * dt);
        a.x += Math.cos(a.heading + Math.PI / 2) * circling * dt * 0.8;
        a.z += Math.sin(a.heading + Math.PI / 2) * circling * dt * 0.8;
        if (d < reachOf(a) * 0.75) walk(a, dt, -0.35); // too close, give ground
        if (a.strikeT < 0 && a.stateT > 0.35 && Math.random() < dt / STRIKE_PERIOD) {
          a.strikeT = 0;
          a.struck = false;
          a.heavy = Math.random() < 0.3;
          sim.events.push({ type: 'strike', x: a.x, z: a.z, agent: a });
        }
        break;
      }
      case 'flee': {
        const t = a.target ?? nearest(sim, a, NOTICE_R);
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
      const other = nearest(sim, a, NOTICE_R);
      if (other && Math.random() < dt * 0.9 * (1 - sim.peace) * (0.4 + a.nerve)) {
        a.target = other;
        setState(a, 'approach');
        sim.events.push({ type: 'notice', x: a.x, z: a.z, agent: a });
        // being stalked is worth reacting to
        if (other.state === 'wander' || other.state === 'think') {
          other.target = a;
          setState(other, Math.random() < other.nerve ? 'approach' : 'flee');
        }
      }
    }

    turnToward(a, dt);
    // keep the gait cycle honest to distance travelled
    const eff = effectiveGait(a.genome.gait, { tired: 0, angry: a.state === 'fight' ? 0.7 : 0 });
    a.phase = (a.phase + eff.cadence * a.move * dt) % 1;

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
