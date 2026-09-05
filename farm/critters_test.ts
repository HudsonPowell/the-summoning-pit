// The wildlife is decorative, so it needs a test for the same reason the
// motes do: nothing on screen will tell you the pit is quietly filling with
// rats, and a population that only grows is how a phone dies at 3am.
import assert from 'node:assert/strict';
import { Critters, Threat } from '../src/critters';
import { Capsule } from '../src/pose';

const finite = (c: Capsule) =>
  [c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r].every(Number.isFinite) && c.r > 0;
const empty: Threat[] = [];

// --- an hour alone in the pit -------------------------------------------------
{
  const c = new Critters();
  let peak = 0, everSeen = 0;
  for (let i = 0; i < 60 * 60 * 30; i++) {          // an hour at 30fps
    c.step(1 / 30, empty);
    peak = Math.max(peak, c.count);
    if (i % 900 === 0) everSeen = Math.max(everSeen, c.count);
  }
  assert.ok(peak > 0, 'something did wander in');
  assert.ok(peak <= 20, `an hour alone and the pit holds ${peak} — that is an infestation`);
  const caps: Capsule[] = [];
  c.caps(caps, 3600);
  assert.ok(caps.every(finite), 'every critter capsule is finite');
  console.log(`  an hour alone: at most ${peak} critters at once, ${caps.length} capsules now`);
}

// --- they keep out from under the feet ---------------------------------------
{
  const c = new Critters();
  const boot: Threat[] = [{ x: 0, z: 0, bulk: 1.6, deadT: -1 }];
  for (let i = 0; i < 60 * 30; i++) c.step(1 / 30, empty);   // let some arrive
  let closest = 1e9;
  for (let i = 0; i < 120 * 30; i++) {
    c.step(1 / 30, boot);
    for (const b of c.snapshot()) {
      if (b.kind === 'ant') continue;                 // ants are beneath notice
      closest = Math.min(closest, Math.hypot(b.x, b.z));
    }
  }
  assert.ok(closest > 0.25, `something walked right through a creature (${closest.toFixed(2)}m)`);
  console.log(`  nearest a rat or beetle came to a standing creature: ${closest.toFixed(2)}m`);
}

// --- a starved phone gets no wildlife -----------------------------------------
{
  const c = new Critters();
  c.budget = 0;
  for (let i = 0; i < 60 * 60 * 30; i++) c.step(1 / 30, empty);
  assert.equal(c.count, 0, 'ambience is the first thing to go');
}

// --- and violence clears the floor -------------------------------------------
{
  const c = new Critters();
  for (let i = 0; i < 200 * 30; i++) c.step(1 / 30, empty);
  const before = c.snapshot().filter(b => b.kind !== 'ant');
  c.scatter(0, 0, 1.5);
  const bolting = c.snapshot().filter(b => b.kind !== 'ant' && b.speed > 0);
  assert.ok(before.length === 0 || bolting.length > 0, 'a kill sends them running');
  console.log(`  a kill set ${bolting.length} of ${before.length} running`);
}

console.log('Critters: population bounded, feet avoided, budget obeyed, violence scatters them.');
