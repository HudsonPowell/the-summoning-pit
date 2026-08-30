// The only bench that counts: hatch the same prompts through each candidate
// brain and RENDER the results side by side. Field counts lied — a model can
// compose six parts of nothing. Coherence is visible, not inferable.
//   HATCH_API_KEY=... HATCH_API_URL=... npx tsx farm/brain_sheet.ts model1 model2 ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { hatchGenome } from '../src/hatch';
import { makeCharacter } from '../src/character';
import { heightOf } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { drawText, wrap } from './font';

const MODELS = process.argv.slice(2);
if (!MODELS.length) { console.error('pass model ids'); process.exit(1); }
const PROMPTS = [
  'a hooded pale hunter with a tall silver longbow',
  'a rust-armoured toad king trailing a moth-eaten cloak',
  'a censer priest swinging green smoke on a chain',
  'a crowned moth queen with four wings and a curved horn bow',
];
const CELL = 210, LAB = 14;
mkdirSync('farm/out', { recursive: true });
const r = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const sheet = new PNG({ width: CELL * PROMPTS.length, height: (CELL + LAB) * MODELS.length + LAB });

for (let row = 0; row < MODELS.length; row++) {
  for (let col = 0; col < PROMPTS.length; col++) {
    const oy = LAB + row * (CELL + LAB), ox = col * CELL;
    try {
      const g = await hatchGenome(PROMPTS[col], MODELS[row], undefined, undefined,
        Number(process.env.BRAIN_TEMP ?? 0.85));
      const ch = makeCharacter(g, 'beast');
      const caps = solvePose(g, { tired: 0, angry: 0 }, 0.22, 1, 0, undefined, 0,
        { weapon: ch.weapon, offhand: ch.offhand, gear: ch.gear as any });
      let reach = 0.2, minY = Infinity, maxY = -Infinity;
      for (const c of caps) for (const p of [c.a, c.b]) {
        reach = Math.max(reach, Math.hypot(p.x, p.z) + c.r);
        minY = Math.min(minY, p.y - c.r); maxY = Math.max(maxY, p.y + c.r);
      }
      const cam: Camera = { yaw: 0.5, pitch: 0.2, ppm: (CELL * 0.8) / Math.max(reach * 2, maxY - minY, heightOf(g)),
        cy: (minY + maxY) / 2, floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1, voidColor: [10, 8, 14] };
      r.render(buf, caps, cam, 0);
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const s = (y * CELL + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.data[d] = buf[s]; sheet.data[d+1] = buf[s+1]; sheet.data[d+2] = buf[s+2]; sheet.data[d+3] = 255;
      }
      console.log(`${MODELS[row].split('/')[1]} × "${PROMPTS[col].slice(0, 30)}" ok`);
    } catch (e: any) {
      drawText(sheet.data, sheet.width, sheet.height, 'FAILED', ox + 6, oy + CELL / 2, [200, 90, 80], 1);
      console.log(`${MODELS[row].split('/')[1]} × "${PROMPTS[col].slice(0, 30)}" FAILED ${String(e?.message ?? e).slice(0, 50)}`);
    }
  }
  drawText(sheet.data, sheet.width, sheet.height, MODELS[row].toUpperCase(), 5, LAB + row * (CELL + LAB) + CELL + 3, [196, 186, 160], 1);
}
PROMPTS.forEach((p2, col) =>
  wrap(p2, CELL - 8, 1).slice(0, 1).forEach(l =>
    drawText(sheet.data, sheet.width, sheet.height, l, col * CELL + 4, 3, [110, 118, 128], 1)));
writeFileSync('farm/out/brains.png', PNG.sync.write(sheet));
console.log('farm/out/brains.png');
