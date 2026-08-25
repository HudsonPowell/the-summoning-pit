// The blend parameter space, headless. Columns: softness k. Rows: how the
// fused silhouette is dialled back (shape fuse) and how far ink may bleed
// across depth (blend depth).

import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { troll } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL = 132;
const KS = [0, 1, 2, 4];
const ROWS: { label: string; shape: number; depth: number }[] = [
  { label: 'fused', shape: 1, depth: 0.35 },
  { label: 'hard silhouette', shape: 0, depth: 0.35 },
  { label: 'deep bleed', shape: 1, depth: 1.2 },
];

const g = troll();
const png = new PNG({ width: CELL * KS.length, height: CELL * ROWS.length });
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const caps = solvePose(g, { tired: 0, angry: 0 }, 0.18);

ROWS.forEach((row, ry) => {
  KS.forEach((k, cx) => {
    const cam: Camera = {
      yaw: 0.5, pitch: 0.22, ppm: 62, cy: 0.95, floor: false,
      blend: k, blendDepth: row.depth, blendMix: 1, blendShape: row.shape,
    };
    renderer.render(buf, caps, cam, 0);
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const s = (y * CELL + x) * 4;
        const d = ((ry * CELL + y) * png.width + cx * CELL + x) * 4;
        png.data[d] = buf[s];
        png.data[d + 1] = buf[s + 1];
        png.data[d + 2] = buf[s + 2];
        png.data[d + 3] = 255;
      }
  });
});

mkdirSync('farm/out', { recursive: true });
writeFileSync('farm/out/blend_test.png', PNG.sync.write(png));
console.log('farm/out/blend_test.png');
console.log('columns: blend k =', KS.join(', '));
console.log('rows:', ROWS.map(r => r.label).join(' / '));
