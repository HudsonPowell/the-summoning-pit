import assert from 'node:assert/strict';
import { defaultBiped, spider, serpent, drifter, PRESETS, effectiveGait } from '../src/genome';
import { makeCharacter } from '../src/character';
import { landingWeight, motionOf, hopHeight, livingMotion, smoothNoise, swingVariation } from '../src/motion';
import { solvePose } from '../src/pose';
import { newSecondary, stepSecondary } from '../src/secondary';
import { createVoid, makeAgent, stepVoid } from '../src/void/sim';

const mood = { tired: 0, angry: 0 };
for (const genome of [defaultBiped(), spider()]) {
  for (const direction of [1, -1]) {
    let energy = 0, events = 0;
    for (let i = 1; i <= 1000; i++) {
      const phase = ((0.123 + direction * i / 1000) % 1 + 1) % 1;
      const weight = landingWeight(genome, genome.gait, phase, direction / 1000);
      energy += weight;
      if (weight) events++;
    }
    assert.ok(Math.abs(energy - 2) < 1e-6, `${genome.name}: correct contact energy in direction ${direction}`);
    if (genome.skeleton.chains.filter(c => c.role === 'leg').length > 2) assert.ok(events > 2);
    console.log(`${genome.name}: ${events} real landings, ${energy.toFixed(2)} total weight, direction ${direction}`);
  }
}
for (const genome of [serpent(), drifter()]) {
  assert.equal(landingWeight(genome, genome.gait, 0.01, 0.02), 0);
}
assert.deepEqual(motionOf(defaultBiped()), motionOf(structuredClone(defaultBiped())));
assert.notDeepEqual(motionOf(defaultBiped()), motionOf({ ...defaultBiped(), name: 'another individual' }));

const hopper = defaultBiped();
hopper.skeleton.locomotion = 'hop';
const airbornePhase = (1 + hopper.gait.stance) / 2;
const feet = solvePose(hopper, mood, airbornePhase, 1, 0, undefined, 0, { variation: 0 }).filter(c => c.part === 'foot');
assert.ok(feet.every(c => c.a.y > 0.1), 'all feet leave the floor together');
assert.ok(feet.every(c => Math.abs(c.a.y - (0.06 + hopHeight(airbornePhase, hopper.gait))) < 1e-8));
assert.ok(solvePose(hopper, mood, 0.1).filter(c => c.part === 'foot').every(c => c.a.y === 0.06));
const unpaired = defaultBiped();
unpaired.skeleton.chains.filter(c => c.role === 'leg').forEach(c => c.mirror = false);
assert.equal(solvePose(unpaired, mood, 0).filter(c => c.part === 'foot').length, 1);

for (const genome of [...Object.values(PRESETS).map(make => make()), hopper]) {
  const s = newSecondary();
  for (let i = 0; i < 360; i++) {
    const phase = (i / 60) % 1;
    stepSecondary(s, i === 90 ? 0.2 : 1 / 60, {
      turnRate: Math.sin(i / 30) * 3, move: i < 240 ? 1 : 0, speed: i < 240 ? 1.5 : 0,
      mass: 1.2, lookYaw: 0.3, phase, phaseDelta: 1 / 60, dead: false, genome,
      gait: effectiveGait(genome.gait, mood),
    });
    const caps = solvePose(genome, mood, phase, i < 240 ? 1 : 0, i / 60, undefined, 0, s);
    assert.ok(caps.every(c => [c.a.x,c.a.y,c.a.z,c.b.x,c.b.y,c.b.z,c.r].every(Number.isFinite)));
    assert.ok([s.lean,s.twist,s.bob,s.jiggle,s.head].every(v => Math.abs(v) < 1));
  }
  assert.ok(solvePose(genome, mood, 0.4, 0, 6).filter(c => c.part === 'foot').every(c => Math.abs(c.a.y - 0.06) < 1e-8));
}
console.log('All body plans stay finite, grounded at rest, and springs survive a slow frame.');

