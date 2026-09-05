// Getting out of the way. The rule that matters is that the ATTACK decides
// which evasion beats it, so every strike the model ever invents is covered
// without anyone writing it down.
import assert from 'node:assert/strict';
import * as C from '../src/character';
import { evadedBy, StrikeSpec } from '../src/character';

// --- the arc says how to answer it -------------------------------------------
{
  // a wide arc at head height goes over a crouch
  assert.equal(evadedBy(C.STRIKE_SWIPE), 'duck');
  // a wide arc at the shins goes under a leap
  assert.equal(evadedBy((C as any).STRIKE_LASH), 'jump');
  // and anything coming straight down or straight in has to be stepped away from
  assert.equal(evadedBy(C.STRIKE_SLAM), 'dodge');
  assert.equal(evadedBy(C.STRIKE_THRUST), 'dodge');
  console.log('  swipe ducks, lash jumps, slam and thrust are sidestepped');
}

// --- a feint is read from the SHOWN line, which is the point of a feint -------
{
  const honest: StrikeSpec = { ...C.STRIKE_SWIPE };
  const lie: StrikeSpec = { ...C.STRIKE_SWIPE, feintPosts: C.STRIKE_SLAM.posts };
  assert.equal(evadedBy(lie), evadedBy(honest),
    'a defender must commit to the line it was shown, not the one hidden behind it');
  // and once the feint turns, the blow classifies as what it really is
  const turned: StrikeSpec = { ...C.STRIKE_SWIPE, posts: C.STRIKE_SLAM.posts };
  assert.notEqual(evadedBy(turned), evadedBy(honest), 'so the feint beats the evasion');
  console.log('  a feint is read as its shown line, and beats the evasion when it turns');
}

// --- nothing the model composes can crash it ---------------------------------
{
  for (const junk of [{}, { posts: [] }, { posts: [[0, 0, 0]] },
    { posts: [[0, 0], [1, 1], [2, 2]] }, { posts: null }]) {
    const got = evadedBy(junk as any);
    assert.ok(['duck', 'jump', 'dodge'].includes(got), `malformed spec gave ${got}`);
  }
  console.log('  a malformed strike is something you step away from, not a crash');
}

// --- every authored strike classifies, and nothing is left undecided ----------
{
  let n = 0;
  for (const [name, spec] of Object.entries(C)) {
    if (!name.startsWith('STRIKE_')) continue;
    const s = spec as StrikeSpec;
    if (!s?.posts) continue;
    const e = evadedBy(s);
    assert.ok(['duck', 'jump', 'dodge'].includes(e), `${name} gave ${e}`);
    n++;
  }
  assert.ok(n >= 10, `only ${n} strikes classified`);
  console.log(`  all ${n} authored strikes classify`);
}

console.log('Evade: the blow decides the answer, feints beat it, malformed specs cannot crash it.');
