// Every attack style at its strike apex. Arm styles on the scout, bite and
// lash on the hound, because those limbs are what perform them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped, hound, heightOf } from '../src/genome';
import { STRIKE_STYLES } from '../src/character';
import { solvePose, slashWeight } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL = 170;
const names = Object.keys(STRIKE_STYLES);
const cols = names.length;
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const png = new PNG({ width: CELL * cols, height: CELL * 2 });

names.forEach((n, i) => {
  const spec = STRIKE_STYLES[n];
  const beastly = spec.limb === 'head' || spec.limb === 'tail';
  const g = beastly ? hound() : defaultBiped();
  if (!beastly) g.weapon = { length: 0.62, r: 0.032, color: '#cfd6e4' };
  const h = heightOf(g);
  // two moments: mid-windup and the strike itself
  [spec.windup * 0.8, spec.windup + spec.strike * 0.55].forEach((t, row) => {
    const cam: Camera = {
      yaw: 0.5, pitch: 0.2, ppm: (CELL * 0.46) / Math.max(h, 0.9), cy: h * 0.5,
      floor: false, blend: 1.1, blendShape: 0.5, blendMix: 1,
    };
    const caps = solvePose(g, { tired: 0, angry: 0.4 }, 0.1, 0, 0,
      { slash: { t, weight: slashWeight(t), spec } }, 0, { weapon: undefined });
    renderer.render(buf, caps, cam, 0);
    const ox = i * CELL, oy = row * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const s = (y * CELL + x) * 4, d = ((oy + y) * png.width + ox + x) * 4;
      png.data[d]=buf[s]; png.data[d+1]=buf[s+1]; png.data[d+2]=buf[s+2]; png.data[d+3]=255;
    }
  });
});
mkdirSync('farm/out', { recursive: true });
writeFileSync('farm/out/attack_test.png', PNG.sync.write(png));
console.log('top row windup, bottom row strike:', names.join(' | '));