const sim = createVoid([], 0);
sim.props = []; sim.flora = []; sim.peace = 1;
const a = makeAgent(makeCharacter(defaultBiped(), 'hero'), 0, 0);
a.phase = 0; a.heading = a.aim = a.lookAt = 0; a.stateT = -100; a.scanT = 100;
sim.agents.push(a);
stepVoid(sim, 1 / 60);
assert.ok(a.vx > 0 && a.vx < a.speed * 0.2, 'accelerates into first step');
for (let i = 0; i < 60; i++) stepVoid(sim, 1 / 60);
a.state = 'think'; a.stateT = -100;
const beforeStop = a.x, beforeSpeed = a.vx;
stepVoid(sim, 1 / 60);
assert.ok(a.x > beforeStop && a.vx < beforeSpeed, 'brakes instead of instantly freezing');
for (let i = 0; i < 180; i++) stepVoid(sim, 1 / 60);
assert.ok(Math.abs(a.vx) < 0.001, 'settles to a stop');
console.log('Start, braking and rest verified. All motion checks passed.');


// Variation must evolve, repeat deterministically on replay, and stay smooth.
const walker = defaultBiped();
assert.deepEqual(livingMotion(walker, 8).pace, livingMotion(structuredClone(walker), 8).pace);
const lifts: number[] = [];
for (let t = 0; t < 30; t += 0.17) {
  const life = livingMotion(walker, t);
  assert.ok(life.pace >= 0.825 && life.pace <= 1.175);
  const foot = solvePose(walker, mood, 0.8, 1, t).find(c => c.part === 'foot')!;
  lifts.push(foot.a.y);
}
assert.ok(Math.max(...lifts) - Math.min(...lifts) > 0.025, 'successive swings visibly vary in clearance');
for (let cell = -10; cell < 30; cell++) {
  assert.ok(Math.abs(smoothNoise(cell - 1e-5, 123) - smoothNoise(cell + 1e-5, 123)) < 1e-7);
}
for (const genome of Object.values(PRESETS).map(make => make())) {
  const first = solvePose(genome, mood, 0.05, 1, 0).filter(c => c.part === 'foot');
  for (const time of [0.1, 0.7, 2.2, 6, 19]) {
    const next = solvePose(genome, mood, 0.05, 1, time).filter(c => c.part === 'foot');
    first.forEach((foot, index) => {
      if (foot.a.y !== 0.06) return;
      assert.ok(Math.hypot(foot.a.x - next[index].a.x, foot.a.z - next[index].a.z) < 1e-8,
        `${genome.name}: variation does not move planted feet`);
    });
  }
}
for (const boundary of [walker.gait.stance, 1]) {
  for (const timing of [-1.5, 1.5]) {
    const a = swingVariation(boundary - 1e-7, walker.gait, timing, 1);
    const b = swingVariation(boundary, walker.gait, timing, 1);
    assert.ok(Math.abs(a.phase - b.phase) < 1e-6, 'continuous takeoff and landing');
  }
}
console.log('Non-repeating swing clearance, smooth timing and stable stance contacts verified.');

// Curved limbs keep the hands and stance feet connected through a full cycle.
for (const genome of [defaultBiped(), spider()]) {
  for (let phase = 0; phase < 1; phase += 1 / 60) {
    const rigid = solvePose(genome, mood, phase, 1, 2, undefined, 0, { hose: 0 });
    const soft = solvePose(genome, mood, phase, 1, 2, undefined, 0, { hose: 1 });
    const rigidFeet = rigid.filter(c => c.part === 'foot');
    const softFeet = soft.filter(c => c.part === 'foot');
    assert.deepEqual(softFeet, rigidFeet, 'body deformation must not move the foot targets');
    const thighs = soft.filter(c => c.part === 'thigh');
    const shins = soft.filter(c => c.part === 'shin');
    assert.equal(thighs.length, rigidFeet.length * 3);
    for (let leg = 0; leg < rigidFeet.length; leg++) {
      const segments = [...thighs.slice(leg * 3, leg * 3 + 3), ...shins.slice(leg * 3, leg * 3 + 3)];
      segments.slice(1).forEach((segment, i) => assert.deepEqual(segment.a, segments[i].b));
      assert.deepEqual(segments[5].b, softFeet[leg].a);
      assert.ok(segments.every(c => c.r > 0 && Number.isFinite(c.r)));
    }
    const hands = soft.filter(c => c.part === 'hand');
    const forearms = soft.filter(c => c.part === 'forearm');
    hands.forEach((hand, i) => assert.deepEqual(hand.a, forearms[i * 3 + 2].b));
    assert.ok(soft.length < rigid.length * 3, 'subdivision cost stays bounded');
  }
}
console.log('Rubber-hose limbs remain continuous, attached, and preserve every foot target.');
