import { sanitiseGenome } from '../server/sanitise';
import { fitBudget } from '../src/budget';
import assert from 'node:assert/strict';
import { anatomyStudy, variationBrief } from '../src/diversity';
import { buildPrompt, validateGenome } from '../src/hatch';
import { defaultBiped } from '../src/genome';
import { validateWeapon, priceWeapon, weaponsFromWords } from '../src/smith';
import { solvePose } from '../src/pose';

const signatures = new Set<string>();
for (let seed = 1; seed <= 96; seed++) {
  const raw = anatomyStudy(seed);
  const g = validateGenome(raw, 'an invented creature');
  const roles = g.skeleton.chains.map(c => `${c.role}:${c.mirror === false ? 'single' : 'pair'}`).sort();
  signatures.add(`${g.skeleton.upright}:${g.skeleton.locomotion}:${g.skeleton.body.length}:${roles}`);
  const pose = solvePose(g, { tired: 0, angry: 0 }, 0.3, 1, 2);
  assert.ok(pose.length > 0 && pose.length < 250);
  assert.ok(pose.every(c => [c.a.x,c.a.y,c.a.z,c.b.x,c.b.y,c.b.z,c.r].every(Number.isFinite) && c.r > 0));
  for (const role of ['spike', 'tentacle'] as const) {
    const expected = raw.skeleton.chains.filter(c => c.role === role).length;
    assert.equal(g.skeleton.chains.filter(c => c.role === role).length, expected);
  }
}
assert.ok(signatures.size > 65, `${signatures.size} genuinely different topologies in 96 seeds`);
assert.equal(buildPrompt('a wizard', 42), buildPrompt('a wizard', 42));
assert.notEqual(variationBrief(42), variationBrief(43));
const many = anatomyStudy(9);
many.skeleton.chains = Array.from({ length: 4 }, (_, i) => ({ role: 'head', at: 0.7 + i * 0.1, seg: [0.1,0.1], r: 0.1, spread: 0.1 }));
assert.equal(validateGenome(many, 'a floating four-headed orb').skeleton.chains.filter(c => c.role === 'head').length, 4);
const broad = defaultBiped(); broad.skeleton.girth = [0.35];
assert.ok(Math.max(...validateGenome(broad, 'a broad squat wizard').skeleton.girth) > 0.25);

const bow = weaponsFromWords('a longbow').main!;
const cleanBow = validateWeapon(bow, 'longbow');
const extentY = (parts: typeof bow.parts) => Math.max(...parts.flatMap(p => [Math.abs(p.a[1]),Math.abs(p.b[1])]));
assert.ok(extentY(cleanBow.parts) > 0.3, 'bow limbs must not be flattened to the old quarter-metre clamp');
assert.ok(cleanBow.parts.some(p => p.r < 0.012), 'bow string stays fine');
const malformed = validateWeapon({ name: 'spear', parts: [
  { a:[0,0,0], b:[1,0,0], r:0.02, color:'#aaaaaa' },
  { a:[0,0.8,0.4], b:[0.1,0.8,0.4], r:0.02, color:'#aaaaaa' },
  { a:[NaN,0,0], b:[1,0,0], r:0.02 },
]}, 'spear');
assert.equal(malformed.parts.length, 1, 'floating and non-finite fragments are removed');
const big = { name: 'hammer', parts:[{ a:[0,0,0] as [number,number,number], b:[2,1,0] as [number,number,number], r:0.2, color:'#aaaaaa' }] };
const priced = priceWeapon(big);
assert.equal(priced.parts[0].b[0] / priced.parts[0].b[1], 2, 'budget keeps proportions');

for (const description of ['longbow','crossbow','sword','axe','staff','shield','spear']) {
  const equipment = weaponsFromWords(description);
  const g = defaultBiped(); delete g.weapon;
  const w = equipment.main ?? equipment.off!;
  const extras = equipment.main ? { weapon: w } : { offhand: w };
  for (let i = 0; i < 20; i++) {
    const caps = solvePose(g, { tired:0,angry:0 }, i/20, 1, i/10, undefined, 0, extras);
    const parts = caps.filter(c => c.part === 'weapon');
    assert.equal(parts.length, w.parts.length);
    assert.ok(parts.every(c => Math.min(c.a.y,c.b.y) - c.r > 0), `${description} clears the floor while carried`);
  }
}
console.log(`Diversity: ${signatures.size} body topologies across 96 seeds. Anatomy, weapon assembly, bow proportions and carrying checks passed.`);

for (let seed = 1; seed <= 96; seed++) {
  const g = validateGenome(anatomyStudy(seed), 'an invented creature');
  const clean = sanitiseGenome(g)!;
  assert.ok(clean);
  assert.equal(clean.skeleton.chains.length, g.skeleton.chains.length, 'server preserves topology');
  g.skeleton.chains.forEach((c, i) => {
    const output = clean.skeleton.chains[i];
    for (const key of ['side','yaw','taper'] as const) assert.equal(output[key], c[key]);
  });
}
const wide = anatomyStudy(20);
const fitted = fitBudget(wide, 0.001, 0.002);
assert.ok(Math.abs(fitted.skeleton.chains[0].spread / wide.skeleton.chains[0].spread - fitted.skeleton.body[0] / wide.skeleton.body[0]) < 1e-8);
console.log('Server round-trip preserves all anatomy fields; budget scaling preserves attachment positions.');

const trident = weaponsFromWords('trident').main!;
assert.equal(validateWeapon(trident, 'trident').parts.length, trident.parts.length, 'all three trident tines stay connected');

const thrower = defaultBiped(); thrower.weapon = weaponsFromWords('spear').main;
assert.equal(solvePose(thrower,{tired:0,angry:0},0,0,0,undefined,0,{weapon:undefined}).filter(c=>c.part==='weapon'||c.part==='blade').length,0,
  'explicitly absent thrown weapon must not fall back to the genome');
