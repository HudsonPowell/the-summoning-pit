// Sixteen headings around the compass, rendered exactly the way the arena
// does it: the pose is rotated to its heading and shot with one fixed camera.
// The eight cardinal + diagonal directions the pad can produce are the first
// eight; the in-between frames prove the orientation is continuous, not
// snapped to a handful of hand-picked camera angles.

import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { defaultBiped } from '../src/genome';
import { solvePose, Capsule } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';
import { rotY } from '../src/vec';

const CELL = 72;
const COLS = 8;
const ROWS = 2;

const g = defaultBiped();
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const png = new PNG({ width: CELL * COLS, height: CELL * ROWS });

const cam: Camera = {
  yaw: 0, pitch: 0.3, ppm: 34, cy: 0.85, floor: false,
  blend: 1.5, blendDepth: 0.35, blendMix: 1, blendShape: 0.5,
};

const oriented = (caps: Capsule[], heading: number): Capsule[] =>
  caps.map(c => ({ ...c, a: rotY(c.a, -heading), b: rotY(c.b, -heading) }));

for (let i = 0; i < COLS * ROWS; i++) {
  // the eight pad directions first, then the halfway angles between them
  const step = (Math.PI * 2) / 8;
  const heading = i < 8 ? i * step : (i - 8) * step + step / 2;
  const caps = solvePose(g, { tired: 0, angry: 0 }, 0.15, 1, 0);
  renderer.render(buf, oriented(caps, heading), cam, 0);
  const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
  for (let y = 0; y < CELL; y++)
    for (let x = 0; x < CELL; x++) {
      const s = (y * CELL + x) * 4;
      const d = ((oy + y) * png.width + ox + x) * 4;
      png.data[d] = buf[s];
      png.data[d + 1] = buf[s + 1];
      png.data[d + 2] = buf[s + 2];
      png.data[d + 3] = 255;
    }
}

mkdirSync('farm/out', { recursive: true });
writeFileSync('farm/out/facing_test.png', PNG.sync.write(png));
console.log('farm/out/facing_test.png');
console.log('row 1: the 8 pad directions (E, SE, S, SW, W, NW, N, NE)');
console.log('row 2: the halfway angles — continuous, not snapped');
