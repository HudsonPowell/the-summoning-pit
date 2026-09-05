// Everyone gets the same creature to spend.
//
// The pit has to be fair to someone running a 3B model on a laptop and someone
// running a 70B one, and to someone hand-writing JSON straight at the socket.
// The answer is not to police WHAT a creature is — that would kill the whole
// point — but how MUCH of it there is. A budget in flesh: be big and simple, or
// small and elaborate, but not both. Spend it however you like.
//
// Nothing here rejects a creature. Anything over budget is scaled down until it
// fits, so an extravagant summon still arrives, just smaller.

import { Genome, Skeleton, girthAt } from './genome';

/** Roughly the volume of the thing, in capsule terms. */
export function massOf(sk: Skeleton): number {
  let m = 0;
  for (let i = 0; i < sk.body.length; i++) {
    const r = (girthAt(sk, i) + girthAt(sk, i + 1)) * 0.5;
    m += Math.PI * r * r * sk.body[i];
  }
  for (const c of sk.chains) {
    const len = c.seg.reduce((a, b) => a + b, 0);
    const pairs = (c.mirror ?? (c.role !== 'tail' && c.role !== 'head')) ? 2 : 1;
    m += Math.PI * c.r * c.r * len * pairs;
  }
  return m;
}

/**
 * A band, not a ceiling. Measured across real hatches: a wolf came back at
 * 0.141, "an enormous armoured war-elephant" at 0.015 and "a colossal titan of
 * stone, the biggest thing in the world" at 0.021 — the model has almost no
 * grip on scale, and gets it backwards as often as not. So the floor matters
 * as much as the cap: it rescues the titan that arrived the size of a cat.
 *
 * The spread between them is nearly 5x, which is plenty of room for a giant and
 * an imp to be different things, and small enough that nobody can simply be
 * bigger than everyone. Being big is a CHOICE, not a win: girth costs speed
 * (see src/temper.ts), so a heavy creature is a slow one.
 */
// widened so 'towering' and 'tiny' read at a glance — fairness still holds
// because hp scales with bulk and temperament derives from shape
export const MASS_MIN = 0.025;
export const MASS_MAX = 0.17;

/**
 * Scale a creature down until it fits. Volume goes with the cube of a linear
 * scale, so the correction is the cube root — halving the budget overrun costs
 * only ~20% of its height, which is why an over-budget summon still looks like
 * what it was asked to be.
 */
export function fitBudget(g: Genome, lo = MASS_MIN, hi = MASS_MAX): Genome {
  const m = massOf(g.skeleton);
  if (m >= lo && m <= hi) return g;
  const target = m < lo ? lo : hi;
  const k = Math.cbrt(target / m);
  const sk = g.skeleton;
  return {
    ...g,
    skeleton: {
      ...sk,
      body: sk.body.map(v => v * k),
      girth: sk.girth.map(v => v * k),
      chains: sk.chains.map(c => ({ ...c, seg: c.seg.map(v => v * k), r: c.r * k, spread: c.spread * k })),
    },
  };
}
