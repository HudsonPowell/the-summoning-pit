// Worn gear is the one layer that must obey two opposite rules at once: a
// helmet has to be welded to the skull, and a cloak has to refuse to be.
import assert from 'node:assert/strict';
import { gearFromWords, CLOAK, HELM, GearPiece, Anchor } from '../src/gear';
import { defaultBiped } from '../src/genome';
import { solvePose, Capsule } from '../src/pose';

const g = defaultBiped();
const wear = (gear: GearPiece[], mv: number, turn = 0) =>
  solvePose(g, { tired: 0, angry: 0 }, 0.25, mv, 2, undefined, 0, { gear, turn })
    .filter(c => c.part === 'gear');
const spread = (a: Capsule[], b: Capsule[]) =>
  Math.max(...a.map((c, i) => Math.hypot(c.b.x - b[i].b.x, c.b.y - b[i].b.y, c.b.z - b[i].b.z)));

// ISOLATE THE CLOTH. Rigid gear still MOVES — a helmet rides a skull, and
// the skull bobs, breathes and leans. So the honest comparison holds the body
// in exactly one state and varies only whether the piece is cloth.
const stiffen = (p: GearPiece): GearPiece => ({ ...p, drape: 0 });
const clothGap = (p: GearPiece, mv: number, turn = 0) =>
  spread(wear([stiffen(p)], mv, turn), wear([p], mv, turn));

// --- a helmet is not cloth, whatever the body is doing ------------------------
{
  assert.equal(clothGap(HELM, 1, 3.2), 0, 'a helm has no cloth in it and must not gain any');
  const still = wear([HELM], 0), running = wear([HELM], 1);
  assert.ok(spread(still, running) > 0, 'but it does ride the head, which moves');
  console.log(`  helm: 0m of cloth, ${spread(still, running).toFixed(2)}m of skull`);
}

// --- and a cloak is nothing but ----------------------------------------------
{
  const hanging = clothGap(CLOAK, 0);
  const streaming = clothGap(CLOAK, 1);
  const swinging = clothGap(CLOAK, 1, 3.2);
  assert.ok(streaming > hanging * 3, `a cloak must stream at a run (${streaming.toFixed(3)}m vs ${hanging.toFixed(3)}m hanging)`);
  assert.ok(swinging > streaming, 'and go wider still into a hard turn');
  assert.ok(hanging < 0.06, 'while a standing creature keeps its cloak decently still');
  console.log(`  cloak: ${hanging.toFixed(2)}m standing, ${streaming.toFixed(2)}m running, ${swinging.toFixed(2)}m turning`);
}

// --- pinned at the top, free at the hem ---------------------------------------
{
  const stiff = wear([stiffen(CLOAK)], 1), cloth = wear([CLOAK], 1);
  let top = 0, bottom = 0;
  stiff.forEach((c, i) => {
    if (c.b.y > stiff[top].b.y) top = i;
    if (c.b.y < stiff[bottom].b.y) bottom = i;
  });
  const moved = (i: number) => Math.hypot(
    stiff[i].b.x - cloth[i].b.x, stiff[i].b.y - cloth[i].b.y, stiff[i].b.z - cloth[i].b.z);
  assert.ok(moved(bottom) > moved(top) * 2,
    `the hem must outswing the yoke (hem ${moved(bottom).toFixed(3)} vs yoke ${moved(top).toFixed(3)})`);
  console.log(`  pinned properly: hem swings ${moved(bottom).toFixed(2)}m, yoke ${moved(top).toFixed(2)}m`);
}

// --- nothing ever comes out non-finite ----------------------------------------
for (const desc of ['a knight in full plate', 'a hooded assassin in a cloak',
  'an old wizard in robes and a pointed hat', 'a fur-mantled chieftain', 'a tattered zombie in rags']) {
  const gear = gearFromWords(desc);
  assert.ok(gear.length, `${desc} wears nothing at all`);
  for (const mv of [0, 0.5, 1]) {
    const caps = wear(gear, mv, 2);
    assert.ok(caps.every(c => [c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r].every(Number.isFinite) && c.r > 0),
      `${desc} produced a broken capsule at move ${mv}`);
  }
  // one layer per socket, or a creature wears two helmets
  const seen = new Set<Anchor>();
  for (const p of gear) {
    if (p.at === 'shoulder') continue;
    assert.ok(!seen.has(p.at), `${desc} wears two things at ${p.at}`);
    seen.add(p.at);
  }
}

// --- a knight is dressed like a knight ----------------------------------------
{
  const knight = gearFromWords('a knight in full plate with a longsword').map(p => p.at);
  for (const socket of ['head', 'shoulder', 'torso', 'hip', 'leg'] as Anchor[]) {
    assert.ok(knight.includes(socket), `full plate should cover the ${socket}`);
  }
  console.log(`  a knight in full plate covers ${knight.length} sockets`);
}

console.log('Gear: rigid stays rigid, cloth streams and swings, hems outswing yokes, sockets stay single.');

// --- scars are earned, placed by name, and never wander -----------------------
{
  const bare = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1, undefined, 0, {});
  const marked = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1, undefined, 0, { scars: 5 });
  const scars = marked.filter(c => c.part === 'scar');
  assert.equal(bare.filter(c => c.part === 'scar').length, 0, 'an unhurt creature carries none');
  assert.equal(scars.length, 5, 'and a veteran carries one per wound');
  assert.ok(scars.every(c => [c.a.x, c.a.y, c.a.z, c.r].every(Number.isFinite) && c.r > 0), 'all finite');

  // the same creature must scar identically on every screen, forever
  const again = solvePose(g, { tired: 0, angry: 0 }, 0.9, 1, 7, undefined, 0, { scars: 5 })
    .filter(c => c.part === 'scar');
  assert.equal(scars.length, again.length, 'the same count in any pose');
  // and an older wound never moves when a newer one is taken
  const fewer = solvePose(g, { tired: 0, angry: 0 }, 0.2, 0, 1, undefined, 0, { scars: 2 })
    .filter(c => c.part === 'scar');
  fewer.forEach((c, i) => assert.deepEqual(c.a, scars[i].a, 'old scars stay where they were'));
  console.log(`  scars: ${scars.length} placed by name, and the first ${fewer.length} never move`);
}
