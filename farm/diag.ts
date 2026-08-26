import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { serpent, raptor, hydra, hippo, heightOf } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL = 240;
const set = [serpent(), raptor(), hydra(), hippo()];
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const png = new PNG({ width: CELL * set.length, height: CELL });
set.forEach((g, i) => {
  const h = heightOf(g);
  const cam: Camera = { yaw: 0, pitch: 0.12, ppm: (CELL * 0.3) / Math.max(h, 0.7),
    cy: h * 0.45, floor: false };
  renderer.render(buf, solvePose(g, { tired: 0, angry: 0 }, 0.18), cam, 0);
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const s = (y*CELL+x)*4, d = (y*png.width + i*CELL + x)*4;
    png.data[d]=buf[s]; png.data[d+1]=buf[s+1]; png.data[d+2]=buf[s+2]; png.data[d+3]=255;
  }
});
writeFileSync('farm/out/diag.png', PNG.sync.write(png));
console.log('serpent | raptor | hydra | hippo, side-on');
