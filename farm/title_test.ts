// The fight goes through the word.
//
// The word hangs 4.6m nearer the camera than the floor the creatures fight on,
// so a blow can never literally touch it — it can only CROSS it on screen. The
// claim the whole effect rests on is therefore a projection claim: a blade that
// looks like it went through the O went through the O. That is not a matter of
// taste and it is not something to eyeball on a ten-second title screen, so it
// is checked here in numbers.
import { WireTitle } from '../src/void/wiretitle';
import { rotX, rotY, v3 } from '../src/vec';

let bad = 0;
const ok = (name: string, pass: boolean, saw = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}${saw ? ` — ${saw}` : ''}`);
  if (!pass) bad++;
};

const CAM = { yaw: 0.55, pitch: 0.34, cx: 0, cz: 0 };

/** The renderer's own transform, so the test cannot agree with a private bug. */
const screen = (p: { x: number; y: number; z: number }) => {
  const v = rotX(rotY(v3(p.x - CAM.cx, p.y, p.z - CAM.cz), CAM.yaw), CAM.pitch);
  return { x: v.x, y: v.y };
};

/** A word, stood up and held: strikes only land once it has finished arriving. */
function standing(): WireTitle {
  const w = new WireTitle('the summoning pit', 12);
  for (let i = 0; i < 44; i++) w.caps(0.1, CAM.yaw);   // past ARRIVE, into the hold
  return w;
}

console.log('\nthe fight goes through the word');

// --- 1: a blow lands where it appears to land --------------------------------
{
  const w = standing();
  let worst = 0, hits = 0;
  // sweep the pit floor: where a creature actually stands and swings
  for (let x = -3; x <= 3; x += 1.5) {
    for (let z = -3; z <= 3; z += 1.5) {
      for (const y of [0.6, 1.2, 1.9]) {
        const p = { x, y, z };
        // a degenerate segment, so every sample is the one point under test
        const hit = w.strike(CAM, p.x, p.y, p.z, p.x, p.y, p.z, 0.3, 0.0001);
        if (!hit) continue;
        hits++;
        const a = screen(p), b = screen(hit);
        worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
  }
  ok('the pit floor reaches the word at all', hits > 8, `${hits} points landed on letters`);
  ok('a blow lands on the pixel it appears to land on', worst < 1e-6,
     `worst miss ${(worst * 1000).toFixed(4)} mm on screen`);
}

// --- 2: hitting it takes it apart, and only where it was hit -----------------
{
  const w = standing();
  const before = w.caps(0.016, CAM.yaw).length;
  // twelve blows through one place, as a fight in front of one letter would be
  for (let i = 0; i < 12; i++) {
    w.strike(CAM, -1.2, 0.5, 0, -0.4, 1.4, 0, 0.3, 0.9);
    w.caps(0.05, CAM.yaw);
  }
  for (let i = 0; i < 30; i++) w.caps(0.05, CAM.yaw);
  const after = w.caps(0.016, CAM.yaw).length;
  ok('letters struck repeatedly come away from the word', after < before * 0.95,
     `${before} chunks → ${after}`);
  ok('the rest of the word is still standing', after > before * 0.3,
     `${Math.round(100 * after / before)}% left`);
}

// --- 3: a word nobody touches loses nothing ---------------------------------
{
  const w = standing();
  const before = w.caps(0.016, CAM.yaw).length;
  for (let i = 0; i < 42; i++) w.caps(0.05, CAM.yaw);
  const after = w.caps(0.016, CAM.yaw).length;
  ok('an unstruck word keeps every letter through its hold', after >= before * 0.98,
     `${before} chunks → ${after}`);
}

// --- 4: nothing lands while the word is still pouring in --------------------
{
  const w = new WireTitle('the summoning pit', 12);
  w.caps(0.1, CAM.yaw);
  ok('a word still arriving cannot be hit',
     w.strike(CAM, 0, 1, 0, 0.6, 1.6, 0, 0.3, 2) === null);
}

console.log(bad ? `\n${bad} failed\n` : '\nall green\n');
process.exit(bad ? 1 : 0);
