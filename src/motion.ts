import { Genome, ChainSpec, Gait, mirrorsByDefault } from './genome';
import { frac } from './vec';

/** Stable character traits: no frame-to-frame randomness or saved-data migration. */
export function motionOf(genome: Genome) {
  let seed = 2166136261;
  for (const ch of genome.name) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const unit = (shift: number) => ((seed >>> shift) & 255) / 255;
  return {
    spring: 0.8 + unit(0) * 0.4,
    asymmetry: (unit(8) - 0.5) * 0.035,
    breath: 0.27 + unit(16) * 0.15,
    offset: unit(24) * Math.PI * 2,
    response: 0.15 + unit(8) * 0.12,
  };
}

export function legSides(chain: ChainSpec): number[] {
  return (chain.mirror ?? mirrorsByDefault(chain.role)) ? [-1, 1] : [chain.side ?? 0];
}

/** Shared by posing and contact detection, including asymmetric and unpaired legs. */
export function legOffset(genome: Genome, chain: ChainSpec, index: number, count: number, side: number): number {
  if (genome.skeleton.locomotion === 'hop') return 0;
  const spread = count >= 3 ? index / count * 0.5 : chain.at * 0.25;
  return spread + (side > 0 ? 0.5 + motionOf(genome).asymmetry : 0);
}

/** Contact crossings in either direction; a reverse walk lands at the stance boundary. */
export function landingWeight(genome: Genome, gait: Gait, phase: number, delta: number): number {
  if (!delta || Math.abs(delta) > 0.5) return 0; // discontinuity/teleport
  if (genome.skeleton.locomotion === 'fly' || genome.skeleton.locomotion === 'slither') return 0;
  const legs = genome.skeleton.chains.filter(c => c.role === 'leg').sort((a, b) => a.at - b.at);
  let hits = 0, count = 0;
  legs.forEach((chain, index) => {
    for (const side of legSides(chain)) {
      const offset = legOffset(genome, chain, index, legs.length, side);
      const boundary = delta > 0 ? 0 : gait.stance;
      const end = phase + offset - boundary;
      const start = end - delta;
      hits += Math.abs(Math.floor(end + 1e-9) - Math.floor(start + 1e-9));
      count++;
    }
  });
  return count ? hits * 2 / count : 0;
}

/** Shared airborne displacement keeps body and feet together during a hop. */
export function hopHeight(phase: number, gait: Gait): number {
  const p = frac(phase);
  if (p < gait.stance) return 0;
  const u = (p - gait.stance) / Math.max(0.01, 1 - gait.stance);
  return 4 * u * (1 - u) * Math.max(0.08, gait.lift * 1.8);
}

/** C2-continuous value noise: new intentions with no repeating animation period. */
export function smoothNoise(time: number, seed: number): number {
  const cell = Math.floor(time), u = time - cell;
  const randomAt = (n: number) => {
    let h = Math.imul(n ^ seed, 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const blend = u * u * u * (u * (u * 6 - 15) + 10);
  return randomAt(cell) * (1 - blend) + randomAt(cell + 1) * blend;
}

/**
 * Separate time scales for effort, attention and individual limbs. Time is
 * continuous across gait wraps; sampling twice never advances hidden RNG state.
 */
export function livingMotion(genome: Genome, time: number, amount = 1) {
  let seed = 2166136261;
  for (const ch of genome.name) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  const strength = Math.max(0, Math.min(1.5, amount));
  const drift = (channel: number, rate = 0.65, lag = 0) =>
    smoothNoise((time - lag) * rate + 17.37, seed ^ Math.imul(channel + 1, 0x9e3779b1)) * strength;
  const effort = drift(0, 0.28);
  return {
    drift,
    // Correlate the pace and gesture size, while each limb keeps its own timing.
    pace: 1 + effort * 0.13 + drift(1, 0.95) * 0.045,
    effort,
    posture: drift(2, 0.35) * 0.055,
    gaze: drift(3, 0.48) * 0.22,
    breath: drift(4, 0.19),
  };
}

/** Warp only the airborne part of a step; stance travel and contacts stay exact. */
export function swingVariation(p: number, gait: Gait, timing: number, lift: number) {
  if (p < gait.stance) return { phase: p, lift: 1, arc: 0 };
  const u = (p - gait.stance) / Math.max(0.01, 1 - gait.stance);
  const arc = Math.sin(Math.PI * u) ** 2;
  return {
    phase: gait.stance + (u + timing * 0.12 * arc) * (1 - gait.stance),
    lift: 1 + lift * 0.27,
    arc,
  };
}
