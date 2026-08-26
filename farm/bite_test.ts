// A bite and a lash, frame by frame, side-on where the motion reads.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { hound, heightOf } from '../src/genome';
import { STRIKE_BITE, STRIKE_LASH } from '../src/character';
import { solvePose, slashWeight } from '../src/pose';
import { PixelRenderer, Camera } from '../src/render';

const CELL = 190, FRAMES = 6;
const renderer = new PixelRenderer(CELL, CELL);
const buf = new Uint8ClampedArray(CELL * CELL * 4);
const png = new PNG({ width: CELL * FRAMES, height: CELL * 2 });
const g = hound();
g.palette = { torso: '#6e7276', limbs: '#4c5054', head: '#d8b46a', accent: '#c14b4b' };
const h = heightOf(g);

[STRIKE_BITE, STRIKE_LASH].forEach((spec, row) => {
  for (let f = 0; f < FRAMES; f++) {
    const t = f / (FRAMES - 1);
    const cam: Camera = {
      yaw: row === 0 ? 0.15 : 0.95, pitch: row === 0 ? 0.14 : 0.5,
      ppm: (CELL * 0.42) / Math.max(h, 0.9), cy: h * 0.5, floor: false,
      blend: 1.1, blendShape: 0.5, blendMix: 1,
    };
    const caps = solvePose(g, { tired: 0, angry: 0.5 }, 0.1, 0, 0,
      { slash: { t, weight: slashWeight(t), spec } }, 0);
    renderer.render(buf, caps, cam, 0);
    const ox = f * CELL, oy = row * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const s = (y*CELL+x)*4, d = ((oy+y)*png.width + ox + x)*4;
      png.data[d]=buf[s]; png.data[d+1]=buf[s+1]; png.data[d+2]=buf[s+2]; png.data[d+3]=255;
    }
  }
});
writeFileSync('farm/out/bite_test.png', PNG.sync.write(png));
console.log('row 1: bite (side-on) · row 2: tail lash (from above)');
