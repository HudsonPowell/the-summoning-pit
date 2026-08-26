// The camera operator. Two jobs, kept apart: DECIDE what is worth filming
// (shot selection), then MOVE there like a real head — critically damped,
// anticipating the action rather than trailing it.

import { Agent, VoidSim } from './sim';

export interface DirectorTuning {
  closeness: number;   // 0 wide .. 1 in your face
  response: number;    // seconds to settle; smaller is snappier
  lead: number;        // seconds of subject motion to anticipate
  sway: number;        // radians of drift either side of the ideal angle
  pitch: number;
}

export interface Frame {
  x: number; z: number;
  ppm: number;
  yaw: number;
  cy: number;
  shake: number;
}

type ShotKind = 'duel' | 'brawl' | 'kill' | 'stalk' | 'solo' | 'empty';

interface Shot {
  kind: ShotKind;
  cast: Agent[];
  score: number;
}

const MIN_HOLD = 2.2;   // don't twitch between subjects
const STALE = 11;       // but don't stare at nothing forever

/** Unity-style critically damped spring: eases in and out, never overshoots. */
function smoothDamp(
  current: number, target: number, vel: { v: number }, smoothTime: number, dt: number,
): number {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // clamp the tail so it can't creep past the target
  if ((target - current > 0) === (out > target)) {
    out = target;
    vel.v = (out - target) / dt;
  }
  return out;
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smoothDampAngle(
  current: number, target: number, vel: { v: number }, smoothTime: number, dt: number,
): number {
  return smoothDamp(current, current + wrapPi(target - current), vel, smoothTime, dt);
}

export class Director {
  private shot: Shot = { kind: 'empty', cast: [], score: 0 };
  private held = 0;
  private settle = 0;          // extra urgency just after a cut
  private swayT = Math.random() * 10;

  private x = 0; private z = 0; private ppm = 40; private yaw = 0.6; private cy = 0.9;
  private vx = { v: 0 }; private vz = { v: 0 };
  private vppm = { v: 0 }; private vyaw = { v: 0 }; private vcy = { v: 0 };
  shake = 0;

  /** What deserves the lens right now. */
  private candidates(sim: VoidSim): Shot[] {
    const live = sim.agents.filter(a => a.deadT < 0);
    const out: Shot[] = [];

    // someone going down is the most cinematic thing that can happen
    const dying = sim.agents.filter(a => a.deadT >= 0 && a.deadT < 1.6);
    if (dying.length) {
      const killer = live.find(a => a.target && dying.includes(a.target));
      out.push({ kind: 'kill', cast: killer ? [dying[0], killer] : [dying[0]], score: 130 });
    }

    const fighters = live.filter(a => a.state === 'fight');
    if (fighters.length >= 3) {
      out.push({ kind: 'brawl', cast: fighters, score: 110 });
    } else if (fighters.length >= 1) {
      // pair the fighter with whoever it is actually swinging at
      const a = fighters[0];
      const b = a.target && a.target.deadT < 0 ? a.target : fighters[1];
      // the closer they are to finishing each other, the better the shot
      const drama = 20 - (a.hp + (b?.hp ?? 4)) * 2;
      out.push({ kind: 'duel', cast: b ? [a, b] : [a], score: 100 + drama });
    }

    const closing = live.filter(a => a.state === 'approach' || a.state === 'flee');
    if (closing.length) {
      const a = closing[0];
      const b = a.target && a.target.deadT < 0 ? a.target : null;
      out.push({ kind: 'stalk', cast: b ? [a, b] : [a], score: 70 });
    }

    if (live.length) {
      // otherwise follow somebody who is actually doing something
      const moving = live.filter(a => a.move > 0.4);
      const pick = (moving.length ? moving : live)[0];
      out.push({ kind: 'solo', cast: [pick], score: 30 + pick.bulk * 4 });
    }

    if (!out.length) out.push({ kind: 'empty', cast: [], score: 0 });
    return out;
  }

  private chooseShot(sim: VoidSim, dt: number): void {
    this.held += dt;
    const cands = this.candidates(sim);
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];

    const castAlive = this.shot.cast.length > 0 &&
      this.shot.cast.some(a => sim.agents.includes(a) && a.deadT < 2);
    const stale = this.held > STALE;
    const held = this.held < MIN_HOLD;

    // cut when the subject is gone, when something much better turns up, or
    // when we have simply been on this too long
    const muchBetter = best.score > this.shot.score + 25;
    if (!castAlive || stale || (!held && muchBetter) || this.shot.kind === 'empty') {
      const sameCast =
        best.cast.length === this.shot.cast.length &&
        best.cast.every((a, i) => a === this.shot.cast[i]);
      if (!sameCast) {
        this.shot = best;
        this.held = 0;
        this.settle = 0.7; // move decisively into the new shot
      } else {
        this.shot = best;
      }
    } else if (best.kind === this.shot.kind) {
      this.shot.score = best.score; // keep the score fresh without cutting
    }
  }

  update(sim: VoidSim, dt: number, tune: DirectorTuning, bufW: number, bufH: number): Frame {
    this.chooseShot(sim, dt);
    this.settle = Math.max(0, this.settle - dt);
    this.swayT += dt;

    const cast = this.shot.cast.filter(a => sim.agents.includes(a));
    const live = cast.length ? cast : sim.agents.filter(a => a.deadT < 0);

    // --- where to look ------------------------------------------------
    let tx = 0, tz = 0, spread = 0, tall = 1;
    if (live.length) {
      for (const a of live) { tx += a.x; tz += a.z; }
      tx /= live.length;
      tz /= live.length;
      for (const a of live) spread = Math.max(spread, Math.hypot(a.x - tx, a.z - tz));
      tall = Math.max(...live.map(a => a.bulk));
      // ANTICIPATE: lead the subject rather than chasing its tail
      if (live.length === 1) {
        const a = live[0];
        const v = a.speed * a.move;
        tx += Math.cos(a.heading) * v * tune.lead;
        tz += Math.sin(a.heading) * v * tune.lead;
      }
    }

    // --- how close ----------------------------------------------------
    // margin shrinks as closeness rises; a duel is framed tighter than a mob
    const margin = 3.2 - tune.closeness * 2.3;
    const tightness = this.shot.kind === 'duel' || this.shot.kind === 'kill' ? 0.82 : 1;
    const acrossM = Math.max(1.9, (spread * 2 + tall * 1.15 + margin) * tightness);
    const upM = Math.max(1.4, spread * 2 * Math.sin(tune.pitch) + tall * 1.25 + margin * 0.45);
    const fitPpm = Math.min(bufW / acrossM, bufH / upM);

    // --- from what angle ----------------------------------------------
    let idealYaw = this.yaw;
    if (live.length >= 2) {
      // put the pair across the screen so you can read both of them
      const a = live[0], b = live[1];
      idealYaw = Math.atan2(b.z - a.z, b.x - a.x);
    } else if (live.length === 1) {
      // three-quarter front: we want its face, not its back
      const h = live[0].heading;
      idealYaw = h + 0.75 - Math.PI / 2;
    }
    idealYaw += Math.sin(this.swayT * 0.21) * tune.sway;

    // --- move like a head, not a lerp ---------------------------------
    const t = Math.max(0.06, tune.response * (this.settle > 0 ? 0.45 : 1));
    this.x = smoothDamp(this.x, tx, this.vx, t, dt);
    this.z = smoothDamp(this.z, tz, this.vz, t, dt);
    this.ppm = smoothDamp(this.ppm, fitPpm, this.vppm, t * 1.35, dt);
    this.yaw = smoothDampAngle(this.yaw, idealYaw, this.vyaw, t * 2.2, dt);
    this.cy = smoothDamp(this.cy, tall * 0.52, this.vcy, t * 1.5, dt);
    this.shake *= Math.exp(-6 * dt);

    return { x: this.x, z: this.z, ppm: this.ppm, yaw: this.yaw, cy: this.cy, shake: this.shake };
  }

  punch(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  get currentShot(): string {
    return this.shot.kind;
  }
}
