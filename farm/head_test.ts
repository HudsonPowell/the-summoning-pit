// A head has to read as a head.
//
// Nothing ever related a head to the body under it: `r` is an absolute radius
// the model picks alone, so the live pit ran from heads half the width of the
// shoulders they sat on to heads two and a half times them. The budget lives
// in migrateGenome, which means it runs on EVERY read of every genome — so the
// property that matters most here is not the clamp, it is that running it
// again changes nothing. A rule that grew a neck by a few percent per read
// would give the pit giraffes over a week of saves and reloads.
import { migrateGenome, defaultBiped, girthAt, Genome } from '../src/genome';

let bad = 0;
const ok = (name: string, pass: boolean, saw = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}   ${name}${saw ? ` — ${saw}` : ''}`);
  if (!pass) bad++;
};
const head = (g: Genome) => g.skeleton.chains.find(c => c.role === 'head')!;
const neck = (g: Genome) => head(g).seg.reduce((a, b) => a + b, 0);
const clone = (g: any) => JSON.parse(JSON.stringify(g));

console.log('\na head has to read as a head');

// --- the calibration: the creature every default is cut from ---------------
{
  const before = clone(defaultBiped());
  const after = migrateGenome(clone(before));
  const h0 = before.skeleton.chains.find((c: any) => c.role === 'head');
  ok('the hand-drawn biped is left exactly alone',
     head(after).r === h0.r && Math.abs(neck(after) - h0.seg.reduce((a: number, b: number) => a + b, 0)) < 1e-9,
     `r ${h0.r}→${head(after).r}`);
}

// --- a balloon is brought back ---------------------------------------------
{
  const g = clone(defaultBiped());
  const h = g.skeleton.chains.find((c: any) => c.role === 'head');
  h.r = 0.34;                                   // two and a half times the shoulders
  const after = migrateGenome(clone(g));
  const shoulder = girthAt(after.skeleton, (head(after).at ?? 1) * after.skeleton.body.length);
  ok('a head far wider than its body is brought back',
     head(after).r < 0.34 && head(after).r <= shoulder * 1.5 + 1e-9,
     `r 0.34 → ${head(after).r.toFixed(3)}, shoulder ${shoulder.toFixed(3)}`);
  ok('but it is still a big head, not a standard one',
     head(after).r > shoulder, `${(head(after).r / shoulder).toFixed(2)}x the shoulder`);
}

// --- a short neck is lengthened until the head stands clear -----------------
{
  const g = clone(defaultBiped());
  const h = g.skeleton.chains.find((c: any) => c.role === 'head');
  h.seg = [0.06, 0.07];                          // a neck, but a short one
  const after = migrateGenome(clone(g));
  const shoulder = girthAt(after.skeleton, (head(after).at ?? 1) * after.skeleton.body.length);
  ok('a short neck is lengthened until the head stands clear',
     neck(after) > 0.13, `neck 0.130 → ${neck(after).toFixed(3)}`);
  ok('more than half the ball ends up outside the body',
     neck(after) >= shoulder + head(after).r * 0.55 - 1e-9,
     `${neck(after).toFixed(3)} vs ${(shoulder + head(after).r * 0.55).toFixed(3)} needed`);
}

// --- one that cannot be solved is left alone, not turned into a giraffe -----
{
  const g = clone(defaultBiped());
  const h = g.skeleton.chains.find((c: any) => c.role === 'head');
  h.seg = [0.02, 0.03];                          // no neck at all
  const after = migrateGenome(clone(g));
  ok('a head with no neck at all is left as the model wrote it',
     Math.abs(neck(after) - 0.05) < 1e-9,
     `neck stayed ${neck(after).toFixed(3)} rather than stretching to clear`);
}

// --- THE ONE THAT MATTERS: reading it again changes nothing -----------------
{
  const cases: [string, any][] = [
    ['a balloon head', (() => { const g = clone(defaultBiped()); g.skeleton.chains.find((c: any) => c.role === 'head').r = 0.3; return g; })()],
    ['a buried head', (() => { const g = clone(defaultBiped()); g.skeleton.chains.find((c: any) => c.role === 'head').seg = [0.02, 0.03]; return g; })()],
    ['the plain biped', clone(defaultBiped())],
  ];
  let drifted = '';
  for (const [what, g0] of cases) {
    let g = migrateGenome(clone(g0));
    const r1 = head(g).r, n1 = neck(g);
    for (let i = 0; i < 20; i++) g = migrateGenome(clone(g));   // twenty saves and loads
    if (Math.abs(head(g).r - r1) > 1e-9 || Math.abs(neck(g) - n1) > 1e-9) {
      drifted += ` ${what}: r ${r1.toFixed(4)}→${head(g).r.toFixed(4)} neck ${n1.toFixed(4)}→${neck(g).toFixed(4)};`;
    }
  }
  ok('twenty more reads change nothing at all', !drifted, drifted || 'stable');
}

console.log(bad ? `\n${bad} failed\n` : '\nall green\n');
process.exit(bad ? 1 : 0);
