// Do ranged attacks actually happen, and do archers keep their distance?
import { makeCharacter, styleFor } from '../src/character';
import { defaultBiped, hound } from '../src/genome';
import { createVoid, stepVoid, makeAgent, rangedOf, preferredRange } from '../src/void/sim';

const archerG = defaultBiped();
archerG.name = 'archer';
archerG.weapon = { length: 0.75, r: 0.026, color: '#8a6d3f' };
const archer = makeCharacter(archerG, 'hero');
archer.weapon = { name: 'longbow', parts: [
  { a: [0, -0.3, 0], b: [0, 0.3, 0], r: 0.02, color: '#8a6d3f' },
] };
// styleFor keys off the weapon name, so rebuild the behaviours from it
Object.assign(archer.behaviors, {
  'attack-light': { type: 'strike', strike: styleFor('longbow', true, false).light },
  'attack-heavy': { type: 'strike', strike: styleFor('longbow', true, false).heavy },
});

const brute = makeCharacter(hound(), 'beast');

const sim = createVoid([archer, brute], 0);
sim.peace = 0;
const a = makeAgent(archer, -3.5, 0);
const b = makeAgent(brute, 3.5, 0);
sim.agents.push(a, b);

console.log('archer ranged?', !!rangedOf(a), ' prefers', preferredRange(a).toFixed(1), 'm');
console.log('hound  ranged?', !!rangedOf(b), ' prefers', preferredRange(b).toFixed(1), 'm');

let loosed = 0, impacts = 0, maxShots = 0, bites = 0;
for (let i = 0; i < 60 * 25; i++) {
  stepVoid(sim, 1 / 60);
  for (const e of sim.events) {
    if (e.kind === 'loose') loosed++;
    if (e.kind === 'hit' && (e.how === 'bolt' || e.how === 'spell')) impacts++;
    if (e.kind === 'strike' && e.actor?.id === b.id) bites++;
  }
  maxShots = Math.max(maxShots, sim.shots.length);
}
console.log(`over 25s: ${loosed} shots loosed, ${impacts} landed, ${maxShots} in flight at once, ${bites} bites`);
console.log('survivors:', sim.agents.filter(x => x.deadT < 0).map(x => `${x.ch.name} hp${x.hp}`).join(', ') || 'none');
process.exit(loosed > 0 ? 0 : 1);
