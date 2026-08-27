import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped, hound, Genome } from '../src/genome';
import { makeCharacter } from '../src/character';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { gearFromWords } from '../src/gear';
import { drawText, wrap } from './font';

const CASES = [
  'a knight in heavy plate with a greatsword',
  'a hooded ranger with a longbow',
  'a horned barbarian chieftain with a great axe',
  'a robed necromancer with a bone wand',
  'a caped champion with a crest and a sword',
  'a ragged ghoul',
  'a tortoise with a mossy shell',
  'a plain wanderer with a spear',
];
const W = 250, LAB = 26, COLS = 4;
mkdirSync('farm/out', { recursive: true });
const r = new PixelRenderer(W, W);
const buf = new Uint8ClampedArray(W * W * 4);
const sheet = new PNG({ width: W * COLS, height: (W + LAB) * Math.ceil(CASES.length / COLS) });

CASES.forEach((desc, i) => {
  const g: Genome = JSON.parse(JSON.stringify(/tortoise/.test(desc) ? hound() : defaultBiped()));
  g.gear = gearFromWords(desc) as any;
  const ch = makeCharacter(g, 'beast');
  const caps = solvePose(g, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
    { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
  let reach = 0.2, minY = Infinity, maxY = -Infinity;
  for (const c of caps) for (const p of [c.a, c.b]) {
    reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
    minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
  }
  const cam: Camera = { yaw: 0.5, pitch: 0.18, ppm: (W * 0.84) / Math.max(reach * 2, maxY - minY),
    cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14] };
  r.render(buf, caps, cam, 0);
  const ox = (i % COLS) * W, oy = Math.floor(i / COLS) * (W + LAB);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
  }
  for (let y = W; y < W + LAB; y++) for (let x = 0; x < W; x++) {
    const d = ((oy + y) * sheet.width + ox + x) * 4;
    sheet.data[d] = 6; sheet.data[d+1] = 6; sheet.data[d+2] = 9; sheet.data[d+3] = 255;
  }
  wrap((g.gear ?? []).map((x: any) => x.name).join(' + ') || 'nothing', W - 10, 1).forEach((l, li) =>
    drawText(sheet.data, sheet.width, sheet.height, l.toUpperCase(), ox + 5, oy + W + 4 + li * 9, [196, 186, 160], 1));
  wrap(desc, W - 10, 1).slice(0, 1).forEach(l =>
    drawText(sheet.data, sheet.width, sheet.height, l, ox + 5, oy + W + 15, [110, 118, 128], 1));
});
writeFileSync('farm/out/gear.png', PNG.sync.write(sheet));
console.log('farm/out/gear.png');
