// Determinism + class-rule tests for the CLASH sim. The sim is pure and
// integer-only, so a scripted replay must produce a bit-identical hash every
// time — that property is what netcode, spectating and desync detection will
// all rest on. Run: npx tsx farm/sim_test.ts

import {
  createGame, step, Input, Pattern, Game, GW, TS, T,
} from '../src/clash/sim';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const NONE: Input = { dx: 0, dy: 0, place: false, melee: false };
const mv = (dx: -1 | 0 | 1, dy: -1 | 0 | 1, place = false, melee = false): Input =>
  ({ dx, dy, place, melee });

function cfgFor(pattern: Pattern, fuse = 60, radius = 2) {
  return {
    players: [
      { fuse, radius, pattern },
      { fuse, radius, pattern },
    ],
    beastDefs: [],
    beastBase: 0,
  };
}

/** A cheap but thorough state fingerprint. */
function hash(g: Game): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => {
    h ^= v | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(g.tick);
  mix(g.round);
  mix(g.rng);
  for (const p of g.players) {
    mix(p.x); mix(p.y); mix(p.hp); mix(p.alive ? 1 : 0);
    mix(p.radius); mix(p.maxCandles); mix(p.speed); mix(p.wins);
  }
  for (const c of g.candles) { mix(c.tx); mix(c.ty); mix(c.timer); mix(c.pattern); mix(c.walking ? 1 : 0); }
  for (const b of g.beasts) { mix(b.x); mix(b.y); mix(b.hp); mix(b.biteT); }
  for (let i = 0; i < g.grid.length; i++) mix(g.grid[i] * (i + 1));
  for (let i = 0; i < g.flame.length; i++) if (g.flame[i]) mix(g.flame[i] * (i + 7));
  for (let i = 0; i < g.vine.length; i++) if (g.vine[i]) mix(g.vine[i] * (i + 13));
  for (let i = 0; i < g.oil.length; i++) if (g.oil[i]) mix(g.oil[i] * (i + 17));
  for (const pk of g.pickups) { mix(pk.tx); mix(pk.ty); mix(pk.kind); }
  return h >>> 0;
}

/** Deterministic pseudo-input so replays exercise a lot of surface. */
function scriptedInput(tick: number, pi: number): Input {
  const n = (tick * (pi + 3) * 2654435761) >>> 0;
  const roll = (n >>> 8) % 16;
  const dx = (roll % 3) - 1;
  const dy = ((roll >> 2) % 3) - 1;
  return {
    dx: dx as Input['dx'],
    dy: dy as Input['dy'],
    place: roll === 5,
    melee: roll === 9,
  };
}

function runReplay(seed: number, ticks: number, pattern: Pattern): number {
  const g = createGame(2, seed, cfgFor(pattern, 90, 2));
  for (let t = 0; t < ticks; t++) step(g, [scriptedInput(t, 0), scriptedInput(t, 1)]);
  return hash(g);
}

console.log('\ndeterminism');
for (const pattern of [Pattern.FLAME, Pattern.RUNE, Pattern.VINE, Pattern.OIL, Pattern.CURSE, Pattern.BELL, Pattern.IMP]) {
  const a = runReplay(0xC1A54, 900, pattern);
  const b = runReplay(0xC1A54, 900, pattern);
  check(`900 ticks reproduce exactly (pattern ${pattern})`, a === b, `${a} vs ${b}`);
}
{
  const a = runReplay(0xC1A54, 600, Pattern.FLAME);
  const b = runReplay(0xC1A55, 600, Pattern.FLAME);
  check('different seeds diverge', a !== b);
}

console.log('\nclass rules');

// FLAME: destroys exactly one block per arm
{
  const g = createGame(2, 1, cfgFor(Pattern.FLAME, 30, 3));
  g.introT = 0;
  const before = Array.from(g.grid).filter(t => t === T.BLOCK).length;
  step(g, [mv(0, 0, true), NONE]);
  for (let i = 0; i < 40; i++) step(g, [NONE, NONE]);
  const after = Array.from(g.grid).filter(t => t === T.BLOCK).length;
  check('flame destroys blocks', after < before, `${before} → ${after}`);
}

