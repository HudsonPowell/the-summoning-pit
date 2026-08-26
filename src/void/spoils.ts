// A kill has to leave a mark or nothing that happens in the pit matters.
//
// The body is a list of chains, so the victor can simply TAKE one — a horn, an
// arm, a tail, the hand that was holding a sword. It grafts on in the victim's
// own colour, so it never quite matches, and a creature that has survived five
// fights is visibly a chimera of the five things it killed. Its career is
// readable off its silhouette without a single number on screen.
//
// The counterweight is glory: the pit wants the champion dead (see pickTarget).
// Without that the first creature to get ahead simply stays ahead.

import { Genome, ChainSpec, ChainRole } from '../genome';

export interface Record {
  kills: number;
  spoils: string[];   // what it took, in the order it took them
  born: number;       // sim time it entered
}

export const MAX_SPOILS = 4;

/** What is worth taking, best first. A trophy should read at a glance. */
const WORTH_TAKING: ChainRole[] = ['horn', 'arm', 'tail', 'wing', 'fin', 'head'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * The victor takes one part off the loser. Returns what it took, or null if
 * there was nothing worth having — a creature can only carry so much.
 */
export function takeSpoil(victor: Genome, victim: Genome, rec: Record): string | null {
  if (rec.spoils.length >= MAX_SPOILS) return null;

  let taken: ChainSpec | undefined;
  let role: ChainRole | undefined;
  for (const r of WORTH_TAKING) {
    // never take the last head off a body — that is not a trophy, that is a
    // second creature stapled on
    const pool = victim.skeleton.chains.filter(c => c.role === r);
    if (!pool.length) continue;
    if (r === 'head' && pool.length < 2) continue;
    taken = clone(pool[Math.floor(Math.random() * pool.length)]);
    role = r;
    break;
  }
  if (!taken || !role) return null;

  // it is worn, not grown: smaller than it was, never mirrored, and pushed
  // round to the side so it reads as bolted on
  taken.mirror = false;
  taken.seg = taken.seg.map(s => s * 0.72);
  taken.r *= 0.85;
  taken.spread = Math.max(0.1, taken.spread);
  taken.angle = (taken.angle ?? 0) + (Math.random() < 0.5 ? 0.5 : -0.5);
  // trophies ride high on the back, and each one further along than the last
  taken.at = Math.min(0.95, 0.42 + rec.spoils.length * 0.13);

  // in the dead thing's colour, so it never matches
  victor.palette.extra ??= [];
  victor.palette.extra.push(victim.palette.accent);
  taken.ink = 3 + victor.palette.extra.length;   // 0..3 are its own inks

  victor.skeleton.chains.push(taken);

  // and the weapon, if the hand it came off was holding one
  if (role === 'arm' && victim.weapon && !hasSpoiledWeapon(rec)) {
    victor.weapon = clone(victim.weapon);
    rec.spoils.push(`${role}+weapon`);
    return `${role} and its weapon`;
  }
  rec.spoils.push(role);
  return role;
}

function hasSpoiledWeapon(rec: Record): boolean {
  return rec.spoils.some(s => s.endsWith('+weapon'));
}
