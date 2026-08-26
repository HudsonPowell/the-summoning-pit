// What a creature is LIKE, read off what it is MADE of.
//
// A summoned thing has to have a character before anyone has watched it fight,
// and the honest place for that is its body: a horned, armed, heavy thing picks
// fights; a small unarmed one keeps its distance; long legs and a quick cadence
// make it fast. Nothing here reads the prompt — the words are the summoner's —
// but the hatcher may write explicit numbers onto the genome from those words
// before they are thrown away, and those win when present.

import { Genome, heightOf, effectiveGait } from './genome';

export interface Temper {
  aggression: number;  // 0 keeps to itself .. 1 starts things
  bravery: number;     // 0 bolts when hurt .. 1 dies where it stands
  speed: number;       // 0 lumbering .. 1 darting
}

const c01 = (v: number) => Math.min(1, Math.max(0.05, v));

/** Derived from the body, so it works for every genome ever saved. */
export function temperOf(g: Genome): Temper {
  if (g.temper) {
    return {
      aggression: c01(g.temper.aggression),
      bravery: c01(g.temper.bravery),
      speed: c01(g.temper.speed),
    };
  }
  const sk = g.skeleton;
  const n = (role: string) => sk.chains.filter(c => c.role === role).length;
  const h = heightOf(g);
  const eff = effectiveGait(g.gait, { tired: 0, angry: 0 });
  const fattest = Math.max(...sk.girth, 0.06);
  const legs = sk.chains.filter(c => c.role === 'leg');
  const legLen = legs.length
    ? Math.max(...legs.map(c => c.seg.reduce((x, y) => x + y, 0)))
    : 0;

  // things that make a creature start something: armament, horns, extra heads,
  // mass. A weapon in the hand is the loudest of them.
  const aggression = c01(
    0.24
    + (g.weapon ? 0.28 : 0)
    // a thing with no hands fights with its mouth, and does not hesitate
    + (n('arm') === 0 ? 0.16 : 0)
    + (n('leg') >= 2 ? 0.07 : 0)
    + n('horn') * 0.12
    + Math.max(0, n('head') - 1) * 0.16
    + (h - 1.0) * 0.16
    + (fattest - 0.11) * 1.1
    + n('arm') * 0.05,
  );

  // bravery is mass and armament again, but weighted toward sheer size —
  // small things run, and they are right to
  // nothing is completely without nerve — a floor keeps the pit from emptying
  const bravery = c01(0.16 + (h - 0.75) * 0.42 + (g.weapon ? 0.14 : 0) + n('leg') * 0.05);

  // speed is stride machinery: long legs, quick cadence, not much to carry
  const speed = c01(
    0.2
    + (legLen - 0.3) * 0.8
    + (eff.cadence - 0.8) * 0.45
    + (0.16 - fattest) * 1.6
    + (sk.locomotion === 'fly' ? 0.18 : 0),
  );

  return { aggression, bravery, speed };
}

/** Words nudge the numbers ONCE, at hatch, and are then discarded. */
export function temperFromWords(desc: string, base: Temper): Temper {
  const d = desc.toLowerCase();
  const bump = (re: RegExp, v: number) => (re.test(d) ? v : 0);
  return {
    aggression: c01(base.aggression
      + bump(/savage|feral|vicious|ferocious|bloodthirsty|rabid|enraged|furious|berserk|war|killer|hunting|predator/, 0.3)
      + bump(/gentle|docile|peaceful|placid|shy|meek|harmless|sleepy|tired|polite/, -0.32)),
    bravery: c01(base.bravery
      + bump(/fearless|brave|stubborn|relentless|unflinching|stoic|proud|guardian|defender|knight|champion/, 0.26)
      + bump(/timid|cowardly|skittish|nervous|frightened|craven|scurrying|fleeing/, -0.34)),
    speed: c01(base.speed
      + bump(/swift|quick|fast|darting|fleet|nimble|lithe|agile|whip-thin|scurrying|blink/, 0.28)
      + bump(/lumbering|slow|ponderous|ancient|heavy|hulking|plodding|shambling|giant|huge|massive/, -0.26)),
  };
}
