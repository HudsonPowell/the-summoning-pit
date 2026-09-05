// The word, left alone and under attack, side by side.
//
// The live pit cannot show this on demand — the title runs for ten seconds
// once per load, and whether a creature happens to swing through the E is up
// to the creature. So the fight is staged here: the same word, the same
// seconds, with and without blades going through it.
//   npx tsx farm/title_fight.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { WireTitle } from '../src/void/wiretitle';
import { PixelRenderer, Camera } from '../src/render';

const W = 420, H = 210;
// the seconds the word is actually standing there to be hit
const SHOTS = [3.8, 4.4, 5.0, 5.6, 6.2, 6.8];
const DT = 1 / 60;
const CAM: Camera = {
  yaw: 0.5, pitch: 0.34, ppm: (H * 0.46) / 4.4 * 2.2, cy: 1.6, cx: 0, cz: 0,
  floor: false, blend: 1.8, blendShape: 0.6, blendMix: 1, voidColor: [52, 47, 62],
};
const tc = { yaw: CAM.yaw, pitch: CAM.pitch, cx: 0, cz: 0 };

mkdirSync('farm/out', { recursive: true });
const r = new PixelRenderer(W, H);
const buf = new Uint8ClampedArray(W * H * 4);
const sheet = new PNG({ width: W * SHOTS.length, height: H * 2 });

/** Where a creature's blade is, mid-swing, at a given moment of the fight. */
function blade(t: number) {
  const k = Math.floor(t * 2.2);                 // a blow every 0.6s or so
  const x = -2.4 + ((k * 1.7) % 5) ;             // it moves along the pit
  const z = -1 + ((k * 0.9) % 2.4);
  const a = 0.4 + (k % 3) * 0.5;                 // and swings at its own height
  return { ax: x - 0.5, ay: a + 0.8, az: z, bx: x + 0.5, ay2: a, bz: z };
}

for (let row = 0; row < 2; row++) {
  const title = new WireTitle('the summoning pit', 12);
  let t = 0, shot = 0, swung = -1;
  while (shot < SHOTS.length) {
    if (row === 1) {
      const k = Math.floor(t * 2.2);
      if (k !== swung && t > 3.75) {
        swung = k;
        const b = blade(t);
        title.strike(tc, b.ax, b.ay, b.az, b.bx, b.ay2, b.bz, 0.3, 0.95);
      }
    }
    const caps = title.caps(DT, CAM.yaw);
    t += DT;
    if (t >= SHOTS[shot]) {
      r.render(buf, caps, CAM, 0);
      const ox = shot * W, oy = row * H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4, d = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.data[d] = buf[s]; sheet.data[d + 1] = buf[s + 1];
        sheet.data[d + 2] = buf[s + 2]; sheet.data[d + 3] = 255;
      }
      shot++;
    }
    if (t > 14) break;
  }
  console.log(`row ${row}: ${row ? 'under attack' : 'left alone'} — ${title.cuts}/${title.glyphs} letters taken off`);
}
writeFileSync('farm/out/title_fight.png', PNG.sync.write(sheet));
console.log(`farm/out/title_fight.png — top row untouched, bottom row struck (${SHOTS.join('s, ')}s)`);
