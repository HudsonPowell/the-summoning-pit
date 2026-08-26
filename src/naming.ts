// A creature is named by what it IS, never by what was typed to summon it.
//
// The prompt is the summoner's business and nobody else's: it is not stored on
// the genome, not written into a filename, and never crosses the wire. So the
// name is built from the body — a hash of the skeleton's own numbers picks the
// syllables, which makes it stable for a given creature and impossible to read
// backwards into the words that made it. Two identical bodies share a name;
// that is a feature, they are the same beast.

import { Genome, Skeleton, heightOf } from './genome';

const ONSET = ['v', 'k', 'gr', 'th', 'm', 'sk', 'br', 'z', 'dr', 'n', 'kh', 'sh',
  'tr', 'g', 'r', 'vh', 'b', 'st', 'ch', 'l'];
const NUCLEUS = ['a', 'o', 'u', 'e', 'i', 'aa', 'ae', 'ou', 'ia', 'y'];
const CODA = ['rn', 'kh', 'th', 'sh', 'l', 'm', 'ng', 'r', 'k', 'x', 'd', 'ss',
  'gg', 'n', 'z', 'ch'];

/** Any change to the body is a different name. Text never touches this. */
function hashSkeleton(sk: Skeleton): number {
  let h = 2166136261 >>> 0;
  const eat = (n: number) => {
    h ^= Math.round(n * 1000) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  eat(sk.body.length); sk.body.forEach(eat);
  eat(sk.girth.length); sk.girth.forEach(eat);
  eat(sk.locomotion.length);
  eat(sk.upright ? 3 : 7);
  for (const c of sk.chains) {
    eat(c.role.length * 11); eat(c.at); eat(c.r); eat(c.spread);
    c.seg.forEach(eat);
  }
  return h >>> 0;
}

/** What the body plan earns it. One epithet, the loudest thing about it. */
export function epithetFor(sk: Skeleton): string {
  const n = (role: string) => sk.chains.filter(c => c.role === role).length;
  const heads = n('head'), legs = n('leg'), wings = n('wing'), arms = n('arm');
  const h = heightOf({ skeleton: sk } as Genome);
  const span = sk.body.reduce((a, b) => a + b, 0);

  if (heads > 1) return 'the Twin-Skulled';
  if (wings && sk.locomotion === 'fly') return 'the Winged';
  if (sk.locomotion === 'slither') return 'the Coiled';
  if (legs >= 5) return 'the Many-Legged';
  if (arms >= 3) return 'the Four-Armed';
  if (n('horn')) return 'the Horned';
  if (n('fin')) return 'the Finned';
  if (wings) return 'the Winged';
  const fattest = Math.max(...sk.girth);
  if (h > 1.7) return 'the Tall';
  if (span > 1.2) return 'the Long';
  if (h < 0.6) return 'the Small';
  if (fattest > 0.16) return 'the Broad';
  if (fattest < 0.075) return 'the Lean';
  if (n('tail')) return 'the Tailed';
  return sk.upright ? 'the Standing' : 'the Low';
}

/** Two or three syllables, drawn from the body's own numbers. */
export function nameFor(sk: Skeleton): string {
  let s = hashSkeleton(sk);
  const next = (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % n;
  };
  const syllables = 2 + (next(10) < 2 ? 1 : 0);
  let out = '';
  for (let i = 0; i < syllables; i++) {
    out += ONSET[next(ONSET.length)] + NUCLEUS[next(NUCLEUS.length)];
    // a coda on every syllable clots the name — one at the end, rarely inside
    if (i === syllables - 1 || next(10) < 2) out += CODA[next(CODA.length)];
  }
  return out[0].toUpperCase() + out.slice(1);
}

/** The name a creature carries: "Vorrakh the Twin-Skulled". */
export function titleFor(sk: Skeleton): string {
  return `${nameFor(sk)} ${epithetFor(sk)}`;
}

/** Safe on disk: no text from the summoner reaches a filename either. */
export function fileNameFor(g: Genome): string {
  return nameFor(g.skeleton).toLowerCase() + '-' + epithetFor(g.skeleton)
    .replace(/^the /, '').toLowerCase().replace(/[^a-z]+/g, '');
}
