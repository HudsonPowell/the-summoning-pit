// What the pit is wearing, and what the cloth does when the body moves.
// node --import tsx farm/gear_preview.ts [out-dir]
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pitCam } from './social';
import { gearFromWords, GearPiece } from '../src/gear';
import { weaponsFromWords } from '../src/smith';
import { defaultBiped, heightOf } from '../src/genome';
import { solvePose, slashWeight, Capsule, Intent } from '../src/pose';
import { PixelRenderer } from '../src/render';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/gear'); mkdirSync(out, { recursive: true });
const W = 250, H = 300, BANNER = 46, LABEL = 22;

// the states that make cloth confess: still, walking, running, hard turn, swinging
const STATES: { name: string; mv: number; turn: number; strike: number }[] = [
  { name: 'standing', mv: 0, turn: 0, strike: 0 },
  { name: 'walking', mv: 0.5, turn: 0, strike: 0 },
  { name: 'running', mv: 1, turn: 0, strike: 0 },
  { name: 'hard turn', mv: 1, turn: 3.2, strike: 0 },
  { name: 'mid-swing', mv: 0.35, turn: 0, strike: 0.45 },
];

const LOOKS = [
  'a knight in full plate with a longsword',
  'a hooded assassin in a black cloak with a dagger',
  'an old wizard in robes and a pointed hat with a staff',
  'a fur-mantled barbarian chieftain with an axe',
];

const r = new PixelRenderer(W, H);
const px = new Uint8ClampedArray(W * H * 4);
const ROWS = LOOKS.length + 1;
const sheet = new PNG({ width: W * STATES.length, height: (H + LABEL) * ROWS + BANNER });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 10; sheet.data[i + 1] = 12; sheet.data[i + 2] = 16; sheet.data[i + 3] = 255;
}
drawText(sheet.data, sheet.width, sheet.height, 'WORN — AND WHAT THE CLOTH DOES', 18, 15, [223, 224, 213], 2);

function draw(row: number, col: number, caps: Capsule[], h: number, label?: string) {
  r.render(px, caps, pitCam({ ppm: (H * 0.42) / Math.max(0.9, h), yaw: 0.85, pitch: 0.22, cy: h * 0.52 }), 0);
  const ox = col * W, oy = BANNER + row * (H + LABEL);
  for (let y = 0; y < H; y++) {
    sheet.data.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * sheet.width + ox) * 4);
  }
  if (label) drawText(sheet.data, sheet.width, sheet.height, label, ox + 8, oy + H + 7, [110, 118, 128], 1);
}

function pose(gear: GearPiece[], weapon: any, st: typeof STATES[0], t: number): Capsule[] {
  const g = defaultBiped();
  const intent: Intent | undefined = st.strike
    ? { slash: { t: st.strike, weight: slashWeight(st.strike) } } : undefined;
  return solvePose(g, { tired: 0, angry: 0 }, (t * 1.4) % 1, st.mv, t, intent, 0, {
    gear, weapon, turn: st.turn, lean: st.turn * -0.08, twist: st.turn * -0.05,
  });
}

LOOKS.forEach((desc, row) => {
  const gear = gearFromWords(desc);
  const weapon = weaponsFromWords(desc).main;
  const h = heightOf(defaultBiped());
  STATES.forEach((st, col) => {
    draw(row, col, pose(gear, weapon, st, 2.15), h, col === 0 ? desc.slice(0, 34) : st.name);
  });
  console.log(`${desc.slice(0, 40).padEnd(42)} ${gear.map(g => g.name).join(', ')}`);
});

// the honest A/B: the same cloak, running, with the cloth switched off and on
{
  const row = LOOKS.length;
  const gear = gearFromWords('a hooded assassin in a black cloak');
  const stiff: GearPiece[] = gear.map(g => ({ ...g, drape: 0 }));
  const h = heightOf(defaultBiped());
  const run = STATES[2], turn = STATES[3];
  draw(row, 0, pose(stiff, undefined, run, 2.15), h, 'cloth OFF — running');
  draw(row, 1, pose(gear, undefined, run, 2.15), h, 'cloth ON — running');
  draw(row, 2, pose(stiff, undefined, turn, 2.15), h, 'cloth OFF — turning');
  draw(row, 3, pose(gear, undefined, turn, 2.15), h, 'cloth ON — turning');
  draw(row, 4, pose(gear, undefined, STATES[0], 2.15), h, 'cloth ON — standing');
}

writeFileSync(resolve(out, 'worn.png'), PNG.sync.write(sheet));
console.log(resolve(out, 'worn.png'));
