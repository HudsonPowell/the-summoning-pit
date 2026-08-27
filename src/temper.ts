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
  const h = heightOf({ skeleton: sk } as Genome);
  const eff = effectiveGait(g.gait, { tired: 0, angry: 0 });
  const fattest = Math.max(...sk.girth, 0.06);
  const legs = sk.chains.filter(c => c.role === 'leg');
  const legLen = legs.length
    ? Math.max(...legs.map(c => c.seg.reduce((x, y) => x + y, 0)))
    : 0;

  // Read the SHAPE, not the size.
  //
  // Height used to drive bravery directly, and mass is capped, so the winning
  // move was to be tall and thin — a 2.86m plank scored bravery 1.00 and speed
  // 1.00 while a properly proportioned dwarf scored 0.25 and 0.23. The worse
  // creature was the better fighter, which is exactly backwards: it rewards
  // ignoring the prompt.
  //
  // Everyone spends the same mass (src/budget.ts), so what matters is how it
  // is spent. Stocky holds its ground; leggy runs; armed starts things.
  const stocky = Math.max(0, Math.min(1, (fattest / Math.max(0.2, h)) * 4.2));
  const leggy = Math.max(0, Math.min(1, legLen / Math.max(0.25, h) * 1.5));

  const aggression = c01(
    0.2
    + (g.weapon ? 0.26 : 0)
    + (n('arm') === 0 ? 0.16 : 0)      // no hands: it fights with its mouth
    + n('horn') * 0.11
    + Math.max(0, n('head') - 1) * 0.15
    + stocky * 0.22,
  );

  // a thing built like a barrel does not run away; a thing built like a stick does
  const bravery = c01(0.14 + stocky * 0.62 + (g.weapon ? 0.12 : 0) + n('leg') * 0.04);

  // long legs for your size, and not much to carry
  const speed = c01(0.16 + leggy * 0.6 + (eff.cadence - 0.8) * 0.35 - stocky * 0.35
    + (sk.locomotion === 'fly' ? 0.16 : 0));

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
