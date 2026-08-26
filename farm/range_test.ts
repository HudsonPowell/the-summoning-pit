// Can the genome SAY these creatures? One row of presets, walking.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PRESETS, heightOf, Genome } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL = 150;
const names = Object.keys(PRESETS);
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const cols = 5, rows = Math.ceil(names.length / cols);
const png = new PNG({ width: CELL * cols, height: CELL * rows });

names.forEach((n, i) => {
  const g: Genome = PRESETS[n]();
  const h = heightOf(g);
  const cam: Camera = {
    yaw: 0.55, pitch: 0.26, ppm: (CELL * 0.62) / Math.max(h, 0.9), cy: h * 0.48,
    floor: false, blend: 1.2, blendShape: 0.5, blendMix: 1,
  };
  renderer.render(buf, solvePose(g, { tired: 0, angry: 0 }, 0.18), cam, 0);
  const ox = (i % cols) * CELL, oy = Math.floor(i / cols) * CELL;
  for (let y = 0; y < CELL; y++)
    for (let x = 0; x < CELL; x++) {
      const s = (y * CELL + x) * 4, d = ((oy + y) * png.width + ox + x) * 4;
      png.data[d] = buf[s]; png.data[d+1] = buf[s+1]; png.data[d+2] = buf[s+2]; png.data[d+3] = 255;
    }
});
mkdirSync('farm/out', { recursive: true });
writeFileSync('farm/out/range_test.png', PNG.sync.write(png));
console.log('farm/out/range_test.png —', names.join(', '));
