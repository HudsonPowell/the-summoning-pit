// Render a row of freshly hatched genomes, so variety is visible not inferred.
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { migrateGenome, heightOf } from '../src/genome';
import { solvePose } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const files = process.argv.slice(2);
const CELL = 190;
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const png = new PNG({ width: CELL * files.length, height: CELL });
files.forEach((f, i) => {
  const g = migrateGenome(JSON.parse(readFileSync(`genomes/${f}.json`, 'utf8')));
  const h = heightOf(g);
  const cam: Camera = { yaw: 0.5, pitch: 0.24, ppm: (CELL * 0.5) / Math.max(h, 0.8),
    cy: h * 0.45, floor: false, blend: 1.2, blendShape: 0.5, blendMix: 1 };
  renderer.render(buf, solvePose(g, { tired: 0, angry: 0 }, 0.2), cam, 0);
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const s = (y*CELL+x)*4, d = (y*png.width + i*CELL + x)*4;
    png.data[d]=buf[s]; png.data[d+1]=buf[s+1]; png.data[d+2]=buf[s+2]; png.data[d+3]=255;
  }
});
writeFileSync('farm/out/hatched_sheet.png', PNG.sync.write(png));
console.log(files.join(' | '));
