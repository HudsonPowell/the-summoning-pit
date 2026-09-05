import { Genome, Gait } from './genome';
import { landingWeight, motionOf } from './motion';

// The difference between animated and alive is what the body does AFTER it is
// told to move. A driver-posed creature hits every target exactly, on the frame
// it was asked to — which is why it reads as a puppet. This is the lag: a set
// of springs that overshoot, settle, and get knocked about, fed by what the
// creature is actually doing and by what is done to it.
//
// Deliberately under-damped. Critical damping is correct and looks dead.

export interface Secondary {
  lean: number; leanV: number;     // bank into a turn, and past it
  twist: number; twistV: number;   // the torso lagging a change of heading
  bob: number; bobV: number;       // weight settling, landing, flinching
  jiggle: number; jiggleV: number; // mass carrying on after the frame stops
  head: number; headV: number;     // the head arriving last
  spin: number; spinV: number;     // knocked off its axis entirely
  ready: boolean;
  lastSpeed: number;
  lastPhase: number;               // to catch each footfall as it lands
}

export function newSecondary(): Secondary {
  return {
    lean: 0, leanV: 0, twist: 0, twistV: 0, bob: 0, bobV: 0,
    jiggle: 0, jiggleV: 0, head: 0, headV: 0, spin: 0, spinV: 0,
    lastPhase: 0, ready: false, lastSpeed: 0,
  };
}

/** One under-damped spring step. k is stiffness, z is damping ratio (<1 rings). */
function spring(x: number, v: number, target: number, k: number, z: number, dt: number): [number, number] {
  // sub-step so a slow frame cannot blow the spring up
  const steps = Math.max(1, Math.ceil(dt * 120));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = -k * (x - target) - 2 * z * Math.sqrt(k) * v;
    v += a * h;
    x += v * h;
  }
  return [x, v];
}

export interface SecondaryDrive {
  turnRate: number;   // rad/s the creature is actually turning
  move: number;       // 0..1 how hard it is going
  speed: number;      // m/s, for how much there is to throw around
  mass: number;       // roughly height; heavy things are slower and looser
  lookYaw: number;    // where the head is being asked to point
  phase: number;      // gait phase, so the wobble rides the footfalls
  dead: boolean;
  genome?: Genome;
  gait?: Gait;
  phaseDelta?: number;
}

/**
 * Heavier creatures get softer springs and looser damping: a troll wobbles for
 * longer than an imp, which is most of what tells you it is heavy.
 */
export function stepSecondary(s: Secondary, dt: number, d: SecondaryDrive): void {
  dt = Math.max(0, Math.min(0.25, dt));
  if (!dt) return;
  const m = Math.max(0.4, Math.min(2.4, d.mass));
  const soft = (d.genome ? motionOf(d.genome).spring : 1) / (0.55 + m * 0.45);     // 1 = light and snappy, <1 = heavy

  // banking: lean into the turn, overshoot coming out of it.
  // THESE GAINS WERE TUNED BLIND. The springs never ran on a live screen until
  // the client began stepping them, and the sim's own turns hit 4-5 rad/s —
  // so the old clamp of 1.4 rad, multiplied AFTER clamping by up to 1.35 and
  // then overshot by the ringing, put the lean at 2.5 rad on ordinary turns:
  // 0.16 m/rad at the spine top is the torso flung 0.4 m sideways on a metre
  // of creature. Measured over a 40s brawl: lean past 0.5 rad in 13% of all
  // frames. A bank you can see is 0.3-0.5 rad; clamp there, before the
  // move factor, and let the ring add its little more.
  const leanWant = Math.max(-0.45, Math.min(0.45, -d.turnRate * 0.12)) * (0.35 + 0.65 * d.move);
  [s.lean, s.leanV] = spring(s.lean, s.leanV, leanWant, 42 * soft, 0.4, dt);

  // the torso does not turn when the feet do; it is dragged round after them
  const twistWant = Math.max(-0.28, Math.min(0.28, -d.turnRate * 0.075));
  [s.twist, s.twistV] = spring(s.twist, s.twistV, twistWant, 26 * soft, 0.3, dt);

  // Acceleration compresses the body; individual foot contacts supply the landing beat.
  const acceleration = s.ready ? Math.max(-5, Math.min(5, (d.speed - s.lastSpeed) / dt)) : 0;
  s.lastSpeed = d.speed;
  const bobWant = d.dead ? -0.02 : -Math.abs(acceleration) * 0.002;
  [s.bob, s.bobV] = spring(s.bob, s.bobV, bobWant, 90 * soft, 0.3, dt);

  // flesh: never has a target, only ever settling toward still
  [s.jiggle, s.jiggleV] = spring(s.jiggle, s.jiggleV, 0, 34 * soft, 0.12, dt);

  // Actual leg contacts drive the springs; reverse steps must not look like wraps.
  const delta = d.phaseDelta ?? ((d.phase - s.lastPhase + 1.5) % 1 - 0.5);
  const contact = s.ready && d.genome
    ? landingWeight(d.genome, d.gait ?? d.genome.gait, d.phase, delta) : 0;
  if (contact && d.move > 0.12 && !d.dead) {
    const strike = Math.min(1.5, 0.3 + d.speed * 0.4) * d.move * m * contact;
    s.bobV -= strike * 0.05;
    s.jiggleV += strike * 0.06;
  }
  s.lastPhase = d.phase;
  s.ready = true;

  // the head arrives last, and overshoots when it does — but a neck has an
  // end: the ask is capped short of the pose's own limit so the overshoot
  // lands inside it instead of cranking the head round past the shoulder
  const headWant = d.dead ? 0.5 : Math.max(-0.8, Math.min(0.8, d.lookYaw));
  [s.head, s.headV] = spring(s.head, s.headV, headWant, 30 * soft, 0.5, dt);

  // spin only ever decays — nothing drives it but being hit
  [s.spin, s.spinV] = spring(s.spin, s.spinV, 0, 5 * soft, 0.5, dt);
}

/** Something hit it. Put the energy in and let the springs deal with it. */
export function jolt(s: Secondary, force: number, fromYaw: number, mass: number): void {
  const m = Math.max(0.4, Math.min(2.4, mass));
  const give = force / m;
  // scaled with the drives above: a blow should knock a body about a third
  // of the way to where a hard turn banks it, not past it
  s.bobV -= give * 0.9;
  s.jiggleV += give * 1.6;
  s.leanV += Math.sin(fromYaw) * give * 2.5;
  s.twistV += Math.sin(fromYaw) * give * 1.8;
  s.headV += Math.sin(fromYaw + 0.7) * give * 3;
  s.spinV += Math.sin(fromYaw) * give * 2.2;
}
