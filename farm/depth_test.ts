// The new depth, proven in numbers: fireballs go off, sparks fly, a thrown
// spear sticks in the floor and its owner walks back to reclaim it.
import { makeCharacter, styleFor } from '../src/character';
import { defaultBiped, hound } from '../src/genome';
import { createVoid, stepVoid, makeAgent, rangedOf } from '../src/void/sim';

function armed(name: string, weapon: string) {
  const g = defaultBiped();
  g.name = name;
  const ch = makeCharacter(g, 'hero');
  ch.weapon = { name: weapon, parts: [{ a: [0, 0, 0], b: [0.6, 0, 0], r: 0.02, color: '#8a6d3f' }] };
  Object.assign(ch.behaviors, {
    'attack-light': { type: 'strike', strike: styleFor(weapon, true, false).light },
    'attack-heavy': { type: 'strike', strike: styleFor(weapon, true, false).heavy },
  });
  return ch;
}

// --- 1: the wizard's fireball ------------------------------------------------
{
  const wizard = armed('wizard', 'staff');
  const target = makeCharacter(hound(), 'beast');
  const sim = createVoid([wizard, target], 0);
  sim.peace = 0;
  const w = makeAgent(wizard, -3.5, 0);
  const t = makeAgent(target, 3.5, 0);
  // skip the arrival grace so the fight starts at once
  w.deeds.born = -60; t.deeds.born = -60;
  sim.agents.push(w, t);
  let booms = 0, sparks = 0, colors = new Set<string>();
  for (let f = 0; f < 60 * 30; f++) {
    stepVoid(sim, 1 / 60);
    for (const s of sim.shots) {
      colors.add(s.spec.color);
      if (s.spec.spark) sparks++;
      if (s.spec.boom) booms++;
    }
  }
  console.log(`wizard: boom-frames=${booms > 0} spark-frames=${sparks > 0} shot colours=${[...colors].join(',')}`);
}

// --- 2: the thrower's spear, out and back ------------------------------------
{
  const thrower = armed('thrower', 'javelin');
  const prey = makeCharacter(hound(), 'beast');
  const sim = createVoid([thrower, prey], 0);
  sim.peace = 0;
  const a = makeAgent(thrower, -3.5, 0);
  const b = makeAgent(prey, 3.5, 0);
  a.deeds.born = -60; b.deeds.born = -60;
  sim.agents.push(a, b);
  let stuck = false, meleeWhileOut = false, reclaimed = false, relicSeen = false;
  for (let f = 0; f < 60 * 60; f++) {
    stepVoid(sim, 1 / 60);
    if (a.thrownRelic != null) {
      stuck = true;
      if (sim.relics.some(r => r.id === a.thrownRelic)) relicSeen = true;
      if (!rangedOf(a)) meleeWhileOut = true;
    } else if (stuck && a.deadT < 0) {
      reclaimed = true;
      break;
    }
  }
  console.log(`thrower: threw=${stuck} spearOnFloor=${relicSeen} meleeWhileOut=${meleeWhileOut} reclaimed=${reclaimed} alive=${a.deadT < 0}`);
}

// --- 3: the exchange — strike, block, riposte --------------------------------
{
  const knightA = armed('knightA', 'sword');
  knightA.offhand = { name: 'shield', parts: [{ a: [0.04, -0.26, 0], b: [0.04, 0.26, 0], r: 0.1, color: '#6b7280' }] };
  const knightB = armed('knightB', 'axe');
  const sim = createVoid([knightA, knightB], 0);
  sim.peace = 0;
  const a = makeAgent(knightA, -2, 0);
  const b = makeAgent(knightB, 2, 0);
  a.deeds.born = -60; b.deeds.born = -60;
  sim.agents.push(a, b);
  let blocked = 0, parried = 0, guards = 0, staggers = 0, ripostes = 0, plainHits = 0;
  let prevRipA = 0, prevRipB = 0;
  for (let f = 0; f < 60 * 90; f++) {
    stepVoid(sim, 1 / 60);
    for (const e of sim.events) {
      if (e.kind !== 'hit') continue;
      if (e.how === 'blocked') blocked++;
      else if (e.how === 'parried') parried++;
      else plainHits++;
    }
    if (a.guardT > 0 || b.guardT > 0) guards++;
    if (a.staggerT > 0 || b.staggerT > 0) staggers++;
    if ((prevRipA > 0 && a.riposteT === 0 && a.strikeT >= 0) || (prevRipB > 0 && b.riposteT === 0 && b.strikeT >= 0)) ripostes++;
    prevRipA = a.riposteT; prevRipB = b.riposteT;
    if (a.deadT >= 0 || b.deadT >= 0) break;
  }
  console.log(`exchange: hits=${plainHits} blocked=${blocked} parried=${parried} guard-frames=${guards} stagger-frames=${staggers} ripostes~=${ripostes}`);
}
