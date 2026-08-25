// Evidence for the CLASH art-direction question: can the rig RENDER the
// game's figures, flat, at 16x24-sprite scale — instead of anyone drawing
// sprites? Top row shaded (studio look), bottom row flat (CLASH look).

import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped, imp, hound, troll, ogre, Genome } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL_W = 28, CELL_H = 32; // px per creature cell at sprite scale
const SCALE = 8; // upscale for viewing
const PHASE = 0.18; // mid-stride

function heightOf(g: Genome): number {
  const sk = g.skeleton;
  const legs = sk.chains.filter(c => c.role === 'leg' && c.attach === 'hip');
  const legLen = legs.length ? Math.max(...legs.map(c => c.seg[0] + c.seg[1])) : 0.8;
  return sk.prone
    ? legLen + sk.torsoR + sk.headR * 2
    : legLen + sk.spine + sk.neck + sk.headR * 2;
}

const creatures = [defaultBiped(), imp(), hound(), troll(), ogre()];
const png = new PNG({ width: CELL_W * creatures.length * SCALE, height: CELL_H * 2 * SCALE });
png.data.fill(0);
// black background, full alpha
for (let i = 0; i < png.data.length; i += 4) png.data[i + 3] = 255;

const renderer = new PixelRenderer(CELL_W, CELL_H);
const buf = new Uint8ClampedArray(CELL_W * CELL_H * 4);

creatures.forEach((g, col) => {
  const h = heightOf(g);
  const ppm = 22 / h; // every creature ~22px tall — CLASH figures are 24px incl. headroom
  [false, true].forEach((flat, row) => {
    const cam: Camera = {
      yaw: 0.45, pitch: 0.3, ppm, cy: h * 0.48,
      flat, floor: false,
    };
    const caps = solvePose(g, { tired: 0, angry: 0 }, PHASE);
    renderer.render(buf, caps, cam, 0);
    const ox = col * CELL_W * SCALE, oy = row * CELL_H * SCALE;
    for (let y = 0; y < CELL_H; y++)
      for (let x = 0; x < CELL_W; x++) {
        const s = (y * CELL_W + x) * 4;
        for (let dy = 0; dy < SCALE; dy++)
          for (let dx = 0; dx < SCALE; dx++) {
            const d = ((oy + y * SCALE + dy) * png.width + ox + x * SCALE + dx) * 4;
            png.data[d] = buf[s];
            png.data[d + 1] = buf[s + 1];
            png.data[d + 2] = buf[s + 2];
            png.data[d + 3] = 255;
          }
      }
  });
});

mkdirSync('farm/out', { recursive: true });
writeFileSync('farm/out/flat_test.png', PNG.sync.write(png));
console.log('farm/out/flat_test.png — top: shaded, bottom: CLASH flat, all ~22px tall');
