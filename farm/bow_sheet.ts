// Every bow in the armoury, carried and mid-draw, so a change to the grip or
// the silhouette is seen before it ships. npx tsx farm/bow_sheet.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped, Genome } from '../src/genome';
import { makeCharacter, STRIKE_SHOOT } from '../src/character';
import { weaponsFromWords } from '../src/smith';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { drawText, wrap } from './font';

const CASES = [
  'a skeleton archer with a bow',
  'a hooded ranger with a longbow',
  'a goblin raider with a shortbow',
  'a giant with a greatbow',
];
const W = 250, LAB = 26, COLS = 4, ROWS = 2;
mkdirSync('farm/out', { recursive: true });
const r = new PixelRenderer(W, W);
const buf = new Uint8ClampedArray(W * W * 4);
const sheet = new PNG({ width: W * COLS, height: (W + LAB) * ROWS });

for (let row = 0; row < ROWS; row++) CASES.forEach((desc, i) => {
  const g: Genome = JSON.parse(JSON.stringify(defaultBiped()));
  g.weapon = weaponsFromWords(desc).main as any;
  const ch = makeCharacter(g, 'beast');
  // row 0 carries the bow; row 1 is caught at the top of the draw
  const intent = row === 1
    ? { slash: { t: 0.6, weight: 1, spec: (ch.behaviors['attack-light'] as any)?.strike ?? STRIKE_SHOOT } }
    : undefined;
  const caps = solvePose(g, { tired: 0, angry: row }, 0.22, row === 1 ? 0.2 : 1, 0, intent, 0,
    { weapon: ch.weapon, offhand: ch.offhand });
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) for (const p of [c.a, c.b]) {
    reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
    minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
  }
  const cam: Camera = { yaw: 0.5, pitch: 0.18, ppm: (W * 0.84) / Math.max(reach * 2, maxY - minY),
    cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14] };
  r.render(buf, caps, cam, 0);
  const ox = i * W, oy = row * (W + LAB);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
  }
  for (let y = W; y < W + LAB; y++) for (let x = 0; x < W; x++) {
    const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
  }
  const label = `${ch.weapon?.name ?? 'none'} ${row === 1 ? '(drawn)' : '(carried)'}`;
  drawText(sheet.data, sheet.width, sheet.height, label.toUpperCase(), ox + 5, oy + W + 4, [196, 186, 160], 1);
  wrap(desc, W - 10, 1).slice(0, 1).forEach(l =>
    drawText(sheet.data, sheet.width, sheet.height, l, ox + 5, oy + W + 15, [110, 118, 128], 1));
});
writeFileSync('farm/out/bows.png', PNG.sync.write(sheet));
console.log('farm/out/bows.png');
