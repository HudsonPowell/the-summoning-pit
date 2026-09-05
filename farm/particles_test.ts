// The motes are decorative, which is exactly why they need a test: nothing
// on screen will tell you the pool has been leaking for an hour, and a
// particle system that quietly grows is how a phone dies mid-fight.
import assert from 'node:assert/strict';
import { Motes, muzzle, wake, impact, spatter, undoing, dust } from '../src/particles';
import { Capsule } from '../src/pose';

const col: [number, number, number] = [220, 120, 60];
const dark: [number, number, number] = [0, 0, 0];
const finite = (c: Capsule) =>
  [c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r].every(Number.isFinite) && c.r > 0;

// --- the pool is a ceiling, not a suggestion ---------------------------------
{
  const m = new Motes();
  for (let i = 0; i < 400; i++) {
    impact(m, 0, 0.5, 0, col, 0.06, 2.4);           // the most expensive thing there is
    m.step(1 / 60, i / 60);
  }
  assert.ok(m.count <= 340, `pool held at ${m.count}`);
  const caps: Capsule[] = [];
  m.caps(caps, dark, 3);
  assert.ok(caps.length <= m.count, 'never more capsules than motes');
  assert.ok(caps.every(finite), 'every capsule is finite and has a radius');
}

// --- and everything in it dies ------------------------------------------------
{
  const m = new Motes();
  impact(m, 0, 0.4, 0, col, 0.06, 2);
  muzzle(m, 1, 0.6, 0, 1, 0, col, 0.05);
  spatter(m, 0, 0.5, 1, 1, 0, col, 1);
  undoing(m, 2, 0.2, 2, col, 1.4);
  dust(m, 0, 3, 1.2, 1, [40, 44, 54]);
  assert.ok(m.count > 30, `a full pit of effects emitted ${m.count}`);
  // the scorch outlives everything else by design; ten seconds buries it too
  for (let i = 0; i < 10 * 60; i++) m.step(1 / 60, i / 60);
  assert.equal(m.count, 0, 'nothing outlives its own lifetime');
}

// --- the governor's dial actually turns ---------------------------------------
{
  const m = new Motes();
  m.budget = 0;
  impact(m, 0, 0.4, 0, col, 0.06, 2);
  assert.equal(m.count, 0, 'a starved pit draws no motes at all');
  m.budget = 0.5;
  impact(m, 0, 0.4, 0, col, 0.06, 2);
  const half = m.count;
  m.clear();
  m.budget = 1;
  impact(m, 0, 0.4, 0, col, 0.06, 2);
  assert.ok(half > 0 && half < m.count, `half budget gave ${half} of ${m.count}`);
}

// --- a fireball is louder than an arrow ---------------------------------------
{
  const plain = new Motes(), boom = new Motes();
  impact(plain, 0, 0.3, 0, col, 0.05, 0);
  impact(boom, 0, 0.3, 0, col, 0.05, 2.4);
  assert.ok(boom.count > plain.count * 2, `${boom.count} vs ${plain.count}`);
}

// --- the step holds still: no hidden randomness between frames ----------------
{
  const run = () => {
    const m = new Motes();
    impact(m, 0, 0.4, 0, col, 0.06, 2);
    for (let i = 0; i < 40; i++) m.step(1 / 60, i / 60);
    const caps: Capsule[] = [];
    m.caps(caps, dark, 1);
    return caps.map(c => `${c.a.x.toFixed(6)},${c.b.y.toFixed(6)},${c.r.toFixed(6)}`).join('|');
  };
  assert.equal(run(), run(), 'the same burst plays the same way twice');
}

// --- nothing survives a slow frame or a stopped one ---------------------------
{
  const m = new Motes();
  impact(m, 0, 0.4, 0, col, 0.06, 2);
  m.step(0, 0);
  m.step(2.5, 1);            // a tab that was asleep
  const caps: Capsule[] = [];
  m.caps(caps, dark, 1);
  assert.ok(caps.every(finite), 'a two-second frame does not blow the pool up');
}

// --- a shot's wake tells a bolt from a spell ----------------------------------
{
  const bolt = new Motes(), spell = new Motes();
  for (let i = 0; i < 30; i++) {
    wake(bolt, i * 0.5, 1, 0, 22, 0, 0, col, 0.05, 1 / 60);   // fast and flat
    wake(spell, i * 0.1, 1, 0, 4, 0, 0, col, 0.12, 1 / 60);   // slow and fat
  }
  assert.ok(bolt.count > 0 && spell.count > 0, 'both leave something behind');
}

console.log('Motes: pool bounded, lifetimes end, budget scales, boom outweighs arrow, step is deterministic.');
