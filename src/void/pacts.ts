// A link does not let you in. Everyone is already in — one pit, no rooms, no
// names. What a link does is change how your creatures FEEL about someone
// else's, and that is the only trace it leaves.
//
// Deliberately one-way. You declare; they need not reciprocate, and nothing
// tells you whether they have. Your beasts spare theirs while theirs may still
// be hunting you, and the only way to find out is to message the person and
// ask. That asymmetry is the point — the game will not tell you who just
// killed you, and it will not tell them you spared their life.
//
// Deliberately not transitive. A pacting B and B pacting C leaves A and C
// strangers, so the pit fills with a web rather than two blocs.

export type Stance = 'ally' | 'feud' | 'none';

export interface Pacts {
  /** declarer -> subject -> stance. One-way, always. */
  by: Map<string, Map<string, Stance>>;
}

export function newPacts(): Pacts {
  return { by: new Map() };
}

export function declare(p: Pacts, from: string, to: string, stance: Stance): void {
  if (from === to) return;
  let row = p.by.get(from);
  if (!row) { row = new Map(); p.by.set(from, row); }
  if (stance === 'none') row.delete(to); else row.set(to, stance);
}

/** How A's creatures regard B's. Says nothing about how B's regard A's. */
export function stanceOf(p: Pacts, from?: string, to?: string): Stance {
  if (!from || !to) return 'none';
  if (from === to) return 'ally';   // your own never turn on each other
  return p.by.get(from)?.get(to) ?? 'none';
}
