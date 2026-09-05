// The weather is a pure function of the pit's clock, which is the whole point:
// if it ever stops being one, two screens watching the same fight get
// different wind and the cloaks stop agreeing.
import assert from 'node:assert/strict';
import { conditionsAt, rainCaps } from '../src/conditions';

// --- the same moment is the same weather, always ------------------------------
{
  for (const t of [0, 12.5, 903.25, 48211.7]) {
    const a = conditionsAt(t), b = conditionsAt(t);
    assert.deepEqual(a, b, 'conditions must depend on nothing but the clock');
  }
}

// --- and it stays inside its banks over a week --------------------------------
{
  let minLight = 1, maxLight = 0, maxWind = 0, wet = 0, n = 0;
  for (let t = 0; t < 7 * 24 * 3600; t += 11) {
    const c = conditionsAt(t); n++;
    assert.ok([c.windX, c.windZ, c.light, c.rain, c.gust, c.hour].every(Number.isFinite), `non-finite at t=${t}`);
    assert.ok(c.rain >= 0 && c.rain <= 1, `rain out of range at t=${t}`);
    assert.ok(c.hour >= 0 && c.hour < 1, `hour out of range at t=${t}`);
    minLight = Math.min(minLight, c.light); maxLight = Math.max(maxLight, c.light);
    maxWind = Math.max(maxWind, Math.hypot(c.windX, c.windZ));
    if (c.rain > 0.05) wet++;
  }
  assert.ok(minLight > 0.22, `night must stay legible, got ${minLight.toFixed(2)}`);
  assert.ok(maxLight > 0.9, 'and noon must actually be bright');
  assert.ok(maxWind < 4, `a gale is one thing, ${maxWind.toFixed(1)}m/s is another`);
  const wetPct = 100 * wet / n;
  assert.ok(wetPct > 2 && wetPct < 55, `it rains ${wetPct.toFixed(0)}% of the time, which is wrong either way`);
  console.log(`  a week: light ${minLight.toFixed(2)}–${maxLight.toFixed(2)}, wind to ${maxWind.toFixed(1)}m/s, wet ${wetPct.toFixed(0)}% of the time`);
}

// --- rain is bounded, finite, and free when it is dry -------------------------
{
  const dry: any[] = [];
  rainCaps(dry, 100, { ...conditionsAt(100), rain: 0 }, 0, 0, 1);
  assert.equal(dry.length, 0, 'a dry pit draws no rain at all');

  let worst = 0;
  for (let t = 0; t < 400; t += 7) {
    const caps: any[] = [];
    rainCaps(caps, t, { ...conditionsAt(t), rain: 1 }, 0, 0, 1);
    worst = Math.max(worst, caps.length);
    assert.ok(caps.every(c => [c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.r].every(Number.isFinite) && c.r > 0),
      'every drop is finite');
    assert.ok(caps.every(c => c.b.y >= -0.01 && c.a.y <= 6.4), 'and stays between the sky and the floor');
  }
  assert.ok(worst <= 150, `a downpour costs ${worst} capsules`);

  const starved: any[] = [];
  rainCaps(starved, 100, { ...conditionsAt(100), rain: 1 }, 0, 0, 0.2);
  assert.ok(starved.length < worst / 3, 'a struggling phone gets less weather, not more');
  console.log(`  downpour costs ${worst} capsules, ${starved.length} on a starved phone`);
}

console.log('Conditions: one clock, same weather everywhere, night legible, rain bounded.');