// VINE: grows walls, destroys nothing
{
  const g = createGame(2, 1, cfgFor(Pattern.VINE, 30, 3));
  g.introT = 0;
  const before = Array.from(g.grid).filter(t => t === T.BLOCK).length;
  step(g, [mv(0, 0, true), NONE]);
  for (let i = 0; i < 40; i++) step(g, [NONE, NONE]);
  const after = Array.from(g.grid).filter(t => t === T.BLOCK).length;
  const vines = Array.from(g.vine).filter(v => v > 0).length;
  check('vine builds wall', vines > 0, `${vines} tiles`);
  check('vine destroys nothing', after === before, `${before} → ${after}`);
  const flames = Array.from(g.flame).filter(f => f > 0).length;
  check('vine makes no fire', flames === 0);
  for (let i = 0; i < 260; i++) step(g, [NONE, NONE]);
  check('vine wall rots away', Array.from(g.vine).every(v => v <= 0));
}

// OIL: inert until fire touches it, then chains
{
  const g = createGame(2, 1, cfgFor(Pattern.OIL, 30, 3));
  g.introT = 0;
  step(g, [mv(0, 0, true), NONE]);
  for (let i = 0; i < 30; i++) step(g, [NONE, NONE]);
  const oiled = Array.from(g.oil).filter(o => o > 0).length;
  check('oil paints a slick', oiled > 1, `${oiled} tiles`);
  check('oil is inert (no flame, player unharmed)',
    Array.from(g.flame).every(f => f <= 0) && g.players[0].hp === 3);
  // now light it with a flame candle placed by player 2's config
  g.cfg.players[1].pattern = Pattern.FLAME;
  const p2 = g.players[1];
  // move p2 onto an oiled tile
  const oilIdx = Array.from(g.oil).findIndex(o => o > 0);
  p2.x = (oilIdx % GW) * TS + TS / 2;
  p2.y = Math.floor(oilIdx / GW) * TS + TS / 2;
  step(g, [NONE, mv(0, 0, true)]);
  for (let i = 0; i < 40; i++) step(g, [NONE, NONE]);
  const burned = Array.from(g.oil).filter(o => o > 0).length;
  check('fire ignites the slick', burned < oiled, `${oiled} → ${burned}`);
}

// BELL: shoves two tiles down a clear corridor, never kills
{
  const g = createGame(2, 1, cfgFor(Pattern.BELL, 30, 2));
  g.introT = 0;
  const p2 = g.players[1];
  p2.x = g.players[0].x + TS * 2;
  p2.y = g.players[0].y;
  for (let tx = 3; tx < 9; tx++) {
    const i = 1 * GW + tx;
    if (g.grid[i] === T.BLOCK) g.grid[i] = T.FLOOR; // clear the lane
  }
  const beforeX = p2.x;
  step(g, [mv(0, 0, true), NONE]);
  for (let i = 0; i < 40; i++) step(g, [NONE, NONE]);
  const tiles = (p2.x - beforeX) / TS;
  check('bell shoves two tiles', tiles >= 1.9 && tiles <= 2.2, `${tiles.toFixed(2)} tiles`);
  check('bell never damages', p2.hp === 3 && g.players[0].hp === 3);
  check('bell destroys no blocks', Array.from(g.grid).filter(t => t === T.BLOCK).length > 0);
}

// IMP: the bomb walks before it bursts
{
  const g = createGame(2, 1, cfgFor(Pattern.IMP, 30, 2));
  g.introT = 0;
  const startTx = Math.floor(g.players[0].x / TS);
  step(g, [mv(0, 0, true), NONE]);
  check('imp starts walking', g.candles[0]?.walking === true);
  let walkedTx = startTx;
  for (let i = 0; i < 120 && g.candles.length; i++) {
    step(g, [NONE, NONE]);
    if (g.candles[0]) walkedTx = g.candles[0].tx;
  }
  check('imp travelled from where it was placed', walkedTx !== startTx, `${startTx} → ${walkedTx}`);
}

// RUNE: an enemy standing still on it scuffs it out
{
  const g = createGame(2, 1, cfgFor(Pattern.RUNE, 600, 2));
  g.introT = 0;
  step(g, [mv(0, 0, true), NONE]);
  check('rune placed', g.candles.length === 1);
  const c = g.candles[0];
  const p2 = g.players[1];
  p2.x = c.tx * TS + TS / 2;
  p2.y = c.ty * TS + TS / 2;
  for (let i = 0; i < 40; i++) step(g, [NONE, NONE]); // p2 stands still on it
  check('enemy scuffs the rune out', g.candles.length === 0);
  check('scuffing does not hurt', p2.hp === 3);
}

console.log(failures === 0 ? '\nall green\n' : `\n${failures} FAILURES\n`);
process.exit(failures === 0 ? 0 : 1);
